// Local Docker relay fixture; invoked only by node tests/browser.mjs --turn.
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {networkInterfaces} from 'node:os';
import {randomBytes,createHmac} from 'node:crypto';
import {createConnection,isIPv4} from 'node:net';
import {writeFile} from 'node:fs/promises';
const exec=promisify(execFile);
export async function startTurn(){
  const host=process.env.TURN_TEST_IP??Object.values(networkInterfaces()).flat().find(a=>a.family==='IPv4'&&!a.internal)?.address;
  if(!host||!isIPv4(host))throw Error('Set TURN_TEST_IP to a reachable local IPv4 address');
  const secret=randomBytes(32).toString('hex');
  const image='coturn/coturn@sha256:aa68aab64a3b929d57fc2924c98ea447bf996cf8dade2508e7b71eaf23f1f14e';
  const {stdout}=await exec('docker',['run','--rm','-d','--name',`spaceships-turn-test-${process.pid}`,
    '-p',`${host}:34789:3478/tcp`,'-p',`${host}:34789:3478/udp`,'-p',`${host}:45000-45031:45000-45031/udp`,image,
    '-c','/dev/null','--log-file=stdout','--no-tls','--fingerprint','--use-auth-secret',`--static-auth-secret=${secret}`,
    '--realm=spaceships-test','--verbose',`--external-ip=${host}`,'--min-port=45000','--max-port=45031','--user-quota=16','--total-quota=128']).catch(async error=>{const id=error.stdout?.trim();if(/^[a-f0-9]{64}$/.test(id??''))await exec('docker',['rm','-f',id]);throw Error(error.stderr??'Unable to start local TURN');});
  const id=stdout.trim();
  async function close(){
    try{const {stdout,stderr}=await exec('docker',['logs',id]);await writeFile('artifacts/turn-server.log',stdout+stderr);}finally{await exec('docker',['stop','-t','2',id]);}
  }
  try{
    const deadline=Date.now()+15000;
    while(true){
      const ready=await new Promise(resolve=>{const socket=createConnection({host,port:34789});socket.setTimeout(500);socket.once('connect',()=>{socket.destroy();resolve(true)});socket.once('error',()=>resolve(false));socket.once('timeout',()=>{socket.destroy();resolve(false)});});
      if(ready)break;if(Date.now()>deadline)throw Error('Local TURN did not listen');await new Promise(resolve=>setTimeout(resolve,100));
    }
    const credentials=()=>{const username=`${Math.floor(Date.now()/1000)+600}:${randomBytes(6).toString('hex')}`;return [{urls:[`turn:${host}:34789?transport=udp`,`turn:${host}:34789?transport=tcp`],username,credential:createHmac('sha1',secret).update(username).digest('base64')}];};
    return {credentials,urls:`turn:${host}:34789?transport=udp,turn:${host}:34789?transport=tcp`,secret,close};
  }catch(error){await close();throw error;}
}
