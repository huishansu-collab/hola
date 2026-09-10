const assert=require('node:assert/strict');
const {playwright,launchOptions}=require('./browser-env.cjs');
const {chromium}=playwright();
(async()=>{
 const browser=await chromium.launch(launchOptions());
 try{
  const page=await browser.newPage({viewport:{width:1440,height:1000}});
  await page.goto(process.env.STUDIO_URL||'http://127.0.0.1:5180/');
  const names={weather:'北京天气 / 跑步提醒',actor:'演员名字 / 追问电视剧',ride:'回家路况 / 呼叫快车',coffee:'订咖啡 / 偏好与地址确认',sms:'手机欠费短信 / Living Edge 提醒'};
  const select=async id=>{await page.getByRole('button',{name:names[id],exact:true}).click();await page.waitForTimeout(200)};
  const snapshot=()=>page.evaluate(()=>({available:document.querySelector('.timeline-shell').clientWidth-document.querySelector('.track-headers').offsetWidth,viewport:document.querySelector('.timeline-scroll').clientWidth,width:document.querySelector('.timeline').getBoundingClientRect().width,scroll:document.querySelector('.timeline-scroll').scrollLeft,views:JSON.parse(localStorage.getItem('track-studio-case-viewports-v1'))}));
  const fitCheck=async id=>{await page.waitForTimeout(200);const s=await snapshot();assert.equal(s.views[id].mode,'fit');assert(Math.abs(s.available-s.viewport)<=1,`${id}: content shrank viewport ${s.viewport}/${s.available}`);assert(Math.abs(s.width-s.available)<=1,`${id}: timeline fails to fill editor`)};
  // Every duration uses fit, including the long → short path missed by a fit → custom test.
  for(const id of Object.keys(names)){await select(id);await page.getByRole('button',{name:'适应窗口',exact:true}).click();await fitCheck(id)}
  for(const id of ['ride','sms','weather','actor','coffee','sms']){await select(id);await fitCheck(id)}
  await page.reload();await fitCheck('sms');
  await page.setViewportSize({width:1700,height:1000});await fitCheck('sms');
  const separator=page.getByRole('separator',{name:'调整 Files 宽度'});await separator.focus();await separator.press('ArrowRight');await fitCheck('sms');
  await select('actor');await page.getByRole('button',{name:'放大',exact:true}).click();await page.waitForTimeout(200);
  const custom=(await snapshot()).views.actor;assert.equal(custom.mode,'custom');
  await select('ride');await fitCheck('ride');await select('sms');await fitCheck('sms');await select('actor');
  const restored=await snapshot();assert.equal(restored.views.actor.scale,custom.scale);assert.equal(restored.views.actor.mode,'custom');assert(Math.abs(restored.viewport-restored.available)<=1);
  await page.reload();await page.waitForTimeout(300);assert.equal((await snapshot()).views.actor.scale,custom.scale);
  console.log('PASS: all fit durations; long → short switches; independent custom zoom; reload; window and sidebar resize.');
 }finally{await browser.close()}
})().catch(e=>{console.error(e);process.exit(1)});
