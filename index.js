const TelegramBot = require('node-telegram-bot-api');
const { initializeApp } = require('firebase/app');
const { getDatabase, ref, get, update, push, set, remove } = require('firebase/database');
const sistemaRecargas = require('./recargas');

// --- INTEGRACIÓN WHATSAPP (BAILEYS) ---
const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, delay, Browsers } = require('@whiskeysockets/baileys');
const pino = require('pino');

let waSocket = null;
let isWaConnected = false;
const waVerificationCodes = {}; // Almacena códigos temporales para verificar usuarios

async function initWA(pairNumber = null, tgChatId = null, botInstance = null) {
    const { state, saveCreds } = await useMultiFileAuthState('wa_auth_session');
    
    waSocket = makeWASocket({
        logger: pino({ level: 'silent' }),
        printQRInTerminal: false,
        auth: state,
        browser: Browsers.macOS('Desktop'), // Simula ser la app nativa de Mac para evitar bloqueos
        syncFullHistory: false // Evita sobrecargar la memoria y acelera la vinculación
    });

    waSocket.ev.on('creds.update', saveCreds);

    if (pairNumber && !waSocket.authState.creds.registered) {
        setTimeout(async () => {
            try {
                let code = await waSocket.requestPairingCode(pairNumber);
                code = code?.match(/.{1,4}/g)?.join('-') || code;
                if (botInstance && tgChatId) {
                    botInstance.sendMessage(tgChatId, `📲 *CÓDIGO DE VINCULACIÓN WHATSAPP:*\n\n\`${code}\`\n\nVe a WhatsApp > Dispositivos Vinculados > Vincular con número de teléfono, e ingresa este código.`, { parse_mode: 'Markdown' });
                }
            } catch (error) {
                if (botInstance && tgChatId) {
                    botInstance.sendMessage(tgChatId, '❌ Error al generar el código de WhatsApp. Es posible que el servidor de Meta esté bloqueando la solicitud. Intenta nuevamente más tarde.');
                    console.error('Error solicitando Pairing Code:', error);
                }
            }
        }, 3000);
    }

    waSocket.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect } = update;
        if (connection === 'close') {
            isWaConnected = false;
            const shouldReconnect = lastDisconnect.error?.output?.statusCode !== DisconnectReason.loggedOut;
            if (shouldReconnect) initWA();
        } else if (connection === 'open') {
            isWaConnected = true;
            console.log('✅ WhatsApp Bot Conectado Exitosamente');
            if (botInstance && tgChatId) botInstance.sendMessage(tgChatId, '✅ *WhatsApp vinculado y conectado correctamente al servidor.*', { parse_mode: 'Markdown' });
        }
    });
}
initWA(); // Iniciar sesión WA al arrancar el script

// Helpers WhatsApp
async function enviarWA(numero, mensaje) {
    if (!isWaConnected || !waSocket) return;
    try {
        const jid = `${numero}@s.whatsapp.net`;
        await waSocket.sendMessage(jid, { text: mensaje });
    } catch (e) { console.log('Error enviando WA:', e.message); }
}

async function broadcastWA(mensaje, db) {
    if (!isWaConnected || !waSocket) return;
    const usersSnap = await get(ref(db, 'users'));
    if (!usersSnap.exists()) return;
    
    let usersWA = [];
    usersSnap.forEach(u => {
        if (u.val().whatsapp) usersWA.push(u.val().whatsapp);
    });

    for (const num of usersWA) {
        await enviarWA(num, mensaje);
        await delay(2500); // Retraso obligatorio para evitar baneos por spam
    }
}
// --------------------------------------

// CONFIGURACIÓN MASTER
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

function adaptarProductoLegacy(p) {
    if (p && !p.durations && p.price !== undefined) {
        p.durations = {
            'legacy_var': {
                duration: p.duration || 'Única / Estándar',
                price: p.price,
                warranty: p.warranty || 0,
                keys: p.keys || {}
            }
        };
        p.category = p.category || 'Android'; 
    }
    return p;
}

async function getRanks(db) {
    const snap = await get(ref(db, 'settings/ranks'));
    if (snap.exists()) {
        const ranksObj = snap.val();
        return Object.keys(ranksObj)
            .map(key => ({ id: key, ...ranksObj[key] }))
            .sort((a, b) => b.minGastado - a.minGastado);
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
        return Object.keys(defaultRanks)
            .map(key => ({ id: key, ...defaultRanks[key] }))
            .sort((a, b) => b.minGastado - a.minGastado);
    }
}

function calcularGastoTotal(historial) {
    let total = 0;
    if (historial) {
        Object.values(historial).forEach(compra => { 
            if (!compra.refunded) {
                total += parseFloat(compra.price || 0); 
            }
        });
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
        if (user.recharges) {
            Object.values(user.recharges).forEach(r => totalRecharged += parseFloat(r.amount || 0));
        }
        
        if (totalRecharged >= 5 || amountAdded >= 5) {
            const inviterCode = user.referredBy;
            const codeSnap = await get(ref(db, `referral_codes/${inviterCode}`));
            
            if (codeSnap.exists()) {
                const inviterUid = codeSnap.val();
                const inviterSnap = await get(ref(db, `users/${inviterUid}`));
                
                if (inviterSnap.exists()) {
                    const inviterBal = parseFloat(inviterSnap.val().balance || 0);
                    await update(ref(db), { 
                        [`users/${inviterUid}/balance`]: inviterBal + 2, 
                        [`users/${targetUid}/referralRewarded`]: true 
                    });
                    
                    const tgAuthSnap = await get(ref(db, `telegram_auth`));
                    let inviterTgId = null;
                    tgAuthSnap.forEach(child => { 
                        if (child.val() === inviterUid) inviterTgId = child.key; 
                    });
                    
                    if (inviterTgId) {
                        const msgBono = `━━━━━━━━━━━━━━━━━━━━━\n` +
                                        `🎉 *¡BONO DE REFERIDO!*\n` +
                                        `━━━━━━━━━━━━━━━━━━━━━\n\n` +
                                        `Tu referido *${user.username}* acaba de realizar su primera recarga de $5 USD o más.\n\n` +
                                        `🎁 Acabas de recibir *$2.00 USD* de saldo gratis.\n` +
                                        `💰 Tu nuevo saldo es: *$${(inviterBal + 2).toFixed(2)} USD*`;
                        bot.sendMessage(inviterTgId, msgBono, { parse_mode: 'Markdown' });
                    }
                }
            }
        }
    }
}

const userStates = {}; 

