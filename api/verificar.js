// /api/verificar.js — LexVeritas Verificador de Citações
// Vercel Serverless Function — Node.js 18+ — CommonJS
// v1.2 — integração BNP/PORBASE para doutrina + fallback DGSI sempre disponível
//        + suavização falsos positivos comarca/tribunal
//
// FONTES:
//   Acórdãos      → juris.stj.pt (ElasticSearch DGSI) + fallback link DGSI directo
//   Diplomas      → dre.pt (API + fallback HTML)
//   Doutrina      → PORBASE (catálogo union de todas as bibliotecas PT) + BNP catálogo
//                   + RCAAP (repositório acesso aberto) como tertiary fallback
//
// BNP/PORBASE:
//   PORBASE cobre livros comerciais + académicos de todas as bibliotecas portuguesas
//   Endpoint SRU: https://porbase.bnportugal.gov.pt/ipac20/ipac.jsp?session=...
//   Endpoint catálogo BNP: https://catalogo.bnportugal.gov.pt/cgi-bin/koha/opac-search.pl?q=...
//   Sem autenticação necessária — acesso público

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

// ── Gerar links de verificação manual (sempre disponíveis, sem fetch) ──
function gerarLinksDGSI(numero) {
  const enc = encodeURIComponent(numero);
  return {
    juris:         `https://juris.stj.pt/pesquisa?q=${encodeURIComponent('"' + numero + '"')}`,
    dgsi:          `https://www.dgsi.pt/jstj.nsf/954f0ce6ad9dd8b980256b5f003fa814?SearchView&Query=${enc}&SearchOrder=4&SearchMax=10`,
    jurisprudencia:`https://www.jurisprudencia.pt/pesquisa/?q=${enc}`,
  };
}

// ── Extrair termos de pesquisa de uma citação doutrinária ──
// Ex: "FREITAS, Lebre de — A Acção Executiva, 9.ª ed., Coimbra, 2021, p. 234"
// → "Lebre de Freitas Acção Executiva"
function extrairTermosDoutrina(citacao) {
  // Tentar extrair autor e título
  let autor = '', titulo = '';

  // Padrão "APELIDO, Nome — Título"
  const matchAutorTitulo = citacao.match(/^([A-ZÁÉÍÓÚÀÂÊÔÃÕÇ][A-ZÁÉÍÓÚÀÂÊÔÃÕÇa-záéíóúàâêôãõç\s,\.]+?)\s*[—–-]{1,2}\s*(.+?)(?:,\s*\d|$)/);
  if (matchAutorTitulo) {
    autor  = matchAutorTitulo[1].replace(/,/g, ' ').trim();
    titulo = matchAutorTitulo[2].trim();
  }

  // Limpar termos: remover edição, página, ano, editora
  const termosBrutos = (autor + ' ' + titulo + ' ' + citacao)
    .replace(/\d+\.?ª?\s*(ed|edição|vol|volume|p\.|pp\.)[^,]*/gi, '')
    .replace(/\b(Coimbra|Lisboa|Porto|Almedina|Leya|AAFDL|Quid Juris)\b/gi, '')
    .replace(/\b\d{4}\b/g, '')         // anos
    .replace(/\bp\.\s*\d+/gi, '')      // páginas
    .replace(/[,.\-—–;:()[\]]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .substring(0, 100);

  return termosBrutos.length >= 5 ? termosBrutos : citacao.substring(0, 80);
}


// ══════════════════════════════════════════════════════════════════════════════
// REPOSITÓRIOS DSPACE PORTUGUESES — dissertações e teses
//
// Todos os repositórios institucionais PT usam DSpace com URL estável.
// Pesquisa em paralelo nos principais repositórios de Direito.
// ══════════════════════════════════════════════════════════════════════════════

const REPOSITORIOS_DSPACE = [
  { nome: 'ULisboa',  url: 'https://repositorio.ul.pt/simple-search'          },
  { nome: 'UPorto',   url: 'https://repositorio-aberto.up.pt/simple-search'   },
  { nome: 'UNova',    url: 'https://run.unl.pt/simple-search'                 },
  { nome: 'UC',       url: 'https://estudogeral.uc.pt/simple-search'          },
  { nome: 'UA',       url: 'https://ria.ua.pt/simple-search'                  },
  { nome: 'UMinho',   url: 'https://repositorium.sdum.uminho.pt/simple-search' },
  { nome: 'UEvora',   url: 'https://dspace.uevora.pt/simple-search'           },
  { nome: 'UCP',      url: 'https://repositorio.ucp.pt/simple-search'         },
];

async function verificarDoutrinaDSpace(citacaoTexto) {
  const termos = extrairTermosDoutrina(citacaoTexto);
  if (termos.length < 5) return null;

  const enc = encodeURIComponent(termos);

  // Tentar cada repositório em sequência (parar no primeiro positivo)
  for (const repo of REPOSITORIOS_DSPACE) {
    const url = `${repo.url}?query=${enc}&rpp=5&sort_by=score&order=desc`;
    try {
      const response = await comTimeout(
        fetch(url, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (compatible; LexVeritas/1.0; +https://lexveritas.pt)',
            'Accept': 'text/html',
          },
        }),
        6000,
        `${repo.nome} timeout`
      );

      if (!response.ok) continue;
      const html = await response.text();

      // Detectar ausência de resultados DSpace
      const semResultados =
        html.includes('did not match any documents') ||
        html.includes('Your search did not return') ||
        html.includes('nenhum resultado') ||
        html.includes('Nenhum resultado') ||
        html.includes('0 result') ||
        (html.includes('discovery-result-results') && html.includes('ds-result-count">0'));

      if (semResultados) continue;

      // Detectar presença de resultados DSpace
      const temResultados =
        html.includes('ds-artifact-item') ||
        html.includes('discovery-result-results') ||
        html.includes('class="list-group-item"') ||
        html.includes('artifact-description') ||
        html.includes('ds-result-count') ||
        html.includes('item-list') ||
        (html.includes('handle') && html.includes(termos.split(' ')[0]));

      if (temResultados) {
        // Extrair título se disponível
        let titulo = null;
        const matchTit = html.match(/class="artifact-title"[^>]*>\s*(?:<[^>]+>)?([^<]{5,120})/i) ||
                         html.match(/class="ds-preferred-item"[^>]*>([^<]{5,100})/i);
        if (matchTit) titulo = matchTit[1].trim();

        return {
          encontrado: true,
          fonte: `Repositório ${repo.nome}`,
          url,
          confianca: 'alta',
          detalhe: [
            `Encontrado no Repositório ${repo.nome}.`,
            titulo ? `Título: ${titulo.substring(0, 80)}` : null,
            'Verifique edição e página na obra original.',
          ].filter(Boolean).join(' | '),
        };
      }
    } catch {
      continue; // Repositório indisponível — tenta o próximo
    }
  }

  return null; // Nenhum repositório encontrou
}

