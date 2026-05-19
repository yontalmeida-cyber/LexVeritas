// /api/detetar-injection-pdf.js — LexVeritas Detector de Prompt Injection (PDF bytes brutos)
// Vercel Serverless Function — Node.js 18+ — CommonJS
// v1.3 — XObject forms recursivos; análise de entropia; metadados; camadas ocultas

const zlib = require('zlib');
const { promisify } = require('util');
const inflateRaw = promisify(zlib.inflateRaw);
const inflate    = promisify(zlib.inflate);

const SUPABASE_URL      = 'https://bsbgizaftamufmmxeyer.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJzYmdpemFmdGFtdWZtbXhleWVyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc3NDkzNTIsImV4cCI6MjA5MzMyNTM1Mn0._xBiw0VUa3FSnortYseUQPDc5xb--k15lYcylNmMEEQ';

// ── Caracteres Unicode invisíveis com limiar de sinalização ──
const UNICODE_INVISIVEL = [
  { char: '\u200B', nome: 'Zero-Width Space',          limiar: 1  },
  { char: '\u200C', nome: 'Zero-Width Non-Joiner',     limiar: 1  },
  { char: '\u200D', nome: 'Zero-Width Joiner',         limiar: 1  },
  { char: '\u200E', nome: 'Left-to-Right Mark',        limiar: 1  },
  { char: '\u200F', nome: 'Right-to-Left Mark',        limiar: 1  },
  { char: '\uFEFF', nome: 'BOM / Zero-Width No-Break', limiar: 2  },
  { char: '\u2060', nome: 'Word Joiner',               limiar: 1  },
  { char: '\u2061', nome: 'Function Application',      limiar: 1  },
  { char: '\u2062', nome: 'Invisible Times',           limiar: 1  },
  { char: '\u2063', nome: 'Invisible Separator',       limiar: 1  },
  { char: '\u2064', nome: 'Invisible Plus',            limiar: 1  },
  { char: '\u00AD', nome: 'Soft Hyphen',               limiar: 10 }, // Word insere automaticamente
  { char: '\u180E', nome: 'Mongolian Vowel Separator', limiar: 1  },
  { char: '\u034F', nome: 'Combining Grapheme Joiner', limiar: 1  },
  { char: '\u115F', nome: 'Hangul Choseong Filler',    limiar: 1  },
  { char: '\u1160', nome: 'Hangul Jungseong Filler',   limiar: 1  },
  { char: '\u3164', nome: 'Hangul Filler',             limiar: 1  },
  { char: '\uFFA0', nome: 'Halfwidth Hangul Filler',   limiar: 1  },
];

