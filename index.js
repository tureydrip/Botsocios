import TelegramBot from 'node-telegram-bot-api';
import { initializeApp } from 'firebase/app';
import { getDatabase, ref, get, set, update, push, remove } from 'firebase/database';

// --- 1. CONFIGURACIÓN DE FIREBASE ---
const firebaseConfig = {
  apiKey: "AIzaSyBCk_6-UQu_8js-Rof_Vps7QWPBw6dJFcg",
  authDomain: "temo-store.firebaseapp.com",
  databaseURL: "https://temo-store-default-rtdb.firebaseio.com", 
  projectId: "temo-store",
  storageBucket: "temo-store.firebasestorage.app",
  messagingSenderId: "502364316401",
  appId: "1:502364316401:web:201b9e9c6e426acdb33f50"
};

const app = initializeApp(firebaseConfig);
const db = getDatabase(app);

// --- 2. CONFIGURACIÓN DE LOS BOTS ---

// BOT 1: TEMO STORE (Bot Original)
const token = '8240591970:AAEAPtTNdanUdR0tXZDjFC9hcdxsdmQFuGI'; 
const bot = new TelegramBot(token, { polling: true });

// BOT 2: TIKTOK GRATIS (Bot Nuevo)
const tokenTiktok = '8038521927:AAH32NbJJwzNgZTResVyHi24kVycRhPRt7U';
const botTiktok = new TelegramBot(tokenTiktok, { polling: true });

// Variables globales del Bot 1
const PRINCIPAL_ADMINS = [8182510987, 7710633235];
const WHATSAPP_URL = "https://wa.me/523224528803";
const COSTO_TIKTOK = 0.05; 
const userStates = {};

let botUsername = "";
bot.getMe().then(info => botUsername = info.username);

// --- FUNCIONES COMPARTIDAS ---

async function checkAdminPermissions(chatId) {
  const isPrincipal = PRINCIPAL_ADMINS.includes(chatId);
  const subAdminsSnap = await get(ref(db, 'sub_admins'));
  const subAdmins = subAdminsSnap.exists() ? subAdminsSnap.val() : {};
  const isSubAdmin = subAdmins.hasOwnProperty(chatId.toString());
  
  const isAdmin = isPrincipal || isSubAdmin;
  const permisos = isSubAdmin ? (subAdmins[chatId.toString()].permisos || {}) : {};

  const hasPermission = (perm) => {
    if (isPrincipal) return true;
    if (isSubAdmin && permisos[perm] === true) return true;
    return false;
  };

  return { isPrincipal, isSubAdmin, isAdmin, hasPermission };
}

async function getTikTokVideo(url) {
  try {
    const response = await fetch("https://www.tikwm.com/api/", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ url: url, hd: 1 })
    });
    const data = await response.json();
    if (data.code === 0 && data.data) {
      return data.data.hdplay || data.data.play;
    }
    return null;
  } catch (error) {
    console.error("Error obteniendo TikTok:", error);
    return null;
  }
}

// --- NUEVA FUNCIÓN PARA CONTAR USUARIOS DEL BOT 2 ---
async function getAndTrackTiktokUsers(chatId) {
  const userRef = ref(db, `tiktok_bot_users/${chatId}`);
  const userSnap = await get(userRef);
  const statsRef = ref(db, `tiktok_bot_stats/total_users`);
  
  let totalUsers = 0;
  const statsSnap = await get(statsRef);
  if (statsSnap.exists()) {
    totalUsers = statsSnap.val();
  }

  // Si el usuario no existe en la base de datos del bot 2, lo registramos y sumamos 1
  if (!userSnap.exists()) {
    totalUsers += 1;
    await set(userRef, true);
    await set(statsRef, totalUsers);
  }
  return totalUsers;
}

// ==========================================
// ====== LÓGICA DEL BOT 2 (TIKTOK GRATIS) ==
// ==========================================

// Se cambió a async para poder consultar la base de datos
botTiktok.onText(/\/start/, async (msg) => {
  const chatId = msg.chat.id;
  
  // Obtenemos el total de usuarios (y registramos al actual si es nuevo)
  const totalUsuarios = await getAndTrackTiktokUsers(chatId);
  
  const mensaje = "🤖 *Este bot está 100% programado por sebastian (LUCK XIT OFC)*\n\n" +
                  "👋 ¡Hola! Soy un bot totalmente gratuito para descargar videos de TikTok.\n\n" +
                  `📊 *Usuarios totales que me usan:* ${totalUsuarios}\n\n` +
                  "📖 *¿Cómo usar el bot?*\n" +
                  "Simplemente cópiame y envíame un enlace válido de TikTok (ejemplo: `https://vm.tiktok.com/...`) y yo me encargaré de enviarte el video sin marca de agua al instante. 🚀";

  const opciones = {
    parse_mode: "Markdown",
    disable_web_page_preview: true,
    reply_markup: {
      inline_keyboard: [
        [{ text: "📞 Contacto en WhatsApp", url: "https://wa.me/573142369516" }]
      ]
    }
  };

  botTiktok.sendMessage(chatId, mensaje, opciones);
});

