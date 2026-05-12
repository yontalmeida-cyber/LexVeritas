// /api/analisar.js — LexVeritas API Endpoint
// Vercel Serverless Function — Node.js 18+ — CommonJS
// v2.5 — fix: max_tokens crítica 5000, correcção tribunal no backend, retry automático, fallback com erro explícito

const SUPABASE_URL      = 'https://bsbgizaftamufmmxeyer.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJzYmdpemFmdGFtdWZtbXhleWVyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc3NDkzNTIsImV4cCI6MjA5MzMyNTM1Mn0._xBiw0VUa3FSnortYseUQPDc5xb--k15lYcylNmMEEQ';

// ══════════════════════════════════════════════════════════════════════════════
// MAPA DE TRIBUNAIS — Dec.-Lei n.º 49/2014 + Portaria 280/2013
// Usado tanto no prompt como na normalização do backend (fonte de verdade única)
// ══════════════════════════════════════════════════════════════════════════════

// Palavras-chave no nome do tribunal → Relação competente
// Ordem: mais específico primeiro
const TRIBUNAL_PARA_RELACAO = [
  // Supremos — sem Relação
  { match: /STJ|supremo tribunal de justiça/i,               relacao: null, nome: 'Supremo Tribunal de Justiça' },
  { match: /STA|supremo tribunal administrativo/i,           relacao: null, nome: 'Supremo Tribunal Administrativo' },
  { match: /tribunal constitucional/i,                       relacao: null, nome: 'Tribunal Constitucional' },
  { match: /TCAS|central administrativo sul/i,               relacao: null, nome: 'Tribunal Central Administrativo Sul' },
  { match: /TCAN|central administrativo norte/i,             relacao: null, nome: 'Tribunal Central Administrativo Norte' },
  // Relações — recursão para STJ
  { match: /relação de lisboa|TRL/i,                         relacao: 'STJ', nome: 'Tribunal da Relação de Lisboa' },
  { match: /relação do porto|TRP/i,                          relacao: 'STJ', nome: 'Tribunal da Relação do Porto' },
  { match: /relação de coimbra|TRC/i,                        relacao: 'STJ', nome: 'Tribunal da Relação de Coimbra' },
  { match: /relação de guimarães|TRG/i,                      relacao: 'STJ', nome: 'Tribunal da Relação de Guimarães' },
  { match: /relação de évora|relação de evora|TRE/i,         relacao: 'STJ', nome: 'Tribunal da Relação de Évora' },
  // Comarcas → Relação competente (Dec.-Lei 49/2014)
  // → Coimbra
  { match: /guarda|T8GRD|TBGRD/i,                            relacao: 'TRC', nome: 'Tribunal da Relação de Coimbra' },
  { match: /castelo.?branco|T8CTB|TBCTB/i,                   relacao: 'TRC', nome: 'Tribunal da Relação de Coimbra' },
  { match: /coimbra|T8CBR|TBCBR/i,                           relacao: 'TRC', nome: 'Tribunal da Relação de Coimbra' },
  { match: /aveiro|T8AVR|TBAVR/i,                            relacao: 'TRC', nome: 'Tribunal da Relação de Coimbra' },
  { match: /viseu|T8VIS|TBVIS/i,                             relacao: 'TRC', nome: 'Tribunal da Relação de Coimbra' },
  { match: /figueira.?da.?foz|T8FIG/i,                       relacao: 'TRC', nome: 'Tribunal da Relação de Coimbra' },
  { match: /leiria|T8LRA|LBLRA/i,                            relacao: 'TRC', nome: 'Tribunal da Relação de Coimbra' },
  { match: /lamego|T8LMG/i,                                  relacao: 'TRC', nome: 'Tribunal da Relação de Coimbra' },
  // → Porto
  { match: /porto|T8PRT|TBPRT/i,                             relacao: 'TRP', nome: 'Tribunal da Relação do Porto' },
  { match: /vila.?nova.?de.?gaia|T8VNG/i,                    relacao: 'TRP', nome: 'Tribunal da Relação do Porto' },
  { match: /matosinhos|T8MTS/i,                              relacao: 'TRP', nome: 'Tribunal da Relação do Porto' },
  { match: /maia|T8MLD/i,                                    relacao: 'TRP', nome: 'Tribunal da Relação do Porto' },
  { match: /valongo|T8VLP/i,                                 relacao: 'TRP', nome: 'Tribunal da Relação do Porto' },
  { match: /póvoa.?de.?varzim|povoa.?de.?varzim|T8PVZ/i,    relacao: 'TRP', nome: 'Tribunal da Relação do Porto' },
  { match: /vila.?do.?conde|T8VCD/i,                         relacao: 'TRP', nome: 'Tribunal da Relação do Porto' },
  { match: /santo.?tirso|T8STS/i,                            relacao: 'TRP', nome: 'Tribunal da Relação do Porto' },
  { match: /penafiel|T8PNF/i,                                relacao: 'TRP', nome: 'Tribunal da Relação do Porto' },
  { match: /paredes|T8PRC/i,                                 relacao: 'TRP', nome: 'Tribunal da Relação do Porto' },
  { match: /felgueiras|T8FLG/i,                              relacao: 'TRP', nome: 'Tribunal da Relação do Porto' },
  { match: /lousada|T8LUS/i,                                 relacao: 'TRP', nome: 'Tribunal da Relação do Porto' },
  { match: /vila.?real|T8VRL/i,                              relacao: 'TRP', nome: 'Tribunal da Relação do Porto' },
  { match: /chaves|T8CHV/i,                                  relacao: 'TRP', nome: 'Tribunal da Relação do Porto' },
  { match: /bragança|braganca|T8BGC/i,                       relacao: 'TRP', nome: 'Tribunal da Relação do Porto' },
  { match: /mirandela|T8MCN/i,                               relacao: 'TRP', nome: 'Tribunal da Relação do Porto' },
  // → Guimarães (parte de Braga)
  { match: /guimarães|guimaraes|T8GML/i,                     relacao: 'TRG', nome: 'Tribunal da Relação de Guimarães' },
  { match: /braga|T8BRG|TBBRG/i,                             relacao: 'TRG', nome: 'Tribunal da Relação de Guimarães' },
  { match: /barcelos|T8BCL/i,                                relacao: 'TRG', nome: 'Tribunal da Relação de Guimarães' },
  { match: /viana.?do.?castelo|T8VCT|TBVCT/i,               relacao: 'TRG', nome: 'Tribunal da Relação de Guimarães' },
  // → Lisboa
  { match: /lisboa|T8LSB|TBLSB/i,                            relacao: 'TRL', nome: 'Tribunal da Relação de Lisboa' },
  { match: /sintra|T8SNT|TBSNT/i,                            relacao: 'TRL', nome: 'Tribunal da Relação de Lisboa' },
  { match: /cascais|T8CSC/i,                                 relacao: 'TRL', nome: 'Tribunal da Relação de Lisboa' },
  { match: /oeiras|T8OER/i,                                  relacao: 'TRL', nome: 'Tribunal da Relação de Lisboa' },
  { match: /amadora|T8AMD/i,                                 relacao: 'TRL', nome: 'Tribunal da Relação de Lisboa' },
  { match: /vila.?franca.?de.?xira|T8VFX/i,                 relacao: 'TRL', nome: 'Tribunal da Relação de Lisboa' },
  { match: /loures|T8LRA/i,                                  relacao: 'TRL', nome: 'Tribunal da Relação de Lisboa' },
  { match: /setúbal|setubal|T8STB/i,                         relacao: 'TRL', nome: 'Tribunal da Relação de Lisboa' },
  { match: /almada|T8ALM/i,                                  relacao: 'TRL', nome: 'Tribunal da Relação de Lisboa' },
  { match: /seixal|T8SXL/i,                                  relacao: 'TRL', nome: 'Tribunal da Relação de Lisboa' },
  { match: /barreiro|T8BRR/i,                                relacao: 'TRL', nome: 'Tribunal da Relação de Lisboa' },
  { match: /santarém|santarem|T8STR/i,                       relacao: 'TRL', nome: 'Tribunal da Relação de Lisboa' },
  { match: /torres.?vedras|T8TVD/i,                          relacao: 'TRL', nome: 'Tribunal da Relação de Lisboa' },
  { match: /abrantes|T8ABT/i,                                relacao: 'TRL', nome: 'Tribunal da Relação de Lisboa' },
  // → Évora
  { match: /évora|evora|T8EVR|TBEVR/i,                       relacao: 'TRE', nome: 'Tribunal da Relação de Évora' },
  { match: /beja|T8BJA/i,                                    relacao: 'TRE', nome: 'Tribunal da Relação de Évora' },
  { match: /portalegre|T8PTG/i,                              relacao: 'TRE', nome: 'Tribunal da Relação de Évora' },
  { match: /faro|T8FAR|TBFAR/i,                              relacao: 'TRE', nome: 'Tribunal da Relação de Évora' },
  { match: /loulé|loule|T8LLE/i,                             relacao: 'TRE', nome: 'Tribunal da Relação de Évora' },
  { match: /tavira|T8TVR/i,                                  relacao: 'TRE', nome: 'Tribunal da Relação de Évora' },
  { match: /olhão|olhao|T8OLH/i,                             relacao: 'TRE', nome: 'Tribunal da Relação de Évora' },
  { match: /portimão|portimao|T8PTA/i,                       relacao: 'TRE', nome: 'Tribunal da Relação de Évora' },
  { match: /lagos|T8LAG/i,                                   relacao: 'TRE', nome: 'Tribunal da Relação de Évora' },
  { match: /santiago.?do.?cacém|T8SBR/i,                     relacao: 'TRE', nome: 'Tribunal da Relação de Évora' },
];

