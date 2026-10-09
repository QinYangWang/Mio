# 安装、运维与数据管理

> 本文档规范 Mio 的生产环境配置字典、容器化部署守则、日常运维命令、故障诊断恢复矩阵，以及隐私数据擦除与备份标准。

---

## ⚙️ 环境变量全景字典

所有配置项均在 `.env` 中定义，启动时由 `config.ts` 执行解析与合法性边界校验：

### 1. Slack 凭据与权限接入

| 变量名 | 类型 | 必填 | 默认值 | 取值范围 / 校验规则 | 作用与说明 |
|---|---|---|---|---|---|
| `SLACK_BOT_TOKEN` | 字符串 | **是** | 无 | 以 `xoxb-` 开头 | Slack Bot 用户的 API 访问凭据 |
| `SLACK_APP_TOKEN` | 字符串 | **是** | 无 | 以 `xoxp-` 开头 | Socket Mode App-Level Token（需 `connections:write` 权限） |
| `CHANNEL_IDS` | 列表 | **是** | 无 | 逗号分隔的频道 ID | 授权 Mio 监听、发言与主动发起话题的频道列表 |
| `ADMIN_USER_IDS` | 列表 | 否 | `""` | 逗号分隔的用户 ID | 允许在已授权频道中执行 `/companion` 管理命令的成员 ID |

### 2. 模型引擎与人设

| 变量名 | 类型 | 必填 | 默认值 | 取值范围 / 校验规则 | 作用与说明 |
|---|---|---|---|---|---|
| `OPENAI_API_KEY` | 字符串 | **是** | 无 | 有效 API Key | Pi OpenAI Provider 访问凭据 |
| `MODEL_ID` | 字符串 | 否 | `gpt-6-sol` | Pi 支持的模型 ID | 驱动对话与工具调用的模型版本 |
| `BOT_NAME` | 字符串 | 否 | `小澪` | 任意有效字符串 | 首次生成人设时赋予的名字 |
| `PERSONA_SEED` | 字符串 | 否 | `""` | 任意文本 | 首次生成人设的指导种子（后续成长不被此覆盖） |

### 3. 调度、节奏与并发控制

| 变量名 | 类型 | 必填 | 默认值 | 取值范围 / 校验规则 | 作用与说明 |
|---|---|---|---|---|---|
| `TIMEZONE` | 字符串 | 否 | `Asia/Taipei` | 有效 IANA 时区标识 | 静默时段与每日主动次数重置采用的时区 |
| `QUIET_START` | 整数 | 否 | `23` | `0` – `23` | 夜间静默时段起始小时数 |
| `QUIET_END` | 整数 | 否 | `8` | `0` – `23` | 夜间静默时段结束小时数（两值相同表示关闭静默） |
| `AMBIENT_COOLDOWN_SECONDS` | 整数 | 否 | `90` | $\ge 0$ | 未被直接提及时的插话冷却时长（秒） |
| `PROACTIVE_INTERVAL_MINUTES`| 整数 | 否 | `180` | $\ge 5$（系统硬性下限） | 主动发起话题的最短间隔时间（分钟） |
| `DAILY_PROACTIVE_LIMIT` | 整数 | 否 | `2` | `0` – `20` | 单个频道单日内主动发起话题的最大尝试次数 |
| `MAX_CONCURRENT_LANES` | 整数 | 否 | `4` | `1` – `16`（系统硬性上限） | 全局允许并行调用大模型的最大独立会话车道数 |

### 4. 存储路径与网络安全

| 变量名 | 类型 | 必填 | 默认值 | 取值范围 / 校验规则 | 作用与说明 |
|---|---|---|---|---|---|
| `DATA_DIR` | 路径 | 否 | `./data` | 有效本地文件目录路径 | SQLite 与 Pi Durable 会话历史的持久化存储根目录 |
| `NETWORK_HOSTS` | 列表 | 否 | `""` | 逗号分隔的域名列表 | 工具与插件允许发起的只读 HTTPS 域名白名单 |

---

## 🚀 部署实操指南

### 1. Docker Compose 生产部署（推荐）

> [!IMPORTANT]
> **容器权限要求**：Docker 镜像基于官方 `oven/bun`，在容器内以非 root 用户 `bun`（UID 1000, GID 1000）运行。必须确保宿主机挂载目录属于该用户。

```bash
# 1. 创建本地数据挂载目录并赋权
mkdir -p data
sudo chown -R 1000:1000 data

# 2. 检查 .env 文件是否已包含全部必填项
test -f .env || echo "错误：缺少 .env 配置文件"

# 3. 构建并后台启动
docker compose up -d --build

# 4. 观察实时运行日志
docker compose logs -f --tail=100
```

### 2. 进程独占守则（禁止多副本）

> [!CAUTION]
> **单实例红线**：同一个 `DATA_DIR` **严禁同时被两个以上的进程或容器挂载与读写**！
> - 系统依赖 `owner.lock` 记录运行中进程的 PID；
> - 绝对不要在两个宿主机之间使用 NFS / SMB 共享同一个数据目录；
> - 水平扩容（Scale）会导致 SQLite WAL 冲突与 Pi 会话历史损坏。

