import { mkdirSync } from "node:fs";
import { Store, type Event } from "../src/store.ts";
import { config } from "../src/config.ts";
import { Worker } from "../src/worker.ts";
mkdirSync("data/demo",{recursive:true});
const store=new Store("data/demo");
const cfg=config({CHANNEL_IDS:"demo",QUIET_START:"0",QUIET_END:"0",AMBIENT_COOLDOWN_SECONDS:"0"});
const mockSlack={chat:{postMessage:async({text}:{text:string})=>{console.log(`她：${text}`);return {ok:true,ts:String(Date.now()/1000)};}},conversations:{history:async()=>({messages:[]}),replies:async()=>({messages:[]})}};
// Deterministic transport demo, explicitly not a model-generated conversation.
const worker=new Worker(store,cfg,{decide:async(e)=>JSON.stringify({action:"reply",text:e.text.includes("累")?"今天又被工作追着跑？": "这个梗我接住了 😂"})},mockSlack as never);
for(const text of ["今天上班累死了","不是我在上班，是班在上我"]){
  console.log(`群友：${text}`);const ts=String(Date.now()/1000);
  const e:Event={id:`demo:${ts}:${text}`,team:"demo",channel:"demo",user:"friend",ts,text,direct:false,kind:"message"};
  store.accept(e);await worker.tick();await worker.drain();await worker.deliver();
}
await worker.stop();store.close();
