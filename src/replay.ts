import {Engine,STATE_BYTES} from './engine.ts';
import type {Pair} from './rollback.ts';
export interface Identity {protocol:number;abi:number;wasm:string;map:string;config:string}
export interface Replay {version:1;identity:Identity;seed:number;mapMode:number;initial:number[];inputs:Pair[];checkpoints:{tick:number;hash:string;state:number[]}[]}
export function checkReplay(value:unknown,identity:Identity):asserts value is Replay {
  const r=value as Replay;
  if(!r||r.version!==1||!r.identity||['protocol','abi','wasm','map','config'].some(key=>r.identity[key as keyof Identity]!==identity[key as keyof Identity]))throw Error('Replay build, map or configuration mismatch');
  if(!Number.isInteger(r.seed)||r.seed<0||r.seed>0xffffffff||![0,32768].includes(r.mapMode)||!Array.isArray(r.inputs)||r.inputs.length>216000)throw Error('Invalid replay bounds');
  const snapshot=(v:unknown)=>Array.isArray(v)&&v.length===STATE_BYTES&&v.every(b=>Number.isInteger(b)&&b>=0&&b<=255);
  if(!snapshot(r.initial)||!r.inputs.every(pair=>Array.isArray(pair)&&pair.length===2&&pair.every(b=>Number.isInteger(b)&&b>=0&&b<=15)))throw Error('Invalid replay state or inputs');
  if(!Array.isArray(r.checkpoints)||r.checkpoints.length>3601)throw Error('Invalid checkpoint count');
  let previous=0;
  for(const cp of r.checkpoints){if(!cp||!Number.isInteger(cp.tick)||cp.tick<=previous||cp.tick>r.inputs.length||typeof cp.hash!=='string'||!/^[-]?\d{1,20}$/.test(cp.hash)||!snapshot(cp.state))throw Error('Invalid checkpoint');previous=cp.tick;}
}
export async function recordReplay(binary:BufferSource,identity:Identity,inputs:Pair[],mapMode=32768,seed=0):Promise<Replay>{
  const engine=await Engine.create(binary,mapMode,seed);
  const replay:Replay={version:1,identity,seed,mapMode,initial:[...engine.save()],inputs,checkpoints:[]};
  for(let tick=0;tick<inputs.length;tick++){engine.step(inputs[tick]);if((tick+1)%60===0||tick+1===inputs.length)replay.checkpoints.push({tick:tick+1,hash:engine.hash(),state:[...engine.save()]});}
  return replay;
}
export class ReplayPlayer {
  readonly engine:Engine;
  readonly replay:Replay;
  tick=0;
  constructor(engine:Engine,replay:Replay){this.engine=engine;this.replay=replay;this.engine.load(new Uint8Array(replay.initial));}
  seek(tick:number){
    if(!Number.isInteger(tick)||tick<0||tick>this.replay.inputs.length)throw Error('Invalid replay tick');
    const checkpoint=this.replay.checkpoints.findLast(cp=>cp.tick<=tick);
    this.engine.load(new Uint8Array(checkpoint?.state??this.replay.initial));
    if(checkpoint&&this.engine.hash()!==checkpoint.hash)throw Error('Corrupt replay checkpoint');
    this.tick=checkpoint?.tick??0;
    while(this.tick<tick)this.engine.step(this.replay.inputs[this.tick++]);
    return this.engine.frame();
  }
  async validate(){
    const {replay,engine}=this;
    engine.wasm.init(1024,replay.mapMode,replay.seed);
    if([...engine.save()].some((value,i)=>value!==replay.initial[i]))throw Error('Replay initial state differs from match configuration');
    let index=0;
    for(let t=0;t<replay.inputs.length;t++){
      engine.step(replay.inputs[t]);const cp=replay.checkpoints[index];
      if(cp?.tick===t+1){if(engine.hash()!==cp.hash||[...engine.save()].some((value,i)=>value!==cp.state[i]))throw Error(`Replay diverges at tick ${t+1}`);index++;}
    }
    this.tick=replay.inputs.length;return engine.hash();
  }
}
