// Conexão com o WhatsApp (funciona como um "WhatsApp Web" rodando no servidor).
import makeWASocket, {
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
} from '@whiskeysockets/baileys';
import qrcode from 'qrcode-terminal';
import fs from 'node:fs';
import pino from 'pino';

let sock = null;
let pronto = false;
let jaPediuCodigo = false; // pede o código só uma vez por execução

/**
 * No WhatsApp, celulares brasileiros com DDD 31 ou maior costumam ser registrados
 * SEM o 9 extra (ex.: 55 85 9XXXX-XXXX vira 55 85 XXXX-XXXX).
 * Para não tirar o 9, coloque WHATSAPP_MANTER_9=sim no .env.
 */
function numeroParaWhatsApp(texto) {
  const n = String(texto || '').replace(/\D/g, '');
  const manter9 = /^s/i.test(process.env.WHATSAPP_MANTER_9 || '');
  if (!manter9 && n.length === 13 && n.startsWith('55') && Number(n.slice(2, 4)) >= 31 && n[4] === '9') {
    return n.slice(0, 4) + n.slice(5);
  }
  return n;
}

export function conectar() {
  return new Promise(async (resolve) => {
    const { state, saveCreds } = await useMultiFileAuthState('sessao-whatsapp');
    const { version } = await fetchLatestBaileysVersion();

    sock = makeWASocket({
      version,
      auth: state,
      logger: pino({ level: 'silent' }),
      markOnlineOnConnect: false,
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async (u) => {
      const { connection, lastDisconnect, qr } = u;

      if (qr && !state.creds.registered && !state.creds.me) {
        const numero = numeroParaWhatsApp(process.env.WHATSAPP_NUMERO);
        if (numero && !jaPediuCodigo) {
          jaPediuCodigo = true;
          console.log(`📱 Pedindo código para o número ${numero}`);
          const codigo = await sock.requestPairingCode(numero);
          console.log('\n==============================================');
          console.log(`  CÓDIGO PARA CONECTAR O WHATSAPP:  ${codigo}`);
          console.log('==============================================');
          console.log('No celular: WhatsApp > Configurações > Aparelhos conectados >');
          console.log('Conectar um aparelho > "Conectar com número de telefone" e digite o código.');
          console.log('⚠️  Digite o código NO CELULAR do número do robô, não aqui no tablet.\n');
        } else if (!numero) {
          console.log('\nEscaneie este QR Code no WhatsApp (Aparelhos conectados > Conectar um aparelho):\n');
          qrcode.generate(qr, { small: true });
        }
      }

      if (connection === 'open') {
        pronto = true;
        console.log('✅ WhatsApp conectado!');
        resolve(sock);
      }

      if (connection === 'close') {
        pronto = false;
        const codigo = lastDisconnect?.error?.output?.statusCode;
        if (codigo === DisconnectReason.loggedOut) {
          // Limpa a conexão antiga para a próxima tentativa começar do zero
          fs.rmSync('sessao-whatsapp', { recursive: true, force: true });
          console.log('❌ O WhatsApp não aceitou a conexão (ou foi desconectado pelo celular).');
          console.log('   Já limpei a tentativa anterior. Rode o comando de novo para gerar um código novo.');
          process.exit(1);
        }
        console.log('🔄 Conexão caiu, reconectando...');
        setTimeout(() => conectar().then(resolve), 3000);
      }
    });
  });
}

/** Deixa só letras e números (sem emoji, acento ou símbolo) para comparar nomes de grupo. */
function limparNome(t) {
  return String(t || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

/**
 * Acha o grupo pelo nome (ignora emoji, acento e maiúsculas).
 * Trava de segurança: o robô NUNCA posta nos grupos oficiais (lista em config.json > gruposProibidos).
 */
export async function acharGrupo(nome, gruposProibidos = []) {
  const proibidos = ['Alerta K-Beauty', ...gruposProibidos].map(limparNome).filter(Boolean);
  const ehProibido = (n) => proibidos.some((p) => limparNome(n).includes(p));
  if (ehProibido(nome)) {
    console.log(`⛔ "${nome}" é um grupo oficial. O robô só manda no grupo de rascunhos.`);
    return null;
  }
  const grupos = Object.values(await sock.groupFetchAllParticipating());
  const alvo = limparNome(nome);
  const achado =
    grupos.find((g) => limparNome(g.subject) === alvo) ||
    grupos.find((g) => limparNome(g.subject).startsWith(alvo));
  if (!achado || ehProibido(achado.subject)) {
    console.log(`\n⚠️  Não achei o grupo "${nome}". Seus grupos são:`);
    grupos.forEach((g) => console.log(`   - ${g.subject}`));
    console.log('Copie o nome para "grupoRascunhos" no config.json.\n');
    return null;
  }
  return achado.id;
}

export async function enviar(grupoId, texto, imagemUrl) {
  if (!pronto) throw new Error('WhatsApp não está conectado');
  if (imagemUrl) {
    try {
      await sock.sendMessage(grupoId, { image: { url: imagemUrl }, caption: texto });
      return;
    } catch {
      // se a imagem falhar, manda só o texto
    }
  }
  await sock.sendMessage(grupoId, { text: texto });
}
