# 美国反代池

## 为什么需要

联通 5G 等网络下，Cloudflare 官方 104 段经常不通，官方 IP 的出口地区还可能被判成香港。美国反代 IP 的出口跟着反代走（实测落在洛杉矶一带），访问 AI 服务更稳。

## 数据来源

`sources/edge/remote.json` 中的 `relay-us-*` 源：

| 源 | 说明 |
|---|---|
| `relay-us-zip` | `zip.cm.edu.kg/all.txt`，只取 `#US` 标签、443 端口 |
| `relay-us-countrymerge` | `countrymerge.pages.dev/all.txt`，同上 |
| `relay-us-nirevil` | NiREvil/vless `country_proxies/US.txt`（`IP 端口` 两列格式） |
| `relay-us-cmliu-dns` | `ProxyIP.US.CMLiussss.net` 的 A 记录（经 dns.google 解析） |
| `relay-us-fofa` | 仓库内 `sources/relay/fofa/` 目录，读取其中全部 `.txt` / `.csv` / `.gz` |

所有 `relay-*` 源都会剔除混入的 Cloudflare 官方段 IP，只保留 443 端口的 IPv4。设 Actions 变量 `ALLOW_RELAY=0` 可整体关闭。

## 筛选流程

1. **美国初筛**（Update，每 6 小时）：以 `VLESS_HOST`（或 `VLESS_SNI`，都没有时用 `speed.cloudflare.com`）为 SNI，对每个 IP 的 443 端口请求 `/cdn-cgi/trace`，要求返回 `cf-ray`（说明转发到了 Cloudflare），同时拿到落地机房。落地不在 `SUB_LANDING` 白名单内的丢弃。其余按「西海岸（LAX / SJC / SFO / SEA / PDX）优先，再按延迟」排在待验证池 `CN_PENDING_IPS` 前面（池上限 `CN_PENDING_MAX`，默认 500）。
2. **国内实测**（China Probe，每 2 小时）：Globalping 三网探针以 HTTPS 请求 `/cdn-cgi/trace`，拿到 trace 且落地合格才算通过。每轮给没测过的美国反代固定 40% 额度；一个 /24 测过 3 个以上 IP 都不通时自动降额。
3. **进入订阅**：只有国内实测通过的反代 IP 才会进订阅，排序时加 `SUB_RELAY_BONUS_MS`（Pages 环境变量，默认 60ms）。

## 每月更新 FOFA 数据（手机即可完成）

1. 打开 fofa.info，搜索：

   ```text
   server=="cloudflare" && port=="443" && header=="Forbidden" && country=="US" && asn!="13335" && asn!="209242"
   ```

2. 导出 CSV（免费账号每次最多 2990 行，字段不用裁剪）。
3. 手机浏览器打开仓库 → `sources/relay/fofa/` → **Add file → Upload files** → 选择刚导出的文件 → **Commit changes**。
4. 无需去重或改格式：Update 会从文件中提取全部 IP，失效的在美国初筛中自动淘汰。旧文件可删可留。

不更新也能运行：其余四个源由社区自动维护，FOFA 只是额外补充。
