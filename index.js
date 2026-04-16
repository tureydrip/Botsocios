const TelegramBot = require('node-telegram-bot-api');
const { initializeApp } = require('firebase/app');
const { getDatabase, ref, get, update, push, set, remove } = require('firebase/database');
const { default: makeWASocket, useMultiFileAuthState, fetchLatestBaileysVersion, DisconnectReason } = require('@whiskeysockets/baileys');
const pino = require('pino');
const sistemaRecargas = require('./recargas');

// ==========================================
// CONFIGURACIÓN MASTER
// ==========================================
const token = '8275295427:AAHiO33nzZPgmglmSWo8eKVMKkEsCy19fSA';
const bot = new TelegramBot(token, { polling: true });
const SUPER_ADMIN_ID = 7710633235; 
const TASA_COP = 3800; 

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

// ==========================================
// MÓDULO DE WHATSAPP BOT (BAILEYS)
// ==========================================
let waSock = null;

async function iniciarWhatsApp() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');
    const { version } = await fetchLatestBaileysVersion();

    waSock = makeWASocket({
        version,
        logger: pino({ level: 'silent' }),
        printQRInTerminal: false,
        auth: state,
        browser: ['Ubuntu', 'Chrome', '20.0.04']
    });

    waSock.ev.on('creds.update', saveCreds);

    waSock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect } = update;
        if (connection === 'close') {
            const shouldReconnect = (lastDisconnect.error)?.output?.statusCode !== DisconnectReason.loggedOut;
            console.log('WhatsApp: Conexión cerrada, reconectando...', shouldReconnect);
            if (shouldReconnect) {
                iniciarWhatsApp();
            } else {
                console.log('WhatsApp: Sesión cerrada. Requiere vinculación nuevamente.');
            }
        } else if (connection === 'open') {
            console.log('WhatsApp: Conectado exitosamente y listo para notificar.');
        }
    });
}
iniciarWhatsApp(); 

async function enviarMensajeWA(numero, mensaje) {
    if (waSock && waSock.authState.creds.registered) {
        try {
            await waSock.sendMessage(`${numero}@s.whatsapp.net`, { text: mensaje });
        } catch (error) {
            console.error('Error enviando mensaje WA a', numero, error.message);
        }
    }
}

async function broadcastWA(mensaje) {
    if (!waSock || !waSock.authState.creds.registered) return;
    const usersSnap = await get(ref(db, 'users'));
    if (usersSnap.exists()) {
        usersSnap.forEach(u => {
            const user = u.val();
            if (user.waLinked && user.waNumber) {
                enviarMensajeWA(user.waNumber, mensaje);
            }
        });
    }
}

// ==========================================
// FUNCIONES FIREBASE Y NÚCLEO
// ==========================================
function adaptarProductoLegacy(p) {
    if (p && !p.durations && p.price !== undefined) {
        p.durations = {
            'legacy_var': { duration: p.duration || 'Única / Estándar', price: p.price, warranty: p.warranty || 0, keys: p.keys || {} }
        };
        p.category = p.category || 'Android'; 
    }
    return p;
}

async function getRanks(db) {
    const snap = await get(ref(db, 'settings/ranks'));
    if (snap.exists()) {
        const ranksObj = snap.val();
        return Object.keys(ranksObj).map(key => ({ id: key, ...ranksObj[key] })).sort((a, b) => b.minGastado - a.minGastado);
    } else {
        const defaultRanks = {
            elite: { nombre: '🌟 Élite', minGastado: 200, descuento: 2.50 }, deluxe: { nombre: '🔥 Deluxe', minGastado: 150, descuento: 2.00 },
            diamante: { nombre: '💎 Diamante', minGastado: 100, descuento: 1.50 }, premium: { nombre: '✨ Premium', minGastado: 50, descuento: 1.00 },
            vip: { nombre: '🎫 VIP', minGastado: 10, descuento: 0.50 }, miembro: { nombre: '👤 Miembro', minGastado: 0, descuento: 0 }
        };
        await set(ref(db, 'settings/ranks'), defaultRanks);
        return Object.keys(defaultRanks).map(key => ({ id: key, ...defaultRanks[key] })).sort((a, b) => b.minGastado - a.minGastado);
    }
}

function calcularGastoTotal(historial) {
    let total = 0;
    if (historial) Object.values(historial).forEach(compra => { if (!compra.refunded) total += parseFloat(compra.price || 0); });
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
                    
                    if (inviterTgId) {
                        const msgBono = `🎉 *¡BONO DE REFERIDO!*\nTu referido *${user.username}* recargó $5 USD o más.\n🎁 Recibes *$2.00 USD* gratis.\n💰 Tu nuevo saldo es: *$${(inviterBal + 2).toFixed(2)} USD*`;
                        bot.sendMessage(inviterTgId, msgBono, { parse_mode: 'Markdown' });
                    }
                }
            }
        }
    }
}

// ==========================================
// UI Y MENÚS
// ==========================================
const userStates = {}; 

const userKeyboard = {
    reply_markup: {
        keyboard: [
            [{ text: '🛒 Tienda' }, { text: '👤 Mi Perfil' }],
            [{ text: '💳 Recargas' }, { text: '🤝 Referidos' }],
            [{ text: '🎟️ Canjear Cupón' }, { text: '💸 Transferir Saldo' }],
            [{ text: '🔄 Resetear Key' }, { text: '🔄 Solicitar Reembolso' }] 
        ],
        resize_keyboard: true, is_persistent: true
    }
};

const cancelKeyboard = {
    reply_markup: { keyboard: [[{ text: '❌ Cancelar Acción' }]], resize_keyboard: true, is_persistent: true }
};

