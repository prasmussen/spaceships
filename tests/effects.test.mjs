import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Effects,MAX_FRAGMENTS,FRAGMENT_STRIDE} from '../src/effects.ts';
function eventFrame(count=1){const frame=new Int32Array(2097+count*8);frame[0]=20;frame[2096]=count;for(let i=0;i<count;i++)frame.set([19,i,0,1,100*65536,200*65536,0,0],2097+i*8);return frame;}
test('rollback events produce one cosmetic burst, expire, and do not alter the frame',()=>{
  const effects=new Effects(()=>({sound:false,particles:true})),frame=eventFrame(),copy=frame.slice(),buffer=new Float32Array(2048);
  effects.consume(frame,1000);effects.consume(frame,1000);
  assert.equal(effects.write(buffer,0,1000),5);
  assert.equal(effects.write(buffer,0,1300),0);
  assert.deepEqual(frame,copy);
  effects.clear();effects.consume(frame,1400);assert.equal(effects.write(buffer,0,1400),5);
});
test('cosmetic bursts are bounded and reduced motion clears existing particles',()=>{
  let particles=true;const effects=new Effects(()=>({sound:false,particles})),buffer=new Float32Array(2048);
  effects.consume(eventFrame(512),1000);assert.equal(effects.write(buffer,0,1000),512);
  particles=false;assert.equal(effects.write(buffer,0,1000),0);
  particles=true;assert.equal(effects.write(buffer,0,1000),0);
});
test('ship deaths produce 16 shaped hull fragments per ship without firework particles',()=>{
  const effects=new Effects(()=>({sound:false,particles:true})),frame=eventFrame(2),buffer=new Float32Array(MAX_FRAGMENTS*FRAGMENT_STRIDE);
  frame[2100]=4;frame[2108]=5;frame[2111]=1;
  const copy=frame.slice();effects.consume(frame,1000);effects.consume(frame,1000);
  assert.equal(effects.write(new Float32Array(2048),0,1000),0);
  assert.equal(effects.writeFragments(buffer,1000),32);
  for(let i=0;i<32;i++)assert.ok(buffer[i*FRAGMENT_STRIDE+3]>=1);
  assert.ok(buffer[0]!==buffer[16]||buffer[1]!==buffer[17]);
  assert.equal(buffer[4],0);assert.equal(buffer[16*FRAGMENT_STRIDE+4],1);
  const initial=buffer.slice();effects.writeFragments(buffer,1500);
  assert.notEqual(buffer[0],initial[0]);assert.notEqual(buffer[2],initial[2]);
  assert.deepEqual(frame,copy);
  assert.equal(effects.writeFragments(buffer,4000),32);assert.equal(buffer[5],1);
  assert.equal(effects.writeFragments(buffer,4050),32);assert.equal(buffer[5],.5);
  assert.equal(effects.writeFragments(buffer,4100),0);
});
test('debris stays bounded and respects reduced motion and reset',()=>{
  let particles=true;const effects=new Effects(()=>({sound:false,particles})),frame=eventFrame(40),buffer=new Float32Array(MAX_FRAGMENTS*FRAGMENT_STRIDE);
  for(let i=0;i<40;i++)frame[2100+i*8]=5;
  effects.consume(frame,1000);assert.equal(effects.writeFragments(buffer,1000),MAX_FRAGMENTS);
  particles=false;assert.equal(effects.writeFragments(buffer,1000),0);
  particles=true;assert.equal(effects.writeFragments(buffer,1000),0);
  effects.clear();effects.consume(frame,1000);effects.clear();assert.equal(effects.writeFragments(buffer,1000),0);
});
