// /api/analisar.js — LexVeritas API Endpoint
// Vercel Serverless Function — Node.js 18+ — CommonJS
// v2.4 — análise crítica reforçada (10 critérios) + validador formato processos PT + minuta 16k

const SUPABASE_URL      = 'https://bsbgizaftamufmmxeyer.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJzYmdpemFmdGFtdWZtbXhleWVyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc3NDkzNTIsImV4cCI6MjA5MzMyNTM1Mn0._xBiw0VUa3FSnortYseUQPDc5xb--k15lYcylNmMEEQ';

// ══════════════════════════════════════════════════════════════════════════════
// VALIDADOR DE NÚMEROS DE PROCESSO PORTUGUÊS
// Portaria n.º 280/2013, de 26 de Agosto
// ══════════════════════════════════════════════════════════════════════════════

const COMARCA_PARA_RELACAO = {
  'LSB': 'L', 'LRS': 'L', 'SNT': 'L', 'CSC': 'L', 'OER': 'L',
  'VFX': 'L', 'MTS': 'L', 'ALM': 'L', 'SXL': 'L', 'BRR': 'L',
  'PLM': 'L', 'STR': 'L', 'TRS': 'L', 'ABT': 'L', 'TVD': 'L',
  'STC': 'L', 'LRE': 'L',
  'PRT': 'P', 'VNG': 'P', 'MLD': 'P', 'VLP': 'P', 'PVZ': 'P',
  'VCD': 'P', 'STS': 'P', 'TRV': 'P', 'PNF': 'P', 'PRC': 'P',
  'FLG': 'P', 'LUS': 'P', 'ESP': 'P', 'GDM': 'P', 'VRL': 'P',
  'CHV': 'P', 'BGC': 'P', 'MCN': 'P', 'VPA': 'P', 'BRG': 'P',
  'GML': 'G', 'VCT': 'G', 'BCL': 'G',
  'CBR': 'C', 'AVR': 'C', 'VIS': 'C', 'GRD': 'C', 'CTB': 'C',
  'FIG': 'C', 'AGD': 'C', 'OVR': 'C', 'STA': 'C', 'LMG': 'C',
  'LRA': 'C',
  'EVR': 'E', 'BJA': 'E', 'PTG': 'E', 'FAR': 'E', 'LLE': 'E',
  'TVR': 'E', 'OLH': 'E', 'PTA': 'E', 'LAG': 'E', 'SBR': 'E',
  'ALT': 'E',
};

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

function validarNumeroProcesso(numero) {
  const resultado = { valido: false, formato_ok: false, problemas: [], relacao_esperada: null, coerencia_relacao: null };
  if (!numero || typeof numero !== 'string') { resultado.problemas.push('Número ausente.'); return resultado; }
  const s = numero.trim().toUpperCase();
  const RE = /^(\d{1,6})\/(\d{2,4})\.\d[A-Z0-9]{3,8}\.([A-Z])(\d{1,2})(?:-[A-Z0-9]+)*$/;
  const m = RE.exec(s);
  if (!m) {
    if (/^\d{2}[A-Z]\d{3,5}$/.test(s)) { resultado.formato_ok = true; resultado.valido = true; return resultado; }
    resultado.problemas.push(`Formato inválido: "${numero}". Padrão: NNNNN/AA.NTTTTT.XN (ex: 1422/25.0T8GRD.C1).`);
    return resultado;
  }
  resultado.formato_ok = true;
  const [, , anoStr, letraRelacao] = m;
  const anoNum = parseInt(anoStr, 10);
  const anoReal = anoNum < 100 ? (anoNum >= 90 ? 1900 + anoNum : 2000 + anoNum) : anoNum;
  const anoAtual = new Date().getFullYear();
  if (anoReal < 1990) resultado.problemas.push(`Ano ${anoReal} anterior à informatização (1990). Provavelmente fabricado.`);
  if (anoReal > anoAtual) resultado.problemas.push(`Ano ${anoReal} é futuro (actual: ${anoAtual}). Impossível.`);
  if (!LETRAS_RELACAO[letraRelacao]) {
    resultado.problemas.push(`Letra tribunal desconhecida: "${letraRelacao}". Válidas: L, P, C, G, E, S, A, T.`);
  } else {
    resultado.relacao_esperada = LETRAS_RELACAO[letraRelacao];
  }
  const partes = s.split('.');
  if (partes.length >= 2) {
    const mComarca = partes[1].match(/([A-Z]{3})(?:-[A-Z])?$/);
    if (mComarca) {
      const codComarca = mComarca[1];
      const relacaoEsperadaLetra = COMARCA_PARA_RELACAO[codComarca];
      if (relacaoEsperadaLetra && LETRAS_RELACAO[letraRelacao]) {
        if (relacaoEsperadaLetra !== letraRelacao) {
          resultado.problemas.push(`Incoerência: comarca "${codComarca}" pertence à ${LETRAS_RELACAO[relacaoEsperadaLetra]}, mas o número indica ${LETRAS_RELACAO[letraRelacao]}. Possível fabricação.`);
          resultado.coerencia_relacao = false;
        } else { resultado.coerencia_relacao = true; }
      }
    }
  }
  resultado.valido = resultado.problemas.length === 0;
  return resultado;
}

