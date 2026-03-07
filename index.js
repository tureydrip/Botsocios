const TelegramBot = require('node-telegram-bot-api');
const { initializeApp } = require('firebase/app');
const { getDatabase, ref, get, update, push, set } = require('firebase/database');
const express = require('express');

// --- 1. MINI SERVIDOR PARA RAILWAY (Evita el Crash) ---
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

// --- 3. TECLADOS DE ABAJO (REPLY KEYBOARDS) ---
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
    const authSnap = await get(ref(db, `telegram_auth/${telegramId}`));
    return authSnap.exists() ? authSnap.val() : null;
}

// --- 4. COMANDO INICIAL ---
bot.onText(/\/start/, async (msg) => {
    const chatId = msg.chat.id;
    const tgId = msg.from.id;
    userStates[chatId] = null; 

    const webUid = await getAuthUser(tgId);

    if (!webUid) {
        return bot.sendMessage(chatId, `🛑 *ACCESO DENEGADO*\n\nTu ID \`${tgId}\` no está autorizado.\n\nVe a la web, sección "Autorizar Telegram", pega tu ID y vuelve a pulsar /start.`, { parse_mode: 'Markdown' });
    }

    const userSnap = await get(ref(db, `users/${webUid}`));
    const webUser = userSnap.val();
    const keyboard = (tgId === ADMIN_ID) ? adminKeyboard : userKeyboard;

    bot.sendMessage(chatId, `🌌 *LUCK XIT GALAXY*\n\nBienvenido, *${webUser.username}*.\nSincronización web activa 🟢`, { parse_mode: 'Markdown', ...keyboard });
});

// --- 5. LÓGICA DE MENSAJES ---
bot.on('message', async (msg) => {
    if (!msg.text || msg.text === '/start') return;

    const chatId = msg.chat.id;
    const tgId = msg.from.id;
    const text = msg.text;

    const webUid = await getAuthUser(tgId);
    if (!webUid) return;

    // BOTÓN: CANCELAR
    if (text === '❌ Cancelar Acción') {
        userStates[chatId] = null;
        return bot.sendMessage(chatId, '✅ Acción cancelada.', (tgId === ADMIN_ID ? adminKeyboard : userKeyboard));
    }

    // --- PROCESOS DE ESTADO (Para no usar comandos escritos) ---
    if (userStates[chatId]) {
        const state = userStates[chatId];

        // ADMIN: Proceso de Saldo
        if (state.step === 'WAIT_USER_BALANCE') {
            state.user = text.trim();
            state.step = 'WAIT_AMOUNT_BALANCE';
            return bot.sendMessage(chatId, `Perfecto. ¿Cuánto saldo le añado a *${state.user}*? (Ej: 5.00)`, {parse_mode:'Markdown'});
        }
        if (state.step === 'WAIT_AMOUNT_BALANCE') {
            const amount = parseFloat(text);
            if (isNaN(amount)) return bot.sendMessage(chatId, '❌ Número inválido.');
            
            const usersSnap = await get(ref(db, 'users'));
            let foundUid = null; let currentBal = 0;
            usersSnap.forEach(u => { if(u.val().username === state.user) { foundUid = u.key; currentBal = parseFloat(u.val().balance || 0); }});

            if (foundUid) {
                const updates = {};
                updates[`users/${foundUid}/balance`] = currentBal + amount;
                const rechRef = push(ref(db, `users/${foundUid}/recharges`));
                updates[`users/${foundUid}/recharges/${rechRef.key}`] = { amount: amount, date: Date.now() };
                await update(ref(db), updates);
                bot.sendMessage(chatId, `✅ $${amount} añadidos a ${state.user}.`, adminKeyboard);
            } else {
                bot.sendMessage(chatId, '❌ Usuario no encontrado.', adminKeyboard);
            }
            userStates[chatId] = null; return;
        }

        // ADMIN: Proceso de Stock
        if (state.step === 'WAIT_KEYS') {
            const cleanKeys = text.split(/[\n,\s]+/).map(k => k.trim()).filter(k => k.length > 0);
            const updates = {};
            cleanKeys.forEach(k => {
                const newId = push(ref(db, `products/${state.prodId}/keys`)).key;
                updates[`products/${state.prodId}/keys/${newId}`] = k;
            });
            await update(ref(db), updates);
            bot.sendMessage(chatId, `✅ Se agregaron ${cleanKeys.length} keys.`, adminKeyboard);
            userStates[chatId] = null; return;
        }
        
        // ADMIN: Crear Producto
        if (state.step === 'WAIT_PROD_NAME') {
            state.name = text; state.step = 'WAIT_PROD_PRICE';
            return bot.sendMessage(chatId, 'Dime el precio (Ej: 1.50):');
        }
        if (state.step === 'WAIT_PROD_PRICE') {
            state.price = parseFloat(text); state.step = 'WAIT_PROD_DUR';
            return bot.sendMessage(chatId, 'Dime la duración (Ej: 24 Horas):');
        }
        if (state.step === 'WAIT_PROD_DUR') {
            const newRef = push(ref(db, 'products'));
            await set(newRef, { name: state.name, price: state.price, duration: text });
            bot.sendMessage(chatId, `✅ Producto ${state.name} creado.`, adminKeyboard);
            userStates[chatId] = null; return;
        }
    }

    // --- BOTONES DEL TECLADO ---
    switch (text) {
        case '👤 Mi Perfil':
            const uSnap = await get(ref(db, `users/${webUid}`));
            bot.sendMessage(chatId, `👤 *USUARIO:* ${uSnap.val().username}\n💰 *SALDO:* $${uSnap.val().balance.toFixed(2)}`, {parse_mode:'Markdown'});
            break;

        case '💳 Recargas':
            bot.sendMessage(chatId, `💳 *MÉTODO NEQUI*\n\nNúmero: \`3214701288\`\n\nEnvía el pago y repórtalo aquí:`, {
                parse_mode: 'Markdown',
                reply_markup: { inline_keyboard: [[{ text: '💬 Reportar Pago', url: 'https://wa.me/573142369516' }]] }
            });
            break;

        case '🛒 Tienda':
            const pSnap = await get(ref(db, 'products'));
            let btns = [];
            pSnap.forEach(p => {
                const stock = p.val().keys ? Object.keys(p.val().keys).length : 0;
                if(stock > 0) btns.push([{ text: `${p.val().name} - $${p.val().price} (${stock} disp)`, callback_data: `buy_${p.key}` }]);
            });
            bot.sendMessage(chatId, '🛒 *TIENDA LUCK XIT*', {parse_mode:'Markdown', reply_markup: { inline_keyboard: btns }});
            break;

        // BOTONES EXCLUSIVOS ADMIN
        case '💰 Añadir Saldo':
            if(tgId !== ADMIN_ID) return;
            userStates[chatId] = { step: 'WAIT_USER_BALANCE' };
            bot.sendMessage(chatId, '👤 Escribe el nombre del usuario:');
            break;

        case '🔑 Añadir Stock':
            if(tgId !== ADMIN_ID) return;
            const prods = await get(ref(db, 'products'));
            let sBtns = [];
            prods.forEach(p => sBtns.push([{ text: `+ Stock a: ${p.val().name}`, callback_data: `stock_${p.key}` }]));
            bot.sendMessage(chatId, 'Selecciona el producto:', { reply_markup: { inline_keyboard: sBtns } });
            break;

        case '📦 Crear Producto':
            if(tgId !== ADMIN_ID) return;
            userStates[chatId] = { step: 'WAIT_PROD_NAME' };
            bot.sendMessage(chatId, 'Nombre del nuevo producto:');
            break;
    }
});

