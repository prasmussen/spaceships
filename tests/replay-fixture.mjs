// Generate an independent JS-engine oracle for the Go validator integration test.
import {readFile,writeFile} from 'node:fs/promises';
import {recordReplay} from '../src/replay.ts';
const wasm=await readFile('public/simulation.wasm');
const identity=JSON.parse(await readFile('public/build.json','utf8'));
const players=Number(process.argv[3]??2);
const inputs=Array.from({length:3600},(_,tick)=>Array.from({length:players},(_,id)=>(tick*(7-id*2)+(tick>>(3+id)))&31));
await writeFile(process.argv[2],JSON.stringify(await recordReplay(wasm,identity,inputs,32768,0xffffffff,players)));
