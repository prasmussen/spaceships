import type {Simulation} from './simulation';
export const STATE_BYTES=8512,STATE_PTR=4096,SNAPSHOT_PTR=65536,FRAME_PTR=81920,INPUT_PTR=2048;
export class Engine {
  readonly wasm:Simulation;
  readonly map:number;
  readonly seed:number;
  readonly players:number;
  constructor(instance:WebAssembly.Instance,map=32768,seed=0,players=2){
    if(!Number.isInteger(players)||players<1||players>4)throw Error('Invalid player count');
    this.map=map;this.seed=seed;this.players=players;
    this.wasm=instance.exports as Simulation;
    if(!this.wasm.init(1024,map,seed,players))throw Error('Invalid simulation configuration');
  }
  step(pair:readonly number[]){if(pair.length!==this.players||pair.some(b=>!Number.isInteger(b)||b<0||b>31))throw Error('Invalid player input vector');new Uint8Array(this.wasm.memory.buffer,INPUT_PTR,this.players).set(pair);if(!this.wasm.step(INPUT_PTR,1))throw Error('Simulation step rejected');}
  save(){if(this.wasm.save_state(SNAPSHOT_PTR)!==STATE_BYTES)throw Error('Snapshot serialization failed');return new Uint8Array(this.wasm.memory.buffer.slice(SNAPSHOT_PTR,SNAPSHOT_PTR+STATE_BYTES));}
  load(snapshot:Uint8Array){if(snapshot.length!==STATE_BYTES)throw Error('Invalid snapshot size');new Uint8Array(this.wasm.memory.buffer,SNAPSHOT_PTR,STATE_BYTES).set(snapshot);if(!this.wasm.load_state(SNAPSHOT_PTR,STATE_BYTES))throw Error('Snapshot validation failed');}
  hash(){return this.wasm.state_hash().toString();}
  frame(){const length=this.wasm.write_frame(FRAME_PTR);return new Int32Array(this.wasm.memory.buffer.slice(FRAME_PTR,FRAME_PTR+length));}
  static async create(binary:BufferSource,map=32768,seed=0,players=2){const {instance}=await WebAssembly.instantiate(binary);return new Engine(instance,map,seed,players);}
}
