import {test} from 'node:test';
import assert from 'node:assert/strict';
import {moveDebris} from '../src/debris.ts';
import {Effects,MAX_FRAGMENTS,FRAGMENT_STRIDE} from '../src/effects.ts';
const body=(values={})=>({x:0,y:0,vx:0,vy:0,size:3,angle:0,spin:4,...values});
test('airborne fragments retain horizontal momentum and spin while gravity accelerates them',()=>{
  const p=body({vx:240,vy:-100});
  for(let i=0;i<240;i++)moveDebris(p,1/120,[]);
  assert.equal(p.vx,240);assert.equal(p.x,480);assert.equal(p.spin,4);
  assert.ok(Math.abs(p.vy-280)<1e-9);
});
test('fast fragments bounce off thin walls instead of tunneling through',()=>{
  for(const direction of [-1,1]){
    const p=body({x:direction===1?0:100,vx:direction*5000});
    moveDebris(p,.02,[[49,-100,51,100]]);
    assert.ok(p.vx*direction<0);
    assert.ok(direction===1?p.x<49-3.3:p.x>51+3.3);
  }
});
test('debris bounces off floors and ceilings and loses energy',()=>{
  for(const direction of [-1,1]){
    const p=body({y:direction===1?0:100,vy:direction*1000});
    moveDebris(p,.06,[[-100,49,100,51]]);
    assert.ok(p.vy*direction<0);assert.ok(Math.abs(p.vy)<1000);
  }
});
test('chips born overlapping terrain are pushed out and settle above a floor',()=>{
  const p=body({y:49,vy:50}),solids=[[-100,50,100,100]];
  for(let i=0;i<360;i++){moveDebris(p,1/120,solids);assert.ok(p.y<=50-p.size*1.1);}
  assert.ok(Math.abs(p.vy)<5);
});
test('explosion fragments use cave collisions only in cave mode',()=>{
  for(const cave of [0,1]){
    const effects=new Effects(()=>({sound:false,particles:true}),[[-500,20,500,1000]]);
    const frame=new Int32Array(2105);frame[0]=1;frame[2]=cave;frame[2096]=1;frame.set([0,0,0,5,0,0,0,0],2097);
    effects.consume(frame,0);const output=new Float32Array(MAX_FRAGMENTS*FRAGMENT_STRIDE);
    const count=effects.writeFragments(output,1000);assert.equal(count,16);
    const ys=Array.from({length:count},(_,i)=>output[i*FRAGMENT_STRIDE+1]);
    if(cave)for(let i=0;i<count;i++)assert.ok(ys[i]+output[i*FRAGMENT_STRIDE+3]*1.1<=20.001);
    else assert.ok(ys.some(y=>y>20));
  }
});
