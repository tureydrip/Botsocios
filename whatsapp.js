const { makeWASocket, useMultiFileAuthState, delay, DisconnectReason, Browsers } = require('@whiskeysockets/baileys');
const pino = require('pino');

const BOT_NUMBER = "573114998378"; 
const ADMIN_NUMBER = "573142369516";

let sock;
let codigoPedido = false; // Bandera para pedir el código UNA SOLA VEZ

async function iniciarWhatsApp() {
    const { state, saveCreds } = await useMultiFileAuthState('baileys_auth_info');

    sock = makeWASocket({
        auth: state,
        printQRInTerminal: false,
        logger: pino({ level: 'silent' }),
        // LA CLAVE ESTÁ AQUÍ: Usar el objeto Browsers nativo de Baileys
        // Esto le da a WhatsApp la firma exacta que requiere para que el código sea válido.
        browser: Browsers.macOS('Desktop'),
        syncFullHistory: false // Evita sobrecargas al vincular por primera vez
    });

    // SISTEMA DE CÓDIGO DE EMPAREJAMIENTO
    if (!sock.authState.creds.registered && !codigoPedido) {
        codigoPedido = true; // Bloqueamos para que no pida más códigos
        
        // Limpiamos el número de cualquier espacio o símbolo "+" residual que pueda dañar la petición
        const numeroLimpio = BOT_NUMBER.replace(/[^0-9]/g, '');

        setTimeout(async () => {
            try {
                let code = await sock.requestPairingCode(numeroLimpio);
                code = code?.match(/.{1,4}/g)?.join("-") || code;
                console.log(`\n=========================================`);
                console.log(`🟢 CÓDIGO DE WHATSAPP: ${code}`);
                console.log(`⏳ Ve a Dispositivos Vinculados > "Vincular con el número de teléfono".`);
                console.log(`=========================================\n`);
            } catch (error) {
                console.log('🔴 Error pidiendo código:', error.message);
                codigoPedido = false; // Si falla, permitimos que intente de nuevo
            }
        }, 3000);
    }

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect } = update;
        
        if (connection === 'close') {
            const reason = lastDisconnect.error?.output?.statusCode;
            
            if (reason === DisconnectReason.loggedOut) {
                console.log('🔴 Dispositivo desvinculado por WhatsApp. Borra la carpeta de sesión.');
                codigoPedido = false; 
            } else {
                console.log(`🔴 Conexión caída (Código: ${reason}). Reconectando de forma segura...`);
                setTimeout(() => {
                    iniciarWhatsApp();
                }, 5000);
            }
        } else if (connection === 'open') {
            console.log('✅ Bot de WhatsApp de LUCK XIT conectado exitosamente.');
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
                console.log('🔴 Error en comando .agg:', error.message);
            }
        }
    });
}

async function enviarNotificacionWA(numero, mensaje) {
    if (!sock) return console.log('🔴 WhatsApp no está listo.');
    try {
        // Aseguramos de limpiar el número destino también
        const numeroLimpio = numero.replace(/[^0-9]/g, '');
        const jid = `${numeroLimpio}@s.whatsapp.net`;
        
        await sock.sendPresenceUpdate('composing', jid);
        const typingTime = Math.floor(Math.random() * (4000 - 2000 + 1) + 2000);
        await delay(typingTime); 
        await sock.sendMessage(jid, { text: mensaje });
    } catch (error) {
        console.log(`🔴 No se pudo enviar mensaje a ${numero}:`, error.message);
    }
}

iniciarWhatsApp();

module.exports = { enviarNotificacionWA };
