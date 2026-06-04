# CI/CD 补全清单

## 目标

让 GitHub Actions 不只是更新 KV，还能守住质量和安全。

## 任务列表

- [ ] workflow 在更新 KV 前运行 `npm test`

- [ ] workflow 在更新 KV 前运行 `npm run preflight`

- [ ] preflight 校验 workflow 是否包含 preflight 步骤

- [ ] preflight 校验首页是否发送管理 token

- [x] Actions 最小权限：`permissions: contents: read`

- [x] Actions 并发锁：`concurrency.group = preferred-sub-generator-update`

- [x] Actions 超时：`timeout-minutes: 20`

- [x] Actions 结果回写 KV（LAST_RUN_AT / LAST_RUN_OK）

- [x] KV 版本快照保留上限：`BEST_IPS_VERSION_INDEX` 默认保留 30 个

- [ ] 新增 remote.json 格式校验

- [ ] 新增 KV 更新失败报警（可先写入 STATUS）

- [x] 若新检测结果过少，保留旧 BEST_IPS（已实现）

- [x] webhook 通知失败降级为 warning，不阻断 KV 更新

- [ ] 增加 Actions 运行摘要 artifact（可选）

- [ ] 增加 weekly secret-scan 检查（可选）

- [ ] 增加“无更新超过 24 小时”提醒（可选）

## 验收标准

- 每次自动更新都有 test + preflight 守门
- 更新失败可被识别，不会静默覆盖已有订阅数据