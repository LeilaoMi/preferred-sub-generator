# 安全补全清单

## 目标
把项目从“功能可用”提升到“私用安全边界完整”。

## 任务列表
- [ ] 收窄 `GET /api/template`，不返回完整原始模板
- [ ] 仅返回 preview + 必要元信息（host/sni/port/tls/uuid 摘要）
- [ ] `/api/template` 继续要求管理 token
- [ ] `/sub`、`/best` 继续无 token
- [ ] token 比较使用 timing-safe 比较
- [ ] 增加错误 token 频率限制（建议 10 次/分钟）
- [ ] 连续错误 token 失败后临时锁定（建议 5 分钟）
- [ ] 管理页面加 `noindex`
- [ ] 管理页面支持 `#token=` 或 `?token=` 仅用于管理，不写入订阅 URL
- [ ] 检查历史 Git 提交中是否残留敏感 token
- [ ] 若发现泄露，立即轮换 `SUB_TOKEN`
- [ ] README 明确写清：订阅 URL 不带 token

## 验收标准
- 无 token 时 `/api/template` 返回 401
- 正确 token 时返回 preview，不暴露完整原始 VLESS
- `/sub?type=v2rayng` 始终可直接给客户端使用
