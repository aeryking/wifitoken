#!/bin/sh
set -eu

PREFIX=/usr/local/bin
ETC=/etc/token-router
BIN_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)

if [ "$(id -u)" != 0 ]; then
  echo "请用 root 执行：sudo $0" >&2
  exit 1
fi

install -d -m 0700 "$ETC"
install -m 0755 "$BIN_DIR/tokenrouter-agent-linux-arm64" "$PREFIX/tokenrouter-agent"
if [ ! -e "$ETC/agent.env" ]; then
  install -m 0600 "$BIN_DIR/agent.env.example" "$ETC/agent.env"
else
  chmod 0600 "$ETC/agent.env"
fi

if command -v systemctl >/dev/null 2>&1 && [ -d /run/systemd/system ]; then
  install -m 0644 "$BIN_DIR/tokenrouter-agent.service" /etc/systemd/system/tokenrouter-agent.service
  systemctl daemon-reload
  systemctl enable --now tokenrouter-agent
  echo "已安装并启动 systemd 服务 tokenrouter-agent"
else
  echo "未检测到 systemd。若这是 OpenWrt，请将 openwrt-init.d 安装到 /etc/init.d/tokenrouter-agent。"
  echo "配置文件：$ETC/agent.env"
fi
