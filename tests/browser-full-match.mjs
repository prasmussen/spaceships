import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {matchInputs} from './match-inputs.mjs';
export async function checkFullMatch(browser,base,relay){
  const inputs=await matchInputs(),contexts=[],pages=[];
  try{
    for(let p=0;p<2;p++){
      const context=await browser.newContext();contexts.push(context);
      await context.addInitScript(inputs=>{
        const NativeWorker=window.Worker;
        window.Worker=class extends NativeWorker{
          constructor(url,options){
            if(String(url).includes('online-worker')){
              const source=`const originalFetch=self.fetch.bind(self);self.fetch=(url,options)=>originalFetch(typeof url==='string'?new URL(url,${JSON.stringify(location.href)}).href:url,options);const inputs=${JSON.stringify(inputs)};let slot=0,loaded=false;const pending=[];const send=self.postMessage.bind(self);self.addEventListener('message',e=>{if(!loaded){pending.push(e.data);e.stopImmediatePropagation();return;}if(e.data.type==='init')slot=e.data.slot;});self.postMessage=(data,...args)=>{if(data.type==='booted'||data.type==='frame'){const tick=data.type==='booted'?0:data.tick;self.dispatchEvent(new MessageEvent('message',{data:{type:'input',buttons:inputs[tick+2]?.[slot]??0}}));}return send(data,...args);};await import(${JSON.stringify(new URL(url,location.href).href)});loaded=true;for(const data of pending)self.dispatchEvent(new MessageEvent('message',{data}));`;
              const blob=URL.createObjectURL(new Blob([source],{type:'text/javascript'}));super(blob,options);this.addEventListener('message',()=>URL.revokeObjectURL(blob),{once:true});
            }else super(url,options);
          }
        };
      },inputs);
      if(relay)await context.addInitScript(()=>{
        const PC=window.RTCPeerConnection;
        window.RTCPeerConnection=class extends PC{constructor(config){super({...config,iceTransportPolicy:'relay'});}};
      });
      const page=await context.newPage();pages.push(page);await page.goto(base);await page.waitForFunction(()=>document.querySelector('#status').textContent.includes('FUEL'));
      await page.getByRole('button',{name:'Find opponent',exact:true}).click();
      await page.waitForFunction(()=>document.querySelector('#online-status').textContent.includes('Searching'));
      await page.getByRole('button',{name:'Cancel search',exact:true}).click();
      await page.waitForFunction(()=>document.querySelector('#online-status').textContent.includes('Search cancelled'));
      await page.waitForFunction(()=>!document.querySelector('#queue-join').disabled);

    }
    await pages[0].getByRole('button',{name:'Find opponent',exact:true}).click();
    await pages[0].waitForFunction(()=>document.querySelector('#online-status').textContent.includes('Searching'));
    await pages[1].getByRole('button',{name:'Find opponent',exact:true}).click();
    await Promise.all(pages.map(page=>page.waitForFunction(()=>document.querySelector('#connection-status').textContent.includes('Online ·'),{},{timeout:20000})));
    if(relay)await Promise.all(pages.map(page=>page.waitForFunction(()=>document.querySelector('#connection-status').textContent.endsWith('· relay'))));
    console.log(`Playing complete ${relay?'TURN':'direct'} match with normal inputs (${inputs.length} scripted ticks)…`);
    await Promise.all(pages.map(page=>page.waitForFunction(()=>!document.querySelector('#result').hidden,{},{timeout:80000})));
    for(const page of pages)assert.match(await page.locator('#winner').textContent(),/Player 1 wins · 5 : 0/);
    await Promise.all(pages.map(page=>page.getByRole('button',{name:'Rematch',exact:true}).click()));
    await Promise.all(pages.map(page=>page.waitForFunction(()=>document.querySelector('#result').hidden&&document.querySelector('#connection-status').textContent.includes('Online ·'),{},{timeout:20000})));
    for(const page of pages)assert.equal(await page.locator('#status strong').nth(4).textContent(),'0');
    await pages[0].getByRole('button',{name:'Online duel',exact:true}).click();await pages[0].getByRole('button',{name:'Practice offline',exact:true}).click();
    await pages[1].waitForFunction(()=>/Left match|disconnected/i.test(document.querySelector('#connection-status').textContent));
    await writeFile(`artifacts/full-${relay?'relay':'direct'}-match.json`,JSON.stringify({normalInputs:true,firstToFive:true,rematch:true,leave:true},null,2)+'\n');
    console.log(`Complete ${relay?'TURN':'direct'} match and rematch passed.`);
  }catch(error){await writeFile('artifacts/full-match-failure.json',JSON.stringify(await Promise.all(pages.map(page=>page.evaluate(()=>({connection:document.querySelector('#connection-status').textContent,status:document.querySelector('#online-status').textContent,hud:document.querySelector('#status').textContent})))),null,2));throw error;}finally{await Promise.all(contexts.map(context=>context.close()));}
}