botTiktok.on('message', async (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text;

  // Ignorar si no hay texto o si es un comando (como /start)
  if (!text || text.startsWith('/')) return;

  // Actualizamos estadísticas por si el usuario envió un enlace sin usar /start antes
  const totalUsuarios = await getAndTrackTiktokUsers(chatId);

  if (text.includes('tiktok.com')) {
    const waitMsg = await botTiktok.sendMessage(chatId, "⏳ Descargando video sin marca de agua, por favor espera...");
    const videoUrl = await getTikTokVideo(text.trim());

    if (videoUrl) {
      try {
        // Se agregó el contador también aquí para que lo vean al descargar
        await botTiktok.sendVideo(chatId, videoUrl, { caption: `✅ ¡Aquí tienes tu video gratis!\n\n📊 *Usuarios totales en tiempo real:* ${totalUsuarios}\n🤖 _Bot by: sebastian (LUCK XIT OFC)_`, parse_mode: "Markdown" });
        botTiktok.deleteMessage(chatId, waitMsg.message_id).catch(()=>{});
      } catch (error) {
        botTiktok.deleteMessage(chatId, waitMsg.message_id).catch(()=>{});
        botTiktok.sendMessage(chatId, "❌ Error al enviar el video. Puede que sea demasiado pesado para Telegram.");
      }
    } else {
      botTiktok.deleteMessage(chatId, waitMsg.message_id).catch(()=>{});
      botTiktok.sendMessage(chatId, "❌ Error al procesar el enlace. Asegúrate de que el video sea público y el enlace esté correcto.");
    }
  } else {
    // Si envían texto que no es de tiktok
    botTiktok.sendMessage(chatId, "⚠️ Por favor, envíame un enlace válido de TikTok.");
  }
});


// ==========================================
// ====== LÓGICA DEL BOT 1 (TEMO STORE) =====
// ==========================================

// --- 3. COMANDO /START ---
bot.onText(/\/start(?:\s+(.+))?/, async (msg, match) => {
  const chatId = msg.chat.id;
  const username = msg.from.first_name || "Usuario";
  const refId = match[1]; 

  const userRef = ref(db, `users/${chatId}`);
  const snapshot = await get(userRef);
  
  if (!snapshot.exists()) {
    await set(userRef, { nombre: username, saldo: 0, keys_compradas: [], invitados: 0, tiktok_credits: 0, protegido: false });
    
    if (refId && refId != chatId) {
      const inviterRef = ref(db, `users/${refId}`);
      const inviterSnap = await get(inviterRef);
      if (inviterSnap.exists()) {
        let inviterData = inviterSnap.val();
        let nuevosInvitados = (inviterData.invitados || 0) + 1;
        let nuevosCreditos = inviterData.tiktok_credits || 0;

        if (nuevosInvitados % 5 === 0) {
          nuevosCreditos += 2;
          bot.sendMessage(refId, `🎉 *¡Felicidades!*\nHas llegado a ${nuevosInvitados} invitados y ganaste **2 Créditos** para descargar TikToks gratis.`, { parse_mode: "Markdown" });
        } else {
          bot.sendMessage(refId, `👤 Un nuevo usuario entró con tu enlace. (Llevas ${nuevosInvitados} invitados).`);
        }
        await update(inviterRef, { invitados: nuevosInvitados, tiktok_credits: nuevosCreditos });
      }
    }
  }

  const { isAdmin, isPrincipal, hasPermission } = await checkAdminPermissions(chatId);

  if (isAdmin) {
    const keyboard = [];
    const row1 = [];
    if (hasPermission('add_saldo')) row1.push({ text: "➕ Agregar Saldo" });
    if (hasPermission('remove_saldo')) row1.push({ text: "➖ Quitar Saldo" });
    if (row1.length > 0) keyboard.push(row1);

    const row2 = [];
    if (hasPermission('create_prod')) row2.push({ text: "📦 Crear Producto" });
    if (hasPermission('manage_prod')) row2.push({ text: "📋 Gestionar Productos" });
    if (row2.length > 0) keyboard.push(row2);

    const row3 = [];
    if (hasPermission('view_stock')) row3.push({ text: "📊 Ver Stocks" });
    if (hasPermission('edit_price')) row3.push({ text: "✏️ Editar Precios" });
    if (row3.length > 0) keyboard.push(row3);

    const row4 = [];
    if (hasPermission('view_history')) row4.push({ text: "📜 Historial Compras" });
    if (row4.length > 0) keyboard.push(row4);

    keyboard.push([{ text: "📱 Descargar TikTok" }]);

    if (isPrincipal) keyboard.push([{ text: "👥 Gestionar Admins" }]);
    
    // BOTÓN EXCLUSIVO PARA EL ADMIN 7710633235
    if (chatId === 7710633235) {
      keyboard.push([{ text: "🛡️ Proteger Usuario" }]);
    }

    bot.sendMessage(chatId, `👑 *Panel de Administrador* | Hola ${username}`, {
      parse_mode: "Markdown",
      reply_markup: { keyboard: keyboard, resize_keyboard: true, is_persistent: true }
    });
  } else {
    bot.sendMessage(chatId, `👋 Hola ${username}, ¡Bienvenido a *TEMO STORE*!\n\nUsa el menú de abajo para navegar:`, {
      parse_mode: "Markdown",
      reply_markup: {
        keyboard: [
          [{ text: "🛒 Ver Productos" }], 
          [{ text: "👤 Mi Perfil" }, { text: "💳 Recargar Saldo" }],
          [{ text: "📱 Descargar TikTok" }]
        ],
        resize_keyboard: true, is_persistent: true
      }
    });
  }
});

