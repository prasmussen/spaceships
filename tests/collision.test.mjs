import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const {instance}=await WebAssembly.instantiate(await readFile('tests/collision-test.wasm'));
const s=instance.exports;
const Q=65536;
function circle(x,y,dx,dy,r){return s.circle_toi(x*Q,y*Q,dx*Q,dy*Q,0,0,r*Q);}
test('swept circle hits, misses, overlap, tangency and stationary segments',()=>{
  assert.equal(circle(-30,0,60,0,16),15292);
  assert.equal(circle(-30,17,60,0,16),65537);
  assert.equal(circle(0,0,0,0,16),0);
  assert.equal(circle(30,0,0,0,16),65537);
  assert.equal(circle(-30,16,60,0,16),32768);
  assert.equal(circle(20,0,1/Q,0,16),65537);
  assert.equal(circle(16.1,0,-1/Q,0,16),65537);
});
test('circle sweep agrees with analytic intersection away from quantization boundaries',()=>{
  let seed=421;
  const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/2**32;};
  for(let i=0;i<20000;i++) {
    const x=Math.round((random()*160-80)*Q)/Q,y=Math.round((random()*160-80)*Q)/Q;
    const dx=Math.round((random()*128-64)*Q)/Q,dy=Math.round((random()*128-64)*Q)/Q;
    const a=dx*dx+dy*dy,b=2*(x*dx+y*dy),c=x*x+y*y-256,disc=b*b-4*a*c;
    let expected=c<=0?0:disc>=0?(-b-Math.sqrt(disc))/(2*a):Infinity;
    if(expected<0 || expected>1)expected=Infinity;
    const result=circle(x,y,dx,dy,16);
    if(expected===Infinity)assert.equal(result,65537,`miss ${x},${y},${dx},${dy}`);
    else assert.ok(Math.abs(result-expected*Q)<4,`TOI ${result} vs ${expected*Q} at ${x},${y},${dx},${dy}`);
  }
});
test('rectangle corners are round, not expanded square footprints',()=>{
  const rect=32832+9*16; // pillar [1450,700,1750,1450]
  assert.equal(s.rect_toi(1435*Q,685*Q,0,0,rect,16*Q),65537);
  assert.equal(s.rect_toi(1440*Q,690*Q,0,0,rect,16*Q),0);
});
test('uniform grid produces the same earliest contact as a full solid scan',()=>{
  const count=new DataView(s.memory.buffer).getInt32(32780,true);
  for(let i=0;i<4000;i++){
    const x=((i*149)%6400)*Q,y=((i*313)%4000)*Q,dx=((i*7)%65-32)*Q,dy=((i*13)%65-32)*Q;
    let expected=65537;
    for(let id=0;id<count;id++)expected=Math.min(expected,s.rect_toi(x,y,dx,dy,32832+id*16,16*Q));
    assert.equal(s.terrain_toi(x,y,dx,dy,16*Q),expected,`grid query ${i}`);
  }
});
