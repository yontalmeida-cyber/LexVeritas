// api/analisar.js — LexVeritas v4
// Melhorias: prompt sofisticado, 6000 chars, análise em 2 fases, Sonnet

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

  const estilosTribunal = {
    'STJ — Supremo Tribunal de Justiça': `ESTILO STJ: linguagem técnica densa, frases longas (50-120 palavras), doutrina clássica (Antunes Varela, Menezes Cordeiro, Menezes Leitão, Oliveira Ascensão), citações precisas com número de processo e relator, latim jurídico natural (ex vi, ad quem, a quo, in casu), variação NOTÁVEL no tamanho dos parágrafos. Expressões humanas típicas: afigura-se-nos, temos por seguro que, sem embargo, cumpre notar porém, salvo o devido respeito, haverá que concluir, com efeito, ora. SINAIS DE IA NO STJ: parágrafos uniformes, ausência de latim, citações sem processo específico, neste conspecto excessivo.`,

    'TRL — Tribunal da Relação de Lisboa': `ESTILO TRL: estilo directo, fundamentação concisa, citações do próprio TRL com número de processo, matéria de facto em lista numerada, linguagem forense prática, irregularidades sintácticas naturais, variação no tamanho dos parágrafos, travessão para comentários intercalados. Expressões: como resulta dos autos, conforme se extrai de, tendo presente que. SINAIS DE IA: estrutura perfeitamente simétrica, ausência de irregularidades, falta de referências processuais específicas.`,

    'TRP — Tribunal da Relação do Porto': `ESTILO TRP: directo e pragmático, frases curtas (20-40 palavras), matéria de facto estruturada em itens numerados, travessão intercalado. Expressões: como vem sendo entendido, é pacífico que, não se vislumbra razão para. SINAIS DE IA: frases longas e elaboradas, estrutura pedagógica, parágrafos uniformes.`,

    'TRC — Tribunal da Relação de Coimbra': `ESTILO TRC: influência académica, citações doutrinárias extensas com obra e página, subtítulos frequentes (I - II -), parágrafos médios. Expressões: conforme ensina o Prof. X in Obra pág. Y, na lição de, como doutrina. SINAIS DE IA: ausência de citações doutrinárias precisas.`,

    'TRG — Tribunal da Relação de Guimarães': `ESTILO TRG: conciso e prático, acórdãos curtos, vai directo ao ponto. Expressões: resulta evidente que, não merece censura a decisão. SINAIS DE IA: introduções longas, parágrafos extensos e uniformes.`,

    'TRE — Tribunal da Relação de Évora': `ESTILO TRE: equilibrado, jurisprudência do STJ como referência, extensão moderada, linguagem acessível mas precisa.`,

    'TC — Tribunal Constitucional': `ESTILO TC: linguagem constitucional específica, direito comparado (TEDH, BVerfG), votos de vencido frequentes, acórdãos muito longos, numeração romana. Expressões: à luz do bloco de constitucionalidade, o núcleo essencial, princípio da proporcionalidade impõe. SINAIS DE IA: ausência de referências comparatistas, falta de votos.`,

    'TCAS — Tribunal Central Administrativo Sul': `ESTILO TCAS: linguagem administrativa (acto administrativo, vício de forma, desvio de poder), referências ao CPA e CPTA com artigos específicos, matéria de facto focada em actos e prazos. SINAIS DE IA: ausência de referências legislativas específicas.`,

    'TCAN — Tribunal Central Administrativo Norte': `Partilha características com TCAS: especialização administrativa e fiscal, estilo ligeiramente mais conciso.`,
  };

  const estiloCtx = tribunal && estilosTribunal[tribunal] ? `\n${estilosTribunal[tribunal]}` : tribunal ? `\nTribunal: ${tribunal}` : '';
  const relatorCtx = relator?.trim() ? `\nRELATOR: "${relator.trim()}" — verifica se o texto tem marcas pessoais deste magistrado ou parece genérico.` : '';

  // Texto aumentado: início + meio + fim = até 6000 chars
  const len = texto.length;
  let textoAnalise;
  if (len <= 6000) {
    textoAnalise = texto;
  } else {
    const ini = texto.substring(0, 2500);
    const mid = texto.substring(Math.floor(len/2)-1000, Math.floor(len/2)+1000);
    const fim = texto.substring(len - 1500);
    textoAnalise = ini + '\n\n[...]\n\n' + mid + '\n\n[...]\n\n' + fim;
  }

  const systemPrompt = `És o melhor especialista mundial em análise forense linguística de textos jurídicos portugueses. Determina com máxima precisão se um documento judicial foi elaborado por magistrado humano ou com auxílio de IA.

METODOLOGIA EM DUAS FASES:

FASE 1 — ANÁLISE ESTRUTURAL:
- Variação no tamanho dos parágrafos: humanos têm ALTA variância; IA tende à uniformidade
- Elementos inesperados: parênteses, travessões intercalados, frases inacabadas = humano
- Densidade de referências concretas: números de processo, datas, artigos de lei, autores com obra e página = humano
- Estilo pedagógico e exaustivo = IA; ir directo ao ponto = humano

FASE 2 — ANÁLISE LINGUÍSTICA:
MARCADORES DE ALTA SUSPEIÇÃO DE IA:
- "cumpre apreciar e decidir", "importa referir que", "neste conspecto"
- "por todo o exposto", "nos termos e com os fundamentos supra expostos", "nesta conformidade"
- "há que salientar", "importa sublinhar", "face ao exposto", "em suma", "diga-se desde já"
- "conforme resulta da jurisprudência dominante", "carreados para os autos"
- "demais disso" (brasileirismo = IA), "em sede de" (possível IA)
- Parágrafos com exactamente o mesmo número de frases e tamanho similar

MARCADORES DE ESCRITA HUMANA AUTÊNTICA:
- "ora", "vejamos", "com efeito", "aliás", "de resto", "sem embargo", "afigura-se-nos"
- Travessão intercalado — como este — no meio de frases
- Frases que começam com conjunção adversativa ou conclusiva
- Referências documentais: "cfr. doc. 3 junto com a p.i.", "a fls. 45 dos autos"
- Latim jurídico natural e não forçado: ex vi, ad quem, in casu
- Erros ortográficos leves, pontuação irregular = humano

EXEMPLO DE TEXTO COM IA: "Cumpre apreciar e decidir. Importa referir que, face às argumentações jurídicas que estão na base das pretensões deduzidas, há que analisar com particular acuidade os elementos probatórios carreados para os autos. Neste conspecto, e conforme resulta da jurisprudência dominante, importa sublinhar que o ónus da prova recai sobre quem invoca o direito. Por todo o exposto, e nos termos e com os fundamentos supra expostos, nesta conformidade, decide-se julgar improcedente o recurso."

EXEMPLO DE TEXTO HUMANO: "O recorrente insurge-se contra a sentença — e compreende-se que o faça — mas sem razão. Vejamos porquê. A questão, no fundo, é simples: saber se o contrato de 15.03.2019 (cfr. doc. 3) configura cessão de posição contratual (art. 424.º CC). Como ensina Menezes Leitão (Direito das Obrigações, vol. II, 8.ª ed., pág. 182)..."

CALIBRAÇÃO DOS INDICADORES:
- perplexidade: 0=muito previsível (IA), 100=muito imprevisível (humano)
- burstiness: 0=parágrafos uniformes (IA), 100=alta variância (humano)
- coesao_artificial: 0=coesão natural (humano), 100=coesão excessiva (IA)
- uniformidade_sintatica: 0=sintaxe variada (humano), 100=sintaxe uniforme (IA)
- riqueza_lexical: 0=pobre, 100=rico (não discrimina sozinho)
- marcadores_formulaicos: 0=sem marcadores IA, 100=cheio de marcadores IA

SER CONSERVADOR: prefere INCONCLUSIVO a falsos positivos. Um texto com alguns marcadores de IA pode ser de um magistrado que usa expressões convencionais.

RESPONDE APENAS COM JSON VÁLIDO. SEM TEXTO ANTES OU DEPOIS:
{
  "veredicto": "IA_DETECTADA|PROVAVELMENTE_IA|INCONCLUSIVO|PROVAVELMENTE_HUMANO|HUMANO",
  "confianca": 0-100,
  "indicadores": {
    "perplexidade": 0-100,
    "burstiness": 0-100,
    "coesao_artificial": 0-100,
    "uniformidade_sintatica": 0-100,
    "riqueza_lexical": 0-100,
    "marcadores_formulaicos": 0-100
  },
  "narrativa": "Explicacao em 3-4 frases em portugues europeu com evidencias concretas do texto analisado.",
  "relator_analise": "Analise do estilo do relator ou Relator nao indicado.",
  "marcadores": [
    {"tipo": "ai|ok", "texto": "Descricao especifica com exemplo concreto do texto"}
  ]
}
Entre 4 e 6 marcadores. Sem aspas dentro de strings JSON.`;

  const userMsg = ['Analisa este documento judicial portugues com maxima precisao.', estiloCtx, relatorCtx, '', 'DOCUMENTO:', textoAnalise].filter(Boolean).join('\n');

  try {
    const anthropicRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1200,
        system: systemPrompt,
        messages: [{ role: 'user', content: userMsg }]
      })
    });

    if (!anthropicRes.ok) {
      const err = await anthropicRes.json().catch(() => ({}));
      console.error('Erro Anthropic:', anthropicRes.status, JSON.stringify(err));
      return res.status(502).json({ erro: 'Erro no servico de analise. Tente novamente.' });
    }

    const data = await anthropicRes.json();
    const raw = data.content?.map(i => i.text || '').join('') || '{}';
    console.log('Raw:', raw.substring(0, 300));

    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.error('Sem JSON:', raw);
      return res.status(500).json({ erro: 'Resposta invalida. Tente novamente.' });
    }

    const result = JSON.parse(jsonMatch[0]);
    return res.status(200).json(result);

  } catch (err) {
    console.error('Erro interno:', err.message);
    return res.status(500).json({ erro: 'Erro interno: ' + err.message });
  }
}
