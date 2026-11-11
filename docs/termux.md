# 在手机 Termux 上做国内实测

Globalping 的国内探针多在家宽或机房，不等于你的手机线路。手机实测能把 **你自己线路** 上的结果并入排序。

有两种方式：

| 方式 | 结果去向 | 适合 |
|---|---|---|
| [cf-termux-pick](https://github.com/LeilaoMi/cf-termux-pick)（推荐） | 推到 GitHub 仓库，China Probe 每轮通过 `PHONE_RESULTS_URL` 自动拉取 | 不想在手机上保存管理 token |
| 本仓库 `scripts/termux-probe.sh`（本文） | 直接回传到你部署的 `/api/ip-feedback` | 已设置管理 token，想立即生效 |

本文介绍第二种。回传数据在绑定 D1 时写入 D1，否则写入 KV（保留最近 500 条）。

## 一次性安装

```bash
pkg update && pkg install -y nodejs-lts git
git clone https://github.com/你的用户名/preferred-sub-generator ~/psg
cat > ~/.psg.env <<'CONF'
SITE_URL=https://你的部署域名
SUB_TOKEN=你的管理token
CONF
chmod 600 ~/.psg.env
```

管理 token 可以是 Pages 环境变量 `SUB_TOKEN`，也可以是通过 `/setup.html` 设置的那个。配置文件位置可用环境变量 `PSG_ENV` 指定。

## 每次实测（先关掉代理 / VPN）

```bash
cd ~/psg && git pull && bash scripts/termux-probe.sh
```

- 实测整个候选池（最多 300 个 IP），每个 IP 握手采样 3 次，不测带宽，流量很小。
- 检测到出口不在国内（代理没关）会直接中止，不会回传错误数据。
- 日志保存在 `~/.psg-logs/`，只保留最近 30 份。
- Wi-Fi 和移动数据线路不同，两种网络下各测一次效果最好。
- 订阅只采信最近 3 天的实测（`SUB_VERIFIED_DAYS`），建议每 1–2 天测一次。

额外参数会原样传给 `scripts/probe-ips.js`，可用参数见 [reference.md](reference.md#probe-ipsjs-参数)。

## 可选：定时自动测

代理常开时，定时任务大多会被「出口不在国内」拦下，意义不大；只有手机常态直连时才推荐：

```bash
pkg install -y cronie termux-services
sv-enable crond          # 装完需重开一次 Termux
(crontab -l 2>/dev/null; echo '0 */6 * * * bash $HOME/psg/scripts/termux-probe.sh >/dev/null 2>&1') | crontab -
```

还需在系统设置里关闭 Termux 的电池优化，否则后台会被杀掉。

## 手动置顶

把你确认能用的 IP 或优选域名写进 `sources/edge/manual.txt`（每行一个，`IP`、`IP:端口` 或 `域名:端口`）。即使美国初筛连不上，它们也会留在候选池里，订阅时排在国内实测节点之后、补位节点之前。

> 注意：Update 工作流运行时会用仓库主人自己的 `<你的用户名>/cf-termux-pick` 仓库的 `best-ips.txt` 替换 `manual.txt` 中的 IP 行（只在当次运行中，不提交）；拉取失败时才使用仓库里的内容。
