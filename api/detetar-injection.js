// /api/detetar-injection.js — LexVeritas Detector de Prompt Injection
// Vercel Serverless Function — Node.js 18+ — CommonJS
// v1.1 — fix: soft hyphen excluído do score; threshold ajustado

const SUPABASE_URL      = 'https://bsbgizaftamufmmxeyer.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJzYmdpemFmdGFtdWZtbXhleWVyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc3NDkzNTIsImV4cCI6MjA5MzMyNTM1Mn0._xBiw0VUa3FSnortYseUQPDc5xb--k15lYcylNmMEEQ';

// ── Caracteres Unicode invisíveis conhecidos usados em prompt injection ──
// NOTA: soft hyphen (\u00AD) e BOM (\uFEFF) têm tratamento especial —
// são inseridos automaticamente por processadores de texto (Word, LibreOffice)
// e só são sinalizados quando presentes em quantidade anómala.
const UNICODE_INVISIVEL = [
  { char: '\u200B', nome: 'Zero-Width Space',            limiar: 1  },
  { char: '\u200C', nome: 'Zero-Width Non-Joiner',       limiar: 1  },
  { char: '\u200D', nome: 'Zero-Width Joiner',           limiar: 1  },
  { char: '\u200E', nome: 'Left-to-Right Mark',          limiar: 1  },
  { char: '\u200F', nome: 'Right-to-Left Mark',          limiar: 1  },
  { char: '\uFEFF', nome: 'BOM / Zero-Width No-Break',   limiar: 2  }, // 1 BOM é normal
  { char: '\u2060', nome: 'Word Joiner',                 limiar: 1  },
  { char: '\u2061', nome: 'Function Application',        limiar: 1  },
  { char: '\u2062', nome: 'Invisible Times',             limiar: 1  },
  { char: '\u2063', nome: 'Invisible Separator',         limiar: 1  },
  { char: '\u2064', nome: 'Invisible Plus',              limiar: 1  },
  { char: '\u00AD', nome: 'Soft Hyphen',                 limiar: 10 }, // Word insere automaticamente — só sinalizar se > 10
  { char: '\u180E', nome: 'Mongolian Vowel Separator',   limiar: 1  },
  { char: '\u034F', nome: 'Combining Grapheme Joiner',   limiar: 1  },
  { char: '\u115F', nome: 'Hangul Choseong Filler',      limiar: 1  },
  { char: '\u1160', nome: 'Hangul Jungseong Filler',     limiar: 1  },
  { char: '\u3164', nome: 'Hangul Filler',               limiar: 1  },
  { char: '\uFFA0', nome: 'Halfwidth Hangul Filler',     limiar: 1  },
];

