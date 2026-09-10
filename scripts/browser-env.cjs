// 浏览器检查的运行环境：别写死某台机器的路径。
// playwright 用 PLAYWRIGHT_MODULE 或就近解析；Chrome 用 CHROME_PATH，留空则用 playwright 自带的；
// 页面默认取本地构建产物 ../Track Studio Local/Track Studio.html（local/package_single.py 的输出）。
const path = require('node:path'),
  { pathToFileURL } = require('node:url');
function playwright() {
  const tries = [
    process.env.PLAYWRIGHT_MODULE,
    'playwright',
    '/opt/node22/lib/node_modules/playwright',
  ].filter(Boolean);
  for (const p of tries) {
    try {
      return require(p);
    } catch {}
  }
  throw Error('找不到 playwright：设置 PLAYWRIGHT_MODULE 指向它的安装目录');
}
const studioUrl = () =>
  process.env.STUDIO_URL ||
  pathToFileURL(
    path.resolve(__dirname, '..', '..', 'Track Studio Local', 'Track Studio.html'),
  ).href;
const launchOptions = () => ({
  headless: true,
  ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}),
});
module.exports = { playwright, studioUrl, launchOptions };
