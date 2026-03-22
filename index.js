const TelegramBot = require('node-telegram-bot-api');
const { initializeApp } = require('firebase/app');
const { getDatabase, ref, get, update, push, set, remove } = require('firebase/database');

// ==========================================
// CONFIGURACIÓN DE FIREBASE Y API
// ==========================================
const PYTHON_API_URL = process.env.PYTHON_API_URL || 'PON_AQUI_LA_URL_PUBLICA_DE_TU_FLASK';

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
// 👑 SISTEMA DEL BOT MAESTRO (LUCK XIT VENDEDOR)
// ==========================================
// PON AQUÍ EL TOKEN DEL BOT QUE VA A VENDER LAS SUSCRIPCIONES
const MASTER_TOKEN = '8275295427:AAFc-U21od7ZWdtQU-62U1mJOSJqFYFZ-IQ'; 
const MASTER_ADMIN = 7710633235; // Tu ID, LUCK XIT
const masterBot = new TelegramBot(MASTER_TOKEN, { polling: true });

const activeBots = {}; // Memoria para guardar los bots encendidos

masterBot.onText(/\/start/, (msg) => {
    const chatId = msg.chat.id;
    if (msg.from.id === MASTER_ADMIN) {
        masterBot.sendMessage(chatId, "👑 *Panel Master LUCK XIT*\n\nPara activar a un cliente usa este formato:\n`/crearbot [ID_DEL_CLIENTE] [TOKEN_DE_SU_BOT] [DIAS_DE_USO]`\n\nEjemplo:\n`/crearbot 123456789 8275295427:AAFc... 30`", { parse_mode: 'Markdown' });
    } else {
        masterBot.sendMessage(chatId, "🌌 *Bienvenido a LUCK XIT Bot Creator*\n\nAdquiere tu propio bot de ventas totalmente administrable por solo $5 USD mensuales. Contacta al soporte para pagar y activar tu bot.", { parse_mode: 'Markdown' });
    }
});

masterBot.onText(/\/crearbot (\d+) (.+) (\d+)/, async (msg, match) => {
    if (msg.from.id !== MASTER_ADMIN) return;
    const chatId = msg.chat.id;
    const clienteId = parseInt(match[1]);
    const botToken = match[2];
    const dias = parseInt(match[3]);

    const expiresAt = Date.now() + (dias * 24 * 60 * 60 * 1000);

    await set(ref(db, `suscripciones_bots/${clienteId}`), {
        token: botToken,
        expiresAt: expiresAt,
        active: true
    });

    masterBot.sendMessage(chatId, `✅ *Bot Creado/Actualizado*\n\nCliente: \`${clienteId}\`\nDías: ${dias}\n\nIniciando su bot ahora mismo...`, { parse_mode: 'Markdown' });
    arrancarBotCliente(clienteId, botToken);
});

async function checkSubscriptions() {
    const subSnap = await get(ref(db, 'suscripciones_bots'));
    if (!subSnap.exists()) return;

    subSnap.forEach(child => {
        const clienteId = child.key;
        const data = child.val();

        if (data.active) {
            if (Date.now() > data.expiresAt) {
                if (activeBots[clienteId]) {
                    activeBots[clienteId].stopPolling();
                    delete activeBots[clienteId];
                }
                update(ref(db, `suscripciones_bots/${clienteId}`), { active: false });
                masterBot.sendMessage(MASTER_ADMIN, `🔴 *Suscripción Vencida*\n\nEl bot del cliente \`${clienteId}\` se ha apagado automáticamente porque se le acabó el mes.`, { parse_mode: 'Markdown' });
            } else {
                if (!activeBots[clienteId]) {
                    arrancarBotCliente(parseInt(clienteId), data.token);
                }
            }
        }
    });
}
setInterval(checkSubscriptions, 60000); // Revisa cada 1 minuto
setTimeout(checkSubscriptions, 2000);

