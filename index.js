bot.on('message', async (msg) => {
    if (msg.text === '/start') return;

    const chatId = msg.chat.id;
    const tgId = msg.from.id;
    const text = msg.text || msg.caption || ''; 

    // 🛠️ FIX: Evitar que el bot devuelva return prematuro si envían foto con o sin texto.
    if (!text && !msg.photo) return;

    const webUid = await getAuthUser(tgId);
    if (!webUid) return bot.sendMessage(chatId, `🛑 Acceso denegado. Escribe /start para verificar.`);
    
    // --- VERIFICACIONES GLOBALES ---
    const settingsSnap = await get(ref(db, 'settings'));
    const isMaintenance = settingsSnap.val()?.maintenance || false;
    
    const userSnap = await get(ref(db, `users/${webUid}`));
    const webUser = userSnap.val();

    // 🛠️ FIX: Evitar crash si el usuario está en telegram_auth pero no en la BD de users
    if (!webUser) {
        return bot.sendMessage(chatId, '⚠️ *ERROR CRÍTICO*\n\nTu cuenta web fue eliminada o no se encuentra. Contacta a soporte.', { parse_mode: 'Markdown' });
    }

    if (tgId !== ADMIN_ID) {
        if (webUser.banned) {
            return bot.sendMessage(chatId, '🚫 *ESTÁS BANEADO*\n\nHas sido bloqueado del sistema LUCK XIT por violar nuestras políticas o reglas.', { parse_mode: 'Markdown' });
        }
        if (isMaintenance) {
            return bot.sendMessage(chatId, '🛠️ *MODO MANTENIMIENTO ACTIVO*\n\nEstamos haciendo unas mejoras rápidas en el bot. Volveremos pronto.', { parse_mode: 'Markdown' });
        }
    }
