const TelegramBot = require('node-telegram-bot-api');
const { initializeApp } = require('firebase/app');
const { getDatabase, ref, get, update, push, set, remove } = require('firebase/database');
const sistemaRecargas = require('./recargas');

// CONFIGURACIÓN MASTER
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

// --- SISTEMAS BASE (RANGOS Y REFERIDOS) ---
async function getRanks(db) {
    const snap = await get(ref(db, 'settings/ranks'));
    if (snap.exists()) {
        const ranksObj = snap.val();
        return Object.keys(ranksObj).map(key => ({ id: key, ...ranksObj[key] })).sort((a, b) => b.minGastado - a.minGastado);
    } else {
        const defaultRanks = {
            elite: { nombre: '🌟 Élite', minGastado: 200, descuento: 2.50 },
            deluxe: { nombre: '🔥 Deluxe', minGastado: 150, descuento: 2.00 },
            diamante: { nombre: '💎 Diamante', minGastado: 100, descuento: 1.50 },
            premium: { nombre: '✨ Premium', minGastado: 50, descuento: 1.00 },
            vip: { nombre: '🎫 VIP', minGastado: 10, descuento: 0.50 },
            miembro: { nombre: '👤 Miembro', minGastado: 0, descuento: 0 }
        };
        await set(ref(db, 'settings/ranks'), defaultRanks);
        return Object.keys(defaultRanks).map(key => ({ id: key, ...defaultRanks[key] })).sort((a, b) => b.minGastado - a.minGastado);
    }
}

function calcularGastoTotal(historial) {
    let total = 0;
    if (historial) {
        Object.values(historial).forEach(compra => { if (!compra.refunded) total += parseFloat(compra.price || 0); });
    }
    return total;
}

async function obtenerRango(db, totalGastado) {
    const rangos = await getRanks(db);
    return rangos.find(r => totalGastado >= r.minGastado) || rangos[rangos.length - 1];
}

async function verificarBonoReferido(db, bot, targetUid, amountAdded) {
    const uSnap = await get(ref(db, `users/${targetUid}`));
    if (!uSnap.exists()) return;
    const user = uSnap.val();
    if (user.referredBy && !user.referralRewarded) {
        let totalRecharged = amountAdded; 
        if (user.recharges) Object.values(user.recharges).forEach(r => totalRecharged += parseFloat(r.amount || 0));
        
        if (totalRecharged >= 5 || amountAdded >= 5) {
            const inviterCode = user.referredBy;
            const codeSnap = await get(ref(db, `referral_codes/${inviterCode}`));
            if (codeSnap.exists()) {
                const inviterUid = codeSnap.val();
                const inviterSnap = await get(ref(db, `users/${inviterUid}`));
                if (inviterSnap.exists()) {
                    const inviterBal = parseFloat(inviterSnap.val().balance || 0);
                    await update(ref(db), { [`users/${inviterUid}/balance`]: inviterBal + 2, [`users/${targetUid}/referralRewarded`]: true });
                    const tgAuthSnap = await get(ref(db, `telegram_auth`));
                    let inviterTgId = null;
                    tgAuthSnap.forEach(child => { if (child.val() === inviterUid) inviterTgId = child.key; });
                    if (inviterTgId) bot.sendMessage(inviterTgId, `🎉 *¡BONO DE REFERIDO!*\n\nTu referido *${user.username}* acaba de realizar su primera recarga de $5 USD o más.\n🎁 Acabas de recibir *$2.00 USD* de saldo gratis.\n💰 Tu nuevo saldo es: *$${(inviterBal + 2).toFixed(2)} USD*`, { parse_mode: 'Markdown' });
                }
            }
        }
    }
}

// --- ESTADOS Y TECLADOS ---
const userStates = {}; 

const userKeyboard = {
    reply_markup: {
        keyboard: [
            [{ text: '🛒 Tienda' }, { text: '👤 Mi Perfil' }],
            [{ text: '💳 Recargas' }, { text: '🤝 Referidos' }],
            [{ text: '🎟️ Canjear Cupón' }, { text: '💸 Transferir Saldo' }],
            [{ text: '🔄 Resetear Key' }, { text: '🔄 Solicitar Reembolso' }] 
        ],
        resize_keyboard: true,
        is_persistent: true
    }
};

