# 参考手册

日常使用看仓库首页的 [README](../README.md)。本文汇总接口参数、KV 键、候选源格式和脚本参数，内容以代码为准（`src/`、`functions/`、`scripts/`、`.github/workflows/`）。

- [接口](#接口)
- [鉴权模型](#鉴权模型)
- [KV 键](#kv-键)
- [候选源格式](#候选源格式)
- [脚本](#脚本)
- [脚本内部参数](#脚本内部参数)

## 接口

所有接口由 `functions/` 下的 Pages Functions 提供，实现位于 `src/api/`。

### `GET /sub`

订阅主接口。鉴权见 [鉴权模型](#鉴权模型)。

| 参数 | 说明 |
|---|---|
| `type` | 输出格式：`vless`（明文链接列表，默认）、`v2rayng` / `base64`、`clash` / `mihomo`、`stash`、`singbox` / `sing-box`、`singbox-outbounds`、`surge`、`loon`、`shadowrocket`。缺省时按 UA 识别（Stash、Clash/Mihomo、sing-box、Surge、Loon、Shadowrocket、v2rayNG），识别不出用 `vless` |
| `isp` | `ct` / `cu` / `cm` 只用该运营商的国内实测排序；`all` 强制三网综合。缺省时依次看子域名、`SUB_DEFAULT_ISP` |
| `n` | 节点数，最多 50 |
| `ip6=1` | 在末尾追加 IPv6 独立池（未实测，不占 `n` 名额） |
| `colo` | 只保留指定落地机房，逗号分隔（最多 10 个），`auto` 表示请求者当前接入点；无匹配时回退全量 |
| `rank=off` | 关闭按实测排序，按候选池原顺序输出 |
| `mode=sample` | 从候选池加权随机抽样（有实测的权重更高）；其他 `mode` 值返回 400 |
| `wrap` | `v2rayng` / `base64` 输出按固定宽度换行 |
| `t` | 只读 token（也可用 `Authorization: Bearer`） |
| `uuid` `sni` `host` `path` `port` `net` `security` | 节点参数。带 `uuid` 时使用 URL 里的参数；`net` 为传输方式（只支持 `ws`） |

响应头带 `Subscription-Userinfo`（象征值，避免客户端显示空白）和 `Profile-Update-Interval: 6`。

**edgetunnel 探测旁路**：请求同时满足 `host=example.com`、`uuid=00000000-0000-4000-8000-000000000000`、UA 含 `edgetunnel` 时，免 token 返回 base64 占位订阅（最多 30 个节点），按「子域名 → Pages `SUB_DEFAULT_ISP` → China Probe 写入 KV 的默认运营商」决定排序用的运营商，在边缘缓存 5 分钟；生成失败时退回国内快照，始终返回 200。

错误码：`NO_AVAILABLE_NODES`（503）、`UNSUPPORTED_MODE`（400）、`UNSUPPORTED_TRANSPORT`（400，非 ws 节点）、`UNSUPPORTED_SUBSCRIPTION_TYPE`（400）。

### `GET /best`

返回候选池 JSON，鉴权同 `/sub`。

| 参数 | 说明 |
|---|---|
| `n` | 默认 20，最多 50；`rank=off` 时最多 300 |
| `rank=off` | 不按实测重排（`probe-ips.js --pool` 用它拉全量池） |
| `version` | 读取历史版本，`last` 为最近一次快照 |
| `colo` | 同 `/sub`，带上时返回 `filter` 说明命中情况 |

返回 `nodes`、`total`、`version`、`measured`（带实测的节点数），以及可能的 `droppedUnreachable`、`filter`。

### `GET /versions`

鉴权同 `/sub`。返回最近的 `BEST_IPS_*` 版本索引，`n` 默认 30、最多 100。默认保留 30 个版本。

### `GET /status`

公开。主要字段：

| 字段 | 说明 |
|---|---|
| `updatedAt` `ageSeconds` `status` | 最近一次 Update 的时间与语义状态：`ok` / `stale`（超 12 小时）/ `unhealthy`（超 24 小时）/ `fallback` / `error` |
| `available` `newAvailable` `checked` `sourceCount` | 候选池规模、本轮新扫描可用数、初筛通过数、源数量 |
| `fallbackActive` `lastError` | 本轮可用少于 20 时保留上次结果 |
| `speedtestLocation` `averageLatency` `averageSpeed` | 美国初筛视角的数据，仅供参考，不参与排序 |
| `cnProbe` | 最近一轮国内实测：时间、测试数、结果数、通过数、是否被限流、三网已验证节点数 |
| `cnHosts` | 域名体检：每个域名在 CT / CU / CM 下的 `ok` / `unstable` / `blocked` / `unknown`；匿名访问时域名打码 |

### `GET /cn-verified`

社区实测池，默认 404。Actions 或 Pages 设 `PUBLIC_CN_VERIFIED=1` 后开放，返回 `updatedAt` 与 `all` / `CT` / `CU` / `CM` 四份名单，每项只含 `address`、`port`、`rtt`、`colo`、`successRate`。带 CORS 与 10 分钟缓存，可供他人填入 `COMMUNITY_POOL_URL`。

### `GET /health`、`GET /health/full`

`/health` 公开，只返回 `{ ok }`（候选池为空时 503）。`/health/full` 需管理 token，额外返回 `bestIpsCount`、`configOk`、`configWarnings`（服务端 `VLESS_*` 模板的校验结果）。

### 管理接口

| 接口 | 鉴权 | 说明 |
|---|---|---|
| `GET /api/read-token` | 管理 token | 匿名只返回 `{ configured }`；带管理 token 时返回只读 token（开启轮换时为当期派生值） |
| `GET /api/template` | 管理 token | 只读展示 Pages 的 `VLESS_*` 节点配置及风险提示（如 SNI 为 `workers.dev`） |
| `POST /api/template` | 管理 token | 已停用，返回 410。节点配置请改 Pages 环境变量 |
| `GET /api/admin-setup` | 公开 | 返回是否需要设置、网页设置是否开启 |
| `POST /api/admin-setup` | 设置码 | JSON `{ setupCode, token }`；token 12–128 位，KV 只存 SHA-256；已设置或已配 `SUB_TOKEN` 时拒绝 |
| `POST /api/ip-feedback` | 管理 token | 回传逐 IP 实测 `{ results: [{ address, port, rtt, colo, region, speed, ok }] }`，单次最多 200 条 |
| `GET /api/ip-feedback` | 管理 token | 按 IP 聚合的评分，`days` 默认 14、最多 90 |
| `POST /api/speedtest-feedback` | 公开 / 管理 token | 浏览器测速结果 `{ speedMbps, colo, ipCountry }`。绑定 D1 时公开写入；未绑定 D1 时只接受管理 token，匿名请求返回 202 且不落库 |
| `GET /api/speedtest-feedback` | 管理 token | 测速汇总与按天趋势，`days` 默认 14、最多 90，`limit` 默认 100、最多 1000 |

`/api/template`、`POST /api/admin-setup`、`POST /api/ip-feedback`、`POST /api/speedtest-feedback` 带基础限流（每 IP 每分钟 10 次，超出封禁 5 分钟）。

## 鉴权模型

| 角色 | 来源 | 用途 |
|---|---|---|
| 只读 token | Pages `SUB_READ_TOKEN`（轮换期 `SUB_READ_TOKEN_NEXT`） | `/sub`、`/best`、`/versions`；`/status` 显示完整域名 |
| 管理 token | Pages `SUB_TOKEN`（轮换期 `SUB_TOKEN_NEXT`），或 `/setup.html` 写入 KV 的哈希 | 管理接口；同时也被只读接口接受 |

- `SUB_PUBLIC` 未设置时为公开模式：没有有效 token 的请求也放行，但**不能使用服务端节点模板**（KV `TEMPLATE` 或 `VLESS_*`），只能用 URL 里自带的节点参数。
- `SUB_PUBLIC=0`（或 `false` / `no` / `off`）时，只读接口必须带有效 token。
- 只读 token 可用 `?t=` 或 `Authorization: Bearer`；管理 token 默认只接受 `Authorization: Bearer`，`ALLOW_QUERY_TOKEN=1` 时额外接受 `?token=`。
- `SUB_TOKEN_ROTATE_DAYS=N` 时，有效只读凭证变为 `HMAC-SHA256(SUB_READ_TOKEN, 周期)` 的当期与上一期值，静态 `SUB_READ_TOKEN` 只作为密钥。
- `SUB_ALLOWED_IPS` 限制 token 鉴权的来源 IP。

## KV 键

绑定名 `SUB_KV`。D1（绑定名 `SPEED_DB`）可选，用于测速反馈和逐 IP 实测；未绑定时回退 KV（各保留最近 500 条）。

| 键 | 写入方 | 内容 |
|---|---|---|
| `BEST_IPS` | Update | 候选池（初筛通过，按地址聚合，最多 300，含手动置顶） |
| `BEST_IPS_V6` | Update | IPv6 独立池（未实测，最多 100） |
| `CN_PENDING_IPS` | Update | 待国内验证的反代 IP（上限 `CN_PENDING_MAX`） |
| `BEST_IPS_<时间>` `BEST_IPS_LAST` `BEST_IPS_LATEST_VERSION` `BEST_IPS_VERSION_INDEX` `BEST_IPS_EXPIRED_VERSIONS` | Update | 版本快照与索引 |
| `BEST_IPS_TREND` `STATUS` `SOURCE_HEALTH` `LAST_RUN_*` `ALERT_STATE` | Update | 刷新趋势、状态、各源健康、告警状态 |
| `CN_PROBE_FEEDBACK` | China Probe / Host Check | 国内三网实测与手机实测记录（保留 3 天） |
| `CN_PROBE_STATE` | China Probe | 最近一轮概况、游标、`defaultIsp`、`landing`、`publicVerified` |
| `CN_VERIFIED` | China Probe / Host Check | 国内已验证快照（`all` / `CT` / `CU` / `CM`） |
| `CN_COMMUNITY` | China Probe | 从 `COMMUNITY_POOL_URL` 拉取的社区池 |
| `CN_HOST_HEALTH` `CN_HOST_ALERT_STATE` | Host Check | 域名体检历史（每域名每运营商最近 12 次）与告警状态 |
| `IP_FEEDBACK` | `/api/ip-feedback` | 未绑定 D1 时的逐 IP 实测 |
| `SPEED_FEEDBACK` | `/api/speedtest-feedback` | 未绑定 D1 时的浏览器测速 |
| `ADMIN_TOKEN_SHA256` | `/api/admin-setup` | 网页设置的管理 token 哈希 |
| `TEMPLATE` | 手动写入 | 可选的服务端节点模板（`vless://` 链接或含 `uuid` 等字段的 JSON），优先于 `VLESS_*`，只对带 token 的请求生效 |

## 候选源格式

### `sources/edge/manual.txt`

每行一个 `IP`、`IP:端口`、`域名:端口` 或 IPv4 CIDR，`#` 开头为注释。手动条目即使美国初筛不通过也保留在池里，订阅时排在国内实测节点之后。`npm run validate:sources` 会校验格式。

> Update 工作流会在运行时用仓库主人自己的 `<owner>/cf-termux-pick` 仓库的 `best-ips.txt` 替换本文件中的 IP 行（不提交），拉不到时沿用本文件。

### `sources/edge/remote.json`

数组，每项一个远程或本地源：

| 字段 | 说明 |
|---|---|
| `name` | 源名称；以 `cmliu` 或 `relay-` 开头的视为反代源 |
| `url` | 远程地址（与 `dir` / `file` 二选一） |
| `dir` / `file` | 仓库内的本地目录 / 文件；目录会读取全部 `.txt` / `.csv` / `.gz` |
| `type` | `text`、`csv`、`scrape`（从任意文本中提取 IP）；缺省时按扩展名判断 |
| `cidrSamples` | 每个 CIDR 抽样的 IP 数 |
| `minSpeed` | CSV 源的速度下限 |
| `cfOnly` | 只保留落在 Cloudflare 官方 IPv4 段内的 IP |
| `repo` | 只在这个仓库（`owner/name`）启用，Fork 自动跳过；用于作者自建的私有接口 |
| `relay` / `relayOnly` | 反代源；`relayOnly` 会剔除混入的 Cloudflare 官方段 IP |
| `country` | 只保留注释中带该国家代码的行（如 `#US`） |
| `ports` | 只保留这些端口（未写端口的按 443） |

处理规则：

- 普通源（非反代）在 GitHub Actions 上做美国初筛：用 `VLESS_HOST` / `VLESS_SNI`（缺省 `speed.cloudflare.com`）作 SNI 请求 `/cdn-cgi/trace`，要求 2xx 且带 `cf-ray`，每个 IP 测全部 TLS 端口，通过的按地址聚合进 `BEST_IPS`。
- `cmliu*` 反代源在美国大多连不上，跳过初筛直接进 `CN_PENDING_IPS`。
- `relay-*` 源在美国测 443 的 trace，存活且落地在 `SUB_LANDING` 内的按「西海岸优先、再按延迟」排在 `CN_PENDING_IPS` 前面。
- 只有国内实测通过的待验证 IP 才会进入订阅。

## 脚本

| 脚本 | 运行位置 | 作用 |
|---|---|---|
| `scripts/cf-bootstrap.js` | Actions | 查找或创建 KV（`preferred-sub-generator-kv`）、D1（`speed-feedback`）、Pages 项目，改写 `wrangler.toml` 并导出 `CLOUDFLARE_NAMESPACE_ID`、`PAGES_PROJECT` |
| `scripts/update-kv.js` | Update | 汇总候选源、美国初筛、带宽抽测（前 30 个）、写 KV、告警 |
| `scripts/china-probe.js` | China Probe | 国内三网实测、合并手机实测与社区池、更新快照 |
| `scripts/china-host-check.js` | Host Check | 域名体检（每域名三网各 2 个探针）、IP × 域名组合测、告警 |
| `scripts/probe-ips.js` | 本机 / Termux | 本机实测候选 IP 并回传 `/api/ip-feedback` |
| `scripts/termux-probe.sh` | Termux | `probe-ips.js` 的手机封装，见 [termux.md](termux.md) |
| `scripts/preflight.js` | 本地 / CI | 部署前检查 |
| `scripts/validate-sources.js` | 本地 / CI | 校验 `manual.txt` |

### `probe-ips.js` 参数

```text
--site <url>        站点地址（默认 env SITE_URL）
--token <token>     管理 token（默认 env SUB_TOKEN；无 token 时配合 --no-submit）
--n <count>         探测节点数，默认 50
--pool              拉整个候选池（最多 300）逐个实测
--samples <n>       每个 IP 的握手采样次数，默认 3，成功过半才算可用
--speed <MB>        下载测速大小，默认 2；0 只测延迟
--sni <host>        探测 SNI（默认取 /api/template 的域名，取不到用 speed.cloudflare.com）
--colo <list>       只探测指定机房，auto 为当前接入点
--concurrency <n>   并发，默认 8
--timeout <ms>      单项超时，默认 5000
--json <file>       另存结果
--force             跳过「出口是否在国内」检查
--no-submit         只打印不回传
```

## 脚本内部参数

以下变量由脚本读取，但工作流没有传入，需要时得自行在工作流的 `env:` 中添加：

| 变量 | 默认 | 作用 |
|---|---|---|
| `CHECK_TIMEOUT_MS` | `2500` | 美国初筛单次超时 |
| `CHECK_CONCURRENCY` | `64` | 美国初筛并发 |
| `FETCH_TIMEOUT_MS` | `20000` | 脚本内网络请求的全局超时 |
| `SOURCE_MAX_BYTES` | 5 MB | 单个远程源最大读取量 |
| `REQUIRE_CF_RAY` | `1` | 初筛要求返回 `cf-ray` |
| `ALLOW_TCP_ONLY` | `0` | 允许只 TCP 可达的结果 |
| `VERSION_RETENTION` | `30` | 保留的版本快照数 |
| `KV_TITLE` | `preferred-sub-generator-kv` | 自动创建 / 查找的 KV 命名空间名称 |
| `SUB_PREFERRED_PORTS` | 空 | 初筛测试的端口列表（Pages 端同名变量控制订阅端口顺序） |
