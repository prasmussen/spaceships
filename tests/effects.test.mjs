import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Effects} from '../src/effects.ts';
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
