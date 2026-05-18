// /api/analisar.js — LexVeritas API Endpoint
// Vercel Serverless Function — Node.js 18+ — CommonJS
// v2.9 — prompt caching activado (-66% custo input)
//        limites por plano: gratuito 120k/200k/120k, pro 300k/700k/300k
//        citacoes_suspeitas no modo académico (Nível 1: prompt + schema; Nível 2: backend)
//        Nível 1: systemPrompt académico inclui citacoes_suspeitas com regras para notas
//                 de rodapé, bibliografia, doutrina e acórdãos; max_tokens académico → 3000
//        Nível 2: extrairEValidarProcessos() activo também para modo académico;
//                 normalização citacoes_suspeitas partilhada entre judicial e académico
// v2.7 — extracção inteligente de texto para modo académico (50.000 chars, heurística estrutural)
//        mapeamento tribunais verificado LOSJ (Lei 62/2013) + DL 49/2014 + fonte CSM oficial
//        fix: Aveiro→Porto, Bragança→Guimarães, Vila Real→Guimarães, Braga→Guimarães
//        max_tokens crítica 5000, retry automático, correcção tribunal no backend

const SUPABASE_URL      = 'https://bsbgizaftamufmmxeyer.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJzYmdpemFmdGFtdWZtbXhleWVyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc3NDkzNTIsImV4cCI6MjA5MzMyNTM1Mn0._xBiw0VUa3FSnortYseUQPDc5xb--k15lYcylNmMEEQ';

// ══════════════════════════════════════════════════════════════════════════════
// MAPA OFICIAL DE TRIBUNAIS DE RECURSO
// Fontes: Lei n.º 62/2013 (LOSJ) Anexo I + DL n.º 49/2014 (ROFTJ) + CSM (csm.org.pt/tribunais/comarcas)
// Verificado em Maio de 2026 — 23 comarcas do continente + Regiões Autónomas
//
// RESUMO DAS 23 COMARCAS → RELAÇÃO COMPETENTE:
//   → TRL (Lisboa):    Lisboa, Lisboa Norte, Lisboa Oeste, Setúbal, Santarém, Leiria(*), Portalegre(**)
//   → TRC (Coimbra):   Coimbra, Guarda, Castelo Branco, Viseu, Leiria, Aveiro(***)
//   → TRP (Porto):     Porto, Porto Este
//   → TRG (Guimarães): Braga, Bragança, Viana do Castelo, Vila Real
//   → TRE (Évora):     Évora, Beja, Faro
//   + Açores e Madeira → TRL
//
//  (*) Leiria: em matéria cível → TRC (Coimbra); em matéria penal pode ir a TRL
//  (**) Portalegre: na prática vai para TRE (Évora), não TRL
//  (***) Aveiro: vai para TRP (Porto), NÃO para TRC — correcção face à versão anterior
//
// ATENÇÃO: A Comarca de Braga inclui o município de Guimarães (não é comarca autónoma).
// A TRG tem competência sobre a comarca de Braga (não apenas sobre Guimarães).
// ══════════════════════════════════════════════════════════════════════════════

