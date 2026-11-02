# napcat-rescue

把「我掉线了」变成一张能扫的码。

一个独立的小服务：查 NapCat 的登录状态，掉线时把登录二维码渲染出来，挂在一个只有知道口令的人才能打开的网页上。

**它不依赖 dsh。** dsh 挂了它也还在 —— 那正是它存在的理由。

---

## 它解决什么问题

NapCat 掉登录之后，你看到的是一模一样的现象：**没动静**。

分不出是「她不想说话」还是「她根本没上线」。要救就得 SSH 上去翻 `~/napcatrun/run.log`，在两个 hex 转储和几万行日志里找那个 `https://txz.qq.com/p?k=...` 链接，再拿手机扫——而且那个链接两分钟就过期。

这个页面把这件事变成：打开一个网址，扫码。

---

## 装

```bash
./install.sh                      # 默认 8099 端口、装到 ~/napcat-rescue
./install.sh --port 8080          # 换端口
./install.sh --port 8080 --uin 123456789
```

`--uin` 给了，页面上会多一个「我确认掉了」按钮（按了真的重启那个号的 NapCat）。
不给就只做只读的登录状态和二维码。

装完它会把地址打出来，长这样：

```
http://<机器地址>:8099/<64位口令>/
```

**口令在路径里，不是 `?secret=<口令>`。** 写成参数就是 404 —— 而且 404 长得跟「服务没起」一模一样，会浪费你半小时。

---

## 依赖

- `python3`
- `segno` —— 画二维码的纯 python 库：`python3 -m pip install --user segno`
- systemd（`--uin` 那条还要 cron）

---

## 它怎么知道 NapCat 在哪

自己找，按这个顺序：

```
~/napcatrun/napcat/config/webui.json
~/napcat/config/webui.json
```

两个都没有就报 `找不到 webui.json`。

⚠️ **如果你的 NapCat 不在这些位置**，改 `qq-rescue.py` 顶上的 `WEBUI_CANDIDATES`，或者在 `config.json` 里加 `"webuiPath": "/你的/路径/webui.json"`。

WebUI 的 base 地址是 `http://127.0.0.1:6099`。NapCat 改过端口的话，同文件顶上的 `WEBUI_BASE` 也要改。

---

## 安全

**二维码本身就是登录凭证。** 谁扫到，谁就能登你的号。

所以这个服务：

- 只有 `/<secret>/` 下的路径有响应，其它一律 404（常数时间比较，不给你试口令的机会）
- **在线时根本不生成二维码** —— 没掉线就没什么可扫
- 二维码只活在内存里，不落盘、不进日志
- 页头带 `no-store` / `noindex` / 禁止被别处内嵌
- systemd 里 `NoNewPrivileges` / `PrivateTmp` / 32M 内存封顶

**你要做的**：

- 口令别贴进聊天、issue、截图（从别的机器打开它就等于拿到你的号）
- 用完之后想换口令：删 `config.json` 里的 `secret` 那行再重启，会生成新的

---

## 想让外网打开

默认只在 `0.0.0.0:8099` 上听。要能公网访问，两条路：

**一、直接开端口**（最简单，也最危险 —— 你暴露的是一个能登你 QQ 的页面）

**二、走 80 端口重定向**（我们用的这个）：

```bash
sudo iptables -t nat -A PREROUTING -p tcp --dport 80 -j REDIRECT --to-ports 8099
```

⚠️ **iptables 规则重启就没了，防火墙重载也会丢。** 我们踩过 —— 某天忽然打不开，查了半天发现规则没了。

要么手动补，要么放一条 cron 每分钟检查一次：

```bash
* * * * * /path/to/port80-redirect.sh
```

配套的 `port80-redirect.sh` 见仓库，逻辑就是「有这条规则就什么都不做，没有就加」。

---

## 卸

```bash
./uninstall.sh
```

它会：停服务、删 unit、删 cron 那一行、**保留** `config.json` 和日志（万一你还要查）。

要连目录一起删：`./uninstall.sh --purge`

---

## 我们踩过的坑（都记在这儿，省你再踩）

1. **口令在路径里，不在参数里。** 写 `?secret=` 得到 404，而 404 跟「服务没起」看起来一样。
2. **「3001 端口不通」不等于 NapCat 坏了。** NapCat 只有在登录成功之后才监听那个端口。不通 = 没登录。
3. **同账号别在两处登。** 手机上也登着这个号的话，每次手机活跃就把服务器挤下线 —— 看起来像风控，其实不是。**扫码不需要登被扫的那个号**，随便一个 QQ 都能扫。
4. **自动登录做不到。** 就算配了 `NAPCAT_QUICK_PASSWORD`，quick token 失效之后走密码回退会要求**短信验证码**。那是腾讯的门槛。所以这个页面不是「锦上添花」，是必需品。
5. **`iptables` 规则会丢。** 见上面。
