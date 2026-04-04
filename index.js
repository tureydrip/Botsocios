const TelegramBot = require('node-telegram-bot-api');
const { initializeApp } = require('firebase/app');
const { getDatabase, ref, get, update, push, set, remove } = require('firebase/database');
const sistemaRecargas = require('./recargas');
const { enviarNotificacionWA } = require('./whatsapp'); // INTEGRACIÓN WHATSAPP

// CONFIGURACIÓN MASTER
const token = '8275295427:AAFc-U21od7ZWdtQU-62U1mJOSJqFYFZ-IQ';
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

const userStates = {}; 

const botsActivos = {}; 

function iniciarSubBot(ownerUid, botToken, ownerTgId) {
    if (botsActivos[ownerUid]) {
        botsActivos[ownerUid].stopPolling(); 
    }

    const subBot = new TelegramBot(botToken, { polling: true });
    botsActivos[ownerUid] = subBot;
    console.log(`🟢 Sub-Bot encendido para el cliente UID: ${ownerUid}`);
    
    subBot.onText(/\/start/, (msg) => {
        const chatId = msg.chat.id;
        subBot.sendMessage(chatId, `¡Hola! Soy un bot gestionado por un cliente de LUCK XIT.\n\nPara simular un pago, envíame una foto (comprobante).`);
    });

    subBot.on('photo', async (msg) => {
        const chatId = msg.chat.id;
        const fileId = msg.photo[msg.photo.length - 1].file_id;
        const senderUsername = msg.from.username || 'Usuario';

        subBot.sendMessage(chatId, '✅ Comprobante enviado a mi administrador.');

        const tecladoDueño = {
            inline_keyboard: [
                [{ text: '✅ Aprobar', callback_data: `sub_aprobar|${chatId}` }, { text: '❌ Rechazar', callback_data: `sub_rechazar|${chatId}` }],
                [{ text: '🕵️‍♂️ Mandar a revisar (Soporte LUCK XIT)', callback_data: `ask_review|${fileId}|${chatId}` }]
            ]
        };

        subBot.sendPhoto(ownerTgId, fileId, {
            caption: `💳 *NUEVO PAGO EN TU BOT*\n\n👤 De: @${senderUsername}\n\n¿Qué deseas hacer?`,
            parse_mode: 'Markdown',
            reply_markup: tecladoDueño
        });
    });

    subBot.on('callback_query', async (query) => {
        const data = query.data;
        subBot.answerCallbackQuery(query.id);

        if (data.startsWith('sub_aprobar|')) {
            const targetChat = data.split('|')[1];
            subBot.editMessageReplyMarkup({ inline_keyboard: [] }, { chat_id: query.message.chat.id, message_id: query.message.message_id });
            subBot.sendMessage(query.message.chat.id, '✅ Aprobaste el pago de tu cliente.');
            subBot.sendMessage(targetChat, '🎉 Tu pago fue aprobado por el administrador.');
        }

        if (data.startsWith('sub_rechazar|')) {
            const targetChat = data.split('|')[1];
            subBot.editMessageReplyMarkup({ inline_keyboard: [] }, { chat_id: query.message.chat.id, message_id: query.message.message_id });
            subBot.sendMessage(query.message.chat.id, '❌ Rechazaste el pago.');
            subBot.sendMessage(targetChat, '❌ Tu pago fue rechazado.');
        }

        if (data.startsWith('ask_review|')) {
            const fileId = data.split('|')[1];
            const targetChat = data.split('|')[2]; 

            subBot.editMessageReplyMarkup({ inline_keyboard: [] }, { chat_id: query.message.chat.id, message_id: query.message.message_id });
            subBot.sendMessage(query.message.chat.id, '⏳ *Comprobante enviado a la central de LUCK XIT.* Espera el veredicto de los Master Admins.', { parse_mode: 'Markdown' });

            const reviewRef = push(ref(db, 'verificaciones_pendientes'));
            await set(reviewRef, { ownerTgId: ownerTgId, targetChat: targetChat, subBotToken: botToken });

            const tecladoMaster = {
                inline_keyboard: [
                    [{ text: '🟢 ES REAL (Avisar al cliente)', callback_data: `master_real|${reviewRef.key}` }],
                    [{ text: '🔴 ES FALSO (Avisar al cliente)', callback_data: `master_falso|${reviewRef.key}` }]
                ]
            };

            bot.sendPhoto(SUPER_ADMIN_ID, fileId, {
                caption: `🚨 *REVISIÓN SOLICITADA POR UN CLIENTE (BaaS)*\n\nTu cliente ID \`${ownerTgId}\` solicita verificar este comprobante.\n\n¿Es real o falso?`,
                parse_mode: 'Markdown',
                reply_markup: tecladoMaster
            });
        }
    });
}

async function arrancarTodosLosBots() {
    const botsSnap = await get(ref(db, 'rented_bots'));
    if (botsSnap.exists()) {
        const now = Date.now();
        botsSnap.forEach(child => {
            const data = child.val();
            if (data.status === 'active' && data.expiresAt > now) {
                iniciarSubBot(child.key, data.botToken, data.ownerTgId);
            }
        });
    }
}
arrancarTodosLosBots();

const userKeyboard = {
    reply_markup: {
        keyboard: [
            [{ text: '🛒 Tienda' }, { text: '👤 Mi Perfil' }],
            [{ text: '💳 Recargas' }, { text: '🔄 Solicitar Reembolso' }],
            [{ text: '🎟️ Canjear Cupón' }, { text: '💸 Transferir Saldo' }],
            [{ text: '🤖 Mi Bot (Alquiler)' }, { text: '📱 Vincular WhatsApp' }] 
        ],
        resize_keyboard: true,
        is_persistent: true
    }
};

function notifySuperAdmin(adminUsername, adminTgId, action, details) {
    if (adminTgId === SUPER_ADMIN_ID) return; 
    const msg = `🕵️‍♂️ *REPORTE DE ADMINISTRADOR*\n\n👮 *Admin:* ${adminUsername} (\`${adminTgId}\`)\n🛠️ *Acción:* ${action}\n📝 *Detalle:* ${details}`;
    bot.sendMessage(SUPER_ADMIN_ID, msg, { parse_mode: 'Markdown' }).catch(() => {});
}

async function getAdminData(tgId) {
    if (tgId === SUPER_ADMIN_ID) {
        return { isSuper: true, perms: { products: true, balance: true, broadcast: true, refunds: true, coupons: true, stats: true, users: true, maintenance: true } };
    }
    const snap = await get(ref(db, `admins/${tgId}`));
    if (snap.exists()) return { isSuper: false, perms: snap.val().perms || {} };
    return null;
}

function buildAdminKeyboard(adminData) {
    const kb = []; let row = [];
    const addBtn = (text, perm) => {
        if (adminData.isSuper || adminData.perms[perm]) { row.push({ text }); if (row.length === 3) { kb.push(row); row = []; } }
    };
    
    addBtn('📦 Crear Producto', 'products'); addBtn('📝 Editar Producto', 'products'); addBtn('🗑️ Eliminar Producto', 'products');
    addBtn('🔑 Añadir Stock', 'products'); addBtn('💰 Añadir Saldo', 'balance'); addBtn('📢 Mensaje Global', 'broadcast');
    addBtn('🔄 Revisar Reembolsos', 'refunds'); addBtn('🎟️ Crear Cupón', 'coupons'); addBtn('📊 Estadísticas', 'stats');
    addBtn('📋 Ver Usuarios', 'stats'); addBtn('🔨 Gest. Usuarios', 'users'); addBtn('🛠️ Mantenimiento', 'maintenance');
    
    if (row.length > 0) kb.push(row);
    let bottomRow = [];
    if (adminData.isSuper) { bottomRow.push({ text: '👮 Gest. Admins' }); bottomRow.push({ text: '🌍 Gest. Países' }); }
    bottomRow.push({ text: '❌ Cancelar Acción' }); kb.push(bottomRow);
    
    return { reply_markup: { keyboard: kb, resize_keyboard: true, is_persistent: true } };
}

function buildAdminManagerInline(targetTgId, perms) {
    const p = (perm) => perms[perm] ? '🟢' : '🔴';
    return {
        inline_keyboard: [
            [{ text: `${p('products')} Productos y Stock`, callback_data: `tgp|${targetTgId}|products` }],
            [{ text: `${p('balance')} Añadir Saldo`, callback_data: `tgp|${targetTgId}|balance` }, { text: `${p('refunds')} Reembolsos`, callback_data: `tgp|${targetTgId}|refunds` }],
            [{ text: `${p('coupons')} Cupones`, callback_data: `tgp|${targetTgId}|coupons` }, { text: `${p('stats')} Estadísticas`, callback_data: `tgp|${targetTgId}|stats` }],
            [{ text: `${p('users')} Banear/Ver Usr`, callback_data: `tgp|${targetTgId}|users` }, { text: `${p('broadcast')} Mensaje Global`, callback_data: `tgp|${targetTgId}|broadcast` }],
            [{ text: `${p('maintenance')} Mantenimiento`, callback_data: `tgp|${targetTgId}|maintenance` }],
            [{ text: `🗑️ Revocar Administrador`, callback_data: `deladm|${targetTgId}` }]
        ]
    };
}

async function getAuthUser(telegramId) {
    const authSnap = await get(ref(db, `telegram_auth/${telegramId}`));
    if (authSnap.exists()) return authSnap.val();
    return null;
}

