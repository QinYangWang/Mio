import { Type } from "@earendil-works/pi-ai";
import { defineExtension, defineTool, type Registry } from "@earendil-works/pi-durable";
import type { Network } from "./network.ts";
import type { Store } from "./store.ts";
export interface Recipe { name:string; description:string; url:string; select:string; version:number; }
export class Plugins {
  constructor(private store:Store,private registry:Registry,private net:Network,private hosts:string[]) {}
  validate(r:Recipe) {
    if(!/^custom_[a-z][a-z0-9_]{0,35}$/.test(r.name)||typeof r.description!=="string"||r.description.length>300) throw new Error("Invalid plugin identity");
    const url=new URL(r.url.replaceAll("{query}","example"));
    if(url.protocol!=="https:"||url.port||url.username||url.password||!this.hosts.includes(url.hostname)||r.url.length>1000) throw new Error("Plugin endpoint not allowed");
    if(!/^(?:[a-zA-Z0-9_]+\.)*[a-zA-Z0-9_]*$/.test(r.select)||r.select.split(".").some(s=>["__proto__","prototype","constructor"].includes(s))) throw new Error("Invalid JSON selector");
  }
  install(r:Recipe) {
    this.validate(r);
    this.registry.install(defineExtension({name:r.name,tools:[defineTool({
      name:r.name,description:r.description,parameters:Type.Object({query:Type.String({maxLength:500})}),replay:"safe",
      execute:async({query})=>{
        let result=await this.net.json(r.url.replaceAll("{query}",encodeURIComponent(query)));
        if(r.select) for(const key of r.select.split(".")) result=result?.[key];
        return {content:[{type:"text",text:JSON.stringify(result??null).slice(0,12000)}]};
      }
    })]}));
  }
  load() {
    for(const row of this.store.db.query("SELECT value FROM plugins").all() as {value:string}[]) this.install(JSON.parse(row.value));
  }
  async create(input:Omit<Recipe,"version">) {
    const old=this.store.db.query("SELECT value FROM plugins WHERE name=?").get(input.name) as {value:string}|null;
    if(old){const prior:Recipe=JSON.parse(old.value);if(prior.description===input.description&&prior.url===input.url&&prior.select===input.select){this.install(prior);return prior;}}
    const recipe={...input,version:old?JSON.parse(old.value).version+1:1};
    this.validate(recipe);
    // Validate the endpoint before persisting or changing the running registry.
    await this.net.json(recipe.url.replaceAll("{query}","test"));
    this.store.db.query("INSERT OR REPLACE INTO plugins VALUES(?,?)").run(recipe.name,JSON.stringify(recipe));
    this.install(recipe);
    return recipe;
  }
}
