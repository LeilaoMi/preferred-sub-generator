# Preferred Sub Generator

单用户私用的优选订阅生成器。当前已实现 VLESS 节点解析、替换优选地址后重新生成 VLESS 链接，可输出 Clash/Mihomo、Sing-box、Shadowrocket 订阅格式，提供 Cloudflare Pages Functions API 与 token 防滥用，支持自动聚合候选源、检测优选节点、写入 Cloudflare KV，并提供中文状态面板、部署前检查清单与 Cloudflare 设置说明。

## 当前阶段

- 解析 `vless://` 链接
- 识别 UUID、地址、端口、WS、Host、SNI、路径、TLS 状态
- 替换地址/端口后重新生成 `vless://` 链接
- 生成 Clash/Mihomo YAML 订阅
- 生成 Sing-box JSON 订阅
- 生成 Shadowrocket VLESS 链接列表
- 生成 v2rayNG base64 订阅
- 提供 `/sub`、`/best`、`/status` Pages Functions API
- `/sub`、`/best` 支持 `?token=` 和 `Authorization: Bearer` 鉴权
- `/best` 最多返回 50 个节点，防止滥用
- 聚合 `sources/edge/manual.txt` 和 `sources/edge/remote.json` 候选源
- 支持文本源、IPv4 CIDR 抽样源、CloudflareSpeedTest CSV 源
- 按 TLS/非 TLS 策略检测候选端口并按延迟排序
- 通过 GitHub Actions 定时更新 Cloudflare KV
- 提供中文首页状态面板：`public/index.html`
- 提供私用配置页：`public/admin.html`
- 提供 Cloudflare Pages 配置：`wrangler.toml`
- 提供部署前检查清单：`docs/deploy-checklist.md`
- 提供 Cloudflare 设置说明：`docs/cloudflare-setup.md`
- 提供同类订阅器与 IP 源调研：`docs/source-research.md`
- 提供部署前静态检查：`npm run preflight`

## API

```text
GET /status
GET /sub?type=vless&token=你的token
GET /sub?type=v2rayng&token=你的token
GET /sub?type=clash&token=你的token
GET /sub?type=singbox&token=你的token
GET /sub?type=shadowrocket&token=你的token
GET /best?n=20&token=你的token
```

## KV 数据

```text
TEMPLATE   # 原始 VLESS 链接，或解析后的模板 JSON
BEST_IPS   # 优选节点 JSON 数组
STATUS     # 更新时间、可用数量、来源数量等公开状态
```

## 候选源

```text
sources/edge/manual.txt     # CF Edge IP 手动候选，每行一个 IP、域名、host:port 或 IPv4 CIDR
sources/edge/remote.json    # CF Edge IP 远程公开源列表
```

订阅池只读取 `sources/edge/*`，目标是筛选 Cloudflare 高速边缘 IP。

## Cloudflare Pages

```text
wrangler.toml                 # Pages 输出目录和 KV 绑定
public/index.html             # 中文首页状态面板
public/admin.html             # 私用配置页
functions/sub.js              # 订阅接口
functions/best.js             # 优选列表接口
functions/status.js           # 状态接口
```

## GitHub Secrets

```text
CLOUDFLARE_API_TOKEN      # GitHub Actions 更新 KV 用；当前约定使用目标账号 token
CLOUDFLARE_ACCOUNT_ID     # 目标 Cloudflare 账号 ID
CLOUDFLARE_NAMESPACE_ID   # 目标账号 SUB_KV Namespace ID
ORIGINAL_SUB_OR_NODE      # 原始 VLESS 链接
```

## 部署前检查

```bash
npm run preflight
```

如果 `wrangler.toml` 的 KV Namespace ID 仍是占位符，部署前检查会失败。创建 Cloudflare KV 后，把真实 Namespace ID 填进去再运行。

详细说明：

```text
docs/deploy-checklist.md
docs/cloudflare-setup.md
```

## 验证

```bash
npm test
```