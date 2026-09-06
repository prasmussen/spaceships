import {test} from 'node:test';
import assert from 'node:assert/strict';
import {FlightInterpolation,PositionCorrection} from '../src/presentation.ts';
function frame(x,y=100){const state=new Int32Array(2096);state[16]=x*65536;state[17]=y*65536;state[18]=65536;state[23]=3;return state;}
function moving(tick){const state=frame(100+tick);state[0]=tick;return state;}
test('flight advances evenly at 144 Hz despite jittered 60 Hz worker updates',()=>{
  const flight=new FlightInterpolation();let tick=0,state=moving(0),previous;
  for(let render=0;render<288;render++){
    const now=render*1000/144;
    while((tick+1)*1000/60+((tick+1)%3)*3<=now)state=moving(++tick);
    const copy=state.slice(),pose=flight.sample(state,0,now);
    if(render>12)assert.ok(Math.abs(pose.x-previous-60/144)<1e-9,`uneven movement at frame ${render}`);
    previous=pose.x;assert.deepEqual(state,copy);
  }
});
test('flight interpolates rotation through angle wrap and holds still when updates stop',()=>{
  const flight=new FlightInterpolation(),a=moving(0),b=moving(1);a[20]=4090;b[20]=6;
  flight.sample(a,0,0);flight.sample(b,0,1000/60);
  const middle=flight.sample(b,0,2500/60);
  assert.ok(Math.abs(middle.angle-2*Math.PI)<1e-9);
  assert.equal(middle.x,100.5);
  assert.equal(flight.sample(b,0,100).x,101);
  assert.equal(flight.sample(b,0,150).x,101);
});
test('flight snaps on resets, seeks, respawns, landings and long interruptions',()=>{
  for(const kind of ['reset','seek','respawn','landing','suspend','teleport']){
    const flight=new FlightInterpolation();flight.sample(moving(10),0,0);
    const state=moving(kind==='seek'?0:11);
    if(kind==='respawn')state[23]=0;
    if(kind==='landing')state[24]=1;
    if(kind==='teleport')state[16]=300*65536;
    assert.equal(flight.sample(state,0,kind==='suspend'?500:10,kind==='reset').x,state[16]/65536);
  }
});
test('small rollback correction preserves predicted position then settles without mutating state',()=>{
  const correction=new PositionCorrection();correction.sample(frame(100),0,0,0,0);
  const corrected=frame(103),copy=corrected.slice();
  assert.equal(correction.sample(corrected,0,1,1,0).x,101);
  const settling=correction.sample(corrected,0,1,1,.1);assert.ok(settling.x>102&&settling.x<103);
  assert.ok(Math.abs(correction.sample(corrected,0,1,1,1).x-103)<.000001);
  assert.deepEqual(corrected,copy);
});
test('large jumps, respawns, grounded state and explicit reduced-motion reset snap immediately',()=>{
  for(const kind of ['jump','respawn','grounded','reset']){
    const correction=new PositionCorrection();correction.sample(frame(100),0,1,0,0);
    const state=frame(kind==='jump'?200:103);if(kind==='respawn')state[23]=0;if(kind==='grounded')state[24]=1;
    const result=correction.sample(state,0,2,1,0,kind==='reset');assert.equal(result.x,state[16]/65536);assert.equal(result.snap,true);
  }
});
test('ordinary simulation motion is not delayed and replay seeks discard old offsets',()=>{
  const correction=new PositionCorrection();correction.sample(frame(100),0,100,0,0);
  assert.equal(correction.sample(frame(104),0,101,0,0).x,104);
  correction.sample(frame(107),0,102,1,0);
  assert.equal(correction.sample(frame(50),0,20,1,0).x,50);
});