// ══════════════════════════════════════════════════════════════════════════════
// VERIFICADOR DE DOUTRINA — BNP Catálogo + PORBASE
//
// O catálogo BNP usa Koha e tem endpoint de pesquisa público:
//   https://catalogo.bnportugal.gov.pt/cgi-bin/koha/opac-search.pl?q=TERMOS
//
// A PORBASE (catálogo colectivo de todas as bibliotecas PT) tem endpoint:
//   https://porbase.bnportugal.gov.pt/ipac20/ipac.jsp?menu=search&aspect=basic_search&npp=10&ipp=20&spp=20&profile=porbase&ri=&term=TERMOS&index=GKEY&x=0&y=0&aspect=basic_search
//
// Ambos sem autenticação. Cobrimos livros comerciais jurídicos (Almedina,
// AAFDL, Quid Juris, etc.) que o RCAAP não indexa.
// ══════════════════════════════════════════════════════════════════════════════

async function verificarDoutrinaBNP(citacaoTexto) {
  if (!citacaoTexto || typeof citacaoTexto !== 'string') {
    return { encontrado: false, fonte: 'BNP/PORBASE', erro: 'Citação inválida' };
  }

  const termos = extrairTermosDoutrina(citacaoTexto);

  // URL catálogo BNP (Koha OPAC)
  const urlBNP     = `https://catalogo.bnportugal.gov.pt/cgi-bin/koha/opac-search.pl?q=${encodeURIComponent(termos)}`;
  // URL PORBASE (catálogo colectivo)
  const urlPORBASE = `https://porbase.bnportugal.gov.pt/ipac20/ipac.jsp?menu=search&aspect=basic_search&npp=10&term=${encodeURIComponent(termos)}&index=GKEY`;

  // Tentamos BNP primeiro, depois PORBASE
  for (const { url, fonte } of [
    { url: urlBNP,     fonte: 'BNP'     },
    { url: urlPORBASE, fonte: 'PORBASE' },
  ]) {
    try {
      const response = await comTimeout(
        fetch(url, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (compatible; LexVeritas/1.0; +https://lexveritas.pt)',
            'Accept': 'text/html,application/xhtml+xml',
            'Accept-Language': 'pt-PT,pt;q=0.9',
          },
        }),
        8000,
        `${fonte} timeout`
      );

      if (!response.ok) continue;

      const html = await response.text();

      // Detectar ausência de resultados
      const semResultados =
        html.includes('Nenhum resultado') ||
        html.includes('nenhum resultado') ||
        html.includes('Sem resultados') ||
        html.includes('0 resultado') ||
        html.includes('no results found') ||
        html.includes('No results found') ||
        html.includes('numresults=0') ||
        html.includes('totalresults">0') ||
        html.includes('"numFound":0') ||
        html.includes('results_count">0');

      if (semResultados) {
        // Não encontrado nesta fonte — tenta a próxima
        continue;
      }

      // Detectar presença de resultados
      const temResultados =
        html.includes('biblionumber') ||          // Koha BNP
        html.includes('class="title"') ||
        html.includes('class="author"') ||
        html.includes('result_set') ||
        html.includes('ipac-result') ||           // PORBASE
        html.includes('class="results_summary"') ||
        html.includes('marcxml') ||
        html.includes('numresults') ||
        html.includes('totalresults') ||
        (html.includes('ISBN') && html.includes(termos.split(' ')[0]));

      if (temResultados) {
        // Tentar extrair título e autor
        let titulo = null;
        const matchTit = html.match(/class="title"[^>]*>\s*<[^>]+>([^<]{5,100})/i) ||
                         html.match(/<title[^>]*>([^<]{5,100})/i);
        if (matchTit) titulo = matchTit[1].trim().replace(/&amp;/g, '&').replace(/&quot;/g, '"');

        let autor = null;
        const matchAut = html.match(/class="author"[^>]*>([^<]{3,80})/i) ||
                         html.match(/by\s+([A-ZÁÉÍÓÚ][^<\n]{3,60})/i);
        if (matchAut) autor = matchAut[1].trim();

        return {
          encontrado: true,
          fonte,
          url,
          confianca: 'alta',
          detalhe: [
            `Obra encontrada no catálogo ${fonte}.`,
            titulo ? `Título: ${titulo.substring(0, 80)}` : null,
            autor  ? `Autor: ${autor.substring(0, 60)}`  : null,
            'Verifique edição e página na obra original.',
          ].filter(Boolean).join(' | '),
        };
      }

    } catch {
      continue; // Tenta próxima fonte
    }
  }

  // Nenhuma fonte encontrou — devolver link BNP para verificação manual
  return {
    encontrado: null,
    fonte: 'BNP/PORBASE',
    url: urlBNP,
    confianca: 'baixa',
    detalhe: 'Não encontrado automaticamente. Clique para pesquisar no catálogo BNP.',
  };
}

