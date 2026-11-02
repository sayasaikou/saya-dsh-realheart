[Unit]
Description=QQ rescue page (login status + login QR)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=__USER__
ExecStart=/usr/bin/env python3 __DIR__/qq-rescue.py
ExecStartPost=-__DIR__/check-secret-leak.sh
Restart=always
RestartSec=3
# 它只做一件事：查登录状态、画二维码。32M 封顶，超了就是漏了。
MemoryHigh=24M
MemoryMax=32M
NoNewPrivileges=true
PrivateTmp=true

[Install]
WantedBy=multi-user.target
