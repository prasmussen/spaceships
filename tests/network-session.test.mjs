import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {Engine} from '../src/engine.ts';
import {NetworkSession} from '../src/network-session.ts';
const wasm=await readFile('public/simulation.wasm'),identity=JSON.parse(await readFile('public/build.json','utf8'));
const match={players:2,id:'a'.repeat(32),epoch:432,seed:19,identity,inputDelay:2,recoveryPeer:0,region:'eu'};
async function setup(players=2){
  const queues=Array.from({length:players},()=>[]),diagnostics=[];
  const peers=await Promise.all(Array.from({length:players},async(_,sender)=>{
    const route=(kind,data,recipient)=>{for(let id=0;id<players;id++)if(id!==sender&&(recipient===undefined||recipient===id))queues[id].push({kind,data,sender});};
    return new NetworkSession(await Engine.create(wasm,32768,19,players),sender,{...match,players},{gameplay:buffer=>route('gameplay',buffer),control:(message,recipient)=>route('control',JSON.stringify(message),recipient),diagnostic:d=>diagnostics.push(d)});
  }));return{queues,peers,diagnostics};
}
function deliver(peers,queues,loss=false){for(let p=0;p<peers.length;p++){const packets=queues[p].splice(0);for(let i=0;i<packets.length;i++){const packet=packets[i];if(loss&&packet.kind==='gameplay'&&i%3===0)continue;peers[p][packet.kind](packet.data,packet.sender);}}}
test('online presentation includes events from every catch-up tick and drains once',async()=>{
  const {peers,queues}=await setup();
  for(let tick=0;tick<24;tick++){peers.forEach(p=>p.scheduled(8));deliver(peers,queues);}
  const peer=peers[0],hash=peer.peer.engine.hash(),frame=peer.frame(),shotTicks=new Set();
  for(let i=0;i<frame[2128];i++){const o=2129+i*8;if(frame[o+3]===1)shotTicks.add(frame[o]);}
  assert.ok(shotTicks.size>=3,'shots on earlier ticks survive the frame batching');
  assert.equal(peer.frame()[2128],0);
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
test('wire recovery freezes, repairs one mismatch and resumes both peers',async()=>{const {peers,queues,diagnostics}=await setup();for(let wall=0;wall<180;wall++){for(const p of peers)p.scheduled(1);if(wall===20)new Int32Array(peers[1].peer.engine.wasm.memory.buffer,4096,2128)[22]-=1;deliver(peers,queues);}for(let i=0;i<10;i++)deliver(peers,queues);const tick=Math.min(...peers.map(p=>Math.min(p.peer.agreed,p.peer.tick-1)));assert.equal(peers[0].peer.hashAt(tick),peers[1].peer.hashAt(tick));assert.equal(diagnostics.length,2);assert.ok(peers.every(p=>p.monitor.recoveries===1&&!p.peer.frozen));});
for(const players of [3,4])test(`${players}-player wire sessions agree through repair, recovery and replay capture`,async()=>{
  const {peers,queues}=await setup(players);
  for(let wall=0;wall<420;wall++){
    peers.forEach((p,id)=>p.scheduled((wall*7+id*3)&31));
    if(wall>=80&&wall<150){for(const queue of queues)queue.splice(0);}
    else deliver(peers,queues,true);
  }
  for(let i=0;i<10;i++){peers.forEach(p=>p.resume());deliver(peers,queues);}
  let tick=Math.min(...peers.map(p=>Math.min(p.peer.agreed,p.peer.tick-1)));
  assert.ok(tick>250);for(const p of peers)assert.equal(p.peer.hashAt(tick),peers[0].peer.hashAt(tick));
  const recording=await peers.at(-1).replay(wasm);assert.equal(recording.players,players);assert.equal(recording.inputs[0].length,players);
  // Change canonical state at the highest remote slot to exercise coordinator recovery.
  const last=peers.at(-1);new Int32Array(last.peer.engine.wasm.memory.buffer,4096,2128)[22]^=1;
  for(let wall=0;wall<180;wall++){peers.forEach(p=>p.scheduled(0));deliver(peers,queues);}
  for(let i=0;i<10;i++)deliver(peers,queues);
  tick=Math.min(...peers.map(p=>Math.min(p.peer.agreed,p.peer.tick-1)));
  for(const p of peers){assert.equal(p.peer.hashAt(tick),peers[0].peer.hashAt(tick));assert.equal(p.monitor.recoveries,1);assert.equal(p.peer.frozen,false);}
  assert.throws(()=>peers[1].control(JSON.stringify({type:'recover',tick:59,snapshot:Array(8512).fill(0)}),players-1));
  assert.throws(()=>peers[0].gameplay(new ArrayBuffer(21),players));
});
