// Generate an independent JS-engine oracle for the Go validator integration test.
import {readFile,writeFile} from 'node:fs/promises';
import {recordReplay} from '../src/replay.ts';
const wasm=await readFile('public/simulation.wasm');
const identity=JSON.parse(await readFile('public/build.json','utf8'));
const inputs=Array.from({length:3600},(_,tick)=>[(tick*7+(tick>>3))&15,(tick*3+(tick>>4))&15]);
await writeFile(process.argv[2],JSON.stringify(await recordReplay(wasm,identity,inputs,32768,0xffffffff)));
