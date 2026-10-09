import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { Store, type Event } from "../src/store.ts";
import { config, quiet } from "../src/config.ts";
import { eligible, parseDecision } from "../src/policy.ts";
import { Worker } from "../src/worker.ts";
import { Network } from "../src/network.ts";
import { Plugins } from "../src/plugins.ts";
import { createRegistry, Harness } from "@earendil-works/pi-durable";
import { openNodeJsonlStorage } from "@earendil-works/pi-durable/storage/jsonl/node";
import { BACKGROUND_CONTEXT as ctx } from "@earendil-works/chord/context";
import { createModels } from "@earendil-works/pi-ai/models";
import { grow } from "../src/growth.ts";

const tmpdir=()=>join(process.cwd(),"data","tests");
mkdirSync(tmpdir(),{recursive:true});

const cfg=config({CHANNEL_IDS:"C1,C2",QUIET_START:"0",QUIET_END:"0",NETWORK_HOSTS:"hacker-news.firebaseio.com",AMBIENT_COOLDOWN_SECONDS:"90"});
const event=(id:string,channel="C1",thread?:string):Event=>({id,team:"T1",channel,user:"U1",ts:String(Number(id.replace(/\D/g,""))||1),text:"今天有点累",direct:false,kind:"message",thread});
function fixture(){const dir=mkdtempSync(join(tmpdir(),"companion-"));const store=new Store(dir);return {dir,store,dispose:()=>{store.close();rmSync(dir,{recursive:true,force:true});}};}
const slack=()=>({chat:{postMessage:async()=>({ok:true,ts:"123"})},conversations:{history:async()=>({ok:true,messages:[]}),replies:async()=>({ok:true,messages:[]})}});

test("message dedup, lane order, backoff and restart recovery",()=>{
  const f=fixture();try{
    assert.equal(f.store.accept(event("1"),100),true);assert.equal(f.store.accept(event("1"),100),false);
    f.store.accept(event("2"),100);f.store.accept(event("3","C2"),100);
    assert.deepEqual(f.store.next(100).map(x=>x.id),["1","3"]);
    f.store.claim("1");assert.deepEqual(f.store.next(100).map(x=>x.id),["3"]);
    f.store.close();const reopened=new Store(f.dir);assert.equal(reopened.next(100)[0].id,"1");
    reopened.fail(reopened.next(100)[0],"network",100);assert.deepEqual(reopened.next(101).map(x=>x.id),["3"]);reopened.close();
  }finally{rmSync(f.dir,{recursive:true,force:true});}
});
test("context never includes future turns or another channel/thread",()=>{
  const f=fixture();try{
    for(const e of [event("1"),event("2","C1","1"),event("3","C1","other"),event("4","C2"),event("5")])f.store.accept(e);
    assert.deepEqual(f.store.context(event("2","C1","1")).map(x=>(x as {ts:string}).ts),["1","2"]);
  }finally{f.dispose();}
});
test("cooldown, pause and overnight quiet hours",()=>{
  const f=fixture();try{
    assert.equal(eligible(event("1"),f.store,cfg),true);
    f.store.enqueue(event("1"),"笑死");assert.equal(eligible(event("2"),f.store,cfg),false);
    assert.equal(eligible({...event("2"),direct:true},f.store,cfg),true);
    f.store.set("paused:C1",true);assert.equal(eligible({...event("2"),direct:true},f.store,cfg),false);
    const night=config({TIMEZONE:"Asia/Taipei"});assert.equal(quiet(Date.parse("2026-10-09T16:00:00Z"),night),true);
    assert.equal(quiet(Date.parse("2026-10-09T06:00:00Z"),night),false);
  }finally{f.dispose();}
});
test("malformed decisions rejected; mass notifications neutralized",()=>{
  assert.throws(()=>parseDecision('{"action":"reply","text":""}'));
  assert.throws(()=>parseDecision('{"action":"delete"}'));
  assert.equal(parseDecision('```json\n{"action":"reply","text":"<!channel> 哈哈"}\n```').text,"大家 哈哈");
});
test("independent lanes execute concurrently; one lane never overlaps",async()=>{
  const f=fixture();let active=0,max=0;let release!:()=>void;const gate=new Promise<void>(r=>release=r);
  try{
    f.store.accept({...event("1"),direct:true});f.store.accept({...event("2"),direct:true});f.store.accept({...event("3","C2"),direct:true});
    const worker=new Worker(f.store,cfg,{decide:async()=>{max=Math.max(max,++active);await gate;active--;return '{"action":"reply","text":"嗯？"}';}},slack() as never);
    await worker.tick();await worker.tick();assert.equal(max,2);release();await worker.drain();
    await worker.tick();await worker.drain();assert.equal((f.store.db.query("SELECT COUNT(*) AS n FROM outbox").get() as {n:number}).n,3);
  }finally{f.dispose();}
});
test("uncertain send survives restart and reconciles without duplicate",async()=>{
  const f=fixture();let calls=0;const s=slack();s.chat.postMessage=async()=>{calls++;throw new Error("connection lost after commit");};
  try{
    f.store.enqueue(event("1"),"你好");let worker=new Worker(f.store,cfg,{decide:async()=>""},s as never);
    await worker.deliver();await worker.deliver();assert.equal(calls,1);
    f.store.close();const reopened=new Store(f.dir);
    s.conversations.history=async()=>({ok:true,messages:[{ts:"42",metadata:{event_payload:{delivery_id:"reply:1"}}}]}) as never;
    worker=new Worker(reopened,cfg,{decide:async()=>""},s as never);await worker.deliver();
    assert.equal(calls,1);assert.equal((reopened.db.query("SELECT status FROM outbox").get() as {status:string}).status,"sent");reopened.close();
  }finally{rmSync(f.dir,{recursive:true,force:true});}
});
test("proactive schedule persists daily budget and skips paused channels",()=>{
  const f=fixture();try{
    const worker=new Worker(f.store,cfg,{decide:async()=>""},slack() as never);
    f.store.set("paused:C2",true);const now=Date.parse("2026-10-09T06:00:00Z");worker.schedule("T1",now);worker.schedule("T1",now);
    assert.equal(f.store.next(now).length,1);assert.equal(f.store.get("proactive-count:C1:2026-10-09"),1);
  }finally{f.dispose();}
});
test("opt-out clears application memory across channels",()=>{
  const f=fixture();try{
    f.store.accept(event("1"));f.store.remember(event("1"),"喜欢猫","轻松");f.store.forget("T1","U1");
    f.store.remember(event("1"),"another note","friendly");assert.equal(f.store.db.query("SELECT * FROM members").all().length,0);
    assert.equal(f.store.context(event("1")).length,0);assert.equal(f.store.get("forgotten:T1:U1"),true);
  }finally{f.dispose();}
});
test("plugins reject host escape, credentials and prototype selectors",()=>{
  const f=fixture();try{
    const plugin=new Plugins(f.store,createRegistry(),new Network(cfg.hosts),cfg.hosts);
    const r={name:"custom_news",description:"news",url:"https://hacker-news.firebaseio.com/v0/topstories.json",select:"",version:1};
    assert.doesNotThrow(()=>plugin.validate(r));
    for(const url of ["http://hacker-news.firebaseio.com/x","https://127.0.0.1/x","https://hacker-news.firebaseio.com.evil.example/x","https://user@hacker-news.firebaseio.com/x"])assert.throws(()=>plugin.validate({...r,url}));
    assert.throws(()=>plugin.validate({...r,select:"__proto__.x"}));
  }finally{f.dispose();}
});
test("real Pi JSONL storage works on available JS runtime and retains conversation across reopen",async()=>{
  const dir=mkdtempSync(join(tmpdir(),"pi-companion-"));try{
    const opts={models:createModels(),registry:createRegistry()};
    let h=await Harness.open(await openNodeJsonlStorage(dir,ctx,{fsync:true}),opts,ctx);
    const c=await h.createConversation({ownership:{kind:"ownerless"}},ctx);
    const submission=await c.submit({type:"write",entry:{kind:"app.test",data:{text:"persisted"}},requestId:"write-once"},ctx);
    assert.equal((await submission.wait(ctx)).status,"done");const id=c.id;const first=submission.id;await h.close(ctx);
    h=await Harness.open(await openNodeJsonlStorage(dir,ctx,{fsync:true}),opts,ctx);h.resume();
    const restored=await h.conversation(id,ctx);assert.ok(restored);
    const second=await restored.submit({type:"write",entry:{kind:"app.test",data:{text:"persisted"}},requestId:"write-once"},ctx);
    assert.equal(second.id,first);await h.close(ctx);
  }finally{rmSync(dir,{recursive:true,force:true});}
});

