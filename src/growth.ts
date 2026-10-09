import type { Store, Persona } from "./store.ts";
export interface Change { evidenceId:string;reason:string;trait:"playfulness"|"curiosity"|"warmth";delta:number;interest:string; }
export function grow(store:Store,change:Change,taskId:number,date:string,channel:string,now=Date.now(),relaxLimits=false) {
  const maxDelta = relaxLimits ? 0.1 : 0.02;
  if(!Number.isFinite(change.delta)||Math.abs(change.delta)>maxDelta)throw new Error("Growth step exceeds bound");
  return store.db.transaction(()=>{
    if(!relaxLimits && store.get(`growth-day:${date}`))return false;
    const persona=store.get<Persona>("persona");if(!persona)throw new Error("Missing persona");
    const minTrait = relaxLimits ? 0.05 : 0.15;
    const maxTrait = relaxLimits ? 0.95 : 0.85;
    persona.traits[change.trait]=Math.max(minTrait,Math.min(maxTrait,(persona.traits[change.trait]??0.5)+change.delta));
    if(change.interest)persona.interests=[...new Set([...persona.interests,change.interest])].slice(relaxLimits ? -30 : -12);
    persona.version++;store.set("persona",persona);store.set(`growth-day:${date}`,true);
    store.db.query("INSERT OR IGNORE INTO growth VALUES(?,?,?)").run(String(taskId),JSON.stringify({...change,channel,date,version:persona.version}),now);
    return true;
  })();
}
