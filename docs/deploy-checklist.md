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
- [ ] `/status` 能返回更新时间和可用节点数量。
- [ ] `/sub?type=v2rayng` 能返回订阅，无需 token。
- [ ] `/best?n=20` 能返回优选列表，无需 token。

## 安全

- [ ] 无需 token；请不要公开你的部署域名给不信任的人。
- [ ] 没有把真实 VLESS 原始节点写进仓库。
- [ ] 如部署域名泄露，请重新部署到新域名或恢复 token 鉴权。
