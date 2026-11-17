// Robô Alerta K-Beauty: busca ofertas nas lojas autorizadas da Shopee,
// escolhe as melhores, escreve as mensagens e manda para o grupo de RASCUNHOS.
import 'dotenv/config';
import fs from 'node:fs';
import cron from 'node-cron';
import { buscarProdutos, resolverLoja, expandirLink, extrairIds, buscarProdutoPorId, gerarLinkAfiliado, extrairLojaRelampago, buscarRelampagoDaLoja } from './shopee.js';
import { conectar, acharGrupo, enviar, aoReceberMensagem, aoGuardarMensagem, idsDosGrupos } from './whatsapp.js';
import { guardar, buscarParecida, exemplosDeEstilo, totalDoGrupo, lerExportacao, salvarAgora, CHAT_IMPORTADO, buscarPorLink, nomeDoProdutoNoPost } from './memoria.js';
import { modoRedator, escolherEEscrever, escreverEscolhidos, temDoisPrecos } from './redator.js';

const FUSO = 'America/Sao_Paulo';
const ARQ_ENVIADOS = 'enviados.json';

const lerConfig = () => JSON.parse(fs.readFileSync('config.json', 'utf8'));
function lerEnviados() {
  try { return JSON.parse(fs.readFileSync(ARQ_ENVIADOS, 'utf8')); } catch { return {}; }
}
function salvarEnviados(e) { fs.writeFileSync(ARQ_ENVIADOS, JSON.stringify(e, null, 2)); }

const reais = (v) => Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

// Mensagem simples, usada só se não houver chave do Claude configurada.
function mensagemSimples(p) {
  const precos = temDoisPrecos(p)
    ? [`💰 *Por: ${reais(p.precoPix)} no Pix*`, `💳 *${reais(p.precoCartao)} no cartão*`]
    : [`💰 *Por: ${reais(p.precoFinal)}*`];
  return [
    `💗 *${p.productName.trim()}*`,
    '',
    ...precos,
    '✈️ *Impostos calculados no carrinho*',
    '',
    `🛒 *Link:* ${p.offerLink}`,
  ].join('\n');
}

// ---------- Memória do grupo oficial (só leitura) ----------
let idsOficiais = [CHAT_IMPORTADO]; // mensagens importadas do arquivo + grupo oficial ao vivo

/** Marca nos produtos se ela já postou o mesmo produto no grupo oficial e devolve exemplos do estilo dela. */
function contextoDaMemoria(produtos) {
  let achados = 0;
  for (const p of produtos) {
    if (achados >= 10) break;
    const m = buscarParecida(p.productName, idsOficiais);
    if (m) { p.mensagemAnterior = m.texto.slice(0, 1500); achados++; }
  }
  if (achados) console.log(`📚 ${achados} produto(s) já postados antes no grupo oficial: vou reaproveitar o texto.`);
  return exemplosDeEstilo(idsOficiais, 5);
}

