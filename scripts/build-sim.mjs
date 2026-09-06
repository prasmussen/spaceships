process.on('uncaughtException',error=>{console.error(error.message);process.exit(1);});
import { createHash } from 'node:crypto';
import wabtFactory from 'wabt';
import {HULL_FRAGMENTS} from '../src/hull-fragments.ts';
import {readFile, writeFile, mkdir} from 'node:fs/promises';
const wabt = await wabtFactory();
const table = await readFile(new URL('../sim/sine.json', import.meta.url), 'utf8');
const values = JSON.parse(table);
if (values.length !== 4096 || values.some(v => !Number.isInteger(v) || Math.abs(v)>65536)) throw Error('Invalid trig table');
const bytes = Buffer.alloc(values.length*4);
values.forEach((v,i)=>bytes.writeInt32LE(v,i*4));
const data = [...bytes].map(v=>'\\'+v.toString(16).padStart(2,'0')).join('');
const tuningSource = await readFile('sim/tuning.json','utf8');
const tuning = JSON.parse(tuningSource);
const configKeys = ['version','tickRate','substeps','gravityPerSubstep','thrustPerSubstep','angularAccelerationPerSubstep','maxAngularSpeed','maxSpeed','maxPosition','fuelCapacity','hull','landingMaxVx','landingMaxVy','landingMaxAngle','landingMaxSpin','refuelPerSubstep','muzzleSpeed','projectileLifetime','weaponCooldown','spawnProtection','angularBrakingPerSubstep','movementDragDivisor','exhaustForcePerSubstep','padExhaustResponse','boostThrustPerSubstep','boostExhaustForcePerSubstep','boostDuration','boostCooldown','boostFuelCost','shieldDuration','shieldCooldown','shieldEnergyCost','repairDelay','projectileDamage'];
const configBytes = Buffer.alloc(configKeys.length*4);
for (const [i,key] of configKeys.entries()) {
  if (!Number.isSafeInteger(tuning[key]) || tuning[key] < 1 || tuning[key] > 1073741824) throw Error(`Invalid tuning: ${key}`);
  configBytes.writeInt32LE(tuning[key], i*4);
}
if(tuning.shieldDuration>255||tuning.shieldDuration>tuning.shieldCooldown||tuning.shieldCooldown>65535||tuning.shieldEnergyCost>tuning.fuelCapacity||tuning.repairDelay>65535||tuning.projectileDamage>tuning.hull)throw Error('Shield/repair tuning exceeds bounds');
if (tuning.boostThrustPerSubstep > 65536 || tuning.boostExhaustForcePerSubstep > 65536 || tuning.boostDuration > tuning.boostCooldown || tuning.boostCooldown > 3600 || tuning.boostFuelCost >= tuning.fuelCapacity) throw Error('Boost tuning exceeds bounds');
if (tuning.movementDragDivisor < 2 || tuning.movementDragDivisor > 65536 || tuning.tickRate !== 60 || tuning.substeps !== 2 || tuning.maxSpeed > 4194304 || tuning.maxPosition > 1073741824 || tuning.maxAngularSpeed > 4096 || tuning.fuelCapacity > 1000000 || tuning.hull !== 600 || tuning.angularBrakingPerSubstep > 64 || tuning.angularAccelerationPerSubstep > 64 || tuning.padExhaustResponse > 64 || tuning.exhaustForcePerSubstep > 65536 || tuning.thrustPerSubstep > 65536 || tuning.gravityPerSubstep > 65536) throw Error('Tuning exceeds proven bounds');
if(tuning.muzzleSpeed>786432 || tuning.projectileLifetime>120 || tuning.weaponCooldown>120 || tuning.spawnProtection>600)throw Error('Combat tuning exceeds proven bounds');
const configData = [...configBytes].map(v=>'\\'+v.toString(16).padStart(2,'0')).join('');
const caveSource = await readFile('sim/cave.json','utf8');
const cave = JSON.parse(caveSource);
if(cave.width!==4800 || cave.height!==3000 || cave.cellSize!==300 || cave.solids.length>32 || cave.pads.length!==4)throw Error('Unsupported cave bounds');
const mapBytes=Buffer.alloc(1664);
mapBytes.writeInt32LE(cave.version,0);mapBytes.writeInt32LE(cave.width*65536,4);mapBytes.writeInt32LE(cave.height*65536,8);mapBytes.writeInt32LE(cave.solids.length,12);
for(const [i,pad]of cave.pads.entries()) {
  if(![pad.x,pad.y,pad.halfWidth].every(Number.isInteger) || pad.x<pad.halfWidth || pad.x+pad.halfWidth>cave.width || pad.y<16 || pad.y>cave.height)throw Error('Invalid pad');
  [pad.x,pad.y,pad.halfWidth].forEach((v,k)=>mapBytes.writeInt32LE(v*65536,16+i*12+k*4));
}
for(const [i,rect]of cave.solids.entries()) {
  if(rect.length!==4 || !rect.every(Number.isInteger) || rect[0]<0 || rect[1]<0 || rect[2]>cave.width || rect[3]>cave.height || rect[0]>=rect[2] || rect[1]>=rect[3])throw Error('Invalid solid');
  rect.forEach((v,k)=>mapBytes.writeInt32LE(v*65536,64+i*16+k*4));
  for(let y=0;y<10;y++)for(let x=0;x<16;x++)if(rect[0]<=(x+1)*cave.cellSize && rect[2]>=x*cave.cellSize && rect[1]<=(y+1)*cave.cellSize && rect[3]>=y*cave.cellSize) {
    const offset=1024+(y*16+x)*4;mapBytes.writeUInt32LE((mapBytes.readUInt32LE(offset)|(1<<i))>>>0,offset);
  }
}
const mapData=[...mapBytes].map(v=>'\\'+v.toString(16).padStart(2,'0')).join('');
let source = (await readFile('sim/core.wat','utf8')).replace(';; TRIG_TABLE',`(data (i32.const 16384) "${data}")`);
const debrisBytes=Buffer.alloc(16*24);
HULL_FRAGMENTS.forEach((shape,i)=>{
  const direction=Math.atan2(shape.y,shape.x),speed=(shape.strip?65:40)+(i*17%50);
  [shape.x*65536,shape.y*65536,shape.size*1.1*65536,Math.cos(direction)*speed/60*65536,Math.sin(direction)*speed/60*65536,(i%2?1:-1)*(12+i%17)].forEach((v,k)=>debrisBytes.writeInt32LE(Math.round(v),i*24+k*4));
});
source=source.replace(';; DEBRIS',await readFile('sim/debris.wat','utf8'));
source=source.replace(';; DEBRIS_DATA',`(data (i32.const 36000) "${[...debrisBytes].map(v=>'\\'+v.toString(16).padStart(2,'0')).join('')}")`);
source = source.replace(';; EVENTS',await readFile('sim/events.wat','utf8'));
source=source.replace(';; EXHAUST',await readFile('sim/exhaust.wat','utf8'));
source = source.replace(';; COMBAT',await readFile('sim/combat.wat','utf8'));
source = source.replace(';; COLLISION',await readFile('sim/collision.wat','utf8')).replace(';; LANDING',await readFile('sim/landing.wat','utf8'));
source = source.replace(';; MAP_DATA',`(data (i32.const 32768) \"${mapData}\")`).replace(';; MAP_VALIDATE', Array.from({length:mapBytes.length/4},(_,i)=>`(if (i32.ne (i32.load (i32.const ${32768+i*4})) (i32.const ${mapBytes.readInt32LE(i*4)})) (then (return (i32.const 0))))`).join('\n'));
source = source.replace(';; CONFIG_DATA', `(data (i32.const 1024) \"${configData}\")`).replace(';; CONFIG_VALIDATE', configKeys.map((key,i) => `(if (i32.ne (i32.load (i32.const ${1024+i*4})) (i32.const ${tuning[key]})) (then (return (i32.const 0))))`).join('\n'));
const constants={...tuning,cellSizeQ:cave.cellSize*65536,padCount:cave.pads.length,padsEnd:32784+cave.pads.length*12,mapWidthQ:cave.width*65536,mapHeightQ:cave.height*65536};
source = source.replace(/@([a-zA-Z]+)@/g, (_,key)=> { if (!(key in constants)) throw Error(`Unknown tuning ${key}`); return String(constants[key]); });
const module = wabt.parseWat('simulation.wat',source);
module.resolveNames(); module.validate();
const {buffer} = module.toBinary({canonicalize_lebs:true,write_debug_names:true});
const binary = wabt.readWasm(buffer,{}); binary.validate();
await mkdir('public',{recursive:true});
await mkdir('tests',{recursive:true});
await writeFile('public/simulation.wasm',buffer);
const hash = data => createHash('sha256').update(data).digest('hex');
await writeFile('public/build.json',JSON.stringify({protocol:2,abi:2,wasm:hash(buffer),config:hash(configBytes),map:hash(mapBytes),tuning},null,2)+'\n');
const diagnostic=wabt.parseWat('collision-test.wat',source.replace(/\)\s*$/, '(export \"circle_toi\" (func $circle_toi)) (export \"rect_toi\" (func $rect_toi)) (export \"terrain_toi\" (func $terrain_toi)))'));
diagnostic.validate();
await writeFile('tests/collision-test.wasm',diagnostic.toBinary({}).buffer);
console.log(`Validated handwritten simulation: ${buffer.length} bytes`);
