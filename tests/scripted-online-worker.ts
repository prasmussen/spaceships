// Browser acceptance entry only: substitute the local button sampler, while
// keeping the real worker, simulation, rollback, packet repair and hash checks.
import {NetworkSession} from '../src/network-session.ts';
import '../src/online-worker.ts';
let fixtures:number[][][]=[];
self.addEventListener('message',({data})=>{if(data.type==='fixture')fixtures=data.fixtures;});
const schedule=NetworkSession.prototype.scheduled;
NetworkSession.prototype.scheduled=function(){
  return schedule.call(this,fixtures[this.match.seed%4]?.[this.peer.tick+2]?.[this.peer.player]??0);
};
// Accelerate only scheduling time; no authoritative state is modified.
const realNow=performance.now.bind(performance);
Object.defineProperty(performance,'now',{value:()=>realNow()*3});