/** Busca os candidatos SOMENTE nas lojas autorizadas. */
async function coletarCandidatos(config) {
  const f = config.filtros;
  const enviados = lerEnviados();
  const limiteTempo = Date.now() - f.naoRepetirPorDias * 86400000;

  // 1) Descobre o número de cada loja autorizada
  const lojasOk = new Map(); // shopId -> nome
  for (const loja of config.lojas) {
    try {
      const id = await resolverLoja(loja);
      if (id) lojasOk.set(String(id), loja.nome);
      else console.log(`⚠️  Não achei a loja "${loja.nome}". Coloque no config.json o link de um PRODUTO dela.`);
    } catch (e) { console.log(`⚠️  ${loja.nome}: ${e.message}`); }
  }

  const candidatos = new Map();
  const considerar = (lista) => {
    for (const p of lista) {
      p.precoFinal = Number(p.priceMin ?? p.price ?? 0);
      if (!lojasOk.has(String(p.shopId))) continue; // regra: só lojas autorizadas
      if (!p.offerLink || !p.precoFinal) continue;
      if (enviados[p.itemId] > limiteTempo) continue;
      if (p.precoFinal > f.precoMaximo) continue;
      if (Number(p.ratingStar || 5) < f.notaMinima) continue;
      candidatos.set(String(p.itemId), p);
    }
  };

  // 2) Produtos de cada loja (mais vendidos + maior desconto/relevância)
  for (const [shopId, nome] of lojasOk) {
    let total = 0, nomeShopee = '';
    for (const ordem of [1, 5]) { // 1 = relevância, 5 = maior comissão
      try {
        const lista = await buscarProdutos({ shopId, ordem, limite: f.candidatosPorLoja });
        total += lista.length;
        nomeShopee ||= lista[0]?.shopName || '';
        considerar(lista);
      } catch (e) { console.log(`⚠️  ${nome}: ${e.message}`); }
    }
    if (!total) {
      // Plano B: busca pelo nome da loja e fica só com os produtos dessa loja
      try {
        const lista = (await buscarProdutos({ palavraChave: nome, ordem: 1, limite: 50 }))
          .filter((p) => String(p.shopId) === String(shopId));
        total = lista.length;
        nomeShopee ||= lista[0]?.shopName || '';
        considerar(lista);
      } catch (e) { console.log(`⚠️  ${nome} (busca pelo nome): ${e.message}`); }
    }
    console.log(`🏪 ${nome}: ${total} produtos${nomeShopee ? ` (na Shopee: "${nomeShopee}")` : ''}`);
  }
  // 3) Palavras-chave (resultado filtrado para as lojas autorizadas)
  for (const palavra of config.palavrasChave || []) {
    try { considerar(await buscarProdutos({ palavraChave: palavra, ordem: 1, limite: 50 })); }
    catch (e) { console.log(`⚠️  "${palavra}": ${e.message}`); }
  }

  return [...candidatos.values()];
}

/** Escolhe e escreve. Devolve [{ produto, mensagem }]. */
async function prepararMensagens(config) {
  const candidatos = await coletarCandidatos(config);
  console.log(`🔎 ${candidatos.length} produtos candidatos nas lojas autorizadas.`);
  if (!candidatos.length) return [];
  const max = config.filtros.maximoPorRodada;

  const modo = modoRedator(config);
  if (modo !== 'simples') {
    try {
      const exemplos = contextoDaMemoria(candidatos);
      const escolhidos = await escolherEEscrever(candidatos, { maximo: max, modelo: config.modeloClaude, modo, exemplos });
      escolhidos.forEach((e) => console.log(`   ✔ ${e.produto.productName.slice(0, 60)}: ${e.motivo}`));
      return escolhidos;
    } catch (e) {
      // Ex.: limite do plano esgotado. Não fica sem nada: manda a versão simples.
      console.log(`⚠️  O Claude não conseguiu escrever agora (${e.message}). Mandando a versão simples.`);
    }
  }
  // Versão simples: pega os de maior desconto, só com nome, preço e link
  return candidatos
    .sort((a, b) => Number(b.priceDiscountRate || 0) - Number(a.priceDiscountRate || 0))
    .slice(0, max)
    .map((p) => ({ produto: p, mensagem: mensagemSimples(p) }));
}

async function rodada() {
  const config = lerConfig();
  console.log(`\n⏰ ${new Date().toLocaleString('pt-BR', { timeZone: FUSO })}: buscando ofertas...`);
  const grupoId = await acharGrupo(config.grupoRascunhos, config.gruposProibidos);
  if (!grupoId) return;

  const itens = await prepararMensagens(config);
  if (!itens.length) { console.log('Nenhuma oferta boa nesta rodada.'); return; }

  const enviados = lerEnviados();
  for (const { produto, mensagem } of itens) {
    await enviar(grupoId, mensagem, produto.imageUrl);
    enviados[produto.itemId] = Date.now();
    salvarEnviados(enviados);
    await new Promise((r) => setTimeout(r, 4000 + Math.random() * 4000));
  }
  console.log(`✅ ${itens.length} rascunhos enviados para "${config.grupoRascunhos}".`);
}

// ---------- Modo manual: ela cola links da Shopee no grupo de rascunhos ----------
const REGEX_LINK = /https?:\/\/[^\s]*(?:shopee\.com\.br|shope\.ee|shp\.ee)[^\s]*/gi;
let lojasAutorizadas = null; // shopId -> nome

async function carregarLojasAutorizadas(config) {
  if (lojasAutorizadas) return lojasAutorizadas;
  lojasAutorizadas = new Map();
  for (const loja of config.lojas) {
    try { const id = await resolverLoja(loja); if (id) lojasAutorizadas.set(String(id), loja.nome); } catch {}
  }
  return lojasAutorizadas;
}

