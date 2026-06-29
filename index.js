// ============================================
//  СЕРВЕР МЕССЕНДЖЕРА
//  Запуск: node index.js
//  Порт: process.env.PORT или 3001
// ============================================

const http = require("http");
const { WebSocketServer } = require("ws");
const crypto = require("crypto");

const PORT = process.env.PORT || 3001;

// ── Хранилище в памяти ──────────────────────
// Для 5-20 человек этого хватит.
// Если нужна история после перезапуска — добавь SQLite (см. README).
const users = new Map();   // token → { id, name, color }
const clients = new Map(); // ws → token
const history = [];        // последние 200 сообщений
const MAX_HISTORY = 200;

// ── Инвайт-коды ─────────────────────────────
// Добавляй сюда коды для друзей. Можно генерировать любые строки.
// После регистрации код остаётся рабочим (один код = один пользователь).
const INVITE_CODES = new Set([
  "friend-alfa",
  "friend-beta",
  "friend-gamma",
  "friend-delta",
  "friend-epsilon",
  "friend-zeta",
  "friend-eta",
  "friend-theta",
  "friend-iota",
  "friend-kappa",
  "friend-lambda",
  "friend-mu",
  "friend-nu",
  "friend-xi",
  "friend-omicron",
  "friend-pi",
  "friend-rho",
  "friend-sigma",
  "friend-tau",
  "friend-upsilon",
]);

// Цвета аватаров — присваиваются при регистрации
const COLORS = [
  "#378ADD", "#1D9E75", "#D85A30", "#7F77DD",
  "#639922", "#BA7517", "#D4537E", "#E24B4A",
];

// ── HTTP-сервер (нужен Railway для health-check) ─
const server = http.createServer((req, res) => {
  if (req.url === "/health") {
    res.writeHead(200);
    res.end("ok");
    return;
  }
  res.writeHead(200, { "Content-Type": "text/plain" });
  res.end("Messenger server running");
});

// ── WebSocket-сервер ─────────────────────────
const wss = new WebSocketServer({ server });

wss.on("connection", (ws) => {
  console.log("New connection");

  ws.on("message", (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    switch (msg.type) {

      // ── Регистрация / логин ──────────────────
      case "auth": {
        const { inviteCode, name, token } = msg;

        // Повторный вход по токену
        if (token && users.has(token)) {
          const user = users.get(token);
          clients.set(ws, token);
          ws.send(JSON.stringify({
            type: "auth_ok",
            token,
            user,
            history: history.slice(-50), // последние 50 сообщений
            online: getOnlineList(),
          }));
          broadcastPresence();
          return;
        }

        // Новая регистрация по инвайт-коду
        if (!INVITE_CODES.has(inviteCode)) {
          ws.send(JSON.stringify({ type: "auth_error", message: "Неверный инвайт-код" }));
          return;
        }
        if (!name || name.trim().length < 2) {
          ws.send(JSON.stringify({ type: "auth_error", message: "Имя слишком короткое" }));
          return;
        }

        const newToken = crypto.randomBytes(24).toString("hex");
        const color = COLORS[users.size % COLORS.length];
        const user = { id: newToken.slice(0, 8), name: name.trim(), color };

        users.set(newToken, user);
        clients.set(ws, newToken);

        ws.send(JSON.stringify({
          type: "auth_ok",
          token: newToken,
          user,
          history: history.slice(-50),
          online: getOnlineList(),
        }));
        broadcastPresence();
        break;
      }

      // ── Отправка сообщения ───────────────────
      case "message": {
        const token = clients.get(ws);
        if (!token) return;
        const user = users.get(token);
        if (!user) return;

        const text = (msg.text || "").trim().slice(0, 4000);
        if (!text) return;

        const message = {
          id: crypto.randomBytes(8).toString("hex"),
          userId: user.id,
          userName: user.name,
          userColor: user.color,
          text,
          ts: Date.now(),
        };

        history.push(message);
        if (history.length > MAX_HISTORY) history.shift();

        broadcast({ type: "message", message });
        break;
      }

      // ── Статус "печатает" ────────────────────
      case "typing": {
        const token = clients.get(ws);
        if (!token) return;
        const user = users.get(token);
        if (!user) return;
        broadcastExcept(ws, {
          type: "typing",
          userId: user.id,
          userName: user.name,
          isTyping: !!msg.isTyping,
        });
        break;
      }

      // ── Реакция на сообщение ─────────────────
      case "react": {
        const token = clients.get(ws);
        if (!token) return;
        const user = users.get(token);
        if (!user) return;
        broadcast({
          type: "react",
          messageId: msg.messageId,
          emoji: msg.emoji,
          userId: user.id,
          userName: user.name,
        });
        break;
      }
    }
  });

  ws.on("close", () => {
    clients.delete(ws);
    broadcastPresence();
    console.log("Disconnected");
  });
});

// ── Утилиты ──────────────────────────────────
function broadcast(data) {
  const str = JSON.stringify(data);
  wss.clients.forEach((c) => { if (c.readyState === 1) c.send(str); });
}

function broadcastExcept(except, data) {
  const str = JSON.stringify(data);
  wss.clients.forEach((c) => { if (c !== except && c.readyState === 1) c.send(str); });
}

function broadcastPresence() {
  broadcast({ type: "online", users: getOnlineList() });
}

function getOnlineList() {
  const list = [];
  clients.forEach((token) => {
    const u = users.get(token);
    if (u) list.push({ id: u.id, name: u.name, color: u.color });
  });
  return list;
}

server.listen(PORT, () => {
  console.log(`✅ Сервер запущен на порту ${PORT}`);
});
