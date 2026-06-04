# Cloudflare 设置说明

本文只记录部署前需要准备的资源和配置，不包含任何真实密钥。

## 1. 创建 KV Namespace

在 Cloudflare Dashboard 创建一个 KV Namespace，用来保存：

```text
TEMPLATE
BEST_IPS
STATUS
```

创建后记录 Namespace ID，用于：

- `wrangler.toml` 的 `kv_namespaces.id`
- GitHub Secret：`CLOUDFLARE_NAMESPACE_ID`

## 2. Cloudflare Pages 项目

Pages 项目建议设置：

```text
项目名：preferred-sub-generator
构建命令：留空
构建输出目录：public
Functions 目录：functions
KV 绑定变量名：SUB_KV
```

Pages 环境变量：

```text
```

## 3. GitHub Secrets

在 GitHub 仓库 Settings → Secrets and variables → Actions 中配置：

```text
CLOUDFLARE_API_TOKEN_2    # 用于 GitHub Actions 写 KV，对应当前账号的 Cloudflare API Token
CLOUDFLARE_ACCOUNT_ID     # Cloudflare Account ID
CLOUDFLARE_NAMESPACE_ID   # KV Namespace ID
```

原始 VLESS 节点通过网页输入并保存到 Cloudflare KV 的 `TEMPLATE`，不要写进 GitHub Secrets 或仓库文件。

## 4. 设置环境变量

在 Pages 生产环境变量中添加：

```text
SUB_TOKEN          管理 token，用于保存/读取原始 VLESS 模板
SUB_READ_TOKEN     只读 token，用于访问 /sub 和 /best；未设置时回退使用 SUB_TOKEN
SUB_TOKEN_NEXT     可选，管理 token 轮换期间使用的新 token
SUB_ALLOWED_IPS    可选，管理接口 IP 白名单，多个 IP 用英文逗号分隔
SUB_PUBLIC         可选，设为 1 时公开 /sub 和 /best；默认不要设置
UPDATE_WEBHOOK_URL 可选，自动刷新完成后的通知 Webhook
```

订阅接口 `/sub` 和 `/best` 默认需要只读 token，避免公开泄露完整 VLESS 订阅。管理接口 `/api/template` 需要 `SUB_TOKEN`；不要把管理 token 拼进 URL。

## 5. 部署前验证

本地静态检查：

```bash
npm run preflight
```

注意：如果 `wrangler.toml` 里的 KV id 还是占位符，`preflight` 会失败。这是正常的，说明还没替换成真实 Namespace ID。

## 6. 上线后验证

```text
/status
/health
/health/full   # 需要 Authorization: Bearer 你的SUB_TOKEN
/sub?type=vless&t=你的SUB_READ_TOKEN
/sub?type=clash&t=你的SUB_READ_TOKEN
/sub?type=singbox&t=你的SUB_READ_TOKEN
/sub?type=shadowrocket&t=你的SUB_READ_TOKEN
/best?n=20&t=你的SUB_READ_TOKEN
/versions?t=你的SUB_READ_TOKEN
```

订阅接口和版本索引默认需要只读 token；如必须公开，才设置 `SUB_PUBLIC=1`。公开 `/health` 只返回最小状态，详细健康信息放在需要管理 token 的 `/health/full`。
