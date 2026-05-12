// /api/analisar.js — LexVeritas API Endpoint
// Vercel Serverless Function — Node.js 18+ — CommonJS
// v2.3 — validador formato números de processo PT (Portaria 280/2013) + mapa tribunais + minuta 16k

const SUPABASE_URL      = 'https://bsbgizaftamufmmxeyer.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJzYmdpemFmdGFtdWZtbXhleWVyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc3NDkzNTIsImV4cCI6MjA5MzMyNTM1Mn0._xBiw0VUa3FSnortYseUQPDc5xb--k15lYcylNmMEEQ';

// ══════════════════════════════════════════════════════════════════════════════
// VALIDADOR DE NÚMEROS DE PROCESSO PORTUGUÊS
// Portaria n.º 280/2013, de 26 de Agosto
//
// Formato padrão: NNNNN/AA.NTTTTT.XN[-sufixo]
// Exemplos reais: 1422/25.0T8GRD.C1
//                 223/15.8T9EVR.E1
//                 6/02.5TBSNT-A.L1-9
//                 16577/23.0T8SNT.L1-4
//                 1231/23.0T8FIG-A.C1
//
// Componentes:
//   NNNNN  — número sequencial (1 a 6 dígitos)
//   AA     — ano (2 ou 4 dígitos)
//   N      — dígito de controlo (0-9)
//   TTTTT  — código do tribunal/comarca (ex: T8GRD, T9EVR, TBSNT)
//   X      — letra da Relação (L=Lisboa, P=Porto, C=Coimbra, G=Guimarães,
//             E=Évora, S=STJ, A=STA, T=TC)
//   N[-sufixo] — número da secção/vara e sufixo opcional
// ══════════════════════════════════════════════════════════════════════════════

// Mapeamento das últimas 3 letras do código de comarca → letra da Relação competente
const COMARCA_PARA_RELACAO = {
  // → Lisboa (L)
  'LSB': 'L', 'LRS': 'L', 'SNT': 'L', 'CSC': 'L', 'OER': 'L',
  'VFX': 'L', 'MTS': 'L', 'ALM': 'L', 'SXL': 'L', 'BRR': 'L',
  'PLM': 'L', 'STR': 'L', 'TRS': 'L', 'ABT': 'L', 'TVD': 'L',
  'STC': 'L', 'LRE': 'L',
  // → Porto (P)
  'PRT': 'P', 'VNG': 'P', 'MLD': 'P', 'VLP': 'P', 'PVZ': 'P',
  'VCD': 'P', 'STS': 'P', 'TRV': 'P', 'PNF': 'P', 'PRC': 'P',
  'FLG': 'P', 'LUS': 'P', 'ESP': 'P', 'GDM': 'P', 'VRL': 'P',
  'CHV': 'P', 'BGC': 'P', 'MCN': 'P', 'VPA': 'P', 'BRG': 'P',
  // → Guimarães (G) — parte do distrito de Braga
  'GML': 'G', 'VCT': 'G', 'BCL': 'G',
  // → Coimbra (C)
  'CBR': 'C', 'AVR': 'C', 'VIS': 'C', 'GRD': 'C', 'CTB': 'C',
  'FIG': 'C', 'AGD': 'C', 'OVR': 'C', 'STA': 'C', 'LMG': 'C',
  'LRA': 'C',
  // → Évora (E)
  'EVR': 'E', 'BJA': 'E', 'PTG': 'E', 'FAR': 'E', 'LLE': 'E',
  'TVR': 'E', 'OLH': 'E', 'PTA': 'E', 'LAG': 'E', 'SBR': 'E',
  'ALT': 'E', 'STC': 'E',
};

// Letras de Relação válidas e nomes completos
const LETRAS_RELACAO = {
  'L': 'Tribunal da Relação de Lisboa',
  'P': 'Tribunal da Relação do Porto',
  'C': 'Tribunal da Relação de Coimbra',
  'G': 'Tribunal da Relação de Guimarães',
  'E': 'Tribunal da Relação de Évora',
  'S': 'Supremo Tribunal de Justiça',
  'A': 'Supremo Tribunal Administrativo',
  'T': 'Tribunal Constitucional',
};

