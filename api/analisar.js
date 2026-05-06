// /api/analisar.js — LexVeritas API Endpoint
// Vercel Serverless Function — Node.js 18+ — CommonJS

const SUPABASE_URL      = 'https://bsbgizaftamufmmxeyer.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJzYmdpemFmdGFtdWZtbXhleWVyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc3NDkzNTIsImV4cCI6MjA5MzMyNTM1Mn0._xBiw0VUa3FSnortYseUQPDc5xb--k15lYcylNmMEEQ';

// ─────────────────────────────────────────────────────────────────────────────
// UTILITÁRIOS
// ─────────────────────────────────────────────────────────────────────────────

function clamp(val) {
  const n = Number(val);
  return isNaN(n) ? 50 : Math.max(0, Math.min(100, Math.round(n)));
}

/**
 * Extrai o valor de um campo de string JSON mesmo que contenha newlines literais.
 * Devolve { value: string, cleaned: string } onde cleaned é o rawText sem esse campo.
 * Se o campo não existir devolve { value: null, cleaned: rawText }.
 */
function extractStringField(rawText, fieldName) {
  // Encontra: "fieldName": "...conteúdo com newlines literais..."
  // O conteúdo termina na última " seguida de , } ou whitespace+}
  const pattern = new RegExp(
    `"${fieldName}"\\s*:\\s*"([\\s\\S]*?)"(?=\\s*[,}])`,
  );
  const match = rawText.match(pattern);
  if (!match) return { value: null, cleaned: rawText };

  const value = match[1]
    // escapes já presentes: manter
    // newlines literais → \n
    .replace(/\r\n/g, '\\n')
    .replace(/\r/g, '\\n')
    .replace(/\n/g, '\\n')
    // tabs literais → \t
    .replace(/\t/g, '\\t')
    // aspas não escapadas dentro da string → escapar
    .replace(/(?<!\\)"/g, '\\"');

  // Remove o campo do texto para o JSON.parse não tropeçar nele
  const cleaned = rawText.replace(match[0], `"${fieldName}":"__EXTRACTED__"`);
  return { value, cleaned };
}

/**
 * Tenta JSON.parse com múltiplas estratégias de recuperação.
 * Devolve o objecto parsed ou lança erro.
 */
function robustParse(text) {
  // 1. Limpa markdown code fences
  let s = text
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();

  // 2. Tentativa directa
  try { return JSON.parse(s); } catch (_) {}

  // 3. Extrai o bloco { ... } mais externo
  const match = s.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('Sem bloco JSON');
  s = match[0];

  // 4. Tentativa no bloco extraído
  try { return JSON.parse(s); } catch (_) {}

  // 5. Remove vírgulas pendentes e fecha objectos/arrays abertos
  s = s.replace(/,\s*([}\]])/g, '$1');
  let depth = 0;
  for (const c of s) {
    if (c === '{' || c === '[') depth++;
    if (c === '}' || c === ']') depth--;
  }
  if (depth > 0) s += '}'.repeat(depth);

  return JSON.parse(s); // lança se ainda falhar
}

