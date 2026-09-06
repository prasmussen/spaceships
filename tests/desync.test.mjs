import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {Engine} from '../src/engine.ts';
import {Rollback} from '../src/rollback.ts';
import {DesyncMonitor} from '../src/desync.ts';
const wasm=await readFile('public/simulation.wasm'),identity=JSON.parse(await readFile('public/build.json','utf8'));
test('forced desync freezes, saves diagnostics, recovers once and aborts on repetition',async()=>{
  const peers=[new Rollback(await Engine.create(wasm),0),new Rollback(await Engine.create(wasm),1)];
  for(let t=0;t<90;t++){
    for(let p=0;p<2;p++){peers[p].advance(1);peers[1-p].receive(p,t+2,1);}
    peers[0].acknowledge(peers[1].complete,1);peers[1].acknowledge(peers[0].complete,0);
    if(t===20)new Int32Array(peers[1].engine.wasm.memory.buffer,4096,2128)[22]-=1;
  }
  assert.notEqual(peers[0].hashAt(59),peers[1].hashAt(59));
  const monitor=new DesyncMonitor(peers[1],identity);
  assert.equal(monitor.compare(59,peers[0].hashAt(59)),false);assert.ok(monitor.diagnostic);assert.equal(peers[1].advance(1),false);
  assert.throws(()=>monitor.recover(59,peers[0].snapshots.get(60),1),/not permitted/);
  monitor.recover(59,peers[0].snapshots.get(60),0);
  assert.equal(peers[0].engine.hash(),peers[1].engine.hash());assert.equal(monitor.compare(59,peers[0].hashAt(59)),true);
  assert.throws(()=>monitor.compare(59,'1'),/Repeated desync/);assert.equal(monitor.aborted,true);assert.equal(peers[1].frozen,true);
});
