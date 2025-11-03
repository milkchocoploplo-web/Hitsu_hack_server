const express = require('express');
const app = express();

app.use(express.json());
app.use(express.static('public'));

let tokens = []; // メモリDB

function generateToken() {
  return 'FREE-' + Math.random().toString(36).substr(2, 10).toUpperCase();
}

// === POST /generate ===
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
  console.log('発行:', token);
  res.json({
    success: true,
    token,
    user,
    expires: new Date(record.expires).toISOString().split('T')[0],
    uses
  });
});

// === POST /validate ===
app.post('/validate', (req, res) => {
  const { token } = req.body;
  console.log('検証:', token);
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

// === GET / - 発行ページ ===
app.get('/', (req, res) => {
  res.sendFile(__dirname + '/public/index.html');
});

// === GET /tokens - 管理画面（HTML） ===
app.get('/tokens', (req, res) => {
  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <title>トークン管理</title>
      <style>
        body { font-family: sans-serif; padding: 20px; background: #f0f0f0; }
        .card { background: white; padding: 20px; border-radius: 10px; margin-bottom: 20px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
        table { width: 100%; border-collapse: collapse; }
        th, td { padding: 10px; text-align: left; border-bottom: 1px solid #ddd; }
        th { background: #f4f4f4; }
        .token { font-family: monospace; background: #ddd; padding: 2px 6px; }
        button { padding: 5px 10px; background: #e74c3c; color: white; border: none; border-radius: 3px; cursor: pointer; }
        button:hover { background: #c0392b; }
        button:disabled { background: #ccc; cursor: not-allowed; }
        .expired { color: #ff6b6b; font-weight: bold; }
      </style>
    </head>
    <body>
      <div class="card">
        <h2>トークン管理画面</h2>
        <p><a href="/">← 発行ページに戻る</a></p>
        <table>
          <tr><th>トークン</th><th>ユーザー</th><th>期限</th><th>残り回数</th><th>作成日</th><th>操作</th></tr>
          ${tokens.map(t => {
            const expired = t.expires < Date.now();
            return `
              <tr ${expired ? 'class="expired"' : ''}>
                <td><span class="token">${t.token}</span></td>
                <td>${t.user}</td>
                <td>${new Date(t.expires).toISOString().split('T')[0]}</td>
                <td>${expired ? '期限切れ' : t.uses}</td>
                <td>${t.created.split('T')[0]}</td>
                <td>
                  <button onclick="invalidate('${t.token}')" ${expired ? 'disabled' : ''}>
                    無効化
                  </button>
                </td>
              </tr>
            `;
          }).join('')}
        </table>
        <p>総トークン数: ${tokens.length}</p>
      </div>

      <script>
        async function invalidate(token) {
          if (!confirm('このトークンを無効化しますか？')) return;
          const res = await fetch('/invalidate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ token })
          });
          const data = await res.json();
          if (data.success) {
            location.reload();
          } else {
            alert('無効化失敗: ' + data.message);
          }
        }
      </script>
    </body>
    </html>
  `;
  res.send(html);
});

// === POST /invalidate - 無効化API ===
app.post('/invalidate', (req, res) => {
  const { token } = req.body;
  const index = tokens.findIndex(t => t.token === token);
  if (index === -1) {
    return res.json({ success: false, message: 'トークンが見つかりません' });
  }
  tokens[index].uses = 0; // 回数を0に → 即無効化
  console.log('無効化:', token);
  res.json({ success: true, message: '無効化完了' });
});

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Server on port ${port}`);
});
