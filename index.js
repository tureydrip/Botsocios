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
// SISTEMA DE NOTIFICACIONES EN TIEMPO REAL (WEB -> BOT)
// ==========================================
const pendingRef = ref(db, 'pending_receipts');
let isInitialLoad = true;

onValue(pendingRef, () => {
    isInitialLoad = false;
}, { onlyOnce: true });

onChildAdded(pendingRef, (snapshot) => {
    if (isInitialLoad) return; 

    const receiptId = snapshot.key;
    const data = snapshot.val();
    
    if (data) {
        const msgAdmin = `[ NUEVA RECARGA PENDIENTE ]\n\n` +
                         `[ID Recarga:] \`${receiptId}\`\n` +
                         `[Usuario:] ${data.username}\n` +
                         `[Monto USD:] $${parseFloat(data.amountUsd || 0).toFixed(2)}\n` +
                         `[Pais:] ${data.countryName || 'No especificado'}\n` +
                         `[Monto Local:] ${data.amountLocal || 'No especificado'}\n` +
                         `[Comprobante:] ${data.receiptUrl || 'No adjunto'}\n\n` +
                         `Para APROBAR envie:\n\`/config ${receiptId}\`\n\n` +
                         `Para RECHAZAR envie:\n\`/rech ${receiptId}\``;
        
        bot.sendMessage(SUPER_ADMIN_ID, msgAdmin, { parse_mode: 'Markdown' }).catch(() => {});

        enviarMensajeWA('573142369516', `[AVISO PAGO] ${data.username} envio un comprobante de $${parseFloat(data.amountUsd || 0).toFixed(2)} USD. Revisa Telegram para validarlo.`);
    }
});

// ==========================================
// SISTEMA DE CONTROL REMOTO DESDE LA WEB
// ==========================================
let waSock = null;

// Escuchar peticion de vinculacion
onValue(ref(db, 'whatsapp_control/command'), async (snapshot) => {
    const cmd = snapshot.val();
    if (cmd && cmd.action === 'request_code') {
        try {
            if (waSock && waSock.authState.creds.registered) {
                await set(ref(db, 'whatsapp_control/code'), { code: 'EL BOT YA ESTA VINCULADO', timestamp: Date.now() });
                return;
            }
            
            console.log(`[LUCK XIT OFC] Solicitando codigo WA para la web: ${cmd.number}`);
            const code = await waSock.requestPairingCode(cmd.number);
            
            await set(ref(db, 'whatsapp_control/code'), { code: code, timestamp: Date.now() });
            await set(ref(db, 'whatsapp_control/command'), null);
            
        } catch (error) {
            console.error('Error generando codigo WA:', error.message);
            await set(ref(db, 'whatsapp_control/code'), { code: 'ERROR: ' + error.message, timestamp: Date.now() });
        }
    }
});