---

## 🛠️ 管理员命令操作规范

在授权的 Slack 频道中，管理员（属于 `ADMIN_USER_IDS`）可发送 `/companion` 命令：

```text
/companion status               # 查看当前频道的暂停状态、队列积压统计、当前人设版本与未确认消息
/companion pause                # 紧急暂停：停止当前频道的插话、主动发言与新消息出库
/companion resume               # 恢复运行：解除暂停状态
/companion retry reply:<事件ID>  # 人工重试处于 uncertain 状态的待发消息
```

> [!WARNING]
> **手动重试前务必核对频道**：执行 `/companion retry` 前，管理员必须**亲自打开 Slack 对应频道/线程确认该回复是否确实未发出**。若消息其实已经发出，手动重试将导致在群内重复补发一条！

---

## 🩺 故障排查与恢复矩阵

| 故障现象 | 数据库特征 | 触发原因 | 诊断与解决步骤 |
|---|---|---|---|
| **消息卡死不回应** | `inbox.status = 'dead'` | 连续 5 次执行异常（如模型 429 耗尽、无效 JSON 返回） | 1. 查询数据库：`SELECT error FROM inbox WHERE status='dead';`<br>2. 修复配置或网络问题；<br>3. 需重新处理该消息时由管理员重新建立事件。 |
| **消息发送状态未知** | `outbox.status = 'uncertain'` | 发送瞬间网络抖动、Slack 接口超时或服务进程被强杀 | 1. 系统正在只读对账；<br>2. 若长时间未转为 `sent`，人工核对 Slack 频道；<br>3. 若确未发送，执行 `/companion retry <outbox-id>`。 |
| **启动报错进程已锁** | `owner.lock` 报 `Data directory already owned` | 上次服务异常崩溃残留锁，或后台仍有隐藏实例在跑 | 1. 检查是否存在僵尸进程：`ps aux \| grep bun`；<br>2. 确认无其他进程读写该目录后，手动删除 `data/owner.lock`。 |
| **插件请求报错拒绝** | 日志提示 `URL outside configured HTTPS host allowlist` | 模型试图请求未放行的域名，或尝试非 HTTPS/内网端口 | 检查 `NETWORK_HOSTS` 是否包含该目标公网域名；系统禁止内网与明文 HTTP。 |
| **全员艾特被改写** | 发出的消息中出现 `"大家"` 而非 `@channel` | 模型输出了全员通知语法 | **正常安全防御**：系统强制中和全员提醒，无需干预。 |

---

## 🔒 数据位置、隐私保护与完整删除

### 1. 本地数据物理分布

```text
data/
├── companion.sqlite       # 应用核心数据库（收发件箱、关系记忆、成长日志、插件配方）
├── companion.sqlite-wal   # SQLite WAL 预写日志
├── companion.sqlite-shm   # SQLite 共享内存文件
├── owner.lock             # 单实例运行互斥锁
└── pi/                    # Pi Durable 会话历史根目录
    └── .../*.jsonl        # 经过 fsync 严格刷盘的长期会话追加日志与检查点
```

### 2. 成员退出命令与已知边界

群成员在群聊中发送 `/companion forget-me` 时：
- **系统立即执行的操作**：在 SQLite 事务中物理删除该成员的所有原始历史消息、待办收件箱任务、待发回复，以及所有频道内的个性化记忆档案；并在 KV 中永久记录 `forgotten:<team>:<user>` 拦截标记。
- **已知技术限制（重要）**：
  > [!IMPORTANT]
  > Pi Durable 存储引擎采用**不可变追加写入（Append-only JSONL）**归档。已经归档入历史对话的上下文无法做精准物理行擦除。因此本版**不向用户承诺密码学或法律层面的“绝对被遗忘”**。

### 3. 全量数据销毁流程（完全重置）

如需彻底清除机器人的全部历史记忆、人设与插件，执行破坏性全量擦除：

```bash
# 1. 必须首先彻底停止服务容器或进程
docker compose down

# 2. 彻底删除整个数据目录（包含 WAL、历史与 Pi 会话）
sudo rm -rf data/

# 3. 重新创建空目录并赋权
mkdir -p data && sudo chown -R 1000:1000 data

# 4. 重新启动（将从初始状态重新生成人设）
docker compose up -d
```

---

## 💾 备份与升级标准

### 1. 冷备份标准步骤
1. **停止进程**：绝不要在程序运行写入中直接拷贝正在更新的文件；
2. **完整打包**：备份必须**连同 `companion.sqlite`、`-wal`、`-shm` 以及 `pi/` 目录一同复制**，保证应用状态与大模型会话状态处于同一个静止时间点；
3. **独立恢复演练**：在新测试机上解压到空目录，启动单测验证会话连续性。

### 2. 依赖升级守则
Pi Durable、Chord 与 Bolt SDK 属于实验性或核心集成库：
- 升级前务必执行 `npm run typecheck`、`npm run test:node` 与 `bun test`；
- 本版暂未集成跨大版本的数据迁移自动化框架（Migration Tooling），升级依赖若涉及底层存储结构变更，必须在备份环境完成回归验收方可上线。
