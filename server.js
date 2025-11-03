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

// 管理画面
app.get('/', (req, res) => {
  let html = `<h1>MilkChoco Token Manager</h1><ul>`;
  for (const [t, d] of Object.entries(tokens)) {
    html += `<li><b>${t}</b> - ${d.user} - 残り: ${d.uses - d.used}回 - 期限: ${d.expires} 
      <a href="/delete?token=${encodeURIComponent(t)}" style="color:red;">[無効化]</a></li>`;
  }
  html += `</ul><hr>
    <form action="/add" method="POST">
      Token: <input name="token" value="FREE-${Math.random().toString(36).substr(2,16).toUpperCase()}" readonly><br>
      ユーザー: <input name="user"><br>
      期限: <input name="expires" type="date"><br>
      回数: <input name="uses" type="number" value="10"><br>
      <button>発行</button>
    </form>`;
  res.send(html);
});

app.post('/add', (req, res) => {
  const { token, user, expires, uses } = req.body;
  tokens[token] = { user, expires, uses: parseInt(uses), used: 0 };
  res.redirect('/');
});

app.get('/delete', (req, res) => {
  delete tokens[req.query.token];
  res.redirect('/');
});

app.listen(port, () => console.log('Server running'));