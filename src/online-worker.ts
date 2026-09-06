import {Engine} from './engine.ts';
import {NetworkSession} from './network-session.ts';
let session:NetworkSession|undefined,buttons=0,running=false,failed=false,deadline=0;
let binary:ArrayBuffer|undefined;
const tickMs=1000/60;
function send(type:string,extra:Record<string,unknown>={}){postMessage({type,...extra});}
function fail(error:unknown){failed=true;running=false;send('error',{message:String(error)});}
let chain=Promise.resolve();
onmessage=({data})=>{chain=chain.then(async()=>{
  if(data.type==='init'){
    binary=await(await fetch('/simulation.wasm')).arrayBuffer();
    const digest=[...new Uint8Array(await crypto.subtle.digest('SHA-256',binary))].map(b=>b.toString(16).padStart(2,'0')).join('');
    if(digest!==data.match.identity.wasm)throw Error('WASM artifact does not match the negotiated build');
    session=new NetworkSession(await Engine.create(binary,32768,data.match.seed,data.match.players),data.slot,data.match,{
      gameplay:buffer=>postMessage({type:'gameplay',buffer},[buffer]),control:(message,recipient)=>send('control',{message,recipient}),diagnostic:bundle=>send('diagnostic',{bundle})
    });send('booted');
  }else if(data.type==='replay'){
    if(data.finalize)running=false;
    try{if(!session||!binary)throw Error('No match recording available');send('replay',{recording:await session.replay(binary),finalize:!!data.finalize});}
    catch(error){send('replay',{error:String(error),finalize:!!data.finalize});}
  }else if(data.type==='input')buttons=data.buttons;
  else if(data.type==='start'){if(!session)throw Error('Worker not initialized');running=true;deadline=performance.now()+Math.min(10000,Math.max(0,Number(data.delayMs)||0));}
  else if(data.type==='stop')running=false;
  else if(data.type==='gameplay')session?.gameplay(data.buffer,data.sender);
  else if(data.type==='control')session?.control(data.raw,data.sender);
  else if(data.type==='resume')session?.resume();
}).catch(fail);};
setInterval(()=>{
  if(!running||failed||!session)return;
  try{
    const now=performance.now();if(now-deadline>12*tickMs)deadline=now;
    let stepped=false,count=0;
    while(now>=deadline&&count++<12){stepped=session.scheduled(buttons)||stepped;deadline+=tickMs;}
    if(count<=1&&!stepped)return;
    const frame=session.frame(),peer=session.peer;
    const hashTick=Math.floor((Math.min(peer.agreed,peer.tick-1)+1)/60)*60-1;
    postMessage({type:'frame',inputs:peer.executed.get(peer.tick-1)??Array(session.match.players).fill(0),hashTick,hash:hashTick>=0?peer.hashAt(hashTick):undefined,buffer:frame.buffer,tick:peer.tick,complete:peer.complete,agreed:peer.agreed,stalled:peer.frozen||peer.tick>peer.agreed+12,rollbacks:peer.rollbacks,maxDepth:peer.maxDepth,stalls:peer.stalls,desyncs:session.monitor.recoveries},[frame.buffer]);
  }catch(error){fail(error);}
},4);
