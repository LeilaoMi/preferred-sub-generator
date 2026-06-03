# Cloudflare 设置说明

本文只记录部署前需要准备的资源和配置，不包含任何真实密钥。

## 1. 创建 KV Namespace

在 Cloudflare Dashboard 创建一个 KV Namespace，用来保存：

```text
TEMPLATE
BEST_IPS
STATUS
```

创建后记录 Namespace ID，用于：

- `wrangler.toml` 的 `kv_namespaces.id`
- GitHub Secret：`CLOUDFLARE_NAMESPACE_ID`

## 2. Cloudflare Pages 项目

Pages 项目建议设置：

```text
项目名：preferred-sub-generator
构建命令：留空
构建输出目录：public
Functions 目录：functions
KV 绑定变量名：SUB_KV
```

Pages 环境变量：

```text
```

## 3. GitHub Secrets

在 GitHub 仓库 Settings → Secrets and variables → Actions 中配置：

```text
CLOUDFLARE_API_TOKEN      # 用于写 KV
CLOUDFLARE_ACCOUNT_ID     # Cloudflare Account ID
CLOUDFLARE_NAMESPACE_ID   # KV Namespace ID
```

原始 VLESS 节点通过网页输入并保存到 Cloudflare KV 的 `TEMPLATE`，不要写进 GitHub Secrets 或仓库文件。

## 4. Cloudflare API Token 最小权限

建议创建自定义 API Token，只给必要权限：

```text
Account → Workers KV Storage → Edit
Account → Account Settings → Read
```

资源范围只选择当前账号。不要使用全局 API Key。

## 5. 部署前验证

本地静态检查：

```bash
npm run preflight
```

注意：如果 `wrangler.toml` 里的 KV id 还是占位符，`preflight` 会失败。这是正常的，说明还没替换成真实 Namespace ID。

## 6. 上线后验证

```text
/status
/sub?type=vless
/sub?type=clash
/sub?type=singbox
/sub?type=shadowrocket
/best?n=20
```

订阅接口无需 token；请不要公开部署域名。