// --- 4. MANEJO DE TEXTOS DEL TECLADO Y ESTADOS ---
bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text;

  // Si es un mensaje del bot 2 o un comando, lo ignoramos para no mezclar eventos
  if (!text || text.startsWith('/')) return;

  const { isAdmin, isPrincipal, hasPermission } = await checkAdminPermissions(chatId);

  if (text === "👤 Mi Perfil") {
    const userData = (await get(ref(db, `users/${chatId}`))).val() || { saldo: 0, invitados: 0, tiktok_credits: 0 };
    const linkReferido = `https://t.me/${botUsername}?start=${chatId}`;

    let texto = `👤 *Tu Perfil*\n\n💰 Saldo: $${userData.saldo}\n🆔 Tu ID: \`${chatId}\`\n\n`;
    texto += `📱 *TikTok Downloader:*\n- Créditos disponibles: ${userData.tiktok_credits}\n- Personas invitadas: ${userData.invitados}\n\n`;
    texto += `🔗 *Tu link de referidos:*\n\`${linkReferido}\`\n_(Invita a 5 personas con este link para ganar 2 créditos para videos gratis)_\n\n`;
    texto += `🔑 *Tus Keys Compradas:*\n`;
    
    let keysArr = userData.keys_compradas || [];
    if (!Array.isArray(keysArr)) keysArr = Object.values(keysArr);

    if (keysArr.length > 0) {
      keysArr.forEach(k => {
        if (typeof k === 'object') {
          texto += `- \`${k.key}\` (Gastaste: $${k.gasto})\n`;
        } else {
          texto += `- \`${k}\`\n`; // Para compatibilidad con keys antiguas
        }
      });
    } else {
      texto += "Aún no tienes keys.";
    }
    
    return bot.sendMessage(chatId, texto, { parse_mode: "Markdown", disable_web_page_preview: true });
  }

  if (text === "💳 Recargar Saldo") {
    return bot.sendMessage(chatId, `Para recargar saldo, comunícate a nuestro WhatsApp:\n👉 [Contactar por WhatsApp](${WHATSAPP_URL})`, { parse_mode: "Markdown" });
  }

  if (text === "🛒 Ver Productos" && !isAdmin) { 
    const prodsSnap = await get(ref(db, 'productos'));
    if (!prodsSnap.exists()) return bot.sendMessage(chatId, "No hay productos disponibles.");
    
    const botones = [];
    prodsSnap.forEach((child) => {
      botones.push([{ text: `🎮 ${child.val().nombre || "Producto"}`, callback_data: `buy_prod:${child.key}` }]);
    });
    return bot.sendMessage(chatId, "Selecciona un producto para ver sus precios:", { reply_markup: { inline_keyboard: botones } });
  }

  if (text === "📱 Descargar TikTok") {
    if (isAdmin) {
      userStates[chatId] = { step: 'AWAITING_TIKTOK_URL', cost: 0, useCredit: false };
      return bot.sendMessage(chatId, "👑 *Modo Admin:* Envía el enlace del video de TikTok (Descarga gratuita):", { parse_mode: "Markdown" });
    }

    const userData = (await get(ref(db, `users/${chatId}`))).val() || { saldo: 0, tiktok_credits: 0 };
    const linkReferido = `https://t.me/${botUsername}?start=${chatId}`;

    if (userData.tiktok_credits > 0) {
      userStates[chatId] = { step: 'AWAITING_TIKTOK_URL', cost: 0, useCredit: true };
      return bot.sendMessage(chatId, `Tienes **${userData.tiktok_credits} créditos**.\nEnvía el enlace del video de TikTok a descargar:`, { parse_mode: "Markdown" });
    } 
    else if (userData.saldo >= COSTO_TIKTOK) {
      userStates[chatId] = { step: 'AWAITING_TIKTOK_URL', cost: COSTO_TIKTOK, useCredit: false };
      return bot.sendMessage(chatId, `Costo: **$${COSTO_TIKTOK}** descontados de tu saldo.\nEnvía el enlace del video de TikTok a descargar:`, { parse_mode: "Markdown" });
    } 
    else {
      return bot.sendMessage(chatId, `❌ *No tienes saldo ni créditos suficientes.*\n\nCada video cuesta $${COSTO_TIKTOK} (2 videos por $0.10).\n\n🎁 **¡Consíguelos GRATIS!**\nInvita a 5 amigos al bot usando tu enlace y gana 2 descargas gratuitas:\n\n\`${linkReferido}\``, { parse_mode: "Markdown", disable_web_page_preview: true });
    }
  }

  if (isAdmin) {
    // FUNCIÓN EXCLUSIVA PARA PROTEGER USUARIOS
    if (text === "🛡️ Proteger Usuario" && chatId === 7710633235) {
      userStates[chatId] = { step: 'AWAITING_PROTECT_USER_ID' };
      return bot.sendMessage(chatId, "🛡️ Envía el **ID del usuario** que deseas proteger (o desproteger):", { parse_mode: "Markdown" });
    }

    if (text === "👥 Gestionar Admins" && isPrincipal) {
      return bot.sendMessage(chatId, "⚙️ *Gestión de Administradores*\n¿Qué deseas hacer?", { parse_mode: "Markdown", reply_markup: { inline_keyboard: [[{ text: "➕ Agregar Admin", callback_data: "admin_add" }, { text: "➖ Quitar Admin", callback_data: "admin_remove" }], [{ text: "🎛️ Configurar Permisos", callback_data: "admin_perms" }]] } });
    }
    if (text === "➕ Agregar Saldo") {
      if (!hasPermission('add_saldo')) return bot.sendMessage(chatId, "❌ No tienes permiso para esta función.");
      userStates[chatId] = { step: 'AWAITING_USER_ID' };
      return bot.sendMessage(chatId, "Envía el **ID del usuario** para recargarle saldo:", { parse_mode: "Markdown" });
    }
    if (text === "➖ Quitar Saldo") {
      if (!hasPermission('remove_saldo')) return bot.sendMessage(chatId, "❌ No tienes permiso.");
      const usersSnap = await get(ref(db, 'users'));
      if (!usersSnap.exists()) return bot.sendMessage(chatId, "No hay usuarios registrados.");
      let lista = "👥 *Usuarios con saldo disponible:*\n\n", hay = false;
      usersSnap.forEach((child) => { 
        const user = child.val(); 
        // Lógica de protección: Ocultar de la lista si está protegido y el admin no es el 7710633235
        if (user.protegido && chatId !== 7710633235) return; 

        if (user.saldo > 0) { 
          lista += `👤 *${user.nombre}*\n🆔 ID: \`${child.key}\`\n💰 Saldo: $${user.saldo}\n\n`; 
          hay = true; 
        } 
      });
      if (!hay) return bot.sendMessage(chatId, "❌ Nadie tiene saldo (o los usuarios están protegidos).");
      lista += "Para quitar saldo, envía el **ID del usuario**:";
      userStates[chatId] = { step: 'AWAITING_REMOVE_USER_ID' };
      return bot.sendMessage(chatId, lista, { parse_mode: "Markdown" });
    }
    if (text === "📦 Crear Producto") {
      if (!hasPermission('create_prod')) return bot.sendMessage(chatId, "❌ No tienes permiso.");
      userStates[chatId] = { step: 'AWAITING_PROD_NAME' };
      return bot.sendMessage(chatId, "Escribe el **Nombre del nuevo producto** (Ej: Free Fire Mod):", { parse_mode: "Markdown" });
    }
    if (text === "📋 Gestionar Productos") {
      if (!hasPermission('manage_prod')) return bot.sendMessage(chatId, "❌ No tienes permiso.");
      const prodsSnap = await get(ref(db, 'productos'));
      if (!prodsSnap.exists()) return bot.sendMessage(chatId, "No hay productos.");
      const botones = [];
      prodsSnap.forEach((child) => {
        botones.push([{ text: `Editar/Eliminar ${child.val().nombre || "Producto"}`, callback_data: `edit_prod:${child.key}` }]);
      });
      return bot.sendMessage(chatId, "Selecciona un producto:", { reply_markup: { inline_keyboard: botones } });
    }
    if (text === "📊 Ver Stocks") {
      if (!hasPermission('view_stock')) return bot.sendMessage(chatId, "❌ No tienes permiso.");
      const prodsSnap = await get(ref(db, 'productos'));
      if (!prodsSnap.exists()) return bot.sendMessage(chatId, "No hay productos.");
      let mensaje = "📊 *Inventario Actual:*\n\n";
      prodsSnap.forEach((child) => {
        const prod = child.val();
        mensaje += `📦 *${prod.nombre}*\n`;
        if (prod.opciones) {
          for (const optId in prod.opciones) {
            let stock = prod.opciones[optId].keys ? (Array.isArray(prod.opciones[optId].keys) ? prod.opciones[optId].keys.length : Object.keys(prod.opciones[optId].keys).length) : 0;
            mensaje += `  ├ ${prod.opciones[optId].titulo}: *${stock}* disponibles\n`;
          }
        } else { mensaje += `  └ Sin opciones.\n`; }
        mensaje += "\n";
      });
      return bot.sendMessage(chatId, mensaje, { parse_mode: "Markdown" });
    }
    if (text === "✏️ Editar Precios") {
      if (!hasPermission('edit_price')) return bot.sendMessage(chatId, "❌ No tienes permiso.");
      const prodsSnap = await get(ref(db, 'productos'));
      if (!prodsSnap.exists()) return bot.sendMessage(chatId, "No hay productos.");
      const botones = [];
      prodsSnap.forEach((child) => {
        botones.push([{ text: `✏️ Editar precios de ${child.val().nombre || "Producto"}`, callback_data: `edit_price_prod:${child.key}` }]);
      });
      return bot.sendMessage(chatId, "Selecciona el producto:", { reply_markup: { inline_keyboard: botones } });
    }
    if (text === "📜 Historial Compras") {
      if (!hasPermission('view_history')) return bot.sendMessage(chatId, "❌ No tienes permiso.");
      return bot.sendMessage(chatId, "📜 *Gestión de Historial de Compras*\nElige una opción:", {
        parse_mode: "Markdown",
        reply_markup: {
          inline_keyboard: [
            [{ text: "👥 Ver lista de compradores", callback_data: "hist_all" }],
            [{ text: "🔍 Buscar historial por ID", callback_data: "hist_search" }]
          ]
        }
      });
    }
  }

  // --- LÓGICA DE ESTADOS ---
  const state = userStates[chatId];
  if (!state) return;
  const currentState = { ...state };
  delete userStates[chatId];

  // ESTADO EXCLUSIVO: PROTEGER USUARIO
  if (currentState.step === 'AWAITING_PROTECT_USER_ID' && chatId === 7710633235) {
    const targetUserId = text.trim();
    const userRef = ref(db, `users/${targetUserId}`);
    const userSnapshot = await get(userRef);
    if (userSnapshot.exists()) {
      const userData = userSnapshot.val();
      const isProtected = userData.protegido || false;
      await update(userRef, { protegido: !isProtected });
      
      if (!isProtected) {
        bot.sendMessage(chatId, `🛡️ ✅ El usuario \`${targetUserId}\` ahora está **PROTEGIDO**.\nNingún otro admin podrá verlo, recargarle o ver su historial.`, { parse_mode: "Markdown" });
      } else {
        bot.sendMessage(chatId, `🔓 El usuario \`${targetUserId}\` ya **NO** está protegido.\nTodos los admins podrán verlo nuevamente.`, { parse_mode: "Markdown" });
      }
    } else {
      bot.sendMessage(chatId, "❌ Usuario no encontrado en la base de datos.");
    }
  }

  else if (currentState.step === 'AWAITING_TIKTOK_URL') {
    const url = text.trim();
    if (!url.includes('tiktok.com')) {
      return bot.sendMessage(chatId, "❌ Enlace inválido. Debes enviar un enlace válido de TikTok.");
    }

    const waitMsg = await bot.sendMessage(chatId, "⏳ Descargando video sin marca de agua, por favor espera...");
    const videoUrl = await getTikTokVideo(url);

    if (videoUrl) {
      try {
        await bot.sendVideo(chatId, videoUrl, { caption: "✅ ¡Aquí tienes tu video sin marca de agua!" });
        bot.deleteMessage(chatId, waitMsg.message_id).catch(()=>{});

        if (!isAdmin) {
          const userRef = ref(db, `users/${chatId}`);
          const userData = (await get(userRef)).val();
          
          if (currentState.useCredit) {
            await update(userRef, { tiktok_credits: userData.tiktok_credits - 1 });
            bot.sendMessage(chatId, "🎫 Se ha descontado 1 crédito de tu cuenta.");
          } else if (currentState.cost > 0) {
            await update(userRef, { saldo: userData.saldo - currentState.cost });
            bot.sendMessage(chatId, `💸 Se han descontado $${currentState.cost} de tu saldo.`);
          }
        }
      } catch (error) {
        bot.deleteMessage(chatId, waitMsg.message_id).catch(()=>{});
        bot.sendMessage(chatId, "❌ Error al enviar el video. Puede que sea demasiado pesado para Telegram.");
      }
    } else {
      bot.deleteMessage(chatId, waitMsg.message_id).catch(()=>{});
      bot.sendMessage(chatId, "❌ Error al procesar el enlace. Asegúrate de que el video sea público.");
    }
  }

  else if (currentState.step === 'AWAITING_NEW_ADMIN_ID' && isPrincipal) {
    const newAdminId = text.trim();
    await set(ref(db, `sub_admins/${newAdminId}`), { agregado_por: chatId, permisos: { add_saldo: false, remove_saldo: false, create_prod: false, manage_prod: false, view_stock: false, edit_price: false, view_history: false } });
    bot.sendMessage(chatId, `✅ Sub-Admin \`${newAdminId}\` agregado exitosamente.\n\n⚠️ *Nota:* Por defecto tiene todas las funciones desactivadas. Usa "🎛️ Configurar Permisos" para activarle lo que necesites.`, { parse_mode: "Markdown" });
  }
  else if (currentState.step === 'AWAITING_USER_ID') {
    const targetUserId = text.trim();
    const userSnapshot = await get(ref(db, `users/${targetUserId}`));
    if (userSnapshot.exists()) {
      const userData = userSnapshot.val();
      // Bloqueo de Protección
      if (userData.protegido && chatId !== 7710633235) return bot.sendMessage(chatId, "❌ Usuario no encontrado.");

      userStates[chatId] = { step: 'AWAITING_AMOUNT', targetUserId }; 
      bot.sendMessage(chatId, `Usuario: ${userData.nombre}. ¿Cuánto saldo agregas?`);
    } else bot.sendMessage(chatId, "❌ Usuario no encontrado.");
  } 
  else if (currentState.step === 'AWAITING_AMOUNT') {
    const amount = parseFloat(text.trim());
    if (isNaN(amount)) { userStates[chatId] = currentState; return bot.sendMessage(chatId, "❌ Escribe un número válido."); }
    const targetRef = ref(db, `users/${currentState.targetUserId}/saldo`);
    const currentBalance = (await get(targetRef)).val() || 0;
    await set(targetRef, currentBalance + amount);
    bot.sendMessage(chatId, `✅ Saldo actualizado. Nuevo saldo: $${currentBalance + amount}`);
    bot.sendMessage(currentState.targetUserId, `🎉 ¡Te han recargado $${amount} de saldo!`);
  }
  else if (currentState.step === 'AWAITING_REMOVE_USER_ID') {
    const targetUserId = text.trim();
    const userSnapshot = await get(ref(db, `users/${targetUserId}`));
    if (userSnapshot.exists()) {
      const userData = userSnapshot.val();
      // Bloqueo de Protección
      if (userData.protegido && chatId !== 7710633235) return bot.sendMessage(chatId, "❌ Usuario no encontrado.");

      if (userData.saldo <= 0) return bot.sendMessage(chatId, "❌ Este usuario ya tiene $0 de saldo.");
      userStates[chatId] = { step: 'AWAITING_REMOVE_AMOUNT', targetUserId }; 
      bot.sendMessage(chatId, `Usuario: ${userData.nombre} (Saldo: $${userData.saldo}).\n¿Cuánto le deseas quitar?`);
    } else bot.sendMessage(chatId, "❌ Usuario no encontrado.");
  }
  else if (currentState.step === 'AWAITING_REMOVE_AMOUNT') {
    const amount = parseFloat(text.trim());
    if (isNaN(amount) || amount <= 0) { userStates[chatId] = currentState; return bot.sendMessage(chatId, "❌ Número inválido."); }
    const targetRef = ref(db, `users/${currentState.targetUserId}/saldo`);
    const currentBalance = (await get(targetRef)).val() || 0;
    let nuevoSaldo = currentBalance - amount;
    if (nuevoSaldo < 0) nuevoSaldo = 0;
    await set(targetRef, nuevoSaldo);
    bot.sendMessage(chatId, `✅ Saldo descontado. Nuevo saldo: $${nuevoSaldo}`);
    bot.sendMessage(currentState.targetUserId, `⚠️ Se descontaron $${amount}. Saldo actual: $${nuevoSaldo}`);
  }
  else if (currentState.step === 'AWAITING_PROD_NAME') {
    const newProdRef = push(ref(db, 'productos'));
    await set(newProdRef, { nombre: text.trim() });
    bot.sendMessage(chatId, `✅ Producto "${text}" creado.`);
  }
  else if (currentState.step === 'AWAITING_OPT_NAME') {
    const match = text.match(/(.+?)\s+(\d+)\$$/); 
    if (!match) { userStates[chatId] = currentState; return bot.sendMessage(chatId, "⚠️ Formato: '1 dia 3$'. Intenta de nuevo."); }
    const newOptRef = push(ref(db, `productos/${currentState.prodId}/opciones`));
    await set(newOptRef, { titulo: match[1].trim(), precio: parseInt(match[2]), keys: [] });
    bot.sendMessage(chatId, `✅ Opción agregada.\n¿Quieres agregarle keys ahora?`, { reply_markup: { inline_keyboard: [[{ text: "➕ Agregar Keys", callback_data: `add_keys:${currentState.prodId}:${newOptRef.key}` }]] } });
  }
  else if (currentState.step === 'AWAITING_KEYS') {
    const keysArray = text.split('\n').map(k => k.trim()).filter(k => k !== '');
    const keysRef = ref(db, `productos/${currentState.prodId}/opciones/${currentState.optId}/keys`);
    let currentKeys = (await get(keysRef)).val() || [];
    if (!Array.isArray(currentKeys)) currentKeys = Object.values(currentKeys);
    await set(keysRef, currentKeys.concat(keysArray));
    bot.sendMessage(chatId, `✅ Se agregaron ${keysArray.length} keys.`);
  }
  else if (currentState.step === 'AWAITING_NEW_PRICE') {
    const nuevoPrecio = parseInt(text.trim());
    if (isNaN(nuevoPrecio) || nuevoPrecio < 0) { userStates[chatId] = currentState; return bot.sendMessage(chatId, "❌ Precio inválido."); }
    await update(ref(db), { [`productos/${currentState.prodId}/opciones/${currentState.optId}/precio`]: nuevoPrecio });
    bot.sendMessage(chatId, `✅ Precio actualizado a $${nuevoPrecio}.`);
  }
  else if (currentState.step === 'AWAITING_HISTORY_ID') {
    const uId = text.trim();
    const uSnap = await get(ref(db, `users/${uId}`));
    if (!uSnap.exists()) return bot.sendMessage(chatId, "❌ Usuario no encontrado en la base de datos.");
    
    const u = uSnap.val();
    // Bloqueo de Protección
    if (u.protegido && chatId !== 7710633235) return bot.sendMessage(chatId, "❌ Usuario no encontrado en la base de datos.");

    let textoHistorial = `📜 *Historial de Compras*\n👤 *Usuario:* ${u.nombre}\n🆔 *ID:* \`${uId}\`\n\n`;
    let keysArr = u.keys_compradas || [];
    if (!Array.isArray(keysArr)) keysArr = Object.values(keysArr);
    
    if (keysArr.length === 0) {
      textoHistorial += "Este usuario no ha realizado ninguna compra.";
    } else {
      keysArr.forEach(k => {
        if (typeof k === 'object') {
          textoHistorial += `🔹 *Producto:* ${k.producto}\n🔑 *Key:* \`${k.key}\`\n💸 *Gasto:* $${k.gasto}\n📅 *Fecha:* ${k.fecha}\n\n`;
        } else {
          textoHistorial += `🔹 *Key (Antigua):* \`${k}\`\n\n`;
        }
      });
    }
    bot.sendMessage(chatId, textoHistorial, { parse_mode: "Markdown" });
  }
});

