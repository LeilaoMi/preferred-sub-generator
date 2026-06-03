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
SUB_TOKEN    # 私有订阅 token，不要公开
```

## 3. GitHub Secrets

在 GitHub 仓库 Settings → Secrets and variables → Actions 中配置：

```text
CLOUDFLARE_API_TOKEN      # 用于写 KV
CLOUDFLARE_ACCOUNT_ID     # Cloudflare Account ID
CLOUDFLARE_NAMESPACE_ID   # KV Namespace ID
ORIGINAL_SUB_OR_NODE      # 你的原始 VLESS 节点或订阅模板
```

`ORIGINAL_SUB_OR_NODE` 必须是你自己的原始 VLESS 节点，例如：

```text
vless://uuid@example.com:443?encryption=none&security=tls&sni=example.com&type=ws&host=example.com&path=%2Fws#原始节点
```

不要把真实节点写进仓库文件。

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
/sub?type=vless&token=你的token
/sub?type=clash&token=你的token
/sub?type=singbox&token=你的token
/sub?type=shadowrocket&token=你的token
/best?n=20&token=你的token
```

错误 token 请求 `/sub` 应返回 401。
