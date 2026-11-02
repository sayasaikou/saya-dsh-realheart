#!/usr/bin/env python3
"""把「我掉线了」变成一张能扫的码。

一个独立的小服务：查 NapCat 的登录状态，掉线时把登录二维码渲染出来，
挂在一个只有知道口令的人才能打开的网页上。它自己不依赖 dsh —— dsh 挂了
它也还在。

安全前提：二维码本身就是登录凭证。所以
  · 只有 /<secret>/ 下的路径有响应，其它一律 404（常数时间比较）
  · 在线时根本不生成二维码
  · 二维码只活在内存里，不落盘、不进日志
  · 页头 no-store / noindex / 禁止被别处内嵌

配置：config.json {"port": 8099, "secret": "...", "qr_ttl": 45}
"""

import hashlib
import hmac
import json
import os
import socket
import sys
import threading
import time
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import segno

HERE = os.path.dirname(os.path.abspath(__file__))
CONFIG_PATH = os.path.join(HERE, 'config.json')
WEBUI_CANDIDATES = [
    os.path.expanduser('~/napcatrun/napcat/config/webui.json'),
    os.path.expanduser('~/napcat/config/webui.json'),
]
WEBUI_BASE = 'http://127.0.0.1:6099'

# 「我确认掉了」按钮留的记号。cron 每分钟扫一次，有记号就重启 NapCat。
RESET_FLAG = os.path.join(HERE, '.reset-request')

# NapCat 的消息库。最后写入时间＝最后一次真正跟 QQ 服务器换过消息的时间。
NT_MSG_GLOB = os.path.expanduser('~/.config/QQ/nt_qq_*/nt_db/nt_msg.db-wal')

_cfg = json.load(open(CONFIG_PATH, encoding='utf-8'))
PORT = int(_cfg.get('port', 8099))
SECRET = str(_cfg['secret'])
QR_TTL = int(_cfg.get('qr_ttl', 20))     # PNG 缓存秒数（页面每 12 秒刷一次，比码的寿命短得多）

_lock = threading.Lock()
_cred = None          # WebUI 的 Credential（内存里，过期就重登）
_qr = None            # {'url': str, 'png': bytes, 'at': float}
_url_seen = {'url': '', 'at': 0.0}   # 同一个 qrcodeurl 第一次出现的时间
_last = {'ok': False, 'at': 0.0, 'data': {}}
_last_error = ''
_qr_error = {'msg': '', 'at': 0.0}   # 上一次换码失败的原因 + 时间（用于冷却和页面提示）


def _webui_token():
    for path in WEBUI_CANDIDATES:
        if os.path.exists(path):
            with open(path, encoding='utf-8') as fh:
                return json.load(fh)['token']
    raise RuntimeError('找不到 webui.json')


def _post(path, body=None, cred=None, timeout=12):
    data = json.dumps(body if body is not None else {}).encode()
    headers = {'Content-Type': 'application/json'}
    if cred:
        headers['Authorization'] = 'Bearer ' + cred
    req = urllib.request.Request(WEBUI_BASE + path, data=data, headers=headers, method='POST')
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return json.loads(resp.read().decode())
    except urllib.error.HTTPError as exc:
        return {'code': -exc.code, 'message': 'http %d' % exc.code}
    except Exception as exc:                      # 连接层的问题：NapCat 可能整个没起来
        return {'code': -1, 'message': 'connect: %s' % type(exc).__name__}


def _login():
    global _cred
    token = _webui_token()
    digest = hashlib.sha256((token + '.napcat').encode()).hexdigest()
    out = _post('/api/auth/login', {'hash': digest})
    cred = (out.get('data') or {}).get('Credential') if isinstance(out.get('data'), dict) else None
    if not cred:
        raise RuntimeError('WebUI 登录失败: %s' % out.get('message', ''))
    _cred = cred
    return cred


def _authed(path, body=None, timeout=12):
    """调一次 WebUI 接口；Credential 过期就重登一次。

    timeout 透传给 _post。RefreshQRcode 会阻塞最多 10 秒，调用方要自己给值；
    2026-10-28 12:0x 修：上一版这里根本没有 timeout 形参，
    而 _refresh_qr_url 里写的是 _authed(..., timeout=16) ⇒ TypeError，
    qr_png() 整条路径抛异常、页面 500 —— 从 10-27 22:50 起二维码一直出不来。
    """
    cred = _cred or _login()
    out = _post(path, body, cred, timeout=timeout)
    if out.get('code') == -1 and 'Unauthorized' in str(out.get('message', '')):
        cred = _login()
        out = _post(path, body, cred, timeout=timeout)
    return out