let geracao = 0; // muda quando ela manda "parar": os envios em andamento são cancelados
const cancelado = (g) => g !== geracao;

async function tratarLinks(grupoId, texto, msg) {
  if (/^\s*(parar|pare|stop)\s*[.!]*\s*$/i.test(texto)) {
    geracao++;
    console.log('⏹️  Envios interrompidos a pedido.');
    await enviar(grupoId, '⏹️ Parei os envios.', null, msg);
    return;
  }
  const minhaGeracao = geracao;
  let links = [...new Set(texto.match(REGEX_LINK) || [])];
  if (!links.length) return;
  const limite = Number(lerConfig().relampagoMaximo || 15);
  if (links.length > limite) {
    await enviar(grupoId, `Recebi ${links.length} links. Vou fazer só os ${limite} primeiros (para parar, escreva *parar*).`, null, msg);
    links = links.slice(0, limite);
  }
  const config = lerConfig();
  const relampago = /rel[aâ]mpago|flash/i.test(texto);
  const numero = (t) => Number(String(t).replace(/\./g, '').replace(',', '.'));
  const precosDaPagina = {};
  // Preços que o atalho leu na tela, por NOME do produto: "* Nome do produto | pix=97,32"
  const precosPorNome = [];
  for (const linha of texto.split('\n')) {
    const m = linha.match(/^\*\s*(.+?)\s*\|(.*)$/);
    if (!m) continue;
    const pix = m[2].match(/pix=([\d.,]+)/i);
    const cartao = m[2].match(/cartao=([\d.,]+)/i);
    precosPorNome.push({ nome: m[1], pix: pix && numero(pix[1]), cartao: cartao && numero(cartao[1]), esgotado: /esgotado/i.test(m[2]) });
  }
  const palavras = (t) => String(t).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 2);
  const precoPeloNome = (nomeProduto) => {
    const alvo = new Set(palavras(nomeProduto));
    let melhor = null, nota = 0;
    for (const c of precosPorNome) {
      const ws = palavras(c.nome);
      if (!ws.length) continue;
      const n = ws.filter((w) => alvo.has(w)).length / ws.length;
      if (n > nota) { nota = n; melhor = c; }
    }
    return nota >= 0.6 ? melhor : null;
  };
  for (const linha of texto.split('\n')) {
    const ids = extrairIds(linha);
    if (!ids) continue;
    const pix = linha.match(/pix=([\d.,]+)/i);
    const cartao = linha.match(/cartao=([\d.,]+)/i);
    if (pix || cartao) precosDaPagina[ids.itemId] = { pix: pix && numero(pix[1]), cartao: cartao && numero(cartao[1]) };
  }
  const lojas = await carregarLojasAutorizadas(config);
  console.log(`\n🔗 Recebi ${links.length} link(s) no grupo${relampago ? ' (relâmpago)' : ''}.`);

  const produtos = [];
  for (const link of links) {
    if (cancelado(minhaGeracao)) return;
    const completo = await expandirLink(link);
    let ids = extrairIds(completo);

    // Plano B: link curto de um post antigo dela → acha o produto pelo nome escrito no post
    if (!ids && /s\.shopee\.com\.br|shope\.ee|shp\.ee/i.test(link)) {
      const post = buscarPorLink(link, idsOficiais);
      const nome = post && nomeDoProdutoNoPost(post.texto);
      if (nome) {
        console.log(`   📚 Link de um post antigo: "${nome}". Procurando nas lojas autorizadas...`);
        const lista = await buscarProdutos({ palavraChave: nome, ordem: 1, limite: 30 }).catch(() => []);
        const palavras = nome.toLowerCase().split(/[^a-z0-9à-ú]+/i).filter((w) => w.length > 2);
        const nota = (p) => palavras.filter((w) => p.productName.toLowerCase().includes(w)).length;
        const melhor = lista
          .filter((p) => !lojas.size || lojas.has(String(p.shopId)))
          .sort((a, b) => nota(b) - nota(a))[0];
        if (melhor && nota(melhor) >= Math.min(2, palavras.length)) ids = { shopId: String(melhor.shopId), itemId: String(melhor.itemId) };
        else console.log('   ⚠️  Não achei esse produto nas lojas autorizadas.');
      }
    }

    // Link da aba "ofertas relâmpago" de uma loja: tenta ler cada produto da lista
    const lojaRelampago = extrairLojaRelampago(completo);
    if (lojaRelampago) {
      const ok = await tratarListaRelampago(grupoId, lojaRelampago, completo, lojas, config, msg);
      if (ok) continue; // se não deu para ler a lista, cai no link de afiliada da lista (abaixo)
    }

    if (!ids && /s\.shopee\.com\.br|shope\.ee|shp\.ee/i.test(completo)) {
      // Link curto que não deu para abrir (a Shopee só resolve dentro do navegador)
      await enviar(grupoId, [
        '⚠️ Não consegui descobrir qual é o produto desse link curto (s.shopee.com.br).',
        '',
        'Para eu fazer o rascunho, mande o *link completo*: abra o produto no Chrome e copie o endereço da barra',
        '(começa com shopee.com.br/ e tem o nome do produto).',
      ].join('\n'), null, msg);
      continue;
    }

    if (!ids) {
      // Link de lista (ofertas relâmpago da loja, página da loja, cupom...): vira link de afiliada
      try {
        const curto = await gerarLinkAfiliado(completo);
        const ehRelampago = relampago || /flash/i.test(completo);
        const linhas = ehRelampago
          ? ['⚡ *Ofertas relâmpago no ar!*', '', 'Preços especiais por tempo limitado. Corre antes que acabe! ⏳', '', '👇 Veja todas aqui:', curto]
          : ['🛍️ *Ofertas selecionadas*', '', '👇 Confira aqui:', curto];
        linhas.push('', '✈️ *Impostos calculados no carrinho*');
        await enviar(grupoId, linhas.join('\n'), null, msg);
      } catch (e) {
        await enviar(grupoId, `⚠️ Não consegui gerar o link de afiliada para este link (${e.message}).`, null, msg);
      }
      continue;
    }

    if (lojas.size && !lojas.has(String(ids.shopId))) {
      await enviar(grupoId, '⛔ Esse produto não é de nenhuma loja autorizada, então não preparei o rascunho.', null, msg);
      continue;
    }
    const p = await buscarProdutoPorId(ids).catch(() => null);
    if (!p?.offerLink) {
      await enviar(grupoId, '⚠️ Não encontrei esse produto no programa de afiliados da Shopee.', null, msg);
      continue;
    }
    p.precoFinal = Number(p.priceMin ?? p.price ?? 0);
    const pg = precosDaPagina[String(p.itemId)] || precoPeloNome(p.productName);
    if (pg?.esgotado) { console.log(`   ⏭️  Esgotado, pulei: ${p.productName.slice(0, 50)}`); continue; }
    if (pg) {
      // O preço que aparece na página é o que a cliente vai ver: ele manda
      if (pg.cartao > 0) p.precoFinal = pg.cartao;
      p.precoPix = pg.pix || 0;
      p.precoCartao = pg.cartao || 0;
      // Só achou o preço do Pix na página: o preço normal (cartão) é o da API
      if (pg.pix > 0 && !(pg.cartao > 0)) p.precoCartao = p.precoFinal;
    }
    produtos.push(p);
  }
  if (!produtos.length) return;

  if (cancelado(minhaGeracao)) return;
  if (produtos.length > 3) {
    await enviar(grupoId, `${relampago ? '⚡ ' : ''}Recebi ${produtos.length} produtos. Preparando os rascunhos... (para parar, escreva *parar*)`, null, msg);
  }
  const modo = modoRedator(config);
  let total = 0;
  // Escreve em grupos de 5, para não ficar pesado
  for (let i = 0; i < produtos.length; i += 5) {
    const lote = produtos.slice(i, i + 5);
    let itens;
    try {
      if (modo === 'simples') throw new Error('modo simples');
      itens = await escreverEscolhidos(lote, { modelo: config.modeloClaude, modo, relampago, exemplos: contextoDaMemoria(lote) });
    } catch (e) {
      console.log(`⚠️  O Claude não conseguiu escrever agora (${e.message}). Mandando a versão simples.`);
      itens = lote.map((p) => ({ produto: p, mensagem: (relampago ? '⚡ *Oferta relâmpago*\n\n' : '') + mensagemSimples(p) }));
    }
    for (const { produto, mensagem } of itens) {
      if (cancelado(minhaGeracao)) return;
      await enviar(grupoId, mensagem, produto.imageUrl, produtos.length <= 3 ? msg : undefined);
      total++;
      await new Promise((r) => setTimeout(r, 3000 + Math.random() * 3000));
    }
  }
  console.log(`✅ ${total} rascunho(s) feitos a partir dos links.`);
}

