// api/analisar.js — LexVeritas
// Usa Claude Haiku: o modelo mais económico da Anthropic
// Custo aproximado: 0.001€ por análise

const SYSTEM_PROMPT = `És um especialista forense em análise linguística de textos jurídicos portugueses. Detecta se um documento judicial foi elaborado com IA ou por um magistrado humano.

Conheces os tribunais portugueses: STJ, STA, TRL, TRP, TRC, TRG, TRE, Tribunal Constitucional, TCAS, TCAN e tribunais de primeira instância.

Responde APENAS com JSON válido, sem texto antes ou depois:
{
  "veredicto": "IA_DETECTADA" | "PROVAVELMENTE_IA" | "INCONCLUSIVO" | "PROVAVELMENTE_HUMANO" | "HUMANO",
  "confianca": 0-100,
  "indicadores": {
    "perplexidade": 0-100,
    "burstiness": 0-100,
    "coesao_artificial": 0-100,
    "uniformidade_sintatica": 0-100,
    "riqueza_lexical": 0-100,
    "marcadores_formulaicos": 0-100
  },
  "narrativa": "Explicação em português europeu (2-3 parágrafos)",
  "marcadores": [{"tipo": "ai|ok", "texto": "descrição"}]
}

Sinais de IA: fórmulas excessivas ("cumpre apreciar", "por todo o exposto"), sem idiossincrasias do relator, citações sem número de processo, parágrafos uniformes, português do Brasil.
Sinais humanos: processos concretos, doutrina portuguesa específica, estilo telegráfico, irregularidades naturais.`;

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ erro: 'Método não permitido.' });
  }

  const { texto, tribunal } = req.body || {};

  if (!texto || typeof texto !== 'string' || texto.trim().length < 100) {
    return res.status(400).json({ erro: 'Texto demasiado curto (mínimo 100 caracteres).' });
  }
  if (texto.length > 30000) {
    return res.status(400).json({ erro: 'Texto demasiado longo (máximo 30 000 caracteres).' });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ erro: 'Servidor mal configurado. Contacte o administrador.' });
  }

  const tribunalCtx = tribunal ? `\nTribunal: ${tribunal}` : '';
  const textoLimitado = texto.substring(0, 3000);

  try {
    const anthropicRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type':      'application/json',
        'x-api-key':         apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model:      'claude-haiku-4-5-20251001',
        max_tokens: 800,
        system:     SYSTEM_PROMPT,
        messages: [{
          role:    'user',
          content: `Analisa este documento judicial português:${tribunalCtx}\n\n${textoLimitado}`
        }]
      })
    });

    if (!anthropicRes.ok) {
      const err = await anthropicRes.json().catch(() => ({}));
      console.error('Erro Anthropic:', anthropicRes.status, err);
      return res.status(502).json({ erro: 'Erro no serviço de análise. Tente novamente.' });
    }

    const data   = await anthropicRes.json();
    const raw    = data.content?.map(i => i.text || '').join('') || '{}';
    const clean  = raw.replace(/```json|```/g, '').trim();
    const result = JSON.parse(clean);

    return res.status(200).json(result);

  } catch (err) {
    console.error('Erro interno:', err.message);
    return res.status(500).json({ erro: 'Erro interno. Tente novamente.' });
  }
}
