// server.js - 完全版（SQLite永続化 + スリープ対策 + HEALTHチェック + バージョンチェック）
const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const app = express();
const port = process.env.PORT || 3000;

// === 環境変数（Render.comで設定）===
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
if (!ADMIN_PASSWORD) {
  console.error("ERROR: ADMIN_PASSWORDが未設定！Render.comで設定してください");
  process.exit(1);
}

// === Express設定 ===
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// === SQLite DB（永続化）===
const dbPath = path.join(__dirname, 'tokens.db');
const db = new sqlite3.Database(dbPath, (err) => {
  if (err) console.error("DB接続失敗:", err);
  else console.log(`DB接続: ${dbPath}`);
});

// テーブル作成（version列追加）
db.serialize(() => {
  // 1. tokensテーブル
  db.run(`
    CREATE TABLE IF NOT EXISTS tokens (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      token TEXT UNIQUE NOT NULL,
      user TEXT NOT NULL,
      expires TEXT NOT NULL,
      uses INTEGER DEFAULT 10,
      used INTEGER DEFAULT 0,
      created DATETIME DEFAULT CURRENT_TIMESTAMP,
      version TEXT NOT NULL DEFAULT '1.0'
    )
  `, (err) => {
    if (err) console.error("tokensテーブル作成失敗:", err);
  });

  // 2. player_logsテーブル
  db.run(`
    CREATE TABLE IF NOT EXISTS player_logs (
      fc INTEGER PRIMARY KEY,
      current_name TEXT NOT NULL,
      previous_names TEXT DEFAULT '[]',
      change_history TEXT DEFAULT '[]',
      is_blacklist BOOLEAN DEFAULT 0,
      blacklist_name TEXT DEFAULT ''
    )
  `, (err) => {
    if (err) console.error("player_logsテーブル作成失敗:", err);
  });
});

// === メモリキャッシュ（高速化）===
let tokenCache = {};
let playerLogCache = {};
// キャッシュ更新関数
async function updateCache() {
  return new Promise((resolve) => {
    db.all("SELECT * FROM tokens", (err, rows) => {
      if (err) {
        console.error("キャッシュ更新失敗:", err);
        return resolve();
      }
      tokenCache = {};
      rows.forEach(row => tokenCache[row.token] = row);
      resolve();
    });
db.all("SELECT * FROM player_logs", (err, rows) => {
  if (err) return;
  playerLogCache = {};
  rows.forEach(row => {
    playerLogCache[row.fc] = row;
  });
});
  });
}

// 起動時にキャッシュロード
updateCache().then(() => {
  console.log(`キャッシュロード: ${Object.keys(tokenCache).length}トークン`);
});

// === ログイン画面HTML ===
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
  if (password === ADMIN_PASSWORD) return next();
  res.send(getLoginHTML('パスワードが間違っています'));
}

// === ルート ===

// 1. ログイン画面
app.get('/', (req, res) => res.send(getLoginHTML()));

// 2. ログイン処理
app.post('/login', requireAuth, (req, res) => res.redirect('/dashboard'));

// 3. 管理画面（バージョン入力追加）
app.get('/dashboard', async (req, res) => {
  await updateCache();
  let html = `<h1>Token Manager</h1><ul>`;
  for (const [t, d] of Object.entries(tokenCache)) {
    const remaining = d.uses - d.used;
    const expired = new Date(d.expires) < new Date();
    html += `<li><b>${t}</b> - ${d.user} - Ver: ${d.version} - ${expired ? '期限切れ' : '残り: ' + remaining + '回'} - ${d.expires} 
      <a href="/delete?token=${t}" style="color:red;" onclick="return confirm('無効化？');">[無効化]</a></li>`;
  }
  html += `</ul><hr>
    <form action="/add" method="POST">
      Token: <input name="token" value="FREE-${Math.random().toString(36).substr(2,16).toUpperCase()}" readonly><br><br>
      ユーザー: <input name="user" required><br><br>
      バージョン: <input name="version" value="1.0" required placeholder="例: 1.0 or legacy"><br><br>  <!-- ここで好きなバージョンを入力可能 -->
      期限: <input name="expires" type="date" required><br><br>
      回数: <input name="uses" type="number" value="10" min="1" required><br><br>
      <button>発行</button>
    </form>
    <p><a href="/">ログアウト</a></p>`;
  res.send(html);
  html += `<hr><h2>プレイヤーログ</h2>`;
const sortedLogs = Object.values(playerLogCache).sort((a, b) => a.fc - b.fc);
const blacklisted = sortedLogs.filter(l => l.is_blacklist);
const others = sortedLogs.filter(l => !l.is_blacklist);
blacklisted.forEach(l => {
  html += `<p>(${l.fc}, ${l.blacklist_name}): (${l.current_name})</p>`;
});
others.forEach(l => {
  html += `<p>${l.fc}: ${l.current_name}</p>`;
});
html += `<a href="/download-log"><button>ログダウンロード</button></a>
  <form action="/upload-log" method="POST" enctype="multipart/form-data">
    <input type="file" name="logfile" accept=".txt" required>
    <button>ログアップロード</button>
  </form>
  <hr><h2>ブラックリスト追加</h2>
  <form action="/add-blacklist" method="POST">
    FC: <input name="fc" type="number" required><br>
    名前: <input name="blacklist_name" required><br>
    <button>追加</button>
  </form>`;
});

