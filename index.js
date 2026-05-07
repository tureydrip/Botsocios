const TelegramBot = require('node-telegram-bot-api');
const { initializeApp } = require('firebase/app');
const { getDatabase, ref, get, update, push, set, remove, onValue, onChildAdded } = require('firebase/database');
const { default: makeWASocket, useMultiFileAuthState, fetchLatestBaileysVersion, DisconnectReason } = require('@whiskeysockets/baileys');
const pino = require('pino');
const fs = require('fs');
const path = require('path');

// CONFIGURACION LUCK XIT OFC
const token = '8275295427:AAHiO33nzZPgmglmSWo8eKVMKkEsCy19fSA';
const bot = new TelegramBot(token, { polling: true });
const SUPER_ADMIN_ID = 7710633235; 
// Lista de administradores para recibir notificaciones (sin el signo +)
const ADMIN_WA_NUMBERS = ['573142369516', '34642459475']; 

const firebaseConfig = {
    apiKey: "AIzaSyDrNambFw1VNXSkTR1yGq6_B9jWWA1LsxM",
    authDomain: "clientesvip-be9bd.firebaseapp.com",
    projectId: "clientesvip-be9bd",
    storageBucket: "clientesvip-be9bd.firebasestorage.app",
    messagingSenderId: "131036295027",
    appId: "1:131036295027:web:3cc360dca16d4873f55f06"
};
const app = initializeApp(firebaseConfig);
const db = getDatabase(app);

// Estados de interaccion
const waUserStates = {};
const userStates = {};

// ==========================================
// SISTEMA DE NOTIFICACIONES (FIREBASE -> WHATSAPP)
// ==========================================

// 1. OYENTE DE RECARGAS DE SALDO (Avisa a los Admins)
const pendingRef = ref(db, 'pending_receipts');
let isInitialLoadRecargas = true;
onValue(pendingRef, () => { isInitialLoadRecargas = false; }, { onlyOnce: true });
onChildAdded(pendingRef, async (snapshot) => {
    if (isInitialLoadRecargas) return; 
    const receiptId = snapshot.key;
    const data = snapshot.val();
    if (data && !data.notified) {
        const shortId = receiptId.slice(-6).toUpperCase();
        const msgWaAdmin = `🔔 *NUEVA RECARGA PENDIENTE*\n\n` +
                         `*🆔 Ref:* #${shortId}\n` +
                         `*👤 Usuario:* ${data.username}\n` +
                         `*💵 Monto (USD):* $${parseFloat(data.amountUsd || 0).toFixed(2)}\n` +
                         `*🌎 País:* ${data.countryName || 'No especificado'}\n` +
                         `*💰 Monto Local:* ${data.amountLocal || 'No especificado'}\n\n` +
                         `👉 _Ingrese a su panel web de LUCK XIT OFC para revisar y validar este pago._`;
        
        const imageUrl = data.receiptUrl && data.receiptUrl.startsWith('http') ? data.receiptUrl : null;
        ADMIN_WA_NUMBERS.forEach(adminNumber => { enviarMensajeWA(adminNumber, msgWaAdmin, false, imageUrl); });
        try { await update(ref(db, `pending_receipts/${receiptId}`), { notified: true }); } catch (error) {}
    }
});

