import { Database } from "./sqlite.ts";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
export interface Event {
  id: string; team: string; channel: string; user: string; ts: string;
  thread?: string; text: string; direct: boolean; kind: "message" | "proactive";
}
export interface Job { id: string; lane: string; payload: string; attempts: number; }
export interface Persona { name: string; core: string; traits: Record<string,number>; interests: string[]; version: number; }
export class Store {
  db: Database;
  constructor(dir: string) {
    mkdirSync(dir,{recursive:true});
    this.db = new Database(join(dir,"companion.sqlite"));
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;
      CREATE TABLE IF NOT EXISTS inbox(id TEXT PRIMARY KEY,lane TEXT,payload TEXT,status TEXT,attempts INTEGER DEFAULT 0,due INTEGER,error TEXT);
      CREATE TABLE IF NOT EXISTS messages(id TEXT PRIMARY KEY,team TEXT,channel TEXT,lane TEXT,user TEXT,ts TEXT,text TEXT,created INTEGER);
      CREATE INDEX IF NOT EXISTS messages_lane ON messages(lane,created);
      CREATE TABLE IF NOT EXISTS kv(key TEXT PRIMARY KEY,value TEXT);
      CREATE TABLE IF NOT EXISTS members(key TEXT PRIMARY KEY,value TEXT);
      CREATE TABLE IF NOT EXISTS growth(id TEXT PRIMARY KEY,value TEXT,created INTEGER);
      CREATE TABLE IF NOT EXISTS outbox(id TEXT PRIMARY KEY,lane TEXT,channel TEXT,thread TEXT,text TEXT,status TEXT,ts TEXT,created INTEGER,error TEXT,proactive INTEGER);
      CREATE TABLE IF NOT EXISTS plugins(name TEXT PRIMARY KEY,value TEXT);
    `);
    // One process owns the database. A prior process cannot still hold these jobs.
    this.db.exec("UPDATE inbox SET status='pending' WHERE status='running'; UPDATE outbox SET status='uncertain' WHERE status='sending';");
  }
  get<T>(key: string): T | undefined {
    const row = this.db.query("SELECT value FROM kv WHERE key=?").get(key) as {value:string}|null;
    return row ? JSON.parse(row.value) : undefined;
  }
  set(key: string,value: unknown) { this.db.query("INSERT OR REPLACE INTO kv VALUES(?,?)").run(key,JSON.stringify(value)); }
  lane(e: Event) { return `${e.team}:${e.channel}:${e.thread ?? "main"}`; }
  accept(e: Event, now=Date.now()) {
    return this.db.transaction(() => {
      const lane = this.lane(e);
      const inserted = this.db.query("INSERT OR IGNORE INTO inbox(id,lane,payload,status,due) VALUES(?,?,?,'pending',?)").run(e.id,lane,JSON.stringify(e),now);
      if (!inserted.changes) return false;
      if (e.kind === "message") this.db.query("INSERT OR IGNORE INTO messages VALUES(?,?,?,?,?,?,?,?)").run(e.id,e.team,e.channel,lane,e.user,e.ts,e.text,now);
      return true;
    })();
  }
  next(now=Date.now()): Job[] {
    // Strict ordering within each lane, including backoff on an earlier event.
    return this.db.query(`SELECT i.id,i.lane,i.payload,i.attempts FROM inbox i WHERE i.status='pending' AND i.due<=?
      AND NOT EXISTS(SELECT 1 FROM inbox p WHERE p.lane=i.lane AND p.status IN ('pending','running') AND p.rowid<i.rowid)
      ORDER BY i.rowid LIMIT 100`).all(now) as unknown as Job[];
  }
  claim(id: string) { return !!this.db.query("UPDATE inbox SET status='running' WHERE id=? AND status='pending'").run(id).changes; }
  done(id: string) { this.db.query("UPDATE inbox SET status='done',error=NULL WHERE id=?").run(id); }
  fail(job: Job,error: unknown,now=Date.now()) {
    const attempts=job.attempts+1;
    this.db.query("UPDATE inbox SET status=?,attempts=?,due=?,error=? WHERE id=?").run(attempts>=5?"dead":"pending",attempts,now+Math.min(300000,1000*2**attempts),String(error).slice(0,200),job.id);
  }
  context(e: Event) {
    return this.db.query(`SELECT user,ts,text FROM messages WHERE team=? AND channel=? AND (lane=? OR lane=?) AND CAST(ts AS REAL)<=CAST(? AS REAL) ORDER BY CAST(ts AS REAL) DESC LIMIT 35`)
      .all(e.team,e.channel,this.lane(e),`${e.team}:${e.channel}:main`,e.ts).reverse();
  }
  relation(team: string,channel: string,user: string): Record<string,unknown> {
    const row=this.db.query("SELECT value FROM members WHERE key=?").get(`${team}:${channel}:${user}`) as {value:string}|null;
    return row?JSON.parse(row.value):{familiarity:0,tone:"尚不熟悉",notes:[]};
  }
  remember(e: Event, note: string, tone: string) {
    if (this.get<boolean>(`forgotten:${e.team}:${e.user}`)) return;
    const key=`${e.team}:${e.channel}:${e.user}`;
    const old=this.relation(e.team,e.channel,e.user);
    const value={familiarity:Math.min(1,Number(old.familiarity)+0.01),tone:tone.slice(0,100),notes:[...(old.notes as string[]),note.slice(0,300)].slice(-12)};
    this.db.query("INSERT OR REPLACE INTO members VALUES(?,?)").run(key,JSON.stringify(value));
  }
  forget(team:string,user:string) {
    this.db.transaction(()=>{
      this.db.query("DELETE FROM messages WHERE team=? AND user=?").run(team,user);
      const jobs=this.db.query("SELECT id FROM inbox WHERE json_extract(payload,'$.team')=? AND json_extract(payload,'$.user')=?").all(team,user) as {id:string}[];
      for(const {id} of jobs) this.db.query("DELETE FROM outbox WHERE id=? AND status='pending'").run(`reply:${id}`);
      this.db.query("DELETE FROM inbox WHERE json_extract(payload,'$.team')=? AND json_extract(payload,'$.user')=?").run(team,user);
      const keys=this.db.query("SELECT key FROM members").all() as {key:string}[];
      for(const {key} of keys) if(key.startsWith(`${team}:`)&&key.endsWith(`:${user}`)) this.db.query("DELETE FROM members WHERE key=?").run(key);
      this.set(`forgotten:${team}:${user}`,true);
    })();
  }
  enqueue(e: Event,text: string) {
    const id=`reply:${e.id}`;
    this.db.query("INSERT OR IGNORE INTO outbox VALUES(?,?,?,?,?,'pending',NULL,?,NULL,?)").run(id,this.lane(e),e.channel,e.thread??null,text,Date.now(),Number(e.kind==="proactive"));
    return id;
  }
  sentRecently(channel:string,since:number,proactive=false) {
    const row=this.db.query(`SELECT COUNT(*) AS n FROM outbox WHERE channel=? AND created>=? AND status IN ('pending','sending','sent','uncertain') ${proactive?"AND proactive=1":""}`).get(channel,since) as {n:number};
    return row.n;
  }
  close() { this.db.close(); }
}
