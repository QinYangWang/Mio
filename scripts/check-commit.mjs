import { readFileSync } from "node:fs";

const path = process.argv[2];
if (!path) {
  console.error("Usage: node scripts/check-commit.mjs <commit-message-file>");
  process.exit(1);
}
const subject = readFileSync(path, "utf8").split(/\r?\n/)[0];
// Git-generated merge/revert messages remain usable without editing old history.
const generated = /^(Merge (?:branch |remote-tracking branch |pull request )|Revert ")/.test(subject);
const conventional = /^(feat|fix|docs|refactor|test|perf|build|ci|chore|revert)(?:\([a-z0-9][a-z0-9/_-]*\))?!?: \S.*$/.test(subject);
if ((!generated && !conventional) || [...subject].length > 100) {
  console.error("提交标题须符合 type(scope): 描述，且不超过 100 字符。例：chore(repo): 统一 Mio 命名与协作规范");
  process.exit(1);
}