ONEBOT_PORT = 3001       # OneBot 那一侧（插件连的就是它）


def _onebot_up():
    """3001 还听不听得到。

    这条问的不是 NapCat「觉得自己」在不在线，而是**外面真的能不能连上它**。
    风控踢人那天就是进程还在、WebUI 字段照旧报在线，3001 已经不听了。
    """
    s = socket.socket()
    s.settimeout(1.5)
    try:
        s.connect(('127.0.0.1', ONEBOT_PORT))
        return True
    except OSError:
        return False
    finally:
        s.close()


def last_msg_age():
    """消息库最后一次写入距今多少秒；查不到返回 None。

    这不是「我掉线了吗」的判据 —— 他不说话的时候它当然不动。它的用处是
    摆事实：页面上写「最后一次消息 17 分钟前」，让人自己判断要不要按重启。
    ⚠️ 2026-10-27 那次假在线，就是靠这条定性的：NapCat 三项全绿、拒发二维码，
       可 nt_msg.db-wal 从 21:38:55 之后一个字都没写。
    """
    import glob
    best = None
    for path in glob.glob(NT_MSG_GLOB):
        try:
            m = os.path.getmtime(path)
        except OSError:
            continue
        if best is None or m > best:
            best = m
    if best is None:
        return None
    return max(0.0, time.time() - best)


