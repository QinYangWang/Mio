# Mio · 澪

> 一个会接话、记得你，也会慢慢成长的 Slack AI 群友。

基于 **Bun + Slack Bolt SDK + Pi Durable** 构建的主动型群聊机器人。她能作为公开透明的 AI 参与群聊：根据语境决定接话或保持沉默、浏览热点、发起话题、记录成员偏好，并在日常互动中逐步演进表达习惯。

---

## ⚡ 30 秒快速了解

| 特性维度 | 当前支持能力（已实现） | 严格边界与限制（不可做/规划中） |
|---|---|---|
| **群聊交互** | 授权频道的普通消息感知；自主判定回复或沉默；智能接梗与答疑 | 不会自动加入未邀请的私密频道；不补取加入前的历史消息 |
| **主动话题** | 定时浏览热点并主动开场；群友发言时优先接话避让 | 每日次数受限（默认 2 次/天）；避开夜间静默时段 |
| **个性成长** | 依据真实群聊事件小步微调性格倾向与兴趣列表；审计日志入库 | 核心身份不可篡改；不是大模型权重微调；每天最多微调 1 次 |
| **成员记忆** | 记录明确表达的偏好与专属梗；按频道与成员隔离 | 不推测敏感身份与隐私；遵循 `/companion forget-me` 退出标记 |
| **动态插件** | 自主生成并热加载只读 HTTPS JSON API 工具配方 | **严禁执行任意宿主代码**；无 Shell / eval 权限；严格域名白名单 |
| **可靠运行** | 进程崩溃自愈；SQLite 队列持久化；Pi Durable 会话恢复 | **不承诺 Slack exactly-once**；需单实例独占数据卷 |

---

## 🚀 快速开始

### 1. 环境准备
- **运行时**：[Bun](https://bun.sh/) $\ge 1.4.2$（正式生产运行）
- **开发工具**：Node.js $\ge 24$ 与 npm（用于依赖安装与严格类型检查）

### 2. 安装与配置

```bash
# 1. 安装依赖
npm ci

# 2. 复制环境配置模板
cp .env.example .env
```

编辑 `.env` 文件，填入核心配置：
- `SLACK_BOT_TOKEN` / `SLACK_APP_TOKEN`：Slack 应用凭据（需启用 Socket Mode）
- `OPENAI_API_KEY` / `MODEL_ID`：模型提供商凭据与支持的模型标识
- `CHANNEL_IDS`：允许 Mio 参与的 Slack 频道 ID 列表（逗号分隔）
- `ADMIN_USER_IDS`：具备管理权限的 Slack 用户 ID 列表

> [!TIP]
> **Slack 应用配置**：在 [Slack App Directory](https://api.slack.com/apps) 使用项目内置的 [`config/slack-manifest.json`](config/slack-manifest.json) 即可一键导入应用配置。

### 3. 邀请进群与启动

1. 在目标频道中邀请机器人：`/invite @小澪`
2. 启动服务：

```bash
bun src/main.ts
```

首次启动时，Mio 会自动调用模型根据 `PERSONA_SEED` 生成初始性格并持久化存储。

---

## 🛠️ 常用命令与管理

### 开发与验证命令

| 命令 | 用途 | 说明 |
|---|---|---|
| `npm run typecheck` | TypeScript 严格类型检查 | 保证接口与类型完整性 |
| `npm run test:node` | Node 24 核心回归测试 | 验证持久化、队列、并发与恢复逻辑 |
| `bun test` | Bun 原生环境测试 | 验证生产运行时下的全套单测 |
| `npm run demo` | 本地确定性控制台演示 | 无需网络与 API 凭据，模拟消息流转与接话 |

### Slack 管理指令（仅限管理员）

在 Mio 参与的频道中直接发送：

```text
/companion status               # 查看当前队列状态、人设版本与异常消息
/companion pause                # 暂停当前频道的处理与主动发言
/companion resume               # 恢复当前频道的处理
/companion retry reply:<事件ID>  # 手动重试发送状态不确定的消息（操作前须核对 Slack）
```

普通成员隐私命令：
```text
/companion forget-me            # 清除本人的应用层记忆并停止处理本人后续消息
```

---

## 🐳 Docker 生产部署

> [!IMPORTANT]
> **单实例约束**：同一 `DATA_DIR` **严禁同时启动多个进程或容器实例**，亦不能在多个主机间共享卷。持久化锁（`owner.lock`）会阻止多实例竞争。

```bash
# 1. 创建本地数据挂载目录并赋予容器 bun 用户权限 (UID 1000)
mkdir -p data
sudo chown -R 1000:1000 data

# 2. 构建并后台运行
docker compose up -d --build

# 3. 查看实时运行日志
docker compose logs -f
```

---

## 📚 完整文档体系

为了获得完整的设计细节与运维指导，请查阅以下专门文档：

| 模块 | 核心内容 | 目标受众 |
|---|---|---|
| 📖 [产品与行为设计](docs/product.md) | 自然交流准则、发言决策模型、成员记忆隔离、成长边界 | 产品设计 / 运营 |
| 🏗️ [架构与恢复语义](docs/architecture.md) | 双存储模型、Lane 调度并发、outbox 交付对账、崩溃自愈 | 架构师 / 后端研发 |
| 🧩 [自主扩展与学习](docs/evolution.md) | JSON 插件配方规范、安全沙箱防御（SSRF/原型污染）、未来代码自演化 | 安全 / 算法研发 |
| 运维 [安装与运维管理](docs/operations.md) | 完整环境变量字典、故障诊断清单、数据备份与彻底删除指南 | 运维 / SRE / 管理员 |
| 🧪 [验证记录与清单](docs/validation.md) | 已执行测试事实、环境限制说明、上线前验收 Checklist | QA / 交付工程师 |
| 🤝 [贡献与提交规范](CONTRIBUTING.md) | Conventional Commits、分支管理、本地校验 Hooks 与 PR 流程 | 开源贡献者 |
| 🤖 [协作规则](AGENTS.md) | 智能体工作契约、代码地图、不可破坏的系统设计红线 | AI 编码助手 |

---

## ⚠️ 关键限制与安全守则

> [!WARNING]
> 1. **代码执行安全**：自主插件系统**仅限读取结构化 HTTPS JSON API**，未开放且严禁执行任意 TypeScript/Shell 代码。
> 2. **网络出网限制**：插件请求严格受 `NETWORK_HOSTS` 白名单限制，禁止内网 IP 与重定向。
> 3. **交付语义边界**：不承诺 Slack exactly-once delivery。在网络或进程崩溃导致状态不确定时，系统仅做只读对账，绝不盲目重发。
> 4. **完全遗忘限制**：`/companion forget-me` 立即删除应用层记录，但底层 Pi Durable 的 append-only 历史归档需要停机人工处理。详见 [数据运维文档](docs/operations.md#数据位置与隐私)。
