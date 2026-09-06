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
test('canonical debris renders once, fades after three seconds and clears on reset',()=>{
  const effects=new Effects(()=>({sound:false,particles:true})),frame=eventFrame(2),buffer=new Float32Array(MAX_FRAGMENTS*FRAGMENT_STRIDE);
  frame[2100]=4;frame[2108]=5;frame[2111]=1;
  for(let i=0;i<32;i++)frame.set([100*65536,200*65536,0,0,186,i<16?0:1,i+1,0x10000000|(i%16)],48+i*8);
  const copy=frame.slice();effects.consume(frame,1000);effects.consume(frame,1000);
  assert.equal(effects.write(new Float32Array(2048),0,1000),0);
  assert.equal(effects.writeFragments(buffer,1000),32);assert.equal(buffer[5],1);
  assert.equal(buffer[16*FRAGMENT_STRIDE+4],1);assert.deepEqual(frame,copy);
  frame[52]=6;effects.writeFragments(buffer,4000);assert.equal(buffer[5],1);
  frame[52]=3;effects.writeFragments(buffer,4050);assert.equal(buffer[5],.5);
  frame[52]=0;assert.equal(effects.writeFragments(buffer,4100),31);
  effects.clear();assert.equal(effects.writeFragments(buffer),0);
});
test('gameplay debris stays visible when cosmetic particles are disabled',()=>{
  const effects=new Effects(()=>({sound:false,particles:false})),frame=eventFrame(0),buffer=new Float32Array(MAX_FRAGMENTS*FRAGMENT_STRIDE);
  frame.set([100*65536,200*65536,0,0,186,0,1,0x10000000],48);
  effects.consume(frame);assert.equal(effects.writeFragments(buffer),1);
});