/**
 * Lê a lista de ofertas relâmpago da loja e manda um rascunho para cada produto.
 * Devolve false se não conseguiu ler a lista (aí o robô manda só o link da lista).
 */
async function tratarListaRelampago(grupoId, shopId, link, lojas, config, msg) {
  const minhaGeracao = geracao;
  if (lojas.size && !lojas.has(String(shopId))) {
    await enviar(grupoId, '⛔ Essa loja não está na lista de lojas autorizadas.', null, msg);
    return true;
  }
  let lista;
  try {
    lista = await buscarRelampagoDaLoja(shopId);
  } catch (e) {
    console.log(`⚠️  Relâmpago: ${e.message}`);
    await enviar(grupoId, `⚠️ Não consegui abrir a lista de ofertas relâmpago (${e.message}). Vou mandar o link da lista:`, null, msg);
    return false;
  }
  if (!lista.itens.length) {
    await enviar(grupoId, '⚡ Essa loja não tem ofertas relâmpago acontecendo agora.', null, msg);
    return true;
  }
  const max = Number(config.relampagoMaximo || 15);
  const nomeLoja = lojas.get(String(shopId)) || 'loja';
  const hora = (t) => new Date(t * 1000).toLocaleTimeString('pt-BR', { timeZone: FUSO, hour: '2-digit', minute: '2-digit' });
  const agora = Date.now() / 1000;
  const quando = lista.sessao?.inicio > agora ? ` (começa às ${hora(lista.sessao.inicio)})`
    : lista.sessao?.fim ? ` (até ${hora(lista.sessao.fim)})` : '';
  await enviar(grupoId, `⚡ Achei ${lista.itens.length} ofertas relâmpago da ${nomeLoja}${quando}. Preparando os rascunhos de até ${max}...`, null, msg);

  const produtos = [];
  for (const it of lista.itens.slice(0, max)) {
    const p = await buscarProdutoPorId(it).catch(() => null);
    if (!p?.offerLink) continue;
    const precoApi = Number(p.priceMin ?? p.price ?? 0);
    // Usa o preço relâmpago só se fizer sentido (menor ou igual ao preço normal)
    p.precoFinal = it.precoRelampago && (!precoApi || it.precoRelampago <= precoApi) ? it.precoRelampago : precoApi;
    produtos.push(p);
  }
  if (!produtos.length) {
    await enviar(grupoId, '⚠️ Achei a lista, mas nenhum produto dela está no programa de afiliados.', null, msg);
    return true;
  }

  const modo = modoRedator(config);
  // Escreve em grupos de 5, para não ficar pesado
  for (let i = 0; i < produtos.length; i += 5) {
    const lote = produtos.slice(i, i + 5);
    let itens;
    try {
      if (modo === 'simples') throw new Error('modo simples');
      itens = await escreverEscolhidos(lote, { modelo: config.modeloClaude, modo, relampago: true, exemplos: contextoDaMemoria(lote) });
    } catch (e) {
      console.log(`⚠️  O Claude não conseguiu escrever agora (${e.message}). Mandando a versão simples.`);
      itens = lote.map((p) => ({ produto: p, mensagem: '⚡ *Oferta relâmpago*\n\n' + mensagemSimples(p) }));
    }
    for (const { produto, mensagem } of itens) {
      if (cancelado(minhaGeracao)) return true;
      await enviar(grupoId, mensagem, produto.imageUrl);
      await new Promise((r) => setTimeout(r, 3000 + Math.random() * 3000));
    }
  }
  console.log(`✅ ${produtos.length} rascunhos de ofertas relâmpago enviados.`);
  return true;
}

