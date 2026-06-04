# Preferred Sub Generator

单用户私用的 Cloudflare Edge 优选订阅生成器。

它的核心目标很简单：**保留你的原始 VLESS 节点参数，只把入口地址替换成测速后的 Cloudflare 高速边缘 IP，然后生成适合不同客户端导入的订阅。**

> 隐私提醒：公开 `/sub` 等价于公开由真实 VLESS 模板派生出的完整订阅，包含 UUID、Host、SNI、path 等敏感参数。默认私密模式下，`/sub` 和 `/best` 需要只读 token；只有显式设置 `SUB_PUBLIC=1` 才会公开订阅。

## 功能特性

- 支持粘贴 `vless://` 原始节点，解析并保存为私用模板。
- 自动识别并保留：UUID、端口、TLS、WS、Host、SNI、path、节点备注等参数。
- 自动聚合 Cloudflare Edge 候选源：
  - Cloudflare 官方 IPv4 CIDR。
  - cmliu `addressesapi.txt`。
  - cmliu `addressesipv6api.txt`。
  - cmliu `addressescsv.csv`，支持速度阈值过滤。
  - amclubs `ipv4.txt`。
  - 本地手动源 `sources/edge/manual.txt`。
- 自动检测候选 IP 的可达性、延迟和 Cloudflare COLO。
- 订阅节点名称支持中文友好 COLO 展示，例如：

```text
🇺🇸 美国洛杉矶 LAX 12ms #1
🇭🇰 香港 HKG 18ms #2
🇸🇬 新加坡 SIN 22ms #3
```

- 支持输出格式：
  - VLESS 链接列表
  - v2rayNG base64 订阅
  - Clash / Mihomo YAML
  - Sing-box JSON
  - Shadowrocket VLESS 链接列表
- 提供 Cloudflare Pages Functions API：
  - `/status`
  - `/health`
  - `/health/full`
  - `/sub`
  - `/best`
  - `/versions`
  - `/api/template`
- `/sub`、`/best` 默认需要只读 token，避免真实订阅被公开拉取。
- `/api/template` 需要管理 token，仅用于保存或读取原始 VLESS 模板，token 不会拼进订阅链接。
- API 默认带 noindex / nosniff / no-referrer 等安全响应头，`public/robots.txt` 默认禁止搜索引擎索引。
- 管理接口带基础频率限制，并会清理过期/过量 IP 计数桶。
- GitHub Actions 可每 6 小时自动刷新 Cloudflare KV 中的优选 IP。
- 不引入 ProxyIP、SOCKS5、NAT64、中转 IP 或公益节点混合源。

## 适合什么场景

适合：

- 你已经有一个可用的 VLESS 节点。
- 你想尝试用 Cloudflare Edge 优选 IP 改善入口连接质量。
- 你不想把真实节点提交给第三方公开订阅器。
- 你想自己掌控订阅生成器、数据源、KV 和部署环境。

不适合：

- 原始 VLESS 本身不可用。
- UUID、Host、SNI、path、TLS 配置错误。
- 后端服务已经失效。
- 期望本项目修复落地节点、代理协议或服务端问题。

如果原始 VLESS 不能连接，替换 Cloudflare Edge IP 后通常也不能连接。本项目解决的是“入口优选”，不是“修复坏节点”。

## 支持部署到哪里

### 推荐：Cloudflare Pages

当前项目已按 Cloudflare Pages 设计：

```text
public/       静态首页和配置页
functions/    Pages Functions API
wrangler.toml Pages 输出目录和 KV 绑定
```

Cloudflare Pages 是推荐部署方式，也是当前仓库实际验证的部署方式。

### 可配合 GitHub Actions

GitHub Actions 不负责部署页面，它负责定时刷新 KV：

```text
抓取候选源 → 检测可用 CF Edge → 写入 BEST_IPS 和 STATUS
```

真实 VLESS 模板不放 GitHub Secrets。Actions 会读取 Cloudflare KV 中已保存的 `TEMPLATE`。

### 不建议直接部署到普通静态托管

普通静态托管只能展示页面，不能运行 `functions/` 里的 API，也不能读写 Cloudflare KV，因此不能完整工作。

### 可迁移但未内置适配的平台

理论上可迁移到 Vercel、Netlify、Workers，但需要改 API 路由和 KV/数据库读写逻辑。本仓库不默认支持这些平台。

## 项目结构

