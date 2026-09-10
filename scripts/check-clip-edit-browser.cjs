// 时间线上的片段增删改：点空白新建、双击配置、删除、撤销重做、框选整体移动。
//   node scripts/check-clip-edit-browser.cjs
const assert = require('node:assert/strict');
const { playwright, studioUrl, launchOptions } = require('./browser-env.cjs');
const { chromium } = playwright();
(async () => {
  const browser = await chromium.launch(launchOptions());
  try {
    const page = await browser.newPage({ viewport: { width: 1500, height: 980 } }), errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('dialog', (d) => d.accept());
    await page.goto(studioUrl());
    await page.getByRole('button', { name: '新用户查 Gmail 邮件', exact: true }).click();
    await page.waitForTimeout(400);
    // 轨道上找一处真正空白的地方：轨道很宽，屏幕外点不到。
    const spot = async (name) => {
      const el = page.locator(`.track[data-track-name="${name}"]`);
      await el.scrollIntoViewIfNeeded();
      const box = await el.boundingBox(), view = await page.locator('.timeline-scroll').boundingBox();
      const y = Math.max(view.y + 10, Math.min(box.y + 30, view.y + view.height - 30));
      for (let x = view.x + view.width - 60; x > view.x + 40; x -= 40) {
        const hit = await page.evaluate(([x, y]) => document.elementFromPoint(x, y)?.className ?? '', [x, y]);
        if (typeof hit === 'string' && hit.startsWith('track ')) return { x, y };
      }
      throw Error(`${name} 轨道上找不到空白处`);
    };
    const count = () => page.locator('.region').count();

    // 1. 点空白 → 新建片段
    const before = await count();
    let at = await spot('后台判断');
    await page.mouse.click(at.x, at.y);
    await page.locator('dialog.block-editor').waitFor();
    assert.equal(await page.locator('#block-editor-title').textContent(), '创建片段 · 后台判断');
    await page.getByLabel('片段名称').fill('自检：新建的判断片段');
    await page.getByRole('button', { name: '保存' }).click();
    await page.waitForTimeout(250);
    assert.equal(await count(), before + 1, '新建之后片段数没变');

    // 2. 撤销 / 重做
    await page.getByRole('button', { name: '撤销' }).click();
    await page.waitForTimeout(200);
    assert.equal(await count(), before, '撤销没有回到原样');
    await page.getByRole('button', { name: '重做' }).click();
    await page.waitForTimeout(200);
    assert.equal(await count(), before + 1, '重做没有把片段带回来');

    // 3. 双击配置 → 改说明 → 删除
    const mine = page.locator('.clip', { hasText: '自检：新建的判断片段' }).first();
    await mine.scrollIntoViewIfNeeded();
    await mine.dblclick();
    await page.locator('dialog.block-editor').waitFor();
    assert.equal(await page.locator('#block-editor-title').textContent(), '配置片段 · 后台判断');
    await page.getByLabel('片段说明').fill('改过一次');
    await page.getByRole('button', { name: '保存' }).click();
    await page.waitForTimeout(250);
    assert.ok((await page.locator('.clip small').allTextContents()).includes('改过一次'), '说明没保存上');
    await page.locator('.clip', { hasText: '自检：新建的判断片段' }).first().dblclick();
    await page.getByRole('button', { name: '删除片段' }).click();
    await page.waitForTimeout(250);
    assert.equal(await count(), before, '删除之后片段数没回去');

    // 4. 工具片段：分组挑工具，必填参数缺了要拦住
    at = await spot('工具调用');
    await page.mouse.click(at.x, at.y);
    await page.locator('dialog.block-editor').waitFor();
    assert.deepEqual(
      await page.locator('dialog.block-editor optgroup').evaluateAll((n) => n.map((x) => x.label)),
      ['Memory 工具', '系统工具', 'MCP 工具', '其他工具'],
    );
    await page.getByLabel('工具', { exact: true }).selectOption('mcps.search');
    await page.getByRole('button', { name: '保存' }).click();
    await page.waitForTimeout(150);
    assert.match(await page.locator('.block-error').textContent(), /请填写 query/);
    await page.getByLabel('query', { exact: true }).fill('查找可用的外卖连接器');
    await page.getByRole('button', { name: '保存' }).click();
    await page.waitForTimeout(250);
    const labels = await page.locator('.clip span').allTextContents();
    assert.ok(labels.some((x) => x.includes('mcps.search("查找可用的外卖连接器")')), '工具片段没落到轨道上');

    // 5. 语音轨道不给手动建片段，说清楚为什么
    at = await spot('用户');
    await page.mouse.click(at.x, at.y);
    await page.locator('dialog.block-editor').waitFor();
    assert.match(await page.locator('.block-notice').textContent(), /语音轨道不支持手动创建片段/);
    assert.ok(await page.getByRole('button', { name: '保存' }).isDisabled());
    await page.getByRole('button', { name: '取消' }).click();

    // 6. 轨道里框选 → 整体移动：相对位置不变
    const view = await page.locator('.timeline-scroll').boundingBox();
    const row = await page.locator('.track[data-track-name="工具调用"]').boundingBox();
    const y = Math.max(view.y + 10, Math.min(row.y + 30, view.y + view.height - 30));
    await page.mouse.move(view.x + 12, y - 6);
    await page.mouse.down();
    await page.mouse.move(view.x + view.width - 40, y + 40, { steps: 10 });
    await page.mouse.up();
    await page.waitForTimeout(200);
    const picked = await page.locator('.region-selected').count();
    assert.ok(picked > 1, `框选只选中了 ${picked} 个片段`);
    const starts = () => page.locator('.region-selected').evaluateAll((n) => n.map((x) => Number(x.dataset.startMs)));
    const was = await starts();
    const first = page.locator('.region-selected').first();
    const box = await first.boundingBox();
    await page.mouse.move(box.x + Math.min(20, box.width / 2), box.y + 20);
    await page.mouse.down();
    await page.mouse.move(box.x + Math.min(20, box.width / 2) + 120, box.y + 20, { steps: 10 });
    await page.mouse.up();
    await page.waitForTimeout(300);
    const now = await starts();
    assert.equal(now.length, was.length, '整体移动之后选中的片段少了');
    const shift = now[0] - was[0];
    assert.ok(shift > 0, `整体移动没生效：${was[0]} → ${now[0]}`);
    assert.deepEqual(now, was.map((v) => v + shift), '整体移动把相对位置拉散了');

    assert.deepEqual(errors, []);
    console.log('clip-edit-page: 新建、配置、删除、撤销重做、工具校验、框选整体移动都正常');
  } finally {
    await browser.close();
  }
})();
