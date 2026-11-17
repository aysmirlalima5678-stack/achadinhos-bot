// Conversa com a API oficial de Afiliados da Shopee (Open API).
// Documentação: painel de afiliados > Open API.
import crypto from 'node:crypto';
import fs from 'node:fs';

const ENDPOINT = 'https://open-api.affiliate.shopee.com.br/graphql';

async function chamarApi(query, variables = {}) {
  const appId = process.env.SHOPEE_APP_ID;
  const secret = process.env.SHOPEE_SECRET;
  if (!appId || !secret) {
    throw new Error('Faltam SHOPEE_APP_ID e/ou SHOPEE_SECRET no arquivo .env');
  }

  // A Shopee prefere os valores escritos direto na query (sem "variables")
  const payload = JSON.stringify(Object.keys(variables).length ? { query, variables } : { query });
  const timestamp = Math.floor(Date.now() / 1000);
  const assinatura = crypto
    .createHash('sha256')
    .update(`${appId}${timestamp}${payload}${secret}`)
    .digest('hex');

  const resp = await fetch(ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `SHA256 Credential=${appId}, Timestamp=${timestamp}, Signature=${assinatura}`,
    },
    body: payload,
  });

  const json = await resp.json().catch(() => ({}));
  if (!resp.ok || json.errors) {
    const msg = json.errors?.map((e) => e.message).join('; ') || `HTTP ${resp.status}`;
    throw new Error(`Erro da Shopee: ${msg}`);
  }
  return json.data;
}

const CAMPOS = `
  itemId
  productName
  shopId
  shopName
  priceMin
  priceMax
  priceDiscountRate
  commissionRate
  sales
  ratingStar
  imageUrl
  offerLink
  productLink
`;

/**
 * Busca produtos. Pode filtrar por loja (shopId) e/ou palavra-chave.
 * sortType: 1 = relevância, 2 = mais vendidos, 3 = maior preço,
 *           4 = menor preço, 5 = maior comissão
 */
export async function buscarProdutos({ shopId, palavraChave, ordem = 2, limite = 20 }) {
  const args = [];
  if (shopId) args.push(`shopId: ${Number(shopId)}`);
  if (palavraChave) args.push(`keyword: ${JSON.stringify(String(palavraChave))}`);
  args.push(`sortType: ${Number(ordem)}`, 'page: 1', `limit: ${Number(limite)}`);
  const montar = (a) => `{ productOfferV2(${a.join(', ')}) { nodes { ${CAMPOS} } } }`;
  try {
    const data = await chamarApi(montar(args));
    return data?.productOfferV2?.nodes ?? [];
  } catch (e) {
    // Algumas combinações dão "System Error" na Shopee: tenta de novo sem a ordenação
    if (!/10000|System Error/i.test(e.message)) throw e;
    const semOrdem = args.filter((x) => !x.startsWith('sortType'));
    const data = await chamarApi(montar(semOrdem));
    return data?.productOfferV2?.nodes ?? [];
  }
}

/** Transforma qualquer link da Shopee em link curto de afiliado. */
export async function gerarLinkAfiliado(url) {
  const query = `mutation { generateShortLink(input: { originUrl: ${JSON.stringify(String(url))}, subIds: ["whatsapp"] }) { shortLink } }`;
  const data = await chamarApi(query);
  return data?.generateShortLink?.shortLink;
}

/**
 * Links curtos do botão "Compartilhar" do app (s.shopee.com.br/..., shope.ee/...)
 * não têm o número da loja. Aqui abrimos o link para descobrir o endereço completo.
 */
