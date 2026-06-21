# Dragon Tiger 龍虎鬥 — Standalone Package

完整獨立版龍虎鬥遊戲，含遊戲伺服器、玩家前台、管理後台。

---

## 目錄結構

```
dragon-tiger/
├── server.js          # 遊戲 WebSocket + HTTP 伺服器 (port 4000)
├── admin-server.js    # 管理後台 API 伺服器 (port 4001)
├── core/
│   ├── db.js          # PostgreSQL 連線 + 自動建表
│   ├── config.js      # 遊戲設定讀寫
│   └── migrate.sql    # 完整 SQL schema（備查用，伺服器啟動時自動執行）
├── game/
│   └── DragonTigerGame.js   # 遊戲核心邏輯
├── frontend/          # 玩家前台 (Vite + React)
└── admin/             # 管理後台 (Vite + React)
```

---

## 環境需求

- Node.js 18+
- PostgreSQL 14+

---

## 快速開始

### 1. 建立資料庫

```bash
createdb dragon_tiger
```

### 2. 設定環境變數

複製 `.env.example` → `.env` 並填入：

```env
DATABASE_URL=postgresql://user:password@localhost:5432/dragon_tiger
PORT=4000
ADMIN_PORT=4001
CORS_ORIGIN=http://localhost:5173
ADMIN_CORS_ORIGIN=http://localhost:5174
```

### 3. 安裝後端依賴

```bash
npm install
```

### 4. 啟動遊戲伺服器

```bash
node server.js
```

首次啟動會自動建立所有資料表（無需手動執行 migrate.sql）。

### 5. 啟動管理後台伺服器

```bash
node admin-server.js
```

### 6. 建立第一個管理員帳號

```bash
node -e "
import('./core/db.js').then(async ({ query, initDb }) => {
  await initDb()
  const bcrypt = (await import('bcryptjs')).default
  const hash = await bcrypt.hash('YOUR_PASSWORD', 12)
  await query(
    \`INSERT INTO dt_admin_accounts (username, password_hash, role)
     VALUES ('admin', \$1, 'super_admin')\`,
    [hash]
  )
  console.log('Admin created')
  process.exit(0)
})
"
```

### 7. 啟動前台 (開發模式)

```bash
cd frontend
cp .env.example .env   # 調整 VITE_API_BASE_URL 和 VITE_WS_URL
npm install
npm run dev            # http://localhost:5173
```

### 8. 啟動管理後台 (開發模式)

```bash
cd admin
npm install
npm run dev            # http://localhost:5174
```

---

## 正式部署

### 前台 Build

```bash
cd frontend && npm run build
# 產出 dist/ → 放到 Nginx / CDN
```

### 管理後台 Build

```bash
cd admin && npm run build
```

### Nginx 範例設定

```nginx
server {
    listen 80;
    server_name your-domain.com;

    # 玩家前台
    root /var/www/dragon-tiger/frontend/dist;
    index index.html;
    location / { try_files $uri $uri/ /index.html; }

    # 遊戲 API + WebSocket
    location /ws {
        proxy_pass http://127.0.0.1:4000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
    }
    location ~ ^/(config|dt-config|dt-history|login|register) {
        proxy_pass http://127.0.0.1:4000;
    }
}

server {
    listen 80;
    server_name admin.your-domain.com;

    # 管理後台
    root /var/www/dragon-tiger/admin/dist;
    location / { try_files $uri $uri/ /index.html; }

    location /admin/ {
        proxy_pass http://127.0.0.1:4001;
    }
}
```

### PM2 (推薦生產環境)

```bash
npm install -g pm2
pm2 start server.js       --name dt-game
pm2 start admin-server.js --name dt-admin
pm2 save
pm2 startup
```

---

## 玩家帳號

玩家透過前台 `/register` 自行註冊，或由管理後台手動新增並設定初始餘額。

---

## 管理後台功能

| 功能 | 說明 |
|------|------|
| 遊戲設定 | 賠率、下注時間、七點規則、大小/單雙/花色規則 |
| 會員管理 | 查詢/調整餘額、停用帳號 |
| 帳務明細 | 依玩家篩選每局損益記錄 |
| 管理員帳號 | 新增/管理後台帳號，支援 super_admin / game_operator / finance / cs 角色 |

---

## 遊戲設定說明

| 設定鍵 | 說明 | 預設值 |
|--------|------|--------|
| `payout.dragon` | 龍賠率倍數 | 1 |
| `payout.tiger` | 虎賠率倍數 | 1 |
| `payout.tie` | 和賠率倍數 | 8 |
| `payout.tie_refund` | 和局主注退還比例 | 0.5 |
| `payout.big` | 大副注賠率 | 1 |
| `payout.small` | 小副注賠率 | 1 |
| `payout.odd` | 單副注賠率 | 1 |
| `payout.even` | 雙副注賠率 | 1 |
| `payout.suit` | 花色副注賠率 | 3 |
| `seven_rule` | 七點規則：`push`=退注 / `banker`=莊家吃注 | push |
| `bet_time_ms` | 下注時間（毫秒） | 20000 |
| `min_bet` | 最低單注 | 20 |
| `max_bet` | 最高單注 | 50000 |
