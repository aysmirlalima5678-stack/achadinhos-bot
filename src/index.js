// Robô Alerta K-Beauty: busca ofertas nas lojas autorizadas da Shopee,
// escolhe as melhores, escreve as mensagens e manda para o grupo de RASCUNHOS.
import 'dotenv/config';
import fs from 'node:fs';
import cron from 'node-cron';
import { buscarProdutos, resolverLoja } from './shopee.js';
import { conectar, acharGrupo, enviar } from './whatsapp.js';
import { modoRedator, escolherEEscrever } from './redator.js';

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
  return [
    `💖 *${p.productName.trim()}*`,
    '',
    `💰 Por: ${reais(p.precoFinal)}`,
    '👇 Aproveite aqui:',
    p.offerLink,
    '',
    '✈️ Impostos já inclusos',
  ].join('\n');
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
      const escolhidos = await escolherEEscrever(candidatos, { maximo: max, modelo: config.modeloClaude, modo });
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
  const grupoId = await acharGrupo(config.grupoRascunhos);
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

// Véspera de data dupla da Shopee (3/3, 4/4 ... 11/11, 12/12)
async function avisoDataDupla() {
  const amanha = new Date(new Date().toLocaleString('en-US', { timeZone: FUSO }));
  amanha.setDate(amanha.getDate() + 1);
  const d = amanha.getDate(), m = amanha.getMonth() + 1;
  if (d !== m) return;
  const config = lerConfig();
  const grupoId = await acharGrupo(config.grupoRascunhos);
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

await conectar();

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
  console.log(`🤖 Robô ligado! Rascunhos às ${config.horarios.join(', ')} (horário de Brasília) no grupo "${config.grupoRascunhos}".`);
}
