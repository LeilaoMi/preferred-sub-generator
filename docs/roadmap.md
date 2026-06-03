# 优化路线图（建议）

## 优先级 1：安全与稳定
1. **GET `/api/template` 不要返回原始 `template` 字段**
   - 现在会直接暴露完整 `vless://...`，如果 token 泄露，还是会泄露真实节点。
   - 建议只返回 `preview`，以及一个脱敏的 `templateSafe`（如只保留前 8 位）。

2. **为 `/api/template` 增加简单防滥用层**
   - 管理接口虽然已经要 token，但仍建议加：
     - IP 级频率限制（如 10 次/分钟）
     - 或一次性 nonce/token 校验（比简单 query token 更抗自动化抓取）

3. **首页与管理页访问控制**
   - 当前 `public/index.html` 和 `public/admin.html` 完全公开。
   - 建议：
     - 或至少加 robots `noindex`，避免被搜索引擎收录；
     - 或用 Cloudflare Access / Tokenized URL 做入口保护。

## 优先级 2：可靠性与可维护性
4. **补充 End-to-End 冒烟测试**
   - 本地测试只验证生成结果，不验证：
     - `GET /sub` 实际行为
     - `POST /api/template` 与 `GET /api/template` 联动
     - token 拒绝行为
   - 建议在 CI 加一层 "API smoke test"，用同一个测试 env 闭环。

5. **修复 `STATUS.lastError` 语义**
   - 当前：无错误也显示 `"检测失败，已保留上次可用结果"`
   - 建议：区分三种状态
     - `null`（无错误）
     - `"检测失败，已保留上次可用结果"`
     - 真实错误（如网络超时）

6. **KV 更新策略更透明**
   - 当前逻辑：新可用节点少于 20 则保留旧结果
   - 建议在 `/status` 里同时暴露：
     - `newAvailable`
     - `previousAvailable`
     - `fallbackActive`
   - 便于排查“为什么订阅一直没更新”。

## 优先级 3：体验与产品化
7. **前端展示“管理 token 状态”**
   - 现在填不填 token，页面体验差异不大。
   - 建议增加：
     - 保存成功后显示 preview 概要
     - token 错误时明确提示“401 / 缺失 / 无效”

8. **增加订阅格式兼容性测试**
   - 当前测试覆盖了生成文本，但未验证客户端常用格式细节：
     - Clash `proxy-groups` 至少存在
     - Sing-box `outbounds` 数组结构正确
     - v2rayNG base64 解码后 URI 合法
   - 建议加入更严格的格式断言。

9. **README 中补充真实 token 故障排查**
   - 建议加一节“订阅失败排查清单”：
     - 原始 VLESS 本身是否可用
     - 是否把 token 错误放入订阅 URL
     - Cloudflare KV 是否已保存 TEMPLATE
     - GitHub Actions 最近一次更新是否成功

# 我建议的下一步顺序
1. 先收窄 `/api/template` 返回值（最快、收益最大）
2. 再补 smoke tests + `/status` 错误语义
3. 再做入口访问保护
