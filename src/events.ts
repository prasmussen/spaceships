export interface GameEvent {tick:number;entity:number;index:number;type:number;x:number;y:number;player:number;data:number}
export class EventDeduper {
  private lastTick=-1;
  private seen=new Map<string,number>();
  clear(){this.seen.clear();this.lastTick=-1;}
  consume(frame:Int32Array){
    if(frame[0]<this.lastTick)this.clear();this.lastTick=frame[0];
    const result:GameEvent[]=[],count=frame[2128]??0;
    if(count<0||2129+count*8>frame.length)throw Error('Invalid event frame');
    for(let i=0;i<count;i++){
      const o=2129+i*8,[tick,entity,index,type,x,y,player,data]=frame.subarray(o,o+8);
      const key=`${tick}:${entity}:${index}`;if(this.seen.has(key))continue;
      this.seen.set(key,tick);result.push({tick,entity,index,type,x:x/65536,y:y/65536,player,data});
    }
    for(const [key,tick]of this.seen)if(tick<frame[0]-240)this.seen.delete(key);
    return result;
  }
}
