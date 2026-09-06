import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const binary=await readFile('public/simulation.wasm');
async function create(){ const {instance}=await WebAssembly.instantiate(binary);const s=instance.exports;assert.equal(s.init(1024,0,0),1);return s; }
function step(s,a=0,b=0,n=1){ for(let i=0;i<n;i++){new Uint8Array(s.memory.buffer,2048,2).set([a,b]);assert.equal(s.step(2048,1),1);} }
function state(s){return new Int32Array(s.memory.buffer,4096,48);}
test('gravity, thrust and automatic rotation braking',async()=>{const s=await create();step(s);assert.equal(state(s)[19],3597);step(s,1);assert.equal(state(s)[19],-3603);step(s,4);const spin=state(s)[21];step(s,0);assert.ok(spin>0);assert.equal(state(s)[21],0);step(s,2);assert.ok(state(s)[21]<0);step(s,6);assert.equal(state(s)[21],0);});
test('fuel runs out without disabling rotation',async()=>{const s=await create();step(s,1,0,3000);assert.equal(state(s)[22],0);const vy=state(s)[19];step(s,5);assert.ok(state(s)[19]>vy);assert.ok(state(s)[21]>0);});
test('snapshot restoration reproduces exact future hashes',async()=>{const s=await create();step(s,5,2,80);const hash=s.state_hash();assert.equal(s.save_state(65536),8384);step(s,3,1,100);const future=s.state_hash();assert.equal(s.load_state(65536,8384),1);assert.equal(s.state_hash(),hash);step(s,3,1,100);assert.equal(s.state_hash(),future);});
test('tick batching and presentation reads do not alter gameplay',async()=>{const a=await create(),b=await create();for(let batch=0;batch<100;batch++){const inputs=new Uint8Array(b.memory.buffer,2048,240);for(let i=0;i<120;i++){const x=(batch+i)%8,y=(batch*3+i)%8;inputs.set([x,y],i*2);step(a,x,y);a.write_frame(81920);}assert.equal(b.step(2048,120),1);assert.equal(a.state_hash(),b.state_hash());}});
test('fixed memory and invalid snapshot boundaries',async()=>{const s=await create();assert.throws(()=>s.memory.grow(1));assert.equal(s.step(0,1),0);assert.equal(s.step(2048,121),0);assert.equal(s.load_state(65536,8383),0);s.save_state(65536);new DataView(s.memory.buffer).setInt32(65536+64+16,4096,true);const hash=s.state_hash();assert.equal(s.load_state(65536,8384),0);assert.equal(s.state_hash(),hash);});
test('configuration must match the versioned artifact',async()=>{const s=await create();new DataView(s.memory.buffer).setInt32(1024+12,999,true);const hash=s.state_hash();assert.equal(s.init(1024,0,0),0);assert.equal(s.state_hash(),hash);});
test('snapshot rejects every out-of-bounds field and reserved region atomically',async()=>{const s=await create();const invalid=[[0,-1],[4,0],[8,1],[60,1],[64,2147483647],[68,-2147483648],[72,4194305],[76,-4194305],[80,-1],[84,73],[88,-1],[92,4],[96,1],[124,1],[128,-2147483648],[148,-73],[188,1]];for(const [offset,value]of invalid){s.save_state(65536);new DataView(s.memory.buffer).setInt32(65536+offset,value,true);const hash=s.state_hash();assert.equal(s.load_state(65536,8384),0,`offset ${offset}`);assert.equal(s.state_hash(),hash);}});
test('angles wrap, negative half-steps truncate toward zero, and speed saturates',async()=>{const s=await create();const st=state(s);st[20]=0;st[21]=-3;st[18]=-3;step(s,2);assert.equal(st[20],4091);assert.equal(st[16],-19660802);st[19]=4194303;st[20]=2048;step(s,1);assert.equal(st[19],4194304);st[16]=1073741823;st[18]=4194304;step(s,1);assert.equal(st[16],1073741824);});
test('WASM has no host imports',()=>assert.deepEqual(WebAssembly.Module.imports(new WebAssembly.Module(binary)),[]));

for(const direction of [-1,1])test(`rotation braking stops ${direction<0?'left':'right'} spin within 100 ms while coasting gently`,async()=>{
  const s=await create(),st=state(s);st[21]=direction*72;st[18]=2*65536;st[22]=0;
  for(let tick=0;tick<5;tick++){step(s);assert.equal(st[21],direction*Math.max(0,72-(tick+1)*16)||0);assert.ok(st[18]<2*65536&&st[18]>1.9*65536);}
  const angle=st[20];step(s,0,0,10);assert.equal(st[20],angle);assert.equal(st[22],0);
});

test('held steering caps rotation at 72 units per tick in both directions',async()=>{
  for(const [buttons,direction]of [[2,-1],[4,1]]){
    const s=await create();step(s,buttons,0,120);assert.equal(state(s)[21],direction*72);
  }
});

test('coasting gently loses about 21% horizontal speed per second in either direction',async()=>{
  for(const direction of [-1,1]){
    const s=await create(),st=state(s);st[18]=direction*4*65536;const fuel=st[22];
    step(s,0,0,60);const fraction=st[18]/(direction*4*65536);
    assert.ok(fraction>.78&&fraction<.8);assert.equal(st[22],fuel);
  }
});
test('active thrust bypasses drag; holding thrust with an empty tank does not',async()=>{
  const s=await create(),st=state(s);st[18]=4*65536;step(s,1,0,60);assert.equal(st[18],4*65536);
  st[22]=0;step(s,1,0,60);assert.ok(st[18]<3.2*65536&&st[18]>3.1*65536);assert.equal(st[22],0);
});
