const { ref, get, update, push, set, remove } = require('firebase/database');

const PaisesConfig = {
    "AR": { flag: "🇦🇷", name: "Argentina", rate: 1500, currency: "ARS", methods: "🔵 *Uala* (🏦 TRANSFERENCIA)\n📋 CVU: `0000184305010007732302` | Alias: `cescorrea1`\n💡 Transferencia UALA." },
    "BO": { flag: "🇧🇴", name: "Bolivia", rate: 16, currency: "Bs", methods: "💜 *Yape* (💵 EFECTIVO)\n📋 N° Cuenta: `62656932`\n💡 Banca Electrónica Yape \n\n📱 *Yape QR* (💵 EFECTIVO)\n📋 Código QR disponible arriba\n💡 Escanea el código QR de Yape: [Ver QR](https://i.ibb.co/W4gZw351/qrbolivia.jpg)\n\n🔷 *BCP* (🏦 TRANSFERENCIA)\n📋 N° Cuenta: `20152008832355`\n💡 Cuenta Ahorros BCP" },
    "BR": { flag: "🇧🇷", name: "Brasil", rate: 5.20, currency: "BRL", methods: "🟢 *PIX* (🏦 TRANSFERENCIA)\n📋 Chave PIX: `91991076791`\n💡 Transferência instantânea PIX" },
    "CL": { flag: "🇨🇱", name: "Chile", rate: 950, currency: "CLP", methods: "🏪 *Banco Estado (Caja Vecina)* (💵 EFECTIVO)\n📋 Titular: XAVIER FUENZALIDA | RUT: `23.710.151-0` | CuentaRUT: `23710151`\n💡 CAJA VECINA - Depósito en efectivo\n\n🟢 *Banco Estado (Transferencia)* (🏦 TRANSFERENCIA)\n📋 Titular: XAVIER FUENZALIDA | RUT: `23.710.151-0` | CuentaRUT: `23710151`\n💡 TRANSFERENCIA BANCARIA" },
    "CO": { flag: "🇨🇴", name: "Colombia", rate: 3800, currency: "COP", methods: "🟡 *Bancolombia* (🏦 TRANSFERENCIA)\n📋 N° Cuenta: `76900007797`\n💡 Transferencia Ahorros Bancolombia\n\n🔵 *Nequi* (💵 EFECTIVO)\n📋 Nequi: `3214701288`\n💡 Envía dinero por Nequi\n\n🟣 *Nu Bank* (🏦 TRANSFERENCIA)\n📋 Llave Nu: `@PMG3555`\n💡 Transferencia Nu Bank" },
    "CR": { flag: "🇨🇷", name: "Costa Rica", rate: 520, currency: "CRC", methods: "📱 *SINPE Móvil* (💵 EFECTIVO)\n📋 SINPE Móvil: `72805302`\n💡 Pago móvil SINPE" },
    "EC": { flag: "🇪🇨", name: "Ecuador", rate: 1, currency: "USD", methods: "🟨 *Banco Pichincha* (🏦 TRANSFERENCIA)\n📋 N° Cuenta: `2207195565`\n💡 Transferencia Cuenta Ahorro Pichincha" },
    "ES": { flag: "🇪🇸", name: "España", rate: 1, currency: "EUR", methods: "💶 *Bizum* (🏦 TRANSFERENCIA)\n📋 Número: `637070926` | Nombre: Xiomari Moreno\n💡 Pago por Bizum" },
    "US": { flag: "🇺🇸", name: "Estados Unidos", rate: 1, currency: "USD", methods: "💎 *ZELLE* (💵 EFECTIVO)\n📋 Número: `+18046307411`\n💡 Banca Electrónica Zelle" },
    "GT": { flag: "🇬🇹", name: "Guatemala", rate: 7.8, currency: "GTQ", methods: "🟩 *Banrural* (🏦 TRANSFERENCIA)\n📋 N° Cuenta: `4431164091`\n💡 Transferencia Banrural" },
    "HN": { flag: "🇭🇳", name: "Honduras", rate: 25, currency: "HNL", methods: "🔵 *Bampais* (🏦 TRANSFERENCIA)\n📋 N° Cuenta: `216400100524`\n💡 Transferencia Cuenta Ahorros Bampais" },
    "MX": { flag: "🇲🇽", name: "México", rate: 20, currency: "MXN", methods: "🏦 *Albo* (🏦 TRANSFERENCIA)\n📋 N° Cuenta: `721180100042683432`\n💡 SOLO TRANSFERENCIAS\n\n🏪 *Nu México (OXXO)* (💵 EFECTIVO)\n📋 `5101250686919389`\n💡 SOLO DEPOSITOS OXXO" },
    "NI": { flag: "🇳🇮", name: "Nicaragua", rate: 36.50, currency: "NIO", methods: "🏦 *BAC Nicaragua* (🏦 TRANSFERENCIA)\n📋 N° Cuenta: `371674409` | IBAN: `NI37BAMC00000000000371674409`\n💡 Transferencia Bancaria BAC (Tasa P2P Binance)" },
    "PA": { flag: "🇵🇦", name: "Panamá", rate: 1, currency: "USD", methods: "🟠 *Punto Pago Wally* (💵 EFECTIVO)\n📋 N° Cuenta: `+584128975265`\n💡 Banca Electrónica Punto Pago Wally\n\n🟣 *Zinli* (💵 EFECTIVO)\n📋 Correo: `chauran2001@gmail.com`\n💡 Banca Electrónica Zinli" },
    "PY": { flag: "🇵🇾", name: "Paraguay", rate: 7300, currency: "PYG", methods: "🏦 *Banco Itau* (🏦 TRANSFERENCIA)\n📋 N° Cuenta: `300406285` | Titular: DIEGO ARMANDO LEIVA ROA\n💡 Transferencia Bancaria Itau\n\n💳 *Billetera Personal* (💵 EFECTIVO)\n📋 Billetera Personal: `0993363424`\n💡 Transferencia a Billetera Personal" },
    "PE": { flag: "🇵🇪", name: "Perú", rate: 3.3, currency: "PEN", methods: "🟣 *Yape* (💵 EFECTIVO)\n📋 N° Cuenta: `954302258`\n💡 Banca Electrónica Yape\n\n🔵 *Plin* (💵 EFECTIVO)\n📋 N° Cuenta: `954302258`\n💡 Banca Electrónica Plin" },
    "DO": { flag: "🇩🇴", name: "Rep. Dominicana", rate: 62, currency: "DOP", methods: "🟦 *Banreservas* (🏦 TRANSFERENCIA)\n📋 N° Cuenta: `9601546622`\n💡 Transferencia Cuenta Ahorro Banreservas\n\n🔴 *Banco Popular* (🏦 TRANSFERENCIA)\n📋 N° Cuenta: `837147719`\n💡 Transferencia Cuenta Ahorro Popular\n\n🟨 *BHD León* (🏦 TRANSFERENCIA)\n📋 N° Cuenta: `34478720012`\n💡 Transferencia BHD León\n\n🟢 *Qik* (💵 EFECTIVO)\n📋 N° Cuenta: `1002173707`\n💡 Pago móvil Qik" },
    "VE": { flag: "🇻🇪", name: "Venezuela", rate: 650, currency: "VES", methods: "🟡 *Pago Móvil* (💵 EFECTIVO)\n📋 Pago móvil: `0102 04128975265 31303430`\n💡 Pago móvil interbancario (Dólar a Binance)" }
};