export async function expandirLink(texto) {
  const s = String(texto || '').trim();
  if (!/^https?:\/\/(s\.shopee\.com\.br|shope\.ee|shp\.ee)\//i.test(s)) return s;
  // Procura loja + produto em qualquer texto (links, parâmetros codificados, página)
  const achar = (t) => {
    let x = String(t || '');
    try { x += ' ' + decodeURIComponent(x); } catch {}
    try { x += ' ' + decodeURIComponent(x); } catch {}
    const m = x.match(/-i\.(\d+)\.(\d+)/) || x.match(/\/product\/(\d+)\/(\d+)/)
      || x.match(/shopid[="':\s]+(\d+)[^\d]{1,40}itemid[="':\s]+(\d+)/i);
    if (m) return `https://shopee.com.br/product/${m[1]}/${m[2]}`;
    const n = x.match(/itemid[="':\s]+(\d+)[^\d]{1,40}shopid[="':\s]+(\d+)/i);
    return n ? `https://shopee.com.br/product/${n[2]}/${n[1]}` : null;
  };
  try {
    let url = s;
    const caminho = [];
    for (let i = 0; i < 8; i++) {
      const r = await fetch(url, { redirect: 'manual', headers: { 'User-Agent': 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/126.0 Mobile Safari/537.36' } });
      const prox = r.headers.get('location');
      const achado = achar(url) || achar(prox);
      if (achado) { console.log(`   🔗 link curto → ${achado}`); return achado; }
      if (prox) { url = new URL(prox, url).href; caminho.push(url); continue; }
      const html = await r.text();
      const noHtml = achar(html.slice(0, 200000));
      if (noHtml) { console.log(`   🔗 link curto → ${noHtml}`); return noHtml; }
      break;
    }
    console.log(`   ⚠️  Não descobri o produto do link curto. Caminho: ${caminho.join(' → ').slice(0, 300) || '(sem redirecionamento)'}`);
    return url;
  } catch (e) {
    console.log(`   ⚠️  Não consegui abrir o link curto (${e.message})`);
    return s;
  }
}

/** Pega o "nome de usuário" da loja num link tipo https://shopee.com.br/koksara.br?... */
export function extrairUsuarioLoja(texto) {
  try {
    const u = new URL(String(texto).trim());
    const partes = u.pathname.split('/').filter(Boolean);
    if (partes.length === 1 && !/-i\.\d+\.\d+/.test(partes[0]) && partes[0] !== 'search') return partes[0];
  } catch {}
  return null;
}

/** Se for link de busca (shopee.com.br/search?keyword=...), devolve a palavra buscada. */
export function extrairBusca(texto) {
  try {
    const u = new URL(String(texto).trim());
    if (u.pathname.startsWith('/search')) return u.searchParams.get('keyword');
  } catch {}
  return null;
}

// Guarda os números de loja já descobertos, para não procurar toda vez.
const ARQ_IDS = 'lojas-ids.json';
function lerIds() { try { return JSON.parse(fs.readFileSync(ARQ_IDS, 'utf8')); } catch { return {}; } }

/**
 * Descobre o shopId de uma loja a partir de qualquer link dela
 * (link de produto, link da loja ou o próprio número).
 */
export async function resolverLoja(loja) {
  if (loja.shopId) return String(loja.shopId);
  const link = await expandirLink(loja.link);
  const direto = extrairShopId(link);
  if (direto) return direto;

  // Sem link? Procura pelo nome da loja.
  const usuario = extrairUsuarioLoja(link);
  const chave = usuario || `nome:${loja.nome}`;
  const cache = lerIds();
  if (cache[chave]) return cache[chave];

  let id = null;
  // 1ª tentativa: página pública da Shopee
  if (usuario) try {
    const r = await fetch(`https://shopee.com.br/api/v4/shop/get_shop_detail?username=${encodeURIComponent(usuario)}`, {
      headers: { 'User-Agent': 'Mozilla/5.0', 'X-Requested-With': 'XMLHttpRequest' },
    });
    const j = await r.json();
    if (j?.data?.shopid) id = String(j.data.shopid);
  } catch {}

  // 2ª tentativa: busca de lojas da API de afiliados, pelo nome
  if (!id) {
    const nome = usuario ? usuario.replace(/\.br$/, '') : loja.nome;
    const data = await chamarApi(
      `{ shopOfferV2(keyword: ${JSON.stringify(nome)}, page: 1, limit: 20) { nodes { shopId shopName originalLink } } }`,
    );
    const nodes = data?.shopOfferV2?.nodes ?? [];
    const limpa = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    const achada =
      (usuario && nodes.find((n) => (n.originalLink || '').toLowerCase().includes(usuario.toLowerCase()))) ||
      nodes.find((n) => limpa(n.shopName).includes(limpa(nome)));
    if (achada) id = String(achada.shopId);
  }

  if (id) {
    cache[chave] = id;
    fs.writeFileSync(ARQ_IDS, JSON.stringify(cache, null, 2));
    console.log(`🔎 Loja "${loja.nome}" encontrada (número ${id})`);
  }
  return id;
}

/**
 * Descobre o número da loja (shopId) a partir de um link de produto da loja.
 * Ex.: https://shopee.com.br/Nome-do-produto-i.123456.789  -> 123456
 *      https://shopee.com.br/product/123456/789            -> 123456
 */
export function extrairShopId(texto) {
  const s = String(texto).trim();
  if (/^\d+$/.test(s)) return s;
  const m = s.match(/-i\.(\d+)\.\d+/) || s.match(/\/product\/(\d+)\/\d+/) || s.match(/\/shop\/(\d+)/);
  return m ? m[1] : null;
}

/** Pega loja e produto de um link de produto. Ex.: ...-i.123.456 -> { shopId: '123', itemId: '456' } */
export function extrairIds(texto) {
  const s = String(texto || '');
  const m = s.match(/-i\.(\d+)\.(\d+)/) || s.match(/\/product\/(\d+)\/(\d+)/);
  return m ? { shopId: m[1], itemId: m[2] } : null;
}

/** Busca um produto específico (com o link de afiliado dela). */
export async function buscarProdutoPorId({ shopId, itemId }) {
  const query = `{ productOfferV2(shopId: ${Number(shopId)}, itemId: ${Number(itemId)}, page: 1, limit: 1) { nodes { ${CAMPOS} } } }`;
  const data = await chamarApi(query);
  return data?.productOfferV2?.nodes?.[0] ?? null;
}

/** Se for link da aba de ofertas relâmpago de uma loja, devolve o número da loja. */
export function extrairLojaRelampago(texto) {
  const s = String(texto || '');
  if (!/flash[-_]?sale/i.test(s)) return null;
  const m = s.match(/\/shop\/(\d+)/) || s.match(/shopi?d=(\d+)/i);
  return m ? m[1] : null;
}

/**
 * Lê os produtos da oferta relâmpago de uma loja, pelo mesmo caminho que o site da Shopee usa.
 * NÃO é a API oficial: a Shopee pode bloquear. Devolve { sessao, itens:[{shopId,itemId,precoRelampago}] }.
 */
export async function buscarRelampagoDaLoja(shopId) {
  const url = `https://shopee.com.br/api/v4/shop/get_shop_flash_sale_items?shopid=${Number(shopId)}`;
  const r = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Linux; Android 14; SM-P613) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36',
      Accept: 'application/json',
      'X-Requested-With': 'XMLHttpRequest',
      'X-API-SOURCE': 'pc',
      'X-Shopee-Language': 'pt-BR',
      Referer: `https://shopee.com.br/shop/${Number(shopId)}/flash-sale`,
    },
  });
  const texto = await r.text();
  let j;
  try { j = JSON.parse(texto); } catch { throw new Error(`a Shopee não devolveu a lista (HTTP ${r.status})`); }
  const sessoes = j?.data?.flash_sales;
  if (!Array.isArray(sessoes)) {
    throw new Error(`a Shopee bloqueou a leitura da lista (código ${j?.error ?? r.status})`);
  }
  if (!sessoes.length) return { sessao: null, itens: [] };

  const agora = Date.now() / 1000;
  const sessao =
    sessoes.find((x) => x.start_time <= agora && (!x.end_time || agora < x.end_time)) ||
    sessoes.slice().sort((a, b) => a.start_time - b.start_time).find((x) => x.start_time > agora) ||
    sessoes[0];
  const itens = (sessao.items || []).map((it) => {
    const bruto = Number(it.price ?? it.flash_sale_price ?? 0);
    return {
      shopId: String(it.shop_id ?? it.shopid ?? shopId),
      itemId: String(it.item_id ?? it.itemid),
      precoRelampago: bruto > 0 ? bruto / 100000 : null, // a Shopee guarda preço x 100000
    };
  }).filter((x) => x.itemId && x.itemId !== 'undefined');
  if (itens[0]) console.log('   (relâmpago) exemplo de item:', JSON.stringify(sessao.items[0]).slice(0, 300));
  return { sessao: { inicio: sessao.start_time, fim: sessao.end_time }, itens };
}
