const { makeWASocket, useMultiFileAuthState, delay } = require('@whiskeysockets/baileys');
const pino = require('pino');

const BOT_NUMBER = "573114998378"; 
const ADMIN_NUMBER = "573142369516";

let sock;

async function iniciarWhatsApp() {
    const { state, saveCreds } = await useMultiFileAuthState('baileys_auth_info');

    sock = makeWASocket({
        auth: state,
        printQRInTerminal: false,
        logger: pino({ level: 'silent' }),
        browser: ['LUCK XIT Bot', 'Chrome', '1.0.0']
    });

    if (!sock.authState.creds.registered) {
        setTimeout(async () => {
            let code = await sock.requestPairingCode(BOT_NUMBER);
            code = code?.match(/.{1,4}/g)?.join("-") || code;
            console.log(`\n=========================================`);
            console.log(`🟢 CÓDIGO DE EMPAREJAMIENTO WHATSAPP: ${code}`);
            console.log(`=========================================\n`);
        }, 3000);
    }

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect } = update;
        if (connection === 'close') {
            console.log('🔴 Conexión de WhatsApp cerrada. Reconectando...');
            iniciarWhatsApp();
        } else if (connection === 'open') {
            console.log('✅ Bot de WhatsApp conectado exitosamente.');
        }
    });

    sock.ev.on('messages.upsert', async (m) => {
        const msg = m.messages[0];
        if (!msg.message || msg.key.fromMe) return;

        const remoteJid = msg.key.remoteJid;
        const sender = msg.key.participant || remoteJid;
        const text = msg.message.conversation || msg.message.extendedTextMessage?.text || "";

        if (text === '.agg' && remoteJid.endsWith('@g.us') && sender.includes(ADMIN_NUMBER)) {
            try {
                await sock.sendPresenceUpdate('composing', remoteJid);
                await delay(3000); 

                const groupMetadata = await sock.groupMetadata(remoteJid);
                const participants = groupMetadata.participants;
                
                await sock.sendMessage(remoteJid, { text: `⏳ Procesando ${participants.length} miembros del grupo para LUCK XIT...` });
                await delay(2000);
                
                await sock.sendPresenceUpdate('composing', remoteJid);
                await delay(2500);
                await sock.sendMessage(remoteJid, { text: `✅ *LUCK XIT ADMIN:*\n\nSe han registrado los miembros del grupo exitosamente.` }, { quoted: msg });
                
            } catch (error) {
                console.log('Error en comando .agg:', error);
            }
        }
    });
}

async function enviarNotificacionWA(numero, mensaje) {
    if (!sock) return console.log('WhatsApp no está listo.');
    try {
        const jid = `${numero}@s.whatsapp.net`;
        await sock.sendPresenceUpdate('composing', jid);
        const typingTime = Math.floor(Math.random() * (4000 - 2000 + 1) + 2000);
        await delay(typingTime); 
        await sock.sendMessage(jid, { text: mensaje });
    } catch (error) {
        console.log(`No se pudo enviar mensaje a ${numero}:`, error);
    }
}

iniciarWhatsApp();

module.exports = { enviarNotificacionWA };