/**
 * Valida um número de processo português.
 * @param {string} numero
 * @returns {{ valido: boolean, formato_ok: boolean, problemas: string[], relacao_esperada: string|null, coerencia_relacao: boolean|null }}
 */
function validarNumeroProcesso(numero) {
  const resultado = {
    valido: false,
    formato_ok: false,
    problemas: [],
    relacao_esperada: null,
    coerencia_relacao: null,
  };

  if (!numero || typeof numero !== 'string') {
    resultado.problemas.push('Número de processo ausente.');
    return resultado;
  }

  const s = numero.trim().toUpperCase();

  // Formato moderno: NNNNN/AA.NTTTTT.XN[-sufixo]
  // Aceita variações como sufixos -A, -B, secções com dois dígitos
  const RE = /^(\d{1,6})\/(\d{2,4})\.\d[A-Z0-9]{3,8}\.([A-Z])(\d{1,2})(?:-[A-Z0-9]+)*$/;
  const m = RE.exec(s);

  if (!m) {
    // Formato antigo STJ (ex: 07A1234) — aceitar sem mais validação
    if (/^\d{2}[A-Z]\d{3,5}$/.test(s)) {
      resultado.formato_ok = true;
      resultado.valido = true;
      return resultado;
    }
    resultado.problemas.push(
      `Formato inválido: "${numero}". O padrão é NNNNN/AA.NTTTTT.XN (ex: 1422/25.0T8GRD.C1).`
    );
    return resultado;
  }

  resultado.formato_ok = true;
  const [, , anoStr, letraRelacao] = m;

  // Validar ano
  const anoNum = parseInt(anoStr, 10);
  const anoReal = anoNum < 100 ? (anoNum >= 90 ? 1900 + anoNum : 2000 + anoNum) : anoNum;
  const anoAtual = new Date().getFullYear();

  if (anoReal < 1990) {
    resultado.problemas.push(
      `Ano ${anoReal} anterior à informatização dos tribunais (1990). Provavelmente fabricado.`
    );
  }
  if (anoReal > anoAtual) {
    resultado.problemas.push(`Ano ${anoReal} é futuro (ano actual: ${anoAtual}). Impossível.`);
  }

  // Validar letra da Relação
  if (!LETRAS_RELACAO[letraRelacao]) {
    resultado.problemas.push(
      `Letra de tribunal desconhecida: "${letraRelacao}". Válidas: L, P, C, G, E, S, A, T.`
    );
  } else {
    resultado.relacao_esperada = LETRAS_RELACAO[letraRelacao];
  }

  // Extrair código de comarca e verificar coerência com a Relação indicada no número
  // O segmento do meio (ex: "0T8GRD" ou "5TBSNT-A") contém o código do tribunal
  const partes = s.split('.');
  if (partes.length >= 2) {
    const segComarca = partes[1].split('.')[0]; // ex: "0T8GRD"
    // Extrair as últimas 3 letras do código de comarca
    const mComarca = segComarca.match(/([A-Z]{3})(?:-[A-Z])?$/);
    if (mComarca) {
      const codComarca = mComarca[1];
      const relacaoEsperadaLetra = COMARCA_PARA_RELACAO[codComarca];
      if (relacaoEsperadaLetra && LETRAS_RELACAO[letraRelacao]) {
        if (relacaoEsperadaLetra !== letraRelacao) {
          resultado.problemas.push(
            `Incoerência: a comarca "${codComarca}" pertence à ${LETRAS_RELACAO[relacaoEsperadaLetra]}, ` +
            `mas o número aponta para ${LETRAS_RELACAO[letraRelacao]}. Possível número fabricado.`
          );
          resultado.coerencia_relacao = false;
        } else {
          resultado.coerencia_relacao = true;
        }
      }
    }
  }

  resultado.valido = resultado.problemas.length === 0;
  return resultado;
}

/**
 * Extrai e valida todos os números de processo num texto.
 * Devolve apenas os que têm problemas.
 */
