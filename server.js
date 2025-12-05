// server.js（これに全部置き換えてGitHubにpushするだけ！）
const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');
const app = express();

// === 環境変数 ===
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
if (!ADMIN_PASSWORD) {
  console.error("ADMIN_PASSWORDが未設定です！");
  process.exit(1);
}

// === VercelでもRenderでも動くDBパス ===
const isVercel = process.env.VERCEL || process.env.RENDER;
const dbPath = isVercel 
  ? '/tmp/tokens.db'      // Vercelはここにしか書き込めない（でも再起動後も残る！）
  : path.join(__dirname, 'tokens.db');  // Renderやローカルはこっち

// ディレクトリがなければ作る（Vercel初回用）
if (isVercel) {
  const dir = path.dirname(dbPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

const db = new sqlite3.Database(dbPath, (err) => {
  if (err) console.error("DB接続失敗:", err);
  else console.log(`DB接続成功: ${dbPath}`);
});

// テーブル作成（同じ）
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
});

// === 以下はあなたのコードを100%そのままコピー ===
// （見た目も動きも全く同じになるよう、そのまま貼り付け）

let tokenCache = {};

async function updateCache() {
  return new Promise((resolve) => {
    db.all("SELECT * FROM tokens", (err, rows) => {
      if (err) return resolve();
      tokenCache = {};
      rows.forEach(row => tokenCache[row.token] = row);
      resolve();
    });
  });
}
updateCache();

function getLoginHTML(error = '') {
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>管理画面ログイン</title><style>body{font-family:sans-serif;background:#f0f0f0;padding:50px;text-align:center}.card{background:white;padding:30px;border-radius:15px;display:inline-block;box-shadow:0 4px 15px rgba(0,0,0,0.1)}input,button{padding:12px;margin:10px;width:280px;border:1px solid #ddd;border-radius:8px}button{background:#4CAF50;color:white;font-weight:bold;cursor:pointer}button:hover{background:#45a049}.error{color:red;font-weight:bold}</style></head><body><div class="card"><h2>MilkChoco 管理画面</h2><form method="POST" action="/login"><input type="password" name="password" placeholder="パスワード" required autofocus><br><button type="submit">ログイン</button></form>${error ? `<p class="error">${error}</p>` : ''}</div></body></html>`;
}

function requireAuth(req, res, next) {
  const password = req.body.password || req.query.password;
  if (password === ADMIN_PASSWORD) return next();
  res.send(getLoginHTML('パスワードが間違っています'));
}

app.use(express.urlencoded({ extended: true }));
app.use(express.json());

app.get('/', (req, res) => res.send(getLoginHTML()));
app.post('/login', requireAuth, (req, res) => res.redirect('/dashboard'));

app.get('/dashboard', async (req, res) => {
  await updateCache();
  let html = `<h1>Token Manager</h1><ul>`;
  for (const [t, d] of Object.entries(tokenCache)) {
    const remaining = d.uses - d.used;
    const expired = new Date(d.expires) < new Date());
    html += `<li><b>${t}</b> - ${d.user} - ${expired ? '期限切れ' : '残り: ' + remaining + '回'} - ${d.expires} <a href="/delete?token=${t}" style="color:red;" onclick="return confirm('無効化？');">[無効化]</a></li>`;
  }
  html += `</ul><hr><form action="/add" method="POST">Token: <input name="token" value="FREE-${Math.random().toString(36).substr(2,16).toUpperCase()}" readonly><br><br>ユーザー: <input name="user" required><br><br>期限: <input name="expires" type="date" required><br><br>回数: <input name="uses" type="number" value="10" min="1" required><br><br><button>発行</button></form><p><a href="/">ログアウト</a></p>`;
  res.send(html);
});

app.post('/add', (req, res) => {
  const { token, user, expires, uses } = req.body;
  db.run("INSERT OR REPLACE INTO tokens (token, user, expires, uses, used) VALUES (?, ?, ?, ?, 0)",
    [token, user, expires, parseInt(uses)],
    async () => { await updateCache(); res.redirect('/dashboard'); }
  );
});

app.get('/delete', async (req, res) => {
  const token = req.query.token;
  db.run("DELETE FROM tokens WHERE token = ?", [token], async () => {
    await updateCache(); res.redirect('/dashboard');
  });
});

app.get('/api/check', async (req, res) => {
  const token = req.query.token;
  if (token === 'HEALTH') return res.json({ valid: false, msg: 'Server is alive' });
  const data = tokenCache[token];
  if (!data || new Date(data.expires) < new Date() || data.used >= data.uses) {
    return res.json({ valid: false, msg: '無効なToken' });
  }
  data.used++;
  db.run("UPDATE tokens SET used = ? WHERE token = ?", [data.used, token]);
  res.json({ valid: true });
});

app.listen(process.env.PORT || 3000, () => {
  console.log(`Server running → ${isVercel ? 'Vercel' : 'Render/Local'}`);
});
