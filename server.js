// server.js - 完全版（発行 + 検証 + 管理）
const express = require('express');
const app = express();
app.use(express.json());
app.use(express.static('public')); // ← HTMLを置くフォルダ

// === メモリDB（再起動で消える → 後でDBに変更可）===
let tokens = [];

// === トークン生成関数 ===
function generateToken() {
  return 'FREE-' + Math.random().toString(36).substr(2, 10).toUpperCase();
}

// === POST /generate - トークン発行 ===
app.post('/generate', (req, res) => {
  const { user = "anonymous", expires_days = 30, uses = 10 } = req.body;

  const token = generateToken();
  const record = {
    token,
    user,
    expires: Date.now() + (expires_days * 24 * 60 * 60 * 1000),
    uses: parseInt(uses),
    created: new Date().toISOString()
  };

  tokens.push(record);
  console.log('新規トークン発行:', token, 'ユーザー:', user);

  res.json({
    success: true,
    token,
    user,
    expires: new Date(record.expires).toISOString().split('T')[0],
    uses
  });
});

// === POST /validate - 検証 ===
app.post('/validate', (req, res) => {
  const { token } = req.body;
  const record = tokens.find(t => t.token === token);

  if (!record) {
    return res.json({ valid: false, message: "無効なトークンです" });
  }
  if (record.expires < Date.now()) {
    return res.json({ valid: false, message: "期限切れです" });
  }
  if (record.uses <= 0) {
    return res.json({ valid: false, message: "回数超過です" });
  }

  record.uses--;
  res.json({
    valid: true,
    user: record.user,
    expires: new Date(record.expires).toISOString().split('T')[0],
    uses_left: record.uses
  });
});

// === GET / - 管理画面 ===
app.get('/', (req, res) => {
  res.sendFile(__dirname + '/public/index.html');
});

// === GET /tokens - 管理用（後でパスワード保護）===
app.get('/tokens', (req, res) => {
  res.json(tokens.map(t => ({
    token: t.token,
    user: t.user,
    expires: new Date(t.expires).toISOString().split('T')[0],
    uses_left: t.uses
  })));
});

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Token Server: https://token-milkchocoexe-ribon.onrender.com`);
});