// ─────────────────────────────────────────────────────────────────────────────
// HANDLER PRINCIPAL
// ─────────────────────────────────────────────────────────────────────────────

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ erro: 'Método não permitido' });

  // ── AUTENTICAÇÃO ──────────────────────────────────────────────────────────
  const authHeader = (req.headers.authorization || '').trim();
  if (!authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ erro: 'Autenticação necessária.' });
  }
  const token = authHeader.replace('Bearer ', '').trim();
  try {
    const authCheck = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { 'Authorization': `Bearer ${token}`, 'apikey': SUPABASE_ANON_KEY },
    });
    if (!authCheck.ok) return res.status(401).json({ erro: 'Sessão inválida ou expirada.' });
  } catch {
    return res.status(401).json({ erro: 'Erro de autenticação.' });
  }

  // ── CORPO ────────────────────────────────────────────────────────────────
  const body = req.body || {};
  const {
    texto, modo = 'judicial', tribunal, relator,
    instituicao, tipoDoc, orientador,
    tipoProcesso, parteRecorrente,
  } = body;

  if (!texto || typeof texto !== 'string' || texto.trim().length < 50) {
    return res.status(400).json({ erro: 'Texto insuficiente. Mínimo 50 caracteres.' });
  }

  const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
  if (!ANTHROPIC_API_KEY) return res.status(500).json({ erro: 'Serviço indisponível.' });

  const textoTruncado = texto.length > 12000
    ? texto.substring(0, 12000) + '\n[texto truncado]'
    : texto;

  let systemPrompt, userPrompt;

  // ══════════════════════════════════════════════════════════════════════════
  // PROMPTS
  // ══════════════════════════════════════════════════════════════════════════

  if (modo === 'critica') {
    const ctx = [
      tribunal        ? `Tribunal: ${tribunal}`                : null,
      tipoProcesso    ? `Tipo de processo: ${tipoProcesso}`    : null,
      parteRecorrente ? `Parte recorrente: ${parteRecorrente}` : null,
    ].filter(Boolean).join('\n');

    systemPrompt = `Actua como Consultor Jurídico Sénior com 25 anos de experiência em recursos nos tribunais portugueses — STJ, Tribunais da Relação, Tribunais Administrativos e Tribunal Constitucional.

A tua tarefa é fazer uma análise forense completa da decisão judicial para identificar TODOS os fundamentos que possam sustentar um recurso, organizados por prioridade e dificuldade de prova.

RESPONDE APENAS COM JSON PURO. Sem texto antes, sem texto depois, sem markdown, sem backticks.

REGRA CRÍTICA PARA O CAMPO "minuta":
O campo "minuta" é uma string JSON. NUNCA uses newlines literais (tecla Enter) dentro desta string.
Usa SEMPRE a sequência de escape \\n para representar quebras de linha dentro da minuta.
Exemplo correcto: "minuta": "Linha 1\\nLinha 2\\nLinha 3"
Exemplo ERRADO:   "minuta": "Linha 1
Linha 2"

Estrutura obrigatória do JSON:

{
  "veredicto_recurso": "RECURSO_VIAVEL",
  "confianca": 80,
  "admissivel": true,
  "tribunal_recurso": "Tribunal da Relação de Lisboa",
  "prazo_recurso": "30 dias a partir da notificação (art. 638.º CPC)",
  "sumario": "Resumo executivo da análise em 3-4 frases.",
  "fundamentos": [
    {
      "categoria": "nulidade",
      "tipo": "Nome do fundamento",
      "artigo": "Base legal principal",
      "gravidade": "grave",
      "prioridade": 1,
      "dificuldade": "facil",
      "descricao": "Descrição precisa do vício identificado na decisão, com referência ao texto concreto.",
      "argumento": "Texto pronto a usar na peça processual, com linguagem jurídica formal e fundamento legal completo."
    }
  ],
  "conclusao": "Recomendação estratégica final do consultor.",
  "minuta": "MINUTA DE RECURSO\\n\\n[NOME DO RECORRENTE], vem interpor RECURSO...\\n\\nI. PRIMEIRO FUNDAMENTO\\n\\n[Texto]\\n\\nCONCLUSÕES\\n\\n1.ª [Primeira conclusão]\\n\\nN.ª Termos em que deve o recurso ser admitido.\\n\\nO Mandatário,\\n[NOME E CÉDULA]"
}

VALORES VÁLIDOS — usa exactamente estas strings:
- veredicto_recurso: RECURSO_VIAVEL, RECURSO_PARCIAL, ou RECURSO_INVIAVEL
- categoria: nulidade, erro_direito, erro_facto, ou questao_constitucional
- gravidade: grave, moderada, ou leve
- dificuldade: facil, media, ou dificil
- admissivel: true ou false
- prioridade: número inteiro começando em 1 (1 = argumento mais forte)

CRITÉRIOS DE VEREDICTO:
- RECURSO_VIAVEL: um ou mais fundamentos graves com alto potencial de procedência
- RECURSO_PARCIAL: fundamentos existem mas com limitações ou difíceis de provar
- RECURSO_INVIAVEL: decisão correctamente fundamentada, sem vícios identificáveis

CATEGORIAS DE FUNDAMENTOS A ANALISAR SISTEMATICAMENTE:

1. NULIDADES PROCESSUAIS (categoria: nulidade)
Omissão de pronúncia — Art. 615.º/1/d) CPC, Art. 379.º/1/c) CPP
Contradição entre fundamentação e decisão — Art. 615.º/1/c) CPC
Falta ou insuficiência de fundamentação — Art. 615.º/1/b) CPC, Art. 205.º CRP
Falta de exame crítico das provas — Art. 607.º/4 CPC, Art. 374.º/2 CPP
Excesso de pronúncia — Art. 615.º/1/d) CPC
Violação do contraditório — Art. 3.º/3 CPC, Art. 32.º/5 CRP

2. ERROS DE DIREITO (categoria: erro_direito)
Errada interpretação de norma jurídica
Erro na determinação da norma aplicável
Violação de presunção legal
Erro na qualificação jurídica dos factos provados
Desrespeito por jurisprudência uniformizada do STJ (Art. 686.º CPC)

3. ERROS NA MATÉRIA DE FACTO (categoria: erro_facto)
Erro notório na apreciação da prova — Art. 410.º/2/c) CPP, Art. 662.º CPC
Insuficiência da matéria de facto — Art. 410.º/2/a) CPP
Contradição insanável na matéria de facto — Art. 410.º/2/b) CPP
Omissão de prova relevante

4. QUESTÕES CONSTITUCIONAIS (categoria: questao_constitucional)
Violação do direito de acesso à justiça — Art. 20.º CRP
Violação das garantias do processo criminal — Art. 32.º CRP
Violação do princípio da proporcionalidade — Art. 18.º/2 CRP

INSTRUÇÕES:
- O campo "argumento" deve conter texto pronto a inserir numa peça processual
- Ordena os fundamentos por "prioridade" do mais forte (1) para o mais fraco
- A "minuta" deve ter: fundamentos desenvolvidos, CONCLUSÕES numeradas, pedido final
- Usa [PLACEHOLDER] para dados desconhecidos
- LEMBRA: na minuta usa \\n (barra invertida + n), NUNCA Enter literal`;

    userPrompt = `${ctx ? `CONTEXTO DO PROCESSO:\n${ctx}\n\n` : ''}DECISÃO JUDICIAL A ANALISAR:\n\n${textoTruncado}\n\nFaz a análise completa. Responde em JSON puro. Lembra: na minuta usa \\n para quebras de linha, nunca Enter literal.`;

  } else if (modo === 'academico') {
    const ctx = [
      instituicao ? `Instituição: ${instituicao}` : null,
      tipoDoc     ? `Tipo: ${tipoDoc}`             : null,
      orientador  ? `Orientador: ${orientador}`    : null,
    ].filter(Boolean).join('\n');

    systemPrompt = `És um perito forense em análise linguística para detectar autoria de IA em textos académicos jurídicos portugueses.

RESPONDE APENAS COM JSON PURO. Sem texto antes, sem texto depois, sem markdown, sem backticks.

Estrutura obrigatória:

{
  "veredicto": "IA_DETECTADA",
  "confianca": 80,
  "indicadores": {
    "perplexidade": 75,
    "burstiness": 60,
    "coesao_artificial": 70,
    "uniformidade_sintatica": 65,
    "riqueza_lexical": 55,
    "marcadores_formulaicos": 80
  },
  "narrativa": "Análise detalhada aqui.",
  "relator_analise": "Análise do estilo do autor.",
  "marcadores": [
    { "tipo": "ai", "texto": "Descrição do marcador." }
  ]
}

VALORES VÁLIDOS para veredicto: IA_DETECTADA, PROVAVELMENTE_IA, INCONCLUSIVO, PROVAVELMENTE_HUMANO, ou HUMANO
VALORES VÁLIDOS para tipo de marcador: ai ou humano
Todos os indicadores: números entre 0 e 100 (0=humano, 100=IA)`;

    userPrompt = `${ctx ? `CONTEXTO:\n${ctx}\n\n` : ''}TEXTO ACADÉMICO:\n\n${textoTruncado}\n\nResponde em JSON puro.`;

  } else {
    // MODO JUDICIAL (default)
    const ctx = [
      tribunal ? `Tribunal: ${tribunal}` : null,
      relator  ? `Relator: ${relator}`   : null,
    ].filter(Boolean).join('\n');

    systemPrompt = `És um perito forense em análise linguística para detectar autoria de IA em decisões judiciais portuguesas.

RESPONDE APENAS COM JSON PURO. Sem texto antes, sem texto depois, sem markdown, sem backticks.

Estrutura obrigatória:

{
  "veredicto": "IA_DETECTADA",
  "confianca": 80,
  "indicadores": {
    "perplexidade": 75,
    "burstiness": 60,
    "coesao_artificial": 70,
    "uniformidade_sintatica": 65,
    "riqueza_lexical": 55,
    "marcadores_formulaicos": 80
  },
  "narrativa": "Análise detalhada aqui.",
  "relator_analise": "Análise do estilo do relator.",
  "marcadores": [
    { "tipo": "ai", "texto": "Descrição do marcador." }
  ]
}

VALORES VÁLIDOS para veredicto: IA_DETECTADA, PROVAVELMENTE_IA, INCONCLUSIVO, PROVAVELMENTE_HUMANO, ou HUMANO
VALORES VÁLIDOS para tipo de marcador: ai ou humano
Todos os indicadores: números entre 0 e 100 (0=humano, 100=IA)

NOTAS:
- Analisa principalmente o corpo de fundamentação, não as fórmulas jurídicas fixas
- O português jurídico PT tem características formais próprias
- Marcadores típicos de IA: "Neste contexto", "Importa salientar", "É de referir que", parágrafos de comprimento uniforme`;

    userPrompt = `${ctx ? `CONTEXTO:\n${ctx}\n\n` : ''}DECISÃO JUDICIAL:\n\n${textoTruncado}\n\nResponde em JSON puro.`;
  }

  // ── CHAMADA ANTHROPIC ────────────────────────────────────────────────────
  try {
    const anthropicResponse = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: modo === 'critica' ? 6000 : 2000,
        system: systemPrompt,
        messages: [{ role: 'user', content: userPrompt }],
      }),
    });

    if (!anthropicResponse.ok) {
      const errText = await anthropicResponse.text().catch(() => '');
      console.error('Anthropic error:', anthropicResponse.status, errText.substring(0, 200));
      return res.status(502).json({ erro: 'Erro na API de análise. Tente novamente.' });
    }

    const anthropicData = await anthropicResponse.json();
    const rawText = (anthropicData.content?.[0]?.text || '').trim();

    if (!rawText) {
      return res.status(500).json({ erro: 'Resposta vazia. Tente novamente.' });
    }

    // ── FIX: EXTRAI CAMPOS COM NEWLINES LITERAIS ANTES DO PARSE ──────────
    // O modelo pode gerar newlines reais dentro de strings JSON (viola RFC 8259).
    // Extraímos os campos problemáticos antes de fazer JSON.parse.

    let minutaExtraida = null;
    let textToparse = rawText;

    if (modo === 'critica') {
      const extracted = extractStringField(textToparse, 'minuta');
      if (extracted.value !== null) {
        minutaExtraida = extracted.value;
        textToparse = extracted.cleaned;
      }
    }

    // ── PARSE JSON ────────────────────────────────────────────────────────
    let parsed;
    try {
      parsed = robustParse(textToparse);
    } catch (parseErr) {
      console.error('Parse failed. Raw[0-600]:', rawText.substring(0, 600));

      if (modo === 'critica') {
        parsed = {
          veredicto_recurso: 'RECURSO_INVIAVEL',
          confianca: 50,
          admissivel: true,
          tribunal_recurso: 'Não determinado',
          prazo_recurso: 'Consulte um advogado',
          sumario: 'Análise incompleta. Por favor tente novamente.',
          fundamentos: [],
          conclusao: 'Não foi possível concluir a análise.',
          minuta: '',
        };
      } else {
        return res.status(500).json({ erro: 'Erro ao processar resposta. Tente novamente.' });
      }
    }

    // Reintroduz a minuta limpa (se foi extraída separadamente)
    if (minutaExtraida !== null) {
      // Converte as sequências de escape textuais em caracteres reais para output
      parsed.minuta = minutaExtraida
        .replace(/\\n/g, '\n')
        .replace(/\\t/g, '\t');
    }

    // ── NORMALIZAÇÃO ─────────────────────────────────────────────────────
    if (modo === 'critica') {
      const okV = ['RECURSO_VIAVEL', 'RECURSO_PARCIAL', 'RECURSO_INVIAVEL'];
      if (!okV.includes(parsed.veredicto_recurso)) parsed.veredicto_recurso = 'RECURSO_INVIAVEL';
      parsed.confianca        = clamp(parsed.confianca);
      parsed.admissivel       = parsed.admissivel !== false;
      parsed.tribunal_recurso = String(parsed.tribunal_recurso || 'Não determinado');
      parsed.prazo_recurso    = String(parsed.prazo_recurso    || 'Consulte um advogado');
      parsed.sumario          = String(parsed.sumario          || 'Análise concluída.');
      parsed.conclusao        = String(parsed.conclusao        || 'Consulte um advogado.');
      // minuta já tratada acima; só garante string
      if (typeof parsed.minuta !== 'string') parsed.minuta = '';

      const okCat  = ['nulidade', 'erro_direito', 'erro_facto', 'questao_constitucional'];
      const okGrav = ['grave', 'moderada', 'leve'];
      const okDif  = ['facil', 'media', 'dificil'];

      const items = Array.isArray(parsed.fundamentos)
        ? parsed.fundamentos
        : Array.isArray(parsed.nulidades)
          ? parsed.nulidades.map((n, i) => ({
              ...n, categoria: 'nulidade', prioridade: i + 1, dificuldade: 'media',
            }))
          : [];

      parsed.fundamentos = items.map((f, i) => ({
        categoria:   okCat.includes(f.categoria)                          ? f.categoria                 : 'nulidade',
        tipo:        String(f.tipo       || 'Vício Processual'),
        artigo:      String(f.artigo     || ''),
        gravidade:   okGrav.includes((f.gravidade  || '').toLowerCase())  ? f.gravidade.toLowerCase()   : 'moderada',
        prioridade:  Number(f.prioridade) || (i + 1),
        dificuldade: okDif.includes((f.dificuldade || '').toLowerCase())  ? f.dificuldade.toLowerCase() : 'media',
        descricao:   String(f.descricao  || ''),
        argumento:   String(f.argumento  || ''),
      }));

      parsed.fundamentos.sort((a, b) => a.prioridade - b.prioridade);
      delete parsed.nulidades;

    } else {
      const okV = ['IA_DETECTADA', 'PROVAVELMENTE_IA', 'INCONCLUSIVO', 'PROVAVELMENTE_HUMANO', 'HUMANO'];
      if (!okV.includes(parsed.veredicto)) parsed.veredicto = 'INCONCLUSIVO';
      parsed.confianca = clamp(parsed.confianca);
      if (!parsed.indicadores || typeof parsed.indicadores !== 'object') parsed.indicadores = {};
      ['perplexidade', 'burstiness', 'coesao_artificial', 'uniformidade_sintatica', 'riqueza_lexical', 'marcadores_formulaicos']
        .forEach(k => { parsed.indicadores[k] = clamp(parsed.indicadores[k]); });
      parsed.narrativa       = String(parsed.narrativa       || 'Análise concluída.');
      parsed.relator_analise = String(parsed.relator_analise || 'Não indicado.');
      parsed.marcadores = Array.isArray(parsed.marcadores)
        ? parsed.marcadores.slice(0, 8).map(m => ({
            tipo:  m.tipo === 'ai' ? 'ai' : 'humano',
            texto: String(m.texto || ''),
          }))
        : [];
    }

    return res.status(200).json(parsed);

  } catch (err) {
    console.error('Unhandled:', err.message);
    return res.status(500).json({ erro: 'Erro interno. Tente novamente.' });
  }
};
