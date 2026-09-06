import {Engine} from './engine.ts';
import {Rollback,ProtocolError} from './rollback.ts';
import {DesyncMonitor} from './desync.ts';
import {encodeInput,decodeInput,decodeControl} from './protocol.ts';
import type {Control} from './protocol.ts';
import type {Identity} from './replay.ts';
import {recordReplay} from './replay.ts';
export interface MatchConfig {id:string;epoch:number;seed:number;identity:Identity;inputDelay:number;recoveryPeer:number;region:string}
export interface SessionOutput {gameplay:(buffer:ArrayBuffer)=>void;control:(message:Control)=>void;diagnostic:(value:unknown)=>void}
/** Pure networking/simulation orchestration. Wall-clock scheduling and transport stay outside. */
export class NetworkSession {
  readonly peer:Rollback;
  readonly monitor:DesyncMonitor;
  readonly match:MatchConfig;
  readonly output:SessionOutput;
  private remoteHashes=new Map<number,string>();
  private compared=new Set<number>();
  private lastHash=-1;
  private schedules=0;
  private events:number[]=[];
  private pendingRecovery:Extract<Control,{type:'recover'}>|undefined;
  private recoveryTick:number|undefined;
  private recovering=false;
  constructor(engine:Engine,slot:number,match:MatchConfig,output:SessionOutput){
    if(match.inputDelay!==2||match.recoveryPeer!==0)throw new ProtocolError('Unsupported match configuration');
    this.peer=new Rollback(engine,slot,frame=>{const records=frame.subarray(2097);if(records.length)this.events.push(...records);if(this.events.length>32768)this.events.splice(0,this.events.length-32768);});this.monitor=new DesyncMonitor(this.peer,match.identity);this.match=match;this.output=output;
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
  gameplay(buffer:ArrayBuffer){
    const packet=decodeInput(buffer,this.match.epoch,1-this.peer.player,this.peer.tick);
    packet.frames.forEach((buttons,i)=>this.peer.receive(packet.sender,packet.start+i,buttons));
    this.peer.acknowledge(packet.ack);this.checkHashes();
  }
  control(raw:string){
    const message=decodeControl(raw),peer=this.peer;
    switch(message.type){
      case 'need':{
        if(message.from<peer.tick-120||message.to>peer.tick+120)throw new ProtocolError('Repair request outside history');
        const frames:number[]=[];for(let tick=message.from;tick<=message.to;tick++){const value=peer.input[peer.player].get(tick);if(value===undefined)break;frames.push(value);}
        if(frames.length)this.output.control({type:'repair',start:message.from,frames,ack:peer.complete});break;
      }
      case 'repair':message.frames.forEach((buttons,i)=>peer.receive(1-peer.player,message.start+i,buttons));peer.acknowledge(message.ack);break;
      case 'hash':
        if(message.tick>peer.tick+120||message.tick<peer.tick-120||(message.tick+1)%60!==0)throw new ProtocolError('Hash outside agreed history');
        if(this.remoteHashes.has(message.tick)&&this.remoteHashes.get(message.tick)!==message.hash)throw new ProtocolError('Conflicting hash report');
        this.remoteHashes.set(message.tick,message.hash);break;
      case 'recover':
        if(peer.player!==1||this.monitor.recoveries||this.pendingRecovery)throw new ProtocolError('Unexpected recovery authority');
        this.pendingRecovery=message;break;
      case 'recovered':
        if(!this.recovering||message.tick!==this.recoveryTick||peer.hashAt(message.tick)!==message.hash)throw new ProtocolError('Recovery acknowledgement mismatch');
        if(peer.player===0)this.output.control(message);
        this.recovering=false;peer.frozen=false;break;
      case 'resume':
        if(message.epoch!==this.match.epoch||Math.abs(message.tick-peer.tick)>120)throw new ProtocolError('Invalid resume timeline');
        peer.acknowledge(message.complete);this.repairMissing();this.sendLatest();break;
      default:throw new ProtocolError('Unexpected simulation control');
    }
    this.checkHashes();
  }
  private repairMissing(){const from=this.peer.complete+1;if(from<=this.peer.tick+1)this.output.control({type:'need',from,to:Math.min(this.peer.tick+1,from+119)});}
  resume(){this.output.control({type:'resume',epoch:this.match.epoch,tick:this.peer.tick,complete:this.peer.complete});this.sendLatest();this.repairMissing();}
  async replay(binary:BufferSource){
    const inputs=this.peer.confirmedInputs();
    if(!inputs.length||inputs.length>216000)throw Error('Recording is empty or exceeds the one-hour replay limit');
    const tick=inputs.length-1,hash=this.peer.hashAt(tick),state=this.peer.snapshots.get(tick+1)?.slice();
    if(!state)throw Error('Confirmed recording state unavailable');
    const replay=await recordReplay(binary,this.match.identity,inputs,32768,this.match.seed);
    const final=replay.checkpoints.at(-1)!;
    if(final.hash!==hash||final.state.some((byte,i)=>byte!==state[i]))throw Error('Recording differs from confirmed state; save the desync diagnostic');
    return replay;
  }
  private checkHashes(){
    const limit=Math.min(this.peer.agreed,this.peer.tick-1);
    for(let tick=this.lastHash+60;tick<=limit;tick+=60){this.output.control({type:'hash',tick,hash:this.peer.hashAt(tick)});this.lastHash=tick;}
    for(const [tick,hash]of this.remoteHashes){
      if(tick>limit||this.compared.has(tick))continue;
      this.compared.add(tick);
      if(!this.monitor.compare(tick,hash)){
        this.output.diagnostic(this.monitor.diagnostic);this.recovering=true;this.recoveryTick=tick;
        if(this.peer.player===0){
          const snapshot=this.peer.snapshots.get(tick+1);if(!snapshot)throw new ProtocolError('Recovery snapshot unavailable');
          this.monitor.recover(tick,snapshot,0);this.peer.frozen=true;
          this.output.control({type:'recover',tick,snapshot:[...snapshot]});
        }
      }
    }
    if(this.pendingRecovery&&this.recovering){
      const m=this.pendingRecovery;
      if(m.tick!==this.recoveryTick)throw new ProtocolError('Recovery tick differs from mismatch');
      if(m.tick<=limit){this.monitor.recover(m.tick,new Uint8Array(m.snapshot),0);this.peer.frozen=true;this.pendingRecovery=undefined;this.output.control({type:'recovered',tick:m.tick,hash:this.peer.hashAt(m.tick)});}
    }
    for(const tick of this.remoteHashes.keys())if(tick<this.peer.tick-120){this.remoteHashes.delete(tick);this.compared.delete(tick);}
  }
  frame(){
    const current=this.peer.engine.frame(),frame=new Int32Array(2097+this.events.length);
    frame.set(current.subarray(0,2096));frame[2096]=this.events.length/8;frame.set(this.events,2097);this.events=[];
    const confirmed=this.peer.snapshots.get(Math.min(this.peer.agreed,this.peer.tick-1)+1);
    if(confirmed){const state=new Int32Array(confirmed.buffer,confirmed.byteOffset,confirmed.byteLength/4);frame[1]=state[1];frame[27]=state[27];frame[43]=state[43];}
    else{frame[1]=-1;frame[27]=0;frame[43]=0;}
    return frame;
  }
}