```text
.github/workflows/update.yml     GitHub Actions 定时刷新 KV
public/index.html                中文首页，粘贴 VLESS 并生成订阅
public/admin.html                私用模板配置页
functions/sub.js                 订阅接口
functions/best.js                优选 IP 列表接口
functions/versions.js            优选 IP 版本索引接口
functions/status.js              公开状态接口
functions/health.js              健康检查接口
functions/api/template.js        模板读取/保存接口
src/parser/vless.js              VLESS 解析
src/generator/vless.js           VLESS 生成
src/generator/clash.js           Clash/Mihomo 输出
src/generator/singbox.js         Sing-box 输出
src/generator/shadowrocket.js    Shadowrocket 输出
src/utils/colo.js                COLO 中文命名
scripts/update-kv.js             聚合、检测并写入 KV
scripts/lib/candidates.js        候选源解析
scripts/lib/check.js             TCP/HTTP Edge 检测
docs/cloudflare-setup.md         Cloudflare 设置说明
docs/deploy-checklist.md         部署前检查清单
docs/source-research.md          同类项目和 IP 源调研
sources/edge/manual.txt          手动 CF Edge 候选源
sources/edge/remote.json         远程 CF Edge 候选源
```

## Cloudflare 资源准备

### 1. 创建 KV Namespace

在 Cloudflare Dashboard 创建 KV Namespace，用来保存：

```text
TEMPLATE   原始 VLESS 模板，由网页保存
BEST_IPS   最新优选 Edge IP 列表
BEST_IPS_LAST      最近一次写入的优选结果
BEST_IPS_LATEST_VERSION 最近版本 key
BEST_IPS_VERSION_INDEX  最近版本索引，默认只保留 30 个 BEST_IPS_* 快照
BEST_IPS_TREND     最近 7 次刷新趋势
STATUS     更新时间、可用数量、检测状态、连续 fallback、最近成功刷新时间
SOURCE_HEALTH      最近一次候选源抓取健康报告，含每源状态、候选数、错误和耗时
TEMPLATE_AUDIT     最近一次模板更新审计信息
LAST_RUN_*       最近一次 GitHub Actions 自动刷新结果
```

创建后记录 Namespace ID，并填入：

```toml
[[kv_namespaces]]
binding = "SUB_KV"
id = "你的 KV Namespace ID"
```

### 2. 创建 Pages 项目

建议配置：

```text
项目名：preferred-sub-generator
构建命令：留空
构建输出目录：public
Functions 目录：functions
KV 绑定变量名：SUB_KV
```

### 3. 设置 Pages 环境变量

Cloudflare Pages 生产环境需要设置：

```text
SUB_TOKEN   管理 token，用于保存/读取原始 VLESS 模板
```

建议同时设置：

```text
SUB_READ_TOKEN   只读 token，用于 /sub 和 /best
```

如果暂时不设置 `SUB_READ_TOKEN`，只读接口会回退使用 `SUB_TOKEN`。长期建议二者分开，避免把管理 token 放进客户端。

可选环境变量：

```text
SUB_READ_TOKEN             只读 token，用于 /sub 和 /best；不设置时回退使用 SUB_TOKEN
SUB_READ_TOKEN_NEXT        只读 token 轮换期间的新 token
SUB_PUBLIC=1              显式恢复公开 /sub 和 /best 的旧行为，不推荐
ALLOW_QUERY_TOKEN=1       临时允许 /api/template?token=，默认关闭
SOURCE_MAX_BYTES=5242880  远程候选源最大读取字节数，默认 5MB
REQUIRE_CF_RAY=1          只保留带 cf-ray 的 Cloudflare Edge 验证结果，默认开启
ALLOW_TCP_ONLY=1          兼容 TCP 可达但无 cf-ray 的结果，默认关闭
VERSION_RETENTION=30      BEST_IPS_* 版本快照保留数量，默认 30
```

订阅接口 `/sub` 和 `/best` 默认需要只读 token；管理接口 `/api/template` 需要 `SUB_TOKEN`。管理接口默认只接受 `Authorization: Bearer <SUB_TOKEN>`，不要把管理 token 拼进 URL。

## 部署到 Cloudflare Pages

### 方式 A：Wrangler 命令部署

确认已安装 Wrangler，并已配置 Cloudflare API Token 后：

```bash
npm test
npm run preflight
npx wrangler pages deploy public --project-name preferred-sub-generator --branch main --commit-dirty=true
```

如果需要指定账号和 token：

```bash
CLOUDFLARE_ACCOUNT_ID=你的账号ID \
CLOUDFLARE_API_TOKEN=你的API_TOKEN \
npx wrangler pages deploy public --project-name preferred-sub-generator --branch main --commit-dirty=true
```

