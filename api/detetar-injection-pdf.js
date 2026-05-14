// /api/detetar-injection-pdf.js — LexVeritas Detector de Prompt Injection (PDF bytes brutos)
// Vercel Serverless Function — Node.js 18+ — CommonJS
// v1.0 — recebe PDF em base64, analisa bytes brutos preservando Unicode invisível

const SUPABASE_URL      = 'https://bsbgizaftamufmmxeyer.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJzYmdpemFmdGFtdWZtbXhleWVyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc3NDkzNTIsImV4cCI6MjA5MzMyNTM1Mn0._xBiw0VUa3FSnortYseUQPDc5xb--k15lYcylNmMEEQ';

// ── Caracteres Unicode invisíveis conhecidos usados em prompt injection ──
const UNICODE_INVISIVEL = [
  { char: '\u200B', nome: 'Zero-Width Space' },
  { char: '\u200C', nome: 'Zero-Width Non-Joiner' },
  { char: '\u200D', nome: 'Zero-Width Joiner' },
  { char: '\u200E', nome: 'Left-to-Right Mark' },
  { char: '\u200F', nome: 'Right-to-Left Mark' },
  { char: '\uFEFF', nome: 'BOM / Zero-Width No-Break Space' },
  { char: '\u2060', nome: 'Word Joiner' },
  { char: '\u2061', nome: 'Function Application' },
  { char: '\u2062', nome: 'Invisible Times' },
  { char: '\u2063', nome: 'Invisible Separator' },
  { char: '\u2064', nome: 'Invisible Plus' },
  { char: '\u00AD', nome: 'Soft Hyphen' },
  { char: '\u180E', nome: 'Mongolian Vowel Separator' },
  { char: '\u034F', nome: 'Combining Grapheme Joiner' },
  { char: '\u115F', nome: 'Hangul Choseong Filler' },
  { char: '\u1160', nome: 'Hangul Jungseong Filler' },
  { char: '\u17B4', nome: 'Khmer Vowel Inherent Aq' },
  { char: '\u17B5', nome: 'Khmer Vowel Inherent Aa' },
  { char: '\u3164', nome: 'Hangul Filler' },
  { char: '\uFFA0', nome: 'Halfwidth Hangul Filler' },
];

