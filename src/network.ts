export class Network {
  constructor(private hosts: string[], private relaxLimits = false) {}
  async json(url: string) {
    const parsed=new URL(url);
    if(this.relaxLimits) {
      if(parsed.protocol!=="https:"||parsed.username||parsed.password) throw new Error("Invalid HTTPS URL");
    } else {
      if(parsed.protocol!=="https:"||parsed.username||parsed.password||parsed.port||!this.hosts.includes(parsed.hostname)) throw new Error("URL outside configured HTTPS host allowlist");
    }
    const timeout = this.relaxLimits ? 30000 : 15000;
    const res=await fetch(parsed,{redirect:"error",signal:AbortSignal.timeout(timeout)});
    if(!res.ok) throw new Error(`HTTP ${res.status}`);
    // Bound streamed bodies rather than trusting Content-Length.
    const maxBytes = this.relaxLimits ? 2097152 : 262144;
    const reader=res.body!.getReader(); let bytes=0; const chunks:Uint8Array[]=[];
    while(true){const {done,value}=await reader.read(); if(done)break;bytes+=value.length;if(bytes>maxBytes){await reader.cancel();throw new Error("Response too large");}chunks.push(value);}
    const body=new Uint8Array(bytes);let offset=0;for(const chunk of chunks){body.set(chunk,offset);offset+=chunk.length;}
    return JSON.parse(new TextDecoder().decode(body));
  }
  async trends() {
    const ids=await this.json("https://hacker-news.firebaseio.com/v0/topstories.json");
    if(!Array.isArray(ids)) throw new Error("Invalid trend response");
    const results=await Promise.allSettled(ids.slice(0,5).map(id=>this.json(`https://hacker-news.firebaseio.com/v0/item/${Number(id)}.json`)));
    return results.flatMap(r=>r.status==="fulfilled"&&r.value?.title?[{title:String(r.value.title).slice(0,250),url:`https://news.ycombinator.com/item?id=${r.value.id}`,published:r.value.time}]:[]);
  }
}
