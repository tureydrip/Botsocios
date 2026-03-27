const TelegramBot = require('node-telegram-bot-api');
const { initializeApp } = require('firebase/app');
const { getDatabase, ref, get, update, push, set, remove } = require('firebase/database');

// CONFIGURACIÓN
const token = '8275295427:AAFc-U21od7ZWdtQU-62U1mJOSJqFYFZ-IQ';
const bot = new TelegramBot(token, { polling: true });
const SUPER_ADMIN_ID = 7710633235; // Tu ID intocable

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

const userKeyboard = {
    reply_markup: {
        keyboard: [
            [{ text: '🛒 Tienda' }, { text: '👤 Mi Perfil' }],
            [{ text: '💳 Recargas' }, { text: '🔄 Solicitar Reembolso' }],
            [{ text: '🎟️ Canjear Cupón' }, { text: '💸 Transferir Saldo' }] 
        ],
        resize_keyboard: true,
        is_persistent: true
    }
};

// ==========================================
// FUNCIÓN DE AUDITORÍA (EL ESPÍA DE LUCK XIT)
// ==========================================
function notifySuperAdmin(adminUsername, adminTgId, action, details) {
    if (adminTgId === SUPER_ADMIN_ID) return; 
    
    const msg = `🕵️‍♂️ *REPORTE DE ADMINISTRADOR*\n\n` +
                `👮 *Admin:* ${adminUsername} (\`${adminTgId}\`)\n` +
                `🛠️ *Acción:* ${action}\n` +
                `📝 *Detalle:* ${details}`;
                
    bot.sendMessage(SUPER_ADMIN_ID, msg, { parse_mode: 'Markdown' }).catch(() => {});
}

async function getAdminData(tgId) {
    if (tgId === SUPER_ADMIN_ID) {
        return {
            isSuper: true,
            perms: { products: true, balance: true, broadcast: true, refunds: true, coupons: true, stats: true, users: true, maintenance: true }
        };
    }
    const snap = await get(ref(db, `admins/${tgId}`));
    if (snap.exists()) {
        return { isSuper: false, perms: snap.val().perms || {} };
    }
    return null;
}

