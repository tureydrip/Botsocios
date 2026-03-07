const TelegramBot = require('node-telegram-bot-api');
const { initializeApp } = require('firebase/app');
const { getDatabase, ref, get, update, push, set } = require('firebase/database');
const express = require('express');

// --- 0. ANTICRASH GLOBAL PARA RAILWAY ---
// Esto evita que el bot se apague completamente si hay un error silencioso
process.on('uncaughtException', (err) => console.error('❌ Excepción no capturada:', err));
process.on('unhandledRejection', (reason, p) => console.error('❌ Promesa rechazada no manejada:', reason));

// --- 1. MINI SERVIDOR PARA RAILWAY ---
const appExpress = express();
const PORT = process.env.PORT || 3000;
appExpress.get('/', (req, res) => res.send('LUCK XIT GALAXY BOT ONLINE 🚀'));
appExpress.listen(PORT, () => console.log(`Servidor en puerto ${PORT}`));

// --- 2. CONFIGURACIÓN ---
const token = '8275295427:AAFc-U21od7ZWdtQU-62U1mJOSJqFYFZ-IQ';
const bot = new TelegramBot(token, { polling: true });
const ADMIN_ID = 7710633235; 

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

// Memoria temporal para procesos (Admin/Usuario)
const userStates = {}; 

// --- 3. TECLADOS ---
const userKeyboard = {
    reply_markup: {
        keyboard: [
            [{ text: '🛒 Tienda' }, { text: '👤 Mi Perfil' }],
            [{ text: '💳 Recargas' }]
        ],
        resize_keyboard: true, is_persistent: true
    }
};

const adminKeyboard = {
    reply_markup: {
        keyboard: [
            [{ text: '🛒 Tienda' }, { text: '👤 Mi Perfil' }],
            [{ text: '📦 Crear Producto' }, { text: '🔑 Añadir Stock' }],
            [{ text: '💰 Añadir Saldo' }, { text: '❌ Cancelar Acción' }]
        ],
        resize_keyboard: true, is_persistent: true
    }
};

// Función para verificar si el ID de Telegram está autorizado en la Web
async function getAuthUser(telegramId) {
    try {
        const authSnap = await get(ref(db, `telegram_auth/${telegramId}`));
        return authSnap.exists() ? authSnap.val() : null;
    } catch (error) {
        console.error('Error en Firebase (getAuthUser):', error);
        return null;
    }
}

// --- 4. COMANDO INICIAL ---
bot.onText(/\/start/, async (msg) => {
    const chatId = msg.chat.id;
    const tgId = msg.from.id;
    delete userStates[chatId]; // Mejor que = null para evitar fugas de memoria

    try {
        const webUid = await getAuthUser(tgId);

        if (!webUid) {
            return bot.sendMessage(chatId, `🛑 *ACCESO DENEGADO*\n\nTu ID \`${tgId}\` no está autorizado.\n\nVe a la web, sección "Autorizar Telegram", pega tu ID y vuelve a pulsar /start.`, { parse_mode: 'Markdown' }).catch(()=>{});
        }

        const userSnap = await get(ref(db, `users/${webUid}`));
        const webUser = userSnap.val() || { username: 'Usuario' };
        const keyboard = (tgId === ADMIN_ID) ? adminKeyboard : userKeyboard;

        bot.sendMessage(chatId, `🌌 *LUCK XIT GALAXY*\n\nBienvenido, *${webUser.username}*.\nSincronización web activa 🟢`, { parse_mode: 'Markdown', ...keyboard }).catch(()=>{});
    } catch (error) {
        console.error("Error en /start:", error);
    }
});

