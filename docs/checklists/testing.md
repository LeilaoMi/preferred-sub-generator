# 测试补全清单

## 目标
从“函数级测试正确”升级到“端到端行为可靠”。

## 任务列表
- [ ] 增加 API smoke test：POST 保存模板 -> GET 读取 preview
- [ ] 增加 smoke test：错误 token 返回 401
- [ ] 增加 smoke test：无 TEMPLATE 时 `/sub` 返回 503
- [ ] 增加 smoke test：无 BEST_IPS 时 `/sub` 返回 503
- [ ] 增加 smoke test：token 不会出现在订阅 URL 文本中
- [ ] 增加 Clash 格式断言：包含 `proxy-groups`
- [ ] 增加 Sing-box 格式断言：包含完整 `outbounds`
- [ ] 增加 v2rayNG 断言：base64 解码后仍合法 VLESS URI
- [ ] 增加首页行为断言：点击“生成”后不把 token 拼入 `/sub`
- [ ] 增加 admin 行为断言：未填 token 不触发保存请求
- [ ] 增加 preflight 断言：检测 workflow 必须含 `npm run preflight`
- [ ] 增加 preflight 断言：首页保存模板时必须带 `Authorization`

## 验收标准
- `npm test` 通过率稳定
- 本地可复现“订阅成功 / 管理拦截 / 缺模板失败”三种主场景