function extrairEValidarProcessos(texto) {
  if (!texto || typeof texto !== 'string') return [];
  const RE_EXTRAI = /\b\d{1,6}\/\d{2,4}\.\d[A-Z0-9]{3,8}\.[A-Z]\d{1,2}(?:-[A-Z0-9]+)*\b/gi;
  const encontrados = [], vistos = new Set();
  let m;
  while ((m = RE_EXTRAI.exec(texto)) !== null) {
    const num = m[0].toUpperCase();
    if (!vistos.has(num)) {
      vistos.add(num);
      const r = validarNumeroProcesso(num);
      if (!r.valido || r.problemas.length > 0) encontrados.push({ numero: num, validacao: r });
    }
  }
  return encontrados;
}

// ── MAPA DE TRIBUNAIS DE RECURSO (Dec.-Lei n.º 49/2014) ──
const MAPA_RELACOES = `
TRIBUNAIS DE RECURSO SEGUNDO O DECRETO-LEI N.º 49/2014, DE 27 DE MARÇO:

Tribunal da Relação de Lisboa:
  - Comarca de Lisboa, Lisboa Norte, Lisboa Oeste, Setúbal, Santarém, Leiria

Tribunal da Relação de Coimbra:
  - Comarca de Coimbra, Aveiro, Viseu, Guarda ← IMPORTANTE, Castelo Branco, Leiria (penal)

Tribunal da Relação do Porto:
  - Comarca do Porto, Porto Este, Braga, Viana do Castelo, Vila Real, Bragança

Tribunal da Relação de Guimarães:
  - Parte da Comarca de Braga (Guimarães). NÃO é relação autónoma para todos os processos de Braga.

Tribunal da Relação de Évora:
  - Comarca de Évora, Beja, Portalegre, Faro

NOTA CRÍTICA: A Comarca da Guarda recorre SEMPRE para Coimbra, NUNCA para Guimarães.
`;