function extrairEValidarProcessos(texto) {
  if (!texto || typeof texto !== 'string') return [];

  const RE_EXTRAI = /\b\d{1,6}\/\d{2,4}\.\d[A-Z0-9]{3,8}\.[A-Z]\d{1,2}(?:-[A-Z0-9]+)*\b/gi;
  const encontrados = [];
  const vistos = new Set();
  let m;

  while ((m = RE_EXTRAI.exec(texto)) !== null) {
    const num = m[0].toUpperCase();
    if (!vistos.has(num)) {
      vistos.add(num);
      const r = validarNumeroProcesso(num);
      if (!r.valido || r.problemas.length > 0) {
        encontrados.push({ numero: num, validacao: r });
      }
    }
  }

  return encontrados;
}

// ── MAPA DE TRIBUNAIS DE RECURSO (Dec.-Lei n.º 49/2014, de 27 de Março) ──
const MAPA_RELACOES = `
TRIBUNAIS DE RECURSO SEGUNDO O DECRETO-LEI N.º 49/2014, DE 27 DE MARÇO:

Tribunal da Relação de Lisboa:
  - Tribunal Judicial da Comarca de Lisboa, Lisboa Norte, Lisboa Oeste
  - Tribunal Judicial da Comarca de Setúbal
  - Tribunal Judicial da Comarca de Santarém
  - Tribunal Judicial da Comarca de Leiria

Tribunal da Relação de Coimbra:
  - Tribunal Judicial da Comarca de Coimbra
  - Tribunal Judicial da Comarca de Aveiro
  - Tribunal Judicial da Comarca de Viseu
  - Tribunal Judicial da Comarca da Guarda  ← IMPORTANTE
  - Tribunal Judicial da Comarca de Castelo Branco
  - Tribunal Judicial da Comarca de Leiria (matéria penal: partilhado)

Tribunal da Relação do Porto:
  - Tribunal Judicial da Comarca do Porto, Porto Este
  - Tribunal Judicial da Comarca de Braga
  - Tribunal Judicial da Comarca de Viana do Castelo
  - Tribunal Judicial da Comarca de Vila Real
  - Tribunal Judicial da Comarca de Bragança

Tribunal da Relação de Guimarães:
  - Tribunal Judicial da Comarca de Guimarães (Braga — parte)
  - Nota: Guimarães NÃO é relação autónoma; o TJCB de Guimarães recorre para a Relação do Porto

Tribunal da Relação de Évora:
  - Tribunal Judicial da Comarca de Évora
  - Tribunal Judicial da Comarca de Beja
  - Tribunal Judicial da Comarca de Portalegre
  - Tribunal Judicial da Comarca de Faro

NOTA CRÍTICA: A Comarca da Guarda recorre SEMPRE para o Tribunal da Relação de Coimbra, NUNCA para Guimarães.
`;

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

  const textoTruncado = texto
    ? (texto.length > 12000 ? texto.substring(0, 12000) + '\n[texto truncado]' : texto)
    : '';

  // ── VALIDAÇÃO LOCAL DE NÚMEROS DE PROCESSO (modo judicial, sem custo) ──
  let validacoesLocais = [];
  if (modo === 'judicial' && texto) {
    validacoesLocais = extrairEValidarProcessos(texto);
  }

  let systemPrompt, userPrompt;

  // ══════════════════════════════════════════════════
  // MODO CRÍTICA
  // ══════════════════════════════════════════════════
  if (modo === 'critica') {
    const ctx = [
      tribunal        ? `Tribunal de 1.ª Instância: ${tribunal}`  : null,
      tipoProcesso    ? `Tipo de processo: ${tipoProcesso}`        : null,
      parteRecorrente ? `Parte recorrente: ${parteRecorrente}`     : null,
    ].filter(Boolean).join('\n');

    systemPrompt = `Actua como Consultor Jurídico Sénior especialista em recursos portugueses. Responde APENAS com JSON puro, sem backticks, sem texto antes ou depois.

${MAPA_RELACOES}

REGRA CRÍTICA PARA tribunal_recurso: Determina o tribunal da relação competente com base no tribunal de 1.ª instância indicado, usando RIGOROSAMENTE o mapa acima. Se o tribunal for da Comarca da Guarda, o tribunal de recurso é OBRIGATORIAMENTE o Tribunal da Relação de Coimbra. Nunca atribuas a Guarda à Relação de Guimarães.

{
  "veredicto_recurso": "RECURSO_VIAVEL",
  "confianca": 80,
  "admissivel": true,
  "tribunal_recurso": "Tribunal da Relação de Coimbra",
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

Valores obrigatórios:
- veredicto_recurso: RECURSO_VIAVEL, RECURSO_PARCIAL ou RECURSO_INVIAVEL
- categoria: nulidade, erro_direito, erro_facto ou questao_constitucional
- gravidade: grave, moderada ou leve
- dificuldade: facil, media ou dificil
- Máximo 4 fundamentos, por ordem de prioridade

Pesquisa: omissão pronúncia (615.º/1/d CPC, 379.º/1/c CPP), contradição (615.º/1/c), falta fundamentação (615.º/1/b, 205.º CRP), falta exame crítico provas (607.º/4 CPC, 374.º/2 CPP), excesso pronúncia, errada interpretação legal, erro notório (410.º/2/c CPP), insuficiência matéria facto (410.º/2/a), violação Art. 20.º/32.º CRP.

IMPORTANTE: Se identificares fundamentos, lista-os SEMPRE no array fundamentos. Nunca devolvas fundamentos vazios se existirem vícios identificáveis.`;

    userPrompt = `${ctx ? `CONTEXTO DO PROCESSO:\n${ctx}\n\n` : ''}DECISÃO JUDICIAL A ANALISAR:\n\n${textoTruncado}\n\nResponde em JSON puro.`;

  // ══════════════════════════════════════════════════
  // MODO MINUTA — max_tokens 16000, texto COMPLETO
  // ══════════════════════════════════════════════════
  } else if (modo === 'minuta') {
    const { fundamentos = [], veredicto_recurso, tribunal_recurso, tipoProcesso: tp, parteRecorrente: pr } = body;
    if (!fundamentos.length) {
      return res.status(400).json({ erro: 'Fundamentos em falta para gerar minuta.' });
    }
    const ctx = [
      tribunal_recurso ? `Tribunal de recurso: ${tribunal_recurso}` : null,
      tp               ? `Tipo de processo: ${tp}`                  : null,
      pr               ? `Parte recorrente: ${pr}`                  : null,
    ].filter(Boolean).join('\n');

    const fundamentosTexto = fundamentos.map((f, i) =>
      `${i + 1}. ${f.tipo} (${f.artigo || ''}) — ${f.descricao}\nArgumento: ${f.argumento}`
    ).join('\n\n');

    systemPrompt = `Actua como Advogado Sénior especialista em recursos portugueses. Redige uma proposta de texto TOTALMENTE COMPLETA E INTEGRAL para recurso em português jurídico formal PT-PT.

REGRAS ABSOLUTAS — NUNCA VIOLAR:
1. Texto simples, SEM markdown, SEM #, SEM asteriscos, SEM listas com hífens ou asteriscos
2. NUNCA cortes, resumir ou interrompas o texto em ponto algum — a peça deve estar 100% completa até ao PEDIDO FINAL inclusivé, com assinatura e data
3. Cada fundamento deve ter PELO MENOS 5 parágrafos de argumentação jurídica substancial, densa e desenvolvida
4. Cita doutrina portuguesa relevante (Lebre de Freitas, Abrantes Geraldes, Salvador da Costa, Pais de Amaral, etc.) com referência a obra e página quando possível
5. Cita jurisprudência relevante com número de processo, tribunal e data aproximada quando aplicável
6. Não uses frases como "etc.", "entre outros", "e outros fundamentos" — desenvolve TUDO completamente
7. O texto NUNCA pode terminar antes do PEDIDO FINAL com fecho completo
8. Usa [PLACEHOLDER] apenas para dados que genuinamente não tens (nome, número de processo, data)
9. O texto final deve ter no mínimo 2000 palavras, idealmente 3000-4000 palavras

ESTRUTURA OBRIGATÓRIA COMPLETA (respeita esta ordem e não omitas nenhuma secção):

EXMO. SENHOR [JUIZ / DESEMBARGADOR]
DO [TRIBUNAL]

[NOME DO RECORRENTE], ..., vem interpor o presente RECURSO de apelação da sentença proferida nos autos de [TIPO DE PROCESSO] n.º [NUMERO DO PROCESSO], que correu termos no [TRIBUNAL A QUO], com data de [DATA DA DECISAO], com os seguintes fundamentos:

I. ADMISSIBILIDADE DO RECURSO
(2-3 parágrafos sobre legitimidade, prazo, interesse em agir, referências aos arts. 629.º e ss. CPC ou arts. 399.º e ss. CPP conforme aplicável)

II. FUNDAMENTOS DO RECURSO
(Para cada fundamento: título em maiúsculas, seguido de MÍNIMO 5 parágrafos desenvolvidos com argumentação jurídica, doutrina e jurisprudência)

III. CONCLUSÕES
(Numeradas: 1.ª, 2.ª, 3.ª, etc. — uma conclusão assertiva por cada argumento relevante, em linguagem precisa e directa)

IV. PEDIDO
Termos em que deve o presente recurso ser julgado procedente e, em consequência, ser a decisão recorrida revogada/alterada nos termos pugnados.

[Local e data]
O Mandatário,
[NOME DO ADVOGADO]`;

    userPrompt = `${ctx ? ctx + '\n\n' : ''}FUNDAMENTOS IDENTIFICADOS:\n\n${fundamentosTexto}\n\nRedige a proposta de texto COMPLETA E INTEGRAL para recurso em texto simples, sem markdown. Não cortes nem abrevies em ponto algum. O texto deve estar 100% completo até ao fecho.`;

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
  "humanizador_detectado": false,
  "narrativa": "Análise detalhada aqui.",
  "relator_analise": "Análise do estilo do autor.",
  "marcadores": [
    { "tipo": "ai", "texto": "Descrição do marcador." }
  ]
}

