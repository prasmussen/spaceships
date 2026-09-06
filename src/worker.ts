import type { Simulation } from './simulation';
import { ComputerPilot } from './computer-pilot';
const computers=Array.from({length:3},(_,id)=>new ComputerPilot(id+1));
let players=2;
let inputs=[0,0];
let computerButtons=0;
let sim: Simulation;
let buttons = 0;
let deadline = 0;
let paused = false;
let map = 32768;
const tickMs = 1000 / 60;
const randomSeed=()=>crypto.getRandomValues(new Uint32Array(1))[0];
function frame(events?:number[]) {
  const length=sim.write_frame(81920);
  let buffer=sim.memory.buffer.slice(81920,81920+length);
  if(events){const output=new Int32Array(2129+events.length);output.set(new Int32Array(buffer,0,2128));output[2128]=events.length/8;output.set(events,2129);buffer=output.buffer;}
  postMessage({ type: 'frame', buffer, computerButtons,inputs }, [buffer]);
}
onmessage = ({ data }) => {
  if (data.type === 'input') buttons = data.buttons;
  if (data.type === 'pause') { paused = data.paused; buttons = 0; deadline = performance.now(); }
  if (data.type === 'mode') { if(Number.isInteger(data.players)&&data.players>=2&&data.players<=4)players=data.players; map = data.mode ? 32768 : 32769; for(const computer of computers)computer.reset();computerButtons=0;inputs=Array(players).fill(0); if(sim) {sim.init(1024,map,randomSeed(),players); deadline=performance.now();frame();} }
};
async function start() {
  const { instance } = await WebAssembly.instantiateStreaming(fetch('/simulation.wasm'));
  sim = instance.exports as Simulation;
  if (!sim.init(1024, map, randomSeed(),players)) throw Error('Simulation initialization failed');
  deadline = performance.now();
  setInterval(() => {
    if (paused) return;
    const now = performance.now();
    // Suspension never causes an unbounded burst of commands.
    if (now - deadline > 12 * tickMs) deadline = now;
    let count = 0;
    const events:number[]=[];
    while (now >= deadline && count < 12) {
      const state=new Int32Array(sim.memory.buffer,4096,2128);
      inputs=[buttons,...computers.slice(0,players-1).map(computer=>computer.input(state))];computerButtons=inputs[1];
      new Uint8Array(sim.memory.buffer, 2048, players).set(inputs);
      sim.step(2048, 1);
      sim.write_frame(81920);
      const eventCount=new Int32Array(sim.memory.buffer,90432,1)[0];
      events.push(...new Int32Array(sim.memory.buffer,90436,eventCount*8));
      deadline += tickMs; count++;
    }
    if (count) frame(events);
  }, 4);
}
start().catch(error => postMessage({ type: 'error', message: String(error) }));