// ── CRITÉRIOS COMPLETOS DE ANÁLISE CRÍTICA ──
const CRITERIOS_CRITICA = `
CRITÉRIOS DE ANÁLISE OBRIGATÓRIOS (aplica TODOS ao texto):

═══════════════════════════════════════════════
CRITÉRIO 1 — VÍCIOS FORMAIS DA SENTENÇA (Art. 615.º CPC / Art. 379.º CPP)
═══════════════════════════════════════════════
Verifica cada causa de nulidade:
- 615.º/1/a) CPC: falta de assinatura do juiz
- 615.º/1/b) CPC: falta de fundamentação de facto e de direito
- 615.º/1/c) CPC: oposição entre os fundamentos e a decisão (contradição)
- 615.º/1/d) CPC: omissão de pronúncia sobre questões que devia conhecer
- 615.º/1/d) CPC: excesso de pronúncia sobre questões que não devia conhecer
- 615.º/1/e) CPC: condenação em quantidade superior ou objecto diverso do pedido
- 379.º/1/a) CPP: não contiver as menções do art. 374.º (processo penal)
- 379.º/1/b) CPP: condenar por factos diversos dos da acusação
- 379.º/1/c) CPP: omissão de pronúncia (processo penal)

DISTINÇÃO CRÍTICA — determina o tipo de pedido:
→ Vícios formais (615.º/379.º) = NULIDADE da sentença → pedido: "declare nula a sentença e ordene a sua substituição"
→ Erros de julgamento (direito/facto) = REVOGAÇÃO → pedido: "revogue a sentença e substitua por outra"
Nunca confundir os dois — é erro técnico grave.

═══════════════════════════════════════════════
CRITÉRIO 2 — ERROS DE JULGAMENTO DE DIREITO
═══════════════════════════════════════════════
- Interpretação errada de norma legal (errada subsunção dos factos ao direito)
- Aplicação de norma revogada ou inaplicável ao caso
- Violação de norma imperativa
- Erro na determinação da norma aplicável
- Violação de jurisprudência uniformizada (art. 686.º CPC)

═══════════════════════════════════════════════
CRITÉRIO 3 — ERROS DE JULGAMENTO DE FACTO (Art. 662.º CPC / Art. 410.º CPP)
═══════════════════════════════════════════════
Cível (art. 662.º CPC):
- Erro na apreciação das provas — a Relação pode modificar a matéria de facto
- ATENÇÃO: o recorrente tem ónus de especificação do art. 640.º CPC:
  * Indicar os concretos pontos de facto incorrectamente julgados
  * Indicar os meios de prova que impõem decisão diferente
  * Indicar a decisão que deve ser proferida sobre cada facto
  * Se a prova foi gravada: indicar as passagens relevantes (início/fim)
  * Incumprimento = rejeição imediata do recurso — verificar se a decisão recorrida regista esta falha

Penal (art. 410.º/2 CPP) — vícios do acórdão:
- 410.º/2/a): insuficiência da matéria de facto para a decisão
- 410.º/2/b): contradição insanável na fundamentação ou entre fundamentação e decisão
- 410.º/2/c): erro notório na apreciação da prova

═══════════════════════════════════════════════
CRITÉRIO 4 — QUESTÕES CONSTITUCIONAIS
═══════════════════════════════════════════════
- Art. 20.º CRP: acesso ao direito e tutela jurisdicional efectiva
- Art. 32.º CRP: garantias do processo criminal (presunção de inocência, contraditório, defesa)
- Art. 205.º CRP: fundamentação obrigatória das decisões judiciais
- Art. 13.º CRP: princípio da igualdade (tratamento desigual de situações iguais)
- Art. 18.º CRP: proporcionalidade na restrição de direitos fundamentais
- Art. 268.º/4 CRP (processo administrativo): fundamentação dos actos

═══════════════════════════════════════════════
CRITÉRIO 5 — ADMISSIBILIDADE E VALOR DE ALÇADA (Art. 629.º CPC)
═══════════════════════════════════════════════
Verifica se o recurso é admissível considerando:
- Alçada do tribunal de comarca: €5.000 — recurso de apelação só admissível se valor > €5.000
- Alçada da Relação: €30.000 — recurso de revista para STJ só admissível se valor > €30.000
- Se o valor da causa constar do texto, verifica a admissibilidade
- Excepções: sempre admissível em matéria penal, estado civil das pessoas, certas matérias de família
- Dupla conforme (art. 671.º/3 CPC): se a Relação confirmou a 1.ª instância, recurso de revista é geralmente inadmissível
  salvo: questão de grande relevância jurídica, contradição com jurisprudência do STJ, ou voto de vencido

═══════════════════════════════════════════════
CRITÉRIO 6 — PRAZOS (verificar com a data da decisão se disponível)
═══════════════════════════════════════════════
Prazos de interposição (contam da notificação):
- Apelação cível: 30 dias (art. 638.º/1 CPC)
- Apelação urgente: 15 dias
- Revista para STJ: 30 dias (art. 671.º CPC)
- Recurso penal (arguido): 30 dias (art. 411.º CPP)
- Recurso penal (MP): 30 dias
- Recurso administrativo: 30 dias (art. 144.º CPTA)
- Reclamação: 10 dias
Se a data da decisão constar do texto, calcula se o prazo já expirou.
Se não constar, indica apenas o prazo aplicável.

═══════════════════════════════════════════════
CRITÉRIO 7 — MATÉRIA DE FACTO vs. MATÉRIA DE DIREITO (para STJ)
═══════════════════════════════════════════════
O STJ só conhece matéria de direito (art. 674.º/3 CPC).
Se o texto for de um acórdão de Relação:
- Identifica se os fundamentos são de facto (ficam precludidos no STJ) ou de direito
- Erros de facto da Relação: apenas sindicáveis no STJ em casos muito restritos (art. 674.º/3 in fine)
- Identifica se há fundamentos puros de direito que justifiquem revista

═══════════════════════════════════════════════
CRITÉRIO 8 — QUESTÕES DE CONHECIMENTO OFICIOSO
═══════════════════════════════════════════════
Algumas nulidades/excepções podem ser arguidas a qualquer momento sem necessidade de arguição prévia:
- Incompetência absoluta do tribunal (art. 97.º CPC) — conhecimento oficioso
- Falta de personalidade judiciária (art. 11.º CPC)
- Ilegitimidade processual (art. 30.º CPC) — em certos casos
- Caso julgado (art. 577.º/i CPC) — excepção dilatória
- Litispendência (art. 577.º/i CPC)
- Nulidades absolutas em processo penal (art. 119.º CPP) — conhecimento oficioso em qualquer fase
Se identificares alguma destas situações no texto, assinala — podem ser arguidas mesmo que não o tenham sido anteriormente.

═══════════════════════════════════════════════
CRITÉRIO 9 — VIOLAÇÃO DO PRINCÍPIO DO CONTRADITÓRIO (Art. 3.º/3 CPC)
═══════════════════════════════════════════════
Verifica se o tribunal:
- Decidiu com base em questão (de facto ou de direito) que não foi previamente submetida ao contraditório das partes
- Usou fundamento de conhecimento oficioso sem ouvir as partes (art. 3.º/3 CPC)
- Proferiu decisão surpresa — jurisprudência do TEDH e do TC reconhece este fundamento
- Em processo penal: se o arguido não foi ouvido sobre factos ou qualificações relevantes
Esta é causa de nulidade autónoma da sentença, independente do art. 615.º.

═══════════════════════════════════════════════
CRITÉRIO 10 — PROPORCIONALIDADE E ADEQUAÇÃO DA PENA (processo penal)
═══════════════════════════════════════════════
Aplica APENAS em processo penal:
- Art. 40.º CP: finalidades das penas (prevenção geral e especial, não pode exceder culpa)
- Art. 71.º CP: determinação da medida da pena (critérios que o tribunal deve ponderar)
- Art. 72.º CP: atenuação especial (circunstâncias diminuem acentuadamente ilicitude ou culpa)
- Art. 74.º CP: dispensa de pena (ilicitude e culpa mínimas)
- Verifica se o tribunal fundamentou adequadamente a escolha e medida da pena
- Falta de fundamentação da pena = nulidade por violação do art. 205.º CRP e art. 71.º/3 CP
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
  // MODO CRÍTICA — 10 critérios completos
  // ══════════════════════════════════════════════════
  if (modo === 'critica') {
    const ctx = [
      tribunal        ? `Tribunal de 1.ª Instância: ${tribunal}`  : null,
      tipoProcesso    ? `Tipo de processo: ${tipoProcesso}`        : null,
      parteRecorrente ? `Parte recorrente: ${parteRecorrente}`     : null,
    ].filter(Boolean).join('\n');

    systemPrompt = `Actua como Consultor Jurídico Sénior especialista em recursos portugueses com 20 anos de experiência. Responde APENAS com JSON puro, sem backticks, sem texto antes ou depois.

