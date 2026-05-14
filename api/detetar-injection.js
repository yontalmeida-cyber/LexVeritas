// /api/detetar-injection.js — LexVeritas Detector de Prompt Injection
// Vercel Serverless Function — Node.js 18+ — CommonJS
// v1.0 — detecta prompt injection oculta em documentos jurídicos

const SUPABASE_URL      = 'https://bsbgizaftamufmmxeyer.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJzYmdpemFmdGFtdWZtbXhleWVyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc3NDkzNTIsImV4cCI6MjA5MzMyNTM1Mn0._xBiw0VUa3FSnortYseUQPDc5xb--k15lYcylNmMEEQ';

// ── Caracteres Unicode invisíveis conhecidos usados em prompt injection ──
const UNICODE_INVISIVEL = [
  '\u200B', // zero-width space
  '\u200C', // zero-width non-joiner
  '\u200D', // zero-width joiner
  '\u200E', // left-to-right mark
  '\u200F', // right-to-left mark
  '\uFEFF', // byte order mark / zero-width no-break space
  '\u2060', // word joiner
  '\u2061', // function application
  '\u2062', // invisible times
  '\u2063', // invisible separator
  '\u2064', // invisible plus
  '\u00AD', // soft hyphen
  '\u180E', // mongolian vowel separator
  '\u034F', // combining grapheme joiner
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
  const contagens = {};

  for (const char of UNICODE_INVISIVEL) {
    const count = (texto.split(char)).length - 1;
    if (count > 0) {
      const codePoint = char.codePointAt(0).toString(16).toUpperCase().padStart(4, '0');
      contagens[`U+${codePoint}`] = count;
      encontrados.push({
        tipo: 'unicode_invisivel',
        gravidade: count > 5 ? 'critica' : 'alta',
        desc: `Caractere invisível U+${codePoint} encontrado ${count} vez${count > 1 ? 'es' : ''}`,
        count,
        codePoint: `U+${codePoint}`,
      });
    }
  }

  return { encontrados, contagens };
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
      if (matches.length >= 3) break; // Máx 3 ocorrências por padrão
    }

    if (matches.length > 0) {
      encontrados.push({
        tipo: padrao.tipo,
        gravidade: padrao.gravidade,
        desc: padrao.desc,
        ocorrencias: matches,
      });
    }
  }

  return encontrados;
}

// ── Detector de repetição anómala ──
// Texto de injection oculto por repetição com separadores invisíveis
function detectarRepeticaoAnomala(texto) {
  const alertas = [];

  // Sequências de espaços anómalas (mais de 5 espaços consecutivos fora de início de linha)
  const espacosAnimalos = texto.match(/[^\n] {6,}/g);
  if (espacosAnimalos && espacosAnimalos.length > 3) {
    alertas.push({
      tipo: 'espacos_anomalos',
      gravidade: 'media',
      desc: `${espacosAnimalos.length} sequências com espaços excessivos — possível texto oculto`,
    });
  }

  // Linhas muito curtas intercaladas (técnica de fragmentação)
  const linhas = texto.split('\n');
  const linhasCurtas = linhas.filter(l => l.trim().length > 0 && l.trim().length < 4);
  if (linhasCurtas.length > 10) {
    alertas.push({
      tipo: 'fragmentacao_texto',
      gravidade: 'media',
      desc: `${linhasCurtas.length} linhas muito curtas — possível fragmentação de instrução oculta`,
    });
  }

  return alertas;
}

// ── Calcular score de risco ──
function calcularRisco(unicode, padroes, anomalias) {
  let score = 0;

  for (const u of unicode) {
    if (u.gravidade === 'critica') score += 40;
    else if (u.gravidade === 'alta') score += 25;
    else score += 10;
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

  const { texto } = req.body || {};
  if (!texto || typeof texto !== 'string' || texto.trim().length < 20) {
    return res.status(400).json({ erro: 'Texto insuficiente.' });
  }

  // ── Análise ──
  const { encontrados: unicodeEncontrados } = detectarUnicodeInvisivel(texto);
  const padroesEncontrados = detectarPadroesLinguisticos(texto);
  const anomaliasEncontradas = detectarRepeticaoAnomala(texto);

  const totalIndicadores = unicodeEncontrados.length + padroesEncontrados.length + anomaliasEncontradas.length;
  const score = calcularRisco(unicodeEncontrados, padroesEncontrados, anomaliasEncontradas);
  const veredicto = veredictoRisco(score, totalIndicadores);

  const resumo = {
    veredicto,
    score,
    total_indicadores: totalIndicadores,
    unicode_invisivel: unicodeEncontrados,
    padroes_linguisticos: padroesEncontrados,
    anomalias_estruturais: anomaliasEncontradas,
    recomendacao: veredicto === 'INJECTION_DETECTADA'
      ? 'Documento contém indícios fortes de prompt injection. Não processe com IA sem revisão humana completa.'
      : veredicto === 'SUSPEITO'
      ? 'Documento apresenta elementos suspeitos. Reveja manualmente antes de processar com IA.'
      : 'Nenhum indicador de prompt injection detectado. Documento aparenta ser legítimo.',
  };

  return res.status(200).json(resumo);
};
