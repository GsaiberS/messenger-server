// ============================================
//  КЛИЕНТ МЕССЕНДЖЕРА
//  Измени SERVER_URL на адрес своего сервера
//  после деплоя на Railway!
// ============================================

// ▼▼▼ СЮДА ВСТАВЬ АДРЕС СВОЕГО СЕРВЕРА ▼▼▼
const SERVER_URL = "https://messenger-server-production-1e78.up.railway.app/";
// ▲▲▲ Пример: "wss://my-messenger-production.up.railway.app" ▲▲▲

// ── Состояние ────────────────────────────────
let ws = null;
let myToken = localStorage.getItem("ms_token") || null;
let myUser = null;
let reconnectTimer = null;
let typingTimer = null;
let isTyping = false;
let typingUsers = {};    // userId → { name, timer }
let reactions = {};      // messageId → { emoji → [userId,...] }
let lastMsgDate = null;
let lastMsgUserId = null;
let lastMsgTs = 0;
const GROUP_GAP = 90;    // секунд: группировать сообщения одного автора

// ── Запуск ───────────────────────────────────
window.addEventListener("DOMContentLoaded", () => {
  // Если токен сохранён — сразу подключаемся
  if (myToken) connect();
});

// ── Подключение к серверу ────────────────────
function connect() {
  if (ws && ws.readyState < 2) return;

  ws = new WebSocket(SERVER_URL);

  ws.onopen = () => {
    clearTimeout(reconnectTimer);
    // Авторизуемся (новый или повторный вход)
    ws.send(JSON.stringify({
      type: "auth",
      token: myToken,
      inviteCode: pendingLogin?.code,
      name: pendingLogin?.name,
    }));
  };

  ws.onmessage = (e) => {
    let msg;
    try { msg = JSON.parse(e.data); } catch { return; }
    handleServer(msg);
  };

  ws.onclose = () => {
    updateSubtitle();
    // Переподключение через 3 секунды
    reconnectTimer = setTimeout(() => {
      if (myToken) connect();
    }, 3000);
  };

  ws.onerror = () => ws.close();
}

// ── Обработка сообщений от сервера ───────────
function handleServer(msg) {
  switch (msg.type) {

    case "auth_ok": {
      myToken = msg.token;
      myUser = msg.user;
      localStorage.setItem("ms_token", myToken);
      pendingLogin = null;

      showChatScreen();
      renderMyAvatar();
      updateOnlineList(msg.online);
      updateSubtitle(msg.online);

      // Загружаем историю
      if (msg.history && msg.history.length) {
        msg.history.forEach(renderMessage);
        scrollToBottom(true);
      }
      break;
    }

    case "auth_error": {
      pendingLogin = null;
      showLoginError(msg.message || "Ошибка входа");
      enableLoginBtn();
      break;
    }

    case "message": {
      renderMessage(msg.message);
      scrollToBottomIfNear();

      // Push-уведомление если вкладка не активна
      if (document.hidden && msg.message.userId !== myUser?.id) {
        sendPushNotification(msg.message.userName, msg.message.text);
      }
      break;
    }

    case "online": {
      updateOnlineList(msg.users);
      updateSubtitle(msg.users);
      break;
    }

    case "typing": {
      handleTypingEvent(msg);
      break;
    }

    case "react": {
      applyReaction(msg.messageId, msg.emoji, msg.userId, msg.userName);
      break;
    }
  }
}

// ── Логин ─────────────────────────────────────
let pendingLogin = null;

function doLogin() {
  const name = document.getElementById("input-name").value.trim();
  const code = document.getElementById("input-code").value.trim();

  if (!name || name.length < 2) { showLoginError("Имя должно быть не короче 2 символов"); return; }
  if (!code) { showLoginError("Введите инвайт-код"); return; }

  pendingLogin = { name, code };
  disableLoginBtn();
  hideLoginError();
  connect();
}

function doLogout() {
  myToken = null;
  myUser = null;
  localStorage.removeItem("ms_token");
  if (ws) ws.close();
  showLoginScreen();
}

function showLoginError(text) {
  const el = document.getElementById("login-error");
  el.textContent = text;
  el.style.display = "block";
}
function hideLoginError() { document.getElementById("login-error").style.display = "none"; }
function disableLoginBtn() { document.getElementById("btn-join").disabled = true; document.getElementById("btn-join").textContent = "Подключение..."; }
function enableLoginBtn() { document.getElementById("btn-join").disabled = false; document.getElementById("btn-join").textContent = "Войти"; }