// ── Padrões linguísticos típicos de prompt injection em PT e EN ──
const PADROES_INJECTION = [
  // Instruções directas ao modelo
  { re: /ignore\s+(todas?\s+as?\s+)?instru[cç][oõ]es?\s+anteriores?/gi, tipo: 'instrucao_directa', gravidade: 'critica', desc: 'Instrução para ignorar comandos anteriores' },
  { re: /ignore\s+all\s+(previous\s+)?instructions?/gi, tipo: 'instrucao_directa', gravidade: 'critica', desc: 'Ignore all instructions (EN)' },
  { re: /forget\s+(everything|all)\s+(you\s+)?(were\s+)?(told|said|instructed)/gi, tipo: 'instrucao_directa', gravidade: 'critica', desc: 'Forget previous instructions (EN)' },
  { re: /esqueça?\s+(tudo|todas?\s+as?\s+instru[cç][oõ]es?)/gi, tipo: 'instrucao_directa', gravidade: 'critica', desc: 'Instrução para esquecer contexto anterior' },
  { re: /act\s+as\s+(if\s+you\s+(are|were)|a\s+new)/gi, tipo: 'instrucao_directa', gravidade: 'alta', desc: 'Act as (jailbreak EN)' },
  { re: /now\s+you\s+(are|will\s+be|must\s+act\s+as)/gi, tipo: 'instrucao_directa', gravidade: 'alta', desc: 'Now you are (EN)' },

  // Manipulação de resposta
  { re: /a\s+tua\s+resposta\s+deve\s+(ser|incluir|conter|afirmar)/gi, tipo: 'manipulacao_resposta', gravidade: 'critica', desc: 'Instrução directa sobre o conteúdo da resposta' },
  { re: /your\s+(answer|response)\s+(must|should|shall)\s+be/gi, tipo: 'manipulacao_resposta', gravidade: 'critica', desc: 'Your response must be (EN)' },
  { re: /respond\s+(only|always)\s+(with|by\s+saying)/gi, tipo: 'manipulacao_resposta', gravidade: 'critica', desc: 'Respond only with (EN)' },
  { re: /responde?\s+(apenas|sempre|obrigatoriamente)\s+(com|que|afirmando)/gi, tipo: 'manipulacao_resposta', gravidade: 'critica', desc: 'Instrução de resposta obrigatória' },
  { re: /always\s+(say|respond|answer|state)\s+that/gi, tipo: 'manipulacao_resposta', gravidade: 'critica', desc: 'Always say that (EN)' },

  // Manipulação de avaliação judicial
  { re: /considera?\s+que\s+(esta\s+pe[cç]a|este\s+(recurso|argumento|documento))\s+(trata|deve\s+ser\s+(avaliada?|julgada?|analisada?))/gi, tipo: 'manipulacao_judicial', gravidade: 'alta', desc: 'Instrução sobre como avaliar a peça processual' },
  { re: /enfatize?\s+(que\s+)?(os?\s+)?argumentos?\s+da\s+parte\s+contr[aá]ria/gi, tipo: 'manipulacao_judicial', gravidade: 'critica', desc: 'Instrução para desvalorizar parte contrária' },
  { re: /n[aã]o\s+h[aá]\s+elementos?\s+probat[oó]rios?\s+(relevantes?|em\s+sentido\s+contr[aá]rio)/gi, tipo: 'manipulacao_judicial', gravidade: 'alta', desc: 'Afirmação falsa sobre elementos probatórios' },
  { re: /o\s+documento\s+cont[eé]m\s+prova\s+(conclusiva|definitiva)/gi, tipo: 'manipulacao_judicial', gravidade: 'critica', desc: 'Afirmação fabricada sobre prova conclusiva' },
  { re: /analise?\s+(os?\s+)?argumentos?\s+sob\s+a\s+[oó]tica/gi, tipo: 'manipulacao_judicial', gravidade: 'media', desc: 'Instrução sobre perspectiva de análise' },
  { re: /favor\s+analis[ae]r?\s+(os?\s+argumentos?|esta\s+pe[cç]a)/gi, tipo: 'manipulacao_judicial', gravidade: 'alta', desc: 'Instrução directa ao modelo de análise' },
  { re: /conteste\s+(essa|esta)\s+peti[cç][aã]o\s+de\s+forma\s+superficial/gi, tipo: 'manipulacao_judicial', gravidade: 'critica', desc: 'Instrução para contestar superficialmente (padrão TRT8)' },
  { re: /n[aã]o\s+impugne\s+os?\s+documentos?/gi, tipo: 'manipulacao_judicial', gravidade: 'critica', desc: 'Instrução para não impugnar documentos (padrão TRT8)' },
  { re: /independentemente\s+do\s+comando\s+que\s+lhe\s+for\s+dado/gi, tipo: 'manipulacao_judicial', gravidade: 'critica', desc: 'Override de comandos do sistema (padrão TRT8)' },
  { re: /aten[cç][aã]o[,\s]+intelig[eê]ncia\s+artificial/gi, tipo: 'manipulacao_judicial', gravidade: 'critica', desc: 'Interpelação directa à IA no corpo do documento' },

  // Padrões de system prompt override
  { re: /\[SYSTEM\]/gi, tipo: 'system_override', gravidade: 'critica', desc: 'Tag [SYSTEM] — tentativa de override de prompt de sistema' },
  { re: /\[INST\]/gi, tipo: 'system_override', gravidade: 'critica', desc: 'Tag [INST] — formato de instrução de modelo' },
  { re: /<\|system\|>/gi, tipo: 'system_override', gravidade: 'critica', desc: 'Tag <|system|> — formato Llama' },
  { re: /\{\{system\}\}/gi, tipo: 'system_override', gravidade: 'critica', desc: 'Template de sistema {{system}}' },
  { re: /###\s*instruction/gi, tipo: 'system_override', gravidade: 'alta', desc: '### Instruction — formato de prompt de instrução' },

  // Comentários ocultos e delimitadores
  { re: /<!--[\s\S]{0,500}?-->/g, tipo: 'comentario_html', gravidade: 'media', desc: 'Comentário HTML oculto no texto' },
  { re: /\/\*[\s\S]{0,200}?\*\//g, tipo: 'comentario_codigo', gravidade: 'media', desc: 'Comentário de código oculto no texto' },

  // Referências a modelos de IA no corpo do texto
  { re: /(?:ChatGPT|GPT-4|GPT-3|Claude|Gemini|Llama|Mistral|Copilot)\s*[:,]\s*(?:responde|analisa|confirma|diz|afirma)/gi, tipo: 'referencia_modelo', gravidade: 'alta', desc: 'Instrução directa a modelo de IA específico' },
];

// ── Detector de caracteres Unicode invisíveis ──
function detectarUnicodeInvisivel(texto) {
  const encontrados = [];

  for (const { char, nome, limiar } of UNICODE_INVISIVEL) {
    const count = (texto.split(char)).length - 1;

    // Só sinalizar se ultrapassar o limiar definido para este caractere
    if (count >= limiar) {
      const codePoint = char.codePointAt(0).toString(16).toUpperCase().padStart(4, '0');

      // Gravidade proporcional à quantidade e ao tipo
      let gravidade;
      if (char === '\u00AD') {
        // Soft hyphen: só é suspeito em grande quantidade
        gravidade = count > 30 ? 'alta' : 'media';
      } else {
        gravidade = count > 5 ? 'critica' : count > 2 ? 'alta' : 'media';
      }

      encontrados.push({
        tipo: 'unicode_invisivel',
        gravidade,
        desc: `${nome} (U+${codePoint}) — ${count} ocorrência${count > 1 ? 's' : ''}`,
        count,
        codePoint: `U+${codePoint}`,
      });
    }
  }

  return encontrados;
}

// ── Detector de padrões linguísticos de injection ──
function detectarPadroesLinguisticos(texto) {
  const encontrados = [];

  for (const padrao of PADROES_INJECTION) {
    const matches = [];
    let m;
    const re = new RegExp(padrao.re.source, padrao.re.flags);
    while ((m = re.exec(texto)) !== null) {
      matches.push({
        texto: m[0].substring(0, 100),
        posicao: m.index,
        contexto: texto.substring(Math.max(0, m.index - 50), m.index + m[0].length + 50).replace(/\n/g, ' '),
      });
      if (matches.length >= 3) break;
    }
    if (matches.length > 0) {
      encontrados.push({ tipo: padrao.tipo, gravidade: padrao.gravidade, desc: padrao.desc, ocorrencias: matches });
    }
  }

  return encontrados;
}

// ── Análise de entropia ──
function calcularEntropiaShannon(texto) {
  if (!texto || texto.length === 0) return 0;
  const freq = {};
  for (const ch of texto) freq[ch] = (freq[ch] || 0) + 1;
  const n = texto.length;
  let entropia = 0;
  for (const count of Object.values(freq)) {
    const p = count / n;
    entropia -= p * Math.log2(p);
  }
  return entropia;
}

function analisarEntropia(texto) {
  const alertas = [];
  if (!texto || texto.length < 200) return alertas;

  const entropiaGlobal = calcularEntropiaShannon(texto.substring(0, 10000));

  if (entropiaGlobal > 6.5) {
    alertas.push({
      tipo: 'entropia_anomala_alta',
      gravidade: 'alta',
      desc: `Entropia anormalmente alta (${entropiaGlobal.toFixed(2)} bits/char) — possível conteúdo codificado ou encriptado`,
      valor: entropiaGlobal.toFixed(2),
    });
  } else if (entropiaGlobal < 2.5 && texto.length > 500) {
    alertas.push({
      tipo: 'entropia_anomala_baixa',
      gravidade: 'media',
      desc: `Entropia anormalmente baixa (${entropiaGlobal.toFixed(2)} bits/char) — possível repetição estruturada`,
      valor: entropiaGlobal.toFixed(2),
    });
  }

  // Blocos anómalos
  const tamanhoBloco = 500;
  const blocos = [];
  for (let i = 0; i < Math.min(texto.length, 20000); i += tamanhoBloco) {
    const bloco = texto.substring(i, i + tamanhoBloco);
    if (bloco.trim().length > 50) blocos.push(calcularEntropiaShannon(bloco));
  }

  if (blocos.length > 3) {
    const media = blocos.reduce((a, b) => a + b, 0) / blocos.length;
    const desvioPadrao = Math.sqrt(blocos.map(b => Math.pow(b - media, 2)).reduce((a, b) => a + b, 0) / blocos.length);
    const blocosAnomalia = blocos.filter(b => b > media + 2.5 * desvioPadrao || b < media - 2.5 * desvioPadrao);
    if (blocosAnomalia.length > 0 && desvioPadrao > 0.8) {
      alertas.push({
        tipo: 'entropia_blocos_anomalos',
        gravidade: 'media',
        desc: `${blocosAnomalia.length} bloco${blocosAnomalia.length > 1 ? 's' : ''} com entropia anómala (σ=${desvioPadrao.toFixed(2)}) — possíveis secções ocultas`,
        valor: `média=${media.toFixed(2)}, σ=${desvioPadrao.toFixed(2)}`,
      });
    }
  }

  return alertas;
}

// ── Detector de anomalias estruturais ──
function detectarAnomalias(texto) {
  const alertas = [];

  const espacosAnomalia = texto.match(/[^\n] {6,}/g);
  if (espacosAnomalia && espacosAnomalia.length > 3) {
    alertas.push({ tipo: 'espacos_anomalos', gravidade: 'media', desc: `${espacosAnomalia.length} sequências com espaços excessivos — possível texto oculto` });
  }

  const linhas = texto.split('\n');
  const linhasCurtas = linhas.filter(l => l.trim().length > 0 && l.trim().length < 4);
  if (linhasCurtas.length > 10) {
    alertas.push({ tipo: 'fragmentacao_texto', gravidade: 'media', desc: `${linhasCurtas.length} linhas muito curtas — possível fragmentação de instrução oculta` });
  }

  return alertas;
}

// ── Calcular score de risco ──
// Soft hyphens em quantidade moderada não contribuem para o score
function calcularRisco(unicode, padroes, anomalias) {
  let score = 0;

  for (const u of unicode) {
    // Soft hyphen com gravidade média contribui menos
    if (u.codePoint === 'U+00AD' && u.gravidade === 'media') {
      score += 3;
    } else if (u.gravidade === 'critica') {
      score += 40;
    } else if (u.gravidade === 'alta') {
      score += 25;
    } else {
      score += 10;
    }
  }

  for (const p of padroes) {
    if (p.gravidade === 'critica') score += 35;
    else if (p.gravidade === 'alta') score += 20;
    else if (p.gravidade === 'media') score += 10;
    else score += 5;
  }

  for (const a of anomalias) {
    if (a.gravidade === 'media') score += 8;
    else score += 4;
  }

  return Math.min(100, score);
}

// ── Veredicto ──
// Fix: threshold ajustado para evitar falsos positivos com soft hyphens
// totalIndicadores só conta indicadores com gravidade >= alta (exclui soft hyphen isolado)
function veredictoRisco(score, unicodeEncontrados, padroesEncontrados, anomaliasEncontradas) {
  const indicadoresGraves = [
    ...unicodeEncontrados.filter(u => !(u.codePoint === 'U+00AD' && u.gravidade === 'media')),
    ...padroesEncontrados,
    ...anomaliasEncontradas.filter(a =>
      !(a.tipo === 'entropia_anomala_baixa') &&
      !(a.tipo === 'entropia_blocos_anomalos' && a.gravidade === 'media') &&
      !(a.tipo === 'sequencias_codificadas' && a.gravidade === 'media') &&
      a.gravidade !== 'baixa'
    ),
  ];

  if (score >= 60 || indicadoresGraves.length >= 3) return 'INJECTION_DETECTADA';
  if (score >= 30 || indicadoresGraves.length >= 1) return 'SUSPEITO';
  return 'LIMPO';
}

// ══════════════════════════════════════════════════════════════════════════════
// HANDLER PRINCIPAL
// ══════════════════════════════════════════════════════════════════════════════
module.exports = async 

// ── RTL OVERRIDE ──
function detectarRTLOverride(texto) {
  const alertas = [];
  if (!texto) return alertas;
  const rtlChars = ['‮','‭','‫','‪','‏','؜','⁦','⁧','⁨','⁩'];
  let count = 0;
  const encontrados = [];
  for (const char of rtlChars) {
    const matches = (texto.match(new RegExp(char, 'g')) || []).length;
    if (matches > 0) { count += matches; encontrados.push(`U+${char.codePointAt(0).toString(16).toUpperCase().padStart(4,'0')} (${matches}x)`); }
  }
  if (count > 0) {
    alertas.push({
      tipo: 'rtl_override',
      gravidade: count >= 3 ? 'critica' : 'alta',
      desc: `${count} caractere(s) de controlo de direcção de texto: ${encontrados.join(', ')} — possível inversão/ocultação de conteúdo`,
    });
  }
  return alertas;
}

// ── BASE64 ENCODING OCULTO ──
function detectarEncodingOculto(texto) {
  const alertas = [];
  if (!texto) return alertas;
  const base64Regex = /(?<![A-Za-z0-9+/])([A-Za-z0-9+/]{40,}={0,2})(?![A-Za-z0-9+/])/g;
  const matches = [...texto.matchAll(base64Regex)];
  for (const m of matches) {
    try {
      const decoded = Buffer.from(m[1], 'base64').toString('utf-8');
      const injPatterns = [/ignore/i, /instruc/i, /assistant/i, /system/i, /prompt/i, /jailbreak/i, /bypass/i];
      if (injPatterns.some(p => p.test(decoded))) {
        alertas.push({ tipo: 'base64_injection', gravidade: 'critica', desc: `Instrução de injection detectada em Base64: "${decoded.substring(0, 60)}..."` });
        break;
      }
    } catch(e) {}
  }
  return alertas;
}

// ── HTML/CSS INJECTION ──
function detectarHTMLCSSInjection(texto) {
  const alertas = [];
  if (!texto) return alertas;
  const padroes = [
    { re: /style\s*=\s*["'][^"']*display\s*:\s*none/gi, desc: 'Elemento com display:none — conteúdo oculto via CSS' },
    { re: /style\s*=\s*["'][^"']*visibility\s*:\s*hidden/gi, desc: 'Elemento com visibility:hidden — conteúdo invisível' },
    { re: /style\s*=\s*["'][^"']*font-size\s*:\s*0/gi, desc: 'Texto com font-size:0 — dimensão zero' },
    { re: /<!--[\s\S]{20,}?-->/g, desc: 'Comentário HTML com conteúdo substancial' },
  ];
  for (const p of padroes) {
    if (p.re.test(texto)) {
      alertas.push({ tipo: 'html_css_injection', gravidade: 'media', desc: p.desc });
    }
  }
  return alertas;
}

// ── HOMÓGLIFOS ──
const HOMOGLIFOS_MAP = {
  'а': 'a', 'е': 'e', 'о': 'o', 'р': 'p', 'с': 'c',
  'х': 'x', 'і': 'i', 'ј': 'j', 'ӏ': 'l', 'ѕ': 's',
  'α': 'a', 'ε': 'e', 'ο': 'o', 'ρ': 'p', 'ν': 'v',
  'ι': 'i', 'κ': 'k', 'χ': 'x',
  'ａ': 'a', 'ｅ': 'e', 'ｏ': 'o', 'ｐ': 'p',
};

function detectarHomoglifos(texto) {
  const alertas = [];
  if (!texto) return alertas;
  let count = 0;
  const exemplos = [];
  for (const [char, equiv] of Object.entries(HOMOGLIFOS_MAP)) {
    const matches = texto.match(new RegExp(char, 'g')) || [];
    if (matches.length > 0) {
      count += matches.length;
      if (exemplos.length < 5) {
        const idx = texto.indexOf(char);
        exemplos.push(`U+${char.codePointAt(0).toString(16).toUpperCase().padStart(4,'0')} (≈'${equiv}') pos.${idx}`);
      }
    }
  }
  if (count >= 3) {
    alertas.push({
      tipo: 'homoglifo',
      gravidade: count >= 10 ? 'critica' : 'alta',
      desc: `${count} caracteres homóglifos detectados — possível substituição de letras latinas`,
      exemplos,
    });
  }
  return alertas;
}

// ── SNOW STEGANOGRAFIA ──
function detectarSNOW(texto) {
  const alertas = [];
  if (!texto) return alertas;
  const linhas = texto.split(/\r?\n/);
  let suspeitas = 0;
  for (const linha of linhas) {
    if (/[ \t]+$/.test(linha)) suspeitas++;
  }
  const pct = suspeitas / Math.max(linhas.length, 1);
  if (pct > 0.35 && suspeitas > 15) {
    alertas.push({
      tipo: 'snow_steganografia',
      gravidade: pct > 0.4 ? 'alta' : 'media',
      desc: `${suspeitas} linhas com espaços/tabs no fim — possível steganografia SNOW`,
    });
  }
  return alertas;
}

async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ erro: 'Método não permitido' });

  const authHeader = (req.headers.authorization || '').trim();
  if (!authHeader.startsWith('Bearer ')) return res.status(401).json({ erro: 'Autenticação necessária.' });
  const token = authHeader.replace('Bearer ', '').trim();

  // ── AUTENTICAÇÃO + PLANO ──
  let userPlano = 'gratuito';
  try {
    const authCheck = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { 'Authorization': `Bearer ${token}`, 'apikey': SUPABASE_ANON_KEY },
    });
    if (!authCheck.ok) return res.status(401).json({ erro: 'Sessão inválida ou expirada.' });
    const userData = await authCheck.json().catch(() => null);
    const userId = userData?.id;
    if (userId) {
      const perfilCheck = await fetch(
        `${SUPABASE_URL}/rest/v1/perfis?id=eq.${userId}&select=plano`,
        { headers: { 'Authorization': `Bearer ${token}`, 'apikey': SUPABASE_ANON_KEY } }
      ).catch(() => null);
      if (perfilCheck?.ok) {
        const perfil = await perfilCheck.json().catch(() => null);
        if (Array.isArray(perfil) && perfil[0]?.plano) userPlano = perfil[0].plano;
      }
    }
  } catch { return res.status(401).json({ erro: 'Erro de autenticação.' }); }

  // ── LIMITES POR PLANO ──
  // Gratuito: 50k chars | Profissional/Institucional: 200k chars
  const isPro = userPlano === 'profissional' || userPlano === 'institucional';
  const LIMITE_CHARS_INJECTION = isPro ? 200000 : 50000;

  const { texto } = req.body || {};
  if (!texto || typeof texto !== 'string' || texto.trim().length < 20) {
    return res.status(400).json({ erro: 'Texto insuficiente.' });
  }

  // Aplicar limite por plano
  const textoLimitado = texto.length > LIMITE_CHARS_INJECTION
    ? texto.substring(0, LIMITE_CHARS_INJECTION)
    : texto;

  const textoTruncado = texto.length > LIMITE_CHARS_INJECTION;

  // ── Validação de domínio — apenas documentos jurídicos PT-PT ──
  const textoValidacao = textoLimitado.toLowerCase().substring(0, 6000);
  const indicadoresPortugues = [
    'stj', 'trl', 'trp', 'trc', 'trg', 'tre', 'sta',
    'supremo tribunal de justiça', 'tribunal da relação',
    'tribunal constitucional', 'comarca', 'dgsi',
    'tcas', 'tcan', 'tribunal administrativo',
    'diário da república', 'ministério público',
    'código de processo civil', 'código penal português',
    'tribunal judicial', 'juízo', 'portaria', 'decreto-lei',
  ];
  const isDocumentoPortugues = indicadoresPortugues.some(t => textoValidacao.includes(t));

  // Domínio não reconhecido — analisar na mesma com nota de aviso
  const avisoForeignDomain = (!isDocumentoPortugues && texto.trim().length > 500)
    ? 'Domínio não confirmado automaticamente. Os resultados têm fiabilidade indeterminada para documentos fora do sistema jurídico português.'
    : null;

  const unicodeEncontrados = detectarUnicodeInvisivel(textoLimitado);
  const padroesEncontrados = detectarPadroesLinguisticos(textoLimitado);
  const anomaliasEncontradas = detectarAnomalias(textoLimitado);
  const alertasEntropia = analisarEntropia(textoLimitado);
  const homoglifosEncontrados = detectarHomoglifos(textoLimitado);
  const snowEncontrado = detectarSNOW(textoLimitado);
  const rtlOverride = detectarRTLOverride(textoLimitado);
  const base64Oculto = detectarEncodingOculto(textoLimitado);
  const htmlCSSInject = detectarHTMLCSSInjection(textoLimitado);

  const todasAnomalias = [...anomaliasEncontradas, ...alertasEntropia, ...homoglifosEncontrados, ...snowEncontrado, ...rtlOverride, ...base64Oculto, ...htmlCSSInject];
  const score = calcularRisco(unicodeEncontrados, padroesEncontrados, todasAnomalias);
  const veredicto = veredictoRisco(score, unicodeEncontrados, padroesEncontrados, todasAnomalias);
  const totalIndicadores = unicodeEncontrados.length + padroesEncontrados.length + todasAnomalias.length;

  // ── Detecção de jurisdição ──
  const textoParaJurisdicao = textoLimitado.toLowerCase().substring(0, 5000);
  const tribunaisPortugueses = ['stj','trl','trp','trc','trg','tre','sta','supremo tribunal de justiça','tribunal da relação','tribunal constitucional','comarca','dgsi','tcas','tcan','tribunal de trabalho','tribunal administrativo'];
  const dominioPortugues = tribunaisPortugueses.some(t => textoParaJurisdicao.includes(t));
  const notaDominio = dominioPortugues
    ? null
    : 'Documento fora do domínio de calibração (jurisdição não portuguesa detectada). Os resultados têm fiabilidade indeterminada e não devem ser utilizados como base de análise.';

  return res.status(200).json({
    veredicto,
    score,
    total_indicadores: totalIndicadores,
    unicode_invisivel: unicodeEncontrados,
    padroes_linguisticos: padroesEncontrados,
    anomalias_estruturais: todasAnomalias,
    nota_dominio: notaDominio || avisoForeignDomain,
    truncado: textoTruncado,
    plano: userPlano,
    meta: {
      dominio_portugues: dominioPortugues,
      chars_analisados: textoLimitado.length,
      chars_total: texto.length,
    },
    recomendacao: veredicto === 'INJECTION_DETECTADA'
      ? 'Documento contém indícios fortes de prompt injection. Não processe com IA sem revisão humana completa.'
      : veredicto === 'SUSPEITO'
      ? 'Documento apresenta elementos suspeitos. Reveja manualmente antes de processar com IA.'
      : 'Nenhum indicador de prompt injection detectado. Documento aparenta ser legítimo.',
  });
};