${MAPA_RELACOES}

${CRITERIOS_CRITICA}

REGRA CRÍTICA PARA tribunal_recurso: usa RIGOROSAMENTE o mapa acima. Comarca da Guarda → SEMPRE Coimbra, NUNCA Guimarães.

Estrutura JSON obrigatória:

{
  "veredicto_recurso": "RECURSO_VIAVEL",
  "confianca": 80,
  "admissivel": true,
  "alçada_ok": true,
  "dupla_conforme": false,
  "tipo_pedido": "revogacao",
  "tribunal_recurso": "Tribunal da Relação de Coimbra",
  "prazo_recurso": "30 dias a contar da notificação (art. 638.º/1 CPC)",
  "prazo_expirado": false,
  "sumario": "Resumo executivo em 2-3 frases.",
  "fundamentos": [
    {
      "categoria": "nulidade",
      "criterio": 1,
      "tipo": "Nome preciso do vício",
      "artigo": "Art. 615.º/1/d) CPC",
      "gravidade": "grave",
      "prioridade": 1,
      "dificuldade": "facil",
      "conhecimento_oficioso": false,
      "descricao": "Descrição objectiva e fundamentada do vício identificado no texto.",
      "argumento": "Argumento jurídico completo para incluir na peça processual."
    }
  ],
  "alerta_contraditorio": "",
  "alerta_alcada": "",
  "alerta_dupla_conforme": "",
  "alerta_facto_vs_direito": "",
  "alerta_proporcionalidade_pena": "",
  "conclusao": "Recomendação estratégica completa incluindo tipo de pedido (nulidade vs. revogação) e prioridade dos fundamentos."
}

