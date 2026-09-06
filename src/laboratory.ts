import {Engine} from './engine.ts';
import {Rollback} from './rollback.ts';
import {recordReplay} from './replay.ts';
import type {Identity} from './replay.ts';
export interface Conditions {rtt:number;jitter:number;loss:number;outage:number}
export async function laboratory(binary:BufferSource,identity:Identity,conditions:Conditions){
  if(!Number.isFinite(conditions.rtt)||conditions.rtt<0||conditions.rtt>200||!Number.isFinite(conditions.jitter)||conditions.jitter<0||conditions.jitter>100||!Number.isFinite(conditions.loss)||conditions.loss<0||conditions.loss>.5||!Number.isFinite(conditions.outage)||conditions.outage<0||conditions.outage>3000)throw Error('Invalid laboratory conditions');
  const peers=[new Rollback(await Engine.create(binary),0),new Rollback(await Engine.create(binary),1)];
  let seed=4291;
  const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/2**32;};
  let queue:{at:number;sender:number;tick:number;buttons:number}[]=[];
  const target=900;
  for(let wall=0;wall<4000;wall++){
    const outage=wall>=180&&wall<180+Math.ceil(conditions.outage*60/1000);
    for(let p=0;p<2;p++){
      const peer=peers[p];if(peer.tick<target)peer.advance((peer.tick*7+(peer.tick>>(p?3:5)))&15);
      if(outage)continue;
      for(const [tick,buttons]of [...peer.input[p]].slice(-8))if(random()>=conditions.loss){
        const at=wall+Math.round(conditions.rtt*.03+random()*conditions.jitter*.06);
        queue.push({at,sender:p,tick,buttons});if(random()<.15)queue.push({at:at+2,sender:p,tick,buttons});
      }
      if(wall%20===0)for(const [tick,buttons]of peer.input[p])if(!peers[1-p].input[p].has(tick))queue.push({at:wall+Math.ceil(conditions.rtt*.03)+2,sender:p,tick,buttons});
    }
    if(!outage){const due=queue.filter(packet=>packet.at<=wall).reverse();queue=queue.filter(packet=>packet.at>wall);for(const packet of due)peers[1-packet.sender].receive(packet.sender,packet.tick,packet.buttons);for(let p=0;p<2;p++)peers[p].acknowledge(peers[1-p].complete);}
    if(peers.every(peer=>peer.tick===target&&peer.agreed>=target-1))break;
  }
  if(!peers.every(peer=>peer.tick===target&&peer.agreed>=target-1))throw Error('Laboratory failed to resume');
  const replay=await recordReplay(binary,identity,peers[0].confirmedInputs());
  const reference=replay.checkpoints.at(-1)!.hash;
  const hashes=peers.map(peer=>peer.hashAt(target-1));
  if(hashes.some(hash=>hash!==reference))throw Error('Laboratory desync: reference mismatch');
  return {replay,hashes,reference,metrics:peers.map(peer=>({rollbacks:peer.rollbacks,maxDepth:peer.maxDepth,stalls:peer.stalls,tick:peer.tick,complete:peer.complete,agreed:peer.agreed}))};
}
