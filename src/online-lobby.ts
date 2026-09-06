import {PeerMatch} from './peer-match.ts';
import type {MatchConfig} from './network-session.ts';
import type {Identity} from './replay.ts';
type Frame=Parameters<ConstructorParameters<typeof PeerMatch>[3]['frame']>[0];
interface OnlineCallbacks {start:(slot:number)=>void;frame:(data:Frame,slot:number)=>void;leave:()=>void}
export class OnlineLobby {
  private ws:WebSocket|undefined;
  private peer:PeerMatch|undefined;
  private config:{identity:Identity;regions:string[];iceServers:RTCIceServer[]}|undefined;
  private room='';
  private recordingMatch='';
  private slot=0;
  private ready=false;
  private connecting=false;
  private intentional=false;
  private disconnectSince:number|undefined;
  private reconnectTimer:ReturnType<typeof setTimeout>|undefined;
  private connectTimer:ReturnType<typeof setTimeout>|undefined;
  private messages=Promise.resolve();
  private endedNormally=false;
  private reported=false;
  private pendingFinish:string|undefined;
  private finishTimer:ReturnType<typeof setTimeout>|undefined;
  private latest:Frame|undefined;
  private lastMetrics={stalls:0,rollbacks:0,desyncs:0};
  private connectionReported=false;
  private callbacks:OnlineCallbacks;
  private panel=document.querySelector<HTMLElement>('#online-panel')!;
  private status=document.querySelector<HTMLOutputElement>('#online-status')!;
  private region=document.querySelector<HTMLSelectElement>('#online-region')!;
  private code=document.querySelector<HTMLInputElement>('#invite-code')!;
  constructor(callbacks:OnlineCallbacks){
    this.callbacks=callbacks;
    document.querySelector('#online-open')!.addEventListener('click',()=>{this.panel.hidden=false;if(!this.ws||this.ws.readyState>1)void this.connect();});
    document.querySelector('#online-close')!.addEventListener('click',()=>{this.panel.hidden=true;});
    document.querySelector('#online-connect')!.addEventListener('click',()=>void this.connect());
    document.querySelector('#invite-create')!.addEventListener('click',()=>this.send({type:'create'}));
    document.querySelector<HTMLFormElement>('#invite-form')!.onsubmit=e=>{e.preventDefault();this.send({type:'join',code:this.code.value.trim().toLowerCase()});};
    document.querySelector('#queue-join')!.addEventListener('click',()=>this.send({type:'queue'}));
    document.querySelector('#queue-cancel')!.addEventListener('click',()=>this.send({type:'cancelQueue'}));
    document.querySelector('#online-ready')!.addEventListener('click',()=>this.send({type:'ready',ready:!this.ready}));
    document.querySelector('#online-leave')!.addEventListener('click',()=>this.leave());
    this.region.onchange=()=>{if(this.config)this.send({type:'hello',identity:this.config.identity,region:this.region.value});};
    setInterval(()=>this.metrics(),2000);
    document.querySelector('#online-replay-save')!.addEventListener('click',()=>{this.peer?.saveReplay();document.querySelector('#online-replay-status')!.textContent='Checking confirmed recording…';});
    this.enabled(false);
  }
  get active(){return !!this.peer;}
  input(buttons:number){this.peer?.input(buttons);}
  rematch(){this.send({type:'rematch'});this.panel.hidden=false;this.status.textContent='Waiting for your opponent to rematch…';}
  private enabled(value:boolean){this.panel.querySelectorAll<HTMLButtonElement>('button[data-online-action]').forEach(button=>{button.disabled=!value;});this.region.disabled=!value;}
  private async connect(){
    if(this.connecting||this.ws?.readyState===WebSocket.OPEN)return;
    clearTimeout(this.reconnectTimer);
    this.connecting=true;this.intentional=false;this.status.textContent='Connecting to online service…';
    try{
      const remaining=this.disconnectSince===undefined?8000:Math.max(1,Math.min(8000,10000-(performance.now()-this.disconnectSince)));
      const signal=AbortSignal.timeout(remaining);
      const guest=await fetch('/api/session',{method:'POST',signal});if(!guest.ok)throw Error('Online service unavailable. Try again.');
      const response=await fetch('/api/config',{signal});if(!response.ok)throw Error('Guest session expired. Try again.');
      const config=await response.json();const build=await(await fetch('/build.json',{signal})).json();
      if(!config.identity||(['protocol','abi','wasm','map','config'] as const).some(key=>config.identity[key]!==build[key]))throw Error('This page uses an older game build. Reload to play online.');
      if(!Array.isArray(config.regions)||!config.regions.length||!Array.isArray(config.iceServers))throw Error('Invalid online configuration');
      this.config=config;
      const selected=this.region.value;this.region.replaceChildren(...config.regions.map((region:string)=>new Option(region.toUpperCase(),region)));if(config.regions.includes(selected))this.region.value=selected;
      const ws=new WebSocket(location.origin.replace(/^http/,'ws')+'/ws');this.ws=ws;
      ws.onmessage=event=>{this.messages=this.messages.then(()=>this.message(JSON.parse(event.data))).catch(error=>this.error(String(error)));};
      this.connectTimer=setTimeout(()=>ws.close(),this.disconnectSince===undefined?8000:Math.max(1,10000-(performance.now()-this.disconnectSince)));
      ws.onopen=()=>{this.connecting=false;};
      ws.onerror=()=>{this.status.textContent='Online service connection failed.';};
      ws.onclose=()=>{
        if(this.ws!==ws)return;this.connecting=false;this.enabled(false);
        if(this.intentional)return;
        clearTimeout(this.connectTimer);this.reconnect();
      };
    }catch(error){this.connecting=false;this.status.textContent=String(error);this.enabled(false);if(this.disconnectSince!==undefined)this.reconnect();}
  }
  private reconnect(){
    this.disconnectSince??=performance.now();
    clearTimeout(this.reconnectTimer);
    if(performance.now()-this.disconnectSince<10000){this.status.textContent='Lobby connection interrupted · reconnecting…';this.reconnectTimer=setTimeout(()=>void this.connect(),500);}
    else{this.error('Lobby disconnected. Reconnect to play again.');this.peer?.close('Lobby disconnected');this.disconnectSince=undefined;}
  }
  private send(message:Record<string,unknown>){if(this.ws?.readyState===WebSocket.OPEN)this.ws.send(JSON.stringify(message));else this.status.textContent='Connect to the online service first.';}
  private async message(m:Record<string,any>){
    switch(m.type){
      case 'welcome':
        clearTimeout(this.connectTimer);this.disconnectSince=undefined;
        if(m.resumed){this.enabled(true);if(m.region)this.region.value=m.region;this.status.textContent='Online session restored.';this.peer?.resumeSignaling();}
        else this.send({type:'hello',identity:this.config!.identity,region:this.region.value});break;
      case 'hello':this.enabled(true);this.status.textContent='Create an invite or find an opponent.';break;
      case 'error':this.status.textContent=m.message;break;
      case 'room':
        this.room=m.code;this.slot=m.slot;this.ready=m.ready[this.slot];
        document.querySelector('#room-code')!.textContent=this.room;
        document.querySelector('#online-ready')!.textContent=this.ready?'Not ready':'Ready to play';
        this.region.disabled=true;
        if(!m.active)this.status.textContent=m.present.every(Boolean)?'Both players joined. Select Ready to play.':'Share the room code with your opponent.';break;
      case 'queued':this.status.textContent=`Searching for an opponent in ${String(m.region).toUpperCase()}…`;this.region.disabled=true;break;
      case 'queueCancelled':this.status.textContent='Search cancelled.';this.region.disabled=false;break;
      case 'match':await this.start(m.match,m.slot);break;
      case 'signal':if(this.peer&&m.matchId===this.peer.match.id&&m.sender===1-this.slot)this.peer.signal(m.signal);break;
      case 'peerDisconnected':this.status.textContent='Opponent is reconnecting…';break;
      case 'ended':
        if(this.peer&&m.matchId===this.peer.match.id&&m.reason==='reported'&&!this.reported){
          this.pendingFinish=m.matchId;clearTimeout(this.finishTimer);
          this.status.textContent='Confirming final match inputs…';
          this.finishTimer=setTimeout(()=>{if(this.pendingFinish===m.matchId){this.pendingFinish=undefined;this.endedNormally=true;this.peer?.close('Match report could not be confirmed',false);this.peer=undefined;}},10000);
          break;
        }
        if(this.peer&&m.matchId===this.peer.match.id){this.endedNormally=true;this.peer.close(m.reason==='reported'?'Match finished':'Opponent disconnected',false);this.peer=undefined;}
        this.panel.hidden=false;this.status.textContent=m.reason==='reported'?'Match finished · casual result is unverified. Select Ready to rematch.':'Opponent disconnected. You can invite another player.';break;
      case 'left':this.room='';this.ready=false;this.region.disabled=false;document.querySelector('#room-code')!.textContent='—';this.status.textContent='You left the online room.';break;
      default:throw Error('Unknown lobby message');
    }
  }
  private async start(match:MatchConfig,slot:number){
    if(this.peer?.match.id===match.id)return;
    if(!match||!this.config||(['protocol','abi','wasm','map','config'] as const).some(key=>match.identity[key]!==this.config!.identity[key]))throw Error('Match build mismatch');
    const response=await fetch('/api/config');if(!response.ok)throw Error('Unable to refresh connection credentials');
    const config=await response.json();this.config.iceServers=config.iceServers;
    if(this.peer){this.endedNormally=true;this.peer.close('Replaced match',false);}
    clearTimeout(this.finishTimer);this.pendingFinish=undefined;
    this.recordingMatch=match.id;
    const replayLink=document.querySelector<HTMLAnchorElement>('#online-replay-download')!;
    if(replayLink.href.startsWith('blob:'))URL.revokeObjectURL(replayLink.href);replayLink.hidden=true;
    document.querySelector('#online-replay-status')!.textContent='';
    document.querySelector<HTMLButtonElement>('#online-replay-save')!.disabled=false;
    this.slot=slot;this.reported=false;this.endedNormally=false;this.connectionReported=false;this.lastMetrics={stalls:0,rollbacks:0,desyncs:0};this.latest=undefined;
    this.status.textContent='Connecting to opponent…';this.callbacks.start(slot);this.panel.hidden=true;
    this.peer=new PeerMatch(match,slot,config.iceServers,{
      signal:signal=>this.send({type:'signal',matchId:match.id,signal}),
      refreshICE:async()=>{
        const response=await fetch('/api/config',{signal:AbortSignal.timeout(8000)});if(!response.ok)throw Error('Unable to renew relay credentials');
        const config=await response.json();
        if(!Array.isArray(config.iceServers)||(['protocol','abi','wasm','map','config'] as const).some(key=>config.identity?.[key]!==match.identity[key]))throw Error('Relay configuration build mismatch');
        return config.iceServers;
      },
      status:status=>{this.status.textContent=status;document.querySelector('#connection-status')!.textContent=status;},
      frame:data=>{
        this.latest=data;this.callbacks.frame(data,slot);
        const state=new Int32Array(data.buffer);
        document.querySelector('#connection-status')!.textContent=data.stalled?'Connection stalled · waiting for confirmed inputs':`Online · ${Math.round(this.peer?.rtt??0)} ms · ${this.peer?.relay?'relay':'direct'} · tick ${data.tick}`;
        if(state[1]>=0&&!this.reported){
          this.reported=true;
          if(this.pendingFinish===match.id){clearTimeout(this.finishTimer);this.pendingFinish=undefined;this.endedNormally=true;this.peer?.close('Match finished',false);this.peer=undefined;}
          else this.send({type:'finish',matchId:match.id,winner:state[1]});
        }
      },
      diagnostic:bundle=>{const url=URL.createObjectURL(new Blob([JSON.stringify(bundle)],{type:'application/json'}));const link=document.querySelector<HTMLAnchorElement>('#diagnostic-download')!;if(link.href.startsWith('blob:'))URL.revokeObjectURL(link.href);link.href=url;link.hidden=false;},
      replay:(recording,error)=>{
        if(this.recordingMatch!==match.id)return;
        document.querySelector('#online-replay-status')!.textContent=error??`Recording ready · ${recording!.inputs.length} confirmed ticks`;
        if(recording){if(replayLink.href.startsWith('blob:'))URL.revokeObjectURL(replayLink.href);replayLink.href=URL.createObjectURL(new Blob([JSON.stringify(recording)],{type:'application/json'}));replayLink.download=`cavern-duel-${match.id}.json`;replayLink.hidden=false;}
      },
      ended:reason=>{
        document.querySelector<HTMLButtonElement>('#online-replay-save')!.disabled=true;
        if(this.peer?.match.id===match.id)this.peer=undefined;
        if(!this.endedNormally)this.send({type:'leave'});
        document.querySelector('#connection-status')!.textContent=reason;this.status.textContent=reason;this.panel.hidden=false;
      }
    },document.querySelector<HTMLInputElement>('#force-relay')!.checked);
  }
  private metrics(){
    if(!this.peer||!this.latest||this.ws?.readyState!==WebSocket.OPEN)return;
    const latest=this.latest;
    this.send({type:'metrics',matchId:this.peer.match.id,metrics:{connections:this.connectionReported?0:1,relayed:!this.connectionReported&&this.peer.relay?1:0,rttMs:Math.min(10000,Math.round(this.peer.rtt)),stalls:Math.max(0,latest.stalls-this.lastMetrics.stalls),rollbacks:Math.max(0,latest.rollbacks-this.lastMetrics.rollbacks),maxDepth:latest.maxDepth,desyncs:Math.max(0,latest.desyncs-this.lastMetrics.desyncs)}});
    this.connectionReported=true;this.lastMetrics={stalls:latest.stalls,rollbacks:latest.rollbacks,desyncs:latest.desyncs};
  }
  leave(){clearTimeout(this.finishTimer);this.pendingFinish=undefined;this.endedNormally=true;this.peer?.close('Left match');this.peer=undefined;this.send({type:'leave'});this.callbacks.leave();}
  private error(message:string){this.status.textContent=message;this.panel.hidden=false;}
}
