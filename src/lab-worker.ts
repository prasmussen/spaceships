import {Engine} from './engine.ts';
import {laboratory} from './laboratory.ts';
import {ReplayPlayer,checkReplay} from './replay.ts';
let player:ReplayPlayer|undefined;
const content=Promise.all([fetch('/simulation.wasm').then(r=>r.arrayBuffer()),fetch('/build.json').then(r=>r.json())]);
let work=Promise.resolve();
onmessage=({data})=>{work=work.then(async()=>{
  const [binary,identity]=await content;
  if(data.type==='run'){
    const result=await laboratory(binary,identity,data.conditions);
    player=new ReplayPlayer(await Engine.create(binary),result.replay);
    postMessage({type:'result',...result});
  }else if(data.type==='load'){
    checkReplay(data.replay,identity);
    player=new ReplayPlayer(await Engine.create(binary,data.replay.mapMode,data.replay.seed,data.replay.players),data.replay);
    const hash=await player.validate();postMessage({type:'loaded',hash,replay:data.replay});
  }else if(data.type==='seek'&&player){const frame=player.seek(data.tick);postMessage({type:'frame',buffer:frame.buffer},[frame.buffer]);}
}).catch(error=>postMessage({type:'error',message:String(error)}));};
