# 安装、运维与数据管理

## 配置

| 变量 | 用途 |
|---|---|
| SLACK_BOT_TOKEN / SLACK_APP_TOKEN | 工作区 bot 与 Socket Mode app-level token |
| OPENAI_API_KEY / MODEL_ID | Pi OpenAI provider 的模型访问 |
| BOT_NAME / PERSONA_SEED | 首次生成的人设姓名与种子 |
| CHANNEL_IDS | 允许读取、回应和主动开场的频道列表 |
| ADMIN_USER_IDS | 管理命令允许用户；空值表示无人可管理 |
| DATA_DIR | 应用与 Pi 的同一持久化数据目录 |
| TIMEZONE | 静默时间和每日计数采用的 IANA 时区 |
| QUIET_START / QUIET_END | 小时数；相同表示关闭夜间静默 |
| AMBIENT_COOLDOWN_SECONDS | 未被直接叫到时的插话冷却 |
| PROACTIVE_INTERVAL_MINUTES | 主动尝试的最短间隔，最小 5 分钟 |
| DAILY_PROACTIVE_LIMIT | 每频道每天主动尝试次数，默认 2 |
| MAX_CONCURRENT_LANES | 并发话题数，默认 4，最大 16 |
| NETWORK_HOSTS | 工具可访问的确切 HTTPS 公网主机 |

Bun 启动会读取当前目录 .env。不要将 .env、data、日志、备份或任何聊天资料推入 GitHub。应用不会自己创建 Slack app、生成用户 token 或修改工作区设置。安装后仍需成员邀请进频道。

## 自愈与故障处理

进程意外退出后，supervisor 重启服务，恢复同一个数据卷。初始化锁若发现 PID 不存在会清理旧锁；仍存在则拒绝第二个实例。在容器重建或 PID 复用情形，人工确认没有旧实例后才清理锁。

`/companion status` 显示 inbox 状态、人设与 uncertain outbox ID，不打印密钥。dead 表示某事件连续失败 5 次；查看数据库中简短错误再定位模型权限、输出格式或接口故障。没有自动删 dead 的功能，便于检查，但需管理员定期安排保留周期。

uncertain 表示消息发送结果不明确。自动只做核对，不重复写；Slack 权限或历史分页限制可能让核对失败。管理员阅读实际频道/线程确认后，必要时使用 `/companion retry <完整outbox-id>`。暂停频道会阻止生成后的新入队及 pending 发送，但不能撤回已发送消息或已在进行的 Slack 请求。

SDK 断线恢复由 Bolt/Socket Mode 管理。模型调用由 Pi 持久化调度器接管；应用失败事件指数退避。没有外部 watchdog 或健康检查 HTTP 端点，容器存活不等于 Slack 已连接；生产应配外部告警和连接状态观察。

## 数据位置与隐私

companion.sqlite 保存消息、任务、关系、成长、插件与 outbox。pi/ 保存模型会话转录、任务检查点、模型与工具结果；转录可能包含原始消息和记忆副本。请在加入频道时明确说明她是 AI、读取范围与记忆策略，使用访问受控的数据卷和备份。

`forget-me` 删除成员应用层原始消息、待办输入、未发送回复和频道关系，并设置停止处理标记。已经发出的回复、成长日志、人设内容与不可变 Pi 转录不自动删除。即使删除应用成员记录，旧 Pi 上下文可能仍引用已存在的资料：这是当前明确限制，不应承诺完整“被遗忘”。

**完整删除**需要停止唯一服务实例，按工作区的删除政策处理两类存储。当前最可靠的全量方案是在确认备份也已按政策处理后删除整个 DATA_DIR 并重建人设；这会丢失全部群聊历史、插件、成长与任务，属于人工破坏性操作。精细到单个成员的 Pi 转录擦除、相关派生摘要清除和迁移目前未实现，不能直接编辑 append-only 归档冒险破坏存储。

退出标记目前没有自助撤销命令。如成员主动希望重新加入处理，管理员在停机维护期间清除对应 `forgotten:<team>:<user>` KV，再重启。部署前应为记忆纠错与重新参与设计明确产品入口。

## 备份与升级

备份时停止服务，将整个 DATA_DIR 连同 SQLite 的 WAL/SHM 一起复制，确保 Pi 与应用存储来自同一静止时刻。恢复到新的独占目录，保留原始副本，再验证会话与 pending/uncertain 状态。不要仅复制主 SQLite 文件而漏掉 WAL。

升级 Pi、Bolt 或 Bun 之前，在复制数据上跑类型检查、全部测试与一次真实工作区的重启演练。Pi 为实验性 API；本版没有数据迁移版本框架。发生 API 变化时必须修正适配代码，不能只提高 package.json 版本。

自托管默认没有完整成本上限。主动频率与并发有限，但频繁 @ 和长工具链仍会产生成本。正式大群部署前添加 provider 预算、调用步数限制、队列容量和运维告警。