VALORES VÁLIDOS veredicto: IA_DETECTADA, PROVAVELMENTE_IA, INCONCLUSIVO, PROVAVELMENTE_HUMANO, HUMANO
VALORES VÁLIDOS tipo marcador: ai ou humano
Indicadores: 0=humano, 100=IA
humanizador_detectado: true se detectares padrões de ferramentas de humanização (Quillbot, Undetectable.ai, etc.) — texto com estrutura IA mas vocabulário forçadamente variado, sinónimos incomuns, ritmo artificial`;

    userPrompt = `${ctx ? `CONTEXTO:\n${ctx}\n\n` : ''}TEXTO ACADÉMICO:\n\n${textoTruncado}\n\nResponde em JSON puro.`;

  // ══════════════════════════════════════════════════
  // MODO JUDICIAL
  // ══════════════════════════════════════════════════
  } else {
    const ctx = [
      tribunal ? `Tribunal: ${tribunal}` : null,
      relator  ? `Relator: ${relator}`   : null,
    ].filter(Boolean).join('\n');

    // Alertas de formato detectados localmente — injectados no prompt sem custo extra
    const alertasLocais = validacoesLocais.length > 0
      ? `\n\nALERTAS DE FORMATO DETECTADOS AUTOMATICAMENTE (validação local de números de processo PT):\n` +
        validacoesLocais.map(v =>
          `- Processo ${v.numero}: ${v.validacao.problemas.join('; ')}`
        ).join('\n') +
        `\nConsidera estes processos como citações suspeitas de gravidade alta — o seu formato é inválido ou incoerente com as regras da Portaria 280/2013.\n`
      : '';

    systemPrompt = `És um perito forense em análise linguística para detectar autoria de IA em decisões judiciais portuguesas.

