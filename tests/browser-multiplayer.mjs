import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
export async function checkOnlineGroups(browser,base,forceRelay=false){
  const evidence=[];
  for(const players of [3,4]){
    const contexts=[],pages=[],errors=[];
    try{
      for(let id=0;id<players;id++){
        const context=await browser.newContext();contexts.push(context);
        await context.addInitScript(forceRelay=>{
          window.onlineWorkers=[];window.onlineHashes={};window.onlinePCs=[];
          const WorkerBase=window.Worker;window.Worker=class extends WorkerBase{constructor(url,options){super(url,options);if(String(url).includes('online-worker')){
            window.onlineWorkers.push(this);this.addEventListener('message',({data})=>{
              if(data.type==='frame'){window.onlineFrame={...data,state:Array.from(new Int32Array(data.buffer))};if(data.hashTick>=0)window.onlineHashes[data.hashTick]=data.hash;}
              if(data.type==='replay')window.onlineRecording=data;
              if(data.type==='error')window.onlineError=data.message;
            });
          }}};
          const PC=window.RTCPeerConnection;window.RTCPeerConnection=class extends PC{constructor(config){super(forceRelay?{...config,iceTransportPolicy:'relay'}:config);window.onlinePCs.push(this);}};
        },forceRelay);
        const page=await context.newPage();pages.push(page);page.on('pageerror',e=>errors.push(String(e)));
        await page.goto(base);await page.getByLabel('Online players',{exact:true}).selectOption(String(players));
        await page.getByRole('button',{name:'Find opponent',exact:true}).click();
        if(id<players-1)await page.waitForFunction(()=>document.querySelector('#online-status').textContent.includes('Searching'));
      }
      await Promise.all(pages.map(page=>page.waitForFunction(()=>window.onlineFrame?.agreed>=180||window.onlineError,{},{timeout:25000})));
      for(const page of pages){
        const state=await page.evaluate(()=>({error:window.onlineError,players:window.onlineFrame?.state[5],connections:window.onlinePCs.map(pc=>pc.connectionState)}));
        assert.equal(state.error,undefined);assert.equal(state.players,players);assert.deepEqual(state.connections,Array(players-1).fill('connected'));
      }
      if(forceRelay)await Promise.all(pages.map(page=>page.waitForFunction(()=>document.querySelector('#connection-status').textContent.endsWith('· relay'))));
      await Promise.all(pages.map(page=>page.keyboard.down('w')));await pages[0].waitForTimeout(250);await Promise.all(pages.map(page=>page.keyboard.up('w')));
      for(let id=0;id<players;id++)assert.ok(await pages[id].evaluate(id=>window.onlineFrame.state[22+id*16]<6000,id),`slot ${id} receives its controls`);
      await pages.at(-1).evaluate(()=>window.onlineWorkers[0].postMessage({type:'stop'}));
      await pages[0].waitForFunction(()=>window.onlineFrame.stalled,{},{timeout:4000});
      await pages[0].waitForTimeout(600);
      const before=await pages[0].evaluate(()=>window.onlineFrame.agreed);
      await pages.at(-1).evaluate(()=>window.onlineWorkers[0].postMessage({type:'start'}));
      await Promise.all(pages.map(page=>page.waitForFunction(before=>window.onlineFrame.agreed>before+90,before,{timeout:10000})));
      const states=await Promise.all(pages.map(page=>page.evaluate(()=>({tick:window.onlineFrame.tick,agreed:window.onlineFrame.agreed,hashes:window.onlineHashes,depth:window.onlineFrame.maxDepth,error:window.onlineError}))));
      const common=Object.keys(states[0].hashes).filter(t=>states.every(s=>s.hashes[t]));assert.ok(common.length>=3);
      for(const tick of common)for(const state of states){assert.equal(state.hashes[tick],states[0].hashes[tick]);assert.ok(state.depth<=12);assert.equal(state.error,undefined);}
      await pages.at(-1).evaluate(()=>window.onlineWorkers[0].postMessage({type:'replay'}));
      await pages.at(-1).waitForFunction(()=>window.onlineRecording);
      const recording=await pages.at(-1).evaluate(()=>window.onlineRecording);assert.equal(recording.error,undefined);assert.equal(recording.recording.players,players);
      const path=`artifacts/online-${players}-player-replay.json`;await writeFile(path,JSON.stringify(recording.recording));
      await promisify(execFile)('go',['run','./cmd/replaycheck',path]);
      await pages[0].screenshot({path:`artifacts/online-${players}-players.png`});
      await pages.at(-1).getByRole('button',{name:'Online duel',exact:true}).click();await pages.at(-1).getByRole('button',{name:'Practice offline',exact:true}).click();
      await Promise.all(pages.slice(0,-1).map(page=>page.waitForFunction(()=>/Left match|disconnected/i.test(document.querySelector('#connection-status').textContent))));
      assert.deepEqual(errors,[]);evidence.push({players,connectionsPerPeer:players-1,forcedRelay:forceRelay,controls:true,pauseResume:true,commonHashes:common.length,replayValidatedInGo:true,leave:true});
      console.log(`${players}-player online mesh passed: controls, hashes, pause/resume, Go replay and leave.`);
    }catch(error){await writeFile(`artifacts/online-${players}-failure.json`,JSON.stringify(await Promise.all(pages.map(page=>page.evaluate(()=>({status:document.querySelector('#online-status')?.textContent,connection:document.querySelector('#connection-status')?.textContent,error:window.onlineError,frame:window.onlineFrame&&{tick:window.onlineFrame.tick,agreed:window.onlineFrame.agreed},pcs:window.onlinePCs?.map(pc=>({state:pc.connectionState,ice:pc.iceConnectionState,signal:pc.signalingState}))})))),null,2));throw error;}
    finally{await Promise.all(contexts.map(c=>c.close()));}
  }
  await writeFile(`artifacts/online-multiplayer${forceRelay?'-relay':''}.json`,JSON.stringify(evidence,null,2));
}
