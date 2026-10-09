// Polyfill undici.ping for Bun runtime compatibility with @slack/socket-mode
try {
  const undici = require("undici");
  if (!undici.ping) {
    const { channel } = require("node:diagnostics_channel");
    const pongChannel = channel("undici:websocket:pong");
    Object.defineProperty(undici, "ping", {
      value: (ws: any, data: any) => {
        try {
          ws?.ping?.(data);
          // In Bun, native WebSocket handles pong at network level without emitting
          // Node undici diagnostics_channel events. Notify pongChannel to prevent timeouts.
          pongChannel.publish({ websocket: ws, payload: Buffer.alloc(0) });
        } catch {}
      },
      writable: true,
      configurable: true
    });
  }
} catch {}

import { App } from "@slack/bolt";
import { mkdirSync, openSync, closeSync, unlinkSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { config } from "./config.ts";
import { Store } from "./store.ts";
import { Agent } from "./agent.ts";
import { Network } from "./network.ts";
import { Worker } from "./worker.ts";

const cfg=config();
if(!cfg.token||!cfg.appToken||(!process.env.OPENAI_API_KEY && cfg.provider !== "magpie")||!cfg.channels.length) throw new Error("Set Slack tokens, OPENAI_API_KEY (or use magpie) and CHANNEL_IDS in .env");
mkdirSync(cfg.dir,{recursive:true});
// Pi's storage needs a single owner. Atomic lock creation, stale PID recovery.
const lock=join(cfg.dir,"owner.lock");
function acquire() {
  try { const fd=openSync(lock,"wx");writeFileSync(fd,String(process.pid));closeSync(fd); }
  catch(error) {
    if((error as NodeJS.ErrnoException).code!=="EEXIST")throw error;
    const pid=Number(readFileSync(lock,"utf8"));
    if(!Number.isSafeInteger(pid)||pid<=0) throw new Error("Invalid owner.lock: inspect manually");
    try{process.kill(pid,0);throw new Error("Data directory already owned by a live process");}
    catch(e){if((e as NodeJS.ErrnoException).code!=="ESRCH")throw e;unlinkSync(lock);acquire();}
  }
}
acquire();
const store=new Store(cfg.dir);const agent=new Agent(store,cfg,new Network(cfg.hosts,cfg.relaxLimits));
const app=new App({token:cfg.token,appToken:cfg.appToken,socketMode:true,clientOptions:{retryConfig:{retries:0},rejectRateLimitedCalls:true}});
let timer:ReturnType<typeof setInterval>|undefined;let shutting=false;let worker:Worker|undefined;
async function shutdown() {
  if(shutting)return;shutting=true;if(timer)clearInterval(timer);
  await app.stop().catch(()=>{});await worker?.stop();await agent.close();store.close();
  unlinkSync(lock);
}
process.once("SIGTERM",()=>void shutdown().then(()=>process.exit(0)));
process.once("SIGINT",()=>void shutdown().then(()=>process.exit(0)));
try {
  const identity=await app.client.auth.test();if(!identity.user_id||!identity.team_id)throw new Error("No Slack bot identity");
  const team=identity.team_id;const bot=identity.user_id;
  await agent.open();worker=new Worker(store,cfg,agent,app.client);
  const ingest=async({event,body}: {event:unknown;body:unknown})=>{
    const e=event as Record<string,unknown>;const b=body as Record<string,unknown>;
    if(e.subtype||e.bot_id||!e.user||e.user===bot||typeof e.text!=="string"||typeof e.channel!=="string"||typeof e.ts!=="string")return;
    const channelAllowed = cfg.channels.includes("*") || cfg.channels.includes(e.channel);
    if(!channelAllowed||store.get(`forgotten:${team}:${e.user}`))return;
    // message + app_mention may both describe the same message: one canonical ID.
    const id=`slack:${b.team_id??team}:${e.channel}:${e.ts}`;
    store.accept({id,team,channel:e.channel,user:String(e.user),ts:e.ts,thread:typeof e.thread_ts==="string"?e.thread_ts:undefined,text:e.text.slice(0,12000),direct:e.text.includes(`<@${bot}>`)||String(e.channel_type)==="im",kind:"message"});
  };
  app.event("message",ingest);app.event("app_mention",ingest);
  app.command("/companion",async({command,ack,respond})=>{
    await ack();const [action,id]=command.text.trim().split(/\s+/);
    if(action==="forget-me"){
      store.forget(team,command.user_id);
      await respond({response_type:"ephemeral",text:"已清除应用层的成员记忆和原始消息，并停止处理你后续的消息。既有 Pi 会话归档仍可能保留内容，完整删除请联系管理员按数据文档操作。"});return;
    }
    const adminAllowed = cfg.admins.includes(command.user_id) || (cfg.relaxLimits && !cfg.admins.length);
    const channelAllowed = cfg.channels.includes("*") || cfg.channels.includes(command.channel_id);
    if(!adminAllowed||!channelAllowed) {await respond("仅配置的管理员可在启用频道管理她。");return;}
    if(action==="pause"||action==="resume")store.set(`paused:${command.channel_id}`,action==="pause");
    if(action==="retry"&&id){store.db.query("UPDATE outbox SET status='pending' WHERE id=? AND channel=? AND status='uncertain'").run(id,command.channel_id);}
    const stats=store.db.query("SELECT status,COUNT(*) AS count FROM inbox GROUP BY status").all();
    await respond({response_type:"ephemeral",text:JSON.stringify({paused:store.get(`paused:${command.channel_id}`)??false,queue:stats,persona:store.get("persona"),uncertain:store.db.query("SELECT id FROM outbox WHERE channel=? AND status='uncertain'").all(command.channel_id)})});
  });
  let tickBusy=false;
  timer=setInterval(()=>{
    if(tickBusy||shutting)return;tickBusy=true;
    void (async()=>{worker!.schedule(team);await worker!.tick();await worker!.deliver();})()
      .catch(error=>console.error(JSON.stringify({event:"tick_failed",message:String(error).slice(0,200)})))
      .finally(()=>{tickBusy=false;});
  },1000);
  await app.start();console.log(JSON.stringify({event:"started",channels:cfg.channels,name:cfg.name,model:cfg.model,provider:cfg.provider}));
}catch(error){await shutdown();throw error;}
