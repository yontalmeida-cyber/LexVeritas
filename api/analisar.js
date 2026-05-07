// /api/analisar.js — LexVeritas API Endpoint
// Vercel Serverless Function — Node.js 18+ — CommonJS

const SUPABASE_URL      = 'https://bsbgizaftamufmmxeyer.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJzYmdpemFmdGFtdWZtbXhleWVyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc3NDkzNTIsImV4cCI6MjA5MzMyNTM1Mn0._xBiw0VUa3FSnortYseUQPDc5xb--k15lYcylNmMEEQ';

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ erro: 'Método não permitido' });

  // ── AUTENTICAÇÃO ──
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

  // ── CORPO ──
  const body = req.body || {};
  const { texto, modo = 'judicial', tribunal, relator, instituicao, tipoDoc, orientador, tipoProcesso, parteRecorrente } = body;

  if (modo !== 'minuta' && (!texto || typeof texto !== 'string' || texto.trim().length < 50)) {
    return res.status(400).json({ erro: 'Texto insuficiente. Mínimo 50 caracteres.' });
  }

  const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
  if (!ANTHROPIC_API_KEY) return res.status(500).json({ erro: 'Serviço indisponível.' });

  const textoTruncado = (modo === 'critica' && texto.length > 8000) ? texto.substring(0, 8000) : texto.length > 12000 ? texto.substring(0, 12000) + '\n[texto truncado]' : texto;

  let systemPrompt, userPrompt;

  // ══════════════════════════════════════════════════
  // MODO CRÍTICA — Análise Jurídica Avançada
  // ══════════════════════════════════════════════════
  if (modo === 'critica') {
    const ctx = [
      tribunal        ? `Tribunal: ${tribunal}`               : null,
      tipoProcesso    ? `Tipo de processo: ${tipoProcesso}`   : null,
      parteRecorrente ? `Parte recorrente: ${parteRecorrente}` : null,
    ].filter(Boolean).join('\n');

    systemPrompt = `Actua como Consultor Jurídico Sénior especialista em recursos portugueses. Responde APENAS com JSON puro, sem backticks, sem texto antes ou depois.

{
  "veredicto_recurso": "RECURSO_VIAVEL",
  "confianca": 80,
  "admissivel": true,
  "tribunal_recurso": "Tribunal da Relação de Lisboa",
  "prazo_recurso": "30 dias (art. 638.º CPC)",
  "sumario": "Resumo em 2 frases.",
  "fundamentos": [
    {
      "categoria": "nulidade",
      "tipo": "Nome do vício",
      "artigo": "Art. 615.º/1/d) CPC",
      "gravidade": "grave",
      "prioridade": 1,
      "dificuldade": "facil",
      "descricao": "Descrição objectiva do vício.",
      "argumento": "Argumento jurídico para a peça processual."
    }
  ],
  "conclusao": "Recomendação estratégica em 2 frases."
}

Valores: veredicto_recurso deve ser RECURSO_VIAVEL, RECURSO_PARCIAL ou RECURSO_INVIAVEL. categoria deve ser nulidade, erro_direito, erro_facto ou questao_constitucional. gravidade deve ser grave, moderada ou leve. dificuldade deve ser facil, media ou dificil. Máximo 4 fundamentos por ordem de prioridade.

Pesquisa: omissão pronúncia (615.º/1/d CPC, 379.º/1/c CPP), contradição (615.º/1/c), falta fundamentação (615.º/1/b, 205.º CRP), falta exame crítico provas (607.º/4 CPC, 374.º/2 CPP), excesso pronúncia, errada interpretação legal, erro notório (410.º/2/c CPP), insuficiência matéria facto (410.º/2/a), violação Art. 20.º/32.º CRP.`

    userPrompt = `${ctx ? `CONTEXTO DO PROCESSO:\n${ctx}\n\n` : ''}DECISÃO JUDICIAL A ANALISAR:\n\n${textoTruncado}\n\nResponde em JSON puro.`;

  // ══════════════════════════════════════════════════
  // MODO ACADÉMICO
  // ══════════════════════════════════════════════════
  // ══════════════════════════════════════════════════
  // MODO MINUTA — Gera proposta de texto separadamente
  // ══════════════════════════════════════════════════
  } else if (modo === 'minuta') {
    const { fundamentos = [], veredicto_recurso, tribunal_recurso, tipoProcesso, parteRecorrente } = body;
    if (!fundamentos.length) {
      return res.status(400).json({ erro: 'Fundamentos em falta para gerar minuta.' });
    }
    const ctx = [
      tribunal_recurso ? `Tribunal de recurso: ${tribunal_recurso}` : null,
      tipoProcesso     ? `Tipo de processo: ${tipoProcesso}`        : null,
      parteRecorrente  ? `Parte recorrente: ${parteRecorrente}`      : null,
    ].filter(Boolean).join('\n');

    const fundamentosTexto = fundamentos.map((f, i) =>
      `${i+1}. ${f.tipo} (${f.artigo||''}) — ${f.descricao}\nArgumento: ${f.argumento}`
    ).join('\n\n');

    systemPrompt = `Actua como Consultor Jurídico Sénior. Redige uma proposta de texto para recurso em português jurídico formal, baseada nos fundamentos fornecidos.

Estrutura obrigatória:
1. Parágrafo de introdução com [NOME DO RECORRENTE], [NÚMERO DO PROCESSO], [TRIBUNAL A QUO], [DATA DA DECISÃO]
2. Secção FUNDAMENTOS com cada argumento desenvolvido (um parágrafo por fundamento)
3. CONCLUSÕES numeradas (1.ª, 2.ª, ..., N.ª) — uma por fundamento, linguagem precisa
4. Pedido final: "Termos em que deve o presente recurso ser julgado procedente..."

Usa [PLACEHOLDER] para dados desconhecidos. Texto directo, sem comentários, sem explicações.`;

    userPrompt = `${ctx ? ctx + '\n\n' : ''}FUNDAMENTOS IDENTIFICADOS:\n\n${fundamentosTexto}\n\nRedige a proposta de texto para recurso.`;

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

  // ══════════════════════════════════════════════════
  // MODO JUDICIAL
  // ══════════════════════════════════════════════════
  } else {
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

  // ── CHAMADA ANTHROPIC ──
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
        max_tokens: 2000,
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
    const fullText = (anthropicData.content?.[0]?.text || '').trim();

    if (!fullText) {
      return res.status(500).json({ erro: 'Resposta vazia. Tente novamente.' });
    }

    const rawText = fullText;
    const minutaRaw = '';

    // ── PARSE JSON ──
    let parsed;
    try {
      const cleaned = rawText
        .replace(/^```json\s*/i, '')
        .replace(/^```\s*/i, '')
        .replace(/\s*```$/i, '')
        .trim();
      parsed = JSON.parse(cleaned);
    } catch {
      const match = rawText.match(/\{[\s\S]*\}/);
      if (match) {
        try {
          parsed = JSON.parse(match[0]);
        } catch {
          let jsonStr = match[0];
          jsonStr = jsonStr.replace(/,\s*$/, '').replace(/,\s*\}$/, '}').replace(/,\s*\]$/, ']');
          let depth = 0;
          for (const c of jsonStr) { if (c === '{' || c === '[') depth++; if (c === '}' || c === ']') depth--; }
          if (depth > 0) for (let i = 0; i < depth; i++) jsonStr += '}';
          try {
            parsed = JSON.parse(jsonStr);
          } catch {
            console.error('Parse failed. Raw[0-500]:', rawText.substring(0, 500));
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
        }
      } else {
        console.error('No JSON found. Raw[0-500]:', rawText.substring(0, 500));
        return res.status(500).json({ erro: 'Resposta inválida. Tente novamente.' });
      }
    }

    // ── NORMALIZAÇÃO ──
    // Modo minuta: retorna texto simples
    if (modo === 'minuta') {
      const minutaText = (anthropicData.content?.[0]?.text || '').trim();
      return res.status(200).json({ minuta: minutaText });
    }

    if (modo === 'critica') {
      const okV = ['RECURSO_VIAVEL', 'RECURSO_PARCIAL', 'RECURSO_INVIAVEL'];
      if (!okV.includes(parsed.veredicto_recurso)) parsed.veredicto_recurso = 'RECURSO_INVIAVEL';
      parsed.confianca       = clamp(parsed.confianca);
      parsed.admissivel      = parsed.admissivel !== false;
      parsed.tribunal_recurso = String(parsed.tribunal_recurso || 'Não determinado');
      parsed.prazo_recurso    = String(parsed.prazo_recurso    || 'Consulte um advogado');
      parsed.sumario          = String(parsed.sumario          || 'Análise concluída.');
      parsed.conclusao        = String(parsed.conclusao        || 'Consulte um advogado.');
      parsed.minuta           = minutaRaw || String(parsed.minuta || '');

      const okCat  = ['nulidade','erro_direito','erro_facto','questao_constitucional'];
      const okGrav = ['grave','moderada','leve'];
      const okDif  = ['facil','media','dificil'];

      // Suporte para resposta com "nulidades" (formato antigo) ou "fundamentos" (formato novo)
      const items = Array.isArray(parsed.fundamentos)
        ? parsed.fundamentos
        : Array.isArray(parsed.nulidades)
          ? parsed.nulidades.map((n, i) => ({ ...n, categoria: 'nulidade', prioridade: i + 1, dificuldade: 'media' }))
          : [];

      parsed.fundamentos = items.map((f, i) => ({
        categoria:  okCat.includes(f.categoria)  ? f.categoria  : 'nulidade',
        tipo:       String(f.tipo       || 'Vício Processual'),
        artigo:     String(f.artigo     || ''),
        gravidade:  okGrav.includes((f.gravidade||'').toLowerCase()) ? f.gravidade.toLowerCase() : 'moderada',
        prioridade: Number(f.prioridade) || (i + 1),
        dificuldade:okDif.includes((f.dificuldade||'').toLowerCase()) ? f.dificuldade.toLowerCase() : 'media',
        descricao:  String(f.descricao  || ''),
        argumento:  String(f.argumento  || ''),
      }));

      // Ordenar por prioridade
      parsed.fundamentos.sort((a, b) => a.prioridade - b.prioridade);

      // Remover campo antigo se existir
      delete parsed.nulidades;

    } else {
      const okV = ['IA_DETECTADA','PROVAVELMENTE_IA','INCONCLUSIVO','PROVAVELMENTE_HUMANO','HUMANO'];
      if (!okV.includes(parsed.veredicto)) parsed.veredicto = 'INCONCLUSIVO';
      parsed.confianca = clamp(parsed.confianca);
      if (!parsed.indicadores || typeof parsed.indicadores !== 'object') parsed.indicadores = {};
      ['perplexidade','burstiness','coesao_artificial','uniformidade_sintatica','riqueza_lexical','marcadores_formulaicos']
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

function clamp(val) {
  const n = Number(val);
  return isNaN(n) ? 50 : Math.max(0, Math.min(100, Math.round(n)));
}
