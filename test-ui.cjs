const fs=require('fs'),path=require('path'),http=require('http'),assert=require('assert/strict');
const {chromium}=require(process.env.PLAYWRIGHT||'/home/coolhand/projects/spectre/node_modules/playwright-core');
const out=process.env.EVIDENCE||path.join(require('os').tmpdir(),'notan-verification'),root=process.env.CANDIDATE||__dirname;fs.mkdirSync(out,{recursive:true});
const server=http.createServer((req,res)=>{const f=path.join(root,new URL(req.url,'http://local').pathname.replace(/\/$/,'/index.html'));if(!f.startsWith(root)||!fs.existsSync(f)){res.writeHead(404);res.end();return}res.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.css':'text/css','.woff2':'font/woff2'})[path.extname(f)]||'application/octet-stream');res.end(fs.readFileSync(f));});
let checks=0;const results={geometry:[],errors:[],checks:0};const ok=(v,msg)=>{assert.ok(v,msg);checks++};const eq=(a,b,msg)=>{assert.deepEqual(a,b,msg);checks++};
(async()=>{await new Promise(r=>server.listen(0,'127.0.0.1',r));const base=process.env.BASE||'http://127.0.0.1:'+server.address().port+'/';const b=await chromium.launch({executablePath:process.env.CHROME||'/home/coolhand/.cache/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-linux64/chrome-headless-shell',args:['--no-sandbox']});
async function open({width=390,height=844,zoom=100,theme='dark',save,clock=false,query='?endless=5&seed=81051',primary}={}){const c=await b.newContext({viewport:{width,height},colorScheme:theme,hasTouch:true,reducedMotion:'reduce'});await c.route('https://stats.dr.eamer.dev/**',r=>r.fulfill({body:''}));const p=await c.newPage();p.on('pageerror',e=>results.errors.push(e.message));await p.addInitScript(({zoom,theme,save,primary})=>{if(!sessionStorage.getItem('fixture')){if(primary)localStorage.setItem('ink.v1',JSON.stringify(primary));else localStorage.setItem('ink.v1',JSON.stringify({zoom,theme,...save}));sessionStorage.setItem('fixture','yes')}},{zoom,theme,save,primary});if(clock)await p.clock.install();await p.goto(base+query);await p.waitForFunction(()=>window.__notan);await p.evaluate(()=>document.fonts.ready);return{p,c};}
const cells=p=>p.evaluate(()=>Array.from(__notan.S.cells));
async function reset(p){await p.locator('#settings-btn').click();await p.locator('#reset-level').click();}
async function drag(p,selector,ids){const pts=await p.locator(selector).evaluateAll((ns,ids)=>ids.map(i=>{const r=ns[i].getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}}),ids);await p.mouse.move(pts[0].x,pts[0].y);await p.mouse.down();for(const pt of pts.slice(1))await p.mouse.move(pt.x,pt.y,{steps:5});await p.mouse.up();}
async function touch(p,selector,ids,cancel=false,hold=0){const session=await p.context().newCDPSession(p),pts=await p.locator(selector).evaluateAll((ns,ids)=>ids.map(i=>{const r=ns[i].getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}}),ids);await session.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[pts[0]]});if(hold)await p.waitForTimeout(hold);for(const pt of pts.slice(1))await session.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[pt]});await session.send('Input.dispatchTouchEvent',{type:cancel?'touchCancel':'touchEnd',touchPoints:[]});await session.detach();}
try{
// Real inputs, isolated practice state, path painting and recovery.
{
const {p,c}=await open();eq(await p.locator('dialog[open]').count(),0,'straight to play');eq(await p.evaluate(()=>[__notan.RAMP.length,__notan.PLUS.length]),[53,20]);
await drag(p,'#grid .cell',[0,2,12]);eq((await cells(p)).flatMap((v,i)=>v?[i]:[]),[0,1,2,7,12],'actual path not rectangle');await p.locator('#undo-btn').click();ok((await cells(p)).every(v=>v===0),'one Undo restores drag');
await touch(p,'#grid .cell',[0,2,12],true);ok((await cells(p)).every(v=>v===0),'cancelled touch rolls back');
const cell=await p.locator('#grid .cell').first().boundingBox();await p.touchscreen.tap(cell.x+cell.width/2,cell.y+cell.height/2);await p.touchscreen.tap(cell.x+cell.width/2,cell.y+cell.height/2);eq((await cells(p))[0],2,'double tap marks');await reset(p);
await p.locator('#grid .cell').first().focus();await p.keyboard.press('Space');await p.keyboard.press('l');ok(await p.evaluate(()=>__notan.S.locks.row[0]),'keyboard lock');await reset(p);await p.locator('#undo-btn').click();ok(await p.evaluate(()=>__notan.S.locks.row[0]&&__notan.S.cells[0]===1),'reset Undo restores lock and fill');await reset(p);
const before=await cells(p);await p.locator('#help-btn').click();await p.locator('.practice-cell').nth(2).click();await p.keyboard.press('ArrowRight');await p.keyboard.press('Space');eq(await p.locator('#help[open]').count(),1,'pointer then keyboard stays in Help');eq(await p.locator('.practice-cell.ink').count(),2,'pointer then keyboard edits next cell');await p.evaluate(()=>document.querySelector('#practice-reset').click());await drag(p,'.practice-cell',[0,4]);eq(await p.locator('.practice-cell.ink').count(),5,'lesson drag fills run');ok((await p.locator('#practice-feedback').textContent()).includes('one run of five'),'completion feedback');eq(await cells(p),before,'practice never alters puzzle');await p.locator('#practice-undo').click();eq(await p.locator('.practice-cell.ink').count(),0,'practice single undo');await touch(p,'.practice-cell',[0,4],true);eq(await p.locator('.practice-cell.ink').count(),0,'practice cancellation');
await p.locator('#lesson-next').click();await touch(p,'.practice-cell',[0,2]);await p.locator('.practice-cell').nth(4).click();await p.locator('#practice-mode').click();await p.locator('.practice-cell').nth(3).click();eq(await p.locator('.practice-cell.mark').count(),1,'explicit gap dot');ok((await p.locator('#practice-feedback').textContent()).startsWith('Three,'),'gap lesson solved');
await p.locator('#lesson-next').click();eq(await p.locator('.possibility').count(),2,'two overlap placements');await drag(p,'.practice-cell',[1,3]);eq(await p.locator('.practice-cell.ink').count(),3);ok((await p.locator('#practice-feedback').textContent()).includes('Only the middle three'),'deduction not completed line');eq(await p.locator('.practice-cell.mark').count(),0,'ends unknown');
await p.evaluate(()=>document.querySelector('#practice-reset').click());await touch(p,'.practice-cell',[0],false,450);eq(await p.locator('.practice-cell.mark').count(),1,'hold marks');await p.evaluate(()=>document.querySelector('#practice-reset').click());await p.locator('.practice-cell').nth(1).focus();await p.keyboard.press('Space');await p.keyboard.press('Shift+ArrowRight');await p.keyboard.press('Shift+ArrowRight');eq(await p.locator('.practice-cell.ink').count(),3,'keyboard painting');await p.keyboard.press('z');eq(await p.locator('.practice-cell.ink').count(),2,'keyboard undo');await p.evaluate(()=>document.querySelector('#practice-reset').click());await p.locator('.practice-cell').nth(0).click({button:'right'});eq(await p.locator('.practice-cell.mark').count(),1,'right click');
await p.keyboard.press('Escape');eq(await cells(p),before,'practice history isolated');await p.locator('#hint-btn').click();ok(await p.evaluate(()=>!!__notan.S.hint),'explicit hint');
await reset(p);const sol=await p.evaluate(()=>Array.from(__notan.S.puz.sol));for(let i=0;i<sol.length;i++)if(sol[i])await p.locator('#grid .cell').nth(i).click();await p.waitForFunction(()=>__notan.S.solved);ok(await p.locator('#share-btn').isVisible(),'share blank retained');await p.locator('#next-btn').click();ok(!(await p.evaluate(()=>__notan.S.solved)),'next fresh puzzle');await c.close();
}
// Isolated import once; never change production's byte string.
{
const primary={at:'cup',solved:{square:10},hinted:{square:true},boards:{cup:{c:'100000000',t:7,locks:{row:[true,false,false],col:[]},h:true}},zoom:100,theme:'dark',gentleCue:false,rampOrder:2};const {p,c}=await open({primary,query:'?level=2'});ok(await p.evaluate(()=>__notan.S.locks.row[0]),'an existing ink.v1 save keeps its locks');ok(await p.evaluate(()=>JSON.parse(localStorage.getItem('ink.v1')).solved.square===10),'an existing ink.v1 save keeps its solves');await reset(p);await p.reload();ok(!(await p.evaluate(()=>__notan.S.locks.row[0])),'reset puzzle persists after reload');await c.close();
}
// Nothing is hinted unasked; the bulb on the bar is the one way to a hint.
{
const {p,c}=await open({clock:true,save:{gentleCue:true}});await p.clock.fastForward(60000);eq(await p.evaluate(()=>[__notan.S.hinted,!!__notan.S.hint,document.querySelectorAll('.nudge').length]),[false,false,0],'a minute of waiting hints nothing');const bulb=await p.locator('#hint-btn').evaluate(n=>{const r=n.getBoundingClientRect();return{bar:!!n.closest('.bar'),w:r.width,h:r.height}});ok(bulb.bar&&bulb.w>=44&&bulb.h>=44,'the hint bulb sits on the bar at touch size');eq(await p.locator('dialog #hint-btn, #cue-btn').count(),0,'Settings holds no hint or cue control');await p.locator('#hint-btn').click();ok(await p.evaluate(()=>!!__notan.S.hint&&__notan.S.hinted&&document.querySelector('.hint').classList.contains('on')),'the bulb rings a square');ok(await p.evaluate(()=>!('gentleCue' in JSON.parse(localStorage.getItem('ink.v1')))),'the old cue preference is dropped from the save');await c.close();
}
// A mouse that loses capture just before its release (a buttonless move lands first) keeps its stroke.
{
const {p,c}=await open();const cdp=await c.newCDPSession(p);const box=await p.locator('#grid .cell').first().boundingBox();const at=n=>({x:box.x+box.width*(n+.5),y:box.y+box.height/2});const mouse=(type,n,held,extra={})=>cdp.send('Input.dispatchMouseEvent',{type,...at(n),button:held?'left':'none',buttons:held?1:0,...extra});await mouse('mousePressed',0,true,{clickCount:1});await mouse('mouseMoved',1,true);await mouse('mouseMoved',2,true);await mouse('mouseMoved',2,false);await mouse('mouseReleased',2,false,{button:'left',clickCount:1});eq(await p.evaluate(()=>[Array.from(__notan.S.cells.slice(0,3)),__notan.S.undo.length,!!__notan.S.drag]),[[1,1,1],1,false],'a stroke survives capture lost just before release');await c.close();
}
// Sheet geometry, close reachability and accessible DOM at narrow/landscape/desktop.
for(const [width,height] of [[320,700],[390,844],[844,390],[1280,900]])for(const zoom of [100,150])for(const theme of ['light','dark']){
const {p,c}=await open({width,height,zoom,theme});
for(const id of ['settings','help','levels']){
 await p.locator({'settings':'#settings-btn','help':'#help-btn','levels':'#lvl-btn'}[id]).click();
 if(id==='help'){await p.locator('#lesson-next').click();await p.locator('#lesson-next').click();}
 const m=await p.locator('#'+id).evaluate(d=>{const r=d.getBoundingClientRect(),body=d.querySelector('.sheet-body'),close=d.querySelector('.sheet-x');return {width:r.width,height:r.height,bodyOverflow:body.scrollWidth-body.clientWidth,closeY:close.getBoundingClientRect().y,closeH:close.getBoundingClientRect().height,bodyH:body.clientHeight,contentH:body.scrollHeight}});
 ok(m.width<=width&&m.height<=height,'sheet fits');ok(m.bodyOverflow<=1,'no horizontal overflow');ok(m.closeH>=44,'44px Close');
 await p.locator('#'+id+' .sheet-body').evaluate(n=>n.scrollTop=n.scrollHeight);eq(Math.round((await p.locator('#'+id+' .sheet-x').boundingBox()).y),Math.round(m.closeY),'close stays fixed');
 if(id==='settings'&&width===390&&zoom===100)ok(m.height<700,'short Settings content sized');
 if(id==='help'){
  await p.locator('#help .sheet-body').evaluate(n=>n.scrollTop=n.scrollHeight);const box=await p.locator('#help .sheet-x').boundingBox();ok(box.y>=0&&box.y+box.height<=height,'scrolled help retains Close');ok(await p.locator('#practice-controls dt').count()===3,'three control lines');
 }
 await p.locator('#'+id+' .sheet-body').evaluate(n=>n.scrollTop=0);
 if((width===390||width===1280)&&zoom===100)await p.screenshot({path:path.join(out,id+'-'+width+'-'+theme+'.png')});
 results.geometry.push({width,height,zoom,theme,id,...m});
 if(zoom===100&&width===390){await p.addScriptTag({path:process.env.AXE||'/home/coolhand/projects/inclusion-economics/node_modules/.pnpm/axe-core@4.13.0/node_modules/axe-core/axe.min.js'});const axe=await p.evaluate(async()=>{const r=await axe.run(document.querySelector('dialog[open]'));return r.violations.map(v=>({id:v.id,impact:v.impact,nodes:v.nodes.map(n=>n.target)}))});eq(axe,[],'axe '+id);}
 await p.locator('#'+id+' .sheet-x').click();eq(await p.locator('dialog[open]').count(),0,'Close dismisses');
}
await c.close();}
// Hints say fill or empty, and following them without ever marking a square reaches the end.
{
const {p,c}=await open({query:'?level=30'});let last=-1,repeats=0,steps=0;
for(;steps<200&&!(await p.evaluate(()=>__notan.isSolved()));steps++){await p.locator('#hint-btn').click();const h=await p.evaluate(()=>({i:__notan.S.hint.i,fill:__notan.S.hint.fill,ring:document.querySelector('.hint').className}));if(h.i===last)repeats++;last=h.i;if(steps===0){ok(h.fill===true&&/\bfill\b/.test(h.ring),'the ring shows that the square is to be filled');ok(await p.locator('.hint').evaluate(n=>getComputedStyle(n,'::after').content!=='none'),'answer drawn inside the ring');}await p.locator('#grid .cell').nth(h.i).click();}
await p.waitForFunction(()=>__notan.S.solved);ok(await p.evaluate(()=>!Array.from(__notan.S.cells).includes(2)),'hints alone finish level 30 with no square marked');eq(repeats,0,'no square is hinted twice running');await c.close();
}
// Finished numbers are unchanged from production; numerals scale with the board; a locked line's numbers are red.
{
const {p,c}=await open({query:'?level=1'});eq(await p.locator('.clue').first().evaluate(n=>parseFloat(getComputedStyle(n).fontSize)),20,'large numerals on a small board');
await p.locator('#grid .cell').nth(0).click();await p.locator('#grid .cell').nth(1).click();
eq(await p.locator('.clue span.n-done').first().evaluate(n=>[getComputedStyle(n).textDecorationLine,getComputedStyle(n).transform]),['line-through','none'],'done numbers look as they do in production');eq(await p.locator('.clue span.n-done').first().evaluate(n=>[n.classList.contains('pop'),getComputedStyle(n).animationName]),[false,'none'],'a finished number does not bounce');
await p.locator('#grid .cell').nth(2).focus();await p.keyboard.press('l');
eq(await p.locator('.rc.locked span').first().evaluate(n=>[getComputedStyle(n).color,getComputedStyle(n.parentNode,'::before').content]),['rgb(217, 48, 54)','none'],'locked clue numbers are red, with no bar beside them');
await p.keyboard.press('l');eq(await p.locator('.clue.locked').count(),0,'unlocking clears the red');await c.close();
const big=await open({query:'?endless=15&seed=81051',width:390,height:844});ok(await big.p.locator('.clue').first().evaluate(n=>parseFloat(getComputedStyle(n).fontSize))>=11,'dense boards keep readable numerals');eq(await big.p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'dense board still fits the phone');await big.c.close();
}
// The clock stops while a sheet is open.
{
const {p,c}=await open({clock:true,query:'?level=12'});await p.locator('#grid .cell').nth(0).click();await p.clock.runFor(3000);const before=await p.evaluate(()=>__notan.S.time);ok(before>=2,'clock runs in play');
await p.locator('#settings-btn').click();await p.clock.runFor(8000);eq(await p.evaluate(()=>__notan.S.time),before,'clock holds while Settings is open');await c.close();
}
// A save carried from another address folds in: it adds, keeps the better time, and never moves a player back.
{
const enc=v=>encodeURIComponent(Buffer.from(JSON.stringify(v)).toString('base64'));
const carried={at:'flag',solved:{square:9,cup:30,plus:12},hinted:{plus:true},boards:{stairs:{c:'100110111',t:5}},plusUnlocked:false,rampOrder:2};
const fresh=await open({query:'?x=1#carry='+enc(carried)});eq(await fresh.p.evaluate(()=>{const v=JSON.parse(localStorage.getItem('ink.v1'));return[__notan.S.puz.id,Object.keys(v.solved).sort(),location.hash];}),['flag',['cup','plus','square'],''],'an empty save adopts the carried place and progress');await fresh.c.close();
const mine={at:'tree',solved:{square:4,cup:50,stairs:8},hinted:{},boards:{},zoom:100,theme:'dark',gentleCue:false,rampOrder:2};
const kept=await open({primary:mine,query:'?x=1#carry='+enc(carried)});eq(await kept.p.evaluate(()=>{const v=JSON.parse(localStorage.getItem('ink.v1'));return[__notan.S.puz.id,v.solved,v.hinted,Object.keys(v.boards)];}),['tree',{square:4,cup:30,stairs:8,plus:12},{plus:true},[]],'an existing save keeps its place, takes better times and new solves, and ignores a board it already solved');await kept.c.close();
const bad=await open({primary:mine,query:'?x=1#carry=%%%'});eq(await bad.p.evaluate(()=>JSON.parse(localStorage.getItem('ink.v1')).solved),{square:4,cup:50,stairs:8},'a damaged carry changes nothing');await bad.c.close();
const plus=await open({query:'?plus=3'});eq(await plus.p.evaluate(()=>[__notan.S.puz.plus,__notan.S.puz.index]),[true,2],'a New Game+ address reopens its board after the save is lost');await plus.c.close();
}
eq(results.errors,[],'no page errors');results.checks=checks;fs.writeFileSync(path.join(out,'verification.json'),JSON.stringify(results,null,2));console.log('PASS',checks,'checks;',results.geometry.length,'sheet states');
}catch(e){fs.writeFileSync(path.join(out,'failure.json'),JSON.stringify({checks,error:e.stack,...results},null,2));throw e}finally{await b.close();server.close()}})().catch(e=>{console.error(e);process.exit(1)});
