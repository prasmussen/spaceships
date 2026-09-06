import {decodeControl} from './protocol.ts';
import type {Control} from './protocol.ts';
import type {MatchConfig} from './network-session.ts';
import type {Replay} from './replay.ts';
export interface PeerCallbacks {
 signal:(signal:unknown)=>void;
 refreshICE?:()=>Promise<RTCIceServer[]>;
 frame:(data:{inputs:number[];buffer:ArrayBuffer;tick:number;complete:number;agreed:number;stalled:boolean;rollbacks:number;maxDepth:number;stalls:number;desyncs:number})=>void;
 status:(status:string)=>void;
 ended:(reason:string)=>void;
 diagnostic:(bundle:unknown)=>void;
 replay?:(recording:Replay|undefined,error?:string)=>void;
}
/** Main-thread RTC only; all gameplay/prediction lives in the dedicated worker. */
export class PeerMatch {
  readonly pc:RTCPeerConnection;
  readonly worker:Worker;
  readonly match:MatchConfig;
  readonly slot:number;
  readonly callbacks:PeerCallbacks;
  private gameplayChannel:RTCDataChannel|undefined;
  private controlChannel:RTCDataChannel|undefined;
  private candidates:RTCIceCandidateInit[]=[];
  private reliable:string[]=[];
  private reliableBytes=0;
  private signals=Promise.resolve();
  private controls=Promise.resolve();
  private booted:Promise<void>;
  private resolveBoot!:()=>void;
  private hello=false;
  private localReady=false;
  private remoteReady=false;
  private startSent=false;
  private started=false;
  private startAt=0;
  private measured=false;
  private stalledAt:number|undefined;
  private closed=false;
  private replayPending=false;
  private shutdownTimer:ReturnType<typeof setTimeout>|undefined;
  private pingID=0;
  private renewalAt=performance.now()+240000;
  private refreshing:Promise<void>|undefined;
  private offering=false;
  private probes=new Map<number,number>();
  private lastReceived=performance.now();
  private handshakeDeadline=performance.now()+15000;
  private disconnectedAt:number|undefined;
  private incomingWindow=performance.now();
  private incomingCount=0;
  private timer:ReturnType<typeof setInterval>;
  rtt=0;
  relay=false;
  constructor(match:MatchConfig,slot:number,iceServers:RTCIceServer[],callbacks:PeerCallbacks,forceRelay=false){
    this.match=match;this.slot=slot;this.callbacks=callbacks;
    if(slot!==0&&slot!==1)throw Error('Invalid assigned slot');
    this.pc=new RTCPeerConnection({iceServers,iceTransportPolicy:forceRelay?'relay':'all'});
    this.booted=new Promise(resolve=>{this.resolveBoot=resolve});
    this.worker=new Worker(new URL('./online-worker.ts',import.meta.url),{type:'module'});
    this.worker.onmessage=({data})=>{
      if(data.type==='replay'){
        if(this.closed&&!data.finalize)return;
        this.replayPending=false;
        if(this.closed){clearTimeout(this.shutdownTimer);this.worker.terminate();}
        this.callbacks.replay?.(data.recording,data.error);return;
      }
      if(this.closed)return;
      try{
        if(data.type==='booted')this.resolveBoot();
        else if(data.type==='error')this.close(data.message);
        else if(data.type==='gameplay'){
          // Obsolete gameplay is discarded; reliable repair fills any missing gap.
          if(this.gameplayChannel?.readyState==='open'&&this.gameplayChannel.bufferedAmount<4096)this.gameplayChannel.send(data.buffer);
        }else if(data.type==='control')this.sendControl(data.message);
        else if(data.type==='frame'){
          if(data.stalled)this.stalledAt??=performance.now();else this.stalledAt=undefined;
          this.callbacks.frame(data);
        }
        else if(data.type==='diagnostic')this.callbacks.diagnostic(data.bundle);
      }catch(error){this.close(String(error));}
    };
    this.worker.onerror=event=>this.close(event.message);
    this.worker.postMessage({type:'init',match,slot});
    this.pc.onicecandidate=event=>{if(event.candidate)callbacks.signal({candidate:event.candidate.toJSON()});};
    this.pc.ondatachannel=event=>{try{if(slot!==1)throw Error('Unexpected remote DataChannel');this.attach(event.channel);}catch(error){this.close(String(error));}};
    this.pc.onconnectionstatechange=()=>{
      if(this.closed)return;
      if(this.pc.connectionState==='connected'){
        if(this.started){this.worker.postMessage({type:'resume'});callbacks.status('Connected');}
        this.disconnectedAt=undefined;
        void this.statistics();
      }else if(['disconnected','failed'].includes(this.pc.connectionState))this.restart();
    };
    this.timer=setInterval(()=>{
      if(this.closed)return;
      const now=performance.now();
      if(this.stalledAt!==undefined&&now-this.stalledAt>10000){this.close('Disconnected: input synchronization timed out');return;}
      if(this.started&&now-this.lastReceived>1000&&this.disconnectedAt===undefined)this.restart();
      if(this.disconnectedAt!==undefined&&now-this.disconnectedAt>10000){this.close('Disconnected: recovery timed out');return;}
      if(!this.started&&now>this.handshakeDeadline){this.close('Connection handshake timed out');return;}
      if(this.controlChannel?.readyState==='open'){
        const id=++this.pingID;this.probes.set(id,now);this.sendControl({type:'ping',id,sent:now});
        for(const [id,sent]of this.probes)if(now-sent>10000)this.probes.delete(id);
      }
      if(this.started&&this.slot===0&&this.callbacks.refreshICE&&now>=this.renewalAt){this.renewalAt=now+240000;void this.offer(true).catch(error=>this.close(`Relay credential renewal failed: ${String(error)}`));}
      this.flush();
    },500);
    if(slot===0){this.attach(this.pc.createDataChannel('gameplay',{ordered:false,maxRetransmits:0}));this.attach(this.pc.createDataChannel('control',{ordered:true}));void this.offer(false).catch(error=>this.close(String(error)));}
  }
  private attach(channel:RTCDataChannel){
    if(channel.label==='gameplay'&&!this.gameplayChannel&&!channel.ordered&&channel.maxRetransmits===0&&channel.maxPacketLifeTime===null)this.gameplayChannel=channel;
    else if(channel.label==='control'&&!this.controlChannel&&channel.ordered&&channel.maxRetransmits===null&&channel.maxPacketLifeTime===null)this.controlChannel=channel;
    else throw Error('Invalid DataChannel configuration');
    channel.binaryType='arraybuffer';channel.bufferedAmountLowThreshold=8192;
    channel.onbufferedamountlow=()=>this.flush();
    channel.onopen=()=>{
      if(channel.label==='control'){this.sendControl({type:'hello',matchId:this.match.id,epoch:this.match.epoch,slot:this.slot,identity:this.match.identity,inputDelay:2});this.flush();}
    };
    channel.onmessage=event=>{
      if(this.closed)return;
      const now=performance.now();if(now-this.incomingWindow>=1000){this.incomingWindow=now;this.incomingCount=0;}
      if(++this.incomingCount>300){this.close('Peer message rate exceeded');return;}
      this.lastReceived=now;
      if(this.disconnectedAt!==undefined&&this.pc.connectionState==='connected'){this.disconnectedAt=undefined;this.worker.postMessage({type:'resume'});}
      if(channel.label==='gameplay'){
        if(!this.started||!(event.data instanceof ArrayBuffer))return;
        this.worker.postMessage({type:'gameplay',buffer:event.data},[event.data]);
      }else this.controls=this.controls.then(()=>this.control(event.data)).catch(error=>this.close(String(error)));
    };
    channel.onclose=()=>{if(!this.closed)this.restart();};channel.onerror=()=>{if(!this.closed)this.restart();};
  }
  private async control(raw:unknown){
    if(typeof raw!=='string')throw Error('Control channel requires JSON text');
    const message=decodeControl(raw);
    if(message.type==='hello'){
      if(this.hello)throw Error('Duplicate content handshake');
      if(message.matchId!==this.match.id||message.epoch!==this.match.epoch||message.slot!==1-this.slot||(['protocol','abi','wasm','map','config'] as const).some(key=>message.identity[key]!==this.match.identity[key]))throw Error('Peer build or match mismatch');
      this.hello=true;await this.booted;if(this.closed)return;this.localReady=true;this.sendControl({type:'ready'});
      const id=++this.pingID,sent=performance.now();this.probes.set(id,sent);this.sendControl({type:'ping',id,sent});
    }else if(message.type==='ping'){if(!this.hello)throw Error('Probe before hello');this.sendControl({type:'pong',id:message.id,sent:message.sent});}
    else if(message.type==='pong'){
      const sent=this.probes.get(message.id);if(sent===undefined||sent!==message.sent)return;
      this.probes.delete(message.id);this.rtt=performance.now()-sent;this.measured=true;this.startIfReady();
    }else if(message.type==='ready'){
      if(!this.hello||!this.localReady||this.remoteReady)throw Error('Unexpected ready');this.remoteReady=true;
      this.startIfReady();
    }else if(message.type==='start'){
      if(this.slot!==1||!this.localReady||!this.remoteReady||this.started)throw Error('Unexpected start');
      this.startAt=performance.now()+message.delayMs-message.oneWayMs;this.sendControl({type:'started'});this.begin();
    }else if(message.type==='started'){
      if(this.slot!==0||!this.startSent||this.started)throw Error('Unexpected start acknowledgement');this.begin();
    }else if(message.type==='bye')this.close(message.reason,false);
    else{if(!this.started)throw Error('Gameplay control before ready');this.worker.postMessage({type:'control',raw});}
  }
  private startIfReady(){
    if(this.slot!==0||!this.localReady||!this.remoteReady||!this.measured||this.startSent)return;
    const delayMs=Math.min(10000,Math.max(200,this.rtt*2));this.startAt=performance.now()+delayMs;this.startSent=true;
    this.sendControl({type:'start',delayMs,oneWayMs:Math.min(this.rtt/2,delayMs)});
  }
  private begin(){this.started=true;this.lastReceived=performance.now();this.worker.postMessage({type:'start',delayMs:Math.max(0,this.startAt-performance.now())});this.callbacks.status('Connected');}
  private sendControl(message:Control){
    if(this.closed)return;const raw=JSON.stringify(message);
    if(this.reliableBytes+raw.length>256000||this.reliable.length>=256)throw Error('Reliable channel backlog exceeded');
    this.reliable.push(raw);this.reliableBytes+=raw.length;this.flush();
  }
  private flush(){if(this.closed)return;while(this.controlChannel?.readyState==='open'&&this.controlChannel.bufferedAmount<65536&&this.reliable.length){const raw=this.reliable.shift()!;this.reliableBytes-=raw.length;this.controlChannel.send(raw);}}
  input(buttons:number){this.worker.postMessage({type:'input',buttons});}
  saveReplay(){if(!this.closed&&!this.replayPending){this.replayPending=true;this.worker.postMessage({type:'replay'});}}
  private async refreshICE(){
    if(!this.callbacks.refreshICE)return;
    if(!this.refreshing)this.refreshing=(async()=>{const iceServers=await this.callbacks.refreshICE!();if(!this.closed){this.pc.setConfiguration({...this.pc.getConfiguration(),iceServers});this.renewalAt=performance.now()+240000;}})().finally(()=>{this.refreshing=undefined;});
    await this.refreshing;
  }
  private async offer(restart:boolean){
    if(this.closed||this.offering||this.pc.signalingState!=='stable')return;
    this.offering=true;
    try{if(restart)await this.refreshICE();if(this.closed||this.pc.signalingState!=='stable')return;
      const offer=await this.pc.createOffer({iceRestart:restart});await this.pc.setLocalDescription(offer);this.callbacks.signal({description:this.pc.localDescription?.toJSON()});
    }finally{this.offering=false;}
  }
  resumeSignaling(){
    if(this.closed||!this.started)return;
    if(this.pc.signalingState==='have-local-offer')this.callbacks.signal({description:this.pc.localDescription?.toJSON()});
    else if(this.slot===0)void this.offer(true).catch(error=>this.close(String(error)));
    else this.callbacks.signal({restart:true});
  }

