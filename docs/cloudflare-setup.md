# Cloudflare 设置说明

本文记录当前仓库实际需要的 Cloudflare 资源、环境变量和上线验证方式，不包含任何真实密钥。

## 当前实际部署

```text
生产自定义域名：https://yxdy.woniu.bee.al
Pages 项目名：preferred-sub-generator-zrd
最近验证预览：https://3b090ee2.pre
KV 绑定变量：SUB_KV
KV Namespace ID：9c1be2549489489ca8c55c5886b56b3d
```

线上已验证：

```text
/status                         HTTP 200
/health                         HTTP 200
/api/read-token                 HTTP 200，configured: true
/sub?type=v2rayng&t=只读token   HTTP 200，返回 base64 订阅
/best?n=2&t=只读token           HTTP 200，返回 JSON
```

## 1. KV Namespace

Cloudflare KV Namespace 用来保存：

```text
TEMPLATE                 默认原始 VLESS 模板，由网页保存
TEMPLATE_1..TEMPLATE_5   可选多模板槽位
BEST_IPS                 最新优选 Edge IP 列表
BEST_IPS_LAST            最近一次写入的优选结果
BEST_IPS_LATEST_VERSION  最近版本 key
BEST_IPS_VERSION_INDEX   最近版本索引，默认只保留 30 个 BEST_IPS_* 快照
BEST_IPS_TREND           最近 7 次刷新趋势
STATUS                   更新时间、可用数量、检测状态等
SOURCE_HEALTH            最近一次候选源抓取健康报告
TEMPLATE_AUDIT           最近一次模板更新审计信息
SPEED_FEEDBACK           浏览器本地测速反馈
LAST_RUN_*               最近一次 GitHub Actions 自动刷新结果
```

Namespace ID 同步到：

- `wrangler.toml` 的 `kv_namespaces.id`
- GitHub Secret：`CLOUDFLARE_NAMESPACE_ID`

## 2. Cloudflare Pages 项目

Pages 项目设置：

```text
项目名：preferred-sub-generator-zrd
构建命令：留空
构建输出目录：public
Functions 目录：functions
KV 绑定变量名：SUB_KV
```

## 3. Pages 环境变量

生产环境必须设置：

```text
SUB_TOKEN        管理 token，只用于 /api/template 和 /health/full
SUB_READ_TOKEN   只读 token，用于 /sub、/best、/versions；首页会通过 /api/read-token 读取并自动拼到订阅 URL
```

可选环境变量：

```text
SUB_READ_TOKEN_NEXT        只读 token 轮换期间的新 token
SUB_TOKEN_NEXT             管理 token 轮换期间的新 token
SUB_ALLOWED_IPS            管理接口 IP 白名单，多个 IP 用英文逗号分隔
SUB_PUBLIC=1               显式公开 /sub 和 /best，不推荐
ALLOW_QUERY_TOKEN=1        临时允许 /api/template?token=，默认关闭
SOURCE_MAX_BYTES=5242880   远程候选源最大读取字节数，默认 5MB
REQUIRE_CF_RAY=1           只保留带 cf-ray 的 Cloudflare Edge 验证结果，默认开启
ALLOW_TCP_ONLY=1           兼容 TCP 可达但无 cf-ray 的结果，默认关闭
VERSION_RETENTION=30       BEST_IPS_* 版本快照保留数量，默认 30
UPDATE_WEBHOOK_URL         自动刷新完成后的通知 Webhook
```

安全边界：

- `/sub`、`/best`、`/versions` 默认需要只读 token。
- `/api/read-token` 会返回 `SUB_READ_TOKEN`，目的是让首页生成可直接导入客户端的订阅 URL。
- `/api/template` 和 `/health/full` 使用管理 token `SUB_TOKEN`，默认只接受 `Authorization: Bearer <SUB_TOKEN>`。
- 管理 token 不要拼进 URL，也不要给客户端订阅使用。

## 4. GitHub Secrets

在 GitHub 仓库 Settings → Secrets and variables → Actions 中配置：

```text
CLOUDFLARE_API_TOKEN_2    用于 GitHub Actions 写 KV 的 Cloudflare API Token
CLOUDFLARE_ACCOUNT_ID     Cloudflare Account ID
CLOUDFLARE_NAMESPACE_ID   KV Namespace ID
```

原始 VLESS 节点通过网页输入并保存到 Cloudflare KV 的 `TEMPLATE`，不要写进 GitHub Secrets 或仓库文件。

## 5. 本地验证

```bash
npm test
npm run preflight
npm run validate:sources
```

## 6. 部署

```bash
CLOUDFLARE_API_TOKEN="$CLOUDFLARE_API_TOKEN_2" \
  npx wrangler pages deploy public \
  --project-name preferred-sub-generator-zrd \
  --branch main \
  --commit-dirty=true
```

## 7. 上线后验证

```text
https://yxdy.woniu.bee.al/status
https://yxdy.woniu.bee.al/health
https://yxdy.woniu.bee.al/api/read-token
https://yxdy.woniu.bee.al/health/full   # 需要 Authorization: Bearer 你的SUB_TOKEN
https://yxdy.woniu.bee.al/sub?type=v2rayng&t=你的SUB_READ_TOKEN
https://yxdy.woniu.bee.al/sub?type=clash&t=你的SUB_READ_TOKEN
https://yxdy.woniu.bee.al/sub?type=singbox&t=你的SUB_READ_TOKEN
https://yxdy.woniu.bee.al/sub?type=shadowrocket&t=你的SUB_READ_TOKEN
https://yxdy.woniu.bee.al/best?n=20&t=你的SUB_READ_TOKEN
https://yxdy.woniu.bee.al/versions?t=你的SUB_READ_TOKEN
```

如必须公开订阅，才设置 `SUB_PUBLIC=1`。公开 `/health` 只返回最小状态，详细健康信息放在需要管理 token 的 `/health/full`。