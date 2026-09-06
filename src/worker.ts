import type { Simulation } from './simulation';
let sim: Simulation;
let buttons = [0, 0];
let deadline = 0;
let paused = false;
let map = 32768;
const tickMs = 1000 / 60;
function frame(events?:number[]) {
  const length=sim.write_frame(81920);
  let buffer=sim.memory.buffer.slice(81920,81920+length);
  if(events){const output=new Int32Array(2097+events.length);output.set(new Int32Array(buffer,0,2096));output[2096]=events.length/8;output.set(events,2097);buffer=output.buffer;}
  postMessage({ type: 'frame', buffer }, [buffer]);
}
onmessage = ({ data }) => {
  if (data.type === 'input') buttons = data.buttons;
  if (data.type === 'pause') { paused = data.paused; buttons = [0, 0]; deadline = performance.now(); }
  if (data.type === 'mode') { map = data.mode ? 32768 : 0; if(sim) {sim.init(1024,map,0); frame();} }
  if (data.type === 'reset' && sim) { sim.init(1024, map, 0); deadline = performance.now(); frame(); }
};
async function start() {
  const { instance } = await WebAssembly.instantiateStreaming(fetch('/simulation.wasm'));
  sim = instance.exports as Simulation;
  if (!sim.init(1024, map, 0)) throw Error('Simulation initialization failed');
  deadline = performance.now();
  setInterval(() => {
    if (paused) return;
    const now = performance.now();
    // Suspension never causes an unbounded burst of commands.
    if (now - deadline > 12 * tickMs) deadline = now;
    let count = 0;
    const events:number[]=[];
    while (now >= deadline && count < 12) {
      new Uint8Array(sim.memory.buffer, 2048, 2).set(buttons);
      sim.step(2048, 1);
      sim.write_frame(81920);
      const eventCount=new Int32Array(sim.memory.buffer,90304,1)[0];
      events.push(...new Int32Array(sim.memory.buffer,90308,eventCount*8));
      deadline += tickMs; count++;
    }
    if (count) frame(events);
  }, 4);
}
start().catch(error => postMessage({ type: 'error', message: String(error) }));
