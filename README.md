# Slack Companion · 小澪

使用 **Bun + Slack 官方 Bolt SDK + Pi Durable** 的主动群聊 AI。她能接收授权频道的普通消息，按语境选择接话或沉默，读取热点、发起话题、维护成员记忆，并逐步调整表达习惯。

这是可运行、可测试的第一版。自主插件目前是动态生成与加载的 **只读 HTTPS JSON API 配方**；不是任意宿主代码执行。成长是可追溯的人设、兴趣与关系记忆更新，不是模型权重训练。

## 快速开始

建议 Bun 1.4.2，另备 Node 24 与 npm 用于安装和类型检查。

```bash
npm ci
cp .env.example .env
# 编辑 .env，填入 Slack、模型凭据与频道 ID
bun src/main.ts
```

1. 在 [Slack 应用管理](https://api.slack.com/apps) 中用 `config/slack-manifest.json` 创建应用并安装到工作区。
2. 创建带 `connections:write` 权限的 **app-level token**，填入 `SLACK_APP_TOKEN`。将安装得到的 bot token 填入 `SLACK_BOT_TOKEN`。
3. 填入 `OPENAI_API_KEY`，将 `MODEL_ID` 改成该账号实际可访问、Pi 模型目录支持的模型。默认值来自 Pi 示例，不保证你的账号可用。
4. 将希望启用的频道 ID 写入 `CHANNEL_IDS`，管理员 Slack user ID 写入 `ADMIN_USER_IDS`。
5. 在这些频道中 `/invite @小澪`。她只读取 Slack 授权且已加入的频道；私密频道必须由成员邀请。
6. `PERSONA_SEED` 可以为空。首次启动调用模型生成人设并保存；之后读取保存版本。修改种子不会覆盖已成长的人设。

Socket Mode 无需公网 webhook。Slack 应用可由成员在工作区发现并邀请；不支持绕过工作区安装政策或自行进入私密频道。多人安装、跨工作区 OAuth 分发不在本版范围内。

## 运行与管理

```bash
npm run typecheck
npm run test:node       # Node 24 核心与真实 Pi 持久化测试
bun test               # 正式 Bun 环境验证
npm run demo           # 无凭据、确定性模拟演示，不调用模型或 Slack
```

管理员在启用频道使用 `/companion status`、`pause`、`resume`。`/companion retry reply:<事件ID>` 可以手动重试发送状态不确定的消息；操作前先核对 Slack，可能存在重复发送风险。成员可用 `/companion forget-me` 清除应用层成员记忆并停止处理自己的后续消息。Pi 归档的完整删除步骤见数据文档。

部署示例：

```bash
mkdir -p data
# Docker 镜像使用 bun 用户；保证挂载目录对该用户可写
sudo chown -R 1000:1000 data
docker compose up -d --build
docker compose logs -f
```

同一个 `DATA_DIR` **只运行一个进程/容器**，不要横向扩容或在两个主机共享目录。Docker 的重启策略负责进程崩溃后的重新启动，Pi 和应用数据库负责恢复任务。部署文件已提供，当前环境未运行 Docker 构建或真实 Slack 联调。

## 文档

- [产品与行为设计](docs/product.md)：自然交流、群聊参与、记忆、成长与需求落实表。
- [架构与恢复语义](docs/architecture.md)：并发、Pi、消息去重、持久化队列与发送确认。
- [自主扩展与学习](docs/evolution.md)：插件配方、成长机制，以及代码自更新的后续方案。
- [运行与数据管理](docs/operations.md)：配置、Slack 安装、故障处理、隐私与完整删除。
- [验证记录](docs/validation.md)：已验证范围、未验证项与上线验收清单。

依赖版本以 `package-lock.json` 为准。Pi Durable 为实验性接口，升级前必须运行类型检查、持久化与恢复测试。[Pi Durable 介绍](https://earendil.com/posts/pi-durable/)、[源码文档](https://github.com/earendil-works/pi/tree/main/packages/durable)、[Slack Socket Mode](https://docs.slack.dev/tools/bolt-js/concepts/socket-mode/)。

## GitHub

项目仓库：[QinYangWang/ama](https://github.com/QinYangWang/ama)。克隆后按快速开始配置并运行：

```bash
git clone https://github.com/QinYangWang/ama.git
cd ama
```

`.env`、聊天数据、插件运行数据和模型密钥均不进入 Git。
