import { resolve } from "node:path";
export function config(env = process.env) {
  const list = (key: string) => (env[key] ?? "").split(",").map(s => s.trim()).filter(Boolean);
  const n = (key: string, fallback: number, min = 0, max = 100000) => {
    const value = Number(env[key] ?? fallback);
    if (!Number.isFinite(value) || value < min || value > max) throw new Error(`Invalid ${key}`);
    return value;
  };
  const zone = env.TIMEZONE ?? "Asia/Taipei";
  new Intl.DateTimeFormat("en", { timeZone: zone }).format();
  return {
    token: env.SLACK_BOT_TOKEN ?? "", appToken: env.SLACK_APP_TOKEN ?? "",
    model: env.MODEL_ID ?? "gpt-6-sol", name: env.BOT_NAME ?? "小澪", seed: env.PERSONA_SEED ?? "",
    channels: list("CHANNEL_IDS"), admins: list("ADMIN_USER_IDS"),
    hosts: list("NETWORK_HOSTS"), dir: resolve(env.DATA_DIR ?? "./data"), zone,
    quietStart: n("QUIET_START",23,0,23), quietEnd: n("QUIET_END",8,0,23),
    interval: n("PROACTIVE_INTERVAL_MINUTES",180,5) * 60000,
    dailyLimit: n("DAILY_PROACTIVE_LIMIT",2,0,20), cooldown: n("AMBIENT_COOLDOWN_SECONDS",90,0)*1000,
    concurrency: n("MAX_CONCURRENT_LANES",4,1,16)
  };
}
export type Config = ReturnType<typeof config>;
export function quiet(now: number, cfg: Config) {
  const hour = Number(new Intl.DateTimeFormat("en-GB",{hour:"2-digit",hourCycle:"h23",timeZone:cfg.zone}).format(now));
  return cfg.quietStart === cfg.quietEnd ? false : cfg.quietStart < cfg.quietEnd
    ? hour >= cfg.quietStart && hour < cfg.quietEnd : hour >= cfg.quietStart || hour < cfg.quietEnd;
}
export function day(now: number, zone: string) {
  return new Intl.DateTimeFormat("en-CA",{timeZone:zone,year:"numeric",month:"2-digit",day:"2-digit"}).format(now);
}
