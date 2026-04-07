const { makeWASocket, useMultiFileAuthState, delay, DisconnectReason, Browsers } = require('@whiskeysockets/baileys');
const pino = require('pino');

// --- CONFIGURACIÓN ---
const BOT_NUMBER = "573114998378"; 

// --- WHATSAPP (DESACTIVADO/CONGELADO) ---
// He envuelto todo en esta función que NO se está llamando al final.
// El servidor no gastará ni 1kb de RAM en WhatsApp.
async function iniciarWhatsApp() {
    console.log("⚠️ El sistema de WhatsApp está actualmente desactivado para priorizar Telegram.");
    /*
    const { state, saveCreds } = await useMultiFileAuthState('baileys_auth_info');
    const sock = makeWASocket({
        auth: state,
        printQRInTerminal: false,
        logger: pino({ level: 'silent' }),
        browser: Browsers.macOS('Desktop')
    });
    // ... resto del código comentado ...
    */
}

// --- LÓGICA DE TELEGRAM (ACTIVA) ---
// Asegúrate de que tu lógica de Telegram esté aquí abajo.
// Al NO llamar a iniciarWhatsApp(), el VPS no tendrá interferencias.

console.log("🤖 LUCK XIT PRO V3 - MODO PRIORIDAD TELEGRAM");
console.log("✅ El servidor VPS está libre de procesos de WhatsApp.");

// SECCIÓN TELEGRAM:
// Aquí debe ir tu código de: const bot = new TelegramBot(TOKEN, {polling: true});
// Al estar solo, responderá instantáneamente sin errores 405 ni bloqueos.

// iniciarWhatsApp(); // <--- ESTO ESTÁ COMENTADO PARA NO INTERFERIR
