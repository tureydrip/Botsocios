const { makeWASocket, useMultiFileAuthState, delay, DisconnectReason } = require('@whiskeysockets/baileys');
const pino = require('pino');

// Tu número configurado
const BOT_NUMBER = "573114998378"; 
const ADMIN_NUMBER = "573142369516";

let sock;
let generadorCodigos; // Variable para controlar el bucle de 20 segundos

async function iniciarWhatsApp() {
    const { state, saveCreds } = await useMultiFileAuthState('baileys_auth_info');

    sock = makeWASocket({
        auth: state,
        printQRInTerminal: false,
        logger: pino({ level: 'silent' }), // Silenciamos los logs excesivos de baileys
        browser: ['LUCK XIT Bot', 'Chrome', '1.0.0']
    });

    // SISTEMA DE CÓDIGO DE EMPAREJAMIENTO (Ciclo de 20 segundos)
    if (!sock.authState.creds.registered) {
        
        const pedirCodigo = async () => {
            // Si por alguna razón ya se registró, detenemos el generador
            if (sock.authState.creds.registered) {
                if (generadorCodigos) clearInterval(generadorCodigos);
                return;
            }

            try {
                let code = await sock.requestPairingCode(BOT_NUMBER);
                code = code?.match(/.{1,4}/g)?.join("-") || code;
                console.log(`\n=========================================`);
                console.log(`🟢 NUEVO CÓDIGO DE WHATSAPP: ${code}`);
                console.log(`⏳ Tienes 20 segundos para ingresarlo...`);
                console.log(`=========================================\n`);
            } catch (error) {
                // Si la librería tira un error temporal por pedir muy rápido, lo ignoramos y esperamos al siguiente ciclo
                console.log('⏳ Esperando al siguiente ciclo para generar código...');
            }
        };

        // Pedimos el primero a los 3 segundos
        setTimeout(() => {
            pedirCodigo();
            // Luego, programamos que se repita exactamente cada 20.000 milisegundos (20s)
            generadorCodigos = setInterval(pedirCodigo, 20000);
        }, 3000);
    }

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect } = update;
        
        if (connection === 'close') {
            // Si se cierra la conexión, matamos el bucle para que no se sature la memoria de Railway
            if (generadorCodigos) clearInterval(generadorCodigos); 
            
            const reason = lastDisconnect.error?.output?.statusCode;
            
            if (reason === DisconnectReason.loggedOut) {
                console.log('🔴 Dispositivo desvinculado. Debes borrar la sesión en Railway y reiniciar.');
            } else {
                console.log('🔴 Conexión pausada. El servidor reintentará conectarse en 5 segundos de forma segura...');
                setTimeout(() => {
                    iniciarWhatsApp();
                }, 5000);
            }
        } else if (connection === 'open') {
            // ¡Éxito! Matamos el bucle de los 20 segundos porque ya no lo necesitamos
            if (generadorCodigos) clearInterval(generadorCodigos);
            console.log('✅ Bot de WhatsApp de LUCK XIT conectado exitosamente.');
        }
    });

    // LISTENER DE MENSAJES (Para el comando .agg del Admin)
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
                await sock.sendMessage(remoteJid, { text: `✅ *LUCK XIT ADMIN:*\n\nSe han registrado los miembros del grupo exitosamente en el sistema.` }, { quoted: msg });
                
            } catch (error) {
                console.log('Error en comando .agg:', error);
            }
        }
    });
}

// FUNCIÓN PARA ENVIAR MENSAJES CON ANTI-BAN (Llamada desde Telegram)
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
