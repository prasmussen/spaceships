import {test} from 'node:test';
import assert from 'node:assert/strict';
import {FlightInterpolation,FragmentInterpolation,PositionCorrection,projectilePose} from '../src/presentation.ts';
function frame(x,y=100){const state=new Int32Array(2096);state[16]=x*65536;state[17]=y*65536;state[18]=65536;state[23]=3;return state;}
function moving(tick){const state=frame(100+tick);state[0]=tick;return state;}
test('moving shots stay centered on the nose on the ship render clock',()=>{
  for(const angle of [0,1024,2048,3072]){
    const motion=new FlightInterpolation(),radians=angle*Math.PI/2048;
    const dx=Math.round(Math.sin(radians)),dy=-Math.round(Math.cos(radians));
    let tick=0;
    const make=t=>{
      const state=moving(t);state[16]=(100+t*8)*65536;state[17]=(100+t*3)*65536;
      state[18]=8*65536;state[19]=3*65536;state[20]=angle;
      if(t>10){const age=t-10;state.set([(180+20*dx+(8+12*dx)*age)*65536,(130+20*dy+(3+12*dy)*age)*65536,
        (8+12*dx)*65536,(3+12*dy)*65536,120-age,0,1,0],48);}
      return state;
    };
    let state=make(0),visible=0;
    for(let render=0;render<100;render++){
      const now=render*1000/144;
      while((tick+1)*1000/60+((tick+1)%3)*3<=now)state=make(++tick);
      const ship=motion.sample(state,0,now),copy=state.slice(),shot=projectilePose(state,0,ship.tick);
      assert.equal(shot.visible,ship.tick>=10&&tick>10);
      if(shot.visible){
        visible++;
        const distance=20+12*(ship.tick-10);
        assert.ok(Math.abs(shot.x-ship.x-dx*distance)<1e-9);
        assert.ok(Math.abs(shot.y-ship.y-dy*distance)<1e-9);
      }
      assert.deepEqual(state,copy);
    }
    assert.ok(visible>0);
  }
});
test('shot rewind respects half-step rounding, expiry, debris and resets',()=>{
  const state=moving(20);state.set([1000,2000,101,-103,119,0,1,0],48);
  assert.equal(projectilePose(state,0,19).x,900/65536);
  assert.equal(projectilePose(state,0,19).y,2102/65536);
  assert.equal(projectilePose(state,0,18).visible,false);
  assert.equal(projectilePose(state,0,20).x,1000/65536);
  state[55]=0x10000000;assert.equal(projectilePose(state,0,20).visible,false);
  state[55]=0;state[52]=0;assert.equal(projectilePose(state,0,20).visible,false);
});
function debris(tick,x=tick,id=1,angle=tick*20){
  const state=moving(tick);state.set([x*65536,100*65536,65536,0,186-tick,0,id,0x10000000|(angle<<5)],48);return state;
}
test('fragment translation and rotation stay even at 144 Hz with jittered worker delivery',()=>{
  const motion=new FragmentInterpolation();let tick=0,state=debris(0),previous;
  for(let render=0;render<200;render++){
    const now=render*1000/144;
    while((tick+1)*1000/60+((tick+1)%3)*3<=now)state=debris(++tick);
    const copy=state.slice(),pose=motion.sample(state,now).get(1);
    if(render>12){
      assert.ok(Math.abs(pose.x-previous.x-60/144)<1e-9);
      assert.ok(Math.abs(pose.angle-previous.angle-20*Math.PI/2048*60/144)<1e-9);
    }
    previous=pose;assert.deepEqual(state,copy);
  }
});
test('fragment rotation wraps, bounces stay within known positions and paused updates hold still',()=>{
  const motion=new FragmentInterpolation();motion.sample(debris(0,0,1,4090),0);
  const state=debris(1,1,1,6);motion.sample(state,1000/60);
  const halfway=motion.sample(state,2500/60).get(1);
  assert.equal(halfway.x,.5);assert.ok(Math.abs(halfway.angle-2*Math.PI)<1e-9);
  assert.equal(motion.sample(state,100).get(1).x,1);
  assert.equal(motion.sample(state,150).get(1).x,1);
  const bounce=debris(2,0);assert.ok(motion.sample(bounce,160).get(1).x<=1);
});
test('fragment slot reuse, expiry, seeks and rollback corrections discard stale motion',()=>{
  const motion=new FragmentInterpolation();motion.sample(debris(10),0);
  const reused=motion.sample(debris(11,100,2),10);assert.equal(reused.has(1),false);assert.equal(reused.get(2).x,100);
  const empty=debris(12);empty[52]=0;assert.equal(motion.sample(empty,20).size,0);
  assert.equal(motion.sample(debris(0,50),30).get(1).x,50);
  assert.equal(motion.sample(debris(1,60),40,false,1).get(1).x,60);
  assert.equal(motion.sample(debris(2,70),50,true,1).get(1).x,70);
});
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
