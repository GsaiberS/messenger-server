# 🔐 Приватный мессенджер — Инструкция по запуску

---

## Что умеет

- Мгновенные сообщения через WebSocket
- Отправка файлов (до 10 МБ)
- Реакции на сообщения (долгое нажатие / правый клик)
- Индикатор "печатает..."
- Push-уведомления в браузере
- Устанавливается на телефон как приложение (PWA)
- Тёмная тема автоматически
- Группировка сообщений одного автора
- Авторизация по инвайт-кодам (без номеров телефонов)

---

## ШАГИ: Деплой сервера на Railway (бесплатно)

### 1. Зарегистрируйся на Railway
Перейди на https://railway.app и войди через GitHub.

### 2. Создай GitHub-репозиторий
- Зайди на https://github.com/new
- Назови его `messenger-server` (приватный)
- Создай репозиторий

### 3. Загрузи файлы сервера
Загрузи на GitHub всё из папки `server/`:
- `index.js`
- `package.json`
- `railway.toml`

Через сайт GitHub: нажми "Add file" → "Upload files".

### 4. Деплой на Railway
- На https://railway.app нажми "New Project"
- Выбери "Deploy from GitHub repo"
- Выбери свой `messenger-server`
- Railway автоматически запустит сервер!

### 5. Получи адрес сервера
- В Railway открой свой проект
- Вкладка "Settings" → "Networking" → "Generate Domain"
- Скопируй адрес вида: `your-app.up.railway.app`

---

## ШАГИ: Деплой клиента на Netlify (бесплатно)

### 1. Открой `client/app.js` и замени адрес сервера

Найди строку:
```js
const SERVER_URL = "wss://your-server.up.railway.app";
```

Замени `your-server.up.railway.app` на адрес из Railway.
Пример:
```js
const SERVER_URL = "wss://messenger-server-production.up.railway.app";
```

### 2. Зарегистрируйся на Netlify
Перейди на https://app.netlify.com

### 3. Загрузи папку client
- Нажми "Add new site" → "Deploy manually"
- Перетащи папку `client/` прямо в браузер
- Готово! Netlify даст тебе ссылку вида: `https://amazing-name-123.netlify.app`

---

## ШАГИ: Добавить иконки (для красивой установки на телефон)

Создай папку `client/icons/` и положи туда два PNG-файла:
- `icon-192.png` (192×192 пикселей)
- `icon-512.png` (512×512 пикселей)

Можно сгенерировать на https://favicon.io или нарисовать любые.

---

## ШАГИ: Добавить Service Worker (PWA)

Чтобы мессенджер работал как приложение — добавь в конец `<head>` файла `index.html`:

```html
<script>
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js');
  }
</script>
```

---

## Добавление новых друзей

Открой `server/index.js` и найди блок:
```js
const INVITE_CODES = new Set([
  "friend-alfa",
  ...
]);
```

Добавь любые коды для новых людей:
```js
"мой-секретный-код-2024",
```

После изменения запушь в GitHub — Railway автоматически перезапустит сервер.

---

## Изменение инвайт-кодов

Просто придумай любую строку без пробелов. Примеры:
- `вася-2024`
- `supercode`
- `x7k9m2`

Раздавай друзьям по одному — они используют его один раз при регистрации.

---

## Хранение истории (необязательно)

По умолчанию история хранится в памяти (последние 200 сообщений).
Если сервер перезапустится — история сотрётся.

Чтобы сохранять навсегда, добавь SQLite:

```bash
# В папке server:
npm install better-sqlite3
```

Затем в `index.js` после строки `const history = [];` добавь:
```js
const Database = require("better-sqlite3");
const db = new Database("chat.db");
db.exec(`CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  userId TEXT, userName TEXT, userColor TEXT,
  text TEXT, file TEXT, ts INTEGER
)`);
```

И замени `history.push(message)` на:
```js
db.prepare(`INSERT INTO messages VALUES (?,?,?,?,?,?,?)`).run(
  message.id, message.userId, message.userName, message.userColor,
  message.text, message.file ? JSON.stringify(message.file) : null, message.ts
);
```

---

## Стоимость

| Сервис | Цена |
|--------|------|
| Railway (до 500 часов/мес) | $0 |
| Netlify (статика) | $0 |
| **Итого** | **$0/мес** |

Railway даёт 500 бесплатных часов в месяц — этого хватит на 20 дней непрерывной работы.
Если нужно больше — $5/мес за Hobby план (без лимита).

---

## Если что-то не работает

1. **Не подключается** — проверь адрес в `app.js`, там должно быть `wss://` (не `ws://`)
2. **Неверный инвайт-код** — проверь `INVITE_CODES` в `server/index.js`
3. **Нет уведомлений** — нажми "Разрешить" когда браузер спросит
4. **Не устанавливается как приложение** — открой сайт в Chrome, в меню появится "Добавить на главный экран"