// ══════════════════════════════════════════════════════════════════════════════
// VERIFICADOR DE DOUTRINA — RCAAP (repositório acesso aberto)
// Mantido como fallback para artigos académicos em acesso aberto
// ══════════════════════════════════════════════════════════════════════════════

async function verificarDoutrinaRcaap(citacaoTexto) {
  const termos = extrairTermosDoutrina(citacaoTexto);
  if (termos.length < 5) return { encontrado: null, fonte: 'RCAAP', detalhe: 'Citação demasiado curta.' };

  const url = `https://www.rcaap.pt/search.jsp?query=${encodeURIComponent(termos)}&rpp=5&sort_by=0&order=DESC`;

  try {
    const response = await comTimeout(
      fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; LexVeritas/1.0; +https://lexveritas.pt)',
          'Accept': 'text/html',
        },
      }),
      7000, 'RCAAP timeout'
    );

    if (!response.ok) return { encontrado: null, fonte: 'RCAAP', url, erro: `HTTP ${response.status}` };

    const html = await response.text();

    if (html.includes('Sem resultados') || html.includes('0 resultados') || html.includes('ds-result-count">0')) {
      return { encontrado: false, fonte: 'RCAAP', url, confianca: 'baixa',
        detalhe: 'Não encontrado no RCAAP (repositório de acesso aberto). Obra pode ser livro comercial.' };
    }

    if (html.includes('ds-artifact-item') || html.includes('artifact-description') || html.includes('resultado')) {
      return { encontrado: true, fonte: 'RCAAP', url, confianca: 'media',
        detalhe: 'Encontrado no repositório RCAAP. Verifique edição e página na obra original.' };
    }

    return { encontrado: null, fonte: 'RCAAP', url, confianca: 'baixa',
      detalhe: 'Resultado inconclusivo no RCAAP. Verifique manualmente.' };

  } catch (err) {
    return { encontrado: null, fonte: 'RCAAP', url, erro: err.message,
      detalhe: 'RCAAP indisponível. Verifique manualmente em rcaap.pt.' };
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// VERIFICADOR COMBINADO DE DOUTRINA
// Ordem: BNP → PORBASE → RCAAP
// Devolve o primeiro resultado positivo encontrado
// ══════════════════════════════════════════════════════════════════════════════

async function verificarDoutrina(citacaoTexto) {
  const termos = extrairTermosDoutrina(citacaoTexto);

  // 1.ª tentativa — BNP + PORBASE (cobre livros comerciais)
  const resBNP = await verificarDoutrinaBNP(citacaoTexto);
  if (resBNP.encontrado === true) return resBNP;

  // 2.ª tentativa — Repositórios DSpace institucionais PT (dissertações e teses)
  const resDSpace = await verificarDoutrinaDSpace(citacaoTexto);
  if (resDSpace && resDSpace.encontrado === true) return resDSpace;

  // 3.ª tentativa — RCAAP (repositório agregado de acesso aberto)
  const resRCAP = await verificarDoutrinaRcaap(citacaoTexto);
  if (resRCAP.encontrado === true) return resRCAP;

  // Nenhuma fonte encontrou — devolver links para verificação manual
  const enc = encodeURIComponent(termos);
  return {
    encontrado: null,
    fonte: 'BNP/PORBASE/Repositórios PT/RCAAP',
    url: `https://catalogo.bnportugal.gov.pt/cgi-bin/koha/opac-search.pl?q=${enc}`,
    urlJuris: `https://www.rcaap.pt/search.jsp?query=${enc}`,
    urlJP: `https://repositorio.ul.pt/simple-search?query=${enc}`,
    confianca: 'baixa',
    detalhe: 'Não encontrado automaticamente. Verifique no catálogo BNP, RCAAP ou repositórios institucionais.',
  };
}

// ══════════════════════════════════════════════════════════════════════════════
// VERIFICADOR DE ACÓRDÃOS — juris.stj.pt com fallback DGSI
// ══════════════════════════════════════════════════════════════════════════════

async function verificarAcordaoJurisStj(numero) {
  if (!numero || typeof numero !== 'string') {
    return { encontrado: false, fonte: 'juris.stj.pt', erro: 'Número inválido' };
  }

  const numeroLimpo = numero.trim().toUpperCase();
  const links = gerarLinksDGSI(numeroLimpo);

  try {
    const response = await comTimeout(
      fetch(links.juris, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; LexVeritas/1.0; +https://lexveritas.pt)',
          'Accept': 'text/html,application/xhtml+xml',
          'Accept-Language': 'pt-PT,pt;q=0.9',
        },
      }),
      8000, 'juris.stj.pt timeout'
    );

    if (!response.ok) {
      return {
        encontrado: null, fonte: 'DGSI',
        url: links.dgsi, urlJuris: links.juris, urlJP: links.jurisprudencia,
        confianca: 'indisponivel',
        detalhe: 'Serviço indisponível. Verifique manualmente nos links abaixo.',
      };
    }

    const html = await response.text();

    const semResultados =
      html.includes('Sem resultados') || html.includes('sem resultados') ||
      html.includes('0 resultado') || html.includes('nenhum resultado') ||
      html.includes('total": 0') || html.includes('"total":0');

    if (semResultados) {
      return {
        encontrado: false, fonte: 'juris.stj.pt',
        url: links.dgsi, urlJuris: links.juris, urlJP: links.jurisprudencia,
        confianca: 'alta',
        detalhe: 'Não encontrado no DGSI. Verifique também nos outros links abaixo.',
      };
    }

    const temResultados =
      html.includes('data-processo') || html.includes('class="processo"') ||
      html.includes('Processo:') || html.includes('Relator:') ||
      html.includes('Data do Acórdão') || html.includes(numeroLimpo) ||
      html.includes('"hits"') || html.includes('resultado');

    if (temResultados) {
      let detalhe = 'Acórdão encontrado no DGSI.';
      const matchT = html.match(/Tribunal[^:]*:\s*([^\n<"]+)/i);
      const matchD = html.match(/Data do Acórd[aã]o[^:]*:\s*([\d\/\-\.]+)/i);
      const matchR = html.match(/Relator[^:]*:\s*([^\n<"]+)/i);
      const partes = [
        matchT ? `Tribunal: ${matchT[1].trim().substring(0, 80)}` : null,
        matchD ? `Data: ${matchD[1].trim()}` : null,
        matchR ? `Relator: ${matchR[1].trim().substring(0, 60)}` : null,
      ].filter(Boolean);
      if (partes.length) detalhe = partes.join(' | ');

      return { encontrado: true, fonte: 'juris.stj.pt', url: links.juris, confianca: 'alta', detalhe };
    }

    return {
      encontrado: null, fonte: 'juris.stj.pt',
      url: links.dgsi, urlJuris: links.juris, urlJP: links.jurisprudencia,
      confianca: 'baixa',
      detalhe: 'Resultado inconclusivo. Verifique manualmente nos links abaixo.',
    };

  } catch {
    return {
      encontrado: null, fonte: 'DGSI',
      url: links.dgsi, urlJuris: links.juris, urlJP: links.jurisprudencia,
      confianca: 'indisponivel',
      detalhe: 'Verificação automática indisponível. Verifique manualmente nos links abaixo.',
    };
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// VERIFICADOR DE DIPLOMAS LEGAIS — DRE
// ══════════════════════════════════════════════════════════════════════════════

async function verificarDiplomaLegalDre(citacaoTexto) {
  if (!citacaoTexto || typeof citacaoTexto !== 'string') {
    return { encontrado: null, fonte: 'DRE', erro: 'Citação inválida' };
  }

  const RE_DIPLOMA = /(?:Lei|Decreto[-\s]Lei|Portaria|Despacho|Resolução|Regulamento)\s+n\.?[oºª]?\s*([\d][\d\-A-Z]*)\/(\d{2,4})/gi;
  const match = RE_DIPLOMA.exec(citacaoTexto);
  const urlHtml = `https://dre.pt/web/guest/pesquisa/-/search/${encodeURIComponent(citacaoTexto.substring(0, 60))}`;

  if (!match) {
    return { encontrado: null, fonte: 'DRE', url: urlHtml,
      detalhe: 'Não foi possível identificar o diploma. Clique para pesquisar no DRE.' };
  }

  const numero = match[1];
  const anoRaw = match[2];
  const ano = anoRaw.length === 2 ? (parseInt(anoRaw) >= 90 ? '19' + anoRaw : '20' + anoRaw) : anoRaw;

  try {
    const numeroBase = numero.replace(/[^0-9]/g, '');
    const url = `https://dre.pt/dre/api/legislation?number=${numeroBase}&year=${ano}`;

    const response = await comTimeout(
      fetch(url, {
        headers: { 'Accept': 'application/json', 'User-Agent': 'Mozilla/5.0 (compatible; LexVeritas/1.0)' },
      }),
      6000, 'DRE timeout'
    );

    if (!response.ok) {
      return { encontrado: null, fonte: 'DRE', url: urlHtml, confianca: 'baixa',
        detalhe: `Não foi possível verificar automaticamente. Clique para verificar em dre.pt.` };
    }

    const data = await response.json().catch(() => null);

    if (data && (data.results?.length > 0 || data.total > 0 || data.id)) {
      const item = data.results?.[0] || data;
      return {
        encontrado: true, fonte: 'DRE', url: item.url || urlHtml, confianca: 'alta',
        detalhe: [
          'Diploma encontrado no Diário da República.',
          item.title   ? `Título: ${item.title}`         : null,
          item.date    ? `Data: ${item.date}`             : null,
          item.revoked ? '⚠️ ATENÇÃO: diploma revogado.' : null,
        ].filter(Boolean).join(' | '),
      };
    }

    return { encontrado: false, fonte: 'DRE', url: urlHtml, confianca: 'media',
      detalhe: `Diploma n.º ${numero}/${ano} não encontrado no DRE. Clique para verificar manualmente.` };

  } catch (err) {
    return { encontrado: null, fonte: 'DRE', url: urlHtml, erro: err.message,
      detalhe: 'DRE temporariamente indisponível. Clique para verificar manualmente.' };
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// SUAVIZAÇÃO DE GRAVIDADE — falsos positivos comarca/tribunal
// Processos transferidos mantêm número original — não é indicação de fabricação
// ══════════════════════════════════════════════════════════════════════════════

function suavizarGravidade(citacao) {
  if (
    citacao.gravidade === 'alta' &&
    citacao.problema &&
    citacao.problema.toLowerCase().includes('pertence') &&
    (citacao.problema.toLowerCase().includes('comarca') ||
     citacao.problema.toLowerCase().includes('relação'))
  ) {
    return {
      ...citacao,
      gravidade: 'media',
      problema: citacao.problema + ' (Nota: pode dever-se a transferência de processo — verifique antes de concluir fabricação.)',
    };
  }
  return citacao;
}

// ══════════════════════════════════════════════════════════════════════════════
// ROUTER
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
      // BNP → PORBASE → RCAAP
      verificacao = await verificarDoutrina(texto);
      break;
    default:
      if (/^\d{1,6}\/\d{2,4}\.\d/.test(texto)) {
        verificacao = await verificarAcordaoJurisStj(texto);
      } else if (/[A-Z][a-z]+,\s|—|–/.test(texto)) {
        // Parece doutrina
        verificacao = await verificarDoutrina(texto);
      } else {
        verificacao = {
          encontrado: null, fonte: 'N/A',
          detalhe: 'Tipo de citação não suportado para verificação automática.',
        };
      }
  }

  return { ...citacao, verificacao };
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

  const verificarAtivo = process.env.VERIFICAR_ATIVO !== 'false';
  if (!verificarAtivo) {
    return res.status(200).json({ resultados: [], aviso: 'Verificação desactivada.' });
  }

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
  } catch {
    return res.status(401).json({ erro: 'Erro de autenticação.' });
  }

  // ── LIMITES POR PLANO ──
  // Gratuito: 4 citações | Profissional/Institucional: 12 citações
  const isPro = userPlano === 'profissional' || userPlano === 'institucional';
  const LIMITE_CITACOES = isPro ? 12 : 4;

  const { citacoes } = req.body || {};
  if (!Array.isArray(citacoes) || citacoes.length === 0) {
    return res.status(400).json({ erro: 'Array de citações em falta ou vazio.' });
  }

  const citacoesAVerificar = citacoes
    .slice(0, LIMITE_CITACOES)
    .filter(c => c && typeof c.citacao === 'string' && c.citacao.trim().length > 3)
    .map(suavizarGravidade);

  if (citacoesAVerificar.length === 0) {
    return res.status(400).json({ erro: 'Nenhuma citação válida para verificar.' });
  }

  try {
    const promises = citacoesAVerificar.map(c =>
      comTimeout(verificarCitacao(c), 15000, `Timeout: ${c.citacao?.substring(0, 40)}`)
        .catch(err => ({
          ...c,
          verificacao: {
            encontrado: null, fonte: 'DGSI',
            url: gerarLinksDGSI(c.citacao || '').dgsi,
            urlJuris: gerarLinksDGSI(c.citacao || '').juris,
            urlJP: gerarLinksDGSI(c.citacao || '').jurisprudencia,
            erro: err.message,
            detalhe: 'Erro interno. Verifique manualmente nos links abaixo.',
          },
        }))
    );

    const resultados = await Promise.allSettled(promises).then(results =>
      results.map(r => r.status === 'fulfilled' ? r.value : {
        verificacao: { encontrado: null, fonte: 'N/A', erro: 'Falha inesperada' },
      })
    );

    const stats = {
      total:           resultados.length,
      encontrados:     resultados.filter(r => r.verificacao?.encontrado === true).length,
      nao_encontrados: resultados.filter(r => r.verificacao?.encontrado === false).length,
      inconclusivos:   resultados.filter(r => r.verificacao?.encontrado === null).length,
    };

    return res.status(200).json({ resultados, stats });

  } catch (err) {
    console.error('verificar.js unhandled:', err.message);
    return res.status(500).json({ erro: 'Erro interno. Tente novamente.' });
  }
};
