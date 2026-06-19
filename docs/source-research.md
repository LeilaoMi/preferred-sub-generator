# 同类优选订阅器调研

本文记录当前项目只做 Cloudflare Edge 优选订阅时，参考同类项目后应采用和不采用的设计。

## 调研边界

- 只学习公开源码、公开 README、公开首页 HTML。
- 不向第三方订阅器提交用户真实节点。
- 当前项目定位是私用订阅生成器：保留用户原始 VLESS 参数，只替换为 Cloudflare 高速边缘 IP。
- 不引入 ProxyIP、SOCKS5、NAT64 或其它中转/反代 IP 池。

## cmliu/WorkerVless2sub

项目根源：`cmliu/WorkerVless2sub`。

可学习点：

- `ADD`：手动优选 IP、域名、host:port。
- `ADDAPI`：远程 txt 优选 IP 源。
- `ADDCSV`：CloudflareSpeedTest CSV 测速结果源。
- `DLS`：CSV 速度下限，过滤低速节点。
- `addressesapi.txt`：`IP:端口#备注` 文本源。
- `addressesipv6api.txt`：`[IPv6]:端口#备注` 文本源。
- `addressescsv.csv`：包含 IP、端口、TLS、数据中心、地区、城市、TCP 延迟、速度等字段。

不采用点：

- `PROXYIP`、`PROXYIPAPI`、`CMPROXYIPS`。
- `SOCKS5DATA`。
- 公益节点 `LINK` 混入。
- 默认外部订阅转换后端处理私有节点。

## amclubs/am-cf-tunnel-sub

项目根源：`amclubs/am-cf-tunnel-sub`，其默认 IP 源来自 `amclubs/am-cf-tunnel`。

可学习点：

- `IP_URL`：远程 IP 源，默认是 `https://raw.githubusercontent.com/amclubs/am-cf-tunnel/main/example/ipv4.txt`。
- `official` 模式：读取 `https://www.cloudflare.com/ips-v4/`，从 Cloudflare 官方 CIDR 中抽样测试。
- 在线优选 IP 页面：通过请求候选 IP 的 `/cdn-cgi/trace` 获取 RTT 与 COLO。
- KV 缓存优选结果，避免每次订阅请求实时测速。

不采用点：

- `PROXYIP`、`EXTRA_IP_PROXY`。
- NAT64 反代模式。
- NIP 服务绑定。
- 多后端转换器作为默认路径。

## cmliu/EdgeOne-Pages-BestIP2SUB

这是 `WorkerVless2sub` 的 EdgeOne Pages 变体。其 IP 源仍主要沿用：

- `WorkerVless2sub/main/addressesapi.txt`
- `WorkerVless2sub/main/addressesipv6api.txt`
- `WorkerVless2sub/main/addressescsv.csv`

公开站点 `zrf.zrf.me` 页面外链指向该项目。

## 公开 SUB 订阅器根源判断

| 域名 | 读取结果 | 根源判断 |
| --- | --- | --- |
| `zrf.zrf.me` | 可读 | 页面外链指向 `cmliu/EdgeOne-Pages-BestIP2SUB` |
| `sub.keaeye.icu` | 可读 | 页面外链指向 `cmliu/WorkerVless2sub` |
| `sub.mot.cloudns.biz` | 可读 | 页面外链指向 `cmliu/WorkerVless2sub` |
| `sub.lzjbaby.com` | 可读 | 页面外链指向 `cmliu/WorkerVless2sub` |
| `cm.soso.edu.kg` | 根路径跳 Telegram，`/sub` 返回 202 | 疑似 `WorkerVless2sub` 类部署，入口做了隐藏或跳转 |
| `sub.xinyitang.dpdns.org` | 403 | 疑似 `WorkerVless2sub` 生态部署，但源码根源未确认 |

## 本次额外结论

公开带宽源稀缺，且多数公开订阅器依赖外部转换后端处理私有节点，存在隐私风险。

## 当前项目采用策略

1. 只读取 `sources/edge/*`。
2. 支持 Cloudflare 官方 CIDR 源抽样。
3. 支持 cmliu/amclubs 风格 txt 源。
4. 支持 cmliu CloudflareSpeedTest CSV 源，并用速度下限过滤。
5. 输出的候选节点只代表 Cloudflare Edge 入口可达，不保证用户原始 VLESS 后端可用。
6. 用户原始节点必须自己可用；本项目不能修复错误 UUID、Host、SNI、path、TLS 或后端服务不可用。
7. 测速策略：优先使用 CloudflareSpeedTest CSV 源，结合速度下限过滤低速节点。

## 隐私原则

公开订阅器会接收到用户节点参数。当前项目应默认在用户自己的 Cloudflare Pages + KV 中处理节点，不把真实节点提交到第三方订阅转换器。若未来加入外部转换后端，必须做成显式可选，并在 UI 上提示隐私风险。