// 2. OYENTE DE COMPRAS WEB (CLAN LEVEL UP)
const clanOrdersRef = ref(db, 'clan_level_up_orders');
let isInitialClanLoad = true;
onValue(clanOrdersRef, () => { isInitialClanLoad = false; }, { onlyOnce: true });
onChildAdded(clanOrdersRef, async (snapshot) => {
    if (isInitialClanLoad) return; 
    const orderId = snapshot.key;
    const orderData = snapshot.val();
    if (orderData && orderData.status === 'Pendiente' && !orderData.processed) {
        const shortId = orderId.slice(-6).toUpperCase();
        const adminMsg = `🚨 *NOTIFICACIÓN WEB: COMPRA LEVEL UP* 🚨\n\n` +
                         `*🆔 Pedido:* #${shortId}\n` +
                         `*👤 Cliente:* ${orderData.username}\n` +
                         `*🔰 ID del Clan:* ${orderData.clanId || 'No especificado'}\n` +
                         `*📱 WhatsApp:* ${orderData.waNumber}\n\n` +
                         `🛒 *Producto:* ${orderData.product}\n` +
                         `💰 *Pago:* $${parseFloat(orderData.price).toFixed(2)} USD (Descontado de la Web)\n\n` +
                         `🛠️ _Acción requerida: Contactar al usuario e iniciar servicio de 4 bots (8h)._`;
        ADMIN_WA_NUMBERS.forEach(adminNum => { enviarMensajeWA(adminNum, adminMsg, false, null); });
        if (orderData.waNumber && orderData.waNumber !== 'No vinculado' && orderData.waNumber.length > 5) {
            const userMsg = `✅ *LUCK XIT OFC - CONFIRMACIÓN DE COMPRA*\n\nHola ${orderData.username}, hemos recibido tu orden de "${orderData.product}".\n\nUn administrador se pondrá en contacto contigo en breve vía WhatsApp para coordinar el servicio.`;
            enviarMensajeWA(orderData.waNumber, userMsg, false, null);
        }
        try { await update(ref(db, `clan_level_up_orders/${orderId}`), { processed: true, status: 'Notificado a Admins' }); } catch (e) {}
    }
});

// 3. OYENTE DE MENSAJES INDIVIDUALES DESDE LA WEB
const messagesRef = ref(db, 'whatsapp_control/messages');
let isInitialLoadMessages = true;
onValue(messagesRef, () => { isInitialLoadMessages = false; }, { onlyOnce: true });
onChildAdded(messagesRef, async (snapshot) => {
    if (isInitialLoadMessages) return;
    const msgId = snapshot.key;
    const msgData = snapshot.val();
    if (msgData && msgData.number && msgData.message) {
        enviarMensajeWA(msgData.number, msgData.message, false);
        try { await set(ref(db, `whatsapp_control/messages/${msgId}`), null); } catch (error) {}
    }
});

// ==========================================
// 4. NUEVO: OYENTE DE VENTAS DE CUENTAS FF DESDE LA WEB
// ==========================================
const ffSalesRef = ref(db, 'ff_account_sales');
let isInitialLoadFF = true;
onValue(ffSalesRef, () => { isInitialLoadFF = false; }, { onlyOnce: true });
onChildAdded(ffSalesRef, async (snapshot) => {
    if (isInitialLoadFF) return;

    const saleId = snapshot.key;
    const data = snapshot.val();

    if (data && !data.notified) {
        console.log(`[LUCK XIT OFC] Nueva cuenta FF a la venta detectada en Firebase.`);
        
        const ADMIN_FF = '573142369516'; // Solo a este Admin

        const adminMsg = `🎮 *NUEVA OFERTA: VENTA DE CUENTA FF* 🎮\n\n` +
                         `*👤 Vendedor:* ${data.username}\n` +
                         `*🆔 ID de Cuenta:* ${data.accId}\n` +
                         `*📈 Nivel:* ${data.accLevel}\n` +
                         `*⭐ Prime/Pases:* ${data.accPrime}\n` +
                         `*🔫 Evos:* ${data.accEvos}\n` +
                         `*👕 Pechos:* ${data.accChests}\n` +
                         `*💰 Precio Solicitado:* ${data.accPrice}\n\n` +
                         `*📱 Contacto Directo:* wa.me/${data.userWa}\n\n` +
                         `_La imagen de la cuenta fue enviada en este mensaje._`;

        // 1. Enviar los datos con foto a tu WhatsApp
        const imageUrl = data.imageUrl && data.imageUrl.startsWith('http') ? data.imageUrl : null;
        enviarMensajeWA(ADMIN_FF, adminMsg, false, imageUrl);

        // 2. Enviar mensaje de confirmación al WhatsApp del usuario automáticamente
        if (data.userWa && data.userWa.length > 5) {
            const userMsg = `✅ *LUCK XIT OFC - VENTA DE CUENTA*\n\nHola ${data.username}, tu información y captura de la cuenta han sido recibidas exitosamente.\n\nEl administrador ya está revisando tu cuenta y se pondrá en contacto por este chat en la brevedad posible. ¡Gracias por confiar en nosotros!`;
            enviarMensajeWA(data.userWa, userMsg, false, null);
        }

        // 3. Marcar como notificada en la base de datos para no repetirlo
        try {
            await update(ref(db, `ff_account_sales/${saleId}`), { notified: true });
        } catch (error) { console.error('Error marcando venta de cuenta FF:', error.message); }
    }
});

