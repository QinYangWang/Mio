import type { WebClient } from "@slack/web-api";
import { Store, type Event, type Job } from "./store.ts";
import type { Config } from "./config.ts";
import { day, quiet } from "./config.ts";
import { eligible, parseDecision } from "./policy.ts";

export type Brain={decide(e:Event):Promise<string>};
export class Worker {
  private running=new Map<string,Promise<void>>();
  private stopped=false;
  constructor(private store:Store,private cfg:Config,private brain:Brain,private slack:Pick<WebClient,"chat"|"conversations">) {}
  async process(job:Job) {
    const e:Event=JSON.parse(job.payload);
    try {
      if(eligible(e,this.store,this.cfg)) {
        const result=parseDecision(await this.brain.decide(e),this.cfg.maxReplyLength);
        // Recheck pause and cooldown after generation; another lane may have spoken.
        if(result.action==="reply"&&eligible(e,this.store,this.cfg)) {
          const newer=this.store.db.query("SELECT COUNT(*) AS n FROM messages WHERE team=? AND channel=? AND CAST(ts AS REAL)>CAST(? AS REAL)").get(e.team,e.channel,e.ts) as {n:number};
          if(this.cfg.relaxLimits||e.direct||!newer.n) this.store.enqueue(e,result.text);
        }
      }
      this.store.done(job.id);
    }catch(error){this.store.fail(job,error);}
  }
  async tick() {
    if(this.stopped)return;
    for(const job of this.store.next()) {
      if(this.running.size>=this.cfg.concurrency)break;
      if(this.running.has(job.lane)||!this.store.claim(job.id))continue;
      const promise=this.process(job).finally(()=>this.running.delete(job.lane));
      this.running.set(job.lane,promise);
    }
  }
  async drain() {await Promise.all(this.running.values());}
  async stop(){this.stopped=true;await this.drain();}
  schedule(team:string,now=Date.now()) {
    if(quiet(now,this.cfg)) return;
    for(const channel of this.cfg.channels) {
      if(channel==="*"||this.store.get(`paused:${channel}`))continue;
      const due=this.store.get<number>(`next-proactive:${channel}`)??now;
      const key=`proactive-count:${channel}:${day(now,this.cfg.zone)}`;
      if(now<due||(this.store.get<number>(key)??0)>=this.cfg.dailyLimit)continue;
      if(!this.cfg.relaxLimits&&this.store.sentRecently(channel,now-Math.max(this.cfg.cooldown,300000)))continue;
      const pending=this.store.db.query("SELECT COUNT(*) AS n FROM inbox WHERE status IN ('pending','running') AND json_extract(payload,'$.channel')=?").get(channel) as {n:number};
      if(pending.n)continue;
      this.store.db.transaction(()=>{
        const id=`proactive:${team}:${channel}:${Math.floor(now/this.cfg.interval)}`;
        if(this.store.accept({id,team,channel,user:"",text:"",ts:String(now/1000),direct:false,kind:"proactive"},now)) {
          this.store.set(key,(this.store.get<number>(key)??0)+1);
          this.store.set(`next-proactive:${channel}`,now+this.cfg.interval);
        }
      })();
    }
  }
  async deliver() {
    const rows=this.store.db.query("SELECT * FROM outbox WHERE status IN ('pending','uncertain') ORDER BY created LIMIT 20").all() as {id:string;channel:string;thread:string|null;text:string;status:string;created:number}[];
    for(const row of rows) {
      if(this.store.get(`paused:${row.channel}`))continue;
      if(row.status==="uncertain") {
        // Read-only reconciliation. Absence is not proof that a write never happened.
        try {
          const result=row.thread?await this.slack.conversations.replies({channel:row.channel,ts:row.thread,limit:100,include_all_metadata:true}):await this.slack.conversations.history({channel:row.channel,oldest:String(row.created/1000-5),limit:100,include_all_metadata:true});
          const found=result.messages?.find(m=>(m.metadata?.event_payload as Record<string,unknown>|undefined)?.delivery_id===row.id);
          if(found?.ts)this.store.db.query("UPDATE outbox SET status='sent',ts=?,error=NULL WHERE id=?").run(found.ts,row.id);
        } catch { /* Keep uncertain for operator inspection; no duplicate resend. */ }
        continue;
      }
      if(!this.store.db.query("UPDATE outbox SET status='sending' WHERE id=? AND status='pending'").run(row.id).changes)continue;
      try {
        const result=await this.slack.chat.postMessage({channel:row.channel,thread_ts:row.thread??undefined,text:row.text,metadata:{event_type:"companion_delivery",event_payload:{delivery_id:row.id}},unfurl_links:false,unfurl_media:false});
        if(!result.ok||!result.ts)throw new Error("Unconfirmed Slack send");
        this.store.db.query("UPDATE outbox SET status='sent',ts=? WHERE id=?").run(result.ts,row.id);
      }catch(error){this.store.db.query("UPDATE outbox SET status='uncertain',error=? WHERE id=?").run(String(error).slice(0,200),row.id);}
    }
  }
}
