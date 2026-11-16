// Robô de achadinhos: busca ofertas na Shopee e manda pro grupo de rascunhos.
import 'dotenv/config';
import fs from 'node:fs';
import cron from 'node-cron';
import { buscarProdutos, resolverLoja, extrairBusca } from './shopee.js';
import { conectar, acharGrupo, enviar } from './whatsapp.js';

const FUSO = 'America/Sao_Paulo';
const ARQ_ENVIADOS = 'enviados.json';

const lerConfig = () => JSON.parse(fs.readFileSync('config.json', 'utf8'));

function lerEnviados() {
  try { return JSON.parse(fs.readFileSync(ARQ_ENVIADOS, 'utf8')); } catch { return {}; }
}
function salvarEnviados(e) { fs.writeFileSync(ARQ_ENVIADOS, JSON.stringify(e, null, 2)); }

const reais = (v) =>
  Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

function precoDe(p) { return Number(p.priceMin ?? p.price ?? 0); }

function formatarMensagem(p) {
  const preco = precoDe(p);
  const desconto = Number(p.priceDiscountRate || 0);
  const linhas = [`🛍️ *${p.productName.trim()}*`, ''];
  if (desconto > 0) {
    const antigo = preco / (1 - desconto / 100);
    linhas.push(`~${reais(antigo)}~ por *${reais(preco)}* (-${desconto}%)`);
  } else {
    linhas.push(`💰 *${reais(preco)}*`);
  }
  if (p.ratingStar) linhas.push(`⭐ ${Number(p.ratingStar).toFixed(1)}  •  ${p.sales ?? 0} vendidos`);
  linhas.push(`🏪 ${p.shopName}`, '', `👉 ${p.offerLink}`);
  return linhas.join('\n');
}

async function coletarOfertas(config) {
  const f = config.filtros;
  const enviados = lerEnviados();
  const limiteTempo = Date.now() - f.naoRepetirPorDias * 86400000;
  const passa = (p) =>
    p.offerLink &&
    Number(p.priceDiscountRate || 0) >= f.descontoMinimo &&
    precoDe(p) <= f.precoMaximo &&
    Number(p.ratingStar || 5) >= f.notaMinima &&
    !(enviados[p.itemId] > limiteTempo);

  const escolhidos = [];
  const jaNaLista = new Set();
  const adicionar = (lista, max) => {
    let n = 0;
    for (const p of lista) {
      if (n >= max || jaNaLista.has(p.itemId) || !passa(p)) continue;
      jaNaLista.add(p.itemId);
      escolhidos.push(p);
      n++;
    }
  };

  const palavras = [...(config.palavrasChave || [])];
  for (const loja of config.lojas) {
    const busca = extrairBusca(loja.link);
    if (busca) { palavras.push(busca); continue; } // link de busca vira palavra-chave
    try {
      const shopId = await resolverLoja(loja);
      if (!shopId) {
        console.log(`⚠️  Não consegui descobrir a loja "${loja.nome}". Troque o link pelo link de um PRODUTO dela no config.json.`);
        continue;
      }
      adicionar(await buscarProdutos({ shopId, ordem: 2, limite: 30 }), f.produtosPorLoja);
    } catch (e) { console.log(`⚠️  ${loja.nome}: ${e.message}`); }
  }
  for (const palavra of palavras) {
    try {
      adicionar(await buscarProdutos({ palavraChave: palavra, ordem: 2, limite: 30 }), f.produtosPorLoja);
    } catch (e) { console.log(`⚠️  "${palavra}": ${e.message}`); }
  }

  escolhidos.sort((a, b) => Number(b.priceDiscountRate) - Number(a.priceDiscountRate));
  return escolhidos.slice(0, f.maximoPorRodada);
}

async function rodada() {
  const config = lerConfig();
  console.log(`\n⏰ ${new Date().toLocaleString('pt-BR', { timeZone: FUSO })} — buscando ofertas...`);
  const grupoId = await acharGrupo(config.grupoRascunhos);
  if (!grupoId) return;

  const ofertas = await coletarOfertas(config);
  if (!ofertas.length) { console.log('Nenhuma oferta nova passou nos filtros.'); return; }

  const enviados = lerEnviados();
  for (const p of ofertas) {
    await enviar(grupoId, formatarMensagem(p), p.imageUrl);
    enviados[p.itemId] = Date.now();
    salvarEnviados(enviados);
    await new Promise((r) => setTimeout(r, 4000 + Math.random() * 4000)); // pausa entre mensagens
  }
  console.log(`✅ ${ofertas.length} ofertas enviadas.`);
}

// ---------- início ----------
const args = process.argv.slice(2);

if (args.includes('--testar-shopee')) {
  // Só testa a Shopee, sem WhatsApp
  const ofertas = await coletarOfertas(lerConfig());
  console.log(`Encontrei ${ofertas.length} ofertas:\n`);
  ofertas.forEach((p) => console.log(formatarMensagem(p) + '\n---'));
  process.exit(0);
}

await conectar();

if (args.includes('--agora')) {
  await rodada();
  console.log('Pronto! (modo teste, encerrando)');
  setTimeout(() => process.exit(0), 3000);
} else {
  const config = lerConfig();
  for (const h of config.horarios) {
    const [hora, min] = h.split(':').map(Number);
    cron.schedule(`${min} ${hora} * * *`, () => rodada().catch((e) => console.log('Erro:', e.message)), { timezone: FUSO });
  }
  console.log(`🤖 Robô ligado! Vai mandar ofertas às ${config.horarios.join(', ')} (horário de Brasília).`);
}
