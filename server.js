// server.js - トークン共有防止（Aが閉じるまでB使えない）
const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const app = express();
const port = process.env.PORT || 3000;

// === 環境変数 ===
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
if (!ADMIN_PASSWORD) {
  console.error("ERROR: ADMIN_PASSWORDが未設定！");
  process.exit(1);
}

// === Express設定 ===
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// === SQLite DB ===
const dbPath = path.join(__dirname, 'tokens.db');
const db = new sqlite3.Database(dbPath);

// テーブル作成
db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS tokens (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      token TEXT UNIQUE NOT NULL,
      user TEXT NOT NULL,
      expires TEXT NOT NULL,
      uses INTEGER DEFAULT 10,
      used INTEGER DEFAULT 0,
      created DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
  db.run(`
    CREATE TABLE IF NOT EXISTS sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      token TEXT NOT NULL,
      session_id TEXT UNIQUE NOT NULL
    )
  `);
});

// === キャッシュ ===
let tokenCache = {};
let sessionCache = {};

async function updateCache() {
  return new Promise((resolve) => {
    db.all("SELECT * FROM tokens", (err, rows) => {
      tokenCache = {};
      rows.forEach(row => tokenCache[row.token] = row);
    });
    db.all("SELECT * FROM sessions", (err, rows) => {
      sessionCache = {};
      rows.forEach(row => sessionCache[row.session_id] = row);
    });
    resolve();
  });
}

updateCache();

// === ログイン画面 ===
function getLoginHTML(error = '') {
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>管理画面</title>
  <style>body{font-family:sans-serif;background:#f0f0f0;padding:50px;text-align:center;}
  .card{background:white;padding:30px;border-radius:15px;display:inline-block;box-shadow:0 4px 15px rgba(0,0,0,0.1);}
  input,button{padding:12px;margin:10px;width:280px;border:1px solid #ddd;border-radius:8px;}
  button{background:#4CAF50;color:white;font-weight:bold;cursor:pointer;}
  .error{color:red;font-weight:bold;}</style></head><body>
  <div class="card"><h2>MilkChoco 管理画面</h2>
  <form method="POST" action="/login"><input type="password" name="password" placeholder="パスワード" required><br>
  <button type="submit">ログイン</button></form>${error ? `<p class="error">${error}</p>` : ''}</div></body></html>`;
}

function requireAuth(req, res, next) {
  const password = req.body.password || req.query.password;
  if (password === ADMIN_PASSWORD) return next();
  res.send(getLoginHTML('パスワードが間違っています'));
}

// === ルート ===
app.get('/', (req, res) => res.send(getLoginHTML()));
app.post('/login', requireAuth, (req, res) => res.redirect('/dashboard'));

app.get('/dashboard', async (req, res) => {
  await updateCache();
  let html = `<h1>Token Manager</h1><ul>`;
  for (const [t, d] of Object.entries(tokenCache)) {
    const remaining = d.uses - d.used;
    const expired = new Date(d.expires) < new Date();
    const active = Object.values(sessionCache).find(s => s.token === t);
    html += `<li><b>${t}</b> - ${d.user} - ${expired ? '期限切れ' : '残り: ' + remaining + '回'} 
      - 使用中: ${active ? 'はい' : 'いいえ'}
      <a href="/delete?token=${t}" style="color:red;" onclick="return confirm('無効化？');">[無効化]</a></li>`;
  }
  html += `</ul><hr>
    <form action="/add" method="POST">
      Token: <input name="token" value="FREE-${Math.random().toString(36).substr(2,16).toUpperCase()}" readonly><br><br>
      ユーザー: <input name="user" required><br><br>
      期限: <input name="expires" type="date" required><br><br>
      回数: <input name="uses" type="number" value="10" min="1" required><br><br>
      <button>発行</button>
    </form>
    <p><a href="/">ログアウト</a></p>`;
  res.send(html);
});

app.post('/add', (req, res) => {
  const { token, user, expires, uses } = req.body;
  db.run("INSERT OR REPLACE INTO tokens (token, user, expires, uses, used) VALUES (?, ?, ?, ?, 0)",
    [token, user, expires, parseInt(uses)], async () => {
      await updateCache();
      res.redirect('/dashboard');
    });
});

app.get('/delete', async (req, res) => {
  const token = req.query.token;
  if (token) {
    db.run("DELETE FROM tokens WHERE token = ?", [token]);
    db.run("DELETE FROM sessions WHERE token = ?", [token]);
  }
  await updateCache();
  res.redirect('/dashboard');
});

// === API：認証 + 共有防止 ===
app.get('/api/check', async (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  const token = req.query.token;
  const sessionId = req.query.sessionId;

  if (!token || !sessionId) return res.json({ valid: false, msg: 'Invalid request' });

  if (token === 'HEALTH') {
    res.setHeader('Content-Length', '10');
    return res.end('{"ok":true}');
  }

  await updateCache();
  const data = tokenCache[token];

  if (!data || new Date(data.expires) < new Date() || data.used >= data.uses) {
    return res.json({ valid: false, msg: '無効なToken' });
  }

  const existing = Object.values(sessionCache).find(s => s.token === token);
  if (existing && existing.session_id !== sessionId) {
    return res.json({ valid: false, msg: 'Token always using' });
  }

  db.run("INSERT OR REPLACE INTO sessions (token, session_id) VALUES (?, ?)", [token, sessionId]);
  data.used++;
  db.run("UPDATE tokens SET used = ? WHERE token = ?", [data.used, token]);

  res.json({ valid: true, sessionId });
});

// === ログアウトAPI ===
app.post('/api/logout', (req, res) => {
  const { token, sessionId } = req.body;
  if (token && sessionId) {
    db.run("DELETE FROM sessions WHERE token = ? AND session_id = ?", [token, sessionId]);
  }
  res.json({ success: true });
});

app.listen(port, () => console.log(`Server on port ${port}`));
