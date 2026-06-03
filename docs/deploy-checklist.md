# 部署前检查清单

## Cloudflare Pages

- [ ] 已创建 Pages 项目，连接本仓库。
- [ ] 构建输出目录设置为 `public`。
- [ ] 已创建 KV Namespace。
- [ ] Pages 绑定 KV：变量名 `SUB_KV`。
- [ ] `wrangler.toml` 中 KV `id` 已替换为真实 Namespace ID。

## GitHub Secrets

- [ ] `CLOUDFLARE_API_TOKEN`
- [ ] `CLOUDFLARE_ACCOUNT_ID`
- [ ] `CLOUDFLARE_NAMESPACE_ID`

## 数据源

- [ ] `sources/edge/manual.txt` 已填入可信 CF Edge IP、域名、host:port 或 IPv4 CIDR。
- [ ] `sources/edge/remote.json` 已填入需要使用的 CF Edge 远程源，或保持默认配置。

## 验证

- [ ] 已先在网页输入并保存真实 VLESS 模板。
- [ ] 本地测试通过：`npm test`。
- [ ] GitHub Actions 手动触发成功。

### 验证接口

- [ ] `/status` 能返回 JSON。
- [ ] `/sub?type=v2rayng` 能返回订阅，无需 token。
- [ ] `/best?n=20` 能返回优选列表，无需 token。
- [ ] `/api/template` 无 token 时返回 401。
- [ ] `/api/template?token=你的SUB_TOKEN` 能读取或保存模板。

## 安全

### 安全确认

- [ ] `SUB_TOKEN` 只用于 `/api/template` 管理接口。
- [ ] 订阅链接无需 token，生成给客户端的订阅链接不要拼接 token。
- [ ] 不要公开你的部署域名给不信任的人。
- [ ] 没有把真实 VLESS 原始节点写进仓库。
- [ ] 如部署域名泄露，请重新部署到新域名或恢复 token 鉴权。

### 可选增强

- [ ] 如需轮换 token，先添加 `SUB_TOKEN_NEXT`，确认可用后再替换 `SUB_TOKEN`。
- [ ] 如需限制管理来源，配置 `SUB_ALLOWED_IPS`。
- [ ] 如需刷新通知，配置 `UPDATE_WEBHOOK_URL`。
- [ ] 如果使用多模板，确认 `/api/template?slot=1` 和 `/sub?template=1` 行为符合预期。
- [ ] 如需回滚优选结果，确认 `/best?version=last` 可读取最近快照。