// --- 5. MANEJO DE BOTONES EN LÍNEA ---
bot.on('callback_query', async (query) => {
  const chatId = query.message.chat.id;
  const data = query.data;
  const responder = () => bot.answerCallbackQuery(query.id).catch(()=>{});
  const { isAdmin, isPrincipal } = await checkAdminPermissions(chatId);

  // Lógica para listar historial global
  if (data === "hist_all" && isAdmin) {
    const usersSnap = await get(ref(db, 'users'));
    if (!usersSnap.exists()) { bot.sendMessage(chatId, "No hay usuarios registrados."); return responder(); }
    
    let botones = [];
    usersSnap.forEach((child) => {
      const u = child.val();
      // Bloqueo de Protección
      if (u.protegido && chatId !== 7710633235) return; 

      if (u.keys_compradas && (Array.isArray(u.keys_compradas) ? u.keys_compradas.length > 0 : Object.keys(u.keys_compradas).length > 0)) {
        botones.push([{ text: `👤 ${u.nombre} (ID: ${child.key})`, callback_data: `view_hist:${child.key}` }]);
      }
    });
    
    if (botones.length === 0) { bot.sendMessage(chatId, "Aún no hay compras registradas (o están ocultas)."); return responder(); }
    bot.sendMessage(chatId, "Selecciona un usuario para ver su historial de compras:", { reply_markup: { inline_keyboard: botones } });
    return responder();
  }

  // Lógica para buscar historial por ID
  if (data === "hist_search" && isAdmin) {
    userStates[chatId] = { step: 'AWAITING_HISTORY_ID' };
    bot.sendMessage(chatId, "🔍 Envía el **ID del usuario** para buscar su historial exacto:", { parse_mode: "Markdown" });
    return responder();
  }

  // Lógica para mostrar historial de un usuario desde botón inline
  if (data.startsWith('view_hist:') && isAdmin) {
    const uId = data.split(':')[1];
    const uSnap = await get(ref(db, `users/${uId}`));
    if (!uSnap.exists()) { bot.sendMessage(chatId, "Usuario no encontrado."); return responder(); }
    
    const u = uSnap.val();
    // Bloqueo de Protección extra
    if (u.protegido && chatId !== 7710633235) { bot.sendMessage(chatId, "Usuario no encontrado."); return responder(); }

    let textoHistorial = `📜 *Historial de Compras*\n👤 *Usuario:* ${u.nombre}\n🆔 *ID:* \`${uId}\`\n\n`;
    let keysArr = u.keys_compradas || [];
    if (!Array.isArray(keysArr)) keysArr = Object.values(keysArr);
    
    if (keysArr.length === 0) {
      textoHistorial += "Este usuario no tiene compras.";
    } else {
      keysArr.forEach(k => {
        if (typeof k === 'object') {
          textoHistorial += `🔹 *Producto:* ${k.producto}\n🔑 *Key:* \`${k.key}\`\n💸 *Gasto:* $${k.gasto}\n📅 *Fecha:* ${k.fecha}\n\n`;
        } else {
          textoHistorial += `🔹 *Key (Antigua):* \`${k}\`\n\n`;
        }
      });
    }
    bot.sendMessage(chatId, textoHistorial, { parse_mode: "Markdown" });
    return responder();
  }

  if (data.startsWith('buy_prod:')) {
    const prodId = data.split(':')[1];
    const producto = (await get(ref(db, `productos/${prodId}`))).val();
    if (!producto || !producto.opciones) { bot.sendMessage(chatId, "Producto sin duraciones."); return responder(); }

    const botones = [];
    for (const optId in producto.opciones) botones.push([{ text: `${producto.opciones[optId].titulo} - $${producto.opciones[optId].precio}`, callback_data: `checkout:${prodId}:${optId}` }]);
    bot.sendMessage(chatId, `🛒 *${producto.nombre}*\nElige la duración:`, { parse_mode: "Markdown", reply_markup: { inline_keyboard: botones } });
    return responder();
  }

  if (data.startsWith('checkout:')) {
    const [, prodId, optId] = data.split(':');
    const [userSnap, optSnap, prodNameSnap] = await Promise.all([ get(ref(db, `users/${chatId}`)), get(ref(db, `productos/${prodId}/opciones/${optId}`)), get(ref(db, `productos/${prodId}/nombre`)) ]);

    const user = userSnap.val() || { saldo: 0 };
    const opt = optSnap.val() || {};
    let keysDisp = opt.keys || [];
    if (!Array.isArray(keysDisp)) keysDisp = Object.values(keysDisp);

    if (keysDisp.length === 0) { bot.sendMessage(chatId, "❌ No hay keys disponibles."); return responder(); }
    if (user.saldo < opt.precio) { bot.sendMessage(chatId, `❌ *Saldo insuficiente.*\nTu saldo: $${user.saldo}\nPrecio: $${opt.precio}`, { parse_mode: "Markdown" }); return responder(); }

    const keyEntregada = keysDisp[0];
    const nuevoSaldo = user.saldo - opt.precio; 
    let keysUser = user.keys_compradas || [];
    if (!Array.isArray(keysUser)) keysUser = Object.values(keysUser);
    
    // NUEVA LÓGICA DE GUARDADO DE HISTORIAL
    const prodName = prodNameSnap.exists() ? prodNameSnap.val() : "Producto";
    const fechaCompra = new Date().toLocaleString("es-CO", { timeZone: "America/Bogota" });
    const nuevaCompra = {
      key: keyEntregada,
      producto: `${prodName} (${opt.titulo})`,
      gasto: opt.precio,
      fecha: fechaCompra
    };
    keysUser.push(nuevaCompra);

    await update(ref(db), { [`users/${chatId}/saldo`]: nuevoSaldo, [`users/${chatId}/keys_compradas`]: keysUser, [`productos/${prodId}/opciones/${optId}/keys`]: keysDisp.slice(1) });
    bot.sendMessage(chatId, `✅ *¡COMPRA EXITOSA!*\n\nCompraste: *${opt.titulo}*\nKey: \`${keyEntregada}\`\n💰 Saldo: $${nuevoSaldo}`, { parse_mode: "Markdown" });
    
    if (keysDisp.slice(1).length === 0) {
      PRINCIPAL_ADMINS.forEach((adminId) => bot.sendMessage(adminId, `⚠️ *ALERTA DE INVENTARIO*\nSe agotaron las keys de ${prodName} (${opt.titulo}).`, { parse_mode: "Markdown" }).catch(() => {}));
    }
    return responder();
  }

  if (isPrincipal) {
    if (data === "admin_add") {
      userStates[chatId] = { step: 'AWAITING_NEW_ADMIN_ID' };
      bot.sendMessage(chatId, "Pídele al nuevo admin su ID de Telegram (lo puede ver en 'Mi Perfil') y envíalo aquí:");
    }
    if (data === "admin_remove") {
      const subAdmins = (await get(ref(db, 'sub_admins'))).val() || {};
      if (Object.keys(subAdmins).length === 0) return bot.sendMessage(chatId, "No hay sub-admins agregados.");
      const botones = Object.keys(subAdmins).map(id => ([{ text: `❌ Eliminar ID: ${id}`, callback_data: `del_admin:${id}` }]));
      bot.sendMessage(chatId, "Selecciona el Admin que deseas revocar:", { reply_markup: { inline_keyboard: botones } });
    }
    if (data.startsWith('del_admin:')) {
      const idToRemove = data.split(':')[1];
      await remove(ref(db, `sub_admins/${idToRemove}`));
      bot.editMessageText(`✅ Admin \`${idToRemove}\` revocado correctamente.`, { chat_id: chatId, message_id: query.message.message_id, parse_mode: "Markdown" });
    }
    if (data === "admin_perms") {
      const subAdmins = (await get(ref(db, 'sub_admins'))).val() || {};
      if (Object.keys(subAdmins).length === 0) return bot.sendMessage(chatId, "No hay sub-admins para configurar.");
      const botones = Object.keys(subAdmins).map(id => ([{ text: `⚙️ Configurar ID: ${id}`, callback_data: `edit_perms:${id}` }]));
      bot.sendMessage(chatId, "Selecciona el Admin para editar sus permisos:", { reply_markup: { inline_keyboard: botones } });
    }
    if (data.startsWith('edit_perms:')) {
      const adminId = data.split(':')[1];
      const permisos = (await get(ref(db, `sub_admins/${adminId}/permisos`))).val() || {};
      const btn = (name, key) => [{ text: `${permisos[key] ? '✅' : '❌'} ${name}`, callback_data: `tgl_p:${adminId}:${key}` }];
      bot.editMessageText(`🎛️ *Permisos para:* \`${adminId}\`\nToca un permiso para activarlo o desactivarlo.`, {
        chat_id: chatId, message_id: query.message.message_id, parse_mode: "Markdown",
        reply_markup: {
          inline_keyboard: [
            btn('Agregar Saldo', 'add_saldo'), btn('Quitar Saldo', 'remove_saldo'),
            btn('Crear Prod.', 'create_prod'), btn('Gestionar Prod.', 'manage_prod'),
            btn('Ver Stocks', 'view_stock'), btn('Editar Precios', 'edit_price'),
            btn('Ver Historial', 'view_history'),
            [{ text: "🔙 Volver a la lista", callback_data: "admin_perms" }]
          ]
        }
      });
    }
    if (data.startsWith('tgl_p:')) {
      const [, adminId, permKey] = data.split(':');
      const permRef = ref(db, `sub_admins/${adminId}/permisos/${permKey}`);
      const currentVal = (await get(permRef)).val() || false;
      await set(permRef, !currentVal);
      query.data = `edit_perms:${adminId}`;
      bot.emit('callback_query', query); 
      return; 
    }
  }

  if (isAdmin) {
    if (data.startsWith('edit_prod:')) {
      const prodId = data.split(':')[1];
      const prodSnap = await get(ref(db, `productos/${prodId}/nombre`));
      bot.sendMessage(chatId, `⚙️ *Opciones para: ${prodSnap.exists() ? prodSnap.val() : "este producto"}*`, {
        parse_mode: "Markdown",
        reply_markup: { inline_keyboard: [
            [{ text: "➕ Agregar Duración/Precio", callback_data: `add_opt:${prodId}` }],
            [{ text: "🔑 Agregar Keys a Duración", callback_data: `choose_opt_keys:${prodId}` }],
            [{ text: "🗑️ Eliminar Producto", callback_data: `del_prod:${prodId}` }]
          ] }
      });
    }
    if (data.startsWith('choose_opt_keys:')) {
      const prodId = data.split(':')[1];
      const opciones = (await get(ref(db, `productos/${prodId}/opciones`))).val();
      if (!opciones) { bot.sendMessage(chatId, "⚠️ No tiene duraciones creadas aún."); return responder(); }
      const botones = [];
      for (const optId in opciones) botones.push([{ text: `🔑 ${opciones[optId].titulo} - $${opciones[optId].precio}`, callback_data: `add_keys:${prodId}:${optId}` }]);
      bot.sendMessage(chatId, "Selecciona la duración:", { reply_markup: { inline_keyboard: botones } });
    }
    if (data.startsWith('edit_price_prod:')) {
      const prodId = data.split(':')[1];
      const opciones = (await get(ref(db, `productos/${prodId}/opciones`))).val();
      if (!opciones) { bot.sendMessage(chatId, "⚠️ No tiene duraciones."); return responder(); }
      const botones = [];
      for (const optId in opciones) botones.push([{ text: `${opciones[optId].titulo} (Actual: $${opciones[optId].precio})`, callback_data: `edit_price_opt:${prodId}:${optId}` }]);
      bot.sendMessage(chatId, "Selecciona la duración:", { reply_markup: { inline_keyboard: botones } });
    }
    if (data.startsWith('edit_price_opt:')) {
      const [, prodId, optId] = data.split(':');
      userStates[chatId] = { step: 'AWAITING_NEW_PRICE', prodId, optId };
      bot.sendMessage(chatId, "Escribe el **nuevo precio** (solo número):", { parse_mode: "Markdown" });
    }
    if (data.startsWith('del_prod:')) {
      await remove(ref(db, `productos/${data.split(':')[1]}`));
      bot.sendMessage(chatId, "🗑️ ✅ Producto eliminado.");
    }
    if (data.startsWith('add_opt:')) {
      userStates[chatId] = { step: 'AWAITING_OPT_NAME', prodId: data.split(':')[1] };
      bot.sendMessage(chatId, "Escribe el **título y precio** terminando con $ (Ej: `1 dia 3$`)", { parse_mode: "Markdown" });
    }
    if (data.startsWith('add_keys:')) {
      const [, prodId, optId] = data.split(':');
      userStates[chatId] = { step: 'AWAITING_KEYS', prodId, optId };
      bot.sendMessage(chatId, "Envía las **Keys** una debajo de otra:", { parse_mode: "Markdown" });
    }
  }

  responder();
});

console.log("Bot TEMO STORE iniciado...");
console.log("Bot TIKTOK GRATIS iniciado...");
