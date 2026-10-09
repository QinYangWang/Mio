# 贡献与提交规范

## 开始工作

先阅读 [AGENTS.md](AGENTS.md) 和 [README.md](README.md)，检查工作区状态与远程分支，明确本次修改范围。生产运行使用 Bun；Node 24 兼容层用于受限环境测试。不要在普通维护中替换 Slack 官方 SDK 或 Pi Durable。

较大的功能和多人协作用独立分支：`feat/<topic>`、`fix/<topic>`、`docs/<topic>` 或 `chore/<topic>`。用户已明确授权的小范围维护可以提交到 main。不要强推已发布历史，也不要将无关修改一起提交。

## 提交格式

使用 Conventional Commits：

```text
type(scope): 简洁说明变更

可选正文：问题原因、最终行为、验证与必要限制。

可选脚注：BREAKING CHANGE: 不兼容行为及迁移方式
```

scope 可省略。type 使用下表之一，标题不超过 100 个字符，描述必须非空；中文、英文均可，保持同一提交内部一致。

| type | 用途 |
|---|---|
| feat | 新增用户可见能力 |
| fix | 修正错误行为 |
| docs | 仅修改文档 |
| refactor | 不改变外部行为的代码整理 |
| test | 添加或调整测试 |
| perf | 性能改进 |
| build | 构建、依赖或打包变更 |
| ci | 持续集成配置 |
| chore | 项目维护、元数据与工具配置 |
| revert | 撤销先前改动 |

例如 `feat(memory): 支持成员纠正偏好`、`fix(outbox): 保留发送结果不确定状态`、`chore(repo): 统一 Mio 命名与协作规范`。不兼容变更可写 `feat(storage)!: 升级消息存储格式`，正文必须说明迁移和回退。一次提交只包含一个逻辑目标；历史初始化提交保留原样，新规范从后续提交开始。

## 本地检查

仓库提供不增加依赖的提交消息校验器，按需启用：

```bash
npm run hooks:install
```

这只修改当前仓库的 core.hooksPath。已有自定义 hook 时先手动整合，避免覆盖。取消时执行 `git config --local --unset core.hooksPath`；如之前有自定义值，应恢复原值。hook 检查标题格式，不验证代码正确性，也不会自动安装或改变远程仓库规则。

```bash
npm run typecheck
npm run test:node
bun test
git diff --check
```

运行时修改执行类型检查与相关测试；修改队列、存储、插件或发送行为时覆盖重放、并发和故障恢复。仅修改文档可检查链接、命令、路径与空白格式，无需机械运行全部测试。package.json 的依赖或包名变化要同步 package-lock.json，不生成第二份权威锁文件。

Bun 无法执行时，可以报告 Node 测试结果并保留 Bun 未验证的说明。真实 Slack、模型、热点接口和 Docker 构建分别报告，不用模拟测试代替。不要为了测试真实 API 把密钥或用户聊天内容放进仓库。

## PR 与文档维护

PR 标题沿用提交格式，说明实际问题、修改后的行为和验证结果。有迁移、权限、成本或兼容性影响时补充具体处理方式。仓库提供 PR 模板，可删去不适用项。

README 维护项目入口与安装说明，docs/product.md 维护需求落实，docs/architecture.md 维护可靠性语义，docs/evolution.md 维护学习与扩展边界，docs/operations.md 维护配置与运维步骤。新验证结果改变已知结论时更新 docs/validation.md。

GitHub 仓库名为 **Mio**，npm 包名为 **mio**，中文名为 **澪**。Slack 中已有的显示名、人设与 /companion 命令允许保持兼容；品牌调整不应意外重置存储或改变用户的管理入口。