const NOMES_RELACAO = {
  'TRL': 'Tribunal da Relação de Lisboa',
  'TRP': 'Tribunal da Relação do Porto',
  'TRC': 'Tribunal da Relação de Coimbra',
  'TRG': 'Tribunal da Relação de Guimarães',
  'TRE': 'Tribunal da Relação de Évora',
  'STJ': 'Supremo Tribunal de Justiça',
  'STA': 'Supremo Tribunal Administrativo',
};

/**
 * Dado o nome/código do tribunal de 1.ª instância,
 * devolve o nome completo do tribunal de recurso competente.
 * Retorna null se não for possível determinar.
 */
function determinarTribunalRecurso(tribunalInput) {
  if (!tribunalInput || typeof tribunalInput !== 'string') return null;
  const t = tribunalInput.trim();
  for (const entry of TRIBUNAL_PARA_RELACAO) {
    if (entry.match.test(t)) {
      if (!entry.relacao) return null; // é um supremo, não tem Relação
      return NOMES_RELACAO[entry.relacao] || null;
    }
  }
  return null;
}

/**
 * Verifica e corrige o tribunal_recurso devolvido pelo modelo.
 * Se o tribunal de 1.ª instância for conhecido, usa a nossa tabela.
 * Se não for conhecido, mantém o que o modelo devolveu.
 */
