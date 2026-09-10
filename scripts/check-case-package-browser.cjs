const fs = require('node:fs'),
  assert = require('node:assert/strict');
const { playwright, studioUrl, launchOptions } = require('./browser-env.cjs');
const { chromium } = playwright();
(async () => {
  const browser = await chromium.launch({
    ...launchOptions(),
  });
  try {
    const page = await browser.newPage({
        viewport: { width: 1500, height: 980 },
      }),
      errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(
      studioUrl(),
    );
    await page
      .getByRole('button', { name: '新用户查 Gmail 邮件', exact: true })
      .click();
    assert.equal(await page.locator('.track-name').count(), 7);
    const original = JSON.parse(
      fs.readFileSync('case-packages/gmail/build/gmail.case.json'),
    );
    async function importData(data) {
      await page
        .getByLabel('选择 Case 包', { exact: true })
        .setInputFiles({
          name: 'test.case.json',
          mimeType: 'application/json',
          buffer: Buffer.from(JSON.stringify(data)),
        });
      await page.waitForFunction(
        () => !document.querySelector('[aria-label="导入 Case 包"]').disabled,
      );
    }
    const copy = structuredClone(original);
    copy.manifest.case_id = 'import-test';
    copy.manifest.title = '导入测试';
    Object.assign(copy.case.meta_data.sample, {
      case_id: 'import-test',
      case_name: '导入测试',
    });
    await importData(copy);
    await page.getByRole('button', { name: '导入测试', exact: true }).waitFor();
    assert.equal(await page.locator('.project').innerText(), '导入测试');
    assert.equal(await page.locator('.track-name').count(), 7);
    assert.equal(await page.locator('.track.track-collapsed').count(), 3);
    assert.equal(await page.locator('.clip.fade-out').count(), 0);
    assert.equal(await page.locator('.audible-fade').count(), 1);
    await page.getByRole('button', { name: '播放时间线', exact: true }).click();
    await page.waitForTimeout(200);
    await page.getByRole('button', { name: '暂停播放', exact: true }).click();
    await page
      .getByRole('button', { name: '查看完整合成数据', exact: true })
      .click();
    await page.locator('#case-audio-preview').waitFor();
    const key1 = await page.evaluate(
      () =>
        new Promise((resolve, reject) => {
          const r = indexedDB.open('track-studio-synthesis-v1');
          r.onsuccess = () => {
            const q = r.result
              .transaction('audio')
              .objectStore('audio')
              .getAllKeys();
            q.onsuccess = () => resolve(q.result);
          };
        }),
    );
    await page
      .getByRole('button', { name: '关闭合成数据面板', exact: true })
      .click();
    // Reimport same ID updates title/audio without a duplicate row.
    copy.manifest.title = '导入测试更新';
    copy.case.meta_data.sample.case_name = copy.manifest.title;
    copy.alignment.clips[0].source_end_ms -= 100;
    copy.case.utterances[0].end_at_ms -= 100;
    await importData(copy);
    assert.equal(
      await page
        .getByRole('button', { name: '导入测试更新', exact: true })
        .count(),
      1,
    );
    assert.equal(
      await page.getByRole('button', { name: '导入测试', exact: true }).count(),
      0,
    );
    await page
      .getByRole('button', { name: '查看完整合成数据', exact: true })
      .click();
    await page.locator('#case-audio-preview').waitFor();
    const key2 = await page.evaluate(
      () =>
        new Promise((resolve) => {
          const r = indexedDB.open('track-studio-synthesis-v1');
          r.onsuccess = () => {
            const q = r.result
              .transaction('audio')
              .objectStore('audio')
              .getAllKeys();
            q.onsuccess = () => resolve(q.result);
          };
        }),
    );
    assert.equal(key2.length, key1.length + 1);
    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: '下载 TAR', exact: true }).click();
    await (await download).saveAs('/tmp/case-package-tests/browser.tar');
    await page.reload();
    await page
      .getByRole('button', { name: '导入测试更新', exact: true })
      .waitFor();
    assert.equal(await page.locator('.project').innerText(), '导入测试更新');
    await page.locator('#case-audio-preview').waitFor();
    // Failed import must leave the current case and its saved data intact.
    const invalid = structuredClone(copy);
    invalid.alignment.clips[0].source = '../private.wav';
    await importData(invalid);
    assert((await page.locator('.files-error').innerText()).includes('路径'));
    assert.equal(await page.locator('.project').innerText(), '导入测试更新');
    // Generic loader supports cases with no interruption markers.
    const quiet = structuredClone(copy);
    quiet.manifest.case_id = 'no-markers';
    quiet.manifest.title = '无打断节点';
    Object.assign(quiet.case.meta_data.sample, {
      case_id: quiet.manifest.case_id,
      case_name: quiet.manifest.title,
    });
    // 去掉打断标记，也要去掉那段人声重叠：校验器要求每一处用户与助手的重叠
    // 都声明成打断或附和，只删标记会得到一个自相矛盾的包（导入会被拒）。
    quiet.timeline.interruptions = [];
    {
      const cut = quiet.timeline.interruptions.length
        ? null
        : copy.timeline.interruptions[0];
      if (cut) {
        const user = quiet.case.utterances.find((u) => u.id === cut.user_id),
          assistant = quiet.case.utterances.find(
            (u) => u.id === cut.assistant_id,
          );
        assistant.end_at_ms = user.start_at_ms;
        const clip = quiet.alignment.clips.find(
          (c) => c.utterance_id === assistant.id,
        );
        clip.source_end_ms =
          clip.source_start_ms + assistant.end_at_ms - assistant.start_at_ms;
      }
    }
    await importData(quiet);
    assert.equal(await page.locator('.project').innerText(), '无打断节点');
    await page
      .getByRole('button', { name: '查看 JSON 数据', exact: true })
      .click();
    await page.getByRole('tab', { name: 'Utterances', exact: true }).click();
    assert(
      (await page.locator('#json-panel').innerText()).includes('就 Gmail'),
    );
    assert.deepEqual(errors, []);
    await page.screenshot({ path: '/tmp/case-package-tests/imported.png' });
    console.log(
      'PASS import, reimport, cache invalidation, reload, invalid import, arbitrary case and export',
    );
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