// Нажатие Enter на полях логина
document.addEventListener("DOMContentLoaded", () => {
  ["input-name", "input-code"].forEach(id => {
    document.getElementById(id)?.addEventListener("keydown", e => {
      if (e.key === "Enter") doLogin();
    });
  });
});

// ── Экраны ────────────────────────────────────
function showChatScreen() {
  document.getElementById("login-screen").style.display = "none";
  document.getElementById("chat-screen").style.display = "flex";
  requestPushPermission();
  document.getElementById("msg-input").focus();
}

function showLoginScreen() {
  document.getElementById("chat-screen").style.display = "none";
  document.getElementById("login-screen").style.display = "flex";
  document.getElementById("messages").innerHTML = `
    <div class="messages-start">
      <div class="messages-start-icon">💬</div>
      <p>Начало чата</p>
    </div>`;
  lastMsgDate = null; lastMsgUserId = null; lastMsgTs = 0;
}

// ── Отправка сообщения ────────────────────────
function sendMessage() {
  if (!ws || ws.readyState !== 1) { showToast("Нет соединения, жду..."); return; }

  const input = document.getElementById("msg-input");
  const text = input.value.trim();
  if (!text) return;

  ws.send(JSON.stringify({ type: "message", text }));
  input.value = "";
  autoResize(input);

  // Сбросить "печатает"
  if (isTyping) {
    isTyping = false;
    ws.send(JSON.stringify({ type: "typing", isTyping: false }));
  }
}

// ── Отправка файла ────────────────────────────
function triggerFileUpload() { document.getElementById("file-input").click(); }

function sendFile(input) {
  const file = input.files[0];
  if (!file) return;
  if (file.size > 10 * 1024 * 1024) { showToast("Файл больше 10 МБ"); input.value = ""; return; }

  const reader = new FileReader();
  reader.onload = (e) => {
    if (!ws || ws.readyState !== 1) { showToast("Нет соединения"); return; }
    ws.send(JSON.stringify({
      type: "message",
      text: `📎 ${file.name}`,
      file: {
        name: file.name,
        size: file.size,
        data: e.target.result,  // base64
      },
    }));
  };
  reader.readAsDataURL(file);
  input.value = "";
}

// ── Клавиши ввода ─────────────────────────────
function handleKey(e) {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
}

function handleInput(el) {
  autoResize(el);

  // Индикатор "печатает"
  if (!ws || ws.readyState !== 1) return;
  if (!isTyping) {
    isTyping = true;
    ws.send(JSON.stringify({ type: "typing", isTyping: true }));
  }
  clearTimeout(typingTimer);
  typingTimer = setTimeout(() => {
    isTyping = false;
    ws.send(JSON.stringify({ type: "typing", isTyping: false }));
  }, 2500);
}

function autoResize(el) {
  el.style.height = "auto";
  el.style.height = Math.min(el.scrollHeight, 120) + "px";
}