VALORES OBRIGATÓRIOS:
- veredicto_recurso: RECURSO_VIAVEL, RECURSO_PARCIAL ou RECURSO_INVIAVEL
- categoria: nulidade, erro_direito, erro_facto ou questao_constitucional
- criterio: número de 1 a 10 indicando qual dos critérios originou o fundamento
- gravidade: grave, moderada ou leve
- dificuldade: facil, media ou dificil
- tipo_pedido: "nulidade" (vícios 615.º/379.º) ou "revogacao" (erros julgamento) ou "misto"
- alçada_ok: true se o valor da causa (se mencionado) supera a alçada; null se valor não identificado
- dupla_conforme: true se a decisão confirma outra anterior (restringe acesso ao STJ)
- prazo_expirado: true/false/null (null se data não identificada)
- conhecimento_oficioso: true se o fundamento pode ser arguido mesmo sem ter sido arguido anteriormente
- alertas: string com aviso relevante ou "" se não aplicável

REGRAS DE PRIORIDADE:
1. Vícios formais do art. 615.º/379.º têm sempre prioridade — são mais fáceis de provar
2. Questões de conhecimento oficioso vêm a seguir — não exigem arguição prévia
3. Erros de direito antes de erros de facto
4. Máximo 6 fundamentos, por ordem de prioridade estratégica
5. NUNCA devolvas fundamentos vazios se existirem vícios identificáveis
6. Se o processo for penal, analisa SEMPRE o critério 10 (proporcionalidade da pena)`;

    userPrompt = `${ctx ? `CONTEXTO DO PROCESSO:\n${ctx}\n\n` : ''}DECISÃO JUDICIAL A ANALISAR:\n\n${textoTruncado}\n\nAplica TODOS os 10 critérios de análise. Responde em JSON puro.`;

  // ══════════════════════════════════════════════════
  // MODO MINUTA — max_tokens 16000, texto COMPLETO
  // ══════════════════════════════════════════════════
  } else if (modo === 'minuta') {
    const { fundamentos = [], veredicto_recurso, tribunal_recurso, tipo_pedido, tipoProcesso: tp, parteRecorrente: pr } = body;
    if (!fundamentos.length) {
      return res.status(400).json({ erro: 'Fundamentos em falta para gerar minuta.' });
    }
    const ctx = [
      tribunal_recurso ? `Tribunal de recurso: ${tribunal_recurso}` : null,
      tp               ? `Tipo de processo: ${tp}`                  : null,
      pr               ? `Parte recorrente: ${pr}`                  : null,
      tipo_pedido      ? `Tipo de pedido: ${tipo_pedido}`           : null,
    ].filter(Boolean).join('\n');

    const fundamentosTexto = fundamentos.map((f, i) =>
      `${i + 1}. [Critério ${f.criterio || '?'}] ${f.tipo} (${f.artigo || ''}) — ${f.descricao}\nArgumento: ${f.argumento}${f.conhecimento_oficioso ? '\nNota: pode ser arguido oficiosamente mesmo sem arguição prévia.' : ''}`
    ).join('\n\n');

    // Tipo de pedido afecta a formulação da conclusão e do pedido final
    const instrucaoPedido = tipo_pedido === 'nulidade'
      ? 'O pedido final deve ser de NULIDADE da sentença e substituição por outra: "Termos em que deve a sentença recorrida ser declarada nula, ordenando-se a sua substituição por outra que..."'
      : tipo_pedido === 'misto'
      ? 'Há fundamentos de nulidade e de revogação — estrutura o pedido em duas alíneas: a) declaração de nulidade quanto aos vícios formais; b) revogação e substituição quanto aos erros de julgamento.'
      : 'O pedido final deve ser de REVOGAÇÃO da sentença e substituição: "Termos em que deve a sentença recorrida ser revogada e substituída por outra que..."';

    systemPrompt = `Actua como Advogado Sénior especialista em recursos portugueses. Redige uma proposta de texto TOTALMENTE COMPLETA E INTEGRAL para recurso em português jurídico formal PT-PT.

