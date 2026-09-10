const fs=require('node:fs'),assert=require('node:assert/strict');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'/Users/kaysaith/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
(async()=>{
 const file=process.argv[2];if(!file)throw Error('Usage: node scripts/check-case-import-file-browser.cjs /path/to/case.zip');
 const {readZip,readJson}=await import('../lib/case-package/archive.ts');
 const manifest=readJson(readZip(new Uint8Array(fs.readFileSync(file))),'manifest.json');
 const browser=await chromium.launch({headless:true,args:['--js-flags=--stack-size=256'],executablePath:process.env.CHROME_PATH||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
 try{
  const page=await browser.newPage({viewport:{width:1500,height:980}}),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.goto(process.env.STUDIO_URL||'file:///Users/kaysaith/Desktop/feishu_cli/Track%20Studio%20Local/Track%20Studio.html');
  for(let i=0;i<3;i++){
   await page.getByLabel('选择 Case 包',{exact:true}).setInputFiles(file);
   await page.waitForFunction(()=>!document.querySelector('[aria-label="导入 Case 包"]').disabled);
   assert.deepEqual(await page.locator('.files-error').allTextContents(),[]);
   assert.equal(await page.locator('.project').innerText(),manifest.title);
   assert.equal(await page.locator('.track-name').count(),7);
   await page.reload();await page.getByRole('button',{name:manifest.title,exact:true}).waitFor();
   assert.equal(await page.locator('.project').innerText(),manifest.title);
  }
  await page.getByRole('button',{name:'播放时间线',exact:true}).click();await page.waitForTimeout(700);
  assert.match(await page.locator('.timecode').innerText(),/0\.[1-9]/);
  assert.equal(await page.getByRole('button',{name:manifest.title,exact:true}).count(),1);
  assert.deepEqual(errors,[]);
  console.log('PASS ZIP import repeated 3 times, reload, seven tracks, playback and no duplicates/errors');
 }finally{await browser.close()}
})().catch(e=>{console.error(e);process.exit(1)});