const cancelKeyboard = {
    reply_markup: {
        keyboard: [[{ text: '❌ Cancelar Acción' }]],
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
    if (tgId === SUPER_ADMIN_ID) return { isSuper: true, perms: { products: true, balance: true, broadcast: true, refunds: true, coupons: true, stats: true, users: true, maintenance: true } };
    const snap = await get(ref(db, `admins/${tgId}`));
    if (snap.exists()) return { isSuper: false, perms: snap.val().perms || {} };
    return null;
}

function buildAdminKeyboard(adminData) {
    const kb = []; let row = [];
    const addBtn = (text, perm) => { if (adminData.isSuper || adminData.perms[perm]) { row.push({ text }); if (row.length === 3) { kb.push(row); row = []; } } };
    
    addBtn('📦 Crear Producto', 'products'); addBtn('➕ Añadir Variante', 'products'); addBtn('📝 Editar Producto', 'products');
    addBtn('🗑️ Eliminar Producto', 'products'); addBtn('🔑 Añadir Stock', 'products'); addBtn('🎁 Regalar Producto', 'products'); 
    addBtn('💰 Añadir Saldo', 'balance'); addBtn('📢 Mensaje Global', 'broadcast'); addBtn('🔄 Revisar Reembolsos', 'refunds'); 
    addBtn('🎟️ Crear Cupón', 'coupons'); addBtn('📊 Estadísticas', 'stats'); addBtn('📋 Ver Usuarios', 'stats'); 
    addBtn('📜 Historial Usuario', 'stats'); addBtn('🔨 Gest. Usuarios', 'users'); addBtn('🛠️ Mantenimiento', 'maintenance'); 
    addBtn('🏆 Gest. Rangos', 'products'); 
    
    if (row.length > 0) kb.push(row);
    let bottomRow = [];
    if (adminData.isSuper) { bottomRow.push({ text: '🔍 Ver Keys/Eliminar' }); bottomRow.push({ text: '👮 Gest. Admins' }); bottomRow.push({ text: '🌍 Gest. Países' }); }
    bottomRow.push({ text: '❌ Cancelar Acción' }); kb.push(bottomRow);
    
    return { reply_markup: { keyboard: kb, resize_keyboard: true, is_persistent: true } };
}

function buildAdminManagerInline(targetTgId, perms) {
    const p = (perm) => perms[perm] ? '🟢' : '🔴';
    return {
        inline_keyboard: [
            [{ text: `${p('products')} Productos/Stock`, callback_data: `tgp|${targetTgId}|products` }],
            [{ text: `${p('balance')} Añadir Saldo`, callback_data: `tgp|${targetTgId}|balance` }, { text: `${p('refunds')} Reembolsos`, callback_data: `tgp|${targetTgId}|refunds` }],
            [{ text: `${p('coupons')} Cupones`, callback_data: `tgp|${targetTgId}|coupons` }, { text: `${p('stats')} Estadísticas`, callback_data: `tgp|${targetTgId}|stats` }],
            [{ text: `${p('users')} Gestión Usr`, callback_data: `tgp|${targetTgId}|users` }, { text: `${p('broadcast')} Mensaje Global`, callback_data: `tgp|${targetTgId}|broadcast` }],
            [{ text: `${p('maintenance')} Mantenimiento`, callback_data: `tgp|${targetTgId}|maintenance` }],
            [{ text: `🗑️ Revocar Admin`, callback_data: `deladm|${targetTgId}` }]
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
    const totalSpent = calcularGastoTotal(targetUser.history);
    const rangoActual = await obtenerRango(db, totalSpent);

    let isBanned = targetUser.banned || false;
    let banText = isBanned ? '🔴 BANEADO PERMANENTE' : '🟢 ACTIVO';
    if (targetUser.banUntil && targetUser.banUntil > Date.now()) {
        isBanned = true;
        banText = `⏳ BANEADO TEMPORAL (${((targetUser.banUntil - Date.now()) / 3600000).toFixed(1)} hrs restantes)`;
    }

    const msgInfo = `👤 *GESTIÓN DE USUARIO*\n\n*Nombre:* ${targetUser.username}\n*Saldo:* $${parseFloat(targetUser.balance||0).toFixed(2)} USD\n*Gastado Total:* $${totalSpent.toFixed(2)} USD\n*Rango:* ${rangoActual.nombre}\n*Estado:* ${banText}`;
    const inlineKeyboard = [
        [{ text: '➕ Agregar Saldo', callback_data: `uact|addbal|${targetUid}` }, { text: '➖ Quitar Saldo', callback_data: `uact|rembal|${targetUid}` }],
        [{ text: isBanned ? '✅ Desbanear' : '🔨 Ban Permanente', callback_data: `uact|banperm|${targetUid}` }, { text: '⏳ Ban Temporal', callback_data: `uact|bantemp|${targetUid}` }]
    ];
    bot.sendMessage(chatId, msgInfo, { parse_mode: 'Markdown', reply_markup: { inline_keyboard: inlineKeyboard } });
}

// --- COMANDOS PRINCIPALES ---
bot.onText(/\/start(?: (.*))?/, async (msg, match) => {
    const chatId = msg.chat.id;
    const tgId = msg.from.id;
    const refCodeParam = match[1] ? match[1].trim().toUpperCase() : null;
    userStates[chatId] = null; 

    const webUid = await getAuthUser(tgId);
    if (!webUid) return bot.sendMessage(chatId, `🛑 *ACCESO DENEGADO*\n\nTu dispositivo no está vinculado a una cuenta web.\n🔑 *TU ID DE TELEGRAM ES:* \`${tgId}\``, { parse_mode: 'Markdown' });

    const userSnap = await get(ref(db, `users/${webUid}`));
    const webUser = userSnap.val();
    if (!webUser) return bot.sendMessage(chatId, '⚠️ *ERROR CRÍTICO*\n\nTu cuenta web no se encuentra en la base de datos.', { parse_mode: 'Markdown' });

    if (refCodeParam && !webUser.referredBy && webUser.referralCode !== refCodeParam) {
        const codeSnap = await get(ref(db, `referral_codes/${refCodeParam}`));
        if (codeSnap.exists() && codeSnap.val() !== webUid) {
            await update(ref(db), { [`users/${webUid}/referredBy`]: refCodeParam });
            bot.sendMessage(chatId, `🤝 *¡CÓDIGO ACEPTADO!*\nHas sido invitado con el código \`${refCodeParam}\`.`, { parse_mode: 'Markdown' });
        }
    }

    const adminData = await getAdminData(tgId);
    const keyboard = adminData ? buildAdminKeyboard(adminData) : userKeyboard;
    let greeting = `🌌 Bienvenido a SociosXit, *${webUser.username}*.`;
    if (adminData) greeting = adminData.isSuper ? `👑 ¡Bienvenido Super Admin SociosXit, *${webUser.username}*!` : `🛡️ Bienvenido Admin cibernético, *${webUser.username}*.`;

    bot.sendMessage(chatId, `${greeting}\nUsa los botones de abajo para navegar.`, { parse_mode: 'Markdown', ...keyboard });
});

bot.on('message', async (msg) => {
    if (msg.text && msg.text.startsWith('/start')) return;
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
    if (!webUser) return;

    const adminData = await getAdminData(tgId);
    const keyboard = adminData ? buildAdminKeyboard(adminData) : userKeyboard;

    if (!adminData) {
        let isBanned = webUser.banned;
        if (webUser.banUntil && webUser.banUntil > Date.now()) isBanned = true;
        else if (webUser.banUntil && webUser.banUntil <= Date.now()) { isBanned = false; await update(ref(db), { [`users/${webUid}/banned`]: false, [`users/${webUid}/banUntil`]: null }); }
        if (isBanned) return bot.sendMessage(chatId, '🚫 *ESTÁS BANEADO*\nContacta a soporte.', { parse_mode: 'Markdown' });
        if (isMaintenance) return bot.sendMessage(chatId, '🛠️ *MODO MANTENIMIENTO ACTIVO*\nVolveremos pronto.', { parse_mode: 'Markdown' });
    }

    if (text === '❌ Cancelar Acción') {
        userStates[chatId] = null;
        return bot.sendMessage(chatId, '✅ Acción cancelada. ¿Qué deseas hacer ahora?', keyboard);
    }

    if (msg.photo && userStates[chatId]) {
        const state = userStates[chatId];
        const fileId = msg.photo[msg.photo.length - 1].file_id; 

        if (state.step === 'WAITING_FOR_RECEIPT') return sistemaRecargas.recibirFotoComprobante(bot, db, chatId, tgId, fileId, state.data, keyboard, SUPER_ADMIN_ID, userStates);
        
        if (state.step === 'WAITING_FOR_USER_REFUND_PROOF') {
            const foundData = state.data;
            const reason = msg.caption ? msg.caption : 'Sin razón especificada';
            const msgInfo = `🔔 *NUEVA SOLICITUD DE REEMBOLSO*\n\n👤 *Usuario:* ${foundData.username}\n📦 *Producto:* ${foundData.compra.product}\n🔑 *Key:* \`${foundData.compra.key}\`\n💰 *Pagado:* $${parseFloat(foundData.compra.price).toFixed(2)} USD\n📝 *Motivo:* ${reason}`;
            const refundKeyboard = { inline_keyboard: [[{ text: '✅ Mandar Reembolso', callback_data: `rfnd|${foundData.uid}|${foundData.histId}` }], [{ text: '❌ Rechazar Solicitud', callback_data: `reject_refund|${foundData.targetTgId}` }]] };
            bot.sendPhoto(SUPER_ADMIN_ID, fileId, { caption: msgInfo, parse_mode: 'Markdown', reply_markup: refundKeyboard });
            userStates[chatId] = null;
            return bot.sendMessage(chatId, '✅ Tu solicitud ha sido enviada. El Staff la revisará pronto.', keyboard);
        }
    }

    if (!text) return; 

    // --- ACCIONES GENERALES ---
    if (text === '🔄 Solicitar Reembolso') {
        userStates[chatId] = { step: 'WAITING_FOR_USER_REFUND_KEY', data: {} };
        return bot.sendMessage(chatId, '🔄 *SOLICITAR REEMBOLSO*\n\nPor favor, envía la **Key** de la compra que presenta problemas.', { parse_mode: 'Markdown', ...cancelKeyboard });
    }
    if (text === '🔄 Resetear Key') {
        userStates[chatId] = { step: 'WAITING_FOR_RESET_KEY', data: {} };
        return bot.sendMessage(chatId, '🔄 *RESETEO DE KEY*\n\nEnvía la **Key** que deseas resetear.', { parse_mode: 'Markdown', ...cancelKeyboard });
    }
    if (text === '💸 Transferir Saldo') {
        userStates[chatId] = { step: 'TRANSFER_USERNAME', data: {} };
        return bot.sendMessage(chatId, '💸 *TRANSFERIR SALDO*\n\nEscribe el *Nombre de Usuario* exacto:', { parse_mode: 'Markdown', ...cancelKeyboard });
    }
    if (text === '🎟️ Canjear Cupón') {
        userStates[chatId] = { step: 'REDEEM_COUPON', data: {} };
        return bot.sendMessage(chatId, '🎁 *CANJEAR CUPÓN*\n\nEscribe el código promocional:', { parse_mode: 'Markdown', ...cancelKeyboard });
    }
    if (text === '💳 Recargas') return sistemaRecargas.iniciarRecarga(bot, db, chatId, webUser, userStates);
    if (text === '👤 Mi Perfil') {
        const totalGastado = calcularGastoTotal(webUser.history);
        const rangoActual = await obtenerRango(db, totalGastado);
        let msgPerfil = `👤 *PERFIL SociosXit*\n\nUsuario: ${webUser.username}\n💰 Saldo: *$${parseFloat(webUser.balance).toFixed(2)} USD*\n\n🏆 *Rango Actual:* ${rangoActual.nombre}\n📈 *Total Gastado:* $${totalGastado.toFixed(2)} USD\n💸 *Descuento de Rango:* -$${parseFloat(rangoActual.descuento || 0).toFixed(2)} USD`;
        if (webUser.active_discount > 0) msgPerfil += `\n\n🎟️ *Cupón Activo:* ${webUser.active_discount}% EXTRA OFF.`;
        return bot.sendMessage(chatId, msgPerfil, { parse_mode: 'Markdown' });
    }
    if (text === '🤝 Referidos') {
        let miCodigo = webUser.referralCode;
        if (!miCodigo) {
            miCodigo = 'LUCK-' + Math.random().toString(36).substring(2, 7).toUpperCase();
            await update(ref(db), { [`users/${webUid}/referralCode`]: miCodigo, [`referral_codes/${miCodigo}`]: webUid });
        }
        const botInfo = await bot.getMe();
        let msgRef = `🤝 *SISTEMA DE REFERIDOS*\n\nInvita y gana saldo. Por recarga de **$5 USD**, recibes **$2 USD**.\n🎟️ *Código:* \`${miCodigo}\`\n🔗 *Enlace:*\n\`https://t.me/${botInfo.username}?start=${miCodigo}\``;
        if (!webUser.referredBy) { userStates[chatId] = { step: 'WAITING_FOR_REF_CODE', data: {} }; msgRef += `\n\n✍️ *¿Alguien te invitó?*\nEscribe su código.`; }
        return bot.sendMessage(chatId, msgRef, { parse_mode: 'Markdown' });
    }
    if (text === '🛒 Tienda') {
        const productsSnap = await get(ref(db, 'products'));
        if (!productsSnap.exists()) return bot.sendMessage(chatId, 'Tienda vacía en este momento.');
        const catKb = [ [{ text: '📱 Android', callback_data: 'tcat|Android' }, { text: '🍎 iPhone', callback_data: 'tcat|iPhone' }], [{ text: '💻 PC', callback_data: 'tcat|PC' }] ];
        return bot.sendMessage(chatId, `🛒 *ARSENAL DISPONIBLE*\n\nSelecciona la plataforma:`, { parse_mode: 'Markdown', reply_markup: { inline_keyboard: catKb } });
    }

    // --- MANEJO DE ESTADOS DE TEXTO ---
    if (userStates[chatId]) {
        const state = userStates[chatId];

        if (state.step === 'HISTORY_USER' && (adminData.isSuper || adminData.perms.stats)) {
            const targetUsername = text.trim();
            const usersSnap = await get(ref(db, 'users'));
            let targetUser = null;
            usersSnap.forEach(u => { if (u.val().username === targetUsername) targetUser = u.val(); });
            if (!targetUser) return bot.sendMessage(chatId, '❌ Usuario no encontrado.');
            if (!targetUser.history || Object.keys(targetUser.history).length === 0) { userStates[chatId] = null; return bot.sendMessage(chatId, '📜 Sin compras.'); }
            let histText = `📜 *COMPRAS DE ${targetUsername}*\n\n`;
            Object.values(targetUser.history).sort((a, b) => b.date - a.date).slice(0, 15).forEach((c, index) => {
                histText += `*${index + 1}. ${c.product}*\n🔑 \`${c.key}\`\n💵 $${c.price} USD | ${new Date(c.date).toLocaleString('es-CO')}\n🛡️ ${c.refunded ? '🔴 REEMBOLSADO' : '🟢 OK'}\n\n`;
            });
            bot.sendMessage(chatId, histText, { parse_mode: 'Markdown' });
            userStates[chatId] = null; return;
        }

        // REGALAR PRODUCTO (USUARIO)
        if (state.step === 'GIFT_USER' && (adminData.isSuper || adminData.perms.products)) {
            const username = text.trim();
            const usersSnap = await get(ref(db, 'users'));
            let targetUid = null;
            usersSnap.forEach(u => { if (u.val().username === username) targetUid = u.key; });
            if (!targetUid) return bot.sendMessage(chatId, '❌ Usuario no encontrado.');
            
            const productsSnap = await get(ref(db, 'products'));
            let kb = [];
            productsSnap.forEach(child => { kb.push([{ text: `🎁 ${child.val().name}`, callback_data: `gift_prod|${targetUid}|${child.key}` }]); });
            bot.sendMessage(chatId, `🎁 Selecciona el producto a regalar a ${username}:`, { reply_markup: { inline_keyboard: kb } });
            userStates[chatId] = null; return;
        }

        if (state.step === 'WAITING_FOR_REF_CODE') {
            const inputCode = text.trim().toUpperCase();
            if (inputCode === webUser.referralCode) return bot.sendMessage(chatId, '❌ Código propio.');
            const codeSnap = await get(ref(db, `referral_codes/${inputCode}`));
            if (!codeSnap.exists()) return bot.sendMessage(chatId, '❌ Código inválido.');
            await update(ref(db), { [`users/${webUid}/referredBy`]: inputCode });
            bot.sendMessage(chatId, `✅ *Código enlazado.*`, { parse_mode: 'Markdown', ...keyboard });
            userStates[chatId] = null; return;
        }

        if (state.step === 'WAITING_FOR_RESET_KEY') {
            const searchKey = text.trim();
            let foundHistId = null; let keyData = null;
            if (webUser.history) {
                Object.keys(webUser.history).forEach(histId => {
                    if (webUser.history[histId].key.trim() === searchKey) { foundHistId = histId; keyData = webUser.history[histId]; }
                });
            }
            if (!foundHistId) return bot.sendMessage(chatId, '❌ Key no encontrada en tu historial.');
            const hoursPassed = (Date.now() - (keyData.lastReset || 0)) / (1000 * 60 * 60);
            if (hoursPassed < 7 && keyData.lastReset) return bot.sendMessage(chatId, `⏳ Espera ${(7 - hoursPassed).toFixed(1)} hrs.`, { parse_mode: 'Markdown' });
            await update(ref(db), { [`users/${webUid}/history/${foundHistId}/lastReset`]: Date.now() });
            bot.sendMessage(chatId, '✅ *Key reseteada con éxito.*', { parse_mode: 'Markdown', ...keyboard });
            userStates[chatId] = null; return;
        }

        if (state.step === 'WAITING_FOR_RECEIPT' || state.step === 'WAITING_FOR_USER_REFUND_PROOF') {
            return bot.sendMessage(chatId, '❌ Debes adjuntar una **foto (captura de pantalla)**.', { parse_mode: 'Markdown' });
        }

        if (state.step === 'TRANSFER_USERNAME') {
            if(text.trim() === webUser.username) return bot.sendMessage(chatId, '❌ No puedes auto-transferirte.');
            userStates[chatId].data.targetUser = text.trim();
            userStates[chatId].step = 'TRANSFER_AMOUNT';
            return bot.sendMessage(chatId, `¿Cuánto USD enviarás a *${text.trim()}*?`, { parse_mode: 'Markdown' });
        }
        if (state.step === 'TRANSFER_AMOUNT') {
            const amount = parseFloat(text);
            if (isNaN(amount) || amount <= 0 || amount > parseFloat(webUser.balance||0)) return bot.sendMessage(chatId, '❌ Cantidad inválida.');
            const usersSnap = await get(ref(db, 'users'));
            let targetUid = null; let targetBal = 0;
            usersSnap.forEach(u => { if (u.val().username === state.data.targetUser) { targetUid = u.key; targetBal = parseFloat(u.val().balance || 0); }});
            if (!targetUid) return bot.sendMessage(chatId, '❌ Usuario no encontrado.');
            
            await update(ref(db), { [`users/${webUid}/balance`]: parseFloat(webUser.balance) - amount, [`users/${targetUid}/balance`]: targetBal + amount });
            bot.sendMessage(chatId, `✅ Enviaste *$${amount} USD* a ${state.data.targetUser}.`, { parse_mode: 'Markdown', ...keyboard });
            const authSnap = await get(ref(db, 'telegram_auth'));
            authSnap.forEach(child => { if (child.val() === targetUid) bot.sendMessage(child.key, `💸 *RECIBISTE $${amount} USD* de ${webUser.username}.`, { parse_mode: 'Markdown' }); });
            userStates[chatId] = null; return;
        }

        if (state.step === 'REDEEM_COUPON') {
            const code = text.trim().toUpperCase();
            const couponSnap = await get(ref(db, `coupons/${code}`));
            if (!couponSnap.exists()) return bot.sendMessage(chatId, '❌ *CUPÓN INVÁLIDO*', { parse_mode: 'Markdown', ...keyboard });
            const userUsedCouponsSnap = await get(ref(db, `users/${webUid}/used_coupons/${code}`));
            if (userUsedCouponsSnap.exists()) return bot.sendMessage(chatId, '⚠️ *YA USASTE ESTE CUPÓN*', { parse_mode: 'Markdown', ...keyboard });
            
            const couponData = couponSnap.val();
            const updates = { [`users/${webUid}/used_coupons/${code}`]: true };
            if (couponData.type === 'balance') updates[`users/${webUid}/balance`] = parseFloat(webUser.balance || 0) + parseFloat(couponData.value);
            else updates[`users/${webUid}/active_discount`] = parseFloat(couponData.value);
            await update(ref(db), updates);
            bot.sendMessage(chatId, `🎉 *¡CUPÓN CANJEADO CON ÉXITO!*`, { parse_mode: 'Markdown', ...keyboard });
            userStates[chatId] = null; return;
        }

        // --- MANEJO ESTADOS ADMIN ---
        if (adminData) {
            
            // CREACIÓN
            if (state.step === 'CREATE_PROD_NAME' && (adminData.isSuper || adminData.perms.products)) {
                state.data.name = text; state.step = 'CREATE_PROD_CAT';
                const catKb = { inline_keyboard: [ [{ text: '📱 Android', callback_data: 'setcat|Android' }, { text: '🍎 iPhone', callback_data: 'setcat|iPhone' }], [{ text: '💻 PC', callback_data: 'setcat|PC' }] ] };
                return bot.sendMessage(chatId, 'Selecciona la **Categoría Principal**:', { parse_mode: 'Markdown', reply_markup: catKb });
            }
            if (state.step === 'CREATE_PROD_DURATION' && (adminData.isSuper || adminData.perms.products)) {
                state.data.duration = text; state.step = 'CREATE_PROD_PRICE';
                return bot.sendMessage(chatId, 'Ingresa el **Precio** en USD:', { parse_mode: 'Markdown' });
            }
            if (state.step === 'CREATE_PROD_PRICE' && (adminData.isSuper || adminData.perms.products)) {
                const price = parseFloat(text); if (isNaN(price)) return bot.sendMessage(chatId, '❌ Precio inválido.');
                state.data.price = price; state.step = 'CREATE_PROD_WARRANTY';
                return bot.sendMessage(chatId, 'Ingresa el **tiempo de garantía** en horas (0 = ilimitada):', { parse_mode: 'Markdown' });
            }
            if (state.step === 'CREATE_PROD_WARRANTY' && (adminData.isSuper || adminData.perms.products)) {
                const warranty = parseFloat(text); if (isNaN(warranty) || warranty < 0) return bot.sendMessage(chatId, '❌ Garantía inválida.');
                if (state.data.isAddingVariant) {
                    await set(push(ref(db, `products/${state.data.prodId}/durations`)), { duration: state.data.duration, price: state.data.price, warranty: warranty });
                    bot.sendMessage(chatId, `✅ Variante *${state.data.duration}* agregada.`, { parse_mode: 'Markdown', ...keyboard });
                } else {
                    const newProdRef = push(ref(db, 'products'));
                    const durId = push(ref(db, `products/${newProdRef.key}/durations`)).key;
                    await set(newProdRef, { name: state.data.name, category: state.data.category });
                    await set(ref(db, `products/${newProdRef.key}/durations/${durId}`), { duration: state.data.duration, price: state.data.price, warranty: warranty });
                    bot.sendMessage(chatId, `✅ Producto *${state.data.name}* creado.`, { parse_mode: 'Markdown', ...keyboard });
                }
                notifySuperAdmin(webUser.username, tgId, 'Creó Producto/Variante', `Garantía: ${warranty}h`);
                userStates[chatId] = null; return;
            }

            if (state.step === 'ADD_STOCK_KEYS' && (adminData.isSuper || adminData.perms.products)) {
                const cleanKeys = text.split(/[\n,\s]+/).map(k => k.trim()).filter(k => k.length > 0);
                if (cleanKeys.length === 0) { userStates[chatId] = null; return bot.sendMessage(chatId, '❌ Keys inválidas.'); }
                const updates = {};
                cleanKeys.forEach(k => updates[`products/${state.data.prodId}/durations/${state.data.durId}/keys/${push(ref(db)).key}`] = k );
                await update(ref(db), updates);
                bot.sendMessage(chatId, `✅ Se agregaron ${cleanKeys.length} keys a esta variante.`, keyboard);
                notifySuperAdmin(webUser.username, tgId, 'Añadió Stock', `${cleanKeys.length} keys al prod ID: ${state.data.prodId}`);
                userStates[chatId] = null; return;
            }

            // EDICIÓN
            if (state.step === 'EDIT_PROD_NAME' && (adminData.isSuper || adminData.perms.products)) {
                await update(ref(db), { [`products/${state.data.prodId}/name`]: text });
                bot.sendMessage(chatId, `✅ Nombre actualizado a: *${text}*`, { parse_mode: 'Markdown', ...keyboard });
                userStates[chatId] = null; return;
            }
            if (state.step.startsWith('EDIT_VAR_') && (adminData.isSuper || adminData.perms.products)) {
                const { prodId, durId } = state.data; const fieldType = state.step.split('_')[2]; 
                let updates = {};
                if (fieldType === 'PRICE') { const p = parseFloat(text); if(isNaN(p)) return; updates[`products/${prodId}/durations/${durId}/price`] = p; }
                else if (fieldType === 'WARR') { const w = parseFloat(text); if(isNaN(w)) return; updates[`products/${prodId}/durations/${durId}/warranty`] = w; }
                else if (fieldType === 'DUR') updates[`products/${prodId}/durations/${durId}/duration`] = text;
                await update(ref(db), updates);
                bot.sendMessage(chatId, `✅ Variante actualizada.`, keyboard);
                userStates[chatId] = null; return;
            }

            // GESTIÓN ADMINS / USUARIOS
            if (state.step === 'WAITING_FOR_ADMIN_ID' && adminData.isSuper) {
                const targetTgId = parseInt(text.trim()); if (isNaN(targetTgId) || targetTgId === SUPER_ADMIN_ID) return bot.sendMessage(chatId, '❌ ID Inválido.');
                const targetAdminSnap = await get(ref(db, `admins/${targetTgId}`));
                if (targetAdminSnap.exists()) {
                    bot.sendMessage(chatId, `⚙️ *Administrando a ID:* \`${targetTgId}\``, { parse_mode: 'Markdown', reply_markup: buildAdminManagerInline(targetTgId, targetAdminSnap.val().perms) });
                } else {
                    const currentPerms = { products: false, balance: false, broadcast: false, refunds: false, coupons: false, stats: false, users: false, maintenance: false };
                    await set(ref(db, `admins/${targetTgId}`), { perms: currentPerms });
                    bot.sendMessage(chatId, `✅ *Nuevo Administrador Creado*\n\nID: \`${targetTgId}\``, { parse_mode: 'Markdown', reply_markup: buildAdminManagerInline(targetTgId, currentPerms) });
                }
                userStates[chatId] = null; return;
            }

            if (state.step === 'MANAGE_USER' && (adminData.isSuper || adminData.perms.users)) {
                const username = text.trim(); const usersSnap = await get(ref(db, 'users')); let targetUid = null;
                usersSnap.forEach(u => { if (u.val().username === username) targetUid = u.key; });
                if (!targetUid) return bot.sendMessage(chatId, '❌ Usuario no encontrado.');
                await sendUserManageMenu(chatId, targetUid, bot);
                userStates[chatId] = null; return;
            }
            if (state.step === 'TEMP_BAN_TIME' && (adminData.isSuper || adminData.perms.users)) {
                const hrs = parseFloat(text); if (isNaN(hrs)) return bot.sendMessage(chatId, '❌ Horas inválidas.');
                await update(ref(db), { [`users/${state.data.targetUid}/banned`]: true, [`users/${state.data.targetUid}/banUntil`]: Date.now() + (hrs * 3600000) });
                bot.sendMessage(chatId, `✅ Usuario baneado temporalmente.`, keyboard); userStates[chatId] = null; return;
            }

            // SALDOS DIRECTOS
            if (state.step === 'ADD_BALANCE_USER' && (adminData.isSuper || adminData.perms.balance)) {
                state.data.targetUser = text.trim(); state.step = 'ADD_BALANCE_AMOUNT';
                return bot.sendMessage(chatId, `Dime la **cantidad** en USD a añadir para ${state.data.targetUser}:`, { parse_mode: 'Markdown' });
            }
            if (state.step === 'ADD_BALANCE_AMOUNT' && (adminData.isSuper || adminData.perms.balance)) {
                const amount = parseFloat(text); if (isNaN(amount)) return bot.sendMessage(chatId, '❌ Cantidad inválida.');
                const usersSnap = await get(ref(db, 'users')); let foundUid = null; let currentBal = 0; 
                usersSnap.forEach(c => { if (c.val().username === state.data.targetUser) { foundUid = c.key; currentBal = parseFloat(c.val().balance || 0); }});
                if (foundUid) {
                    await update(ref(db), { [`users/${foundUid}/balance`]: currentBal + amount, [`users/${foundUid}/recharges/${push(ref(db)).key}`]: { amount: amount, date: Date.now() }});
                    bot.sendMessage(chatId, `✅ Saldo añadido.`, keyboard);
                    const authSnap = await get(ref(db, 'telegram_auth'));
                    authSnap.forEach(c => { if(c.val() === foundUid) bot.sendMessage(c.key, `🎉 Se depositaron: *$${amount} USD* a tu saldo.`, { parse_mode: 'Markdown' }); });
                    await verificarBonoReferido(db, bot, foundUid, amount);
                }
                userStates[chatId] = null; return;
            }
            if (state.step === 'DIRECT_ADD_BAL' && (adminData.isSuper || adminData.perms.balance)) {
                const amt = parseFloat(text); if (isNaN(amt)) return;
                const uSnap = await get(ref(db, `users/${state.data.targetUid}`)); const currentBal = parseFloat(uSnap.val().balance || 0);
                await update(ref(db), { [`users/${state.data.targetUid}/balance`]: currentBal + amt }); bot.sendMessage(chatId, `✅ Saldo agregado.`, keyboard); userStates[chatId] = null; return;
            }
            if (state.step === 'DIRECT_REM_BAL' && (adminData.isSuper || adminData.perms.balance)) {
                const amt = parseFloat(text); if (isNaN(amt)) return;
                const uSnap = await get(ref(db, `users/${state.data.targetUid}`)); const currentBal = parseFloat(uSnap.val().balance || 0);
                await update(ref(db), { [`users/${state.data.targetUid}/balance`]: Math.max(0, currentBal - amt) }); bot.sendMessage(chatId, `✅ Saldo removido.`, keyboard); userStates[chatId] = null; return;
            }

            // BROADCAST / REEMBOLSOS / CUPONES / RANGOS
            if (state.step === 'WAITING_FOR_BROADCAST_MESSAGE' && (adminData.isSuper || adminData.perms.broadcast)) {
                const authSnap = await get(ref(db, 'telegram_auth')); let count = 0;
                authSnap.forEach(child => { bot.sendMessage(child.key, `📢 *Anuncio SociosXit*\n\n${text}`, { parse_mode: 'Markdown' }).catch(()=>{}); count++; });
                bot.sendMessage(chatId, `✅ Mensaje enviado a ${count} usuarios.`, keyboard); userStates[chatId] = null; return;
            }
            if (state.step === 'WAITING_FOR_REFUND_KEY' && (adminData.isSuper || adminData.perms.refunds)) {
                const searchKey = text.trim().replace(/`/g, '');
                const usersSnap = await get(ref(db, 'users')); let foundData = null;
                usersSnap.forEach(u => {
                    if (u.val().history) Object.keys(u.val().history).forEach(hId => { if (u.val().history[hId].key.trim() === searchKey) foundData = { uid: u.key, username: u.val().username, histId: hId, compra: u.val().history[hId] }; });
                });
                if (foundData) {
                    if (foundData.compra.refunded) return bot.sendMessage(chatId, '⚠️ *Key ya reembolsada.*', { parse_mode: 'Markdown' });
                    const msgInfo = `🧾 *COMPRA*\n👤 Usr: ${foundData.username}\n📦 Prod: ${foundData.compra.product}\n🔑 Key: \`${foundData.compra.key}\`\n💰 Pagado: $${foundData.compra.price}`;
                    bot.sendMessage(chatId, msgInfo, { parse_mode: 'Markdown', reply_markup: { inline_keyboard: [[{ text: '✅ Mandar Reembolso', callback_data: `rfnd|${foundData.uid}|${foundData.histId}` }], [{ text: '❌ Cancelar', callback_data: `cancel_refund` }]] } });
                } else bot.sendMessage(chatId, '❌ Key no encontrada.');
                userStates[chatId] = null; return;
            }
            if (state.step === 'WAITING_FOR_REJECT_REASON' && (adminData.isSuper || adminData.perms.refunds)) {
                bot.sendMessage(chatId, '✅ Razón enviada al usuario.', keyboard);
                bot.sendMessage(state.data.targetTgId, `❌ *REEMBOLSO RECHAZADO*\n\nMotivo:\n_${text.trim()}_`, { parse_mode: 'Markdown' });
                userStates[chatId] = null; return;
            }
            if (state.step === 'CREATE_COUPON_CODE' && (adminData.isSuper || adminData.perms.coupons)) {
                state.data.code = text.trim().toUpperCase(); state.step = 'CREATE_COUPON_TYPE';
                return bot.sendMessage(chatId, `¿Qué tipo de beneficio dará?`, { reply_markup: { inline_keyboard: [[{ text: '💰 Saldo USD', callback_data: `cpntype|bal` }], [{ text: '📉 Descuento %', callback_data: `cpntype|desc` }]] } });
            }
            if (state.step === 'CREATE_COUPON_VALUE' && (adminData.isSuper || adminData.perms.coupons)) {
                const val = parseFloat(text); if (isNaN(val)) return bot.sendMessage(chatId, '❌ Valor inválido.');
                await set(ref(db, `coupons/${state.data.code}`), { type: state.data.type, value: val });
                bot.sendMessage(chatId, `✅ *Cupón creado.*`, { parse_mode: 'Markdown', ...keyboard }); userStates[chatId] = null; return;
            }
            if (state.step === 'EDIT_RANK_MIN' && (adminData.isSuper || adminData.perms.products)) {
                await update(ref(db), { [`settings/ranks/${state.data.rankId}/minGastado`]: parseFloat(text) }); bot.sendMessage(chatId, '✅ Actualizado.', keyboard); userStates[chatId] = null; return;
            }
            if (state.step === 'EDIT_RANK_DESC' && (adminData.isSuper || adminData.perms.products)) {
                await update(ref(db), { [`settings/ranks/${state.data.rankId}/descuento`]: parseFloat(text) }); bot.sendMessage(chatId, '✅ Actualizado.', keyboard); userStates[chatId] = null; return;
            }
        }
        
        // REEMBOLSO USUARIO
        if (state.step === 'WAITING_FOR_USER_REFUND_KEY') {
            const searchKey = text.trim().replace(/`/g, '');
            let foundData = null;
            if (webUser.history) Object.keys(webUser.history).forEach(hId => { if (webUser.history[hId].key.trim() === searchKey) foundData = { uid: webUid, username: webUser.username, histId: hId, compra: webUser.history[hId], targetTgId: tgId }; });
            if (foundData) {
                if (foundData.compra.refunded) { userStates[chatId] = null; return bot.sendMessage(chatId, '⚠️ *Ya reembolsada.*', { parse_mode: 'Markdown' }); }
                const hrsPassed = (Date.now() - foundData.compra.date) / 3600000;
                if (foundData.compra.warrantyHours > 0 && hrsPassed > foundData.compra.warrantyHours) { userStates[chatId] = null; return bot.sendMessage(chatId, '❌ *GARANTÍA EXPIRADA*', { parse_mode: 'Markdown' }); }
                userStates[chatId] = { step: 'WAITING_FOR_USER_REFUND_PROOF', data: foundData };
                return bot.sendMessage(chatId, '✅ *Key válida.*\nEnvía una foto capturando el error.', { parse_mode: 'Markdown', ...cancelKeyboard });
            } else { userStates[chatId] = null; return bot.sendMessage(chatId, '❌ Key no encontrada.'); }
        }

        if (state.step === 'WAITING_FOR_RECHARGE_AMOUNT') return sistemaRecargas.procesarMonto(bot, chatId, text, state.data, userStates);
    } 

    // --- COMANDOS MENU ADMIN TEXTO ---
    if (adminData) {
        if (text === '📦 Crear Producto' && (adminData.isSuper || adminData.perms.products)) {
            userStates[chatId] = { step: 'CREATE_PROD_NAME', data: {} };
            return bot.sendMessage(chatId, 'Escribe el **Nombre General**:', { parse_mode: 'Markdown', ...cancelKeyboard });
        }
        if (text === '➕ Añadir Variante' && (adminData.isSuper || adminData.perms.products)) {
            const productsSnap = await get(ref(db, 'products')); let kb = [];
            if (productsSnap.exists()) productsSnap.forEach(c => kb.push([{ text: `➕ a: ${c.val().name}`, callback_data: `addvar|${c.key}` }]));
            return bot.sendMessage(chatId, `Selecciona el producto:`, { reply_markup: { inline_keyboard: kb } });
        }
        if (text === '🔑 Añadir Stock' && (adminData.isSuper || adminData.perms.products)) {
            const productsSnap = await get(ref(db, 'products')); let kb = [];
            if (productsSnap.exists()) productsSnap.forEach(c => kb.push([{ text: `📦 ${c.val().name}`, callback_data: `st_prod|${c.key}` }]));
            return bot.sendMessage(chatId, `Selecciona el producto:`, { reply_markup: { inline_keyboard: kb } });
        }
        if (text === '🎁 Regalar Producto' && (adminData.isSuper || adminData.perms.products)) {
            userStates[chatId] = { step: 'GIFT_USER', data: {} };
            return bot.sendMessage(chatId, '🎁 *REGALAR PRODUCTO*\n\nEscribe el **Username** exacto del usuario:', { parse_mode: 'Markdown', ...cancelKeyboard });
        }
        if (text === '📝 Editar Producto' && (adminData.isSuper || adminData.perms.products)) {
            const productsSnap = await get(ref(db, 'products')); let kb = [];
            if (productsSnap.exists()) productsSnap.forEach(c => kb.push([{ text: `⚙️ Opciones de: ${c.val().name}`, callback_data: `ed_prod|${c.key}` }]));
            return bot.sendMessage(chatId, `📝 Selecciona el producto a modificar:`, { reply_markup: { inline_keyboard: kb } });
        }
        if (text === '🗑️ Eliminar Producto' && (adminData.isSuper || adminData.perms.products)) {
            const productsSnap = await get(ref(db, 'products')); let kb = [];
            if (productsSnap.exists()) productsSnap.forEach(c => kb.push([{ text: `🗑️ En: ${c.val().name}`, callback_data: `sel_delprod|${c.key}` }]));
            return bot.sendMessage(chatId, `🗑️ *ELIMINACIÓN*\nSelecciona producto:`, { parse_mode: 'Markdown', reply_markup: { inline_keyboard: kb } });
        }
        if (text === '🔍 Ver Keys/Eliminar' && adminData.isSuper) {
            const productsSnap = await get(ref(db, 'products')); let kb = [];
            if (productsSnap.exists()) productsSnap.forEach(c => kb.push([{ text: `🔍 Ver: ${c.val().name}`, callback_data: `viewdel|${c.key}` }]));
            return bot.sendMessage(chatId, `🗑️ *CONTROL SUPREMO*\nSelecciona producto para extraer todas sus keys:`, { parse_mode: 'Markdown', reply_markup: { inline_keyboard: kb } });
        }
        if (text === '📊 Estadísticas' && (adminData.isSuper || adminData.perms.stats)) {
            const usersSnap = await get(ref(db, 'users')); const productsSnap = await get(ref(db, 'products'));
            let totalUsers = 0; let allTimeRecharges = 0; let allTimeSalesUsd = 0; let allTimeSalesCount = 0; let activeProducts = 0; let totalKeys = 0;
            if (usersSnap.exists()) usersSnap.forEach(u => { totalUsers++; if (u.val().recharges) Object.values(u.val().recharges).forEach(r => allTimeRecharges += parseFloat(r.amount||0)); if (u.val().history) Object.values(u.val().history).forEach(h => { allTimeSalesCount++; allTimeSalesUsd += parseFloat(h.price||0); }); });
            if (productsSnap.exists()) productsSnap.forEach(p => { activeProducts++; if (p.val().durations) Object.values(p.val().durations).forEach(dur => { if (dur.keys) totalKeys += Object.keys(dur.keys).length; }); });
            return bot.sendMessage(chatId, `📊 *DASHBOARD SociosXit*\n\n👥 Usuarios: ${totalUsers}\n💵 Recargas: $${allTimeRecharges.toFixed(2)}\n🛍️ Ventas: ${allTimeSalesCount} ($${allTimeSalesUsd.toFixed(2)})\n📦 Productos: ${activeProducts} | Keys Stock: ${totalKeys}`, { parse_mode: 'Markdown'});
        }
        if (text === '📢 Mensaje Global' && (adminData.isSuper || adminData.perms.broadcast)) { userStates[chatId] = { step: 'WAITING_FOR_BROADCAST_MESSAGE', data: {} }; return bot.sendMessage(chatId, '📝 *MENSAJE GLOBAL*\nEscribe el mensaje:', { parse_mode: 'Markdown', ...cancelKeyboard }); }
        if (text === '💰 Añadir Saldo' && (adminData.isSuper || adminData.perms.balance)) { userStates[chatId] = { step: 'ADD_BALANCE_USER', data: {} }; return bot.sendMessage(chatId, 'Escribe el **Username** exacto:', { parse_mode: 'Markdown', ...cancelKeyboard }); }
        if (text === '🏆 Gest. Rangos' && (adminData.isSuper || adminData.perms.products)) {
            const rangos = await getRanks(db); let kb = []; rangos.forEach(r => kb.push([{ text: `${r.nombre} - $${r.minGastado} USD`, callback_data: `editrank|${r.id}` }]));
            return bot.sendMessage(chatId, '🏆 *GESTOR RANGOS*', { parse_mode: 'Markdown', reply_markup: { inline_keyboard: kb } });
        }
        if (text === '🌍 Gest. Países' && adminData.isSuper) return sistemaRecargas.menuPaisesAdmin(bot, db, chatId);
        if (text === '👮 Gest. Admins' && adminData.isSuper) { userStates[chatId] = { step: 'WAITING_FOR_ADMIN_ID', data: {} }; return bot.sendMessage(chatId, '👮 *ID de Telegram del usuario:*', { parse_mode: 'Markdown', ...cancelKeyboard }); }
        if (text === '📋 Ver Usuarios' && (adminData.isSuper || adminData.perms.stats)) return bot.sendMessage(chatId, '📋 *USUARIOS*', { parse_mode: 'Markdown', reply_markup: { inline_keyboard: [ [{ text: '💰 Con Saldo', callback_data: 'viewu|saldo' }, { text: '💸 Sin Saldo', callback_data: 'viewu|nosaldo' }], [{ text: '👥 Todos', callback_data: 'viewu|todos' }] ] } });
        if (text === '🎟️ Crear Cupón' && (adminData.isSuper || adminData.perms.coupons)) { userStates[chatId] = { step: 'CREATE_COUPON_CODE', data: {} }; return bot.sendMessage(chatId, '🎟️ *CREADOR DE CUPONES*\nEscribe el código:', { parse_mode: 'Markdown', ...cancelKeyboard }); }
        if (text === '🔨 Gest. Usuarios' && (adminData.isSuper || adminData.perms.users)) { userStates[chatId] = { step: 'MANAGE_USER', data: {} }; return bot.sendMessage(chatId, '🔨 Escribe el **Username** exacto:', { parse_mode: 'Markdown', ...cancelKeyboard }); }
        if (text === '📜 Historial Usuario' && (adminData.isSuper || adminData.perms.stats)) { userStates[chatId] = { step: 'HISTORY_USER', data: {} }; return bot.sendMessage(chatId, '📜 Escribe el **Username** exacto:', { parse_mode: 'Markdown', ...cancelKeyboard }); }
        if (text === '🛠️ Mantenimiento' && (adminData.isSuper || adminData.perms.maintenance)) {
            const sSnap = await get(ref(db, 'settings/maintenance')); const nMaint = !(sSnap.val() || false);
            await update(ref(db), { 'settings/maintenance': nMaint }); return bot.sendMessage(chatId, `🛠️ *MANTENIMIENTO*: **${nMaint ? 'CERRADO 🔴' : 'ABIERTO 🟢'}**`, { parse_mode: 'Markdown' });
        }
        if (text === '🔄 Revisar Reembolsos' && (adminData.isSuper || adminData.perms.refunds)) { userStates[chatId] = { step: 'WAITING_FOR_REFUND_KEY', data: {} }; return bot.sendMessage(chatId, '🔎 *REEMBOLSOS GLOBALES*\nPega la Key:', { parse_mode: 'Markdown', ...cancelKeyboard }); }
    }
});

// --- CALLBACKS INLINE ---
bot.on('callback_query', async (query) => {
    const chatId = query.message.chat.id; const tgId = query.from.id; const data = query.data;
    bot.answerCallbackQuery(query.id);
    const webUid = await getAuthUser(tgId); if (!webUid) return bot.sendMessage(chatId, `🛑 Acceso revocado.`);
    const adminUserSnap = await get(ref(db, `users/${webUid}`)); const adminUsername = adminUserSnap.exists() ? adminUserSnap.val().username : 'Desconocido';
    const webUser = adminUserSnap.val(); const adminData = await getAdminData(tgId);

    // SUPREMO CALLBACKS
    if (adminData && adminData.isSuper) {
        if (data.startsWith('viewdel|')) {
            const prodId = data.split('|')[1]; const prodSnap = await get(ref(db, `products/${prodId}`)); if (!prodSnap.exists()) return; const p = prodSnap.val();
            let kText = `📦 *PRODUCTO:* ${p.name}\n\n*KEYS DISPONIBLES:*\n`;
            if (p.durations) Object.keys(p.durations).forEach(durId => { const dur = p.durations[durId]; kText += `\n⏱️ *${dur.duration}*:\n`; if (dur.keys && Object.keys(dur.keys).length > 0) Object.values(dur.keys).forEach(k => kText += `\`${k}\`\n`); else kText += `_(Sin stock)_\n`; });
            const opts = { inline_keyboard: [[{ text: '⚠️ PURGAR PRODUCTO COMPLETO', callback_data: `delprod_confirm|${prodId}` }]] };
            if (kText.length > 4000) kText = kText.substring(0, 4000) + '\n...[TRUNCADO]';
            return bot.sendMessage(chatId, kText, { parse_mode: 'Markdown', reply_markup: opts });
        }
        if (data.startsWith('delprod_confirm|')) { await remove(ref(db, `products/${data.split('|')[1]}`)); return bot.editMessageText('✅ Producto purgado.', { chat_id: chatId, message_id: query.message.message_id }); }
        if (data.startsWith('tgp|')) {
            const parts = data.split('|'); const aRef = ref(db, `admins/${parts[1]}/perms/${parts[2]}`); const snap = await get(aRef);
            await set(aRef, !(snap.exists() ? snap.val() : false)); const uSnap = await get(ref(db, `admins/${parts[1]}/perms`));
            return bot.editMessageReplyMarkup(buildAdminManagerInline(parts[1], uSnap.val()), { chat_id: chatId, message_id: query.message.message_id });
        }
        if (data.startsWith('deladm|')) { await remove(ref(db, `admins/${data.split('|')[1]}`)); return bot.editMessageText(`✅ Administrador revocado.`, { chat_id: chatId, message_id: query.message.message_id }); }
    }

    // ADMIN CALLBACKS
    if (adminData) {
        // Eliminar Menú
        if (data.startsWith('sel_delprod|') && (adminData.isSuper || adminData.perms.products)) {
            const prodId = data.split('|')[1]; const p = (await get(ref(db, `products/${prodId}`))).val(); let kb = [];
            if (p.durations) Object.keys(p.durations).forEach(dId => kb.push([{ text: `❌ Eliminar Variante: ${p.durations[dId].duration}`, callback_data: `del_var|${prodId}|${dId}` }]));
            kb.push([{ text: `⚠️ ELIMINAR TODO EL PRODUCTO`, callback_data: `del_fullprod|${prodId}` }]);
            return bot.editMessageText(`¿Qué deseas eliminar de *${p.name}*?`, { chat_id: chatId, message_id: query.message.message_id, parse_mode: 'Markdown', reply_markup: { inline_keyboard: kb } });
        }
        if (data.startsWith('del_var|') && (adminData.isSuper || adminData.perms.products)) { await remove(ref(db, `products/${data.split('|')[1]}/durations/${data.split('|')[2]}`)); return bot.editMessageText('✅ Variante eliminada.', { chat_id: chatId, message_id: query.message.message_id }); }
        if (data.startsWith('del_fullprod|') && (adminData.isSuper || adminData.perms.products)) { await remove(ref(db, `products/${data.split('|')[1]}`)); return bot.editMessageText('✅ Producto completo eliminado.', { chat_id: chatId, message_id: query.message.message_id }); }

        // Creación
        if (data.startsWith('setcat|')) { if (userStates[chatId] && userStates[chatId].step === 'CREATE_PROD_CAT') { userStates[chatId].data.category = data.split('|')[1]; userStates[chatId].step = 'CREATE_PROD_DURATION'; bot.editMessageText(`✅ Categoría lista. Escribe la **Duración**:`, {chat_id: chatId, message_id: query.message.message_id}); } return; }
        if (data.startsWith('addvar|')) { userStates[chatId] = { step: 'CREATE_PROD_DURATION', data: { isAddingVariant: true, prodId: data.split('|')[1] } }; return bot.editMessageText(`Escribe la **Nueva Duración**:`, {chat_id: chatId, message_id: query.message.message_id}); }
        
        // Stock
        if (data.startsWith('st_prod|')) {
            const prodId = data.split('|')[1]; const p = (await get(ref(db, `products/${prodId}`))).val(); if (!p.durations) return; let kb = [];
            Object.keys(p.durations).forEach(dId => kb.push([{ text: `⏱️ ${p.durations[dId].duration}`, callback_data: `st_dur|${prodId}|${dId}` }]));
            return bot.editMessageText(`📦 Selecciona Variante de *${p.name}*:`, { chat_id: chatId, message_id: query.message.message_id, parse_mode: 'Markdown', reply_markup: { inline_keyboard: kb } });
        }
        if (data.startsWith('st_dur|')) { userStates[chatId] = { step: 'ADD_STOCK_KEYS', data: { prodId: data.split('|')[1], durId: data.split('|')[2] } }; return bot.editMessageText('Pega todas las **Keys**:', { chat_id: chatId, message_id: query.message.message_id, parse_mode: 'Markdown' }); }

        // Regalar (Nuevo Flujo con Variantes)
        if (data.startsWith('gift_prod|') && (adminData.isSuper || adminData.perms.products)) {
            const [_, tUid, prodId] = data.split('|'); const p = (await get(ref(db, `products/${prodId}`))).val(); let kb = [];
            if (p.durations) Object.keys(p.durations).forEach(dId => kb.push([{ text: `🎁 Dar: ${p.durations[dId].duration}`, callback_data: `gift_do|${tUid}|${prodId}|${dId}` }]));
            return bot.editMessageText(`Selecciona la Variante a regalar:`, { chat_id: chatId, message_id: query.message.message_id, reply_markup: { inline_keyboard: kb } });
        }
        if (data.startsWith('gift_do|') && (adminData.isSuper || adminData.perms.products)) {
            bot.editMessageReplyMarkup({ inline_keyboard: [] }, { chat_id: chatId, message_id: query.message.message_id });
            const [_, tUid, prodId, durId] = data.split('|'); const p = (await get(ref(db, `products/${prodId}`))).val(); const tUser = (await get(ref(db, `users/${tUid}`))).val();
            const durInfo = p.durations[durId];
            if (durInfo.keys && Object.keys(durInfo.keys).length > 0) {
                const firstKeyId = Object.keys(durInfo.keys)[0]; const keyToDeliver = durInfo.keys[firstKeyId];
                await update(ref(db), { [`products/${prodId}/durations/${durId}/keys/${firstKeyId}`]: null, [`users/${tUid}/history/${push(ref(db)).key}`]: { product: `${p.name} - ${durInfo.duration}`, key: keyToDeliver, price: 0, date: Date.now(), refunded: false, warrantyHours: durInfo.warranty || 0 } });
                bot.sendMessage(chatId, `✅ *REGALO ENVIADO*\n\nKey: \`${keyToDeliver}\` dada a *${tUser.username}*`, { parse_mode: 'Markdown' });
                const authSnap = await get(ref(db, 'telegram_auth')); authSnap.forEach(c => { if(c.val() === tUid) bot.sendMessage(c.key, `🎁 *¡REGALO DEL STAFF!*\n\nProducto: *${p.name}*\n🔑 Key: \`${keyToDeliver}\``, { parse_mode: 'Markdown' }); });
            } else bot.sendMessage(chatId, '❌ Producto sin stock.');
            return;
        }

        // Editar
        if (data.startsWith('ed_prod|')) { return bot.editMessageText('¿Qué deseas modificar?', { chat_id: chatId, message_id: query.message.message_id, reply_markup: { inline_keyboard: [ [{ text: '✏️ Editar Nombre General', callback_data: `edit_pname|${data.split('|')[1]}` }], [{ text: '⚙️ Editar Variantes/Precios', callback_data: `list_vars|${data.split('|')[1]}` }] ] } }); }
        if (data.startsWith('edit_pname|')) { userStates[chatId] = { step: 'EDIT_PROD_NAME', data: { prodId: data.split('|')[1] } }; return bot.editMessageText('Escribe el **Nuevo Nombre General**:', { chat_id: chatId, message_id: query.message.message_id, parse_mode: 'Markdown' }); }
        if (data.startsWith('list_vars|')) {
            const p = (await get(ref(db, `products/${data.split('|')[1]}`))).val(); let kb = [];
            if (p.durations) Object.keys(p.durations).forEach(dId => kb.push([{ text: `✏️ Editar: ${p.durations[dId].duration}`, callback_data: `ed_dur|${data.split('|')[1]}|${dId}` }]));
            return bot.editMessageText(`Selecciona Variante de *${p.name}*:`, { chat_id: chatId, message_id: query.message.message_id, parse_mode: 'Markdown', reply_markup: { inline_keyboard: kb } });
        }
        if (data.startsWith('ed_dur|')) {
            const parts = data.split('|');
            return bot.editMessageText('⚙️ ¿Qué editarás?', { chat_id: chatId, message_id: query.message.message_id, reply_markup: { inline_keyboard: [ [{ text: '💰 Precio', callback_data: `editv|PRICE|${parts[1]}|${parts[2]}` }], [{ text: '⏱️ Nombre Duración', callback_data: `editv|DUR|${parts[1]}|${parts[2]}` }], [{ text: '⏳ Garantía', callback_data: `editv|WARR|${parts[1]}|${parts[2]}` }] ] } });
        }
        if (data.startsWith('editv|')) {
            const parts = data.split('|'); userStates[chatId] = { step: `EDIT_VAR_${parts[1]}`, data: { prodId: parts[2], durId: parts[3] } };
            bot.sendMessage(chatId, `Escribe el nuevo valor:`, { parse_mode: 'Markdown', ...cancelKeyboard }); return;
        }

        // Configuración Extra
        if (data.startsWith('editrank|')) { const rankId = data.split('|')[1]; return bot.editMessageText(`⚙️ *Editando Rango*`, { chat_id: chatId, message_id: query.message.message_id, parse_mode: 'Markdown', reply_markup: { inline_keyboard: [ [{ text: '💰 Editar Gasto Min', callback_data: `er_min|${rankId}` }], [{ text: '📉 Editar Descuento', callback_data: `er_desc|${rankId}` }] ] } }); }
        if (data.startsWith('er_min|')) { userStates[chatId] = { step: 'EDIT_RANK_MIN', data: { rankId: data.split('|')[1] } }; return bot.sendMessage(chatId, '💰 Escribe la nueva cantidad USD requerida:'); }
        if (data.startsWith('er_desc|')) { userStates[chatId] = { step: 'EDIT_RANK_DESC', data: { rankId: data.split('|')[1] } }; return bot.sendMessage(chatId, '📉 Escribe el nuevo descuento fijo en USD:'); }
        if (data.startsWith('toggle_pais|') && adminData.isSuper) return sistemaRecargas.togglePaisAdmin(bot, db, chatId, query.message.message_id, data.split('|')[1]);
        if (data.startsWith('viewu|')) {
            const filter = data.split('|')[1]; const usersSnap = await get(ref(db, 'users')); let kb = [];
            if (usersSnap.exists()) usersSnap.forEach(u => { const s = parseFloat(u.val().balance || 0); let inc = false; if(filter === 'saldo' && s > 0) inc = true; if(filter === 'nosaldo' && s <= 0) inc = true; if(filter === 'todos') inc = true; if(inc) kb.push([{ text: `👤 ${u.val().username} - $${s.toFixed(2)}`, callback_data: `usermenu|${u.key}` }]); });
            if (kb.length > 90) kb = kb.slice(0, 90);
            return bot.editMessageText('📋 *USUARIOS*', { chat_id: chatId, message_id: query.message.message_id, reply_markup: { inline_keyboard: kb }, parse_mode: 'Markdown' });
        }
        if (data.startsWith('usermenu|')) return sendUserManageMenu(chatId, data.split('|')[1], bot);
        if (data.startsWith('uact|')) {
            const parts = data.split('|'); const action = parts[1]; const tUid = parts[2];
            if (action === 'banperm') { const isBanned = (await get(ref(db, `users/${tUid}`))).val().banned || false; await update(ref(db), { [`users/${tUid}/banned`]: !isBanned, [`users/${tUid}/banUntil`]: null }); return bot.editMessageText(`✅ Estado actualizado.`, { chat_id: chatId, message_id: query.message.message_id }); }
            if (action === 'bantemp') { userStates[chatId] = { step: 'TEMP_BAN_TIME', data: { targetUid: tUid } }; return bot.sendMessage(chatId, '⏳ Escribe las horas de ban:'); }
            if (action === 'addbal') { userStates[chatId] = { step: 'DIRECT_ADD_BAL', data: { targetUid: tUid } }; return bot.sendMessage(chatId, '➕ USD a AGREGAR:'); }
            if (action === 'rembal') { userStates[chatId] = { step: 'DIRECT_REM_BAL', data: { targetUid: tUid } }; return bot.sendMessage(chatId, '➖ USD a QUITAR:'); }
        }
        if (data.startsWith('cpntype|')) { userStates[chatId].data.type = data.split('|')[1] === 'bal' ? 'balance' : 'discount'; userStates[chatId].step = 'CREATE_COUPON_VALUE'; return bot.editMessageText('Escribe el valor del cupón (USD o %):', { chat_id: chatId, message_id: query.message.message_id }); }
        
        // REEMBOLSO ADMIN
        if (data.startsWith('rfnd|') && (adminData.isSuper || adminData.perms.refunds)) {
            bot.editMessageReplyMarkup({ inline_keyboard: [] }, { chat_id: chatId, message_id: query.message.message_id });
            const [_, tUid, hId] = data.split('|'); const uData = (await get(ref(db, `users/${tUid}`))).val(); const c = uData.history[hId];
            if (c && !c.refunded) {
                const price = parseFloat(c.price || 0); const nSal = parseFloat(uData.balance || 0) + price;
                await update(ref(db), { [`users/${tUid}/balance`]: nSal, [`users/${tUid}/history/${hId}/refunded`]: true });
                bot.sendMessage(chatId, `✅ *Reembolso completado.* $${price} USD a ${uData.username}.`, { parse_mode: 'Markdown' });
                const authSnap = await get(ref(db, 'telegram_auth')); authSnap.forEach(ch => { if(ch.val() === tUid) bot.sendMessage(ch.key, `🔄 *REEMBOLSO APROBADO*\n💰+$${price} USD\n💳 Saldo: $${nSal.toFixed(2)}`, { parse_mode: 'Markdown' }); });
            }
            return;
        }
        if (data.startsWith('reject_refund|') && (adminData.isSuper || adminData.perms.refunds)) {
            bot.editMessageReplyMarkup({ inline_keyboard: [] }, { chat_id: chatId, message_id: query.message.message_id });
            userStates[chatId] = { step: 'WAITING_FOR_REJECT_REASON', data: { targetTgId: data.split('|')[1] } };
            return bot.sendMessage(chatId, '✍️ *Escribe el motivo del rechazo:*', { parse_mode: 'Markdown' });
        }
        if (data === 'cancel_refund' && (adminData.isSuper || adminData.perms.refunds)) { bot.editMessageReplyMarkup({ inline_keyboard: [] }, { chat_id: chatId, message_id: query.message.message_id }); return bot.sendMessage(chatId, '❌ Reembolso cancelado.'); }

        // RECARGAS ADMIN
        if (data.startsWith('ok_rech|') && (adminData.isSuper || adminData.perms.balance)) return sistemaRecargas.aprobarRecarga(bot, db, chatId, query.message.message_id, data.split('|')[1], adminUsername, tgId, notifySuperAdmin);
        if (data.startsWith('no_rech|') && (adminData.isSuper || adminData.perms.balance)) return sistemaRecargas.rechazarRecarga(bot, db, chatId, query.message.message_id, data.split('|')[1], adminUsername, tgId, notifySuperAdmin);
    }

    // --- CALLBACKS TIENDA USUARIO ---
    if (data.startsWith('tcat|')) {
        const cat = data.split('|')[1]; const productsSnap = await get(ref(db, 'products')); let kb = [];
        if (productsSnap.exists()) productsSnap.forEach(child => { if (child.val().category === cat) kb.push([{ text: `🎮 ${child.val().name}`, callback_data: `tprod|${child.key}` }]); });
        if (kb.length === 0) return bot.editMessageText(`❌ No hay productos en la categoría ${cat}.`, { chat_id: chatId, message_id: query.message.message_id });
        return bot.editMessageText(`📦 Productos en la categoría *${cat}*:`, { chat_id: chatId, message_id: query.message.message_id, parse_mode: 'Markdown', reply_markup: { inline_keyboard: kb } });
    }

    if (data.startsWith('tprod|')) {
        const prodId = data.split('|')[1]; const p = (await get(ref(db, `products/${prodId}`))).val();
        if (!p || !p.durations) return bot.editMessageText('❌ Producto sin opciones.', { chat_id: chatId, message_id: query.message.message_id });
        const rAct = await obtenerRango(db, calcularGastoTotal(webUser.history)); const aDesc = parseFloat(webUser.active_discount || 0); let kb = [];
        Object.keys(p.durations).forEach(durId => {
            const dur = p.durations[durId]; const stock = dur.keys ? Object.keys(dur.keys).length : 0;
            if (stock > 0) {
                let sPrice = dur.price; if (rAct.descuento > 0) sPrice = Math.max(0, sPrice - rAct.descuento); if (aDesc > 0) sPrice = sPrice - (sPrice * (aDesc / 100));
                kb.push([{ text: `${dur.duration} - $${sPrice.toFixed(2)} (${stock} disp)`, callback_data: `buy|${prodId}|${durId}` }]);
            }
        });
        if(kb.length === 0) return bot.editMessageText(`❌ Todas las variantes agotadas.`, { chat_id: chatId, message_id: query.message.message_id });
        return bot.editMessageText(`Selecciona la duración para *${p.name}*:`, { chat_id: chatId, message_id: query.message.message_id, parse_mode: 'Markdown', reply_markup: { inline_keyboard: kb } });
    }

    if (data.startsWith('buy|')) {
        const [_, productId, durId] = data.split('|'); const waitMsg = await bot.sendMessage(chatId, '⚙️ Procesando...');
        const p = (await get(ref(db, `products/${productId}`))).val(); if (!p || !p.durations || !p.durations[durId]) return bot.editMessageText('❌ Error de producto.', { chat_id: chatId, message_id: waitMsg.message_id });
        const durInfo = p.durations[durId]; const rAct = await obtenerRango(db, calcularGastoTotal(webUser.history)); const aDesc = parseFloat(webUser.active_discount || 0);
        let fPrice = durInfo.price; if (rAct.descuento > 0) fPrice = Math.max(0, fPrice - rAct.descuento); if (aDesc > 0) fPrice = fPrice - (fPrice * (aDesc / 100));
        if (parseFloat(webUser.balance || 0) < fPrice) return bot.editMessageText(`❌ Saldo insuficiente.\nPrecio: $${fPrice.toFixed(2)}\nSaldo: $${parseFloat(webUser.balance || 0).toFixed(2)}`, { chat_id: chatId, message_id: waitMsg.message_id });
        
        if (durInfo.keys && Object.keys(durInfo.keys).length > 0) {
            const firstKeyId = Object.keys(durInfo.keys)[0]; const keyToDeliver = durInfo.keys[firstKeyId]; const kRestantes = Object.keys(durInfo.keys).length - 1; 
            const updates = { [`products/${productId}/durations/${durId}/keys/${firstKeyId}`]: null, [`users/${webUid}/balance`]: parseFloat(webUser.balance || 0) - fPrice };
            if (aDesc > 0) updates[`users/${webUid}/active_discount`] = null;
            updates[`users/${webUid}/history/${push(ref(db)).key}`] = { product: `${p.name} - ${durInfo.duration}`, key: keyToDeliver, price: fPrice, date: Date.now(), refunded: false, warrantyHours: durInfo.warranty || 0 };
            await update(ref(db), updates);
            bot.editMessageText(`✅ *¡COMPRA EXITOSA!*\n\nTu Key es:\n\n\`${keyToDeliver}\``, { chat_id: chatId, message_id: waitMsg.message_id, parse_mode: 'Markdown' });
            if (kRestantes <= 3) bot.sendMessage(SUPER_ADMIN_ID, `⚠️ *ALERTA STOCK BAJO*\n${p.name} (${durInfo.duration}) = ${kRestantes} keys.`, { parse_mode: 'Markdown' });
        } else bot.editMessageText('❌ Agotado.', { chat_id: chatId, message_id: waitMsg.message_id });
    }

    if (data.startsWith('sel_pais|')) {
        if (userStates[chatId] && userStates[chatId].data) return sistemaRecargas.seleccionarPais(bot, chatId, data.split('|')[1], userStates[chatId].data, userStates);
        return bot.sendMessage(chatId, '❌ Tu sesión de recarga expiró.');
    }
    if (data.startsWith('send_receipt|')) return sistemaRecargas.solicitarComprobante(bot, db, chatId, webUid, parseFloat(data.split('|')[1]), data.split('|')[2], userStates);
});

module.exports = { verificarBonoReferido };
console.log('🤖 Bot SociosXit (Ultimate Edition) iniciado...');