// ==========================================
// SISTEMA DE CONTROL REMOTO DESDE LA WEB
// ==========================================
let waSock = null;

onValue(ref(db, 'whatsapp_control/command'), async (snapshot) => {
    const cmd = snapshot.val();
    if (cmd && cmd.action === 'request_code') {
        try {
            if (waSock && waSock.authState.creds.registered) {
                await set(ref(db, 'whatsapp_control/code'), { code: 'EL BOT YA ESTA VINCULADO', timestamp: Date.now() });
                return;
            }
            const code = await waSock.requestPairingCode(cmd.number);
            await set(ref(db, 'whatsapp_control/code'), { code: code, timestamp: Date.now() });
            await set(ref(db, 'whatsapp_control/command'), null);
        } catch (error) {
            await set(ref(db, 'whatsapp_control/code'), { code: 'ERROR: ' + error.message, timestamp: Date.now() });
        }
    }
});

onValue(ref(db, 'whatsapp_control/broadcast'), async (snapshot) => {
    const data = snapshot.val();
    if (data && data.message) {
        const usersSnap = await get(ref(db, 'users'));
        if (usersSnap.exists()) {
            usersSnap.forEach(u => {
                const user = u.val();
                if (user.waNumber) enviarMensajeWA(user.waNumber, `📢 *COMUNICADO OFICIAL*\n\n${data.message}`, true);
            });
        }
        await set(ref(db, 'whatsapp_control/broadcast'), null);
    }
});

// ==========================================
// SISTEMA DE RESTAURACION DE SESION (FIREBASE)
// ==========================================
const sessionDir = './auth_info_baileys';
const credsPath = path.join(sessionDir, 'creds.json');

async function restaurarSesionFirebase() {
    if (!fs.existsSync(sessionDir)) fs.mkdirSync(sessionDir, { recursive: true });
    if (!fs.existsSync(credsPath)) {
        const snap = await get(ref(db, 'whatsapp_control/backup_session'));
        if (snap.exists()) fs.writeFileSync(credsPath, JSON.stringify(snap.val()));
    }
}