async function sendUserManageMenu(chatId, targetUid, bot) {
    const uSnap = await get(ref(db, `users/${targetUid}`));
    if (!uSnap.exists()) return bot.sendMessage(chatId, '❌ Usuario no encontrado.');
    const targetUser = uSnap.val();

    let totalSpent = 0;
    if (targetUser.history) { Object.values(targetUser.history).forEach(h => totalSpent += parseFloat(h.price || 0)); }

    let isBanned = targetUser.banned || false;
    let banText = isBanned ? '🔴 BANEADO PERMANENTE' : '🟢 ACTIVO';
    
    if (targetUser.banUntil && targetUser.banUntil > Date.now()) {
        isBanned = true;
        const hoursLeft = ((targetUser.banUntil - Date.now()) / 3600000).toFixed(1);
        banText = `⏳ BANEADO TEMPORAL (${hoursLeft} hrs restantes)`;
    }

    const msgInfo = `👤 *GESTIÓN DE USUARIO*\n\n*Nombre:* ${targetUser.username}\n*Saldo:* $${parseFloat(targetUser.balance||0).toFixed(2)} USD\n*Gastado Total:* $${totalSpent.toFixed(2)} USD\n*Estado:* ${banText}`;
    const inlineKeyboard = [
        [{ text: '➕ Agregar Saldo', callback_data: `uact|addbal|${targetUid}` }, { text: '➖ Quitar Saldo', callback_data: `uact|rembal|${targetUid}` }],
        [{ text: isBanned ? '✅ Desbanear' : '🔨 Ban Permanente', callback_data: `uact|banperm|${targetUid}` }, { text: '⏳ Ban Temporal', callback_data: `uact|bantemp|${targetUid}` }]
    ];

    bot.sendMessage(chatId, msgInfo, { parse_mode: 'Markdown', reply_markup: { inline_keyboard: inlineKeyboard } });
}

bot.onText(/\/start/, async (msg) => {
    const chatId = msg.chat.id;
    const tgId = msg.from.id;
    userStates[chatId] = null; 

    const webUid = await getAuthUser(tgId);
    if (!webUid) {
        return bot.sendMessage(chatId, `🛑 *ACCESO DENEGADO*\n\nTu dispositivo no está vinculado a una cuenta web.\n\n🔑 *TU ID DE TELEGRAM ES:* \`${tgId}\`\n\nVe a la web, vincula tu cuenta y vuelve a escribir /start.`, { parse_mode: 'Markdown' });
    }

    const userSnap = await get(ref(db, `users/${webUid}`));
    const webUser = userSnap.val();
    if (!webUser) return bot.sendMessage(chatId, '⚠️ *ERROR CRÍTICO*\n\nTu cuenta web fue eliminada o no se encuentra en la base de datos. Contacta a soporte.', { parse_mode: 'Markdown' });

    const adminData = await getAdminData(tgId);
    const keyboard = adminData ? buildAdminKeyboard(adminData) : userKeyboard;
    
    let greeting = `🌌 Bienvenido a LUCK XIT, *${webUser.username}*.`;
    if (adminData) greeting = adminData.isSuper ? `👑 ¡Bienvenido Super Admin LUCK XIT, *${webUser.username}*!` : `🛡️ Bienvenido Admin, *${webUser.username}*.`;

    bot.sendMessage(chatId, `${greeting}\nUsa los botones de abajo para navegar.`, { parse_mode: 'Markdown', ...keyboard });
});

