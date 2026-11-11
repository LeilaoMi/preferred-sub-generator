# Cloudflare 配置说明

正常情况下不需要手动配置 Cloudflare：Fork 后填好 `CLOUDFLARE_API_TOKEN` 和 `CLOUDFLARE_ACCOUNT_ID`，工作流里的 `scripts/cf-bootstrap.js` 会自动准备所有资源（见 [README 快速开始](../README.md#快速开始)）。

本文用于：确认 API 令牌权限、理解自动创建了什么、在 Pages 上设置环境变量、手动部署和排错。本文不含任何真实密钥或资源 ID。

## 1. API 令牌权限

在 Cloudflare「我的个人资料 → API 令牌」创建自定义令牌，资源范围选你的账户：

| 权限 | 是否必需 | 用途 |
|---|---|---|
| 账户 → Cloudflare Pages → 编辑 | 必需 | 创建 Pages 项目、部署 |
| 账户 → Workers KV 存储 → 编辑 | 必需 | 创建 / 读写 KV |
| 账户 → D1 → 编辑 | 可选 | 创建 D1；没有时测速反馈和逐 IP 实测改存 KV |

令牌填到 GitHub 仓库的 Secret `CLOUDFLARE_API_TOKEN`（旧名 `CLOUDFLARE_API_TOKEN_2` 也兼容）。

## 2. 自动创建的资源

每个工作流开始时都会运行 `cf-bootstrap.js`：

| 资源 | 名称 | 行为 |
|---|---|---|
| KV 命名空间 | `preferred-sub-generator-kv` | 按名称查找，没有就创建。已设 Secret `CLOUDFLARE_NAMESPACE_ID` 时直接用它 |
| D1 数据库 | `speed-feedback` | 按名称查找，没有就创建；失败只告警，不影响运行 |
| Pages 项目 | `preferred-sub-generator`（Actions 变量 `PAGES_PROJECT` 可改） | 仅 Deploy 工作流会创建，生产分支 `main` |

脚本会在运行时重写 `wrangler.toml`，写入当前账户的 KV / D1 ID（绑定名分别为 `SUB_KV`、`SPEED_DB`）。仓库里提交的 `wrangler.toml` 是上游实例的配置，Fork 无需修改；ID 不是密钥，公开没有风险。

## 3. Pages 环境变量

在 Cloudflare 控制台：**Workers 和 Pages → 你的 Pages 项目 → 设置 → 变量和机密**。可用变量见 [README · Cloudflare Pages 环境变量](../README.md#cloudflare-pages-环境变量)，最常用的是：

| 变量 | 说明 |
|---|---|
| `SUB_TOKEN` | 管理 token |
| `SUB_READ_TOKEN` | 只读 token |
| `SUB_PUBLIC` | 设 `0` 关闭匿名订阅 |
| `SETUP_CODE` | 开启 `/setup.html` 网页设置管理 token |

注意：

- 改完变量需要重新部署才生效（push 到 `main`，或在 Actions 手动运行 **Deploy to Cloudflare Pages**）。
- 部署使用仓库里的 `wrangler.toml`，绑定（KV、D1）以文件为准。token 类变量建议以「机密 / Secret」类型添加。
- 如果发现部署后管理 token 失效，可以改用 `/setup.html` 把管理 token 的哈希存进 KV，KV 不受重新部署影响。

## 4. D1（可选）

D1 用于保存浏览器测速反馈（`speed_feedback` 表）和逐 IP 实测回传（`ip_feedback` 表），支持 `/admin.html` 的按天趋势。未绑定时自动回退 KV（各保留最近 500 条），并且匿名的浏览器测速不会落库。

自动创建失败时，可以手动创建：

```bash
npx wrangler d1 create speed-feedback
```

然后在 Pages 项目 **设置 → 绑定 → 添加 → D1 数据库**，变量名填 `SPEED_DB`。表结构会在首次写入时自动创建，无需手动建表。

## 5. 手动部署

需要 Node.js 和 Wrangler 4：

```bash
npm test
npm run preflight
CLOUDFLARE_API_TOKEN=你的令牌 CLOUDFLARE_ACCOUNT_ID=你的账户ID \
  npx wrangler pages deploy public --project-name=preferred-sub-generator --branch=main
```

手动部署前请确认 `wrangler.toml` 里的 KV / D1 ID 属于你自己的账户（可参考 `wrangler.example.toml`）。

## 6. 上线验证

```bash
curl https://你的域名/status
curl https://你的域名/health
curl -H "Authorization: Bearer 你的SUB_TOKEN" https://你的域名/health/full
curl https://你的域名/api/read-token          # 匿名只返回 { "configured": ... }
curl -H "User-Agent: edgetunnel" \
  "https://你的域名/sub?host=example.com&uuid=00000000-0000-4000-8000-000000000000"
```

最后一条模拟 edgetunnel 的拉取，应返回 base64 文本。各接口说明见 [reference.md](reference.md)。
