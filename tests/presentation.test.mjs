import {test} from 'node:test';
import assert from 'node:assert/strict';
import {PositionCorrection} from '../src/presentation.ts';
function frame(x,y=100){const state=new Int32Array(2096);state[16]=x*65536;state[17]=y*65536;state[18]=65536;state[23]=3;return state;}
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
