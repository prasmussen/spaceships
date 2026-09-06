import './style.css';
import {render} from './renderer';
import {OnlineLobby} from './online-lobby';
import {Controls} from './controls';
import {Effects} from './effects';
const canvas=document.querySelector<HTMLCanvasElement>('#view')!;
const status=document.querySelector<HTMLElement>('#status')!;
const result=document.querySelector<HTMLElement>('#result')!;
const worker=new Worker(new URL('./worker.ts',import.meta.url),{type:'module'});
let labActive=false;
let online:OnlineLobby|undefined;
let localSlot=0;
let onlineButtons=[0,0];
let correction=0;
let state=new Int32Array(2096),buttons=[0,0],mode=1,snapCamera=true;
const held=new Set<string>();
const guide=document.querySelector<HTMLDialogElement>('#guide-panel')!;
document.querySelector('#guide-open')!.addEventListener('click',()=>{held.clear();input();guide.showModal();});
guide.onclose=()=>{held.clear();input();};
const controls=new Controls(()=>{held.clear();input();});
const effects=new Effects(()=>({sound:controls.sound&&!document.hidden,particles:!controls.reducedMotion}));
for(const name of ['pointerdown','keydown','change'])window.addEventListener(name,()=>effects.unlock());
function input(){let pressed=0;for(const key of held)pressed|=controls.lookup(key);buttons=[pressed,0];worker.postMessage({type:'input',buttons:pressed});if(mode===3)online?.input(pressed);}
function reset(){effects.clear();if(mode===3){online?.rematch();return;}held.clear();input();snapCamera=true;worker.postMessage({type:'reset'});}
document.querySelectorAll<HTMLButtonElement>('[data-mode]').forEach(button=>button.onclick=()=>{
  if(mode===3)online?.leave();
  effects.clear();mode=Number(button.dataset.mode);localSlot=0;result.hidden=true;
  document.querySelectorAll('[data-mode]').forEach(item=>item.setAttribute('aria-pressed',String(item===button)));
  held.clear();input();snapCamera=true;worker.postMessage({type:'mode',mode});
});
document.querySelector('#rematch')!.addEventListener('click',reset);
window.addEventListener('keydown',e=>{if(controls.open||guide.open||labActive||e.target instanceof HTMLInputElement||e.target instanceof HTMLSelectElement)return;if(controls.lookup(e.code)){e.preventDefault();held.add(e.code);input();}if(controls.restart(e.code)&&!e.repeat){e.preventDefault();reset();}});
window.addEventListener('keyup',e=>{held.delete(e.code);input();});
window.addEventListener('blur',()=>{held.clear();input();});
document.addEventListener('visibilitychange',()=>{effects.unlock();held.clear();input();worker.postMessage({type:'pause',paused:document.hidden||labActive||mode===3});});
function hud(player:number){const o=16+player*16;return `<span>FUEL <strong>${Math.ceil(state[o+6]/60)}%</strong></span><span>SPEED <strong>${(Math.hypot(state[o+2],state[o+3])/65536*60).toFixed(0)}</strong></span><span>SPIN <strong>${state[o+5]}</strong></span><span>HULL <strong>${state[o+7]} / 3</strong></span><span>SCORE <strong>${state[o+11]}</strong></span><small>${state[o+7]===0?'RESPAWNING':state[o+8]?'ON PAD · REFUELING':'IN FLIGHT'} · FIRST TO 5</small>`;}
worker.onmessage=({data})=>{
  if(data.type==='frame'){
    if(labActive||mode===3)return;
    state=new Int32Array(data.buffer);effects.consume(state);status.innerHTML=hud(0);
    result.hidden=state[1]<0;
    if(state[1]>=0)document.querySelector('#winner')!.textContent=`Player ${state[1]+1} wins · ${state[27]} : ${state[43]}`;
  }else if(data.type==='error')status.textContent=data.message;
};
render(canvas,effects,()=>({state,buttons:mode===3?onlineButtons:buttons,localSlot,correction:mode===3?correction:0,reducedMotion:controls.reducedMotion,snap:snapCamera,didSnap:()=>{snapCamera=false;}})).catch(error=>{
  worker.terminate();status.textContent=String(error);document.body.classList.add('unavailable');
});