// ==========================================
// MODULO DE WHATSAPP BOT (BAILEYS)
// ==========================================
async function iniciarWhatsApp() {
    await restaurarSesionFirebase();
    const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');
    const { version } = await fetchLatestBaileysVersion();

    waSock = makeWASocket({
        version,
        logger: pino({ level: 'silent' }),
        printQRInTerminal: false,
        auth: state,
        browser: ['Ubuntu', 'Chrome', '20.0.04']
    });

    waSock.ev.on('creds.update', async () => {
        await saveCreds();
        if (fs.existsSync(credsPath)) {
            try {
                const rawData = fs.readFileSync(credsPath, 'utf8');
                const credsObj = JSON.parse(rawData);
                await set(ref(db, 'whatsapp_control/backup_session'), credsObj);
            } catch(e) {}
        }
    });

    waSock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect } = update;
        if (connection === 'close') {
            const shouldReconnect = (lastDisconnect.error)?.output?.statusCode !== DisconnectReason.loggedOut;
            if (shouldReconnect) iniciarWhatsApp();
        } else if (connection === 'open') {
            console.log('WhatsApp: Conectado exitosamente y blindado. - LUCK XIT OFC');
        }
    });

    // SISTEMA DE MENSAJES RECIBIDOS EN WHATSAPP
    waSock.ev.on('messages.upsert', async m => {
        if (m.type !== 'notify') return; 
        const msg = m.messages[0];
        if (!msg.message || msg.key.fromMe) return;

        const sender = msg.key.remoteJid;
        const numero = sender.split('@')[0];
        const text = msg.message.conversation || msg.message.extendedTextMessage?.text || '';
        const t = text.trim().toLowerCase();

        const uSnap = await get(ref(db, 'users'));
        let webUid = null, webUser = null;
        if (uSnap.exists()) {
            uSnap.forEach(u => {
                if (u.val().waNumber === numero && u.val().waLinked) {
                    webUid = u.key; webUser = u.val();
                }
            });
        }

        if (!webUser) return; 

        if (t === '.shop' || t === 'tienda') {
            const pSnap = await get(ref(db, 'products'));
            let kbText = `🏪 *TIENDA LUCK XIT OFC* 🏪\n\nResponda con el *NÚMERO* del producto que desea visualizar o comprar:\n\n`;
            let pList = [];
            let i = 1;
            
            pSnap.forEach(c => {
                const p = adaptarProductoLegacy(c.val());
                kbText += `*${i}.* 🎮 ${p.name}\n`;
                pList.push({ id: c.key, name: p.name, durations: p.durations });
                i++;
            });

            if(pList.length === 0) return enviarMensajeWA(numero, `⚠️ _La tienda se encuentra vacía en este momento. Vuelva más tarde._`);

            waUserStates[numero] = { step: 'SHOP_SELECT_PROD', pList };
            kbText += `\n💡 _Ejemplo: Escriba *1* para seleccionar la primera opción._`;
            return enviarMensajeWA(numero, kbText);
        }

        if (waUserStates[numero]) {
            const state = waUserStates[numero];
            
            if (state.step === 'SHOP_SELECT_PROD') {
                const idx = parseInt(t) - 1;
                if (isNaN(idx) || idx < 0 || idx >= state.pList.length) return enviarMensajeWA(numero, `❌ *Opción inválida.* Responda con un número del 1 al ${state.pList.length}.`);
                
                const prod = state.pList[idx];
                let dText = `📦 *PAQUETE:* ${prod.name}\n\n⏱️ Seleccione la *duración* deseada respondiendo con su NÚMERO:\n\n`;
                let dList = [];
                let dIdx = 1;
                
                Object.keys(prod.durations).forEach(dId => {
                    const dur = prod.durations[dId];
                    const stock = dur.keys ? Object.keys(dur.keys).length : 0;
                    if (stock > 0) {
                        dText += `*${dIdx}.* ⏳ ${dur.duration} ➖ 💵 *$${dur.price} USD* _(${stock} disp.)_\n`;
                        dList.push({ dId, ...dur });
                        dIdx++;
                    }
                });
                
                if (dList.length === 0) {
                    waUserStates[numero] = null;
                    return enviarMensajeWA(numero, `⚠️ _Todas las variantes de este producto están agotadas actualmente._`);
                }
                
                waUserStates[numero] = { step: 'SHOP_SELECT_DUR', prodId: prod.id, dList, prodName: prod.name };
                return enviarMensajeWA(numero, dText);
            }

            if (state.step === 'SHOP_SELECT_DUR') {
                const idx = parseInt(t) - 1;
                if (isNaN(idx) || idx < 0 || idx >= state.dList.length) return enviarMensajeWA(numero, `❌ *Opción inválida.*`);
                const dur = state.dList[idx];
                waUserStates[numero] = { step: 'SHOP_CONFIRM', prodId: state.prodId, durId: dur.dId, durInfo: dur, prodName: state.prodName };
                const confirmMsg = `🧾 *CONFIRMACIÓN DE COMPRA*\n\n*🎮 Producto:* ${state.prodName}\n*⏳ Duración:* ${dur.duration}\n*💵 Precio:* $${dur.price} USD\n*💳 Su Saldo:* $${parseFloat(webUser.balance || 0).toFixed(2)} USD\n\n✅ Escriba *COMPRAR* para procesar la transacción.\n❌ Escriba *CANCELAR* para anular.`;
                return enviarMensajeWA(numero, confirmMsg);
            }

            if (state.step === 'SHOP_CONFIRM') {
                if (t === 'cancelar') {
                    waUserStates[numero] = null;
                    return enviarMensajeWA(numero, `🚫 _Compra cancelada exitosamente._`);
                }
                if (t === 'comprar') {
                    const { prodId, durId, durInfo, prodName } = state;
                    const fPrice = durInfo.price;
                    let cB = parseFloat(webUser.balance||0);
                    
                    if (cB < fPrice) {
                         waUserStates[numero] = null;
                         return enviarMensajeWA(numero, `❌ *Saldo insuficiente.*\n\nCuenta con *$${cB.toFixed(2)} USD*, pero el producto cuesta *$${fPrice.toFixed(2)} USD*. Por favor recargue saldo en la web.`);
                    }

                    const pSnapLive = await get(ref(db, `products/${prodId}`));
                    if(!pSnapLive.exists()) return enviarMensajeWA(numero, `⚠️ _El producto ya no existe o fue retirado._`);
                    
                    const prLive = pSnapLive.val();
                    let realDur = null;
                    if(durId === 'legacy_var' && prLive.keys) realDur = { keys: prLive.keys };
                    else if(prLive.durations && prLive.durations[durId]) realDur = prLive.durations[durId];

                    if (realDur && realDur.keys && Object.keys(realDur.keys).length > 0) {
                        const kId = Object.keys(realDur.keys)[0];
                        const kD = realDur.keys[kId];
                        let kP = `products/${prodId}/durations/${durId}/keys/${kId}`;
                        if (durId === 'legacy_var') kP = `products/${prodId}/keys/${kId}`;

                        const historyKey = push(ref(db)).key;
                        const shortOrderId = historyKey.slice(-6).toUpperCase();
                        const u = { [kP]: null, [`users/${webUid}/balance`]: cB - fPrice };
                        u[`users/${webUid}/history/${historyKey}`] = { product: `${prodName} - ${durInfo.duration}`, key: kD, price: fPrice, date: Date.now(), refunded: false, warrantyHours: durInfo.warranty || 0 };

                        await update(ref(db), u);
                        const successMsg = `🎉 *¡COMPRA EXITOSA!* 🎉\n\n*🆔 Pedido:* #${shortOrderId}\n*🎮 Producto:* ${prodName}\n*⏳ Duración:* ${durInfo.duration}\n\n🔑 *SU KEY / CÓDIGO:*\n\`\`\`${kD}\`\`\`\n\n✨ _Gracias por su preferencia._`;
                        enviarMensajeWA(numero, successMsg);
                        waUserStates[numero] = null;
                    } else {
                        waUserStates[numero] = null;
                        enviarMensajeWA(numero, `⚠️ _Lamentablemente el producto se agotó en este momento._`);
                    }
                    return;
                }
            }
        }
    });
}
iniciarWhatsApp();

