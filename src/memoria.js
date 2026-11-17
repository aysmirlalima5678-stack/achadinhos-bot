// Memória das mensagens dos grupos (fica SÓ no tablet, no arquivo memoria-grupos.json).
// Serve para: (1) achar se um produto já foi postado no grupo oficial e reaproveitar o texto;
//             (2) usar as mensagens dela como exemplo de estilo (emojis, tamanho, jeito de escrever).
import fs from 'node:fs';

const ARQ = 'memoria-grupos.json';
const MAXIMO = 8000;
let mem = null;
let timer = null;

function carregar() {
  if (!mem) {
    try { mem = JSON.parse(fs.readFileSync(ARQ, 'utf8')); } catch { mem = { msgs: [] }; }
    mem.ids = new Set(mem.msgs.map((m) => m.id));
  }
  return mem;
}

/** Salva na hora (usado no fim da importação). */
export function salvarAgora() {
  clearTimeout(timer);
  if (mem) fs.writeFileSync(ARQ, JSON.stringify({ msgs: mem.msgs }));
}

/** Nome usado para as mensagens que vieram do arquivo exportado do grupo oficial. */
export const CHAT_IMPORTADO = 'importado-grupo-oficial';

/**
 * Lê o arquivo de "Exportar conversa" do WhatsApp (iPhone ou Android) e devolve os posts.
 * Formatos: "[12/05/2026, 14:48:42] Nome: texto" ou "12/05/2026 14:48 - Nome: texto".
 */
export function lerExportacao(texto, apenasAutor = '') {
  const re = /^\u200e?\[?(\d{1,2})\/(\d{1,2})\/(\d{2,4}),? (\d{1,2}):(\d{2})(?::(\d{2}))?\]?(?: -)? ([^:\n]+): /gm;
  const marcas = [...texto.matchAll(re)];
  const posts = [];
  marcas.forEach((m, i) => {
    const fim = i + 1 < marcas.length ? marcas[i + 1].index : texto.length;
    const corpo = texto.slice(m.index + m[0].length, fim).replace(/\u200e?<Mensagem editada>/g, '').replace(/[\u200e\ufffc]/g, '').trim();
    const autor = m[7].trim();
    if (apenasAutor && !autor.toLowerCase().includes(apenasAutor.toLowerCase())) return;
    const ano = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
    const ts = Math.floor(new Date(ano, Number(m[2]) - 1, Number(m[1]), Number(m[4]), Number(m[5]), Number(m[6] || 0)).getTime() / 1000);
    posts.push({ id: `imp-${ts}-${i}`, ts, autor, texto: corpo });
  });
  return posts;
}

function salvarDepois() {
  clearTimeout(timer);
  timer = setTimeout(() => {
    fs.writeFileSync(ARQ, JSON.stringify({ msgs: mem.msgs }));
  }, 2000);
}

/** Guarda uma mensagem de grupo (só as que parecem posts de oferta: texto mais longo). */
export function guardar({ chat, id, ts, texto }) {
  const m = carregar();
  if (!chat || !id || !texto || texto.length < 80 || m.ids.has(id)) return false;
  m.msgs.push({ chat, id, ts: Number(ts) || 0, texto });
  m.ids.add(id);
  if (m.msgs.length > MAXIMO) {
    m.msgs.sort((a, b) => a.ts - b.ts);
    m.msgs = m.msgs.slice(-MAXIMO);
    m.ids = new Set(m.msgs.map((x) => x.id));
  }
  salvarDepois();
  return true;
}

export function totalDoGrupo(chats) {
  const set = new Set(chats);
  return carregar().msgs.filter((m) => set.has(m.chat)).length;
}

const PARADAS = new Set([
  'com', 'para', 'por', 'sem', 'dos', 'das', 'uma', 'the', 'and', 'official', 'original', 'novo', 'nova',
  'kit', 'pele', 'caixa', 'versao', 'renewal', 'korea', 'coreia', 'coreano', 'skin', 'care',
]);

function limpar(t) {
  return String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function palavrasChave(nome) {
  return limpar(nome)
    .split(' ')
    .filter((w) => w.length > 2 && !PARADAS.has(w) && !/^\d+(ml|g|ea|x)?$/.test(w))
    .slice(0, 7);
}

/** Procura no grupo oficial a mensagem mais recente que fale do mesmo produto. */
export function buscarParecida(nomeProduto, chats) {
  const alvo = [...new Set(palavrasChave(nomeProduto))];
  if (alvo.length < 2) return null;
  const set = new Set(chats);
  let melhor = null;
  let melhorNota = 0;
  for (const m of carregar().msgs) {
    if (!set.has(m.chat)) continue;
    const ps = new Set(limpar(m.texto.slice(0, 500)).split(' '));
    const comum = alvo.filter((w) => ps.has(w)).length;
    const nota = comum / alvo.length;
    if (comum >= 2 && (nota > melhorNota || (nota === melhorNota && melhor && m.ts > melhor.ts))) {
      melhor = m;
      melhorNota = nota;
    }
  }
  return melhorNota >= 0.6 ? melhor : null;
}

/** Mensagens recentes dela no grupo oficial, para servir de exemplo de estilo. */
export function exemplosDeEstilo(chats, quantos = 5) {
  const set = new Set(chats);
  return carregar().msgs
    .filter((m) => set.has(m.chat) && /R\$/.test(m.texto) && m.texto.length > 150)
    .sort((a, b) => a.ts - b.ts)
    .slice(-quantos)
    .map((m) => m.texto.slice(0, 1200));
}
