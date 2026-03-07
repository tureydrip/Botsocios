const TelegramBot = require('node-telegram-bot-api');
const { initializeApp } = require('firebase/app');
const { getDatabase, ref, get, update, push, set, remove } = require('firebase/database');

// CONFIGURACIÓN
const token = '8275295427:AAFc-U21od7ZWdtQU-62U1mJOSJqFYFZ-IQ';
const bot = new TelegramBot(token, { polling: true });
const SUPER_ADMIN = 7710633235; // EL JEFE (TÚ)

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

// --- NUEVO: TECLADOS REORGANIZADOS ---
const userKeyboard = {
    reply_markup: {
        keyboard: [
            [{ text: '🛒 Tienda' }, { text: '👤 Mi Perfil' }],
            [{ text: '💳 Recargas' }, { text: '🔄 Solicitar Reembolso' }] 
        ],
        resize_keyboard: true,
        is_persistent: true
    }
};

const adminKeyboard = {
    reply_markup: {
        keyboard: [
            [{ text: '📦 Prod & Stock' }, { text: '💰 Finanzas' }],
            [{ text: '💬 Comunicación' }, { text: '👥 Usuarios' }],
            [{ text: '👑 Gestión Admins' }], // Solo tú podrás usar este
            [{ text: '❌ Cancelar Acción' }]
        ],
        resize_keyboard: true,
        is_persistent: true
    }
};

// MIDDLEWARE: Verifica si es Admin y sus permisos
async function checkAdminPerms(tgId, permissionModule) {
    if (tgId === SUPER_ADMIN) return true; // El Super Admin tiene poder absoluto
    const adminSnap = await get(ref(db, `admins/${tgId}`));
    if (adminSnap.exists()) {
        const perms = adminSnap.val().perms || {};
        return perms[permissionModule] === true;
    }
    return false; // No es admin
}

// MIDDLEWARE: Obtener la lista de todos los IDs de admins para notificaciones
async function getAllAdmins() {
    let admins = [SUPER_ADMIN];
    const snap = await get(ref(db, 'admins'));
    if (snap.exists()) {
        snap.forEach(child => { admins.push(parseInt(child.key)); });
    }
    return [...new Set(admins)]; // Evitar duplicados
}

async function getAuthUser(telegramId) {
    const authSnap = await get(ref(db, `telegram_auth/${telegramId}`));
    if (authSnap.exists()) return authSnap.val();
    return null;
}

// 1. INICIO
bot.onText(/\/start/, async (msg) => {
    const chatId = msg.chat.id;
    const tgId = msg.from.id;
    userStates[chatId] = null; 

    const webUid = await getAuthUser(tgId);
    if (!webUid) {
        return bot.sendMessage(chatId, `🛑 *ACCESO DENEGADO*\n\nTu dispositivo no está vinculado.\n\n🔑 *TU ID DE TELEGRAM ES:* \`${tgId}\`\n\nVe a la web y vincula tu cuenta.`, { parse_mode: 'Markdown' });
    }

    const userSnap = await get(ref(db, `users/${webUid}`));
    const webUser = userSnap.val();
    
    // Validar si es admin para darle su teclado
    let isAdmin = (tgId === SUPER_ADMIN);
    if (!isAdmin) {
        const admSnap = await get(ref(db, `admins/${tgId}`));
        if (admSnap.exists()) isAdmin = true;
    }

    const keyboard = isAdmin ? adminKeyboard : userKeyboard;
    const greeting = isAdmin ? `👑 ¡Bienvenido al Panel de Control, *${webUser.username}*!` : `🌌 Bienvenido a LUCK XIT, *${webUser.username}*.`;

    bot.sendMessage(chatId, `${greeting}\nUsa los botones de abajo para navegar.`, { parse_mode: 'Markdown', ...keyboard });
});

