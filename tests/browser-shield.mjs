import {chromium} from '@playwright/test';
import {createServer} from 'vite';
import assert from 'node:assert/strict';
const server=await createServer({server:{host:'127.0.0.1',port:0}});
let browser;
try{
 await server.listen();browser=await chromium.launch({channel:'chrome',headless:true,args:['--enable-unsafe-webgpu']});
 const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];
 page.setDefaultTimeout(15000);
 page.on('pageerror',e=>errors.push(String(e)));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
 await page.goto(server.resolvedUrls.local[0]);
 assert.equal(await page.title(),'Spaceships');
 assert.equal(await page.locator('h1').textContent(),'Spaceships');
 assert.equal(await page.locator('#online-panel').getAttribute('aria-label'),'Online multiplayer');
 await page.screenshot({path:'artifacts/spaceships-home.png'});
 // Migrate an existing layout whose thrust key already uses the new default E.
 await page.evaluate(()=>{localStorage.removeItem('spaceships-controls-v3');localStorage.setItem('spaceships-controls-v2',JSON.stringify(['KeyE','KeyA','KeyD','Space','ShiftLeft']));});
 await page.reload();await page.locator('#local-menu summary').click();await page.getByRole('button',{name:'Landing course',exact:true}).click();
 const shield=page.locator('#status span').filter({hasText:'SHIELD'});
 await page.waitForFunction(()=>document.querySelector('#status').textContent.includes('ENERGY'));
 assert.match(await page.locator('#status').textContent(),/HULL 100%/);
 await page.keyboard.down('q');await shield.getByText('ACTIVE',{exact:true}).waitFor();
 await page.screenshot({path:'artifacts/shield.png'});await page.keyboard.up('q');
 await page.waitForFunction(()=>/SHIELD\s+\d\.\ds/.test(document.querySelector('#status').textContent));
 await page.getByRole('button',{name:'Open game menu',exact:true}).click();await page.locator('#controls-open').click();
 assert.equal(await page.getByRole('button',{name:'Shield',exact:true}).textContent(),'Q');
 await page.getByRole('button',{name:'Shield',exact:true}).click();await page.keyboard.press('f');
 assert.equal(await page.getByRole('button',{name:'Shield',exact:true}).textContent(),'F');
 await page.getByRole('button',{name:'Done',exact:true}).click();
 await page.reload();await page.locator('#local-menu summary').click();await page.getByRole('button',{name:'Landing course',exact:true}).click();
 await shield.getByText('READY',{exact:true}).waitFor();await page.keyboard.down('f');await shield.getByText('ACTIVE',{exact:true}).waitFor();await page.keyboard.up('f');
 assert.equal(await page.locator('body.unavailable').count(),0);assert.deepEqual(errors,[]);
 console.log('Shield activation, cooldown HUD, percentage hull, binding migration/persistence and WebGPU rendering passed');
}finally{await browser?.close();await server.close();}
