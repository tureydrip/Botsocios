const TelegramBot = require('node-telegram-bot-api');
const { initializeApp } = require('firebase/app');
const { getDatabase, ref, get, update, push, set } = require('firebase/database');

// CONFIGURACIÓN
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

// SISTEMA DE ESTADOS 
const userStates = {}; 

// TECLADOS PRINCIPALES
const userKeyboard = {
    reply_markup: {
        keyboard: [
            [{ text: '🛒 Tienda' }, { text: '👤 Mi Perfil' }],
            [{ text: '💳 Recargas' }]
        ],
        resize_keyboard: true,
        is_persistent: true
    }
};

const adminKeyboard = {
    reply_markup: {
        keyboard: [
            [{ text: '📦 Crear Producto' }, { text: '🔑 Añadir Stock' }],
            [{ text: '💰 Añadir Saldo' }, { text: '📢 Mensaje Global' }],
            [{ text: '❌ Cancelar Acción' }]
        ],
        resize_keyboard: true,
        is_persistent: true
    }
};

// MIDDLEWARE: Verifica si el usuario está autorizado en la web
async function getAuthUser(telegramId) {
    const authSnap = await get(ref(db, `telegram_auth/${telegramId}`));
    if (authSnap.exists()) return authSnap.val();
    return null;
}

// 1. INICIO OBLIGATORIO DE TELEGRAM
bot.onText(/\/start/, async (msg) => {
    const chatId = msg.chat.id;
    const tgId = msg.from.id;
    userStates[chatId] = null; 

    const webUid = await getAuthUser(tgId);

    if (!webUid) {
        const textoBloqueo = `🛑 *ACCESO DENEGADO*\n\nTu dispositivo no está vinculado a una cuenta web.\n\n🔑 *TU ID DE TELEGRAM ES:* \`${tgId}\`\n\nVe a la web, vincula tu cuenta y vuelve a escribir /start.`;
        return bot.sendMessage(chatId, textoBloqueo, { parse_mode: 'Markdown' });
    }

    const userSnap = await get(ref(db, `users/${webUid}`));
    const webUser = userSnap.val();
    const keyboard = (tgId === ADMIN_ID) ? adminKeyboard : userKeyboard;
    const greeting = (tgId === ADMIN_ID) ? `👑 ¡Bienvenido Admin Supremo, *${webUser.username}*!` : `🌌 Bienvenido a LUCK XIT, *${webUser.username}*.`;

    bot.sendMessage(chatId, `${greeting}\nUsa los botones de abajo para navegar.`, { parse_mode: 'Markdown', ...keyboard });
});