// ── Padrões linguísticos típicos de prompt injection ──
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
  { re: /\[SYSTEM\]/gi, tipo: 'system_override', gravidade: 'critica', desc: 'Tag [SYSTEM] — tentativa de override de prompt de sistema' },
  { re: /\[INST\]/gi, tipo: 'system_override', gravidade: 'critica', desc: 'Tag [INST] — formato de instrução de modelo' },
  { re: /<\|system\|>/gi, tipo: 'system_override', gravidade: 'critica', desc: 'Tag <|system|> — formato Llama' },
  { re: /\{\{system\}\}/gi, tipo: 'system_override', gravidade: 'critica', desc: 'Template de sistema {{system}}' },
  { re: /###\s*instruction/gi, tipo: 'system_override', gravidade: 'alta', desc: '### Instruction — formato de prompt de instrução' },
  { re: /<!--[\s\S]{0,500}?-->/g, tipo: 'comentario_html', gravidade: 'media', desc: 'Comentário HTML oculto no texto' },
  { re: /\/\*[\s\S]{0,200}?\*\//g, tipo: 'comentario_codigo', gravidade: 'media', desc: 'Comentário de código oculto no texto' },
  { re: /(?:ChatGPT|GPT-4|GPT-3|Claude|Gemini|Llama|Mistral|Copilot)\s*[:,]\s*(?:responde|analisa|confirma|diz|afirma)/gi, tipo: 'referencia_modelo', gravidade: 'alta', desc: 'Instrução directa a modelo de IA específico' },
];

// ── Extrai texto de PDF preservando Unicode ──
// Usamos uma abordagem de extracção manual do stream de conteúdo do PDF
// em vez de usar pdf.js (que descarta caracteres invisíveis).
// Procuramos os streams de texto dentro do PDF e decodificamos directamente.
function extrairTextoPDFBruto(buffer) {
  // Converte o buffer para string preservando todos os bytes
  // PDF é um formato binário — extraímos as secções de texto entre BT...ET
  const bytes = Buffer.from(buffer);
  const pdfStr = bytes.toString('latin1'); // latin1 preserva todos os bytes 0x00-0xFF

  const textChunks = [];

  // Extrair streams de conteúdo (entre "stream\r\n" e "\r\nendstream")
  const streamRegex = /stream[\r\n]([\s\S]*?)[\r\n]endstream/g;
  let streamMatch;
  while ((streamMatch = streamRegex.exec(pdfStr)) !== null) {
    const streamContent = streamMatch[1];

    // Dentro do stream, procurar operadores de texto Tj, TJ, '  (após BT)
    // Tj: (texto)Tj — texto literal
    // TJ: [(texto) offset (texto)]TJ — array de texto
    // ': string após newline
    const tjRegex = /\(([^)\\]*(?:\\.[^)\\]*)*)\)\s*(?:Tj|'|")/g;
    let tjMatch;
    while ((tjMatch = tjRegex.exec(streamContent)) !== null) {
      const rawText = tjMatch[1];
      // Descodificar sequências de escape PDF: \n \r \t \( \) \\ e \ddd (octal)
      const decoded = rawText
        .replace(/\\(\d{1,3})/g, (_, oct) => String.fromCharCode(parseInt(oct, 8)))
        .replace(/\\n/g, '\n')
        .replace(/\\r/g, '\r')
        .replace(/\\t/g, '\t')
        .replace(/\\\(/g, '(')
        .replace(/\\\)/g, ')')
        .replace(/\\\\/g, '\\');
      if (decoded.trim()) textChunks.push(decoded);
    }

    // TJ arrays: [(texto)(texto) num]TJ
    const tjArrayRegex = /\[([\s\S]*?)\]\s*TJ/g;
    let tjArrMatch;
    while ((tjArrMatch = tjArrayRegex.exec(streamContent)) !== null) {
      const inner = tjArrMatch[1];
      const innerTj = /\(([^)\\]*(?:\\.[^)\\]*)*)\)/g;
      let innerMatch;
      while ((innerMatch = innerTj.exec(inner)) !== null) {
        const rawText = innerMatch[1];
        const decoded = rawText
          .replace(/\\(\d{1,3})/g, (_, oct) => String.fromCharCode(parseInt(oct, 8)))
          .replace(/\\n/g, '\n').replace(/\\r/g, '\r').replace(/\\t/g, '\t')
          .replace(/\\\(/g, '(').replace(/\\\)/g, ')').replace(/\\\\/g, '\\');
        if (decoded.trim()) textChunks.push(decoded);
      }
    }
  }

  // Também analisar o buffer binário inteiro à procura de sequências UTF-16
  // (PDFs com encoding ToUnicode usam UTF-16BE para caracteres especiais)
  // Extraímos todos os bytes e tentamos decodificar como UTF-16
  const utf16Chunks = [];
  for (let i = 0; i < bytes.length - 1; i++) {
    // BOM UTF-16 BE: 0xFE 0xFF
    if (bytes[i] === 0xFE && bytes[i + 1] === 0xFF) {
      let end = i + 2;
      while (end < bytes.length - 1 && !(bytes[end] === 0x00 && bytes[end + 1] === 0x00)) end += 2;
      try {
        const slice = bytes.slice(i, end);
        utf16Chunks.push(slice.toString('utf16le'));
      } catch {}
    }
  }

  const textoExtraido = textChunks.join(' ') + ' ' + utf16Chunks.join(' ');

  // IMPORTANTE: também devolvemos o buffer original como string para busca
  // directa de sequências de bytes correspondentes a UTF-8 de caracteres invisíveis
  const textoUTF8 = bytes.toString('utf8');

  return { textoExtraido, textoUTF8, numChunks: textChunks.length };
}