// ── Padrões linguísticos de injection ──
const PADROES_INJECTION = [
  { re: /ignore\s+(todas?\s+as?\s+)?instru[cç][oõ]es?\s+anteriores?/gi, tipo: 'instrucao_directa', gravidade: 'critica', desc: 'Instrução para ignorar comandos anteriores' },
  { re: /ignore\s+all\s+(previous\s+)?instructions?/gi, tipo: 'instrucao_directa', gravidade: 'critica', desc: 'Ignore all instructions (EN)' },
  { re: /forget\s+(everything|all)\s+(you\s+)?(were\s+)?(told|said|instructed)/gi, tipo: 'instrucao_directa', gravidade: 'critica', desc: 'Forget previous instructions (EN)' },
  { re: /esqueça?\s+(tudo|todas?\s+as?\s+instru[cç][oõ]es?)/gi, tipo: 'instrucao_directa', gravidade: 'critica', desc: 'Instrução para esquecer contexto anterior' },
  { re: /act\s+as\s+(if\s+you\s+(are|were)|a\s+new)/gi, tipo: 'instrucao_directa', gravidade: 'alta', desc: 'Act as (jailbreak EN)' },
  { re: /now\s+you\s+(are|will\s+be|must\s+act\s+as)/gi, tipo: 'instrucao_directa', gravidade: 'alta', desc: 'Now you are (EN)' },
  { re: /a\s+tua\s+resposta\s+deve\s+(ser|incluir|conter|afirmar)/gi, tipo: 'manipulacao_resposta', gravidade: 'critica', desc: 'Instrução directa sobre o conteúdo da resposta' },
  { re: /your\s+(answer|response)\s+(must|should|shall)\s+be/gi, tipo: 'manipulacao_resposta', gravidade: 'critica', desc: 'Your response must be (EN)' },
  { re: /respond\s+(only|always)\s+(with|by\s+saying)/gi, tipo: 'manipulacao_resposta', gravidade: 'critica', desc: 'Respond only with (EN)' },
  { re: /responde?\s+(apenas|sempre|obrigatoriamente)\s+(com|que|afirmando)/gi, tipo: 'manipulacao_resposta', gravidade: 'critica', desc: 'Instrução de resposta obrigatória' },
  { re: /always\s+(say|respond|answer|state)\s+that/gi, tipo: 'manipulacao_resposta', gravidade: 'critica', desc: 'Always say that (EN)' },
  { re: /considera?\s+que\s+(esta\s+pe[cç]a|este\s+(recurso|argumento|documento))\s+(trata|deve\s+ser\s+(avaliada?|julgada?|analisada?))/gi, tipo: 'manipulacao_judicial', gravidade: 'alta', desc: 'Instrução sobre como avaliar a peça processual' },
  { re: /enfatize?\s+(que\s+)?(os?\s+)?argumentos?\s+da\s+parte\s+contr[aá]ria/gi, tipo: 'manipulacao_judicial', gravidade: 'critica', desc: 'Instrução para desvalorizar parte contrária' },
  { re: /n[aã]o\s+h[aá]\s+elementos?\s+probat[oó]rios?\s+(relevantes?|em\s+sentido\s+contr[aá]rio)/gi, tipo: 'manipulacao_judicial', gravidade: 'alta', desc: 'Afirmação falsa sobre elementos probatórios' },
  { re: /o\s+documento\s+cont[eé]m\s+prova\s+(conclusiva|definitiva)/gi, tipo: 'manipulacao_judicial', gravidade: 'critica', desc: 'Afirmação fabricada sobre prova conclusiva' },
  { re: /favor\s+analis[ae]r?\s+(os?\s+argumentos?|esta\s+pe[cç]a)/gi, tipo: 'manipulacao_judicial', gravidade: 'alta', desc: 'Instrução directa ao modelo de análise' },
  { re: /conteste\s+(essa|esta)\s+peti[cç][aã]o\s+de\s+forma\s+superficial/gi, tipo: 'manipulacao_judicial', gravidade: 'critica', desc: 'Instrução para contestar superficialmente (padrão TRT8)' },
  { re: /n[aã]o\s+impugne\s+os?\s+documentos?/gi, tipo: 'manipulacao_judicial', gravidade: 'critica', desc: 'Instrução para não impugnar documentos (padrão TRT8)' },
  { re: /independentemente\s+do\s+comando\s+que\s+lhe\s+for\s+dado/gi, tipo: 'manipulacao_judicial', gravidade: 'critica', desc: 'Override de comandos do sistema (padrão TRT8)' },
  { re: /aten[cç][aã]o[,\s]+intelig[eê]ncia\s+artificial/gi, tipo: 'manipulacao_judicial', gravidade: 'critica', desc: 'Interpelação directa à IA no corpo do documento' },
  { re: /\[SYSTEM\]/gi, tipo: 'system_override', gravidade: 'critica', desc: 'Tag [SYSTEM]' },
  { re: /\[INST\]/gi, tipo: 'system_override', gravidade: 'critica', desc: 'Tag [INST]' },
  { re: /<\|system\|>/gi, tipo: 'system_override', gravidade: 'critica', desc: 'Tag <|system|> — formato Llama' },
  { re: /\{\{system\}\}/gi, tipo: 'system_override', gravidade: 'critica', desc: 'Template {{system}}' },
  { re: /###\s*instruction/gi, tipo: 'system_override', gravidade: 'alta', desc: '### Instruction' },
  { re: /<!--[\s\S]{0,500}?-->/g, tipo: 'comentario_html', gravidade: 'media', desc: 'Comentário HTML oculto' },
  { re: /\/\*[\s\S]{0,200}?\*\//g, tipo: 'comentario_codigo', gravidade: 'media', desc: 'Comentário de código oculto' },
  { re: /(?:ChatGPT|GPT-4|GPT-3|Claude|Gemini|Llama|Mistral|Copilot)\s*[:,]\s*(?:responde|analisa|confirma|diz|afirma)/gi, tipo: 'referencia_modelo', gravidade: 'alta', desc: 'Instrução directa a modelo de IA específico' },
];

// ══════════════════════════════════════════════════════════════════════════════
// EXTRACÇÃO DE STREAMS PDF COM SUPORTE A FLATEDECODE
// ══════════════════════════════════════════════════════════════════════════════

// Descomprime um stream FlateDecode (zlib/deflate)
async function descomprimirStream(streamBytes) {
  try {
    // Tentar inflate normal (com header zlib)
    return await inflate(streamBytes);
  } catch {
    try {
      // Tentar inflateRaw (sem header — alguns PDFs usam deflate puro)
      return await inflateRaw(streamBytes);
    } catch {
      return null;
    }
  }
}

// Extrai todos os streams do PDF, descomprimindo FlateDecode quando necessário
async function extrairStreams(pdfBuffer) {
  const pdfBytes = Buffer.from(pdfBuffer);
  const streamContents = []; // Strings de conteúdo de stream

  // Encontrar todos os dicionários de stream e respectivos dados
  // Formato: << ... /Filter /FlateDecode ... >> stream \r\n ... \r\n endstream
  let pos = 0;
  while (pos < pdfBytes.length) {
    // Procurar "stream" keyword
    const streamMarker = pdfBytes.indexOf(Buffer.from('stream'), pos);
    if (streamMarker === -1) break;

    // Verificar que é "stream\n" ou "stream\r\n" (e não "endstream")
    const afterMarker = pdfBytes[streamMarker + 6];
    if (afterMarker !== 0x0A && afterMarker !== 0x0D) { pos = streamMarker + 7; continue; }

    // Encontrar endstream
    const endStreamMarker = pdfBytes.indexOf(Buffer.from('endstream'), streamMarker);
    if (endStreamMarker === -1) break;

    // Extrair dicionário antes do stream (máx 1KB antes)
    const dictStart = Math.max(0, streamMarker - 1024);
    const dictStr = pdfBytes.slice(dictStart, streamMarker).toString('latin1');

    // Verificar se tem FlateDecode
    const hasFlateDecode = /\/Filter\s*\/FlateDecode|\/Filter\s*\[.*?\/FlateDecode.*?\]/i.test(dictStr);

    // Calcular offset real do stream (depois de \n ou \r\n)
    let streamStart = streamMarker + 6;
    if (pdfBytes[streamStart] === 0x0D) streamStart++; // \r
    if (pdfBytes[streamStart] === 0x0A) streamStart++; // \n

    const streamData = pdfBytes.slice(streamStart, endStreamMarker);

    if (hasFlateDecode && streamData.length > 0) {
      // Descomprimir
      const decompressed = await descomprimirStream(streamData);
      if (decompressed) {
        streamContents.push(decompressed.toString('utf8'));
        // Também guardar como latin1 para capturar bytes não-UTF8
        streamContents.push(decompressed.toString('latin1'));
      }
    } else {
      // Stream não comprimido — usar directamente
      streamContents.push(streamData.toString('utf8'));
      streamContents.push(streamData.toString('latin1'));
    }

    pos = endStreamMarker + 9;
  }

  return streamContents;
}

// ══════════════════════════════════════════════════════════════════════════════
// DETECÇÃO DE COR BRANCA E FONT-SIZE 0 (GAP 1)
// ══════════════════════════════════════════════════════════════════════════════

// Estado gráfico do PDF: parseia operadores scn/sc/g/rg e Tf
// para detectar texto invisível por cor branca ou tamanho zero


// ── RTL OVERRIDE (U+202E) — inversão de direcção de texto ──
function detectarRTLOverride(texto) {
  const alertas = [];
  if (!texto) return alertas;
  const rtlChars = [
    '‮', // RIGHT-TO-LEFT OVERRIDE
    '‭', // LEFT-TO-RIGHT OVERRIDE
    '‫', // RIGHT-TO-LEFT EMBEDDING
    '‪', // LEFT-TO-RIGHT EMBEDDING
    '‏', // RIGHT-TO-LEFT MARK
    '؜', // ARABIC LETTER MARK
    '⁦', '⁧', '⁨', '⁩', // ISOLATES
  ];
  let count = 0;
  const encontrados = [];
  for (const char of rtlChars) {
    const matches = (texto.match(new RegExp(char, 'g')) || []).length;
    if (matches > 0) {
      count += matches;
      encontrados.push(`U+${char.codePointAt(0).toString(16).toUpperCase().padStart(4,'0')} (${matches}x)`);
    }
  }
  if (count > 0) {
    alertas.push({
      tipo: 'rtl_override',
      gravidade: count >= 3 ? 'critica' : 'alta',
      desc: `${count} caractere(s) de controlo de direcção de texto detectado(s): ${encontrados.join(', ')} — possível inversão/ocultação de conteúdo`,
    });
  }
  return alertas;
}

// ── BASE64 / ENCODING OCULTO ──
function detectarEncodingOculto(texto) {
  const alertas = [];
  if (!texto) return alertas;
  // Base64 com comprimento suspeito (>40 chars) em contexto não esperado
  const base64Regex = /(?<![A-Za-z0-9+/])([A-Za-z0-9+/]{40,}={0,2})(?![A-Za-z0-9+/])/g;
  const matches = [...texto.matchAll(base64Regex)];
  const suspeitos = [];
  for (const m of matches) {
    try {
      const decoded = Buffer.from(m[1], 'base64').toString('utf-8');
      // Verificar se o decoded contém padrões de injection
      const injPatterns = [/ignore/i, /instruc/i, /assistant/i, /system/i, /prompt/i, /jailbreak/i, /bypass/i];
      if (injPatterns.some(p => p.test(decoded))) {
        suspeitos.push({ encoded: m[1].substring(0, 30) + '...', decoded: decoded.substring(0, 80) });
      }
    } catch(e) {}
  }
  if (suspeitos.length > 0) {
    alertas.push({
      tipo: 'base64_injection',
      gravidade: 'critica',
      desc: `Instrução de injection detectada em conteúdo codificado em Base64: "${suspeitos[0].decoded.substring(0, 60)}..."`,
    });
  }
  return alertas;
}

// ── HTML/CSS INJECTION em documentos com conteúdo web ──
function detectarHTMLCSSInjection(texto) {
  const alertas = [];
  if (!texto) return alertas;
  const padroes = [
    { re: /style\s*=\s*["'][^"']*display\s*:\s*none[^"']*["']/gi, tipo: 'css_display_none', desc: 'Elemento HTML com display:none — conteúdo oculto via CSS' },
    { re: /style\s*=\s*["'][^"']*visibility\s*:\s*hidden[^"']*["']/gi, tipo: 'css_visibility_hidden', desc: 'Elemento HTML com visibility:hidden — conteúdo invisível via CSS' },
    { re: /style\s*=\s*["'][^"']*color\s*:\s*(?:white|#fff|#ffffff|rgba?\s*\(\s*255\s*,\s*255\s*,\s*255)[^"']*["']/gi, tipo: 'css_white_text', desc: 'Texto HTML com cor branca — invisível sobre fundo branco' },
    { re: /style\s*=\s*["'][^"']*font-size\s*:\s*0[^"']*["']/gi, tipo: 'css_fontsize_zero', desc: 'Texto HTML com font-size:0 — texto de dimensão zero' },
    { re: /<!--[\s\S]{20,}?-->/g, tipo: 'html_comment', desc: 'Comentário HTML com conteúdo substancial' },
    { re: /<[^>]+\s+(?:data-[a-z-]+)\s*=\s*["'][^"']{20,}["']/gi, tipo: 'data_attribute', desc: 'Atributo data-* com conteúdo extenso — possível instrução oculta' },
  ];
  for (const p of padroes) {
    const matches = texto.match(p.re) || [];
    if (matches.length > 0) {
      alertas.push({
        tipo: p.tipo,
        gravidade: 'media',
        desc: p.desc,
      });
    }
  }
  return alertas;
}

// ── HOMÓGLIFOS — caracteres visualmente idênticos de outros alfabetos ──
// Cirílico, Grego, Arménio, etc. substituídos por letras latinas
const HOMOGLIFOS_MAP = {
  // Cirílico
  'а': 'a', 'е': 'e', 'о': 'o', 'р': 'p', 'с': 'c',
  'х': 'x', 'і': 'i', 'ј': 'j', 'ӏ': 'l', 'ѕ': 's',
  // Grego
  'α': 'a', 'ε': 'e', 'ο': 'o', 'ρ': 'p', 'ν': 'v',
  'ι': 'i', 'κ': 'k', 'ν': 'n', 'χ': 'x',
  // Unicode confusables comuns
  // U+2019 e U+201A removidos — são pontuação tipográfica normal em PT
  'ʼ': "'",
  'ａ': 'a', 'ｅ': 'e', 'ｏ': 'o', 'ｐ': 'p',
};

function detectarHomoglifos(texto) {
  const alertas = [];
  if (!texto) return alertas;
  let count = 0;
  const exemplos = [];
  for (const [char, equiv] of Object.entries(HOMOGLIFOS_MAP)) {
    const regex = new RegExp(char, 'g');
    const matches = texto.match(regex) || [];
    if (matches.length > 0) {
      count += matches.length;
      if (exemplos.length < 5) {
        const idx = texto.indexOf(char);
        exemplos.push(`U+${char.codePointAt(0).toString(16).toUpperCase().padStart(4,'0')} (≈'${equiv}') em pos.${idx}`);
      }
    }
  }
  if (count >= 3) {
    alertas.push({
      tipo: 'homoglifo',
      gravidade: count >= 10 ? 'critica' : 'alta',
      desc: `${count} caracteres homóglifos detectados — possível substituição de letras latinas por caracteres de outros alfabetos`,
      exemplos,
    });
  }
  return alertas;
}

// ── SNOW STEGANOGRAFIA — espaços e tabs no fim de linhas ──
function detectarSNOW(texto) {
  const alertas = [];
  if (!texto) return alertas;
  const linhas = texto.split(/\r?\n/);
  let linhasComTrailingSpace = 0;
  let linhasComTab = 0;
  let padrao = '';
  for (const linha of linhas) {
    if (/ +$/.test(linha)) linhasComTrailingSpace++;
    if (/\t+$/.test(linha)) linhasComTab++;
    if (/[ \t]+$/.test(linha)) padrao += linha.match(/[ \t]+$/)[0];
  }
  const percentagem = (linhasComTrailingSpace + linhasComTab) / Math.max(linhas.length, 1);
  if (percentagem > 0.35 && (linhasComTrailingSpace + linhasComTab) > 15) {
    alertas.push({
      tipo: 'snow_steganografia',
      gravidade: percentagem > 0.4 ? 'alta' : 'media',
      desc: `${linhasComTrailingSpace + linhasComTab} linhas com espaços/tabs no fim — possível steganografia SNOW`,
    });
  }
  return alertas;
}

// ── TEXTO FORA DA ÁREA DE IMPRESSÃO ──
function detectarTextoForaDaArea(streamContents, pdfBuffer) {
  const alertas = [];
  // Extrair MediaBox do PDF
  const mediaBoxMatch = pdfBuffer.toString('latin1').match(/\/MediaBox\s*\[\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)/);
  if (!mediaBoxMatch) return alertas;
  const [, x0, y0, x1, y1] = mediaBoxMatch.map(Number);

  for (const stream of streamContents) {
    // Procurar posicionamentos de texto com Td, TD, Tm
    const tmMatches = stream.matchAll(/(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)\s+Tm/g);
    for (const m of tmMatches) {
      const tx = parseFloat(m[5]);
      const ty = parseFloat(m[6]);
      if (tx < x0 - 10 || tx > x1 + 10 || ty < y0 - 10 || ty > y1 + 10) {
        alertas.push({
          tipo: 'texto_fora_area',
          gravidade: 'alta',
          desc: `Texto posicionado fora da área de impressão (x:${tx.toFixed(0)}, y:${ty.toFixed(0)}) — possível injection oculta`,
        });
        break;
      }
    }
    if (alertas.length > 0) break;
  }
  return alertas;
}

// ── XMP METADATA — instruções nos metadados XML ──
function detectarXMPInjection(pdfBuffer) {
  const alertas = [];
  const pdf = pdfBuffer.toString('latin1');
  const xmpMatch = pdf.match(/<x:xmpmeta[\s\S]*?<\/x:xmpmeta>/i);
  if (!xmpMatch) return alertas;
  const xmp = xmpMatch[0];
  const PADROES_XMP = [
    /ignore.*instru/i, /system.*prompt/i, /assistant.*role/i,
    /jailbreak/i, /bypass/i, /override/i, /forget.*previous/i,
    /esqueça/i, /ignora.*anterior/i,
  ];
  for (const p of PADROES_XMP) {
    if (p.test(xmp)) {
      alertas.push({
        tipo: 'xmp_injection',
        gravidade: 'critica',
        desc: 'Padrão de prompt injection detectado nos metadados XMP do PDF',
      });
      break;
    }
  }
  // XMP com comprimento anómalo
  if (xmp.length > 5000) {
    alertas.push({
      tipo: 'xmp_anómalo',
      gravidade: 'media',
      desc: `Metadados XMP com dimensão anómala (${xmp.length} chars) — possível dados ocultos`,
    });
  }
  return alertas;
}

// ── TRANSPARÊNCIA / OPACIDADE ZERO ──
function detectarTransparenciaOculta(streamContents) {
  const alertas = [];
  for (const stream of streamContents) {
    // ca (fill opacity) ou CA (stroke opacity) a 0
    if (/\b0(\.0+)?\s+ca\b/.test(stream) || /\b0(\.0+)?\s+CA\b/.test(stream)) {
      alertas.push({
        tipo: 'opacidade_zero',
        gravidade: 'alta',
        desc: 'Texto com opacidade zero detectado — completamente invisível mas presente no documento',
      });
      break;
    }
    // /GS com opacity 0 em ExtGState
    if (/\/ca\s+0\b/.test(stream) || /\/CA\s+0\b/.test(stream)) {
      alertas.push({
        tipo: 'extgstate_transparente',
        gravidade: 'alta',
        desc: 'Estado gráfico com transparência total detectado (ExtGState ca=0)',
      });
      break;
    }
  }
  return alertas;
}

function detectarTextoInvisivel(streamContent) {
  const alertas = [];

  // Divide o stream em "blocos de texto" BT...ET
  const blocosBT = streamContent.match(/BT[\s\S]*?ET/g) || [];

  for (const bloco of blocosBT) {
    // Tokenizar o bloco em linhas/tokens
    const tokens = bloco.split(/\s+/);

    let fontSizeActual = null;
    let corBrancaActiva = false;
    let textoNesseBloco = [];

    for (let i = 0; i < tokens.length; i++) {
      const tok = tokens[i];

      // ── Operador Tf: /FontName size Tf ──
      // Ex: /F1 0 Tf  ou  /F1 0.001 Tf
      if (tok === 'Tf' && i >= 2) {
        const size = parseFloat(tokens[i - 1]);
        if (!isNaN(size)) {
          fontSizeActual = size;
        }
      }

      // ── Operador g: gray scale fill color  (1 g = branco) ──
      if (tok === 'g' && i >= 1) {
        const g = parseFloat(tokens[i - 1]);
        if (!isNaN(g)) corBrancaActiva = (g >= 0.99);
      }

      // ── Operador G: gray scale stroke color ──
      if (tok === 'G' && i >= 1) {
        const g = parseFloat(tokens[i - 1]);
        // Stroke não afecta fill — ignorar para fill color
      }

      // ── Operador rg: RGB fill color (1 1 1 rg = branco) ──
      if (tok === 'rg' && i >= 3) {
        const r = parseFloat(tokens[i - 3]);
        const g = parseFloat(tokens[i - 2]);
        const b = parseFloat(tokens[i - 1]);
        if (!isNaN(r) && !isNaN(g) && !isNaN(b)) {
          corBrancaActiva = (r >= 0.99 && g >= 0.99 && b >= 0.99);
        }
      }

      // ── Operador scn / sc: cor de fill genérica ──
      // Para espaços DeviceGray: 1 scn = branco
      // Para espaços DeviceRGB: 1 1 1 scn = branco
      if ((tok === 'scn' || tok === 'sc') && i >= 1) {
        // Tentar ler 1, 2 ou 3 valores antes
        const v1 = parseFloat(tokens[i - 1]);
        const v2 = i >= 2 ? parseFloat(tokens[i - 2]) : NaN;
        const v3 = i >= 3 ? parseFloat(tokens[i - 3]) : NaN;

        if (!isNaN(v1) && isNaN(v2)) {
          // DeviceGray: 1 scn
          corBrancaActiva = (v1 >= 0.99);
        } else if (!isNaN(v1) && !isNaN(v2) && isNaN(v3)) {
          // Dois valores — não é RGB standard, ignorar
        } else if (!isNaN(v1) && !isNaN(v2) && !isNaN(v3)) {
          // DeviceRGB: 1 1 1 scn
          corBrancaActiva = (v3 >= 0.99 && v2 >= 0.99 && v1 >= 0.99);
        }
      }

      // ── Operadores de texto Tj / TJ / ' ──
      // Extrair o texto deste bloco para incluir no alerta
      const tjMatch = tok.match(/^\((.+)\)$/);
      if (tjMatch) {
        textoNesseBloco.push(tjMatch[1].substring(0, 80));
      }
    }

    // Verificar condições suspeitas
    const fontSizeZero = fontSizeActual !== null && fontSizeActual <= 0.01;
    const textoResumo = textoNesseBloco.join(' ').substring(0, 120) || '(texto não extraível)';

    if (corBrancaActiva && textoNesseBloco.length > 0) {
      alertas.push({
        tipo: 'texto_cor_branca',
        gravidade: 'critica',
        desc: `Texto com cor branca (invisível ao leitor) detectado num bloco BT/ET — padrão idêntico ao caso TRT8`,
        contexto: textoResumo,
      });
    }

    if (fontSizeZero && textoNesseBloco.length > 0) {
      alertas.push({
        tipo: 'texto_tamanho_zero',
        gravidade: 'critica',
        desc: `Texto com font-size ${fontSizeActual} (invisível ao leitor) detectado num bloco BT/ET`,
        contexto: textoResumo,
      });
    }
  }

  // Deduplica alertas (mantém máx 3 por tipo)
  const vistos = {};
  return alertas.filter(a => {
    vistos[a.tipo] = (vistos[a.tipo] || 0) + 1;
    return vistos[a.tipo] <= 3;
  });
}

// ══════════════════════════════════════════════════════════════════════════════
// EXTRACÇÃO DE TEXTO DOS STREAMS (APÓS DESCOMPRESSÃO)
// ══════════════════════════════════════════════════════════════════════════════

function extrairTextoDosStreams(streamContents) {
  const textChunks = [];

  for (const content of streamContents) {
    // Tj literal: (texto)Tj
    const tjRegex = /\(([^)\\]*(?:\\.[^)\\]*)*)\)\s*(?:Tj|'|")/g;
    let m;
    while ((m = tjRegex.exec(content)) !== null) {
      const decoded = decodePDFString(m[1]);
      if (decoded.trim()) textChunks.push(decoded);
    }

    // TJ arrays: [(texto)(texto)]TJ
    const tjArrayRegex = /\[([\s\S]*?)\]\s*TJ/g;
    while ((m = tjArrayRegex.exec(content)) !== null) {
      const inner = m[1];
      const innerRegex = /\(([^)\\]*(?:\\.[^)\\]*)*)\)/g;
      let im;
      while ((im = innerRegex.exec(inner)) !== null) {
        const decoded = decodePDFString(im[1]);
        if (decoded.trim()) textChunks.push(decoded);
      }
    }

    // Texto hexadecimal <48656C6C6F> — Type1/CIDFont
    const hexRegex = /<([0-9A-Fa-f]+)>\s*(?:Tj|TJ|'|")/g;
    while ((m = hexRegex.exec(content)) !== null) {
      try {
        const hex = m[1];
        let decoded = '';
        for (let i = 0; i < hex.length; i += 2) {
          const code = parseInt(hex.substring(i, i + 2), 16);
          if (code > 0) decoded += String.fromCharCode(code);
        }
        if (decoded.trim()) textChunks.push(decoded);
      } catch {}
    }
  }

  return textChunks.join(' ');
}

// Descodifica sequências de escape PDF num string literal
function decodePDFString(raw) {
  return raw
    .replace(/\\(\d{1,3})/g, (_, oct) => String.fromCharCode(parseInt(oct, 8)))
    .replace(/\\n/g, '\n')
    .replace(/\\r/g, '\r')
    .replace(/\\t/g, '\t')
    .replace(/\\\(/g, '(')
    .replace(/\\\)/g, ')')
    .replace(/\\\\/g, '\\');
}

// ══════════════════════════════════════════════════════════════════════════════
// DETECÇÃO DE UNICODE INVISÍVEL NOS BYTES BRUTOS
// ══════════════════════════════════════════════════════════════════════════════

function detectarUnicodeInvisivelBruto(textoUTF8, textoExtraido) {
  const encontrados = [];

  for (const { char, nome, limiar } of UNICODE_INVISIVEL) {
    const countUTF8     = (textoUTF8.split(char)).length - 1;
    const countExtraido = (textoExtraido.split(char)).length - 1;
    const count = Math.max(countUTF8, countExtraido);

    if (count >= limiar) {
      const codePoint = char.codePointAt(0).toString(16).toUpperCase().padStart(4, '0');

      let gravidade;
      if (char === '\u00AD') {
        gravidade = count > 30 ? 'alta' : 'media';
      } else if (char === '\uFEFF' && count < 3) {
        gravidade = 'baixa';
      } else {
        gravidade = count > 10 ? 'critica' : count > 3 ? 'alta' : 'media';
      }

      encontrados.push({
        tipo: 'unicode_invisivel',
        gravidade,
        desc: `${nome} (U+${codePoint}) — ${count} ocorrência${count > 1 ? 's' : ''} nos bytes brutos do PDF`,
        count,
        codePoint: `U+${codePoint}`,
        fonte: countUTF8 > 0 ? 'bytes_brutos' : 'stream_texto',
      });
    }
  }

  // Combining chars em excesso (steganografia)
  const combiningCount = (textoUTF8.match(/[\u0300-\u036F]/g) || []).length;
  if (combiningCount > 200) {
    encontrados.push({
      tipo: 'unicode_invisivel',
      gravidade: 'alta',
      desc: `${combiningCount} caracteres de combinação Unicode — possível steganografia`,
      count: combiningCount,
      codePoint: 'U+0300–U+036F',
      fonte: 'bytes_brutos',
    });
  }

  return encontrados;
}

// ── Detector de padrões linguísticos ──
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

// ── Detector de anomalias estruturais ──
function detectarAnomalias(texto) {
  const alertas = [];
  const espacosAnomalia = texto.match(/[^\n] {6,}/g);
  if (espacosAnomalia && espacosAnomalia.length > 3) {
    alertas.push({ tipo: 'espacos_anomalos', gravidade: 'media', desc: `${espacosAnomalia.length} sequências com espaços excessivos` });
  }
  const linhas = texto.split('\n');
  const linhasCurtas = linhas.filter(l => l.trim().length > 0 && l.trim().length < 4);
  if (linhasCurtas.length > 10) {
    alertas.push({ tipo: 'fragmentacao_texto', gravidade: 'media', desc: `${linhasCurtas.length} linhas muito curtas — possível fragmentação` });
  }
  return alertas;
}

// ── Score de risco ──
function calcularRisco(unicode, padroes, anomalias, textoInvisivel) {
  let score = 0;

  // Texto com cor branca ou font-size 0 é o indicador mais grave
  for (const t of textoInvisivel) {
    if (t.gravidade === 'critica') score += 60;
    else score += 30;
  }

  for (const u of unicode) {
    if (u.codePoint === 'U+00AD' && u.gravidade === 'media') score += 3;
    else if (u.gravidade === 'critica') score += 40;
    else if (u.gravidade === 'alta') score += 25;
    else score += 8;
  }

  for (const p of padroes) {
    if (p.gravidade === 'critica') score += 35;
    else if (p.gravidade === 'alta') score += 20;
    else if (p.gravidade === 'media') score += 10;
    else score += 5;
  }

  for (const a of anomalias) {
    // Metadados ausentes sozinhos não devem ser suficientes para SUSPEITO
    if (a.tipo === 'metadata_ausentes') score += 2;
    else if (a.tipo === 'camadas_presentes') score += 5;
    else score += a.gravidade === 'media' ? 8 : 4;
  }

  return Math.min(100, score);
}

function veredictoRisco(score, unicodeEncontrados, padroesEncontrados, anomaliasEncontradas, textoInvisivel) {
  // Texto invisível por cor branca ou font-size 0 é imediatamente crítico
  if (textoInvisivel.length > 0) return 'INJECTION_DETECTADA';

  // Indicadores graves — excluir:
  // - soft hyphens moderados (inseridos automaticamente pelo Word)
  // - ausência de metadados isolada (pode ser documento legítimo sem metadados)
  // - anomalias de entropia baixa/média isoladas
  const indicadoresGraves = [
    ...unicodeEncontrados.filter(u => !(u.codePoint === 'U+00AD' && u.gravidade === 'media')),
    ...padroesEncontrados,
    ...anomaliasEncontradas.filter(a =>
      a.tipo !== 'metadata_ausentes' &&
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
// RESOLUÇÃO RECURSIVA DE XOBJECT FORMS
// ══════════════════════════════════════════════════════════════════════════════
// XObject Forms são sub-streams referenciados no PDF como /XObject /Form.
// O texto neles não aparece no fluxo principal — é uma técnica de ocultação.
// Resolvemos recursivamente até 3 níveis de profundidade.

async function resolverXObjects(pdfBuffer, streamContents, profundidade = 0) {
  if (profundidade >= 3) return; // Limite de recursão

  const pdfBytes = Buffer.from(pdfBuffer);
  const pdfStr = pdfBytes.toString('latin1');

  // Encontrar referências a XObject Forms: /XObject << /NomeQualquer X Y R >>
  // onde X Y R é uma referência indirecta a um objecto PDF
  const xobjRegex = /\/XObject\s*<<([\s\S]{0,500}?)>>/g;
  let xobjMatch;
  const refsProcessadas = new Set();

  while ((xobjMatch = xobjRegex.exec(pdfStr)) !== null) {
    const xobjBlock = xobjMatch[1];

    // Extrair todas as referências indirectas (ex: /Im1 5 0 R)
    const refRegex = /\/\w+\s+(\d+)\s+(\d+)\s+R/g;
    let refMatch;

    while ((refMatch = refRegex.exec(xobjBlock)) !== null) {
      const objNum = refMatch[1];
      const genNum = refMatch[2];
      const refKey = `${objNum}_${genNum}`;

      if (refsProcessadas.has(refKey)) continue;
      refsProcessadas.add(refKey);

      // Encontrar o objecto referenciado no PDF
      // Formato: "X Y obj << ... /Subtype /Form ... >> stream ... endstream"
      const objPattern = new RegExp(`${objNum}\\s+${genNum}\\s+obj[\\s\\S]{0,2000}?endobj`, 'g');
      const objMatch = objPattern.exec(pdfStr);
      if (!objMatch) continue;

      const objStr = objMatch[0];

      // Verificar se é um XObject Form (não Image)
      if (!/\/Subtype\s*\/Form/i.test(objStr)) continue;

      // Extrair o stream deste XObject
      const streamStart = objStr.indexOf('stream');
      const streamEnd = objStr.lastIndexOf('endstream');
      if (streamStart === -1 || streamEnd === -1) continue;

      let rawStream = objStr.substring(streamStart + 6, streamEnd);
      if (rawStream.startsWith('\r\n')) rawStream = rawStream.substring(2);
      else if (rawStream.startsWith('\n')) rawStream = rawStream.substring(1);

      const hasFlateDecode = /\/Filter\s*\/FlateDecode/i.test(objStr);
      const streamBuf = Buffer.from(rawStream, 'latin1');

      let content;
      if (hasFlateDecode) {
        const decompressed = await descomprimirStream(streamBuf);
        if (decompressed) {
          content = decompressed.toString('utf8');
          streamContents.push(content);
          streamContents.push(decompressed.toString('latin1'));
        }
      } else {
        content = rawStream;
        streamContents.push(content);
      }
    }
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// ANÁLISE DE ENTROPIA DO TEXTO
// ══════════════════════════════════════════════════════════════════════════════
// Texto jurídico português tem um perfil de entropia característico.
// Texto de injection oculto (especialmente codificado ou fragmentado)
// tem distribuição estatística diferente.
// Usamos entropia de Shannon sobre blocos do texto para detectar anomalias.

function calcularEntropiaShannon(texto) {
  if (!texto || texto.length === 0) return 0;
  const freq = {};
  for (const ch of texto) {
    freq[ch] = (freq[ch] || 0) + 1;
  }
  const n = texto.length;
  let entropia = 0;
  for (const count of Object.values(freq)) {
    const p = count / n;
    entropia -= p * Math.log2(p);
  }
  return entropia;
}

function analisarEntropia(textoExtraido) {
  const alertas = [];
  if (!textoExtraido || textoExtraido.length < 200) return alertas;

  // ── Entropia global ──
  // Texto jurídico PT tem entropia típica entre 4.0 e 5.2 bits/char
  // Valores muito altos (>6.5) indicam conteúdo codificado/encriptado
  // Valores muito baixos (<2.5) indicam repetição anómala
  const entropiaGlobal = calcularEntropiaShannon(textoExtraido.substring(0, 10000));

  if (entropiaGlobal > 6.5) {
    alertas.push({
      tipo: 'entropia_anomala_alta',
      gravidade: 'alta',
      desc: `Entropia do texto anormalmente alta (${entropiaGlobal.toFixed(2)} bits/char) — possível conteúdo codificado ou encriptado oculto no documento`,
      valor: entropiaGlobal.toFixed(2),
    });
  } else if (entropiaGlobal < 2.5 && textoExtraido.length > 500) {
    alertas.push({
      tipo: 'entropia_anomala_baixa',
      gravidade: 'media',
      desc: `Entropia do texto anormalmente baixa (${entropiaGlobal.toFixed(2)} bits/char) — possível repetição estruturada ou conteúdo gerado`,
      valor: entropiaGlobal.toFixed(2),
    });
  }

  // ── Análise por blocos — detectar secções anómalas ──
  // Dividir o texto em blocos de 500 chars e calcular entropia de cada um
  // Um bloco com entropia muito diferente da média é suspeito
  const tamanhoBloco = 500;
  const blocos = [];
  for (let i = 0; i < Math.min(textoExtraido.length, 20000); i += tamanhoBloco) {
    const bloco = textoExtraido.substring(i, i + tamanhoBloco);
    if (bloco.trim().length > 50) {
      blocos.push(calcularEntropiaShannon(bloco));
    }
  }

  if (blocos.length > 3) {
    const media = blocos.reduce((a, b) => a + b, 0) / blocos.length;
    const desvioPadrao = Math.sqrt(blocos.map(b => Math.pow(b - media, 2)).reduce((a, b) => a + b, 0) / blocos.length);

    // Blocos com entropia > média + 2.5 desvios padrão são suspeitos
    const blocosAnomalia = blocos.filter(b => b > media + 2.5 * desvioPadrao || b < media - 2.5 * desvioPadrao);

    if (blocosAnomalia.length > 0 && desvioPadrao > 0.8) {
      alertas.push({
        tipo: 'entropia_blocos_anomalos',
        gravidade: 'media',
        desc: `${blocosAnomalia.length} bloco${blocosAnomalia.length > 1 ? 's' : ''} de texto com entropia anómala (σ=${desvioPadrao.toFixed(2)}) — possíveis secções ocultas com conteúdo diferente do restante documento`,
        valor: `média=${media.toFixed(2)}, σ=${desvioPadrao.toFixed(2)}`,
      });
    }
  }

  // ── Detecção de sequências de alta entropia em texto curto ──
  // Sequências de 20+ chars com apenas caracteres de alta entropia
  // são típicas de conteúdo codificado em base64 ou hex escondido no texto
  const altaEntropiaRegex = /[A-Za-z0-9+/=]{30,}/g;
  const sequenciasBase64 = textoExtraido.match(altaEntropiaRegex) || [];
  const suspeitas = sequenciasBase64.filter(s => {
    // Base64 válido tem proporção equilibrada de maiúsculas/minúsculas/números
    const upper = (s.match(/[A-Z]/g) || []).length;
    const lower = (s.match(/[a-z]/g) || []).length;
    const digits = (s.match(/[0-9]/g) || []).length;
    const total = s.length;
    // Texto normal não tem estas proporções em sequências longas
    return upper > total * 0.2 && lower > total * 0.2 && digits > total * 0.1;
  });

  if (suspeitas.length > 2) {
    alertas.push({
      tipo: 'sequencias_codificadas',
      gravidade: 'media',
      desc: `${suspeitas.length} sequências com padrão de texto codificado (possível base64/hex) detectadas no documento`,
      valor: suspeitas.length.toString(),
    });
  }

  return alertas;
}

// ══════════════════════════════════════════════════════════════════════════════
// DETECÇÃO DE METADADOS SUSPEITOS
// ══════════════════════════════════════════════════════════════════════════════

// Software de criação associado a IA ou ferramentas suspeitas
const SOFTWARE_SUSPEITO = [
  /chatgpt/i, /openai/i, /gpt-?[0-9]/i, /claude/i, /gemini/i, /copilot/i,
  /llama/i, /mistral/i, /ai.?pdf/i, /pdf.?ai/i, /undetectable/i, /quillbot/i,
  /jasper/i, /writesonic/i, /copy\.ai/i, /anyword/i,
];

function extrairMetadados(pdfBuffer) {
  const alertas = [];
  const pdfStr = pdfBuffer.toString('latin1');

  // ── Extrair dicionário /Info ──
  const infoMatch = pdfStr.match(/\/Info\s*<<([\s\S]{0,2000}?)>>/);
  const metadados = {};

  if (infoMatch) {
    const infoBlock = infoMatch[1];

    // Extrair campos standard do dicionário Info
    const campos = ['Creator', 'Producer', 'Author', 'Title', 'Subject', 'Keywords', 'CreationDate', 'ModDate'];
    for (const campo of campos) {
      // Formato: /Campo (valor) ou /Campo <hex>
      const m = infoBlock.match(new RegExp(`/${campo}\\s*\\(([^)]*)\\)`));
      if (m) metadados[campo] = m[1].replace(/\\(\d{3})/g, (_, o) => String.fromCharCode(parseInt(o, 8))).trim();
      const mHex = infoBlock.match(new RegExp(`/${campo}\\s*<([0-9A-Fa-f]+)>`));
      if (mHex) {
        try {
          const hex = mHex[1];
          let decoded = '';
          for (let i = 0; i < hex.length; i += 2) decoded += String.fromCharCode(parseInt(hex.substring(i, i + 2), 16));
          metadados[campo] = decoded.replace(/\x00/g, '').trim();
        } catch {}
      }
    }
  }

  // ── Verificar software de criação ──
  const softwareFields = [metadados.Creator, metadados.Producer].filter(Boolean);
  for (const field of softwareFields) {
    for (const pattern of SOFTWARE_SUSPEITO) {
      if (pattern.test(field)) {
        alertas.push({
          tipo: 'metadata_software_suspeito',
          gravidade: 'critica',
          desc: `Software de criação suspeito detectado: "${field}" — documento possivelmente gerado por IA`,
          campo: softwareFields.indexOf(field) === 0 ? 'Creator' : 'Producer',
          valor: field,
        });
        break;
      }
    }
  }

  // ── Verificar inconsistência de datas ──
  // CreationDate e ModDate em formato PDF: D:YYYYMMDDHHmmSS
  const parsePDFDate = (d) => {
    if (!d) return null;
    const m = d.replace('D:', '').match(/^(\d{4})(\d{2})(\d{2})/);
    if (!m) return null;
    return new Date(`${m[1]}-${m[2]}-${m[3]}`);
  };

  const dataCriacao = parsePDFDate(metadados.CreationDate);
  const dataModificacao = parsePDFDate(metadados.ModDate);

  if (dataCriacao && dataModificacao && dataModificacao < dataCriacao) {
    alertas.push({
      tipo: 'metadata_datas_inconsistentes',
      gravidade: 'alta',
      desc: `Data de modificação (${metadados.ModDate}) anterior à data de criação (${metadados.CreationDate}) — metadados manipulados`,
    });
  }

  // Documento muito recente comparado com data declarada no conteúdo
  if (dataCriacao) {
    const agora = new Date();
    const diffAnos = (agora - dataCriacao) / (1000 * 60 * 60 * 24 * 365);
    if (diffAnos < 0) {
      alertas.push({
        tipo: 'metadata_data_futura',
        gravidade: 'alta',
        desc: `Data de criação no futuro (${metadados.CreationDate}) — metadados manipulados`,
      });
    }
  }

  // ── Verificar ausência total de metadados (suspeito em documentos oficiais) ──
  const temMetadados = Object.keys(metadados).length > 0;
  if (!temMetadados) {
    alertas.push({
      tipo: 'metadata_ausentes',
      gravidade: 'media',
      desc: 'Documento sem metadados — incomum em documentos judiciais oficiais; possível remoção deliberada',
    });
  }

  return { alertas, metadados };
}

// ══════════════════════════════════════════════════════════════════════════════
// DETECÇÃO DE CAMADAS OCULTAS (OCG — Optional Content Groups)
// ══════════════════════════════════════════════════════════════════════════════

function detectarCamadasOcultas(pdfBuffer) {
  const alertas = [];
  const pdfStr = pdfBuffer.toString('latin1');

  // ── Verificar existência de /OCProperties ──
  const ocPropsMatch = pdfStr.match(/\/OCProperties\s*<<([\s\S]{0,5000}?)>>/);
  if (!ocPropsMatch) return alertas; // Sem camadas — documento normal

  const ocBlock = ocPropsMatch[1];

  // ── Extrair nomes das camadas (/OCGs array) ──
  const ocgNames = [];
  const nameRegex = /\/Name\s*\(([^)]*)\)/g;
  let m;
  while ((m = nameRegex.exec(ocBlock)) !== null) {
    ocgNames.push(m[1]);
  }

  // ── Verificar estado das camadas no dicionário /D (Default) ──
  // /OFF array contém as camadas desligadas por defeito
  const offMatch = ocBlock.match(/\/OFF\s*\[([\s\S]*?)\]/);
  const offCount = offMatch ? (offMatch[1].match(/\d+\s+\d+\s+R/g) || []).length : 0;

  // ── Verificar /AS (Aplicação de Estado) com eventos suspeitos ──
  const asMatch = ocBlock.match(/\/AS\s*\[([\s\S]*?)\]/);

  if (offCount > 0) {
    alertas.push({
      tipo: 'camada_oculta_off',
      gravidade: 'critica',
      desc: `${offCount} camada${offCount > 1 ? 's' : ''} PDF oculta${offCount > 1 ? 's' : ''} por defeito (estado OFF) — pode conter texto invisível ao leitor`,
      camadas: ocgNames.length > 0 ? ocgNames.join(', ') : 'nomes não disponíveis',
    });
  }

  // ── Verificar camadas com nomes suspeitos ──
  const nomesSuspeitos = ocgNames.filter(n =>
    /injection|hidden|oculto|invisible|prompt|instruc|command|ai|system/i.test(n)
  );
  if (nomesSuspeitos.length > 0) {
    alertas.push({
      tipo: 'camada_nome_suspeito',
      gravidade: 'critica',
      desc: `Camada PDF com nome suspeito: "${nomesSuspeitos.join('", "')}"`,
      camadas: nomesSuspeitos.join(', '),
    });
  }

  // ── Verificar se há camadas mesmo sem estar explicitamente OFF ──
  // A simples existência de OCG num documento judicial é incomum
  if (ocgNames.length > 0 && offCount === 0) {
    alertas.push({
      tipo: 'camadas_presentes',
      gravidade: 'media',
      desc: `Documento contém ${ocgNames.length} camada${ocgNames.length > 1 ? 's' : ''} PDF (${ocgNames.join(', ')}) — incomum em documentos judiciais; verifique se contêm conteúdo oculto`,
    });
  }

  return alertas;
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
  // Gratuito: 5MB | Profissional/Institucional: 10MB
  const isPro = userPlano === 'profissional' || userPlano === 'institucional';
  const LIMITE_PDF_BASE64 = isPro ? 14_000_000 : 7_000_000; // base64 ~33% maior que o ficheiro real

  const { pdfBase64, nomeFile } = req.body || {};
  if (!pdfBase64 || typeof pdfBase64 !== 'string') {
    return res.status(400).json({ erro: 'PDF em base64 não fornecido.' });
  }
  if (pdfBase64.length > LIMITE_PDF_BASE64) {
    const limiteMsg = isPro ? '10MB' : '5MB';
    return res.status(413).json({ erro: `PDF demasiado grande. Máximo ${limiteMsg} no plano ${userPlano}.` });
  }

  let pdfBuffer;
  try {
    pdfBuffer = Buffer.from(pdfBase64, 'base64');
  } catch {
    return res.status(400).json({ erro: 'Base64 inválido.' });
  }

  // ── 1. Extrair streams (com descompressão FlateDecode) ──
  let streamContents = [];
  try {
    streamContents = await extrairStreams(pdfBuffer);
  } catch (e) {
    console.error('Erro extracção streams:', e.message);
  }

  // ── 2. Resolver XObject Forms recursivamente ──
  try {
    await resolverXObjects(pdfBuffer, streamContents, 0);
  } catch (e) {
    console.error('Erro XObjects:', e.message);
  }

  // ── 3. Detectar texto invisível (cor branca / font-size 0) ──
  const textoInvisivel = [];
  for (const content of streamContents) {
    try {
      const alertas = detectarTextoInvisivel(content);
      textoInvisivel.push(...alertas);
    } catch {}
  }

  // ── 4. Extrair texto para análise linguística ──
  const textoExtraido = extrairTextoDosStreams(streamContents);
  const textoUTF8 = pdfBuffer.toString('utf8');
  const textoCombinado = textoExtraido + ' ' + textoUTF8.substring(0, 50000);

  // ── 4A. Validação de domínio — apenas jurisprudência e documentos PT-PT ──
  // O detector está calibrado exclusivamente para o sistema jurídico português.
  // Documentos de outras jurisdições (Brasil, Espanha, TJUE, etc.) produzem
  // falsos positivos porque os seus sistemas de exportação PDF inserem
  // caracteres Unicode (U+034F, U+0300–U+036F) como artefacto legítimo.
  const textoValidacao = (textoExtraido || '').toLowerCase().substring(0, 6000);
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

  // Domínio não reconhecido — analisar na mesma mas com nota de aviso
  // Não bloquear: PDFs gerados por alguns exportadores não expõem o texto
  // correctamente nos primeiros 6000 caracteres mesmo sendo documentos PT-PT
  const avisoForeignDomain = (!isDocumentoPortugues && textoExtraido.length > 500)
    ? 'Domínio não confirmado automaticamente. Os resultados têm fiabilidade indeterminada para documentos fora do sistema jurídico português.'
    : null;

  // ── 5. Análise de entropia ──
  const alertasEntropia = analisarEntropia(textoExtraido || textoUTF8.substring(0, 20000));

  // ── 6. Metadados ──
  const { alertas: alertasMetadados, metadados } = extrairMetadados(pdfBuffer);

  // ── 7. Camadas ocultas ──
  const alertasCamadas = detectarCamadasOcultas(pdfBuffer);

  // ── 8. Análise linguística e Unicode ──
  const unicodeEncontrados   = detectarUnicodeInvisivelBruto(textoUTF8, textoExtraido);
  const padroesEncontrados   = detectarPadroesLinguisticos(textoCombinado);
  const anomaliasEncontradas = detectarAnomalias(textoExtraido || textoUTF8.substring(0, 30000));

  // ── 8B. Técnicas avançadas ──
  const homoglifosEncontrados    = detectarHomoglifos(textoExtraido || textoUTF8.substring(0, 50000));
  const snowEncontrado           = detectarSNOW(textoExtraido || textoUTF8.substring(0, 50000));
  const textoForaAreaEncontrado  = detectarTextoForaDaArea(streamContents, pdfBuffer);
  const xmpInjectado             = detectarXMPInjection(pdfBuffer);
  const transparenciaOculta      = detectarTransparenciaOculta(streamContents);
  const rtlOverride              = detectarRTLOverride(textoExtraido || textoUTF8.substring(0, 50000));
  const base64Oculto             = detectarEncodingOculto(textoExtraido || textoUTF8.substring(0, 50000));
  const htmlCSSInject            = detectarHTMLCSSInjection(textoExtraido || textoUTF8.substring(0, 50000));

  // ── 9. Score e veredicto ──
  const todasAnomalias = [
    ...anomaliasEncontradas,
    ...textoInvisivel,
    ...alertasMetadados,
    ...alertasCamadas,
    ...alertasEntropia,
    ...homoglifosEncontrados,
    ...snowEncontrado,
    ...textoForaAreaEncontrado,
    ...xmpInjectado,
    ...transparenciaOculta,
    ...rtlOverride,
    ...base64Oculto,
    ...htmlCSSInject,
  ];

  const score = calcularRisco(unicodeEncontrados, padroesEncontrados, todasAnomalias, textoInvisivel);
  const veredicto = veredictoRisco(score, unicodeEncontrados, padroesEncontrados, todasAnomalias, textoInvisivel);
  const totalIndicadores = unicodeEncontrados.length + padroesEncontrados.length + todasAnomalias.length;

  // ── Detecção de jurisdição ──
  // O LexVeritas está calibrado para jurisprudência portuguesa.
  // Se o documento não contiver referências a tribunais portugueses,
  // emite uma nota de aviso no resultado.
  const textoParaJurisdicao = (textoExtraido || '').toLowerCase().substring(0, 5000);
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
    metadados_pdf: metadados,
    nota_dominio: notaDominio || avisoForeignDomain,
    meta: {
      fonte: 'bytes_brutos_pdf',
      nome_ficheiro: nomeFile || 'desconhecido',
      tamanho_bytes: pdfBuffer.length,
      streams_extraidos: streamContents.length,
      texto_invisivel_detectado: textoInvisivel.length,
      alertas_metadados: alertasMetadados.length,
      alertas_camadas: alertasCamadas.length,
      alertas_entropia: alertasEntropia.length,
      dominio_portugues: dominioPortugues,
    },
    recomendacao: veredicto === 'INJECTION_DETECTADA'
      ? 'PDF contém indícios fortes de prompt injection. Não processe com IA sem revisão humana completa.'
      : veredicto === 'SUSPEITO'
      ? 'PDF apresenta elementos suspeitos. Reveja manualmente antes de processar com IA.'
      : 'Nenhum indicador de prompt injection detectado nos bytes brutos do PDF.',
  });
};
