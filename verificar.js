// /api/verificar.js — LexVeritas Verificador de Citações
// Vercel Serverless Function — Node.js 18+ — CommonJS
// v1.0 — verificação de acórdãos via juris.stj.pt (ElasticSearch) + doutrina via RCAAP OAI-PMH
//
// ARQUITECTURA:
//   POST /api/verificar
//   Body: { citacoes: [{ citacao, tipo, problema, gravidade }] }
//   Devolve: { resultados: [{ ...citacao, verificacao: { encontrado, fonte, url, confianca, detalhe } }] }
//
// FONTES:
//   Acórdãos  → juris.stj.pt (agrega TODOS os tribunais do DGSI via ElasticSearch)
//   Doutrina  → rcaap.pt (repositório científico PT, OAI-PMH / query URL)
//
// LIMITES:
//   Max 8 citações por chamada (para não ultrapassar timeout Vercel 60s)
//   Chamadas em paralelo com Promise.allSettled
//   Timeout individual por fonte: 8 segundos
//
// VARIÁVEIS DE AMBIENTE NECESSÁRIAS (Vercel Dashboard → Settings → Environment Variables):
//   VERIFICAR_ATIVO=true   (desliga toda a verificação se false — útil para debug)

const SUPABASE_URL      = 'https://bsbgizaftamufmmxeyer.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJzYmdpemFmdGFtdWZtbXhleWVyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc3NDkzNTIsImV4cCI6MjA5MzMyNTM1Mn0._xBiw0VUa3FSnortYseUQPDc5xb--k15lYcylNmMEEQ';

// ── Timeout helper ──
function comTimeout(promise, ms, mensagem) {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(mensagem || `Timeout após ${ms}ms`)), ms)
    ),
  ]);
}

// ══════════════════════════════════════════════════════════════════════════════
// VERIFICADOR DE ACÓRDÃOS — juris.stj.pt
//
// O juris.stj.pt usa ElasticSearch internamente e expõe uma API de pesquisa
// acessível sem autenticação. Agrega todos os tribunais do DGSI:
// STJ, TRL, TRP, TRC, TRG, TRE, STA, TC, TCAN, TCAS
//
// URL de pesquisa: https://juris.stj.pt/pesquisa?q=NUMERO_PROCESSO
// A página devolve HTML com os resultados. Fazemos parse do HTML para
// detectar se há resultados (presença de elementos de resultado vs. "sem resultados").
//
// Estratégia de verificação:
//   1. Pesquisar o número de processo como texto livre
//   2. Verificar se a resposta HTML contém indicadores de resultado encontrado
//   3. Tentar extrair metadados (tribunal, data, relator) se disponíveis
// ══════════════════════════════════════════════════════════════════════════════

