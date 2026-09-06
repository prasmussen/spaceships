import {ProtocolError} from './rollback.ts';
export const PROTOCOL=2;
export interface InputPacket {epoch:number;sender:number;start:number;ack:number;frames:number[]}
// 20-byte header + one byte per input: magic u16, protocol u8, sender u8,
// epoch u32, start tick u32, inclusive complete frontier i32, count u8, 3 zero bytes.
export function encodeInput(packet:InputPacket):ArrayBuffer {
  validateFields(packet);
  const buffer=new ArrayBuffer(20+packet.frames.length),v=new DataView(buffer);
  v.setUint16(0,0x4344,true);v.setUint8(2,PROTOCOL);v.setUint8(3,packet.sender);
  v.setUint32(4,packet.epoch,true);v.setUint32(8,packet.start,true);v.setInt32(12,packet.ack,true);v.setUint8(16,packet.frames.length);
  new Uint8Array(buffer,20).set(packet.frames);return buffer;
}
function validateFields(p:InputPacket){
  if(!Number.isInteger(p.epoch)||p.epoch<0||p.epoch>0xffffffff||![0,1,2,3].includes(p.sender)||!Number.isInteger(p.start)||p.start<0||p.start>2147483400||!Number.isInteger(p.ack)||p.ack<1||p.ack>2147483527||!Array.isArray(p.frames)||p.frames.length<1||p.frames.length>8||p.frames.some(b=>!Number.isInteger(b)||b<0||b>31))throw new ProtocolError('Malformed input packet');
}
export function decodeInput(buffer:ArrayBuffer,epoch:number,remote:number,tick:number):InputPacket {
  if(!(buffer instanceof ArrayBuffer)||buffer.byteLength<21||buffer.byteLength>28)throw new ProtocolError('Invalid gameplay packet size');
  const v=new DataView(buffer),count=v.getUint8(16);
  if(v.getUint16(0,true)!==0x4344||v.getUint8(2)!==PROTOCOL||v.getUint8(17)||v.getUint16(18,true)||buffer.byteLength!==20+count)throw new ProtocolError('Invalid gameplay packet header');
  const packet:InputPacket={epoch:v.getUint32(4,true),sender:v.getUint8(3),start:v.getUint32(8,true),ack:v.getInt32(12,true),frames:[...new Uint8Array(buffer,20)]};
  validateFields(packet);
  if(packet.epoch!==epoch||packet.sender!==remote)throw new ProtocolError('Gameplay epoch or ownership mismatch');
  if(packet.start+count-1<tick-120||packet.start+count-1>tick+120||packet.ack>tick+120)throw new ProtocolError('Gameplay tick window exceeded');
  return packet;
}
export type Control =
 | {type:'hello';matchId:string;epoch:number;slot:number;players:number;identity:{protocol:number;abi:number;wasm:string;map:string;config:string};inputDelay:number}
 | {type:'meshReady'} | {type:'ready'} | {type:'start';delayMs:number;oneWayMs:number} | {type:'started'}
 | {type:'ping';id:number;sent:number} | {type:'pong';id:number;sent:number}
 | {type:'repair';start:number;frames:number[];ack:number}
 | {type:'need';from:number;to:number}
 | {type:'hash';tick:number;hash:string;revision:number}
 | {type:'desync';tick:number}
 | {type:'recoveryDone';tick:number}
 | {type:'recover';tick:number;snapshot:number[]}
 | {type:'recovered';tick:number;hash:string}
 | {type:'resume';tick:number;complete:number;epoch:number}
 | {type:'bye';reason:string};
export function decodeControl(raw:string):Control {
  if(typeof raw!=='string'||raw.length>40000)throw new ProtocolError('Control message exceeds limit');
  let m:Record<string,unknown>;
  try{m=JSON.parse(raw);}catch{throw new ProtocolError('Malformed control JSON');}
  if(!m||typeof m!=='object'||Array.isArray(m))throw new ProtocolError('Invalid control object');
  const integer=(v:unknown,min=0,max=2147483527)=>typeof v==='number'&&Number.isInteger(v)&&v>=min&&v<=max;
  const hash=(v:unknown)=>typeof v==='string'&&/^-?\d{1,20}$/.test(v);
  const digest=(v:unknown)=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
  let valid=false;
  switch(m.type){
    case 'hello':{const i=m.identity as Record<string,unknown>;valid=typeof m.matchId==='string'&&/^[a-f0-9]{32}$/.test(m.matchId)&&integer(m.epoch,0,0xffffffff)&&integer(m.slot,0,3)&&integer(m.players,2,4)&&(m.slot as number)<(m.players as number)&&m.inputDelay===2&&!!i&&i.protocol===PROTOCOL&&integer(i.abi,1,100)&&digest(i.wasm)&&digest(i.map)&&digest(i.config);break;}
    case 'meshReady':case 'ready':case 'started':valid=true;break;
    case 'start':valid=typeof m.delayMs==='number'&&Number.isFinite(m.delayMs)&&m.delayMs>=100&&m.delayMs<=10000&&typeof m.oneWayMs==='number'&&Number.isFinite(m.oneWayMs)&&m.oneWayMs>=0&&m.oneWayMs<=m.delayMs;break;
    case 'ping':case 'pong':valid=integer(m.id)&&typeof m.sent==='number'&&Number.isFinite(m.sent)&&m.sent>=0&&m.sent<1e15;break;
    case 'repair':valid=integer(m.start)&&integer(m.ack,1)&&Array.isArray(m.frames)&&m.frames.length>0&&m.frames.length<=120&&m.frames.every(b=>integer(b,0,31));break;
    case 'need':valid=integer(m.from)&&integer(m.to)&&(m.to as number)>=(m.from as number)&&(m.to as number)-(m.from as number)<120;break;
    case 'hash':valid=integer(m.tick)&&hash(m.hash)&&integer(m.revision,0,1);break;
    case 'recovered':valid=integer(m.tick)&&hash(m.hash);break;
    case 'desync':case 'recoveryDone':valid=integer(m.tick);break;
    case 'recover':valid=integer(m.tick)&&Array.isArray(m.snapshot)&&m.snapshot.length===8512&&m.snapshot.every(b=>integer(b,0,255));break;
    case 'resume':valid=integer(m.tick)&&integer(m.complete,1)&&integer(m.epoch,0,0xffffffff);break;
    case 'bye':valid=typeof m.reason==='string'&&m.reason.length<=100;break;
  }
  if(!valid)throw new ProtocolError('Invalid control payload');
  return m as unknown as Control;
}