const labWorker=new Worker(new URL('./lab-worker.ts',import.meta.url),{type:'module'});
const labPanel=document.querySelector<HTMLElement>('#lab-panel')!;
const labStatus=document.querySelector<HTMLOutputElement>('#lab-status')!;
const seek=document.querySelector<HTMLInputElement>('#replay-seek')!;
const exportReplay=document.querySelector<HTMLButtonElement>('#replay-export')!;
const run=document.querySelector<HTMLButtonElement>('#lab-run')!;
let savedReplay:unknown;
document.querySelector('#lab-open')!.addEventListener('click',()=>{
  if(mode===3)online?.leave();
  effects.clear();labActive=true;labPanel.hidden=false;held.clear();input();worker.postMessage({type:'pause',paused:true});
});
document.querySelector('#lab-close')!.addEventListener('click',()=>{
  labActive=false;labPanel.hidden=true;worker.postMessage({type:'pause',paused:document.hidden});snapCamera=true;
});
document.querySelector<HTMLFormElement>('#lab-form')!.onsubmit=e=>{
  e.preventDefault();const data=new FormData(e.currentTarget as HTMLFormElement);
  run.disabled=true;labStatus.textContent='Running both peers and the reference replay…';
  labWorker.postMessage({type:'run',conditions:Object.fromEntries([...data].map(([key,value])=>[key,Number(value)]))});
};
function replayReady(replay:{inputs:unknown[]}){savedReplay=replay;seek.disabled=false;seek.max=String(replay.inputs.length);seek.value='0';exportReplay.disabled=false;labWorker.postMessage({type:'seek',tick:0});snapCamera=true;}
labWorker.onmessage=({data})=>{
  if(data.type==='result'){
    run.disabled=false;labStatus.textContent=`Converged · ${data.metrics[0].tick} ticks · ${data.metrics.map((m:{rollbacks:number;maxDepth:number;stalls:number},p:number)=>`P${p+1}: ${m.rollbacks} rollbacks, depth ${m.maxDepth}, ${m.stalls} stalls`).join(' · ')}`;replayReady(data.replay);
  }else if(data.type==='loaded'){labStatus.textContent='Replay validated against its recorded checkpoints.';replayReady(data.replay);}
  else if(data.type==='frame'&&labActive){state=new Int32Array(data.buffer);status.innerHTML=hud(0);document.querySelector('#seek-tick')!.textContent=seek.value;}
  else if(data.type==='error'){run.disabled=false;labStatus.textContent=data.message;}
};
seek.oninput=()=>{labWorker.postMessage({type:'seek',tick:Number(seek.value)});snapCamera=true;};
exportReplay.onclick=()=>{
  const url=URL.createObjectURL(new Blob([JSON.stringify(savedReplay)],{type:'application/json'}));
  const link=document.createElement('a');link.href=url;link.download='cavern-duel-replay.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
};
document.querySelector<HTMLInputElement>('#replay-file')!.onchange=async e=>{
  const file=(e.target as HTMLInputElement).files?.[0];if(!file)return;
  try{if(file.size>64*1024*1024)throw Error('Replay file exceeds 64 MB');labStatus.textContent='Validating replay…';labWorker.postMessage({type:'load',replay:JSON.parse(await file.text())});}
  catch(error){labStatus.textContent=String(error);}
};

online=new OnlineLobby({
  start:slot=>{effects.clear();mode=3;localSlot=slot;labActive=false;labPanel.hidden=true;held.clear();input();snapCamera=true;result.hidden=true;document.querySelectorAll('[data-mode]').forEach(item=>item.setAttribute('aria-pressed','false'));worker.postMessage({type:'pause',paused:true});},
  frame:(data,slot)=>{if(mode!==3)return;onlineButtons=data.inputs;correction=data.rollbacks+data.desyncs;state=new Int32Array(data.buffer);effects.consume(state);status.innerHTML=hud(slot);result.hidden=state[1]<0;if(state[1]>=0)document.querySelector('#winner')!.textContent=`Player ${state[1]+1} wins · ${state[27]} : ${state[43]} · unverified`;},
  leave:()=>{effects.clear();mode=1;localSlot=0;held.clear();input();snapCamera=true;result.hidden=true;document.querySelectorAll<HTMLButtonElement>('[data-mode]').forEach(item=>item.setAttribute('aria-pressed',String(item.dataset.mode==='1')));worker.postMessage({type:'mode',mode});worker.postMessage({type:'pause',paused:document.hidden});document.querySelector('#connection-status')!.textContent='';}
});
