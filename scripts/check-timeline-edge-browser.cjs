const assert = require('node:assert/strict');
const {chromium}=require('/Users/kaysaith/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
 try{
 const page=await browser.newPage({viewport:{width:1500,height:980}});
 await page.goto('file:///Users/kaysaith/Desktop/feishu_cli/Track%20Studio%20Local/Track%20Studio.html');
 for(const name of ['北京天气 / 跑步提醒','演员名字 / 追问电视剧','新用户查 Gmail 邮件']){
 await page.getByRole('button',{name,exact:true}).click();
 for(const fit of [false,true]){
 if(fit)await page.getByRole('button',{name:'适应窗口',exact:true}).click();
 await page.locator('.timeline-scroll').evaluate(el=>el.scrollLeft=el.scrollWidth);
 await page.waitForTimeout(120);
 const size=await page.locator('.timeline-scroll').evaluate(el=>({scroll:el.scrollWidth,viewport:el.clientWidth,timeline:el.querySelector('.timeline').getBoundingClientRect().width}));
 console.log(name,fit,size);
 assert(size.scroll<=Math.ceil(Math.max(size.viewport,size.timeline))+1,'Timeline children create horizontal blank overflow');
 }
 }
 }finally{await browser.close()}
})().catch(e=>{console.error(e);process.exit(1)});
