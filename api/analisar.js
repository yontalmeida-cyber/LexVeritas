// /api/analisar.js — LexVeritas API Endpoint
// Vercel Serverless Function — Node.js 18+
// Handles 3 analysis modes: judicial, academico, critica

export default async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ erro: 'Método não permitido' });

  const { texto, modo = 'judicial', tribunal, relator, instituicao, tipoDoc, orientador, tipoProcesso, parteRecorrente } = req.body;

  if (!texto || texto.length < 50) {
    return res.status(400).json({ erro: 'Texto insuficiente para análise.' });
  }

  const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
  if (!ANTHROPIC_API_KEY) {
    return res.status(500).json({ erro: 'Chave API não configurada.' });
  }

  // Truncate text to ~12000 chars to control token usage
  const textoTruncado = texto.length > 12000 ? texto.substring(0, 12000) + '\n[...texto truncado para análise...]' : texto;

  try {
    let systemPrompt, userPrompt;

    // ═══════════════════════════════════════════════
    // MODO CRÍTICA — Consultor Jurídico Sénior
    // ═══════════════════════════════════════════════
    if (modo === 'critica') {
      const contextoProcesso = [
        tribunal ? `Tribunal: ${tribunal}` : null,
        tipoProcesso ? `Tipo de processo: ${tipoProcesso}` : null,
        parteRecorrente ? `Parte recorrente: ${parteRecorrente}` : null,
      ].filter(Boolean).join('\n');

      systemPrompt = `Actua como um Consultor Jurídico Sénior especialista em Processo Civil e Processo Penal português. Tens 20 anos de experiência em recursos nos tribunais portugueses, com especial domínio em:
- Nulidades processuais (Art. 615.º CPC / Art. 379.º CPP)
- Erros de julgamento e violação de regras de prova
- Falta de fundamentação e exame crítico das provas
- Violações ao Art. 205.º da Constituição da República Portuguesa
- Recursos para as Relações e para o STJ

A tua tarefa é analisar a decisão judicial e identificar todos os vícios, nulidades e erros que possam fundamentar um recurso. Deves ser técnico, preciso e fundamentado em lei.

INSTRUÇÕES DE RESPOSTA:
- Responde EXCLUSIVAMENTE em JSON válido, sem markdown, sem backticks, sem texto antes ou depois do JSON
- Não uses aspas tipográficas — usa apenas aspas retas "
- O JSON deve ter exactamente esta estrutura:

{
  "veredicto_recurso": "RECURSO_VIAVEL" | "RECURSO_PARCIAL" | "RECURSO_INVIAVEL",
  "confianca": <número 0-100>,
  "sumario": "<resumo executivo em 2-3 frases>",
  "nulidades": [
    {
      "tipo": "<nome do vício ex: Omissão de Pronúncia>",
      "artigo": "<artigo legal ex: Art. 615.º n.º 1 al. d) CPC>",
      "gravidade": "grave" | "moderada" | "leve",
      "descricao": "<descrição objectiva do vício identificado no texto>",
      "argumento": "<argumento técnico-jurídico para usar no recurso>"
    }
  ],
  "conclusao": "<recomendação final do consultor em 2-4 frases>"
}

CRITÉRIOS DE VEREDICTO:
- RECURSO_VIAVEL: Existem uma ou mais nulidades graves com fundamento jurídico sólido. Alta probabilidade de procedência.
- RECURSO_PARCIAL: Existem argumentos mas com limitações — nulidades leves ou de difícil prova. Recurso possível mas incerto.
- RECURSO_INVIAVEL: A decisão está fundamentada, os vícios são mínimos ou inexistentes. Recurso improvável de proceder.

NULIDADES A PESQUISAR (não exclusivo):
1. Omissão de pronúncia — Art. 615.º n.º 1 al. d) CPC / Art. 379.º n.º 1 al. c) CPP
2. Contradição entre fundamentação e decisão — Art. 615.º n.º 1 al. c) CPC
3. Falta ou insuficiência de fundamentação — Art. 615.º n.º 1 al. b) CPC / Art. 205.º CRP
4. Falta de exame crítico das provas — Art. 607.º n.º 4 CPC / Art. 374.º n.º 2 CPP
5. Excesso de pronúncia — Art. 615.º n.º 1 al. d) CPC
6. Violação do princípio da imediação — Art. 607.º CPC
7. Erro notório na apreciação da prova — Art. 410.º n.º 2 al. c) CPP
8. Presunções ilícitas ou inversão do ónus da prova
9. Violação de normas imperativas de direito substantivo
10. Insuficiência para a decisão da matéria de facto provada — Art. 410.º n.º 2 al. a) CPP`;

      userPrompt = `${contextoProcesso ? `CONTEXTO DO PROCESSO:\n${contextoProcesso}\n\n` : ''}DECISÃO JUDICIAL A ANALISAR:

${textoTruncado}

Analisa esta decisão e identifica todas as nulidades, erros de julgamento e vícios processuais. Responde em JSON puro.`;
    }

    // ═══════════════════════════════════════════════
    // MODO ACADÉMICO
    // ═══════════════════════════════════════════════
    else if (modo === 'academico') {
      const contextoAcademico = [
        instituicao ? `Instituição: ${instituicao}` : null,
        tipoDoc ? `Tipo de documento: ${tipoDoc}` : null,
        orientador ? `Orientador: ${orientador}` : null,
      ].filter(Boolean).join('\n');

      systemPrompt = `És um perito forense em análise linguística especializado em detectar autoria de Inteligência Artificial em textos académicos jurídicos em português de Portugal. Tens experiência na análise de dissertações, teses e trabalhos académicos jurídicos.

Analisa o texto fornecido e avalia 6 indicadores de autoria humana vs. IA, com especial atenção ao estilo académico-jurídico português.

INSTRUÇÕES DE RESPOSTA:
- Responde EXCLUSIVAMENTE em JSON válido, sem markdown, sem backticks, sem texto antes ou depois
- Usa apenas aspas retas ", nunca aspas tipográficas
- Estrutura obrigatória:

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
  "narrativa": "<análise fundamentada em 2-3 parágrafos>",
  "relator_analise": "<análise do estilo do autor - se não há info sobre o autor, indica que não foi fornecido>",
  "marcadores": [
    { "tipo": "ai" | "humano", "texto": "<descrição do marcador observado>" }
  ]
}

VALORES DOS INDICADORES (0=humano, 100=IA):
- perplexidade: 0=texto imprevisível/humano, 100=muito previsível/IA
- burstiness: 0=grande variação rítmica/humano, 100=ritmo uniforme/IA
- coesao_artificial: 0=transições naturais, 100=conectores excessivamente fluidos
- uniformidade_sintatica: 0=estruturas variadas, 100=estruturas repetitivas
- riqueza_lexical: 0=vocabulário rico e variado, 100=vocabulário limitado e repetido
- marcadores_formulaicos: 0=expressões originais, 100=frases-clichê típicas de IA

VEREDICTOS:
- IA_DETECTADA: confiança ≥75%, múltiplos indicadores acima de 70
- PROVAVELMENTE_IA: confiança 55-74%, padrão sugere IA mas inconclusivo
- INCONCLUSIVO: confiança 40-54%, sinais mistos
- PROVAVELMENTE_HUMANO: confiança 25-39%, maioritariamente humano
- HUMANO: confiança <25%, texto claramente humano`;

      userPrompt = `${contextoAcademico ? `CONTEXTO DO DOCUMENTO:\n${contextoAcademico}\n\n` : ''}TEXTO ACADÉMICO A ANALISAR:

${textoTruncado}

Analisa este documento académico jurídico. Responde em JSON puro.`;
    }

    // ═══════════════════════════════════════════════
    // MODO JUDICIAL (default)
    // ═══════════════════════════════════════════════
    else {
      const contextoJudicial = [
        tribunal ? `Tribunal: ${tribunal}` : null,
        relator ? `Relator: ${relator}` : null,
      ].filter(Boolean).join('\n');

      systemPrompt = `És um perito forense em análise linguística especializado em detectar autoria de Inteligência Artificial em decisões judiciais portuguesas. Trabalhas com acórdãos, sentenças e despachos dos tribunais portugueses — STJ, Tribunais da Relação e tribunais de 1.ª instância.

Analisa o texto fornecido e avalia 6 indicadores de autoria humana vs. IA, calibrados especificamente para o estilo jurídico-judicial português.

INSTRUÇÕES DE RESPOSTA:
- Responde EXCLUSIVAMENTE em JSON válido, sem markdown, sem backticks, sem texto antes ou depois
- Usa apenas aspas retas ", nunca aspas tipográficas
- Estrutura obrigatória:

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
  "narrativa": "<análise fundamentada em 2-3 parágrafos concisos>",
  "relator_analise": "<análise do estilo do relator — se não foi indicado relator, descreve o estilo geral da decisão>",
  "marcadores": [
    { "tipo": "ai" | "humano", "texto": "<descrição concisa do marcador observado no texto>" }
  ]
}

VALORES DOS INDICADORES (0=humano, 100=IA):
- perplexidade: 0=texto imprevisível/genuíno, 100=muito previsível/gerado
- burstiness: 0=grande variação rítmica/humano, 100=ritmo uniforme/IA
- coesao_artificial: 0=transições naturais, 100=fluidez excessivamente homogénea
- uniformidade_sintatica: 0=estruturas frásicas variadas, 100=estruturas repetitivas
- riqueza_lexical: 0=vocabulário rico e específico, 100=vocabulário limitado/genérico
- marcadores_formulaicos: 0=linguagem jurídica autêntica, 100=frases-clichê de IA

VEREDICTOS:
- IA_DETECTADA: confiança ≥75%, vários indicadores acima de 70
- PROVAVELMENTE_IA: confiança 55-74%, padrão sugere IA
- INCONCLUSIVO: confiança 40-54%, sinais contraditórios
- PROVAVELMENTE_HUMANO: confiança 25-39%, maioritariamente humano
- HUMANO: confiança <25%, texto claramente de autoria humana

CONTEXTO IMPORTANTE:
- As decisões judiciais têm fórmulas jurídicas fixas (ementas, dispositivos) que não são indicadores de IA
- Analisa principalmente o corpo de fundamentação, não as partes formais obrigatórias
- O português jurídico português tem características próprias — não confundas estilo formal com IA
- Marcadores típicos de IA em contexto judicial: transições como "Neste contexto", "Importa salientar", "É de referir que", uniformidade no comprimento dos parágrafos, ausência de referências específicas ao processo`;

      userPrompt = `${contextoJudicial ? `CONTEXTO DA DECISÃO:\n${contextoJudicial}\n\n` : ''}TEXTO DA DECISÃO JUDICIAL A ANALISAR:

${textoTruncado}

Analisa esta decisão judicial. Responde em JSON puro.`;
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
        model: 'claude-opus-4-5',
        max_tokens: 2000,
        system: systemPrompt,
        messages: [{ role: 'user', content: userPrompt }],
      }),
    });

    if (!anthropicResponse.ok) {
      const errText = await anthropicResponse.text();
      console.error('Anthropic API error:', anthropicResponse.status, errText);
      return res.status(502).json({ erro: 'Erro na API de análise. Tente novamente.' });
    }

    const anthropicData = await anthropicResponse.json();
    const rawText = anthropicData.content?.[0]?.text || '';

    // ═══════════════════════════════════════════════
    // PARSE DA RESPOSTA JSON
    // ═══════════════════════════════════════════════
    let parsed;
    try {
      // Remove possíveis markdown fences
      const cleaned = rawText
        .replace(/^```json\s*/i, '')
        .replace(/^```\s*/i, '')
        .replace(/\s*```$/i, '')
        .trim();
      parsed = JSON.parse(cleaned);
    } catch (parseErr) {
      console.error('JSON parse error:', parseErr, 'Raw:', rawText.substring(0, 500));

      // Fallback: tentar extrair JSON por regex
      const jsonMatch = rawText.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        try {
          parsed = JSON.parse(jsonMatch[0]);
        } catch {
          return res.status(500).json({
            erro: 'Erro ao processar resposta da análise. Tente novamente.',
            detalhe: 'parse_error',
          });
        }
      } else {
        return res.status(500).json({ erro: 'Resposta inválida do modelo. Tente novamente.' });
      }
    }

    // ═══════════════════════════════════════════════
    // VALIDAÇÃO E NORMALIZAÇÃO DA RESPOSTA
    // ═══════════════════════════════════════════════
    if (modo === 'critica') {
      // Validar e normalizar resposta critica
      const veredictosCritica = ['RECURSO_VIAVEL', 'RECURSO_PARCIAL', 'RECURSO_INVIAVEL'];
      if (!veredictosCritica.includes(parsed.veredicto_recurso)) {
        parsed.veredicto_recurso = 'RECURSO_INVIAVEL';
      }
      parsed.confianca = Math.max(0, Math.min(100, Number(parsed.confianca) || 50));
      parsed.sumario = parsed.sumario || 'Análise concluída.';
      parsed.nulidades = Array.isArray(parsed.nulidades) ? parsed.nulidades : [];
      parsed.conclusao = parsed.conclusao || 'Consulte um advogado para validar estes resultados.';

      // Normalizar gravidade de cada nulidade
      parsed.nulidades = parsed.nulidades.map(n => ({
        tipo: n.tipo || 'Vício Processual',
        artigo: n.artigo || '',
        gravidade: ['grave', 'moderada', 'leve'].includes(n.gravidade) ? n.gravidade : 'moderada',
        descricao: n.descricao || '',
        argumento: n.argumento || '',
      }));

    } else {
      // Validar e normalizar resposta standard (judicial/academico)
      const veredictos = ['IA_DETECTADA', 'PROVAVELMENTE_IA', 'INCONCLUSIVO', 'PROVAVELMENTE_HUMANO', 'HUMANO'];
      if (!veredictos.includes(parsed.veredicto)) {
        parsed.veredicto = 'INCONCLUSIVO';
      }
      parsed.confianca = Math.max(0, Math.min(100, Number(parsed.confianca) || 50));

      // Normalizar indicadores
      const indKeys = ['perplexidade', 'burstiness', 'coesao_artificial', 'uniformidade_sintatica', 'riqueza_lexical', 'marcadores_formulaicos'];
      if (!parsed.indicadores || typeof parsed.indicadores !== 'object') {
        parsed.indicadores = {};
      }
      indKeys.forEach(k => {
        parsed.indicadores[k] = Math.max(0, Math.min(100, Number(parsed.indicadores[k]) || 50));
      });

      parsed.narrativa = parsed.narrativa || 'Análise concluída.';
      parsed.relator_analise = parsed.relator_analise || 'Relator/autor não indicado.';
      parsed.marcadores = Array.isArray(parsed.marcadores) ? parsed.marcadores.slice(0, 8) : [];
    }

    return res.status(200).json(parsed);

  } catch (err) {
    console.error('Handler error:', err);
    return res.status(500).json({ erro: 'Erro interno. Tente novamente em alguns instantes.' });
  }
}
