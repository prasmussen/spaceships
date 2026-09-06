import {readFile,writeFile,mkdir} from 'node:fs/promises';
import os from 'node:os';
import {Engine} from '../src/engine.ts';
import {Rollback} from '../src/rollback.ts';
import {NetworkSession} from '../src/network-session.ts';
import {encodeInput} from '../src/protocol.ts';
const wasm=await readFile('public/simulation.wasm');
const engine=await Engine.create(wasm),normal=[],rollback=[];
for(let tick=0;tick<22000;tick++){const start=performance.now();engine.step([(tick*7+(tick>>4))&15,(tick*3+(tick>>5))&15]);if(tick>=2000)normal.push(performance.now()-start);}
for(let sample=0;sample<500;sample++){
  const peer=new Rollback(await Engine.create(wasm),0);for(let t=0;t<14;t++)peer.advance(0);
  const start=performance.now();peer.receive(1,2,1);rollback.push(performance.now()-start);
  if(peer.maxDepth!==12)throw Error('Benchmark did not exercise 12-tick rollback');
}
const identity=JSON.parse(await readFile('public/build.json','utf8'));
const match={id:'a'.repeat(32),epoch:1,seed:0,identity,inputDelay:2,recoveryPeer:0,region:'eu'};
const output={gameplay:()=>{},control:()=>{},diagnostic:()=>{}};
const networkTick=[],networkRollback=[];
const session=new NetworkSession(await Engine.create(wasm),0,match,output);
for(let tick=0;tick<22000;tick++){
  const start=performance.now();
  session.peer.receive(1,tick+2,(tick*3+(tick>>5))&15);session.peer.acknowledge(tick+1);
  session.scheduled((tick*7+(tick>>4))&15);session.frame();
  if(tick>=2000)networkTick.push(performance.now()-start);
}
for(let sample=0;sample<500;sample++){
  const session=new NetworkSession(await Engine.create(wasm),0,match,output);
  for(let t=0;t<14;t++)session.scheduled(0);session.frame();
  const packet=encodeInput({epoch:1,sender:1,start:2,ack:1,frames:[1]});
  const start=performance.now();session.gameplay(packet);session.frame();networkRollback.push(performance.now()-start);
  if(session.peer.maxDepth!==12)throw Error('Network benchmark missed 12-tick rollback');
}
const stats=values=>{values.sort((a,b)=>a-b);return {samples:values.length,p50:values[Math.floor(values.length*.5)],p95:values[Math.floor(values.length*.95)],p99:values[Math.floor(values.length*.99)],max:values.at(-1)};};
const result={date:new Date().toISOString(),platform:os.platform(),architecture:os.arch(),cpu:os.cpus()[0].model,runtime:process.version,build:JSON.parse(await readFile('public/build.json','utf8')).wasm,units:'milliseconds',normalTick:stats(normal),rollback12Ticks:stats(rollback),networkTickAndFrame:stats(networkTick),networkRollbackAndFrame:stats(networkRollback)};
await mkdir('artifacts',{recursive:true});await writeFile('artifacts/performance.json',JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result,null,2));
if(result.normalTick.p99>=1||result.rollback12Ticks.p99>=8||result.networkTickAndFrame.p99>=1||result.networkRollbackAndFrame.p99>=8)process.exitCode=1;
