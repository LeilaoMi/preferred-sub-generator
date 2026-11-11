# 美国反代池

## 为什么要
联通 5G 下官方 104 段常不通，官方 IP 的出口地区还可能被判成香港；美国反代 IP 的出口跟着反代走（实测落洛杉矶），给 AI 站用更稳。

## 数据从哪来（`sources/edge/remote.json` 里 `relay-us-*`）
| 源 | 说明 |
|---|---|
| `relay-us-zip` | zip.cm.edu.kg/all.txt，只取 `#US` 标签、443 端口 |
| `relay-us-countrymerge` | countrymerge.pages.dev/all.txt，同上 |
| `relay-us-nirevil` | NiREvil/vless `country_proxies/US.txt`（每日扫描，`IP 端口` 格式） |
| `relay-us-cmliu-dns` | `ProxyIP.US.CMLiussss.net` 的 A 记录（dns.google 解析） |
| `relay-us-fofa` | 仓库内 `sources/relay/us-fofa.txt`，FOFA 网页手动导出 |

所有 `relay-*` 源都会去掉混进来的 Cloudflare 官方段 IP，只留 443。

## 怎么筛
1. **美国初筛（Update，每 6 小时）**：用 `VLESS_SNI`/`VLESS_HOST` 对每个 IP 发 TLS 请求，要求返回 cf-ray（说明转发到了 Cloudflare），顺带拿到落地机房。落地在 `SUB_LANDING` 白名单外的丢掉。剩下的按「西海岸（LAX/SJC/SFO/SEA/PDX）优先，再按延迟」进 `CN_PENDING_IPS`（上限 `CN_PENDING_MAX`，默认 500）。
2. **国内实测（China Probe，每 2 小时）**：Globalping 三网探针 HTTPS GET `/cdn-cgi/trace`，拿到 trace 且落地合格才算 ok。每轮给没测过的美国反代 40% 额度，测过 3 个以上都不通的 /24 自动降额。
3. **订阅**：只有国内实测 ok 的反代才进订阅，排序加 `SUB_RELAY_BONUS_MS`（默认 60ms）分。

## FOFA 每月更新一次（手机就能做）
1. 打开 fofa.info，搜：
   ```
   server=="cloudflare" && port=="443" && header=="Forbidden" && country=="US" && asn!="13335" && asn!="209242"
   ```
2. 导出 → 字段只勾 ip、端口 → CSV（免费账号每次最多 2990 行）。
3. 把 CSV 发给 Hark（或自己去重后覆盖 `sources/relay/us-fofa.txt`，每行一个 IP，`#` 开头是注释）。

不用每次都全量新的：失效 IP 会在美国初筛里自动被筛掉。