// Escuchar peticion de Mensaje Global (Broadcast)
onValue(ref(db, 'whatsapp_control/broadcast'), async (snapshot) => {
    const data = snapshot.val();
    if (data && data.message) {
        console.log('[LUCK XIT OFC] Procesando Mensaje Global...');
        
        const usersSnap = await get(ref(db, 'users'));
        if (usersSnap.exists()) {
            usersSnap.forEach(u => {
                const user = u.val();
                if (user.waLinked && user.waNumber) {
                    enviarMensajeWA(user.waNumber, `[ COMUNICADO OFICIAL ]\n\n${data.message}`, true);
                }
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
    if (!fs.existsSync(sessionDir)) {
        fs.mkdirSync(sessionDir, { recursive: true });
    }
    
    if (!fs.existsSync(credsPath)) {
        console.log('[LUCK XIT OFC] Verificando respaldo de sesion en Firebase...');
        const snap = await get(ref(db, 'whatsapp_control/backup_session'));
        if (snap.exists()) {
            fs.writeFileSync(credsPath, JSON.stringify(snap.val()));
            console.log('[LUCK XIT OFC] Sesion restaurada desde Firebase exitosamente.');
        } else {
            console.log('[LUCK XIT OFC] No se encontro respaldo. Se requerira vinculacion.');
        }
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
            } catch(e) {
                console.error('[LUCK XIT OFC] Error respaldando sesion en Firebase:', e.message);
            }
        }
    });

    waSock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect } = update;
        if (connection === 'close') {
            const shouldReconnect = (lastDisconnect.error)?.output?.statusCode !== DisconnectReason.loggedOut;
            console.log('WhatsApp: Conexion cerrada, reconectando...', shouldReconnect);
            if (shouldReconnect) iniciarWhatsApp();
        } else if (connection === 'open') {
            console.log('WhatsApp: Conectado exitosamente y blindado. - LUCK XIT OFC');
        }
    });

    // SISTEMA .SHOP DESDE WHATSAPP
    waSock.ev.on('messages.upsert', async m => {
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
            let kbText = `[ TIENDA LUCK XIT OFC ]\n\nResponda con el NUMERO del producto que desea visualizar o comprar:\n\n`;
            let pList = [];
            let i = 1;
            
            pSnap.forEach(c => {
                const p = adaptarProductoLegacy(c.val());
                kbText += `*${i}.* [Producto] ${p.name}\n`;
                pList.push({ id: c.key, name: p.name, durations: p.durations });
                i++;
            });

            if(pList.length === 0) return enviarMensajeWA(numero, `[AVISO] La tienda se encuentra vacia en este momento.`);

            waUserStates[numero] = { step: 'SHOP_SELECT_PROD', pList };
            kbText += `\nEjemplo: Escriba 1 para seleccionar la primera opcion.`;
            return enviarMensajeWA(numero, kbText);
        }

        if (waUserStates[numero]) {
            const state = waUserStates[numero];
            
            if (state.step === 'SHOP_SELECT_PROD') {
                const idx = parseInt(t) - 1;
                if (isNaN(idx) || idx < 0 || idx >= state.pList.length) {
                    return enviarMensajeWA(numero, `[ERROR] Opcion invalida. Responda con un numero del 1 al ${state.pList.length}.`);
                }
                
                const prod = state.pList[idx];
                let dText = `[PAQUETE] *${prod.name}*\n\nSeleccione la duracion deseada respondiendo con su NUMERO:\n\n`;
                let dList = [];
                let dIdx = 1;
                
                Object.keys(prod.durations).forEach(dId => {
                    const dur = prod.durations[dId];
                    const stock = dur.keys ? Object.keys(dur.keys).length : 0;
                    if (stock > 0) {
                        dText += `*${dIdx}.* [Tiempo] ${dur.duration} - *$${dur.price} USD* (${stock} disponibles)\n`;
                        dList.push({ dId, ...dur });
                        dIdx++;
                    }
                });
                
                if (dList.length === 0) {
                    waUserStates[numero] = null;
                    return enviarMensajeWA(numero, `[AVISO] Todas las variantes de este producto estan agotadas.`);
                }
                
                waUserStates[numero] = { step: 'SHOP_SELECT_DUR', prodId: prod.id, dList, prodName: prod.name };
                return enviarMensajeWA(numero, dText);
            }

            if (state.step === 'SHOP_SELECT_DUR') {
                const idx = parseInt(t) - 1;
                if (isNaN(idx) || idx < 0 || idx >= state.dList.length) {
                    return enviarMensajeWA(numero, `[ERROR] Opcion invalida.`);
                }
                const dur = state.dList[idx];

                waUserStates[numero] = { step: 'SHOP_CONFIRM', prodId: state.prodId, durId: dur.dId, durInfo: dur, prodName: state.prodName };
                return enviarMensajeWA(numero, `[CONFIRMACION DE COMPRA]\n\n[Producto:] ${state.prodName} (${dur.duration})\n[Precio:] $${dur.price} USD\n[Saldo actual:] $${parseFloat(webUser.balance || 0).toFixed(2)} USD\n\nEscriba COMPRAR para proceder con la transaccion.\nEscriba CANCELAR para abortar.`);
            }

            if (state.step === 'SHOP_CONFIRM') {
                if (t === 'cancelar') {
                    waUserStates[numero] = null;
                    return enviarMensajeWA(numero, `[AVISO] Compra cancelada exitosamente.`);
                }
                if (t === 'comprar') {
                    const { prodId, durId, durInfo, prodName } = state;
                    const fPrice = durInfo.price;
                    let cB = parseFloat(webUser.balance||0);
                    
                    if (cB < fPrice) {
                         waUserStates[numero] = null;
                         return enviarMensajeWA(numero, `[ERROR] Saldo insuficiente.\n\nCuenta con $${cB.toFixed(2)} USD, pero el producto cuesta $${fPrice.toFixed(2)} USD.`);
                    }

                    const pSnapLive = await get(ref(db, `products/${prodId}`));
                    if(!pSnapLive.exists()) return enviarMensajeWA(numero, `[ERROR] El producto ya no existe en la base de datos.`);
                    
                    const prLive = pSnapLive.val();
                    let realDur = null;
                    if(durId === 'legacy_var' && prLive.keys) realDur = { keys: prLive.keys };
                    else if(prLive.durations && prLive.durations[durId]) realDur = prLive.durations[durId];

                    if (realDur && realDur.keys && Object.keys(realDur.keys).length > 0) {
                        const kId = Object.keys(realDur.keys)[0];
                        const kD = realDur.keys[kId];

                        let kP = `products/${prodId}/durations/${durId}/keys/${kId}`;
                        if (durId === 'legacy_var') kP = `products/${prodId}/keys/${kId}`;

                        const u = { [kP]: null, [`users/${webUid}/balance`]: cB - fPrice };
                        u[`users/${webUid}/history/${push(ref(db)).key}`] = { product: `${prodName} - ${durInfo.duration}`, key: kD, price: fPrice, date: Date.now(), refunded: false, warrantyHours: durInfo.warranty || 0 };

                        await update(ref(db), u);
                        enviarMensajeWA(numero, `[COMPRA EXITOSA]\n\n[Producto:] ${prodName}\n[Duracion:] ${durInfo.duration}\n\n[Su Key es:]\n${kD}\n\nGracias por su compra. - LUCK XIT OFC`);
                        waUserStates[numero] = null;
                    } else {
                        waUserStates[numero] = null;
                        enviarMensajeWA(numero, `[AVISO] El producto se agoto en este momento. Intente con otro o espere un restock.`);
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
        const { numero, mensaje, delayAfter } = waQueue.shift();
        
        if (waSock && waSock.authState.creds.registered) {
            try {
                const jid = `${numero}@s.whatsapp.net`;
                await waSock.sendPresenceUpdate('composing', jid);
                const typingMs = Math.min(Math.max(mensaje.length * 20, 1500), 4000);
                await new Promise(resolve => setTimeout(resolve, typingMs));
                
                await waSock.sendPresenceUpdate('paused', jid);
                await waSock.sendMessage(jid, { text: mensaje });
            } catch (error) {
                console.error('Error enviando mensaje WA a', numero, error.message);
            }
        }

        if (waQueue.length > 0) {
            await new Promise(resolve => setTimeout(resolve, delayAfter));
        }
    }
    isProcessingWaQueue = false;
}

function enviarMensajeWA(numero, mensaje, isMasivo = false) {
    const delay = isMasivo ? 60000 : 3000;
    waQueue.push({ numero, mensaje, delayAfter: delay });
    processWaQueue();
}

function adaptarProductoLegacy(p) {
    if (p && !p.durations && p.price !== undefined) {
        p.durations = {
            'legacy_var': {
                duration: p.duration || 'Unica / Estandar',
                price: p.price,
                warranty: p.warranty || 0,
                keys: p.keys || {}
            }
        };
        p.category = p.category || 'Android'; 
    }
    return p;
}

// ==========================================
// PANEL DE ADMINISTRACION TELEGRAM
// ==========================================

bot.onText(/\/start/, async (msg) => {
    const chatId = msg.chat.id;
    const tgId = msg.from.id;

    if (tgId !== SUPER_ADMIN_ID) return;

    userStates[chatId] = null; 

    const kb = {
        inline_keyboard: [
            [{ text: '[ Vincular WhatsApp por Telegram ]', callback_data: 'walinkadmin_menu' }]
        ]
    };

    bot.sendMessage(chatId, 'Panel de Control - LUCK XIT OFC\n\nSeleccione una accion:', { reply_markup: kb });
});

// Comandos de Aprobacion y Rechazo de Pagos
bot.onText(/\/config (.+)/, async (msg, match) => {
    if (msg.from.id !== SUPER_ADMIN_ID) return;
    const receiptId = match[1].trim();
    
    const snap = await get(ref(db, `pending_receipts/${receiptId}`));
    if (!snap.exists()) return bot.sendMessage(msg.chat.id, '[ERROR] Recarga no encontrada o ya fue procesada.');
    
    const data = snap.val();
    const uid = data.uid;
    const amountUsd = parseFloat(data.amountUsd);

    const uSnap = await get(ref(db, `users/${uid}`));
    let currentBal = 0; let waNum = null;
    if (uSnap.exists()) {
        currentBal = parseFloat(uSnap.val().balance || 0);
        waNum = uSnap.val().waNumber;
    }

    const updates = {};
    updates[`users/${uid}/balance`] = currentBal + amountUsd;
    updates[`users/${uid}/recharges/${receiptId}/status`] = 'approved';
    updates[`users/${uid}/recharges/${receiptId}/date`] = Date.now();
    updates[`pending_receipts/${receiptId}`] = null;
    
    await update(ref(db), updates);
    bot.sendMessage(msg.chat.id, `[EXITO] Recarga de $${amountUsd} USD aprobada para el usuario ${data.username}.`);
    
    if (waNum) {
        enviarMensajeWA(waNum, `[ RECARGA APROBADA ]\n\nSu pago ha sido validado exitosamente. Se han añadido $${amountUsd.toFixed(2)} USD a su saldo.`);
    }
});

bot.onText(/\/rech (.+)/, async (msg, match) => {
    if (msg.from.id !== SUPER_ADMIN_ID) return;
    const receiptId = match[1].trim();
    
    const snap = await get(ref(db, `pending_receipts/${receiptId}`));
    if (!snap.exists()) return bot.sendMessage(msg.chat.id, '[ERROR] Recarga no encontrada o ya fue procesada.');
    
    const data = snap.val();
    const uid = data.uid;

    const uSnap = await get(ref(db, `users/${uid}`));
    let waNum = null;
    if (uSnap.exists()) {
        waNum = uSnap.val().waNumber;
    }

    const updates = {};
    updates[`users/${uid}/recharges/${receiptId}/status`] = 'rejected';
    updates[`users/${uid}/recharges/${receiptId}/date`] = Date.now();
    updates[`pending_receipts/${receiptId}`] = null;
    
    await update(ref(db), updates);
    bot.sendMessage(msg.chat.id, `[AVISO] Recarga rechazada para el usuario ${data.username}.`);
    
    if (waNum) {
        enviarMensajeWA(waNum, `[ RECARGA RECHAZADA ]\n\nSu comprobante fue rechazado por el administrador. Contacte a soporte si cree que hubo un error.`);
    }
});

bot.on('callback_query', async (query) => {
    const chatId = query.message.chat.id;
    const tgId = query.from.id;
    const data = query.data;

    bot.answerCallbackQuery(query.id);

    if (tgId !== SUPER_ADMIN_ID) return;

    if (data === 'walinkadmin_menu') {
        const kb = {
            inline_keyboard: [
                [{text: 'Colombia (+57)', callback_data: 'walinkadmin|57'}, {text: 'Mexico (+52)', callback_data: 'walinkadmin|52'}],
                [{text: 'Otro Pais (Escribir codigo)', callback_data: 'walinkadmin|otro'}]
            ]
        };
        return bot.editMessageText('VINCULAR BOT A WHATSAPP\n\nSeleccione el pais del numero destino que alojara el bot:', {chat_id: chatId, message_id: query.message.message_id, reply_markup: kb});
    }

    if (data.startsWith('walinkadmin|')) {
        const codPais = data.split('|')[1];
        if (codPais === 'otro') {
            userStates[chatId] = { step: 'ADMIN_WA_CUSTOM_COUNTRY', data: {} };
            return bot.editMessageText('Escriba el Codigo de Pais del Bot (solo numeros):', {chat_id: chatId, message_id: query.message.message_id});
        } else {
            userStates[chatId] = { step: 'ADMIN_WA_NUMBER', data: { countryCode: codPais } };
            return bot.editMessageText(`Pais seleccionado (+${codPais}).\n\nEscriba el numero del Bot de WhatsApp (sin el codigo de pais):`, {chat_id: chatId, message_id: query.message.message_id});
        }
    }
});

bot.on('message', async (msg) => {
    if (msg.text && msg.text.startsWith('/start')) return;
    if (msg.text && (msg.text.startsWith('/config') || msg.text.startsWith('/rech'))) return;

    const chatId = msg.chat.id;
    const tgId = msg.from.id;
    const text = msg.text || '';

    if (tgId !== SUPER_ADMIN_ID) return;
    if (!text) return;

    if (userStates[chatId]) {
        const state = userStates[chatId];

        if (state.step === 'ADMIN_WA_CUSTOM_COUNTRY') {
            const code = text.replace('+', '').trim();
            if (isNaN(code)) return bot.sendMessage(chatId, 'Error: Escriba solo numeros (Ej: 51)');
            state.data.countryCode = code;
            state.step = 'ADMIN_WA_NUMBER';
            return bot.sendMessage(chatId, `Codigo +${code} guardado.\n\nEscriba el numero que se convertira en el Bot de WhatsApp sin el codigo de pais:`);
        }

        if (state.step === 'ADMIN_WA_NUMBER') {
            const num = text.trim();
            if (isNaN(num)) return bot.sendMessage(chatId, 'Error: Escriba solo numeros.');
            const fullNumber = `${state.data.countryCode}${num}`;

            bot.sendMessage(chatId, `Solicitando Codigo a WhatsApp para el numero +${fullNumber}... Por favor espere.`);

            try {
                if (waSock && waSock.authState.creds.registered) {
                    userStates[chatId] = null;
                    return bot.sendMessage(chatId, 'El bot de WhatsApp ya se encuentra registrado y vinculado con un numero. Cierre sesion primero desde WhatsApp si desea cambiarlo.');
                }
                setTimeout(async () => {
                    try {
                        const code = await waSock.requestPairingCode(fullNumber);
                        bot.sendMessage(chatId, `Codigo de vinculacion para WhatsApp:\n\n\`${code}\`\n\nIngrese este codigo en "Dispositivos Vinculados" > "Vincular con el numero de telefono" en su WhatsApp destino.`, { parse_mode: 'Markdown' });
                    } catch(err) {
                        bot.sendMessage(chatId, 'Error al solicitar codigo: ' + err.message);
                    }
                }, 3000);
            } catch (error) {
                bot.sendMessage(chatId, 'Error al solicitar codigo: ' + error.message);
            }
            userStates[chatId] = null;
            return;
        }
    }
});

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));

console.log('Terminal de LUCK XIT OFC En linea y a la espera de peticiones...');