RESPONDE APENAS COM JSON PURO. Sem texto antes, sem texto depois, sem markdown, sem backticks.

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
  "humanizador_detectado": false,
  "citacoes_suspeitas": [],
  "narrativa": "Análise detalhada aqui.",
  "relator_analise": "Análise do estilo do relator.",
  "marcadores": [
    { "tipo": "ai", "texto": "Descrição do marcador." }
  ]
}

VALORES VÁLIDOS veredicto: IA_DETECTADA, PROVAVELMENTE_IA, INCONCLUSIVO, PROVAVELMENTE_HUMANO, HUMANO
VALORES VÁLIDOS tipo marcador: ai ou humano
Indicadores: 0=humano, 100=IA

ANÁLISE DE HUMANIZADORES:
humanizador_detectado: true se o texto apresentar sinais de ter passado por uma ferramenta de "humanização" de IA (Quillbot, Undetectable.ai, WordAI, etc.). Sinais típicos: vocabulário artificialmente variado com sinónimos incomuns no registo jurídico português, estrutura IA mas léxico forçado, fluência inconsistente, alternância súbita de registo.

VERIFICAÇÃO DE CITAÇÕES E JURISPRUDÊNCIA:
citacoes_suspeitas: array com citações que apresentem sinais de fabricação ou inconsistência. Para cada citação suspeita:
{
  "citacao": "texto exacto da citação ou referência no documento",
  "tipo": "acordao" | "diploma_legal" | "doutrina" | "jurisprudencia",
  "problema": "descrição do problema detectado",
  "gravidade": "alta" | "media" | "baixa",
  "validacao_formato": "ok" | "formato_invalido" | "nao_aplicavel"
}
Verifica: números de processo com formato inválido para o tribunal indicado, datas impossíveis ou inconsistentes, referências a diplomas revogados como se estivessem em vigor, citações de jurisprudência com elementos internamente contraditórios, doutrina atribuída incorrectamente. Se não detectares citações suspeitas, devolve array vazio [].