  signal(value:unknown){this.signals=this.signals.then(async()=>{
    if(this.closed)return;
    const signal=value as {description?:RTCSessionDescriptionInit;candidate?:RTCIceCandidateInit;restart?:boolean};
    if(!signal||typeof signal!=='object')throw Error('Invalid signaling payload');
    if(signal.restart===true){if(this.slot!==0)throw Error('Unexpected ICE restart request');await this.offer(true);}
    else if(signal.description){
      const d=signal.description;if(d.type!==(this.slot===0?'answer':'offer')||typeof d.sdp!=='string'||d.sdp.length>24000)throw Error('Invalid session description');
      if(d.type==='offer'&&this.started)await this.refreshICE();
      if(this.closed)return;
      await this.pc.setRemoteDescription(d);for(const candidate of this.candidates)await this.pc.addIceCandidate(candidate);this.candidates=[];
      if(d.type==='offer'){await this.pc.setLocalDescription(await this.pc.createAnswer());this.callbacks.signal({description:this.pc.localDescription?.toJSON()});}
    }else if(signal.candidate){
      if(typeof signal.candidate.candidate!=='string'||signal.candidate.candidate.length>4096)throw Error('Invalid ICE candidate');
      if(this.pc.remoteDescription)await this.pc.addIceCandidate(signal.candidate);else{if(this.candidates.length>=128)throw Error('Too many pending ICE candidates');this.candidates.push(signal.candidate);}
    }else throw Error('Unknown signaling payload');
  }).catch(error=>this.close(String(error)));}
  private restart(){if(this.closed||this.disconnectedAt!==undefined)return;this.disconnectedAt=performance.now();this.callbacks.status('Connection interrupted · attempting recovery');if(this.slot===0)void this.offer(true).catch(error=>this.close(String(error)));else this.callbacks.signal({restart:true});}
  private async statistics(){try{const stats=await this.pc.getStats();stats.forEach(report=>{if(report.type==='candidate-pair'&&report.state==='succeeded'&&report.nominated){const local=stats.get(report.localCandidateId),remote=stats.get(report.remoteCandidateId);this.relay=local?.candidateType==='relay'||remote?.candidateType==='relay';}});}catch{}}
  close(reason='Left match',notify=true){
    if(this.closed)return;
    if(notify&&this.controlChannel?.readyState==='open')try{this.controlChannel.send(JSON.stringify({type:'bye',reason:reason.slice(0,100)}));}catch{}
    this.closed=true;clearInterval(this.timer);this.pc.close();
    // Keep only the simulation worker alive long enough to validate the final recording.
    this.worker.postMessage({type:'replay',finalize:true});
    this.shutdownTimer=setTimeout(()=>{this.worker.terminate();this.callbacks.replay?.(undefined,'Recording timed out');},30000);
    this.callbacks.ended(reason);
  }
}
