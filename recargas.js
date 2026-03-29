const { ref, get, update, push } = require('firebase/database');

module.exports = {
    iniciarRecarga: async (bot, chatId, webUser, userStates) => {
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
    },

    procesarMonto: (bot, chatId, text, minUsd, userStates) => {
        const amountUsd = parseFloat(text.replace(',', '.').replace('$', ''));

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
    },

    solicitarComprobante: async (bot, db, chatId, webUid, amountRequest, userStates) => {
        const userSnap = await get(ref(db, `users/${webUid}`));
        if (!userSnap.exists()) return bot.sendMessage(chatId, '❌ Error: No pudimos cargar tus datos.');
        
        const username = userSnap.val().username;
        userStates[chatId] = { step: 'WAITING_FOR_RECEIPT', data: { username: username, amount: amountRequest, webUid: webUid } };
        return bot.sendMessage(chatId, '📸 Por favor, envía la **foto de tu comprobante** de pago ahora mismo.\n\n_(Asegúrate de que la captura se vea clara)_', { parse_mode: 'Markdown' });
    },

    recibirFotoComprobante: (bot, chatId, tgId, fileId, stateData, keyboard, superAdminId, userStates) => {
        const adminConfirmKeyboard = {
            inline_keyboard: [
                [{ text: '✅ Confirmar', callback_data: `ok_rech|${stateData.webUid}|${stateData.amount}|${tgId}` }],
                [{ text: '❌ Rechazar', callback_data: `no_rech|${tgId}` }]
            ]
        };

        bot.sendPhoto(superAdminId, fileId, {
            caption: `💳 *NUEVO COMPROBANTE DE PAGO*\n\n👤 Usuario: ${stateData.username}\n🆔 ID Telegram: \`${tgId}\`\n💰 Monto Solicitado: *$${stateData.amount} USD*`,
            parse_mode: 'Markdown',
            reply_markup: adminConfirmKeyboard 
        });
        
        userStates[chatId] = null; 
        return bot.sendMessage(chatId, '✅ Comprobante enviado exitosamente a los administradores. Por favor espera a que se valide.', keyboard);
    },

    aprobarRecarga: async (bot, db, chatId, queryMessageId, targetWebUid, amount, targetTgId, adminUsername, tgId, notifySuperAdmin) => {
        bot.editMessageReplyMarkup({ inline_keyboard: [] }, { chat_id: chatId, message_id: queryMessageId });
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
            
            notifySuperAdmin(adminUsername, tgId, 'Aprobó Recarga', `Acreditó $${amount} USD a la cuenta de ${userSnap.val().username}`);
        } else {
            bot.sendMessage(chatId, '❌ Hubo un error buscando al usuario en Firebase.');
        }
    },

    rechazarRecarga: (bot, chatId, queryMessageId, targetTgId, adminUsername, tgId, notifySuperAdmin) => {
        bot.editMessageReplyMarkup({ inline_keyboard: [] }, { chat_id: chatId, message_id: queryMessageId });
        bot.sendMessage(chatId, '❌ Comprobante rechazado.');
        bot.sendMessage(targetTgId, '❌ *RECARGA RECHAZADA*\n\nTu comprobante no fue válido. Si crees que es un error, por favor contacta al soporte enviando un mensaje directo.', { parse_mode: 'Markdown' });
        
        notifySuperAdmin(adminUsername, tgId, 'Rechazó Recarga', `Comprobante rechazado para el Telegram ID: ${targetTgId}`);
    }
};