def _age_text(sec):
    if sec is None:
        return '查不到'
    sec = int(sec)
    if sec < 90:
        return '%d 秒前' % sec
    if sec < 5400:
        return '%d 分钟前' % (sec // 60)
    return '%d 小时 %d 分钟前' % (sec // 3600, (sec % 3600) // 60)


def status():
    """{online, onebot, error, data, last_msg_age}

    ⚠️ 2026-10-27 踩过的三个坑，都写在这儿，别再走回去：

    ① 只看 isLogin / coreReady 不行 —— 风控踢人后进程还在，字段照旧报在线，
       那天页面是绿底「在线」，我却已经收不到消息了。
    ② 于是改成了「看 qrcodeurl 在不在」—— 更糟：**在线时 CheckLoginStatus
       里照样挂着上一张码的地址（残留）**，我人在线却被判成掉线，
       他看到的是反的。
    ③ 改成了 3001 真连得上 + 三个字段 + loginPhase=ready，缺一不算在线。
       还是不够：**21:38 那次 3001 在听、三字段全绿、连 GetQQLoginQrcode 都
       回「QQ Is Logined」，可 QQ 服务器那头早就断了**。NapCat 根本不知道自己掉了。

    ⇒ 结论：**没有任何一个接口能可靠地问出「真的在线吗」**，全是自述。
       所以这里保留最优努力判断，但页面必须同时给两样东西：
         · 消息库最后写入时间（人能拿它跟自己的记忆对账）
         · 一个「我确认掉了」的强制重登按钮（不跟他争辩，直接重启）
    """
    global _last_error
    out = _authed('/api/QQLogin/CheckLoginStatus')
    data = out.get('data') if isinstance(out.get('data'), dict) else {}
    age = last_msg_age()
    if out.get('code') != 0 or not data:
        _last_error = str(out.get('message', 'unknown'))
        return {'online': None, 'onebot': _onebot_up(), 'error': _last_error,
                'data': data, 'last_msg_age': age}

    up = _onebot_up()
    phase = str(data.get('loginPhase') or '')
    # isOffline 这个键只在某些版本出现，缺省当 false；出现了就一票否决。
    online = (up
              and bool(data.get('isLogin'))
              and not bool(data.get('isOffline'))
              and bool(data.get('coreReady'))
              and phase == 'ready')
    _last_error = ''
    _last.update(ok=online, at=time.time(), data=data, onebot=up)
    return {'online': online, 'onebot': up, 'error': '', 'data': data, 'last_msg_age': age}


# 一张码用多久就换。
#   · QQ 的登录码大约活 1~2 分钟；
#   · 换一次码，手上那张立刻作废 —— 所以不能换太勤，否则永远扫不上。
# 50 秒是折中：给足扫码窗口，又保证手里那张没死透。
QR_URL_TTL = 50
# 换码失败后隔多久再试。RefreshQRcode 会阻塞最多 10 秒，
# 不设冷却的话页面每 12 秒刷一次就卡一次。
QR_RETRY_GAP = 30


def _refresh_qr_url(current):
    """让 NapCat 换一张码，返回 (url, logged_in, err)。

    🔴 必须用 RefreshQRcode，不能用 GetQQLoginQrcode ——
    2026-10-27 22:44 那次「一直给过期二维码」就是踩了这个：

      · GetQQLoginQrcode 只把缓存里的 Ke.QQQRCodeURL 原样吐出来
        （源码 jue：`const n = pe.getQQLoginQrcodeURL()`，根本不生成新码），
        所以问多少次都是同一张，一分钟后它就是死的；
      · RefreshQRcode 才会真的让 QQ 内核重新出一张：先把 QQLoginPhase
        置成 generating_qrcode，触发内核出码，然后轮询 QQRCodeURL
        **直到它变了**才返回，最多等 10 秒，超时抛
        「二维码刷新超时：QQ 登录服务未返回新的二维码」。

    也就是说：要新码，只有这一个入口，而且它返回的就是新码本身。
    """
    out = _authed('/api/QQLogin/RefreshQRcode', timeout=16)
    msg = str(out.get('message') or '')
    if 'logined' in msg.lower() or '已登录' in msg:
        return '', True, ''
    data = out.get('data') if isinstance(out.get('data'), dict) else {}
    if data.get('restarting'):
        return '', False, 'NapCat 正在重连，等它一下'
    url = str(data.get('qrcodeurl') or '')
    if url and url != current:
        return url, False, ''
    if out.get('code') != 0:
        return '', False, msg or 'RefreshQRcode 调用失败'
    # code=0 但地址没变（或为空）：NapCat 没能出新码
    return '', False, 'NapCat 没给出新的二维码'


def _get_qr_url():
    """返回 (url, logged_in, err)。url 为空＝这次一张都没有。"""
    now = time.time()
    cur = _url_seen['url']
    if cur and now - _url_seen['at'] < QR_URL_TTL:
        return cur, False, ''
    if now - _qr_error['at'] < QR_RETRY_GAP:
        # 刚失败过，别连着再卡 10 秒；手上还有旧码就先给出去
        return (cur or ''), False, (_qr_error['msg'] if cur else '')
    url, logged_in, err = _refresh_qr_url(cur)
    if logged_in:
        return '', True, ''
    if url:
        _url_seen['url'] = url
        _url_seen['at'] = now
        _qr_error['msg'] = ''
        # 只记时间，不记地址 —— url 里的 k= 就是登录凭证
        sys.stderr.write('%s QR refreshed (had_old=%s)\n'
                         % (time.strftime('%H:%M:%S'), 'yes' if cur else 'no'))
        return url, False, ''
    _qr_error['msg'] = err
    _qr_error['at'] = now
    sys.stderr.write('%s QR refresh failed: %s\n'
                     % (time.strftime('%H:%M:%S'), err))
    return (cur or ''), False, err


def qr_png():
    """掉线时返回二维码 PNG 字节；在线返回 None。"""
    global _qr
    with _lock:
        now = time.time()
        # PNG 缓存按地址命中：码换了就必须重画
        if (_qr and _qr.get('url') == _url_seen['url']
                and now - _qr['at'] < QR_TTL):
            return _qr['png']

        st = status()
        if st['online'] is not False:      # 在线（或状态都查不到）：不给码
            _qr = None
            return None

        url, logged_in, _err = _get_qr_url()
        if logged_in or not url:           # 登上了 / 实在没码可给
            _qr = None
            return None

        buf = []
        segno.make(url, error='m').save(_Writable(buf), kind='png', scale=6, border=3)
        png = b''.join(buf)
        _qr = {'url': url, 'png': png, 'at': now}
        return png


def request_reset():
    """留个记号，让 cron 里的看门狗去重启 NapCat。

    为什么不在这儿直接重启：
      · 本服务开了 NoNewPrivileges=true，sudo 用不了（也不该为省事拆掉它）；
      · systemd 默认 KillMode=control-group，从这里起的子进程会挂在
        本服务的 cgroup 下 —— 本服务一重启就把 NapCat 一起带走。
    所以真正的重启交给用户级 cron 干，这里是「转交」不是「执行」。
    """
    try:
        with open(RESET_FLAG, 'w', encoding='utf-8') as fh:
            fh.write(str(int(time.time())) + '\n')
        return True
    except OSError:
        return False


class _Writable:
    """segno 只要求 write()。"""

    def __init__(self, chunks):
        self._chunks = chunks

    def write(self, data):
        self._chunks.append(bytes(data))
        return len(data)


PAGE = """<!doctype html><html lang="zh"><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<title>本鱼抢救页</title>
<style>
:root{color-scheme:light dark}
body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;
font:16px/1.6 system-ui,-apple-system,"Segoe UI",sans-serif;background:#0f1115;color:#e8eaed}
.card{max-width:520px;padding:28px 26px;border-radius:18px;background:#171a21;box-shadow:0 10px 40px #0006}
h1{font-size:20px;margin:0 0 6px}
.badge{display:inline-block;padding:2px 10px;border-radius:999px;font-size:13px;margin-bottom:14px}
.on{background:#153a26;color:#5ee08a}.off{background:#3a1a1a;color:#ff8b8b}.unk{background:#33363d;color:#c8ccd4}
img{display:block;width:260px;height:260px;margin:6px auto 10px;background:#fff;border-radius:12px;padding:6px}
.muted{color:#9aa0a6;font-size:13px}
code{background:#20242c;padding:1px 6px;border-radius:6px;font-size:13px}
form{margin:16px 0 0}
button{width:100%%;padding:11px 14px;border-radius:10px;border:1px solid #333a45;
background:#20242c;color:#c8ccd4;font:inherit;font-size:14px;cursor:pointer}
button:hover{border-color:#4b5563;color:#e8eaed}
</style>
<div class="card">
  <h1>本鱼 · 抢救页</h1>
  <div class="badge %(cls)s">%(badge)s</div>
  <div>%(body)s</div>
  <p class="muted">最后一次消息：<code>%(last)s</code>
  <br>这一行是拿 QQ 消息库的写入时间算的，不是 NapCat 自己说的。
  它一直不动、而你又刚发过话，那就是真的掉了。</p>
  <form method="post" action="reset" onsubmit="return confirm('确定要重启 QQ 吗？重启后要重新扫一次码。')">
    <button type="submit">我确认掉了 → 重启 QQ 并出码</button>
  </form>
  <p class="muted">这个页面每 12 秒自己刷新一次。二维码只在你看到它的那一刻才存在，扫完就没了。</p>
  <p class="muted">查状态时间：%(now)s</p>
</div>
<script>setTimeout(()=>location.reload(),12000)</script>
</html>"""

RESET_PAGE = """<!doctype html><html lang="zh"><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<title>正在重启</title>
<style>
:root{color-scheme:light dark}
body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;
font:16px/1.6 system-ui,-apple-system,"Segoe UI",sans-serif;background:#0f1115;color:#e8eaed}
.card{max-width:520px;padding:28px 26px;border-radius:18px;background:#171a21;box-shadow:0 10px 40px #0006}
h1{font-size:20px;margin:0 0 10px}
.muted{color:#9aa0a6;font-size:13px}
</style>
<div class="card">
  <h1>已经交出去了</h1>
  <div>一分钟内 QQ 会重启，然后这一页自己变成二维码。<br>
  别关，等着就行 —— 大概 40 秒后会冒出来。</div>
  <p class="muted">没动静就刷新一下。</p>
</div>
<script>setTimeout(()=>location.href='./',45000)</script>
</html>"""


class Handler(BaseHTTPRequestHandler):
    server_version = 'rescue'
    protocol_version = 'HTTP/1.1'

    def log_message(self, fmt, *args):
        # 一律不写：BaseHTTPRequestHandler 的格式串里第一个就是 requestline，
        # 而 URL 路径里就是口令。日志会轮转、会被翻、会被备份带出去。
        return

    def log_request(self, code='-', size='-'):
        # 只留方法、状态码、字节数；路径整段不记。
        sys.stderr.write('%s %s %s %s\n' % (time.strftime('%H:%M:%S'), self.command, code, size))

    def _send(self, code, body, ctype='text/html; charset=utf-8', extra=None):
        self.send_response(code)
        self.send_header('Content-Type', ctype)
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Cache-Control', 'no-store, max-age=0')
        self.send_header('X-Robots-Tag', 'noindex, nofollow')
        self.send_header('X-Frame-Options', 'DENY')
        self.send_header('Referrer-Policy', 'no-referrer')
        for k, v in (extra or {}).items():
            self.send_header(k, v)
        self.end_headers()
        self.wfile.write(body)

    def _ok_path(self, path):
        # self.path 是 http.server 按 latin-1 解出来的：原始字节 > 0x7F 就会变成
        # 非 ASCII 字符，而 hmac.compare_digest 拿 str 比较时只吃纯 ASCII，
        # 会直接抛 TypeError（公网一开，扫描器第一批请求里就带这种）。
        # 所以先还原成原始字节，再按字节比。
        try:
            raw = path.encode('latin-1')
            prefix = ('/' + SECRET).encode('ascii')
            return hmac.compare_digest(raw, prefix) or raw.startswith(prefix + b'/')
        except (TypeError, UnicodeError, ValueError):
            return False

    def do_GET(self):
        path = self.path.split('?', 1)[0]
        if not self._ok_path(path):
            return self._send(404, b'not found', 'text/plain; charset=utf-8')

        sub = path[len(SECRET) + 1:].lstrip('/')   # /<secret>/state → 'state'

        if sub == 'qr.png':
            png = qr_png()
            if not png:
                return self._send(404, b'no qr', 'text/plain; charset=utf-8')
            return self._send(200, png, 'image/png')

        if sub == 'state':
            st = status()
            payload = json.dumps({
                'online': st['online'],
                'onebot_up': st.get('onebot'),
                'error': st['error'],
                'phase': (st['data'] or {}).get('loginPhase', ''),
                'core_ready': (st['data'] or {}).get('coreReady'),
                'qq': (st['data'] or {}).get('uin', ''),
                'last_msg_ago_sec': (None if st['last_msg_age'] is None
                                     else int(st['last_msg_age'])),
                'qr_error': _qr_error['msg'],
                'qr_age_sec': (int(time.time() - _url_seen['at'])
                               if _url_seen['url'] else None),
                'checked_at': time.strftime('%Y-%m-%d %H:%M:%S'),
            }, ensure_ascii=False).encode()
            return self._send(200, payload, 'application/json; charset=utf-8')

        st = status()
        online = st['online']
        now = time.strftime('%Y-%m-%d %H:%M:%S')
        last = _age_text(st['last_msg_age'])
        if online is True:
            cls, badge = 'on', '在线'
            body = '我现在是在线的，不用扫。掉线了这里会自己换成二维码。'
        elif online is False:
            cls, badge = 'off', '掉线了'
            phase = (st['data'] or {}).get('loginPhase') or ''
            if _qr_error['msg']:
                # 换码失败就别放 <img>，否则浏览器只显示一个破图，看不出原因
                body = ('QQ 掉线了（%s），可换码没成功：<code>%s</code>'
                        '<br>等 30 秒它会自己再试一次；等不及就按下面那个按钮重启。'
                        % (phase or '状态未知', _qr_error['msg']))
            else:
                body = ('QQ 掉线了（%s）。下面这张码扫一下就把我登回来。'
                        '<br>一张码最多用 %d 秒，页面到点会自己换新的。'
                        '<br><img src="qr.png" alt="登录二维码">'
                        '<span class="muted">扫不到就等下一张，或者刷新页面。</span>'
                        % (phase or '状态未知', QR_URL_TTL))
        else:
            cls, badge = 'unk', '状态查不到'
            body = ('拿不到 NapCat 的状态（<code>%s</code>）。'
                    '<br>可能是 NapCat 整个没起来，这时候没有码可扫，'
                    '按下面那个按钮重启它。'
                    % (st['error'] or '未知'))
        self._send(200, (PAGE % {'cls': cls, 'badge': badge, 'body': body,
                                 'now': now, 'last': last})
                   .encode('utf-8'))

    def do_POST(self):
        path = self.path.split('?', 1)[0]
        if not self._ok_path(path):
            return self._send(404, b'not found', 'text/plain; charset=utf-8')

        # 请求体读掉，不然 keep-alive 下一条请求会串味
        try:
            n = int(self.headers.get('Content-Length') or 0)
            if n > 0:
                self.rfile.read(min(n, 65536))
        except (ValueError, OSError):
            pass

        sub = path[len(SECRET) + 1:].lstrip('/')
        if sub == 'reset':
            ok = request_reset()
            if not ok:
                return self._send(500, '留记号失败'.encode('utf-8'))
            return self._send(200, RESET_PAGE.encode('utf-8'))
        return self._send(404, b'not found', 'text/plain; charset=utf-8')


def main():
    srv = ThreadingHTTPServer(('0.0.0.0', PORT), Handler)
    srv.daemon_threads = True
    print('rescue page on :%d' % PORT, flush=True)
    srv.serve_forever()


if __name__ == '__main__':
    main()
