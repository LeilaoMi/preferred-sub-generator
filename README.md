# Preferred Sub Generator

[![CI](https://github.com/LeilaoMi/preferred-sub-generator/actions/workflows/ci.yml/badge.svg)](https://github.com/LeilaoMi/preferred-sub-generator/actions/workflows/ci.yml)

单用户私用的 Cloudflare Edge 优选订阅生成器。

它的核心目标很简单：**保留你的原始 VLESS 节点参数，只把入口地址替换成测速后的 Cloudflare 高速边缘 IP，然后生成适合不同客户端导入的订阅。**

> 隐私提醒：公开 `/sub` 等价于公开由真实 VLESS 模板派生出的完整订阅，包含 UUID、Host、SNI、path 等敏感参数。默认私密模式下，`/sub` 和 `/best` 需要只读 token；只有显式设置 `SUB_PUBLIC=1` 才会公开订阅。

## 🚀 复刻部署三步（零配置）

1. **Fork** 本仓库，在你的 fork 里打开 **Actions** 页，点「I understand my workflows, go ahead and enable them」（GitHub 对 fork 默认关闭定时任务）。
2. 在 **Settings → Secrets and variables → Actions** 新建两个 secret：
   - `CLOUDFLARE_ACCOUNT_ID`：Cloudflare 控制台右侧栏的账户 ID；
   - `CLOUDFLARE_API_TOKEN`：在 Cloudflare「我的个人资料 → API 令牌」创建，权限勾选 **Cloudflare Pages：编辑、Workers KV 存储：编辑、D1：编辑**（D1 可不勾，没有时测速回传自动改用 KV）。
3. 在 Actions 页依次手动运行 **Deploy to Cloudflare Pages** → **Update Preferred Subscription** → **China Probe (Globalping)**。

完成。KV 命名空间、D1 数据库、Pages 项目全部由 `scripts/cf-bootstrap.js` 自动查找或创建，不需要改 `wrangler.toml`，也不需要填节点域名（未设置 `VLESS_HOST` 时用 `speed.cloudflare.com` 做通用初筛）。部署地址是 `https://preferred-sub-generator-xxx.pages.dev`（Pages 项目页可见），edgetunnel 里把它作为 SUB 订阅器填入即可。

可选：`GLOBALPING_TOKEN`（secret，在 globalping.io 免费注册，国内实测额度翻倍）、`VLESS_HOST`（variable，填你 edgetunnel 的自定义域名，初筛更贴近真实）、`PAGES_PROJECT`（variable，自定义 Pages 项目名）。

## 2026-10-12：国内视角稳定输出（对齐 cmliu 的固定名单思路）

- **edgetunnel 探测和默认订阅不再随机抽样**，固定输出：国内本机实测 ok（按 RTT）→ `manual.txt` 手动置顶 → 不足 `SUB_MIN_NODES`（默认 10）时才用过审池按固定顺序补齐。每次拉取结果一致。`mode=sample` 仍可显式使用。
- 只采信最近 `SUB_VERIFIED_DAYS`（默认 3）天的实测。
- **国内三网自动实测（无需手机）**：`.github/workflows/china-probe.yml` 每 2 小时借 [Globalping](https://globalping.io) 的中国大陆电信/联通/移动探针，对过审池做 TCP 443 握手测量（每轮约 60 个 IP，按游标轮转覆盖整池），结果写入 KV `CN_PROBE_FEEDBACK`，与本机回传合并参与排序。美国初筛连不上的 cmliu 反代 IP（大多只对国内开放）进入待验证池 `CN_PENDING_IPS`（上限 `CN_PENDING_MAX`，默认 300），只有国内实测 ok 的才进订阅。可选 secret `GLOBALPING_TOKEN` 提高额度、变量 `CN_PROBE_BUDGET` 调整每轮数量。局限：测不到 SNI 阻断。
- 手机 Termux 实测（可选补充）：见 [docs/termux.md](docs/termux.md)，`bash scripts/termux-probe.sh`（全量过审池、不测带宽、检测到走代理会中止）。
- `probe-ips.js` 新增 `--pool`（全量实测，最多 300）、`--force`；回传自动分批。
- **稳定优先，放行反代 IP**：恢复 cmliu 社区源（`addressesapi.txt` / CSV）。这些源基本是 Oracle/AWS/Linode 上的反代 IP，正是 cmliu 在国内稳定的原因，默认放行。流量内容仍是 TLS 端到端加密，但反代方可见连接元数据、可随时失效；介意的话在 GitHub Actions Variables 设 `ALLOW_RELAY=0`，只保留 Cloudflare 官方段 IPv4。
- `EDGE_BLACKLIST`（Actions Variable，逗号分隔 CIDR）可追加网段黑名单。
- `manual.txt` 条目即使美国扫描不过审也保留在池里（`edgeVerified:false`）。
- 修复：扫描时解析不出 HTTP 状态码的回包不再判为可用。

## 功能特性

- 节点配置来自环境变量离散配置（VLESS_UUID / VLESS_SNI / VLESS_HOST / VLESS_PATH 等，对标竞品），项目内不保存任何模板；管理页只读展示当前配置并校验风险项（如 workers.dev SNI 在中国大陆被阻断）。
  粘贴 `vless://` 链接仅做导入填充，仍需逐项检查后保存——不再静默照抄整条链接。
  SNI 为 `workers.dev` / `pages.dev` 等已知被 SNI 阻断的域名时会给出明确警告（仍可保存）。
- 自动聚合 Cloudflare Edge 候选源（当前默认只保留 Cloudflare 官方源，避免第三方源混入中转 IP）：
  - Cloudflare 官方 IPv4 CIDR（`https://www.cloudflare.com/ips-v4/`）。
  - Cloudflare 官方 IPv6 CIDR（`https://www.cloudflare.com/ips-v6/`）。
  - 本地手动源 `sources/edge/manual.txt`。
  - 可按需在 `sources/edge/remote.json` 自行添加 cmliu/amclubs 等社区源（注意区分 CF 边缘 IP 与中转 IP）。
- 候选源并行抓取：多源同时拉取，单源 10 秒超时隔离，一个源挂掉不拖慢整轮刷新；每源健康状态记入 `SOURCE_HEALTH`。
- CSV 源按表头解析：按列名（ip/端口/tls/速度/数据中心）定位，不再依赖固定列顺序；上游加列不再静默错位。
- 自动检测候选 IP 的可达性、延迟和 Cloudflare COLO：每个候选测 3 次，时通时断的直接淘汰。
- 扫描只做"资格审查"，不发榜：GitHub Actions 用 **VLESS_SNI** 当 SNI 逐个直连候选 IP，要求返回 2xx（含 cf-ray）才算过审；过审结果按 IP 地址聚合为"过审池"写入 KV（单个 IP 记下全部过审端口，池上限 300）。
- 节点排序只用你本机的实测：实测 ok 的按实测 RTT 升序排前面；没实测过的只保证 6 小时内验证活着，不排名。美国扫描机的延迟不再参与排序——那是 demo 数据。
- 抽样模式（`mode=sample`）：每次从过审池里加权随机抽，有本地实测的被抽中概率 ×3。
- 订阅有两种发法：默认是确定性排序（实测优先）；`mode=sample` 是抽样模式，每次拉取换一批。
- 抽样模式细节：节点端口优先 443；节点名不印延迟（有本地实测才标 `实测`）。
- edgetunnel 探测旁路每次从池里抽样 **30** 个 IP 发出去（edgetunnel 每次生成订阅都会来拉，天然轮换），端口走 443 优先（该 IP 过审端口含 443 就发 443；国内运营商对 2053/2083 等非标准端口建连超时的概率明显高于 443）。
- 提供浏览器本地测速反馈面板：首页「开始测速」按钮在用户浏览器本地通过 Cloudflare 官方端点 `speed.cloudflare.com/__down` 实测下载速度，结果回传 `/api/speedtest-feedback` 存入 D1（未绑定时回退 KV），可用于验证国内真实访问质量；`/admin.html` 提供按天趋势面板。
- `/status` 标注测速地点（`speedtestLocation`，当前为 `GitHub Actions (US)`）、平均延迟（`averageLatency`）和平均带宽（`averageSpeed`；每 6 小时对 Top 30 过审节点主动抽测带宽，结果写入 KV）。
- 订阅响应带 `Subscription-Userinfo` 头，客户端订阅页正常显示流量与有效期，不再空白。
- `type` 参数缺省时按客户端 UA 自动识别格式（Clash/Mihomo/Sing-box/Shadowrocket/v2rayNG），裸域名可直接当订阅地址用；显式 `?type=` 优先。
- 订阅节点名称支持中文友好 COLO 展示。默认（固定榜）例如：

```text
🇺🇸 美国洛杉矶 LAX 12ms #1
🇭🇰 香港 HKG 18ms #2
🇸🇬 新加坡 SIN 22ms #3
```

抽样模式（`mode=sample`）下不再印美国扫描机的延迟，例如 `🇺🇸 美国洛杉矶 LAX #1`。
- 节点名里出现 `28ms 实测` 时，COLO 和延迟来自**你本机的实测**（`scripts/probe-ips.js` 回传的数据），而不是美国扫描机看到的数字。
- 订阅支持按线路过滤：`/sub?colo=HKG`、`/best?colo=auto`（`auto` = 你当前接入点），无匹配时自动回退全量，订阅不会变空。
- IPv6 独立通道：IPv6 候选不再因无 v6 测速环境被一刀切丢弃，收录进独立池 `BEST_IPS_V6`（标记未实测），`/sub?ip6=1` 追加返回，节点名带 `[IPv6]` 前缀，不占常规名额。
- 端口优先级可配：`SUB_PREFERRED_PORTS` 环境变量覆盖端口顺序（默认 443 优先，基于国内运营商实测）；换线路不用改代码。
- 支持在本机探测每个候选 IP 的 TCP 握手延迟、落地 COLO 和下载带宽，回传 `/api/ip-feedback` 后：默认订阅按你的实测结果重排，抽样模式下则按实测加权抽样——这是让代理真正变快的关键一步。
- 本地探测默认用 **VLESS_SNI 环境变量的域名**当探测 SNI（`--slot` 选账号槽位、`--sni` 覆盖），因此能识别出「IP 活着但不服务你的 zone」的 `error code: 1034` 节点；这类节点会带 `ok:false` 回传，订阅生成时自动剔除（失败多于成功才剔，剔完为空则回退全量）。
- 首页状态卡显示「你的接入点」和「你的延迟」（你到 Cloudflare 边缘的真实 RTT，3 次取最小）。

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
  - `/api/read-token`
  - `/api/template`
  - `/api/ip-feedback`
- `/sub`、`/best` 默认需要只读 token，避免真实订阅被公开拉取。
- `/api/template` 需要管理 token，只读返回当前环境变量节点配置（含风险校验）；写入接口已下线（410），配置请去 Cloudflare Dashboard 的 Pages 环境变量修改。
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

## 当前实际线上状态

当前仓库已按 Cloudflare Pages 方式部署并验证。

```text
生产自定义域名：https://yxdy.woniu.bee.al
Pages 项目名：preferred-sub-generator（见 wrangler.toml）
KV 绑定变量：SUB_KV
KV Namespace ID / D1 database_id：见 wrangler.toml（非密钥，可随仓库公开；真正的凭据只有环境变量里的 token）
```

KV 里 `BEST_IPS` 现在是过审 IP 池（按地址聚合，含各 IP 全部过审端口，`ports` 字段），不再是固定的前 50 名榜单；`STATUS.available` 统计的是池大小。

当前线上关键行为：

```text
/status                         公开状态接口，HTTP 200，含 speedtestLocation / averageSpeed
/health                         公开最小健康检查，HTTP 200
/api/read-token                 匿名只返回是否配置 SUB_READ_TOKEN；带管理 token Bearer 才返回只读 token 值，HTTP 200
/api/speedtest-feedback         POST 公开回传浏览器本地测速结果（colo/speed）；GET 需管理 token 查看汇总与按天趋势
/sub?type=v2rayng&t=只读token   返回 v2rayNG base64 订阅，HTTP 200
/sub?t=只读token&colo=auto       按线路过滤后的订阅，无匹配自动回退全量
/best?n=2&t=只读token           返回优选 IP JSON，HTTP 200，含 measured（实测节点数），带 colo= 时含 filter
/best?n=2&t=只读token&rank=off   关闭按实测数据重排
/api/ip-feedback                POST 需管理 token 回传逐 IP 实测；GET 需管理 token 查看聚合分数（默认统计 14 天）
/sub?host=example.com&uuid=00000000-0000-4000-8000-000000000000  edgetunnel 探测旁路，免 token 返回占位 base64 订阅（UA 需含 edgetunnel）；每次从过审池抽样 30 个，端口 443 优先，名称不带美国延迟
```

真实 token 只保存在 Cloudflare Pages 环境变量中，仓库不保存、不展示。首页在浏览器中请求 `/api/read-token` 时必须带上管理 token 才能换到 `SUB_READ_TOKEN`，换到后自动把 `t=只读token` 拼进订阅链接并存入 localStorage；匿名请求只能得到 `configured` 标记，拿不到 token 值。管理 token `SUB_TOKEN` 不会进入订阅 URL。

### 可配合 GitHub Actions

`.github/workflows/update.yml` 每 6 小时定时刷新 KV（不负责部署页面）：

```text
抓取候选源（并行，单源 10s 超时） → 检测可用 CF Edge（含抖动多采样）→ Top 30 带宽抽测 → 写入 BEST_IPS / BEST_IPS_V6 和 STATUS
```

`.github/workflows/deploy-pages.yml` 在 push 到 `main` 时自动部署到 Cloudflare Pages（`wrangler pages deploy public`，用仓库 Secrets 里的 `CLOUDFLARE_API_TOKEN_2` / `CLOUDFLARE_ACCOUNT_ID`）。改完代码 push 即可上线，不用再手动跑 wrangler。

节点探测参数通过 GitHub Actions Variables 传入（`VLESS_SNI` / `VLESS_HOST` / `VLESS_SECURITY`），与 Pages 环境变量保持一致；UUID 不需要进 GHA。

### 不建议直接部署到普通静态托管

普通静态托管只能展示页面，不能运行 `functions/` 里的 API，也不能读写 Cloudflare KV，因此不能完整工作。

### 可迁移但未内置适配的平台

理论上可迁移到 Vercel、Netlify、Workers，但需要改 API 路由和 KV/数据库读写逻辑。本仓库不默认支持这些平台。

## 项目结构

```text
.github/workflows/update.yml     GitHub Actions 定时刷新 KV
.github/workflows/deploy-pages.yml  push 到 main 自动部署到 Cloudflare Pages
public/index.html                中文首页，粘贴 VLESS 并生成订阅
public/admin.html                私用节点配置只读展示页
functions/sub.js                 订阅接口
functions/best.js                优选 IP 列表接口
functions/versions.js            优选 IP 版本索引接口
functions/status.js              公开状态接口
functions/health.js              健康检查接口
functions/api/read-token.js      用管理 token 换取 SUB_READ_TOKEN，用于首页自动拼订阅 URL
functions/api/template.js        节点配置只读接口（POST 已下线）
functions/api/speedtest-feedback.js  浏览器本地测速结果回传与汇总
functions/api/ip-feedback.js      逐 IP 实测数据回传与读取
src/api/node-filter.js            线路过滤与按实测数据重排
src/api/ip-feedback.js            实测数据存储抽象与聚合
src/parser/vless.js              VLESS 解析
src/generator/vless.js           VLESS 生成
src/generator/clash.js           Clash/Mihomo 输出
src/generator/singbox.js         Sing-box 输出
src/generator/shadowrocket.js    Shadowrocket 输出
src/utils/colo.js                COLO 中文命名
src/api/speedtest-feedback.js    测速反馈接收与汇总
src/api/speedtest-db.js          测速反馈存储抽象（D1 优先，KV 回退）与按天聚合
scripts/update-kv.js             聚合、检测并写入 KV
scripts/probe-ips.js             本机探测候选 IP 延迟/COLO/带宽并回传
scripts/lib/candidates.js        候选源解析（并行抓取、CSV 表头解析）
scripts/lib/check.js             TCP/HTTP Edge 检测（含抖动多采样）
scripts/lib/speed.js             带宽测速（直连 IP 下载，供 GHA 抽测复用）
docs/cloudflare-setup.md         Cloudflare 设置说明
docs/deploy-checklist.md         部署前检查清单
docs/d1-setup.md                 D1 测速数据存储与趋势面板绑定说明
docs/source-research.md          同类项目和 IP 源调研
sources/edge/manual.txt          手动 CF Edge 候选源
sources/edge/remote.json         远程 CF Edge 候选源
```

## Cloudflare 资源准备

### 1. 创建 KV Namespace

在 Cloudflare Dashboard 创建 KV Namespace，用来保存：

```text
BEST_IPS   最新优选 Edge IP 列表
BEST_IPS_V6      IPv6 候选独立池（未实测标记，仅 ?ip6=1 时返回）
BEST_IPS_LAST      最近一次写入的优选结果
BEST_IPS_LATEST_VERSION 最近版本 key
BEST_IPS_VERSION_INDEX  最近版本索引，默认只保留 30 个 BEST_IPS_* 快照
BEST_IPS_TREND     最近 7 次刷新趋势
STATUS     更新时间、可用数量、检测状态、连续 fallback、最近成功刷新时间
SOURCE_HEALTH      最近一次候选源抓取健康报告，含每源状态、候选数、错误和耗时
SPEED_FEEDBACK     浏览器本地测速反馈记录（D1 未绑定时的回退存储），最多保留 500 条，由 /api/speedtest-feedback 写入
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
项目名：your-pages-project
构建命令：留空
构建输出目录：public
Functions 目录：functions
KV 绑定变量名：SUB_KV
```

### 3. 设置管理 token（一次性）

部署完成后，在浏览器打开 `https://你的域名/setup`，按提示设置管理 token 即可。

- 只存 SHA-256 哈希，不存原文；设置后即锁定，不可重复设置。
- 存在 KV 中，重新部署不会丢失（Pages 环境变量在 wrangler 部署后可能被清空，不建议再用它存 token）。
- 兼容旧路径：仍可通过 Pages 环境变量 `SUB_TOKEN` 设置，此时设置页自动锁定。

节点配置（对标竞品离散配置，必填，项目内不再存模板）：

```text
VLESS_UUID       节点 UUID（建议设为 Secret）
VLESS_SNI        TLS 握手域名（SNI），决定客户端握手时看到的域名
VLESS_HOST       HTTP Host，决定流量路由到哪个后端
VLESS_PATH       WS 路径，默认为空
VLESS_PORT       默认 443
VLESS_TYPE       默认 ws
VLESS_SECURITY   默认 tls
```

建议同时设置：

```text
SUB_READ_TOKEN   只读 token，用于 /sub 和 /best
```

如果暂时不设置 `SUB_READ_TOKEN`，后端只读接口会回退使用 `SUB_TOKEN`；但首页不会把管理 token 自动拼进订阅 URL。长期必须二者分开，避免把管理 token 放进客户端。

可选环境变量：

```text
SUB_READ_TOKEN             只读 token，用于 /sub、/best、/versions；上线后首页用管理 token 从 /api/read-token 换取它并自动拼到订阅 URL
SUB_READ_TOKEN_NEXT        只读 token 轮换期间的新 token
SUB_PUBLIC=1              显式恢复公开 /sub 和 /best 的旧行为，不推荐
ALLOW_QUERY_TOKEN=1       临时允许 /api/template?token=，默认关闭
SOURCE_MAX_BYTES=5242880  远程候选源最大读取字节数，默认 5MB
REQUIRE_CF_RAY=1          只保留带 cf-ray 的 Cloudflare Edge 验证结果，默认开启
ALLOW_TCP_ONLY=1          兼容 TCP 可达但无 cf-ray 的结果，默认关闭
VERSION_RETENTION=30      BEST_IPS_* 版本快照保留数量，默认 30
SUB_RTT_DROP_MS=1000      实测 rtt 超过该值（毫秒）不进实测池，默认 1000
SUB_PREFERRED_PORTS=      覆盖端口优先级顺序，如 "443,8443,2053"；留空保持 443 优先
SUB_TOKEN_ROTATE_DAYS=    只读 token 自动周期轮换天数，如 7；留空则关闭（默认关闭）
```

订阅接口 `/sub`、`/best` 和 `/versions` 默认需要只读 token；管理接口 `/api/template` 需要 `SUB_TOKEN`。管理接口默认只接受 `Authorization: Bearer <SUB_TOKEN>`，不要把管理 token 拼进 URL。首页上线后会通过 `/api/read-token`（需管理 token）换取 Cloudflare Pages 环境变量 `SUB_READ_TOKEN`，并只把这个只读 token 自动拼进订阅链接。

## 部署到 Cloudflare Pages

### 方式 A：Wrangler 命令部署

确认已安装 Wrangler，并已配置 Cloudflare API Token 后：

```bash
npm test
npm run preflight
npx wrangler pages deploy public --project-name your-pages-project --commit-dirty=true
```

不写 `--branch` 才是上生产；`--branch <名字>` 会部署成该分支的预览版本（只对连接了 Git 的项目有意义）。

如果需要指定账号和 token：

```bash
CLOUDFLARE_ACCOUNT_ID=你的账号ID \
CLOUDFLARE_API_TOKEN=你的API_TOKEN \
npx wrangler pages deploy public --project-name your-pages-project --commit-dirty=true
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
SUB_TOKEN   管理 token，用于管理接口鉴权
```

节点配置（对标竞品离散配置，必填，项目内不再存模板）：

```text
VLESS_UUID       节点 UUID（建议设为 Secret）
VLESS_SNI        TLS 握手域名（SNI），决定客户端握手时看到的域名
VLESS_HOST       HTTP Host，决定流量路由到哪个后端
VLESS_PATH       WS 路径，默认为空
VLESS_PORT       默认 443
VLESS_TYPE       默认 ws
VLESS_SECURITY   默认 tls
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
UPDATE_WEBHOOK_URL        可选，告警 Webhook（Telegram/Slack/企业微信机器人等）
```

可选配置 Actions Variables（阈值调优）：

```text
UPDATE_WEBHOOK_ALWAYS     1 = 每次刷新都推送 webhook（旧行为），默认关闭
ALERT_REPEAT_HOURS        同一告警重复提醒间隔，默认 24 小时
ALERT_FALLBACK_THRESHOLD  连续 fallback 触发 warn 的次数，默认 3
ALERT_MIN_AVAILABLE       可用节点低于该值触发 warn，默认 10
ALERT_DROP_RATIO          可用数相比上次下降比例阈值，默认 0.3
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
告警评估：可用数归零/骤降、连续 fallback 超阈值、刷新失败时才推送 webhook；
状态未变化则静默，同一告警按 ALERT_REPEAT_HOURS 重复提醒，恢复时推送 recovery；
通知失败只记录 warning，不阻断 KV 更新
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
6. 上线环境配置了 `SUB_READ_TOKEN` 后，页面生成的订阅地址会自动带 `t=你的SUB_READ_TOKEN`；不会带管理 token。
7. 复制 v2rayNG / Clash / Sing-box / Shadowrocket 对应订阅地址导入客户端。

## 与 edgetunnel 配合

本项目支持两种 edgetunnel 接入方式。

### cmliu 版 edgetunnel（带 `sub://` 优选订阅生成器）

cmliu 版 edgetunnel 用 `sub://` 协议对接外部"优选订阅生成器"。它的处理逻辑是：

1. 把你填的 `sub://host...` 中的 `sub://` 换成 `https://`，并**丢弃 `#` 和 `?` 之后的所有内容**——所以你在 `sub://` 后面带的 `?t=`、`?type=` 都会被砍掉，不起作用。
2. 自己拼一个固定探测请求：`https://host/sub?host=example.com&uuid=00000000-0000-4000-8000-000000000000`，UA 含 `edgetunnel`。
3. 用 `atob()` 解码响应，识别其中带全 0 uuid + `example.com` 的行，提取 `域名:端口#备注` 作为优选 IP。

因此对接这种 edgetunnel 时：

- **不需要也无法带 token**：cmliu 版会砍掉 query 参数。
- 在 edgetunnel 的"优选订阅地址"里直接填：

```text
sub://your-domain.example.com
```

- 不要加 `?t=` 或 `?type=`，加了也会被丢弃且无意义。

本项目已内置 edgetunnel 探测旁路：当 `/sub` 收到同时满足 `host=example.com` + `uuid=全0` + UA 含 `edgetunnel` 的请求时，免只读 token 放行，返回 base64 编码的占位订阅——节点用占位 `uuid=00000000-...` 和 `host=example.com` 生成，**不会泄露真实 UUID / Host / SNI**。其它非探测请求仍必须带只读 token，私密模式不受影响。

探测走抽样不走固定榜：每次从过审池里加权随机抽 **30** 个 IP（edgetunnel 每次生成订阅都会来拉一次，天然轮换），端口走 443 优先，节点名不带美国扫描机的延迟。edgetunnel 拿到后按自己的模板重新组装节点，你的池子只负责提供"验明正身过的 IP:端口"。

### edgetunnel 2.0（zizifn 风格，直接给订阅 URL）

edgetunnel 2.0 不走 `sub://` 探测协议，直接把订阅 URL 当普通订阅导入：

1. 先在 edgetunnel 2.0 生成或复制你的 VLESS 节点。
2. 确认该原始 VLESS 在客户端里单独导入可用。
3. 把这个 VLESS 粘贴到本项目网页，生成优选订阅。
4. 把生成的带 token 订阅 URL（`/sub?type=v2rayng&t=只读token`）导入 v2rayNG、Clash、Sing-box 等客户端。

注意：原始 VLESS 如果本身不可用，生成出的优选订阅通常也不可用。

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
GET /sub?type=v2rayng&wrap=76
```

可选参数：

```text
n=20        限制返回节点数量，最多 50
wrap=76     v2rayNG/base64 输出按固定宽度换行，兼容老客户端/复制场景
colo=HKG    只保留该线路节点，逗号分隔多个；auto = 你的接入点；无匹配回退全量
rank=off    关闭按本地实测数据排序（默认开启）
mode=sample 抽样模式：每次从过审池里加权随机抽 n 个（见下）
ip6=1       在常规节点之后追加 IPv6 独立池节点（带 [IPv6] 前缀，不占 n 名额）
```

`type` 缺省时按请求 UA 自动识别：Clash/Mihomo/ClashMeta → clash，Sing-box → singbox，Surge → clash，Shadowrocket → shadowrocket，v2rayNG → v2rayng；识别不出回退 vless。显式 `?type=` 始终优先。响应带 `Subscription-Userinfo` 头，客户端订阅页可正常显示。

抽样模式（`mode=sample`）与默认的区别：KV 里存的是检查过审的整个 IP 池。带 `mode=sample` 拉订阅时，每次请求从池里加权随机抽 `n` 个发——有你本地实测的 IP 被抽中概率 ×3，没测过的 ×1；节点端口优先 443；节点名不印延迟（有本地实测才标 `实测`）。去掉这个参数即回退默认的确定性排序。

排序原则（2026-10-12 重设计）：**只有你本机的实测才是真实信号**。默认订阅 = 实测 ok 的节点按实测 RTT 升序排前面，没实测过的按池顺序跟在后面（只保证 6 小时内验证活着，不假装知道快慢）。美国扫描机的延迟/抖动不再参与排序——那是 demo 数据。Clash / Sing-box 输出默认带自动测速分组（`自动测速` url-test），客户端在你线路上自己挑最快的。

特殊：edgetunnel 探测旁路。当请求同时满足 `host=example.com` + `uuid=00000000-0000-4000-8000-000000000000` + UA 含 `edgetunnel` 时，`/sub` 免只读 token 放行，固定返回 base64 编码的占位订阅（占位 uuid/host，不泄露真实参数），用于对接 cmliu 版 edgetunnel 的 `sub://` 协议。探测不走固定榜：每次从过审池里加权随机抽一批 IP 发出去（edgetunnel 每次生成订阅都会来拉一次，天然轮换），端口走 443 优先（国内运营商对非标准端口更易超时），名称不带美国测速延迟。详见「与 edgetunnel 配合」。

### 优选列表

```text
GET /best?n=20
GET /best?n=20&version=last
GET /best?n=20&colo=auto
GET /best?n=20&rank=off
```

返回当前 KV 中的优选节点 JSON。`version=last` 返回最近一次版本化快照。

`colo=` 过滤会返回 `filter` 字段说明命中情况（`matched` / `fallback` / `matchedCount` / `total`）；`rank` 默认按本地实测数据重排，命中的节点带 `userRtt`、`userColo`、`userSpeed` 字段，顶层 `measured` 表示本次返回里有多少个节点是实测过的。带 `colo=` 时返回的 `total` 是过滤后的节点数。

匹配优先级：先看你本机回传的落地 COLO（`userColo`），再看扫描记录的 COLO（`colo`）。

### 优选版本

```text
GET /versions
GET /versions?n=10
```

需要只读 token，返回最近 `BEST_IPS_*` 版本索引，不直接返回节点详情。可配合 `/best?version=...` 做回滚和诊断。

### 换取只读订阅 token

```text
GET /api/read-token
```

需要管理 token（`Authorization: Bearer <SUB_TOKEN>`）才会返回只读 token 的值；匿名请求只返回 `{ configured }`，不会泄露 `SUB_READ_TOKEN`。用于首页换取只读 token 后自动生成可直接导入客户端的订阅 URL。换取到的只读 token 只存在浏览器 localStorage，不会返回管理 token `SUB_TOKEN`。

开启 `SUB_TOKEN_ROTATE_DAYS` 后，下发的是按周期派生的 token（HMAC-SHA256(只读token, 周期)，当期有效），泄露的订阅链接最多存活一个周期；静态只读 token 降级为派生密钥，不再直接接受为凭证。

### 测速反馈

```text
POST /api/speedtest-feedback
GET  /api/speedtest-feedback
```

`POST` 公开接口，接收浏览器本地测速结果：用 Cloudflare 官方端点 `speed.cloudflare.com/__down?bytes=10000000` 在用户浏览器本地实测下载速度，附带 `/cdn-cgi/trace` 拿到的 COLO 和 ISP，回传后端存入 D1 的 `speed_feedback` 表（未绑定 `SPEED_DB` 时回退 KV 的 `SPEED_FEEDBACK`，最多 500 条）。原始 IP 不落库，只存 SHA-256 哈希前缀。带基础频率限制。

`GET` 需要管理 token，支持 `?days=N&limit=M`（`days` 上限 90、`limit` 上限 1000），返回测速汇总（平均速度、最高速度、COLO 分布、按天趋势 `trend`）和明细列表，`storage` 字段标明当前走 D1 还是 KV。

读取测速汇总与按天趋势：

```bash
curl -H "Authorization: Bearer 你的SUB_TOKEN" \
  "https://你的域名/api/speedtest-feedback?days=14"
```

趋势面板也可在 `/admin.html` 的「测速趋势」区块直接查看。

### 实测反馈（IP 级）

```text
POST /api/ip-feedback
GET  /api/ip-feedback
```

`POST` 需要管理 token，接收 `scripts/probe-ips.js` 回传的逐 IP 实测结果：

```json
{
  "results": [
    { "address": "104.25.85.85", "port": 443, "rtt": 38.4, "colo": "HKG", "region": "HK", "speed": 42.1, "ok": true },
    { "address": "108.162.192.1", "port": 443, "rtt": null, "colo": "", "ok": false }
  ]
}
```

`rtt` 是本机 TCP 握手延迟（毫秒），`colo`/`region` 是连该 IP 时 `/cdn-cgi/trace` 返回的落地点，`speed` 是下载带宽 Mbps（可选）。单次最多 200 条，带基础频率限制，原始 IP 不落库（只存 SHA-256 哈希前缀以外的必要字段：地址本身是公开的 CF 边缘 IP，不是你的 IP）。存储优先写 D1 的 `ip_feedback` 表，未绑定 `SPEED_DB` 时回退 KV 的 `IP_FEEDBACK`（最多 500 条）。

`ok`（可选）表示这个 IP 在你那边**到底能不能用**：`true` = 连得上且对该域名返回可用回包；`false` = TCP 连不上，或者连上了但对该域名返回非 2xx（典型是 `error code: 1034` 这种「IP 活着但不服务你这个 zone」的边缘拦截）。`ok:false` 时 `rtt` 可以为 `null`（`colo` 也为空）；老数据没有 `ok` 字段，行为与旧版一致。

`GET` 需要管理 token，`?days=N`（默认 14、上限 90）返回按 IP 聚合的分数（`rtt` 平均值、`speed` 平均值、最新 `colo`、样本数、`failed` 失败次数、`unreachable` 是否判定不可用）。

`/sub` 与 `/best` 读取最近窗口内的实测数据：默认按实测 RTT 升序排序（实测过的排前面，未实测的按原顺序跟在后面），`rank=off` 可关闭；`/sub?mode=sample` 下则改为加权随机抽样（实测好的 IP 被抽中概率 ×3）。被判定为 `unreachable`（失败次数多于成功次数）的 IP 会被直接剔除，`/best` 响应里的 `droppedUnreachable` 就是剔除数量；如果剔完一个不剩，自动回退全量，订阅不会变空。数据全空时行为与旧版完全一致。

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

当前默认只保留 Cloudflare 官方源：

```text
Cloudflare 官方 IPv4 CIDR（ips-v4）
Cloudflare 官方 IPv6 CIDR（ips-v6）
```

> 历史上接入过 cmliu `addressesapi.txt`、`addressesipv6api.txt`、`addressescsv.csv` 和 amclubs `ipv4.txt`。实测发现部分社区源会混入 Oracle Cloud 等非 CF 边缘中转 IP，污染优选结果，已默认移除。如确认某源是纯 CF 边缘 IP，可自行加回 `remote.json`。

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
  "cidrSamples": 16
}
```

仓库自带的官方源两个都配了 `cidrSamples: 16`（每个 CIDR 抽 16 个样本进池）。

## 本地探测与线路过滤（按你的真实线路选 IP）

扫描机跑在 GitHub Actions（美国），它测出来的延迟和 COLO 只代表**美国机房视角**；Cloudflare 官方 IP 是 anycast，你连过去落在哪个 PoP、走哪条线路，取决于你的运营商到这段 IP 的路由，两者经常完全相反。想让代理真正变快，就得从你自己的机器测一遍。

### 为什么不能在服务端或浏览器里测

- Cloudflare 明确禁止 Workers 对 Cloudflare IP 段发起出站 TCP（`connect()` 直接报 `Outbound TCP sockets to Cloudflare IP ranges are blocked`），边缘函数测不了候选 IP。
- 浏览器直连裸 IP 会因 SNI/证书校验失败，拿不到可靠延迟，而且 https 页面也不允许发到 `http://IP` 的混合内容请求。
- 所以实测只能从你的机器发起——这同时也正是最准的那个视角。

### 用法

需要 Node.js 18+，在能访问你站点的机器上执行：

```bash
SUB_TOKEN=你的管理token SITE_URL=https://你的域名 node scripts/probe-ips.js
```

常用参数：

```text
--speed 5        每个 IP 下载测 5MB 再测带宽（默认 2，0 = 只测延迟）
--samples 3      每个 IP 握手采样次数（默认 3）；成功数过半才算可用，
                 延迟取中位数，筛掉时通时断的抖动节点；1 = 单次（旧行为）
--colo auto      只探测你接入点的线路；或 --colo HKG,NRT
--n 20           只测前 20 个候选
--slot 2         用第 2 个账号槽位的模板当默认 SNI（1-5）
--sni x.y.z      显式指定探测 SNI，优先级最高
--concurrency 8  延迟探测并发（默认 8）
--no-submit      只打印结果不回传
--json out.json  额外把结果导出成 JSON
```

**探测 SNI 默认取订阅模板的域名**（`--sni` 显式指定时优先，取不到模板才回退 `speed.cloudflare.com`）。这点很关键：Cloudflare 的 `error code: 1034` 是「这个 IP 活着，但不服务你的 zone」，只有用**你实际在用的那个域名**去连才暴露得出来；用 `speed.cloudflare.com` 测的话，这类 IP 照样是绿的。脚本启动时会打印它实际用的 SNI 和来源。

脚本分两步：先对每个候选做 `--samples` 次 TCP 握手采样（默认 3 次，成功过半才算可用，延迟取中位数并打印抖动），同时测连该 IP 时的落地 COLO（`/cdn-cgi/trace`），再以并发 2 测下载带宽，最后打印排序结果并回传 `/api/ip-feedback`。**连不上的、握手抖动的、或对该域名拿不到可用回包的 IP 会带 `ok:false` 一起回传**，服务端据此把它们从订阅里剔掉，不用你手动挑。

### 回传之后

- `/sub` 和 `/best` 默认按实测 RTT 升序重排，实测过的节点排前面，节点名变成 `🇭🇰 香港 HKG 28ms 实测 #1` 这种——COLO 和延迟都来自你的实测。`rank=off` 可以关掉；`mode=sample` 下实测只影响抽样权重。
- 首页「线路过滤」填 `auto`（你的接入点）或 `HKG,NRT`，生成的订阅 URL 会自动带 `colo=`；过滤无匹配时回退全量，订阅不会变空。
- 实测数据默认只统计最近 14 天；没有实测数据时，一切行为与旧版完全一致。

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
- IPv6 CIDR 展开与 IPv6 地址/端口解析
- 候选源端到端（含 CF 官方 IPv6 源）
- COLO 中文节点名
- 访问控制
- COLO 过滤与实测重排
- 过审池聚合（按地址合并多端口、443 优先）与池上限
- 加权随机抽样（含实测权重、不可用剔除、全死回退）与 443 优先
- 抽样模式的自动测速分组（Clash url-test / Sing-box urltest+selector）
- edgetunnel 探测旁路（抽样 30、443 优先、名称去延迟）
- IP 实测回传（含 `ok:false`）与不可用 IP 剔除
- 候选源并行抓取与单源超时隔离、CSV 表头解析（含回退）
- 抖动多采样、加权评分公式、rtt 淘汰门槛、权重环境变量覆盖
- Subscription-Userinfo 响应头、UA 自动识别客户端格式
- 端口优先级环境变量覆盖（SUB_PREFERRED_PORTS）
- IPv6 独立池与 ?ip6=1 通道
- 只读 token 周期轮换（派生 token 确定性、跨周期、开关行为）
- GHA Top 30 带宽抽测（mock 注入，不打真实网络）
- 候选扫描状态码校验（1034 不入选）
- 部署前检查

## 上线后验证

```bash
curl https://你的域名/status
curl https://你的域名/health
curl -H "Authorization: Bearer 你的SUB_TOKEN" https://你的域名/health/full
curl "https://你的域名/sub?type=v2rayng&t=你的SUB_READ_TOKEN"
curl "https://你的域名/best?n=20&t=你的SUB_READ_TOKEN"
curl "https://你的域名/versions?t=你的SUB_READ_TOKEN"
curl -H "User-Agent: v2rayN/edgetunnel (https://github.com/cmliu/edgetunnel)" "https://你的域名/sub?host=example.com&uuid=00000000-0000-4000-8000-000000000000"
curl -H "Authorization: Bearer 你的SUB_TOKEN" "https://你的域名/api/speedtest-feedback"
```

订阅接口 `/sub`、`/best` 和 `/versions` 默认需要只读 token。推荐在客户端订阅 URL 使用短参数；首页上线后会通过 `/api/read-token` 用管理 token 换取 `SUB_READ_TOKEN` 并生成这种 URL：

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

### 连接报 `unexpected HTTP response status: 403` / `error code: 1034`

Cloudflare 部分边缘 IP 只服务特定 zone：同一个 IP 用 `speed.cloudflare.com` 探测是 `200`，用你的模板域名（`host`/`sni`）探测却返回 `403` + `error code: 1034`。这种响应**同样带 `cf-ray`**，早期扫描只认 `cf-ray`、不看状态码，于是把它们当合格节点写进了 `BEST_IPS`——连上就是 403。

扫描本身就用模板的 `host` 当 SNI 发 `GET /cdn-cgi/trace`（`scripts/update-kv.js`），现在 `checkHttpEdge` 会校验状态码：非 2xx 直接判为不可用，必须 `200` 才入选（`scripts/lib/check.js`）。`scripts/probe-ips.js` 走的是 trace 内容（必须有 `colo=`），本来就不受这个问题影响，现在还会把这类 IP 标成 `ok:false` 回传，`/sub` 和 `/best` 直接剔掉，不用等下一次扫描。

手上已有旧批次的坏 IP：换一个节点即可，`1034` 的 IP 会在下一次扫描（每 6 小时）被剔除；或者在本机跑一次 `node scripts/probe-ips.js`，实测不通过的会立刻被订阅忽略。

### 为什么不支持 ProxyIP / 中转 IP？

本项目目标是 Cloudflare Edge 入口优选，不做中转池。ProxyIP、SOCKS5、NAT64 会扩大复杂度和风险，已明确不采用。

### 为什么不要把原始 VLESS 写进 GitHub Secret？

GitHub Secret 虽然不是公开文本，但没有必要让 GitHub Actions 持有真实节点。网页保存到你自己的 Cloudflare KV 更符合私用场景。

### edgetunnel 仍然显示 `Unauthorized` 怎么办？

确认你填的是 `sub://你的订阅生成器域名`，不要把 `?t=...` 直接拼在 `sub://` 后面。cmliu 版 edgetunnel 会忽略 `sub://` 后面的 query，并自己发起探测请求；本项目已专门兼容它的探测请求，但普通订阅请求仍然需要只读 token。

### 为什么优选 IP 选出来全是美国？

测速在 GitHub Actions（美国）跑，候选来自 CF 官方 IP 段和社区源，Anycast 导致从美国探测到的多是美国节点。这是扫描机视角，不代表你连过去的落点——跑一次 `node scripts/probe-ips.js` 回传实测，你的订阅就会按你的真实线路重排。

带宽数据现在每 6 小时对 Top 30 过审节点主动抽测（直连 IP 下载 1MB），`averageSpeed` 不再是 None；更贴近你线路的数值请用首页「开始测速」或本地探测脚本。

### 为什么 IP 在 cleanip.io / AbuseIPDB 上显示 abuse？X/TikTok 等验证过不了？

这是 Cloudflare Worker 架构的固有限制，不是优选 IP 没选好，也不是本项目配置错误。

原因：你连的 CF 边缘 IP（入口）和访问目标网站时 CF 对外的出口 IP 不是同一个。CF 内部按负载动态分配出口 IP，你无法选择或固定它。而 CF 的出口段长期被大量代理用户共用，已被 AbuseIPDB、Spamhaus 等 RBL 大量标记为 abuse。所以即使你优选到一个干净的边缘 IP（AbuseIPDB 分数 0），访问 X、TikTok 等做 IP 信誉验证的服务时，落到的还是被标脏的出口段，验证会报错或拒绝。

本项目只优化「入口」（CF 边缘 IP 的延迟/带宽），无法优化「出口」（CF 对外访问目标网站的 IP）。出口不可控是 CF Worker 的架构特性，任何基于 CF Worker 的 VLESS 方案都有同样问题，换源、换优选 IP 都解决不了。

解决方向：需要自有 VPS 或中转服务作为可控出口（架构变为 `你 → CF边缘 → CF Worker → 你的VPS → 目标网站`），由 VPS 的 IP 访问目标网站，信誉你自己维护。本项目明确不做中转、不引入 ProxyIP/SOCKS5/NAT64，如果你主要场景是过 X/TikTok 等验证类应用，建议直接用自有 VPS 或商业机场，比继续调 CF 优选更有效。

### 为什么 IPv6 节点可能测不到 / 进不了 BEST_IPS？

GitHub Actions 的运行机默认没有 IPv6 出口，无法连通 CF IPv6 边缘 IP，所以 IPv6 候选不会进主池 `BEST_IPS`。但它们不再被一刀切丢弃：会收录进独立池 `BEST_IPS_V6`（标记未实测），`/sub?ip6=1` 可追加返回，节点名带 `[IPv6]` 前缀。如果你的使用环境有 IPv6 线路，加上这个参数即可；以后的 GHA 若有了 v6 出口，主池也会自然收录。

### COLO 不认识怎么办？

未知 COLO 会显示为：

```text
🌐 XXX
```

可以在 `src/utils/colo.js` 里补充映射。

### 为什么扫描出来的 COLO 全是 LAX/SJC？

因为扫描机跑在 GitHub Actions（美国），它看到的落点就是美国的 PoP。这不代表你连过去也会落在 LAX：Cloudflare 官方 IP 是 anycast，你实际落到哪个 PoP 由你的运营商到这段 IP 的路由决定。

想拿到你自己的落点和延迟，跑一次 `node scripts/probe-ips.js`（见「本地探测与线路过滤」），回传后节点名里的 COLO 和延迟就变成你实测的值，`colo=auto` 线路过滤也才有意义。

## 📖 延伸阅读

- [docs/audit-2026-06-04.md](docs/audit-2026-06-04.md) — 项目改进建议报告（58 条）

## 相关文档

```text
docs/cloudflare-setup.md
docs/deploy-checklist.md
docs/d1-setup.md
docs/source-research.md
```

## 免责声明

本项目仅用于个人学习和私用订阅管理。请遵守当地法律法规。不要把真实节点提交到不可信的公开订阅器。

## 致敬

本项目的节点筛选与输出思路——国内实测、固定名单、反代 IP 兜底稳定性——直接受 [cmliu](https://github.com/cmliu) 的 [edgetunnel](https://github.com/cmliu/edgetunnel) 与 [WorkerVless2sub](https://github.com/cmliu/WorkerVless2sub) 启发，社区优选源也来自 cmliu 及其贡献者的长期维护。感谢 cmliu 和所有为 Cloudflare 优选 IP 生态贡献测速数据的朋友。
