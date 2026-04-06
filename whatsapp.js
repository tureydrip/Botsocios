const { makeWASocket, useMultiFileAuthState, delay, DisconnectReason } = require('@whiskeysockets/baileys');
const pino = require('pino');
const fs = require('fs'); 

const BOT_NUMBER = "573114998378"; 
const ADMIN_NUMBER = "573142369516";
const DIR_SESION = 'auth_luck_xit2_limpia'; // Nueva carpeta virgen

let sock;
let codigoPedido = false;

async function iniciarWhatsApp() {
    const { state, saveCreds } = await useMultiFileAuthState(DIR_SESION);

    sock = makeWASocket({
        auth: state,
        printQRInTerminal: false,
        logger: pino({ level: 'silent' }), // Silencia logs innecesarios
        browser: ['Ubuntu', 'Chrome', '20.0.04']
    });

    sock.ev.on('creds.update', saveCreds);

    if (!sock.authState.creds.registered && !codigoPedido) {
        codigoPedido = true;
        setTimeout(async () => {
            try {
                const numeroLimpio = BOT_NUMBER.replace(/[^0-9]/g, '');
                let code = await sock.requestPairingCode(numeroLimpio);
                code = code?.match(/.{1,4}/g)?.join("-") || code;
                
                console.log(`\n=========================================`);
                console.log(`📱 REVISA TU CELULAR: WhatsApp te debió enviar la notificación.`);
                console.log(`🟢 CÓDIGO DE VINCULACIÓN: ${code}`);
                console.log(`=========================================\n`);
            } catch (error) {
                console.log('🔴 Error pidiendo código con Meta. Reiniciando servidor para limpiar memoria...');
                process.exit(1); // 🛑 RAILWAY REINICIARÁ LA APP LIMPIA
            }
        }, 5000); 
    }

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect } = update;
        
        if (connection === 'close') {
            const reason = lastDisconnect.error?.output?.statusCode;
            
            if (reason === DisconnectReason.loggedOut || reason === 401 || reason === 403 || reason === 405) {
                console.log('🔴 Sesión rechazada por WhatsApp. Borrando basura...');
                if (fs.existsSync(DIR_SESION)) {
                    fs.rmSync(DIR_SESION, { recursive: true, force: true });
                }
            }
            
            console.log('🔄 Desconectado. Apagando proceso para que Railway lo reinicie fresco...');
            // 🛑 EN LUGAR DE BUCLES, APAGAMOS EL PROCESO. RAILWAY LO PRENDE AUTOMÁTICAMENTE EN 3 SEGUNDOS.
            process.exit(1); 
            
        } else if (connection === 'open') {
            console.log('✅ Bot LUCK XIT conectado a WhatsApp correctamente.');
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
                
                await sock.sendMessage(remoteJid, { text: `⏳ Procesando ${participants.length} miembros...` });
                await delay(2000);
                
                await sock.sendPresenceUpdate('composing', remoteJid);
                await delay(2500);
                await sock.sendMessage(remoteJid, { text: `✅ *LUCK XIT ADMIN:*\n\nUsuarios registrados con éxito.` }, { quoted: msg });
                
            } catch (error) {
                console.log('Error en comando .agg:', error);
            }
        }
    });
}

async function enviarNotificacionWA(numero, mensaje) {
    if (!sock) return;
    try {
        const jid = `${numero}@s.whatsapp.net`;
        await sock.sendPresenceUpdate('composing', jid);
        const typingTime = Math.floor(Math.random() * (4000 - 2000 + 1) + 2000);
        await delay(typingTime); 
        await sock.sendMessage(jid, { text: mensaje });
    } catch (error) {
        console.log(`No se pudo enviar mensaje a ${numero}`);
    }
}

iniciarWhatsApp();

module.exports = { enviarNotificacionWA };