### 方式 B：Cloudflare Dashboard 连接 GitHub

1. 打开 Cloudflare Dashboard。
2. 进入 Workers & Pages。
3. 创建 Pages 项目。
4. 连接 GitHub 仓库。
5. 设置：

```text
构建命令：留空
构建输出目录：public
```

6. 绑定 KV：

```text
变量名：SUB_KV
Namespace：你创建的 KV
```

7. 添加生产环境变量：

```text
SUB_TOKEN   管理 token，用于保存/读取原始 VLESS 模板
```

8. 部署。

## GitHub Actions 自动刷新 KV

仓库包含：

```text
.github/workflows/update.yml
```

默认每 6 小时运行一次，也支持手动触发。

需要配置 GitHub Actions Secrets：

```text
CLOUDFLARE_API_TOKEN_2    用于 GitHub Actions 写 KV 的 Cloudflare API Token（当前账号）
CLOUDFLARE_ACCOUNT_ID     Cloudflare 账号 ID
CLOUDFLARE_NAMESPACE_ID   SUB_KV 的 Namespace ID
```

不需要配置原始 VLESS 节点。真实节点通过网页输入并保存到 KV 的 `TEMPLATE`。

Actions 运行逻辑：

```text
读取 KV 中 TEMPLATE
读取 sources/edge/manual.txt
读取 sources/edge/remote.json
检测 Cloudflare Edge 候选 IP
写入 BEST_IPS
写入 STATUS
  ↓
清理超出保留上限的 BEST_IPS_* 版本快照
  ↓
可选 webhook 通知；通知失败只记录 warning，不阻断 KV 更新
```

如果还没有通过网页保存过模板，Actions 会提示缺少 `TEMPLATE`。

## Cloudflare API Token 权限建议

用于 GitHub Actions 写 KV 的 token 至少需要：

```text
Account → Workers KV Storage → Edit
Account → Account Settings → Read
```

用于 Pages 部署的 Cloudflare API Token 还需要：

```text
Account → Cloudflare Pages → Edit
```

建议资源范围只选择当前目标账号。

## 如何使用网页生成订阅

1. 打开首页：

```text
https://你的域名/
```

2. 粘贴原始 VLESS 链接。
3. 选择默认格式，例如 `v2rayNG`。
4. 点击“生成优选订阅”。
5. 页面会先把原始 VLESS 保存到 KV 的 `TEMPLATE`，再生成订阅地址。
6. 复制 v2rayNG / Clash / Sing-box / Shadowrocket 对应订阅地址导入客户端。

## 与 edgetunnel 2.0 配合

如果你使用 edgetunnel 2.0：

1. 先在 edgetunnel 2.0 生成或复制你的 VLESS 节点。
2. 确认该原始 VLESS 在客户端里单独导入可用。
3. 把这个 VLESS 粘贴到本项目网页。
4. 点击生成优选订阅。
5. 将生成出的订阅 URL 导入 v2rayNG、Clash、Sing-box 等客户端。

注意：edgetunnel 2.0 的原始节点如果本身不可用，本项目生成出的优选订阅也通常不可用。

## API 说明

### 状态

```text
GET /status
```

公开接口，不需要 token。返回更新时间、可用节点数量、来源数量等。

### 订阅

```text
GET /sub?type=vless
GET /sub?type=v2rayng
GET /sub?type=clash
GET /sub?type=singbox
GET /sub?type=shadowrocket
GET /sub?type=v2rayng&template=1
GET /sub?type=v2rayng&slot=1&wrap=76
```

可选参数：

```text
n=20        限制返回节点数量，最多 50
template=1  使用 TEMPLATE_1 模板槽位，支持 1-5
slot=1      使用 TEMPLATE_1 模板槽位，template 的别名
wrap=76     v2rayNG/base64 输出按固定宽度换行，兼容老客户端/复制场景
```

### 优选列表

```text
GET /best?n=20
GET /best?n=20&version=last
```

返回当前 KV 中的优选节点 JSON。`version=last` 返回最近一次版本化快照。

### 优选版本

```text
GET /versions
GET /versions?n=10
```

需要只读 token，返回最近 `BEST_IPS_*` 版本索引，不直接返回节点详情。可配合 `/best?version=...` 做回滚和诊断。

### 模板配置

```text
GET  /api/template
POST /api/template
GET  /api/template?slot=1
POST /api/template?slot=1
```

`/api/template` 需要管理 token，默认只接受：

```text
Authorization: Bearer 你的SUB_TOKEN
```

