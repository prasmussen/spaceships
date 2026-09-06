import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const binary=await readFile('public/simulation.wasm'),Q=65536;
async function create({angle=0,dx=0,dy=44,map=0,source=0}={}){
  const {instance}=await WebAssembly.instantiate(binary),s=instance.exports;s.init(1024,map,0,2);
  const st=new Int32Array(s.memory.buffer,4096,2128),a=16+source*16,b=16+(1-source)*16;
  for(const o of [16,32]){st[o+8]=0;st[o+12]=0;st[o+2]=0;st[o+3]=0;}
  st[a]=1000*Q;st[a+1]=1000*Q;st[a+4]=angle;st[b]=(1000+dx)*Q;st[b+1]=(1000+dy)*Q;
  return {s,st,a,b,source};
}
function step({s,source},thrust=1,n=1){const input=new Uint8Array(s.memory.buffer,2048,2);input.fill(0);input[source]=thrust;for(let i=0;i<n;i++)s.step(2048,1);}
async function delta(options={}){const active=await create(options),idle=await create(options);step(active);step(idle,0);const b=active.b;assert.equal(active.st[b+7],3);return [active.st[b+2]-idle.st[b+2],active.st[b+3]-idle.st[b+3]];}
test('exhaust pushes behind the thruster in all four orientations for either player',async()=>{
  for(const source of [0,1])for(const [angle,dx,dy]of [[0,0,44],[1024,-44,0],[2048,0,-44],[3072,44,0]]){
    const [vx,vy]=await delta({angle,dx,dy,source});assert.ok(vx*dx+vy*dy>0);
    assert.equal(dx===0?vx:vy,0);
  }
});
test('exhaust force falls off with distance and lateral separation',async()=>{
  const near=await delta(),far=await delta({dy:70}),edge=await delta({dx:20});
  assert.ok(near[1]>far[1]&&far[1]>0);assert.ok(near[1]>edge[1]&&edge[1]>0);
});
test('ships ahead, beside or beyond exhaust range receive no force',async()=>{
  for(const options of [{dy:-44},{dx:44,dy:0},{dx:44,dy:44},{dy:100}])assert.deepEqual(await delta(options),[0,0]);
});
test('empty tanks, dead emitters, dead targets do not receive exhaust force',async()=>{
  for(const kind of ['fuel','source','target']){
    const active=await create(),idle=await create();
    for(const game of [active,idle]){
      if(kind==='fuel')game.st[game.a+6]=0;
      if(kind==='source'){game.st[game.a+7]=0;game.st[game.a+10]=120;}
      if(kind==='target'){game.st[game.b+7]=0;game.st[game.b+10]=120;}
    }
    step(active);step(idle,0);assert.equal(active.st[active.b+2],idle.st[idle.b+2]);assert.equal(active.st[active.b+3],idle.st[idle.b+3]);
  }
});
test('cave corners block exhaust even when the target is in range',async()=>{
  const games=[];
  for(const map of [0,32768])for(const thrust of [0,1]){
    const game=await create({map,angle:2560,dx:50,dy:-50});game.st[16]=1430*Q;game.st[17]=730*Q;game.st[32]=1480*Q;game.st[33]=680*Q;
    step(game,thrust);assert.equal(game.st[23],3);assert.equal(game.st[39],3);games.push(game.st[34]);
  }
  assert.ok(games[1]>games[0]);assert.equal(games[2],games[3]);
});
test('exhaust forces reproduce exactly after snapshot restoration',async()=>{
  const game=await create();game.s.save_state(65536);step(game,1,20);const hash=game.s.state_hash();
  assert.equal(game.s.load_state(65536,8512),1);step(game,1,20);assert.equal(game.s.state_hash(),hash);
});
test('angled exhaust gently slides a protected ship along its own pad in either direction',async()=>{
  for(const direction of [-1,1]){
    const game=await create({map:32769,source:1});const {st,s,a,b}=game;
    st[b]=450*Q;st[b+1]=1684*Q-1;st[b+8]=1;st[b+12]=90;st[b+6]=3000;
    st[a]=(450-direction*40)*Q;st[a+1]=1668*Q;st[a+4]=direction<0?768:3328;
    s.save_state(65536);step(game,1,10);
    assert.ok((st[b]-450*Q)*direction>8*Q);assert.ok(Math.abs(st[b]/Q-450)<20);
    assert.equal(st[b+8],1);assert.equal(st[b+1],1684*Q-1);assert.equal(st[b+7],3);assert.ok(st[b+6]>3000);
    const hash=s.state_hash();assert.equal(s.load_state(65536,8512),1);step(game,1,10);assert.equal(s.state_hash(),hash);
    s.save_state(65536);assert.equal(s.load_state(65536,8512),1);
  }
});
test('straight downward exhaust cannot push a parked ship through its pad',async()=>{
  const game=await create({map:32769,source:1}),{st,a,b}=game;
  st[b]=450*Q;st[b+1]=1684*Q-1;st[b+8]=1;st[a]=450*Q;st[a+1]=1640*Q;st[a+4]=0;
  step(game,1,30);assert.ok(st[b]>465*Q);assert.equal(st[b+1],1684*Q-1);assert.equal(st[b+8],1);assert.equal(st[b+7],3);
});

test('off-center upright exhaust visibly nudges a parked ship away from the jet',async()=>{
  for(const direction of [-1,1]){
    const game=await create({map:32769,source:1}),{st,a,b}=game;
    st[b]=450*Q;st[b+1]=1684*Q-1;st[b+8]=1;st[a]=(450-direction*10)*Q;st[a+1]=1640*Q;st[a+4]=0;
    step(game,1,30);
    assert.ok((st[b]-450*Q)*direction>15*Q);assert.equal(st[b+8],1);assert.equal(st[b+7],3);assert.equal(st[b+1],1684*Q-1);
  }
});
test('parked ship continues sliding after a brief blast from the locally controlled ship',async()=>{
  const game=await create({map:32769,source:0}),{st,s,a,b}=game;
  st[b]=2750*Q;st[b+1]=1684*Q-1;st[b+8]=1;st[a]=2740*Q;st[a+1]=1640*Q;st[a+4]=0;
  step(game,1,10);const first=st[b],velocity=st[b+2];assert.ok(velocity>0);
  s.save_state(65536);step(game,0,20);assert.ok(st[b]>first+4*Q);assert.ok(st[b+2]<velocity);assert.equal(st[b+8],1);
  const hash=s.state_hash();assert.equal(s.load_state(65536,8512),1);step(game,0,20);assert.equal(s.state_hash(),hash);
});