// ── Рендер сообщения ──────────────────────────
function renderMessage(msg) {
  const container = document.getElementById("messages");
  const isMine = msg.userId === myUser?.id;
  const date = new Date(msg.ts);
  const dateStr = formatDate(date);

  // Разделитель даты
  if (dateStr !== lastMsgDate) {
    lastMsgDate = dateStr;
    const div = document.createElement("div");
    div.className = "date-divider";
    div.innerHTML = `<span>${dateStr}</span>`;
    container.appendChild(div);
    lastMsgUserId = null;
    lastMsgTs = 0;
  }

  // Группировка: тот же автор в течение GROUP_GAP сек
  const gap = (msg.ts - lastMsgTs) / 1000;
  const grouped = (lastMsgUserId === msg.userId) && (gap < GROUP_GAP);

  lastMsgUserId = msg.userId;
  lastMsgTs = msg.ts;

  const timeStr = date.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
  const avatarColor = msg.userColor || "#378ADD";
  const initials = getInitials(msg.userName);

  // Файл или текст?
  let bubbleContent;
  if (msg.file) {
    const sizeStr = formatBytes(msg.file.size);
    bubbleContent = `
      <div class="file-msg ${isMine ? "mine" : "theirs"}">
        <div class="file-icon">📄</div>
        <div class="file-info">
          <div class="file-name" style="${isMine ? "color:white" : ""}">${escHtml(msg.file.name)}</div>
          <div class="file-size">${sizeStr}</div>
        </div>
        <a class="file-dl" href="${msg.file.data}" download="${escHtml(msg.file.name)}" title="Скачать">⬇</a>
      </div>`;
  } else {
    bubbleContent = `<div class="bubble ${isMine ? "mine" : "theirs"}">${escHtml(msg.text)}</div>`;
  }

  const row = document.createElement("div");
  row.className = `msg-row ${isMine ? "mine" : "theirs"}${grouped ? " grouped" : ""}`;
  row.dataset.id = msg.id;
  row.innerHTML = `
    <div class="avatar" style="background:${avatarColor}" title="${escHtml(msg.userName)}">${initials}</div>
    <div class="bubble-wrap">
      ${!grouped && !isMine ? `<div class="bubble-name" style="color:${avatarColor}">${escHtml(msg.userName)}</div>` : ""}
      ${bubbleContent}
      <div class="bubble-meta">
        <span class="bubble-time">${timeStr}</span>
        ${isMine ? `<span class="bubble-status">✓✓</span>` : ""}
      </div>
      <div class="reactions" id="react-${msg.id}"></div>
    </div>`;

  // Долгое нажатие / правый клик — реакции
  row.addEventListener("contextmenu", (e) => { e.preventDefault(); showEmojiPicker(e, msg.id); });
  let longTap;
  row.addEventListener("touchstart", () => { longTap = setTimeout(() => showEmojiPicker(null, msg.id, row), 500); });
  row.addEventListener("touchend", () => clearTimeout(longTap));
  row.addEventListener("touchmove", () => clearTimeout(longTap));

  container.appendChild(row);
}

// ── Эмодзи-реакции ────────────────────────────
const EMOJIS = ["👍", "❤️", "😂", "😮", "😢", "🔥"];

let activePickerEl = null;

function showEmojiPicker(e, msgId, anchorEl) {
  closeEmojiPicker();

  const picker = document.createElement("div");
  picker.className = "emoji-picker";
  picker.id = "emoji-picker";

  EMOJIS.forEach(em => {
    const span = document.createElement("span");
    span.textContent = em;
    span.onclick = () => {
      sendReaction(msgId, em);
      closeEmojiPicker();
    };
    picker.appendChild(span);
  });

  // Позиция
  if (e) {
    picker.style.position = "fixed";
    picker.style.top = (e.clientY - 60) + "px";
    picker.style.left = Math.min(e.clientX - 80, window.innerWidth - 230) + "px";
  } else if (anchorEl) {
    const rect = anchorEl.getBoundingClientRect();
    picker.style.position = "fixed";
    picker.style.top = Math.max(rect.top - 60, 8) + "px";
    picker.style.left = Math.min(rect.left, window.innerWidth - 230) + "px";
  }

  document.body.appendChild(picker);
  activePickerEl = picker;

  setTimeout(() => {
    document.addEventListener("click", closeEmojiPicker, { once: true });
  }, 0);
}

function closeEmojiPicker() {
  if (activePickerEl) { activePickerEl.remove(); activePickerEl = null; }
}

function sendReaction(msgId, emoji) {
  if (!ws || ws.readyState !== 1) return;
  ws.send(JSON.stringify({ type: "react", messageId: msgId, emoji }));
}

function applyReaction(msgId, emoji, userId, userName) {
  if (!reactions[msgId]) reactions[msgId] = {};
  if (!reactions[msgId][emoji]) reactions[msgId][emoji] = new Set();
  reactions[msgId][emoji].add(userId);
  rerenderReactions(msgId);
}

function rerenderReactions(msgId) {
  const el = document.getElementById(`react-${msgId}`);
  if (!el) return;
  el.innerHTML = "";
  const r = reactions[msgId] || {};
  Object.entries(r).forEach(([emoji, users]) => {
    if (!users.size) return;
    const pill = document.createElement("div");
    pill.className = "reaction-pill";
    pill.innerHTML = `${emoji} <span class="reaction-count">${users.size}</span>`;
    pill.onclick = () => sendReaction(msgId, emoji);
    el.appendChild(pill);
  });
}