// Véspera de data dupla da Shopee (3/3, 4/4 ... 11/11, 12/12)
async function avisoDataDupla() {
  const amanha = new Date(new Date().toLocaleString('en-US', { timeZone: FUSO }));
  amanha.setDate(amanha.getDate() + 1);
  const d = amanha.getDate(), m = amanha.getMonth() + 1;
  if (d !== m) return;
  const config = lerConfig();
  const grupoId = await acharGrupo(config.grupoRascunhos, config.gruposProibidos);
  if (!grupoId) return;
  const texto = [
    `🚨 *Amanhã é ${d}/${m} na Shopee, meninas!*`,
    '',
    'Os cupons e as ofertas começam à *meia-noite* 🕛 e costumam esgotar bem rápido. Depois que acabam, o preço não volta, então vale ficar de olho!',
    '',
    'Vou mandar aqui no grupo todas as ofertas e cupons que valerem a pena 💕',
  ].join('\n');
  await enviar(grupoId, texto);
  console.log(`📅 Aviso de ${d}/${m} enviado para os rascunhos.`);
}

// ---------- início ----------
const args = process.argv.slice(2);

if (args.includes('--testar-shopee')) {
  // Testa a busca (e o Claude, se configurado) sem mandar nada no WhatsApp
  const itens = await prepararMensagens(lerConfig());
  console.log(`\n${itens.length} rascunhos:\n`);
  itens.forEach((i) => console.log(i.mensagem + '\n\n----------\n'));
  process.exit(0);
}

