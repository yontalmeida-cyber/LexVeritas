// /api/detetar-injection-pdf.js — LexVeritas Detector de Prompt Injection (PDF bytes brutos)
// Vercel Serverless Function — Node.js 18+ — CommonJS
// v1.2 — fix: descompressão FlateDecode; detecção cor branca (scn) e font-size 0 (Tf); soft hyphen limiar

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
  const textoCombinado = textoUTF8 + ' ' + textoExtraido;

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
  if (combiningCount > 50) {
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
    score += a.gravidade === 'media' ? 8 : 4;
  }

  return Math.min(100, score);
}

function veredictoRisco(score, unicodeEncontrados, padroesEncontrados, anomaliasEncontradas, textoInvisivel) {
  // Texto invisível por cor branca ou font-size 0 é imediatamente crítico
  if (textoInvisivel.length > 0) return 'INJECTION_DETECTADA';

  const indicadoresGraves = [
    ...unicodeEncontrados.filter(u => !(u.codePoint === 'U+00AD' && u.gravidade === 'media')),
    ...padroesEncontrados,
  ];

  if (score >= 60 || indicadoresGraves.length >= 3) return 'INJECTION_DETECTADA';
  if (score >= 30 || indicadoresGraves.length >= 1) return 'SUSPEITO';
  return 'LIMPO';
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
  try {
    const authCheck = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { 'Authorization': `Bearer ${token}`, 'apikey': SUPABASE_ANON_KEY },
    });
    if (!authCheck.ok) return res.status(401).json({ erro: 'Sessão inválida ou expirada.' });
  } catch { return res.status(401).json({ erro: 'Erro de autenticação.' }); }

  const { pdfBase64, nomeFile } = req.body || {};
  if (!pdfBase64 || typeof pdfBase64 !== 'string') {
    return res.status(400).json({ erro: 'PDF em base64 não fornecido.' });
  }
  if (pdfBase64.length > 14_000_000) {
    return res.status(413).json({ erro: 'PDF demasiado grande. Máximo 10MB.' });
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

  // ── 2. Detectar texto invisível (cor branca / font-size 0) ──
  const textoInvisivel = [];
  for (const content of streamContents) {
    try {
      const alertas = detectarTextoInvisivel(content);
      textoInvisivel.push(...alertas);
    } catch {}
  }

  // ── 3. Extrair texto para análise linguística ──
  const textoExtraido = extrairTextoDosStreams(streamContents);
  const textoUTF8 = pdfBuffer.toString('utf8');
  const textoCombinado = textoExtraido + ' ' + textoUTF8.substring(0, 50000);

  // ── 4. Análise ──
  const unicodeEncontrados    = detectarUnicodeInvisivelBruto(textoUTF8, textoExtraido);
  const padroesEncontrados    = detectarPadroesLinguisticos(textoCombinado);
  const anomaliasEncontradas  = detectarAnomalias(textoExtraido || textoUTF8.substring(0, 30000));

  const score = calcularRisco(unicodeEncontrados, padroesEncontrados, anomaliasEncontradas, textoInvisivel);
  const veredicto = veredictoRisco(score, unicodeEncontrados, padroesEncontrados, anomaliasEncontradas, textoInvisivel);
  const totalIndicadores = unicodeEncontrados.length + padroesEncontrados.length + anomaliasEncontradas.length + textoInvisivel.length;

  return res.status(200).json({
    veredicto,
    score,
    total_indicadores: totalIndicadores,
    unicode_invisivel: unicodeEncontrados,
    padroes_linguisticos: padroesEncontrados,
    anomalias_estruturais: [...anomaliasEncontradas, ...textoInvisivel],
    meta: {
      fonte: 'bytes_brutos_pdf',
      nome_ficheiro: nomeFile || 'desconhecido',
      tamanho_bytes: pdfBuffer.length,
      streams_extraidos: streamContents.length,
      texto_invisivel_detectado: textoInvisivel.length,
    },
    recomendacao: veredicto === 'INJECTION_DETECTADA'
      ? 'PDF contém indícios fortes de prompt injection. Não processe com IA sem revisão humana completa.'
      : veredicto === 'SUSPEITO'
      ? 'PDF apresenta elementos suspeitos. Reveja manualmente antes de processar com IA.'
      : 'Nenhum indicador de prompt injection detectado nos bytes brutos do PDF.',
  });
};
