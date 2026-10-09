// Bun is the production runtime; Node 24 enables the same persistence tests in
// environments that cannot execute Bun's native binary.
import type { DatabaseSync, SQLInputValue } from "node:sqlite";
const NativeSQLite = typeof Bun === "undefined" ? (await import("node:sqlite")).DatabaseSync : undefined;
class NodeDatabase {
  private db:DatabaseSync;private sequence=0;
  constructor(file:string){this.db=new NativeSQLite!(file);}
  exec(sql:string){this.db.exec(sql);}
  query(sql:string){
    const statement=this.db.prepare(sql);
    return {run:(...args:SQLInputValue[])=>statement.run(...args),get:(...args:SQLInputValue[])=>statement.get(...args),all:(...args:SQLInputValue[])=>statement.all(...args)};
  }
  transaction<T>(fn:()=>T){return ()=>{
    const savepoint=`app_${++this.sequence}`;this.db.exec(`SAVEPOINT ${savepoint}`);
    try{const result=fn();this.db.exec(`RELEASE ${savepoint}`);return result;}
    catch(error){this.db.exec(`ROLLBACK TO ${savepoint}; RELEASE ${savepoint}`);throw error;}
  };}
  close(){this.db.close();}
}
export const Database:typeof NodeDatabase = typeof Bun!=="undefined"
  ? (await import("bun:sqlite")).Database as unknown as typeof NodeDatabase : NodeDatabase;
export type Database = NodeDatabase;