// ==========================================
// SISTEMA DE COLA ANTI-BAN WHATSAPP
// ==========================================
const waQueue = [];
let isProcessingWaQueue = false;

async function processWaQueue() {
    if (isProcessingWaQueue || waQueue.length === 0) return;
    isProcessingWaQueue = true;

    while (waQueue.length > 0) {
        const { numero, mensaje, delayAfter, imageUrl } = waQueue.shift();
        
        if (waSock && waSock.authState.creds.registered) {
            try {
                const jid = `${numero}@s.whatsapp.net`;
                await waSock.sendPresenceUpdate('composing', jid);
                const typingMs = Math.min(Math.max(mensaje.length * 20, 1500), 4000);
                await new Promise(resolve => setTimeout(resolve, typingMs));
                await waSock.sendPresenceUpdate('paused', jid);

                if (imageUrl) {
                    await waSock.sendMessage(jid, { image: { url: imageUrl }, caption: mensaje });
                } else {
                    await waSock.sendMessage(jid, { text: mensaje });
                }
            } catch (error) { console.error('Error enviando mensaje WA a', numero, error.message); }
        }
        if (waQueue.length > 0) await new Promise(resolve => setTimeout(resolve, delayAfter));
    }
    isProcessingWaQueue = false;
}

function enviarMensajeWA(numero, mensaje, isMasivo = false, imageUrl = null) {
    const delay = isMasivo ? 60000 : 3000;
    waQueue.push({ numero, mensaje, delayAfter: delay, imageUrl });
    processWaQueue();
}

