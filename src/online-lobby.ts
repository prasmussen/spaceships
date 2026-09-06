import {PeerMatch} from './peer-match.ts';
import type {MatchConfig} from './network-session.ts';
import type {Identity} from './replay.ts';
type Frame=Parameters<ConstructorParameters<typeof PeerMatch>[3]['frame']>[0];
interface OnlineCallbacks {browse:()=>void;start:(slot:number)=>void;frame:(data:Frame,slot:number)=>void;leave:()=>void}
export class OnlineLobby {
  private ws:WebSocket|undefined;
  private readonly instance=Array.from(crypto.getRandomValues(new Uint8Array(16)),byte=>byte.toString(16).padStart(2,'0')).join('');
  private peer:PeerMatch|undefined;
  private config:{identity:Identity;regions:string[];iceServers:RTCIceServer[]}|undefined;
  private room='';
  private slot=0;
  private ready=false;
  private hasOpponent=false;
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
  private region='';
  private available=false;
  private searching=false;
  private pendingSearch=false;
  private playerCount=document.querySelector<HTMLSelectElement>('#online-players')!;
  constructor(callbacks:OnlineCallbacks){
    this.callbacks=callbacks;
    document.querySelector('#online-open')!.addEventListener('click',()=>{this.panel.hidden=false;this.callbacks.browse();if(!this.ws||this.ws.readyState>1)void this.connect();});
    document.querySelector('#online-close')!.addEventListener('click',()=>{if(this.peer)this.panel.hidden=true;else this.leave();});
    document.querySelector('#queue-join')!.addEventListener('click',()=>{
      this.pendingSearch=true;this.searching=true;this.updateActions();
      if(this.available)this.findOpponent();else void this.connect();
    });
    document.querySelector('#queue-cancel')!.addEventListener('click',()=>{this.pendingSearch=false;this.searching=false;if(this.available)this.send({type:'cancelQueue'});this.updateActions();});
    document.querySelector('#online-ready')!.addEventListener('click',()=>this.rematch());
    document.querySelector('#online-leave')!.addEventListener('click',()=>this.leave());
    setInterval(()=>this.metrics(),2000);
    this.enabled(false);
  }
  get active(){return !!this.peer;}
  input(buttons:number){this.peer?.input(buttons);}
  rematch(){this.ready=true;this.updateActions();this.send({type:'rematch'});this.panel.hidden=false;this.status.textContent='Waiting for all players to rematch…';}
  private enabled(value:boolean){this.available=value;this.updateActions();}
  private updateActions(){
    const find=this.panel.querySelector<HTMLButtonElement>('#queue-join')!;
    find.hidden=this.searching||!!this.peer;
    find.disabled=false;
    this.panel.querySelector<HTMLButtonElement>('#queue-cancel')!.hidden=!this.searching;
    this.playerCount.disabled=this.searching||!!this.peer;
    const rematch=this.panel.querySelector<HTMLButtonElement>('#online-ready')!;
    rematch.hidden=!this.room||!this.hasOpponent||!!this.peer||this.searching;
    rematch.disabled=!this.available||this.ready;
    document.querySelector<HTMLButtonElement>('#rematch')!.disabled=!!this.peer||this.ready||!this.available;
    rematch.textContent=this.ready?'Waiting for players…':'Rematch';
  }
  private findOpponent(){
    this.pendingSearch=false;
    if(this.room){this.send({type:'leave'});this.room='';}
    this.send({type:'queue',players:Number(this.playerCount.value)});
  }
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
      if(!config.regions.includes(this.region))this.region=config.regions[0];
      const ws=new WebSocket(location.origin.replace(/^http/,'ws')+'/ws?instance='+this.instance);this.ws=ws;
      ws.onmessage=event=>{this.messages=this.messages.then(()=>this.message(JSON.parse(event.data))).catch(error=>this.error(String(error)));};
      this.connectTimer=setTimeout(()=>ws.close(),this.disconnectSince===undefined?8000:Math.max(1,10000-(performance.now()-this.disconnectSince)));
      ws.onopen=()=>{this.connecting=false;};
      ws.onerror=()=>{this.status.textContent='Online service connection failed.';};
      ws.onclose=()=>{
        if(this.ws!==ws)return;this.connecting=false;this.enabled(false);
        if(this.intentional)return;
        clearTimeout(this.connectTimer);this.reconnect();
      };
    }catch(error){this.connecting=false;this.status.textContent=String(error);this.pendingSearch=false;this.searching=false;this.enabled(false);if(this.disconnectSince!==undefined)this.reconnect();}
  }
  private reconnect(){
    this.disconnectSince??=performance.now();
    clearTimeout(this.reconnectTimer);
    if(performance.now()-this.disconnectSince<10000){this.status.textContent='Lobby connection interrupted · reconnecting…';this.reconnectTimer=setTimeout(()=>void this.connect(),500);}
    else{this.searching=false;this.pendingSearch=false;this.updateActions();this.error('Lobby disconnected. Select Find opponent to try again.');this.peer?.close('Lobby disconnected');this.disconnectSince=undefined;}
  }
  private send(message:Record<string,unknown>){if(this.ws?.readyState===WebSocket.OPEN)this.ws.send(JSON.stringify(message));else this.status.textContent='Online service unavailable. Select Find opponent to try again.';}
  private async message(m:Record<string,any>){
    switch(m.type){
      case 'welcome':
        clearTimeout(this.connectTimer);this.disconnectSince=undefined;
        if(m.resumed){this.enabled(true);if(m.region)this.region=m.region;this.status.textContent='Online session restored.';this.peer?.resumeSignaling();if(this.pendingSearch)this.findOpponent();}
        else this.send({type:'hello',identity:this.config!.identity,region:this.region});break;
      case 'hello':this.enabled(true);this.status.textContent='Ready when you are.';if(this.pendingSearch)this.findOpponent();break;
      case 'error':this.pendingSearch=false;this.searching=false;this.updateActions();this.status.textContent=m.message;break;
      case 'room':
        this.room=m.code;this.slot=m.slot;this.ready=m.ready[this.slot];this.hasOpponent=m.present.every(Boolean);
        this.searching=false;this.updateActions();
        if(!m.active)this.status.textContent=m.present.every(Boolean)?(this.ready?'Waiting for all players to rematch…':'Play again or find a new opponent.'):'A player left. Find a new match.';break;
      case 'queued':this.searching=true;this.updateActions();this.status.textContent='Searching for players…';break;
      case 'queueCancelled':this.searching=false;this.updateActions();this.status.textContent='Search cancelled.';break;
      case 'match':await this.start(m.match,m.slot);break;
      case 'signal':if(this.peer&&m.matchId===this.peer.match.id&&Number.isInteger(m.sender)&&m.sender>=0&&m.sender<this.peer.match.players&&m.sender!==this.slot)this.peer.signal(m.signal,m.sender);break;
      case 'peerDisconnected':this.status.textContent='A player is reconnecting…';break;
      case 'ended':
        if(this.peer&&m.matchId===this.peer.match.id&&m.reason==='reported'&&!this.reported){
          this.pendingFinish=m.matchId;clearTimeout(this.finishTimer);
          this.status.textContent='Confirming final match inputs…';
          this.finishTimer=setTimeout(()=>{if(this.pendingFinish===m.matchId){this.pendingFinish=undefined;this.endedNormally=true;this.peer?.close('Match report could not be confirmed',false);this.peer=undefined;}},10000);
          break;
        }
        if(this.peer&&m.matchId===this.peer.match.id){this.endedNormally=true;this.peer.close(m.reason==='reported'?'Match finished':'Opponent disconnected',false);this.peer=undefined;}
        this.panel.hidden=false;this.status.textContent=m.reason==='reported'?'Match finished · casual result is unverified. Play again or find a new opponent.':'Opponent disconnected. Find another opponent.';break;
      case 'left':this.room='';this.ready=false;this.updateActions();this.status.textContent='You left the online room.';break;
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
    this.slot=slot;this.reported=false;this.endedNormally=false;this.connectionReported=false;this.lastMetrics={stalls:0,rollbacks:0,desyncs:0};this.latest=undefined;
    this.status.textContent='Connecting to players…';this.callbacks.start(slot);this.panel.hidden=true;
    this.peer=new PeerMatch(match,slot,config.iceServers,{
      signal:value=>{const {recipient,signal}=value as {recipient:number;signal:unknown};this.send({type:'signal',matchId:match.id,recipient,signal});},
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
        document.querySelector('#connection-status')!.textContent=data.stalled?'Connection stalled · waiting for confirmed inputs':`Online · ${Math.round(this.peer?.rtt??0)} ms · ${this.peer?.relay?'relay':'direct'}`;
        if(state[1]>=0&&!this.reported){
          this.reported=true;
          if(this.pendingFinish===match.id){clearTimeout(this.finishTimer);this.pendingFinish=undefined;this.endedNormally=true;this.peer?.close('Match finished',false);this.peer=undefined;}
          else this.send({type:'finish',matchId:match.id,winner:state[1]});
        }
      },
      diagnostic:()=>{},
      ended:reason=>{
        if(this.peer?.match.id===match.id)this.peer=undefined;
        if(!this.endedNormally)this.send({type:'leave'});
        this.updateActions();
        document.querySelector('#connection-status')!.textContent=reason;this.status.textContent=reason;this.panel.hidden=false;
      }
    });
    this.searching=false;this.updateActions();
  }
  private metrics(){
    if(!this.peer||!this.latest||this.ws?.readyState!==WebSocket.OPEN)return;
    const latest=this.latest;
    this.send({type:'metrics',matchId:this.peer.match.id,metrics:{connections:this.connectionReported?0:1,relayed:!this.connectionReported&&this.peer.relay?1:0,rttMs:Math.min(10000,Math.round(this.peer.rtt)),stalls:Math.max(0,latest.stalls-this.lastMetrics.stalls),rollbacks:Math.max(0,latest.rollbacks-this.lastMetrics.rollbacks),maxDepth:latest.maxDepth,desyncs:Math.max(0,latest.desyncs-this.lastMetrics.desyncs)}});
    this.connectionReported=true;this.lastMetrics={stalls:latest.stalls,rollbacks:latest.rollbacks,desyncs:latest.desyncs};
  }
  leave(){this.pendingSearch=false;this.searching=false;clearTimeout(this.finishTimer);this.pendingFinish=undefined;this.endedNormally=true;this.peer?.close('Left match');this.peer=undefined;if(this.available)this.send({type:'leave'});this.room='';this.ready=false;this.updateActions();this.callbacks.leave();this.panel.hidden=true;}
  private error(message:string){this.status.textContent=message;this.panel.hidden=false;}
}