REGRAS ABSOLUTAS — NUNCA VIOLAR:
1. Texto simples, SEM markdown, SEM #, SEM asteriscos, SEM listas com hífens ou asteriscos
2. NUNCA cortes, resumir ou interrompas — a peça deve estar 100% completa até ao PEDIDO FINAL com assinatura e data
3. Cada fundamento deve ter PELO MENOS 5 parágrafos de argumentação jurídica substancial e desenvolvida
4. Cita doutrina portuguesa relevante (Lebre de Freitas, Abrantes Geraldes, Salvador da Costa, Pais de Amaral, Cavaleiro de Ferreira, Figueiredo Dias, etc.) com referência a obra e página quando possível
5. Cita jurisprudência relevante com número de processo, tribunal e data quando aplicável
6. Não uses frases como "etc.", "entre outros" — desenvolve TUDO completamente
7. O texto NUNCA pode terminar antes do PEDIDO FINAL com fecho completo
8. Usa [PLACEHOLDER] para dados desconhecidos (nome, número de processo, data)
9. Mínimo 2500 palavras, idealmente 3500-5000 palavras
10. ${instrucaoPedido}

ESTRUTURA OBRIGATÓRIA COMPLETA:

EXMO. SENHOR [JUIZ / DESEMBARGADOR / CONSELHEIRO]
DO [TRIBUNAL]

[NOME DO RECORRENTE], ..., vem, nos termos dos arts. [629.º e ss. / 399.º e ss.] do [CPC/CPP], interpor o presente RECURSO DE APELAÇÃO [ou REVISTA ou PENAL] da sentença proferida nos autos de [TIPO DE PROCESSO] n.º [NUMERO DO PROCESSO], que correu termos no [TRIBUNAL A QUO], com data de [DATA DA DECISAO], com os seguintes fundamentos:

I. ADMISSIBILIDADE DO RECURSO
(3 parágrafos: legitimidade activa, tempestividade, interesse em agir, valor de alçada se aplicável)

II. FUNDAMENTOS DO RECURSO
(Para cada fundamento: TÍTULO EM MAIÚSCULAS indicando o artigo violado, seguido de MÍNIMO 5 parágrafos com argumentação densa, doutrina e jurisprudência. Se houver fundamentos de nulidade e de revogação, separa-os em subsecções IIA e IIB.)

III. CONCLUSÕES
(Numeradas: 1.ª, 2.ª, 3.ª, etc. — uma conclusão por argumento, em linguagem precisa e assertiva)

IV. PEDIDO
${instrucaoPedido}

