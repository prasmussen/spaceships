export interface Simulation extends WebAssembly.Exports {
  memory: WebAssembly.Memory;
  init(config: number, map: number, seed: number, players: number): number;
  step(input: number, count: number): number;
  write_frame(dst: number): number;
  save_state(dst:number):number;
  load_state(src:number,length:number):number;
  state_hash(): bigint;
}
