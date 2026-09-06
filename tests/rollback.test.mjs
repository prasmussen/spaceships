import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {Engine} from '../src/engine.ts';
import {Rollback,ProtocolError} from '../src/rollback.ts';
const wasm=await readFile('public/simulation.wasm');
const buttons=(p,t)=>((t*7+(t>>(p?3:5)))&31);
for(const lag of [0,3,6])for(const loss of [0,.2])test(`rollback converges: ${lag*1000/30} ms RTT, ${loss*100}% loss, jitter/reordering/duplicates and burst outage`,async()=>{
  const peers=[new Rollback(await Engine.create(wasm),0),new Rollback(await Engine.create(wasm),1)];
  let seed=1723,queue=[];
  const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/2**32;};
  const target=700;
  for(let wall=0;wall<2500;wall++){
    const outage=wall>=100&&wall<160;
    for(let p=0;p<2;p++){
      const peer=peers[p];if(peer.tick<target)peer.advance(buttons(p,peer.tick));
      assert.ok(peer.tick-1<=peer.agreed+12,'speculation remains bounded');
      if(outage)continue;
      const entries=[...peer.input[p]].slice(-8);
      for(const [tick,value]of entries)if(random()>=loss){const packet={at:wall+lag+Math.floor(random()*4),p,tick,value};queue.push(packet);if(random()<.2)queue.push({...packet,at:packet.at+2});}
      // Reliable missing-input repair, delayed but not permanently lossy.
      if(wall%20===0)for(const [tick,value]of peer.input[p])if(!peers[1-p].input[p].has(tick))queue.push({at:wall+lag+2,p,tick,value});
    }
    if(!outage){
      const due=queue.filter(packet=>packet.at<=wall).reverse();queue=queue.filter(packet=>packet.at>wall);
      for(const packet of due)peers[1-packet.p].receive(packet.p,packet.tick,packet.value);
      for(let p=0;p<2;p++)peers[p].acknowledge(peers[1-p].complete,1-p);
    }
    if(peers.every(peer=>peer.tick===target&&peer.agreed>=target-1))break;
  }
  assert.ok(peers.every(peer=>peer.tick===target&&peer.agreed>=target-1));
  const reference=await Engine.create(wasm);
  for(let t=0;t<target;t++)reference.step([peers[0].input[0].get(t),peers[1].input[1].get(t)]);
  for(const peer of peers){assert.equal(peer.hashAt(target-1),reference.hash());assert.ok(peer.stalls>0);assert.ok(peer.maxDepth<=12);assert.equal(peer.confirmedInputs().length,target);}
});
test('conflicting/foreign input and speculative hash requests are protocol errors',async()=>{const peer=new Rollback(await Engine.create(wasm),0);assert.throws(()=>peer.receive(0,2,1),ProtocolError);peer.receive(1,2,1);peer.receive(1,2,1);assert.throws(()=>peer.receive(1,2,2),ProtocolError);assert.throws(()=>peer.receive(1,500,0),ProtocolError);assert.throws(()=>peer.hashAt(0),ProtocolError);peer.advance(1);assert.equal(typeof peer.hashAt(0),'string');});
test('outage stalls both command generation and simulation; resume repairs prediction',async()=>{const peer=new Rollback(await Engine.create(wasm),0);for(let t=0;t<100;t++)peer.advance(t&31);assert.equal(peer.tick,14);const count=peer.input[0].size;for(let t=0;t<100;t++)peer.advance(0);assert.equal(peer.input[0].size,count);for(let t=2;t<16;t++)peer.receive(1,t,1);peer.acknowledge(15,1);assert.ok(peer.advance(0));});
for(const players of [3,4])test(`${players} peers converge with loss, reordering, duplicate input and a disconnected peer`,async()=>{
  const peers=await Promise.all(Array.from({length:players},async(_,id)=>new Rollback(await Engine.create(wasm,32769,73,players),id)));
  let queue=[],seed=12345;
  const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/2**32;};
  const target=500;
  for(let wall=0;wall<2500;wall++){
    const outage=wall>=100&&wall<200;
    for(const peer of peers)if(peer.tick<target)peer.advance((wall*7+peer.player*11)&31);
    for(const sender of peers)for(const receiver of peers){
      if(sender===receiver||outage&&(sender.player===players-1||receiver.player===players-1))continue;
      const entries=wall%12===0?[...sender.input[sender.player]].filter(([tick])=>!receiver.input[sender.player].has(tick)):[...sender.input[sender.player]].slice(-8);
      for(const [tick,buttons] of entries)if(wall%12===0||random()>.25){
        const packet={at:wall+3+Math.floor(random()*5),sender:sender.player,receiver:receiver.player,tick,buttons};queue.push(packet);
        if(random()<.1)queue.push({...packet,at:packet.at+1});
      }
      receiver.acknowledge(sender.complete,sender.player);
    }
    const due=queue.filter(p=>p.at<=wall).reverse();queue=queue.filter(p=>p.at>wall);
    for(const packet of due)peers[packet.receiver].receive(packet.sender,packet.tick,packet.buttons);
    if(peers.every(peer=>peer.tick===target&&peer.agreed>=target-1))break;
  }
  assert.ok(peers.every(peer=>peer.tick===target&&peer.agreed>=target-1));
  const reference=await Engine.create(wasm,32769,73,players);
  for(let tick=0;tick<target;tick++)reference.step(peers.map(peer=>peer.input[peer.player].get(tick)));
  for(const peer of peers){assert.equal(peer.hashAt(target-1),reference.hash());assert.ok(peer.rollbacks>0);assert.ok(peer.stalls>0);assert.ok(peer.maxDepth<=12);assert.equal(peer.confirmedInputs()[0].length,players);}
});
test('agreement waits for every peer acknowledgement and rejects foreign slots',async()=>{
  const peer=new Rollback(await Engine.create(wasm,0,0,4),3);
  for(let tick=2;tick<10;tick++){for(let id=0;id<3;id++)peer.receive(id,tick,0);peer.advance(0);}
  peer.acknowledge(9,0);peer.acknowledge(9,1);assert.equal(peer.agreed,1);
  peer.acknowledge(9,2);assert.ok(peer.agreed>1);
  for(const id of [-1,3,4,1.5]){assert.throws(()=>peer.receive(id,10,0));assert.throws(()=>peer.acknowledge(9,id));}
});