// ==========================================
// 🤖 SISTEMA DE INSTANCIAS (TU CÓDIGO COMPLETO)
// ==========================================
function arrancarBotCliente(ADMIN_ID, token) {
    if (activeBots[ADMIN_ID]) return; // Evita encenderlo 2 veces

    console.log(`🚀 Iniciando bot para cliente: ${ADMIN_ID}`);
    const bot = new TelegramBot(token, { polling: true });
    activeBots[ADMIN_ID] = bot;

    const dbPrefix = `clientes/${ADMIN_ID}`; // <- LA MAGIA DEL AISLAMIENTO DE DATOS

    // SISTEMA DE ESTADOS (Aislado por bot)
    const userStates = {}; 

    const userKeyboard = {
        reply_markup: {
            keyboard: [
                [{ text: '🛒 Tienda' }, { text: '👤 Mi Perfil' }],
                [{ text: '💳 Recargas' }, { text: '🔄 Solicitar Reembolso' }],
                [{ text: '🎥 Descargar Video' }, { text: '🎟️ Canjear Cupón' }] 
            ],
            resize_keyboard: true,
            is_persistent: true
        }
    };

    const adminKeyboard = {
        reply_markup: {
            keyboard: [
                [{ text: '📦 Crear Producto' }, { text: '📝 Editar Producto' }, { text: '🗑️ Eliminar Producto' }],
                [{ text: '🔑 Añadir Stock' }, { text: '💰 Añadir Saldo' }, { text: '📢 Mensaje Global' }],
                [{ text: '🔄 Revisar Reembolsos' }, { text: '🎟️ Crear Cupón' }, { text: '📊 Estadísticas' }], 
                [{ text: '📋 Usuarios con Saldo' }, { text: '🔨 Gest. Usuarios' }, { text: '🛠️ Mantenimiento' }],
                [{ text: '⚙️ Ajustes Descargas' }, { text: '🎥 Descargar Video' }, { text: '❌ Cancelar Acción' }]
            ],
            resize_keyboard: true,
            is_persistent: true
        }
    };

    async function getAuthUser(telegramId) {
        const authSnap = await get(ref(db, `${dbPrefix}/telegram_auth/${telegramId}`));
        if (authSnap.exists()) return authSnap.val();
        return null;
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

        const userSnap = await get(ref(db, `${dbPrefix}/users/${webUid}`));
        const webUser = userSnap.val();
        
        if (!webUser) {
            return bot.sendMessage(chatId, '⚠️ *ERROR CRÍTICO*\n\nTu cuenta web fue eliminada o no se encuentra en la base de datos. Contacta a soporte.', { parse_mode: 'Markdown' });
        }

        const keyboard = (tgId === ADMIN_ID) ? adminKeyboard : userKeyboard;
        const greeting = (tgId === ADMIN_ID) ? `👑 ¡Bienvenido Admin Supremo, *${webUser.username}*!` : `🌌 Bienvenido a LUCK XIT, *${webUser.username}*.`;

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
        
        const settingsSnap = await get(ref(db, `${dbPrefix}/settings`));
        const isMaintenance = settingsSnap.val()?.maintenance || false;
        
        const userSnap = await get(ref(db, `${dbPrefix}/users/${webUid}`));
        const webUser = userSnap.val();

        if (!webUser) {
            return bot.sendMessage(chatId, '⚠️ *ERROR CRÍTICO*\n\nTu cuenta web fue eliminada o no se encuentra. Contacta a soporte.', { parse_mode: 'Markdown' });
        }

        if (tgId !== ADMIN_ID) {
            if (webUser.banned) {
                return bot.sendMessage(chatId, '🚫 *ESTÁS BANEADO*\n\nHas sido bloqueado del sistema LUCK XIT por violar nuestras políticas o reglas. Si crees que es un error, contacta a soporte.', { parse_mode: 'Markdown' });
            }
            if (isMaintenance) {
                return bot.sendMessage(chatId, '🛠️ *MODO MANTENIMIENTO ACTIVO*\n\nEstamos haciendo unas mejoras rápidas en el bot. Volveremos a estar en línea muy pronto. ¡Gracias por tu paciencia!', { parse_mode: 'Markdown' });
            }
        }

        const keyboard = (tgId === ADMIN_ID) ? adminKeyboard : userKeyboard;

        if (text === '❌ Cancelar Acción') {
            userStates[chatId] = null;
            return bot.sendMessage(chatId, '✅ Acción cancelada. ¿Qué deseas hacer ahora?', adminKeyboard);
        }

        if (msg.photo && userStates[chatId]) {
            const state = userStates[chatId];
            const fileId = msg.photo[msg.photo.length - 1].file_id; 

            if (state.step === 'WAITING_FOR_RECEIPT') {
                const stateData = state.data; 
                const username = stateData.username;
                const amount = stateData.amount;
                const targetWebUid = stateData.webUid;
                
                const adminConfirmKeyboard = {
                    inline_keyboard: [
                        [{ text: '✅ Confirmar', callback_data: `ok_rech|${targetWebUid}|${amount}|${tgId}` }],
                        [{ text: '❌ Rechazar', callback_data: `no_rech|${tgId}` }]
                    ]
                };

                bot.sendPhoto(ADMIN_ID, fileId, {
                    caption: `💳 *NUEVO COMPROBANTE DE PAGO*\n\n👤 Usuario: ${username}\n🆔 ID Telegram: \`${tgId}\`\n💰 Monto Solicitado: *$${amount} USD*`,
                    parse_mode: 'Markdown',
                    reply_markup: adminConfirmKeyboard 
                });
                
                userStates[chatId] = null; 
                return bot.sendMessage(chatId, '✅ Comprobante enviado exitosamente al administrador. Por favor espera a que se valide y acredite tu saldo.', keyboard);
            }

            if (state.step === 'WAITING_FOR_USER_REFUND_PROOF') {
                const foundData = state.data;
                const reason = msg.caption ? msg.caption : 'Sin razón especificada';
                const dateStr = new Date(foundData.compra.date).toLocaleString('es-CO');

                const msgInfo = `🔔 *NUEVA SOLICITUD DE REEMBOLSO (CON PRUEBA)*\n\n` +
                            `👤 *Usuario:* ${foundData.username}\n` +
                            `📦 *Producto:* ${foundData.compra.product}\n` +
                            `🔑 *Key:* \`${foundData.compra.key}\`\n` +
                            `💰 *Pagado:* $${parseFloat(foundData.compra.price).toFixed(2)} USD\n` +
                            `📅 *Fecha:* ${dateStr}\n` +
                            `📝 *Motivo del usuario:* ${reason}\n\n` +
                            `¿Deseas aprobar la solicitud y devolver el dinero?`;

                const refundKeyboard = {
                    inline_keyboard: [
                        [{ text: '✅ Mandar Reembolso', callback_data: `rfnd|${foundData.uid}|${foundData.histId}` }],
                        [{ text: '❌ Rechazar Solicitud', callback_data: `reject_refund|${foundData.targetTgId}` }]
                    ]
                };
                
                bot.sendPhoto(ADMIN_ID, fileId, { caption: msgInfo, parse_mode: 'Markdown', reply_markup: refundKeyboard });
                userStates[chatId] = null;
                return bot.sendMessage(chatId, '✅ Tu solicitud y captura han sido enviadas al administrador exitosamente. Recibirás una notificación pronto.', keyboard);
            }
        }

        if (!text) return; 

        if (userStates[chatId]) {
            const state = userStates[chatId];

            if (state.step === 'WAITING_FOR_RECEIPT' || state.step === 'WAITING_FOR_USER_REFUND_PROOF') {
                return bot.sendMessage(chatId, '❌ Debes adjuntar una **foto (captura de pantalla)** para continuar.\n\n_(Si deseas salir, usa el menú o escribe "❌ Cancelar Acción")_', { parse_mode: 'Markdown' });
            }

            if (state.step === 'REDEEM_COUPON') {
                const code = text.trim().toUpperCase();
                const couponSnap = await get(ref(db, `${dbPrefix}/coupons/${code}`));
                
                if (!couponSnap.exists()) {
                    userStates[chatId] = null;
                    return bot.sendMessage(chatId, '❌ *CUPÓN INVÁLIDO*\n\nEse código no existe o lo has escrito mal.', { parse_mode: 'Markdown', ...keyboard });
                }

                const couponData = couponSnap.val();
                const userUsedCouponsSnap = await get(ref(db, `${dbPrefix}/users/${webUid}/used_coupons/${code}`));
                
                if (userUsedCouponsSnap.exists()) {
                    userStates[chatId] = null;
                    return bot.sendMessage(chatId, '⚠️ *YA USASTE ESTE CUPÓN*\n\nSolo se puede canjear una vez por cuenta.', { parse_mode: 'Markdown', ...keyboard });
                }

                const updates = {};
                updates[`${dbPrefix}/users/${webUid}/used_coupons/${code}`] = true;

                if (couponData.type === 'balance') {
                    const currentBal = parseFloat(webUser.balance || 0);
                    const reward = parseFloat(couponData.value);
                    const nuevoSaldo = currentBal + reward;
                    updates[`${dbPrefix}/users/${webUid}/balance`] = nuevoSaldo;
                    
                    await update(ref(db), updates);
                    userStates[chatId] = null;
                    return bot.sendMessage(chatId, `🎉 *¡CUPÓN CANJEADO CON ÉXITO!*\n\nSe han añadido *$${reward} USD* a tu saldo.\n💰 *Nuevo saldo:* $${nuevoSaldo.toFixed(2)} USD`, { parse_mode: 'Markdown', ...keyboard });
                } else if (couponData.type === 'discount') {
                    const discount = parseFloat(couponData.value);
                    updates[`${dbPrefix}/users/${webUid}/active_discount`] = discount;
                    
                    await update(ref(db), updates);
                    userStates[chatId] = null;
                    return bot.sendMessage(chatId, `🎟️ *¡CUPÓN DE DESCUENTO APLICADO!*\n\nHas activado un descuento del **${discount}%**.\n🛍️ Se aplicará automáticamente en tu **próxima compra** de cualquier producto en la tienda.`, { parse_mode: 'Markdown', ...keyboard });
                }
            }

            if (state.step === 'MANAGE_USER' && tgId === ADMIN_ID) {
                const username = text.trim();
                const usersSnap = await get(ref(db, `${dbPrefix}/users`));
                let targetUid = null;
                let targetUser = null;

                usersSnap.forEach(u => {
                    if (u.val().username === username) {
                        targetUid = u.key;
                        targetUser = u.val();
                    }
                });

                if (!targetUid) return bot.sendMessage(chatId, '❌ Usuario no encontrado. Verifica mayúsculas y minúsculas.');

                let totalSpent = 0;
                if (targetUser.history) {
                    Object.values(targetUser.history).forEach(h => totalSpent += parseFloat(h.price || 0));
                }

                const isBanned = targetUser.banned || false;
                const statusText = isBanned ? '🔴 BANEADO' : '🟢 ACTIVO';
                
                const msgInfo = `👤 *GESTIÓN DE USUARIO*\n\n` +
                                `*Nombre:* ${targetUser.username}\n` +
                                `*Saldo:* $${parseFloat(targetUser.balance||0).toFixed(2)} USD\n` +
                                `*Gastado Total:* $${totalSpent.toFixed(2)} USD\n` +
                                `*Estado:* ${statusText}`;

                const userKeys = {
                    inline_keyboard: [
                        [{ text: isBanned ? '✅ Desbanear Usuario' : '🔨 Banear Usuario', callback_data: `toggleban|${targetUid}` }]
                    ]
                };

                bot.sendMessage(chatId, msgInfo, { parse_mode: 'Markdown', reply_markup: userKeys });
                userStates[chatId] = null;
                return;
            }

            if (state.step === 'CREATE_COUPON_CODE' && tgId === ADMIN_ID) {
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

            if (state.step === 'CREATE_COUPON_VALUE' && tgId === ADMIN_ID) {
                const val = parseFloat(text);
                if (isNaN(val) || val <= 0) return bot.sendMessage(chatId, '❌ Valor inválido. Ingresa un número mayor a 0.');
                
                await set(ref(db, `${dbPrefix}/coupons/${state.data.code}`), { type: state.data.type, value: val });
                
                const isDesc = state.data.type === 'discount';
                bot.sendMessage(chatId, `✅ *Cupón creado.*\n\nCódigo: \`${state.data.code}\`\nBeneficio: ${isDesc ? val + '% de Descuento (1 sola compra)' : '$' + val + ' USD de saldo'}`, { parse_mode: 'Markdown', ...adminKeyboard });
                userStates[chatId] = null;
                return;
            }

            if (state.step === 'WAITING_FOR_REJECT_REASON' && tgId === ADMIN_ID) {
                const targetTgId = state.data.targetTgId;
                const reason = text.trim();

                bot.sendMessage(chatId, '✅ La razón del rechazo ha sido enviada al usuario.', adminKeyboard);
                bot.sendMessage(targetTgId, `❌ *SOLICITUD DE REEMBOLSO RECHAZADA*\n\nTu solicitud no ha sido aprobada por la siguiente razón:\n\n📝 _"${reason}"_\n\nContacta a soporte si crees que es un error.`, { parse_mode: 'Markdown' });
                
                userStates[chatId] = null;
                return;
            }

            if (state.step.startsWith('EDIT_PROD_') && tgId === ADMIN_ID) {
                const prodId = state.data.prodId;
                const fieldType = state.step.split('_')[2]; 
                
                let updates = {};
                if (fieldType === 'NAME') {
                    updates[`${dbPrefix}/products/${prodId}/name`] = text;
                } else if (fieldType === 'PRICE') {
                    const price = parseFloat(text);
                    if (isNaN(price)) return bot.sendMessage(chatId, '❌ Precio inválido. Usa números.');
                    updates[`${dbPrefix}/products/${prodId}/price`] = price;
                } else if (fieldType === 'WARR') {
                    const warr = parseFloat(text);
                    if (isNaN(warr) || warr < 0) return bot.sendMessage(chatId, '❌ Garantía inválida. Usa números mayores o iguales a 0.');
                    updates[`${dbPrefix}/products/${prodId}/warranty`] = warr;
                }
                
                await update(ref(db), updates);
                bot.sendMessage(chatId, `✅ Producto actualizado correctamente.`, adminKeyboard);
                userStates[chatId] = null;
                return;
            }

            if (state.step === 'WAITING_FOR_VIDEO_URL') {
                const url = text.trim();
                const isTikTok = url.includes('tiktok.com') || url.includes('vm.tiktok.com');
                const isYouTube = url.includes('youtube.com') || url.includes('youtu.be');

                if (!isTikTok && !isYouTube) {
                    return bot.sendMessage(chatId, '❌ Enlace no válido. Por favor, envía un enlace válido de TikTok o YouTube.', keyboard);
                }

                bot.sendMessage(chatId, '⏳ Analizando enlace y verificando saldo...');

                try {
                    const settingsSnap = await get(ref(db, `${dbPrefix}/settings/downloads_free`));
                    const isFree = settingsSnap.val() || false;
                    
                    let cost = 0;
                    if (tgId !== ADMIN_ID && !isFree) {
                        cost = isYouTube ? 0.10 : 0.05;
                    }

                    const currentBal = parseFloat(webUser.balance || 0);

                    if (currentBal < cost) {
                        userStates[chatId] = null;
                        return bot.sendMessage(chatId, `❌ Saldo insuficiente. Necesitas $${cost} USD para esta descarga. Tu saldo es: $${currentBal.toFixed(2)} USD.`, keyboard);
                    }

                    const params = new URLSearchParams();
                    params.append('url', url);

                    const previewRes = await fetch(`${PYTHON_API_URL}/preview`, { method: 'POST', body: params });
                    if (!previewRes.ok) throw new Error(`Error HTTP de Python: ${previewRes.status}`);
                    
                    const previewData = await previewRes.json();
                    if (previewData.error) throw new Error(previewData.error);

                    if (isYouTube && previewData.duration > 1200) {
                        userStates[chatId] = null;
                        return bot.sendMessage(chatId, '❌ El video de YouTube excede el límite permitido de 20 minutos.', keyboard);
                    }

                    if (cost > 0) {
                        const nuevoSaldo = currentBal - cost;
                        await update(ref(db), { [`${dbPrefix}/users/${webUid}/balance`]: nuevoSaldo });
                        bot.sendMessage(chatId, `💸 Se han descontado *$${cost} USD* de tu saldo. Iniciando descarga...`, { parse_mode: 'Markdown' });
                    } else if (tgId === ADMIN_ID) {
                        bot.sendMessage(chatId, `👑 Admin supremo, procesando gratis...`);
                    } else {
                        bot.sendMessage(chatId, `✨ Función gratuita activada. Iniciando descarga...`);
                    }

                    bot.sendMessage(chatId, '📥 Descargando archivo desde el servidor, esto tomará unos segundos...');

                    params.append('kind', 'video');
                    const downloadRes = await fetch(`${PYTHON_API_URL}/download`, { method: 'POST', body: params });

                    if (!downloadRes.ok) throw new Error("Error en el servidor de descargas (Python) al descargar.");

                    const arrayBuffer = await downloadRes.arrayBuffer();
                    const buffer = Buffer.from(arrayBuffer);

                    const fileName = isTikTok ? 'tiktok_video.mp4' : 'youtube_video.mp4';
                    
                    await bot.sendVideo(chatId, buffer, { 
                        caption: `✅ *Video descargado exitosamente*\n\n🤖 *LUCK XIT OFC*`,
                        parse_mode: 'Markdown'
                    }, {
                        filename: fileName,
                        contentType: 'video/mp4'
                    });

                    userStates[chatId] = null;

                } catch (error) {
                    console.error("🔴 ERROR EN DESCARGA:", error.message || error);
                    
                    let costToRefund = 0;
                    if (tgId !== ADMIN_ID) {
                        const settingsSnap = await get(ref(db, `${dbPrefix}/settings/downloads_free`));
                        const isFree = settingsSnap.val() || false;
                        if (!isFree) costToRefund = isYouTube ? 0.10 : 0.05;
                    }

                    if (costToRefund > 0) {
                        const reCheckUserSnap = await get(ref(db, `${dbPrefix}/users/${webUid}`));
                        const currentBal = parseFloat(reCheckUserSnap.val().balance || 0);
                        await update(ref(db), { [`${dbPrefix}/users/${webUid}/balance`]: currentBal + costToRefund });
                        bot.sendMessage(chatId, `⚠️ Error en la descarga. **Se te han devuelto $${costToRefund} USD a tu saldo.** Revisa que el enlace sea correcto y no sea muy pesado.`, keyboard);
                    } else {
                        bot.sendMessage(chatId, '⚠️ Hubo un error al procesar el enlace. El servidor puede estar caído o el video pesa más de 50MB (límite de Telegram).', keyboard);
                    }
                    userStates[chatId] = null;
                }
                return;
            }

            if (state.step === 'WAITING_FOR_USER_REFUND_KEY') {
                const searchKey = text.trim();
                bot.sendMessage(chatId, '🔎 Verificando tu solicitud de reembolso...');
                
                let found = false;
                let foundData = null;

                if (webUser.history) {
                    Object.keys(webUser.history).forEach(histId => {
                        const compra = webUser.history[histId];
                        if (compra.key === searchKey) {
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

            if (state.step === 'WAITING_FOR_REFUND_KEY') {
                const searchKey = text.trim();
                bot.sendMessage(chatId, '🔎 Buscando la Key en los registros globales...');

                const usersSnap = await get(ref(db, `${dbPrefix}/users`));
                let found = false;
                let foundData = null;

                if (usersSnap.exists()) {
                    usersSnap.forEach(userChild => {
                        const uid = userChild.key;
                        const userData = userChild.val();
                        
                        if (userData.history) {
                            Object.keys(userData.history).forEach(histId => {
                                const compra = userData.history[histId];
                                if (compra.key === searchKey) {
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
                    bot.sendMessage(chatId, '❌ No se encontró ninguna compra con esa Key en la base de datos.', adminKeyboard);
                }
                userStates[chatId] = null;
                return;
            }

            if (state.step === 'WAITING_FOR_RECHARGE_AMOUNT') {
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
                        [{ text: '📸 Enviar por Aquí (Telegram)', callback_data: `send_receipt|${amountUsd}` }]
                    ] 
                };

                userStates[chatId] = null; 
                return bot.sendMessage(chatId, mensajePago, { parse_mode: 'Markdown', reply_markup: rechargeInline });
            }

            if (state.step === 'WAITING_FOR_BROADCAST_MESSAGE') {
                bot.sendMessage(chatId, '⏳ Enviando mensaje a todos los usuarios...');
                const telegramAuthSnap = await get(ref(db, `${dbPrefix}/telegram_auth`));
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

            if (state.step === 'ADD_BALANCE_USER') {
                state.data.targetUser = text.trim();
                state.step = 'ADD_BALANCE_AMOUNT';
                return bot.sendMessage(chatId, `Dime la **cantidad** en USD a añadir para ${state.data.targetUser}:`, { parse_mode: 'Markdown' });
            }
            if (state.step === 'ADD_BALANCE_AMOUNT') {
                const amount = parseFloat(text);
                if (isNaN(amount)) return bot.sendMessage(chatId, '❌ Cantidad inválida. Intenta con un número (ej: 5.50).');
                
                bot.sendMessage(chatId, '⚙️ Buscando usuario...');
                const usersSnap = await get(ref(db, `${dbPrefix}/users`));
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
                    updates[`${dbPrefix}/users/${foundUid}/balance`] = nuevoSaldo;
                    const rechRef = push(ref(db, `${dbPrefix}/users/${foundUid}/recharges`));
                    updates[`${dbPrefix}/users/${foundUid}/recharges/${rechRef.key}`] = { amount: amount, date: Date.now() };
                    
                    await update(ref(db), updates);
                    
                    bot.sendMessage(chatId, `✅ Saldo añadido a ${state.data.targetUser}. Nuevo saldo: $${nuevoSaldo.toFixed(2)}`, adminKeyboard);

                    const telegramAuthSnap = await get(ref(db, `${dbPrefix}/telegram_auth`));
                    let targetTgId = null;
                    
                    if (telegramAuthSnap.exists()) {
                        telegramAuthSnap.forEach(child => {
                            if (child.val() === foundUid) targetTgId = child.key;
                        });
                    }

                    if (targetTgId) {
                        bot.sendMessage(targetTgId, `🎉 Tu administrador LUCK XIT te ha depositado: *$${amount} USD* de saldo.\n💰 Nuevo saldo: *$${nuevoSaldo.toFixed(2)} USD*`, { parse_mode: 'Markdown' });
                    }

                } else {
                    bot.sendMessage(chatId, `❌ Usuario no encontrado.`, adminKeyboard);
                }
                userStates[chatId] = null; 
                return;
            }

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
                return bot.sendMessage(chatId, 'Ingresa la **duración** (ej: 24 horas o Mensual):', { parse_mode: 'Markdown' });
            }
            if (state.step === 'CREATE_PROD_DURATION') {
                state.data.duration = text;
                state.step = 'CREATE_PROD_WARRANTY';
                return bot.sendMessage(chatId, 'Ingresa el **tiempo de garantía** en horas (ej: 24).\n\n_(Si no quieres que tenga límite de tiempo para reembolso, escribe **0**)_:', { parse_mode: 'Markdown' });
            }
            if (state.step === 'CREATE_PROD_WARRANTY') {
                const warranty = parseFloat(text);
                if (isNaN(warranty) || warranty < 0) return bot.sendMessage(chatId, '❌ Garantía inválida. Usa números (ej: 24 o 0).');
                
                const newProdRef = push(ref(db, `${dbPrefix}/products`));
                await set(newProdRef, { 
                    name: state.data.name, 
                    price: state.data.price, 
                    duration: state.data.duration, 
                    warranty: warranty 
                });
                
                bot.sendMessage(chatId, `✅ Producto *${state.data.name}* creado exitosamente con ${warranty > 0 ? warranty + ' hrs de garantía' : 'garantía ilimitada'}.`, { parse_mode: 'Markdown', ...adminKeyboard });
                userStates[chatId] = null;
                return;
            }

            if (state.step === 'ADD_STOCK_KEYS') {
                const keysRaw = text;
                const cleanKeys = keysRaw.split(/[\n,\s]+/).map(k => k.trim()).filter(k => k.length > 0);
                
                if (cleanKeys.length === 0) {
                    userStates[chatId] = null;
                    return bot.sendMessage(chatId, '❌ No se detectaron keys válidas. Operación cancelada.');
                }

                const updates = {};
                cleanKeys.forEach(k => {
                    const newId = push(ref(db, `${dbPrefix}/products/${state.data.prodId}/keys`)).key;
                    updates[`${dbPrefix}/products/${state.data.prodId}/keys/${newId}`] = k;
                });

                await update(ref(db), updates);
                bot.sendMessage(chatId, `✅ ¡Listo! Se agregaron ${cleanKeys.length} keys al producto.`, adminKeyboard);
                userStates[chatId] = null;
                return;
            }
        }

        if (text === '🎟️ Canjear Cupón') {
            userStates[chatId] = { step: 'REDEEM_COUPON', data: {} };
            return bot.sendMessage(chatId, '🎁 *CANJEAR CUPÓN*\n\nEscribe el código promocional:', { parse_mode: 'Markdown' });
        }

        if (text === '🎥 Descargar Video') {
            userStates[chatId] = { step: 'WAITING_FOR_VIDEO_URL', data: { webUid: webUid } };
            return bot.sendMessage(chatId, '🎥 *DESCARGADOR LUCK XIT*\n\nEnvía el enlace del video de **TikTok** o **YouTube** que deseas descargar.\n\n💸 *Costos:*\n- YouTube (Max 20 min): $0.10 USD\n- TikTok: $0.05 USD\n\n_(Para cancelar, escribe cualquier comando o presiona tu perfil)_', { parse_mode: 'Markdown' });
        }

        if (text === '🔄 Solicitar Reembolso') {
            userStates[chatId] = { step: 'WAITING_FOR_USER_REFUND_KEY', data: { webUid: webUid } };
            return bot.sendMessage(chatId, '🔄 *SOLICITUD DE REEMBOLSO*\n\nPor favor, escribe y envía la **Key** exacta de la compra que deseas que te reembolsemos:', { parse_mode: 'Markdown' });
        }

        if (text === '👤 Mi Perfil') {
            let msgPerfil = `👤 *PERFIL LUCK XIT*\n\nUsuario: ${webUser.username}\n💰 Saldo: *$${parseFloat(webUser.balance).toFixed(2)} USD*`;
            if (webUser.active_discount && webUser.active_discount > 0) {
                msgPerfil += `\n\n🎟️ *Descuento Activo:* Tienes un ${webUser.active_discount}% de descuento para tu próxima compra en la tienda.`;
            }
            return bot.sendMessage(chatId, msgPerfil, { parse_mode: 'Markdown' });
        }

        if (text === '💳 Recargas') {
            let totalRecharged = 0;
            if (webUser.recharges) {
                Object.values(webUser.recharges).forEach(r => {
                    totalRecharged += parseFloat(r.amount || 0);
                });
            }

            const minUsd = totalRecharged > 5 ? 2 : 3;
            const exchangeRate = 3800;

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
            const productsSnap = await get(ref(db, `${dbPrefix}/products`));
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

        if (tgId === ADMIN_ID) {

            if (text === '📋 Usuarios con Saldo') {
                bot.sendMessage(chatId, '⏳ Generando reporte de usuarios...');
                const usersSnap = await get(ref(db, `${dbPrefix}/users`));
                
                let list = `📋 *REPORTE: USUARIOS CON SALDO*\n\n`;
                let count = 0;
                
                if (usersSnap.exists()) {
                    usersSnap.forEach(u => {
                        const ud = u.val();
                        const saldo = parseFloat(ud.balance || 0);
                        
                        if (saldo > 0) {
                            count++;
                            let gastos = 0;
                            let compras = 0;
                            if (ud.history) {
                                Object.values(ud.history).forEach(h => {
                                    gastos += parseFloat(h.price || 0);
                                    compras++;
                                });
                            }
                            list += `👤 *${ud.username}*\n💰 Saldo: $${saldo.toFixed(2)}\n💸 Gastos: $${gastos.toFixed(2)} | 🛍️ Keys: ${compras}\n➖\n`;
                        }
                    });
                }
                
                if (count === 0) return bot.sendMessage(chatId, 'No hay ningún usuario con saldo en la base de datos en este momento.');
                
                if (list.length > 4000) {
                    const lineas = list.split('\n');
                    let chunk = '';
                    for (let linea of lineas) {
                        if ((chunk.length + linea.length) > 3900) {
                            await bot.sendMessage(chatId, chunk, { parse_mode: 'Markdown' });
                            chunk = '';
                        }
                        chunk += linea + '\n';
                    }
                    if (chunk.trim()) await bot.sendMessage(chatId, chunk, { parse_mode: 'Markdown' });
                } else {
                    bot.sendMessage(chatId, list, { parse_mode: 'Markdown' });
                }
                return;
            }
            
            if (text === '📊 Estadísticas') {
                bot.sendMessage(chatId, '⏳ Recopilando datos del servidor...');
                
                const formatter = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Bogota', year: 'numeric', month: 'numeric', day: 'numeric' });
                const [month, day, year] = formatter.format(new Date()).split('/');
                const startOfDayTs = new Date(`${year}-${month}-${day}T00:00:00-05:00`).getTime();

                const usersSnap = await get(ref(db, `${dbPrefix}/users`));
                const productsSnap = await get(ref(db, `${dbPrefix}/products`));
                
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
                                if (h.date >= startOfDayTs) {
                                    todaySalesCount++;
                                    todaySalesUsd += price;
                                }
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

            if (text === '🎟️ Crear Cupón') {
                userStates[chatId] = { step: 'CREATE_COUPON_CODE', data: {} };
                return bot.sendMessage(chatId, '🎟️ *CREADOR DE CUPONES*\n\nEscribe la palabra o código promocional que los usuarios van a canjear (ej: Ofertazo20):', { parse_mode: 'Markdown' });
            }

            if (text === '🔨 Gest. Usuarios') {
                userStates[chatId] = { step: 'MANAGE_USER', data: {} };
                return bot.sendMessage(chatId, '🔨 Escribe el **Username** exacto del usuario que deseas gestionar (Banear/Desbanear o Ver):', { parse_mode: 'Markdown' });
            }

            if (text === '🛠️ Mantenimiento') {
                const settingsSnap = await get(ref(db, `${dbPrefix}/settings/maintenance`));
                const isMaint = settingsSnap.val() || false;
                const newMaint = !isMaint;
                
                await update(ref(db), { [`${dbPrefix}/settings/maintenance`]: newMaint });
                return bot.sendMessage(chatId, `🛠️ *MODO MANTENIMIENTO*\n\nEl acceso a la tienda y comandos para usuarios está: **${newMaint ? 'CERRADO (En Mantenimiento) 🔴' : 'ABIERTO (Normal) 🟢'}**`, { parse_mode: 'Markdown' });
            }

            if (text === '🗑️ Eliminar Producto') {
                const productsSnap = await get(ref(db, `${dbPrefix}/products`));
                if (!productsSnap.exists()) return bot.sendMessage(chatId, '❌ No hay productos creados.');
                
                let inlineKeyboard = [];
                productsSnap.forEach(child => {
                    inlineKeyboard.push([{ text: `❌ Eliminar: ${child.val().name}`, callback_data: `delprod|${child.key}` }]);
                });
                return bot.sendMessage(chatId, `🗑️ *ELIMINAR PRODUCTO*\nSelecciona el producto que deseas eliminar permanentemente:`, { parse_mode: 'Markdown', reply_markup: { inline_keyboard: inlineKeyboard } });
            }

            if (text === '📝 Editar Producto') {
                const productsSnap = await get(ref(db, `${dbPrefix}/products`));
                if (!productsSnap.exists()) return bot.sendMessage(chatId, '❌ No hay productos creados.');
                
                let inlineKeyboard = [];
                productsSnap.forEach(child => {
                    inlineKeyboard.push([{ text: `✏️ Editar: ${child.val().name}`, callback_data: `seledit|${child.key}` }]);
                });
                return bot.sendMessage(chatId, `📝 *EDITAR PRODUCTO*\nSelecciona el producto que deseas modificar:`, { parse_mode: 'Markdown', reply_markup: { inline_keyboard: inlineKeyboard } });
            }

            if (text === '⚙️ Ajustes Descargas') {
                const settingsSnap = await get(ref(db, `${dbPrefix}/settings/downloads_free`));
                const isFree = settingsSnap.val() || false;
                const newState = !isFree; 
                
                await update(ref(db), { [`${dbPrefix}/settings/downloads_free`]: newState });
                
                return bot.sendMessage(chatId, `✅ *AJUSTES DE DESCARGA*\n\nLas descargas para los usuarios están configuradas ahora como: **${newState ? 'GRATUITAS 🟢' : 'DE PAGA 🔴'}**`, { parse_mode: 'Markdown' });
            }
            
            if (text === '🔄 Revisar Reembolsos') {
                userStates[chatId] = { step: 'WAITING_FOR_REFUND_KEY', data: {} };
                return bot.sendMessage(chatId, '🔎 *SISTEMA DE REEMBOLSOS (Global)*\n\nPor favor, pega y envía la **Key** exacta que deseas buscar y reembolsar:', { parse_mode: 'Markdown' });
            }

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
                const productsSnap = await get(ref(db, `${dbPrefix}/products`));
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

        if (tgId !== ADMIN_ID) {
            const settingsSnap = await get(ref(db, `${dbPrefix}/settings`));
            const isMaintenance = settingsSnap.val()?.maintenance || false;
            const userSnap = await get(ref(db, `${dbPrefix}/users/${webUid}`));
            if (userSnap.val()?.banned || isMaintenance) return;
        }

        if (data.startsWith('cpntype|') && tgId === ADMIN_ID) {
            const type = data.split('|')[1] === 'bal' ? 'balance' : 'discount';
            userStates[chatId].data.type = type;
            userStates[chatId].step = 'CREATE_COUPON_VALUE';
            bot.editMessageText(type === 'balance' ? '💵 Escribe la cantidad en **USD** que dará este cupón (ej: 1.5):' : '📉 Escribe el **porcentaje de descuento** que dará este cupón (ej: 15 para un 15%):', { chat_id: chatId, message_id: query.message.message_id, parse_mode: 'Markdown' });
            return;
        }

        if (data.startsWith('toggleban|') && tgId === ADMIN_ID) {
            const targetUid = data.split('|')[1];
            const userSnap = await get(ref(db, `${dbPrefix}/users/${targetUid}`));
            if (userSnap.exists()) {
                const isBanned = userSnap.val().banned || false;
                await update(ref(db), { [`${dbPrefix}/users/${targetUid}/banned`]: !isBanned });
                bot.editMessageText(`✅ Estado actualizado. Usuario **${!isBanned ? 'Baneado 🔴' : 'Desbaneado 🟢'}**.`, { chat_id: chatId, message_id: query.message.message_id, parse_mode: 'Markdown' });
            }
            return;
        }

        if (data.startsWith('delprod|') && tgId === ADMIN_ID) {
            const prodId = data.split('|')[1];
            await remove(ref(db, `${dbPrefix}/products/${prodId}`));
            bot.editMessageText('✅ Producto eliminado exitosamente de la tienda.', { chat_id: chatId, message_id: query.message.message_id });
            return;
        }

        if (data.startsWith('seledit|') && tgId === ADMIN_ID) {
            const prodId = data.split('|')[1];
            const inlineKeyboard = [
                [{ text: '✏️ Cambiar Nombre', callback_data: `editp|name|${prodId}` }],
                [{ text: '💰 Cambiar Precio', callback_data: `editp|price|${prodId}` }],
                [{ text: '⏳ Cambiar Garantía', callback_data: `editp|warr|${prodId}` }]
            ];
            bot.editMessageText('⚙️ ¿Qué deseas editar de este producto?', { chat_id: chatId, message_id: query.message.message_id, reply_markup: { inline_keyboard: inlineKeyboard } });
            return;
        }

        if (data.startsWith('editp|') && tgId === ADMIN_ID) {
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

        if (data.startsWith('rfnd|') && tgId === ADMIN_ID) {
            const parts = data.split('|');
            const targetUid = parts[1];
            const histId = parts[2];

            bot.editMessageReplyMarkup({ inline_keyboard: [] }, { chat_id: chatId, message_id: query.message.message_id });

            const userSnap = await get(ref(db, `${dbPrefix}/users/${targetUid}`));
            if (userSnap.exists()) {
                const userData = userSnap.val();
                const compra = userData.history[histId];

                if (compra && !compra.refunded) {
                    const currentBal = parseFloat(userData.balance || 0);
                    const price = parseFloat(compra.price || 0);
                    const nuevoSaldo = currentBal + price;

                    const updates = {};
                    updates[`${dbPrefix}/users/${targetUid}/balance`] = nuevoSaldo;
                    updates[`${dbPrefix}/users/${targetUid}/history/${histId}/refunded`] = true; 

                    await update(ref(db), updates);

                    bot.sendMessage(chatId, `✅ *Reembolso completado.* Se devolvieron $${price} USD a la cuenta de ${userData.username}.`, { parse_mode: 'Markdown' });

                    const telegramAuthSnap = await get(ref(db, `${dbPrefix}/telegram_auth`));
                    let targetTgId = null;
                    if (telegramAuthSnap.exists()) {
                        telegramAuthSnap.forEach(child => {
                            if (child.val() === targetUid) targetTgId = child.key;
                        });
                    }

                    if (targetTgId) {
                        bot.sendMessage(targetTgId, `🔄 *REEMBOLSO APROBADO*\n\nSe te ha devuelto el dinero de la key de *${compra.product}*.\n💰 Se añadieron *$${price} USD* a tu saldo.\n💳 Nuevo saldo: *$${nuevoSaldo.toFixed(2)} USD*`, { parse_mode: 'Markdown' });
                    }

                } else {
                    bot.sendMessage(chatId, '❌ Hubo un error. La compra no existe o ya fue reembolsada.');
                }
            } else {
                bot.sendMessage(chatId, '❌ Usuario no encontrado en la base de datos.');
            }
            return;
        }

        if (data.startsWith('reject_refund|') && tgId === ADMIN_ID) {
            const targetTgId = data.split('|')[1];
            bot.editMessageReplyMarkup({ inline_keyboard: [] }, { chat_id: chatId, message_id: query.message.message_id });
            
            userStates[chatId] = { step: 'WAITING_FOR_REJECT_REASON', data: { targetTgId: targetTgId } };
            bot.sendMessage(chatId, '✍️ *Por favor, escribe el motivo* por el cual se rechaza este reembolso (este mensaje se le enviará al usuario):', { parse_mode: 'Markdown' });
            return;
        }

        if (data === 'cancel_refund' && tgId === ADMIN_ID) {
            bot.editMessageReplyMarkup({ inline_keyboard: [] }, { chat_id: chatId, message_id: query.message.message_id });
            return bot.sendMessage(chatId, '❌ Reembolso cancelado exitosamente.');
        }

        if (data.startsWith('send_receipt|')) {
            const amountRequest = parseFloat(data.split('|')[1]);
            const userSnap = await get(ref(db, `${dbPrefix}/users/${webUid}`));
            
            if (!userSnap.exists()) return bot.sendMessage(chatId, '❌ Error: No pudimos cargar tus datos.');
            
            const username = userSnap.val().username;
            
            userStates[chatId] = { step: 'WAITING_FOR_RECEIPT', data: { username: username, amount: amountRequest, webUid: webUid } };
            return bot.sendMessage(chatId, '📸 Por favor, envía la **foto de tu comprobante** de pago ahora mismo.\n\n_(Asegúrate de que la captura se vea clara)_', { parse_mode: 'Markdown' });
        }

        if (data.startsWith('ok_rech|') && tgId === ADMIN_ID) {
            const parts = data.split('|');
            const targetWebUid = parts[1];
            const amount = parseFloat(parts[2]);
            const targetTgId = parts[3];

            bot.editMessageReplyMarkup({ inline_keyboard: [] }, { chat_id: chatId, message_id: query.message.message_id });
            bot.sendMessage(chatId, '⚙️ Acreditando saldo al usuario...');

            const userSnap = await get(ref(db, `${dbPrefix}/users/${targetWebUid}`));
            if (userSnap.exists()) {
                const currentBal = parseFloat(userSnap.val().balance || 0);
                const nuevoSaldo = currentBal + amount;

                const updates = {};
                updates[`${dbPrefix}/users/${targetWebUid}/balance`] = nuevoSaldo;
                const rechRef = push(ref(db, `${dbPrefix}/users/${targetWebUid}/recharges`));
                updates[`${dbPrefix}/users/${targetWebUid}/recharges/${rechRef.key}`] = { amount: amount, date: Date.now() };

                await update(ref(db), updates);

                bot.sendMessage(chatId, `✅ Pago aprobado. Se añadieron $${amount} USD a ${userSnap.val().username}.`);
                bot.sendMessage(targetTgId, `🎉 *¡RECARGA APROBADA!*\n\nTu pago ha sido confirmado. Se han añadido *$${amount} USD* a tu cuenta.\n💰 Nuevo saldo: *$${nuevoSaldo.toFixed(2)} USD*`, { parse_mode: 'Markdown' });
            } else {
                bot.sendMessage(chatId, '❌ Hubo un error buscando al usuario en Firebase.');
            }
            return;
        }

        if (data.startsWith('no_rech|') && tgId === ADMIN_ID) {
            const targetTgId = data.split('|')[1];
            bot.editMessageReplyMarkup({ inline_keyboard: [] }, { chat_id: chatId, message_id: query.message.message_id });
            
            bot.sendMessage(chatId, '❌ Comprobante rechazado.');
            bot.sendMessage(targetTgId, '❌ *RECARGA RECHAZADA*\n\nTu comprobante no fue válido. Si crees que es un error, por favor contacta al soporte enviando un mensaje directo.', { parse_mode: 'Markdown' });
            return;
        }

        if (data.startsWith('stock|') && tgId === ADMIN_ID) {
            const prodId = data.split('|')[1];
            userStates[chatId] = { step: 'ADD_STOCK_KEYS', data: { prodId: prodId } };
            return bot.sendMessage(chatId, 'Pega todas las **Keys** ahora. Puedes separarlas por espacios, comas o saltos de línea:', { parse_mode: 'Markdown' });
        }

        if (data.startsWith('buy|')) {
            const productId = data.split('|')[1];
            bot.sendMessage(chatId, '⚙️ Procesando transacción...');

            const userSnap = await get(ref(db, `${dbPrefix}/users/${webUid}`));
            const prodSnap = await get(ref(db, `${dbPrefix}/products/${productId}`));
            
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
                updates[`${dbPrefix}/products/${productId}/keys/${firstKeyId}`] = null; 
                updates[`${dbPrefix}/users/${webUid}/balance`] = currentBalance - finalPrice; 
                
                if (activeDiscount > 0) {
                    updates[`${dbPrefix}/users/${webUid}/active_discount`] = null;
                }
                
                const historyRef = push(ref(db, `${dbPrefix}/users/${webUid}/history`));
                updates[`${dbPrefix}/users/${webUid}/history/${historyRef.key}`] = { 
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
                    bot.sendMessage(ADMIN_ID, `⚠️ *ALERTA DE STOCK BAJO*\n\nAl producto *${product.name}* le quedan solo **${keysRestantes}** keys disponibles.`, { parse_mode: 'Markdown' });
                }

            } else {
                bot.sendMessage(chatId, '❌ Producto agotado justo ahora.');
            }
        }
    });
}

console.log('🤖 SISTEMA MAESTRO LUCK XIT INICIADO CORRECTAMENTE...');
