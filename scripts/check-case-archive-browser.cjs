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
    const names = [
      '北京天气 / 跑步提醒',
      '演员名字 / 追问电视剧',
      '回家路况 / 呼叫快车',
      '订咖啡 / 偏好与地址确认',
      '手机欠费短信 / Living Edge 提醒',
      '新用户查 Gmail 邮件',
    ];
    fs.mkdirSync('/tmp/case-zip-tests', { recursive: true });
    for (let i = 0; i < names.length; i++) {
      const name = names[i];
      await page
        .getByRole('button', { name: '更多：' + name, exact: true })
        .click();
      const download = page.waitForEvent('download', { timeout: 20000 });
      await page
        .getByRole('button', { name: '下载完整 Case ZIP', exact: true })
        .click();
      const d = await download,
        path = '/tmp/case-zip-tests/' + d.suggestedFilename();
      await d.saveAs(path);
      await page.getByRole('button', { name: '关闭 Case 信息' }).click();
      await page
        .getByLabel('选择 Case 包', { exact: true })
        .setInputFiles(path);
      await page.waitForFunction(
        () => !document.querySelector('[aria-label="导入 Case 包"]').disabled,
      );
      assert.equal(
        await page.locator('.files-error').count(),
        0,
        await page.locator('.files-error').allTextContents(),
      );
      assert.equal(
        await page.locator('.project').innerText(),
        i === 0 ? '天气查询 / 打断与改口' : name,
      );
      assert.equal(await page.locator('.track-name').count(), 7);
      await page.reload();
      await page.getByRole('button', { name, exact: true }).waitFor();
      assert.equal(
        await page.locator('.project').innerText(),
        i === 0 ? '天气查询 / 打断与改口' : name,
      );
      console.log('PASS export / import / reload: ' + name);
    }
    await page
      .getByRole('button', { name: '更多：' + names[5], exact: true })
      .click();
    await page.screenshot({ path: '/tmp/case-zip-tests/details.png' });
    await page.getByRole('button', { name: '关闭 Case 信息' }).click();
    await page.getByRole('button', { name: '播放时间线', exact: true }).click();
    await page.waitForTimeout(600);
    assert.match(await page.locator('.timecode').innerText(), /0\.[1-9]/);
    const { readZip, writeZip, jsonBytes, sourceFiles } =
      await import('../lib/case-package/archive.ts');
    const files = readZip(
      new Uint8Array(fs.readFileSync('/tmp/case-zip-tests/gmail.case.zip')),
    );
    assert.ok(files['source/generation/requests/master-request.json']);
    const bad = { ...files, 'case.json': jsonBytes({}) };
    await page
      .getByLabel('选择 Case 包', { exact: true })
      .setInputFiles({
        name: 'bad.zip',
        mimeType: 'application/zip',
        buffer: Buffer.from(writeZip(bad)),
      });
    await page.waitForFunction(
      () => !document.querySelector('[aria-label="导入 Case 包"]').disabled,
    );
    assert.match(
      (await page.locator('.files-error').allTextContents()).join(''),
      /不一致/,
    );
    assert.equal(await page.locator('.project').innerText(), names[5]);
    const pack = JSON.parse(
      fs.readFileSync('case-packages/gmail/build/gmail.case.json'),
    );
    pack.manifest.case_id = 'zip-source-test';
    pack.manifest.title = 'ZIP 源包导入';
    pack.case.meta_data.sample.case_id = pack.manifest.case_id;
    pack.case.meta_data.sample.case_name = pack.manifest.title;
    await page
      .getByLabel('选择 Case 包', { exact: true })
      .setInputFiles({
        name: 'source.zip',
        mimeType: 'application/zip',
        buffer: Buffer.from(writeZip(sourceFiles(pack, ''))),
      });
    await page.waitForFunction(
      () => !document.querySelector('[aria-label="导入 Case 包"]').disabled,
    );
    assert.equal(await page.locator('.files-error').count(), 0);
    assert.equal(
      await page.locator('.project').innerText(),
      pack.manifest.title,
    );
    await page
      .getByRole('button', {
        name: '更多：' + pack.manifest.title,
        exact: true,
      })
      .click();
    const again = page.waitForEvent('download');
    await page
      .getByRole('button', { name: '下载完整 Case ZIP', exact: true })
      .click();
    const final = await again;
    await final.saveAs('/tmp/case-zip-tests/source-reexport.zip');
    const reexport = readZip(
      new Uint8Array(
        fs.readFileSync('/tmp/case-zip-tests/source-reexport.zip'),
      ),
    );
    assert.equal(
      Buffer.from(reexport['source/brief.md']).toString('base64'),
      pack.attachments['brief.md'],
    );
    assert.deepEqual(errors, []);
    console.log(
      'PASS restored playback, source ZIP import/export, invalid ZIP rollback and no browser errors',
    );
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
