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

export function conectar() {
  return new Promise(async (resolve) => {
    const { state, saveCreds } = await useMultiFileAuthState('sessao-whatsapp');
    const { version } = await fetchLatestBaileysVersion();

    sock = makeWASocket({
      version,
      auth: state,
      logger: pino({ level: 'silent' }),
      browser: ['Achadinhos Bot', 'Chrome', '1.0'],
      markOnlineOnConnect: false,
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async (u) => {
      const { connection, lastDisconnect, qr } = u;

      if (qr && !state.creds.registered && !state.creds.me) {
        const numero = (process.env.WHATSAPP_NUMERO || '').replace(/\D/g, '');
        if (numero && !jaPediuCodigo) {
          jaPediuCodigo = true;
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

/** Acha o grupo pelo nome (ignora maiúsculas/minúsculas). */
export async function acharGrupo(nome) {
  // Trava de segurança: o robô NUNCA posta no grupo oficial. Só ela posta lá.
  if (/alerta\s*k-?\s*beauty/i.test(nome)) {
    console.log('⛔ O robô não pode mandar no grupo oficial Alerta K-Beauty. Use o grupo de rascunhos.');
    return null;
  }
  const grupos = await sock.groupFetchAllParticipating();
  const lista = Object.values(grupos);
  const alvo = lista.find((g) => g.subject?.trim().toLowerCase() === nome.trim().toLowerCase());
  if (!alvo) {
    console.log(`\n⚠️  Não achei o grupo "${nome}". Seus grupos são:`);
    lista.forEach((g) => console.log(`   - ${g.subject}`));
    console.log('Copie o nome exato para "grupoRascunhos" no config.json.\n');
    return null;
  }
  return alvo.id;
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
