import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {Engine} from '../src/engine.ts';
import {EventDeduper} from '../src/events.ts';
const wasm=await readFile('public/simulation.wasm');
test('event IDs repeat exactly across rollback and deduplicate presentation',async()=>{
  const engine=await Engine.create(wasm);const snapshot=engine.save();engine.step([8,8]);
  const first=engine.frame(),deduper=new EventDeduper();assert.equal(deduper.consume(first).filter(e=>e.type===1).length,2);
  const hash=engine.hash();engine.load(snapshot);engine.step([8,8]);const second=engine.frame();
  assert.deepEqual(first,second);assert.equal(engine.hash(),hash);assert.equal(deduper.consume(second).length,0);
  deduper.clear();assert.equal(deduper.consume(second).length,2);
});
test('cosmetic memory never changes a canonical snapshot or hash',async()=>{const engine=await Engine.create(wasm);engine.step([8,0]);const hash=engine.hash(),snapshot=engine.save();new Uint8Array(engine.wasm.memory.buffer,131072,16388).fill(0);assert.equal(engine.hash(),hash);assert.deepEqual(engine.save(),snapshot);});
