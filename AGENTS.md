# Mio Agent Instructions

> Operational rules, architectural invariants, and development guidelines for AI assistants working in the Mio repository. Read this file and [CONTRIBUTING.md](CONTRIBUTING.md) before making modifications.

---

## 🧭 Source of Truth & Technology Stack

- **Project**: Mio (澪) — a persistent, proactive AI companion in Slack.
- **Repository**: [https://github.com/QinYangWang/Mio](https://github.com/QinYangWang/Mio)
- **Runtime Stack**: **Bun** (production runtime), **Slack Bolt SDK** (v5.1+), and **Pi Durable** (v1.1+).
  > [!IMPORTANT]
  > Do not replace, upgrade, or swap this stack as part of an unrelated change. Pi Durable APIs are experimental; always check installed declarations in `node_modules` before using.

---

## 🗺️ Code Map & Responsibilities

| Path | Primary Responsibility |
|---|---|
| `src/main.ts` | Slack Socket Mode intake, `/companion` admin commands, process lifecycle & `owner.lock` |
| `src/worker.ts` | Per-lane FIFO task scheduling, proactive topic runner, and outbox delivery pipeline |
| `src/agent.ts` | Pi conversation harness, system prompt instructions, tool registration, and decision flow |
| `src/store.ts` / `src/sqlite.ts` | SQLite schema, queue operations, relations, and cross-runtime adapter (Bun / Node) |
| `src/policy.ts` / `src/config.ts` | Speaking eligibility policies, quiet hours, cooldowns, mention suppression, and config parser |
| `src/growth.ts` | Evidence-based, bounded persona trait evolution and daily limits |
| `src/plugins.ts` / `src/network.ts` | Dynamic read-only HTTPS JSON recipe validator, SSRF defenses, and fetch client |
| `test/core.test.ts` | Persistence, concurrency, memory isolation, and failure recovery regression tests |
| `config/slack-manifest.json` | Declarative Slack app scopes, event subscriptions, and slash commands |

---

## 🛡️ Non-Negotiable Rules & System Invariants

### 1. Concurrency & Conversation Isolation
- **Lane Isolation**: All tasks are strictly partitioned by `team:channel:thread|main`.
- **FIFO within Lane**: Tasks in the same lane must execute in strict order. If a task fails and enters backoff, newer tasks in the same lane must **never** skip ahead.
- **Cross-Lane Concurrency**: Independent lanes execute concurrently up to `MAX_CONCURRENT_LANES`.

### 2. Slack Delivery & Non-Exactly-Once Reality
- **No Claim of Exactly-Once**: Slack Socket Mode transmission acks and local SQLite commits do not form a distributed atomic transaction.
- **Uncertain Deliveries**: If network drops or a crash occurs during send, status is marked `uncertain`. Reconciliation performs read-only checks via `conversations.history/replies`. If no match is found, **never automatically resend** (absence of evidence is not evidence of absence).

### 3. Data Safety & Single-Process Ownership
- **Exclusive Lock**: Only **one process** may access `DATA_DIR` at a time. Multi-instance scaling or sharing directories across machines is strictly forbidden.
- **Backward Compatibility**: Do not rename persisted keys (`forgotten:...`, `growth-day:...`, etc.) or `/companion` command names solely for branding.

### 4. Security & Untrusted Input Defenses
- **Untrusted Boundaries**: All chat messages, web content, and tool outputs are untrusted.
- **Safe Dynamic Plugins**: Plugins are **strictly read-only HTTPS JSON recipes**. Never provide or execute arbitrary host shell commands, TypeScript evaluation (`eval`), or npm installation for the agent.
- **Network Boundaries**: Enforce strict `NETWORK_HOSTS` allowlisting, reject non-HTTPS, block URL credentials, and forbid HTTP redirects (`redirect: "error"`).
- **Mention Sanitization**: Neutralize mass mentions (`<!channel>`, `<!here>`, `<!everyone>`) to `"大家"`.

---

## 🔍 Validation & Quality Standards

1. **Dependency Installation**: Always run `npm ci`. Keep `package-lock.json` synchronized with `package.json`.
2. **Runtime Code Verification**:
   ```bash
   npm run typecheck    # TypeScript strict check (must have 0 errors)
   npm run test:node     # Node 24 core persistence & regression suite (must pass 12/12)
   bun test             # Bun native runtime test suite (must pass 12/12)
   ```
3. **Documentation Verification**:
   - Check all paths, links, and command references.
   - Run `git diff --check` to ensure no whitespace or formatting anomalies.
4. **Factual Reporting**: Never report that live Slack integrations, model completions, or Docker builds succeeded unless they were physically executed in the current session.

---

## 📦 Git & Delivery Conventions

- **Conventional Commits**: Format commits as `type(scope): description`. Keep each commit focused on a single logical change.
- **Clean Diffs**: Avoid unrelated formatting rewrites. Preserve existing working code and comments.
- **Branch Management**: Use `feat/...`, `fix/...`, `docs/...`, or `chore/...` branches for feature development.