// 2. MANEJADOR PRINCIPAL
bot.on('message', async (msg) => {
    if (msg.text === '/start') return;
    if (!msg.text && !msg.photo) return;

    const chatId = msg.chat.id;
    const tgId = msg.from.id;
    const text = msg.text || msg.caption || ''; 

    const webUid = await getAuthUser(tgId);
    if (!webUid) return;

    let isAdmin = (tgId === SUPER_ADMIN) || (await get(ref(db, `admins/${tgId}`))).exists();
    const keyboard = isAdmin ? adminKeyboard : userKeyboard;

    if (text === '❌ Cancelar Acción') {
        userStates[chatId] = null;
        return bot.sendMessage(chatId, '✅ Acción cancelada.', keyboard);
    }

    // --- NUEVO: MANEJO DE COMPROBANTES CON ESTADO COMPARTIDO ---
    if (msg.photo && userStates[chatId] && userStates[chatId].step === 'WAITING_FOR_RECEIPT') {
        const stateData = userStates[chatId].data; 
        const fileId = msg.photo[msg.photo.length - 1].file_id; 
        
        // Creamos un ticket en la DB para evitar colisiones entre admins
        const ticketRef = push(ref(db, 'pending_tickets'));
        await set(ticketRef, {
            type: 'recharge',
            uid: stateData.webUid,
            amount: stateData.amount,
            targetTgId: tgId,
            username: stateData.username,
            status: 'pending' // Puede ser 'pending' o 'processed'
        });

        const adminConfirmKeyboard = {
            inline_keyboard: [
                [{ text: '✅ Confirmar Pago', callback_data: `ticket_ok_${ticketRef.key}` }],
                [{ text: '❌ Rechazar Pago', callback_data: `ticket_no_${ticketRef.key}` }]
            ]
        };

        const msgAdmins = `💳 *NUEVO COMPROBANTE DE PAGO*\n\n👤 Usuario: ${stateData.username}\n💰 Monto: *$${stateData.amount} USD*`;
        
        // Se le manda el comprobante a TODOS los admins
        const allAdmins = await getAllAdmins();
        allAdmins.forEach(adminId => {
            bot.sendPhoto(adminId, fileId, { caption: msgAdmins, parse_mode: 'Markdown', reply_markup: adminConfirmKeyboard }).catch(()=>{});
        });
        
        userStates[chatId] = null; 
        return bot.sendMessage(chatId, '✅ Comprobante enviado a los administradores. Espera a que sea validado.', keyboard);
    }

    if (!msg.text) return; 

    // --- FLUJOS DE ESTADO ---
    if (userStates[chatId]) {
        const state = userStates[chatId];

        // --- NUEVO: DM AL USUARIO (ADMIN) ---
        if (state.step === 'DM_USER_NAME') {
            state.data.targetUser = text.trim();
            state.step = 'DM_USER_MSG';
            return bot.sendMessage(chatId, `Escribe el **mensaje** que quieres enviarle en privado a ${state.data.targetUser}:`, { parse_mode: 'Markdown' });
        }
        if (state.step === 'DM_USER_MSG') {
            bot.sendMessage(chatId, 'Buscando usuario para enviar mensaje...');
            const usersSnap = await get(ref(db, 'users'));
            let targetUid = null;
            usersSnap.forEach(child => { if (child.val().username === state.data.targetUser) targetUid = child.key; });

            if (targetUid) {
                const tgAuthSnap = await get(ref(db, 'telegram_auth'));
                let targetTgId = null;
                tgAuthSnap.forEach(child => { if (child.val() === targetUid) targetTgId = child.key; });

                if (targetTgId) {
                    bot.sendMessage(targetTgId, `📩 *MENSAJE DEL ADMINISTRADOR:*\n\n${text}`, { parse_mode: 'Markdown' });
                    bot.sendMessage(chatId, '✅ Mensaje enviado al usuario exitosamente.', keyboard);
                } else {
                    bot.sendMessage(chatId, '❌ El usuario existe en la web pero no ha vinculado su Telegram.', keyboard);
                }
            } else {
                bot.sendMessage(chatId, '❌ Usuario no encontrado en la base de datos.', keyboard);
            }
            userStates[chatId] = null; return;
        }

        // --- NUEVO: INFO DE UN USUARIO (ADMIN) ---
        if (state.step === 'INFO_USER_NAME') {
            const target = text.trim();
            const usersSnap = await get(ref(db, 'users'));
            let data = null;
            usersSnap.forEach(child => { if (child.val().username === target) data = child.val(); });

            if (data) {
                let gastado = 0; let recargado = 0;
                if (data.history) Object.values(data.history).forEach(c => gastado += parseFloat(c.price||0));
                if (data.recharges) Object.values(data.recharges).forEach(r => recargado += parseFloat(r.amount||0));
                
                const infoMsg = `👤 *INFO DE USUARIO*\n\n`+
                                `🔹 *Username:* ${data.username}\n`+
                                `💰 *Saldo Actual:* $${parseFloat(data.balance||0).toFixed(2)}\n`+
                                `💵 *Total Recargado:* $${recargado.toFixed(2)}\n`+
                                `🛒 *Total Gastado:* $${gastado.toFixed(2)}\n`+
                                `📦 *Compras Totales:* ${data.history ? Object.keys(data.history).length : 0}`;
                bot.sendMessage(chatId, infoMsg, { parse_mode: 'Markdown', ...keyboard });
            } else {
                bot.sendMessage(chatId, '❌ Usuario no encontrado.', keyboard);
            }
            userStates[chatId] = null; return;
        }

        // --- NUEVO: AGREGAR ADMIN (SUPER ADMIN) ---
        if (state.step === 'ADD_ADMIN_ID') {
            const newAdminId = text.trim();
            if (isNaN(newAdminId)) return bot.sendMessage(chatId, '❌ Debe ser un ID numérico de Telegram.');
            await set(ref(db, `admins/${newAdminId}`), {
                perms: { productos: false, finanzas: false, comunicacion: false, usuarios: false }
            });
            bot.sendMessage(chatId, `✅ Admin ${newAdminId} agregado con éxito. Por defecto no tiene permisos. Usa el menú de permisos para habilitarle funciones.`, keyboard);
            userStates[chatId] = null; return;
        }
        if (state.step === 'DEL_ADMIN_ID') {
            const delId = text.trim();
            await remove(ref(db, `admins/${delId}`));
            bot.sendMessage(chatId, `✅ Si existía, el Admin ${delId} fue eliminado.`, keyboard);
            userStates[chatId] = null; return;
        }

        // (Aquí continúan los demás flujos que ya tenías: Añadir Stock, Crear Prod, Reembolso usuario, etc)
        // Por razones de espacio, omito repetir toda la validación anterior que está intacta (Stock, Broadcast, Recargas...). 
        // Asume que los bloques de 'WAITING_FOR_USER_REFUND_KEY', 'ADD_BALANCE_USER', etc., siguen operando igual aquí.
        // ... (Tu código anterior de flujos se mantiene)
    }

    // --- ACCIONES MENÚ USUARIOS ---
    if (!isAdmin) {
        if (text === '🔄 Solicitar Reembolso') {
            userStates[chatId] = { step: 'WAITING_FOR_USER_REFUND_KEY', data: { webUid: webUid } };
            return bot.sendMessage(chatId, '🔄 *SOLICITUD DE REEMBOLSO*\n\nPor favor, escribe la **Key** exacta:', { parse_mode: 'Markdown' });
        }
        if (text === '👤 Mi Perfil') {
            const userSnap = await get(ref(db, `users/${webUid}`));
            return bot.sendMessage(chatId, `👤 *PERFIL*\n\nUsuario: ${userSnap.val().username}\n💰 Saldo: *$${parseFloat(userSnap.val().balance).toFixed(2)} USD*`, { parse_mode: 'Markdown' });
        }
        if (text === '💳 Recargas') {
            // ... (Tu bloque de recargas se mantiene)
            userStates[chatId] = { step: 'WAITING_FOR_RECHARGE_AMOUNT', data: { minUsd: 3 } }; // Simplificado para visualización
            return bot.sendMessage(chatId, `💳 *NUEVA RECARGA*\n\nEscribe la cantidad en USD que deseas recargar:`, { parse_mode: 'Markdown' });
        }
        if (text === '🛒 Tienda') {
             // ... (Tu bloque de tienda se mantiene)
        }
    }

    // --- NUEVO: CATEGORÍAS ADMIN (CON PERMISOS) ---
    if (isAdmin) {
        if (text === '📦 Prod & Stock') {
            if (!await checkAdminPerms(tgId, 'productos')) return bot.sendMessage(chatId, '❌ No tienes permiso para esto.');
            return bot.sendMessage(chatId, '📦 *Módulo de Productos*\n¿Qué deseas hacer?', {
                reply_markup: { inline_keyboard: [
                    [{ text: '📦 Crear Producto', callback_data: 'admin_crear_prod' }],
                    [{ text: '🔑 Añadir Stock', callback_data: 'admin_stock' }]
                ]}
            });
        }
        
        if (text === '💰 Finanzas') {
            if (!await checkAdminPerms(tgId, 'finanzas')) return bot.sendMessage(chatId, '❌ No tienes permiso para esto.');
            return bot.sendMessage(chatId, '💰 *Módulo Financiero*\n¿Qué deseas hacer?', {
                reply_markup: { inline_keyboard: [
                    [{ text: '💸 Añadir Saldo Manual', callback_data: 'admin_add_balance' }],
                    [{ text: '🔄 Buscar/Hacer Reembolso', callback_data: 'admin_search_refund' }]
                ]}
            });
        }

        if (text === '💬 Comunicación') {
            if (!await checkAdminPerms(tgId, 'comunicacion')) return bot.sendMessage(chatId, '❌ No tienes permiso para esto.');
            return bot.sendMessage(chatId, '💬 *Módulo de Comunicación*\n¿Qué deseas hacer?', {
                reply_markup: { inline_keyboard: [
                    [{ text: '📢 Enviar Mensaje Global', callback_data: 'admin_msg_global' }],
                    [{ text: '👤 Mensaje Directo a Usuario', callback_data: 'admin_msg_user' }]
                ]}
            });
        }

        if (text === '👥 Usuarios') {
            if (!await checkAdminPerms(tgId, 'usuarios')) return bot.sendMessage(chatId, '❌ No tienes permiso para esto.');
            return bot.sendMessage(chatId, '👥 *Gestión de Usuarios*\n¿Qué deseas hacer?', {
                reply_markup: { inline_keyboard: [
                    [{ text: '🔍 Buscar Info de un Usuario', callback_data: 'admin_info_user' }],
                    [{ text: '📋 Lista Completa (Gastos/Saldos)', callback_data: 'admin_list_users' }]
                ]}
            });
        }

        if (text === '👑 Gestión Admins') {
            if (tgId !== SUPER_ADMIN) return bot.sendMessage(chatId, '❌ Comando reservado para el Super Administrador.');
            return bot.sendMessage(chatId, '👑 *Control de Administradores*\nConfigura el staff:', {
                reply_markup: { inline_keyboard: [
                    [{ text: '➕ Añadir Admin', callback_data: 'super_add_admin' }, { text: '➖ Quitar Admin', callback_data: 'super_del_admin' }],
                    [{ text: '⚙️ Configurar Permisos', callback_data: 'super_perms_list' }]
                ]}
            });
        }
    }
});

