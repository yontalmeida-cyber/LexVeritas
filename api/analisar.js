// api/analisar.js — LexVeritas
// Usa Claude Haiku: o modelo mais económico da Anthropic

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

  // Prompt separado em partes para evitar problemas com JSON dentro de strings
  const systemPrompt = [
    'És um especialista forense em análise linguística de textos jurídicos portugueses.',
    'Detecta se um documento judicial foi elaborado com IA ou por um magistrado humano.',
    '',
    'Tribunais: STJ, STA, TRL, TRP, TRC, TRG, TRE, TC, TCAS, TCAN.',
    '',
    'IMPORTANTE: Responde APENAS com JSON puro e válido. Sem texto antes ou depois. Sem markdown.',
    '',
    'Formato obrigatório:',
    '{',
    '  "veredicto": "IA_DETECTADA",',
    '  "confianca": 85,',
    '  "indicadores": {',
    '    "perplexidade": 80,',
    '    "burstiness": 70,',
    '    "coesao_artificial": 75,',
    '    "uniformidade_sintatica": 80,',
    '    "riqueza_lexical": 60,',
    '    "marcadores_formulaicos": 90',
    '  },',
    '  "narrativa": "Texto explicativo em duas frases.",',
    '  "marcadores": [',
    '    {"tipo": "ai", "texto": "Descricao do marcador 1"},',
    '    {"tipo": "ok", "texto": "Descricao do marcador 2"}',
    '  ]',
    '}',
    '',
    'Valores possiveis para veredicto: IA_DETECTADA, PROVAVELMENTE_IA, INCONCLUSIVO, PROVAVELMENTE_HUMANO, HUMANO',
    'Inclui entre 3 a 5 marcadores. Nao uses aspas dentro dos textos dos marcadores.',
    'Sinais de IA: formulas excessivas, sem idiossincrasias do relator, citacoes sem numero de processo, paragrafos uniformes.',
    'Sinais humanos: processos concretos, doutrina portuguesa especifica, estilo telegrafico, irregularidades naturais.'
  ].join('\n');

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
        system:     systemPrompt,
        messages: [{
          role:    'user',
          content: 'Analisa este documento judicial portugues:' + tribunalCtx + '\n\n' + textoLimitado
        }]
      })
    });

    if (!anthropicRes.ok) {
      const err = await anthropicRes.json().catch(() => ({}));
      console.error('Erro Anthropic:', anthropicRes.status, JSON.stringify(err));
      return res.status(502).json({ erro: 'Erro no serviço de análise. Tente novamente.' });
    }

    const data = await anthropicRes.json();
    const raw  = data.content?.map(i => i.text || '').join('') || '{}';

    console.log('Resposta raw:', raw.substring(0, 200));

    // Extrai o JSON da resposta
    let result;
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.error('Sem JSON na resposta:', raw);
      return res.status(500).json({ erro: 'Resposta inválida. Tente novamente.' });
    }

    result = JSON.parse(jsonMatch[0]);
    return res.status(200).json(result);

  } catch (err) {
    console.error('Erro interno:', err.message, err.stack);
    return res.status(500).json({ erro: 'Erro interno: ' + err.message });
  }
}