if (args.includes('--importar')) {
  // Importa o arquivo "Exportar conversa" do grupo oficial (só posts de oferta, com R$)
  const arq = args[args.indexOf('--importar') + 1] || 'historico.txt';
  if (!fs.existsSync(arq)) {
    console.log(`❌ Não achei o arquivo "${arq}" na pasta do robô. Veja o guia (Importar o histórico).`);
    process.exit(1);
  }
  const posts = lerExportacao(fs.readFileSync(arq, 'utf8'));
  let n = 0;
  for (const p of posts) {
    if (!/R\$/.test(p.texto) || p.texto.length < 150) continue;
    if (guardar({ chat: CHAT_IMPORTADO, id: p.id, ts: p.ts, texto: p.texto })) n++;
  }
  salvarAgora();
  console.log(`📚 Importei ${n} posts de oferta (de ${posts.length} mensagens). Memória do grupo oficial: ${totalDoGrupo([CHAT_IMPORTADO])}.`);
  console.log('Pode apagar o arquivo de histórico se quiser: ele já está guardado na memória.');
  process.exit(0);
}

// Guarda as mensagens dos grupos (inclusive o histórico que chega ao conectar)
aoGuardarMensagem(guardar);

if (args.includes('--religar')) {
  // Reconecta do zero por QR Code, pedindo o histórico antigo dos grupos
  fs.rmSync('sessao-whatsapp', { recursive: true, force: true });
  process.env.MODO_QR = '1';
}

await conectar();
idsOficiais = [CHAT_IMPORTADO, ...(await idsDosGrupos(lerConfig().gruposLeitura || []).catch(() => []))];
console.log(`📚 Memória do grupo oficial: ${totalDoGrupo(idsOficiais)} mensagens guardadas.`);

if (args.includes('--religar')) {
  console.log('\n⏳ Recebendo o histórico dos grupos... espere uns 3 minutos, sem mexer.');
  await new Promise((r) => setTimeout(r, 180000));
  console.log(`\n📚 Pronto! Memória do grupo oficial: ${totalDoGrupo(idsOficiais)} mensagens.`);
  console.log('Agora saia (exit) e ligue o robô de novo com ./robo.sh');
  setTimeout(() => process.exit(0), 3000);
  await new Promise(() => {});
}

if (args.includes('--agora')) {
  await rodada();
  console.log('Pronto! (modo teste, encerrando)');
  setTimeout(() => process.exit(0), 3000);
} else {
  const config = lerConfig();
  const executar = (fn) => () => fn().catch((e) => console.log('Erro:', e.message));
  for (const h of config.horarios) {
    const [hora, min] = h.split(':').map(Number);
    cron.schedule(`${min} ${hora} * * *`, executar(rodada), { timezone: FUSO });
  }
  cron.schedule('0 20 * * *', executar(avisoDataDupla), { timezone: FUSO });

  // Fica "ouvindo" o grupo de rascunhos: link colado lá vira rascunho pronto
  const grupoId = await acharGrupo(config.grupoRascunhos, config.gruposProibidos);
  if (grupoId) {
    aoReceberMensagem((chatId, texto, msg) => (chatId === grupoId ? tratarLinks(grupoId, texto, msg) : null));
    console.log('👂 Ouvindo o grupo: cole um link da Shopee lá e eu devolvo o rascunho.');
  }
  console.log(`🤖 Robô ligado! Rascunhos às ${config.horarios.join(', ')} (horário de Brasília) no grupo "${config.grupoRascunhos}".`);
}