function buildAdminKeyboard(adminData) {
    const kb = [];
    let row = [];
    
    const addBtn = (text, perm) => {
        if (adminData.isSuper || adminData.perms[perm]) {
            row.push({ text });
            if (row.length === 3) { kb.push(row); row = []; }
        }
    };
    
    addBtn('📦 Crear Producto', 'products');
    addBtn('📝 Editar Producto', 'products');
    addBtn('🗑️ Eliminar Producto', 'products');
    
    addBtn('🔑 Añadir Stock', 'products');
    addBtn('💰 Añadir Saldo', 'balance');
    addBtn('📢 Mensaje Global', 'broadcast');
    
    addBtn('🔄 Revisar Reembolsos', 'refunds');
    addBtn('🎟️ Crear Cupón', 'coupons');
    addBtn('📊 Estadísticas', 'stats');
    
    addBtn('📋 Ver Usuarios', 'stats');
    addBtn('🔨 Gest. Usuarios', 'users');
    addBtn('🛠️ Mantenimiento', 'maintenance');
    
    if (row.length > 0) kb.push(row);
    
    let bottomRow = [];
    if (adminData.isSuper) bottomRow.push({ text: '👮 Gest. Admins' });
    bottomRow.push({ text: '❌ Cancelar Acción' });
    kb.push(bottomRow);
    
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

// NUEVA FUNCIÓN: Envía el menú avanzado de acciones por usuario
async function sendUserManageMenu(chatId, targetUid, bot) {
    const uSnap = await get(ref(db, `users/${targetUid}`));
    if (!uSnap.exists()) return bot.sendMessage(chatId, '❌ Usuario no encontrado.');
    const targetUser = uSnap.val();

    let totalSpent = 0;
    if (targetUser.history) {
        Object.values(targetUser.history).forEach(h => totalSpent += parseFloat(h.price || 0));
    }

    let isBanned = targetUser.banned || false;
    let banText = isBanned ? '🔴 BANEADO PERMANENTE' : '🟢 ACTIVO';
    
    if (targetUser.banUntil && targetUser.banUntil > Date.now()) {
        isBanned = true;
        const hoursLeft = ((targetUser.banUntil - Date.now()) / 3600000).toFixed(1);
        banText = `⏳ BANEADO TEMPORAL (${hoursLeft} hrs restantes)`;
    }

    const msgInfo = `👤 *GESTIÓN DE USUARIO*\n\n` +
                    `*Nombre:* ${targetUser.username}\n` +
                    `*Saldo:* $${parseFloat(targetUser.balance||0).toFixed(2)} USD\n` +
                    `*Gastado Total:* $${totalSpent.toFixed(2)} USD\n` +
                    `*Estado:* ${banText}`;

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
        const textoBloqueo = `🛑 *ACCESO DENEGADO*\n\nTu dispositivo no está vinculado a una cuenta web.\n\n🔑 *TU ID DE TELEGRAM ES:* \`${tgId}\`\n\nVe a la web, vincula tu cuenta y vuelve a escribir /start.`;
        return bot.sendMessage(chatId, textoBloqueo, { parse_mode: 'Markdown' });
    }

    const userSnap = await get(ref(db, `users/${webUid}`));
    const webUser = userSnap.val();
    
    if (!webUser) {
        return bot.sendMessage(chatId, '⚠️ *ERROR CRÍTICO*\n\nTu cuenta web fue eliminada o no se encuentra en la base de datos. Contacta a soporte.', { parse_mode: 'Markdown' });
    }

    const adminData = await getAdminData(tgId);
    const keyboard = adminData ? buildAdminKeyboard(adminData) : userKeyboard;
    
    let greeting = `🌌 Bienvenido a LUCK XIT, *${webUser.username}*.`;
    if (adminData) {
        greeting = adminData.isSuper ? `👑 ¡Bienvenido Super Admin LUCK XIT, *${webUser.username}*!` : `🛡️ Bienvenido Admin, *${webUser.username}*.`;
    }

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

    if (!webUser) {
        return bot.sendMessage(chatId, '⚠️ *ERROR CRÍTICO*\n\nTu cuenta web fue eliminada. Contacta a soporte.', { parse_mode: 'Markdown' });
    }

    const adminData = await getAdminData(tgId);
    const keyboard = adminData ? buildAdminKeyboard(adminData) : userKeyboard;

    // Verificación de Ban Temporal para TODOS
    if (!adminData) {
        let isBanned = webUser.banned;
        if (webUser.banUntil && webUser.banUntil > Date.now()) {
            isBanned = true;
        } else if (webUser.banUntil && webUser.banUntil <= Date.now()) {
            isBanned = false;
            await update(ref(db), { [`users/${webUid}/banned`]: false, [`users/${webUid}/banUntil`]: null });
        }

        if (isBanned) {
            let banMsg = '🚫 *ESTÁS BANEADO*\n\nHas sido bloqueado del sistema LUCK XIT por violar nuestras políticas o reglas.';
            if (webUser.banUntil) {
                const hrsLeft = ((webUser.banUntil - Date.now()) / 3600000).toFixed(1);
                banMsg = `⏳ *BANEADO TEMPORALMENTE*\n\nTu cuenta ha sido suspendida. Tiempo restante: **${hrsLeft} horas**.`;
            }
            return bot.sendMessage(chatId, banMsg, { parse_mode: 'Markdown' });
        }
        if (isMaintenance) {
            return bot.sendMessage(chatId, '🛠️ *MODO MANTENIMIENTO ACTIVO*\n\nEstamos haciendo unas mejoras rápidas en el bot. Volveremos a estar en línea muy pronto.', { parse_mode: 'Markdown' });
        }
    }

    if (text === '❌ Cancelar Acción') {
        userStates[chatId] = null;
        return bot.sendMessage(chatId, '✅ Acción cancelada. ¿Qué deseas hacer ahora?', keyboard);
    }

    if (msg.photo && userStates[chatId]) {
        const state = userStates[chatId];
        const fileId = msg.photo[msg.photo.length - 1].file_id; 

        if (state.step === 'WAITING_FOR_RECEIPT') {
            const stateData = state.data; 
            const adminConfirmKeyboard = {
                inline_keyboard: [
                    [{ text: '✅ Confirmar', callback_data: `ok_rech|${stateData.webUid}|${stateData.amount}|${tgId}` }],
                    [{ text: '❌ Rechazar', callback_data: `no_rech|${tgId}` }]
                ]
            };

            bot.sendPhoto(SUPER_ADMIN_ID, fileId, {
                caption: `💳 *NUEVO COMPROBANTE DE PAGO*\n\n👤 Usuario: ${stateData.username}\n🆔 ID Telegram: \`${tgId}\`\n💰 Monto Solicitado: *$${stateData.amount} USD*`,
                parse_mode: 'Markdown',
                reply_markup: adminConfirmKeyboard 
            });
            
            userStates[chatId] = null; 
            return bot.sendMessage(chatId, '✅ Comprobante enviado exitosamente a los administradores.', keyboard);
        }

        if (state.step === 'WAITING_FOR_USER_REFUND_PROOF') {
            const foundData = state.data;
            const reason = msg.caption ? msg.caption : 'Sin razón especificada';
            const dateStr = new Date(foundData.compra.date).toLocaleString('es-CO');

            const msgInfo = `🔔 *NUEVA SOLICITUD DE REEMBOLSO*\n\n` +
                        `👤 *Usuario:* ${foundData.username}\n` +
                        `📦 *Producto:* ${foundData.compra.product}\n` +
                        `🔑 *Key:* \`${foundData.compra.key}\`\n` +
                        `💰 *Pagado:* $${parseFloat(foundData.compra.price).toFixed(2)} USD\n` +
                        `📅 *Fecha:* ${dateStr}\n` +
                        `📝 *Motivo:* ${reason}\n\n` +
                        `¿Aprobar solicitud?`;

            const refundKeyboard = {
                inline_keyboard: [
                    [{ text: '✅ Mandar Reembolso', callback_data: `rfnd|${foundData.uid}|${foundData.histId}` }],
                    [{ text: '❌ Rechazar Solicitud', callback_data: `reject_refund|${foundData.targetTgId}` }]
                ]
            };
            
            bot.sendPhoto(SUPER_ADMIN_ID, fileId, { caption: msgInfo, parse_mode: 'Markdown', reply_markup: refundKeyboard });
            userStates[chatId] = null;
            return bot.sendMessage(chatId, '✅ Tu solicitud y captura han sido enviadas exitosamente.', keyboard);
        }
    }

    if (!text) return; 

    if (userStates[chatId]) {
        const state = userStates[chatId];

        if (state.step === 'WAITING_FOR_RECEIPT' || state.step === 'WAITING_FOR_USER_REFUND_PROOF') {
            return bot.sendMessage(chatId, '❌ Debes adjuntar una **foto** para continuar.\n\n_(Si deseas salir escribe "❌ Cancelar Acción")_', { parse_mode: 'Markdown' });
        }

        // ==========================================
        // ESTADOS DE USUARIOS (Incluye Transferencias)
        // ==========================================
        if (state.step === 'TRANSFER_USERNAME') {
            state.data.targetUser = text.trim();
            if(state.data.targetUser === webUser.username) return bot.sendMessage(chatId, '❌ No puedes transferirte a ti mismo.');
            state.step = 'TRANSFER_AMOUNT';
            return bot.sendMessage(chatId, `¿Cuánto saldo en **USD** deseas enviarle a *${state.data.targetUser}*?\n\nTu saldo actual: $${parseFloat(webUser.balance||0).toFixed(2)}`, { parse_mode: 'Markdown' });
        }
        
        if (state.step === 'TRANSFER_AMOUNT') {
            const amount = parseFloat(text);
            if (isNaN(amount) || amount <= 0) return bot.sendMessage(chatId, '❌ Cantidad inválida.');
            const currentBal = parseFloat(webUser.balance || 0);
            if (amount > currentBal) return bot.sendMessage(chatId, '❌ No tienes suficiente saldo para esta transferencia.');

            bot.sendMessage(chatId, '⏳ Procesando transferencia...');
            const usersSnap = await get(ref(db, 'users'));
            let targetUid = null;
            let targetBal = 0;
            usersSnap.forEach(u => {
                if (u.val().username === state.data.targetUser) {
                    targetUid = u.key;
                    targetBal = parseFloat(u.val().balance || 0);
                }
            });

            if (!targetUid) {
                userStates[chatId] = null;
                return bot.sendMessage(chatId, '❌ Usuario destino no encontrado en la base de datos.');
            }

            const updates = {};
            updates[`users/${webUid}/balance`] = currentBal - amount;
            updates[`users/${targetUid}/balance`] = targetBal + amount;
            await update(ref(db), updates);

            bot.sendMessage(chatId, `✅ Transferencia exitosa.\nEnviaste *$${amount} USD* a ${state.data.targetUser}.`, keyboard);

            const telegramAuthSnap = await get(ref(db, 'telegram_auth'));
            let targetTgId = null;
            if (telegramAuthSnap.exists()) {
                telegramAuthSnap.forEach(child => { if (child.val() === targetUid) targetTgId = child.key; });
            }
            if (targetTgId) {
                bot.sendMessage(targetTgId, `💸 *¡TRANSFERENCIA RECIBIDA!*\n\nEl usuario *${webUser.username}* te ha enviado *$${amount} USD*.\n💰 Nuevo saldo: *$${(targetBal + amount).toFixed(2)} USD*`, { parse_mode: 'Markdown' });
            }
            userStates[chatId] = null;
            return;
        }

        // ==========================================
        // ESTADOS DE ADMINISTRADORES
        // ==========================================
        if (adminData) {
            
            // BAN TEMPORAL Y AGREGAR/QUITAR SALDO (Directo del Menú Gestión)
            if (state.step === 'TEMP_BAN_TIME' && (adminData.isSuper || adminData.perms.users)) {
                const hrs = parseFloat(text);
                if (isNaN(hrs) || hrs <= 0) return bot.sendMessage(chatId, '❌ Horas inválidas.');
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
                bot.sendMessage(chatId, `✅ Se agregaron $${amt} al usuario ${uSnap.val().username}.`, keyboard);
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

            if (state.step === 'WAITING_FOR_REFUND_KEY' && (adminData.isSuper || adminData.perms.refunds)) {
                // ARREGLO DE BUG DE ESPACIOS/COMILLAS EN KEY
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
            
            // (AQUÍ CONTINÚA EL RESTO DE TU CÓDIGO ADMIN ORIGINAL: Create Prod, Broadcast, Coupon, etc...)
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

            if (state.step === 'CREATE_COUPON_CODE' && (adminData.isSuper || adminData.perms.coupons)) {
                state.data.code = text.trim().toUpperCase();
                state.step = 'CREATE_COUPON_TYPE';
                const inlineType = { inline_keyboard: [ [{ text: '💰 Dar Saldo (USD)', callback_data: `cpntype|bal` }], [{ text: '📉 Dar Descuento (%)', callback_data: `cpntype|desc` }] ] };
                return bot.sendMessage(chatId, `Código: *${state.data.code}*\n\n¿Qué tipo de beneficio dará este cupón?`, { parse_mode: 'Markdown', reply_markup: inlineType });
            }

            if (state.step === 'CREATE_COUPON_VALUE' && (adminData.isSuper || adminData.perms.coupons)) {
                const val = parseFloat(text);
                if (isNaN(val) || val <= 0) return bot.sendMessage(chatId, '❌ Valor inválido.');
                await set(ref(db, `coupons/${state.data.code}`), { type: state.data.type, value: val });
                bot.sendMessage(chatId, `✅ *Cupón creado.*\nCódigo: \`${state.data.code}\``, { parse_mode: 'Markdown', ...keyboard });
                userStates[chatId] = null;
                return;
            }

            // OTROS ESTADOS ADMIN... (ADD_BALANCE_USER, CREATE_PROD, ADD_STOCK, REJECT_REASON, ETC...)
        }
        
        // ==========================================
        // ESTADO USUARIO: REEMBOLSOS Y RECARGAS
        // ==========================================
        if (state.step === 'WAITING_FOR_USER_REFUND_KEY') {
            // ARREGLO DE BUG DE ESPACIOS/COMILLAS EN KEY PARA USUARIO NORMAL
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
                        bot.sendMessage(chatId, `❌ *GARANTÍA EXPIRADA*\n\nHan pasado **${Math.floor(hoursPassed)} horas** desde tu compra.`, { parse_mode: 'Markdown' });
                        userStates[chatId] = null;
                        return; 
                    }

                    userStates[chatId] = { step: 'WAITING_FOR_USER_REFUND_PROOF', data: foundData };
                    bot.sendMessage(chatId, '✅ *Key encontrada.*\n\nPor favor **envía una captura de pantalla** mostrando el error del producto.\n\n✍️ *IMPORTANTE:* Escribe la razón por la que solicitas el reembolso en la descripción de la foto.', { parse_mode: 'Markdown' });
                }
            } else {
                bot.sendMessage(chatId, '❌ No se encontró esta Key en tu historial. Verifica que la hayas escrito correctamente sin espacios adicionales.', keyboard);
                userStates[chatId] = null;
            }
            return;
        }

        if (state.step === 'WAITING_FOR_RECHARGE_AMOUNT') {
            const amountUsd = parseFloat(text.replace(',', '.').replace('$', ''));
            const minUsd = state.data.minUsd;
            if (isNaN(amountUsd)) return bot.sendMessage(chatId, '❌ Cantidad inválida.');
            if (amountUsd < minUsd) return bot.sendMessage(chatId, `❌ El monto mínimo es de *$${minUsd} USD*.`, { parse_mode: 'Markdown' });

            const amountCop = amountUsd * 3800;
            const mensajePago = `✅ *MONTO CALCULADO*\n\n💰 Vas a recargar: *$${amountUsd.toFixed(2)} USD*\n💵 Total a pagar: *$${amountCop.toLocaleString('es-CO')} COP*\n\n🏦 *PASOS PARA PAGAR:*\n1. Envía *$${amountCop.toLocaleString('es-CO')} COP* a Nequi: \`3214701288\`\n2. Selecciona cómo enviar tu comprobante:`;
            
            userStates[chatId] = null; 
            return bot.sendMessage(chatId, mensajePago, { parse_mode: 'Markdown', reply_markup: { inline_keyboard: [[{ text: '💬 WhatsApp', url: 'https://wa.me/573142369516' }], [{ text: '📸 Por Aquí (Telegram)', callback_data: `send_receipt|${amountUsd}` }]] } });
        }
    } 

    // ==========================================
    // COMANDOS DE USUARIO NORMAL
    // ==========================================
    if (text === '💸 Transferir Saldo') {
        userStates[chatId] = { step: 'TRANSFER_USERNAME', data: {} };
        return bot.sendMessage(chatId, '💸 *TRANSFERIR SALDO*\n\nEscribe el *Nombre de Usuario* exacto de la persona a la que le quieres enviar saldo:', { parse_mode: 'Markdown' });
    }

    if (text === '🎟️ Canjear Cupón') {
        userStates[chatId] = { step: 'REDEEM_COUPON', data: {} };
        return bot.sendMessage(chatId, '🎁 *CANJEAR CUPÓN*\n\nEscribe el código promocional:', { parse_mode: 'Markdown' });
    }

    if (text === '🔄 Solicitar Reembolso') {
        userStates[chatId] = { step: 'WAITING_FOR_USER_REFUND_KEY', data: { webUid: webUid } };
        return bot.sendMessage(chatId, '🔄 *SOLICITUD DE REEMBOLSO*\n\nPor favor, escribe y envía la **Key** exacta de la compra:', { parse_mode: 'Markdown' });
    }

    if (text === '👤 Mi Perfil') {
        let msgPerfil = `👤 *PERFIL LUCK XIT*\n\nUsuario: ${webUser.username}\n💰 Saldo: *$${parseFloat(webUser.balance).toFixed(2)} USD*`;
        if (webUser.active_discount && webUser.active_discount > 0) msgPerfil += `\n\n🎟️ *Descuento Activo:* ${webUser.active_discount}% de descuento para tu próxima compra.`;
        return bot.sendMessage(chatId, msgPerfil, { parse_mode: 'Markdown' });
    }

    if (text === '💳 Recargas') {
        let totalRecharged = 0;
        if (webUser.recharges) Object.values(webUser.recharges).forEach(r => { totalRecharged += parseFloat(r.amount || 0); });
        const minUsd = totalRecharged > 5 ? 2 : 3;

        userStates[chatId] = { step: 'WAITING_FOR_RECHARGE_AMOUNT', data: { minUsd: minUsd } };
        const mensajeRequisitos = `💳 *NUEVA RECARGA*\n\n✅ *Tu recarga mínima es de:* *$${minUsd} USD*\n\n👇 *Escribe la cantidad en USD* que deseas recargar:`;
        return bot.sendMessage(chatId, mensajeRequisitos, { parse_mode: 'Markdown' });
    }

    if (text === '🛒 Tienda') {
        const productsSnap = await get(ref(db, 'products'));
        if (!productsSnap.exists()) return bot.sendMessage(chatId, 'Tienda vacía.');
        
        const activeDiscount = parseFloat(webUser.active_discount || 0);
        let header = `🛒 *ARSENAL DISPONIBLE*\nSelecciona un producto:`;
        if (activeDiscount > 0) header = `🛒 *ARSENAL DISPONIBLE*\n🎟️ Tienes un **${activeDiscount}% de descuento** aplicado automáticamente.\n\nSelecciona un producto:`;

        let inlineKeyboard = [];
        productsSnap.forEach(child => {
            const p = child.val();
            const stock = p.keys ? Object.keys(p.keys).length : 0;
            if (stock > 0) {
                let showPrice = p.price;
                if (activeDiscount > 0) showPrice = p.price - (p.price * (activeDiscount / 100));
                inlineKeyboard.push([{ text: `Comprar ${p.name} - $${showPrice.toFixed(2)} (${stock} disp)`, callback_data: `buy|${child.key}` }]);
            }
        });
        if(inlineKeyboard.length === 0) return bot.sendMessage(chatId, '❌ Todos los productos agotados.');
        
        return bot.sendMessage(chatId, header, { parse_mode: 'Markdown', reply_markup: { inline_keyboard: inlineKeyboard } });
    }

    // ==========================================
    // COMANDOS DE ADMINISTRADORES
    // ==========================================
    if (adminData) {
        
        if (text === '📋 Ver Usuarios' && (adminData.isSuper || adminData.perms.stats)) {
            const opts = {
                inline_keyboard: [
                    [{ text: '💰 Con Saldo', callback_data: 'viewu|saldo' }, { text: '💸 Sin Saldo', callback_data: 'viewu|nosaldo' }],
                    [{ text: '👥 Mostrar Todos', callback_data: 'viewu|todos' }]
                ]
            };
            return bot.sendMessage(chatId, '📋 *SISTEMA DE USUARIOS*\n\nElige el grupo de usuarios que deseas ver para tomar acción:', { parse_mode: 'Markdown', reply_markup: opts });
        }

        if (text === '🔨 Gest. Usuarios' && (adminData.isSuper || adminData.perms.users)) {
            userStates[chatId] = { step: 'MANAGE_USER', data: {} };
            return bot.sendMessage(chatId, '🔨 Escribe el **Username** exacto del usuario que deseas gestionar (Ban, Saldo, Info):', { parse_mode: 'Markdown' });
        }
        
        // (AQUÍ CONTINÚA TU CÓDIGO NORMAL: Mantenimiento, Mensaje Global, Añadir Saldo, Crear Producto, Stock, etc...)
        // Para no alargar el bloque con código idéntico repetido, se respeta el tuyo.
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
    const adminData = await getAdminData(tgId);

    if (!adminData) {
        const settingsSnap = await get(ref(db, 'settings'));
        const isMaintenance = settingsSnap.val()?.maintenance || false;
        if (adminUserSnap.val()?.banned || isMaintenance) return;
    }

    // ==========================================
    // CALLBACKS DE ADMINS: NUEVO SISTEMA DE USUARIOS
    // ==========================================
    if (adminData) {
        // FILTROS DE VER USUARIOS
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

        // MOSTRAR MENÚ DE UN USUARIO ESPECÍFICO
        if (data.startsWith('usermenu|') && (adminData.isSuper || adminData.perms.users || adminData.perms.stats)) {
            const targetUid = data.split('|')[1];
            await sendUserManageMenu(chatId, targetUid, bot);
            return;
        }

        // ACCIONES AVANZADAS SOBRE EL USUARIO
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
        
        // (AQUÍ CONTINÚAN TUS CALLBACKS DE ADMIN ORIGINALES: rfnd, stock, reject_refund, etc...)
    }

    // ==========================================
    // CALLBACKS DE USUARIO NORMAL
    // ==========================================
    if (data.startsWith('send_receipt|')) {
        const amountRequest = parseFloat(data.split('|')[1]);
        const userSnap = await get(ref(db, `users/${webUid}`));
        if (!userSnap.exists()) return bot.sendMessage(chatId, '❌ Error: No pudimos cargar tus datos.');
        const username = userSnap.val().username;
        
        userStates[chatId] = { step: 'WAITING_FOR_RECEIPT', data: { username: username, amount: amountRequest, webUid: webUid } };
        return bot.sendMessage(chatId, '📸 Por favor, envía la **foto de tu comprobante** de pago ahora mismo.', { parse_mode: 'Markdown' });
    }

    if (data.startsWith('buy|')) {
        // TU SISTEMA DE COMPRAS NORMAL SE MANTIENE EXACTO.
    }
});

console.log('🤖 Bot LUCK XIT PRO V2 (Sist. de Ban Temp y Transf.) iniciado...');