function notifySuperAdmin(adminUsername, adminTgId, action, details) {
    if (adminTgId === SUPER_ADMIN_ID) return; 
    const msg = `🕵️‍♂️ *REPORTE DE ADMINISTRADOR*\n👮 *Admin:* ${adminUsername}\n🛠️ *Acción:* ${action}\n📝 *Detalle:* ${details}`;
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
    if (adminData.isSuper) { 
        bottomRow.push({ text: '🔍 Ver Keys/Eliminar' }); bottomRow.push({ text: '👮 Gest. Admins' }); 
        bottomRow.push({ text: '🌍 Gest. Países' }); bottomRow.push({ text: '📱 Vincular Bot WA' });
    }
    bottomRow.push({ text: '❌ Cancelar Acción' }); 
    kb.push(bottomRow);
    
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

async function sendUserManageMenu(chatId, targetUid, bot) {
    const uSnap = await get(ref(db, `users/${targetUid}`));
    if (!uSnap.exists()) return bot.sendMessage(chatId, '❌ Usuario no encontrado.');
    const targetUser = uSnap.val();
    
    const totalSpent = calcularGastoTotal(targetUser.history);
    const rangoActual = await obtenerRango(db, totalSpent);

    let isBanned = targetUser.banned || false;
    let banText = isBanned ? '🔴 BANEADO PERMANENTE' : '🟢 ACTIVO';
    if (targetUser.banUntil && targetUser.banUntil > Date.now()) banText = `⏳ BANEADO TEMPORAL`;

    const msgInfo = `👤 *GESTIÓN DE USUARIO*\n*Nombre:* ${targetUser.username}\n*Saldo:* $${parseFloat(targetUser.balance||0).toFixed(2)} USD\n*Gastado Total:* $${totalSpent.toFixed(2)} USD\n*Rango:* ${rangoActual.nombre}\n*Estado:* ${banText}\n*WA:* ${targetUser.waLinked ? '✅ ' + targetUser.waNumber : '❌ No vinculado'}`;
                    
    const inlineKeyboard = [
        [{ text: '➕ Agregar Saldo', callback_data: `uact|addbal|${targetUid}` }, { text: '➖ Quitar Saldo', callback_data: `uact|rembal|${targetUid}` }],
        [{ text: isBanned ? '✅ Desbanear' : '🔨 Ban Permanente', callback_data: `uact|banperm|${targetUid}` }, { text: '⏳ Ban Temporal', callback_data: `uact|bantemp|${targetUid}` }]
    ];
    bot.sendMessage(chatId, msgInfo, { parse_mode: 'Markdown', reply_markup: { inline_keyboard: inlineKeyboard } });
}

async function getAuthUser(telegramId) {
    const authSnap = await get(ref(db, `telegram_auth/${telegramId}`));
    if (authSnap.exists()) return authSnap.val();
    return null;
}

// ==========================================
// RECEPCIÓN DE MENSAJES Y COMANDOS
// ==========================================
bot.onText(/\/start(?: (.*))?/, async (msg, match) => {
    const chatId = msg.chat.id;
    const tgId = msg.from.id;
    const refCodeParam = match[1] ? match[1].trim().toUpperCase() : null;
    userStates[chatId] = null; 

    const webUid = await getAuthUser(tgId);
    if (!webUid) return bot.sendMessage(chatId, `🛑 *ACCESO DENEGADO*\n\nTu dispositivo no está vinculado a una cuenta web.\n🔑 *TU ID DE TELEGRAM ES:* \`${tgId}\``, { parse_mode: 'Markdown' });

    const userSnap = await get(ref(db, `users/${webUid}`));
    const webUser = userSnap.val();
    if (!webUser) return bot.sendMessage(chatId, '⚠️ Tu cuenta web no se encuentra en la base de datos.', { parse_mode: 'Markdown' });

    if (refCodeParam && !webUser.referredBy && webUser.referralCode !== refCodeParam) {
        const codeSnap = await get(ref(db, `referral_codes/${refCodeParam}`));
        if (codeSnap.exists() && codeSnap.val() !== webUid) {
            await update(ref(db), { [`users/${webUid}/referredBy`]: refCodeParam });
            bot.sendMessage(chatId, `🤝 *¡CÓDIGO ACEPTADO!*\nHas sido invitado con el código \`${refCodeParam}\`.`, { parse_mode: 'Markdown' });
        }
    }

    const adminData = await getAdminData(tgId);

    // VERIFICACIÓN DE WHATSAPP OBLIGATORIA PARA USUARIOS
    if (!adminData && !webUser.waLinked) {
        const kb = {
            inline_keyboard: [
                [{text: '🇨🇴 Colombia (+57)', callback_data: 'walinkuser|57'}, {text: '🇲🇽 México (+52)', callback_data: 'walinkuser|52'}],
                [{text: '🇪🇸 España (+34)', callback_data: 'walinkuser|34'}, {text: '🇦🇷 Argentina (+54)', callback_data: 'walinkuser|54'}],
                [{text: '🌍 Otro País (Escribir código)', callback_data: 'walinkuser|otro'}]
            ]
        };
        userStates[chatId] = { step: 'USER_WA_COUNTRY', data: {} };
        return bot.sendMessage(chatId, '⚠️ *VERIFICACIÓN OBLIGATORIA*\n\nPara poder usar el bot y recibir notificaciones de saldo y productos, debes vincular tu número de WhatsApp activo.\n\n👇 Selecciona tu país de residencia:', {reply_markup: kb, parse_mode: 'Markdown'});
    }

    const keyboard = adminData ? buildAdminKeyboard(adminData) : userKeyboard;
    let greeting = adminData ? (adminData.isSuper ? `👑 ¡Bienvenido Super Admin SociosXit, *${webUser.username}*!` : `🛡️ Bienvenido Admin cibernético, *${webUser.username}*.`) : `🌌 Bienvenido a SociosXit, *${webUser.username}*.`;

    bot.sendMessage(chatId, `${greeting}\n\n👇 Usa los botones de abajo para navegar de forma rápida.`, { parse_mode: 'Markdown', ...keyboard });
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
        
        if (isBanned) return bot.sendMessage(chatId, '🚫 *ESTÁS BANEADO*\nContacta a soporte para más información.', { parse_mode: 'Markdown' });
        if (isMaintenance) return bot.sendMessage(chatId, '🛠️ *MODO MANTENIMIENTO ACTIVO*\nEstamos aplicando mejoras. Volveremos pronto.', { parse_mode: 'Markdown' });
    }

    if (text === '❌ Cancelar Acción') {
        userStates[chatId] = null;
        return bot.sendMessage(chatId, '✅ Acción cancelada. ¿Qué deseas hacer ahora?', keyboard);
    }

    // --- INTERCEPCIÓN DEL FLUJO DE VERIFICACIÓN WA USUARIO ---
    if (!adminData && !webUser.waLinked && userStates[chatId]) {
        const state = userStates[chatId];
        
        if (state.step === 'USER_WA_CUSTOM_COUNTRY') {
            const code = text.replace('+', '').trim();
            if (isNaN(code)) return bot.sendMessage(chatId, '❌ Escribe solo los números (Ej: 51)');
            state.data.countryCode = code;
            state.step = 'USER_WA_NUMBER';
            return bot.sendMessage(chatId, `✅ Código +${code} guardado.\n\nEscribe tu número de WhatsApp **sin el código de país**:`, {parse_mode: 'Markdown'});
        }
        
        if (state.step === 'USER_WA_NUMBER') {
            const num = text.trim();
            if (isNaN(num)) return bot.sendMessage(chatId, '❌ Escribe solo números.');
            const fullNumber = `${state.data.countryCode}${num}`;
            const verificationCode = Math.floor(100000 + Math.random() * 900000).toString();
            
            state.data.expectedCode = verificationCode;
            state.data.pendingWaNumber = fullNumber;
            state.step = 'USER_WA_CODE';

            if (waSock && waSock.authState.creds.registered) {
                try {
                    await enviarMensajeWA(fullNumber, `🤖 *Verificación SociosXit*\n\nTu código de verificación es: *${verificationCode}*\n\nRegresa al Bot de Telegram e ingrésalo.`);
                    return bot.sendMessage(chatId, `✅ Hemos enviado un código por WhatsApp al número (+${fullNumber}).\n\n**Ingresa el código aquí para verificar tu cuenta:**`, {parse_mode: 'Markdown'});
                } catch (err) {
                    return bot.sendMessage(chatId, `❌ Hubo un error enviando el WhatsApp. Comprueba que el número sea correcto y vuelve a intentar usando /start.`);
                }
            } else {
                return bot.sendMessage(chatId, `❌ El sistema de notificaciones de WhatsApp está fuera de servicio temporalmente.`);
            }
        }
        
        if (state.step === 'USER_WA_CODE') {
            if (text.trim() === state.data.expectedCode) {
                await update(ref(db), { [`users/${webUid}/waLinked`]: true, [`users/${webUid}/waNumber`]: state.data.pendingWaNumber });
                userStates[chatId] = null;
                return bot.sendMessage(chatId, `🎉 *¡WhatsApp vinculado exitosamente!*\n\nYa tienes acceso completo a la tienda.`, {parse_mode: 'Markdown', ...keyboard});
            } else {
                return bot.sendMessage(chatId, `❌ Código incorrecto. Verifica en tu WhatsApp e intenta de nuevo:`);
            }
        }
        return; // Bloquea todo el resto de la tienda si no está verificado
    }

    // --- INTERCEPCIÓN DEL FLUJO VINCULACIÓN WA ADMIN ---
    if (adminData && userStates[chatId]) {
        const state = userStates[chatId];
        
        if (state.step === 'ADMIN_WA_CUSTOM_COUNTRY') {
            const code = text.replace('+', '').trim();
            if (isNaN(code)) return bot.sendMessage(chatId, '❌ Escribe solo los números (Ej: 51)');
            state.data.countryCode = code;
            state.step = 'ADMIN_WA_NUMBER';
            return bot.sendMessage(chatId, `✅ Código +${code} guardado.\n\nEscribe el número que se convertirá en el Bot de WhatsApp **sin el código de país**:`);
        }
        
        if (state.step === 'ADMIN_WA_NUMBER') {
            const num = text.trim();
            if (isNaN(num)) return bot.sendMessage(chatId, '❌ Escribe solo números.');
            const fullNumber = `${state.data.countryCode}${num}`;
            
            bot.sendMessage(chatId, `⏳ Solicitando Pairing Code a WhatsApp para el número +${fullNumber}... Por favor espera.`);
            
            try {
                if (waSock && waSock.authState.creds.registered) {
                    userStates[chatId] = null;
                    return bot.sendMessage(chatId, '⚠️ El bot de WhatsApp ya se encuentra registrado y vinculado con un número. Cierra sesión primero desde WhatsApp en ese número si deseas cambiarlo.', keyboard);
                }
                setTimeout(async () => {
                    try {
                        const code = await waSock.requestPairingCode(fullNumber);
                        bot.sendMessage(chatId, `Tu código de vinculación para WhatsApp es:\n\n*${code}*\n\nIngresa este código en "Dispositivos Vinculados" > "Vincular con el número de teléfono" en tu WhatsApp destino.`, { parse_mode: 'Markdown', ...keyboard });
                    } catch(err) {
                        bot.sendMessage(chatId, '❌ Error de Baileys al solicitar código: ' + err.message, keyboard);
                    }
                }, 3000);
            } catch (error) {
                bot.sendMessage(chatId, '❌ Error al solicitar código: ' + error.message, keyboard);
            }
            userStates[chatId] = null;
            return;
        }
    }

    if (msg.photo && userStates[chatId]) {
        const state = userStates[chatId];
        const fileId = msg.photo[msg.photo.length - 1].file_id; 

        if (state.step === 'WAITING_FOR_RECEIPT') return sistemaRecargas.recibirFotoComprobante(bot, db, chatId, tgId, fileId, state.data, keyboard, SUPER_ADMIN_ID, userStates);
        
        if (state.step === 'WAITING_FOR_USER_REFUND_PROOF') {
            const foundData = state.data;
            const msgInfo = `🔔 *NUEVA SOLICITUD DE REEMBOLSO*\n\n👤 *Usuario:* ${foundData.username}\n📦 *Producto:* ${foundData.compra.product}\n🔑 *Key:* \`${foundData.compra.key}\`\n💰 *Pagado:* $${parseFloat(foundData.compra.price).toFixed(2)}\n📝 *Motivo:* ${msg.caption || 'Sin motivo'}`;
            bot.sendPhoto(SUPER_ADMIN_ID, fileId, { caption: msgInfo, parse_mode: 'Markdown', reply_markup: { inline_keyboard: [[{ text: '✅ Mandar Reembolso', callback_data: `rfnd|${foundData.uid}|${foundData.histId}` }], [{ text: '❌ Rechazar Solicitud', callback_data: `reject_refund|${foundData.targetTgId}` }]] } });
            userStates[chatId] = null;
            return bot.sendMessage(chatId, '✅ Tu solicitud ha sido enviada. El Staff la revisará pronto.', keyboard);
        }
    }

    if (!text) return; 

    // --- ACCIONES GENERALES DEL BOTÓN USUARIO ---
    if (text === '🔄 Solicitar Reembolso') { userStates[chatId] = { step: 'WAITING_FOR_USER_REFUND_KEY', data: {} }; return bot.sendMessage(chatId, '🔄 Envía la **Key** exacta de la compra con problemas.', { parse_mode: 'Markdown', ...cancelKeyboard }); }
    if (text === '🔄 Resetear Key') { userStates[chatId] = { step: 'WAITING_FOR_RESET_KEY', data: {} }; return bot.sendMessage(chatId, '🔄 Envía la **Key** que deseas resetear.', { parse_mode: 'Markdown', ...cancelKeyboard }); }
    if (text === '💸 Transferir Saldo') { userStates[chatId] = { step: 'TRANSFER_USERNAME', data: {} }; return bot.sendMessage(chatId, '💸 Escribe el *Nombre de Usuario* exacto al que le quieres enviar saldo:', { parse_mode: 'Markdown', ...cancelKeyboard }); }
    if (text === '🎟️ Canjear Cupón') { userStates[chatId] = { step: 'REDEEM_COUPON', data: {} }; return bot.sendMessage(chatId, '🎁 Escribe tu código promocional:', { parse_mode: 'Markdown', ...cancelKeyboard }); }
    if (text === '💳 Recargas') return sistemaRecargas.iniciarRecarga(bot, db, chatId, webUser, userStates);
    
    if (text === '👤 Mi Perfil') {
        const totalGastado = calcularGastoTotal(webUser.history);
        const rAct = await obtenerRango(db, totalGastado);
        const sUsd = parseFloat(webUser.balance || 0);
        let msgP = `👤 *PERFIL SociosXit*\n*Usuario:* ${webUser.username}\n💰 *Saldo:* $${sUsd.toFixed(2)} USD\n🇨🇴 _(Aprox. ${(sUsd*TASA_COP).toLocaleString('es-CO')} COP)_\n🏆 *Rango:* ${rAct.nombre}\n📈 *Gastado:* $${totalGastado.toFixed(2)} USD`;
        if (webUser.active_discount > 0) msgP += `\n🎟️ *Cupón Activo:* ${webUser.active_discount}% EXTRA OFF`;
        return bot.sendMessage(chatId, msgP, { parse_mode: 'Markdown' });
    }
    
    if (text === '🤝 Referidos') {
        let miCodigo = webUser.referralCode;
        if (!miCodigo) {
            miCodigo = 'LUCK-' + Math.random().toString(36).substring(2, 7).toUpperCase();
            await update(ref(db), { [`users/${webUid}/referralCode`]: miCodigo, [`referral_codes/${miCodigo}`]: webUid });
        }
        const botInfo = await bot.getMe();
        let msgRef = `🤝 *SISTEMA DE REFERIDOS*\nInvita y gana saldo. Por cada recarga inicial de **$5 USD** de tus amigos, tú recibes **$2 USD**.\n🎟️ *Tu Código:* \`${miCodigo}\`\n🔗 *Enlace:*\n\`https://t.me/${botInfo.username}?start=${miCodigo}\``;
        if (!webUser.referredBy) { userStates[chatId] = { step: 'WAITING_FOR_REF_CODE', data: {} }; msgRef += `\n\n✍️ *¿Alguien te invitó?* Escribe su código aquí.`; }
        return bot.sendMessage(chatId, msgRef, { parse_mode: 'Markdown' });
    }
    
    if (text === '🛒 Tienda') {
        const pSnap = await get(ref(db, 'products'));
        if (!pSnap.exists()) return bot.sendMessage(chatId, '🛒 Tienda vacía.');
        const catKb = [ [{ text: '📱 Android', callback_data: 'tcat|Android' }, { text: '🍎 iPhone', callback_data: 'tcat|iPhone' }], [{ text: '💻 PC', callback_data: 'tcat|PC' }] ];
        return bot.sendMessage(chatId, `🛒 *ARSENAL DISPONIBLE*\nSelecciona plataforma:`, { parse_mode: 'Markdown', reply_markup: { inline_keyboard: catKb } });
    }

    // --- MANEJO DE ESTADOS CONTINUOS ---
    if (userStates[chatId]) {
        const state = userStates[chatId];

        // REPORTES Y BÚSQUEDAS (ADMIN)
        if (state.step === 'HISTORY_USER' && (adminData.isSuper || adminData.perms.stats)) {
            const usersSnap = await get(ref(db, 'users')); let tUser = null;
            usersSnap.forEach(u => { if (u.val().username === text.trim()) tUser = u.val(); });
            if (!tUser) return bot.sendMessage(chatId, '❌ Usuario no encontrado.');
            if (!tUser.history) { userStates[chatId]=null; return bot.sendMessage(chatId, '📜 Este usuario no tiene compras.'); }
            
            let hText = `📜 *COMPRAS DE ${text.trim()}*\n\n`;
            Object.values(tUser.history).sort((a,b)=>b.date-a.date).slice(0,15).forEach((c,i)=>{
                const d = new Date(c.date).toLocaleString('es-CO');
                hText += `*${i+1}. ${c.product}*\n🔑 \`${c.key}\`\n💵 $${c.price} | ${d} | ${c.refunded?'🔴 REEMBOLSADO':'🟢 OK'}\n\n`;
            });
            bot.sendMessage(chatId, hText, { parse_mode: 'Markdown' }); userStates[chatId]=null; return;
        }

        if (state.step === 'GIFT_USER' && (adminData.isSuper || adminData.perms.products)) {
            const usersSnap = await get(ref(db, 'users')); let tUid = null;
            usersSnap.forEach(u => { if (u.val().username === text.trim()) tUid = u.key; });
            if (!tUid) return bot.sendMessage(chatId, '❌ Usuario no encontrado.');
            const pSnap = await get(ref(db, 'products')); let kb=[];
            pSnap.forEach(c => { kb.push([{ text: `🎁 ${adaptarProductoLegacy(c.val()).name}`, callback_data: `gift_prod|${tUid}|${c.key}` }]); });
            bot.sendMessage(chatId, `🎁 Selecciona el producto a regalar a ${text.trim()}:`, { reply_markup: { inline_keyboard: kb } }); userStates[chatId]=null; return;
        }

        // ACCIONES USUARIO ESTADOS
        if (state.step === 'WAITING_FOR_REF_CODE') {
            const inCode = text.trim().toUpperCase();
            if (inCode === webUser.referralCode) return bot.sendMessage(chatId, '❌ No puedes usar tu código.');
            const codeSnap = await get(ref(db, `referral_codes/${inCode}`));
            if (!codeSnap.exists()) return bot.sendMessage(chatId, '❌ Código inválido.');
            await update(ref(db), { [`users/${webUid}/referredBy`]: inCode });
            bot.sendMessage(chatId, `✅ *Código enlazado.*`, { parse_mode: 'Markdown', ...keyboard }); userStates[chatId]=null; return;
        }

        if (state.step === 'WAITING_FOR_RESET_KEY') {
            const sKey = text.trim(); let hId = null, kData = null;
            if (webUser.history) Object.keys(webUser.history).forEach(id => { if (webUser.history[id].key.trim() === sKey) { hId=id; kData=webUser.history[id]; } });
            if (!hId) return bot.sendMessage(chatId, '❌ Key no encontrada.');
            const hrs = (Date.now() - (kData.lastReset||0)) / 3600000;
            if (hrs < 7 && kData.lastReset) return bot.sendMessage(chatId, `⏳ Límite alcanzado. Espera ${(7-hrs).toFixed(1)} hrs.`);
            await update(ref(db), { [`users/${webUid}/history/${hId}/lastReset`]: Date.now() });
            bot.sendMessage(chatId, '✅ *Key reseteada con éxito.*', { parse_mode: 'Markdown', ...keyboard }); userStates[chatId]=null; return;
        }

        if (state.step === 'WAITING_FOR_RECEIPT' || state.step === 'WAITING_FOR_USER_REFUND_PROOF') return bot.sendMessage(chatId, '❌ Debes adjuntar una **foto**.', { parse_mode: 'Markdown' });

        if (state.step === 'TRANSFER_USERNAME') {
            if(text.trim() === webUser.username) return bot.sendMessage(chatId, '❌ No puedes enviarte a ti mismo.');
            userStates[chatId].data.targetUser = text.trim(); userStates[chatId].step = 'TRANSFER_AMOUNT';
            return bot.sendMessage(chatId, `¿Cuántos **USD** enviarás a *${text.trim()}*?`, { parse_mode: 'Markdown' });
        }
        
        if (state.step === 'TRANSFER_AMOUNT') {
            const amt = parseFloat(text);
            if (isNaN(amt) || amt <= 0 || amt > parseFloat(webUser.balance||0)) return bot.sendMessage(chatId, '❌ Inválido o saldo insuficiente.');
            const usersSnap = await get(ref(db, 'users')); let tUid = null, tBal = 0, tWa = null;
            usersSnap.forEach(u => { if (u.val().username === state.data.targetUser) { tUid = u.key; tBal = parseFloat(u.val().balance||0); tWa = u.val().waNumber; } });
            if (!tUid) return bot.sendMessage(chatId, '❌ Usuario no encontrado.');
            
            await update(ref(db), { [`users/${webUid}/balance`]: parseFloat(webUser.balance) - amt, [`users/${tUid}/balance`]: tBal + amt });
            bot.sendMessage(chatId, `✅ Enviaste *$${amt} USD* a ${state.data.targetUser}.`, { parse_mode: 'Markdown', ...keyboard });
            
            const authSnap = await get(ref(db, 'telegram_auth'));
            authSnap.forEach(child => { if (child.val() === tUid) bot.sendMessage(child.key, `💸 *RECIBISTE $${amt} USD* de ${webUser.username}.`, { parse_mode: 'Markdown' }); });
            
            if (tWa) enviarMensajeWA(tWa, `💸 *¡TRANSFERENCIA RECIBIDA!*\n\nHas recibido *$${amt} USD* de parte del usuario ${webUser.username}.`);
            userStates[chatId] = null; return;
        }

        if (state.step === 'REDEEM_COUPON') {
            const cSnap = await get(ref(db, `coupons/${text.trim().toUpperCase()}`));
            if (!cSnap.exists()) return bot.sendMessage(chatId, '❌ *CUPÓN INVÁLIDO*', { parse_mode: 'Markdown', ...keyboard });
            const uUsed = await get(ref(db, `users/${webUid}/used_coupons/${text.trim().toUpperCase()}`));
            if (uUsed.exists()) return bot.sendMessage(chatId, '⚠️ *YA USASTE ESTE CUPÓN*', { parse_mode: 'Markdown', ...keyboard });
            
            const cData = cSnap.val(); const updates = { [`users/${webUid}/used_coupons/${text.trim().toUpperCase()}`]: true };
            if (cData.type === 'balance') updates[`users/${webUid}/balance`] = parseFloat(webUser.balance||0) + parseFloat(cData.value);
            else updates[`users/${webUid}/active_discount`] = parseFloat(cData.value);
            await update(ref(db), updates);
            bot.sendMessage(chatId, `🎉 *¡CUPÓN CANJEADO!*`, { parse_mode: 'Markdown', ...keyboard }); userStates[chatId]=null; return;
        }

        // --- MANEJO ESTADOS ADMIN CONTINUOS ---
        if (adminData) {
            
            // CREACIÓN DE PRODUCTOS
            if (state.step === 'CREATE_PROD_NAME' && (adminData.isSuper || adminData.perms.products)) {
                state.data.name = text; state.step = 'CREATE_PROD_CAT';
                return bot.sendMessage(chatId, 'Selecciona la Categoría:', { reply_markup: { inline_keyboard: [ [{ text: '📱 Android', callback_data: 'setcat|Android' }, { text: '🍎 iPhone', callback_data: 'setcat|iPhone' }], [{ text: '💻 PC', callback_data: 'setcat|PC' }] ] } });
            }
            if (state.step === 'CREATE_PROD_DURATION' && (adminData.isSuper || adminData.perms.products)) { state.data.duration = text; state.step = 'CREATE_PROD_PRICE'; return bot.sendMessage(chatId, 'Ingresa el Precio USD:'); }
            if (state.step === 'CREATE_PROD_PRICE' && (adminData.isSuper || adminData.perms.products)) { const p = parseFloat(text); if (isNaN(p)) return bot.sendMessage(chatId,'❌ Inválido'); state.data.price = p; state.step = 'CREATE_PROD_WARRANTY'; return bot.sendMessage(chatId, 'Ingresa tiempo de garantía (horas):'); }
            if (state.step === 'CREATE_PROD_WARRANTY' && (adminData.isSuper || adminData.perms.products)) {
                const w = parseFloat(text); if (isNaN(w) || w<0) return bot.sendMessage(chatId,'❌ Inválida');
                
                if (state.data.isAddingVariant) {
                    await set(push(ref(db, `products/${state.data.prodId}/durations`)), { duration: state.data.duration, price: state.data.price, warranty: w });
                    bot.sendMessage(chatId, `✅ Variante *${state.data.duration}* agregada.`, { parse_mode: 'Markdown', ...keyboard });
                } else {
                    const nRef = push(ref(db, 'products')); const dId = push(ref(db, `products/${nRef.key}/durations`)).key;
                    await set(nRef, { name: state.data.name, category: state.data.category });
                    await set(ref(db, `products/${nRef.key}/durations/${dId}`), { duration: state.data.duration, price: state.data.price, warranty: w });
                    bot.sendMessage(chatId, `✅ Producto *${state.data.name}* creado.`, { parse_mode: 'Markdown', ...keyboard });
                    broadcastWA(`📦 *¡NUEVO PRODUCTO DISPONIBLE!*\n\nEl producto *${state.data.name}* ya está en la tienda listo para su compra.`);
                }
                userStates[chatId]=null; return;
            }

            // AÑADIR STOCK KEYS
            if (state.step === 'ADD_STOCK_KEYS' && (adminData.isSuper || adminData.perms.products)) {
                const cKeys = text.split(/[\n,\s]+/).map(k=>k.trim()).filter(k=>k.length>0);
                if (cKeys.length===0) { userStates[chatId]=null; return bot.sendMessage(chatId, '❌ No hay Keys.'); }
                
                const updates = {};
                cKeys.forEach(k => {
                    const nId = push(ref(db)).key;
                    if (state.data.durId === 'legacy_var') updates[`products/${state.data.prodId}/keys/${nId}`] = k;
                    else updates[`products/${state.data.prodId}/durations/${state.data.durId}/keys/${nId}`] = k;
                });
                await update(ref(db), updates);
                bot.sendMessage(chatId, `✅ Se agregaron ${cKeys.length} keys.`, keyboard);
                
                const pSnap = await get(ref(db, `products/${state.data.prodId}`));
                const pName = pSnap.exists() ? pSnap.val().name : 'un producto';
                broadcastWA(`🔑 *¡REABASTECIMIENTO DE STOCK!*\n\nSe han agregado nuevas keys a *${pName}*. ¡Adquiere el tuyo antes de que se agoten!`);
                
                userStates[chatId]=null; return;
            }

            // EDICIONES
            if (state.step === 'EDIT_PROD_NAME') { await update(ref(db), { [`products/${state.data.prodId}/name`]: text }); bot.sendMessage(chatId, `✅ Nombre actualizado a: *${text}*`, keyboard); userStates[chatId]=null; return; }
            if (state.step.startsWith('EDIT_VAR_')) {
                const { prodId, durId } = state.data; const type = state.step.split('_')[2]; let u = {};
                if (type === 'PRICE') { const p=parseFloat(text); if(isNaN(p)) return bot.sendMessage(chatId,'❌ Error'); if(durId==='legacy_var') u[`products/${prodId}/price`]=p; else u[`products/${prodId}/durations/${durId}/price`]=p; }
                if (type === 'WARR') { const w=parseFloat(text); if(isNaN(w)) return bot.sendMessage(chatId,'❌ Error'); if(durId==='legacy_var') u[`products/${prodId}/warranty`]=w; else u[`products/${prodId}/durations/${durId}/warranty`]=w; }
                if (type === 'DUR') { if(durId==='legacy_var') u[`products/${prodId}/duration`]=text; else u[`products/${prodId}/durations/${durId}/duration`]=text; }
                await update(ref(db), u); bot.sendMessage(chatId, `✅ Variante actualizada.`, keyboard); userStates[chatId]=null; return;
            }

            // GESTIÓN ADMINS Y USUARIOS
            if (state.step === 'WAITING_FOR_ADMIN_ID') {
                const tTgId = parseInt(text.trim()); if (isNaN(tTgId) || tTgId===SUPER_ADMIN_ID) return bot.sendMessage(chatId, '❌ ID Inválido.');
                const aSnap = await get(ref(db, `admins/${tTgId}`));
                if (aSnap.exists()) bot.sendMessage(chatId, `⚙️ *Administrando a ID:* \`${tTgId}\``, { parse_mode: 'Markdown', reply_markup: buildAdminManagerInline(tTgId, aSnap.val().perms) });
                else { const perms = { products: false, balance: false, broadcast: false, refunds: false, coupons: false, stats: false, users: false, maintenance: false }; await set(ref(db, `admins/${tTgId}`), { perms }); bot.sendMessage(chatId, `✅ *Nuevo Admin Creado*\n\nID: \`${tTgId}\``, { parse_mode: 'Markdown', reply_markup: buildAdminManagerInline(tTgId, perms) }); }
                userStates[chatId]=null; return;
            }
            if (state.step === 'MANAGE_USER') {
                const uSnap = await get(ref(db, 'users')); let tUid = null;
                uSnap.forEach(u => { if (u.val().username === text.trim()) tUid = u.key; });
                if (!tUid) return bot.sendMessage(chatId, '❌ Usuario no encontrado.');
                await sendUserManageMenu(chatId, tUid, bot); userStates[chatId]=null; return;
            }
            if (state.step === 'TEMP_BAN_TIME') {
                const hrs = parseFloat(text); if (isNaN(hrs)) return bot.sendMessage(chatId, '❌ Inválido.');
                await update(ref(db), { [`users/${state.data.targetUid}/banned`]: true, [`users/${state.data.targetUid}/banUntil`]: Date.now() + (hrs*3600000) });
                bot.sendMessage(chatId, `✅ Baneado por ${hrs} horas.`, keyboard); userStates[chatId]=null; return;
            }

            // SALDOS (CON NOTIFICACIÓN WA)
            if (state.step === 'ADD_BALANCE_USER') { state.data.targetUser = text.trim(); state.step = 'ADD_BALANCE_AMOUNT'; return bot.sendMessage(chatId, `Dime la **cantidad** USD:`, { parse_mode: 'Markdown' }); }
            if (state.step === 'ADD_BALANCE_AMOUNT') {
                const amt = parseFloat(text); if (isNaN(amt)) return bot.sendMessage(chatId, '❌ Inválido.');
                const uSnap = await get(ref(db, 'users')); let fUid = null, cBal = 0, tWa = null;
                uSnap.forEach(c => { if (c.val().username === state.data.targetUser) { fUid = c.key; cBal = parseFloat(c.val().balance||0); tWa = c.val().waNumber; } });
                
                if (fUid) {
                    await update(ref(db), { [`users/${fUid}/balance`]: cBal + amt, [`users/${fUid}/recharges/${push(ref(db)).key}`]: { amount: amt, date: Date.now() } });
                    bot.sendMessage(chatId, `✅ Saldo añadido a ${state.data.targetUser}.`, keyboard);
                    const authSnap = await get(ref(db, 'telegram_auth'));
                    authSnap.forEach(c => { if(c.val() === fUid) bot.sendMessage(c.key, `🎉 Se depositaron: *$${amt} USD*`, { parse_mode: 'Markdown' }); });
                    if (tWa) enviarMensajeWA(tWa, `💰 *¡RECARGA APLICADA!*\n\nSe han sumado *$${amt} USD* a tu saldo en la tienda SociosXit.`);
                    await verificarBonoReferido(db, bot, fUid, amt);
                }
                userStates[chatId]=null; return;
            }
            
            if (state.step === 'DIRECT_ADD_BAL' || state.step === 'DIRECT_REM_BAL') {
                const amt = parseFloat(text); if (isNaN(amt)) return bot.sendMessage(chatId, '❌ Inválido.');
                const uSnap = await get(ref(db, `users/${state.data.targetUid}`)); 
                const uAct = uSnap.val(); const cBal = parseFloat(uAct.balance||0);
                
                if (state.step === 'DIRECT_ADD_BAL') {
                    await update(ref(db), { [`users/${state.data.targetUid}/balance`]: cBal + amt });
                    if (uAct.waLinked && uAct.waNumber) enviarMensajeWA(uAct.waNumber, `💰 *SALDO AÑADIDO!*\n\nEl administrador ha sumado *$${amt} USD* a tu cuenta.`);
                } else {
                    await update(ref(db), { [`users/${state.data.targetUid}/balance`]: Math.max(0, cBal - amt) });
                    if (uAct.waLinked && uAct.waNumber) enviarMensajeWA(uAct.waNumber, `➖ *SALDO RETIRADO*\n\nEl administrador ha descontado *$${amt} USD* de tu cuenta.`);
                }
                bot.sendMessage(chatId, `✅ Saldo actualizado.`, keyboard); userStates[chatId]=null; return;
            }

            // BROADCAST / REEMBOLSOS / CUPONES / RANGOS
            if (state.step === 'WAITING_FOR_BROADCAST_MESSAGE') {
                const aSnap = await get(ref(db, 'telegram_auth')); let c=0;
                aSnap.forEach(ch => { bot.sendMessage(ch.key, `📢 *Anuncio*\n\n${text}`, { parse_mode: 'Markdown' }).catch(()=>{}); c++; });
                broadcastWA(`📢 *COMUNICADO SociosXit*\n\n${text}`);
                bot.sendMessage(chatId, `✅ Mensaje enviado a Telegram (${c} usr) y a WhatsApp (si aplica).`, keyboard); userStates[chatId]=null; return;
            }
            if (state.step === 'WAITING_FOR_REFUND_KEY') {
                const sKey = text.trim().replace(/`/g, ''); const uSnap = await get(ref(db, 'users')); let fD = null;
                uSnap.forEach(u => { if (u.val().history) Object.keys(u.val().history).forEach(hId => { if (u.val().history[hId].key.trim() === sKey) fD = { uid: u.key, un: u.val().username, hId: hId, c: u.val().history[hId] }; }); });
                if (fD) {
                    if (fD.c.refunded) return bot.sendMessage(chatId, '⚠️ *Reembolsada.*', { parse_mode: 'Markdown' });
                    const m = `🧾 *DATOS*\nUsr: ${fD.un}\nProd: ${fD.c.product}\nKey: \`${fD.c.key}\`\nPagado: $${fD.c.price}`;
                    bot.sendMessage(chatId, m, { parse_mode: 'Markdown', reply_markup: { inline_keyboard: [ [{ text: '✅ Mandar Reembolso', callback_data: `rfnd|${fD.uid}|${fD.hId}` }], [{ text: '❌ Cancelar', callback_data: `cancel_refund` }] ] } });
                } else bot.sendMessage(chatId, '❌ Key no encontrada.');
                userStates[chatId]=null; return;
            }
            if (state.step === 'WAITING_FOR_REJECT_REASON') { bot.sendMessage(chatId, '✅ Razón enviada.', keyboard); bot.sendMessage(state.data.targetTgId, `❌ *RECHAZADO*\nMotivo:\n_${text.trim()}_`, { parse_mode: 'Markdown' }); userStates[chatId]=null; return; }
            if (state.step === 'CREATE_COUPON_CODE') { state.data.code = text.trim().toUpperCase(); state.step = 'CREATE_COUPON_TYPE'; return bot.sendMessage(chatId, `¿Tipo?`, { reply_markup: { inline_keyboard: [ [{ text: '💰 USD', callback_data: `cpntype|bal` }], [{ text: '📉 %', callback_data: `cpntype|desc` }] ] } }); }
            if (state.step === 'CREATE_COUPON_VALUE') { await set(ref(db, `coupons/${state.data.code}`), { type: state.data.type, value: parseFloat(text) }); bot.sendMessage(chatId, `✅ *Cupón creado.*`, keyboard); userStates[chatId]=null; return; }
            if (state.step === 'EDIT_RANK_MIN') { await update(ref(db), { [`settings/ranks/${state.data.rankId}/minGastado`]: parseFloat(text) }); bot.sendMessage(chatId, '✅ Actualizado.', keyboard); userStates[chatId]=null; return; }
            if (state.step === 'EDIT_RANK_DESC') { await update(ref(db), { [`settings/ranks/${state.data.rankId}/descuento`]: parseFloat(text) }); bot.sendMessage(chatId, '✅ Actualizado.', keyboard); userStates[chatId]=null; return; }
        }
        
        // REEMBOLSO USUARIO (Flujo Continuo)
        if (state.step === 'WAITING_FOR_USER_REFUND_KEY') {
            const sKey = text.trim().replace(/`/g, ''); let fD = null;
            if (webUser.history) Object.keys(webUser.history).forEach(hId => { if (webUser.history[hId].key.trim() === sKey) fD = { uid: webUid, username: webUser.username, histId: hId, compra: webUser.history[hId], targetTgId: tgId }; });
            
            if (fD) {
                if (fD.compra.refunded) { userStates[chatId]=null; return bot.sendMessage(chatId, '⚠️ *Ya reembolsada.*', { parse_mode: 'Markdown' }); }
                const hrs = (Date.now() - fD.compra.date) / 3600000;
                if (fD.compra.warrantyHours > 0 && hrs > fD.compra.warrantyHours) { userStates[chatId]=null; return bot.sendMessage(chatId, '❌ *GARANTÍA EXPIRADA*', { parse_mode: 'Markdown' }); }
                userStates[chatId] = { step: 'WAITING_FOR_USER_REFUND_PROOF', data: fD };
                return bot.sendMessage(chatId, '✅ *Key válida.*\n\nEnvía una **foto** del error.', { parse_mode: 'Markdown', ...cancelKeyboard });
            } else { userStates[chatId]=null; return bot.sendMessage(chatId, '❌ Key no encontrada en tu historial.'); }
        }

        if (state.step === 'WAITING_FOR_RECHARGE_AMOUNT') return sistemaRecargas.procesarMonto(bot, chatId, text, state.data, userStates);
    } 

    // --- BOTONES DEL PANEL ADMIN ---
    if (adminData) {
        if (text === '📱 Vincular Bot WA' && adminData.isSuper) {
            const kb = { inline_keyboard: [ [{text: '🇨🇴 Colombia (+57)', callback_data: 'walinkadmin|57'}, {text: '🇲🇽 México (+52)', callback_data: 'walinkadmin|52'}], [{text: '🌍 Otro (Escribir)', callback_data: 'walinkadmin|otro'}] ] };
            return bot.sendMessage(chatId, '📱 *VINCULAR BOT A WHATSAPP*\nSelecciona el país:', {parse_mode: 'Markdown', reply_markup: kb});
        }
        if (text === '📦 Crear Producto' && (adminData.isSuper || adminData.perms.products)) { userStates[chatId] = { step: 'CREATE_PROD_NAME', data: {} }; return bot.sendMessage(chatId, 'Escribe el **Nombre General**:', cancelKeyboard); }
        if (text === '➕ Añadir Variante' && (adminData.isSuper || adminData.perms.products)) {
            const pSnap = await get(ref(db, 'products')); let kb=[]; 
            pSnap.forEach(c => { kb.push([{ text: `➕ a: ${adaptarProductoLegacy(c.val()).name}`, callback_data: `addvar|${c.key}` }]); });
            return bot.sendMessage(chatId, `Selecciona el producto:`, { reply_markup: { inline_keyboard: kb } });
        }
        if (text === '🔑 Añadir Stock' && (adminData.isSuper || adminData.perms.products)) {
            const pSnap = await get(ref(db, 'products')); let kb=[]; 
            pSnap.forEach(c => { kb.push([{ text: `📦 ${adaptarProductoLegacy(c.val()).name}`, callback_data: `st_prod|${c.key}` }]); });
            return bot.sendMessage(chatId, `Selecciona producto:`, { reply_markup: { inline_keyboard: kb } });
        }
        if (text === '🎁 Regalar Producto' && (adminData.isSuper || adminData.perms.products)) { userStates[chatId] = { step: 'GIFT_USER', data: {} }; return bot.sendMessage(chatId, '🎁 Escribe el **Username** exacto del usuario:', cancelKeyboard); }
        if (text === '📝 Editar Producto' && (adminData.isSuper || adminData.perms.products)) {
            const pSnap = await get(ref(db, 'products')); let kb=[]; 
            pSnap.forEach(c => { kb.push([{ text: `⚙️ Opciones de: ${adaptarProductoLegacy(c.val()).name}`, callback_data: `ed_prod|${c.key}` }]); });
            return bot.sendMessage(chatId, `📝 Selecciona:`, { reply_markup: { inline_keyboard: kb } });
        }
        if (text === '🗑️ Eliminar Producto' && (adminData.isSuper || adminData.perms.products)) {
            const pSnap = await get(ref(db, 'products')); let kb=[]; 
            pSnap.forEach(c => { kb.push([{ text: `🗑️ En: ${adaptarProductoLegacy(c.val()).name}`, callback_data: `sel_delprod|${c.key}` }]); });
            return bot.sendMessage(chatId, `🗑️ Selecciona producto:`, { reply_markup: { inline_keyboard: kb } });
        }
        if (text === '🔍 Ver Keys/Eliminar' && adminData.isSuper) {
            const pSnap = await get(ref(db, 'products')); let kb=[]; 
            pSnap.forEach(c => { kb.push([{ text: `🔍 Extraer: ${adaptarProductoLegacy(c.val()).name}`, callback_data: `viewdel|${c.key}` }]); });
            return bot.sendMessage(chatId, `💎 Selecciona producto:`, { reply_markup: { inline_keyboard: kb } });
        }
        if (text === '📊 Estadísticas' && (adminData.isSuper || adminData.perms.stats)) {
            const uSnap = await get(ref(db, 'users')); const pSnap = await get(ref(db, 'products'));
            let tU=0, aR=0, aSu=0, aSc=0, aP=0, tK=0;
            if (uSnap.exists()) uSnap.forEach(u => { tU++; if(u.val().recharges) Object.values(u.val().recharges).forEach(r=>aR+=parseFloat(r.amount||0)); if(u.val().history) Object.values(u.val().history).forEach(h=>{aSc++;aSu+=parseFloat(h.price||0);}); });
            if (pSnap.exists()) pSnap.forEach(p => { aP++; const pr=adaptarProductoLegacy(p.val()); if(pr.durations) Object.values(pr.durations).forEach(d=>{if(d.keys)tK+=Object.keys(d.keys).length;}); });
            return bot.sendMessage(chatId, `📊 *DASHBOARD*\n👥 *Usuarios:* ${tU}\n💵 *Recargas:* $${aR.toFixed(2)}\n🛍️ *Ventas:* ${aSc} ($${aSu.toFixed(2)})\n📦 *Productos:* ${aP}\n🔑 *Keys Stock:* ${tK}`, { parse_mode: 'Markdown'});
        }
        if (text === '📢 Mensaje Global' && (adminData.isSuper || adminData.perms.broadcast)) { userStates[chatId] = { step: 'WAITING_FOR_BROADCAST_MESSAGE', data: {} }; return bot.sendMessage(chatId, '📝 Escribe el mensaje global:', cancelKeyboard); }
        if (text === '💰 Añadir Saldo' && (adminData.isSuper || adminData.perms.balance)) { userStates[chatId] = { step: 'ADD_BALANCE_USER', data: {} }; return bot.sendMessage(chatId, 'Escribe el **Username** exacto:', cancelKeyboard); }
        if (text === '🏆 Gest. Rangos' && (adminData.isSuper || adminData.perms.products)) {
            const r = await getRanks(db); let kb=[]; r.forEach(x => { kb.push([{ text: `${x.nombre} - Req $${x.minGastado}`, callback_data: `editrank|${x.id}` }]); });
            return bot.sendMessage(chatId, '🏆 *GESTOR RANGOS*', { parse_mode: 'Markdown', reply_markup: { inline_keyboard: kb } });
        }
        if (text === '🌍 Gest. Países' && adminData.isSuper) return sistemaRecargas.menuPaisesAdmin(bot, db, chatId);
        if (text === '👮 Gest. Admins' && adminData.isSuper) { userStates[chatId] = { step: 'WAITING_FOR_ADMIN_ID', data: {} }; return bot.sendMessage(chatId, '👮 Pega el ID de Telegram:', cancelKeyboard); }
        if (text === '📋 Ver Usuarios' && (adminData.isSuper || adminData.perms.stats)) return bot.sendMessage(chatId, '📋 *DIRECTORIO*', { parse_mode: 'Markdown', reply_markup: { inline_keyboard: [ [{ text: '💰 Con Saldo', callback_data: 'viewu|saldo' }, { text: '💸 Sin Saldo', callback_data: 'viewu|nosaldo' }], [{ text: '👥 Mostrar Todos', callback_data: 'viewu|todos' }] ] } });
        if (text === '🎟️ Crear Cupón' && (adminData.isSuper || adminData.perms.coupons)) { userStates[chatId] = { step: 'CREATE_COUPON_CODE', data: {} }; return bot.sendMessage(chatId, '🎟️ Escribe el código (Ej: DESC10):', cancelKeyboard); }
        if (text === '🔨 Gest. Usuarios' && (adminData.isSuper || adminData.perms.users)) { userStates[chatId] = { step: 'MANAGE_USER', data: {} }; return bot.sendMessage(chatId, '🔨 Escribe el **Username** exacto:', cancelKeyboard); }
        if (text === '📜 Historial Usuario' && (adminData.isSuper || adminData.perms.stats)) { userStates[chatId] = { step: 'HISTORY_USER', data: {} }; return bot.sendMessage(chatId, '📜 Escribe el **Username** exacto:', cancelKeyboard); }
        if (text === '🛠️ Mantenimiento' && (adminData.isSuper || adminData.perms.maintenance)) {
            const sSnap = await get(ref(db, 'settings/maintenance')); const nM = !(sSnap.val() || false);
            await update(ref(db), { 'settings/maintenance': nM }); return bot.sendMessage(chatId, `🛠️ **${nM ? 'CERRADA EN MANTENIMIENTO 🔴' : 'ABIERTA AL PÚBLICO 🟢'}**`, { parse_mode: 'Markdown' });
        }
        if (text === '🔄 Revisar Reembolsos' && (adminData.isSuper || adminData.perms.refunds)) { userStates[chatId] = { step: 'WAITING_FOR_REFUND_KEY', data: {} }; return bot.sendMessage(chatId, '🔎 Pega la Key que vas a buscar:', cancelKeyboard); }
    }
});

// ==========================================
// CALLBACKS (BOTONES INLINE)
// ==========================================
bot.on('callback_query', async (query) => {
    const chatId = query.message.chat.id; 
    const tgId = query.from.id; 
    const data = query.data;
    bot.answerCallbackQuery(query.id);
    
    // INTERCEPCIÓN VINCULACIÓN WA USUARIO
    if (data.startsWith('walinkuser|')) {
        const cod = data.split('|')[1];
        if (cod === 'otro') { userStates[chatId] = { step: 'USER_WA_CUSTOM_COUNTRY', data: {} }; return bot.editMessageText('🌍 Escribe el **Código de País** (Ej: 51 para Perú):', {chat_id: chatId, message_id: query.message.message_id, parse_mode: 'Markdown'}); } 
        else { userStates[chatId] = { step: 'USER_WA_NUMBER', data: { countryCode: cod } }; return bot.editMessageText(`✅ (+${cod}).\nEscribe tu **número de WhatsApp** (SIN código de país):`, {chat_id: chatId, message_id: query.message.message_id, parse_mode: 'Markdown'}); }
    }

    // INTERCEPCIÓN VINCULACIÓN WA ADMIN
    if (data.startsWith('walinkadmin|')) {
        const cod = data.split('|')[1];
        if (cod === 'otro') { userStates[chatId] = { step: 'ADMIN_WA_CUSTOM_COUNTRY', data: {} }; return bot.editMessageText('🌍 Escribe el **Código de País** del Bot:', {chat_id: chatId, message_id: query.message.message_id, parse_mode: 'Markdown'}); } 
        else { userStates[chatId] = { step: 'ADMIN_WA_NUMBER', data: { countryCode: cod } }; return bot.editMessageText(`✅ (+${cod}).\nEscribe el **número del Bot de WhatsApp** (sin código):`, {chat_id: chatId, message_id: query.message.message_id, parse_mode: 'Markdown'}); }
    }

    const webUid = await getAuthUser(tgId); 
    if (!webUid) return;
    
    const uSnap = await get(ref(db, `users/${webUid}`)); 
    const adminUsername = uSnap.exists() ? uSnap.val().username : 'Desc';
    const webUser = uSnap.val(); 
    const adminData = await getAdminData(tgId);

    // --- SUPER ADMIN ---
    if (adminData && adminData.isSuper) {
        if (data.startsWith('viewdel|')) {
            const pId = data.split('|')[1]; const pSnap = await get(ref(db, `products/${pId}`)); if (!pSnap.exists()) return; 
            const p = adaptarProductoLegacy(pSnap.val()); let kT = `📦 *PRODUCTO:* ${p.name}\n\n*KEYS DISPONIBLES:*\n`;
            if (p.durations) Object.keys(p.durations).forEach(dId => { const d = p.durations[dId]; kT += `\n⏱️ *${d.duration}*:\n`; if (d.keys && Object.keys(d.keys).length>0) Object.values(d.keys).forEach(k => kT += `\`${k}\`\n`); else kT += `_(Sin stock)_\n`; });
            if (kT.length > 4000) kT = kT.substring(0, 4000) + '\n...[LIMITE DE TELEGRAM]';
            return bot.sendMessage(chatId, kT, { parse_mode: 'Markdown', reply_markup: { inline_keyboard: [[{ text: '⚠️ PURGAR', callback_data: `delprod_confirm|${pId}` }]] } });
        }
        if (data.startsWith('delprod_confirm|')) { await remove(ref(db, `products/${data.split('|')[1]}`)); return bot.editMessageText('✅ Producto purgado.', { chat_id: chatId, message_id: query.message.message_id }); }
        if (data.startsWith('tgp|')) {
            const p = data.split('|'); const aRef = ref(db, `admins/${p[1]}/perms/${p[2]}`); const s = await get(aRef);
            await set(aRef, !(s.exists() ? s.val() : false)); const au = await get(ref(db, `admins/${p[1]}/perms`));
            return bot.editMessageReplyMarkup(buildAdminManagerInline(p[1], au.val()), { chat_id: chatId, message_id: query.message.message_id });
        }
        if (data.startsWith('deladm|')) { await remove(ref(db, `admins/${data.split('|')[1]}`)); return bot.editMessageText(`✅ Destituido.`, { chat_id: chatId, message_id: query.message.message_id }); }
    }

    // --- ADMINISTRACIÓN GENERAL ---
    if (adminData) {
        if (data.startsWith('sel_delprod|') && (adminData.isSuper || adminData.perms.products)) {
            const pId = data.split('|')[1]; const s = await get(ref(db, `products/${pId}`));
            if (!s.exists()) return bot.editMessageText('❌ No existe.', { chat_id: chatId, message_id: query.message.message_id });
            const p = adaptarProductoLegacy(s.val()); let kb = [];
            if (p.durations) Object.keys(p.durations).forEach(dId => { kb.push([{ text: `❌ Eliminar Variante: ${p.durations[dId].duration}`, callback_data: `del_var|${pId}|${dId}` }]); });
            kb.push([{ text: `⚠️ ELIMINAR TODO`, callback_data: `del_fullprod|${pId}` }]);
            return bot.editMessageText(`¿Qué eliminar de *${p.name}*?`, { chat_id: chatId, message_id: query.message.message_id, parse_mode: 'Markdown', reply_markup: { inline_keyboard: kb } });
        }
        if (data.startsWith('del_var|') || data.startsWith('del_fullprod|')) { 
            const isF = data.startsWith('del_fullprod'); const pId = data.split('|')[1];
            const prS = await get(ref(db, `products/${pId}`)); const pN = prS.exists() ? prS.val().name : 'Un producto';
            if (isF) await remove(ref(db, `products/${pId}`));
            else { const dId = data.split('|')[2]; if (dId === 'legacy_var') await remove(ref(db, `products/${pId}`)); else await remove(ref(db, `products/${pId}/durations/${dId}`)); }
            bot.editMessageText('✅ Eliminado.', { chat_id: chatId, message_id: query.message.message_id }); 
            broadcastWA(`🗑️ *PRODUCTO RETIRADO*\n\nEl producto *${pN}* ha sido modificado o eliminado de nuestra tienda temporalmente.`);
            return;
        }

        if (data.startsWith('setcat|')) { if (userStates[chatId] && userStates[chatId].step === 'CREATE_PROD_CAT') { userStates[chatId].data.category = data.split('|')[1]; userStates[chatId].step = 'CREATE_PROD_DURATION'; bot.editMessageText(`✅ Seleccionaste: ${data.split('|')[1]}.\n\nEscribe la **Duración**:`, {chat_id: chatId, message_id: query.message.message_id}); } return; }
        if (data.startsWith('addvar|')) { userStates[chatId] = { step: 'CREATE_PROD_DURATION', data: { isAddingVariant: true, prodId: data.split('|')[1] } }; return bot.editMessageText(`Escribe la **Nueva Duración**:`, {chat_id: chatId, message_id: query.message.message_id}); }
        if (data.startsWith('st_prod|')) {
            const pId = data.split('|')[1]; const s = await get(ref(db, `products/${pId}`)); if (!s.exists()) return;
            const p = adaptarProductoLegacy(s.val()); if (!p.durations) return; let kb = [];
            Object.keys(p.durations).forEach(dId => { kb.push([{ text: `⏱️ Añadir a: ${p.durations[dId].duration}`, callback_data: `st_dur|${pId}|${dId}` }]); });
            return bot.editMessageText(`📦 Selecciona Variante:`, { chat_id: chatId, message_id: query.message.message_id, reply_markup: { inline_keyboard: kb } });
        }
        if (data.startsWith('st_dur|')) { userStates[chatId] = { step: 'ADD_STOCK_KEYS', data: { prodId: data.split('|')[1], durId: data.split('|')[2] } }; return bot.editMessageText('Pega todas las **Keys**:', { chat_id: chatId, message_id: query.message.message_id, parse_mode: 'Markdown' }); }

        if (data.startsWith('gift_prod|')) {
            const [_, tUid, pId] = data.split('|'); const s = await get(ref(db, `products/${pId}`)); if (!s.exists()) return;
            const p = adaptarProductoLegacy(s.val()); let kb = [];
            if (p.durations) Object.keys(p.durations).forEach(dId => { kb.push([{ text: `🎁 Dar: ${p.durations[dId].duration}`, callback_data: `gift_do|${tUid}|${pId}|${dId}` }]); });
            return bot.editMessageText(`Selecciona Variante:`, { chat_id: chatId, message_id: query.message.message_id, reply_markup: { inline_keyboard: kb } });
        }
        if (data.startsWith('gift_do|')) {
            bot.editMessageReplyMarkup({ inline_keyboard: [] }, { chat_id: chatId, message_id: query.message.message_id });
            const [_, tUid, pId, dId] = data.split('|'); const s = await get(ref(db, `products/${pId}`)); const tuS = await get(ref(db, `users/${tUid}`));
            if (!s.exists() || !tuS.exists()) return;
            const p = adaptarProductoLegacy(s.val()); const dInfo = p.durations[dId];
            if (dInfo.keys && Object.keys(dInfo.keys).length > 0) {
                const kId = Object.keys(dInfo.keys)[0]; const kD = dInfo.keys[kId];
                let kP = `products/${pId}/durations/${dId}/keys/${kId}`; if (dId === 'legacy_var') kP = `products/${pId}/keys/${kId}`;
                await update(ref(db), { [kP]: null, [`users/${tUid}/history/${push(ref(db)).key}`]: { product: `${p.name} - ${dInfo.duration}`, key: kD, price: 0, date: Date.now(), refunded: false, warrantyHours: dInfo.warranty || 0 } });
                bot.sendMessage(chatId, `✅ *REGALO ENVIADO*\n\nKey: \`${kD}\``, { parse_mode: 'Markdown' });
                const aS = await get(ref(db, 'telegram_auth')); aS.forEach(c => { if(c.val() === tUid) bot.sendMessage(c.key, `🎁 *¡REGALO DEL STAFF!*\n\nProd: *${p.name}*\nKey: \`${kD}\``, { parse_mode: 'Markdown' }); });
            } else bot.sendMessage(chatId, '❌ Sin stock.');
            return;
        }

        if (data.startsWith('ed_prod|')) { return bot.editMessageText('¿Qué modificar?', { chat_id: chatId, message_id: query.message.message_id, reply_markup: { inline_keyboard: [ [{ text: '✏️ Editar Nombre', callback_data: `edit_pname|${data.split('|')[1]}` }], [{ text: '⚙️ Editar Variantes/Precios', callback_data: `list_vars|${data.split('|')[1]}` }] ] } }); }
        if (data.startsWith('edit_pname|')) { userStates[chatId] = { step: 'EDIT_PROD_NAME', data: { prodId: data.split('|')[1] } }; return bot.editMessageText('Escribe el **Nuevo Nombre**:', { chat_id: chatId, message_id: query.message.message_id, parse_mode: 'Markdown' }); }
        if (data.startsWith('list_vars|')) {
            const s = await get(ref(db, `products/${data.split('|')[1]}`)); if (!s.exists()) return;
            const p = adaptarProductoLegacy(s.val()); let kb = [];
            if (p.durations) Object.keys(p.durations).forEach(dId => { kb.push([{ text: `✏️ Conf: ${p.durations[dId].duration}`, callback_data: `ed_dur|${data.split('|')[1]}|${dId}` }]); });
            return bot.editMessageText(`Selecciona Variante:`, { chat_id: chatId, message_id: query.message.message_id, reply_markup: { inline_keyboard: kb } });
        }
        if (data.startsWith('ed_dur|')) { const p = data.split('|'); return bot.editMessageText('⚙️ ¿Qué editarás?', { chat_id: chatId, message_id: query.message.message_id, reply_markup: { inline_keyboard: [ [{ text: '💰 Precio USD', callback_data: `editv|PRICE|${p[1]}|${p[2]}` }], [{ text: '⏱️ Nombre', callback_data: `editv|DUR|${p[1]}|${p[2]}` }], [{ text: '⏳ Garantía', callback_data: `editv|WARR|${p[1]}|${p[2]}` }] ] } }); }
        if (data.startsWith('editv|')) { const p = data.split('|'); userStates[chatId] = { step: `EDIT_VAR_${p[1]}`, data: { prodId: p[2], durId: p[3] } }; return bot.sendMessage(chatId, `Escribe nuevo valor:`, cancelKeyboard); }

        if (data.startsWith('editrank|')) { const rId = data.split('|')[1]; return bot.editMessageText(`⚙️ *Editando*`, { chat_id: chatId, message_id: query.message.message_id, parse_mode: 'Markdown', reply_markup: { inline_keyboard: [ [{ text: '💰 Gasto Min', callback_data: `er_min|${rId}` }], [{ text: '📉 Descuento', callback_data: `er_desc|${rId}` }] ] } }); }
        if (data.startsWith('er_min|')) { userStates[chatId] = { step: 'EDIT_RANK_MIN', data: { rankId: data.split('|')[1] } }; return bot.sendMessage(chatId, '💰 Nueva cantidad USD:'); }
        if (data.startsWith('er_desc|')) { userStates[chatId] = { step: 'EDIT_RANK_DESC', data: { rankId: data.split('|')[1] } }; return bot.sendMessage(chatId, '📉 Nuevo descuento USD:'); }
        if (data.startsWith('toggle_pais|') && adminData.isSuper) return sistemaRecargas.togglePaisAdmin(bot, db, chatId, query.message.message_id, data.split('|')[1]);
        
        if (data.startsWith('viewu|')) {
            const f = data.split('|')[1]; const usS = await get(ref(db, 'users')); let kb = [];
            if (usS.exists()) { usS.forEach(u => { const s = parseFloat(u.val().balance||0); let i = false; if(f==='saldo'&&s>0)i=true; if(f==='nosaldo'&&s<=0)i=true; if(f==='todos')i=true; if(i) kb.push([{ text: `👤 ${u.val().username} - $${s.toFixed(2)}`, callback_data: `usermenu|${u.key}` }]); }); }
            if (kb.length > 90) kb = kb.slice(0, 90);
            return bot.editMessageText('📋 *USUARIOS*', { chat_id: chatId, message_id: query.message.message_id, reply_markup: { inline_keyboard: kb }, parse_mode: 'Markdown' });
        }
        if (data.startsWith('usermenu|')) return sendUserManageMenu(chatId, data.split('|')[1], bot);
        if (data.startsWith('uact|')) {
            const [_, act, tUid] = data.split('|');
            if (act === 'banperm') { const uS = await get(ref(db, `users/${tUid}`)); await update(ref(db), { [`users/${tUid}/banned`]: !(uS.val().banned||false), [`users/${tUid}/banUntil`]: null }); return bot.editMessageText(`✅ Actualizado.`, { chat_id: chatId, message_id: query.message.message_id }); }
            if (act === 'bantemp') { userStates[chatId] = { step: 'TEMP_BAN_TIME', data: { targetUid: tUid } }; return bot.sendMessage(chatId, '⏳ Horas de baneo:'); }
            if (act === 'addbal') { userStates[chatId] = { step: 'DIRECT_ADD_BAL', data: { targetUid: tUid } }; return bot.sendMessage(chatId, '➕ USD a AGREGAR directo:'); }
            if (act === 'rembal') { userStates[chatId] = { step: 'DIRECT_REM_BAL', data: { targetUid: tUid } }; return bot.sendMessage(chatId, '➖ USD a QUITAR directo:'); }
        }
        if (data.startsWith('cpntype|')) { userStates[chatId].data.type = data.split('|')[1]==='bal'?'balance':'discount'; userStates[chatId].step = 'CREATE_COUPON_VALUE'; return bot.editMessageText('Escribe el valor numérico:', { chat_id: chatId, message_id: query.message.message_id }); }
        
        if (data.startsWith('rfnd|')) {
            bot.editMessageReplyMarkup({ inline_keyboard: [] }, { chat_id: chatId, message_id: query.message.message_id });
            const [_, tUid, hId] = data.split('|'); const uDS = await get(ref(db, `users/${tUid}`)); if(!uDS.exists()) return;
            const uD = uDS.val(); const c = uD.history[hId];
            if (c && !c.refunded) {
                const pr = parseFloat(c.price||0); const nS = parseFloat(uD.balance||0) + pr;
                await update(ref(db), { [`users/${tUid}/balance`]: nS, [`users/${tUid}/history/${hId}/refunded`]: true });
                bot.sendMessage(chatId, `✅ *Reembolsado* a ${uD.username}.`, { parse_mode: 'Markdown' });
                const aS = await get(ref(db, 'telegram_auth')); aS.forEach(ch => { if(ch.val() === tUid) bot.sendMessage(ch.key, `🔄 *REEMBOLSO APROBADO*\n\n💰 +$${pr} USD\n💳 Saldo: $${nS.toFixed(2)}`, { parse_mode: 'Markdown' }); });
            } return;
        }
        if (data.startsWith('reject_refund|')) { bot.editMessageReplyMarkup({ inline_keyboard: [] }, { chat_id: chatId, message_id: query.message.message_id }); userStates[chatId] = { step: 'WAITING_FOR_REJECT_REASON', data: { targetTgId: data.split('|')[1] } }; return bot.sendMessage(chatId, '✍️ *Escribe motivo rechazo:*', { parse_mode: 'Markdown' }); }
        if (data === 'cancel_refund') { bot.editMessageReplyMarkup({ inline_keyboard: [] }, { chat_id: chatId, message_id: query.message.message_id }); return bot.sendMessage(chatId, '❌ Cancelado.'); }

        if (data.startsWith('ok_rech|')) return sistemaRecargas.aprobarRecarga(bot, db, chatId, query.message.message_id, data.split('|')[1], adminUsername, tgId, notifySuperAdmin);
        if (data.startsWith('no_rech|')) return sistemaRecargas.rechazarRecarga(bot, db, chatId, query.message.message_id, data.split('|')[1], adminUsername, tgId, notifySuperAdmin);
    }

    // --- COMPRA DE USUARIO ---
    if (data.startsWith('tcat|')) {
        const cat = data.split('|')[1]; const pS = await get(ref(db, 'products')); let kb = [];
        if (pS.exists()) { pS.forEach(c => { const p = adaptarProductoLegacy(c.val()); if (p.category === cat) kb.push([{ text: `⚡️ ${p.name}`, callback_data: `tprod|${c.key}` }]); }); }
        if (kb.length === 0) return bot.editMessageText(`❌ No hay productos activos.`, { chat_id: chatId, message_id: query.message.message_id });
        return bot.editMessageText(`📦 Productos en *${cat}*:`, { chat_id: chatId, message_id: query.message.message_id, parse_mode: 'Markdown', reply_markup: { inline_keyboard: kb } });
    }

    if (data.startsWith('tprod|')) {
        const pId = data.split('|')[1]; const s = await get(ref(db, `products/${pId}`));
        if (!s.exists()) return bot.editMessageText('❌ No existe.', { chat_id: chatId, message_id: query.message.message_id });
        const p = adaptarProductoLegacy(s.val()); if (!p.durations) return;
        
        const rAct = await obtenerRango(db, calcularGastoTotal(webUser.history)); const aDesc = parseFloat(webUser.active_discount || 0); let kb = [];
        Object.keys(p.durations).forEach(dId => {
            const d = p.durations[dId]; const stk = d.keys ? Object.keys(d.keys).length : 0;
            if (stk > 0) {
                let sPr = d.price; if (rAct.descuento > 0) sPr = Math.max(0, sPr - rAct.descuento); if (aDesc > 0) sPr = sPr - (sPr * (aDesc/100));
                kb.push([{ text: `${d.duration} - $${sPr.toFixed(2)} (${stk} disp)`, callback_data: `buy|${pId}|${dId}` }]);
            }
        });
        if(kb.length === 0) return bot.editMessageText(`❌ Opciones agotadas.`, { chat_id: chatId, message_id: query.message.message_id });
        return bot.editMessageText(`Selecciona duración de *${p.name}*:`, { chat_id: chatId, message_id: query.message.message_id, parse_mode: 'Markdown', reply_markup: { inline_keyboard: kb } });
    }

    if (data.startsWith('buy|')) {
        const [_, pId, dId] = data.split('|'); const wM = await bot.sendMessage(chatId, '⚙️ Procesando...');
        const uS = await get(ref(db, `users/${webUid}`)); const pS = await get(ref(db, `products/${pId}`));
        if (!uS.exists() || !pS.exists()) return bot.editMessageText('❌ Error base de datos.', { chat_id: chatId, message_id: wM.message_id });
        
        let wUN = uS.val(); let pr = adaptarProductoLegacy(pS.val());
        if (!pr.durations || !pr.durations[dId]) return bot.editMessageText('❌ Error validación.', { chat_id: chatId, message_id: wM.message_id });
        
        const dInfo = pr.durations[dId]; let cB = parseFloat(wUN.balance||0); let aD = parseFloat(wUN.active_discount||0);
        const rAct = await obtenerRango(db, calcularGastoTotal(wUN.history));
        let fP = dInfo.price; if (rAct.descuento > 0) fP = Math.max(0, fP - rAct.descuento); if (aD > 0) fP = fP - (fP * (aD/100));

        if (cB < fP) return bot.editMessageText(`❌ Saldo insuficiente.\nPrecio: $${fP.toFixed(2)} | Saldo: $${cB.toFixed(2)}`, { chat_id: chatId, message_id: wM.message_id });
        
        if (dInfo.keys && Object.keys(dInfo.keys).length > 0) {
            const kId = Object.keys(dInfo.keys)[0]; const kD = dInfo.keys[kId]; const kR = Object.keys(dInfo.keys).length - 1; 
            let kP = `products/${pId}/durations/${dId}/keys/${kId}`; if (dId === 'legacy_var') kP = `products/${pId}/keys/${kId}`;

            const u = { [kP]: null, [`users/${webUid}/balance`]: cB - fP };
            if (aD > 0) u[`users/${webUid}/active_discount`] = null;
            u[`users/${webUid}/history/${push(ref(db)).key}`] = { product: `${pr.name} - ${dInfo.duration}`, key: kD, price: fP, date: Date.now(), refunded: false, warrantyHours: dInfo.warranty || 0 };

            await update(ref(db), u);
            bot.editMessageText(`✅ *COMPRA COMPLETADA*\n\n\`${kD}\``, { chat_id: chatId, message_id: wM.message_id, parse_mode: 'Markdown' });
            if (kR <= 3) bot.sendMessage(SUPER_ADMIN_ID, `⚠️ *ALERTA STOCK*\n\n${pr.name} (${dInfo.duration})\nSolo quedan **${kR}** keys.`, { parse_mode: 'Markdown' });
        } else bot.editMessageText('❌ Agotado.', { chat_id: chatId, message_id: wM.message_id });
    }

    if (data.startsWith('sel_pais|')) { if (userStates[chatId] && userStates[chatId].data) return sistemaRecargas.seleccionarPais(bot, chatId, data.split('|')[1], userStates[chatId].data, userStates); return bot.sendMessage(chatId, '❌ Expirado.'); }
    if (data.startsWith('send_receipt|')) return sistemaRecargas.solicitarComprobante(bot, db, chatId, webUid, parseFloat(data.split('|')[1]), data.split('|')[2], userStates);
});

// ==========================================
// CIERRE SEGURO
// ==========================================
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));

console.log('🤖 Terminal de SociosXit (VERSIÓN 100% COMPLETA + WA) En línea y a la espera...');
