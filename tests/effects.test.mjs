import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Effects,MAX_FRAGMENTS,FRAGMENT_STRIDE} from '../src/effects.ts';
function eventFrame(count=1){const frame=new Int32Array(2129+count*8);frame[0]=20;frame[2128]=count;for(let i=0;i<count;i++)frame.set([19,i,0,2,100*65536,200*65536,0,0],2129+i*8);return frame;}
test('rollback events produce one cosmetic burst, expire, and do not alter the frame',()=>{
  const effects=new Effects(()=>({sound:false,particles:true})),frame=eventFrame(),copy=frame.slice(),buffer=new Float32Array(2048);
  effects.consume(frame,1000);effects.consume(frame,1000);
  assert.equal(effects.write(buffer,0,1000),8);
  assert.equal(effects.write(buffer,0,1300),0);
  assert.deepEqual(frame,copy);
  effects.clear();effects.consume(frame,1400);assert.equal(effects.write(buffer,0,1400),8);
});
test('cosmetic bursts are bounded and reduced motion clears existing particles',()=>{
  let particles=true;const effects=new Effects(()=>({sound:false,particles})),buffer=new Float32Array(2048);
  effects.consume(eventFrame(512),1000);assert.equal(effects.write(buffer,0,1000),512);
  particles=false;assert.equal(effects.write(buffer,0,1000),0);
  particles=true;assert.equal(effects.write(buffer,0,1000),0);
});
test('canonical debris renders once, fades after three seconds and clears on reset',()=>{
  const effects=new Effects(()=>({sound:false,particles:true})),frame=eventFrame(2),buffer=new Float32Array(MAX_FRAGMENTS*FRAGMENT_STRIDE);
  frame[2132]=4;frame[2140]=5;frame[2143]=1;
  for(let i=0;i<32;i++)frame.set([100*65536,200*65536,0,0,186,i<16?0:1,i+1,0x10000000|(i%16)],80+i*8);
  const copy=frame.slice();effects.consume(frame,1000);effects.consume(frame,1000);
  assert.equal(effects.write(new Float32Array(2048),0,1000),0);
  assert.equal(effects.writeFragments(buffer,1000),32);assert.equal(buffer[5],1);
  assert.equal(buffer[16*FRAGMENT_STRIDE+4],1);assert.deepEqual(frame,copy);
  frame[84]=6;effects.writeFragments(buffer,4000);assert.equal(buffer[5],1);
  frame[84]=3;effects.writeFragments(buffer,4050);assert.equal(buffer[5],.5);
  frame[84]=0;assert.equal(effects.writeFragments(buffer,4100),31);
  effects.clear();assert.equal(effects.writeFragments(buffer),0);
});
test('gameplay debris stays visible when cosmetic particles are disabled',()=>{
  const effects=new Effects(()=>({sound:false,particles:false})),frame=eventFrame(0),buffer=new Float32Array(MAX_FRAGMENTS*FRAGMENT_STRIDE);
  frame.set([100*65536,200*65536,0,0,186,0,1,0x10000000],80);
  effects.consume(frame);assert.equal(effects.writeFragments(buffer),1);
});
test('thrust loops once while held and stops for release, empty fuel, death, mute and reset',()=>{
  const original=globalThis.AudioContext,sources=[];
  class Node {
    gain={value:0,cancelScheduledValues(){},setTargetAtTime(){}};
    frequency={value:0};Q={value:0};
    connect(){} disconnect(){} start(){this.started=true;} stop(){this.stopped=true;}
  }
  globalThis.AudioContext=class {
    state='running';currentTime=0;sampleRate=100;
    createGain(){return new Node();}
    createBuffer(){return {getChannelData:()=>new Float32Array(100)};}
    createBufferSource(){const node=new Node();sources.push(node);return node;}
    createOscillator(){return new Node();}
    createBiquadFilter(){return new Node();}
    resume(){return Promise.resolve();}
  };
  try{
    let sound=true;
    const effects=new Effects(()=>({sound,particles:false})),frame=eventFrame(0);
    frame[1]=-1;frame[22]=100;frame[23]=3;
    effects.unlock();effects.thrust(frame,[1,0]);effects.thrust(frame,[1,0]);
    assert.equal(sources.length,1);assert.equal(sources[0].started,true);assert.equal(sources[0].stopped,undefined);
    effects.thrust(frame,[0,0]);assert.equal(sources[0].stopped,true);
    effects.thrust(frame,[1,0]);frame[22]=0;effects.thrust(frame,[1,0]);assert.equal(sources.at(-1).stopped,true);
    frame[22]=100;effects.thrust(frame,[1,0]);frame[23]=0;effects.thrust(frame,[1,0]);assert.equal(sources.at(-1).stopped,true);
    frame[23]=3;effects.thrust(frame,[1,0]);sound=false;effects.unlock();assert.equal(sources.at(-1).stopped,true);
    const count=sources.length;effects.thrust(frame,[1,0]);assert.equal(sources.length,count);
    sound=true;effects.thrust(frame,[1,0]);effects.clear();assert.equal(sources.at(-1).stopped,true);
    effects.thrust(frame,[1,0]);frame[1]=0;effects.thrust(frame,[1,0]);assert.equal(sources.at(-1).stopped,true);
  }finally{globalThis.AudioContext=original;}
});
test('combat destruction and crashes play one blast each, respect mute, and release audio nodes',()=>{
  const original=globalThis.AudioContext,blasts=[],booms=[];
  class Node {
    gain={value:0,setValueAtTime(){},exponentialRampToValueAtTime(){}};
    frequency={setValueAtTime(){},exponentialRampToValueAtTime(){}};Q={value:0};
    connect(){} disconnect(){this.disconnected=true;}
    start(time){this.started=time;} stop(time){this.stopped=time;}
  }
  globalThis.AudioContext=class {
    state='running';currentTime=1;sampleRate=100;
    createGain(){return new Node();}
    createBuffer(_,length){return {getChannelData:()=>new Float32Array(length)};}
    createBufferSource(){const node=new Node();blasts.push(node);return node;}
    createOscillator(){const node=new Node();booms.push(node);return node;}
    createBiquadFilter(){return new Node();}
    resume(){return Promise.resolve();}
  };
  try{
    let sound=true;
    const effects=new Effects(()=>({sound,particles:false})),frame=eventFrame(2);
    frame[2132]=4;frame[2140]=5;
    effects.unlock();effects.consume(frame);effects.consume(frame);
    assert.equal(blasts.length,2);assert.equal(booms.length,2);
    for(const node of [...blasts,...booms]){
      assert.equal(node.started,1);assert.ok(node.stopped>1.5);
      node.onended();assert.equal(node.disconnected,true);
    }
    effects.clear();sound=false;effects.consume(frame);
    assert.equal(blasts.length,2);assert.equal(booms.length,2);
    effects.clear();sound=true;effects.consume(frame);
    assert.equal(blasts.length,4);
  }finally{globalThis.AudioContext=original;}
});
