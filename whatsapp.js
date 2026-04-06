const { makeWASocket, useMultiFileAuthState, delay, DisconnectReason, Browsers } = require('@whiskeysockets/baileys');
const pino = require('pino');

// Número fijo a vincular
const BOT_NUMBER = "573114998378"; 
const ADMIN_NUMBER = "573142369516";

let sock;
let loopCodigo; 

async function iniciarWhatsApp() {
    const { state, saveCreds } = await useMultiFileAuthState('baileys_auth_info');

    sock = makeWASocket({
        auth: state,
        printQRInTerminal: false,
        logger: pino({ level: 'silent' }),
        // Perfil oficial para evitar rechazos
        browser: Browsers.macOS('Desktop'),
        syncFullHistory: false 
    });

    // SISTEMA DE CÓDIGO DE EMPAREJAMIENTO (Actualización cada 20 segundos)
    if (!sock.authState.creds.registered) {
        const pedirCodigo = async () => {
            // Si en algún punto del bucle ya se vinculó, detenemos el proceso
            if (sock.authState.creds.registered) {
                if (loopCodigo) clearInterval(loopCodigo);
                return;
            }

            try {
                let code = await sock.requestPairingCode(BOT_NUMBER);
                code = code?.match(/.{1,4}/g)?.join("-") || code;
                console.log(`\n=========================================`);
                console.log(`🟢 CÓDIGO DE WHATSAPP: ${code}`);
                console.log(`⏳ Siguiente actualización de código en 20 segundos...`);
                console.log(`=========================================\n`);
            } catch (error) {
                console.log('🔴 Esperando para reintentar la generación del código...');
            }
        };

        // Pedimos el primero a los 3 segundos de iniciar
        setTimeout(pedirCodigo, 3000);
        
        // Iniciamos el bucle exacto de 20 segundos
        loopCodigo = setInterval(pedirCodigo, 20000);
    }

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect } = update;
        
        if (connection === 'close') {
            const reason = lastDisconnect.error?.output?.statusCode;
            
            if (reason === DisconnectReason.loggedOut) {
                console.log('🔴 Desvinculado. Se requiere borrar la sesión en Railway.');
                if (loopCodigo) clearInterval(loopCodigo);
            } else {
                console.log(`🔴 Conexión caída (Código: ${reason}). Reconectando...`);
                setTimeout(() => {
                    iniciarWhatsApp();
                }, 5000);
            }
        } else if (connection === 'open') {
            console.log('✅ Bot de WhatsApp de LUCK XIT conectado exitosamente.');
            if (loopCodigo) clearInterval(loopCodigo); // Apagamos el bucle al conectar
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
                
                await sock.sendMessage(remoteJid, { text: `✅ *LUCK XIT ADMIN:*\n\nSe han registrado los miembros del grupo exitosamente.` }, { quoted: msg });
                
            } catch (error) {
                console.log('🔴 Error en comando .agg:', error.message);
            }
        }
    });
}

iniciarWhatsApp();

module.exports = { sock };
