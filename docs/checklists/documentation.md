# 文档补全清单

## 目标
让 README/文档与真实行为一致，避免再次出现 token 设计误用。

## 任务列表
- [x] README 明确写清：`/sub`、`/best` 默认需要只读 token，公开模式需显式开启
- [x] README 明确写清：`/api/template` 需要管理 token
- [x] README 明确写清：管理 token 不要拼入订阅 URL
- [x] README 补充“订阅失败排查清单”
- [x] docs/deploy-checklist.md 补充 `/api/template` 401 验证项
- [x] docs/deploy-checklist.md 补充 token 轮换说明
- [x] docs/cloudflare-setup.md 补充 `SUB_TOKEN` 用途和风险
- [x] docs/roadmap.md 继续作为项目长期改进仓库
- [x] docs/roadmap-full.md 继续作为全量建议归档
- [x] README 补充“先确认原始 VLESS 可用，再用优选订阅”
- [x] README 补充“禁止公开管理 token 给不信任用户”
- [x] README 补充 `/api/read-token` 和当前实际线上部署状态
- [x] docs/cloudflare-setup.md 按当前部署域名、Pages 项目、KV、环境变量完整重写

## 验收标准
- 新人读完文档，不会误把管理 token 放进订阅 URL
- 文档与实际 API 行为一致
