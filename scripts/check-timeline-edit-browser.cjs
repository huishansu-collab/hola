const fs = require('node:fs'),
  assert = require('node:assert/strict');
const { chromium } = require(
  process.env.PLAYWRIGHT_MODULE ||
    '/Users/kaysaith/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright',
);
(async () => {
  const browser = await chromium.launch({
    headless: true,
    executablePath:
      process.env.CHROME_PATH ||
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  });
  try {
    const page = await browser.newPage({
        viewport: { width: 1500, height: 980 },
      }),
      errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(
      process.env.STUDIO_URL ||
        'file:///Users/kaysaith/Desktop/feishu_cli/Track%20Studio%20Local/Track%20Studio.html',
    );
    await page
      .getByRole('button', { name: '新用户查 Gmail 邮件', exact: true })
      .click();
    const region = (ti, ci) =>
      page.locator(`[data-track-index="${ti}"][data-clip-index="${ci}"]`);
    async function move(ti, ci, dx, dy = 0, tail = false) {
      const el = region(ti, ci).locator(tail ? '.clip-resize-handle' : '.clip');
      await el.scrollIntoViewIfNeeded();
      const r = await el.boundingBox();
      const x = tail ? r.x + r.width / 2 : r.x + Math.min(40, r.width / 2),
        y = r.y + r.height / 2;
      await page.mouse.move(x, y);
      await page.mouse.down();
      await page.mouse.move(x + dx, y + dy, { steps: 6 });
      await page.waitForTimeout(80);
      await page.mouse.up();
      await page.waitForTimeout(100);
    }
    await move(0, 0, 37, 90);
    const userStart = Number(await region(0, 0).getAttribute('data-start-ms'));
    assert(userStart > 0 && userStart % 400 !== 0);
    assert(Number.isInteger(userStart));
    await region(0,0).locator('.clip').focus();
    await page.keyboard.press('ArrowRight');
    assert.equal(Number(await region(0,0).getAttribute('data-start-ms')),userStart+1);
    await page.keyboard.press('ArrowLeft');
    assert.equal(Number(await region(0,0).getAttribute('data-start-ms')),userStart);
    const stored = () =>
      page.evaluate(
        () =>
          JSON.parse(localStorage.getItem('track-studio-timeline-edits-v1'))
            .gmail.scenario,
      );
    let s = await stored();
    assert.equal(s.utterances[0].start_at_ms, userStart);
    assert.equal(s.tracks[0].clips.length, 2);
    assert.equal(s.tracks[2].clips[0].a, 6000);
    await move(2, 0, 100);
    s = await stored();
    assert.equal(s.tracks[2].clips[0].a % 400, 0);
    assert(s.tracks[2].clips[0].a !== 6000);
    assert.equal(await region(0,0).locator('.clip-resize-handle').count(),0);
    assert.equal(await region(2,0).locator('.clip-resize-handle').count(),0);
    await move(6, 0, 100, 0, true);
    s = await stored();
    const extended = s.tracks[6].clips[0];
    assert.equal(extended.b % 400, 0);
    assert.equal(s.inputEvents.find(e=>e.event_id===extended.toolEventId && e.query===undefined).time_at_ms,extended.b);
    // Escape rolls back an in-progress move.
    const before = s.tracks[0].clips[0].a;
    const el = region(0, 0).locator('.clip');
    await el.scrollIntoViewIfNeeded();
    let r = await el.boundingBox();
    await page.mouse.move(r.x + 30, r.y + 25);
    await page.mouse.down();
    await page.mouse.move(r.x + 90, r.y + 25, { steps: 5 });
    await page.waitForTimeout(80);
    await page.keyboard.press('Escape');
    await page.mouse.up();
    assert.equal(
      Number(await region(0, 0).getAttribute('data-start-ms')),
      before,
    );
    // At fit, hold a region at the right edge; scale stays fixed as time extends.
    await page.getByRole('button', { name: '适应窗口', exact: true }).click();
    const last = region(2, 1).locator('.clip');
    r = await last.boundingBox();
    const viewport = await page.locator('.timeline-scroll').boundingBox();
    const duration = s.END;
    await page.mouse.move(r.x + 20, r.y + 25);
    await page.mouse.down();
    await page.mouse.move(viewport.x + viewport.width - 3, r.y + 25, {
      steps: 8,
    });
    await page.waitForTimeout(1800);
    await page.mouse.up();
    await page.waitForTimeout(150);
    s = await stored();
    assert(s.END > duration);
    assert.equal(s.END % 400, 0);
    assert((await page.locator('.tick').count()) < 100);
    await page
      .getByRole('button', { name: '演员名字 / 追问电视剧', exact: true })
      .click();
    assert(
      !(await page.evaluate(
        () =>
          JSON.parse(localStorage.getItem('track-studio-timeline-edits-v1'))
            .actor,
      )),
    );
    await page
      .getByRole('button', { name: '新用户查 Gmail 邮件', exact: true })
      .click();
    await page.reload();
    await page.waitForFunction(()=>document.querySelector('.project')?.textContent==='新用户查 Gmail 邮件');
    await region(0, 0).waitFor();
    assert.equal(
      Number(await region(0, 0).getAttribute('data-start-ms')),
      userStart,
    );
    await page.getByRole('button',{name:'查看 JSON 数据',exact:true}).click();
    const visibleJson = () => page.locator('#json-panel .json-line-content').allTextContents().then(lines=>JSON.parse(lines.join('')));
    assert.deepEqual((await visibleJson()).utterances,(await stored()).utterances);
    await page.getByRole('tab',{name:'Events',exact:true}).click();
    assert.deepEqual((await visibleJson()).events,(await stored()).inputEvents);
    await page.getByRole('tab',{name:'Meta',exact:true}).click();
    assert.equal((await visibleJson()).meta_data.media.audio.duration_ms,(await stored()).END);
    await page.getByRole('button',{name:'关闭 JSON 面板',exact:true}).click();
    await page
      .getByRole('button', { name: '更多：新用户查 Gmail 邮件', exact: true })
      .click();
    const download = page.waitForEvent('download');
    await page
      .getByRole('button', { name: '下载完整 Case ZIP', exact: true })
      .click();
    const zip = await download;
    await zip.saveAs('/tmp/timeline-edited.case.zip');
    await page.getByRole('button', { name: '关闭 Case 信息' }).click();
    await page
      .getByLabel('选择 Case 包', { exact: true })
      .setInputFiles('/tmp/timeline-edited.case.zip');
    await page.waitForFunction(
      () => !document.querySelector('[aria-label="导入 Case 包"]').disabled,
    );
    assert.deepEqual(await page.locator('.files-error').allTextContents(), []);
    assert.equal(
      Number(await region(0, 0).getAttribute('data-start-ms')),
      userStart,
    );
    await page.getByRole('button',{name:'适应窗口',exact:true}).click();
    await page.screenshot({path:'/tmp/timeline-edit-preview.png'});
    assert.deepEqual(errors, []);
    console.log(
      'PASS pointer move, resize, cancel, right-edge growth, case isolation, reload and edited ZIP round trip',
    );
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
