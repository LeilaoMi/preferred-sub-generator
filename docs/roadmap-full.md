# 项目优化建议清单（全量）

目标：把“优选订阅生成器”从可用版本，升级成**更安全、更稳、更好维护**的私用工具。

---

## 一、立即该做的（影响安全/误用风险）

### 1. `GET /api/template` 不要返回完整原始模板

- 为什么：当前会直接返回完整 `vless://...`，token 泄露=真实节点泄露。
- 建议：只返回 `preview` + `templateSafe`（如只保留 UUID 前 8 位或完全隐藏）。

### 2. 管理接口要 token，订阅接口不要 token

- 为什么：你已经踩过坑，订阅 URL 带 token 会导致客户端导入失败。
- 建议：保持当前修正后的设计：
  - `/sub`、`/best`：无 token
  - `/api/template`：必须 token

### 3. 增加管理 token 防滥用策略

- 为什么：仅有 token 不够，自动化暴力尝试仍可能成功。
- 建议：
  - IP 级频率限制（如 10 次/分钟）
  - 错误 token 连续失败后临时封禁
  - 或一次性 nonce 校验

### 4. 公开页面做访问控制

- 为什么：首页和管理页完全公开，搜索引擎可能收录。
- 建议：
  - `robots: noindex`
  - Cloudflare Access / WAF
  - 或 `/admin/:token` 形式 token 化入口

### 5. 不要把历史泄露的 token 当作“已修复”

- 为什么：`README` 里曾公开过 token，需要确认没有残留。
- 建议：检查历史 commit/secret 扫描，必要时轮换 `SUB_TOKEN`。

### 6. 限制管理接口返回字段数量

- 为什么：减少“信息泄漏面”，即使 token 泄露也能降低影响。
- 建议：仅返回必要字段，不返回完整 VLESS 原始字段。

---

## 二、短期优化（1-2 周内）

### 7. 补 API smoke test

- 为什么：当前测试只验证生成逻辑，缺少真正 API 行为验证。
- 建议增加：
  - 保存模板后读取成功
  - 错误 token 返回 401
  - 无 TEMPLATE 时 `/sub` 返回 503

### 8. 修复 `/status.lastError` 语义

- 为什么：现在会在正常 fallback 时显示“检测失败”。
- 建议区分：
  - `null`：无错误
  - `"fallback"`：已保留旧数据
  - `"error"`：真实失败

### 9. 客户端格式兼容性测试加强

- 为什么：仅测文本生成不够，需验证格式细节。
- 建议检查：
  - Clash 是否有 `proxy-groups`
  - Sing-box 是否有完整 `outbounds`
  - base64 解码后是否为合法 URI

### 10. 前端增加“保存结果回显”

- 为什么：现在保存后只有文字提示，缺少反馈。
- 建议保存成功后显示：
  - UUID
  - Host/SNI
  - TLS 状态
  - 节点名

### 11. `/status` 增加 KV 更新细节

- 为什么：排查订阅没更新时信息不够。
- 建议新增字段：
  - `newAvailable`
  - `previousAvailable`
  - `fallbackActive`
  - `updatedAt`

### 12. 管理页面增加“当前 token 状态”提示

- 为什么：用户可能不知道 token 是否正确。
- 建议：
  - 首次打开提示“未填写 token”
  - 401 时提示“token 错误或已失效”
  - 成功时显示 preview 概要

### 13. README 增加“订阅失败排查清单”

- 为什么：你遇到的问题说明用户会把 token 设计误解成“接口坏了”。
- 建议列出：
  - 原始 VLESS 是否可用
  - 是否把 token 放入订阅 URL
  - KV 是否已保存 TEMPLATE
  - Actions 最近一次是否成功

---

## 三、中期优化（2-4 周）

### 14. 增加 `/health` 端点

- 为什么：`/status` 偏业务信息，缺少运行健康检查。
- 建议 `/health` 只返回：
  - KV 可用
  - TEMPLATE 存在
  - BEST_IPS 非空

### 15. KV 更新结果本地日志化

- 为什么：GitHub Actions 运行完后不好追溯。
- 建议更新成功后写入 KV：
  - `LAST_RUN_AT`
  - `LAST_RUN_OK`
  - `LAST_RUN_AVAILABLE`
  - `LAST_RUN_NEW_AVAILABLE`

### 16. 增加管理接口审计字段

- 为什么：管理操作需要可追溯。
- 建议记录：
  - `lastTemplateUpdatedAt`
  - `lastTemplateUpdateIp`
  - `lastTemplateUpdateUserAgent`

### 17. 首页支持“仅复制已有订阅，不保存模板”

- 为什么：很多人只是想拿订阅，不想改模板。
- 建议拆成两个按钮：
  - “保存并生成”
  - “仅生成当前订阅”

### 18. 给客户端订阅 URL 增加缓存提示

- 为什么：客户端频繁刷新会增加压力。
- 建议返回：
  - `Cache-Control: public, max-age=600`
  - `ETag`

### 19. 增加 `file manual.txt` 校验

- 为什么：手动源格式写错会静默失效。
- 建议在 Actions 里检查：
  - 是否有非法行
  - 是否混入 proxyip/中转 IP
  - 是否为空

### 20. 文档补充“token 设计原则”

- 为什么：避免未来再被改坏。
- 建议明确写死：
  - 订阅 URL 不带 token
  - 管理接口必须 token
  - token 仅管理员持有

---

## 四、长期/可选扩展

### 21. 多模板支持（低优先级）

- 为什么：适合用户同时管理多个 VLESS。
- 建议：KV 改为 `TEMPLATE_1` / `TEMPLATE_2`，前端可切换。

### 22. 管理端独立域名

- 为什么：公开页面与管理页面混在一起不够安全。
- 建议：admin.example.com 单独部署或加 Access。

### 23. 支持 token 管理旋转

- 为什么：token 泄露后需要快速更换。
- 建议：支持主 token + 失效旧 token。

### 24. IP 白名单管理

- 为什么：私用项目最安全的方式。
- 建议：`SUB_ALLOWED_IPS` 环境变量白名单。

### 25. Webhook 通知

- 为什么：模板被修改、更新失败时需要告警。
- 建议：POST 到 Telegram/Slack/企业微信。

### 26. 检测结果趋势分析

- 为什么：只能看当前结果，无法看到趋势。
- 建议保存最近 7 天：
  - 可用数
  - 平均延迟
  - fallback 次数

### 27. 自动测试客户端导入结果

- 为什么：生成文本正确不代表客户端可导入。
- 建议 CI 中集成：
  - v2rayNG 解码测试
  - Clash YAML 解析
  - Sing-box JSON schema

### 28. 版本化订阅

- 为什么：用户可回退订阅结果。
- 建议 KV 增加 `BEST_IPS_v{N}`，并支持 `/best?version=last`。

---

# 我的执行建议顺序

## Phase 1（最优先）

- 收窄 `GET /api/template`
- token 仅用于管理接口
- 增加 token 防滥用

## Phase 2

- 补 smoke tests
- 改善 `/status` 语义
- 增加失败排查文档

## Phase 3

- 做 `/health`
- Actions 结果回写 KV
- 管理审计字段

## Phase 4（可选）

- 多模板、独立管理域名、告警、趋势分析

---

这份清单是“想法仓库”，不是都必须做。
但如果你问我：**先做哪 3 件事最有价值**，我会选：

1. 收窄 `/api/template` 返回值
2. 稳定“订阅无 token + 管理有 token”
3. 补 API smoke tests + `/status` 语义