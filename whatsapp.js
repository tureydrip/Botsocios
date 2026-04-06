const { makeWASocket, useMultiFileAuthState, delay, DisconnectReason } = require('@whiskeysockets/baileys');
const pino = require('pino');
const fs = require('fs'); // Importamos 'fs' para poder borrar carpetas corruptas automáticamente

const BOT_NUMBER = "573114998378"; 
const ADMIN_NUMBER = "573142369516";

// NUEVO NOMBRE DE CARPETA: Esto fuerza a Railway a ignorar las sesiones viejas
const DIR_SESION = 'auth_luck_xit_nueva'; 

let sock;
let codigoPedido = false;

async function iniciarWhatsApp() {
    const { state, saveCreds } = await useMultiFileAuthState(DIR_SESION);

    sock = makeWASocket({
        auth: state,
        printQRInTerminal: false,
        logger: pino({ level: 'silent' }),
        browser: ['Ubuntu', 'Chrome', '20.0.04']
    });

    sock.ev.on('creds.update', saveCreds);

    if (!sock.authState.creds.registered && !codigoPedido) {
        codigoPedido = true;
        // Damos 5 segundos para que la conexión con Meta sea estable antes de pedir código
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
                console.log('Error pidiendo código con Meta. Reintentando...', error.message);
                codigoPedido = false; 
            }
        }, 5000); 
    }

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect } = update;
        
        if (connection === 'close') {
            const reason = lastDisconnect.error?.output?.statusCode;
            
            // SISTEMA AUTOLIMPIANTE: Si WhatsApp rechaza, borra todo y empieza de cero
            if (reason === DisconnectReason.loggedOut || reason === 401 || reason === 403 || reason === 405) {
                console.log('🔴 Sesión corrupta o rechazada por WhatsApp. Destruyendo basura vieja...');
                if (fs.existsSync(DIR_SESION)) {
                    fs.rmSync(DIR_SESION, { recursive: true, force: true });
                }
                codigoPedido = false;
                console.log('🔄 Reiniciando con una sesión 100% nueva...');
                setTimeout(iniciarWhatsApp, 3000);
            } else {
                console.log('🔴 Reconectando...');
                codigoPedido = false; 
                setTimeout(iniciarWhatsApp, 5000);
            }
        } else if (connection === 'open') {
            console.log('✅ Bot LUCK XIT conectado a WhatsApp correctamente.');
        }
    });

    // EVENTO DE MENSAJES PARA COMANDO .agg
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

// FUNCIÓN PARA ENVIAR NOTIFICACIONES DESDE TELEGRAM
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