test("growth is daily, replay-safe, bounded, and preserves core identity",()=>{
  const f=fixture();try{
    f.store.set("persona",{name:"小澪",core:"好奇但有分寸",traits:{warmth:0.84},interests:["科学"],version:1});
    const change={evidenceId:"slack:T:C:1",reason:"群友讨论天文",trait:"warmth" as const,delta:0.02,interest:"天文"};
    assert.equal(grow(f.store,change,1,"2026-10-09","C"),true);
    assert.equal(grow(f.store,change,1,"2026-10-09","C"),false);
    assert.equal(grow(f.store,change,2,"2026-10-09","C2"),false);
    const p=f.store.get<{core:string;traits:{warmth:number};version:number}>("persona")!;
    assert.equal(p.core,"好奇但有分寸");assert.equal(p.traits.warmth,0.85);assert.equal(p.version,2);
    assert.throws(()=>grow(f.store,{...change,delta:0.1},3,"2026-10-10","C"));
  }finally{f.dispose();}
});
test("autonomous recipe persists, is idempotent, and hot-loads after restart",async()=>{
  const f=fixture();let calls=0;
  const net={json:async()=>{calls++;return {ok:true};}} as unknown as Network;
  const input={name:"custom_example",description:"Read example",url:"https://hacker-news.firebaseio.com/v0/topstories.json",select:""};
  try{
    const first=new Plugins(f.store,createRegistry(),net,cfg.hosts);
    assert.equal((await first.create(input)).version,1);assert.equal((await first.create(input)).version,1);assert.equal(calls,1);
    assert.equal((await first.create({...input,description:"Updated description"})).version,2);
    const reopened=new Plugins(f.store,createRegistry(),net,cfg.hosts);assert.doesNotThrow(()=>reopened.load());
    assert.equal((f.store.db.query("SELECT COUNT(*) AS n FROM plugins").get() as {n:number}).n,1);
  }finally{f.dispose();}
});
