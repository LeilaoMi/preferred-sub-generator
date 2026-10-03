# D1 测速数据存储

测速反馈（`POST /api/speedtest-feedback`）默认写入 KV 的 `SPEED_FEEDBACK` key，最多保留 500 条。
绑定 D1 后改写入 `speed_feedback` 表，保留完整历史并支持 `admin.html` 的按天趋势面板。

**未绑定 D1 也能正常工作**：代码检测到 `env.SPEED_DB` 缺失时自动回退 KV。

## 1. 创建数据库

```bash
npx wrangler d1 create speed-feedback
```

记下输出的 `database_id`。

## 2. 建表

```bash
npx wrangler d1 execute speed-feedback --remote --command "
CREATE TABLE IF NOT EXISTS speed_feedback (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at TEXT NOT NULL,
  colo TEXT,
  ip_country TEXT,
  isp TEXT,
  speed_mbps REAL NOT NULL,
  client_hash TEXT
);
CREATE INDEX IF NOT EXISTS idx_speed_feedback_created_at ON speed_feedback (created_at);
CREATE INDEX IF NOT EXISTS idx_speed_feedback_colo ON speed_feedback (colo);
"
```

表会在首次写入时自动 `CREATE TABLE IF NOT EXISTS`，此步可跳过，但建议显式执行便于校验。

## 3. 添加 binding

`wrangler.toml`：

```toml
[[d1_databases]]
binding = "SPEED_DB"
database_name = "speed-feedback"
database_id = "你的 database_id"
```

Pages 控制台部署时：**Settings > Bindings > Add > D1 database**，
Variable name 填 `SPEED_DB`，选中刚创建的数据库。

## 4. 验证

```bash
# 写入一条
curl -X POST https://你的域名/api/speedtest-feedback \
  -H "Content-Type: application/json" \
  -d '{"speedMbps":123.45,"colo":"LAX","ipCountry":"US"}'

# 管理 token 查看趋势（storage 应为 "d1"）
curl https://你的域名/api/speedtest-feedback?days=7 \
  -H "Authorization: Bearer 你的管理token"
```

## 隐私说明

- 原始 IP 不落库：仅存 `client_hash`（IP 的 SHA-256 前 16 位十六进制）。
- `GET /api/speedtest-feedback` 需要管理 token，返回中不含 `ip` 字段。

## 相关配置

- `GET /api/speedtest-feedback?days=N&limit=M`：`days` 上限 90（默认 14），`limit` 上限 1000（默认 100）。
- 趋势面板入口：`/admin.html` 的「测速趋势」区块。