// 3. BOTONES EN LÍNEA
bot.on('callback_query', async (query) => {
    const chatId = query.message.chat.id;
    const tgId = query.from.id;
    const data = query.data;
    bot.answerCallbackQuery(query.id);

    // --- NUEVO: SISTEMA DE ESTADO COMPARTIDO (TICKETS DE PAGOS) ---
    if (data.startsWith('ticket_')) {
        const action = data.split('_')[1]; // ok o no
        const ticketId = data.split('_')[2];

        // Verificamos si alguien más ya lo procesó
        const ticketSnap = await get(ref(db, `pending_tickets/${ticketId}`));
        if (!ticketSnap.exists()) return bot.answerCallbackQuery(query.id, { text: '❌ Ticket no encontrado.', show_alert: true });
        
        const ticketData = ticketSnap.val();
        if (ticketData.status !== 'pending') {
            // SI YA FUE PROCESADO: Bloquea a los demás admins y borra sus botones.
            bot.editMessageReplyMarkup({ inline_keyboard: [] }, { chat_id: chatId, message_id: query.message.message_id });
            return bot.answerCallbackQuery(query.id, { text: `⚠️ ¡Llegaste tarde! Este pago ya fue procesado por otro admin.`, show_alert: true });
        }

        // Si estaba pendiente, lo reclamamos:
        await update(ref(db, `pending_tickets/${ticketId}`), { status: 'processed' });
        bot.editMessageReplyMarkup({ inline_keyboard: [] }, { chat_id: chatId, message_id: query.message.message_id });

        if (action === 'ok') {
            bot.sendMessage(chatId, '⚙️ Acreditando saldo...');
            const userSnap = await get(ref(db, `users/${ticketData.uid}`));
            const currentBal = parseFloat(userSnap.val().balance || 0);
            const nuevoSaldo = currentBal + parseFloat(ticketData.amount);

            const updates = {};
            updates[`users/${ticketData.uid}/balance`] = nuevoSaldo;
            updates[`users/${ticketData.uid}/recharges/${push(ref(db)).key}`] = { amount: ticketData.amount, date: Date.now() };
            await update(ref(db), updates);

            bot.sendMessage(chatId, `✅ *Pago procesado.* Saldo acreditado a ${ticketData.username}.`, { parse_mode: 'Markdown' });
            bot.sendMessage(ticketData.targetTgId, `🎉 *¡RECARGA APROBADA!*\n\nSe han añadido *$${ticketData.amount} USD* a tu cuenta.\n💰 Nuevo saldo: *$${nuevoSaldo.toFixed(2)} USD*`, { parse_mode: 'Markdown' });
        } else {
            bot.sendMessage(chatId, '❌ Comprobante rechazado exitosamente.');
            bot.sendMessage(ticketData.targetTgId, '❌ *RECARGA RECHAZADA*\n\nTu comprobante no fue válido. Contacta a soporte.', { parse_mode: 'Markdown' });
        }
        return;
    }

    // --- NUEVO: ESTADO COMPARTIDO PARA REEMBOLSOS ---
    if (data.startsWith('rfnd_')) {
        const parts = data.split('_');
        const targetUid = parts[1];
        const histId = parts[2];

        const userSnap = await get(ref(db, `users/${targetUid}`));
        if (!userSnap.exists()) return;

        const compra = userSnap.val().history[histId];
        
        // Verificamos si otro admin ya lo reembolsó
        if (compra && compra.refunded) {
            bot.editMessageReplyMarkup({ inline_keyboard: [] }, { chat_id: chatId, message_id: query.message.message_id });
            return bot.answerCallbackQuery(query.id, { text: '⚠️ Esta Key ya fue reembolsada por otro administrador.', show_alert: true });
        }

        bot.editMessageReplyMarkup({ inline_keyboard: [] }, { chat_id: chatId, message_id: query.message.message_id });
        const price = parseFloat(compra.price || 0);
        const nuevoSaldo = parseFloat(userSnap.val().balance || 0) + price;

        const updates = {};
        updates[`users/${targetUid}/balance`] = nuevoSaldo;
        updates[`users/${targetUid}/history/${histId}/refunded`] = true; // Lo marcamos para que otros admins no puedan
        await update(ref(db), updates);

        bot.sendMessage(chatId, `✅ *Reembolso ejecutado.* Se devolvieron $${price} a ${userSnap.val().username}.`);
        // Lógica de avisar al usuario...
        return;
    }

    // --- ENRUTAMIENTO DE BOTONES DEL MENÚ ADMIN ---
    if (data === 'admin_msg_user') {
        userStates[chatId] = { step: 'DM_USER_NAME', data: {} };
        return bot.sendMessage(chatId, 'Escribe el **Nombre de Usuario** exacto al que le escribirás:', { parse_mode: 'Markdown' });
    }
    
    if (data === 'admin_info_user') {
        userStates[chatId] = { step: 'INFO_USER_NAME', data: {} };
        return bot.sendMessage(chatId, 'Escribe el **Nombre de Usuario** exacto para buscar su historial:', { parse_mode: 'Markdown' });
    }

    if (data === 'admin_list_users') {
        bot.sendMessage(chatId, '⏳ Procesando base de datos, un momento...');
        const usersSnap = await get(ref(db, 'users'));
        let txt = `📋 *REPORTE GLOBAL DE USUARIOS*\n\n`;
        usersSnap.forEach(child => {
            const data = child.val();
            let gastado = 0; let recargado = 0;
            if (data.history) Object.values(data.history).forEach(c => gastado += parseFloat(c.price||0));
            if (data.recharges) Object.values(data.recharges).forEach(r => recargado += parseFloat(r.amount||0));
            
            if (gastado > 0 || recargado > 0 || data.balance > 0) {
                txt += `👤 *${data.username}* | 💰 Saldo: $${parseFloat(data.balance||0).toFixed(2)} | 🛒 Gastado: $${gastado.toFixed(2)}\n`;
            }
        });
        return bot.sendMessage(chatId, txt, { parse_mode: 'Markdown' });
    }

    if (data === 'super_add_admin') {
        userStates[chatId] = { step: 'ADD_ADMIN_ID', data: {} };
        return bot.sendMessage(chatId, 'Envía el **ID de Telegram** numérico del nuevo administrador:');
    }
    
    if (data === 'super_del_admin') {
        userStates[chatId] = { step: 'DEL_ADMIN_ID', data: {} };
        return bot.sendMessage(chatId, 'Envía el **ID de Telegram** numérico del administrador a remover:');
    }

    if (data === 'super_perms_list') {
        const adminsSnap = await get(ref(db, 'admins'));
        if (!adminsSnap.exists()) return bot.sendMessage(chatId, 'No hay administradores extra creados.');
        let kb = [];
        adminsSnap.forEach(child => {
            kb.push([{ text: `⚙️ Configurar Admin: ${child.key}`, callback_data: `super_config_${child.key}` }]);
        });
        return bot.sendMessage(chatId, 'Selecciona un administrador:', { reply_markup: { inline_keyboard: kb } });
    }

    if (data.startsWith('super_config_')) {
        const tId = data.split('_')[2];
        const admSnap = await get(ref(db, `admins/${tId}/perms`));
        const p = admSnap.val() || {};
        
        // Teclado interactivo para prender/apagar
        const kb = [
            [{ text: `${p.productos ? '✅' : '❌'} Productos`, callback_data: `toggle_${tId}_productos` }],
            [{ text: `${p.finanzas ? '✅' : '❌'} Finanzas`, callback_data: `toggle_${tId}_finanzas` }],
            [{ text: `${p.comunicacion ? '✅' : '❌'} Comunicación`, callback_data: `toggle_${tId}_comunicacion` }],
            [{ text: `${p.usuarios ? '✅' : '❌'} Info Usuarios`, callback_data: `toggle_${tId}_usuarios` }]
        ];
        return bot.sendMessage(chatId, `Configurando permisos para ID: \`${tId}\`\nToca para alternar:`, { parse_mode: 'Markdown', reply_markup: { inline_keyboard: kb } });
    }

    if (data.startsWith('toggle_')) {
        const parts = data.split('_');
        const tId = parts[1];
        const perm = parts[2];
        
        const currentSnap = await get(ref(db, `admins/${tId}/perms/${perm}`));
        const currentVal = currentSnap.val() || false;
        
        await update(ref(db, `admins/${tId}/perms`), { [perm]: !currentVal });
        
        // Refrescar el mensaje anterior invocando de nuevo la función (simulación)
        bot.answerCallbackQuery(query.id, { text: `Permiso ${perm} modificado.` });
        
        // Regenerar el teclado actualizado
        const newSnap = await get(ref(db, `admins/${tId}/perms`));
        const p = newSnap.val();
        const kb = [
            [{ text: `${p.productos ? '✅' : '❌'} Productos`, callback_data: `toggle_${tId}_productos` }],
            [{ text: `${p.finanzas ? '✅' : '❌'} Finanzas`, callback_data: `toggle_${tId}_finanzas` }],
            [{ text: `${p.comunicacion ? '✅' : '❌'} Comunicación`, callback_data: `toggle_${tId}_comunicacion` }],
            [{ text: `${p.usuarios ? '✅' : '❌'} Info Usuarios`, callback_data: `toggle_${tId}_usuarios` }]
        ];
        return bot.editMessageReplyMarkup({ inline_keyboard: kb }, { chat_id: chatId, message_id: query.message.message_id });
    }

});

console.log('🤖 Sistema Corporativo Iniciado...');
