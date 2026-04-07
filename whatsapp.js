const { makeWASocket, useMultiFileAuthState, delay, DisconnectReason, Browsers } = require('@whiskeysockets/baileys');
const TelegramBot = require('node-telegram-bot-api');
const pino = require('pino');

// --- CONFIGURACIÓN ---
const BOT_NUMBER = "573114998378"; 
const ADMIN_NUMBER = "573142369516";
const TELEGRAM_TOKEN = 'TU_TOKEN_AQUÍ'; // Pon aquí el token que sacaste de BotFather

// --- INICIALIZACIÓN DE TELEGRAM (PRIORIDAD) ---
const tgBot = new TelegramBot(TELEGRAM_TOKEN, { polling: true });

tgBot.on('message', (msg) => {
    const chatId = msg.chat.id;
    if (msg.text === '/start') {
        tgBot.sendMessage(chatId, "✅ Bot de Telegram LUCK XIT activo y funcionando sin lag.");
    }
});

console.log("🚀 Sistema de Telegram iniciado correctamente.");

// --- SISTEMA DE WHATSAPP (AISLADO) ---
let sock;
let codigoPedido = false;

async function iniciarWhatsApp() {
    try {
        const { state, saveCreds } = await useMultiFileAuthState('baileys_auth_info');

        sock = makeWASocket({
            auth: state,
            printQRInTerminal: false,
            logger: pino({ level: 'silent' }), // Silencio total para no llenar logs en Railway
            browser: Browsers.macOS('Desktop'),
            connectTimeoutMs: 60000,
            defaultQueryTimeoutMs: 0,
            keepAliveIntervalMs: 10000
        });

        // Generar código solo si no está registrado y no se ha pedido en esta sesión
        if (!sock.authState.creds.registered && !codigoPedido) {
            codigoPedido = true;
            setTimeout(async () => {
                try {
                    let code = await sock.requestPairingCode(BOT_NUMBER.replace(/[^0-9]/g, ''));
                    code = code?.match(/.{1,4}/g)?.join("-") || code;
                    console.log(`\n=========================================`);
                    console.log(`🟢 CÓDIGO WHATSAPP: ${code}`);
                    console.log(`=========================================\n`);
                } catch (err) {
                    console.log("🔴 Error al generar código WA:", err.message);
                    codigoPedido = false;
                }
            }, 5000);
        }

        sock.ev.on('creds.update', saveCreds);

        sock.ev.on('connection.update', (update) => {
            const { connection, lastDisconnect } = update;
            if (connection === 'close') {
                const shouldReconnect = lastDisconnect.error?.output?.statusCode !== DisconnectReason.loggedOut;
                console.log('🔴 Conexión WA cerrada. Reintentando:', shouldReconnect);
                if (shouldReconnect) {
                    // Reintento con retraso largo para no saturar el VPS
                    setTimeout(() => iniciarWhatsApp(), 15000);
                }
            } else if (connection === 'open') {
                console.log('✅ WhatsApp conectado exitosamente.');
            }
        });

        // Comandos de WhatsApp
        sock.ev.on('messages.upsert', async (m) => {
            const msg = m.messages[0];
            if (!msg.message || msg.key.fromMe) return;
            const text = msg.message.conversation || msg.message.extendedTextMessage?.text || "";
            const remoteJid = msg.key.remoteJid;

            if (text === '.agg' && remoteJid.endsWith('@g.us')) {
                await sock.sendMessage(remoteJid, { text: "✅ Comando recibido en LUCK XIT." });
            }
        });

    } catch (error) {
        console.error("❌ Error fatal en módulo WhatsApp:", error);
    }
}

// --- EJECUCIÓN ---
// Primero arrancamos Telegram que es lo más ligero
// Y lanzamos WhatsApp, pero si falla, no detendrá el proceso principal.
iniciarWhatsApp().catch(err => console.log("Error inicializando WA:", err));

// Manejo de errores para que Railway no tumbe el bot por "Uncaught Error"
process.on('uncaughtException', (err) => {
    console.log('⚠️ Error capturado para evitar cierre del VPS:', err.message);
});