// --- 6. BOTONES INLINE (Compras y Selección Stock) ---
bot.on('callback_query', async (q) => {
    const chatId = q.message.chat.id;
    const data = q.data;
    const tgId = q.from.id;
    bot.answerCallbackQuery(q.id);

    const webUid = await getAuthUser(tgId);
    if(!webUid) return;

    if (data.startsWith('buy_')) {
        const pId = data.split('_')[1];
        const uSnap = await get(ref(db, `users/${webUid}`));
        const pSnap = await get(ref(db, `products/${pId}`));
        const user = uSnap.val(); const prod = pSnap.val();

        if (user.balance < prod.price) return bot.sendMessage(chatId, '❌ Saldo insuficiente.');

        if (prod.keys) {
            const kId = Object.keys(prod.keys)[0];
            const key = prod.keys[kId];
            const updates = {};
            updates[`products/${pId}/keys/${kId}`] = null;
            updates[`users/${webUid}/balance`] = user.balance - prod.price;
            const hRef = push(ref(db, `users/${webUid}/history`));
            updates[`users/${webUid}/history/${hRef.key}`] = { product: prod.name, key: key, price: prod.price, date: Date.now() };
            await update(ref(db), updates);
            bot.sendMessage(chatId, `✅ *COMPRA EXITOSA*\n\n🔑 Key: \`${key}\``, {parse_mode:'Markdown'});
        }
    }

    if (data.startsWith('stock_') && tgId === ADMIN_ID) {
        userStates[chatId] = { step: 'WAIT_KEYS', prodId: data.split('_')[1] };
        bot.sendMessage(chatId, 'Pega las keys (pueden ser varias separadas por comas o enter):');
    }
});