// --- 5. LÓGICA DE MENSAJES ---
bot.on('message', async (msg) => {
    if (!msg.text || msg.text === '/start') return;

    const chatId = msg.chat.id;
    const tgId = msg.from.id;
    const text = msg.text;

    try {
        const webUid = await getAuthUser(tgId);
        if (!webUid) return;

        // BOTÓN: CANCELAR
        if (text === '❌ Cancelar Acción') {
            delete userStates[chatId];
            return bot.sendMessage(chatId, '✅ Acción cancelada.', (tgId === ADMIN_ID ? adminKeyboard : userKeyboard)).catch(()=>{});
        }

        // --- PROCESOS DE ESTADO ---
        if (userStates[chatId]) {
            const state = userStates[chatId];
            const currentState = { ...state }; // Clonamos el estado para evitar bugs
            
            // ADMIN: Proceso de Saldo
            if (currentState.step === 'WAIT_USER_BALANCE') {
                userStates[chatId].user = text.trim();
                userStates[chatId].step = 'WAIT_AMOUNT_BALANCE';
                return bot.sendMessage(chatId, `Perfecto. ¿Cuánto saldo le añado a *${userStates[chatId].user}*? (Ej: 5.00)`, {parse_mode:'Markdown'}).catch(()=>{});
            }
            if (currentState.step === 'WAIT_AMOUNT_BALANCE') {
                const amount = parseFloat(text);
                if (isNaN(amount)) return bot.sendMessage(chatId, '❌ Número inválido.').catch(()=>{});
                
                const usersSnap = await get(ref(db, 'users'));
                let foundUid = null; let currentBal = 0;
                usersSnap.forEach(u => { if(u.val().username === currentState.user) { foundUid = u.key; currentBal = parseFloat(u.val().balance || 0); }});

                if (foundUid) {
                    const updates = {};
                    updates[`users/${foundUid}/balance`] = currentBal + amount;
                    const rechRef = push(ref(db, `users/${foundUid}/recharges`));
                    updates[`users/${foundUid}/recharges/${rechRef.key}`] = { amount: amount, date: Date.now() };
                    await update(ref(db), updates);
                    bot.sendMessage(chatId, `✅ $${amount} añadidos a ${currentState.user}.`, adminKeyboard).catch(()=>{});
                } else {
                    bot.sendMessage(chatId, '❌ Usuario no encontrado.', adminKeyboard).catch(()=>{});
                }
                delete userStates[chatId]; return;
            }

            // ADMIN: Proceso de Stock
            if (currentState.step === 'WAIT_KEYS') {
                const cleanKeys = text.split(/[\n,\s]+/).map(k => k.trim()).filter(k => k.length > 0);
                const updates = {};
                cleanKeys.forEach(k => {
                    const newId = push(ref(db, `products/${currentState.prodId}/keys`)).key;
                    updates[`products/${currentState.prodId}/keys/${newId}`] = k;
                });
                await update(ref(db), updates);
                bot.sendMessage(chatId, `✅ Se agregaron ${cleanKeys.length} keys.`, adminKeyboard).catch(()=>{});
                delete userStates[chatId]; return;
            }
            
            // ADMIN: Crear Producto
            if (currentState.step === 'WAIT_PROD_NAME') {
                userStates[chatId].name = text; 
                userStates[chatId].step = 'WAIT_PROD_PRICE';
                return bot.sendMessage(chatId, 'Dime el precio (Ej: 1.50):').catch(()=>{});
            }
            if (currentState.step === 'WAIT_PROD_PRICE') {
                userStates[chatId].price = parseFloat(text); 
                userStates[chatId].step = 'WAIT_PROD_DUR';
                return bot.sendMessage(chatId, 'Dime la duración (Ej: 24 Horas):').catch(()=>{});
            }
            if (currentState.step === 'WAIT_PROD_DUR') {
                const newRef = push(ref(db, 'products'));
                await set(newRef, { name: currentState.name, price: currentState.price, duration: text });
                bot.sendMessage(chatId, `✅ Producto ${currentState.name} creado.`, adminKeyboard).catch(()=>{});
                delete userStates[chatId]; return;
            }
        }

        // --- BOTONES DEL TECLADO ---
        switch (text) {
            case '👤 Mi Perfil':
                const uSnap = await get(ref(db, `users/${webUid}`));
                if(uSnap.exists()){
                    const uData = uSnap.val();
                    bot.sendMessage(chatId, `👤 *USUARIO:* ${uData.username || 'N/A'}\n💰 *SALDO:* $${parseFloat(uData.balance || 0).toFixed(2)}`, {parse_mode:'Markdown'}).catch(()=>{});
                }
                break;

            case '💳 Recargas':
                bot.sendMessage(chatId, `💳 *MÉTODO NEQUI*\n\nNúmero: \`3214701288\`\n\nEnvía el pago y repórtalo aquí:`, {
                    parse_mode: 'Markdown',
                    reply_markup: { inline_keyboard: [[{ text: '💬 Reportar Pago', url: 'https://wa.me/573142369516' }]] }
                }).catch(()=>{});
                break;

            case '🛒 Tienda':
                const pSnap = await get(ref(db, 'products'));
                let btns = [];
                if (pSnap.exists()) {
                    pSnap.forEach(p => {
                        const stock = p.val().keys ? Object.keys(p.val().keys).length : 0;
                        if(stock > 0) btns.push([{ text: `${p.val().name} - $${p.val().price} (${stock} disp)`, callback_data: `buy_${p.key}` }]);
                    });
                }
                bot.sendMessage(chatId, btns.length > 0 ? '🛒 *TIENDA LUCK XIT*' : '❌ No hay productos disponibles ahora mismo.', {parse_mode:'Markdown', reply_markup: { inline_keyboard: btns }}).catch(()=>{});
                break;

            // BOTONES EXCLUSIVOS ADMIN
            case '💰 Añadir Saldo':
                if(tgId !== ADMIN_ID) return;
                userStates[chatId] = { step: 'WAIT_USER_BALANCE' };
                bot.sendMessage(chatId, '👤 Escribe el nombre del usuario:').catch(()=>{});
                break;

            case '🔑 Añadir Stock':
                if(tgId !== ADMIN_ID) return;
                const prods = await get(ref(db, 'products'));
                let sBtns = [];
                if(prods.exists()){
                    prods.forEach(p => sBtns.push([{ text: `+ Stock a: ${p.val().name}`, callback_data: `stock_${p.key}` }]));
                }
                bot.sendMessage(chatId, 'Selecciona el producto:', { reply_markup: { inline_keyboard: sBtns } }).catch(()=>{});
                break;

            case '📦 Crear Producto':
                if(tgId !== ADMIN_ID) return;
                userStates[chatId] = { step: 'WAIT_PROD_NAME' };
                bot.sendMessage(chatId, 'Nombre del nuevo producto:').catch(()=>{});
                break;
        }
    } catch (error) {
        console.error("Error en el procesador de mensajes:", error);
    }
});

