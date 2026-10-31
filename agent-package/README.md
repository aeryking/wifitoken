# AK TokenRouter 盒端代理安装包

这个包用于 ARM64 的 OpenWrt 或 Linux 设备。代理只领取短期虚拟网关配置，**不包含 DeepSeek 主 Key**。

## 文件

- `tokenrouter-agent-linux-arm64`：ARM64 静态二进制
- `agent.env.example`：设备配置模板
- `install.sh`：Ubuntu/Armbian 安装脚本
- `openwrt-init.d`：OpenWrt procd 启动脚本
- `SHA256SUMS`：文件校验值

## Ubuntu/Armbian

```sh
tar -xzf ak-tokenrouter-agent-linux-arm64.tar.gz
cd ak-tokenrouter-agent
cp agent.env.example /etc/token-router/agent.env
vi /etc/token-router/agent.env
sudo ./install.sh
sudo systemctl status tokenrouter-agent
```

编辑配置时至少填写：

```ini
CONTROL_URLS=https://gateway.example.com/router-api
ROUTER_ID=你的设备编号
ROUTER_CONTROL_TOKEN=当前原型的服务级控制凭据
```

主备地址用逗号分隔。代理会按顺序请求，主地址失败时尝试下一个。默认每 6 小时刷新一次，写入 `/etc/token-router/upstream.json`，采用临时文件加原子替换，文件权限为 `0600`。

## OpenWrt

```sh
scp tokenrouter-agent-linux-arm64 root@192.168.1.1:/usr/bin/tokenrouter-agent
scp openwrt-init.d root@192.168.1.1:/etc/init.d/tokenrouter-agent
ssh root@192.168.1.1 'mkdir -p /etc/token-router && chmod 0700 /etc/token-router'
scp agent.env.example root@192.168.1.1:/etc/token-router/agent.env
ssh root@192.168.1.1 'chmod 0755 /usr/bin/tokenrouter-agent /etc/init.d/tokenrouter-agent; chmod 0600 /etc/token-router/agent.env; vi /etc/token-router/agent.env; /etc/init.d/tokenrouter-agent enable; /etc/init.d/tokenrouter-agent start'
```

OpenWrt 版本若没有 `systemd`，使用上面的 procd 脚本。不要把主 Key、控制凭据或明文临时 Key 写进固件；设备使用不同的 `ROUTER_ID`。当前服务仍使用共享控制凭据，生产前需要实现逐设备认证。

## 验证

```sh
sha256sum -c SHA256SUMS
systemctl status tokenrouter-agent       # Ubuntu/Armbian
logread -e tokenrouter-agent             # OpenWrt
ls -l /etc/token-router/upstream.json
```

网络不可用时，代理保留最后一份有效配置，不会清空现有配置。