bot.on('message', async (msg) => {
    if (msg.text === '/start') return;
    
    const chatId = msg.chat.id;
    const tgId = msg.from.id;
    const text = msg.text || msg.caption || ''; 

    if (!text && !msg.photo) return;

    const webUid = await getAuthUser(tgId);
    if (!webUid) return bot.sendMessage(chatId, `🛑 Acceso denegado. Escribe /start para verificar.`);
    
    const settingsSnap = await get(ref(db, 'settings'));
    const isMaintenance = settingsSnap.val()?.maintenance || false;
    
    const userSnap = await get(ref(db, `users/${webUid}`));
    const webUser = userSnap.val();
    if (!webUser) return bot.sendMessage(chatId, '⚠️ *ERROR CRÍTICO*\n\nTu cuenta web fue eliminada.', { parse_mode: 'Markdown' });

    const adminData = await getAdminData(tgId);
    const keyboard = adminData ? buildAdminKeyboard(adminData) : userKeyboard;

    if (!adminData) {
        let isBanned = webUser.banned;
        if (webUser.banUntil && webUser.banUntil > Date.now()) {
            isBanned = true;
        } else if (webUser.banUntil && webUser.banUntil <= Date.now()) {
            isBanned = false;
            await update(ref(db), { [`users/${webUid}/banned`]: false, [`users/${webUid}/banUntil`]: null });
        }

        if (isBanned) return bot.sendMessage(chatId, '🚫 *ESTÁS BANEADO*\n\nHas sido bloqueado del sistema LUCK XIT. Contacta a soporte.', { parse_mode: 'Markdown' });
        if (isMaintenance) return bot.sendMessage(chatId, '🛠️ *MODO MANTENIMIENTO ACTIVO*\n\nEstamos haciendo mejoras. Volveremos pronto.', { parse_mode: 'Markdown' });
    }

    if (text === '❌ Cancelar Acción') {
        userStates[chatId] = null;
        return bot.sendMessage(chatId, '✅ Acción cancelada. ¿Qué deseas hacer ahora?', keyboard);
    }

    if (msg.photo && userStates[chatId]) {
        const state = userStates[chatId];
        const fileId = msg.photo[msg.photo.length - 1].file_id; 

        if (state.step === 'WAITING_FOR_RECEIPT') {
            return sistemaRecargas.recibirFotoComprobante(bot, db, chatId, tgId, fileId, state.data, keyboard, SUPER_ADMIN_ID, userStates);
        }

        if (state.step === 'WAITING_FOR_USER_REFUND_PROOF') {
            const foundData = state.data;
            const reason = msg.caption ? msg.caption : 'Sin razón especificada';
            const dateStr = new Date(foundData.compra.date).toLocaleString('es-CO');

            const msgInfo = `🔔 *NUEVA SOLICITUD DE REEMBOLSO*\n\n👤 *Usuario:* ${foundData.username}\n📦 *Producto:* ${foundData.compra.product}\n🔑 *Key:* \`${foundData.compra.key}\`\n💰 *Pagado:* $${parseFloat(foundData.compra.price).toFixed(2)} USD\n📝 *Motivo:* ${reason}`;
            const refundKeyboard = {
                inline_keyboard: [
                    [{ text: '✅ Mandar Reembolso', callback_data: `rfnd|${foundData.uid}|${foundData.histId}` }],
                    [{ text: '❌ Rechazar Solicitud', callback_data: `reject_refund|${foundData.targetTgId}` }]
                ]
            };
            bot.sendPhoto(SUPER_ADMIN_ID, fileId, { caption: msgInfo, parse_mode: 'Markdown', reply_markup: refundKeyboard });
            userStates[chatId] = null;
            return bot.sendMessage(chatId, '✅ Tu solicitud ha sido enviada.', keyboard);
        }
    }

    if (!text) return; 

    if (userStates[chatId]) {
        const state = userStates[chatId];

        if (state.step === 'WAITING_FOR_WA_NUMBER') {
            const numero = text.replace(/\D/g, ''); 
            if (numero.length < 10) return bot.sendMessage(chatId, '❌ Número inválido. Asegúrate de incluir el código de país.');
            
            const codigoVerificacion = Math.floor(10000 + Math.random() * 90000).toString();
            state.step = 'WAITING_FOR_WA_CODE';
            state.data = { numeroWA: numero, codigoValidacion: codigoVerificacion };

            bot.sendMessage(chatId, '⏳ Enviando código de seguridad a tu WhatsApp...', { parse_mode: 'Markdown' });
            
            enviarNotificacionWA(numero, `🔐 *LUCK XIT - SEGURIDAD*\n\nTu código de vinculación para Telegram es: *${codigoVerificacion}*\n\nSi no solicitaste esto, ignora este mensaje.`);

            return bot.sendMessage(chatId, `✅ *Código enviado.*\n\nRevisa tu WhatsApp (+${numero}) y escribe el código de 5 dígitos aquí abajo:`, { parse_mode: 'Markdown' });
        }

        if (state.step === 'WAITING_FOR_WA_CODE') {
            if (text.trim() === state.data.codigoValidacion) {
                await update(ref(db), { [`users/${webUid}/whatsapp`]: state.data.numeroWA });
                userStates[chatId] = null;
                return bot.sendMessage(chatId, '🎉 *¡WhatsApp vinculado exitosamente!*\n\nAhora LUCK XIT te notificará por allá sobre tu saldo y recargas.', { parse_mode: 'Markdown', ...keyboard });
            } else {
                return bot.sendMessage(chatId, '❌ Código incorrecto. Intenta de nuevo o escribe "❌ Cancelar Acción".');
            }
        }

        if (state.step === 'WAITING_FOR_BOT_TOKEN') {
            const botToken = text.trim();
            if (!botToken.includes(':')) return bot.sendMessage(chatId, '❌ Ese token no parece válido. Intenta de nuevo:');

            const expireDate = Date.now() + (30 * 24 * 60 * 60 * 1000); 
            
            await set(ref(db, `rented_bots/${webUid}`), {
                botToken: botToken,
                ownerTgId: tgId,
                status: 'active',
                expiresAt: expireDate
            });

            bot.sendMessage(chatId, `🚀 *¡TU BOT HA SIDO CREADO Y ENCENDIDO!*\n\nEl sistema gestionará tu bot en segundo plano durante los próximos 30 días.\n\nVe a tu bot y escribe /start para probarlo.`, { parse_mode: 'Markdown', ...keyboard });
            
            iniciarSubBot(webUid, botToken, tgId);
            userStates[chatId] = null;
            return;
        }

        if (state.step === 'WAITING_FOR_RECEIPT' || state.step === 'WAITING_FOR_USER_REFUND_PROOF') {
            return bot.sendMessage(chatId, '❌ Debes adjuntar una **foto (captura de pantalla)** para continuar.\n\n_(Si deseas salir, usa el menú o escribe "❌ Cancelar Acción")_', { parse_mode: 'Markdown' });
        }

        if (state.step === 'REDEEM_COUPON') {
            const code = text.trim().toUpperCase();
            const couponSnap = await get(ref(db, `coupons/${code}`));
            if (!couponSnap.exists()) { userStates[chatId] = null; return bot.sendMessage(chatId, '❌ *CUPÓN INVÁLIDO*', { parse_mode: 'Markdown', ...keyboard }); }

            const couponData = couponSnap.val();
            const userUsedCouponsSnap = await get(ref(db, `users/${webUid}/used_coupons/${code}`));
            if (userUsedCouponsSnap.exists()) { userStates[chatId] = null; return bot.sendMessage(chatId, '⚠️ *YA USASTE ESTE CUPÓN*', { parse_mode: 'Markdown', ...keyboard }); }

            const updates = {};
            updates[`users/${webUid}/used_coupons/${code}`] = true;

            if (couponData.type === 'balance') {
                const currentBal = parseFloat(webUser.balance || 0);
                const reward = parseFloat(couponData.value);
                updates[`users/${webUid}/balance`] = currentBal + reward;
                await update(ref(db), updates);
                userStates[chatId] = null;
                return bot.sendMessage(chatId, `🎉 *¡CUPÓN CANJEADO CON ÉXITO!*\n\n💰 *Nuevo saldo:* $${(currentBal + reward).toFixed(2)} USD`, { parse_mode: 'Markdown', ...keyboard });
            } else if (couponData.type === 'discount') {
                const discount = parseFloat(couponData.value);
                updates[`users/${webUid}/active_discount`] = discount;
                await update(ref(db), updates);
                userStates[chatId] = null;
                return bot.sendMessage(chatId, `🎟️ *¡CUPÓN DE DESCUENTO APLICADO!*\n\nHas activado un descuento del **${discount}%**.\n🛍️ Se aplicará automáticamente en tu **próxima compra** de cualquier producto en la tienda.`, { parse_mode: 'Markdown', ...keyboard });
            }
        }

        if (state.step === 'TRANSFER_USERNAME') {
            state.data.targetUser = text.trim();
            if(state.data.targetUser === webUser.username) return bot.sendMessage(chatId, '❌ No puedes transferirte a ti mismo.');
            state.step = 'TRANSFER_AMOUNT';
            return bot.sendMessage(chatId, `¿Cuánto saldo en **USD** deseas enviarle a *${state.data.targetUser}*?\n\nTu saldo actual: $${parseFloat(webUser.balance||0).toFixed(2)}`, { parse_mode: 'Markdown' });
        }
        
        if (state.step === 'TRANSFER_AMOUNT') {
            const amount = parseFloat(text);
            if (isNaN(amount) || amount <= 0) return bot.sendMessage(chatId, '❌ Cantidad inválida. Debe ser mayor a 0.');
            const currentBal = parseFloat(webUser.balance || 0);
            if (amount > currentBal) return bot.sendMessage(chatId, '❌ No tienes suficiente saldo para realizar esta transferencia.');

            bot.sendMessage(chatId, '⏳ Procesando transferencia...');
            const usersSnap = await get(ref(db, 'users'));
            let targetUid = null;
            let targetBal = 0;
            let targetUserWA = null;

            usersSnap.forEach(u => {
                if (u.val().username === state.data.targetUser) {
                    targetUid = u.key;
                    targetBal = parseFloat(u.val().balance || 0);
                    targetUserWA = u.val().whatsapp;
                }
            });

            if (!targetUid) {
                userStates[chatId] = null;
                return bot.sendMessage(chatId, '❌ Usuario destino no encontrado en la base de datos. Verifica el nombre exacto.', keyboard);
            }

            const updates = {};
            updates[`users/${webUid}/balance`] = currentBal - amount;
            updates[`users/${targetUid}/balance`] = targetBal + amount;
            await update(ref(db), updates);

            bot.sendMessage(chatId, `✅ *Transferencia exitosa.*\nEnviaste *$${amount} USD* a ${state.data.targetUser}.\nTu nuevo saldo es: $${(currentBal - amount).toFixed(2)} USD`, { parse_mode: 'Markdown', ...keyboard });

            const telegramAuthSnap = await get(ref(db, 'telegram_auth'));
            let targetTgId = null;
            if (telegramAuthSnap.exists()) {
                telegramAuthSnap.forEach(child => { if (child.val() === targetUid) targetTgId = child.key; });
            }
            if (targetTgId) {
                bot.sendMessage(targetTgId, `💸 *¡TRANSFERENCIA RECIBIDA!*\n\nEl usuario *${webUser.username}* te ha enviado *$${amount} USD*.\n💰 Nuevo saldo: *$${(targetBal + amount).toFixed(2)} USD*`, { parse_mode: 'Markdown' });
            }
            if (targetUserWA) {
                enviarNotificacionWA(targetUserWA, `💸 *TRANSFERENCIA RECIBIDA*\n\nEl usuario *${webUser.username}* te ha enviado saldo.\n\n💵 *Monto:* $${amount} USD\n💎 *Saldo Actual:* $${(targetBal + amount).toFixed(2)} USD`);
            }
            userStates[chatId] = null;
            return;
        }

        if (adminData) {
            if (state.step === 'TEMP_BAN_TIME' && (adminData.isSuper || adminData.perms.users)) {
                const hrs = parseFloat(text);
                if (isNaN(hrs) || hrs <= 0) return bot.sendMessage(chatId, '❌ Cantidad de horas inválidas.');
                const unbanTime = Date.now() + (hrs * 3600000);
                await update(ref(db), { [`users/${state.data.targetUid}/banned`]: true, [`users/${state.data.targetUid}/banUntil`]: unbanTime });
                bot.sendMessage(chatId, `✅ Usuario baneado temporalmente por ${hrs} horas.`, keyboard);
                userStates[chatId] = null;
                return;
            }

            if (state.step === 'DIRECT_ADD_BAL' && (adminData.isSuper || adminData.perms.balance)) {
                const amt = parseFloat(text);
                if (isNaN(amt) || amt <= 0) return bot.sendMessage(chatId, '❌ Monto inválido.');
                const uSnap = await get(ref(db, `users/${state.data.targetUid}`));
                const currentBal = parseFloat(uSnap.val().balance || 0);
                await update(ref(db), { [`users/${state.data.targetUid}/balance`]: currentBal + amt });
                bot.sendMessage(chatId, `✅ Se agregaron $${amt} al usuario ${uSnap.val().username}. Nuevo saldo: $${(currentBal + amt).toFixed(2)}`, keyboard);
                
                if (uSnap.val().whatsapp) {
                    enviarNotificacionWA(uSnap.val().whatsapp, `💰 *RECARGA APROBADA*\n\nSe han depositado *$${amt} USD* a tu cuenta LUCK XIT.\n💎 *Saldo Actual:* $${(currentBal + amt).toFixed(2)} USD`);
                }
                userStates[chatId] = null;
                return;
            }

            if (state.step === 'DIRECT_REM_BAL' && (adminData.isSuper || adminData.perms.balance)) {
                const amt = parseFloat(text);
                if (isNaN(amt) || amt <= 0) return bot.sendMessage(chatId, '❌ Monto inválido.');
                const uSnap = await get(ref(db, `users/${state.data.targetUid}`));
                const currentBal = parseFloat(uSnap.val().balance || 0);
                const newBal = currentBal - amt < 0 ? 0 : currentBal - amt;
                await update(ref(db), { [`users/${state.data.targetUid}/balance`]: newBal });
                bot.sendMessage(chatId, `✅ Se quitaron $${amt} al usuario ${uSnap.val().username}. Nuevo saldo: $${newBal.toFixed(2)}`, keyboard);
                
                if (uSnap.val().whatsapp) {
                    enviarNotificacionWA(uSnap.val().whatsapp, `📉 *SALDO DEBITADO*\n\nSe te descontaron *$${amt} USD* de tu cuenta.\n💎 *Saldo Actual:* $${newBal.toFixed(2)} USD`);
                }
                userStates[chatId] = null;
                return;
            }

            if (state.step === 'WAITING_FOR_ADMIN_ID' && adminData.isSuper) {
                const targetTgId = parseInt(text.trim());
                if (isNaN(targetTgId)) return bot.sendMessage(chatId, '❌ ID Inválido. Debe ser un número.');
                if (targetTgId === SUPER_ADMIN_ID) return bot.sendMessage(chatId, '❌ No puedes modificar tus propios permisos de Super Admin.');

                const targetAdminSnap = await get(ref(db, `admins/${targetTgId}`));
                let currentPerms = {};
                
                if (targetAdminSnap.exists()) {
                    currentPerms = targetAdminSnap.val().perms || {};
                    bot.sendMessage(chatId, `⚙️ *Administrando a ID:* \`${targetTgId}\`\n\nToca los botones para prender (🟢) o apagar (🔴) el acceso a cada función para este administrador:`, { parse_mode: 'Markdown', reply_markup: buildAdminManagerInline(targetTgId, currentPerms) });
                } else {
                    currentPerms = { products: false, balance: false, broadcast: false, refunds: false, coupons: false, stats: false, users: false, maintenance: false };
                    await set(ref(db, `admins/${targetTgId}`), { perms: currentPerms });
                    bot.sendMessage(chatId, `✅ *Nuevo Administrador Creado*\n\nID: \`${targetTgId}\`\nPor defecto todos sus permisos están apagados. Configúralos ahora:`, { parse_mode: 'Markdown', reply_markup: buildAdminManagerInline(targetTgId, currentPerms) });
                }
                userStates[chatId] = null;
                return;
            }

            if (state.step === 'MANAGE_USER' && (adminData.isSuper || adminData.perms.users)) {
                const username = text.trim();
                const usersSnap = await get(ref(db, 'users'));
                let targetUid = null;

                usersSnap.forEach(u => {
                    if (u.val().username === username) targetUid = u.key;
                });

                if (!targetUid) return bot.sendMessage(chatId, '❌ Usuario no encontrado. Verifica mayúsculas y minúsculas.');

                await sendUserManageMenu(chatId, targetUid, bot);
                userStates[chatId] = null;
                return;
            }

            if (state.step === 'CREATE_COUPON_CODE' && (adminData.isSuper || adminData.perms.coupons)) {
                state.data.code = text.trim().toUpperCase();
                state.step = 'CREATE_COUPON_TYPE';
                const inlineType = {
                    inline_keyboard: [
                        [{ text: '💰 Dar Saldo (USD)', callback_data: `cpntype|bal` }],
                        [{ text: '📉 Dar Descuento (%)', callback_data: `cpntype|desc` }]
                    ]
                };
                return bot.sendMessage(chatId, `Código: *${state.data.code}*\n\n¿Qué tipo de beneficio dará este cupón?`, { parse_mode: 'Markdown', reply_markup: inlineType });
            }

            if (state.step === 'CREATE_COUPON_VALUE' && (adminData.isSuper || adminData.perms.coupons)) {
                const val = parseFloat(text);
                if (isNaN(val) || val <= 0) return bot.sendMessage(chatId, '❌ Valor inválido. Ingresa un número mayor a 0.');
                
                await set(ref(db, `coupons/${state.data.code}`), { type: state.data.type, value: val });
                
                const isDesc = state.data.type === 'discount';
                bot.sendMessage(chatId, `✅ *Cupón creado.*\n\nCódigo: \`${state.data.code}\`\nBeneficio: ${isDesc ? val + '% de Descuento (1 sola compra)' : '$' + val + ' USD de saldo'}`, { parse_mode: 'Markdown', ...keyboard });
                
                notifySuperAdmin(webUser.username, tgId, 'Creó un Cupón', `Código: ${state.data.code} | Valor: ${val} | Tipo: ${state.data.type}`);
                userStates[chatId] = null;
                return;
            }

            if (state.step === 'WAITING_FOR_REJECT_REASON' && (adminData.isSuper || adminData.perms.balance || adminData.perms.refunds)) {
                const targetTgId = state.data.targetTgId;
                const reason = text.trim();

                bot.sendMessage(chatId, '✅ La razón del rechazo ha sido enviada al usuario.', keyboard);
                bot.sendMessage(targetTgId, `❌ *SOLICITUD RECHAZADA*\n\nTu solicitud no ha sido aprobada por la siguiente razón:\n\n📝 _"${reason}"_\n\nContacta a soporte si crees que es un error.`, { parse_mode: 'Markdown' });
                
                notifySuperAdmin(webUser.username, tgId, 'Envió Razón de Rechazo', `Al usuario con ID ${targetTgId}. Motivo: "${reason}"`);
                userStates[chatId] = null;
                return;
            }

            if (state.step.startsWith('EDIT_PROD_') && (adminData.isSuper || adminData.perms.products)) {
                const prodId = state.data.prodId;
                const fieldType = state.step.split('_')[2]; 
                
                let updates = {};
                if (fieldType === 'NAME') {
                    updates[`products/${prodId}/name`] = text;
                } else if (fieldType === 'PRICE') {
                    const price = parseFloat(text);
                    if (isNaN(price)) return bot.sendMessage(chatId, '❌ Precio inválido. Usa números.');
                    updates[`products/${prodId}/price`] = price;
                } else if (fieldType === 'WARR') {
                    const warr = parseFloat(text);
                    if (isNaN(warr) || warr < 0) return bot.sendMessage(chatId, '❌ Garantía inválida. Usa números mayores o iguales a 0.');
                    updates[`products/${prodId}/warranty`] = warr;
                }
                
                await update(ref(db), updates);
                bot.sendMessage(chatId, `✅ Producto actualizado correctamente.`, keyboard);
                
                notifySuperAdmin(webUser.username, tgId, 'Editó Producto', `Campo cambiado: ${fieldType} | Nuevo valor: ${text} | Prod ID: ${prodId}`);
                userStates[chatId] = null;
                return;
            }

            if (state.step === 'WAITING_FOR_REFUND_KEY' && (adminData.isSuper || adminData.perms.refunds)) {
                const searchKey = text.trim().replace(/`/g, '');
                bot.sendMessage(chatId, '🔎 Buscando la Key en los registros globales...');

                const usersSnap = await get(ref(db, 'users'));
                let found = false;
                let foundData = null;

                if (usersSnap.exists()) {
                    usersSnap.forEach(userChild => {
                        const uid = userChild.key;
                        const userData = userChild.val();
                        
                        if (userData.history) {
                            Object.keys(userData.history).forEach(histId => {
                                const compra = userData.history[histId];
                                if (compra.key.trim() === searchKey) {
                                    found = true;
                                    foundData = { uid: uid, username: userData.username, histId: histId, compra: compra };
                                }
                            });
                        }
                    });
                }

                if (found) {
                    if (foundData.compra.refunded) {
                        bot.sendMessage(chatId, '⚠️ *Esta Key ya fue reembolsada anteriormente.*', { parse_mode: 'Markdown' });
                    } else {
                        const dateStr = new Date(foundData.compra.date).toLocaleString('es-CO');
                        const msgInfo = `🧾 *INFO DE LA COMPRA ENCONTRADA*\n\n` +
                                    `👤 *Usuario:* ${foundData.username}\n` +
                                    `📦 *Producto:* ${foundData.compra.product}\n` +
                                    `🔑 *Key:* \`${foundData.compra.key}\`\n` +
                                    `💰 *Costo pagado:* $${parseFloat(foundData.compra.price).toFixed(2)} USD\n` +
                                    `📅 *Fecha:* ${dateStr}\n\n` +
                                    `¿Deseas devolverle el dinero a este usuario?`;

                        const refundKeyboard = {
                            inline_keyboard: [
                                [{ text: '✅ Mandar Reembolso', callback_data: `rfnd|${foundData.uid}|${foundData.histId}` }],
                                [{ text: '❌ Cancelar', callback_data: `cancel_refund` }]
                            ]
                        };
                        bot.sendMessage(chatId, msgInfo, { parse_mode: 'Markdown', reply_markup: refundKeyboard });
                    }
                } else {
                    bot.sendMessage(chatId, '❌ No se encontró ninguna compra con esa Key en la base de datos.', keyboard);
                }
                userStates[chatId] = null;
                return;
            }

            if (state.step === 'WAITING_FOR_BROADCAST_MESSAGE' && (adminData.isSuper || adminData.perms.broadcast)) {
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
                
                bot.sendMessage(chatId, `✅ Mensaje enviado exitosamente a ${count} usuarios.`, keyboard);
                notifySuperAdmin(webUser.username, tgId, 'Mensaje Global Enviado', `Texto enviado: "${text.substring(0, 50)}..."`);
                userStates[chatId] = null;
                return;
            }

            if (state.step === 'ADD_BALANCE_USER' && (adminData.isSuper || adminData.perms.balance)) {
                state.data.targetUser = text.trim();
                state.step = 'ADD_BALANCE_AMOUNT';
                return bot.sendMessage(chatId, `Dime la **cantidad** en USD a añadir para ${state.data.targetUser}:`, { parse_mode: 'Markdown' });
            }

            if (state.step === 'ADD_BALANCE_AMOUNT' && (adminData.isSuper || adminData.perms.balance)) {
                const amount = parseFloat(text);
                if (isNaN(amount)) return bot.sendMessage(chatId, '❌ Cantidad inválida. Intenta con un número (ej: 5.50).');
                
                bot.sendMessage(chatId, '⚙️ Buscando usuario...');
                const usersSnap = await get(ref(db, 'users'));
                let foundUid = null; let currentBal = 0; let targetWA = null;

                usersSnap.forEach(child => {
                    if (child.val().username === state.data.targetUser) { 
                        foundUid = child.key; 
                        currentBal = parseFloat(child.val().balance || 0); 
                        targetWA = child.val().whatsapp;
                    }
                });

                if (foundUid) {
                    const updates = {};
                    const nuevoSaldo = currentBal + amount;
                    updates[`users/${foundUid}/balance`] = nuevoSaldo;
                    const rechRef = push(ref(db, `users/${foundUid}/recharges`));
                    updates[`users/${foundUid}/recharges/${rechRef.key}`] = { amount: amount, date: Date.now() };
                    
                    await update(ref(db), updates);
                    
                    bot.sendMessage(chatId, `✅ Saldo añadido a ${state.data.targetUser}. Nuevo saldo: $${nuevoSaldo.toFixed(2)}`, keyboard);

                    const telegramAuthSnap = await get(ref(db, 'telegram_auth'));
                    let targetTgId = null;
                    if (telegramAuthSnap.exists()) {
                        telegramAuthSnap.forEach(child => {
                            if (child.val() === foundUid) targetTgId = child.key;
                        });
                    }

                    if (targetTgId) {
                        bot.sendMessage(targetTgId, `🎉 Un administrador LUCK XIT te ha depositado: *$${amount} USD* de saldo.\n💰 Nuevo saldo: *$${nuevoSaldo.toFixed(2)} USD*`, { parse_mode: 'Markdown' });
                    }

                    if (targetWA) {
                        enviarNotificacionWA(targetWA, `💰 *RECARGA APROBADA*\n\nUn administrador te depositó *$${amount} USD*.\n💎 *Saldo Actual:* $${nuevoSaldo.toFixed(2)} USD`);
                    }
                    
                    notifySuperAdmin(webUser.username, tgId, 'Añadió Saldo Manual', `Monto: $${amount} USD al usuario: ${state.data.targetUser}`);

                } else {
                    bot.sendMessage(chatId, `❌ Usuario no encontrado.`, keyboard);
                }
                userStates[chatId] = null; 
                return;
            }

            if (state.step === 'CREATE_PROD_NAME' && (adminData.isSuper || adminData.perms.products)) {
                state.data.name = text;
                state.step = 'CREATE_PROD_PRICE';
                return bot.sendMessage(chatId, 'Ingresa el **precio** en USD (ej: 2.5):', { parse_mode: 'Markdown' });
            }
            if (state.step === 'CREATE_PROD_PRICE' && (adminData.isSuper || adminData.perms.products)) {
                const price = parseFloat(text);
                if (isNaN(price)) return bot.sendMessage(chatId, '❌ Precio inválido. Usa números.');
                state.data.price = price;
                state.step = 'CREATE_PROD_DURATION';
                return bot.sendMessage(chatId, 'Ingresa la **duración** (ej: 24 horas o Mensual):', { parse_mode: 'Markdown' });
            }
            if (state.step === 'CREATE_PROD_DURATION' && (adminData.isSuper || adminData.perms.products)) {
                state.data.duration = text;
                state.step = 'CREATE_PROD_WARRANTY';
                return bot.sendMessage(chatId, 'Ingresa el **tiempo de garantía** en horas (ej: 24).\n\n_(Si no quieres que tenga límite de tiempo para reembolso, escribe **0**)_:', { parse_mode: 'Markdown' });
            }
            if (state.step === 'CREATE_PROD_WARRANTY' && (adminData.isSuper || adminData.perms.products)) {
                const warranty = parseFloat(text);
                if (isNaN(warranty) || warranty < 0) return bot.sendMessage(chatId, '❌ Garantía inválida. Usa números (ej: 24 o 0).');
                
                const newProdRef = push(ref(db, 'products'));
                await set(newProdRef, { 
                    name: state.data.name, 
                    price: state.data.price, 
                    duration: state.data.duration, 
                    warranty: warranty 
                });
                
                bot.sendMessage(chatId, `✅ Producto *${state.data.name}* creado exitosamente con ${warranty > 0 ? warranty + ' hrs de garantía' : 'garantía ilimitada'}.`, { parse_mode: 'Markdown', ...keyboard });
                
                notifySuperAdmin(webUser.username, tgId, 'Creó un Producto', `Nombre: ${state.data.name} | Precio: $${state.data.price} | Garantía: ${warranty}h`);
                userStates[chatId] = null;
                return;
            }

            if (state.step === 'ADD_STOCK_KEYS' && (adminData.isSuper || adminData.perms.products)) {
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
                bot.sendMessage(chatId, `✅ ¡Listo! Se agregaron ${cleanKeys.length} keys al producto.`, keyboard);
                
                notifySuperAdmin(webUser.username, tgId, 'Añadió Stock', `Se agregaron ${cleanKeys.length} keys al producto ID: ${state.data.prodId}`);
                userStates[chatId] = null;
                return;
            }
        }
        
        if (state.step === 'WAITING_FOR_USER_REFUND_KEY') {
            const searchKey = text.trim().replace(/`/g, '');
            bot.sendMessage(chatId, '🔎 Verificando tu solicitud de reembolso...');
            
            let found = false;
            let foundData = null;

            if (webUser.history) {
                Object.keys(webUser.history).forEach(histId => {
                    const compra = webUser.history[histId];
                    if (compra.key.trim() === searchKey) {
                        found = true;
                        foundData = { uid: webUid, username: webUser.username, histId: histId, compra: compra, targetTgId: tgId };
                    }
                });
            }

            if (found) {
                if (foundData.compra.refunded) {
                    bot.sendMessage(chatId, '⚠️ *Esta Key ya fue reembolsada anteriormente.*', { parse_mode: 'Markdown' });
                    userStates[chatId] = null;
                } else {
                    const warrantyHours = foundData.compra.warrantyHours || 0; 
                    const hoursPassed = (Date.now() - foundData.compra.date) / (1000 * 60 * 60);
                    
                    if (warrantyHours > 0 && hoursPassed > warrantyHours) {
                        bot.sendMessage(chatId, `❌ *GARANTÍA EXPIRADA*\n\nEl tiempo límite de garantía para este producto era de **${warrantyHours} horas**.\nHan pasado **${Math.floor(hoursPassed)} horas** desde tu compra.`, { parse_mode: 'Markdown' });
                        userStates[chatId] = null;
                        return; 
                    }

                    userStates[chatId] = { step: 'WAITING_FOR_USER_REFUND_PROOF', data: foundData };
                    bot.sendMessage(chatId, '✅ *Key encontrada y garantía válida.*\n\nAhora, por favor **envía una captura de pantalla** mostrando el error del producto.\n\n✍️ *IMPORTANTE:* Escribe la razón por la que solicitas el reembolso en la misma descripción/comentario de la foto.', { parse_mode: 'Markdown' });
                }
            } else {
                bot.sendMessage(chatId, '❌ No se encontró esta Key en tu historial de compras. Verifica que la hayas escrito correctamente e intenta de nuevo.', keyboard);
                userStates[chatId] = null;
            }
            return;
        }

        if (state.step === 'WAITING_FOR_RECHARGE_AMOUNT') {
            return sistemaRecargas.procesarMonto(bot, chatId, text, state.data, userStates);
        }
    } 

    if (text === '📱 Vincular WhatsApp') {
        userStates[chatId] = { step: 'WAITING_FOR_WA_NUMBER', data: {} };
        return bot.sendMessage(chatId, '📱 *VINCULACIÓN OBLIGATORIA*\n\nPara recibir alertas de saldo, escribe tu número de WhatsApp con código de país.\n\n_Ejemplo: 573210000000_', { parse_mode: 'Markdown' });
    }

    if (text === '🤖 Mi Bot (Alquiler)') {
        const rentSnap = await get(ref(db, `rented_bots/${webUid}`));
        
        if (rentSnap.exists()) {
            const rentData = rentSnap.val();
            const diasRestantes = Math.ceil((rentData.expiresAt - Date.now()) / (1000 * 60 * 60 * 24));
            
            const txt = `🤖 *PANEL DE TU BOT*\n\nEstado: ${rentData.status === 'active' ? '🟢 Activo' : '🔴 Pausado'}\nExpira en: ${diasRestantes} días\n\n¿Qué deseas hacer?`;
            const kb = {
                inline_keyboard: [
                    [{ text: rentData.status === 'active' ? '⏸️ Pausar Bot' : '▶️ Reanudar Bot', callback_data: `rent_toggle|${webUid}` }],
                    [{ text: '🔄 Cambiar Token', callback_data: `rent_change_token|${webUid}` }],
                    [{ text: '💵 Renovar Mes ($10 USD)', callback_data: `rent_renew|${webUid}` }]
                ]
            };
            return bot.sendMessage(chatId, txt, { parse_mode: 'Markdown', reply_markup: kb });
        } else {
            const txt = `🤖 *ALQUILER DE BOT (BaaS)*\n\nCrea tu propia tienda automática gestionada 100% por nuestros servidores. Tendrás tu propio panel, tus usuarios y tus propios comprobantes.\n\n💵 *Precio:* $10.00 USD / Mensual\n💰 *Tu Saldo Actual:* $${parseFloat(webUser.balance || 0).toFixed(2)} USD\n\n¿Deseas alquilar un mes de servicio y crear tu bot?`;
            const kb = {
                inline_keyboard: [[{ text: '✅ Pagar $10 USD y Crear', callback_data: `rent_buy|${webUid}` }]]
            };
            return bot.sendMessage(chatId, txt, { parse_mode: 'Markdown', reply_markup: kb });
        }
    }

    if (text === '💸 Transferir Saldo') {
        userStates[chatId] = { step: 'TRANSFER_USERNAME', data: {} };
        return bot.sendMessage(chatId, '💸 *TRANSFERIR SALDO*\n\nEscribe el *Nombre de Usuario* exacto:', { parse_mode: 'Markdown' });
    }

    if (text === '🎟️ Canjear Cupón') {
        userStates[chatId] = { step: 'REDEEM_COUPON', data: {} };
        return bot.sendMessage(chatId, '🎁 *CANJEAR CUPÓN*\n\nEscribe el código promocional:', { parse_mode: 'Markdown' });
    }

    if (text === '👤 Mi Perfil') {
        let msgPerfil = `👤 *PERFIL LUCK XIT*\n\nUsuario: ${webUser.username}\n💰 Saldo: *$${parseFloat(webUser.balance).toFixed(2)} USD*`;
        if (webUser.active_discount && webUser.active_discount > 0) {
            msgPerfil += `\n\n🎟️ *Descuento Activo:* Tienes un ${webUser.active_discount}% de descuento para tu próxima compra en la tienda.`;
        }
        return bot.sendMessage(chatId, msgPerfil, { parse_mode: 'Markdown' });
    }

    if (text === '💳 Recargas') {
        return sistemaRecargas.iniciarRecarga(bot, db, chatId, webUser, userStates);
    }

    if (text === '🛒 Tienda') {
        const productsSnap = await get(ref(db, 'products'));
        if (!productsSnap.exists()) return bot.sendMessage(chatId, 'Tienda vacía en este momento.');
        
        const activeDiscount = parseFloat(webUser.active_discount || 0);
        let header = `🛒 *ARSENAL DISPONIBLE*\nSelecciona un producto:`;
        if (activeDiscount > 0) {
            header = `🛒 *ARSENAL DISPONIBLE*\n🎟️ Tienes un **${activeDiscount}% de descuento** que se aplicará automáticamente a tu compra.\n\nSelecciona un producto:`;
        }

        let inlineKeyboard = [];
        productsSnap.forEach(child => {
            const p = child.val();
            const stock = p.keys ? Object.keys(p.keys).length : 0;
            if (stock > 0) {
                let showPrice = p.price;
                if (activeDiscount > 0) {
                    showPrice = p.price - (p.price * (activeDiscount / 100));
                }
                inlineKeyboard.push([{ text: `Comprar ${p.name} - $${showPrice.toFixed(2)} (${stock} disp)`, callback_data: `buy|${child.key}` }]);
            }
        });
        if(inlineKeyboard.length === 0) return bot.sendMessage(chatId, '❌ Todos los productos están agotados.');
        
        return bot.sendMessage(chatId, header, { parse_mode: 'Markdown', reply_markup: { inline_keyboard: inlineKeyboard } });
    }

    if (adminData) {
        if (text === '🌍 Gest. Países' && adminData.isSuper) return sistemaRecargas.menuPaisesAdmin(bot, db, chatId);

        if (text === '👮 Gest. Admins' && adminData.isSuper) {
            userStates[chatId] = { step: 'WAITING_FOR_ADMIN_ID', data: {} };
            return bot.sendMessage(chatId, '👮 *SISTEMA DE ADMINISTRADORES*\n\nPor favor, escribe el **ID de Telegram** del usuario que deseas convertir en Admin o cuyos permisos quieres editar:\n\n_(Ejemplo: 123456789)_', { parse_mode: 'Markdown' });
        }

        if (text === '📋 Ver Usuarios' && (adminData.isSuper || adminData.perms.stats)) {
            const opts = {
                inline_keyboard: [
                    [{ text: '💰 Con Saldo', callback_data: 'viewu|saldo' }, { text: '💸 Sin Saldo', callback_data: 'viewu|nosaldo' }],
                    [{ text: '👥 Mostrar Todos', callback_data: 'viewu|todos' }]
                ]
            };
            return bot.sendMessage(chatId, '📋 *SISTEMA DE USUARIOS*\n\nElige el grupo de usuarios que deseas ver para tomar acción:', { parse_mode: 'Markdown', reply_markup: opts });
        }
        
        if (text === '📊 Estadísticas' && (adminData.isSuper || adminData.perms.stats)) {
            bot.sendMessage(chatId, '⏳ Recopilando datos del servidor...');
            
            const formatter = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Bogota', year: 'numeric', month: 'numeric', day: 'numeric' });
            const [month, day, year] = formatter.format(new Date()).split('/');
            const startOfDayTs = new Date(`${year}-${month}-${day}T00:00:00-05:00`).getTime();

            const usersSnap = await get(ref(db, 'users'));
            const productsSnap = await get(ref(db, 'products'));
            
            let totalUsers = 0; 
            let allTimeRecharges = 0; let allTimeSalesUsd = 0; let allTimeSalesCount = 0;
            let todayRecharges = 0; let todaySalesUsd = 0; let todaySalesCount = 0;
            
            if (usersSnap.exists()) {
                usersSnap.forEach(u => {
                    totalUsers++;
                    const ud = u.val();
                    if (ud.recharges) {
                        Object.values(ud.recharges).forEach(r => {
                            const amt = parseFloat(r.amount||0);
                            allTimeRecharges += amt;
                            if (r.date >= startOfDayTs) todayRecharges += amt;
                        });
                    }
                    if (ud.history) {
                        Object.values(ud.history).forEach(h => {
                            const price = parseFloat(h.price||0);
                            allTimeSalesCount++;
                            allTimeSalesUsd += price;
                            if (h.date >= startOfDayTs) { todaySalesCount++; todaySalesUsd += price; }
                        });
                    }
                });
            }
            
            let activeProducts = 0; let totalKeys = 0;
            if (productsSnap.exists()) {
                productsSnap.forEach(p => {
                    activeProducts++;
                    if (p.val().keys) totalKeys += Object.keys(p.val().keys).length;
                });
            }
            
            const msgStats = `📊 *DASHBOARD LUCK XIT*\n\n` +
            `📅 *ESTADÍSTICAS DE HOY*\n` +
            `💵 Recargado Hoy: *$${todayRecharges.toFixed(2)} USD*\n` +
            `🛍️ Ventas Hoy: *${todaySalesCount}* ($${todaySalesUsd.toFixed(2)} USD)\n\n` +
            `🌍 *ESTADÍSTICAS GLOBALES (Siempre)*\n` +
            `👥 Usuarios Totales: ${totalUsers}\n` +
            `💵 Dinero Recargado: $${allTimeRecharges.toFixed(2)} USD\n` +
            `🛍️ Ventas Totales: ${allTimeSalesCount} ($${allTimeSalesUsd.toFixed(2)} USD)\n\n` +
            `📦 *INVENTARIO*\n` +
            `Activos: ${activeProducts} Prod. | Stock: ${totalKeys} Keys`;
            
            return bot.sendMessage(chatId, msgStats, {parse_mode: 'Markdown'});
        }

        if (text === '🎟️ Crear Cupón' && (adminData.isSuper || adminData.perms.coupons)) {
            userStates[chatId] = { step: 'CREATE_COUPON_CODE', data: {} };
            return bot.sendMessage(chatId, '🎟️ *CREADOR DE CUPONES*\n\nEscribe la palabra o código promocional que los usuarios van a canjear (ej: Ofertazo20):', { parse_mode: 'Markdown' });
        }

        if (text === '🔨 Gest. Usuarios' && (adminData.isSuper || adminData.perms.users)) {
            userStates[chatId] = { step: 'MANAGE_USER', data: {} };
            return bot.sendMessage(chatId, '🔨 Escribe el **Username** exacto del usuario que deseas gestionar (Banear/Desbanear, Agregar/Quitar saldo):', { parse_mode: 'Markdown' });
        }

        if (text === '🛠️ Mantenimiento' && (adminData.isSuper || adminData.perms.maintenance)) {
            const settingsSnap = await get(ref(db, 'settings/maintenance'));
            const isMaint = settingsSnap.val() || false;
            const newMaint = !isMaint;
            
            await update(ref(db), { 'settings/maintenance': newMaint });
            
            notifySuperAdmin(webUser.username, tgId, 'Modificó Mantenimiento', `Estado cambiado a: ${newMaint ? 'ACTIVO 🔴' : 'INACTIVO 🟢'}`);
            return bot.sendMessage(chatId, `🛠️ *MODO MANTENIMIENTO*\n\nEl acceso a la tienda y comandos para usuarios está: **${newMaint ? 'CERRADO (En Mantenimiento) 🔴' : 'ABIERTO (Normal) 🟢'}**`, { parse_mode: 'Markdown' });
        }

        if (text === '🗑️ Eliminar Producto' && (adminData.isSuper || adminData.perms.products)) {
            const productsSnap = await get(ref(db, 'products'));
            if (!productsSnap.exists()) return bot.sendMessage(chatId, '❌ No hay productos creados.');
            
            let inlineKeyboard = [];
            productsSnap.forEach(child => {
                inlineKeyboard.push([{ text: `❌ Eliminar: ${child.val().name}`, callback_data: `delprod|${child.key}` }]);
            });
            return bot.sendMessage(chatId, `🗑️ *ELIMINAR PRODUCTO*\nSelecciona el producto que deseas eliminar permanentemente:`, { parse_mode: 'Markdown', reply_markup: { inline_keyboard: inlineKeyboard } });
        }

        if (text === '📝 Editar Producto' && (adminData.isSuper || adminData.perms.products)) {
            const productsSnap = await get(ref(db, 'products'));
            if (!productsSnap.exists()) return bot.sendMessage(chatId, '❌ No hay productos creados.');
            
            let inlineKeyboard = [];
            productsSnap.forEach(child => {
                inlineKeyboard.push([{ text: `✏️ Editar: ${child.val().name}`, callback_data: `seledit|${child.key}` }]);
            });
            return bot.sendMessage(chatId, `📝 *EDITAR PRODUCTO*\nSelecciona el producto que deseas modificar:`, { parse_mode: 'Markdown', reply_markup: { inline_keyboard: inlineKeyboard } });
        }
        
        if (text === '🔄 Revisar Reembolsos' && (adminData.isSuper || adminData.perms.refunds)) {
            userStates[chatId] = { step: 'WAITING_FOR_REFUND_KEY', data: {} };
            return bot.sendMessage(chatId, '🔎 *SISTEMA DE REEMBOLSOS (Global)*\n\nPor favor, pega y envía la **Key** exacta que deseas buscar y reembolsar:', { parse_mode: 'Markdown' });
        }

        if (text === '📢 Mensaje Global' && (adminData.isSuper || adminData.perms.broadcast)) {
            userStates[chatId] = { step: 'WAITING_FOR_BROADCAST_MESSAGE', data: {} };
            return bot.sendMessage(chatId, '📝 *MENSAJE GLOBAL*\n\nEscribe el mensaje que quieres enviarle a **todos los usuarios** del bot:\n\n_(Puedes incluir emojis o enlaces)_', { parse_mode: 'Markdown' });
        }

        if (text === '💰 Añadir Saldo' && (adminData.isSuper || adminData.perms.balance)) {
            userStates[chatId] = { step: 'ADD_BALANCE_USER', data: {} };
            return bot.sendMessage(chatId, 'Escribe el **Nombre de Usuario** exacto al que deseas añadir saldo:', { parse_mode: 'Markdown' });
        }
        
        if (text === '📦 Crear Producto' && (adminData.isSuper || adminData.perms.products)) {
            userStates[chatId] = { step: 'CREATE_PROD_NAME', data: {} };
            return bot.sendMessage(chatId, 'Escribe el **Nombre** del nuevo producto:', { parse_mode: 'Markdown' });
        }

        if (text === '🔑 Añadir Stock' && (adminData.isSuper || adminData.perms.products)) {
            const productsSnap = await get(ref(db, 'products'));
            if (!productsSnap.exists()) return bot.sendMessage(chatId, '❌ No hay productos creados.');
            
            let inlineKeyboard = [];
            productsSnap.forEach(child => {
                inlineKeyboard.push([{ text: `➕ Stock a: ${child.val().name}`, callback_data: `stock|${child.key}` }]);
            });
            return bot.sendMessage(chatId, `📦 Selecciona a qué producto vas a agregarle Keys:`, { reply_markup: { inline_keyboard: inlineKeyboard } });
        }
    }
});

bot.on('callback_query', async (query) => {
    const chatId = query.message.chat.id;
    const tgId = query.from.id;
    const data = query.data;
    bot.answerCallbackQuery(query.id);

    const webUid = await getAuthUser(tgId);
    if (!webUid) return bot.sendMessage(chatId, `🛑 Acceso revocado.`);

    const adminUserSnap = await get(ref(db, `users/${webUid}`));
    const adminUsername = adminUserSnap.exists() ? adminUserSnap.val().username : 'Desconocido';
    const webUser = adminUserSnap.val();

    const adminData = await getAdminData(tgId);

    if (adminData && adminData.isSuper) {
        if (data.startsWith('master_real|') || data.startsWith('master_falso|')) {
            const esReal = data.startsWith('master_real');
            const receiptId = data.split('|')[1];
            bot.editMessageReplyMarkup({ inline_keyboard: [] }, { chat_id: chatId, message_id: query.message.message_id });
            
            const reviewSnap = await get(ref(db, `verificaciones_pendientes/${receiptId}`));
            if (!reviewSnap.exists()) return bot.sendMessage(chatId, '⚠️ Este reporte ya fue gestionado.');

            const reviewData = reviewSnap.val();
            await remove(ref(db, `verificaciones_pendientes/${receiptId}`));

            bot.sendMessage(chatId, `✅ Le has notificado a tu cliente que el pago es *${esReal ? 'REAL' : 'FALSO'}*.`, { parse_mode: 'Markdown' });

            let veredictoMsg = `🔔 *VEREDICTO DE MASTER ADMIN*\n\nTu comprobante enviado a revisión ha sido analizado.\n\nResultado: `;
            veredictoMsg += esReal ? `🟢 **ES UN PAGO REAL**.\nPuedes ir a tu bot y aprobarle el saldo al usuario.` : `🔴 **ES UN PAGO FALSO/EDITADO**.\nTe recomendamos rechazar el pago en tu bot.`;
            
            bot.sendMessage(reviewData.ownerTgId, veredictoMsg, { parse_mode: 'Markdown' });
            return;
        }

        if (data.startsWith('tgp|')) {
            const parts = data.split('|');
            const targetTgId = parts[1];
            const permToToggle = parts[2];

            const adminRef = ref(db, `admins/${targetTgId}/perms/${permToToggle}`);
            const snap = await get(adminRef);
            const currentVal = snap.exists() ? snap.val() : false;
            
            await set(adminRef, !currentVal);
            
            const updatedSnap = await get(ref(db, `admins/${targetTgId}/perms`));
            bot.editMessageReplyMarkup(buildAdminManagerInline(targetTgId, updatedSnap.val()), { chat_id: chatId, message_id: query.message.message_id });
            return;
        }

        if (data.startsWith('deladm|')) {
            const targetTgId = data.split('|')[1];
            await remove(ref(db, `admins/${targetTgId}`));
            bot.editMessageText(`✅ *Administrador revocado.*\n\nEl ID \`${targetTgId}\` ya no tiene acceso al panel de control ni a comandos especiales.`, { chat_id: chatId, message_id: query.message.message_id, parse_mode: 'Markdown' });
            return;
        }
    }

    if (data.startsWith('rent_buy|')) {
        const targetUid = data.split('|')[1];
        const currentBal = parseFloat(webUser.balance || 0);

        if (currentBal < 10) {
            return bot.sendMessage(chatId, `❌ Saldo insuficiente. Tienes $${currentBal.toFixed(2)} USD y necesitas $10.00 USD. Recarga saldo primero.`);
        }

        bot.editMessageReplyMarkup({ inline_keyboard: [] }, { chat_id: chatId, message_id: query.message.message_id });
        
        await update(ref(db), { [`users/${targetUid}/balance`]: currentBal - 10 });
        
        userStates[chatId] = { step: 'WAITING_FOR_BOT_TOKEN', data: {} };
        bot.sendMessage(chatId, `✅ *Pago de $10 USD realizado con éxito.*\n\nVe a @BotFather en Telegram, crea un bot nuevo y **pégame el TOKEN** aquí abajo:\n\n_(Ejemplo: 71234567:AAHxj...)_`, { parse_mode: 'Markdown' });
        return;
    }

    if (data.startsWith('rent_toggle|')) {
        const targetUid = data.split('|')[1];
        const rentSnap = await get(ref(db, `rented_bots/${targetUid}`));
        const currentStatus = rentSnap.val().status;
        const newStatus = currentStatus === 'active' ? 'paused' : 'active';
        
        await update(ref(db), { [`rented_bots/${targetUid}/status`]: newStatus });
        
        if (newStatus === 'paused' && botsActivos[targetUid]) {
            botsActivos[targetUid].stopPolling();
            delete botsActivos[targetUid];
        } else if (newStatus === 'active') {
            iniciarSubBot(targetUid, rentSnap.val().botToken, tgId);
        }

        bot.editMessageText(`✅ Estado cambiado a: ${newStatus === 'active' ? '🟢 Activo' : '🔴 Pausado'}`, { chat_id: chatId, message_id: query.message.message_id });
        return;
    }

    if (adminData) {

        if (data.startsWith('toggle_pais|') && adminData.isSuper) {
            const countryCode = data.split('|')[1];
            return sistemaRecargas.togglePaisAdmin(bot, db, chatId, query.message.message_id, countryCode);
        }

        if (data.startsWith('viewu|') && (adminData.isSuper || adminData.perms.stats)) {
            const filter = data.split('|')[1];
            bot.editMessageText('⏳ Generando lista, por favor espera...', { chat_id: chatId, message_id: query.message.message_id });

            const usersSnap = await get(ref(db, 'users'));
            let inlineKeyboard = [];

            if (usersSnap.exists()) {
                usersSnap.forEach(u => {
                    const ud = u.val();
                    const saldo = parseFloat(ud.balance || 0);
                    let include = false;
                    
                    if (filter === 'saldo' && saldo > 0) include = true;
                    if (filter === 'nosaldo' && saldo <= 0) include = true;
                    if (filter === 'todos') include = true;

                    if (include) {
                        inlineKeyboard.push([{ text: `👤 ${ud.username} - $${saldo.toFixed(2)}`, callback_data: `usermenu|${u.key}` }]);
                    }
                });
            }

            if (inlineKeyboard.length === 0) {
                return bot.editMessageText('❌ No se encontraron usuarios con este filtro.', { chat_id: chatId, message_id: query.message.message_id });
            }

            if (inlineKeyboard.length > 90) {
                inlineKeyboard = inlineKeyboard.slice(0, 90); 
                bot.sendMessage(chatId, '⚠️ Mostrando los primeros 90 usuarios debido a límites de la plataforma.');
            }

            return bot.editMessageText('📋 *LISTA DE USUARIOS*\nToca el botón del usuario para tomar acciones:', { chat_id: chatId, message_id: query.message.message_id, reply_markup: { inline_keyboard: inlineKeyboard }, parse_mode: 'Markdown' });
        }

        if (data.startsWith('usermenu|') && (adminData.isSuper || adminData.perms.users || adminData.perms.stats)) {
            const targetUid = data.split('|')[1];
            await sendUserManageMenu(chatId, targetUid, bot);
            return;
        }

        if (data.startsWith('uact|') && (adminData.isSuper || adminData.perms.users || adminData.perms.balance)) {
            const parts = data.split('|');
            const action = parts[1];
            const targetUid = parts[2];

            if (action === 'banperm') {
                const uSnap = await get(ref(db, `users/${targetUid}`));
                const isBanned = uSnap.val().banned || false;
                await update(ref(db), { [`users/${targetUid}/banned`]: !isBanned, [`users/${targetUid}/banUntil`]: null });
                bot.editMessageText(`✅ Estado actualizado a **${!isBanned ? 'Baneado Permanente 🔴' : 'Desbaneado 🟢'}**.`, { chat_id: chatId, message_id: query.message.message_id, parse_mode: 'Markdown' });
                return;
            }

            if (action === 'bantemp') {
                userStates[chatId] = { step: 'TEMP_BAN_TIME', data: { targetUid: targetUid } };
                bot.sendMessage(chatId, '⏳ Escribe la cantidad de **horas** para el ban temporal (ej: 24, 48):');
                return;
            }

            if (action === 'addbal') {
                userStates[chatId] = { step: 'DIRECT_ADD_BAL', data: { targetUid: targetUid } };
                bot.sendMessage(chatId, '➕ Escribe la cantidad de **USD** a AGREGAR a este usuario:');
                return;
            }

            if (action === 'rembal') {
                userStates[chatId] = { step: 'DIRECT_REM_BAL', data: { targetUid: targetUid } };
                bot.sendMessage(chatId, '➖ Escribe la cantidad de **USD** a QUITAR a este usuario:');
                return;
            }
        }

        if (data.startsWith('cpntype|') && (adminData.isSuper || adminData.perms.coupons)) {
            const type = data.split('|')[1] === 'bal' ? 'balance' : 'discount';
            userStates[chatId].data.type = type;
            userStates[chatId].step = 'CREATE_COUPON_VALUE';
            bot.editMessageText(type === 'balance' ? '💵 Escribe la cantidad en **USD** que dará este cupón (ej: 1.5):' : '📉 Escribe el **porcentaje de descuento** que dará este cupón (ej: 15 para un 15%):', { chat_id: chatId, message_id: query.message.message_id, parse_mode: 'Markdown' });
            return;
        }

        if (data.startsWith('toggleban|') && (adminData.isSuper || adminData.perms.users)) {
            const targetUid = data.split('|')[1];
            const userSnap = await get(ref(db, `users/${targetUid}`));
            if (userSnap.exists()) {
                const isBanned = userSnap.val().banned || false;
                await update(ref(db), { [`users/${targetUid}/banned`]: !isBanned });
                bot.editMessageText(`✅ Estado actualizado. Usuario **${!isBanned ? 'Baneado 🔴' : 'Desbaneado 🟢'}**.`, { chat_id: chatId, message_id: query.message.message_id, parse_mode: 'Markdown' });
                
                notifySuperAdmin(adminUsername, tgId, 'Modificó Ban', `El usuario con ID ${targetUid} ahora está ${!isBanned ? 'Baneado 🔴' : 'Desbaneado 🟢'}`);
            }
            return;
        }

        if (data.startsWith('delprod|') && (adminData.isSuper || adminData.perms.products)) {
            const prodId = data.split('|')[1];
            await remove(ref(db, `products/${prodId}`));
            bot.editMessageText('✅ Producto eliminado exitosamente de la tienda.', { chat_id: chatId, message_id: query.message.message_id });
            
            notifySuperAdmin(adminUsername, tgId, 'Eliminó Producto', `Producto con ID: ${prodId}`);
            return;
        }

        if (data.startsWith('seledit|') && (adminData.isSuper || adminData.perms.products)) {
            const prodId = data.split('|')[1];
            const inlineKeyboard = [
                [{ text: '✏️ Cambiar Nombre', callback_data: `editp|name|${prodId}` }],
                [{ text: '💰 Cambiar Precio', callback_data: `editp|price|${prodId}` }],
                [{ text: '⏳ Cambiar Garantía', callback_data: `editp|warr|${prodId}` }]
            ];
            bot.editMessageText('⚙️ ¿Qué deseas editar de este producto?', { chat_id: chatId, message_id: query.message.message_id, reply_markup: { inline_keyboard: inlineKeyboard } });
            return;
        }

        if (data.startsWith('editp|') && (adminData.isSuper || adminData.perms.products)) {
            const parts = data.split('|');
            const field = parts[1]; 
            const prodId = parts[2];
            
            userStates[chatId] = { step: `EDIT_PROD_${field.toUpperCase()}`, data: { prodId: prodId } };
            
            let msg = '';
            if (field === 'name') msg = 'Escribe el **nuevo nombre** del producto:';
            else if (field === 'price') msg = 'Escribe el **nuevo precio** en USD (ej: 3.5):';
            else if (field === 'warr') msg = 'Escribe la **nueva garantía** en horas (ej: 24, o 0 para ilimitada):';
            
            bot.sendMessage(chatId, msg, { parse_mode: 'Markdown' });
            return;
        }

        if (data.startsWith('rfnd|') && (adminData.isSuper || adminData.perms.refunds)) {
            const parts = data.split('|');
            const targetUid = parts[1];
            const histId = parts[2];

            bot.editMessageReplyMarkup({ inline_keyboard: [] }, { chat_id: chatId, message_id: query.message.message_id });

            const userSnap = await get(ref(db, `users/${targetUid}`));
            if (userSnap.exists()) {
                const userData = userSnap.val();
                const compra = userData.history[histId];

                if (compra && !compra.refunded) {
                    const currentBal = parseFloat(userData.balance || 0);
                    const price = parseFloat(compra.price || 0);
                    const nuevoSaldo = currentBal + price;

                    const updates = {};
                    updates[`users/${targetUid}/balance`] = nuevoSaldo;
                    updates[`users/${targetUid}/history/${histId}/refunded`] = true; 

                    await update(ref(db), updates);

                    bot.sendMessage(chatId, `✅ *Reembolso completado.* Se devolvieron $${price} USD a la cuenta de ${userData.username}.`, { parse_mode: 'Markdown' });

                    const telegramAuthSnap = await get(ref(db, 'telegram_auth'));
                    let targetTgId = null;
                    if (telegramAuthSnap.exists()) {
                        telegramAuthSnap.forEach(child => {
                            if (child.val() === targetUid) targetTgId = child.key;
                        });
                    }

                    if (targetTgId) {
                        bot.sendMessage(targetTgId, `🔄 *REEMBOLSO APROBADO*\n\nSe te ha devuelto el dinero de la key de *${compra.product}*.\n💰 Se añadieron *$${price} USD* a tu saldo.\n💳 Nuevo saldo: *$${nuevoSaldo.toFixed(2)} USD*`, { parse_mode: 'Markdown' });
                    }

                    if (userData.whatsapp) {
                        enviarNotificacionWA(userData.whatsapp, `🔄 *REEMBOLSO APROBADO*\n\nTe hemos devuelto el dinero de tu compra fallida.\n\n💵 *Añadido:* $${price} USD\n💎 *Saldo Actual:* $${nuevoSaldo.toFixed(2)} USD`);
                    }
                    
                    notifySuperAdmin(adminUsername, tgId, 'Aprobó Reembolso', `Devolvió $${price} USD a la cuenta de ${userData.username}`);

                } else {
                    bot.sendMessage(chatId, '❌ Hubo un error. La compra no existe o ya fue reembolsada.');
                }
            } else {
                bot.sendMessage(chatId, '❌ Usuario no encontrado en la base de datos.');
            }
            return;
        }

        if (data.startsWith('reject_refund|') && (adminData.isSuper || adminData.perms.refunds)) {
            const targetTgId = data.split('|')[1];
            bot.editMessageReplyMarkup({ inline_keyboard: [] }, { chat_id: chatId, message_id: query.message.message_id });
            
            userStates[chatId] = { step: 'WAITING_FOR_REJECT_REASON', data: { targetTgId: targetTgId } };
            bot.sendMessage(chatId, '✍️ *Por favor, escribe el motivo* por el cual se rechaza este reembolso (este mensaje se le enviará al usuario):', { parse_mode: 'Markdown' });
            return;
        }

        if (data === 'cancel_refund' && (adminData.isSuper || adminData.perms.refunds)) {
            bot.editMessageReplyMarkup({ inline_keyboard: [] }, { chat_id: chatId, message_id: query.message.message_id });
            return bot.sendMessage(chatId, '❌ Reembolso cancelado exitosamente.');
        }

        if (data.startsWith('ok_rech|') && (adminData.isSuper || adminData.perms.balance)) {
            const receiptId = data.split('|')[1];
            return sistemaRecargas.aprobarRecarga(bot, db, chatId, query.message.message_id, receiptId, adminUsername, tgId, notifySuperAdmin);
        }

        if (data.startsWith('no_rech|') && (adminData.isSuper || adminData.perms.balance)) {
            const receiptId = data.split('|')[1];
            return sistemaRecargas.rechazarRecarga(bot, db, chatId, query.message.message_id, receiptId, adminUsername, tgId, notifySuperAdmin);
        }

        if (data.startsWith('stock|') && (adminData.isSuper || adminData.perms.products)) {
            const prodId = data.split('|')[1];
            userStates[chatId] = { step: 'ADD_STOCK_KEYS', data: { prodId: prodId } };
            return bot.sendMessage(chatId, 'Pega todas las **Keys** ahora. Puedes separarlas por espacios, comas o saltos de línea:', { parse_mode: 'Markdown' });
        }
    }

    if (data.startsWith('sel_pais|')) {
        const countryCode = data.split('|')[1];
        if (userStates[chatId] && userStates[chatId].data) {
            return sistemaRecargas.seleccionarPais(bot, chatId, countryCode, userStates[chatId].data, userStates);
        }
        return bot.sendMessage(chatId, '❌ Tu sesión de recarga ha expirado. Por favor, solicítala de nuevo.');
    }

    if (data.startsWith('send_receipt|')) {
        const parts = data.split('|');
        const amountRequest = parseFloat(parts[1]);
        const countryCode = parts[2];
        return sistemaRecargas.solicitarComprobante(bot, db, chatId, webUid, amountRequest, countryCode, userStates);
    }

    if (data.startsWith('buy|')) {
        const productId = data.split('|')[1];
        bot.sendMessage(chatId, '⚙️ Procesando transacción...');

        const userSnap = await get(ref(db, `users/${webUid}`));
        const prodSnap = await get(ref(db, `products/${productId}`));
        
        let webUser = userSnap.val();
        let product = prodSnap.val();

        if (!webUser) return bot.sendMessage(chatId, '❌ Error: Usuario no encontrado en la base de datos.');
        if (!product) return bot.sendMessage(chatId, '❌ Lo sentimos, este producto ya no existe o fue retirado.');

        let currentBalance = parseFloat(webUser.balance || 0);
        let activeDiscount = parseFloat(webUser.active_discount || 0);

        let finalPrice = product.price;
        if (activeDiscount > 0) {
            finalPrice = product.price - (product.price * (activeDiscount / 100));
        }

        if (currentBalance < finalPrice) return bot.sendMessage(chatId, '❌ Saldo insuficiente para esta compra.');
        
        if (product.keys && Object.keys(product.keys).length > 0) {
            const firstKeyId = Object.keys(product.keys)[0];
            const keyToDeliver = product.keys[firstKeyId];
            const warrantyHours = product.warranty || 0; 
            const keysRestantes = Object.keys(product.keys).length - 1; 

            const updates = {};
            updates[`products/${productId}/keys/${firstKeyId}`] = null; 
            updates[`users/${webUid}/balance`] = currentBalance - finalPrice; 
            
            if (activeDiscount > 0) {
                updates[`users/${webUid}/active_discount`] = null;
            }
            
            const historyRef = push(ref(db, `users/${webUid}/history`));
            updates[`users/${webUid}/history/${historyRef.key}`] = { 
                product: product.name, 
                key: keyToDeliver, 
                price: finalPrice, 
                date: Date.now(), 
                refunded: false,
                warrantyHours: warrantyHours 
            }; 

            await update(ref(db), updates);
            
            let exitoMsg = `✅ *¡COMPRA EXITOSA!*\n\nTu Key es:\n\n\`${keyToDeliver}\``;
            if (activeDiscount > 0) {
                exitoMsg += `\n\n🎟️ _Se aplicó tu descuento del ${activeDiscount}% a esta compra. Pagaste $${finalPrice.toFixed(2)} USD._`;
            }
            
            bot.sendMessage(chatId, exitoMsg, { parse_mode: 'Markdown' });

            if (keysRestantes <= 3) {
                bot.sendMessage(SUPER_ADMIN_ID, `⚠️ *ALERTA DE STOCK BAJO*\n\nAl producto *${product.name}* le quedan solo **${keysRestantes}** keys disponibles.`, { parse_mode: 'Markdown' });
            }

        } else {
            bot.sendMessage(chatId, '❌ Producto agotado justo ahora.');
        }
    }
});

console.log('🤖 Bot LUCK XIT PRO V3 (WhatsApp + Telegram) iniciado...');