// --- 6. BOTONES INLINE (Compras y Selección Stock) ---
bot.on('callback_query', async (q) => {
    const chatId = q.message.chat.id;
    const data = q.data;
    const tgId = q.from.id;
    
    // El catch aquí es vital si el botón caduca o Telegram da timeout
    bot.answerCallbackQuery(q.id).catch(()=>{});

    try {
        const webUid = await getAuthUser(tgId);
        if(!webUid) return;

        if (data.startsWith('buy_')) {
            const pId = data.split('_')[1];
            const [uSnap, pSnap] = await Promise.all([
                get(ref(db, `users/${webUid}`)),
                get(ref(db, `products/${pId}`))
            ]);
            
            const user = uSnap.val(); 
            const prod = pSnap.val();

            if (!user || !prod) return bot.sendMessage(chatId, '❌ Error al cargar datos.').catch(()=>{});
            if ((user.balance || 0) < prod.price) return bot.sendMessage(chatId, '❌ Saldo insuficiente.').catch(()=>{});

            if (prod.keys && Object.keys(prod.keys).length > 0) {
                const kId = Object.keys(prod.keys)[0];
                const key = prod.keys[kId];
                const updates = {};
                updates[`products/${pId}/keys/${kId}`] = null;
                updates[`users/${webUid}/balance`] = user.balance - prod.price;
                const hRef = push(ref(db, `users/${webUid}/history`));
                updates[`users/${webUid}/history/${hRef.key}`] = { product: prod.name, key: key, price: prod.price, date: Date.now() };
                
                await update(ref(db), updates);
                bot.sendMessage(chatId, `✅ *COMPRA EXITOSA*\n\n🔑 Key: \`${key}\``, {parse_mode:'Markdown'}).catch(()=>{});
            } else {
                bot.sendMessage(chatId, '❌ Producto sin stock.').catch(()=>{});
            }
        }

        if (data.startsWith('stock_') && tgId === ADMIN_ID) {
            userStates[chatId] = { step: 'WAIT_KEYS', prodId: data.split('_')[1] };
            bot.sendMessage(chatId, 'Pega las keys (pueden ser varias separadas por comas o enter):').catch(()=>{});
        }
    } catch (error) {
        console.error("Error en callback_query:", error);
        bot.sendMessage(chatId, "⚠️ Hubo un error al procesar tu solicitud.").catch(()=>{});
    }
});
