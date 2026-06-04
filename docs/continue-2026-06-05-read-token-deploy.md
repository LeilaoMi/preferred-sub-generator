# 续接记录：部署变量 SUB_READ_TOKEN 自动拼接订阅链接

生成时间：2026-06-05（Asia/Shanghai）
项目路径：`/home/workspace/Projects/preferred-sub-generator`

## 任务目标
用户要求：推送并部署；仓库说明要清楚；部署项目上线后，订阅链接才带“变量设置的 token”。

## 当前提交
- 最新提交：`4a84642 Generate subscription links from deployed read token`
- 状态：已 push 到 `origin/main`

## 已完成改动
- 新增 `src/api/read-token.js`
  - 返回 Cloudflare Pages 环境变量 `SUB_READ_TOKEN`。
  - 响应形如 `{ readToken, configured }`。
- 新增 `functions/api/read-token.js`
  - Pages Functions 路由入口。
- 修改 `public/index.html`
  - 首页上线后调用 `/api/read-token`。
  - 若读到 `SUB_READ_TOKEN`，订阅链接自动追加 `t=<SUB_READ_TOKEN>`。
  - 不把管理 token 拼进订阅链接。
- 修改 `scripts/preflight.js`
  - 要求存在 `functions/api/read-token.js`。
  - 检查首页不能写死 `autosub`。
  - 检查首页必须从 `/api/read-token` 读取线上 `SUB_READ_TOKEN`。
- 修改测试：`tests/static.test.js`、`tests/preflight.test.js`。
- 修改文档：`README.md`、`docs/deploy-checklist.md`，说明上线后订阅链接才带部署变量里的 token。

## 验证结果
本地：
```text
npm test：81 passed / 0 failed
npm run preflight：部署前检查通过
npm run validate:sources：手动源校验通过
git diff --check：通过
```

部署：
```text
CLOUDFLARE_API_TOKEN="$CLOUDFLARE_API_TOKEN_2" npx wrangler pages deploy public --project-name preferred-sub-generator --branch main --commit-dirty=true
```

部署成功预览：
```text
https://b2f90a26.preferred-sub-generator-zrd.pages.dev
```

线上验证域名：
```text
https://yxdy.woniu.bee.al
```

线上验证结果：
```text
/                       HTTP 200
/api/read-token          HTTP 200，configured: true
/sub?type=v2rayng&t=<SUB_READ_TOKEN>  HTTP 200，返回 base64 订阅
/best?n=2&t=<SUB_READ_TOKEN>          HTTP 200，返回 JSON
/status                  HTTP 200，status: ok，available: 50
```

首页脚本验证：
```text
包含 /api/read-token
包含 searchParams.set("t", readToken)
不包含写死 autosub
```

## 注意事项
- 本文档不记录实际 token 值。
- 当前线上 `/api/read-token` 会向浏览器返回只读 token，这是为了满足“页面生成的订阅链接可直接导入客户端”的需求；管理 token 不会被返回，也不会拼到订阅 URL。
