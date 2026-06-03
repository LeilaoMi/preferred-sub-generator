# 文档补全清单

## 目标
让 README/文档与真实行为一致，避免再次出现 token 设计误用。

## 任务列表
- [ ] README 明确写清：`/sub`、`/best` 无 token
- [ ] README 明确写清：`/api/template` 需要管理 token
- [ ] README 明确写清：token 不要拼入订阅 URL
- [ ] README 补充“订阅失败排查清单”
- [ ] docs/deploy-checklist.md 补充 `/api/template` 401 验证项
- [ ] docs/deploy-checklist.md 补充 token 轮换说明
- [ ] docs/cloudflare-setup.md 补充 `SUB_TOKEN` 用途和风险
- [ ] docs/roadmap.md 继续作为项目长期改进仓库
- [ ] docs/roadmap-full.md 继续作为全量建议归档
- [ ] README 补充“先确认原始 VLESS 可用，再用优选订阅”
- [ ] README 补充“禁止公开管理 token 给不信任用户”

## 验收标准
- 新人读完文档，不会误把 token 放进订阅 URL
- 文档与实际 API 行为一致