GET 只返回安全预览，不返回完整原始 VLESS。`slot=1` 到 `slot=5` 可保存多个模板槽位。

读取模板安全预览：

```bash
curl -H "Authorization: Bearer 你的SUB_TOKEN" \
  https://你的域名/api/template
```

写入模板：

```bash
curl -X POST https://你的域名/api/template \
  -H "Authorization: Bearer 你的SUB_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"template":"vless://..."}'
```

### 健康检查

```text
GET /health
GET /health/full
```

`/health` 只返回最小公开状态：

```json
{ "ok": true }
```

`/health/full` 需要 `Authorization: Bearer 你的SUB_TOKEN`，返回 KV、模板和优选节点数量等详细信息。

## 候选源配置

### 手动源

编辑：

```text
sources/edge/manual.txt
```

每行一个：

```text
1.1.1.1
1.1.1.1:443
example.com:443
104.16.0.0/13
```

只放 Cloudflare Edge IP、域名或 CIDR，不放 ProxyIP / 中转 IP。

### 远程源

编辑：

```text
sources/edge/remote.json
```

当前默认包含：

```text
Cloudflare 官方 IPv4 CIDR
cmliu addressesapi.txt
cmliu addressesipv6api.txt
cmliu addressescsv.csv
amclubs ipv4.txt
```

CSV 源支持：

```json
{
  "name": "cmliu-addresses-csv",
  "url": "https://raw.githubusercontent.com/cmliu/WorkerVless2sub/main/addressescsv.csv",
  "type": "csv",
  "minSpeed": 8
}
```

CIDR 源支持：

```json
{
  "name": "cloudflare-official-v4",
  "url": "https://www.cloudflare.com/ips-v4/",
  "type": "text",
  "cidrSamples": 4
}
```

## 本地验证

```bash
npm test
npm run preflight
```

当前测试覆盖：

- VLESS 解析与生成
- IPv6 VLESS 地址方括号兼容
- v2rayNG base64 订阅
- Clash/Mihomo 输出
- Sing-box 输出
- Shadowrocket 输出
- CloudflareSpeedTest CSV 源解析
- COLO 中文节点名
- 访问控制
- 部署前检查

## 上线后验证

```bash
curl https://你的域名/status
curl https://你的域名/health
curl -H "Authorization: Bearer 你的SUB_TOKEN" https://你的域名/health/full
curl "https://你的域名/sub?type=v2rayng&t=你的SUB_READ_TOKEN"
curl "https://你的域名/best?n=20&t=你的SUB_READ_TOKEN"
curl "https://你的域名/versions?t=你的SUB_READ_TOKEN"
```

订阅接口 `/sub` 和 `/best` 默认需要只读 token。推荐在客户端订阅 URL 使用短参数：

```text
/sub?type=v2rayng&t=你的SUB_READ_TOKEN
/best?n=20&t=你的SUB_READ_TOKEN
/versions?t=你的SUB_READ_TOKEN
```

如果你明确接受公开风险，可以设置 `SUB_PUBLIC=1` 兼容旧行为。管理接口 `/api/template` 仍必须使用 `SUB_TOKEN`，且默认不接受 `?token=`。

如果 `/sub` 返回没有可用节点，先确认 GitHub Actions 是否已经成功刷新 `BEST_IPS`，或者手动触发一次 Actions。

## 常见问题

### v2rayNG 能导入，但真连接全是 -1

先单独导入原始 VLESS 测试。如果原始 VLESS 不能用，生成后的优选订阅通常也不能用。

### 为什么不支持 ProxyIP / 中转 IP？

本项目目标是 Cloudflare Edge 入口优选，不做中转池。ProxyIP、SOCKS5、NAT64 会扩大复杂度和风险，已明确不采用。

### 为什么不要把原始 VLESS 写进 GitHub Secret？

GitHub Secret 虽然不是公开文本，但没有必要让 GitHub Actions 持有真实节点。网页保存到你自己的 Cloudflare KV 更符合私用场景。

### COLO 不认识怎么办？

未知 COLO 会显示为：

```text
🌐 XXX
```

可以在 `src/utils/colo.js` 里补充映射。

## 📖 延伸阅读

- [docs/audit-2026-06-04.md](docs/audit-2026-06-04.md) — 项目改进建议报告（58 条）

## 相关文档

```text
docs/cloudflare-setup.md
docs/deploy-checklist.md
docs/source-research.md
```

## 免责声明

本项目仅用于个人学习和私用订阅管理。请遵守当地法律法规。不要把真实节点提交到不可信的公开订阅器。