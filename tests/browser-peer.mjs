import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
export async function checkPeer(browser,base,turn){
  const contexts=[],pages=[],pending=[[],[]],failures=[];
  try{
    for(let p=0;p<2;p++){
      const context=await browser.newContext();contexts.push(context);const page=await context.newPage();pages.push(page);await page.goto(new URL('build.json',base).href);
      await page.exposeFunction('renewICE',()=>turn?turn.credentials():[]);
      page.on('pageerror',error=>failures.push(String(error)));
      await page.exposeFunction('routeSignal',async signal=>{
        const remote=signal.recipient;signal={sender:p,signal:signal.signal};if(pending[remote])pending[remote].push(signal);
        else await pages[remote].evaluate(signal=>window.netPeer.signal(signal.signal,signal.sender),signal);
      });
    }
    for(let p=0;p<2;p++){
      await pages[p].evaluate(async ({slot,iceServers,relay})=>{
        const {PeerMatch}=await import('/src/peer-match.ts');const identity=await(await fetch('/build.json')).json();
        window.netRenewals=0;window.netFrames=0;window.netHashes={};window.netEnded='';window.netDiagnostic=[];
        window.netPeer=new PeerMatch({players:2,id:'1234567890abcdef1234567890abcdef',epoch:4100,seed:19,identity,inputDelay:2,recoveryPeer:0,region:'eu'},slot,iceServers,{
          refreshICE:async()=>{window.netRenewals++;return window.renewICE();},
          signal:signal=>window.routeSignal(signal),
          frame:data=>{window.netFrames++;window.netLatest={tick:data.tick,agreed:data.agreed,stalled:data.stalled,rollbacks:data.rollbacks,maxDepth:data.maxDepth};if(data.hashTick>=0)window.netHashes[data.hashTick]=data.hash;},
          status:status=>window.netStatus=status,ended:reason=>window.netEnded=reason,diagnostic:value=>window.netDiagnostic.push(value)
        },relay);
        window.netPeer.input(slot?5:9);
      },{slot:p,iceServers:turn?turn.credentials():[],relay:!!turn});
      const saved=pending[p];pending[p]=null;for(const signal of saved)await pages[p].evaluate(signal=>window.netPeer.signal(signal.signal,signal.sender),signal);
    }
    await Promise.all(pages.map(page=>page.waitForFunction(()=>window.netLatest?.agreed>=180||window.netEnded,{},{timeout:20000})));
    const oldUfrag=await pages[0].evaluate(()=>window.netPeer.pc.localDescription.sdp.match(/a=ice-ufrag:(\S+)/)[1]);
    await pages[0].evaluate(()=>{window.netPeer.links.get(1).renewalAt=0;});
    await Promise.all(pages.map(page=>page.waitForFunction(()=>window.netRenewals>0)));
    await pages[0].waitForFunction(old=>window.netPeer.pc.localDescription.sdp.match(/a=ice-ufrag:(\S+)/)[1]!==old&&window.netPeer.pc.signalingState==='stable',oldUfrag);
    if(turn)await Promise.all(pages.map(page=>page.waitForFunction(()=>window.netPeer.relay)));
    if(process.argv.includes('--soak')){
      if(!turn)throw Error('--soak requires --turn');
      await Promise.all(pages.map(page=>page.evaluate(()=>window.netPeer.input(0))));
      const start=Date.now();let previous=0;
      while(Date.now()-start<660000){
        await pages[0].waitForTimeout(30000);
        const states=await Promise.all(pages.map(page=>page.evaluate(()=>({tick:window.netLatest.agreed,ended:window.netEnded,renewals:window.netRenewals}))));
        for(const state of states){assert.equal(state.ended,'');assert.ok(state.tick>previous);}
        previous=Math.min(...states.map(s=>s.tick));console.log(`TURN soak ${Math.round((Date.now()-start)/1000)}s: agreed ${previous}, credential renewals ${states.map(s=>s.renewals).join('/')}`);
      }
      for(const page of pages)assert.ok(await page.evaluate(()=>window.netRenewals)>=3);
      await writeFile('artifacts/turn-soak.json',JSON.stringify({seconds:(Date.now()-start)/1000,agreedTick:previous,renewals:await Promise.all(pages.map(page=>page.evaluate(()=>window.netRenewals)))},null,2)+'\n');
    }
    const before=await pages[0].evaluate(()=>window.netLatest.agreed);
    await pages[1].evaluate(()=>window.netPeer.worker.postMessage({type:'stop'}));
    await pages[0].waitForFunction(()=>window.netLatest?.stalled,{},{timeout:4000});
    await pages[0].waitForTimeout(1200);
    await pages[1].evaluate(()=>window.netPeer.worker.postMessage({type:'start'}));
    await Promise.all(pages.map(page=>page.waitForFunction(before=>window.netLatest?.agreed>before+90||window.netEnded,before,{timeout:10000})));
    const results=await Promise.all(pages.map(page=>page.evaluate(()=>({state:window.netLatest,ended:window.netEnded,hashes:window.netHashes,connection:window.netPeer.pc.connectionState,channels:{gameplay:{ordered:[...window.netPeer.links.values()][0].gameplayChannel.ordered,retries:[...window.netPeer.links.values()][0].gameplayChannel.maxRetransmits},control:{ordered:[...window.netPeer.links.values()][0].controlChannel.ordered,retries:[...window.netPeer.links.values()][0].controlChannel.maxRetransmits}}}))));
    for(const r of results){assert.equal(r.ended,'');assert.equal(r.connection,'connected');assert.deepEqual(r.channels,{gameplay:{ordered:false,retries:0},control:{ordered:true,retries:null}});assert.ok(r.state.maxDepth<=12);}
    const common=Object.keys(results[0].hashes).filter(t=>results[1].hashes[t]);assert.ok(common.some(t=>Number(t)>=119));for(const tick of common)assert.equal(results[0].hashes[tick],results[1].hashes[tick]);
    await pages[1].evaluate(()=>window.netPeer.worker.postMessage({type:'stop'}));
    await pages[0].waitForFunction(()=>window.netEnded!=='',{},{timeout:15000});
    assert.match(await pages[0].evaluate(()=>window.netEnded),/input synchronization timed out/);
    await pages[1].waitForFunction(()=>window.netEnded!=='');
    pending[0]=[];pending[1]=[];
    for(let p=0;p<2;p++){
      await pages[p].evaluate(async slot=>{
        const {PeerMatch}=await import('/src/peer-match.ts');const identity=await(await fetch('/build.json')).json();if(slot===1)identity.config='f'.repeat(64);
        window.netEnded='';window.netFrames=0;
        window.netPeer=new PeerMatch({players:2,id:'2234567890abcdef1234567890abcdef',epoch:4101,seed:19,identity,inputDelay:2,recoveryPeer:0,region:'eu'},slot,[],{
          signal:signal=>window.routeSignal(signal),frame:()=>window.netFrames++,status:()=>{},ended:reason=>window.netEnded=reason,diagnostic:()=>{}
        });
      },p);
      const saved=pending[p];pending[p]=null;for(const signal of saved)await pages[p].evaluate(signal=>window.netPeer.signal(signal.signal,signal.sender),signal);
    }
    await Promise.all(pages.map(page=>page.waitForFunction(()=>window.netEnded!=='',{},{timeout:10000})));
    for(const page of pages){assert.match(await page.evaluate(()=>window.netEnded),/mismatch/);assert.equal(await page.evaluate(()=>window.netFrames),0);}
    assert.deepEqual(failures,[]);await writeFile(turn?'artifacts/relay-peer-browser.json':'artifacts/peer-browser.json',JSON.stringify(results,null,2)+'\n');
    console.log('Real WebRTC channels and two rollback workers passed: independent inputs, agreed hashes, outage resume, bounded disconnect and build rejection.');
  }finally{await Promise.all(contexts.map(c=>c.close()));}
}
