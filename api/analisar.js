// api/analisar.js — LexVeritas v3
// Passo A: exemplos reais de estilo por tribunal
// Passo B: campo do relator para comparação de estilo

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ erro: 'Método não permitido.' });
  }

  const { texto, tribunal, relator } = req.body || {};

  if (!texto || typeof texto !== 'string' || texto.trim().length < 100) {
    return res.status(400).json({ erro: 'Texto demasiado curto (mínimo 100 caracteres).' });
  }
  if (texto.length > 30000) {
    return res.status(400).json({ erro: 'Texto demasiado longo (máximo 30 000 caracteres).' });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ erro: 'Servidor mal configurado.' });
  }

  // PASSO A — Referências de estilo real por tribunal
  const estilosTribunal = {
    'STJ — Supremo Tribunal de Justiça': `
      O STJ caracteriza-se por: linguagem técnica densa, fundamentação jurídica extensa com referência
      a doutrina clássica portuguesa (Antunes Varela, Menezes Cordeiro, Menezes Leitão, Oliveira Ascensão),
      citações frequentes de acórdãos com número de processo e data precisos, uso de latim jurídico
      ("ex vi", "ad quem", "a quo"), frases longas e complexas com subordinação múltipla,
      referências ao BMJ (Boletim do Ministério da Justiça) em acórdãos mais antigos,
      transições bruscas típicas de escrita humana sob pressão, variação notável no tamanho dos parágrafos.
      Expressões típicas humanas: "afigura-se-nos", "temos por seguro que", "sem embargo",
      "cumpre notar, porém,", "salvo o devido respeito por opinião contrária".`,

    'TRL — Tribunal da Relação de Lisboa': `
      O TRL caracteriza-se por: estilo mais directo que o STJ, fundamentação concisa mas sólida,
      referência frequente a acórdãos do próprio TRL com número de processo,
      uso frequente de listas numeradas na matéria de facto provada,
      linguagem menos acadêmica que o STJ, mais próxima da prática forense,
      citação de doutrina mais recente, irregularidades sintácticas naturais,
      parágrafos de tamanho muito variável, especialmente na fundamentação.
      Expressões típicas: "como resulta dos autos", "conforme se extrai de",
      "tendo presente que", "importa desde logo referir".`,

    'TRP — Tribunal da Relação do Porto': `
      O TRP caracteriza-se por: estilo directo e pragmático, menos ornamentado que Lisboa,
      fundamentação objectiva centrada nos factos do caso concreto,
      menor recurso a doutrina, maior peso na jurisprudência,
      frases mais curtas e directas, matéria de facto muito estruturada em itens,
      uso frequente de travessão para intercalar comentários,
      referências a acórdãos do STJ como autoridade principal.
      Expressões típicas: "como vem sendo entendido", "é pacífico que",
      "não se vislumbra razão para", "a questão está em saber se".`,

    'TRC — Tribunal da Relação de Coimbra': `
      O TRC caracteriza-se por: influência académica de Coimbra visível na escrita,
      maior recurso a doutrina académica, especialmente civilística,
      fundamentação mais desenvolvida e pormenorizada,
      uso frequente de citações doutrinárias extensas entre aspas,
      estrutura muito cuidada com subtítulos frequentes,
      linguagem formal mas acessível, parágrafos médios bem estruturados.
      Expressões típicas: "conforme ensina", "na lição de", "como doutrina".`,

    'TRG — Tribunal da Relação de Guimarães': `
      O TRG caracteriza-se por: estilo conciso e prático, fundamentação directa ao ponto,
      menor extensão dos acórdãos comparado com outros tribunais da relação,
      linguagem clara sem excessos retóricos, matéria de facto bem delimitada,
      referências jurisprudenciais seleccionadas e pertinentes.
      Expressões típicas: "resulta evidente que", "não merece censura a decisão".`,

    'TRE — Tribunal da Relação de Évora': `
      O TRE caracteriza-se por: estilo equilibrado entre rigor técnico e clareza,
      fundamentação sólida com recurso a jurisprudência do STJ,
      menor volume de acórdãos mas qualidade técnica consistente,
      linguagem acessível mas precisa, estrutura clara e bem organizada.`,

    'TC — Tribunal Constitucional': `
      O TC caracteriza-se por: linguagem constitucional específica,
      fundamentação muito extensa com análise de direito comparado,
      referências frequentes à doutrina constitucionalista portuguesa e europeia,
      uso de técnicas de interpretação constitucional explicitadas,
      acórdãos muito longos com dissensões e votos de vencido frequentes,
      referências ao TEDH e jurisprudência europeia, linguagem académica elevada.
      Expressões típicas: "o princípio da proporcionalidade impõe",
      "à luz do bloco de constitucionalidade", "na perspectiva do recorrente".`,

    'TCAS — Tribunal Central Administrativo Sul': `
      O TCAS caracteriza-se por: linguagem administrativa específica,
      referências frequentes ao CPA e CPTA, fundamentação centrada
      no direito administrativo e fiscal, estrutura muito formal,
      uso frequente de remissões para legislação específica,
      matéria de facto mais complexa envolvendo actos administrativos.`,

    'TCAN — Tribunal Central Administrativo Norte': `
      O TCAN partilha características com o TCAS mas com estilo
      ligeiramente mais conciso, mesma especialização administrativa.`,
  };

  // PASSO B — Contexto do relator
  const contextoRelator = relator && relator.trim()
    ? `\nRELATOR INDICADO: ${relator.trim()}\nSe conheceres acórdãos deste relator, compara o estilo do texto com o estilo típico desse magistrado. Identifica se a escrita tem as marcas pessoais desse relator ou se parece genérica e impessoal.`
    : '';

  const estiloTribunalCtx = tribunal && estilosTribunal[tribunal]
    ? `\nESTILO TÍPICO DO ${tribunal}:\n${estilosTribunal[tribunal]}`
    : tribunal
    ? `\nTribunal indicado: ${tribunal}`
    : '';

  const systemPrompt = [
    'És um especialista forense em análise linguística de textos jurídicos portugueses.',
    'Detecta se um documento judicial foi elaborado com IA ou por um magistrado humano.',
    'Tens conhecimento profundo do estilo de escrita de cada tribunal português e dos seus magistrados.',
    '',
    'IMPORTANTE: Responde APENAS com JSON puro e válido. Sem texto antes ou depois. Sem markdown. Sem caracteres especiais dentro das strings.',
    '',
    'Formato obrigatório (copia exactamente esta estrutura):',
    '{',
    '  "veredicto": "PROVAVELMENTE_IA",',
    '  "confianca": 75,',
    '  "indicadores": {',
    '    "perplexidade": 70,',
    '    "burstiness": 65,',
    '    "coesao_artificial": 80,',
    '    "uniformidade_sintatica": 75,',
    '    "riqueza_lexical": 60,',
    '    "marcadores_formulaicos": 85',
    '  },',
    '  "narrativa": "Explicacao da analise em duas ou tres frases simples sem aspas nem caracteres especiais.",',
    '  "relator_analise": "Se foi indicado relator escreve aqui a comparacao de estilo. Se nao foi indicado escreve Relator nao indicado.",',
    '  "marcadores": [',
    '    {"tipo": "ai", "texto": "Descricao sem aspas nem virgulas especiais"},',
    '    {"tipo": "ok", "texto": "Descricao sem aspas nem virgulas especiais"},',
    '    {"tipo": "ai", "texto": "Outro marcador"},',
    '    {"tipo": "ok", "texto": "Outro marcador"}',
    '  ]',
    '}',
    '',
    'Valores para veredicto: IA_DETECTADA, PROVAVELMENTE_IA, INCONCLUSIVO, PROVAVELMENTE_HUMANO, HUMANO',
    'Inclui entre 3 e 5 marcadores. USA APENAS texto simples sem aspas dentro das strings JSON.',
    '',
    'Sinais de IA: formulas excessivas como cumpre apreciar e decidir ou por todo o exposto,',
    'ausencia de idiossincrasias do relator, citacoes sem numero de processo,',
    'paragrafos de tamanho uniforme, portugues do Brasil, estrutura demasiado pedagogica.',
    '',
    'Sinais humanos: referencias a processos concretos com numero, doutrina portuguesa especifica,',
    'estilo telegrafico nas materias de facto, irregularidades sintacticas naturais,',
    'marcas pessoais do magistrado, variacao no tamanho dos paragrafos.'
  ].join('\n');

  const userMessage = [
    'Analisa este documento judicial portugues.',
    estiloTribunalCtx,
    contextoRelator,
    '',
    'TEXTO:',
    texto.substring(0, 3000)
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
        max_tokens: 900,
        system:     systemPrompt,
        messages:   [{ role: 'user', content: userMessage }]
      })
    });

    if (!anthropicRes.ok) {
      const err = await anthropicRes.json().catch(() => ({}));
      console.error('Erro Anthropic:', anthropicRes.status, JSON.stringify(err));
      return res.status(502).json({ erro: 'Erro no servico de analise. Tente novamente.' });
    }

    const data = await anthropicRes.json();
    const raw  = data.content?.map(i => i.text || '').join('') || '{}';

    console.log('Raw response:', raw.substring(0, 300));

    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.error('Sem JSON na resposta:', raw);
      return res.status(500).json({ erro: 'Resposta invalida. Tente novamente.' });
    }

    const result = JSON.parse(jsonMatch[0]);
    return res.status(200).json(result);

  } catch (err) {
    console.error('Erro interno:', err.message);
    return res.status(500).json({ erro: 'Erro interno: ' + err.message });
  }
}