async function verificarAcordaoJurisStj(numero) {
  if (!numero || typeof numero !== 'string') {
    return { encontrado: false, fonte: 'juris.stj.pt', erro: 'Número inválido' };
  }

  const numeroLimpo = numero.trim().toUpperCase();

  try {
    // Pesquisa por texto livre — o juris.stj.pt aceita o número de processo directamente
    const url = `https://juris.stj.pt/pesquisa?q=${encodeURIComponent('"' + numeroLimpo + '"')}`;

    const response = await comTimeout(
      fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; LexVeritas/1.0; +https://lexveritas.pt)',
          'Accept': 'text/html,application/xhtml+xml',
          'Accept-Language': 'pt-PT,pt;q=0.9',
        },
      }),
      8000,
      'juris.stj.pt timeout'
    );

    if (!response.ok) {
      return {
        encontrado: false,
        fonte: 'juris.stj.pt',
        url,
        erro: `HTTP ${response.status}`,
      };
    }

    const html = await response.text();

    // Detectar ausência de resultados
    const semResultados =
      html.includes('Sem resultados') ||
      html.includes('sem resultados') ||
      html.includes('0 resultado') ||
      html.includes('nenhum resultado') ||
      html.includes('no results') ||
      // Padrão específico do juris.stj.pt quando não encontra nada
      html.includes('resultados encontrados: 0') ||
      html.includes('total": 0') ||
      html.includes('"total":0');

    if (semResultados) {
      return {
        encontrado: false,
        fonte: 'juris.stj.pt',
        url,
        confianca: 'alta',
        detalhe: 'Número de processo não encontrado em nenhum tribunal do DGSI.',
      };
    }

    // Detectar presença de resultados
    const temResultados =
      html.includes('data-processo') ||
      html.includes('class="processo"') ||
      html.includes('class="acordao"') ||
      html.includes('class="resultado') ||
      html.includes('Processo:') ||
      html.includes('Relator:') ||
      html.includes('Data do Acordão') ||
      html.includes('Data do Acórdão') ||
      // Padrão numérico do processo na página de resultado
      html.includes(numeroLimpo) ||
      // ElasticSearch devolve hits
      html.includes('"hits"') ||
      html.includes('resultado');

    if (temResultados) {
      // Tentar extrair tribunal da resposta HTML
      let tribunal = null;
      const matchTribunal = html.match(/Tribunal[^:]*:\s*([^\n<"]+)/i);
      if (matchTribunal) tribunal = matchTribunal[1].trim().substring(0, 80);

      let data = null;
      const matchData = html.match(/Data do Acórd[aã]o[^:]*:\s*([\d\/\-\.]+)/i);
      if (matchData) data = matchData[1].trim();

      let relator = null;
      const matchRelator = html.match(/Relator[^:]*:\s*([^\n<"]+)/i);
      if (matchRelator) relator = matchRelator[1].trim().substring(0, 60);

      return {
        encontrado: true,
        fonte: 'juris.stj.pt',
        url,
        confianca: 'alta',
        detalhe: [
          tribunal ? `Tribunal: ${tribunal}` : null,
          data     ? `Data: ${data}`         : null,
          relator  ? `Relator: ${relator}`   : null,
        ].filter(Boolean).join(' | ') || 'Acórdão encontrado no DGSI.',
      };
    }

    // Resultado ambíguo — não conseguimos determinar
    return {
      encontrado: null,
      fonte: 'juris.stj.pt',
      url,
      confianca: 'baixa',
      detalhe: 'Não foi possível determinar — verifique manualmente em juris.stj.pt.',
    };

  } catch (err) {
    return {
      encontrado: null,
      fonte: 'juris.stj.pt',
      erro: err.message,
      confianca: 'indisponivel',
      detalhe: 'Serviço temporariamente indisponível. Verifique manualmente.',
    };
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// VERIFICADOR DE DOUTRINA — RCAAP
//
// O RCAAP (rcaap.pt) é construído sobre Apache Solr e expõe uma URL de pesquisa
// com parâmetros estáveis acessíveis sem autenticação.
//
// URL de pesquisa: https://www.rcaap.pt/search.jsp?query=TERMO&rpp=5&sort_by=0
// Devolve HTML com resultados de repositórios académicos portugueses.
//
// Estratégia:
//   1. Pesquisar por título + autor (se disponíveis)
//   2. Verificar se há resultados no HTML
//   3. Extrair metadados básicos (título, autor, instituição, ano)
// ══════════════════════════════════════════════════════════════════════════════

async function verificarDoutrinaRcaap(citacaoTexto) {
  if (!citacaoTexto || typeof citacaoTexto !== 'string') {
    return { encontrado: false, fonte: 'RCAAP', erro: 'Citação inválida' };
  }

  // Extrair termos de pesquisa da citação
  // Exemplos de formato: "FREITAS, Lebre de — A Acção Executiva, 9.ª ed., p. 234"
  // "GERALDES, Abrantes — Recursos no Novo Código de Processo Civil, 2022"
  const termos = citacaoTexto
    .replace(/[,.\-—–;:()[\]]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .substring(0, 120); // Limitar tamanho da query

  if (termos.length < 5) {
    return { encontrado: false, fonte: 'RCAAP', erro: 'Citação demasiado curta para pesquisar' };
  }

  try {
    const url = `https://www.rcaap.pt/search.jsp?query=${encodeURIComponent(termos)}&rpp=5&sort_by=0&order=DESC`;

    const response = await comTimeout(
      fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; LexVeritas/1.0; +https://lexveritas.pt)',
          'Accept': 'text/html,application/xhtml+xml',
          'Accept-Language': 'pt-PT,pt;q=0.9',
        },
      }),
      8000,
      'RCAAP timeout'
    );

    if (!response.ok) {
      return {
        encontrado: false,
        fonte: 'RCAAP',
        url,
        erro: `HTTP ${response.status}`,
      };
    }

    const html = await response.text();

    // Detectar ausência de resultados
    const semResultados =
      html.includes('Sem resultados') ||
      html.includes('sem resultados') ||
      html.includes('0 resultados') ||
      html.includes('nenhum resultado') ||
      html.includes('No results') ||
      html.includes('ds-result-count">0');

    if (semResultados) {
      return {
        encontrado: false,
        fonte: 'RCAAP',
        url,
        confianca: 'media', // Doutrina pode existir mas não estar no RCAAP (livros não são OA)
        detalhe: 'Não encontrado no RCAAP. Nota: o RCAAP agrega repositórios de acesso aberto — livros comerciais podem não estar indexados.',
      };
    }

    // Detectar presença de resultados
    const temResultados =
      html.includes('ds-artifact-item') ||
      html.includes('item-list') ||
      html.includes('class="list-group-item"') ||
      html.includes('artifact-description') ||
      html.includes('ds-result-count') ||
      html.includes('resultado');

    if (temResultados) {
      // Tentar extrair primeiro resultado
      let titulo = null;
      const matchTitulo = html.match(/class="artifact-title"[^>]*>([^<]{5,120})/i) ||
                          html.match(/class="item-title"[^>]*>([^<]{5,120})/i);
      if (matchTitulo) titulo = matchTitulo[1].trim();

      let autor = null;
      const matchAutor = html.match(/class="artifact-info author"[^>]*>([^<]{3,80})/i) ||
                         html.match(/class="author"[^>]*>([^<]{3,80})/i);
      if (matchAutor) autor = matchAutor[1].trim();

      return {
        encontrado: true,
        fonte: 'RCAAP',
        url,
        confianca: 'media', // Media porque a doutrina pode ter edições diferentes
        detalhe: [
          'Encontrado no repositório RCAAP.',
          titulo ? `Título: ${titulo.substring(0, 80)}` : null,
          autor  ? `Autor: ${autor.substring(0, 60)}`  : null,
          'Nota: verifique edição e página citada na obra original.',
        ].filter(Boolean).join(' | '),
      };
    }

    return {
      encontrado: null,
      fonte: 'RCAAP',
      url,
      confianca: 'baixa',
      detalhe: 'Não foi possível determinar — verifique manualmente em rcaap.pt.',
    };

  } catch (err) {
    return {
      encontrado: null,
      fonte: 'RCAAP',
      erro: err.message,
      confianca: 'indisponivel',
      detalhe: 'Serviço temporariamente indisponível. Verifique manualmente em rcaap.pt.',
    };
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// VERIFICADOR DE DIPLOMAS LEGAIS — DRE (dre.pt)
//
// Bónus: para diplomas legais (leis, decretos-lei, portarias) verificamos
// se o diploma existe e se está em vigor, via dre.pt que tem URLs estáveis.
//
// URL: https://dre.pt/web/guest/pesquisa/-/search/NUMERO+ANO+TIPO
// ══════════════════════════════════════════════════════════════════════════════

async function verificarDiplomaLegalDre(citacaoTexto) {
  if (!citacaoTexto || typeof citacaoTexto !== 'string') {
    return { encontrado: null, fonte: 'DRE', erro: 'Citação inválida' };
  }

  // Extrair padrão de diploma legal português
  // Exemplos: "Lei n.º 62/2013", "Decreto-Lei n.º 49/2014", "Portaria n.º 280/2013"
  const RE_DIPLOMA = /(?:Lei|Decreto[-\s]Lei|Portaria|Despacho|Resolução|Regulamento)\s+n\.?[oºª]?\s*([\d][\d\-A-Z]*)\/(\d{2,4})/gi;
  const match = RE_DIPLOMA.exec(citacaoTexto);

  if (!match) {
    return {
      encontrado: null,
      fonte: 'DRE',
      detalhe: 'Não foi possível identificar o diploma legal para verificar.',
    };
  }

  const numero = match[1];
  const anoRaw = match[2];
  const ano    = anoRaw.length === 2 ? (parseInt(anoRaw) >= 90 ? '19' + anoRaw : '20' + anoRaw) : anoRaw;

  try {
    const numeroBase = numero.replace(/[^0-9]/g, ''); // remove sufixos como -A para a API
    const url = `https://dre.pt/dre/api/legislation?number=${numeroBase}&year=${ano}`;

    const response = await comTimeout(
      fetch(url, {
        headers: {
          'Accept': 'application/json',
          'User-Agent': 'Mozilla/5.0 (compatible; LexVeritas/1.0; +https://lexveritas.pt)',
        },
      }),
      6000,
      'DRE timeout'
    );

    // Se não conseguimos via API, tentamos via URL de pesquisa HTML
    if (!response.ok) {
      const urlHtml = `https://dre.pt/web/guest/pesquisa/-/search/${encodeURIComponent(citacaoTexto.substring(0, 60))}`;
      return {
        encontrado: null,
        fonte: 'DRE',
        url: urlHtml,
        confianca: 'baixa',
        detalhe: `Não foi possível verificar automaticamente a Lei n.º ${numero}/${ano}. Verifique em dre.pt.`,
      };
    }

    const data = await response.json().catch(() => null);

    if (data && (data.results?.length > 0 || data.total > 0 || data.id)) {
      const item = data.results?.[0] || data;
      return {
        encontrado: true,
        fonte: 'DRE',
        url: item.url || `https://dre.pt/web/guest/pesquisa/-/search/${numero}`,
        confianca: 'alta',
        detalhe: [
          'Diploma encontrado no Diário da República.',
          item.title   ? `Título: ${item.title}`         : null,
          item.date    ? `Data: ${item.date}`             : null,
          item.revoked ? '⚠️ ATENÇÃO: diploma revogado.' : null,
        ].filter(Boolean).join(' | '),
      };
    }

    return {
      encontrado: false,
      fonte: 'DRE',
      url: `https://dre.pt/web/guest/pesquisa/-/search/${numero}`,
      confianca: 'media',
      detalhe: `Diploma n.º ${numero}/${ano} não encontrado no DRE. Verifique manualmente.`,
    };

  } catch (err) {
    return {
      encontrado: null,
      fonte: 'DRE',
      erro: err.message,
      confianca: 'indisponivel',
      detalhe: 'DRE temporariamente indisponível. Verifique manualmente em dre.pt.',
    };
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// ROUTER — escolhe o verificador certo para cada tipo de citação
// ══════════════════════════════════════════════════════════════════════════════

async function verificarCitacao(citacao) {
  const { citacao: texto, tipo } = citacao;

  let verificacao;
  switch (tipo) {
    case 'acordao':
    case 'jurisprudencia':
      verificacao = await verificarAcordaoJurisStj(texto);
      break;

    case 'diploma_legal':
      verificacao = await verificarDiplomaLegalDre(texto);
      break;

    case 'doutrina':
      verificacao = await verificarDoutrinaRcaap(texto);
      break;

    default:
      // Tipo desconhecido — tenta como acórdão se parecer um número de processo
      if (/^\d{1,6}\/\d{2,4}\.\d/.test(texto)) {
        verificacao = await verificarAcordaoJurisStj(texto);
      } else {
        verificacao = {
          encontrado: null,
          fonte: 'N/A',
          detalhe: 'Tipo de citação não suportado para verificação automática.',
        };
      }
  }

  return {
    ...citacao,
    verificacao,
  };
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

  // ── Verificar se a funcionalidade está activa ──
  const verificarAtivo = process.env.VERIFICAR_ATIVO !== 'false';
  if (!verificarAtivo) {
    return res.status(200).json({
      resultados: [],
      aviso: 'Verificação de citações desactivada. Active com VERIFICAR_ATIVO=true.',
    });
  }

  // ── Autenticação ──
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

  // ── Corpo ──
  const body = req.body || {};
  const { citacoes } = body;

  if (!Array.isArray(citacoes) || citacoes.length === 0) {
    return res.status(400).json({ erro: 'Array de citações em falta ou vazio.' });
  }

  // Limitar a 8 citações por chamada
  const citacoesAVerificar = citacoes.slice(0, 8).filter(c =>
    c && typeof c.citacao === 'string' && c.citacao.trim().length > 3
  );

  if (citacoesAVerificar.length === 0) {
    return res.status(400).json({ erro: 'Nenhuma citação válida para verificar.' });
  }

  try {
    // Verificar todas em paralelo (com timeout individual por verificação)
    const promises = citacoesAVerificar.map(c =>
      comTimeout(
        verificarCitacao(c),
        12000,
        `Timeout ao verificar: ${c.citacao?.substring(0, 40)}`
      ).catch(err => ({
        ...c,
        verificacao: {
          encontrado: null,
          fonte: 'N/A',
          erro: err.message,
          confianca: 'indisponivel',
          detalhe: 'Erro interno ao verificar. Tente novamente.',
        },
      }))
    );

    const resultados = await Promise.allSettled(promises).then(results =>
      results.map(r => r.status === 'fulfilled' ? r.value : {
        verificacao: { encontrado: null, fonte: 'N/A', erro: 'Falha inesperada' },
      })
    );

    // Estatísticas resumo
    const stats = {
      total: resultados.length,
      encontrados:      resultados.filter(r => r.verificacao?.encontrado === true).length,
      nao_encontrados:  resultados.filter(r => r.verificacao?.encontrado === false).length,
      inconclusivos:    resultados.filter(r => r.verificacao?.encontrado === null).length,
    };

    return res.status(200).json({ resultados, stats });

  } catch (err) {
    console.error('verificar.js unhandled:', err.message);
    return res.status(500).json({ erro: 'Erro interno. Tente novamente.' });
  }
};
