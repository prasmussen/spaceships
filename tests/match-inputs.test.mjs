import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {Engine} from '../src/engine.ts';
import {matchInputs} from './match-inputs.mjs';
test('normal inputs traverse the cave and complete a first-to-five match from spawn',async()=>{
  const inputs=await matchInputs(),engine=await Engine.create(await readFile('public/simulation.wasm'));
  for(const pair of inputs)engine.step(pair);
  const frame=engine.frame();assert.equal(frame[1],0);assert.equal(frame[27],5);assert.equal(frame[43],0);
  const hash=engine.hash();for(let i=0;i<120;i++)engine.step([15,15]);assert.equal(engine.hash(),hash);
});
