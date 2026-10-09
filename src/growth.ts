import type { Store, Persona } from "./store.ts";
export interface Change { evidenceId:string;reason:string;trait:"playfulness"|"curiosity"|"warmth";delta:number;interest:string; }
export function grow(store:Store,change:Change,taskId:number,date:string,channel:string,now=Date.now()) {
  if(!Number.isFinite(change.delta)||Math.abs(change.delta)>0.02)throw new Error("Growth step exceeds bound");
  return store.db.transaction(()=>{
    if(store.get(`growth-day:${date}`))return false;
    const persona=store.get<Persona>("persona");if(!persona)throw new Error("Missing persona");
    persona.traits[change.trait]=Math.max(0.15,Math.min(0.85,(persona.traits[change.trait]??0.5)+change.delta));
    if(change.interest)persona.interests=[...new Set([...persona.interests,change.interest])].slice(-12);
    persona.version++;store.set("persona",persona);store.set(`growth-day:${date}`,true);
    store.db.query("INSERT OR IGNORE INTO growth VALUES(?,?,?)").run(String(taskId),JSON.stringify({...change,channel,date,version:persona.version}),now);
    return true;
  })();
}
