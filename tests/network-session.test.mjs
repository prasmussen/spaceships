import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {Engine} from '../src/engine.ts';
import {NetworkSession} from '../src/network-session.ts';
const wasm=await readFile('public/simulation.wasm'),identity=JSON.parse(await readFile('public/build.json','utf8'));
const match={id:'a'.repeat(32),epoch:432,seed:19,identity,inputDelay:2,recoveryPeer:0,region:'eu'};
async function setup(){const queues=[[],[]],diagnostics=[];const peers=await Promise.all([0,1].map(async p=>new NetworkSession(await Engine.create(wasm,32768,19),p,match,{gameplay:buffer=>queues[1-p].push({kind:'gameplay',data:buffer}),control:message=>queues[1-p].push({kind:'control',data:JSON.stringify(message)}),diagnostic:d=>diagnostics.push(d)})));return{queues,peers,diagnostics};}
function deliver(peers,queues,loss=false){for(let p=0;p<2;p++){const packets=queues[p].splice(0);for(let i=0;i<packets.length;i++){const packet=packets[i];if(loss&&packet.kind==='gameplay'&&i%3===0)continue;peers[p][packet.kind](packet.data);}}}
test('online presentation includes events from every catch-up tick and drains once',async()=>{
  const {peers,queues}=await setup();
  for(let tick=0;tick<24;tick++){peers.forEach(p=>p.scheduled(8));deliver(peers,queues);}
  const peer=peers[0],hash=peer.peer.engine.hash(),frame=peer.frame(),shotTicks=new Set();
  for(let i=0;i<frame[2096];i++){const o=2097+i*8;if(frame[o+3]===1)shotTicks.add(frame[o]);}
  assert.ok(shotTicks.size>=3,'shots on earlier ticks survive the frame batching');
  assert.equal(peer.frame()[2096],0);
  assert.equal(peer.peer.engine.hash(),hash);
});
test('online recording captures only agreed inputs and rejects non-reproducible state',async()=>{
  const {peers,queues}=await setup();
  for(let wall=0;wall<240;wall++){peers.forEach((p,i)=>p.scheduled((wall*3+i)&15));deliver(peers,queues,true);}
  const peer=peers[0],limit=Math.min(peer.peer.agreed,peer.peer.tick-1);
  for(let wall=0;wall<5;wall++)peer.scheduled(15);
  const recording=await peer.replay(wasm);
  assert.equal(recording.inputs.length,limit+1);
  assert.equal(recording.checkpoints.at(-1).hash,peer.peer.hashAt(limit));
  assert.ok(recording.inputs.length<peer.peer.tick);
  peer.peer.hashes.set(limit,'1');
  await assert.rejects(()=>peer.replay(wasm),/differs from confirmed state/);
});
test('serialized gameplay, repair and agreed hashes converge over loss and a burst outage',async()=>{const {peers,queues}=await setup();for(let wall=0;wall<900;wall++){for(let p=0;p<2;p++)peers[p].scheduled((wall*7+p)&15);if(wall<100||wall>=160)deliver(peers,queues,true);else for(const q of queues)q.splice(0);}for(let i=0;i<10;i++){peers.forEach(p=>p.resume());deliver(peers,queues);}const tick=Math.min(...peers.map(p=>Math.min(p.peer.agreed,p.peer.tick-1)));assert.ok(tick>700);assert.equal(peers[0].peer.hashAt(tick),peers[1].peer.hashAt(tick));assert.ok(peers.every(p=>p.peer.maxDepth<=12&&p.peer.stalls>0));});
test('wire recovery freezes, repairs one mismatch and resumes both peers',async()=>{const {peers,queues,diagnostics}=await setup();for(let wall=0;wall<180;wall++){for(const p of peers)p.scheduled(1);if(wall===20)new Int32Array(peers[1].peer.engine.wasm.memory.buffer,4096,2096)[22]-=1;deliver(peers,queues);}for(let i=0;i<10;i++)deliver(peers,queues);const tick=Math.min(...peers.map(p=>Math.min(p.peer.agreed,p.peer.tick-1)));assert.equal(peers[0].peer.hashAt(tick),peers[1].peer.hashAt(tick));assert.equal(diagnostics.length,2);assert.ok(peers.every(p=>p.monitor.recoveries===1&&!p.peer.frozen));});
