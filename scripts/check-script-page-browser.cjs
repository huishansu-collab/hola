// 流水线那一页：脚本编辑 → 体检 → 切轨导入时间线，整条走一遍。
//   node scripts/check-script-page-browser.cjs
const assert = require('node:assert/strict');
const { playwright, studioUrl, launchOptions } = require('./browser-env.cjs');
const { chromium } = playwright();
(async () => {
  const browser = await chromium.launch(launchOptions());
  try {
    const page = await browser.newPage({ viewport: { width: 1500, height: 980 } }),
      errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(studioUrl());
    await page.getByRole('tab', { name: '流水线' }).click();

    // 默认载入的是仓库里那条奶茶脚本，进来就该是通过的。
    await page.locator('.ppl-check.pass').waitFor();
    assert.match(await page.locator('.ppl-check span').textContent(), /2 段用户 · 4 段助手 · 9 次工具/);
    assert.ok((await page.locator('.ppl-row').count()) > 15, '切轨预览是空的');
    assert.equal(await page.locator('.ppl-issues li').count(), 0);

    // 写错了要指到具体行，并且不给导入。
    await page.locator('.ppl-script').fill('标题 坏脚本\n用户 帮我看看。\n唱歌 啦啦啦\n');
    await page.locator('.ppl-check.fail').waitFor();
    assert.match(await page.locator('.ppl-issues li').first().textContent(), /第 3 行/);
    assert.ok(await page.getByRole('button', { name: '切轨并导入时间线' }).isDisabled());

    // 改对之后导入：自动切成七轨，拖动在时间线里做。
    await page.locator('.ppl-script').fill(
      ['标题 页面自检 / 查明天天气', 'ID page-check', '用户 帮我看看明天的天气。',
       '判断 听清了地点和日期 [时长 800]', '助手 嗯…… [垫句]',
       '工具 w1: weather.query(city=北京, date=明天) => temp_c=20 [时长 2400]',
       '助手 明天二十度，多云。 [依赖 w1]', ''].join('\n'));
    await page.locator('.ppl-check.pass').waitFor();
    assert.match(await page.locator('.ppl-check span').textContent(), /page-check$/);
    await page.getByRole('button', { name: '切轨并导入时间线' }).click();

    await page.locator('.timeline-shell').waitFor();
    assert.equal(await page.locator('.track-name').count(), 7);
    assert.equal(await page.locator('.brand .project').textContent(), '页面自检 / 查明天天气');
    const labels = await page.locator('.clip span').allTextContents();
    for (const text of ['帮我看看明天的天气。', '嗯……', '明天二十度，多云。', '垫句 · 嗯……'])
      assert.ok(labels.some((x) => x.includes(text)), `时间线上找不到「${text}」`);
    assert.ok(labels.some((x) => x.includes('weather.query')), '工具没进工具调用轨');
    // 导进来的 Case 要出现在 Files 里，不用刷新。
    await page.locator('.case-row', { hasText: '页面自检 / 查明天天气' }).first().waitFor();
    // 时间线上还能接着拖：拖过的片段留在原地不算通过。
    const find = () => page.locator('.clip', { hasText: '嗯……' }).first();
    await find().scrollIntoViewIfNeeded();
    const before = await find().boundingBox();
    await page.mouse.move(before.x + 30, before.y + 25);
    await page.mouse.down();
    await page.mouse.move(before.x + 130, before.y + 25, { steps: 8 });
    await page.mouse.up();
    await page.waitForTimeout(250);
    const after = await find().boundingBox();
    assert.ok(after.x > before.x + 40, `导入的片段拖不动：${before.x} → ${after.x}`);

    assert.deepEqual(errors, []);
    console.log('script-page: 体检、切轨导入、Files 同步与拖动都正常');
  } finally {
    await browser.close();
  }
})();
