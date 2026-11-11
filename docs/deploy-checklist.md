# 部署检查清单

按顺序勾选即可。详细说明见 [README](../README.md) 和 [cloudflare-setup.md](cloudflare-setup.md)。

## 1. GitHub

- [ ] 已 Fork，并在 Actions 页启用工作流。
- [ ] Secret `CLOUDFLARE_ACCOUNT_ID` 已填。
- [ ] Secret `CLOUDFLARE_API_TOKEN` 已填（老部署用 `CLOUDFLARE_API_TOKEN_2` 也可以，二者填一个）；权限含 Pages 编辑、Workers KV 存储编辑。
- [ ] （建议）Secret `GLOBALPING_TOKEN` 已填。
- [ ] （可选）Secret `CLOUDFLARE_NAMESPACE_ID`：只有想沿用某个已有 KV 命名空间时才需要。
- [ ] （建议）Variables 已填 `CHECK_HOSTS`、`VLESS_HOST`、`SUB_DEFAULT_ISP`；需要指定出口地区时填 `SUB_LANDING`。

## 2. 首次运行

- [ ] 手动运行 **Deploy to Cloudflare Pages**，成功。
- [ ] 手动运行 **Update Preferred Subscription**，成功。
- [ ] 手动运行 **China Probe (Globalping)**，成功。
- [ ] （填了 `CHECK_HOSTS` 时）手动运行 **China Host Check (Globalping)**，成功。

## 3. Cloudflare Pages 环境变量（按需）

- [ ] 需要直接订阅使用服务端模板时：已设 `SUB_READ_TOKEN`（只读访问 `/sub`、`/best`、`/versions`），以及 `VLESS_*` 节点变量。
- [ ] 需要管理接口时：已设 `SUB_TOKEN`，或设 `SETUP_CODE` 后通过 `/setup.html` 设置管理 token。
- [ ] 想关闭匿名订阅时：已设 `SUB_PUBLIC=0`。
- [ ] 改完变量后已重新部署。

## 4. 验证

- [ ] `/status` 返回 JSON，`updatedAt` 是最近时间，`cnProbe.lastRunAt` 有值。
- [ ] `/health` 返回 `{"ok":true}`。
- [ ] 模拟 edgetunnel 请求 `/sub?host=example.com&uuid=00000000-0000-4000-8000-000000000000`（UA 含 `edgetunnel`）返回 base64 文本。
- [ ] edgetunnel 面板填 `sub://你的部署域名`，关闭「随机 IP」，「验证优选 API」能看到 IP。
- [ ] 绑了 `ct.` / `cu.` / `cm.` 子域名时，各自能返回结果。
- [ ] 设了 `SUB_TOKEN` 时：`/health/full` 带 `Authorization: Bearer 你的SUB_TOKEN` 能返回详情，不带时返回 401。

## 5. 安全

- [ ] 仓库里没有真实 UUID、token 或节点链接。
- [ ] 管理 token `SUB_TOKEN` 只放在请求头里，没有拼进任何 URL 或客户端订阅；客户端只使用只读 token `SUB_READ_TOKEN`。
- [ ] 没有把 `workers.dev` 域名当节点域名。
- [ ] 订阅地址只分享给信任的人。