// 4. トークン発行（version追加）
app.post('/add', (req, res) => {
  const { token, user, version, expires, uses } = req.body;
  if (!token || !user || !version || !expires || !uses) return res.send('入力漏れ');

  db.run(
    "INSERT OR REPLACE INTO tokens (token, user, version, expires, uses, used) VALUES (?, ?, ?, ?, ?, 0)",
    [token, user, version, expires, parseInt(uses)],
    async (err) => {
      if (err) return res.send('発行失敗: ' + err.message);
      await updateCache();
      res.redirect('/dashboard');
    }
  );
});

// 5. 無効化
app.get('/delete', async (req, res) => {
  const token = req.query.token;
  if (!token) return res.redirect('/dashboard');

  db.run("DELETE FROM tokens WHERE token = ?", [token], async (err) => {
    if (err) console.error("削除失敗:", err);
    await updateCache();
    res.redirect('/dashboard');
  });
});

// 6. API（公開）+ HEALTHチェック + バージョンチェック
app.get('/api/check', async (req, res) => {
  const token = req.query.token;
  const version = req.query.version;  // 新規: versionパラメータ
// app.get('/api/check'後
app.post('/api/log-players', async (req, res) => {
  const token = req.query.token;
  const { players } = req.body; // [{fc, name}, ...]
  if (!tokenCache[token] || !players) return res.json({ ok: false });

  for (const p of players) {
    const fc = parseInt(p.fc);
    const name = p.name;
    if (isNaN(fc) || !name) continue;

    const existing = playerLogCache[fc];
    if (existing) {
      if (existing.current_name === name) continue; // 一致: 無視
      // 名前変更: 更新
      const prevNames = JSON.parse(existing.previous_names);
      if (!prevNames.includes(existing.current_name)) prevNames.push(existing.current_name);
      const history = JSON.parse(existing.change_history);
      history.push({ old: existing.current_name, new: name, timestamp: new Date().toISOString() });

      db.run("UPDATE player_logs SET current_name = ?, previous_names = ?, change_history = ? WHERE fc = ?",
        [name, JSON.stringify(prevNames), JSON.stringify(history), fc]);
      playerLogCache[fc].current_name = name;
      playerLogCache[fc].previous_names = JSON.stringify(prevNames);
      playerLogCache[fc].change_history = JSON.stringify(history);
    } else {
      // 新規
      db.run("INSERT INTO player_logs (fc, current_name) VALUES (?, ?)", [fc, name]);
      playerLogCache[fc] = { fc, current_name: name, previous_names: '[]', change_history: '[]', is_blacklist: 0, blacklist_name: '' };
    }
  }
  await updateCache(); // キャッシュ更新
  res.json({ ok: true });
});
  // === スリープ対策：HEALTHチェック ===
  if (token === 'HEALTH') {
    return res.json({ valid: false, msg: 'Server is alive' });
  }

  // === バージョンチェック（必須） ===
  if (!version) {
    return res.json({ valid: false, msg: 'バージョン指定が必要です（古いEXE？）' });
  }

  // === 通常認証 ===
  const data = tokenCache[token];
  if (!data || new Date(data.expires) < new Date() || data.used >= data.uses) {
    return res.json({ valid: false, msg: '無効なToken' });
  }

  // === バージョン一致チェック ===
  if (data.version !== version) {
    return res.json({ valid: false, msg: 'バージョンが一致しません' });
  }

  data.used++;
  db.run("UPDATE tokens SET used = ? WHERE token = ?", [data.used, token], (err) => {
    if (err) console.error("使用回数更新失敗:", err);
  });

  res.json({ valid: true });
});
app.post('/add-blacklist', (req, res) => {
  const { fc, blacklist_name } = req.body;
  const fcNum = parseInt(fc);
  if (isNaN(fcNum) || !blacklist_name) return res.redirect('/dashboard');

  if (playerLogCache[fcNum]) {
    db.run("UPDATE player_logs SET is_blacklist = 1, blacklist_name = ? WHERE fc = ?", [blacklist_name, fcNum]);
    playerLogCache[fcNum].is_blacklist = 1;
    playerLogCache[fcNum].blacklist_name = blacklist_name;
  } else {
    db.run("INSERT INTO player_logs (fc, current_name, is_blacklist, blacklist_name) VALUES (?, '', 1, ?)", [fcNum, blacklist_name]);
    playerLogCache[fcNum] = { fc: fcNum, current_name: '', previous_names: '[]', change_history: '[]', is_blacklist: 1, blacklist_name };
  }
  res.redirect('/dashboard');
});
app.get('/download-log', (req, res) => {
  let logText = 'プレイヤーログ\n';
  const sortedLogs = Object.values(playerLogCache).sort((a, b) => a.fc - b.fc);
  const blacklisted = sortedLogs.filter(l => l.is_blacklist);
  const others = sortedLogs.filter(l => !l.is_blacklist);
  blacklisted.forEach(l => logText += `(${l.fc}, ${l.blacklist_name}): (${l.current_name})\n`);
  others.forEach(l => logText += `${l.fc}: ${l.current_name}\n`);

  res.setHeader('Content-Type', 'text/plain');
  res.setHeader('Content-Disposition', 'attachment; filename=player_log.txt');
  res.send(logText);
});
const multer = require('multer'); // 追加依存: npm i multer
const upload = multer({ dest: 'uploads/' });
app.post('/upload-log', upload.single('logfile'), (req, res) => {
  const fs = require('fs');
  const filePath = req.file.path;
  const logContent = fs.readFileSync(filePath, 'utf8');
  fs.unlinkSync(filePath); // クリーン

  const lines = logContent.split('\n');
  for (const line of lines) {
    if (!line.trim()) continue;
    let fc, name;
    if (line.startsWith('(')) { // ブラックリスト形式
      const match = line.match(/\(([\d]+), (.*?)\): \((.*?)\)/);
      if (match) {
        fc = parseInt(match[1]);
        const blName = match[2];
        name = match[3];
        // 更新処理（ブラックリストフラグON）
        if (playerLogCache[fc]) {
          const existing = playerLogCache[fc];
          if (existing.current_name !== name) {
            const prevNames = JSON.parse(existing.previous_names);
            if (!prevNames.includes(existing.current_name)) prevNames.push(existing.current_name);
            const history = JSON.parse(existing.change_history);
            history.push({ old: existing.current_name, new: name, timestamp: new Date().toISOString() });
            db.run("UPDATE player_logs SET current_name = ?, previous_names = ?, change_history = ?, is_blacklist = 1, blacklist_name = ? WHERE fc = ?",
              [name, JSON.stringify(prevNames), JSON.stringify(history), blName, fc]);
            Object.assign(existing, { current_name: name, previous_names: JSON.stringify(prevNames), change_history: JSON.stringify(history), is_blacklist: 1, blacklist_name: blName });
          } else {
            db.run("UPDATE player_logs SET is_blacklist = 1, blacklist_name = ? WHERE fc = ?", [blName, fc]);
            existing.is_blacklist = 1;
            existing.blacklist_name = blName;
          }
        } else {
          db.run("INSERT INTO player_logs (fc, current_name, is_blacklist, blacklist_name) VALUES (?, ?, 1, ?)", [fc, name, blName]);
          playerLogCache[fc] = { fc, current_name: name, previous_names: '[]', change_history: '[]', is_blacklist: 1, blacklist_name: blName };
        }
      }
    } else { // 通常形式 fc: name
      const match = line.match(/^(\d+): (.*)$/);
      if (match) {
        fc = parseInt(match[1]);
        name = match[2];
        // 更新処理（上書き、マージ）
        if (playerLogCache[fc]) {
          const existing = playerLogCache[fc];
          if (existing.current_name !== name) {
            const prevNames = JSON.parse(existing.previous_names);
            if (!prevNames.includes(existing.current_name)) prevNames.push(existing.current_name);
            const history = JSON.parse(existing.change_history);
            history.push({ old: existing.current_name, new: name, timestamp: new Date().toISOString() });
            db.run("UPDATE player_logs SET current_name = ?, previous_names = ?, change_history = ? WHERE fc = ?",
              [name, JSON.stringify(prevNames), JSON.stringify(history), fc]);
            Object.assign(existing, { current_name: name, previous_names: JSON.stringify(prevNames), change_history: JSON.stringify(history) });
          }
        } else {
          db.run("INSERT INTO player_logs (fc, current_name) VALUES (?, ?)", [fc, name]);
          playerLogCache[fc] = { fc, current_name: name, previous_names: '[]', change_history: '[]', is_blacklist: 0, blacklist_name: '' };
        }
      }
    }
  }
  res.redirect('/dashboard');
});
// === サーバー起動 ===
app.listen(port, () => {
  console.log(`Server running on port ${port}`);
  console.log(`ログイン: https://token-milkchocoexe-ribon.onrender.com`);
  console.log(`Cron Job設定推奨: curl -X GET /api/check?token=HEALTH`);
});
