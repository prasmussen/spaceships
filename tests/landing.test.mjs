import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const binary=await readFile('public/simulation.wasm');
const Q=65536;
async function create(){const {instance}=await WebAssembly.instantiate(binary);const s=instance.exports;assert.equal(s.init(1024,32768,0,2),1);return {s,st:new Int32Array(s.memory.buffer,4096,48)};}
function step(s,a=0,n=1){new Uint8Array(s.memory.buffer,2048,2).set([a,0]);for(let i=0;i<n;i++)s.step(2048,1);}
function approach(st){st[16]=450*Q;st[17]=1684*Q-1;st[18]=0;st[19]=30000;st[20]=0;st[21]=0;st[22]=3000;st[24]=0;}
test('grounded ships refuel, suppress rotation, and launch with thrust',async()=>{const {s,st}=await create();assert.equal(st[24],1);st[22]=3000;const y=st[17];step(s,4,10);assert.equal(st[21],0);assert.equal(st[17],y);assert.equal(st[22],3060);step(s,1);assert.equal(st[24],0);assert.ok(st[17]<y);assert.equal(st[22],3058);});
for(const [name,index,limit]of [['horizontal speed',18,52428],['vertical speed',19,91750],['orientation',20,114],['spin',21,8]]) {
  for(const delta of [-1,0,1])test(`landing ${name} at limit ${delta>=0?'+':''}${delta}`,async()=>{
    const {s,st}=await create();approach(st);st[index]=limit+delta-(index===19?1800:0)+(index===21?8:0);if(index===18||index===19)st[index]+=Math.trunc(st[index]/511);step(s);
    assert.equal(st[23],delta<=0?3:0);assert.equal(st[24],delta<=0?1:0);assert.equal(st[27],delta<=0?0:-1);
  });
}
for(const delta of [-1,0,1])test(`landing footprint boundary ${delta}`,async()=>{const {s,st}=await create();approach(st);st[16]=(450+100-16)*Q+delta;step(s);assert.equal(st[23],delta<=0?3:0);});
test('either player can land on every pad and restore the grounded snapshot',async()=>{
  const cave=JSON.parse(await readFile('sim/cave.json','utf8'));
  for(const player of [0,1])for(const pad of cave.pads){
    const {s,st}=await create(),o=16+player*16,other=16+(1-player)*16;
    st[other]=3500*Q;st[other+1]=1000*Q;st[other+8]=0;
    st[o]=pad.x*Q;st[o+1]=(pad.y-16)*Q-1;st[o+2]=0;st[o+3]=30000;st[o+4]=0;st[o+5]=0;st[o+8]=0;
    step(s);assert.equal(st[o+7],3);assert.equal(st[o+8],1);
    s.save_state(65536);assert.equal(s.load_state(65536,8512),1);
  }
});
test('respawn after two seconds selects the pad farthest from the living opponent',async()=>{
  const {s,st}=await create();approach(st);st[20]=2048;step(s);
  assert.equal(st[23],0);assert.equal(st[26],120);assert.equal(st[27],-1);
  step(s,0,119);assert.equal(st[23],0);step(s);
  assert.equal(st[23],3);assert.equal(st[16],5950*Q);assert.equal(st[17],3684*Q-1);assert.equal(st[24],1);
});
test('starting pad assignment varies with seed, stays distinct, and reproduces exactly',async()=>{
  const starts=new Set();
  for(let seed=0;seed<16;seed++){
    const {s,st}=await create();s.init(1024,32768,seed,2);const hash=s.state_hash();
    assert.ok(st[16]!==st[32]||st[17]!==st[33]);starts.add(`${st[16]},${st[17]}`);
    s.init(1024,32768,seed,2);assert.equal(s.state_hash(),hash);
  }
  assert.equal(starts.size,4);
});
test('maximum-speed flight hits the pillar before entering solid terrain',async()=>{const {s,st}=await create();approach(st);st[16]=1420*Q;st[17]=1000*Q;st[18]=64*Q;step(s);assert.equal(st[23],0);assert.ok(st[16]<=1434*Q);assert.equal(st[27],-1);});
test('cave snapshots restore grounded and respawn futures exactly',async()=>{const {s,st}=await create();approach(st);st[20]=2048;step(s);s.save_state(65536);const before=s.state_hash();step(s,0,121);const after=s.state_hash();assert.equal(s.load_state(65536,8512),1);assert.equal(s.state_hash(),before);step(s,0,121);assert.equal(s.state_hash(),after);});
for(const [name,index,limit]of [['leftward speed',18,52428],['counterclockwise spin',21,8],['wrapped orientation',20,114]]) {
  for(const delta of [-1,0,1])test(`landing ${name} magnitude limit ${delta}`,async()=>{
    const {s,st}=await create();approach(st);st[index]=index===20?4096-(limit+delta):-(limit+delta+(index===21?8:0));if(index===18)st[index]+=Math.trunc(st[index]/511);step(s);assert.equal(st[23],delta<=0?3:0);
  });
}
test('contact from below cannot land',async()=>{const {s,st}=await create();approach(st);st[17]=1710*Q;st[19]=-30000;step(s);assert.equal(st[23],0);assert.equal(st[24],0);});
test('zero fuel in flight disables thrust but permits counter-steering',async()=>{const {s,st}=await create();approach(st);st[17]=1400*Q;st[19]=0;st[22]=0;step(s,5);assert.equal(st[19],3597);assert.equal(st[21],4);assert.equal(st[22],0);});
test('empty grounded tank refuels while grounded rotation stays suppressed',async()=>{const {s,st}=await create();st[22]=0;step(s,4);assert.equal(st[22],6);assert.equal(st[21],0);assert.equal(st[24],1);});
test('invalid map bytes and floating grounded snapshots are rejected',async()=>{const {s}=await create();s.save_state(65536);new DataView(s.memory.buffer).setInt32(65536+64+4,1200*Q,true);assert.equal(s.load_state(65536,8512),0);new DataView(s.memory.buffer).setInt32(33792,0,true);assert.equal(s.init(1024,32768,0,2),0);});
