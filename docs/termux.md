# 在手机 Termux 上做国内实测

Globalping 的国内探针多在家宽或机房，不等于你的手机线路。手机实测能把**你自己线路**上的结果并进排序。

推荐用 [cf-termux-pick](https://github.com/LeilaoMi/cf-termux-pick)（Python，结果推到 GitHub，本项目自动拉取，不需要 D1）。下面是本仓库自带的另一种方式：直接回传到你的部署，需要绑定 D1 和管理 token。

## 一次性安装

```bash
pkg update && pkg install -y nodejs-lts git
git clone https://github.com/LeilaoMi/preferred-sub-generator ~/psg
cat > ~/.psg.env <<'CONF'
SITE_URL=https://你的部署域名
SUB_TOKEN=你的管理token
CONF
chmod 600 ~/.psg.env
```

## 每次实测（先关掉代理/VPN）

```bash
cd ~/psg && git pull && bash scripts/termux-probe.sh
```

- 约 1~3 分钟，测完自动回传；只测握手和 TLS，不测带宽，流量很小（约几 MB）。
- 检测到出口不在 CN（代理没关）会直接中止，不会回传错误数据。
- Wi-Fi 和移动数据线路不同，两种网络下各测一次效果最好。
- 订阅只采信最近 3 天的实测（`SUB_VERIFIED_DAYS`），建议每 1~2 天测一次。

## 可选：定时自动测

代理常开的话定时任务大多会被"出口不在 CN"拦下，意义不大；只有手机常态直连时才推荐：

```bash
pkg install -y cronie termux-services
sv-enable crond          # 装完需重开一次 Termux
(crontab -l 2>/dev/null; echo '0 */6 * * * bash $HOME/psg/scripts/termux-probe.sh >/dev/null 2>&1') | crontab -
```

还需在系统设置里关掉 Termux 的电池优化，否则后台会被杀。

## 手动置顶

把你确认能用的 IP 或优选域名写进 `sources/edge/manual.txt`（每行一个，`ip:端口` 或 `域名:端口`）。
即使美国扫描机连不上，它们也会留在池里，订阅时排在实测节点之后、补齐节点之前。