// --- ESCÁNER DE REFERIDOS INTEGRADO EN RECARGAS ---
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
                    tgAuthSnap.forEach(child => { if (child.val() === inviterUid) inviterTgId = child.key; });
                    
                    if (inviterTgId) {
                        bot.sendMessage(inviterTgId, `🎉 *¡BONO DE REFERIDO!*\n\nTu referido *${user.username}* acaba de realizar su primera recarga de $5 USD o más.\n🎁 Acabas de recibir *$2.00 USD* de saldo gratis.\n💰 Tu nuevo saldo es: *$${(inviterBal + 2).toFixed(2)} USD*`, { parse_mode: 'Markdown' }).catch(()=>{});
                    }
                }
            }
        }
    }
}
// --------------------------------------------------

module.exports = {
    iniciarRecarga: async (bot, db, chatId, webUser, userStates) => {
        let totalRecharged = 0;
        if (webUser.recharges) {
            Object.values(webUser.recharges).forEach(r => { totalRecharged += parseFloat(r.amount || 0); });
        }
        
        const minUsd = 3;
        const configSnap = await get(ref(db, 'config/paises_desactivados'));
        const desactivados = configSnap.exists() ? configSnap.val() : {};

        let keyboard = []; let row = [];
        Object.keys(PaisesConfig).forEach(code => {
            if (!desactivados[code]) {
                const p = PaisesConfig[code];
                row.push({ text: `${p.flag} ${p.name}`, callback_data: `sel_pais|${code}` });
                if (row.length === 2) { keyboard.push(row); row = []; }
            }
        });
        if (row.length > 0) keyboard.push(row);

        if (keyboard.length === 0) return bot.sendMessage(chatId, '❌ En este momento no hay métodos de pago habilitados.');

        userStates[chatId] = { step: 'WAITING_FOR_COUNTRY', data: { minUsd: minUsd, totalRecharged: totalRecharged } };
        return bot.sendMessage(chatId, `💳 *NUEVA RECARGA*\n\n📈 *Total recargado por ti:* $${totalRecharged.toFixed(2)} USD\n✅ *Tu recarga mínima es de:* *$${minUsd} USD*\n\n🌍 *Por favor, selecciona tu país de pago:*`, { parse_mode: 'Markdown', reply_markup: { inline_keyboard: keyboard } });
    },

    seleccionarPais: (bot, chatId, countryCode, stateData, userStates) => {
        const pais = PaisesConfig[countryCode];
        if (!pais) return bot.sendMessage(chatId, '❌ País no válido.');

        userStates[chatId] = { step: 'WAITING_FOR_RECHARGE_AMOUNT', data: { minUsd: stateData.minUsd, countryCode: countryCode } };
        const mensaje = `🌍 *País seleccionado:* ${pais.flag} ${pais.name}\n💵 *Tasa de Cambio:* $1 USD = $${pais.rate.toLocaleString('es-CO')} ${pais.currency}\n\n👇 *Escribe la cantidad en USD* que deseas recargar:\n_(Escribe solo el número, por ejemplo: ${stateData.minUsd} o 5.5)_`;
        return bot.sendMessage(chatId, mensaje, { parse_mode: 'Markdown' });
    },

    procesarMonto: (bot, chatId, text, stateData, userStates) => {
        const amountUsd = parseFloat(text.replace(',', '.').replace('$', ''));
        const { minUsd, countryCode } = stateData;
        const pais = PaisesConfig[countryCode];

        if (isNaN(amountUsd)) return bot.sendMessage(chatId, '❌ Cantidad inválida. Por favor, escribe **solo el número**.', { parse_mode: 'Markdown' });
        if (amountUsd < minUsd) return bot.sendMessage(chatId, `❌ El monto mínimo es de *$${minUsd} USD*.`, { parse_mode: 'Markdown' });

        const amountLocal = amountUsd * pais.rate;
        const mensajePago = `✅ *MONTO CALCULADO CON ÉXITO*\n\n💰 Vas a recargar: *$${amountUsd.toFixed(2)} USD*\n🌍 *País:* ${pais.flag} ${pais.name}\n💸 *Monto a pagar:* *$${amountLocal.toLocaleString('es-CO')} ${pais.currency}* (Dólar a ${pais.rate} ${pais.currency})\n\n💳 *MÉTODOS DE PAGO DISPONIBLES:*\n\n${pais.methods}\n\n_(Toca cualquier número de cuenta o ID arriba para copiarlo automáticamente)_\n\n🏦 *PASOS PARA FINALIZAR:*\n1. Realiza el pago exacto.\n2. Selecciona por dónde quieres enviar tu comprobante abajo:`;

        const rechargeInline = { 
            inline_keyboard: [
                [{ text: '💬 Enviar por WhatsApp', url: 'https://wa.me/573142369516' }],
                [{ text: '📸 Enviar por Aquí (Telegram)', callback_data: `send_receipt|${amountUsd}|${countryCode}` }] 
            ] 
        };

        userStates[chatId] = null; 
        return bot.sendMessage(chatId, mensajePago, { parse_mode: 'Markdown', reply_markup: rechargeInline });
    },

    menuPaisesAdmin: async (bot, db, chatId) => {
        const configSnap = await get(ref(db, 'config/paises_desactivados'));
        const desactivados = configSnap.exists() ? configSnap.val() : {};

        let keyboard = [];
        Object.keys(PaisesConfig).forEach(code => {
            const status = desactivados[code] ? '❌' : '✅';
            keyboard.push([{ text: `${status} ${PaisesConfig[code].flag} ${PaisesConfig[code].name}`, callback_data: `toggle_pais|${code}` }]);
        });

        return bot.sendMessage(chatId, '⚙️ *ADMIN: Activar/Desactivar Países*\nToca un país para cambiar su estado (✅ Activo / ❌ Desactivado):', { parse_mode: 'Markdown', reply_markup: { inline_keyboard: keyboard } });
    },

    togglePaisAdmin: async (bot, db, chatId, messageId, countryCode) => {
        const refPais = ref(db, `config/paises_desactivados/${countryCode}`);
        const snap = await get(refPais);
        
        if (snap.exists() && snap.val() === true) { await set(refPais, null); } 
        else { await set(refPais, true); }

        const configSnap = await get(ref(db, 'config/paises_desactivados'));
        const desactivados = configSnap.exists() ? configSnap.val() : {};

        let keyboard = [];
        Object.keys(PaisesConfig).forEach(code => {
            const status = desactivados[code] ? '❌' : '✅';
            keyboard.push([{ text: `${status} ${PaisesConfig[code].flag} ${PaisesConfig[code].name}`, callback_data: `toggle_pais|${code}` }]);
        });

        bot.editMessageReplyMarkup({ inline_keyboard: keyboard }, { chat_id: chatId, message_id: messageId });
    },

    solicitarComprobante: async (bot, db, chatId, webUid, amountRequest, countryCode, userStates) => {
        const userSnap = await get(ref(db, `users/${webUid}`));
        if (!userSnap.exists()) return bot.sendMessage(chatId, '❌ Error: No pudimos cargar tus datos.');
        
        const pais = PaisesConfig[countryCode];
        const localAmount = amountRequest * pais.rate;
        const username = userSnap.val().username;

        userStates[chatId] = { 
            step: 'WAITING_FOR_RECEIPT', 
            data: { username: username, amount: amountRequest, webUid: webUid, countryName: pais.name, localAmount: localAmount, currency: pais.currency } 
        };
        
        return bot.sendMessage(chatId, '📸 Por favor, envía la **foto de tu comprobante** de pago ahora mismo.\n\n_(Asegúrate de que la captura se vea clara)_', { parse_mode: 'Markdown' });
    },

    recibirFotoComprobante: async (bot, db, chatId, tgId, fileId, stateData, keyboard, superAdminId, userStates) => {
        const receiptRef = push(ref(db, 'pending_receipts'));
        const receiptId = receiptRef.key;

        await set(receiptRef, {
            webUid: stateData.webUid,
            amount: stateData.amount,
            tgId: tgId,
            username: stateData.username
        });

        const adminConfirmKeyboard = {
            inline_keyboard: [
                [{ text: '✅ Confirmar', callback_data: `ok_rech|${receiptId}` }],
                [{ text: '❌ Rechazar', callback_data: `no_rech|${receiptId}` }]
            ]
        };

        const captionMsg = `💳 *NUEVO COMPROBANTE DE PAGO*\n\n` +
                           `👤 Usuario: ${stateData.username}\n` +
                           `🆔 ID Telegram: \`${tgId}\`\n` +
                           `💰 Monto Solicitado: *$${stateData.amount} USD*\n` +
                           `🌍 País de Pago: *${stateData.countryName}*\n` +
                           `💸 Monto Pagado Local: *$${stateData.localAmount.toLocaleString('es-CO')} ${stateData.currency}*`;

        bot.sendPhoto(superAdminId, fileId, { caption: captionMsg, parse_mode: 'Markdown', reply_markup: adminConfirmKeyboard }).catch(()=>{});

        const adminsSnap = await get(ref(db, 'admins'));
        if (adminsSnap.exists()) {
            adminsSnap.forEach(child => {
                const adminId = child.key;
                const perms = child.val().perms || {};
                if (perms.balance && adminId !== superAdminId.toString()) {
                    bot.sendPhoto(adminId, fileId, { caption: captionMsg, parse_mode: 'Markdown', reply_markup: adminConfirmKeyboard }).catch(()=>{});
                }
            });
        }
        
        userStates[chatId] = null; 
        return bot.sendMessage(chatId, '✅ Comprobante enviado exitosamente a los administradores. Por favor espera a que se valide.', keyboard);
    },

    aprobarRecarga: async (bot, db, chatId, queryMessageId, receiptId, adminUsername, adminTgId, notifySuperAdmin) => {
        bot.editMessageReplyMarkup({ inline_keyboard: [] }, { chat_id: chatId, message_id: queryMessageId });
        
        const receiptSnap = await get(ref(db, `pending_receipts/${receiptId}`));
        if (!receiptSnap.exists()) {
            return bot.sendMessage(chatId, '⚠️ Este comprobante ya fue procesado (aprobado o rechazado) por otro administrador.');
        }

        const data = receiptSnap.val();
        const targetWebUid = data.webUid;
        const amount = data.amount;
        const targetTgId = data.tgId;

        await remove(ref(db, `pending_receipts/${receiptId}`));

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
            
            notifySuperAdmin(adminUsername, adminTgId, 'Aprobó Recarga', `Acreditó $${amount} USD a la cuenta de ${userSnap.val().username}`);

            // === AQUI SE DISPARA LA RECOMPENSA SI ES SU PRIMERA RECARGA (O ACUMULADA) DE $5 ===
            await verificarBonoReferido(db, bot, targetWebUid, amount);

        } else {
            bot.sendMessage(chatId, '❌ Hubo un error buscando al usuario en Firebase.');
        }
    },

    rechazarRecarga: async (bot, db, chatId, queryMessageId, receiptId, adminUsername, adminTgId, notifySuperAdmin) => {
        bot.editMessageReplyMarkup({ inline_keyboard: [] }, { chat_id: chatId, message_id: queryMessageId });

        const receiptSnap = await get(ref(db, `pending_receipts/${receiptId}`));
        if (!receiptSnap.exists()) {
            return bot.sendMessage(chatId, '⚠️ Este comprobante ya fue procesado por otro administrador.');
        }

        const targetTgId = receiptSnap.val().tgId;
        await remove(ref(db, `pending_receipts/${receiptId}`));

        bot.sendMessage(chatId, '❌ Comprobante rechazado.');
        bot.sendMessage(targetTgId, '❌ *RECARGA RECHAZADA*\n\nTu comprobante no fue válido. Si crees que es un error, por favor contacta al soporte enviando un mensaje directo.', { parse_mode: 'Markdown' });
        
        notifySuperAdmin(adminUsername, adminTgId, 'Rechazó Recarga', `Comprobante rechazado para el Telegram ID: ${targetTgId}`);
    }
};