[Local, data]
O Mandatário / A Mandatária,
[NOME DO ADVOGADO / ADVOGADA]`;

    userPrompt = `${ctx ? ctx + '\n\n' : ''}FUNDAMENTOS IDENTIFICADOS:\n\n${fundamentosTexto}\n\nRedige a proposta COMPLETA E INTEGRAL em texto simples, sem markdown. Não cortes nem abrevies. 100% completo até ao fecho.`;

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
humanizador_detectado: true se detectares padrões de ferramentas de humanização (Quillbot, Undetectable.ai, etc.)`;

    userPrompt = `${ctx ? `CONTEXTO:\n${ctx}\n\n` : ''}TEXTO ACADÉMICO:\n\n${textoTruncado}\n\nResponde em JSON puro.`;

  // ══════════════════════════════════════════════════
  // MODO JUDICIAL
  // ══════════════════════════════════════════════════
  } else {
    const ctx = [
      tribunal ? `Tribunal: ${tribunal}` : null,
      relator  ? `Relator: ${relator}`   : null,
    ].filter(Boolean).join('\n');

    const alertasLocais = validacoesLocais.length > 0
      ? `\n\nALERTAS DE FORMATO DETECTADOS AUTOMATICAMENTE (validação local Portaria 280/2013):\n` +
        validacoesLocais.map(v => `- Processo ${v.numero}: ${v.validacao.problemas.join('; ')}`).join('\n') +
        `\nConsidera estes processos citações suspeitas de gravidade alta.\n`
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
humanizador_detectado: true se sinais de Quillbot, Undetectable.ai, WordAI, etc.

VERIFICAÇÃO DE CITAÇÕES:
citacoes_suspeitas: array com:
{
  "citacao": "texto exacto",
  "tipo": "acordao" | "diploma_legal" | "doutrina" | "jurisprudencia",
  "problema": "descrição",
  "gravidade": "alta" | "media" | "baixa",
  "validacao_formato": "ok" | "formato_invalido" | "nao_aplicavel"
}
Array vazio [] se nada suspeito.

NOTAS: analisa o corpo de fundamentação, não fórmulas fixas. Marcadores IA: "Neste contexto", "Importa salientar", "É de referir que", parágrafos de comprimento uniforme.`;

    userPrompt = `${ctx ? `CONTEXTO:\n${ctx}\n\n` : ''}${alertasLocais}DECISÃO JUDICIAL:\n\n${textoTruncado}\n\nResponde em JSON puro.`;
  }

  // ── CHAMADA ANTHROPIC ──
  // Custo médio por modo (Sonnet 4.6, Maio 2026):
  //   judicial/académico: ~$0.009  (~0.8 cêntimos)
  //   crítica:            ~$0.018  (~1.6 cêntimos) — prompt maior (10 critérios)
  //   minuta:             ~$0.048  (~4.4 cêntimos) — 16k output
  try {
    const maxTokens = modo === 'minuta' ? 16000 : modo === 'critica' ? 3000 : 2000;

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

    if (!fullText) return res.status(500).json({ erro: 'Resposta vazia. Tente novamente.' });

    if (modo === 'minuta') return res.status(200).json({ minuta: fullText });

    // ── PARSE JSON ──
    let parsed;
    try {
      const cleaned = fullText.replace(/^```json\s*/i,'').replace(/^```\s*/i,'').replace(/\s*```$/i,'').trim();
      parsed = JSON.parse(cleaned);
    } catch {
      const match = fullText.match(/\{[\s\S]*\}/);
      if (match) {
        try { parsed = JSON.parse(match[0]); }
        catch {
          let jsonStr = match[0];
          jsonStr = jsonStr.replace(/,\s*$/,'').replace(/,\s*\}$/,'}').replace(/,\s*\]$/,']');
          let depth = 0;
          for (const c of jsonStr) { if (c==='{' || c==='[') depth++; if (c==='}' || c===']') depth--; }
          if (depth > 0) for (let i = 0; i < depth; i++) jsonStr += '}';
          try { parsed = JSON.parse(jsonStr); }
          catch {
            console.error('Parse failed. Raw[0-500]:', fullText.substring(0,500));
            if (modo === 'critica') {
              parsed = {
                veredicto_recurso: 'RECURSO_INVIAVEL', confianca: 50, admissivel: true,
                alçada_ok: null, dupla_conforme: false, tipo_pedido: 'revogacao',
                tribunal_recurso: 'Não determinado', prazo_recurso: 'Consulte um advogado',
                prazo_expirado: null, sumario: 'Análise incompleta. Tente novamente.',
                fundamentos: [], alerta_contraditorio: '', alerta_alcada: '',
                alerta_dupla_conforme: '', alerta_facto_vs_direito: '',
                alerta_proporcionalidade_pena: '', conclusao: 'Não foi possível concluir.',
              };
            } else {
              return res.status(500).json({ erro: 'Erro ao processar resposta. Tente novamente.' });
            }
          }
        }
      } else {
        console.error('No JSON found. Raw[0-500]:', fullText.substring(0,500));
        return res.status(500).json({ erro: 'Resposta inválida. Tente novamente.' });
      }
    }

    // ── NORMALIZAÇÃO ──
    if (modo === 'critica') {
      const okV    = ['RECURSO_VIAVEL','RECURSO_PARCIAL','RECURSO_INVIAVEL'];
      const okCat  = ['nulidade','erro_direito','erro_facto','questao_constitucional'];
      const okGrav = ['grave','moderada','leve'];
      const okDif  = ['facil','media','dificil'];
      const okPed  = ['nulidade','revogacao','misto'];

      if (!okV.includes(parsed.veredicto_recurso)) parsed.veredicto_recurso = 'RECURSO_INVIAVEL';
      parsed.confianca            = clamp(parsed.confianca);
      parsed.admissivel           = parsed.admissivel !== false;
      parsed.alçada_ok            = parsed.alçada_ok === null ? null : parsed.alçada_ok !== false;
      parsed.dupla_conforme       = parsed.dupla_conforme === true;
      parsed.tipo_pedido          = okPed.includes(parsed.tipo_pedido) ? parsed.tipo_pedido : 'revogacao';
      parsed.tribunal_recurso     = String(parsed.tribunal_recurso     || 'Não determinado');
      parsed.prazo_recurso        = String(parsed.prazo_recurso        || 'Consulte um advogado');
      parsed.prazo_expirado       = parsed.prazo_expirado === true ? true : parsed.prazo_expirado === false ? false : null;
      parsed.sumario              = String(parsed.sumario              || 'Análise concluída.');
      parsed.conclusao            = String(parsed.conclusao            || 'Consulte um advogado.');
      parsed.alerta_contraditorio       = String(parsed.alerta_contraditorio       || '');
      parsed.alerta_alcada              = String(parsed.alerta_alcada              || '');
      parsed.alerta_dupla_conforme      = String(parsed.alerta_dupla_conforme      || '');
      parsed.alerta_facto_vs_direito    = String(parsed.alerta_facto_vs_direito    || '');
      parsed.alerta_proporcionalidade_pena = String(parsed.alerta_proporcionalidade_pena || '');

      const items = Array.isArray(parsed.fundamentos)
        ? parsed.fundamentos
        : Array.isArray(parsed.nulidades)
          ? parsed.nulidades.map((n, i) => ({ ...n, categoria: 'nulidade', criterio: 1, prioridade: i + 1, dificuldade: 'media' }))
          : [];

      parsed.fundamentos = items.map((f, i) => ({
        categoria:           okCat.includes(f.categoria)                        ? f.categoria              : 'nulidade',
        criterio:            Number(f.criterio) || 1,
        tipo:                String(f.tipo        || 'Vício Processual'),
        artigo:              String(f.artigo       || ''),
        gravidade:           okGrav.includes((f.gravidade   ||'').toLowerCase()) ? f.gravidade.toLowerCase()  : 'moderada',
        prioridade:          Number(f.prioridade)  || (i + 1),
        dificuldade:         okDif.includes((f.dificuldade  ||'').toLowerCase()) ? f.dificuldade.toLowerCase() : 'media',
        conhecimento_oficioso: f.conhecimento_oficioso === true,
        descricao:           String(f.descricao    || ''),
        argumento:           String(f.argumento    || ''),
      }));

      parsed.fundamentos.sort((a, b) => a.prioridade - b.prioridade);
      delete parsed.nulidades;

    } else {
      // Judicial ou académico
      const okV = ['IA_DETECTADA','PROVAVELMENTE_IA','INCONCLUSIVO','PROVAVELMENTE_HUMANO','HUMANO'];
      if (!okV.includes(parsed.veredicto)) parsed.veredicto = 'INCONCLUSIVO';
      parsed.confianca = clamp(parsed.confianca);
      if (!parsed.indicadores || typeof parsed.indicadores !== 'object') parsed.indicadores = {};
      ['perplexidade','burstiness','coesao_artificial','uniformidade_sintatica','riqueza_lexical','marcadores_formulaicos']
        .forEach(k => { parsed.indicadores[k] = clamp(parsed.indicadores[k]); });
      parsed.narrativa              = String(parsed.narrativa       || 'Análise concluída.');
      parsed.relator_analise        = String(parsed.relator_analise || 'Não indicado.');
      parsed.humanizador_detectado  = parsed.humanizador_detectado === true;

      if (modo === 'judicial') {
        const okGravCit    = ['alta','media','baixa'];
        const okTipoCit    = ['acordao','diploma_legal','doutrina','jurisprudencia'];
        const okFormatoCit = ['ok','formato_invalido','nao_aplicavel'];

        let citacoesIA = Array.isArray(parsed.citacoes_suspeitas)
          ? parsed.citacoes_suspeitas.slice(0, 6).map(c => ({
              citacao:           String(c.citacao  || ''),
              tipo:              okTipoCit.includes(c.tipo)            ? c.tipo            : 'jurisprudencia',
              problema:          String(c.problema || ''),
              gravidade:         okGravCit.includes(c.gravidade)       ? c.gravidade       : 'media',
              validacao_formato: okFormatoCit.includes(c.validacao_formato) ? c.validacao_formato : 'nao_aplicavel',
            }))
          : [];

        const numerosJaNaLista = new Set(citacoesIA.map(c => c.citacao.toUpperCase()));
        for (const v of validacoesLocais) {
          if (!numerosJaNaLista.has(v.numero)) {
            citacoesIA.push({
              citacao: v.numero, tipo: 'acordao',
              problema: v.validacao.problemas.join(' '),
              gravidade: 'alta', validacao_formato: 'formato_invalido',
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
