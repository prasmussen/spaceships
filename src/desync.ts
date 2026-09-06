import {STATE_BYTES} from './engine.ts';
import {Rollback,ProtocolError} from './rollback.ts';
import type {Identity} from './replay.ts';
export class DesyncMonitor {
  readonly peer:Rollback;
  readonly identity:Identity;
  recoveries=0;
  aborted=false;
  diagnostic:unknown;
  constructor(peer:Rollback,identity:Identity){this.peer=peer;this.identity=identity;}
  compare(tick:number,remoteHash:string){
    if(!Number.isInteger(tick)||(tick+1)%60!==0||!/^[-]?\d{1,20}$/.test(remoteHash))throw new ProtocolError('Invalid agreed hash report');
    const localHash=this.peer.hashAt(tick);
    if(localHash===remoteHash)return true;
    this.peer.frozen=true;
    this.diagnostic={version:1,identity:this.identity,tick,localHash,remoteHash,player:this.peer.player,inputs:this.peer.input.map(records=>[...records]),hashes:[...this.peer.hashes],snapshots:[...this.peer.snapshots].map(([tick,bytes])=>({tick,bytes:[...bytes]}))};
    if(this.recoveries){this.aborted=true;throw new ProtocolError('Repeated desync; match aborted');}
    return false;
  }
  recover(tick:number,snapshot:Uint8Array,sender:number){
    if(sender!==0||!this.peer.frozen||this.aborted||this.recoveries||snapshot.length!==STATE_BYTES)throw new ProtocolError('Recovery not permitted');
    this.peer.restoreConfirmed(tick,snapshot);this.recoveries++;this.peer.frozen=false;
  }
}
