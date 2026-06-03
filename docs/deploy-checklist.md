# 部署前检查清单

## Cloudflare Pages

- [ ] 已创建 Pages 项目，连接本仓库。
- [ ] 构建输出目录设置为 `public`。
- [ ] 已创建 KV Namespace。
- [ ] Pages 绑定 KV：变量名 `SUB_KV`。
- [ ] Pages 环境变量已设置：`SUB_TOKEN`。
- [ ] `wrangler.toml` 中 KV `id` 已替换为真实 Namespace ID。

## GitHub Secrets

- [ ] `CLOUDFLARE_API_TOKEN`
- [ ] `CLOUDFLARE_ACCOUNT_ID`
- [ ] `CLOUDFLARE_NAMESPACE_ID`
- [ ] `ORIGINAL_SUB_OR_NODE`

## 数据源

- [ ] `sources/edge/manual.txt` 已填入可信 CF Edge IP、域名、host:port 或 IPv4 CIDR。
- [ ] `sources/edge/remote.json` 已填入需要使用的 CF Edge 远程源，或保持空数组。

## 验证

- [ ] 本地测试通过：`npm test`。
- [ ] GitHub Actions 手动触发成功。
- [ ] `/status` 能返回更新时间和可用节点数量。
- [ ] `/sub?type=vless&token=你的token` 能返回订阅。
- [ ] 错误 token 请求 `/sub` 返回 401。

## 安全

- [ ] 没有把真实 token 写进代码、README 或公开页面。
- [ ] 没有把真实 VLESS 原始节点写进仓库。
- [ ] 如 token 泄露，立即更换 Pages 环境变量 `SUB_TOKEN`。