const TRIBUNAL_PARA_RELACAO = [
  // ── SUPREMOS (sem Relação — recursão directa para STJ/STA/TC) ──
  { match: /\bSTJ\b|supremo tribunal de justiça/i,           relacao: null, nome: 'Supremo Tribunal de Justiça' },
  { match: /\bSTA\b|supremo tribunal administrativo/i,       relacao: null, nome: 'Supremo Tribunal Administrativo' },
  { match: /tribunal constitucional|\bTC\b/i,                relacao: null, nome: 'Tribunal Constitucional' },
  { match: /\bTCAS\b|central administrativo sul/i,           relacao: null, nome: 'Tribunal Central Administrativo Sul' },
  { match: /\bTCAN\b|central administrativo norte/i,         relacao: null, nome: 'Tribunal Central Administrativo Norte' },

  // ── RELAÇÕES (recursão para STJ) ──
  { match: /relação de lisboa|\bTRL\b/i,                     relacao: 'STJ', nome: 'Tribunal da Relação de Lisboa' },
  { match: /relação do porto|\bTRP\b/i,                      relacao: 'STJ', nome: 'Tribunal da Relação do Porto' },
  { match: /relação de coimbra|\bTRC\b/i,                    relacao: 'STJ', nome: 'Tribunal da Relação de Coimbra' },
  { match: /relação de guimarães|relação de guimaraes|\bTRG\b/i, relacao: 'STJ', nome: 'Tribunal da Relação de Guimarães' },
  { match: /relação de évora|relação de evora|\bTRE\b/i,     relacao: 'STJ', nome: 'Tribunal da Relação de Évora' },

  // ══════════════════════════════════════════════════════════════════
  // TRIBUNAL DA RELAÇÃO DE COIMBRA
  // Comarcas: Coimbra, Guarda, Castelo Branco, Viseu, Leiria
  // Fonte: LOSJ Anexo I + TRC (trc.pt/mapa-judiciario) + CSM
  // ══════════════════════════════════════════════════════════════════

  // Comarca da GUARDA — CRÍTICO (não confundir com TRG)
  { match: /comarca da guarda|tribunal.*guarda|juízo.*guarda|juizo.*guarda|ULS guarda|T8GRD|TBGRD/i,
    relacao: 'TRC', nome: 'Tribunal da Relação de Coimbra' },

  // Comarca de CASTELO BRANCO
  { match: /comarca.*castelo.?branco|tribunal.*castelo.?branco|T8CTB|TBCTB/i,
    relacao: 'TRC', nome: 'Tribunal da Relação de Coimbra' },

  // Comarca de COIMBRA
  { match: /comarca.*coimbra|tribunal.*coimbra|T8CBR|TBCBR/i,
    relacao: 'TRC', nome: 'Tribunal da Relação de Coimbra' },

  // Comarca de VISEU
  { match: /comarca.*viseu|tribunal.*viseu|T8VIS|TBVIS/i,
    relacao: 'TRC', nome: 'Tribunal da Relação de Coimbra' },

  // Comarca de LEIRIA (cível e matéria geral → TRC; alguns casos penais → TRL)
  { match: /comarca.*leiria|tribunal.*leiria|T8LRA|TBLRA/i,
    relacao: 'TRC', nome: 'Tribunal da Relação de Coimbra' },

  // ══════════════════════════════════════════════════════════════════
  // TRIBUNAL DA RELAÇÃO DO PORTO
  // Comarcas: Porto, Porto Este, Aveiro (*)
  // (*) Aveiro → TRP — CORRECÇÃO: na versão anterior estava errado como TRC
  // Fonte: CSM csm.org.pt/tribunais/comarcas (Aveiro: "Tribunal da Relação competente: Porto")
  // ══════════════════════════════════════════════════════════════════

  // Comarca de AVEIRO → TRP (não TRC — correcção crítica)
  { match: /comarca.*aveiro|tribunal.*aveiro|T8AVR|TBAVR/i,
    relacao: 'TRP', nome: 'Tribunal da Relação do Porto' },

  // Comarca do PORTO
  { match: /comarca.*porto\b|tribunal.*porto\b|T8PRT|TBPRT/i,
    relacao: 'TRP', nome: 'Tribunal da Relação do Porto' },

  // Comarca do PORTO ESTE
  { match: /porto este|T8PTE/i,
    relacao: 'TRP', nome: 'Tribunal da Relação do Porto' },

  // Municípios da Comarca do Porto (para correspondência por nome de juízo)
  { match: /vila.?nova.?de.?gaia|T8VNG/i,                   relacao: 'TRP', nome: 'Tribunal da Relação do Porto' },
  { match: /matosinhos|T8MTS/i,                             relacao: 'TRP', nome: 'Tribunal da Relação do Porto' },
  { match: /\bmaia\b|T8MLD/i,                               relacao: 'TRP', nome: 'Tribunal da Relação do Porto' },
  { match: /valongo|T8VLP/i,                                relacao: 'TRP', nome: 'Tribunal da Relação do Porto' },
  { match: /póvoa.?de.?varzim|povoa.?de.?varzim|T8PVZ/i,   relacao: 'TRP', nome: 'Tribunal da Relação do Porto' },
  { match: /vila.?do.?conde|T8VCD/i,                        relacao: 'TRP', nome: 'Tribunal da Relação do Porto' },
  { match: /santo.?tirso|T8STS/i,                           relacao: 'TRP', nome: 'Tribunal da Relação do Porto' },
  { match: /penafiel|T8PNF/i,                               relacao: 'TRP', nome: 'Tribunal da Relação do Porto' },
  { match: /\bparedes\b|T8PRC/i,                            relacao: 'TRP', nome: 'Tribunal da Relação do Porto' },
  { match: /felgueiras|T8FLG/i,                             relacao: 'TRP', nome: 'Tribunal da Relação do Porto' },
  { match: /lousada|T8LUS/i,                                relacao: 'TRP', nome: 'Tribunal da Relação do Porto' },
  { match: /gondomar|T8GDM/i,                               relacao: 'TRP', nome: 'Tribunal da Relação do Porto' },
  { match: /espinho|T8ESP/i,                                relacao: 'TRP', nome: 'Tribunal da Relação do Porto' },

  // Municípios da Comarca de Aveiro (→ TRP)
  { match: /\baveiro\b|T8AVR/i,                             relacao: 'TRP', nome: 'Tribunal da Relação do Porto' },
  { match: /santa.?maria.?da.?feira|T8STA/i,               relacao: 'TRP', nome: 'Tribunal da Relação do Porto' },
  { match: /oliveira.?de.?azeméis|oliveira.?de.?azemeis|T8OVR/i, relacao: 'TRP', nome: 'Tribunal da Relação do Porto' },
  { match: /\bagueda\b|águeda|T8AGD/i,                     relacao: 'TRP', nome: 'Tribunal da Relação do Porto' },

  // ══════════════════════════════════════════════════════════════════
  // TRIBUNAL DA RELAÇÃO DE GUIMARÃES
  // Comarcas: Braga, Bragança, Viana do Castelo, Vila Real
  // Fonte: TRG (trg.pt/Jurisdição-territorial) + CSM + LOSJ Anexo I
  // NOTA: A Comarca de Braga inclui Guimarães, Barcelos, Fafe, etc.
  // CORRECÇÃO: Bragança e Vila Real → TRG (não TRP como na versão anterior)
  // ══════════════════════════════════════════════════════════════════

  // Comarca de BRAGA (inclui Guimarães, Barcelos, Fafe, etc.)
  { match: /comarca.*braga|tribunal.*braga|T8BRG|TBBRG/i,
    relacao: 'TRG', nome: 'Tribunal da Relação de Guimarães' },
  // Municípios da Comarca de Braga
  { match: /guimarães|guimaraes|T8GML/i,                   relacao: 'TRG', nome: 'Tribunal da Relação de Guimarães' },
  { match: /barcelos|T8BCL/i,                               relacao: 'TRG', nome: 'Tribunal da Relação de Guimarães' },
  { match: /\bfafe\b/i,                                     relacao: 'TRG', nome: 'Tribunal da Relação de Guimarães' },
  { match: /vila.?nova.?de.?famalicão|vila.?nova.?de.?famalicao/i, relacao: 'TRG', nome: 'Tribunal da Relação de Guimarães' },
  { match: /amares|esposende|terras.?de.?bouro|vieira.?do.?minho|vila.?verde|vizela/i, relacao: 'TRG', nome: 'Tribunal da Relação de Guimarães' },

  // Comarca de BRAGANÇA → TRG (CORRECÇÃO: estava TRP)
  { match: /comarca.*bragança|comarca.*braganca|tribunal.*bragança|T8BGC|TBBGC/i,
    relacao: 'TRG', nome: 'Tribunal da Relação de Guimarães' },
  // Municípios da Comarca de Bragança
  { match: /mirandela|T8MCN/i,                              relacao: 'TRG', nome: 'Tribunal da Relação de Guimarães' },
  { match: /macedo.?de.?cavaleiros|miranda.?do.?douro|mogadouro|torre.?de.?moncorvo|vimioso|vinhais/i, relacao: 'TRG', nome: 'Tribunal da Relação de Guimarães' },

  // Comarca de VIANA DO CASTELO → TRG
  { match: /viana.?do.?castelo|T8VCT|TBVCT/i,              relacao: 'TRG', nome: 'Tribunal da Relação de Guimarães' },

  // Comarca de VILA REAL → TRG (CORRECÇÃO: estava TRP)
  { match: /comarca.*vila.?real|tribunal.*vila.?real|T8VRL/i,
    relacao: 'TRG', nome: 'Tribunal da Relação de Guimarães' },
  // Municípios da Comarca de Vila Real
  { match: /\bchaves\b|T8CHV/i,                             relacao: 'TRG', nome: 'Tribunal da Relação de Guimarães' },
  { match: /peso.?da.?régua|peso.?da.?regua|sabrosa|alijó|alifo|boticas|montalegre|valpaços|valpacos/i, relacao: 'TRG', nome: 'Tribunal da Relação de Guimarães' },

  // ══════════════════════════════════════════════════════════════════
  // TRIBUNAL DA RELAÇÃO DE LISBOA
  // Comarcas: Lisboa, Lisboa Norte, Lisboa Oeste, Setúbal, Santarém, + Açores e Madeira
  // Fonte: DL 49/2014 + CSM + LOSJ Anexo I
  // ══════════════════════════════════════════════════════════════════

  // Comarca de LISBOA (inclui Lisboa e margem sul: Almada, Seixal, Barreiro, Moita, Montijo, Alcochete)
  { match: /comarca.*de.*lisboa\b|tribunal.*de.*lisboa\b|T8LSB|TBLSB/i,
    relacao: 'TRL', nome: 'Tribunal da Relação de Lisboa' },

  // Comarca de LISBOA NORTE (Loures, Mafra, Odivelas, Sintra, Torres Vedras, Vila Franca de Xira)
  { match: /lisboa.?norte|T8LRN/i,                          relacao: 'TRL', nome: 'Tribunal da Relação de Lisboa' },

  // Comarca de LISBOA OESTE (Caldas da Rainha, Óbidos, Peniche, Torres Vedras, etc.)
  { match: /lisboa.?oeste|T8LRO/i,                          relacao: 'TRL', nome: 'Tribunal da Relação de Lisboa' },

  // Comarca de SETÚBAL
  { match: /comarca.*setúbal|comarca.*setubal|tribunal.*setúbal|T8STB|TBSTB/i,
    relacao: 'TRL', nome: 'Tribunal da Relação de Lisboa' },
  // Municípios da Comarca de Setúbal
  { match: /almada|T8ALM/i,                                 relacao: 'TRL', nome: 'Tribunal da Relação de Lisboa' },
  { match: /\bseixal\b|T8SXL/i,                             relacao: 'TRL', nome: 'Tribunal da Relação de Lisboa' },
  { match: /barreiro|T8BRR/i,                               relacao: 'TRL', nome: 'Tribunal da Relação de Lisboa' },
  { match: /montijo|alcochete|moita/i,                       relacao: 'TRL', nome: 'Tribunal da Relação de Lisboa' },
  { match: /palmela|sesimbra|setúbal\b|setubal\b/i,          relacao: 'TRL', nome: 'Tribunal da Relação de Lisboa' },

  // Comarca de SANTARÉM
  { match: /comarca.*santarém|comarca.*santarem|tribunal.*santarém|T8STR|TBSTR/i,
    relacao: 'TRL', nome: 'Tribunal da Relação de Lisboa' },
  { match: /\babrantes\b|tomar|torres.?novas|entroncamento/i, relacao: 'TRL', nome: 'Tribunal da Relação de Lisboa' },

  // Municípios da Comarca de Lisboa Norte
  { match: /sintra|T8SNT|TBSNT/i,                           relacao: 'TRL', nome: 'Tribunal da Relação de Lisboa' },
  { match: /cascais|T8CSC/i,                                relacao: 'TRL', nome: 'Tribunal da Relação de Lisboa' },
  { match: /oeiras|T8OER/i,                                 relacao: 'TRL', nome: 'Tribunal da Relação de Lisboa' },
  { match: /amadora|T8AMD/i,                                relacao: 'TRL', nome: 'Tribunal da Relação de Lisboa' },
  { match: /vila.?franca.?de.?xira|T8VFX/i,                relacao: 'TRL', nome: 'Tribunal da Relação de Lisboa' },
  { match: /\bloures\b/i,                                   relacao: 'TRL', nome: 'Tribunal da Relação de Lisboa' },
  { match: /torres.?vedras|T8TVD/i,                         relacao: 'TRL', nome: 'Tribunal da Relação de Lisboa' },
  { match: /mafra|odivelas/i,                               relacao: 'TRL', nome: 'Tribunal da Relação de Lisboa' },

  // Regiões Autónomas → TRL (LOSJ Anexo I)
  { match: /açores|acores|ponta.?delgada|angra|horta/i,     relacao: 'TRL', nome: 'Tribunal da Relação de Lisboa' },
  { match: /madeira|funchal/i,                              relacao: 'TRL', nome: 'Tribunal da Relação de Lisboa' },

  // ══════════════════════════════════════════════════════════════════
  // TRIBUNAL DA RELAÇÃO DE ÉVORA
  // Comarcas: Évora, Beja, Faro (e Portalegre conforme LOSJ Anexo I)
  // Fonte: TRE + CSM + LOSJ Anexo I
  // ══════════════════════════════════════════════════════════════════

  // Comarca de ÉVORA
  { match: /comarca.*évora|comarca.*evora|tribunal.*évora|T8EVR|TBEVR/i,
    relacao: 'TRE', nome: 'Tribunal da Relação de Évora' },

  // Comarca de BEJA
  { match: /comarca.*beja|tribunal.*beja|T8BJA/i,           relacao: 'TRE', nome: 'Tribunal da Relação de Évora' },

  // Comarca de FARO (inclui Loulé, Tavira, Olhão, Portimão, Lagos, Silves, Albufeira, etc.)
  { match: /comarca.*faro|tribunal.*faro|T8FAR|TBFAR/i,     relacao: 'TRE', nome: 'Tribunal da Relação de Évora' },
  { match: /loulé|loule|T8LLE/i,                            relacao: 'TRE', nome: 'Tribunal da Relação de Évora' },
  { match: /tavira|T8TVR/i,                                 relacao: 'TRE', nome: 'Tribunal da Relação de Évora' },
  { match: /olhão|olhao|T8OLH/i,                            relacao: 'TRE', nome: 'Tribunal da Relação de Évora' },
  { match: /portimão|portimao|T8PTA/i,                      relacao: 'TRE', nome: 'Tribunal da Relação de Évora' },
  { match: /\blagos\b|T8LAG/i,                              relacao: 'TRE', nome: 'Tribunal da Relação de Évora' },
  { match: /silves|albufeira|lagoa|vila.?do.?bispo|aljezur/i, relacao: 'TRE', nome: 'Tribunal da Relação de Évora' },

  // Comarca de PORTALEGRE → TRE (LOSJ Anexo I)
  { match: /comarca.*portalegre|tribunal.*portalegre|T8PTG/i,
    relacao: 'TRE', nome: 'Tribunal da Relação de Évora' },

  // Santiago do Cacém (Comarca de Setúbal, mas área Évora para alguns efeitos — manter TRL)
  // Nota: Santiago do Cacém integra a Comarca de Setúbal → TRL
  { match: /santiago.?do.?cacém|santiago.?do.?cacem/i,      relacao: 'TRL', nome: 'Tribunal da Relação de Lisboa' },
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

function determinarTribunalRecurso(tribunalInput) {
  if (!tribunalInput || typeof tribunalInput !== 'string') return null;
  const t = tribunalInput.trim();
  for (const entry of TRIBUNAL_PARA_RELACAO) {
    if (entry.match.test(t)) {
      if (!entry.relacao) return null;
      return NOMES_RELACAO[entry.relacao] || null;
    }
  }
  return null;
}

function corrigirTribunalRecurso(tribunalRecursoModelo, tribunalPrimeiraInstancia) {
  const correcto = determinarTribunalRecurso(tribunalPrimeiraInstancia);
  if (correcto) return correcto;
  return String(tribunalRecursoModelo || 'Não determinado');
}

// ══════════════════════════════════════════════════════════════════════════════
// VALIDADOR DE NÚMEROS DE PROCESSO (Portaria 280/2013)
// Mapa comarca → letra Relação também corrigido
// ══════════════════════════════════════════════════════════════════════════════

const COMARCA_PARA_RELACAO_LETRA = {
  // → Lisboa (L)
  'LSB': 'L', 'LRN': 'L', 'LRO': 'L', 'SNT': 'L', 'CSC': 'L', 'OER': 'L',
  'VFX': 'L', 'ALM': 'L', 'SXL': 'L', 'BRR': 'L', 'PLM': 'L',
  'STR': 'L', 'ABT': 'L', 'TVD': 'L', 'STB': 'L',
  // → Porto (P)
  'PRT': 'P', 'PTE': 'P', 'VNG': 'P', 'MLD': 'P', 'VLP': 'P', 'PVZ': 'P',
  'VCD': 'P', 'STS': 'P', 'PNF': 'P', 'PRC': 'P', 'FLG': 'P',
  'LUS': 'P', 'ESP': 'P', 'GDM': 'P',
  // Aveiro → Porto (CORRECÇÃO)
  'AVR': 'P', 'STA': 'P', 'OVR': 'P', 'AGD': 'P',
  // → Guimarães (G)
  'BRG': 'G', 'GML': 'G', 'BCL': 'G', 'VCT': 'G',
  'VRL': 'G', 'CHV': 'G',
  // Bragança → Guimarães (CORRECÇÃO)
  'BGC': 'G', 'MCN': 'G',
  // → Coimbra (C)
  'CBR': 'C', 'GRD': 'C', 'CTB': 'C', 'VIS': 'C', 'LRA': 'C',
  'FIG': 'C', 'LMG': 'C',
  // → Évora (E)
  'EVR': 'E', 'BJA': 'E', 'FAR': 'E', 'PTG': 'E', 'LLE': 'E',
  'TVR': 'E', 'OLH': 'E', 'PTA': 'E', 'LAG': 'E',
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
  if (anoReal > anoAtual + 1) resultado.problemas.push(`Ano ${anoReal} improvável (actual: ${anoAtual}). Verifique.`);
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
// MAPA TEXTUAL PARA O PROMPT (texto conciso baseado na LOSJ verificada)
// ══════════════════════════════════════════════════════════════════════════════
const MAPA_RELACOES_PROMPT = `
TRIBUNAIS DE RECURSO — LOSJ (Lei 62/2013) + DL 49/2014 — REGRA ABSOLUTA:

→ TRC (Relação de COIMBRA): Comarcas de Coimbra, Guarda, Castelo Branco, Viseu, Leiria
  CRÍTICO: Comarca da Guarda → SEMPRE TRC. NUNCA TRG, NUNCA TRP.
  Inclui: ULS Guarda, Juízo do Trabalho da Guarda, qualquer tribunal da Comarca da Guarda.

→ TRP (Relação do PORTO): Comarcas do Porto, Porto Este, Aveiro
  ATENÇÃO: Aveiro → TRP (não TRC — erro comum).

→ TRG (Relação de GUIMARÃES): Comarcas de Braga, Bragança, Viana do Castelo, Vila Real
  ATENÇÃO: Bragança e Vila Real → TRG (não TRP — erro comum).
  A Comarca de Braga inclui o município de Guimarães — não existe "Comarca de Guimarães".

→ TRL (Relação de LISBOA): Comarcas de Lisboa, Lisboa Norte, Lisboa Oeste, Setúbal, Santarém
  + Regiões Autónomas dos Açores e da Madeira.

→ TRE (Relação de ÉVORA): Comarcas de Évora, Beja, Faro, Portalegre.
`;

// ══════════════════════════════════════════════════════════════════════════════
// CRITÉRIOS DE ANÁLISE CRÍTICA (10 critérios)
// ══════════════════════════════════════════════════════════════════════════════
const CRITERIOS_CRITICA = `
CRITÉRIOS DE ANÁLISE OBRIGATÓRIOS (aplica TODOS):

1. VÍCIOS FORMAIS (Art. 615.º CPC / Art. 379.º CPP)
   615.º/1/b): falta fundamentação | 615.º/1/c): contradição fundamentos/decisão
   615.º/1/d): omissão ou excesso pronúncia | 615.º/1/e): ultra petita
   379.º CPP: falta menções 374.º | factos diversos acusação | omissão pronúncia
   → Pedido: NULIDADE

2. ERROS DE DIREITO — interpretação errada, norma revogada, violação imperativa

3. ERROS DE FACTO (Art. 662.º CPC / Art. 410.º/2 CPP)
   Cível: ónus art. 640.º (indicar factos, meios prova, decisão alternativa)
   Penal: 410.º/2/a) insuficiência | /b) contradição | /c) erro notório
   → Pedido: REVOGAÇÃO

4. QUESTÕES CONSTITUCIONAIS — Art. 20.º, 32.º, 205.º, 13.º, 18.º CRP

5. ADMISSIBILIDADE E ALÇADA (Art. 629.º CPC)
   Alçada comarca €5.000 | Relação (para STJ) €30.000
   Dupla conforme (art. 671.º/3): Relação confirmou → STJ restrito

6. PRAZOS — Apelação: 30 dias (638.º/1) | Urgente: 15 dias | Penal: 30 dias (411.º CPP)

7. FACTO vs. DIREITO — STJ só conhece direito (art. 674.º/3 CPC)

8. CONHECIMENTO OFICIOSO — incompetência absoluta (97.º), caso julgado (577.º/i), nulidades absolutas CPP (119.º)

9. CONTRADITÓRIO (Art. 3.º/3 CPC) — decisão surpresa, questão não submetida ao contraditório

10. PROPORCIONALIDADE DA PENA (só penal) — Arts. 40.º, 71.º, 72.º, 74.º CP

DISTINÇÃO CRÍTICA: Vícios 615.º/379.º → NULIDADE | Erros julgamento → REVOGAÇÃO | Ambos → MISTO
`;

// ══════════════════════════════════════════════════════════════════════════════
// PARSE JSON ROBUSTO
// ══════════════════════════════════════════════════════════════════════════════
function parseJSON(texto) {
  try {
    const cleaned = texto.replace(/^```json\s*/i,'').replace(/^```\s*/i,'').replace(/\s*```$/i,'').trim();
    return JSON.parse(cleaned);
  } catch {}
  const match = texto.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try { return JSON.parse(match[0]); } catch {}
  try {
    let s = match[0];
    s = s.replace(/,\s*([}\]])/g, '$1');
    s = s.replace(/:\s*"([^"]*?)$/m, ': "$1"');
    let depth = 0;
    for (const c of s) { if (c==='{' || c==='[') depth++; if (c==='}' || c===']') depth--; }
    if (depth > 0) for (let i = 0; i < depth; i++) s += '}';
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

  // ── AUTENTICAÇÃO + PLANO ──
  const authHeader = (req.headers.authorization || '').trim();
  if (!authHeader.startsWith('Bearer ')) return res.status(401).json({ erro: 'Autenticação necessária.' });
  const token = authHeader.replace('Bearer ', '').trim();

  let userPlano = 'gratuito';
  try {
    const authCheck = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { 'Authorization': `Bearer ${token}`, 'apikey': SUPABASE_ANON_KEY },
    });
    if (!authCheck.ok) return res.status(401).json({ erro: 'Sessão inválida ou expirada.' });
    const userData = await authCheck.json().catch(() => null);
    const userId = userData?.id;
    if (userId) {
      // Ir buscar plano do utilizador ao Supabase
      const perfilCheck = await fetch(
        `${SUPABASE_URL}/rest/v1/perfis?id=eq.${userId}&select=plano`,
        { headers: { 'Authorization': `Bearer ${token}`, 'apikey': SUPABASE_ANON_KEY } }
      ).catch(() => null);
      if (perfilCheck?.ok) {
        const perfil = await perfilCheck.json().catch(() => null);
        if (Array.isArray(perfil) && perfil[0]?.plano) {
          userPlano = perfil[0].plano;
        }
      }
    }
  } catch { return res.status(401).json({ erro: 'Erro de autenticação.' }); }

  // ── LIMITES POR PLANO ──
  // Gratuito:          judicial 120k,  académico 200k, crítica 120k
  // Profissional/Inst: judicial 300k,  académico 571k, crítica 300k
  // Admin:             judicial 300k,  académico 200k (testes), crítica 300k — PDF e minuta incluídos
  const isPro   = userPlano === 'profissional' || userPlano === 'institucional';
  const isAdmin = userPlano === 'admin';
  const LIMITE_CHARS           = (isPro || isAdmin) ? 300000 : 120000;
  const LIMITE_CHARS_ACADEMICO = isPro ? 700000 : isAdmin ? 200000 : 200000;
  const LIMITE_CHARS_CRITICA   = (isPro || isAdmin) ? 300000 : 120000;

  // ── CORPO ──
  const body = req.body || {};
  const { texto, modo = 'judicial', tribunal, relator, tipoPeca, instituicao, tipoDoc, orientador, tipoProcesso, parteRecorrente } = body;

  if (modo !== 'minuta' && (!texto || typeof texto !== 'string' || texto.trim().length < 50)) {
    return res.status(400).json({ erro: 'Texto insuficiente. Mínimo 50 caracteres.' });
  }

  const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
  if (!ANTHROPIC_API_KEY) return res.status(500).json({ erro: 'Serviço indisponível.' });

  // ══════════════════════════════════════════════════════
  // SELECÇÃO INTELIGENTE DE TEXTO — limites definidos acima por plano
  // ══════════════════════════════════════════════════════

  function extrairTextoRelevante(txt, modoAnalise) {
    if (!txt) return txt;

    // ── MODO ACADÉMICO ──────────────────────────────────
    // Teses jurídicas têm estrutura previsível:
    //   0-15%  → capa, índice, resumo, introdução (escrita com atenção — menos IA)
    //   15-85% → desenvolvimento, revisão de literatura, argumentação (onde IA aparece)
    //   85-100% → conclusões, bibliografia
    // Estratégia: tentar localizar o início do corpo via marcadores;
    // fallback para 25% do documento se não encontrar marcador.
    if (modoAnalise === 'academico') {
      if (txt.length <= LIMITE_CHARS_ACADEMICO) return txt;

      const MARCADORES_CORPO = [
        /\bCAPÍTULO\s+(?:II|III|IV|2|3|4)\b/i,
        /^\s*2\s*[\.\-–—]\s+[A-ZÁÉÍÓÚÀÂÊÔÃÕÇ]/m,   // "2. Revisão da Literatura"
        /^\s*II\s*[\.\-–—]\s+[A-ZÁÉÍÓÚÀÂÊÔÃÕÇ]/im,
        /\bREVISÃO\s+(?:DA\s+)?LITERATURA\b/i,
        /\bESTADO\s+DA\s+ARTE\b/i,
        /\bENQUADRAMENTO\s+TE[OÓ]RICO\b/i,
        /\bQUADRO\s+TE[OÓ]RICO\b/i,
        /\bFUNDAMENTAÇÃO\s+TE[OÓ]RICA\b/i,
        /\bMETODOLOGIA\b/i,
        /\bDESENVOLVIMENTO\b/i,
      ];

      // Ignorar ocorrências nos primeiros 5% (podem ser do índice)
      const ignorarAte = Math.floor(txt.length * 0.05);

      let inicioCorpor = -1;
      for (const re of MARCADORES_CORPO) {
        const m = re.exec(txt);
        if (m && m.index > ignorarAte) {
          inicioCorpor = m.index;
          break;
        }
      }

      // Fallback: sem marcador → começar a 25% do documento (salta introdução típica)
      if (inicioCorpor === -1) {
        inicioCorpor = Math.floor(txt.length * 0.25);
      }

      const segmento = txt.substring(inicioCorpor, inicioCorpor + LIMITE_CHARS_ACADEMICO);
      const etiqueta = inicioCorpor > Math.floor(txt.length * 0.24)
        ? '[corpo extraído automaticamente via marcador estrutural'
        : '[corpo extraído automaticamente via posição estimada (25%)';

      return `${etiqueta} — posição ${inicioCorpor} de ${txt.length} chars totais]\n\n` + segmento +
             (inicioCorpor + LIMITE_CHARS_ACADEMICO < txt.length
               ? `\n\n[texto truncado — analisados ${LIMITE_CHARS_ACADEMICO} chars a partir da posição ${inicioCorpor}]`
               : '');
    }

    // ── MODO CRÍTICA ────────────────────────────────────
    // Acórdãos são mais curtos; truncagem simples é suficiente.
    if (modoAnalise === 'critica') {
      if (txt.length <= LIMITE_CHARS_CRITICA) return txt;
      return txt.substring(0, LIMITE_CHARS_CRITICA) + '\n[texto truncado — ' + txt.length + ' chars total]';
    }

    // ── MODO JUDICIAL ───────────────────────────────────
    // Lógica original: extrai a fundamentação quando possível.
    if (txt.length <= LIMITE_CHARS) return txt;

    const MARCADORES_FUND = [
      /\bII[\s\-–—]*FUNDAMENTA[CÇ]ÃO\b/i,
      /\bIII[\s\-–—]*FUNDAMENTA[CÇ]ÃO\b/i,
      /\bFUNDAMENTA[CÇ]ÃO\b/i,
      /\bII[\s\-–—]*APRECIANDO\b/i,
      /\bIII[\s\-–—]*APRECIANDO\b/i,
      /\bAPRECIANDO\b/i,
      /\bII[\s\-–—]*FUNDAMENTOS\b/i,
      /\bIII[\s\-–—]*DO DIREITO\b/i,
      /\bDO MÉRITO\b/i,
      /\bDECIDINDO\b/i,
      /\bCONHECENDO DO RECURSO\b/i,
    ];

    const MARCADORES_FIM = [
      /\bIII[\s\-–—]*DECISÃO\b/i,
      /\bIV[\s\-–—]*DECISÃO\b/i,
      /\bDECISÃO\b/i,
      /\bACORDAM\b/i,
      /\bTERMOS EM QUE\b/i,
      /\bPELO EXPOSTO\b/i,
      /\bFACE AO EXPOSTO\b/i,
    ];

    let inicioFund = -1;
    for (const re of MARCADORES_FUND) {
      const m = re.exec(txt);
      if (m && m.index > 200) {
        inicioFund = m.index;
        break;
      }
    }

    if (inicioFund === -1) {
      const meio = Math.floor(txt.length / 2);
      const segmento = txt.substring(meio, meio + LIMITE_CHARS);
      return '[início da fundamentação estimado]\n\n' + segmento +
             '\n[texto truncado — ' + txt.length + ' chars total]';
    }

    let fimFund = txt.length;
    for (const re of MARCADORES_FIM) {
      re.lastIndex = inicioFund + 500;
      const mFim = re.exec(txt.substring(inicioFund + 500));
      if (mFim) {
        const posFim = inicioFund + 500 + mFim.index;
        if (posFim > inicioFund + 1000) { fimFund = posFim; break; }
      }
    }

    const secFund = txt.substring(inicioFund, fimFund);

    if (secFund.length <= LIMITE_CHARS - 2000) {
      const contextoAnterior = txt.substring(Math.max(0, inicioFund - 2000), inicioFund);
      const combined = contextoAnterior + secFund;
      if (combined.length <= LIMITE_CHARS) return combined;
      return combined.substring(0, LIMITE_CHARS) + '\n[texto truncado]';
    }

    return '[fundamentação extraída automaticamente]\n\n' +
           secFund.substring(0, LIMITE_CHARS) +
           '\n[texto truncado — fundamentação com ' + secFund.length + ' chars]';
  }

  const textoTruncado = extrairTextoRelevante(texto || '', modo);

  // ── VALIDAÇÃO LOCAL DE NÚMEROS DE PROCESSO ──
  let validacoesLocais = [];
  if ((modo === 'judicial' || modo === 'academico') && texto) validacoesLocais = extrairEValidarProcessos(texto);

  // ── TRIBUNAL DE RECURSO DETERMINADO LOCALMENTE (para crítica) ──
  const tribunalRecursoLocal = modo === 'critica' ? determinarTribunalRecurso(tribunal) : null;

  let systemPrompt, userPrompt;

  if (modo === 'critica') {
    const ctx = [
      tribunal        ? `Tribunal de 1.ª Instância: ${tribunal}`  : null,
      tipoProcesso    ? `Tipo de processo: ${tipoProcesso}`        : null,
      parteRecorrente ? `Parte recorrente: ${parteRecorrente}`     : null,
    ].filter(Boolean).join('\n');

    const tribunalHint = tribunalRecursoLocal
      ? `\nTRIBUNAL DE RECURSO DETERMINADO PELO SISTEMA (usar OBRIGATORIAMENTE): ${tribunalRecursoLocal}\n`
      : '';

    systemPrompt = `Actua como Consultor Jurídico Sénior especialista em recursos portugueses. Responde APENAS com JSON puro, sem backticks, sem texto antes ou depois.

${MAPA_RELACOES_PROMPT}
${tribunalHint}
${CRITERIOS_CRITICA}

JSON:
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
  "sumario": "Resumo em 2-3 frases.",
  "fundamentos": [{
    "categoria": "nulidade",
    "criterio": 1,
    "tipo": "Nome do vício",
    "artigo": "Art. 615.º/1/d) CPC",
    "gravidade": "grave",
    "prioridade": 1,
    "dificuldade": "facil",
    "conhecimento_oficioso": false,
    "descricao": "Descrição objectiva.",
    "argumento": "Argumento completo."
  }],
  "alerta_contraditorio": "",
  "alerta_alcada": "",
  "alerta_dupla_conforme": "",
  "alerta_facto_vs_direito": "",
  "alerta_proporcionalidade_pena": "",
  "conclusao": "Recomendação com tipo de pedido e prioridade."
}

VALORES: veredicto_recurso: RECURSO_VIAVEL/PARCIAL/INVIAVEL | categoria: nulidade/erro_direito/erro_facto/questao_constitucional | gravidade: grave/moderada/leve | dificuldade: facil/media/dificil | tipo_pedido: nulidade/revogacao/misto | max 6 fundamentos | NUNCA array vazio se há vícios`;

    userPrompt = `${ctx ? `CONTEXTO:\n${ctx}\n\n` : ''}DECISÃO:\n\n${textoTruncado}\n\nAplica os 10 critérios. JSON puro.`;

  } else if (modo === 'minuta') {
    const { fundamentos = [], tribunal_recurso, tipo_pedido, tipoProcesso: tp, parteRecorrente: pr } = body;
    if (!fundamentos.length) return res.status(400).json({ erro: 'Fundamentos em falta.' });

    const ctx = [
      tribunal_recurso ? `Tribunal de recurso: ${tribunal_recurso}` : null,
      tp               ? `Tipo de processo: ${tp}`                  : null,
      pr               ? `Parte recorrente: ${pr}`                  : null,
      tipo_pedido      ? `Tipo de pedido: ${tipo_pedido}`           : null,
    ].filter(Boolean).join('\n');

    const fundamentosTexto = fundamentos.map((f, i) =>
      `${i+1}. [Critério ${f.criterio||'?'}] ${f.tipo} (${f.artigo||''}) — ${f.descricao}\nArgumento: ${f.argumento}${f.conhecimento_oficioso ? '\nNota: pode ser arguido oficiosamente.' : ''}`
    ).join('\n\n');

    const instrucaoPedido = tipo_pedido === 'nulidade'
      ? 'Pedido de NULIDADE: "Termos em que deve a sentença ser declarada nula e substituída por outra que..."'
      : tipo_pedido === 'misto'
      ? 'Pedido MISTO: a) declaração de nulidade quanto aos vícios formais; b) revogação quanto aos erros de julgamento.'
      : 'Pedido de REVOGAÇÃO: "Termos em que deve a sentença ser revogada e substituída por outra que..."';

    systemPrompt = `Actua como Advogado Sénior. Redige proposta TOTALMENTE COMPLETA para recurso em português jurídico formal PT-PT.

REGRAS: Sem markdown. 100% completo até assinatura. Mínimo 5 parágrafos por fundamento. Cita doutrina (Lebre de Freitas, Abrantes Geraldes, Salvador da Costa, Pais de Amaral, Cavaleiro de Ferreira, Figueiredo Dias) com obra e página. Cita jurisprudência com número de processo e tribunal. Mínimo 2500 palavras. ${instrucaoPedido}

ESTRUTURA:
EXMO. SENHOR [JUIZ/DESEMBARGADOR]
DO [TRIBUNAL]
[RECORRENTE] vem interpor RECURSO DE [APELAÇÃO/REVISTA] de [TIPO] n.º [PROCESSO] no [TRIBUNAL A QUO] de [DATA]:
I. ADMISSIBILIDADE (3 parágrafos: legitimidade, prazo, alçada)
II. FUNDAMENTOS (título em MAIÚSCULAS + mínimo 5 parágrafos por fundamento)
III. CONCLUSÕES (numeradas: 1.ª, 2.ª, ...)
IV. PEDIDO
[Local, data] / O Mandatário, / [NOME]`;

    userPrompt = `${ctx ? ctx+'\n\n' : ''}FUNDAMENTOS:\n\n${fundamentosTexto}\n\nProposta COMPLETA em texto simples.`;

  } else if (modo === 'academico' && (tipoDoc === 'Artigo Doutrinário' || tipoDoc === 'Artigo Académico')) {
    // Artigo de opinião/doutrinário — calibração diferente de tese académica
    const dataAnalise = new Date().getFullYear();
    const ctx = [
      instituicao ? `Instituição/Publicação: ${instituicao}` : null,
      tipoDoc     ? `Tipo: ${tipoDoc}`                        : null,
      orientador  ? `Autor: ${orientador}`                    : null,
    ].filter(Boolean).join('\n');

    systemPrompt = `Perito forense em análise linguística de IA em artigos jurídicos doutrinários e de opinião. JSON PURO apenas.

{"veredicto":"IA_DETECTADA","confianca":80,"indicadores":{"perplexidade":75,"burstiness":60,"coesao_artificial":70,"uniformidade_sintatica":65,"riqueza_lexical":55,"marcadores_formulaicos":80},"humanizador_detectado":false,"citacoes_suspeitas":[],"narrativa":"...","relator_analise":"...","marcadores":[{"tipo":"ai","texto":"..."}]}

veredicto: IA_DETECTADA/PROVAVELMENTE_IA/INCONCLUSIVO/PROVAVELMENTE_HUMANO/HUMANO | tipo: ai/humano | indicadores 0-100

citacoes_suspeitas: [{\"citacao\":\"texto exacto da citação conforme aparece no artigo\",\"tipo\":\"acordao|diploma_legal|doutrina|jurisprudencia\",\"problema\":\"...\",\"gravidade\":\"alta|media|baixa\",\"validacao_formato\":\"ok|formato_invalido|nao_aplicavel\"}]

CONTEXTO CRÍTICO: Este é um artigo doutrinário ou de opinião, não uma tese académica. As regras de análise são diferentes:

AUTORIA — foca nestes indicadores:
- Burstiness: artigos humanos têm variação rítmica marcada; IA tende a uniformidade
- Voz autoral: presença de primeira pessoa, ironia, posições pessoais, digressões
- Coesão: transições humanas são irregulares; IA produz encadeamentos demasiado limpos
- Marcadores formulaicos: "É importante notar", "Em conclusão", "Neste contexto" são sinais IA

CITAÇÕES — regras específicas para artigos doutrinários:
- Artigos de opinião PODEM citar eventos recentes (do mesmo ano ou ano anterior) — NÃO é suspeito
- Fontes datadas de ${dataAnalise} são contemporâneas ao artigo — NÃO assinales apenas por data recente
- Fontes de 2025-${dataAnalise} são legítimas em artigos publicados em ${dataAnalise}
- Só assinala citação se: (a) número de processo tem formato manifestamente inválido, (b) atribuição é internamente contraditória, ou (c) a fonte é impossível independentemente da data
- Estatísticas sem fonte concreta identificada podem ser assinaladas como BAIXA gravidade para verificação, não Alta
- NÃO assinales fontes regulatórias recentes (CCBE, CSM, EU) apenas por data — são plausíveis como publicações recentes
- Referências a casos judiciais documentados (Mata v. Avianca, Park v. Kim, Wadsworth v. Walmart) são verificáveis — não assinales
- Referências a casos sem número de processo identificador DEVEM ser assinaladas como BAIXA (nunca MÉDIA ou ALTA) — a ausência de identificador não é por si indício de fabricação, apenas de referência incompleta

PRINCÍPIO: em artigos doutrinários, falsos positivos citacionais são muito piores. Array vazio [] é resposta válida.`;

    userPrompt = `${ctx ? `CONTEXTO:\n${ctx}\n\n` : ''}ARTIGO DOUTRINÁRIO:\n\n${textoTruncado}\n\nJSON puro.`;

  } else if (modo === 'academico') {
    const ctx = [
      instituicao ? `Instituição: ${instituicao}` : null,
      tipoDoc     ? `Tipo: ${tipoDoc}`             : null,
      orientador  ? `Orientador: ${orientador}`    : null,
    ].filter(Boolean).join('\n');

    systemPrompt = `Perito forense em análise linguística de IA em textos académicos jurídicos portugueses. JSON PURO apenas.

{"veredicto":"IA_DETECTADA","confianca":80,"indicadores":{"perplexidade":75,"burstiness":60,"coesao_artificial":70,"uniformidade_sintatica":65,"riqueza_lexical":55,"marcadores_formulaicos":80},"humanizador_detectado":false,"citacoes_suspeitas":[],"narrativa":"...","relator_analise":"...","marcadores":[{"tipo":"ai","texto":"..."}]}

veredicto: IA_DETECTADA/PROVAVELMENTE_IA/INCONCLUSIVO/PROVAVELMENTE_HUMANO/HUMANO | tipo: ai/humano | indicadores 0-100 | humanizador_detectado: true se Quillbot/Undetectable.ai/WordAI

citacoes_suspeitas — ANÁLISE OBRIGATÓRIA de notas de rodapé e bibliografia:
[{"citacao":"...","tipo":"acordao|diploma_legal|doutrina|jurisprudencia","problema":"...","gravidade":"alta|media|baixa","validacao_formato":"ok|formato_invalido|nao_aplicavel"}]

REGRAS CRÍTICAS para citacoes_suspeitas em texto académico:

ACÓRDÃOS (notas de rodapé): assinala se o número de processo tiver formato manifestamente inválido (não segue padrão NNNNN/AA.NTTTTT.XN), ano impossível (anterior a 1990 ou superior ao ano actual +1), ou incoerência comarca/Relação detectável. NÃO assinales por mera dúvida.

DOUTRINA (notas de rodapé e bibliografia): assinala se o autor claramente não existe ou é internamente contraditório, se a obra tem título impossível ou atribuição absurda (ex: Figueiredo Dias como autor de obra de direito civil), ou se edição/data é manifestamente impossível. NÃO assinales apenas por não reconheceres a obra — é normal em textos académicos citar obras menos conhecidas.

DIPLOMAS LEGAIS: NUNCA assinales um diploma legal apenas por incerteza. Só assinala se houver erro POSITIVO e CLARO: formato manifestamente errado (ex: "Lei n.º 0/0000"), contradição interna, ou data de entrada em vigor impossível.

PRINCÍPIO GERAL ACADÉMICO: textos de mestrado/doutoramento contêm habitualmente 20-60 citações bibliográficas legítimas. Em caso de dúvida, NÃO incluas no array. Falsos positivos (assinalar obra correcta) são muito piores do que omitir uma suspeita. Array vazio [] é resposta válida e preferível.

Foca a análise citacional nas notas de rodapé numeradas e na secção de bibliografia/referências bibliográficas.`;

    userPrompt = `${ctx ? `CONTEXTO:\n${ctx}\n\n` : ''}TEXTO:\n\n${textoTruncado}\n\nJSON puro.`;

  } else {
    const ctx = [
      tribunal  ? `Tribunal: ${tribunal}`          : null,
      relator   ? `Relator/Autor: ${relator}`       : null,
      tipoPeca  ? `Tipo de documento: ${tipoPeca}`  : null,
    ].filter(Boolean).join('\n');

    const alertasLocais = validacoesLocais.length > 0
      ? `\n\nALERTAS FORMATO (Portaria 280/2013):\n` +
        validacoesLocais.map(v => `- ${v.numero}: ${v.validacao.problemas.join('; ')}`).join('\n') +
        `\nTrata como citações suspeitas alta gravidade.\n`
      : '';

    systemPrompt = `Perito forense em análise linguística de IA em documentos jurídicos portugueses. Podes analisar decisões judiciais (acórdãos, sentenças, despachos) E peças processuais (petições iniciais, contestações, alegações, recursos, requerimentos, articulados). Adapta a análise ao tipo de documento indicado no contexto. JSON PURO apenas.

{"veredicto":"IA_DETECTADA","confianca":80,"indicadores":{"perplexidade":75,"burstiness":60,"coesao_artificial":70,"uniformidade_sintatica":65,"riqueza_lexical":55,"marcadores_formulaicos":80},"humanizador_detectado":false,"citacoes_suspeitas":[],"narrativa":"...","relator_analise":"...","marcadores":[{"tipo":"ai","texto":"..."}]}

veredicto: IA_DETECTADA/PROVAVELMENTE_IA/INCONCLUSIVO/PROVAVELMENTE_HUMANO/HUMANO | tipo: ai/humano
humanizador_detectado: true se Quillbot/Undetectable.ai/WordAI
citacoes_suspeitas: [{"citacao":"...","tipo":"acordao|diploma_legal|doutrina|jurisprudencia","problema":"...","gravidade":"alta|media|baixa","validacao_formato":"ok|formato_invalido|nao_aplicavel"}]

REGRAS CRÍTICAS PARA citacoes_suspeitas — lê com atenção antes de assinalar:

ACÓRDÃOS: assinala se o número de processo tiver formato manifestamente inválido, ano claramente impossível (anterior a 1990 ou muito futuro, como 2030+), ou incoerência comarca/Relação. A data do acórdão no cabeçalho (ex: 22-04-2026) é legítima — NÃO a uses como sinal suspeito. Um relator identificável no tribunal indicado também não é suspeito. NÃO assinales por dúvida.

DIPLOMAS LEGAIS (leis, decretos-lei, portarias, regulamentos): NUNCA assinales um diploma legal apenas porque não tens certeza se existe. Só assinala se houver evidência POSITIVA e CLARA de erro — por exemplo: número/ano com formato manifestamente errado (ex: "Lei n.º 0/0000"), referência explícita a diploma como "em vigor" quando o próprio texto revela ter sido revogado, ou data de entrada em vigor impossível. Uma lei como "Lei n.º 62/2013" ou "Decreto-Lei n.º 49/2014" é válida até prova em contrário — NÃO a assinales.

DOUTRINA: só assinala se o autor claramente não existe, a obra tem título impossível, ou a atribuição é internamente contraditória. Não assinales por não reconheceres a obra.

PRINCÍPIO GERAL: em caso de dúvida, NÃO incluas no array. É muito pior criar um falso positivo (assinalar algo correcto) do que omitir uma suspeita. Array vazio [] é uma resposta válida e preferível a falsos positivos.

Analisa o corpo do texto. Para DECISÕES JUDICIAIS: analisa a fundamentação. Para PEÇAS PROCESSUAIS (petições, recursos, alegações): analisa o corpo argumentativo — o campo relator_analise deve referir-se ao "perfil de autoria" em vez de "estilo do relator".
Marcadores IA comuns em ambos os tipos: "Neste contexto","Importa salientar","É de referir que","Cumpre referir", parágrafos de comprimento uniforme, transições mecânicas.`;

    const labelDocumento = tipoPeca ? tipoPeca.toUpperCase() : 'DECISÃO JUDICIAL';
    userPrompt = `${ctx ? `CONTEXTO:\n${ctx}\n\n` : ''}${alertasLocais}${labelDocumento}:\n\n${textoTruncado}\n\nJSON puro.`;
  }

  // ── VERIFICAÇÃO WEB DE CITAÇÕES ──
  // Activa apenas para modos judicial e académico, após análise principal.
  // Para cada citação sinalizada, faz uma pesquisa Brave Search e devolve
  // verificacao_web: 'verificada' | 'nao_encontrada' | 'discrepancia' | 'inconclusivo'
  async function verificarCitacaoWeb(citacao, tipo) {
    try {
      // Construir query optimizada por tipo
      let query = citacao.citacao;
      if (tipo === 'acordao' || tipo === 'jurisprudencia') {
        query = `"${citacao.citacao}" site:dgsi.pt OR site:tribunaisnet.mj.pt`;
      } else if (tipo === 'doutrina') {
        query = `${citacao.citacao} filetype:pdf OR site:almedina.net OR site:wook.pt`;
      } else {
        query = `${citacao.citacao} Portugal jurisprudência`;
      }

      const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=3&country=pt&search_lang=pt`;
      const r = await fetch(url, {
        headers: {
          'Accept': 'application/json',
          'Accept-Encoding': 'gzip',
          'X-Subscription-Token': process.env.BRAVE_SEARCH_API_KEY || '',
        },
      });

      if (!r.ok) return 'inconclusivo';

      const data = await r.json();
      const resultados = data?.web?.results || [];

      if (resultados.length === 0) return 'nao_encontrada';

      // Verificar se algum resultado menciona a citação directamente
      const textoResultados = resultados.map(r => (r.title + ' ' + (r.description || '')).toLowerCase()).join(' ');
      const termosChave = citacao.citacao.toLowerCase().split(/\s+/).filter(t => t.length > 4);
      const matches = termosChave.filter(t => textoResultados.includes(t));

      if (matches.length >= Math.ceil(termosChave.length * 0.6)) return 'verificada';
      if (matches.length > 0) return 'inconclusivo';
      return 'nao_encontrada';

    } catch {
      return 'inconclusivo';
    }
  }

  async function verificarCitacoesWeb(citacoes) {
    if (!citacoes || citacoes.length === 0) return citacoes;
    // Se a key não estiver configurada, devolver tudo como nao_verificado sem tentar pesquisa
    if (!process.env.BRAVE_SEARCH_API_KEY) {
      return citacoes.map(c => ({ ...c, verificacao_web: 'nao_verificado' }));
    }
    // Só verificar citações de gravidade alta ou média — baixa não justifica o custo
    const promises = citacoes.map(async (c) => {
      if (c.gravidade === 'baixa') return { ...c, verificacao_web: 'nao_verificado' };
      const resultado = await verificarCitacaoWeb(c, c.tipo);
      return { ...c, verificacao_web: resultado };
    });
    return Promise.all(promises);
  }

  // ── CHAMADA ANTHROPIC com retry + prompt caching ──
  // O system prompt é idêntico em todas as análises do mesmo modo —
  // activar caching reduz o custo de input em ~90% na parte cached.
  const maxTokens = modo === 'minuta' ? 16000 : modo === 'critica' ? 5000 : (modo === 'judicial' || modo === 'academico') ? 3000 : 2000;

  async function chamarAnthropic(tentativa = 1) {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'anthropic-beta': 'prompt-caching-2024-07-31',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: maxTokens,
        temperature: 0,
        system: [
          {
            type: 'text',
            text: systemPrompt,
            cache_control: { type: 'ephemeral' },
          },
        ],
        messages: [{ role: 'user', content: userPrompt }],
      }),
    });
    if (!r.ok) {
      const errText = await r.text().catch(() => '');
      console.error('Anthropic HTTP error:', r.status, errText.substring(0, 200));
      // Retry automático para rate limit (429) e sobrecarga (529)
      if ((r.status === 429 || r.status === 529) && tentativa < 3) {
        const espera = tentativa === 1 ? 12000 : 25000; // 12s, depois 25s
        console.warn(`Anthropic ${r.status} — retry ${tentativa}/2 após ${espera/1000}s`);
        await new Promise(resolve => setTimeout(resolve, espera));
        return chamarAnthropic(tentativa + 1);
      }
      if (r.status === 429 || r.status === 529) {
        throw new Error('Serviço temporariamente sobrecarregado. Aguarde 30 segundos e tente novamente.');
      }
      throw new Error(`Anthropic HTTP ${r.status}`);
    }
    const data = await r.json();
    return (data.content?.[0]?.text || '').trim();
  }

  try {
    let fullText = await chamarAnthropic();
    if (!fullText) return res.status(500).json({ erro: 'Resposta vazia. Tente novamente.' });
    if (modo === 'minuta') return res.status(200).json({ minuta: fullText });

    let parsed = parseJSON(fullText);

    if (!parsed) {
      console.warn('Parse falhou — retry...');
      fullText = await chamarAnthropic();
      parsed = parseJSON(fullText);
    }

    if (!parsed) {
      console.error('Parse falhou após retry. Raw[0-300]:', fullText.substring(0, 300));
      if (modo === 'critica') {
        return res.status(200).json({
          veredicto_recurso: 'RECURSO_INVIAVEL', confianca: 0, admissivel: null,
          alcada_ok: null, dupla_conforme: false, tipo_pedido: 'revogacao',
          tribunal_recurso: tribunalRecursoLocal || 'Não determinado',
          prazo_recurso: 'Consulte um advogado', prazo_expirado: null,
          sumario: 'Erro interno. O texto pode ser extenso ou complexo. Tente novamente ou reduza o texto.',
          fundamentos: [], alerta_contraditorio: '', alerta_alcada: '',
          alerta_dupla_conforme: '', alerta_facto_vs_direito: '',
          alerta_proporcionalidade_pena: '',
          conclusao: 'Análise não concluída por erro interno. Tente novamente.',
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

      parsed.tribunal_recurso = corrigirTribunalRecurso(parsed.tribunal_recurso, tribunal);

      parsed.alerta_contraditorio          = String(parsed.alerta_contraditorio          || '');
      parsed.alerta_alcada                 = String(parsed.alerta_alcada                 || '');
      parsed.alerta_dupla_conforme         = String(parsed.alerta_dupla_conforme         || '');
      parsed.alerta_facto_vs_direito       = String(parsed.alerta_facto_vs_direito       || '');
      parsed.alerta_proporcionalidade_pena = String(parsed.alerta_proporcionalidade_pena || '');

      const items = Array.isArray(parsed.fundamentos)
        ? parsed.fundamentos
        : Array.isArray(parsed.nulidades)
          ? parsed.nulidades.map((n, i) => ({ ...n, categoria: 'nulidade', criterio: 1, prioridade: i+1, dificuldade: 'media' }))
          : [];

      parsed.fundamentos = items.map((f, i) => ({
        categoria:            okCat.includes(f.categoria)                        ? f.categoria              : 'nulidade',
        criterio:             Number(f.criterio) || 1,
        tipo:                 String(f.tipo        || 'Vício Processual'),
        artigo:               String(f.artigo       || ''),
        gravidade:            okGrav.includes((f.gravidade  ||'').toLowerCase()) ? f.gravidade.toLowerCase()  : 'moderada',
        prioridade:           Number(f.prioridade)  || (i+1),
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

      if (modo === 'judicial' || modo === 'academico') {
        const okGravCit    = ['alta','media','baixa'];
        const okTipoCit    = ['acordao','diploma_legal','doutrina','jurisprudencia'];
        const okFormatoCit = ['ok','formato_invalido','nao_aplicavel'];

        let citacoesIA = Array.isArray(parsed.citacoes_suspeitas)
          ? parsed.citacoes_suspeitas.slice(0, 6).map(c => {
              let gravidade = okGravCit.includes(c.gravidade) ? c.gravidade : 'media';
              let problema  = String(c.problema || '');
              // Suavizar falsos positivos de incoerência comarca/tribunal
              // Processos transferidos mantêm número original — não é fabricação
              if (
                gravidade === 'alta' &&
                problema.toLowerCase().includes('pertence') &&
                (problema.toLowerCase().includes('comarca') || problema.toLowerCase().includes('relação'))
              ) {
                gravidade = 'media';
                problema += ' (Nota: pode dever-se a transferência de processo — verifique antes de concluir fabricação.)';
              }
              return {
                citacao:           String(c.citacao  || ''),
                tipo:              okTipoCit.includes(c.tipo) ? c.tipo : 'jurisprudencia',
                problema,
                gravidade,
                validacao_formato: okFormatoCit.includes(c.validacao_formato) ? c.validacao_formato : 'nao_aplicavel',
              };
            })
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
        const citacoesSliced = citacoesIA.slice(0, 8);
        // Verificação web assíncrona — enriquece cada citação com verificacao_web
        parsed.citacoes_suspeitas = await verificarCitacoesWeb(citacoesSliced);
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
