import './style.css';
import {render} from './renderer';
import {OnlineLobby} from './online-lobby';
import {Controls} from './controls';
import {Effects} from './effects';
const canvas=document.querySelector<HTMLCanvasElement>('#view')!;
const status=document.querySelector<HTMLElement>('#status')!;
const result=document.querySelector<HTMLElement>('#result')!;
const menu=document.querySelector<HTMLDialogElement>('#game-menu')!;
const worker=new Worker(new URL('./worker.ts',import.meta.url),{type:'module'});
let online:OnlineLobby|undefined;
let localSlot=0;
let onlineButtons=[0,0];
let practiceInputs=[0,0];
const practicePlayers=document.querySelector<HTMLSelectElement>('#practice-players')!;
let correction=0;
let state=new Int32Array(2128),buttons=[0,0],mode=1,snapCamera=true;
const held=new Set<string>();
const controls=new Controls(()=>{held.clear();input();});
const effects=new Effects(()=>({sound:controls.sound&&!document.hidden,particles:!controls.reducedMotion}));
for(const name of ['pointerdown','keydown','change'])window.addEventListener(name,()=>effects.unlock());
function input(){let pressed=0;for(const key of held)pressed|=controls.lookup(key);buttons=[pressed,0];worker.postMessage({type:'input',buttons:pressed});if(mode===3)online?.input(pressed);}
document.querySelector('#menu-open')!.addEventListener('click',()=>{held.clear();input();menu.showModal();if(mode!==3)worker.postMessage({type:'pause',paused:true});});
for(const id of ['menu-close','menu-resume','online-open'])document.getElementById(id)!.addEventListener('click',()=>menu.close());
menu.addEventListener('close',()=>{held.clear();input();worker.postMessage({type:'pause',paused:document.hidden||mode===3||menu.open||document.body.classList.contains('online-home')});});
menu.addEventListener('click',event=>{if(event.target===menu){const box=menu.getBoundingClientRect();if(event.clientX<box.left||event.clientX>box.right||event.clientY<box.top||event.clientY>box.bottom)menu.close();}});
document.querySelectorAll<HTMLButtonElement>('[data-mode]').forEach(button=>button.onclick=()=>{
  menu.close();document.querySelector<HTMLDetailsElement>('#local-menu')!.open=false;
  online?.leave();
  document.body.classList.remove('online-home');
  effects.clear();mode=Number(button.dataset.mode);localSlot=0;result.hidden=true;
  document.querySelectorAll('[data-mode]').forEach(item=>item.setAttribute('aria-pressed',String(item===button)));
  held.clear();input();snapCamera=true;worker.postMessage({type:'mode',mode,players:Number(practicePlayers.value)});
});
practicePlayers.onchange=()=>{held.clear();input();effects.clear();snapCamera=true;worker.postMessage({type:'mode',mode,players:Number(practicePlayers.value)});};
document.querySelector('#rematch')!.addEventListener('click',()=>{if(mode===3)online?.rematch();});
window.addEventListener('keydown',e=>{if(document.body.classList.contains('online-home')||controls.open||menu.open||e.target instanceof HTMLInputElement||e.target instanceof HTMLSelectElement)return;if(controls.lookup(e.code)){e.preventDefault();held.add(e.code);input();}});
window.addEventListener('keyup',e=>{held.delete(e.code);input();});
window.addEventListener('blur',()=>{held.clear();input();});
document.addEventListener('visibilitychange',()=>{effects.unlock();held.clear();input();worker.postMessage({type:'pause',paused:document.hidden||mode===3||menu.open||document.body.classList.contains('online-home')});});
function hud(player:number){const o=16+player*16;return `<span>FUEL <strong>${Math.ceil(state[o+6]/60)}%</strong></span><span>SPEED <strong>${(Math.hypot(state[o+2],state[o+3])/65536*60).toFixed(0)}</strong></span><span>BOOST <strong>${state[o+7]===0?'—':state[o+13]>0?'ACTIVE':state[o+14]>0?`${(state[o+14]/60).toFixed(1)}s`:state[o+6]<=120?'LOW FUEL':'READY'}</strong></span><span>SPIN <strong>${state[o+5]}</strong></span><span>HULL <strong>${state[o+7]} / 3</strong></span><span>SCORE <strong>${state[o+11]}</strong></span><small>${state[o+7]===0?'RESPAWNING':state[o+8]?'ON PAD · REFUELING':'IN FLIGHT'}</small>`;}
function scores(){return `<small>${Array.from({length:state[5]},(_,id)=>`P${id+1}: ${state[27+id*16]}`).join(' · ')}</small>`;}
worker.onmessage=({data})=>{
  if(data.type==='frame'){
    if(mode===3)return;
    if(document.body.classList.contains('online-home'))worker.postMessage({type:'pause',paused:true});
    practiceInputs=data.inputs;state=new Int32Array(data.buffer);effects.consume(state);status.innerHTML=hud(0)+scores();
    document.querySelector<HTMLButtonElement>('#rematch')!.hidden=true;
    result.hidden=state[1]<0;
    if(state[1]>=0)document.querySelector('#winner')!.textContent=`Player ${state[1]+1} wins · ${Array.from({length:state[5]},(_,id)=>state[27+id*16]).join(' : ')}`;
  }else if(data.type==='error')status.textContent=data.message;
};
render(canvas,effects,()=>{effects.thrust(state,document.body.classList.contains('online-home')||mode===3&&!online?.active?[0,0]:mode===3?onlineButtons:[buttons[0],...practiceInputs.slice(1)],localSlot);return {state,buttons:mode===3?onlineButtons:[buttons[0],...practiceInputs.slice(1)],localSlot,correction:mode===3?correction:0,reducedMotion:controls.reducedMotion,snap:snapCamera,didSnap:()=>{snapCamera=false;}};}).catch(error=>{
  worker.terminate();status.textContent=String(error);document.body.classList.add('unavailable');
});

online=new OnlineLobby({
  browse:()=>{if(mode===3)return;document.body.classList.add('online-home');held.clear();input();worker.postMessage({type:'pause',paused:true});},
  start:(slot,continuing)=>{document.querySelector<HTMLButtonElement>('#rematch')!.hidden=false;document.body.classList.remove('online-home');effects.clear();mode=3;if(!continuing)held.clear();snapCamera=!continuing||localSlot!==slot;localSlot=slot;input();result.hidden=true;document.querySelectorAll('[data-mode]').forEach(item=>item.setAttribute('aria-pressed','false'));worker.postMessage({type:'pause',paused:true});},
  frame:(data,slot)=>{if(mode!==3)return;onlineButtons=data.inputs;correction=data.rollbacks+data.desyncs;state=new Int32Array(data.buffer);effects.consume(state);status.innerHTML=hud(slot)+scores();result.hidden=!!data.quick||state[1]<0;if(state[1]>=0)document.querySelector('#winner')!.textContent=`Player ${state[1]+1} wins · ${Array.from({length:state[5]},(_,id)=>state[27+id*16]).join(' : ')} · unverified`;},
  leave:()=>{document.body.classList.remove('online-home');effects.clear();mode=1;localSlot=0;held.clear();input();snapCamera=true;result.hidden=true;document.querySelectorAll<HTMLButtonElement>('[data-mode]').forEach(item=>item.setAttribute('aria-pressed',String(item.dataset.mode==='1')));worker.postMessage({type:'mode',mode,players:Number(practicePlayers.value)});worker.postMessage({type:'pause',paused:document.hidden});document.querySelector('#connection-status')!.textContent='';}
});
