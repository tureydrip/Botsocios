const TelegramBot = require('node-telegram-bot-api');
const { initializeApp } = require('firebase/app');
const { getDatabase, ref, get, update, push, set } = require('firebase/database');

// CONFIGURACIÓN
const token = '8275295427:AAFc-U21od7ZWdtQU-62U1mJOSJqFYFZ-IQ';
const bot = new TelegramBot(token, { polling: true });
const ADMIN_ID = 7710633235; 

// URL base de tu servidor Python (Asegúrate de que coincida con el puerto donde corre Flask)
const PYTHON_API_URL = 'http://localhost:8081';

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

// --- TECLADOS ACTUALIZADOS ---
const userKeyboard = {
    reply_markup: {
        keyboard: [
            [{ text: '🛒 Tienda' }, { text: '👤 Mi Perfil' }],
            [{ text: '💳 Recargas' }, { text: '🔄 Solicitar Reembolso' }],
            [{ text: '🎥 Descargar Video' }] // <-- NUEVO BOTÓN
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
            [{ text: '🔄 Revisar Reembolsos' }, { text: '⚙️ Ajustes Descargas' }], // <-- NUEVO BOTÓN ADMIN
            [{ text: '🎥 Descargar Video' }, { text: '❌ Cancelar Acción' }]
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
    if (!msg.text && !msg.photo) return;

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
        const stateData = userStates[chatId].data; 
        const username = stateData.username;
        const amount = stateData.amount;
        const targetWebUid = stateData.webUid;
        const fileId = msg.photo[msg.photo.length - 1].file_id; 
        
        const adminConfirmKeyboard = {
            inline_keyboard: [
                [{ text: '✅ Confirmar', callback_data: `ok_rech_${targetWebUid}_${amount}_${tgId}` }],
                [{ text: '❌ Rechazar', callback_data: `no_rech_${tgId}` }]
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

    if (!msg.text) return; 

    // --- FLUJOS DE ESTADO ---
    if (userStates[chatId]) {
        const state = userStates[chatId];

        // --- NUEVO: FLUJO PARA PROCESAR URL DE VIDEO ---
        if (state.step === 'WAITING_FOR_VIDEO_URL') {
            const url = text.trim();
            const isTikTok = url.includes('tiktok.com') || url.includes('vm.tiktok.com');
            const isYouTube = url.includes('youtube.com') || url.includes('youtu.be');

            if (!isTikTok && !isYouTube) {
                return bot.sendMessage(chatId, '❌ Enlace no válido. Por favor, envía un enlace válido de TikTok o YouTube.', keyboard);
            }

            bot.sendMessage(chatId, '⏳ Analizando enlace y verificando saldo...');

            try {
                // Verificar si la descarga es gratuita globalmente (Admin toggle)
                const settingsSnap = await get(ref(db, 'settings/downloads_free'));
                const isFree = settingsSnap.val() || false;
                
                let cost = 0;
                // Si NO es admin y NO está gratis la función, asignamos el precio
                if (tgId !== ADMIN_ID && !isFree) {
                    cost = isYouTube ? 0.10 : 0.05;
                }

                // Verificar saldo del usuario en Firebase
                const userSnap = await get(ref(db, `users/${webUid}`));
                const currentBal = parseFloat(userSnap.val().balance || 0);

                if (currentBal < cost) {
                    userStates[chatId] = null;
                    return bot.sendMessage(chatId, `❌ Saldo insuficiente. Necesitas $${cost} USD para esta descarga. Tu saldo es: $${currentBal.toFixed(2)} USD.`, keyboard);
                }

                // Parámetros para enviar al servidor Flask
                const params = new URLSearchParams();
                params.append('url', url);

                // 1. Obtener información previa (Para checar el límite de 20 min en YouTube)
                const previewRes = await fetch(`${PYTHON_API_URL}/preview`, { method: 'POST', body: params });
                const previewData = await previewRes.json();

                if (previewData.error) throw new Error(previewData.error);

                // Límite de YouTube a 20 minutos (1200 segundos)
                if (isYouTube && previewData.duration > 1200) {
                    userStates[chatId] = null;
                    return bot.sendMessage(chatId, '❌ El video de YouTube excede el límite permitido de 20 minutos.', keyboard);
                }

                // 2. Cobrar saldo si aplica antes de hacer la descarga pesada
                if (cost > 0) {
                    const nuevoSaldo = currentBal - cost;
                    await update(ref(db), { [`users/${webUid}/balance`]: nuevoSaldo });
                    bot.sendMessage(chatId, `💸 Se han descontado *$${cost} USD* de tu saldo. Iniciando descarga...`, { parse_mode: 'Markdown' });
                } else if (tgId === ADMIN_ID) {
                    bot.sendMessage(chatId, `👑 Admin supremo, descargando gratis...`);
                } else {
                    bot.sendMessage(chatId, `✨ Función gratuita activada. Iniciando descarga...`);
                }

                bot.sendMessage(chatId, '📥 Descargando archivo desde los servidores, esto tomará unos segundos...');

                // 3. Solicitar la descarga del archivo al servidor Python
                params.append('kind', 'video');
                const downloadRes = await fetch(`${PYTHON_API_URL}/download`, { method: 'POST', body: params });

                if (!downloadRes.ok) throw new Error("Error en el servidor de descargas (Python).");

                const arrayBuffer = await downloadRes.arrayBuffer();
                const buffer = Buffer.from(arrayBuffer);

                // 4. Enviar el video a Telegram
                await bot.sendVideo(chatId, buffer, { 
                    caption: `✅ *Video descargado exitosamente*\n\n🤖 *LUCK XIT OFC*`,
                    parse_mode: 'Markdown'
                });

                userStates[chatId] = null;

            } catch (error) {
                console.error("Error en descargas:", error);
                
                // Sistema de reembolso automático si falló el envío por peso u error del servidor
                let costToRefund = 0;
                if (tgId !== ADMIN_ID) {
                    const settingsSnap = await get(ref(db, 'settings/downloads_free'));
                    const isFree = settingsSnap.val() || false;
                    if (!isFree) costToRefund = isYouTube ? 0.10 : 0.05;
                }

                if (costToRefund > 0) {
                    const userSnap = await get(ref(db, `users/${webUid}`));
                    const currentBal = parseFloat(userSnap.val().balance || 0);
                    await update(ref(db), { [`users/${webUid}/balance`]: currentBal + costToRefund });
                    bot.sendMessage(chatId, '⚠️ Hubo un error al descargar o el video es muy pesado para Telegram (>50MB). **Tu saldo ha sido reembolsado automáticamente.**', keyboard);
                } else {
                    bot.sendMessage(chatId, '⚠️ Hubo un error al procesar el video o es demasiado pesado para enviarse por Telegram.', keyboard);
                }
                userStates[chatId] = null;
            }
            return;
        }

        // --- FLUJO PARA EL USUARIO SOLICITANDO REEMBOLSO ---
        if (state.step === 'WAITING_FOR_USER_REFUND_KEY') {
            const searchKey = text.trim();
            bot.sendMessage(chatId, '🔎 Verificando tu solicitud de reembolso...');

            const userUid = state.data.webUid;
            const userSnap = await get(ref(db, `users/${userUid}`));
            
            let found = false;
            let foundData = null;

            if (userSnap.exists()) {
                const userData = userSnap.val();
                if (userData.history) {
                    Object.keys(userData.history).forEach(histId => {
                        const compra = userData.history[histId];
                        if (compra.key === searchKey) {
                            found = true;
                            foundData = { uid: userUid, username: userData.username, histId: histId, compra: compra, targetTgId: tgId };
                        }
                    });
                }
            }

            if (found) {
                if (foundData.compra.refunded) {
                    bot.sendMessage(chatId, '⚠️ *Esta Key ya fue reembolsada anteriormente.*', { parse_mode: 'Markdown' });
                } else {
                    const dateStr = new Date(foundData.compra.date).toLocaleString('es-CO');
                    
                    const msgInfo = `🔔 *NUEVA SOLICITUD DE REEMBOLSO (USUARIO)*\n\n` +
                                `👤 *Usuario:* ${foundData.username}\n` +
                                `📦 *Producto:* ${foundData.compra.product}\n` +
                                `🔑 *Key:* \`${foundData.compra.key}\`\n` +
                                `💰 *Costo pagado:* $${parseFloat(foundData.compra.price).toFixed(2)} USD\n` +
                                `📅 *Fecha:* ${dateStr}\n\n` +
                                `¿Deseas aprobar la solicitud y devolver el dinero?`;

                    const refundKeyboard = {
                        inline_keyboard: [
                            [{ text: '✅ Mandar Reembolso', callback_data: `rfnd_${foundData.uid}_${foundData.histId}` }],
                            [{ text: '❌ Rechazar Solicitud', callback_data: `reject_refund_${foundData.targetTgId}` }]
                        ]
                    };
                    
                    bot.sendMessage(ADMIN_ID, msgInfo, { parse_mode: 'Markdown', reply_markup: refundKeyboard });
                    bot.sendMessage(chatId, '✅ Tu solicitud de reembolso ha sido enviada al administrador exitosamente. Recibirás una notificación cuando sea revisada.', keyboard);
                }
            } else {
                bot.sendMessage(chatId, '❌ No se encontró esta Key en tu historial de compras. Verifica que la hayas escrito correctamente e intenta de nuevo.', keyboard);
            }
            userStates[chatId] = null;
            return;
        }

        // FLUJO: BUSCAR LA KEY MANUALMENTE (ADMIN)
        if (state.step === 'WAITING_FOR_REFUND_KEY') {
            const searchKey = text.trim();
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
                            [{ text: '✅ Mandar Reembolso', callback_data: `rfnd_${foundData.uid}_${foundData.histId}` }],
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

        // FLUJO: USUARIO ESCRIBE CUÁNTO QUIERE RECARGAR
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
                    [{ text: '📸 Enviar por Aquí (Telegram)', callback_data: `send_receipt_${amountUsd}` }]
                ] 
            };

            userStates[chatId] = null; 
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

        // FLUJO: AÑADIR SALDO MANUAL (ADMIN)
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
                    bot.sendMessage(targetTgId, `🎉 tu papá luck xit te puso : $${amount} USD de saldo. Nuevo saldo: $${nuevoSaldo.toFixed(2)} USD`);
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

    // --- NUEVO: BOTÓN DE DESCARGAR VIDEO ---
    if (text === '🎥 Descargar Video') {
        userStates[chatId] = { step: 'WAITING_FOR_VIDEO_URL', data: { webUid: webUid } };
        return bot.sendMessage(chatId, '🎥 *DESCARGADOR LUCK XIT*\n\nEnvía el enlace del video de **TikTok** o **YouTube** que deseas descargar.\n\n💸 *Costos:*\n- YouTube (Max 20 min): $0.10 USD\n- TikTok: $0.05 USD\n\n_(Para cancelar, escribe cualquier comando o presiona tu perfil)_', { parse_mode: 'Markdown' });
    }

    if (text === '🔄 Solicitar Reembolso') {
        userStates[chatId] = { step: 'WAITING_FOR_USER_REFUND_KEY', data: { webUid: webUid } };
        return bot.sendMessage(chatId, '🔄 *SOLICITUD DE REEMBOLSO*\n\nPor favor, escribe y envía la **Key** exacta de la compra que deseas que te reembolsemos:', { parse_mode: 'Markdown' });
    }

    if (text === '👤 Mi Perfil') {
        const userSnap = await get(ref(db, `users/${webUid}`));
        const user = userSnap.val();
        return bot.sendMessage(chatId, `👤 *PERFIL LUCK XIT*\n\nUsuario: ${user.username}\n💰 Saldo: *$${parseFloat(user.balance).toFixed(2)} USD*`, { parse_mode: 'Markdown' });
    }

    if (text === '💳 Recargas') {
        const userSnap = await get(ref(db, `users/${webUid}`));
        const userData = userSnap.val();

        let totalRecharged = 0;
        if (userData.recharges) {
            Object.values(userData.recharges).forEach(r => {
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

        // --- NUEVO: ALTERNAR FUNCIONES DE DESCARGA (PAGA/GRATIS) ---
        if (text === '⚙️ Ajustes Descargas') {
            const settingsSnap = await get(ref(db, 'settings/downloads_free'));
            const isFree = settingsSnap.val() || false;
            const newState = !isFree; // Invierte el valor actual
            
            await update(ref(db), { 'settings/downloads_free': newState });
            
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

    if (data.startsWith('rfnd_') && tgId === ADMIN_ID) {
        const parts = data.split('_');
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

            } else {
                bot.sendMessage(chatId, '❌ Hubo un error. La compra no existe o ya fue reembolsada.');
            }
        } else {
            bot.sendMessage(chatId, '❌ Usuario no encontrado en la base de datos.');
        }
        return;
    }

    if (data.startsWith('reject_refund_') && tgId === ADMIN_ID) {
        const targetTgId = data.split('_')[2];
        bot.editMessageReplyMarkup({ inline_keyboard: [] }, { chat_id: chatId, message_id: query.message.message_id });
        
        bot.sendMessage(chatId, '❌ Solicitud de reembolso rechazada.');
        bot.sendMessage(targetTgId, '❌ *SOLICITUD RECHAZADA*\n\nTu solicitud de reembolso para esa Key no fue aprobada por el administrador. Contacta a soporte si crees que es un error.', { parse_mode: 'Markdown' });
        return;
    }

    if (data === 'cancel_refund' && tgId === ADMIN_ID) {
        bot.editMessageReplyMarkup({ inline_keyboard: [] }, { chat_id: chatId, message_id: query.message.message_id });
        return bot.sendMessage(chatId, '❌ Reembolso cancelado exitosamente.');
    }

    if (data.startsWith('send_receipt_')) {
        const amountRequest = parseFloat(data.split('_')[2]);
        const userSnap = await get(ref(db, `users/${webUid}`));
        const username = userSnap.val().username;
        
        userStates[chatId] = { step: 'WAITING_FOR_RECEIPT', data: { username: username, amount: amountRequest, webUid: webUid } };
        return bot.sendMessage(chatId, '📸 Por favor, envía la **foto de tu comprobante** de pago ahora mismo.\n\n_(Asegúrate de que la captura se vea clara)_', { parse_mode: 'Markdown' });
    }

    if (data.startsWith('ok_rech_') && tgId === ADMIN_ID) {
        const parts = data.split('_');
        const targetWebUid = parts[2];
        const amount = parseFloat(parts[3]);
        const targetTgId = parts[4];

        bot.editMessageReplyMarkup({ inline_keyboard: [] }, { chat_id: chatId, message_id: query.message.message_id });
        bot.sendMessage(chatId, '⚙️ Acreditando saldo al usuario...');

        const userSnap = await get(ref(db, `users/${targetWebUid}`));
        if (userSnap.exists()) {
            const currentBal = parseFloat(userSnap.val().balance || 0);
            const nuevoSaldo = currentBal + amount;

            const updates = {};
            updates[`users/${targetWebUid}/balance`] = nuevoSaldo;
            const rechRef = push(ref(db, `users/${targetWebUid}/recharges`));
            updates[`users/${targetWebUid}/recharges/${rechRef.key}`] = { amount: amount, date: Date.now() };

            await update(ref(db), updates);

            bot.sendMessage(chatId, `✅ Pago aprobado. Se añadieron $${amount} USD a ${userSnap.val().username}.`);
            bot.sendMessage(targetTgId, `🎉 *¡RECARGA APROBADA!*\n\nTu pago ha sido confirmado. Se han añadido *$${amount} USD* a tu cuenta.\n💰 Nuevo saldo: *$${nuevoSaldo.toFixed(2)} USD*`, { parse_mode: 'Markdown' });
        } else {
            bot.sendMessage(chatId, '❌ Hubo un error buscando al usuario en Firebase.');
        }
        return;
    }

    if (data.startsWith('no_rech_') && tgId === ADMIN_ID) {
        const targetTgId = data.split('_')[2];
        bot.editMessageReplyMarkup({ inline_keyboard: [] }, { chat_id: chatId, message_id: query.message.message_id });
        
        bot.sendMessage(chatId, '❌ Comprobante rechazado.');
        bot.sendMessage(targetTgId, '❌ *RECARGA RECHAZADA*\n\nTu comprobante no fue válido. Si crees que es un error, por favor contacta al soporte enviando un mensaje directo.', { parse_mode: 'Markdown' });
        return;
    }

    if (data.startsWith('stock_') && tgId === ADMIN_ID) {
        const prodId = data.split('_')[1];
        userStates[chatId] = { step: 'ADD_STOCK_KEYS', data: { prodId: prodId } };
        return bot.sendMessage(chatId, 'Pega todas las **Keys** ahora. Puedes separarlas por espacios, comas o saltos de línea:', { parse_mode: 'Markdown' });
    }

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
            updates[`users/${webUid}/history/${historyRef.key}`] = { product: product.name, key: keyToDeliver, price: product.price, date: Date.now(), refunded: false }; 

            await update(ref(db), updates);
            bot.sendMessage(chatId, `✅ *¡COMPRA EXITOSA!*\n\nTu Key es:\n\n\`${keyToDeliver}\``, { parse_mode: 'Markdown' });
        } else {
            bot.sendMessage(chatId, '❌ Producto agotado justo ahora.');
        }
    }
});

console.log('🤖 Bot sincronizado e interactivo iniciado...');
