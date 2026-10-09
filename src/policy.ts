import type { Config } from "./config.ts";
import { quiet } from "./config.ts";
import type { Event, Store } from "./store.ts";
export function eligible(e: Event,store: Store,cfg: Config,now=Date.now()) {
  if(e.user&&store.get<boolean>(`forgotten:${e.team}:${e.user}`))return false;
  const channelAllowed = cfg.channels.includes("*") || cfg.channels.includes(e.channel);
  if(!channelAllowed||store.get<boolean>(`paused:${e.channel}`)) return false;
  if(cfg.relaxLimits) return true;
  if(e.direct) return true;
  if(quiet(now,cfg)) return false;
  return !store.sentRecently(e.channel,now-cfg.cooldown);
}
export function parseDecision(raw:string,maxLen=1800) {
  const cleaned=raw.trim().replace(/^```(?:json)?\s*/,"").replace(/\s*```$/,"");
  const data=JSON.parse(cleaned);
  if(!data || !["silent","reply"].includes(data.action)) throw new Error("Invalid decision action");
  if(data.action==="reply" && (typeof data.text!=="string"||!data.text.trim()||data.text.length>maxLen)) throw new Error("Invalid reply text");
  // A generated mass mention never becomes a workspace notification.
  const text=String(data.text??"").replace(/<!(?:channel|here|everyone)>/g,"大家");
  return {action:data.action as "silent"|"reply",text};
}
