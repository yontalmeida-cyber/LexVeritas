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

  if (!texto || typeof texto !== 'string' || texto.trim().length < 50) {
    return res.status(400).json({ erro: 'Texto insuficiente. Mínimo 50 caracteres.' });
  }

  const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
  if (!ANTHROPIC_API_KEY) return res.status(500).json({ erro: 'Serviço indisponível.' });

  const textoTruncado = texto.length > 12000 ? texto.substring(0, 12000) + '\n[texto truncado]' : texto;

  let systemPrompt, userPrompt;

  // ══════════════════════════════════════════════════
  // MODO CRÍTICA
  // ══════════════════════════════════════════════════
  if (modo === 'critica') {
    const ctx = [
      tribunal        ? `Tribunal: ${tribunal}`               : null,
      tipoProcesso    ? `Tipo de processo: ${tipoProcesso}`   : null,
      parteRecorrente ? `Parte recorrente: ${parteRecorrente}` : null,
    ].filter(Boolean).join('\n');

    systemPrompt = `Actua como Consultor Jurídico Sénior especialista em Processo Civil e Processo Penal português.

Analisa a decisão judicial e identifica nulidades, erros de julgamento e vícios processuais que fundamentem recurso.

RESPONDE APENAS COM JSON PURO. Sem texto antes, sem texto depois, sem markdown, sem backticks.

O JSON deve ter exactamente esta estrutura (substitui os valores pelos reais):

{
  "veredicto_recurso": "RECURSO_VIAVEL",
  "confianca": 75,
  "sumario": "Texto do sumário aqui.",
  "nulidades": [
    {
      "tipo": "Nome do vício",
      "artigo": "Art. 615.º n.º 1 al. d) CPC",
      "gravidade": "grave",
      "descricao": "Descrição do vício encontrado.",
      "argumento": "Argumento jurídico para o recurso."
    }
  ],
  "conclusao": "Recomendação final."
}

VALORES VÁLIDOS:
- veredicto_recurso: use exactamente uma destas strings: RECURSO_VIAVEL, RECURSO_PARCIAL, ou RECURSO_INVIAVEL
- confianca: número entre 0 e 100
- gravidade de cada nulidade: use exactamente uma destas strings: grave, moderada, ou leve

CRITÉRIOS:
- RECURSO_VIAVEL: nulidades graves com fundamento jurídico sólido
- RECURSO_PARCIAL: alguns argumentos mas com limitações
- RECURSO_INVIAVEL: decisão devidamente fundamentada

NULIDADES A PESQUISAR:
- Omissão de pronúncia: Art. 615.º n.º 1 al. d) CPC / Art. 379.º n.º 1 al. c) CPP
- Contradição entre fundamentação e decisão: Art. 615.º n.º 1 al. c) CPC
- Falta de fundamentação: Art. 615.º n.º 1 al. b) CPC / Art. 205.º CRP
- Falta de exame crítico das provas: Art. 607.º n.º 4 CPC / Art. 374.º n.º 2 CPP
- Excesso de pronúncia: Art. 615.º n.º 1 al. d) CPC
- Erro notório na apreciação da prova: Art. 410.º n.º 2 al. c) CPP
- Insuficiência para a decisão da matéria de facto: Art. 410.º n.º 2 al. a) CPP`;

    userPrompt = `${ctx ? `CONTEXTO:\n${ctx}\n\n` : ''}DECISÃO JUDICIAL:\n\n${textoTruncado}\n\nResponde em JSON puro.`;

  // ══════════════════════════════════════════════════
  // MODO ACADÉMICO
  // ══════════════════════════════════════════════════
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
- Analisa o corpo de fundamentação, não as fórmulas jurídicas fixas
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
        max_tokens: modo === 'critica' ? 4000 : 2000,
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

    // ── PARSE JSON ──
    let parsed;
    try {
      // Limpar possíveis markdown fences
      const cleaned = rawText
        .replace(/^```json\s*/i, '')
        .replace(/^```\s*/i, '')
        .replace(/\s*```$/i, '')
        .trim();
      parsed = JSON.parse(cleaned);
    } catch (e1) {
      // Tentar extrair JSON por regex
      const match = rawText.match(/\{[\s\S]*\}/);
      if (match) {
        try {
          parsed = JSON.parse(match[0]);
        } catch (e2) {
          // Tentar reparar JSON truncado
          let jsonStr = match[0];
          jsonStr = jsonStr.replace(/,\s*$/, '').replace(/,\s*\}$/, '}').replace(/,\s*\]$/, ']');
          let depth = 0;
          for (const c of jsonStr) { if (c === '{' || c === '[') depth++; if (c === '}' || c === ']') depth--; }
          if (depth > 0) for (let i = 0; i < depth; i++) jsonStr += '}';
          try {
            parsed = JSON.parse(jsonStr);
          } catch (e3) {
            console.error('Parse failed. Raw[0-500]:', rawText.substring(0, 500));
            // Fallback para modo crítica
            if (modo === 'critica') {
              parsed = {
                veredicto_recurso: 'RECURSO_INVIAVEL',
                confianca: 50,
                sumario: 'Não foi possível concluir a análise. Por favor tente novamente com um texto mais curto.',
                nulidades: [],
                conclusao: 'Análise incompleta. Tente novamente.',
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
    if (modo === 'critica') {
      const okV = ['RECURSO_VIAVEL', 'RECURSO_PARCIAL', 'RECURSO_INVIAVEL'];
      if (!okV.includes(parsed.veredicto_recurso)) parsed.veredicto_recurso = 'RECURSO_INVIAVEL';
      parsed.confianca = clamp(parsed.confianca);
      parsed.sumario   = String(parsed.sumario   || 'Análise concluída.');
      parsed.conclusao = String(parsed.conclusao || 'Consulte um advogado.');
      parsed.nulidades = Array.isArray(parsed.nulidades) ? parsed.nulidades.map(n => ({
        tipo:      String(n.tipo      || 'Vício Processual'),
        artigo:    String(n.artigo    || ''),
        gravidade: ['grave','moderada','leve'].includes((n.gravidade||'').toLowerCase())
                     ? n.gravidade.toLowerCase() : 'moderada',
        descricao: String(n.descricao || ''),
        argumento: String(n.argumento || ''),
      })) : [];
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
