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
      for(let p=0;p<2;p++)peers[p].acknowledge(peers[1-p].complete);
    }
    if(peers.every(peer=>peer.tick===target&&peer.agreed>=target-1))break;
  }
  assert.ok(peers.every(peer=>peer.tick===target&&peer.agreed>=target-1));
  const reference=await Engine.create(wasm);
  for(let t=0;t<target;t++)reference.step([peers[0].input[0].get(t),peers[1].input[1].get(t)]);
  for(const peer of peers){assert.equal(peer.hashAt(target-1),reference.hash());assert.ok(peer.stalls>0);assert.ok(peer.maxDepth<=12);assert.equal(peer.confirmedInputs().length,target);}
});
test('conflicting/foreign input and speculative hash requests are protocol errors',async()=>{const peer=new Rollback(await Engine.create(wasm),0);assert.throws(()=>peer.receive(0,2,1),ProtocolError);peer.receive(1,2,1);peer.receive(1,2,1);assert.throws(()=>peer.receive(1,2,2),ProtocolError);assert.throws(()=>peer.receive(1,500,0),ProtocolError);assert.throws(()=>peer.hashAt(0),ProtocolError);peer.advance(1);assert.equal(typeof peer.hashAt(0),'string');});
test('outage stalls both command generation and simulation; resume repairs prediction',async()=>{const peer=new Rollback(await Engine.create(wasm),0);for(let t=0;t<100;t++)peer.advance(t&31);assert.equal(peer.tick,14);const count=peer.input[0].size;for(let t=0;t<100;t++)peer.advance(0);assert.equal(peer.input[0].size,count);for(let t=2;t<16;t++)peer.receive(1,t,1);peer.acknowledge(15);assert.ok(peer.advance(0));});
