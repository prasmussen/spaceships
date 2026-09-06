import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {Engine} from '../src/engine.ts';
import {ComputerPilot} from '../src/computer-pilot.ts';

const binary=await readFile('public/simulation.wasm');
test('computer patrol repeats after reset and survives multiple refueling circuits',async()=>{
  const engine=await Engine.create(binary,32769),pilot=new ComputerPilot();
  let firstHash;
  for(let run=0;run<2;run++){
    engine.wasm.init(1024,32769,0,2);pilot.reset();
    let left=false,right=false,fired=false,landings=0,grounded=true;
    for(let tick=0;tick<10000;tick++){
      const bits=pilot.input(engine.frame());
      assert.equal(bits&~15,0);
      fired||=Boolean(bits&8);
      engine.step([0,bits]);
      const state=engine.frame();
      left||=state[32]<1150*65536;
      right||=left&&state[32]>2700*65536;
      if(state[40]&&!grounded)landings++;
      grounded=Boolean(state[40]);
      assert.equal(state[39],3,'patrol must not crash');
      assert.ok(state[38]>0,'patrol must refuel before running dry');
    }
    assert.ok(left&&right&&fired);
    assert.ok(landings>=3,'returns to the pad repeatedly');
    if(run===0)firstHash=engine.hash();else assert.equal(engine.hash(),firstHash);
  }
});

test('computer stays inactive outside the arena and restarts its route after death',async()=>{
  const pilot=new ComputerPilot(),cave=await Engine.create(binary);
  assert.equal(pilot.input(cave.frame()),0);
  const arena=await Engine.create(binary,32769);
  for(let tick=0;tick<500;tick++)arena.step([0,pilot.input(arena.frame())]);
  const dead=arena.frame();dead[39]=0;
  assert.equal(pilot.input(dead),0);
  arena.wasm.init(1024,32769,0,2);
  const fresh=new ComputerPilot();
  for(let tick=0;tick<500;tick++){
    const frame=arena.frame(),bits=pilot.input(frame);
    assert.equal(bits,fresh.input(frame));arena.step([0,bits]);
  }
  const finished=arena.frame();finished[1]=0;
  assert.equal(pilot.input(finished),0);
});

test('computer can patrol and refuel from every randomized starting pad',async()=>{
  for(let seed=0;seed<4;seed++){
    const engine=await Engine.create(binary,32769,seed),pilot=new ComputerPilot();
    let airborne=false,landed=false;
    for(let tick=0;tick<4000;tick++){
      engine.step([0,pilot.input(engine.frame())]);const state=engine.frame();
      assert.equal(state[39],3,`seed ${seed} must survive`);
      assert.ok(state[38]>0,`seed ${seed} must retain fuel`);
      if(!state[40])airborne=true;else if(airborne)landed=true;
    }
    assert.ok(landed,`seed ${seed} must complete a refueling circuit`);
  }
});
