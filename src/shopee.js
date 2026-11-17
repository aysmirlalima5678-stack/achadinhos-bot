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

  const payload = JSON.stringify({ query, variables });
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
  price
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
  const query = `
    query ($shopId: Int64, $keyword: String, $sortType: Int, $limit: Int) {
      productOfferV2(shopId: $shopId, keyword: $keyword, sortType: $sortType, page: 1, limit: $limit) {
        nodes { ${CAMPOS} }
      }
    }`;
  const variables = { sortType: ordem, limit: limite };
  if (shopId) variables.shopId = Number(shopId);
  if (palavraChave) variables.keyword = palavraChave;

  const data = await chamarApi(query, variables);
  return data?.productOfferV2?.nodes ?? [];
}

/** Transforma qualquer link da Shopee em link curto de afiliado. */
export async function gerarLinkAfiliado(url) {
  const query = `
    mutation ($url: String!) {
      generateShortLink(input: { originUrl: $url, subIds: ["whatsapp"] }) { shortLink }
    }`;
  const data = await chamarApi(query, { url });
  return data?.generateShortLink?.shortLink;
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
  const direto = extrairShopId(loja.link);
  if (direto) return direto;

  // Sem link? Procura pelo nome da loja.
  const usuario = extrairUsuarioLoja(loja.link);
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
      `query ($k: String) { shopOfferV2(keyword: $k, page: 1, limit: 10) { nodes { shopId shopName originalLink } } }`,
      { k: nome },
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
