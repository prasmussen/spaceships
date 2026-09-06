import type {Engine} from './engine.ts';
export type Pair=readonly [number,number];
export class ProtocolError extends Error {}
/** Tick means next tick to simulate. Frontiers are inclusive input ticks. */
export class Rollback {
  tick=0;
  complete=1;
  peerAck=1;
  rollbacks=0;
  maxDepth=0;
  stalls=0;
  frozen=false;
  readonly input:[Map<number,number>,Map<number,number>]=[new Map([[0,0],[1,0]]),new Map([[0,0],[1,0]])];
  readonly executed=new Map<number,Pair>();
  readonly snapshots=new Map<number,Uint8Array>();
  readonly hashes=new Map<number,string>();
  readonly player:number;
  readonly engine:Engine;
  private events:((frame:Int32Array)=>void)|undefined;
  constructor(engine:Engine,player:number,events?: (frame:Int32Array)=>void){this.events=events;if(player!==0&&player!==1)throw Error('Invalid player');this.engine=engine;this.player=player;this.snapshots.set(0,engine.save());}
  get agreed(){return Math.min(this.complete,this.peerAck);}
  receive(player:number,tick:number,buttons:number){
    if(player!==1-this.player || !Number.isInteger(tick) || tick<0 || tick>this.tick+120 || !Number.isInteger(buttons)||buttons<0||buttons>31)throw new ProtocolError('Invalid input ownership, tick window or buttons');
    const old=this.input[player].get(tick);
    if(old!==undefined){if(old!==buttons)throw new ProtocolError('Conflicting submitted input');return;}
    if(tick<this.tick-120)throw new ProtocolError('Input outside retained rollback history');
    this.input[player].set(tick,buttons);this.updateComplete();
    if(tick<this.tick && this.executed.get(tick)?.[player]!==buttons)this.replay(tick);
  }
  acknowledge(tick:number){
    if(!Number.isInteger(tick)||tick<1||tick>this.tick+120)throw new ProtocolError('Invalid acknowledgement');
    this.peerAck=Math.max(this.peerAck,tick);
  }
  private updateComplete(){while(this.input[0].has(this.complete+1)&&this.input[1].has(this.complete+1))this.complete++;}
  /** Called at fixed scheduling cadence. A stalled tick never creates extra commands. */
  advance(buttons:number){
    if(!Number.isInteger(buttons)||buttons<0||buttons>31)throw new ProtocolError('Invalid local buttons');
    if(this.frozen)return false;
    const commandTick=this.tick+2;
    if(!this.input[this.player].has(commandTick))this.input[this.player].set(commandTick,buttons);
    this.updateComplete();
    if(this.tick>this.agreed+12){this.stalls++;return false;}
    this.execute();
    for(const t of this.snapshots.keys())if(t<this.tick-120)this.snapshots.delete(t);
    return true;
  }
  private execute(){
    const previous=this.executed.get(this.tick-1)??[0,0];
    const pair:Pair=[this.input[0].get(this.tick)??previous[0],this.input[1].get(this.tick)??previous[1]];
    this.snapshots.set(this.tick,this.engine.save());this.executed.set(this.tick,pair);
    this.engine.step(pair);if(this.events)this.events(this.engine.frame());this.hashes.set(this.tick,this.engine.hash());this.tick++;
    this.snapshots.set(this.tick,this.engine.save());
  }
  private replay(from:number){
    const snapshot=this.snapshots.get(from);if(!snapshot)throw new ProtocolError('Rollback snapshot unavailable');
    const present=this.tick;this.maxDepth=Math.max(this.maxDepth,present-from);this.rollbacks++;
    this.engine.load(snapshot);this.tick=from;while(this.tick<present)this.execute();
  }
  restoreConfirmed(tick:number,snapshot:Uint8Array){
    if(!Number.isInteger(tick)||tick<0||tick>this.agreed||tick>=this.tick)throw new ProtocolError('Recovery requires an agreed simulated tick');
    if(snapshot.length!==8384)throw new ProtocolError('Invalid recovery size');
    const view=new DataView(snapshot.buffer,snapshot.byteOffset,snapshot.byteLength);
    if(view.getInt32(4,true)<0?view.getUint32(0,true)!==tick+1:view.getUint32(0,true)>tick+1)throw new ProtocolError('Recovery snapshot tick mismatch');
    const present=this.tick;this.engine.load(snapshot);this.tick=tick+1;
    this.hashes.set(tick,this.engine.hash());this.snapshots.set(this.tick,this.engine.save());
    while(this.tick<present)this.execute();
  }
  hashAt(tick:number){if(tick>this.agreed||tick>=this.tick)throw new ProtocolError('Cannot hash speculative or unsimulated state');const hash=this.hashes.get(tick);if(hash===undefined)throw new ProtocolError('Hash unavailable');return hash;}
  confirmedInputs(){const pairs:Pair[]=[];for(let t=0;t<=Math.min(this.agreed,this.tick-1);t++){const a=this.input[0].get(t),b=this.input[1].get(t);if(a===undefined||b===undefined)throw Error('Incomplete replay');pairs.push([a,b]);}return pairs;}
}
