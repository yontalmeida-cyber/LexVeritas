// /api/demo.js — LexVeritas Demo (sem auth, 1 análise/hora por IP)
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const ipCache = new Map();

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ erro: 'Método não permitido' });

  // Rate limit: 1/hora por IP
  const ip = req.headers['x-forwarded-for'] || 'unknown';
  const now = Date.now();
  const last = ipCache.get(ip) || 0;
  if (now - last < 3600000) {
    return res.status(429).json({ erro: 'Limite atingido. 1 análise gratuita por hora.' });
  }
  ipCache.set(ip, now);

  const { texto } = req.body || {};
  if (!texto || texto.trim().length < 80) {
    return res.status(400).json({ erro: 'Mínimo 80 caracteres.' });
  }

  const textoTruncado = texto.substring(0, 1500);

  if (!ANTHROPIC_API_KEY) return res.status(500).json({ erro: 'Serviço indisponível.' });

  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 800,
        system: `És um perito forense em análise de autoria de IA em decisões judiciais portuguesas. RESPONDE APENAS COM JSON PURO, sem backticks.

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
  "narrativa": "Análise breve aqui."
}

VALORES: veredicto deve ser IA_DETECTADA, PROVAVELMENTE_IA, INCONCLUSIVO, PROVAVELMENTE_HUMANO, ou HUMANO. Indicadores 0-100.`,
        messages: [{ role: 'user', content: `DECISÃO JUDICIAL:\n\n${textoTruncado}\n\nResponde em JSON puro.` }],
      }),
    });

    if (!r.ok) return res.status(502).json({ erro: 'Erro na análise. Tente novamente.' });

    const data = await r.json();
    const raw = (data.content?.[0]?.text || '').trim();

    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      const match = raw.match(/\{[\s\S]*\}/);
      if (match) parsed = JSON.parse(match[0]);
      else return res.status(500).json({ erro: 'Erro ao processar. Tente novamente.' });
    }

    const okV = ['IA_DETECTADA','PROVAVELMENTE_IA','INCONCLUSIVO','PROVAVELMENTE_HUMANO','HUMANO'];
    if (!okV.includes(parsed.veredicto)) parsed.veredicto = 'INCONCLUSIVO';
    parsed.confianca = Math.max(0, Math.min(100, Math.round(Number(parsed.confianca) || 50)));

    return res.status(200).json(parsed);

  } catch (err) {
    console.error('Demo error:', err.message);
    return res.status(500).json({ erro: 'Erro interno. Tente novamente.' });
  }
};
