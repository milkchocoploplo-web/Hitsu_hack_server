// server.js - タイポ修正版（APIエラー解決）
const express = require('express');
const app = express();
const port = process.env.PORT || 3000;

// === 環境変数 ===
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

if (!ADMIN_PASSWORD) {
  console.error("ADMIN_PASSWORDが未設定！Render.comで設定してください");
  process.exit(1);
}

app.use(express.urlencoded({ extended: true }));
app.use(express.json());

let tokens = {};

// === ログイン画面 ===
function getLoginHTML(error = '') {
  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>管理画面ログイン</title>
  <style>
    body {font-family: sans-serif; background: #f0f0f0; padding: 50px; text-align: center;}
    .card {background: white; padding: 30px; border-radius: 15px; display: inline-block; box-shadow: 0 4px 15px rgba(0,0,0,0.1);}
    input, button {padding: 12px; margin: 10px; width: 280px; border: 1px solid #ddd; border-radius: 8px;}
    button {background: #4CAF50; color: white; font-weight: bold; cursor: pointer;}
    button:hover {background: #45a049;}
    .error {color: red; font-weight: bold;}
  </style>
</head>
<body>
  <div class="card">
    <h2>MilkChoco 管理画面</h2>
    <form method="POST" action="/login">
      <input type="password" name="password" placeholder="パスワード" required autofocus><br>
      <button type="submit">ログイン</button>
    </form>
    ${error ? `<p class="error">${error}</p>` : ''}
  </div>
</body>
</html>`;
}

// === 認証ミドルウェア ===
function requireAuth(req, res, next) {
  const password = req.body.password || req.query.password;
  if (password === ADMIN_PASSWORD) {
    return next();
  }
  res.send(getLoginHTML('パスワードが間違っています'));
}

// === ルート定義 ===

// 1. ログイン画面（GET /）
app.get('/', (req, res) => {
  res.send(getLoginHTML());
});

// 2. ログイン処理（POST /login）
app.post('/login', requireAuth, (req, res) => {
  res.redirect('/dashboard');
});

// 3. 管理画面（/dashboard）
app.get('/dashboard', (req, res) => {
  let html = `<h1>Token Manager</h1><ul>`;
  for (const [t, d] of Object.entries(tokens)) {
    const remaining = d.uses - d.used;
    const expired = new Date(d.expires) < new Date();
    html += `<li><b>${t}</b> - ${d.user} - ${expired ? '期限切れ' : '残り: ' + remaining + '回'} - ${d.expires} 
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

// 4. トークン発行
app.post('/add', (req, res) => {
  const { token, user, expires, uses } = req.body;
  if (!token || !user || !expires || !uses) return res.send('入力漏れ');
  tokens[token] = { user, expires, uses: parseInt(uses), used: 0 };
  res.redirect('/dashboard');
});

// 5. 無効化
app.get('/delete', (req, res) => {
  const token = req.query.token;
  if (token && tokens[token]) delete tokens[token];
  res.redirect('/dashboard');
});

// 6. API（公開） - タイポ修正！
app.get('/api/check', (req, res) => {
  const token = req.query.token;
  const data = tokens[token];
  if (!data || new Date(data.expires) < new Date() || data.used >= data.uses) {
    return res.json({ valid: false, msg: '無効なToken' });
  }
  data.used++;
  res.json({ valid: true });
});

app.listen(port, () => {
  console.log(`Server on port ${port}`);
  console.log(`ログイン: https://token-milkchocoexe-ribon.onrender.com`);
});