NOTAS GERAIS:
- Analisa principalmente o corpo de fundamentação, não as fórmulas jurídicas fixas
- O português jurídico PT tem características formais próprias
- Marcadores típicos de IA: "Neste contexto", "Importa salientar", "É de referir que", parágrafos de comprimento uniforme`;

    userPrompt = `${ctx ? `CONTEXTO:\n${ctx}\n\n` : ''}${alertasLocais}DECISÃO JUDICIAL:\n\n${textoTruncado}\n\nResponde em JSON puro.`;
  }

  // ── CHAMADA ANTHROPIC ──
  // Custo médio por modo (Sonnet 4.6, Maio 2026):
  //   judicial/académico: ~$0.009  (~0.8 cêntimos)
  //   crítica:            ~$0.012  (~1.1 cêntimos)
  //   minuta:             ~$0.048  (~4.4 cêntimos) — 16k output
  try {
    const maxTokens = modo === 'minuta' ? 16000 : 2000;

    const anthropicResponse = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: maxTokens,
        temperature: 0,
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

    // Modo minuta: texto simples, sem parse JSON
    if (modo === 'minuta') {
      return res.status(200).json({ minuta: fullText });
    }

    // ── PARSE JSON ──
    let parsed;
    try {
      const cleaned = fullText
        .replace(/^```json\s*/i, '')
        .replace(/^```\s*/i, '')
        .replace(/\s*```$/i, '')
        .trim();
      parsed = JSON.parse(cleaned);
    } catch {
      const match = fullText.match(/\{[\s\S]*\}/);
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
            console.error('Parse failed. Raw[0-500]:', fullText.substring(0, 500));
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
              };
            } else {
              return res.status(500).json({ erro: 'Erro ao processar resposta. Tente novamente.' });
            }
          }
        }
      } else {
        console.error('No JSON found. Raw[0-500]:', fullText.substring(0, 500));
        return res.status(500).json({ erro: 'Resposta inválida. Tente novamente.' });
      }
    }

    // ── NORMALIZAÇÃO ──
    if (modo === 'critica') {
      const okV = ['RECURSO_VIAVEL', 'RECURSO_PARCIAL', 'RECURSO_INVIAVEL'];
      if (!okV.includes(parsed.veredicto_recurso)) parsed.veredicto_recurso = 'RECURSO_INVIAVEL';
      parsed.confianca        = clamp(parsed.confianca);
      parsed.admissivel       = parsed.admissivel !== false;
      parsed.tribunal_recurso = String(parsed.tribunal_recurso || 'Não determinado');
      parsed.prazo_recurso    = String(parsed.prazo_recurso    || 'Consulte um advogado');
      parsed.sumario          = String(parsed.sumario          || 'Análise concluída.');
      parsed.conclusao        = String(parsed.conclusao        || 'Consulte um advogado.');

      const okCat  = ['nulidade','erro_direito','erro_facto','questao_constitucional'];
      const okGrav = ['grave','moderada','leve'];
      const okDif  = ['facil','media','dificil'];

      const items = Array.isArray(parsed.fundamentos)
        ? parsed.fundamentos
        : Array.isArray(parsed.nulidades)
          ? parsed.nulidades.map((n, i) => ({ ...n, categoria: 'nulidade', prioridade: i + 1, dificuldade: 'media' }))
          : [];

      parsed.fundamentos = items.map((f, i) => ({
        categoria:   okCat.includes(f.categoria)                          ? f.categoria              : 'nulidade',
        tipo:        String(f.tipo       || 'Vício Processual'),
        artigo:      String(f.artigo     || ''),
        gravidade:   okGrav.includes((f.gravidade  ||'').toLowerCase())   ? f.gravidade.toLowerCase() : 'moderada',
        prioridade:  Number(f.prioridade) || (i + 1),
        dificuldade: okDif.includes((f.dificuldade ||'').toLowerCase())   ? f.dificuldade.toLowerCase(): 'media',
        descricao:   String(f.descricao  || ''),
        argumento:   String(f.argumento  || ''),
      }));

      parsed.fundamentos.sort((a, b) => a.prioridade - b.prioridade);
      delete parsed.nulidades;

    } else {
      // Modo judicial ou académico
      const okV = ['IA_DETECTADA','PROVAVELMENTE_IA','INCONCLUSIVO','PROVAVELMENTE_HUMANO','HUMANO'];
      if (!okV.includes(parsed.veredicto)) parsed.veredicto = 'INCONCLUSIVO';
      parsed.confianca = clamp(parsed.confianca);
      if (!parsed.indicadores || typeof parsed.indicadores !== 'object') parsed.indicadores = {};
      ['perplexidade','burstiness','coesao_artificial','uniformidade_sintatica','riqueza_lexical','marcadores_formulaicos']
        .forEach(k => { parsed.indicadores[k] = clamp(parsed.indicadores[k]); });
      parsed.narrativa       = String(parsed.narrativa       || 'Análise concluída.');
      parsed.relator_analise = String(parsed.relator_analise || 'Não indicado.');

      // Humanizador
      parsed.humanizador_detectado = parsed.humanizador_detectado === true;

      // Citações suspeitas — merge IA + validações locais de formato
      if (modo === 'judicial') {
        const okGravCit    = ['alta','media','baixa'];
        const okTipoCit    = ['acordao','diploma_legal','doutrina','jurisprudencia'];
        const okFormatoCit = ['ok','formato_invalido','nao_aplicavel'];

        let citacoesIA = Array.isArray(parsed.citacoes_suspeitas)
          ? parsed.citacoes_suspeitas.slice(0, 6).map(c => ({
              citacao:           String(c.citacao  || ''),
              tipo:              okTipoCit.includes(c.tipo) ? c.tipo : 'jurisprudencia',
              problema:          String(c.problema || ''),
              gravidade:         okGravCit.includes(c.gravidade) ? c.gravidade : 'media',
              validacao_formato: okFormatoCit.includes(c.validacao_formato) ? c.validacao_formato : 'nao_aplicavel',
            }))
          : [];

        // Adicionar detecções locais que não estejam já na lista
        const numerosJaNaLista = new Set(citacoesIA.map(c => c.citacao.toUpperCase()));
        for (const v of validacoesLocais) {
          if (!numerosJaNaLista.has(v.numero)) {
            citacoesIA.push({
              citacao:           v.numero,
              tipo:              'acordao',
              problema:          v.validacao.problemas.join(' '),
              gravidade:         'alta',
              validacao_formato: 'formato_invalido',
            });
          }
        }

        parsed.citacoes_suspeitas = citacoesIA.slice(0, 8);
      }

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