// ── Индикатор "печатает" ──────────────────────
function handleTypingEvent(msg) {
  if (msg.isTyping) {
    typingUsers[msg.userId] = msg.userName;
  } else {
    delete typingUsers[msg.userId];
  }
  updateTypingBadge();
}

function updateTypingBadge() {
  const el = document.getElementById("typing-badge");
  const names = Object.values(typingUsers);
  if (!names.length) { el.style.display = "none"; return; }
  const text = names.length === 1
    ? `${names[0]} печатает...`
    : `${names.join(", ")} печатают...`;
  el.textContent = text;
  el.style.display = "block";
}

// ── Online-список ─────────────────────────────
function updateOnlineList(users) {
  const el = document.getElementById("online-list");
  el.innerHTML = "";
  (users || []).forEach(u => {
    const item = document.createElement("div");
    item.className = "online-item";
    const isMe = u.id === myUser?.id;
    item.innerHTML = `
      <div class="avatar" style="background:${u.color};width:28px;height:28px;font-size:11px">${getInitials(u.name)}</div>
      <div class="online-dot-badge"></div>
      <span class="online-item-name">${escHtml(u.name)}</span>
      ${isMe ? `<span class="online-item-you">я</span>` : ""}`;
    el.appendChild(item);
  });
}

function updateSubtitle(users) {
  const el = document.getElementById("header-sub");
  if (!ws || ws.readyState !== 1) {
    el.textContent = "переподключение...";
    return;
  }
  const n = users ? users.length : 0;
  el.textContent = n > 0 ? `${n} в сети` : "нет участников";
}

function renderMyAvatar() {
  const el = document.getElementById("my-avatar-mini");
  if (!myUser) return;
  el.style.background = myUser.color;
  el.style.width = "28px"; el.style.height = "28px"; el.style.fontSize = "11px";
  el.textContent = getInitials(myUser.name);
}

// ── Прокрутка ─────────────────────────────────
function scrollToBottom(instant) {
  const el = document.getElementById("messages");
  el.scrollTo({ top: el.scrollHeight, behavior: instant ? "auto" : "smooth" });
}

function scrollToBottomIfNear() {
  const el = document.getElementById("messages");
  const threshold = 120;
  if (el.scrollHeight - el.scrollTop - el.clientHeight < threshold) {
    scrollToBottom(false);
  }
}

// ── Мобильный sidebar ─────────────────────────
function openSidebar() {
  document.getElementById("sidebar").classList.add("open");
  document.getElementById("sidebar-overlay").classList.add("show");
}
function closeSidebar() {
  document.getElementById("sidebar").classList.remove("open");
  document.getElementById("sidebar-overlay").classList.remove("show");
}

// ── Push-уведомления ──────────────────────────
function requestPushPermission() {
  if ("Notification" in window && Notification.permission === "default") {
    Notification.requestPermission();
  }
}

function sendPushNotification(name, text) {
  if (!("Notification" in window) || Notification.permission !== "granted") return;
  new Notification(name, {
    body: text.length > 80 ? text.slice(0, 80) + "…" : text,
    icon: "icons/icon-192.png",
    tag: "chat-msg",   // заменяет предыдущее уведомление
    renotify: true,
  });
}

// ── Тост ──────────────────────────────────────
let toastTimer;
function showToast(text, duration = 2500) {
  const el = document.getElementById("toast");
  el.textContent = text;
  el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), duration);
}

// ── Утилиты ───────────────────────────────────
function getInitials(name) {
  if (!name) return "?";
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return name.slice(0, 2).toUpperCase();
}

function escHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function formatDate(d) {
  const today = new Date();
  const yesterday = new Date(); yesterday.setDate(yesterday.getDate() - 1);
  if (isSameDay(d, today)) return "Сегодня";
  if (isSameDay(d, yesterday)) return "Вчера";
  return d.toLocaleDateString("ru-RU", { day: "numeric", month: "long" });
}

function isSameDay(a, b) {
  return a.getFullYear() === b.getFullYear() &&
         a.getMonth() === b.getMonth() &&
         a.getDate() === b.getDate();
}

function formatBytes(n) {
  if (n < 1024) return n + " Б";
  if (n < 1024 * 1024) return Math.round(n / 1024) + " КБ";
  return (n / (1024 * 1024)).toFixed(1) + " МБ";
}
