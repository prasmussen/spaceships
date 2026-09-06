import {Engine,STATE_BYTES} from './engine.ts';

/** Carry living ships and their projectiles into a compacted/new room roster. */
export async function restoreRoom(binary:BufferSource,seed:number,players:number,snapshot?:string,slots?:number[]){
  const engine=await Engine.create(binary,32768,seed,players);
  if(!snapshot)return engine;
  const bytes=Uint8Array.from(atob(snapshot),c=>c.charCodeAt(0));
  if(bytes.length!==STATE_BYTES||!slots||slots.length!==players)throw Error('Invalid room snapshot');
  const old=new Int32Array(bytes.buffer),oldPlayers=old[5];
  if(oldPlayers<1||oldPlayers>4||slots.some(id=>!Number.isInteger(id)||id < -1||id>=oldPlayers)||new Set(slots.filter(id=>id>=0)).size!==slots.filter(id=>id>=0).length)throw Error('Invalid room roster');
  // Validate the source before translating slot ownership.
  const source=await Engine.create(binary,32768,seed,oldPlayers);source.load(bytes);
  if(Array.from({length:oldPlayers},(_,id)=>old[27+id*16]).some(score=>score>=5))return engine;
  const next=new Int32Array(bytes.slice().buffer);next[5]=players;next[1]=-1;next.fill(0,6,14);next.fill(0,16,80);
  for(let id=0;id<players;id++){
    const previous=slots[id],offset=16+id*16;
    if(previous>=0){next.set(old.subarray(16+previous*16,32+previous*16),offset);next.set(old.subarray(6+previous*2,8+previous*2),6+id*2);}
    // A one-tick respawn picks a pad far from the current living players.
    else next[offset+10]=1;
  }
  for(let offset=80;offset<next.length;offset+=8){
    if(!next[offset+4])continue;
    const owner=slots.indexOf(next[offset+5]);
    if(owner<0)next.fill(0,offset,offset+8);else next[offset+5]=owner;
  }
  engine.load(new Uint8Array(next.buffer));return engine;
}