// ── Detector de Unicode invisível nos bytes brutos ──
function detectarUnicodeInvisivelBruto(textoUTF8, textoExtraido) {
  const encontrados = [];
  const textoCombinado = textoUTF8 + ' ' + textoExtraido;

  for (const { char, nome } of UNICODE_INVISIVEL) {
    // Contar no texto UTF-8 directo (bytes brutos do PDF)
    const countUTF8 = (textoUTF8.split(char)).length - 1;
    // Contar no texto extraído dos streams
    const countExtraido = (textoExtraido.split(char)).length - 1;
    const count = Math.max(countUTF8, countExtraido);

    if (count > 0) {
      const codePoint = char.codePointAt(0).toString(16).toUpperCase().padStart(4, '0');

      // Calcular gravidade: BOM único no início é normal em PDFs; múltiplos são suspeitos
      let gravidade = 'alta';
      if (char === '\uFEFF' && count === 1) {
        gravidade = 'baixa'; // BOM único — normal
      } else if (count > 10) {
        gravidade = 'critica';
      } else if (count > 3) {
        gravidade = 'alta';
      } else {
        gravidade = 'media';
      }

      // Ignorar BOM único — é normal em PDFs bem formados
      if (char === '\uFEFF' && count === 1) continue;

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

  // Detector adicional: sequências de bytes suspeitas típicas de steganografia
  // Steganography via combining chars (U+0300–U+036F em excesso)
  const combiningCharsCount = (textoUTF8.match(/[\u0300-\u036F]/g) || []).length;
  if (combiningCharsCount > 50) {
    encontrados.push({
      tipo: 'unicode_invisivel',
      gravidade: 'alta',
      desc: `${combiningCharsCount} caracteres de combinação Unicode (U+0300–U+036F) — possível steganografia`,
      count: combiningCharsCount,
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
    alertas.push({ tipo: 'espacos_anomalos', gravidade: 'media', desc: `${espacosAnomalia.length} sequências com espaços excessivos — possível texto oculto` });
  }
  const linhas = texto.split('\n');
  const linhasCurtas = linhas.filter(l => l.trim().length > 0 && l.trim().length < 4);
  if (linhasCurtas.length > 10) {
    alertas.push({ tipo: 'fragmentacao_texto', gravidade: 'media', desc: `${linhasCurtas.length} linhas muito curtas — possível fragmentação de instrução oculta` });
  }
  return alertas;
}

// ── Score de risco ──
function calcularRisco(unicode, padroes, anomalias) {
  let score = 0;
  for (const u of unicode) {
    if (u.gravidade === 'critica') score += 40;
    else if (u.gravidade === 'alta') score += 25;
    else if (u.gravidade === 'media') score += 12;
    else score += 5;
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

function veredictoRisco(score, totalIndicadores) {
  if (score >= 60 || totalIndicadores >= 3) return 'INJECTION_DETECTADA';
  if (score >= 30 || totalIndicadores >= 1) return 'SUSPEITO';
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

  // ── Autenticação ──
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

  // Verificar tamanho (máx ~10MB em base64 ≈ 7.5MB em bytes)
  if (pdfBase64.length > 14_000_000) {
    return res.status(413).json({ erro: 'PDF demasiado grande. Máximo 10MB.' });
  }

  let pdfBuffer;
  try {
    pdfBuffer = Buffer.from(pdfBase64, 'base64');
  } catch {
    return res.status(400).json({ erro: 'Base64 inválido.' });
  }

  // ── Extrair texto preservando Unicode ──
  const { textoExtraido, textoUTF8, numChunks } = extrairTextoPDFBruto(pdfBuffer);
  const textoCombinado = textoExtraido + ' ' + textoUTF8.substring(0, 50000); // limitar UTF-8 raw

  if (numChunks === 0 && textoUTF8.length < 100) {
    return res.status(400).json({ erro: 'PDF sem conteúdo extraível. Tente copiar o texto manualmente.' });
  }

  // ── Análise ──
  const unicodeEncontrados = detectarUnicodeInvisivelBruto(textoUTF8, textoExtraido);
  const padroesEncontrados = detectarPadroesLinguisticos(textoCombinado);
  const anomaliasEncontradas = detectarAnomalias(textoExtraido || textoUTF8.substring(0, 30000));

  const totalIndicadores = unicodeEncontrados.length + padroesEncontrados.length + anomaliasEncontradas.length;
  const score = calcularRisco(unicodeEncontrados, padroesEncontrados, anomaliasEncontradas);
  const veredicto = veredictoRisco(score, totalIndicadores);

  return res.status(200).json({
    veredicto,
    score,
    total_indicadores: totalIndicadores,
    unicode_invisivel: unicodeEncontrados,
    padroes_linguisticos: padroesEncontrados,
    anomalias_estruturais: anomaliasEncontradas,
    meta: {
      fonte: 'bytes_brutos_pdf',
      nome_ficheiro: nomeFile || 'desconhecido',
      tamanho_bytes: pdfBuffer.length,
      chunks_texto: numChunks,
    },
    recomendacao: veredicto === 'INJECTION_DETECTADA'
      ? 'PDF contém indícios fortes de prompt injection nos bytes brutos. Não processe com IA sem revisão humana completa.'
      : veredicto === 'SUSPEITO'
      ? 'PDF apresenta elementos suspeitos. Reveja manualmente antes de processar com IA.'
      : 'Nenhum indicador de prompt injection detectado nos bytes brutos do PDF.',
  });
};
