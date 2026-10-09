import { resolve } from "node:path";
import { readFileSync, existsSync } from "node:fs";

export function config(env = process.env) {
  const list = (key: string) => (env[key] ?? "").split(",").map(s => s.trim()).filter(Boolean);
  const n = (key: string, fallback: number, min = 0, max = 100000) => {
    const value = Number(env[key] ?? fallback);
    if (!Number.isFinite(value) || value < min || value > max) throw new Error(`Invalid ${key}`);
    return value;
  };
  const zone = env.TIMEZONE ?? "Asia/Taipei";
  new Intl.DateTimeFormat("en", { timeZone: zone }).format();

  const relax = env.RELAX_LIMITS === "true" || env.RELAX_LIMITS === "1";

  // Read persona seed from markdown file if available
  let seed = env.PERSONA_SEED ?? "";
  const seedFile = env.PERSONA_SEED_FILE ?? "config/persona_seed.md";
  if (existsSync(seedFile)) {
    try {
      const content = readFileSync(seedFile, "utf-8").trim();
      if (content) seed = content;
    } catch {
      // Fallback to PERSONA_SEED if reading file fails
    }
  }

  const model = env.MODEL_ID ?? (relax ? "antigravity/gemini-3.8-flash" : "gpt-6-sol");
  const isMagpieModel = model.startsWith("antigravity/") || model.startsWith("codex/");
  const baseUrl = env.OPENAI_BASE_URL ?? env.MAGPIE_BASE_URL ?? (isMagpieModel ? "http://127.0.0.1:3425/v1" : "");
  const provider = env.MODEL_PROVIDER ?? (baseUrl.includes("127.0.0.1:3425") || isMagpieModel ? "magpie" : "openai");

  return {
    token: env.SLACK_BOT_TOKEN ?? "", appToken: env.SLACK_APP_TOKEN ?? "",
    model, name: env.BOT_NAME ?? "小澪", seed,
    channels: list("CHANNEL_IDS"), admins: list("ADMIN_USER_IDS"),
    hosts: list("NETWORK_HOSTS"), dir: resolve(env.DATA_DIR ?? "./data"), zone,
    quietStart: n("QUIET_START", relax ? 0 : 23, 0, 23),
    quietEnd: n("QUIET_END", relax ? 0 : 8, 0, 23),
    interval: n("PROACTIVE_INTERVAL_MINUTES", relax ? 5 : 180, 1) * 60000,
    dailyLimit: n("DAILY_PROACTIVE_LIMIT", relax ? 50 : 2, 0, 1000),
    cooldown: n("AMBIENT_COOLDOWN_SECONDS", relax ? 0 : 90, 0) * 1000,
    concurrency: n("MAX_CONCURRENT_LANES", relax ? 8 : 4, 1, 32),
    relaxLimits: relax,
    baseUrl,
    apiKey: env.OPENAI_API_KEY || "magpie",
    provider,
    maxReplyLength: relax ? 10000 : 1800
  };
}
export type Config = ReturnType<typeof config>;
export function quiet(now: number, cfg: Config) {
  if (cfg.relaxLimits) return false;
  const hour = Number(new Intl.DateTimeFormat("en-GB",{hour:"2-digit",hourCycle:"h23",timeZone:cfg.zone}).format(now));
  return cfg.quietStart === cfg.quietEnd ? false : cfg.quietStart < cfg.quietEnd
    ? hour >= cfg.quietStart && hour < cfg.quietEnd : hour >= cfg.quietStart || hour < cfg.quietEnd;
}
export function day(now: number, zone: string) {
  return new Intl.DateTimeFormat("en-CA",{timeZone:zone,year:"numeric",month:"2-digit",day:"2-digit"}).format(now);
}