const userKeyboard = {
    reply_markup: {
        keyboard: [
            [{ text: '🛒 Tienda' }, { text: '👤 Mi Perfil' }],
            [{ text: '💳 Recargas' }, { text: '🤝 Referidos' }],
            [{ text: '🎟️ Canjear Cupón' }, { text: '💸 Transferir Saldo' }],
            [{ text: '🔄 Resetear Key' }, { text: '🔄 Solicitar Reembolso' }],
            [{ text: '📱 Vincular Mi WhatsApp' }]
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
    if (tgId === SUPER_ADMIN_ID) {
        return { isSuper: true, perms: { products: true, balance: true, broadcast: true, refunds: true, coupons: true, stats: true, users: true, maintenance: true } };
    }
    const snap = await get(ref(db, `admins/${tgId}`));
    if (snap.exists()) return { isSuper: false, perms: snap.val().perms || {} };
    return null;
}

function buildAdminKeyboard(adminData) {
    const kb = []; 
    let row = [];
    
    const addBtn = (text, perm) => { 
        if (adminData.isSuper || adminData.perms[perm]) { 
            row.push({ text }); 
            if (row.length === 3) { 
                kb.push(row); 
                row = []; 
            } 
        } 
    };
    
    addBtn('📦 Crear Producto', 'products'); 
    addBtn('➕ Añadir Variante', 'products'); 
    addBtn('📝 Editar Producto', 'products');
    addBtn('🗑️ Eliminar Producto', 'products'); 
    addBtn('🔑 Añadir Stock', 'products'); 
    addBtn('🎁 Regalar Producto', 'products'); 
    addBtn('💰 Añadir Saldo', 'balance'); 
    addBtn('📢 Mensaje Global', 'broadcast'); 
    addBtn('🔄 Revisar Reembolsos', 'refunds'); 
    addBtn('🎟️ Crear Cupón', 'coupons'); 
    addBtn('📊 Estadísticas', 'stats'); 
    addBtn('📋 Ver Usuarios', 'stats'); 
    addBtn('📜 Historial Usuario', 'stats'); 
    addBtn('🔨 Gest. Usuarios', 'users'); 
    addBtn('🛠️ Mantenimiento', 'maintenance'); 
    addBtn('🏆 Gest. Rangos', 'products'); 
    
    if (row.length > 0) kb.push(row);
    
    let bottomRow = [];
    if (adminData.isSuper) { 
        bottomRow.push({ text: '🔍 Ver Keys/Eliminar' }); 
        bottomRow.push({ text: '👮 Gest. Admins' }); 
        bottomRow.push({ text: '🌍 Gest. Países' }); 
        bottomRow.push({ text: '📱 Vincular WA Bot' }); 
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
        const horasRestantes = ((targetUser.banUntil - Date.now()) / 3600000).toFixed(1);
        banText = `⏳ BANEADO TEMPORAL (${horasRestantes} hrs restantes)`;
    }

    const msgInfo = `━━━━━━━━━━━━━━━━━━━━━\n` +
                    `👤 *GESTIÓN DE USUARIO*\n` +
                    `━━━━━━━━━━━━━━━━━━━━━\n\n` +
                    `*Nombre:* ${targetUser.username}\n` +
                    `*Saldo:* $${parseFloat(targetUser.balance||0).toFixed(2)} USD\n` +
                    `*Gastado Total:* $${totalSpent.toFixed(2)} USD\n` +
                    `*Rango:* ${rangoActual.nombre}\n` +
                    `*WA Vinculado:* ${targetUser.whatsapp ? '✅ ' + targetUser.whatsapp : '❌ No'}\n` +
                    `*Estado:* ${banText}`;
                    
    const inlineKeyboard = [
        [{ text: '➕ Agregar Saldo', callback_data: `uact|addbal|${targetUid}` }, { text: '➖ Quitar Saldo', callback_data: `uact|rembal|${targetUid}` }],
        [{ text: isBanned ? '✅ Desbanear' : '🔨 Ban Permanente', callback_data: `uact|banperm|${targetUid}` }, { text: '⏳ Ban Temporal', callback_data: `uact|bantemp|${targetUid}` }]
    ];
    bot.sendMessage(chatId, msgInfo, { parse_mode: 'Markdown', reply_markup: { inline_keyboard: inlineKeyboard } });
}

// ==========================================
// RECEPCIÓN DE MENSAJES Y COMANDOS DE TEXTO
// ==========================================
bot.onText(/\/start(?: (.*))?/, async (msg, match) => {
    const chatId = msg.chat.id;
    const tgId = msg.from.id;
    const refCodeParam = match[1] ? match[1].trim().toUpperCase() : null;
    userStates[chatId] = null; 

    const webUid = await getAuthUser(tgId);
    if (!webUid) {
        const denyMsg = `🛑 *ACCESO DENEGADO*\n\nTu dispositivo no está vinculado a una cuenta web.\n🔑 *TU ID DE TELEGRAM ES:* \`${tgId}\``;
        return bot.sendMessage(chatId, denyMsg, { parse_mode: 'Markdown' });
    }

    const userSnap = await get(ref(db, `users/${webUid}`));
    const webUser = userSnap.val();
    if (!webUser) {
        return bot.sendMessage(chatId, '⚠️ *ERROR CRÍTICO*\n\nTu cuenta web no se encuentra en la base de datos.', { parse_mode: 'Markdown' });
    }

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
    if (adminData) {
        greeting = adminData.isSuper ? `👑 ¡Bienvenido Super Admin SociosXit, *${webUser.username}*!` : `🛡️ Bienvenido Admin cibernético, *${webUser.username}*.`;
    }

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
        if (webUser.banUntil && webUser.banUntil > Date.now()) {
            isBanned = true;
        } else if (webUser.banUntil && webUser.banUntil <= Date.now()) { 
            isBanned = false; 
            await update(ref(db), { [`users/${webUid}/banned`]: false, [`users/${webUid}/banUntil`]: null }); 
        }
        
        if (isBanned) return bot.sendMessage(chatId, '🚫 *ESTÁS BANEADO*\nContacta a soporte para más información.', { parse_mode: 'Markdown' });
        if (isMaintenance) return bot.sendMessage(chatId, '🛠️ *MODO MANTENIMIENTO ACTIVO*\nEstamos aplicando mejoras. Volveremos pronto.', { parse_mode: 'Markdown' });
        
        if (!webUser.whatsapp && !['📱 Vincular Mi WhatsApp', '❌ Cancelar Acción', '👤 Mi Perfil'].includes(text) && !userStates[chatId]) {
            return bot.sendMessage(chatId, '⚠️ *VERIFICACIÓN REQUERIDA*\n\nPara usar el bot, debes vincular tu número de WhatsApp para recibir las notificaciones de saldo y compras.\n\nPor favor presiona el botón **📱 Vincular Mi WhatsApp**.', { parse_mode: 'Markdown' });
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
            return sistemaRecargas.recibirFotoComprobante(bot, db, chatId, tgId, fileId, state.data, keyboard, SUPER_ADMIN_ID, userStates);
        }
        
        if (state.step === 'WAITING_FOR_USER_REFUND_PROOF') {
            const foundData = state.data;
            const reason = msg.caption ? msg.caption : 'Sin razón especificada';
            
            const msgInfo = `🔔 *NUEVA SOLICITUD DE REEMBOLSO*\n\n` +
                          `👤 *Usuario:* ${foundData.username}\n` +
                          `📦 *Producto:* ${foundData.compra.product}\n` +
                          `🔑 *Key:* \`${foundData.compra.key}\`\n` +
                          `💰 *Pagado:* $${parseFloat(foundData.compra.price).toFixed(2)} USD\n` +
                          `📝 *Motivo:* ${reason}`;
                          
            const refundKeyboard = { 
                inline_keyboard: [
                    [{ text: '✅ Mandar Reembolso', callback_data: `rfnd|${foundData.uid}|${foundData.histId}` }], 
                    [{ text: '❌ Rechazar Solicitud', callback_data: `reject_refund|${foundData.targetTgId}` }]
                ] 
            };
            
            bot.sendPhoto(SUPER_ADMIN_ID, fileId, { caption: msgInfo, parse_mode: 'Markdown', reply_markup: refundKeyboard });
            userStates[chatId] = null;
            return bot.sendMessage(chatId, '✅ Tu solicitud ha sido enviada. El Staff la revisará pronto.', keyboard);
        }
    }

    if (!text) return; 

    // --- ACCIONES DE VINCULACIÓN DE WHATSAPP ---
    if (text === '📱 Vincular Mi WhatsApp') {
        userStates[chatId] = { step: 'WA_USER_NUMBER', data: {} };
        return bot.sendMessage(chatId, '📱 *VINCULACIÓN WHATSAPP*\n\nPor favor envía tu número de WhatsApp **incluyendo el código de país**.\nEjemplo: `573001234567`', { parse_mode: 'Markdown', ...cancelKeyboard });
    }

    if (text === '📱 Vincular WA Bot' && adminData && adminData.isSuper) {
        const paisesKb = [
            [{ text: '🇨🇴 Colombia (+57)', callback_data: 'wa_c|57' }, { text: '🇲🇽 México (+52)', callback_data: 'wa_c|52' }],
            [{ text: '🇦🇷 Argentina (+54)', callback_data: 'wa_c|54' }, { text: '🇨🇱 Chile (+56)', callback_data: 'wa_c|56' }],
            [{ text: '🇪🇸 España (+34)', callback_data: 'wa_c|34' }, { text: '🌎 Otro', callback_data: 'wa_c|otro' }]
        ];
        return bot.sendMessage(chatId, '⚙️ *VINCULAR NÚMERO MASTER WA*\n\nSelecciona el país del número que será el Bot:', { parse_mode: 'Markdown', reply_markup: { inline_keyboard: paisesKb } });
    }

    // --- ACCIONES GENERALES DEL BOTÓN USUARIO ---
    if (text === '🔄 Solicitar Reembolso') {
        userStates[chatId] = { step: 'WAITING_FOR_USER_REFUND_KEY', data: {} };
        return bot.sendMessage(chatId, '🔄 *SOLICITAR REEMBOLSO*\n\nPor favor, envía la **Key** exacta de la compra que presenta problemas.', { parse_mode: 'Markdown', ...cancelKeyboard });
    }
    
    if (text === '🔄 Resetear Key') {
        userStates[chatId] = { step: 'WAITING_FOR_RESET_KEY', data: {} };
        return bot.sendMessage(chatId, '🔄 *RESETEO DE KEY*\n\nEnvía la **Key** que deseas resetear.', { parse_mode: 'Markdown', ...cancelKeyboard });
    }
    
    if (text === '💸 Transferir Saldo') {
        userStates[chatId] = { step: 'TRANSFER_USERNAME', data: {} };
        return bot.sendMessage(chatId, '💸 *TRANSFERIR SALDO*\n\nEscribe el *Nombre de Usuario* exacto al que le quieres enviar saldo:', { parse_mode: 'Markdown', ...cancelKeyboard });
    }
    
    if (text === '🎟️ Canjear Cupón') {
        userStates[chatId] = { step: 'REDEEM_COUPON', data: {} };
        return bot.sendMessage(chatId, '🎁 *CANJEAR CUPÓN*\n\nEscribe tu código promocional:', { parse_mode: 'Markdown', ...cancelKeyboard });
    }
    
    if (text === '💳 Recargas') {
        return sistemaRecargas.iniciarRecarga(bot, db, chatId, webUser, userStates);
    }
    
    if (text === '👤 Mi Perfil') {
        const totalGastado = calcularGastoTotal(webUser.history);
        const rangoActual = await obtenerRango(db, totalGastado);
        
        const saldoUSD = parseFloat(webUser.balance || 0);
        const saldoCOP = (saldoUSD * TASA_COP).toLocaleString('es-CO');
        
        let msgPerfil = `━━━━━━━━━━━━━━━━━━━━━\n` +
                        `👤 *PERFIL SociosXit*\n` +
                        `━━━━━━━━━━━━━━━━━━━━━\n\n` +
                        `*Usuario:* ${webUser.username}\n` +
                        `💰 *Saldo:* $${saldoUSD.toFixed(2)} USD\n` +
                        `🇨🇴 _(Aprox. $${saldoCOP} COP)_\n\n` +
                        `🏆 *Rango Actual:* ${rangoActual.nombre}\n` +
                        `📈 *Total Gastado:* $${totalGastado.toFixed(2)} USD\n` +
                        `📱 *WhatsApp:* ${webUser.whatsapp ? '✅ Vinculado' : '❌ Pendiente'}\n` +
                        `💸 *Descuento VIP:* -$${parseFloat(rangoActual.descuento || 0).toFixed(2)} USD en tienda.`;
                        
        if (webUser.active_discount > 0) {
            msgPerfil += `\n\n🎟️ *Cupón Activo:* Tienes un ${webUser.active_discount}% EXTRA OFF en tu próxima compra.`;
        }
        
        return bot.sendMessage(chatId, msgPerfil, { parse_mode: 'Markdown' });
    }
    
    if (text === '🤝 Referidos') {
        let miCodigo = webUser.referralCode;
        if (!miCodigo) {
            miCodigo = 'LUCK-' + Math.random().toString(36).substring(2, 7).toUpperCase();
            await update(ref(db), { [`users/${webUid}/referralCode`]: miCodigo, [`referral_codes/${miCodigo}`]: webUid });
        }
        const botInfo = await bot.getMe();
        
        let msgRef = `━━━━━━━━━━━━━━━━━━━━━\n` +
                     `🤝 *SISTEMA DE REFERIDOS*\n` +
                     `━━━━━━━━━━━━━━━━━━━━━\n\n` +
                     `Invita y gana saldo. Por cada recarga inicial de **$5 USD** de tus amigos, tú recibes **$2 USD** gratis.\n\n` +
                     `🎟️ *Tu Código:* \`${miCodigo}\`\n` +
                     `🔗 *Enlace directo:*\n\`https://t.me/${botInfo.username}?start=${miCodigo}\``;
                     
        if (!webUser.referredBy) { 
            userStates[chatId] = { step: 'WAITING_FOR_REF_CODE', data: {} }; 
            msgRef += `\n\n✍️ *¿Alguien te invitó a SociosXit?*\nEscribe su código aquí mismo para apoyarlo.`; 
        }
        
        return bot.sendMessage(chatId, msgRef, { parse_mode: 'Markdown' });
    }
    
    if (text === '🛒 Tienda') {
        const productsSnap = await get(ref(db, 'products'));
        if (!productsSnap.exists()) return bot.sendMessage(chatId, '🛒 Tienda vacía en este momento.');
        
        const catKb = [ 
            [{ text: '📱 Android', callback_data: 'tcat|Android' }, { text: '🍎 iPhone', callback_data: 'tcat|iPhone' }], 
            [{ text: '💻 PC', callback_data: 'tcat|PC' }] 
        ];
        
        const msgTienda = `━━━━━━━━━━━━━━━━━━━━━\n` +
                          `🛒 *ARSENAL DISPONIBLE*\n` +
                          `━━━━━━━━━━━━━━━━━━━━━\n\n` +
                          `Selecciona la plataforma de tu producto:`;
                          
        return bot.sendMessage(chatId, msgTienda, { parse_mode: 'Markdown', reply_markup: { inline_keyboard: catKb } });
    }

    // --- MANEJO DE ESTADOS DE TEXTO CONTINUOS ---
    if (userStates[chatId]) {
        const state = userStates[chatId];

        // ESTADOS DE WHATSAPP
        if (state.step === 'WA_ADMIN_NUMBER' && adminData.isSuper) {
            const numero = text.trim().replace(/\D/g, '');
            const fullNumber = state.data.country + numero;
            bot.sendMessage(chatId, `⏳ *Generando código de vinculación para:* \`+${fullNumber}\`\nPor favor espera...`, { parse_mode: 'Markdown' });
            initWA(fullNumber, chatId, bot);
            userStates[chatId] = null;
            return;
        }

        if (state.step === 'WA_USER_NUMBER') {
            const numero = text.trim().replace(/\D/g, '');
            if (numero.length < 10) return bot.sendMessage(chatId, '❌ Número inválido. Asegúrate de incluir el código de país.');
            
            const codigoVerif = Math.floor(100000 + Math.random() * 900000).toString();
            waVerificationCodes[chatId] = { numero: numero, codigo: codigoVerif };
            
            bot.sendMessage(chatId, `⏳ Enviando código de verificación a +${numero} vía WhatsApp...`);
            await enviarWA(numero, `🤖 *SOCIOSXIT BOT*\n\nTu código de verificación es: *${codigoVerif}*\n\nIngresa este código en Telegram para vincular tu cuenta.`);
            
            userStates[chatId] = { step: 'WA_USER_VERIFY', data: {} };
            return bot.sendMessage(chatId, '✅ *Código enviado.*\nRevisa tu WhatsApp e ingresa el código de 6 dígitos aquí:', { parse_mode: 'Markdown', ...cancelKeyboard });
        }

        if (state.step === 'WA_USER_VERIFY') {
            const inputCode = text.trim();
            const sessionData = waVerificationCodes[chatId];
            
            if (sessionData && sessionData.codigo === inputCode) {
                await update(ref(db), { [`users/${webUid}/whatsapp`]: sessionData.numero });
                bot.sendMessage(chatId, '🎉 *¡WhatsApp vinculado exitosamente!*\nAhora recibirás notificaciones de tus saldos.', { parse_mode: 'Markdown', ...keyboard });
                delete waVerificationCodes[chatId];
                userStates[chatId] = null;
            } else {
                bot.sendMessage(chatId, '❌ Código incorrecto. Intenta nuevamente o cancela la acción.');
            }
            return;
        }

        if (state.step === 'HISTORY_USER' && (adminData.isSuper || adminData.perms.stats)) {
            const targetUsername = text.trim();
            const usersSnap = await get(ref(db, 'users'));
            let targetUser = null;
            
            usersSnap.forEach(u => { 
                if (u.val().username === targetUsername) targetUser = u.val(); 
            });
            
            if (!targetUser) return bot.sendMessage(chatId, '❌ Usuario no encontrado.');
            if (!targetUser.history || Object.keys(targetUser.history).length === 0) { 
                userStates[chatId] = null; 
                return bot.sendMessage(chatId, '📜 Este usuario no tiene compras registradas.'); 
            }
            
            let histText = `📜 *COMPRAS DE ${targetUsername}*\n\n`;
            Object.values(targetUser.history).sort((a, b) => b.date - a.date).slice(0, 15).forEach((c, index) => {
                const fecha = new Date(c.date).toLocaleString('es-CO');
                const estado = c.refunded ? '🔴 REEMBOLSADO' : '🟢 OK';
                histText += `*${index + 1}. ${c.product}*\n🔑 \`${c.key}\`\n💵 $${c.price} USD | ${fecha}\n🛡️ ${estado}\n\n`;
            });
            
            bot.sendMessage(chatId, histText, { parse_mode: 'Markdown' });
            userStates[chatId] = null; 
            return;
        }

        if (state.step === 'GIFT_USER' && (adminData.isSuper || adminData.perms.products)) {
            const username = text.trim();
            const usersSnap = await get(ref(db, 'users'));
            let targetUid = null;
            
            usersSnap.forEach(u => { 
                if (u.val().username === username) targetUid = u.key; 
            });
            
            if (!targetUid) return bot.sendMessage(chatId, '❌ Usuario no encontrado.');
            
            const productsSnap = await get(ref(db, 'products'));
            let kb = [];
            productsSnap.forEach(child => { 
                const p = adaptarProductoLegacy(child.val());
                kb.push([{ text: `🎁 ${p.name}`, callback_data: `gift_prod|${targetUid}|${child.key}` }]); 
            });
            
            bot.sendMessage(chatId, `🎁 Selecciona el producto a regalar a ${username}:`, { reply_markup: { inline_keyboard: kb } });
            userStates[chatId] = null; 
            return;
        }

        if (state.step === 'WAITING_FOR_REF_CODE') {
            const inputCode = text.trim().toUpperCase();
            if (inputCode === webUser.referralCode) return bot.sendMessage(chatId, '❌ No puedes usar tu propio código.');
            
            const codeSnap = await get(ref(db, `referral_codes/${inputCode}`));
            if (!codeSnap.exists()) return bot.sendMessage(chatId, '❌ Código inválido.');
            
            await update(ref(db), { [`users/${webUid}/referredBy`]: inputCode });
            bot.sendMessage(chatId, `✅ *Código enlazado correctamente.*`, { parse_mode: 'Markdown', ...keyboard });
            userStates[chatId] = null; 
            return;
        }

        if (state.step === 'WAITING_FOR_RESET_KEY') {
            const searchKey = text.trim();
            let foundHistId = null; 
            let keyData = null;
            
            if (webUser.history) {
                Object.keys(webUser.history).forEach(histId => {
                    if (webUser.history[histId].key.trim() === searchKey) { 
                        foundHistId = histId; 
                        keyData = webUser.history[histId]; 
                    }
                });
            }
            
            if (!foundHistId) return bot.sendMessage(chatId, '❌ Key no encontrada en tu historial.');
            
            const hoursPassed = (Date.now() - (keyData.lastReset || 0)) / (1000 * 60 * 60);
            if (hoursPassed < 7 && keyData.lastReset) {
                return bot.sendMessage(chatId, `⏳ Límite alcanzado. Espera ${(7 - hoursPassed).toFixed(1)} hrs.`, { parse_mode: 'Markdown' });
            }
            
            await update(ref(db), { [`users/${webUid}/history/${foundHistId}/lastReset`]: Date.now() });
            bot.sendMessage(chatId, '✅ *Key reseteada con éxito.*', { parse_mode: 'Markdown', ...keyboard });
            userStates[chatId] = null; 
            return;
        }

        if (state.step === 'WAITING_FOR_RECEIPT' || state.step === 'WAITING_FOR_USER_REFUND_PROOF') {
            return bot.sendMessage(chatId, '❌ Debes adjuntar una **foto (captura de pantalla)**.', { parse_mode: 'Markdown' });
        }

        if (state.step === 'TRANSFER_USERNAME') {
            if(text.trim() === webUser.username) return bot.sendMessage(chatId, '❌ No puedes auto-transferirte saldo.');
            userStates[chatId].data.targetUser = text.trim();
            userStates[chatId].step = 'TRANSFER_AMOUNT';
            return bot.sendMessage(chatId, `¿Cuántos **USD** enviarás a *${text.trim()}*?`, { parse_mode: 'Markdown' });
        }
        
        if (state.step === 'TRANSFER_AMOUNT') {
            const amount = parseFloat(text);
            if (isNaN(amount) || amount <= 0 || amount > parseFloat(webUser.balance||0)) {
                return bot.sendMessage(chatId, '❌ Cantidad inválida o saldo insuficiente.');
            }
            
            const usersSnap = await get(ref(db, 'users'));
            let targetUid = null; 
            let targetBal = 0;
            let targetWA = null;
            
            usersSnap.forEach(u => { 
                if (u.val().username === state.data.targetUser) { 
                    targetUid = u.key; 
                    targetBal = parseFloat(u.val().balance || 0); 
                    targetWA = u.val().whatsapp;
                }
            });
            
            if (!targetUid) return bot.sendMessage(chatId, '❌ Usuario no encontrado en la base de datos.');
            
            await update(ref(db), { 
                [`users/${webUid}/balance`]: parseFloat(webUser.balance) - amount, 
                [`users/${targetUid}/balance`]: targetBal + amount 
            });
            
            bot.sendMessage(chatId, `✅ Enviaste *$${amount} USD* a ${state.data.targetUser}.`, { parse_mode: 'Markdown', ...keyboard });
            
            const authSnap = await get(ref(db, 'telegram_auth'));
            authSnap.forEach(child => { 
                if (child.val() === targetUid) {
                    bot.sendMessage(child.key, `💸 *RECIBISTE $${amount} USD* de parte de ${webUser.username}.`, { parse_mode: 'Markdown' }); 
                }
            });

            // Notificación WA
            if(targetWA) enviarWA(targetWA, `💸 *NUEVO SALDO RECIBIDO*\n\nEl usuario ${webUser.username} te ha transferido *$${amount} USD* a tu cuenta SociosXit.`);
            
            userStates[chatId] = null; 
            return;
        }

        if (state.step === 'REDEEM_COUPON') {
            const code = text.trim().toUpperCase();
            const couponSnap = await get(ref(db, `coupons/${code}`));
            
            if (!couponSnap.exists()) {
                return bot.sendMessage(chatId, '❌ *CUPÓN INVÁLIDO o no existe.*', { parse_mode: 'Markdown', ...keyboard });
            }
            
            const userUsedCouponsSnap = await get(ref(db, `users/${webUid}/used_coupons/${code}`));
            if (userUsedCouponsSnap.exists()) {
                return bot.sendMessage(chatId, '⚠️ *YA USASTE ESTE CUPÓN*', { parse_mode: 'Markdown', ...keyboard });
            }
            
            const couponData = couponSnap.val();
            const updates = { [`users/${webUid}/used_coupons/${code}`]: true };
            
            if (couponData.type === 'balance') {
                updates[`users/${webUid}/balance`] = parseFloat(webUser.balance || 0) + parseFloat(couponData.value);
            } else {
                updates[`users/${webUid}/active_discount`] = parseFloat(couponData.value);
            }
            
            await update(ref(db), updates);
            bot.sendMessage(chatId, `🎉 *¡CUPÓN CANJEADO CON ÉXITO!*`, { parse_mode: 'Markdown', ...keyboard });
            userStates[chatId] = null; 
            return;
        }

        // --- MANEJO ESTADOS ADMIN CONTINUOS ---
        if (adminData) {
            
            // CREACIÓN DE PRODUCTOS
            if (state.step === 'CREATE_PROD_NAME' && (adminData.isSuper || adminData.perms.products)) {
                state.data.name = text; 
                state.step = 'CREATE_PROD_CAT';
                const catKb = { 
                    inline_keyboard: [ 
                        [{ text: '📱 Android', callback_data: 'setcat|Android' }, { text: '🍎 iPhone', callback_data: 'setcat|iPhone' }], 
                        [{ text: '💻 PC', callback_data: 'setcat|PC' }] 
                    ] 
                };
                return bot.sendMessage(chatId, 'Selecciona la **Categoría Principal** del producto:', { parse_mode: 'Markdown', reply_markup: catKb });
            }
            
            if (state.step === 'CREATE_PROD_DURATION' && (adminData.isSuper || adminData.perms.products)) {
                state.data.duration = text; 
                state.step = 'CREATE_PROD_PRICE';
                return bot.sendMessage(chatId, 'Ingresa el **Precio** en USD (ej: 2.5):', { parse_mode: 'Markdown' });
            }
            
            if (state.step === 'CREATE_PROD_PRICE' && (adminData.isSuper || adminData.perms.products)) {
                const price = parseFloat(text); 
                if (isNaN(price)) return bot.sendMessage(chatId, '❌ Precio inválido. Usa números.');
                state.data.price = price; 
                state.step = 'CREATE_PROD_WARRANTY';
                return bot.sendMessage(chatId, 'Ingresa el **tiempo de garantía** en horas (escribe 0 para ilimitada):', { parse_mode: 'Markdown' });
            }
            
            if (state.step === 'CREATE_PROD_WARRANTY' && (adminData.isSuper || adminData.perms.products)) {
                const warranty = parseFloat(text); 
                if (isNaN(warranty) || warranty < 0) return bot.sendMessage(chatId, '❌ Garantía inválida.');
                
                if (state.data.isAddingVariant) {
                    await set(push(ref(db, `products/${state.data.prodId}/durations`)), { 
                        duration: state.data.duration, 
                        price: state.data.price, 
                        warranty: warranty 
                    });
                    bot.sendMessage(chatId, `✅ Variante *${state.data.duration}* agregada exitosamente.`, { parse_mode: 'Markdown', ...keyboard });
                } else {
                    const newProdRef = push(ref(db, 'products'));
                    const durId = push(ref(db, `products/${newProdRef.key}/durations`)).key;
                    await set(newProdRef, { 
                        name: state.data.name, 
                        category: state.data.category 
                    });
                    await set(ref(db, `products/${newProdRef.key}/durations/${durId}`), { 
                        duration: state.data.duration, 
                        price: state.data.price, 
                        warranty: warranty 
                    });
                    bot.sendMessage(chatId, `✅ Producto *${state.data.name}* creado con éxito.`, { parse_mode: 'Markdown', ...keyboard });
                }
                
                // Disparador a WhatsApp global
                broadcastWA(`🛒 *NUEVO PRODUCTO AÑADIDO*\n\nAcabamos de agregar: *${state.data.name}* a la tienda. ¡Ve a revisarlo!`, db);
                
                notifySuperAdmin(webUser.username, tgId, 'Creó Producto/Variante', `Garantía: ${warranty}h`);
                userStates[chatId] = null; 
                return;
            }

            // AÑADIR STOCK KEYS
            if (state.step === 'ADD_STOCK_KEYS' && (adminData.isSuper || adminData.perms.products)) {
                const cleanKeys = text.split(/[\n,\s]+/).map(k => k.trim()).filter(k => k.length > 0);
                if (cleanKeys.length === 0) { 
                    userStates[chatId] = null; 
                    return bot.sendMessage(chatId, '❌ No se detectaron Keys válidas.'); 
                }
                
                const updates = {};
                cleanKeys.forEach(k => {
                    const newId = push(ref(db)).key;
                    if (state.data.durId === 'legacy_var') {
                        updates[`products/${state.data.prodId}/keys/${newId}`] = k;
                    } else {
                        updates[`products/${state.data.prodId}/durations/${state.data.durId}/keys/${newId}`] = k;
                    }
                });
                
                await update(ref(db), updates);
                bot.sendMessage(chatId, `✅ Se agregaron ${cleanKeys.length} keys a esta variante.`, keyboard);
                
                // Disparador WhatsApp global
                broadcastWA(`📦 *STOCK ACTUALIZADO*\n\nSe han añadido ${cleanKeys.length} unidades al inventario. ¡Visita la tienda antes de que se agoten!`, db);

                notifySuperAdmin(webUser.username, tgId, 'Añadió Stock', `${cleanKeys.length} keys al prod ID: ${state.data.prodId}`);
                userStates[chatId] = null; 
                return;
            }

            // EDICIÓN DE TEXTOS Y PRECIOS
            if (state.step === 'EDIT_PROD_NAME' && (adminData.isSuper || adminData.perms.products)) {
                await update(ref(db), { [`products/${state.data.prodId}/name`]: text });
                bot.sendMessage(chatId, `✅ Nombre general actualizado a: *${text}*`, { parse_mode: 'Markdown', ...keyboard });
                userStates[chatId] = null; 
                return;
            }
            
            if (state.step.startsWith('EDIT_VAR_') && (adminData.isSuper || adminData.perms.products)) {
                const { prodId, durId } = state.data; 
                const fieldType = state.step.split('_')[2]; 
                let updates = {};
                
                if (fieldType === 'PRICE') { 
                    const p = parseFloat(text); 
                    if(isNaN(p)) return bot.sendMessage(chatId, '❌ Valor inválido.'); 
                    if (durId === 'legacy_var') updates[`products/${prodId}/price`] = p;
                    else updates[`products/${prodId}/durations/${durId}/price`] = p; 
                }
                else if (fieldType === 'WARR') { 
                    const w = parseFloat(text); 
                    if(isNaN(w)) return bot.sendMessage(chatId, '❌ Valor inválido.'); 
                    if (durId === 'legacy_var') updates[`products/${prodId}/warranty`] = w;
                    else updates[`products/${prodId}/durations/${durId}/warranty`] = w; 
                }
                else if (fieldType === 'DUR') {
                    if (durId === 'legacy_var') updates[`products/${prodId}/duration`] = text;
                    else updates[`products/${prodId}/durations/${durId}/duration`] = text;
                }
                
                await update(ref(db), updates);
                bot.sendMessage(chatId, `✅ Variante actualizada correctamente.`, keyboard);
                userStates[chatId] = null; 
                return;
            }

            // GESTIÓN ADMINS / USUARIOS
            if (state.step === 'WAITING_FOR_ADMIN_ID' && adminData.isSuper) {
                const targetTgId = parseInt(text.trim()); 
                if (isNaN(targetTgId) || targetTgId === SUPER_ADMIN_ID) return bot.sendMessage(chatId, '❌ ID Inválido.');
                
                const targetAdminSnap = await get(ref(db, `admins/${targetTgId}`));
                if (targetAdminSnap.exists()) {
                    bot.sendMessage(chatId, `⚙️ *Administrando a ID:* \`${targetTgId}\``, { parse_mode: 'Markdown', reply_markup: buildAdminManagerInline(targetTgId, targetAdminSnap.val().perms) });
                } else {
                    const currentPerms = { products: false, balance: false, broadcast: false, refunds: false, coupons: false, stats: false, users: false, maintenance: false };
                    await set(ref(db, `admins/${targetTgId}`), { perms: currentPerms });
                    bot.sendMessage(chatId, `✅ *Nuevo Administrador Creado*\n\nID: \`${targetTgId}\``, { parse_mode: 'Markdown', reply_markup: buildAdminManagerInline(targetTgId, currentPerms) });
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
                
                if (!targetUid) return bot.sendMessage(chatId, '❌ Usuario no encontrado.');
                await sendUserManageMenu(chatId, targetUid, bot);
                userStates[chatId] = null; 
                return;
            }
            
            if (state.step === 'TEMP_BAN_TIME' && (adminData.isSuper || adminData.perms.users)) {
                const hrs = parseFloat(text); 
                if (isNaN(hrs)) return bot.sendMessage(chatId, '❌ Horas inválidas.');
                
                await update(ref(db), { 
                    [`users/${state.data.targetUid}/banned`]: true, 
                    [`users/${state.data.targetUid}/banUntil`]: Date.now() + (hrs * 3600000) 
                });
                
                bot.sendMessage(chatId, `✅ Usuario baneado temporalmente por ${hrs} horas.`, keyboard); 
                userStates[chatId] = null; 
                return;
            }

            // SALDOS DIRECTOS ADMIN
            if (state.step === 'ADD_BALANCE_USER' && (adminData.isSuper || adminData.perms.balance)) {
                state.data.targetUser = text.trim(); 
                state.step = 'ADD_BALANCE_AMOUNT';
                return bot.sendMessage(chatId, `Dime la **cantidad** en USD a añadir para ${state.data.targetUser}:`, { parse_mode: 'Markdown' });
            }
            
            if (state.step === 'ADD_BALANCE_AMOUNT' && (adminData.isSuper || adminData.perms.balance)) {
                const amount = parseFloat(text); 
                if (isNaN(amount)) return bot.sendMessage(chatId, '❌ Cantidad inválida.');
                
                const usersSnap = await get(ref(db, 'users')); 
                let foundUid = null; 
                let currentBal = 0; 
                let targetWA = null;
                
                usersSnap.forEach(c => { 
                    if (c.val().username === state.data.targetUser) { 
                        foundUid = c.key; 
                        currentBal = parseFloat(c.val().balance || 0); 
                        targetWA = c.val().whatsapp;
                    }
                });
                
                if (foundUid) {
                    await update(ref(db), { 
                        [`users/${foundUid}/balance`]: currentBal + amount, 
                        [`users/${foundUid}/recharges/${push(ref(db)).key}`]: { amount: amount, date: Date.now() }
                    });
                    
                    bot.sendMessage(chatId, `✅ Saldo añadido a ${state.data.targetUser}.`, keyboard);
                    const authSnap = await get(ref(db, 'telegram_auth'));
                    
                    authSnap.forEach(c => { 
                        if(c.val() === foundUid) {
                            bot.sendMessage(c.key, `🎉 Se depositaron: *$${amount} USD* a tu saldo.\n💰 Disfrútalo.`, { parse_mode: 'Markdown' }); 
                        }
                    });

                    // Notificación WA
                    if(targetWA) enviarWA(targetWA, `💰 *ACTUALIZACIÓN DE SALDO*\n\nSe han agregado *$${amount} USD* a tu cuenta. \nSaldo actual: *$${(currentBal + amount).toFixed(2)} USD*`);
                    
                    await verificarBonoReferido(db, bot, foundUid, amount);
                }
                userStates[chatId] = null; 
                return;
            }
            
            if (state.step === 'DIRECT_ADD_BAL' && (adminData.isSuper || adminData.perms.balance)) {
                const amt = parseFloat(text); 
                if (isNaN(amt)) return bot.sendMessage(chatId, '❌ Valor inválido.');
                const uSnap = await get(ref(db, `users/${state.data.targetUid}`)); 
                const currentBal = parseFloat(uSnap.val().balance || 0);
                const targetWA = uSnap.val().whatsapp;

                await update(ref(db), { [`users/${state.data.targetUid}/balance`]: currentBal + amt }); 
                bot.sendMessage(chatId, `✅ Saldo agregado.`, keyboard); 
                
                if(targetWA) enviarWA(targetWA, `💰 Un administrador ha agregado *$${amt} USD* a tu saldo.`);

                userStates[chatId] = null; 
                return;
            }
            
            if (state.step === 'DIRECT_REM_BAL' && (adminData.isSuper || adminData.perms.balance)) {
                const amt = parseFloat(text); 
                if (isNaN(amt)) return bot.sendMessage(chatId, '❌ Valor inválido.');
                const uSnap = await get(ref(db, `users/${state.data.targetUid}`)); 
                const currentBal = parseFloat(uSnap.val().balance || 0);
                const targetWA = uSnap.val().whatsapp;

                const nuevoSaldo = Math.max(0, currentBal - amt);
                await update(ref(db), { [`users/${state.data.targetUid}/balance`]: nuevoSaldo }); 
                bot.sendMessage(chatId, `✅ Saldo removido.`, keyboard); 
                
                if(targetWA) enviarWA(targetWA, `📉 Un administrador ha descontado *$${amt} USD* de tu saldo.\nSaldo actual: *$${nuevoSaldo.toFixed(2)} USD*`);

                userStates[chatId] = null; 
                return;
            }

            // BROADCAST / REEMBOLSOS / CUPONES / RANGOS
            if (state.step === 'WAITING_FOR_BROADCAST_MESSAGE' && (adminData.isSuper || adminData.perms.broadcast)) {
                const authSnap = await get(ref(db, 'telegram_auth')); 
                let count = 0;
                
                authSnap.forEach(child => { 
                    bot.sendMessage(child.key, `📢 *Anuncio SociosXit*\n\n${text}`, { parse_mode: 'Markdown' }).catch(()=>{}); 
                    count++; 
                });
                
                bot.sendMessage(chatId, `✅ Mensaje enviado a ${count} usuarios.`, keyboard); 
                userStates[chatId] = null; 
                return;
            }
            
            if (state.step === 'WAITING_FOR_REFUND_KEY' && (adminData.isSuper || adminData.perms.refunds)) {
                const searchKey = text.trim().replace(/`/g, '');
                const usersSnap = await get(ref(db, 'users')); 
                let foundData = null;
                
                usersSnap.forEach(u => {
                    if (u.val().history) {
                        Object.keys(u.val().history).forEach(hId => { 
                            if (u.val().history[hId].key.trim() === searchKey) {
                                foundData = { uid: u.key, username: u.val().username, histId: hId, compra: u.val().history[hId] }; 
                            }
                        });
                    }
                });
                
                if (foundData) {
                    if (foundData.compra.refunded) return bot.sendMessage(chatId, '⚠️ *Esta Key ya fue reembolsada.*', { parse_mode: 'Markdown' });
                    
                    const msgInfo = `🧾 *DATOS DE LA COMPRA*\n` +
                                    `👤 Usr: ${foundData.username}\n` +
                                    `📦 Prod: ${foundData.compra.product}\n` +
                                    `🔑 Key: \`${foundData.compra.key}\`\n` +
                                    `💰 Pagado: $${foundData.compra.price}`;
                                    
                    const optsReem = { 
                        inline_keyboard: [
                            [{ text: '✅ Mandar Reembolso', callback_data: `rfnd|${foundData.uid}|${foundData.histId}` }], 
                            [{ text: '❌ Cancelar', callback_data: `cancel_refund` }]
                        ] 
                    };
                    bot.sendMessage(chatId, msgInfo, { parse_mode: 'Markdown', reply_markup: optsReem });
                } else {
                    bot.sendMessage(chatId, '❌ Key no encontrada en ningún registro.');
                }
                userStates[chatId] = null; 
                return;
            }
            
            if (state.step === 'WAITING_FOR_REJECT_REASON' && (adminData.isSuper || adminData.perms.refunds)) {
                bot.sendMessage(chatId, '✅ Razón enviada al usuario correctamente.', keyboard);
                bot.sendMessage(state.data.targetTgId, `❌ *REEMBOLSO RECHAZADO*\n\nTu solicitud no fue aprobada. Motivo:\n_${text.trim()}_`, { parse_mode: 'Markdown' });
                userStates[chatId] = null; 
                return;
            }
            
            if (state.step === 'CREATE_COUPON_CODE' && (adminData.isSuper || adminData.perms.coupons)) {
                state.data.code = text.trim().toUpperCase(); 
                state.step = 'CREATE_COUPON_TYPE';
                
                const optsCpn = { 
                    inline_keyboard: [
                        [{ text: '💰 Dar Saldo USD', callback_data: `cpntype|bal` }], 
                        [{ text: '📉 Dar Descuento %', callback_data: `cpntype|desc` }]
                    ] 
                };
                return bot.sendMessage(chatId, `¿Qué tipo de beneficio dará el cupón?`, { reply_markup: optsCpn });
            }
            
            if (state.step === 'CREATE_COUPON_VALUE' && (adminData.isSuper || adminData.perms.coupons)) {
                const val = parseFloat(text); 
                if (isNaN(val)) return bot.sendMessage(chatId, '❌ Valor numérico inválido.');
                
                await set(ref(db, `coupons/${state.data.code}`), { type: state.data.type, value: val });
                bot.sendMessage(chatId, `✅ *Cupón creado y listo para usar.*`, { parse_mode: 'Markdown', ...keyboard }); 
                userStates[chatId] = null; 
                return;
            }
            
            if (state.step === 'EDIT_RANK_MIN' && (adminData.isSuper || adminData.perms.products)) {
                await update(ref(db), { [`settings/ranks/${state.data.rankId}/minGastado`]: parseFloat(text) }); 
                bot.sendMessage(chatId, '✅ Gasto mínimo actualizado.', keyboard); 
                userStates[chatId] = null; 
                return;
            }
            
            if (state.step === 'EDIT_RANK_DESC' && (adminData.isSuper || adminData.perms.products)) {
                await update(ref(db), { [`settings/ranks/${state.data.rankId}/descuento`]: parseFloat(text) }); 
                bot.sendMessage(chatId, '✅ Descuento actualizado.', keyboard); 
                userStates[chatId] = null; 
                return;
            }
        }
        
        // REEMBOLSO USUARIO (Flujo Continuo)
        if (state.step === 'WAITING_FOR_USER_REFUND_KEY') {
            const searchKey = text.trim().replace(/`/g, '');
            let foundData = null;
            
            if (webUser.history) {
                Object.keys(webUser.history).forEach(hId => { 
                    if (webUser.history[hId].key.trim() === searchKey) {
                        foundData = { uid: webUid, username: webUser.username, histId: hId, compra: webUser.history[hId], targetTgId: tgId }; 
                    }
                });
            }
            
            if (foundData) {
                if (foundData.compra.refunded) { 
                    userStates[chatId] = null; 
                    return bot.sendMessage(chatId, '⚠️ *Esta key ya fue reembolsada anteriormente.*', { parse_mode: 'Markdown' }); 
                }
                
                const hrsPassed = (Date.now() - foundData.compra.date) / 3600000;
                if (foundData.compra.warrantyHours > 0 && hrsPassed > foundData.compra.warrantyHours) { 
                    userStates[chatId] = null; 
                    return bot.sendMessage(chatId, '❌ *GARANTÍA EXPIRADA*\n\nEl tiempo para solicitar reembolso de este producto ya pasó.', { parse_mode: 'Markdown' }); 
                }
                
                userStates[chatId] = { step: 'WAITING_FOR_USER_REFUND_PROOF', data: foundData };
                return bot.sendMessage(chatId, '✅ *Key válida.*\n\nEnvía una **foto (captura de pantalla)** mostrando el error que te arroja.', { parse_mode: 'Markdown', ...cancelKeyboard });
            } else { 
                userStates[chatId] = null; 
                return bot.sendMessage(chatId, '❌ Key no encontrada en tu historial de compras.'); 
            }
        }

        if (state.step === 'WAITING_FOR_RECHARGE_AMOUNT') {
            return sistemaRecargas.procesarMonto(bot, chatId, text, state.data, userStates);
        }
    } 

    // --- BOTONES DEL PANEL ADMIN ---
    if (adminData) {
        if (text === '📦 Crear Producto' && (adminData.isSuper || adminData.perms.products)) {
            userStates[chatId] = { step: 'CREATE_PROD_NAME', data: {} };
            return bot.sendMessage(chatId, 'Escribe el **Nombre General** del nuevo producto (Ej: Netflix):', { parse_mode: 'Markdown', ...cancelKeyboard });
        }
        
        if (text === '➕ Añadir Variante' && (adminData.isSuper || adminData.perms.products)) {
            const productsSnap = await get(ref(db, 'products')); 
            let kb = [];
            if (productsSnap.exists()) {
                productsSnap.forEach(c => {
                    const p = adaptarProductoLegacy(c.val());
                    kb.push([{ text: `➕ a: ${p.name}`, callback_data: `addvar|${c.key}` }]);
                });
            }
            return bot.sendMessage(chatId, `Selecciona el producto al que agregarás otra duración/precio:`, { reply_markup: { inline_keyboard: kb } });
        }
        
        if (text === '🔑 Añadir Stock' && (adminData.isSuper || adminData.perms.products)) {
            const productsSnap = await get(ref(db, 'products')); 
            let kb = [];
            if (productsSnap.exists()) {
                productsSnap.forEach(c => {
                    const p = adaptarProductoLegacy(c.val());
                    kb.push([{ text: `📦 ${p.name}`, callback_data: `st_prod|${c.key}` }]);
                });
            }
            return bot.sendMessage(chatId, `Selecciona el producto para reabastecer sus keys:`, { reply_markup: { inline_keyboard: kb } });
        }
        
        if (text === '🎁 Regalar Producto' && (adminData.isSuper || adminData.perms.products)) {
            userStates[chatId] = { step: 'GIFT_USER', data: {} };
            return bot.sendMessage(chatId, '🎁 *REGALAR PRODUCTO*\n\nEscribe el **Username** exacto del usuario al que le darás una key gratis:', { parse_mode: 'Markdown', ...cancelKeyboard });
        }
        
        if (text === '📝 Editar Producto' && (adminData.isSuper || adminData.perms.products)) {
            const productsSnap = await get(ref(db, 'products')); 
            let kb = [];
            if (productsSnap.exists()) {
                productsSnap.forEach(c => {
                    const p = adaptarProductoLegacy(c.val());
                    kb.push([{ text: `⚙️ Opciones de: ${p.name}`, callback_data: `ed_prod|${c.key}` }]);
                });
            }
            return bot.sendMessage(chatId, `📝 Selecciona el producto que deseas modificar:`, { reply_markup: { inline_keyboard: kb } });
        }
        
        if (text === '🗑️ Eliminar Producto' && (adminData.isSuper || adminData.perms.products)) {
            const productsSnap = await get(ref(db, 'products')); 
            let kb = [];
            if (productsSnap.exists()) {
                productsSnap.forEach(c => {
                    const p = adaptarProductoLegacy(c.val());
                    kb.push([{ text: `🗑️ En: ${p.name}`, callback_data: `sel_delprod|${c.key}` }]);
                });
            }
            return bot.sendMessage(chatId, `🗑️ *ELIMINACIÓN DE TIENDA*\n\nSelecciona un producto para borrar variantes o purgarlo entero:`, { parse_mode: 'Markdown', reply_markup: { inline_keyboard: kb } });
        }
        
        if (text === '🔍 Ver Keys/Eliminar' && adminData.isSuper) {
            const productsSnap = await get(ref(db, 'products')); 
            let kb = [];
            if (productsSnap.exists()) {
                productsSnap.forEach(c => {
                    const p = adaptarProductoLegacy(c.val());
                    kb.push([{ text: `🔍 Extraer: ${p.name}`, callback_data: `viewdel|${c.key}` }]);
                });
            }
            return bot.sendMessage(chatId, `💎 *CONTROL SUPREMO*\n\nSelecciona producto para ver y extraer todas sus keys guardadas en la base de datos:`, { parse_mode: 'Markdown', reply_markup: { inline_keyboard: kb } });
        }
        
        if (text === '📊 Estadísticas' && (adminData.isSuper || adminData.perms.stats)) {
            const usersSnap = await get(ref(db, 'users')); 
            const productsSnap = await get(ref(db, 'products'));
            
            let totalUsers = 0; let allTimeRecharges = 0; let allTimeSalesUsd = 0; let allTimeSalesCount = 0; 
            let activeProducts = 0; let totalKeys = 0;
            
            if (usersSnap.exists()) {
                usersSnap.forEach(u => { 
                    totalUsers++; 
                    if (u.val().recharges) {
                        Object.values(u.val().recharges).forEach(r => allTimeRecharges += parseFloat(r.amount||0)); 
                    }
                    if (u.val().history) {
                        Object.values(u.val().history).forEach(h => { 
                            allTimeSalesCount++; 
                            allTimeSalesUsd += parseFloat(h.price||0); 
                        }); 
                    }
                });
            }
            
            if (productsSnap.exists()) {
                productsSnap.forEach(p => { 
                    activeProducts++; 
                    const prod = adaptarProductoLegacy(p.val());
                    if (prod.durations) {
                        Object.values(prod.durations).forEach(dur => { 
                            if (dur.keys) totalKeys += Object.keys(dur.keys).length; 
                        }); 
                    }
                });
            }
            
            const msgEstadisticas = `━━━━━━━━━━━━━━━━━━━━━\n` +
                                    `📊 *DASHBOARD SociosXit*\n` +
                                    `━━━━━━━━━━━━━━━━━━━━━\n\n` +
                                    `👥 *Usuarios Registrados:* ${totalUsers}\n` +
                                    `💵 *Recargas Globales:* $${allTimeRecharges.toFixed(2)} USD\n` +
                                    `🛍️ *Ventas Totales:* ${allTimeSalesCount} (Movió $${allTimeSalesUsd.toFixed(2)} USD)\n\n` +
                                    `📦 *Productos Creados:* ${activeProducts}\n` +
                                    `🔑 *Keys en Stock:* ${totalKeys}`;
                                    
            return bot.sendMessage(chatId, msgEstadisticas, { parse_mode: 'Markdown'});
        }
        
        if (text === '📢 Mensaje Global' && (adminData.isSuper || adminData.perms.broadcast)) { 
            userStates[chatId] = { step: 'WAITING_FOR_BROADCAST_MESSAGE', data: {} }; 
            return bot.sendMessage(chatId, '📝 *MENSAJE GLOBAL*\n\nEscribe el mensaje que llegará a todos los usuarios:', { parse_mode: 'Markdown', ...cancelKeyboard }); 
        }
        
        if (text === '💰 Añadir Saldo' && (adminData.isSuper || adminData.perms.balance)) { 
            userStates[chatId] = { step: 'ADD_BALANCE_USER', data: {} }; 
            return bot.sendMessage(chatId, 'Escribe el **Username** exacto al que le enviarás USD:', { parse_mode: 'Markdown', ...cancelKeyboard }); 
        }
        
        if (text === '🏆 Gest. Rangos' && (adminData.isSuper || adminData.perms.products)) {
            const rangos = await getRanks(db); 
            let kb = []; 
            rangos.forEach(r => {
                kb.push([{ text: `${r.nombre} - Requiere $${r.minGastado}`, callback_data: `editrank|${r.id}` }]);
            });
            return bot.sendMessage(chatId, '🏆 *GESTOR DE RANGOS VIP*', { parse_mode: 'Markdown', reply_markup: { inline_keyboard: kb } });
        }
        
        if (text === '🌍 Gest. Países' && adminData.isSuper) {
            return sistemaRecargas.menuPaisesAdmin(bot, db, chatId);
        }
        
        if (text === '👮 Gest. Admins' && adminData.isSuper) { 
            userStates[chatId] = { step: 'WAITING_FOR_ADMIN_ID', data: {} }; 
            return bot.sendMessage(chatId, '👮 *GESTOR DE ADMINISTRADORES*\n\nPega el ID de Telegram del usuario:', { parse_mode: 'Markdown', ...cancelKeyboard }); 
        }
        
        if (text === '📋 Ver Usuarios' && (adminData.isSuper || adminData.perms.stats)) {
            const opts = [ 
                [{ text: '💰 Con Saldo', callback_data: 'viewu|saldo' }, { text: '💸 Sin Saldo', callback_data: 'viewu|nosaldo' }], 
                [{ text: '👥 Mostrar Todos', callback_data: 'viewu|todos' }] 
            ];
            return bot.sendMessage(chatId, '📋 *DIRECTORIO DE USUARIOS*\n\nSelecciona un filtro para listar:', { parse_mode: 'Markdown', reply_markup: { inline_keyboard: opts } });
        }
        
        if (text === '🎟️ Crear Cupón' && (adminData.isSuper || adminData.perms.coupons)) { 
            userStates[chatId] = { step: 'CREATE_COUPON_CODE', data: {} }; 
            return bot.sendMessage(chatId, '🎟️ *CREADOR DE CUPONES*\n\nEscribe el código promocional (Ej: DESC10):', { parse_mode: 'Markdown', ...cancelKeyboard }); 
        }
        
        if (text === '🔨 Gest. Usuarios' && (adminData.isSuper || adminData.perms.users)) { 
            userStates[chatId] = { step: 'MANAGE_USER', data: {} }; 
            return bot.sendMessage(chatId, '🔨 Escribe el **Username** exacto del usuario a gestionar:', { parse_mode: 'Markdown', ...cancelKeyboard }); 
        }
        
        if (text === '📜 Historial Usuario' && (adminData.isSuper || adminData.perms.stats)) { 
            userStates[chatId] = { step: 'HISTORY_USER', data: {} }; 
            return bot.sendMessage(chatId, '📜 Escribe el **Username** exacto para ver sus compras:', { parse_mode: 'Markdown', ...cancelKeyboard }); 
        }
        
        if (text === '🛠️ Mantenimiento' && (adminData.isSuper || adminData.perms.maintenance)) {
            const sSnap = await get(ref(db, 'settings/maintenance')); 
            const nMaint = !(sSnap.val() || false);
            await update(ref(db), { 'settings/maintenance': nMaint }); 
            return bot.sendMessage(chatId, `🛠️ *ESTADO DE LA TIENDA ACTUALIZADO*\n\nAhora la tienda se encuentra: **${nMaint ? 'CERRADA EN MANTENIMIENTO 🔴' : 'ABIERTA AL PÚBLICO 🟢'}**`, { parse_mode: 'Markdown' });
        }
        
        if (text === '🔄 Revisar Reembolsos' && (adminData.isSuper || adminData.perms.refunds)) { 
            userStates[chatId] = { step: 'WAITING_FOR_REFUND_KEY', data: {} }; 
            return bot.sendMessage(chatId, '🔎 *BÚSQUEDA DE REEMBOLSOS GLOBALES*\n\nPega la Key que vas a buscar:', { parse_mode: 'Markdown', ...cancelKeyboard }); 
        }
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
    
    const webUid = await getAuthUser(tgId); 
    if (!webUid) return bot.sendMessage(chatId, `🛑 Acceso revocado o cuenta no vinculada.`);
    
    const adminUserSnap = await get(ref(db, `users/${webUid}`)); 
    const adminUsername = adminUserSnap.exists() ? adminUserSnap.val().username : 'Desconocido';
    const webUser = adminUserSnap.val(); 
    
    const adminData = await getAdminData(tgId);

    // --- CALLBACKS VINCULACIÓN WHATSAPP ---
    if (data.startsWith('wa_c|')) {
        const paisCode = data.split('|')[1];
        if (paisCode === 'otro') {
            userStates[chatId] = { step: 'WA_ADMIN_NUMBER', data: { country: '' } };
            return bot.editMessageText('Escribe el código de tu país seguido del número telefónico. (Ej: 51999888777)', { chat_id: chatId, message_id: query.message.message_id });
        } else {
            userStates[chatId] = { step: 'WA_ADMIN_NUMBER', data: { country: paisCode } };
            return bot.editMessageText(`✅ País seleccionado (+${paisCode}).\n\nPor favor envía el **número telefónico** de WhatsApp (sin el código de país):`, { chat_id: chatId, message_id: query.message.message_id });
        }
    }

    // --- CALLBACKS DEL SUPER ADMIN (CONTROL SUPREMO) ---
    if (adminData && adminData.isSuper) {
        if (data.startsWith('viewdel|')) {
            const prodId = data.split('|')[1]; 
            const prodSnap = await get(ref(db, `products/${prodId}`)); 
            if (!prodSnap.exists()) return; 
            
            const p = adaptarProductoLegacy(prodSnap.val());
            let kText = `📦 *PRODUCTO:* ${p.name}\n\n*KEYS DISPONIBLES EN STOCK:*\n`;
            
            if (p.durations) {
                Object.keys(p.durations).forEach(durId => { 
                    const dur = p.durations[durId]; 
                    kText += `\n⏱️ *${dur.duration}*:\n`; 
                    if (dur.keys && Object.keys(dur.keys).length > 0) {
                        Object.values(dur.keys).forEach(k => kText += `\`${k}\`\n`); 
                    } else {
                        kText += `_(Sin stock actual)_\n`; 
                    }
                });
            }
            
            const opts = { inline_keyboard: [[{ text: '⚠️ PURGAR ESTE PRODUCTO DE LA BASE DE DATOS', callback_data: `delprod_confirm|${prodId}` }]] };
            
            if (kText.length > 4000) {
                kText = kText.substring(0, 4000) + '\n...[LIMITE DE TELEGRAM ALCANZADO]';
            }
            
            return bot.sendMessage(chatId, kText, { parse_mode: 'Markdown', reply_markup: opts });
        }
        
        if (data.startsWith('delprod_confirm|')) { 
            await remove(ref(db, `products/${data.split('|')[1]}`)); 
            broadcastWA(`🗑️ *ACTUALIZACIÓN DE TIENDA*\n\nUn producto ha sido retirado definitivamente de la tienda.`, db);
            return bot.editMessageText('✅ Producto y todas sus keys han sido purgados.', { chat_id: chatId, message_id: query.message.message_id }); 
        }
        
        if (data.startsWith('tgp|')) {
            const parts = data.split('|'); 
            const aRef = ref(db, `admins/${parts[1]}/perms/${parts[2]}`); 
            const snap = await get(aRef);
            
            await set(aRef, !(snap.exists() ? snap.val() : false)); 
            
            const uSnap = await get(ref(db, `admins/${parts[1]}/perms`));
            return bot.editMessageReplyMarkup(buildAdminManagerInline(parts[1], uSnap.val()), { chat_id: chatId, message_id: query.message.message_id });
        }
        
        if (data.startsWith('deladm|')) { 
            await remove(ref(db, `admins/${data.split('|')[1]}`)); 
            return bot.editMessageText(`✅ Administrador destituido correctamente.`, { chat_id: chatId, message_id: query.message.message_id }); 
        }
    }

    // --- CALLBACKS GENERALES DE ADMINISTRACIÓN ---
    if (adminData) {
        
        // ELIMINAR VARIANTE O PRODUCTO
        if (data.startsWith('sel_delprod|') && (adminData.isSuper || adminData.perms.products)) {
            const prodId = data.split('|')[1]; 
            const snap = await get(ref(db, `products/${prodId}`));
            if (!snap.exists()) return bot.editMessageText('❌ El producto ya no existe.', { chat_id: chatId, message_id: query.message.message_id });
            
            const p = adaptarProductoLegacy(snap.val()); 
            let kb = [];
            
            if (p.durations) {
                Object.keys(p.durations).forEach(dId => {
                    kb.push([{ text: `❌ Eliminar Variante: ${p.durations[dId].duration}`, callback_data: `del_var|${prodId}|${dId}` }]);
                });
            }
            kb.push([{ text: `⚠️ ELIMINAR TODO EL PRODUCTO`, callback_data: `del_fullprod|${prodId}` }]);
            
            return bot.editMessageText(`¿Qué parte de *${p.name}* deseas eliminar?`, { chat_id: chatId, message_id: query.message.message_id, parse_mode: 'Markdown', reply_markup: { inline_keyboard: kb } });
        }
        
        if (data.startsWith('del_var|') && (adminData.isSuper || adminData.perms.products)) { 
            const prodId = data.split('|')[1];
            const durId = data.split('|')[2];
            
            if (durId === 'legacy_var') {
                await remove(ref(db, `products/${prodId}`));
            } else {
                await remove(ref(db, `products/${prodId}/durations/${durId}`)); 
            }
            broadcastWA(`🗑️ *ACTUALIZACIÓN DE TIENDA*\n\nUna variante de producto ha sido retirada de la tienda.`, db);
            return bot.editMessageText('✅ Variante eliminada.', { chat_id: chatId, message_id: query.message.message_id }); 
        }
        
        if (data.startsWith('del_fullprod|') && (adminData.isSuper || adminData.perms.products)) { 
            await remove(ref(db, `products/${data.split('|')[1]}`)); 
            broadcastWA(`🗑️ *ACTUALIZACIÓN DE TIENDA*\n\nUn producto ha sido retirado de la tienda.`, db);
            return bot.editMessageText('✅ Producto completo eliminado de la tienda.', { chat_id: chatId, message_id: query.message.message_id }); 
        }

        // FLUJO DE CREACIÓN DE CATEGORÍAS Y VARIANTES
        if (data.startsWith('setcat|')) { 
            if (userStates[chatId] && userStates[chatId].step === 'CREATE_PROD_CAT') { 
                userStates[chatId].data.category = data.split('|')[1]; 
                userStates[chatId].step = 'CREATE_PROD_DURATION'; 
                bot.editMessageText(`✅ Seleccionaste: ${data.split('|')[1]}.\n\nEscribe la **Duración** de la primera variante:`, {chat_id: chatId, message_id: query.message.message_id}); 
            } 
            return; 
        }
        
        if (data.startsWith('addvar|')) { 
            userStates[chatId] = { step: 'CREATE_PROD_DURATION', data: { isAddingVariant: true, prodId: data.split('|')[1] } }; 
            return bot.editMessageText(`Escribe la **Nueva Duración** para este producto:`, {chat_id: chatId, message_id: query.message.message_id}); 
        }
        
        // AÑADIR STOCK
        if (data.startsWith('st_prod|')) {
            const prodId = data.split('|')[1]; 
            const snap = await get(ref(db, `products/${prodId}`));
            if (!snap.exists()) return bot.editMessageText('❌ El producto ya no existe.', { chat_id: chatId, message_id: query.message.message_id });
            
            const p = adaptarProductoLegacy(snap.val()); 
            if (!p.durations) return; 
            
            let kb = [];
            Object.keys(p.durations).forEach(dId => {
                kb.push([{ text: `⏱️ Añadir a: ${p.durations[dId].duration}`, callback_data: `st_dur|${prodId}|${dId}` }]);
            });
            
            return bot.editMessageText(`📦 Selecciona la Variante de *${p.name}*:`, { chat_id: chatId, message_id: query.message.message_id, parse_mode: 'Markdown', reply_markup: { inline_keyboard: kb } });
        }
        
        if (data.startsWith('st_dur|')) { 
            userStates[chatId] = { step: 'ADD_STOCK_KEYS', data: { prodId: data.split('|')[1], durId: data.split('|')[2] } }; 
            return bot.editMessageText('Pega todas las **Keys** para abastecer:', { chat_id: chatId, message_id: query.message.message_id, parse_mode: 'Markdown' }); 
        }

        // REGALAR PRODUCTO
        if (data.startsWith('gift_prod|') && (adminData.isSuper || adminData.perms.products)) {
            const [_, tUid, prodId] = data.split('|'); 
            const snap = await get(ref(db, `products/${prodId}`));
            if (!snap.exists()) return;
            
            const p = adaptarProductoLegacy(snap.val()); 
            let kb = [];
            
            if (p.durations) {
                Object.keys(p.durations).forEach(dId => {
                    kb.push([{ text: `🎁 Dar Variante: ${p.durations[dId].duration}`, callback_data: `gift_do|${tUid}|${prodId}|${dId}` }]);
                });
            }
            
            return bot.editMessageText(`Selecciona la Variante exacta que vas a regalar:`, { chat_id: chatId, message_id: query.message.message_id, reply_markup: { inline_keyboard: kb } });
        }
        
        if (data.startsWith('gift_do|') && (adminData.isSuper || adminData.perms.products)) {
            bot.editMessageReplyMarkup({ inline_keyboard: [] }, { chat_id: chatId, message_id: query.message.message_id });
            
            const [_, tUid, prodId, durId] = data.split('|'); 
            const snap = await get(ref(db, `products/${prodId}`));
            const tUserSnap = await get(ref(db, `users/${tUid}`));
            
            if (!snap.exists() || !tUserSnap.exists()) return;
            
            const p = adaptarProductoLegacy(snap.val()); 
            const tUser = tUserSnap.val();
            const durInfo = p.durations[durId];
            
            if (durInfo.keys && Object.keys(durInfo.keys).length > 0) {
                const firstKeyId = Object.keys(durInfo.keys)[0]; 
                const keyToDeliver = durInfo.keys[firstKeyId];
                
                let keyPath = `products/${prodId}/durations/${durId}/keys/${firstKeyId}`;
                if (durId === 'legacy_var') {
                    keyPath = `products/${prodId}/keys/${firstKeyId}`;
                }
                
                await update(ref(db), { 
                    [keyPath]: null, 
                    [`users/${tUid}/history/${push(ref(db)).key}`]: { 
                        product: `${p.name} - ${durInfo.duration}`, 
                        key: keyToDeliver, 
                        price: 0, 
                        date: Date.now(), 
                        refunded: false, 
                        warrantyHours: durInfo.warranty || 0 
                    } 
                });
                
                bot.sendMessage(chatId, `✅ *REGALO ENVIADO ÉXITO*\n\nKey: \`${keyToDeliver}\` enviada a *${tUser.username}*`, { parse_mode: 'Markdown' });
                
                const authSnap = await get(ref(db, 'telegram_auth')); 
                authSnap.forEach(c => { 
                    if(c.val() === tUid) {
                        bot.sendMessage(c.key, `🎁 *¡TIENES UN REGALO DEL STAFF!*\n\nProducto: *${p.name}*\n🔑 Key: \`${keyToDeliver}\``, { parse_mode: 'Markdown' }); 
                    }
                });
            } else {
                bot.sendMessage(chatId, '❌ Producto se quedó sin stock antes de enviar el regalo.');
            }
            return;
        }

        // MENÚ DE EDICIÓN AVANZADA
        if (data.startsWith('ed_prod|')) { 
            const opts = [ 
                [{ text: '✏️ Editar Nombre General', callback_data: `edit_pname|${data.split('|')[1]}` }], 
                [{ text: '⚙️ Editar Variantes/Precios', callback_data: `list_vars|${data.split('|')[1]}` }] 
            ];
            return bot.editMessageText('¿Qué deseas modificar de este producto en el sistema?', { chat_id: chatId, message_id: query.message.message_id, reply_markup: { inline_keyboard: opts } }); 
        }
        
        if (data.startsWith('edit_pname|')) { 
            userStates[chatId] = { step: 'EDIT_PROD_NAME', data: { prodId: data.split('|')[1] } }; 
            return bot.editMessageText('Escribe el **Nuevo Nombre General**:', { chat_id: chatId, message_id: query.message.message_id, parse_mode: 'Markdown' }); 
        }
        
        if (data.startsWith('list_vars|')) {
            const snap = await get(ref(db, `products/${data.split('|')[1]}`));
            if (!snap.exists()) return bot.editMessageText('❌ Producto no existe.', { chat_id: chatId, message_id: query.message.message_id });
            
            const p = adaptarProductoLegacy(snap.val()); 
            let kb = [];
            
            if (p.durations) {
                Object.keys(p.durations).forEach(dId => {
                    kb.push([{ text: `✏️ Editar Configuración: ${p.durations[dId].duration}`, callback_data: `ed_dur|${data.split('|')[1]}|${dId}` }]);
                });
            }
            return bot.editMessageText(`Selecciona Variante de *${p.name}*:`, { chat_id: chatId, message_id: query.message.message_id, parse_mode: 'Markdown', reply_markup: { inline_keyboard: kb } });
        }
        
        if (data.startsWith('ed_dur|')) {
            const parts = data.split('|');
            const optsVars = [ 
                [{ text: '💰 Cambiar Precio USD', callback_data: `editv|PRICE|${parts[1]}|${parts[2]}` }], 
                [{ text: '⏱️ Cambiar Nombre Duración', callback_data: `editv|DUR|${parts[1]}|${parts[2]}` }], 
                [{ text: '⏳ Cambiar Horas de Garantía', callback_data: `editv|WARR|${parts[1]}|${parts[2]}` }] 
            ];
            return bot.editMessageText('⚙️ ¿Qué aspecto de la variante editarás?', { chat_id: chatId, message_id: query.message.message_id, reply_markup: { inline_keyboard: optsVars } });
        }
        
        if (data.startsWith('editv|')) {
            const parts = data.split('|'); 
            userStates[chatId] = { step: `EDIT_VAR_${parts[1]}`, data: { prodId: parts[2], durId: parts[3] } };
            bot.sendMessage(chatId, `Escribe el nuevo valor a establecer:`, { parse_mode: 'Markdown', ...cancelKeyboard }); 
            return;
        }

        // CONFIGURACIÓN EXTRA, REEMBOLSOS Y USUARIOS
        if (data.startsWith('editrank|')) { 
            const rankId = data.split('|')[1]; 
            const optsRank = [ 
                [{ text: '💰 Editar Gasto Min Requerido', callback_data: `er_min|${rankId}` }], 
                [{ text: '📉 Editar Descuento de Rango', callback_data: `er_desc|${rankId}` }] 
            ];
            return bot.editMessageText(`⚙️ *Editando Rango Vip*`, { chat_id: chatId, message_id: query.message.message_id, parse_mode: 'Markdown', reply_markup: { inline_keyboard: optsRank } }); 
        }
        
        if (data.startsWith('er_min|')) { 
            userStates[chatId] = { step: 'EDIT_RANK_MIN', data: { rankId: data.split('|')[1] } }; 
            return bot.sendMessage(chatId, '💰 Escribe la nueva cantidad de gasto requerido en USD:'); 
        }
        
        if (data.startsWith('er_desc|')) { 
            userStates[chatId] = { step: 'EDIT_RANK_DESC', data: { rankId: data.split('|')[1] } }; 
            return bot.sendMessage(chatId, '📉 Escribe el nuevo descuento fijo en USD:'); 
        }
        
        if (data.startsWith('toggle_pais|') && adminData.isSuper) {
            return sistemaRecargas.togglePaisAdmin(bot, db, chatId, query.message.message_id, data.split('|')[1]);
        }
        
        if (data.startsWith('viewu|')) {
            const filter = data.split('|')[1]; 
            const usersSnap = await get(ref(db, 'users')); 
            let kb = [];
            
            if (usersSnap.exists()) {
                usersSnap.forEach(u => { 
                    const s = parseFloat(u.val().balance || 0); 
                    let inc = false; 
                    if(filter === 'saldo' && s > 0) inc = true; 
                    if(filter === 'nosaldo' && s <= 0) inc = true; 
                    if(filter === 'todos') inc = true; 
                    if(inc) {
                        kb.push([{ text: `👤 ${u.val().username} - $${s.toFixed(2)}`, callback_data: `usermenu|${u.key}` }]); 
                    }
                });
            }
            if (kb.length > 90) kb = kb.slice(0, 90);
            
            return bot.editMessageText('📋 *USUARIOS FILTRADOS*', { chat_id: chatId, message_id: query.message.message_id, reply_markup: { inline_keyboard: kb }, parse_mode: 'Markdown' });
        }
        
        if (data.startsWith('usermenu|')) return sendUserManageMenu(chatId, data.split('|')[1], bot);
        
        if (data.startsWith('uact|')) {
            const parts = data.split('|'); 
            const action = parts[1]; 
            const tUid = parts[2];
            
            if (action === 'banperm') { 
                const uSnap = await get(ref(db, `users/${tUid}`));
                const isBanned = uSnap.val().banned || false; 
                await update(ref(db), { [`users/${tUid}/banned`]: !isBanned, [`users/${tUid}/banUntil`]: null }); 
                return bot.editMessageText(`✅ Estado del usuario actualizado en base de datos.`, { chat_id: chatId, message_id: query.message.message_id }); 
            }
            if (action === 'bantemp') { 
                userStates[chatId] = { step: 'TEMP_BAN_TIME', data: { targetUid: tUid } }; 
                return bot.sendMessage(chatId, '⏳ Escribe las horas de baneo temporal:'); 
            }
            if (action === 'addbal') { 
                userStates[chatId] = { step: 'DIRECT_ADD_BAL', data: { targetUid: tUid } }; 
                return bot.sendMessage(chatId, '➕ USD a AGREGAR al usuario directo:'); 
            }
            if (action === 'rembal') { 
                userStates[chatId] = { step: 'DIRECT_REM_BAL', data: { targetUid: tUid } }; 
                return bot.sendMessage(chatId, '➖ USD a QUITAR al usuario directo:'); 
            }
        }
        
        if (data.startsWith('cpntype|')) { 
            userStates[chatId].data.type = data.split('|')[1] === 'bal' ? 'balance' : 'discount'; 
            userStates[chatId].step = 'CREATE_COUPON_VALUE'; 
            return bot.editMessageText('Escribe el valor numérico del cupón (USD o % de descuento):', { chat_id: chatId, message_id: query.message.message_id }); 
        }
        
        // REEMBOLSO ADMIN GESTIÓN
        if (data.startsWith('rfnd|') && (adminData.isSuper || adminData.perms.refunds)) {
            bot.editMessageReplyMarkup({ inline_keyboard: [] }, { chat_id: chatId, message_id: query.message.message_id });
            const [_, tUid, hId] = data.split('|'); 
            
            const uDataSnap = await get(ref(db, `users/${tUid}`));
            if(!uDataSnap.exists()) return;
            const uData = uDataSnap.val();
            const c = uData.history[hId];
            
            if (c && !c.refunded) {
                const price = parseFloat(c.price || 0); 
                const nSal = parseFloat(uData.balance || 0) + price;
                
                await update(ref(db), { 
                    [`users/${tUid}/balance`]: nSal, 
                    [`users/${tUid}/history/${hId}/refunded`]: true 
                });
                
                bot.sendMessage(chatId, `✅ *Reembolso aprobado.* Dinero devuelto a ${uData.username}.`, { parse_mode: 'Markdown' });
                
                const authSnap = await get(ref(db, 'telegram_auth')); 
                authSnap.forEach(ch => { 
                    if(ch.val() === tUid) {
                        bot.sendMessage(ch.key, `🔄 *REEMBOLSO APROBADO*\n\nSe devolvió el dinero a tu cuenta.\n💰 +$${price} USD\n💳 Saldo Actual: $${nSal.toFixed(2)}`, { parse_mode: 'Markdown' }); 
                    }
                });

                if(uData.whatsapp) enviarWA(uData.whatsapp, `🔄 *REEMBOLSO APROBADO*\nSe han devuelto *$${price} USD* a tu cuenta.`);
            }
            return;
        }
        
        if (data.startsWith('reject_refund|') && (adminData.isSuper || adminData.perms.refunds)) {
            bot.editMessageReplyMarkup({ inline_keyboard: [] }, { chat_id: chatId, message_id: query.message.message_id });
            userStates[chatId] = { step: 'WAITING_FOR_REJECT_REASON', data: { targetTgId: data.split('|')[1] } };
            return bot.sendMessage(chatId, '✍️ *Escribe el motivo del rechazo para informar al usuario:*', { parse_mode: 'Markdown' });
        }
        
        if (data === 'cancel_refund' && (adminData.isSuper || adminData.perms.refunds)) { 
            bot.editMessageReplyMarkup({ inline_keyboard: [] }, { chat_id: chatId, message_id: query.message.message_id }); 
            return bot.sendMessage(chatId, '❌ Proceso de reembolso cancelado por el Admin.'); 
        }

        // RECARGAS ADMIN
        if (data.startsWith('ok_rech|') && (adminData.isSuper || adminData.perms.balance)) {
            return sistemaRecargas.aprobarRecarga(bot, db, chatId, query.message.message_id, data.split('|')[1], adminUsername, tgId, notifySuperAdmin);
        }
        if (data.startsWith('no_rech|') && (adminData.isSuper || adminData.perms.balance)) {
            return sistemaRecargas.rechazarRecarga(bot, db, chatId, query.message.message_id, data.split('|')[1], adminUsername, tgId, notifySuperAdmin);
        }
    }

    // --- CALLBACKS TIENDA DEL USUARIO ---
    if (data.startsWith('tcat|')) {
        const cat = data.split('|')[1]; 
        const productsSnap = await get(ref(db, 'products')); 
        let kb = [];
        
        if (productsSnap.exists()) {
            productsSnap.forEach(child => { 
                const p = adaptarProductoLegacy(child.val());
                if (p.category === cat) {
                    kb.push([{ text: `⚡️ ${p.name}`, callback_data: `tprod|${child.key}` }]); 
                }
            });
        }
        
        if (kb.length === 0) return bot.editMessageText(`❌ No hay productos activos en la plataforma ${cat}.`, { chat_id: chatId, message_id: query.message.message_id });
        
        return bot.editMessageText(`📦 Productos en la plataforma *${cat}*:`, { chat_id: chatId, message_id: query.message.message_id, parse_mode: 'Markdown', reply_markup: { inline_keyboard: kb } });
    }

    if (data.startsWith('tprod|')) {
        const prodId = data.split('|')[1]; 
        const snap = await get(ref(db, `products/${prodId}`));
        if (!snap.exists()) return bot.editMessageText('❌ El producto ya no existe en la tienda.', { chat_id: chatId, message_id: query.message.message_id });
        
        const p = adaptarProductoLegacy(snap.val());
        if (!p.durations) return bot.editMessageText('❌ Producto sin variantes disponibles.', { chat_id: chatId, message_id: query.message.message_id });
        
        const totalGastado = calcularGastoTotal(webUser.history);
        const rAct = await obtenerRango(db, totalGastado); 
        const aDesc = parseFloat(webUser.active_discount || 0); 
        let kb = [];
        
        Object.keys(p.durations).forEach(durId => {
            const dur = p.durations[durId]; 
            const stock = dur.keys ? Object.keys(dur.keys).length : 0;
            
            if (stock > 0) {
                let sPrice = dur.price; 
                if (rAct.descuento > 0) sPrice = Math.max(0, sPrice - rAct.descuento); 
                if (aDesc > 0) sPrice = sPrice - (sPrice * (aDesc / 100));
                
                kb.push([{ text: `${dur.duration} - $${sPrice.toFixed(2)} (${stock} disp)`, callback_data: `buy|${prodId}|${durId}` }]);
            }
        });
        
        if(kb.length === 0) return bot.editMessageText(`❌ Todas las opciones de ${p.name} se han agotado.`, { chat_id: chatId, message_id: query.message.message_id });
        
        return bot.editMessageText(`Selecciona el tiempo de duración para tu compra de *${p.name}*:`, { chat_id: chatId, message_id: query.message.message_id, parse_mode: 'Markdown', reply_markup: { inline_keyboard: kb } });
    }

    if (data.startsWith('buy|')) {
        const [_, productId, durId] = data.split('|'); 
        const waitMsg = await bot.sendMessage(chatId, '⚙️ Procesando la transacción, no toques nada...');

        const userSnap = await get(ref(db, `users/${webUid}`));
        const prodSnap = await get(ref(db, `products/${productId}`));
        
        if (!userSnap.exists() || !prodSnap.exists()) {
            return bot.editMessageText('❌ Error de conexión con la base de datos.', { chat_id: chatId, message_id: waitMsg.message_id });
        }
        
        let webUserNow = userSnap.val();
        let product = adaptarProductoLegacy(prodSnap.val());

        if (!product.durations || !product.durations[durId]) {
            return bot.editMessageText('❌ Error de validación del producto seleccionado.', { chat_id: chatId, message_id: waitMsg.message_id });
        }

        const durInfo = product.durations[durId];
        let currentBalance = parseFloat(webUserNow.balance || 0);
        let activeDiscount = parseFloat(webUserNow.active_discount || 0);
        
        const rAct = await obtenerRango(db, calcularGastoTotal(webUserNow.history));
        
        let fPrice = durInfo.price; 
        if (rAct.descuento > 0) fPrice = Math.max(0, fPrice - rAct.descuento); 
        if (activeDiscount > 0) fPrice = fPrice - (fPrice * (activeDiscount / 100));

        if (currentBalance < fPrice) {
            return bot.editMessageText(`❌ Saldo insuficiente.\n\nEl precio final a pagar es: $${fPrice.toFixed(2)} USD\nTu saldo actual es de: $${currentBalance.toFixed(2)} USD`, { chat_id: chatId, message_id: waitMsg.message_id });
        }
        
        if (durInfo.keys && Object.keys(durInfo.keys).length > 0) {
            const firstKeyId = Object.keys(durInfo.keys)[0]; 
            const keyToDeliver = durInfo.keys[firstKeyId]; 
            const keysRestantes = Object.keys(durInfo.keys).length - 1; 

            let keyPath = `products/${productId}/durations/${durId}/keys/${firstKeyId}`;
            if (durId === 'legacy_var') {
                keyPath = `products/${productId}/keys/${firstKeyId}`;
            }

            const updates = { 
                [keyPath]: null, 
                [`users/${webUid}/balance`]: currentBalance - fPrice 
            };
            
            if (activeDiscount > 0) updates[`users/${webUid}/active_discount`] = null;
            
            updates[`users/${webUid}/history/${push(ref(db)).key}`] = { 
                product: `${product.name} - ${durInfo.duration}`, 
                key: keyToDeliver, 
                price: fPrice, 
                date: Date.now(), 
                refunded: false, 
                warrantyHours: durInfo.warranty || 0 
            };

            await update(ref(db), updates);
            
            const msgCompra = `━━━━━━━━━━━━━━━━━━━━━\n` +
                              `✅ *¡COMPRA COMPLETADA CON ÉXITO!*\n` +
                              `━━━━━━━━━━━━━━━━━━━━━\n\n` +
                              `Tu producto ha sido entregado. Guárdalo bien:\n\n` +
                              `\`${keyToDeliver}\``;
                              
            bot.editMessageText(msgCompra, { chat_id: chatId, message_id: waitMsg.message_id, parse_mode: 'Markdown' });

            if (keysRestantes <= 3) {
                bot.sendMessage(SUPER_ADMIN_ID, `⚠️ *ALERTA DE STOCK BAJO*\n\nProducto: ${product.name} (${durInfo.duration})\nSolo quedan **${keysRestantes}** keys.`, { parse_mode: 'Markdown' });
            }

        } else {
            bot.editMessageText('❌ El producto se ha agotado justo en este momento.', { chat_id: chatId, message_id: waitMsg.message_id });
        }
    }

    if (data.startsWith('sel_pais|')) {
        if (userStates[chatId] && userStates[chatId].data) {
            return sistemaRecargas.seleccionarPais(bot, chatId, data.split('|')[1], userStates[chatId].data, userStates);
        }
        return bot.sendMessage(chatId, '❌ Tu sesión de recarga ha expirado. Por favor pídelo nuevamente.');
    }
    
    if (data.startsWith('send_receipt|')) {
        return sistemaRecargas.solicitarComprobante(bot, db, chatId, webUid, parseFloat(data.split('|')[1]), data.split('|')[2], userStates);
    }
});

module.exports = { verificarBonoReferido };
console.log('🤖 Terminal de SociosXit (Edición V5 Definitiva + WhatsApp Mac Auth) En línea y a la espera de peticiones...');
