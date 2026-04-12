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
                    if (inviterTgId) bot.sendMessage(inviterTgId, `🎉 *¡BONO DE REFERIDO!*\n🎁 Recibiste *$2.00 USD* gratis.`, { parse_mode: 'Markdown' }).catch(()=>{});
                }
            }
        }
    }
}

module.exports = {
    verificarBonoReferido,
    iniciarRecarga: async (bot, db, chatId, webUser, userStates) => {
        let totalRecharged = 0;
        if (webUser.recharges) Object.values(webUser.recharges).forEach(r => { totalRecharged += parseFloat(r.amount || 0); });
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
        userStates[chatId] = { step: 'WAITING_FOR_COUNTRY', data: { minUsd: minUsd, totalRecharged: totalRecharged } };
        return bot.sendMessage(chatId, `💳 *NUEVA RECARGA*\n\n🌍 *Selecciona tu país de pago:*`, { parse_mode: 'Markdown', reply_markup: { inline_keyboard: keyboard } });
    },
    seleccionarPais: (bot, chatId, countryCode, stateData, userStates) => {
        const pais = PaisesConfig[countryCode];
        userStates[chatId] = { step: 'WAITING_FOR_RECHARGE_AMOUNT', data: { minUsd: stateData.minUsd, countryCode: countryCode } };
        return bot.sendMessage(chatId, `💵 Tasa: $1 USD = $${pais.rate.toLocaleString('es-CO')} ${pais.currency}\n\nEscribe la cantidad en USD:`, { parse_mode: 'Markdown' });
    },
    procesarMonto: (bot, chatId, text, stateData, userStates) => {
        const amountUsd = parseFloat(text.replace(',', '.'));
        const pais = PaisesConfig[stateData.countryCode];
        if (isNaN(amountUsd) || amountUsd < stateData.minUsd) return bot.sendMessage(chatId, `❌ Monto mínimo: $${stateData.minUsd}`);
        const amountLocal = amountUsd * pais.rate;
        const rechargeInline = { inline_keyboard: [[{ text: '💬 WhatsApp', url: 'https://wa.me/573142369516' }], [{ text: '📸 Telegram', callback_data: `send_receipt|${amountUsd}|${stateData.countryCode}` }]] };
        userStates[chatId] = null;
        return bot.sendMessage(chatId, `💰 *Pagar:* $${amountLocal.toLocaleString('es-CO')} ${pais.currency}\n\n${pais.methods}`, { parse_mode: 'Markdown', reply_markup: rechargeInline });
    },
    menuPaisesAdmin: async (bot, db, chatId) => {
        const configSnap = await get(ref(db, 'config/paises_desactivados'));
        const desactivados = configSnap.exists() ? configSnap.val() : {};
        let keyboard = [];
        Object.keys(PaisesConfig).forEach(code => {
            const status = desactivados[code] ? '❌' : '✅';
            keyboard.push([{ text: `${status} ${PaisesConfig[code].flag} ${PaisesConfig[code].name}`, callback_data: `toggle_pais|${code}` }]);
        });
        return bot.sendMessage(chatId, '⚙️ *Gestión de Países*', { parse_mode: 'Markdown', reply_markup: { inline_keyboard: keyboard } });
    },
    togglePaisAdmin: async (bot, db, chatId, messageId, countryCode) => {
        const refPais = ref(db, `config/paises_desactivados/${countryCode}`);
        const snap = await get(refPais);
        if (snap.exists()) await remove(refPais); else await set(refPais, true);
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
        const pais = PaisesConfig[countryCode];
        userStates[chatId] = { step: 'WAITING_FOR_RECEIPT', data: { username: userSnap.val().username, amount: amountRequest, webUid: webUid, countryName: pais.name, localAmount: amountRequest * pais.rate, currency: pais.currency } };
        return bot.sendMessage(chatId, '📸 Envía la foto del comprobante ahora:');
    },
    recibirFotoComprobante: async (bot, db, chatId, tgId, fileId, stateData, keyboard, superAdminId, userStates) => {
        const receiptRef = push(ref(db, 'pending_receipts'));
        await set(receiptRef, { webUid: stateData.webUid, amount: stateData.amount, tgId: tgId, username: stateData.username });
        const adminConfirmKeyboard = { inline_keyboard: [[{ text: '✅', callback_data: `ok_rech|${receiptRef.key}` }, { text: '❌', callback_data: `no_rech|${receiptRef.key}` }]] };
        bot.sendPhoto(superAdminId, fileId, { caption: `👤 ${stateData.username}\n💰 $${stateData.amount} USD`, reply_markup: adminConfirmKeyboard });
        userStates[chatId] = null;
        return bot.sendMessage(chatId, '✅ Comprobante enviado.', keyboard);
    },
    aprobarRecarga: async (bot, db, chatId, queryMessageId, receiptId, adminUsername, adminTgId, notifySuperAdmin) => {
        bot.editMessageReplyMarkup({ inline_keyboard: [] }, { chat_id: chatId, message_id: queryMessageId });
        const snap = await get(ref(db, `pending_receipts/${receiptId}`));
        if (!snap.exists()) return;
        const data = snap.val();
        await remove(ref(db, `pending_receipts/${receiptId}`));
        const userSnap = await get(ref(db, `users/${data.webUid}`));
        const nuevoSaldo = parseFloat(userSnap.val().balance || 0) + data.amount;
        const updates = {};
        updates[`users/${data.webUid}/balance`] = nuevoSaldo;
        updates[`users/${data.webUid}/recharges/${push(ref(db)).key}`] = { amount: data.amount, date: Date.now() };
        await update(ref(db), updates);
        bot.sendMessage(data.tgId, `🎉 Recarga Aprobada: $${data.amount} USD.`);
        notifySuperAdmin(adminUsername, adminTgId, 'Aprobó Recarga', `$${data.amount} USD a ${userSnap.val().username}`);
        await verificarBonoReferido(db, bot, data.webUid, data.amount);
    },
    rechazarRecarga: async (bot, db, chatId, queryMessageId, receiptId, adminUsername, adminTgId, notifySuperAdmin) => {
        bot.editMessageReplyMarkup({ inline_keyboard: [] }, { chat_id: chatId, message_id: queryMessageId });
        const snap = await get(ref(db, `pending_receipts/${receiptId}`));
        bot.sendMessage(snap.val().tgId, '❌ Recarga Rechazada.');
        await remove(ref(db, `pending_receipts/${receiptId}`));
    }
};
