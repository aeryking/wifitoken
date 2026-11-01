# WiFi Token · 门店 AI 额度网关

面向咖啡店、酒店等场景的 AI Token 服务原型：平台通过 OpenAI 兼容接口发放限额虚拟 Key，消费者在支持自定义 API 地址的客户端使用，网关验证额度、转发请求并记录用量。模型运行在上游服务，路由器不提供本地大模型算力。Wi-Fi 连接本身不会自动改写 HTTPS 请求；消费者需要配置客户端 API 地址和虚拟 Key。

## 现有代码

- `gateway/`：Node.js 网关、管理页面、额度计算与单元测试。
- `openwrt-agent/`：Go 设备代理，按控制地址获取短期配置并写入本地文件。
- `agent-package/`：ARM64 代理及 OpenWrt procd 和 Linux systemd 安装文件。
- `deploy/`：MySQL 初始化和迁移脚本、systemd 示例。
- [赛事作品说明](赛事作品说明.md)、[演示视频脚本](演示视频脚本.md)。

这是与 HomeClaw 独立的 WiFi Token 项目。原项目历史测试通过 HomeClaw 测试环境托管，独立副本已移除运行时对其模块路径、账户与域名的依赖。

## 独立安装（MySQL 8）

1. 安装 Node.js 20+、Go 1.23+ 和 MySQL 8；运行 `npm ci`。
2. 依次导入 `deploy/schema.sql`、`deploy/002-metering.sql`、`deploy/003-quota-runtime.sql`、`deploy/004-platform-auth.sql`。这些迁移用于全新空库，ALTER 语句不要重复运行。数据库账号需访问 `tokenrouter` 库。
3. 将 `.env.example` 的值通过受控方式加载到进程环境，填写数据库、上游密钥、管理密码和控制凭据；不要将实际凭据提交仓库。上游地址需与该服务支持的 OpenAI 兼容路径匹配。
4. `DEFAULT_MODEL` 与 `models`、`model_price_rules` 中的模型 ID 必须一致，价格仅为历史测试示例，上线前须重新核实和配置。
5. 运行 `npm start`。服务默认监听 `127.0.0.1:19080`；管理入口 `/admin`，健康检查 `/health`。部署 HTTPS 反向代理后管理登录 Cookie 才能在浏览器中正常使用；如使用 `/router-api` 前缀，代理应剥离该前缀且 `COOKIE_PATH=/router-api`，页面入口使用 `/router-api/admin`。

执行 `npm test` 和 `go -C openwrt-agent test ./...`。OpenWrt 端安装详见 `agent-package/README.md`；其代理只写配置，完整的顾客接入、Portal、设备端本地代理及 Wi-Fi 流控链路不在当前代码中。

## 运行边界

已有虚拟 Key 签发、失效/撤销、管理页、计量及上游流式转发的实现。额度锁为进程内单实例锁；共享控制凭据、上游成功但缺失 usage、计量在响应结束后写入、上游流式内容内存累积、断连和故障恢复均需进一步完善；不可声称具备生产级可靠计费或多实例安全。用户与上游 Key 分离，主 Key 必须仅由服务器读取。价格、模型、运营数据与合作关系不得以历史样例充当当前事实。

本次本地验证：Node 计量 4 项测试通过；Go 代理的模拟控制端测试验证配置写入、0600 权限及失败保留；源码与 Go 构建通过。未在当前环境运行 MySQL、真实上游、OpenWrt 设备或浏览器端端到端流程，因此不把历史实测当成本次结果。

## Docker Desktop 本机演示

启动 Docker Desktop 并确认 `docker info` 能连接，然后在本目录执行：

```sh
docker compose up -d --build
docker compose ps
curl http://127.0.0.1:19080/health
```

浏览器打开 `http://localhost:19080/admin`，默认管理员用户名 `admin`，密码 `local-admin-2026`。首次启动时会自动初始化 MySQL：数据库 `tokenrouter`，用户名 `tokenrouter`，密码 `local-tokenrouter-2026`；MySQL root 密码 `local-root-2026`。数据库仅在 Docker 内部网络可访问，网关仅绑定本机。默认上游为本地模拟服务，返回模拟响应，不扣真实模型费用。

首次启动时 MySQL 自动依次导入 `deploy/` 下的四个 SQL 文件。数据库存在 `wifitoken_mysql_data` 数据卷中，重启容器不会重置数据；初始化脚本和初始管理员密码只在首次创建空数据库时生效。更改 Compose 密码不会自动更改已有数据库或管理员账户。请勿随意执行 `docker compose down -v`，该命令会删除数据库卷。

要修改默认值，可创建独立的 `.env` 文件覆盖 `MYSQL_ROOT_PASSWORD`、`MYSQL_USER`、`MYSQL_PASSWORD`、`TOKEN_ROUTER_ADMIN_TOKEN`、`ROUTER_CONTROL_TOKEN` 和 `WIFITOKEN_PORT`。正式对外部署须修改所有默认凭据、配置真实上游与价格、配置 HTTPS，并完成设备身份和计费可靠性工作。`DEEPSEEK_BASE_URL`、`DEEPSEEK_API_KEY`、`DEFAULT_MODEL` 和 `PUBLIC_PROXY_URL` 可覆盖模拟上游；不要将密钥提交 Git。

本机演示测试：`node gateway/local-smoke.mjs`，使用模拟上游发卡、调用并测试额度耗尽；会在该测试数据库中创建测试卡片。此部署尚待 Docker Desktop 实际运行验证。