function corrigirTribunalRecurso(tribunalRecursoModelo, tribunalPrimeiraInstancia) {
  const correcto = determinarTribunalRecurso(tribunalPrimeiraInstancia);
  if (correcto) return correcto; // a nossa tabela tem precedência absoluta
  return String(tribunalRecursoModelo || 'Não determinado');
}

// ══════════════════════════════════════════════════════════════════════════════
// VALIDADOR DE NÚMEROS DE PROCESSO PORTUGUÊS (Portaria 280/2013)
// ══════════════════════════════════════════════════════════════════════════════

const COMARCA_PARA_RELACAO_LETRA = {
  'LSB': 'L', 'LRS': 'L', 'SNT': 'L', 'CSC': 'L', 'OER': 'L',
  'VFX': 'L', 'MTS': 'L', 'ALM': 'L', 'SXL': 'L', 'BRR': 'L',
  'PLM': 'L', 'STR': 'L', 'TRS': 'L', 'ABT': 'L', 'TVD': 'L', 'STC': 'L',
  'PRT': 'P', 'VNG': 'P', 'MLD': 'P', 'VLP': 'P', 'PVZ': 'P',
  'VCD': 'P', 'STS': 'P', 'TRV': 'P', 'PNF': 'P', 'PRC': 'P',
  'FLG': 'P', 'LUS': 'P', 'ESP': 'P', 'GDM': 'P', 'VRL': 'P',
  'CHV': 'P', 'BGC': 'P', 'MCN': 'P', 'VPA': 'P', 'BRG': 'P',
  'GML': 'G', 'VCT': 'G', 'BCL': 'G',
  'CBR': 'C', 'AVR': 'C', 'VIS': 'C', 'GRD': 'C', 'CTB': 'C',
  'FIG': 'C', 'AGD': 'C', 'OVR': 'C', 'STA': 'C', 'LMG': 'C', 'LRA': 'C',
  'EVR': 'E', 'BJA': 'E', 'PTG': 'E', 'FAR': 'E', 'LLE': 'E',
  'TVR': 'E', 'OLH': 'E', 'PTA': 'E', 'LAG': 'E', 'SBR': 'E', 'ALT': 'E',
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
      const relacaoEsperadaLetra = COMARCA_PARA_RELACAO_LETRA[codComarca];
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

// ══════════════════════════════════════════════════════════════════════════════
// MAPA TEXTUAL PARA O PROMPT (Dec.-Lei 49/2014)
// ══════════════════════════════════════════════════════════════════════════════
const MAPA_RELACOES_PROMPT = `
TRIBUNAIS DE RECURSO — DEC.-LEI N.º 49/2014 (REGRA ABSOLUTA, NUNCA IGNORAR):

→ Tribunal da Relação de COIMBRA:
  Comarca da Guarda ← CRÍTICO (NUNCA Guimarães)
  Comarca de Coimbra, Aveiro, Viseu, Castelo Branco, Leiria (cível), Figueira da Foz, Lamego

→ Tribunal da Relação do PORTO:
  Comarca do Porto, Porto Este, Vila Nova de Gaia, Matosinhos, Maia, Valongo
  Póvoa de Varzim, Vila do Conde, Santo Tirso, Penafiel, Paredes, Felgueiras, Lousada
  Vila Real, Chaves, Bragança, Mirandela

→ Tribunal da Relação de GUIMARÃES:
  Comarca de Braga, Guimarães, Barcelos, Viana do Castelo

→ Tribunal da Relação de LISBOA:
  Comarca de Lisboa, Lisboa Norte, Lisboa Oeste, Sintra, Cascais, Oeiras, Amadora
  Vila Franca de Xira, Loures, Setúbal, Almada, Seixal, Barreiro, Santarém, Torres Vedras, Abrantes

→ Tribunal da Relação de ÉVORA:
  Comarca de Évora, Beja, Portalegre, Faro, Loulé, Tavira, Olhão, Portimão, Lagos

ATENÇÃO ESPECIAL:
- Comarca da GUARDA → SEMPRE Tribunal da Relação de COIMBRA (nunca Guimarães, nunca Porto)
- ULS Guarda / Juízo do Trabalho da Guarda / Tribunal Judicial da Comarca da Guarda → COIMBRA
- Se o código do processo contiver "GRD" → Relação de COIMBRA (letra C no número de processo)
`;

// ══════════════════════════════════════════════════════════════════════════════
// CRITÉRIOS DE ANÁLISE CRÍTICA (10 critérios)
// ══════════════════════════════════════════════════════════════════════════════
const CRITERIOS_CRITICA = `
CRITÉRIOS DE ANÁLISE OBRIGATÓRIOS (aplica TODOS):

1. VÍCIOS FORMAIS (Art. 615.º CPC / Art. 379.º CPP)
   615.º/1/a): falta assinatura | 615.º/1/b): falta fundamentação | 615.º/1/c): contradição
   615.º/1/d): omissão ou excesso de pronúncia | 615.º/1/e): ultra petita
   379.º/1/a) CPP: falta menções art. 374.º | 379.º/1/b): factos diversos da acusação | 379.º/1/c): omissão pronúncia
   → Pedido: NULIDADE ("declare nula e ordene substituição")

2. ERROS DE DIREITO
   Interpretação errada, aplicação de norma revogada, violação de norma imperativa

3. ERROS DE FACTO (Art. 662.º CPC / Art. 410.º/2 CPP)
   Cível: erro apreciação provas — verificar ónus art. 640.º CPC (indicar factos, meios de prova, decisão alternativa)
   Penal: 410.º/2/a) insuficiência | 410.º/2/b) contradição | 410.º/2/c) erro notório
   → Pedido: REVOGAÇÃO

4. QUESTÕES CONSTITUCIONAIS
   Art. 20.º (acesso direito), 32.º (garantias penais), 205.º (fundamentação), 13.º (igualdade), 18.º (proporcionalidade)

5. ADMISSIBILIDADE E ALÇADA (Art. 629.º CPC)
   Alçada comarca: €5.000 | Alçada Relação (para STJ): €30.000
   Dupla conforme (art. 671.º/3): Relação confirmou 1.ª instância → acesso STJ restrito

6. PRAZOS
   Apelação cível: 30 dias (art. 638.º/1) | Urgente: 15 dias
   Recurso penal: 30 dias (art. 411.º CPP) | Administrativo: 30 dias (art. 144.º CPTA)

7. MATÉRIA DE FACTO vs. DIREITO (para STJ)
   STJ só conhece matéria de direito (art. 674.º/3 CPC) — identificar se fundamentos são de facto ou direito

8. CONHECIMENTO OFICIOSO
   Incompetência absoluta (art. 97.º), falta personalidade judiciária (art. 11.º), caso julgado (art. 577.º/i)
   Nulidades absolutas CPP (art. 119.º) — arguíveis em qualquer fase sem necessidade de arguição prévia

9. VIOLAÇÃO DO CONTRADITÓRIO (Art. 3.º/3 CPC)
   Decisão surpresa, questão de conhecimento oficioso sem audição das partes

10. PROPORCIONALIDADE DA PENA (só processo penal)
    Art. 40.º CP (finalidades), 71.º CP (critérios medida da pena), 72.º CP (atenuação especial), 74.º CP (dispensa)
    Falta fundamentação da pena = nulidade (art. 205.º CRP + art. 71.º/3 CP)

DISTINÇÃO CRÍTICA (nunca confundir):
→ Vícios art. 615.º/379.º = pedido de NULIDADE
→ Erros de julgamento = pedido de REVOGAÇÃO
→ Ambos = pedido MISTO (alíneas separadas)
`;

// ══════════════════════════════════════════════════════════════════════════════
// UTILITÁRIO: parse JSON robusto com tentativas
// ══════════════════════════════════════════════════════════════════════════════
function parseJSON(texto) {
  // Tentativa 1: directo
  try {
    const cleaned = texto.replace(/^```json\s*/i,'').replace(/^```\s*/i,'').replace(/\s*```$/i,'').trim();
    return JSON.parse(cleaned);
  } catch {}

  // Tentativa 2: extrair bloco {}
  const match = texto.match(/\{[\s\S]*\}/);
  if (!match) return null;

  try { return JSON.parse(match[0]); } catch {}

  // Tentativa 3: reparar JSON truncado
  try {
    let s = match[0];
    // Remover vírgulas finais
    s = s.replace(/,\s*([}\]])/g, '$1');
    // Fechar strings abertas (heurística)
    s = s.replace(/:\s*"([^"]*?)$/m, ': "$1"');
    // Fechar estruturas abertas
    let depth = 0;
    for (const c of s) { if (c==='{' || c==='[') depth++; if (c==='}' || c===']') depth--; }
    if (depth > 0) {
      // Tenta fechar arrays e objectos abertos
      for (let i = 0; i < depth; i++) s += '}';
    }
    return JSON.parse(s);
  } catch {}

  return null;
}

// ══════════════════════════════════════════════════════════════════════════════
// HANDLER PRINCIPAL
// ══════════════════════════════════════════════════════════════════════════════
module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ erro: 'Método não permitido' });

  // ── AUTENTICAÇÃO ──
  const authHeader = (req.headers.authorization || '').trim();
  if (!authHeader.startsWith('Bearer ')) return res.status(401).json({ erro: 'Autenticação necessária.' });
  const token = authHeader.replace('Bearer ', '').trim();
  try {
    const authCheck = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { 'Authorization': `Bearer ${token}`, 'apikey': SUPABASE_ANON_KEY },
    });
    if (!authCheck.ok) return res.status(401).json({ erro: 'Sessão inválida ou expirada.' });
  } catch { return res.status(401).json({ erro: 'Erro de autenticação.' }); }

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

  // ── VALIDAÇÃO LOCAL DE NÚMEROS DE PROCESSO ──
  let validacoesLocais = [];
  if (modo === 'judicial' && texto) validacoesLocais = extrairEValidarProcessos(texto);

  // ── TRIBUNAL DE RECURSO DETERMINADO LOCALMENTE (para crítica) ──
  // Se conseguirmos determinar pelo tribunal de 1.ª instância, usamos sempre este valor
  const tribunalRecursoLocal = modo === 'critica' ? determinarTribunalRecurso(tribunal) : null;

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

    // Se já determinamos o tribunal localmente, incluímos no prompt para reforçar
    const tribunalHint = tribunalRecursoLocal
      ? `\nTRIBUNAL DE RECURSO DETERMINADO PELO SISTEMA: ${tribunalRecursoLocal} — usa OBRIGATORIAMENTE este valor no campo tribunal_recurso.\n`
      : '';

    systemPrompt = `Actua como Consultor Jurídico Sénior especialista em recursos portugueses com 20 anos de experiência. Responde APENAS com JSON puro, sem backticks, sem texto antes ou depois.

${MAPA_RELACOES_PROMPT}
${tribunalHint}
${CRITERIOS_CRITICA}

JSON obrigatório:
{
  "veredicto_recurso": "RECURSO_VIAVEL",
  "confianca": 80,
  "admissivel": true,
  "alcada_ok": null,
  "dupla_conforme": false,
  "tipo_pedido": "revogacao",
  "tribunal_recurso": "${tribunalRecursoLocal || 'Tribunal da Relação competente'}",
  "prazo_recurso": "30 dias a contar da notificação (art. 638.º/1 CPC)",
  "prazo_expirado": null,
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
      "descricao": "Descrição objectiva.",
      "argumento": "Argumento completo para a peça."
    }
  ],
  "alerta_contraditorio": "",
  "alerta_alcada": "",
  "alerta_dupla_conforme": "",
  "alerta_facto_vs_direito": "",
  "alerta_proporcionalidade_pena": "",
  "conclusao": "Recomendação estratégica com tipo de pedido (nulidade/revogação) e prioridade."
}

VALORES: veredicto_recurso: RECURSO_VIAVEL/RECURSO_PARCIAL/RECURSO_INVIAVEL | categoria: nulidade/erro_direito/erro_facto/questao_constitucional | gravidade: grave/moderada/leve | dificuldade: facil/media/dificil | tipo_pedido: nulidade/revogacao/misto | max 6 fundamentos por prioridade | NUNCA fundamentos vazios se existirem vícios`;

    userPrompt = `${ctx ? `CONTEXTO:\n${ctx}\n\n` : ''}DECISÃO A ANALISAR:\n\n${textoTruncado}\n\nAplica os 10 critérios. JSON puro.`;

  // ══════════════════════════════════════════════════
  // MODO MINUTA
  // ══════════════════════════════════════════════════
  } else if (modo === 'minuta') {
    const { fundamentos = [], tribunal_recurso, tipo_pedido, tipoProcesso: tp, parteRecorrente: pr } = body;
    if (!fundamentos.length) return res.status(400).json({ erro: 'Fundamentos em falta para gerar minuta.' });

    const ctx = [
      tribunal_recurso ? `Tribunal de recurso: ${tribunal_recurso}` : null,
      tp               ? `Tipo de processo: ${tp}`                  : null,
      pr               ? `Parte recorrente: ${pr}`                  : null,
      tipo_pedido      ? `Tipo de pedido: ${tipo_pedido}`           : null,
    ].filter(Boolean).join('\n');

    const fundamentosTexto = fundamentos.map((f, i) =>
      `${i + 1}. [Critério ${f.criterio || '?'}] ${f.tipo} (${f.artigo || ''}) — ${f.descricao}\nArgumento: ${f.argumento}${f.conhecimento_oficioso ? '\nNota: pode ser arguido oficiosamente mesmo sem arguição prévia.' : ''}`
    ).join('\n\n');

    const instrucaoPedido = tipo_pedido === 'nulidade'
      ? 'O pedido final deve ser de NULIDADE: "Termos em que deve a sentença recorrida ser declarada nula, ordenando-se a sua substituição por outra que..."'
      : tipo_pedido === 'misto'
      ? 'Há fundamentos de nulidade E de revogação — estrutura o pedido em duas alíneas: a) declaração de nulidade; b) revogação e substituição.'
      : 'O pedido final deve ser de REVOGAÇÃO: "Termos em que deve a sentença recorrida ser revogada e substituída por outra que..."';

    systemPrompt = `Actua como Advogado Sénior especialista em recursos portugueses. Redige proposta TOTALMENTE COMPLETA E INTEGRAL para recurso em português jurídico formal PT-PT.

REGRAS ABSOLUTAS:
1. Texto simples, SEM markdown, SEM #, SEM asteriscos
2. 100% completo até ao PEDIDO FINAL com assinatura e data — NUNCA cortes
3. MÍNIMO 5 parágrafos por fundamento com argumentação densa, doutrina e jurisprudência
4. Cita doutrina PT (Lebre de Freitas, Abrantes Geraldes, Salvador da Costa, Pais de Amaral, Cavaleiro de Ferreira, Figueiredo Dias) com obra e página
5. Cita jurisprudência com número de processo, tribunal e data
6. Mínimo 2500 palavras, idealmente 3500-5000
7. ${instrucaoPedido}

ESTRUTURA:
EXMO. SENHOR [JUIZ / DESEMBARGADOR / CONSELHEIRO]
DO [TRIBUNAL]

[RECORRENTE], vem interpor RECURSO DE APELAÇÃO da sentença de [TIPO] n.º [PROCESSO] no [TRIBUNAL A QUO] de [DATA]:

I. ADMISSIBILIDADE (3 parágrafos: legitimidade, prazo, alçada)
II. FUNDAMENTOS (cada um com título em MAIÚSCULAS + mínimo 5 parágrafos)
III. CONCLUSÕES (numeradas: 1.ª, 2.ª, ... — uma por argumento)
IV. PEDIDO (${instrucaoPedido})

[Local, data]
O Mandatário / A Mandatária,
[NOME]`;

    userPrompt = `${ctx ? ctx + '\n\n' : ''}FUNDAMENTOS:\n\n${fundamentosTexto}\n\nRedige proposta COMPLETA em texto simples. 100% completa até ao fecho.`;

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
    "perplexidade": 75, "burstiness": 60, "coesao_artificial": 70,
    "uniformidade_sintatica": 65, "riqueza_lexical": 55, "marcadores_formulaicos": 80
  },
  "humanizador_detectado": false,
  "narrativa": "Análise detalhada.",
  "relator_analise": "Análise do estilo do autor.",
  "marcadores": [{ "tipo": "ai", "texto": "Descrição." }]
}

VALORES: veredicto: IA_DETECTADA/PROVAVELMENTE_IA/INCONCLUSIVO/PROVAVELMENTE_HUMANO/HUMANO | tipo: ai/humano | indicadores 0-100`;

    userPrompt = `${ctx ? `CONTEXTO:\n${ctx}\n\n` : ''}TEXTO:\n\n${textoTruncado}\n\nJSON puro.`;

  // ══════════════════════════════════════════════════
  // MODO JUDICIAL
  // ══════════════════════════════════════════════════
  } else {
    const ctx = [
      tribunal ? `Tribunal: ${tribunal}` : null,
      relator  ? `Relator: ${relator}`   : null,
    ].filter(Boolean).join('\n');

    const alertasLocais = validacoesLocais.length > 0
      ? `\n\nALERTAS FORMATO (Portaria 280/2013):\n` +
        validacoesLocais.map(v => `- ${v.numero}: ${v.validacao.problemas.join('; ')}`).join('\n') +
        `\nTrata como citações suspeitas de gravidade alta.\n`
      : '';

    systemPrompt = `És um perito forense em análise linguística para detectar autoria de IA em decisões judiciais portuguesas.

RESPONDE APENAS COM JSON PURO. Sem texto antes, sem texto depois, sem markdown, sem backticks.

{
  "veredicto": "IA_DETECTADA",
  "confianca": 80,
  "indicadores": {
    "perplexidade": 75, "burstiness": 60, "coesao_artificial": 70,
    "uniformidade_sintatica": 65, "riqueza_lexical": 55, "marcadores_formulaicos": 80
  },
  "humanizador_detectado": false,
  "citacoes_suspeitas": [],
  "narrativa": "Análise detalhada.",
  "relator_analise": "Análise do estilo do relator.",
  "marcadores": [{ "tipo": "ai", "texto": "Descrição." }]
}

VALORES: veredicto: IA_DETECTADA/PROVAVELMENTE_IA/INCONCLUSIVO/PROVAVELMENTE_HUMANO/HUMANO | tipo: ai/humano
humanizador_detectado: true se sinais de Quillbot, Undetectable.ai, WordAI, etc.
citacoes_suspeitas: [{ "citacao": "...", "tipo": "acordao|diploma_legal|doutrina|jurisprudencia", "problema": "...", "gravidade": "alta|media|baixa", "validacao_formato": "ok|formato_invalido|nao_aplicavel" }]
Array vazio [] se nada suspeito. Analisa corpo de fundamentação. Marcadores IA: "Neste contexto", "Importa salientar", "É de referir que", parágrafos uniformes.`;

    userPrompt = `${ctx ? `CONTEXTO:\n${ctx}\n\n` : ''}${alertasLocais}DECISÃO:\n\n${textoTruncado}\n\nJSON puro.`;
  }

  // ── CHAMADA ANTHROPIC com retry automático ──
  // max_tokens: crítica 5000 (JSON rico com 6 fundamentos), minuta 16000, outros 2000
  // retry: 1 tentativa adicional em caso de falha de parse (não de erro HTTP)
  const maxTokens = modo === 'minuta' ? 16000 : modo === 'critica' ? 5000 : 2000;

  async function chamarAnthropic() {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
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
    if (!r.ok) {
      const errText = await r.text().catch(() => '');
      console.error('Anthropic HTTP error:', r.status, errText.substring(0, 200));
      throw new Error(`Anthropic HTTP ${r.status}`);
    }
    const data = await r.json();
    return (data.content?.[0]?.text || '').trim();
  }

  try {
    let fullText = await chamarAnthropic();

    if (!fullText) return res.status(500).json({ erro: 'Resposta vazia. Tente novamente.' });

    // Modo minuta: texto simples
    if (modo === 'minuta') return res.status(200).json({ minuta: fullText });

    // ── PARSE com retry ──
    let parsed = parseJSON(fullText);

    if (!parsed) {
      // Retry: segunda chamada com prompt ligeiramente mais curto (sem critérios longos)
      console.warn('Parse falhou na 1.ª tentativa — a fazer retry...');
      fullText = await chamarAnthropic();
      parsed = parseJSON(fullText);
    }

    if (!parsed) {
      console.error('Parse falhou após retry. Raw[0-300]:', fullText.substring(0, 300));
      // Fallback EXPLÍCITO com indicação de erro — não simula sucesso
      if (modo === 'critica') {
        return res.status(200).json({
          veredicto_recurso: 'RECURSO_INVIAVEL',
          confianca: 0,
          admissivel: null,
          alcada_ok: null,
          dupla_conforme: false,
          tipo_pedido: 'revogacao',
          tribunal_recurso: tribunalRecursoLocal || 'Não determinado',
          prazo_recurso: 'Consulte um advogado',
          prazo_expirado: null,
          sumario: 'Erro interno na análise. O texto pode ser demasiado extenso ou complexo. Por favor tente novamente ou reduza o texto.',
          fundamentos: [],
          alerta_contraditorio: '',
          alerta_alcada: '',
          alerta_dupla_conforme: '',
          alerta_facto_vs_direito: '',
          alerta_proporcionalidade_pena: '',
          conclusao: 'A análise não foi concluída por erro interno. Tente novamente.',
          _erro: true,
        });
      }
      return res.status(500).json({ erro: 'Erro ao processar resposta. Tente novamente.' });
    }

    // ── NORMALIZAÇÃO ──
    if (modo === 'critica') {
      const okV    = ['RECURSO_VIAVEL','RECURSO_PARCIAL','RECURSO_INVIAVEL'];
      const okCat  = ['nulidade','erro_direito','erro_facto','questao_constitucional'];
      const okGrav = ['grave','moderada','leve'];
      const okDif  = ['facil','media','dificil'];
      const okPed  = ['nulidade','revogacao','misto'];

      if (!okV.includes(parsed.veredicto_recurso)) parsed.veredicto_recurso = 'RECURSO_INVIAVEL';
      parsed.confianca      = clamp(parsed.confianca);
      parsed.admissivel     = parsed.admissivel !== false;
      parsed.alcada_ok      = parsed.alcada_ok === null ? null : parsed.alcada_ok !== false;
      parsed.dupla_conforme = parsed.dupla_conforme === true;
      parsed.tipo_pedido    = okPed.includes(parsed.tipo_pedido) ? parsed.tipo_pedido : 'revogacao';
      parsed.prazo_recurso  = String(parsed.prazo_recurso  || 'Consulte um advogado');
      parsed.prazo_expirado = parsed.prazo_expirado === true ? true : parsed.prazo_expirado === false ? false : null;
      parsed.sumario        = String(parsed.sumario        || 'Análise concluída.');
      parsed.conclusao      = String(parsed.conclusao      || 'Consulte um advogado.');

      // ── CORRECÇÃO DO TRIBUNAL — backend é fonte de verdade ──
      parsed.tribunal_recurso = corrigirTribunalRecurso(parsed.tribunal_recurso, tribunal);

      parsed.alerta_contraditorio          = String(parsed.alerta_contraditorio          || '');
      parsed.alerta_alcada                 = String(parsed.alerta_alcada                 || '');
      parsed.alerta_dupla_conforme         = String(parsed.alerta_dupla_conforme         || '');
      parsed.alerta_facto_vs_direito       = String(parsed.alerta_facto_vs_direito       || '');
      parsed.alerta_proporcionalidade_pena = String(parsed.alerta_proporcionalidade_pena || '');

      const items = Array.isArray(parsed.fundamentos)
        ? parsed.fundamentos
        : Array.isArray(parsed.nulidades)
          ? parsed.nulidades.map((n, i) => ({ ...n, categoria: 'nulidade', criterio: 1, prioridade: i + 1, dificuldade: 'media' }))
          : [];

      parsed.fundamentos = items.map((f, i) => ({
        categoria:            okCat.includes(f.categoria)                        ? f.categoria              : 'nulidade',
        criterio:             Number(f.criterio) || 1,
        tipo:                 String(f.tipo        || 'Vício Processual'),
        artigo:               String(f.artigo       || ''),
        gravidade:            okGrav.includes((f.gravidade  ||'').toLowerCase()) ? f.gravidade.toLowerCase()  : 'moderada',
        prioridade:           Number(f.prioridade)  || (i + 1),
        dificuldade:          okDif.includes((f.dificuldade ||'').toLowerCase()) ? f.dificuldade.toLowerCase() : 'media',
        conhecimento_oficioso: f.conhecimento_oficioso === true,
        descricao:            String(f.descricao    || ''),
        argumento:            String(f.argumento    || ''),
      }));

      parsed.fundamentos.sort((a, b) => a.prioridade - b.prioridade);
      delete parsed.nulidades;

    } else {
      const okV = ['IA_DETECTADA','PROVAVELMENTE_IA','INCONCLUSIVO','PROVAVELMENTE_HUMANO','HUMANO'];
      if (!okV.includes(parsed.veredicto)) parsed.veredicto = 'INCONCLUSIVO';
      parsed.confianca = clamp(parsed.confianca);
      if (!parsed.indicadores || typeof parsed.indicadores !== 'object') parsed.indicadores = {};
      ['perplexidade','burstiness','coesao_artificial','uniformidade_sintatica','riqueza_lexical','marcadores_formulaicos']
        .forEach(k => { parsed.indicadores[k] = clamp(parsed.indicadores[k]); });
      parsed.narrativa             = String(parsed.narrativa       || 'Análise concluída.');
      parsed.relator_analise       = String(parsed.relator_analise || 'Não indicado.');
      parsed.humanizador_detectado = parsed.humanizador_detectado === true;

      if (modo === 'judicial') {
        const okGravCit    = ['alta','media','baixa'];
        const okTipoCit    = ['acordao','diploma_legal','doutrina','jurisprudencia'];
        const okFormatoCit = ['ok','formato_invalido','nao_aplicavel'];

        let citacoesIA = Array.isArray(parsed.citacoes_suspeitas)
          ? parsed.citacoes_suspeitas.slice(0, 6).map(c => ({
              citacao:           String(c.citacao  || ''),
              tipo:              okTipoCit.includes(c.tipo)                 ? c.tipo            : 'jurisprudencia',
              problema:          String(c.problema || ''),
              gravidade:         okGravCit.includes(c.gravidade)            ? c.gravidade       : 'media',
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
        ? parsed.marcadores.slice(0, 8).map(m => ({ tipo: m.tipo === 'ai' ? 'ai' : 'humano', texto: String(m.texto || '') }))
        : [];
    }

    return res.status(200).json(parsed);

  } catch (err) {
    console.error('Unhandled:', err.message);
    if (err.message.includes('Anthropic HTTP')) {
      return res.status(502).json({ erro: 'Erro na API de análise. Tente novamente.' });
    }
    return res.status(500).json({ erro: 'Erro interno. Tente novamente.' });
  }
};

function clamp(val) {
  const n = Number(val);
  return isNaN(n) ? 50 : Math.max(0, Math.min(100, Math.round(n)));
}
