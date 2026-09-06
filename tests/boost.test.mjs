import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const binary=await readFile('public/simulation.wasm'),Q=65536;
async function create(map=0){const {instance}=await WebAssembly.instantiate(binary);const s=instance.exports;s.init(1024,map,0,2);return {s,st:new Int32Array(s.memory.buffer,4096,2128)};}
function step({s},buttons=0,n=1,player=0){const input=new Uint8Array(s.memory.buffer,2048,2);input.fill(0);input[player]=buttons;for(let i=0;i<n;i++)assert.equal(s.step(2048,1),1);}
test('boost launches independently of thrust with fourfold acceleration and extra fuel cost',async()=>{
 const game=await create();step(game,16);assert.equal(game.st[19],3600-43200);assert.equal(game.st[22],6000-122);assert.equal(game.st[29],18);
 const pad=await create(32769);step(pad,16);assert.equal(pad.st[24],0);assert.ok(pad.st[19]<-39000);
});
test('boost lasts 18 ticks, continues after release, and requires a new press after recharge',async()=>{
 const game=await create();step(game,16);step(game,0,17);assert.equal(game.st[29],1);step(game);assert.equal(game.st[29],0);
 step(game,16);assert.equal(game.st[29],0);step(game,16,280);assert.equal(game.st[30],1);assert.equal(game.st[29],0);step(game,16);assert.equal(game.st[30],0);assert.equal(game.st[29],0);
 step(game);step(game,16);assert.equal(game.st[29],18);
});
test('insufficient fuel and dead ships cannot boost',async()=>{
 for(const fuel of [0,120]){const game=await create();game.st[22]=fuel;step(game,16);assert.equal(game.st[29],0);assert.equal(game.st[22],fuel);}
 const game=await create();game.st[23]=0;game.st[26]=120;step(game,16);assert.equal(game.st[29],0);
});
test('boost pushes ships inside the exhaust cone much harder for either player and all orientations',async()=>{
 for(const player of [0,1])for(const [angle,dx,dy] of [[0,0,44],[1024,-44,0],[2048,0,-44],[3072,44,0]]){
  const deltas=[];
  for(const buttons of [0,1,16]){const game=await create(),a=16+16*player,b=16+16*(1-player);game.st[a]=0;game.st[a+1]=0;game.st[a+4]=angle;game.st[b]=dx*Q;game.st[b+1]=dy*Q;step(game,buttons,1,player);deltas.push(game.st[b+2]*dx+game.st[b+3]*dy);assert.equal(game.st[b+7],600);}
  assert.ok(deltas[2]-deltas[0]>3.5*(deltas[1]-deltas[0]));
 }
});
test('boost excludes ships outside the cone and behind solid terrain',async()=>{
 for(const [map,x,y,dx,dy,angle] of [[0,1000,1000,0,-44,0],[0,1000,1000,44,44,0],[0,1000,1000,0,100,0],[32768,1068,555,50,-50,2560]]){
  const velocities=[];for(const buttons of [0,16]){const game=await create(map);for(const o of [16,32]){game.st[o+8]=0;game.st[o+12]=0;}game.st[16]=x*Q;game.st[17]=y*Q;game.st[20]=angle;game.st[32]=(x+dx)*Q;game.st[33]=(y+dy)*Q;step(game,buttons);velocities.push([game.st[34],game.st[35]]);}assert.deepEqual(...velocities);
 }
});
test('active boost, recharge and held-key latch restore exactly from snapshots',async()=>{
 const game=await create();step(game,16);step(game,16,4);game.s.save_state(65536);step(game,16,130);const hash=game.s.state_hash();assert.equal(game.s.load_state(65536,8512),1);step(game,16,130);assert.equal(game.s.state_hash(),hash);
});
