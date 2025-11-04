const express = require('express');
const app = express();
const port = process.env.PORT || 3000;

app.use(express.urlencoded({ extended: true }));

let tokens = {};  // メモリに保存（無料プラン）

// API: Token認証
app.get('/api/check', (req, res) => {
  const token = req.query.token;
  const data = tokens[token];
  if (!data || new Date(data.expires) < new Date() || data.used >= data.uses) {
    return res.json({ valid: false, msg: '無効なToken' });
  }
  data.used++;
  res.json({ valid: true });
});

// 管理画面 + 発行フォーム + 無効化リンク
app.get('/', (req, res) => {
  let html = `<h1>MilkChoco Token Manager</h1><ul>`;
  for (const [t, d] of Object.entries(tokens)) {
    const remaining = d.uses - d.used;
    const expired = new Date(d.expires) < new Date();
    const status = expired ? '期限切れ' : `残り: ${remaining}回`;
    const style = expired ? 'color:#ff6b6b; font-weight:bold;' : '';
    html += `<li style="${style}"><b>${t}</b> - ${d.user} - ${status} - 期限: ${d.expires} 
      <a href="/delete?token=${encodeURIComponent(t)}" style="color:red;">[無効化]</a></li>`;
  }
  html += `</ul><hr>
    <form action="/add" method="POST">
      Token: <input name="token" value="FREE-${Math.random().toString(36).substr(2,16).toUpperCase()}" readonly style="width:300px;"><br><br>
      ユーザー: <input name="user" placeholder="例: hacker1" required><br><br>
      期限: <input name="expires" type="date" required><br><br>
      回数: <input name="uses" type="number" value="10" min="1" required><br><br>
      <button style="padding:10px 20px; font-size:16px;">トークン発行</button>
    </form>`;
  res.send(html);
});

app.post('/add', (req, res) => {
  const { token, user, expires, uses } = req.body;
  if (!token || !user || !expires || !uses) {
    return res.send('入力漏れがあります');
  }
  tokens[token] = { user, expires, uses: parseInt(uses), used: 0 };
  res.redirect('/');
});

app.get('/delete', (req, res) => {
  const token = req.query.token;
  if (token && tokens[token]) {
    delete tokens[token];
  }
  res.redirect('/');
});

app.listen(port, () => console.log('Server running on port', port));
