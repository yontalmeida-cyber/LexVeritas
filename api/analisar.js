// /api/analisar.js — LexVeritas API Endpoint
// Vercel Serverless Function — Node.js 18+ — CommonJS
// Handles 3 analysis modes: judicial, academico, critica
// Validates Supabase session token on every request

const SUPABASE_URL     = 'https://bsbgizaftamufmmxeyer.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJzYmdpemFmdGFtdWZtbXhleWVyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc3NDkzNTIsImV4cCI6MjA5MzMyNTM1Mn0._xBiw0VUa3FSnortYseUQPDc5xb--k15lYcylNmMEEQ';

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ erro: 'Método não permitido' });

  // ═══════════════════════════════════════════════
  // VALIDAÇÃO DE AUTENTICAÇÃO — Supabase JWT
  // ═══════════════════════════════════════════════
  const authHeader = (req.headers.authorization || '').trim();
  if (!authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ erro: 'Autenticação necessária.' });
  }
  const token = authHeader.replace('Bearer ', '').trim();

  let autenticado = false;
  try {
    const authCheck = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'apikey': SUPABASE_ANON_KEY,
      },
    });
    autenticado = authCheck.ok;
  } catch {
    autenticado = false;
  }

  if (!autenticado) {
    return res.status(401).json({ erro: 'Sessão inválida ou expirada. Por favor faça login novamente.' });
  }

  // ═══════════════════════════════════════════════
  // CORPO DO PEDIDO
  // ═══════════════════════════════════════════════
  const body = req.body || {};
  const {
    texto,
    modo = 'judicial',
    tribunal, relator,
    instituicao, tipoDoc, orientador,
    tipoProcesso, parteRecorrente,
  } = body;

  if (!texto || typeof texto !== 'string' || texto.trim().length < 50) {
    return res.status(400).json({ erro: 'Texto insuficiente para análise. Mínimo 50 caracteres.' });
  }

  const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
  if (!ANTHROPIC_API_KEY) {
    console.error('ANTHROPIC_API_KEY not set');
    return res.status(500).json({ erro: 'Serviço temporariamente indisponível.' });
  }

  const textoTruncado =
    texto.length > 12000
      ? texto.substring(0, 12000) + '\n[...texto truncado para análise...]'
      : texto;

  try {
    let systemPrompt, userPrompt;

    // ═══════════════════════════════════════════════
    // MODO CRÍTICA — Consultor Jurídico Sénior
    // ═══════════════════════════════════════════════
    if (modo === 'critica') {
      const ctx = [
        tribunal        ? `Tribunal: ${tribunal}`               : null,
        tipoProcesso    ? `Tipo de processo: ${tipoProcesso}`   : null,
        parteRecorrente ? `Parte recorrente: ${parteRecorrente}` : null,
      ].filter(Boolean).join('\n');

      systemPrompt = `Actua como um Consultor Jurídico Sénior especialista em Processo Civil e Processo Penal português com 20 anos de experiência em recursos nos tribunais portugueses.

A tua tarefa é analisar a decisão judicial e identificar todos os vícios, nulidades e erros que possam fundamentar um recurso.

INSTRUÇÕES: Responde EXCLUSIVAMENTE em JSON válido, sem markdown, sem backticks, sem texto antes ou depois. Usa apenas aspas retas ".

Estrutura obrigatória:
{
  "veredicto_recurso": "RECURSO_VIAVEL" | "RECURSO_PARCIAL" | "RECURSO_INVIAVEL",
  "confianca": <número 0-100>,
  "sumario": "<resumo executivo em 2-3 frases>",
  "nulidades": [
    {
      "tipo": "<nome do vício ex: Omissão de Pronúncia>",
      "artigo": "<artigo legal ex: Art. 615.º n.º 1 al. d) CPC>",
      "gravidade": "grave" | "moderada" | "leve",
      "descricao": "<descrição objectiva do vício identificado>",
      "argumento": "<argumento técnico-jurídico para usar no recurso>"
    }
  ],
  "conclusao": "<recomendação final em 2-4 frases>"
}

CRITÉRIOS:
- RECURSO_VIAVEL: nulidades graves com fundamento sólido, alta probabilidade de procedência
- RECURSO_PARCIAL: argumentos limitados, recurso possível mas incerto
- RECURSO_INVIAVEL: decisão devidamente fundamentada, recurso improvável

NULIDADES A PESQUISAR:
- Omissão de pronúncia — Art. 615.º n.º 1 al. d) CPC / Art. 379.º n.º 1 al. c) CPP
- Contradição entre fundamentação e decisão — Art. 615.º n.º 1 al. c) CPC
- Falta de fundamentação — Art. 615.º n.º 1 al. b) CPC / Art. 205.º CRP
- Falta de exame crítico das provas — Art. 607.º n.º 4 CPC / Art. 374.º n.º 2 CPP
- Excesso de pronúncia — Art. 615.º n.º 1 al. d) CPC
- Erro notório na apreciação da prova — Art. 410.º n.º 2 al. c) CPP
- Presunções ilícitas ou inversão do ónus da prova
- Insuficiência para a decisão da matéria de facto — Art. 410.º n.º 2 al. a) CPP`;

      userPrompt = `${ctx ? `CONTEXTO DO PROCESSO:\n${ctx}\n\n` : ''}DECISÃO JUDICIAL A ANALISAR:\n\n${textoTruncado}\n\nAnalisa e identifica todas as nulidades e vícios processuais. Responde em JSON puro.`;

    // ═══════════════════════════════════════════════
    // MODO ACADÉMICO
    // ═══════════════════════════════════════════════
    } else if (modo === 'academico') {
      const ctx = [
        instituicao ? `Instituição: ${instituicao}` : null,
        tipoDoc     ? `Tipo de documento: ${tipoDoc}` : null,
        orientador  ? `Orientador: ${orientador}`     : null,
      ].filter(Boolean).join('\n');

      systemPrompt = `És um perito forense em análise linguística especializado em detectar autoria de Inteligência Artificial em textos académicos jurídicos em português de Portugal.

INSTRUÇÕES: Responde EXCLUSIVAMENTE em JSON válido, sem markdown, sem backticks, sem texto antes ou depois. Usa apenas aspas retas ".

Estrutura obrigatória:
{
  "veredicto": "IA_DETECTADA" | "PROVAVELMENTE_IA" | "INCONCLUSIVO" | "PROVAVELMENTE_HUMANO" | "HUMANO",
  "confianca": <número 0-100>,
  "indicadores": {
    "perplexidade": <0-100>,
    "burstiness": <0-100>,
    "coesao_artificial": <0-100>,
    "uniformidade_sintatica": <0-100>,
    "riqueza_lexical": <0-100>,
    "marcadores_formulaicos": <0-100>
  },
  "narrativa": "<análise em 2-3 parágrafos>",
  "relator_analise": "<análise do estilo do autor>",
  "marcadores": [
    { "tipo": "ai" | "humano", "texto": "<marcador observado>" }
  ]
}

INDICADORES (0=humano, 100=IA):
- perplexidade: imprevisibilidade textual
- burstiness: variação no comprimento das frases
- coesao_artificial: excesso de conectores lógicos
- uniformidade_sintatica: repetição de estruturas frásicas
- riqueza_lexical: variedade de vocabulário
- marcadores_formulaicos: frases-clichê típicas de IA

VEREDICTOS: IA_DETECTADA (≥75%), PROVAVELMENTE_IA (55-74%), INCONCLUSIVO (40-54%), PROVAVELMENTE_HUMANO (25-39%), HUMANO (<25%)`;

      userPrompt = `${ctx ? `CONTEXTO:\n${ctx}\n\n` : ''}TEXTO ACADÉMICO A ANALISAR:\n\n${textoTruncado}\n\nAnalisa este documento. Responde em JSON puro.`;

    // ═══════════════════════════════════════════════
    // MODO JUDICIAL (default)
    // ═══════════════════════════════════════════════
    } else {
      const ctx = [
        tribunal ? `Tribunal: ${tribunal}` : null,
        relator  ? `Relator: ${relator}`   : null,
      ].filter(Boolean).join('\n');

      systemPrompt = `És um perito forense em análise linguística especializado em detectar autoria de Inteligência Artificial em decisões judiciais portuguesas — acórdãos, sentenças e despachos.

INSTRUÇÕES: Responde EXCLUSIVAMENTE em JSON válido, sem markdown, sem backticks, sem texto antes ou depois. Usa apenas aspas retas ".

Estrutura obrigatória:
{
  "veredicto": "IA_DETECTADA" | "PROVAVELMENTE_IA" | "INCONCLUSIVO" | "PROVAVELMENTE_HUMANO" | "HUMANO",
  "confianca": <número 0-100>,
  "indicadores": {
    "perplexidade": <0-100>,
    "burstiness": <0-100>,
    "coesao_artificial": <0-100>,
    "uniformidade_sintatica": <0-100>,
    "riqueza_lexical": <0-100>,
    "marcadores_formulaicos": <0-100>
  },
  "narrativa": "<análise em 2-3 parágrafos concisos>",
  "relator_analise": "<análise do estilo do relator — se não indicado, descreve o estilo geral>",
  "marcadores": [
    { "tipo": "ai" | "humano", "texto": "<marcador observado no texto>" }
  ]
}

INDICADORES (0=humano, 100=IA):
- perplexidade: imprevisibilidade/genuinidade do texto
- burstiness: variação rítmica no comprimento das frases
- coesao_artificial: fluidez excessivamente homogénea
- uniformidade_sintatica: repetição de estruturas frásicas
- riqueza_lexical: especificidade e variedade do vocabulário jurídico
- marcadores_formulaicos: frases-clichê de IA em contexto jurídico PT

VEREDICTOS: IA_DETECTADA (≥75%), PROVAVELMENTE_IA (55-74%), INCONCLUSIVO (40-54%), PROVAVELMENTE_HUMANO (25-39%), HUMANO (<25%)

NOTAS CRÍTICAS:
- Fórmulas jurídicas fixas (ementas, dispositivos) NÃO são indicadores de IA
- Analisa principalmente o corpo de fundamentação
- O português jurídico PT tem características formais próprias
- Marcadores típicos de IA: "Neste contexto", "Importa salientar", parágrafos de comprimento uniforme`;

      userPrompt = `${ctx ? `CONTEXTO DA DECISÃO:\n${ctx}\n\n` : ''}TEXTO DA DECISÃO JUDICIAL:\n\n${textoTruncado}\n\nAnalisa esta decisão. Responde em JSON puro.`;
    }

    // ═══════════════════════════════════════════════
    // CHAMADA À API ANTHROPIC
    // ═══════════════════════════════════════════════
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
      console.error('Anthropic API error:', anthropicResponse.status, errText.substring(0, 300));
      return res.status(502).json({ erro: 'Erro na API de análise. Tente novamente.' });
    }

    const anthropicData = await anthropicResponse.json();
    const rawText = (anthropicData.content?.[0]?.text || '').trim();

    if (!rawText) {
      return res.status(500).json({ erro: 'Resposta vazia do modelo. Tente novamente.' });
    }

    // ═══════════════════════════════════════════════
    // PARSE DO JSON
    // ═══════════════════════════════════════════════
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
        try { parsed = JSON.parse(match[0]); }
        catch {
          console.error('JSON parse failed. Raw:', rawText.substring(0, 300));
          return res.status(500).json({ erro: 'Erro ao processar resposta. Tente novamente.' });
        }
      } else {
        console.error('No JSON in response. Raw:', rawText.substring(0, 300));
        return res.status(500).json({ erro: 'Resposta inválida. Tente novamente.' });
      }
    }

    // ═══════════════════════════════════════════════
    // VALIDAÇÃO E NORMALIZAÇÃO
    // ═══════════════════════════════════════════════
    if (modo === 'critica') {
      const ok = ['RECURSO_VIAVEL', 'RECURSO_PARCIAL', 'RECURSO_INVIAVEL'];
      if (!ok.includes(parsed.veredicto_recurso)) parsed.veredicto_recurso = 'RECURSO_INVIAVEL';
      parsed.confianca = clamp(parsed.confianca);
      parsed.sumario   = String(parsed.sumario   || 'Análise concluída.');
      parsed.conclusao = String(parsed.conclusao || 'Consulte um advogado para validar estes resultados.');
      parsed.nulidades = Array.isArray(parsed.nulidades)
        ? parsed.nulidades.map(n => ({
            tipo:      String(n.tipo      || 'Vício Processual'),
            artigo:    String(n.artigo    || ''),
            gravidade: ['grave','moderada','leve'].includes(n.gravidade) ? n.gravidade : 'moderada',
            descricao: String(n.descricao || ''),
            argumento: String(n.argumento || ''),
          }))
        : [];
    } else {
      const ok = ['IA_DETECTADA','PROVAVELMENTE_IA','INCONCLUSIVO','PROVAVELMENTE_HUMANO','HUMANO'];
      if (!ok.includes(parsed.veredicto)) parsed.veredicto = 'INCONCLUSIVO';
      parsed.confianca = clamp(parsed.confianca);
      if (!parsed.indicadores || typeof parsed.indicadores !== 'object') parsed.indicadores = {};
      ['perplexidade','burstiness','coesao_artificial','uniformidade_sintatica','riqueza_lexical','marcadores_formulaicos']
        .forEach(k => { parsed.indicadores[k] = clamp(parsed.indicadores[k]); });
      parsed.narrativa       = String(parsed.narrativa       || 'Análise concluída.');
      parsed.relator_analise = String(parsed.relator_analise || 'Relator não indicado.');
      parsed.marcadores      = Array.isArray(parsed.marcadores)
        ? parsed.marcadores.slice(0, 8).map(m => ({
            tipo:  m.tipo === 'ai' ? 'ai' : 'humano',
            texto: String(m.texto || ''),
          }))
        : [];
    }

    return res.status(200).json(parsed);

  } catch (err) {
    console.error('Unhandled error:', err.message);
    return res.status(500).json({ erro: 'Erro interno. Tente novamente em alguns instantes.' });
  }
};

function clamp(val) {
  const n = Number(val);
  return isNaN(n) ? 50 : Math.max(0, Math.min(100, Math.round(n)));
}