function adaptarProductoLegacy(p) {
    if (p && !p.durations && p.price !== undefined) {
        p.durations = { 'legacy_var': { duration: p.duration || 'Unica / Estandar', price: p.price, warranty: p.warranty || 0, keys: p.keys || {} } };
        p.category = p.category || 'Android'; 
    }
    return p;
}

// PANEL DE ADMIN TELEGRAM
bot.onText(/\/start/, async (msg) => {
    if (msg.from.id !== SUPER_ADMIN_ID) return;
    bot.sendMessage(msg.chat.id, 'Panel de Control - LUCK XIT OFC', { reply_markup: { inline_keyboard: [[{ text: '[ Vincular WhatsApp ]', callback_data: 'walinkadmin_menu' }]] } });
});

bot.on('callback_query', async (query) => {
    bot.answerCallbackQuery(query.id);
    if (query.from.id !== SUPER_ADMIN_ID) return;
    const chatId = query.message.chat.id;
    if (query.data === 'walinkadmin_menu') {
        return bot.editMessageText('VINCULAR BOT A WHATSAPP\n\nSeleccione el pais:', {chat_id: chatId, message_id: query.message.message_id, reply_markup: {inline_keyboard: [[{text: 'Colombia (+57)', callback_data: 'walinkadmin|57'}, {text: 'Mexico (+52)', callback_data: 'walinkadmin|52'}], [{text: 'Otro Pais', callback_data: 'walinkadmin|otro'}]]}});
    }
    if (query.data.startsWith('walinkadmin|')) {
        const codPais = query.data.split('|')[1];
        if (codPais === 'otro') {
            userStates[chatId] = { step: 'ADMIN_WA_CUSTOM_COUNTRY', data: {} };
            return bot.editMessageText('Escriba el Codigo de Pais:', {chat_id: chatId, message_id: query.message.message_id});
        } else {
            userStates[chatId] = { step: 'ADMIN_WA_NUMBER', data: { countryCode: codPais } };
            return bot.editMessageText(`Escriba el numero sin codigo de pais:`, {chat_id: chatId, message_id: query.message.message_id});
        }
    }
});

bot.on('message', async (msg) => {
    if (msg.from.id !== SUPER_ADMIN_ID || !msg.text || msg.text.startsWith('/start')) return;
    const chatId = msg.chat.id;
    if (userStates[chatId]) {
        if (userStates[chatId].step === 'ADMIN_WA_CUSTOM_COUNTRY') {
            userStates[chatId].data.countryCode = msg.text.replace('+', '').trim();
            userStates[chatId].step = 'ADMIN_WA_NUMBER';
            return bot.sendMessage(chatId, `Escriba el numero:`);
        }
        if (userStates[chatId].step === 'ADMIN_WA_NUMBER') {
            const fullNumber = `${userStates[chatId].data.countryCode}${msg.text.trim()}`;
            bot.sendMessage(chatId, `Solicitando Codigo...`);
            setTimeout(async () => {
                try {
                    const code = await waSock.requestPairingCode(fullNumber);
                    bot.sendMessage(chatId, `Codigo de vinculacion:\n\n\`${code}\``, { parse_mode: 'Markdown' });
                } catch(err) { bot.sendMessage(chatId, 'Error: ' + err.message); }
            }, 3000);
            userStates[chatId] = null;
        }
    }
});
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