// 2. MANEJADOR DE MENSAJES (Texto y Fotos)
bot.on('message', async (msg) => {
    if (msg.text === '/start') return;
    if (!msg.text && !msg.photo) return; // Solo permitir textos y fotos

    const chatId = msg.chat.id;
    const tgId = msg.from.id;
    const text = msg.text || msg.caption || ''; 

    const webUid = await getAuthUser(tgId);
    if (!webUid) return bot.sendMessage(chatId, `🛑 Acceso denegado. Escribe /start para verificar.`);
    
    const keyboard = (tgId === ADMIN_ID) ? adminKeyboard : userKeyboard;

    // --- CANCELAR CUALQUIER ACCIÓN EN CURSO ---
    if (text === '❌ Cancelar Acción') {
        userStates[chatId] = null;
        return bot.sendMessage(chatId, '✅ Acción cancelada. ¿Qué deseas hacer ahora?', adminKeyboard);
    }

    // --- MANEJO DE ENVÍO DE COMPROBANTES (FOTOS) ---
    if (msg.photo && userStates[chatId] && userStates[chatId].step === 'WAITING_FOR_RECEIPT') {
        const username = userStates[chatId].data.username;
        const fileId = msg.photo[msg.photo.length - 1].file_id; // Foto con mejor resolución
        
        bot.sendPhoto(ADMIN_ID, fileId, {
            caption: `💳 *NUEVO COMPROBANTE DE PAGO*\n\n👤 Usuario: ${username}\n🆔 ID Telegram: \`${tgId}\``,
            parse_mode: 'Markdown'
        });
        
        userStates[chatId] = null; // Limpiar estado
        return bot.sendMessage(chatId, '✅ Comprobante enviado exitosamente al administrador. Por favor espera a que se acredite tu saldo.', keyboard);
    }

    // Si enviaron una foto pero no estaban en proceso de comprobante, se ignora
    if (!msg.text) return; 

    // --- FLUJOS DE ESTADO ---
    if (userStates[chatId]) {
        const state = userStates[chatId];

        // FLUJO: USUARIO ESCRIBE CUÁNTO QUIERE RECARGAR
        if (state.step === 'WAITING_FOR_RECHARGE_AMOUNT') {
            // Intentar convertir el texto a número reemplazando comas por puntos por si acaso
            const amountUsd = parseFloat(text.replace(',', '.').replace('$', ''));
            const minUsd = state.data.minUsd;

            if (isNaN(amountUsd)) {
                return bot.sendMessage(chatId, '❌ Cantidad inválida. Por favor, escribe **solo el número** (ej: 3 o 5.5).', { parse_mode: 'Markdown' });
            }

            if (amountUsd < minUsd) {
                return bot.sendMessage(chatId, `❌ El monto mínimo para ti es de *$${minUsd} USD*. Intenta con una cantidad mayor.`, { parse_mode: 'Markdown' });
            }

            const exchangeRate = 3800;
            const amountCop = amountUsd * exchangeRate;

            const mensajePago = `✅ *MONTO CALCULADO CON ÉXITO*\n\n` +
                                `💰 Vas a recargar: *$${amountUsd.toFixed(2)} USD*\n` +
                                `💵 Total a pagar: *$${amountCop.toLocaleString('es-CO')} COP*\n\n` +
                                `🏦 *PASOS PARA PAGAR Y RECARGAR:*\n` +
                                `1. Envía exactamente *$${amountCop.toLocaleString('es-CO')} COP* a Nequi: \`3214701288\`\n` +
                                `2. Selecciona por dónde quieres enviar tu comprobante abajo:`;

            const rechargeInline = { 
                inline_keyboard: [
                    [{ text: '💬 Enviar por WhatsApp', url: 'https://wa.me/573142369516' }],
                    [{ text: '📸 Enviar por Aquí (Telegram)', callback_data: 'send_receipt' }]
                ] 
            };

            userStates[chatId] = null; // Terminamos esta etapa
            return bot.sendMessage(chatId, mensajePago, { parse_mode: 'Markdown', reply_markup: rechargeInline });
        }

        // FLUJO: MENSAJE GLOBAL (ADMIN)
        if (state.step === 'WAITING_FOR_BROADCAST_MESSAGE') {
            bot.sendMessage(chatId, '⏳ Enviando mensaje a todos los usuarios...');
            const telegramAuthSnap = await get(ref(db, 'telegram_auth'));
            let count = 0;
            
            if (telegramAuthSnap.exists()) {
                telegramAuthSnap.forEach(child => {
                    const targetTgId = child.key;
                    bot.sendMessage(targetTgId, `📢 *Anuncio Oficial LUCK XIT*\n\n${text}`, { parse_mode: 'Markdown' }).catch(() => {});
                    count++;
                });
            }
            
            bot.sendMessage(chatId, `✅ Mensaje enviado exitosamente a ${count} usuarios.`, adminKeyboard);
            userStates[chatId] = null;
            return;
        }

        // FLUJO: AÑADIR SALDO (ADMIN)
        if (state.step === 'ADD_BALANCE_USER') {
            state.data.targetUser = text.trim();
            state.step = 'ADD_BALANCE_AMOUNT';
            return bot.sendMessage(chatId, `Dime la **cantidad** en USD a añadir para ${state.data.targetUser}:`, { parse_mode: 'Markdown' });
        }
        if (state.step === 'ADD_BALANCE_AMOUNT') {
            const amount = parseFloat(text);
            if (isNaN(amount)) return bot.sendMessage(chatId, '❌ Cantidad inválida. Intenta con un número (ej: 5.50).');
            
            bot.sendMessage(chatId, '⚙️ Buscando usuario...');
            const usersSnap = await get(ref(db, 'users'));
            let foundUid = null; let currentBal = 0;

            usersSnap.forEach(child => {
                if (child.val().username === state.data.targetUser) { 
                    foundUid = child.key; 
                    currentBal = parseFloat(child.val().balance || 0); 
                }
            });

            if (foundUid) {
                const updates = {};
                const nuevoSaldo = currentBal + amount;
                updates[`users/${foundUid}/balance`] = nuevoSaldo;
                const rechRef = push(ref(db, `users/${foundUid}/recharges`));
                updates[`users/${foundUid}/recharges/${rechRef.key}`] = { amount: amount, date: Date.now() };
                
                await update(ref(db), updates);
                
                bot.sendMessage(chatId, `✅ Saldo añadido a ${state.data.targetUser}. Nuevo saldo: $${nuevoSaldo.toFixed(2)}`, adminKeyboard);

                const telegramAuthSnap = await get(ref(db, 'telegram_auth'));
                let targetTgId = null;
                
                if (telegramAuthSnap.exists()) {
                    telegramAuthSnap.forEach(child => {
                        if (child.val() === foundUid) targetTgId = child.key;
                    });
                }

                if (targetTgId) {
                    bot.sendMessage(targetTgId, `tu papá luck xit te puso : ${amount} de saldo nuevo saldo:${nuevoSaldo.toFixed(2)}`);
                }

            } else {
                bot.sendMessage(chatId, `❌ Usuario no encontrado.`, adminKeyboard);
            }
            userStates[chatId] = null; 
            return;
        }

        // FLUJO: CREAR PRODUCTO (ADMIN)
        if (state.step === 'CREATE_PROD_NAME') {
            state.data.name = text;
            state.step = 'CREATE_PROD_PRICE';
            return bot.sendMessage(chatId, 'Ingresa el **precio** en USD (ej: 2.5):', { parse_mode: 'Markdown' });
        }
        if (state.step === 'CREATE_PROD_PRICE') {
            const price = parseFloat(text);
            if (isNaN(price)) return bot.sendMessage(chatId, '❌ Precio inválido. Usa números.');
            state.data.price = price;
            state.step = 'CREATE_PROD_DURATION';
            return bot.sendMessage(chatId, 'Ingresa la **duración** (ej: 24 horas):', { parse_mode: 'Markdown' });
        }
        if (state.step === 'CREATE_PROD_DURATION') {
            const newProdRef = push(ref(db, 'products'));
            await set(newProdRef, { name: state.data.name, price: state.data.price, duration: text });
            bot.sendMessage(chatId, `✅ Producto *${state.data.name}* creado exitosamente.`, { parse_mode: 'Markdown', ...adminKeyboard });
            userStates[chatId] = null;
            return;
        }

        // FLUJO: AÑADIR STOCK (KEYS) (ADMIN)
        if (state.step === 'ADD_STOCK_KEYS') {
            const keysRaw = text;
            const cleanKeys = keysRaw.split(/[\n,\s]+/).map(k => k.trim()).filter(k => k.length > 0);
            
            if (cleanKeys.length === 0) {
                userStates[chatId] = null;
                return bot.sendMessage(chatId, '❌ No se detectaron keys válidas. Operación cancelada.');
            }

            const updates = {};
            cleanKeys.forEach(k => {
                const newId = push(ref(db, `products/${state.data.prodId}/keys`)).key;
                updates[`products/${state.data.prodId}/keys/${newId}`] = k;
            });

            await update(ref(db), updates);
            bot.sendMessage(chatId, `✅ ¡Listo! Se agregaron ${cleanKeys.length} keys al producto.`, adminKeyboard);
            userStates[chatId] = null;
            return;
        }
    }

    // --- ACCIONES DE LOS BOTONES DE ABAJO (MENÚ PRINCIPAL) ---
    if (text === '👤 Mi Perfil') {
        const userSnap = await get(ref(db, `users/${webUid}`));
        const user = userSnap.val();
        return bot.sendMessage(chatId, `👤 *PERFIL LUCK XIT*\n\nUsuario: ${user.username}\n💰 Saldo: *$${parseFloat(user.balance).toFixed(2)} USD*`, { parse_mode: 'Markdown' });
    }

    if (text === '💳 Recargas') {
        const userSnap = await get(ref(db, `users/${webUid}`));
        const userData = userSnap.val();

        // Calcular historial de recargas
        let totalRecharged = 0;
        if (userData.recharges) {
            Object.values(userData.recharges).forEach(r => {
                totalRecharged += parseFloat(r.amount || 0);
            });
        }

        const minUsd = totalRecharged > 5 ? 2 : 3;
        const exchangeRate = 3800;

        // Poner al usuario en estado de espera para que escriba la cantidad
        userStates[chatId] = { step: 'WAITING_FOR_RECHARGE_AMOUNT', data: { minUsd: minUsd } };

        const mensajeRequisitos = `💳 *NUEVA RECARGA*\n\n` +
                               `💵 *Tasa de Cambio:* $1 USD = $${exchangeRate.toLocaleString('es-CO')} COP\n` +
                               `📈 *Total recargado por ti:* $${totalRecharged.toFixed(2)} USD\n\n` +
                               `✅ *Tu recarga mínima es de:* *$${minUsd} USD*\n\n` +
                               `👇 *Escribe la cantidad en USD* que deseas recargar:\n` +
                               `_(Escribe solo el número, por ejemplo: ${minUsd} o 5.5)_`;

        return bot.sendMessage(chatId, mensajeRequisitos, { parse_mode: 'Markdown' });
    }

    if (text === '🛒 Tienda') {
        const productsSnap = await get(ref(db, 'products'));
        if (!productsSnap.exists()) return bot.sendMessage(chatId, 'Tienda vacía en este momento.');
        
        let inlineKeyboard = [];
        productsSnap.forEach(child => {
            const p = child.val();
            const stock = p.keys ? Object.keys(p.keys).length : 0;
            if (stock > 0) {
                inlineKeyboard.push([{ text: `Comprar ${p.name} - $${p.price} (${stock} disp)`, callback_data: `buy_${child.key}` }]);
            }
        });
        if(inlineKeyboard.length === 0) return bot.sendMessage(chatId, '❌ Todos los productos están agotados.');
        
        return bot.sendMessage(chatId, `🛒 *ARSENAL DISPONIBLE*\nSelecciona un producto:`, { parse_mode: 'Markdown', reply_markup: { inline_keyboard: inlineKeyboard } });
    }

    // --- ACCIONES ADMIN (BOTONES DE ABAJO) ---
    if (tgId === ADMIN_ID) {
        if (text === '📢 Mensaje Global') {
            userStates[chatId] = { step: 'WAITING_FOR_BROADCAST_MESSAGE', data: {} };
            return bot.sendMessage(chatId, '📝 *MENSAJE GLOBAL*\n\nEscribe el mensaje que quieres enviarle a **todos los usuarios** del bot:\n\n_(Puedes incluir emojis o enlaces)_', { parse_mode: 'Markdown' });
        }

        if (text === '💰 Añadir Saldo') {
            userStates[chatId] = { step: 'ADD_BALANCE_USER', data: {} };
            return bot.sendMessage(chatId, 'Escribe el **Nombre de Usuario** exacto al que deseas añadir saldo:', { parse_mode: 'Markdown' });
        }
        
        if (text === '📦 Crear Producto') {
            userStates[chatId] = { step: 'CREATE_PROD_NAME', data: {} };
            return bot.sendMessage(chatId, 'Escribe el **Nombre** del nuevo producto:', { parse_mode: 'Markdown' });
        }

        if (text === '🔑 Añadir Stock') {
            const productsSnap = await get(ref(db, 'products'));
            if (!productsSnap.exists()) return bot.sendMessage(chatId, '❌ No hay productos creados.');
            
            let inlineKeyboard = [];
            productsSnap.forEach(child => {
                inlineKeyboard.push([{ text: `➕ Stock a: ${child.val().name}`, callback_data: `stock_${child.key}` }]);
            });
            return bot.sendMessage(chatId, `📦 Selecciona a qué producto vas a agregarle Keys:`, { reply_markup: { inline_keyboard: inlineKeyboard } });
        }
    }
});

