import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {build} from 'vite';
import {matchInputs} from './match-inputs.mjs';
export async function checkFullMatch(browser,base,relay){
  await build({configFile:false,logLevel:'error',build:{outDir:'artifacts/scripted-worker',emptyOutDir:false,minify:false,lib:{entry:resolve('tests/scripted-online-worker.ts'),formats:['es'],fileName:()=> 'worker.js'}}});
  const counts=process.argv.includes('--multiplayer')?[2,3,4]:[2],evidence=[];
  for(const players of counts){
    const fixtures=await Promise.all([0,1,2,3].map(seed=>matchInputs(players,seed))),contexts=[],pages=[];
    try{
      for(let p=0;p<players;p++){
        const context=await browser.newContext();contexts.push(context);
        await context.route('**/test-online-worker.js',route=>route.fulfill({path:'artifacts/scripted-worker/worker.js',contentType:'text/javascript'}));
        await context.addInitScript(({fixtures,relay})=>{
          window.matchFrames=[];window.matchRecordings=[];window.matchErrors=[];
          const NativeWorker=window.Worker;
          window.Worker=class extends NativeWorker{constructor(url,options){
            const online=String(url).includes('online-worker');super(online?'/test-online-worker.js':url,options);
            if(online){this.postMessage({type:'fixture',fixtures});this.addEventListener('message',({data})=>{
              if(data.type==='frame')window.matchFrame={tick:data.tick,agreed:data.agreed,hash:data.hash,hashTick:data.hashTick,state:Array.from(new Int32Array(data.buffer))};
              if(data.type==='replay')window.matchRecordings.push(data);
              if(data.type==='error')window.matchErrors.push(data.message);
            });}
          }};
          if(relay){const PC=window.RTCPeerConnection;window.RTCPeerConnection=class extends PC{constructor(config){super({...config,iceTransportPolicy:'relay'});}};}
        },{fixtures,relay});
        const page=await context.newPage();pages.push(page);await page.goto(base);
        await page.evaluate(players=>{
          // These replay/fixture checks exercise the retained fixed-roster protocol.
          const send=WebSocket.prototype.send;
          WebSocket.prototype.send=function(raw){const m=JSON.parse(raw);return send.call(this,m.type==='quickPlay'?JSON.stringify({type:'queue',players}):raw);};
        },players);
        await page.getByRole('button',{name:'Quick play',exact:true}).click();
        if(p<players-1)await page.waitForFunction(()=>document.querySelector('#online-status').textContent.includes('Searching'));
      }
      await Promise.all(pages.map(page=>page.waitForFunction(()=>document.querySelector('#connection-status').textContent.includes('Online ·'),{},{timeout:20000})));
      if(relay)await Promise.all(pages.map(page=>page.waitForFunction(()=>document.querySelector('#connection-status').textContent.endsWith('· relay'))));
      console.log(`Playing complete ${players}-player ${relay?'TURN':'direct'} match with normal inputs (up to ${Math.max(...fixtures.map(f=>f.length))} ticks)…`);
      const deadline=Date.now()+300000;
      while(true){
        const states=await Promise.all(pages.map(page=>page.evaluate(()=>({winner:window.matchFrame?.state[1],tick:window.matchFrame?.tick,errors:window.matchErrors,status:document.querySelector('#connection-status').textContent}))));
        for(const state of states){assert.deepEqual(state.errors,[]);assert.doesNotMatch(state.status,/timed out|mismatch|aborted/i);}
        if(states.every(state=>state.winner===0))break;
        if(Date.now()>deadline)throw Error(`Full match timed out: ${JSON.stringify(states)}`);
        await pages[0].waitForTimeout(10000);
        console.log(`${players}-player full-match progress: ${states.map(s=>s.tick??0).join('/')}`);
      }
      for(const page of pages){
        const state=await page.evaluate(()=>window.matchFrame.state);assert.equal(state[27],5);for(let id=1;id<players;id++)assert.equal(state[27+id*16],0);
        assert.match(await page.locator('#winner').textContent(),/Player 1 wins/);
        await page.waitForFunction(()=>window.matchRecordings.some(r=>r.finalize&&r.recording),{},{timeout:15000});
      }
      const recording=await pages[0].evaluate(()=>window.matchRecordings.find(r=>r.finalize).recording);
      const path=`artifacts/full-${players}-${relay?'relay':'direct'}-replay.json`;await writeFile(path,JSON.stringify(recording));
      await promisify(execFile)('go',['run','./cmd/replaycheck',path]);
      for(const page of pages)await page.locator('#online-ready').click();
      await Promise.all(pages.map(page=>page.waitForFunction(()=>document.querySelector('#result').hidden&&document.querySelector('#connection-status').textContent.includes('Online ·'),{},{timeout:20000})));
      for(const page of pages)assert.equal(await page.locator('#status strong').nth(5).textContent(),'0');
      await pages[0].getByRole('button',{name:'Online duel',exact:true}).click();await pages[0].getByRole('button',{name:'Practice offline',exact:true}).click();
      await Promise.all(pages.slice(1).map(page=>page.waitForFunction(()=>/Left match|disconnected/i.test(document.querySelector('#connection-status').textContent))));
      evidence.push({players,normalInputs:true,firstToFive:true,goReplay:true,rematch:true,leave:true});
      await writeFile(`artifacts/full-${relay?'relay':'direct'}-match.json`,JSON.stringify(evidence,null,2));
      console.log(`Complete ${players}-player ${relay?'TURN':'direct'} match, replay and rematch passed.`);
    }catch(error){await writeFile('artifacts/full-match-failure.json',JSON.stringify(await Promise.all(pages.map(page=>page.evaluate(()=>({frame:window.matchFrame,errors:window.matchErrors,recordings:window.matchRecordings?.map(r=>({error:r.error,finalize:r.finalize})),connection:document.querySelector('#connection-status').textContent,status:document.querySelector('#online-status').textContent})))),null,2));throw error;}
    finally{await Promise.all(contexts.map(c=>c.close()));}
  }
}
