# preferred-sub-generator 分阶段改造计划

生成时间：2026-06-05（Asia/Shanghai）
依据：`docs/audit-2026-06-04.md`

## 总目标

把项目从“靠不公开域名实现私用”改造成“代码层默认保护真实 VLESS 派生订阅”的私用订阅生成器，同时保持现有 Cloudflare Pages + Functions + KV 架构不变。

## 阶段 0：基线确认

目标：确认当前仓库、测试和部署前检查状态。

验收：

```bash
npm test
npm run preflight
npm run validate:sources
```

当前结果：已通过，56 tests passed，preflight 通过，source validation 通过。

## 阶段 1：P0 隐私边界

目标：先堵住真实订阅泄露风险。

改造项：

1. `/sub` 默认不再公开。
   - 默认需要只读 token。
   - `SUB_PUBLIC=1` 才允许公开访问，作为兼容开关。
   - `SUB_READ_TOKEN` 优先作为订阅读 token；未设置时可回退使用 `SUB_TOKEN`，避免用户必须马上新增变量。
   - 订阅 token 支持：
     - `Authorization: Bearer <token>`
     - `?t=<token>`
   - 不支持 `?token=` 作为订阅读 token。
2. `/best` 与 `/sub` 使用同一只读保护。
3. `/sub` 响应改为 `Cache-Control: private, no-store`。
4. 管理接口默认禁用 `?token=`。
   - 只接受 `Authorization: Bearer <SUB_TOKEN>`。
   - 如需临时兼容，显式设置 `ALLOW_QUERY_TOKEN=1`。
5. 页面删除 `?token=` 自动填充。
   - 仅保留 `#token=`。
   - 读取后立即清理地址栏。
6. README / checklist / Cloudflare 设置文档同步更新。
7. 新增隐私回归测试。

阶段 1 验收：

```bash
npm test
npm run preflight
npm run validate:sources
```

重点测试：

- 默认 `/sub` 无 token 返回 401。
- `SUB_PUBLIC=1` 时 `/sub` 可公开访问。
- `SUB_READ_TOKEN` Bearer / `?t=` 可访问。
- `/sub` 响应不再 public cache。
- `/api/template?token=` 默认拒绝。
- `ALLOW_QUERY_TOKEN=1` 时 query token 兼容可用。
- 页面不再读取 `?token=`。

## 阶段 2：P1 安全硬化

目标：降低公开页面/API 被索引、XSS、枚举和滥用风险。

计划项：

1. API 统一安全 headers。
2. 新增 `public/robots.txt`。
3. rate limiter 增加过期清理与 Map 容量上限。
4. `/health` 拆分 public/full：公开只返回最小状态，详细信息鉴权。
5. 管理接口错误原因对外最小化。
6. 页面 HTML 输出统一转义或改 DOM API。

## 阶段 3：可靠性与 CI/CD

目标：提升自动刷新可维护性。

已完成：

1. `BEST_IPS_*` 版本快照保留上限。
   - 写入 `BEST_IPS_VERSION_INDEX`。
   - 默认保留最近 30 个版本。
   - 主流程删除超出保留数量的旧版本 key。
2. STATUS 增加连续 fallback、最近成功刷新时间、原始可用数量。
   - `consecutiveFallbacks`
   - `lastSuccessfulRefreshAt`
   - `lastRawAvailable`
   - `averageLatencyNewScan`
3. GitHub Actions 增加：
   - `permissions: contents: read`
   - `concurrency`
   - `timeout-minutes: 20`
4. webhook 通知失败降级为 warning，不影响 KV 主流程。
5. preflight 增加 workflow hardening 检查。

验收：

```bash
node --test tests/update.test.js tests/preflight.test.js
npm run preflight
```

结果：已通过。

## 阶段 4：数据质量与源健康

目标：减少远程源异常、非 Cloudflare Edge 混入、源失败不可见的问题。

已完成：

1. 远程源读取大小限制。
   - 默认 `SOURCE_MAX_BYTES=5242880`。
   - 单个 source 可配置 `maxBytes`。
   - 超限 source 会记录失败，不进入候选池。
2. `SOURCE_HEALTH` 写入 KV。
   - 包含手动源和每个远程源的 `ok/status/candidates/error/ms`。
3. Cloudflare Edge 验证策略开关。
   - `REQUIRE_CF_RAY=1` 默认只保留带 `cf-ray` 的 Edge 验证结果。
   - `ALLOW_TCP_ONLY=1` 可临时兼容 TCP-only 结果。
4. 新增测试覆盖 source health、超大源拒绝、严格 CF Ray 策略。

验收：

```bash
npm test
npm run preflight
npm run validate:sources
```

## 后续阶段

## 线上操作边界

本计划先做本地代码、测试、文档改造。部署 Cloudflare、推送 GitHub 前必须单独确认。