// 3. MANEJADOR DE BOTONES EN LÍNEA (Callback Queries)
bot.on('callback_query', async (query) => {
    const chatId = query.message.chat.id;
    const tgId = query.from.id;
    const data = query.data;
    bot.answerCallbackQuery(query.id);

    const webUid = await getAuthUser(tgId);
    if (!webUid) return bot.sendMessage(chatId, `🛑 Acceso revocado.`);

    // USUARIOS: SOLICITAR ENVÍO DE COMPROBANTE
    if (data === 'send_receipt') {
        const userSnap = await get(ref(db, `users/${webUid}`));
        const username = userSnap.val().username;
        
        userStates[chatId] = { step: 'WAITING_FOR_RECEIPT', data: { username: username } };
        return bot.sendMessage(chatId, '📸 Por favor, envía la **foto de tu comprobante** de pago ahora mismo.\n\n_(Asegúrate de que la captura se vea clara)_', { parse_mode: 'Markdown' });
    }

    // ADMIN: SELECCIÓN DE PRODUCTO PARA AÑADIR STOCK
    if (data.startsWith('stock_') && tgId === ADMIN_ID) {
        const prodId = data.split('_')[1];
        userStates[chatId] = { step: 'ADD_STOCK_KEYS', data: { prodId: prodId } };
        return bot.sendMessage(chatId, 'Pega todas las **Keys** ahora. Puedes separarlas por espacios, comas o saltos de línea:', { parse_mode: 'Markdown' });
    }

    // USUARIOS: COMPRA DE PRODUCTOS
    if (data.startsWith('buy_')) {
        const productId = data.split('_')[1];
        bot.sendMessage(chatId, '⚙️ Procesando transacción...');

        const userSnap = await get(ref(db, `users/${webUid}`));
        const prodSnap = await get(ref(db, `products/${productId}`));
        
        let currentBalance = parseFloat(userSnap.val().balance || 0);
        let product = prodSnap.val();

        if (currentBalance < product.price) return bot.sendMessage(chatId, '❌ Saldo insuficiente en la Web.');
        
        if (product.keys && Object.keys(product.keys).length > 0) {
            const firstKeyId = Object.keys(product.keys)[0];
            const keyToDeliver = product.keys[firstKeyId];

            const updates = {};
            updates[`products/${productId}/keys/${firstKeyId}`] = null; 
            updates[`users/${webUid}/balance`] = currentBalance - product.price; 
            
            const historyRef = push(ref(db, `users/${webUid}/history`));
            updates[`users/${webUid}/history/${historyRef.key}`] = { product: product.name, key: keyToDeliver, price: product.price, date: Date.now() };

            await update(ref(db), updates);
            bot.sendMessage(chatId, `✅ *¡COMPRA EXITOSA!*\n\nTu Key es:\n\n\`${keyToDeliver}\``, { parse_mode: 'Markdown' });
        } else {
            bot.sendMessage(chatId, '❌ Producto agotado justo ahora.');
        }
    }
});

console.log('🤖 Bot sincronizado e interactivo iniciado...');
