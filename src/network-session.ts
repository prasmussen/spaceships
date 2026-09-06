import {Engine} from './engine.ts';
import {Rollback,ProtocolError} from './rollback.ts';
import {DesyncMonitor} from './desync.ts';
import {encodeInput,decodeInput,decodeControl} from './protocol.ts';
import type {Control} from './protocol.ts';
import type {Identity} from './replay.ts';
import {recordReplay} from './replay.ts';
export interface MatchConfig {quick?:boolean;snapshot?:string;slots?:number[];id:string;players:number;epoch:number;seed:number;identity:Identity;inputDelay:number;recoveryPeer:number;region:string}
export interface SessionOutput {gameplay:(buffer:ArrayBuffer)=>void;control:(message:Control,recipient?:number)=>void;diagnostic:(value:unknown)=>void}
/** Pure networking/simulation orchestration. Wall-clock scheduling and transport stay outside. */
export class NetworkSession {
  readonly peer:Rollback;
  readonly monitor:DesyncMonitor;
  readonly match:MatchConfig;
  readonly output:SessionOutput;
  private checkedFinish=-1;
  private finished:Int32Array|undefined;
  private remoteHashes=new Map<number,Map<number,string>>();
  private compared=new Set<number>();
  private recoveryAcks=new Set<number>();
  private requestedRecovery:number|undefined;
  private lastRecoveryTick=-1;
  private lastHash=-1;
  private schedules=0;
  private events:number[]=[];
  private pendingRecovery:Extract<Control,{type:'recover'}>|undefined;
  private recoveryTick:number|undefined;
  private recovering=false;
  constructor(engine:Engine,slot:number,match:MatchConfig,output:SessionOutput){
    if(match.inputDelay!==2||match.recoveryPeer!==0||match.players!==engine.players)throw new ProtocolError('Unsupported match configuration');
    this.peer=new Rollback(engine,slot,frame=>{const records=frame.subarray(2129);if(records.length)this.events.push(...records);if(this.events.length>32768)this.events.splice(0,this.events.length-32768);});this.monitor=new DesyncMonitor(this.peer,match.identity);this.match=match;this.output=output;
  }
  scheduled(buttons:number){
    const advanced=this.peer.advance(buttons);this.schedules++;
    this.sendLatest();
    if(this.schedules%6===0)this.repairMissing();
    this.checkHashes();return advanced;
  }
  private sendLatest(){
    const records=this.peer.input[this.peer.player];const last=this.peer.tick+2;
    let end=last;while(end>1&&!records.has(end))end--;
    const start=Math.max(0,end-7),frames:number[]=[];
    for(let t=start;t<=end;t++){const buttons=records.get(t);if(buttons===undefined)throw Error('Local input gap');frames.push(buttons);}
    this.output.gameplay(encodeInput({epoch:this.match.epoch,sender:this.peer.player,start,ack:this.peer.complete,frames}));
  }
  private remote(sender:number){if(!Number.isInteger(sender)||sender<0||sender>=this.match.players||sender===this.peer.player)throw new ProtocolError('Invalid connection owner');}
  gameplay(buffer:ArrayBuffer,sender:number){
    this.remote(sender);
    const packet=decodeInput(buffer,this.match.epoch,sender,this.peer.tick);
    packet.frames.forEach((buttons,i)=>this.peer.receive(packet.sender,packet.start+i,buttons));
    this.peer.acknowledge(packet.ack,sender);this.checkHashes();
  }
  control(raw:string,sender:number){
    this.remote(sender);
    const message=decodeControl(raw),peer=this.peer;
    switch(message.type){
      case 'need':{
        if(message.from<peer.tick-120||message.to>peer.tick+120)throw new ProtocolError('Repair request outside history');
        const frames:number[]=[];for(let tick=message.from;tick<=message.to;tick++){const value=peer.input[peer.player].get(tick);if(value===undefined)break;frames.push(value);}
        if(frames.length)this.output.control({type:'repair',start:message.from,frames,ack:peer.complete},sender);break;
      }
      case 'repair':message.frames.forEach((buttons,i)=>peer.receive(sender,message.start+i,buttons));peer.acknowledge(message.ack,sender);break;
      case 'hash': {
        if(message.revision<this.monitor.recoveries||message.tick<=this.lastRecoveryTick)break;
        if(message.tick>peer.tick+120||message.tick<peer.tick-120||(message.tick+1)%60!==0)throw new ProtocolError('Hash outside agreed history');
        if(message.revision!==this.monitor.recoveries||this.recovering)break;
        const hashes=this.remoteHashes.get(message.tick)??new Map<number,string>();
        if(hashes.has(sender)&&hashes.get(sender)!==message.hash)throw new ProtocolError('Conflicting hash report');
        hashes.set(sender,message.hash);this.remoteHashes.set(message.tick,hashes);break;
      }
      case 'desync':
        if(peer.player!==0||message.tick>peer.tick+120||message.tick<peer.tick-120||(message.tick+1)%60!==0)throw new ProtocolError('Invalid desync request');
        if(message.tick<=this.lastRecoveryTick||this.recovering)break;
        this.requestedRecovery=message.tick;break;
      case 'recover':
        if(sender!==0||peer.player===0||this.monitor.recoveries||this.pendingRecovery)throw new ProtocolError('Unexpected recovery authority');
        if(message.tick>peer.tick+120||message.tick<peer.tick-120||(message.tick+1)%60!==0)throw new ProtocolError('Recovery outside history');
        this.pendingRecovery=message;break;
      case 'recovered':
        if(peer.player!==0||!this.recovering||message.tick!==this.recoveryTick||peer.hashAt(message.tick)!==message.hash||this.recoveryAcks.has(sender))throw new ProtocolError('Recovery acknowledgement mismatch');
        this.recoveryAcks.add(sender);
        if(this.recoveryAcks.size===this.match.players-1){this.output.control({type:'recoveryDone',tick:message.tick});this.finishRecovery(message.tick);}
        break;
      case 'recoveryDone':
        if(sender!==0||!this.recovering||this.pendingRecovery||message.tick!==this.recoveryTick||this.monitor.recoveries!==1)throw new ProtocolError('Unexpected recovery completion');
        this.finishRecovery(message.tick);break;
      case 'resume':
        if(message.epoch!==this.match.epoch||Math.abs(message.tick-peer.tick)>120)throw new ProtocolError('Invalid resume timeline');
        peer.acknowledge(message.complete,sender);this.repairMissing();this.sendLatest();break;
      default:throw new ProtocolError('Unexpected simulation control');
    }
    this.checkHashes();
  }
  private repairMissing(){for(let sender=0;sender<this.match.players;sender++){if(sender===this.peer.player)continue;let from=this.peer.complete+1;while(from<=this.peer.tick+1&&this.peer.input[sender].has(from))from++;if(from<=this.peer.tick+1)this.output.control({type:'need',from,to:Math.min(this.peer.tick+1,from+119)},sender);}}
  resume(){this.output.control({type:'resume',epoch:this.match.epoch,tick:this.peer.tick,complete:this.peer.complete});this.sendLatest();this.repairMissing();}
  async replay(binary:BufferSource){
    if(this.match.snapshot)throw Error('Replay export is unavailable for a room joined mid-round');
    const inputs=this.peer.confirmedInputs();
    if(!inputs.length||inputs.length>216000)throw Error('Recording is empty or exceeds the one-hour replay limit');
    const tick=inputs.length-1,hash=this.peer.hashAt(tick),state=this.peer.snapshots.get(tick+1)?.slice();
    if(!state)throw Error('Confirmed recording state unavailable');
    const replay=await recordReplay(binary,this.match.identity,inputs,32768,this.match.seed,this.match.players);
    const final=replay.checkpoints.at(-1)!;
    if(final.hash!==hash||final.state.some((byte,i)=>byte!==state[i]))throw Error('Recording differs from confirmed state; save the desync diagnostic');
    return replay;
  }
  private finishRecovery(tick:number){
    this.lastRecoveryTick=tick;this.recovering=false;this.peer.frozen=false;
    this.remoteHashes.clear();this.compared.clear();this.lastHash=tick;
  }
  private checkHashes(){
    const limit=Math.min(this.peer.agreed,this.peer.tick-1);
    if(this.pendingRecovery&&this.pendingRecovery.tick<=limit){
      const m=this.pendingRecovery;this.peer.frozen=true;this.recovering=true;this.recoveryTick=m.tick;
      this.monitor.recover(m.tick,new Uint8Array(m.snapshot),0);this.peer.frozen=true;this.pendingRecovery=undefined;
      this.output.control({type:'recovered',tick:m.tick,hash:this.peer.hashAt(m.tick)},0);
    }
    if(this.recovering)return;
    for(let tick=this.lastHash+60;tick<=limit;tick+=60){this.output.control({type:'hash',tick,hash:this.peer.hashAt(tick),revision:this.monitor.recoveries});this.lastHash=tick;}
    for(const [tick,hashes] of this.remoteHashes){
      if(tick>limit||this.compared.has(tick)||hashes.size!==this.match.players-1)continue;
      this.compared.add(tick);
      for(const hash of hashes.values())if(!this.monitor.compare(tick,hash)){
        this.output.diagnostic(this.monitor.diagnostic);
        if(this.peer.player===0)this.requestedRecovery=tick;
        else{this.recovering=true;this.recoveryTick=tick;this.output.control({type:'desync',tick},0);}
        break;
      }
      if(this.requestedRecovery!==undefined||this.recovering)break;
    }
    if(this.peer.player===0&&this.requestedRecovery!==undefined&&this.requestedRecovery<=limit){
      const tick=this.requestedRecovery;this.requestedRecovery=undefined;
      if(this.monitor.recoveries)throw new ProtocolError('Repeated desync; match aborted');
      const snapshot=this.peer.snapshots.get(tick+1);if(!snapshot)throw new ProtocolError('Recovery snapshot unavailable');
      this.peer.frozen=true;this.monitor.recover(tick,snapshot,0);this.peer.frozen=true;
      this.recovering=true;this.recoveryTick=tick;this.recoveryAcks.clear();
      this.output.control({type:'recover',tick,snapshot:[...snapshot]});
    }
    for(const tick of this.remoteHashes.keys())if(tick<this.peer.tick-120){this.remoteHashes.delete(tick);this.compared.delete(tick);}
  }
  frame(){
    const current=this.peer.engine.frame(),frame=new Int32Array(2129+this.events.length);
    frame.set(current.subarray(0,2128));frame[2128]=this.events.length/8;frame.set(this.events,2129);this.events=[];
    const limit=Math.min(this.peer.agreed,this.peer.tick-1);
    if(this.match.quick&&!this.finished){
      for(let tick=this.checkedFinish+1;tick<=limit;tick++){
        const snapshot=this.peer.snapshots.get(tick+1);if(!snapshot)continue;
        const state=new Int32Array(snapshot.buffer,snapshot.byteOffset,snapshot.byteLength/4);
        if(Array.from({length:this.match.players},(_,id)=>state[27+id*16]).some(score=>score>=5)){this.finished=state.slice();break;}
      }
      this.checkedFinish=limit;
    }
    const confirmed=this.finished?new Uint8Array(this.finished.buffer):this.peer.snapshots.get(limit+1);
    if(confirmed){const state=new Int32Array(confirmed.buffer,confirmed.byteOffset,confirmed.byteLength/4);frame[1]=state[1];for(let id=0;id<this.match.players;id++)frame[27+id*16]=state[27+id*16];}
    else{frame[1]=-1;for(let id=0;id<this.match.players;id++)frame[27+id*16]=0;}
    return frame;
  }
}
