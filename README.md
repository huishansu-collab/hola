# 交互模型数据合成管理平台

全双工交互 Case 的时间线、音频预览和数据导出工作台。所有业务事件均为模拟数据。

## 本地运行

需要 Node.js 22.18 或更新版本，构建单文件页面还需要 Python 3。

```sh
npm ci
npm run dev:local
```

打开终端显示的本地地址。页面使用内置的 Case 数据和音频，无需配置业务服务或 TTS 凭据。

## 构建离线页面

```sh
npm run build:local
```

构建产物位于仓库同级的 `Track Studio Local/Track Studio.html`，可直接用浏览器打开。音频已嵌入页面。

## 功能

- 六个示例 Case：北京天气、演员与电视剧查询、回家叫车、订咖啡、短信提醒、新用户查 Gmail 邮件。Gmail Case 已接入四段完整对话语音，时序按实际录音对齐。
- 用户、用户控制、助手、表达控制、世界、后台判断、工具调用七条轨道；播放控制并入工具调用。
- 每个 Case 独立保存缩放、适应窗口和音频预览开关状态。
- 完整双声道音频：用户位于左声道，助手位于右声道。
- TAR 下载包含 `audio.wav` 和合并 Meta、Utterances、Events、Annotation 的 `case.json`。

文件目录与界面状态保存在当前浏览器的本地存储中；合成音频缓存在 IndexedDB 中。更换浏览器或清除站点数据会重置这些本地状态。

## 独立 Case 包

Gmail 已使用独立数据包驱动。Files 右侧的“导入 Case 包”支持导入构建生成的 `.case.json`，相同 ID 更新，刷新后保留。

```sh
npm run case:validate -- case-packages/gmail
npm run case:build -- case-packages/gmail
```

导入文件位于 `case-packages/gmail/build/gmail.case.json`，交付文件为同目录的 `gmail.tar`。格式和新增 Case 方法见 [Case 包 v1](docs/case-package-v1.md)。

## 项目结构

- `case-packages/`：独立 Case 源数据和源音频，目前已迁移 Gmail。
- `lib/case-package/`：CLI 与浏览器共用的校验和音频构建。
- `app/`：页面和样式。
- `components/`：时间线、Case、音频与数据面板。
- `components/audio/`：内嵌音频与波形数据、播放和双声道合成。
- `components/cases/`：结构化 Case 数据。
- `local/`：离线构建入口、音频生成与整理脚本、提示词及源音频。
- `scripts/`：数据与界面回归检查。

## 检查

```sh
npx tsc --noEmit
node scripts/check-all-json.mjs
node scripts/check-case-viewport.mjs
```

`check-all-json.mjs` 会检查工具与事件关联，并把各 Case 的完整 JSON 写入同级 `Case Exports/` 目录。

浏览器回归检查需要另行提供 Playwright 和 Chrome：

```sh
PLAYWRIGHT_MODULE=/path/to/playwright \
CHROME_PATH=/path/to/chrome \
node scripts/check-case-viewport-browser.cjs
```

运行前先启动本地预览，也可以通过 `STUDIO_URL` 指定已构建页面。

重新生成语音需要自行配置服务访问凭据。生成脚本从 `SEED_AUTH_FILE` 环境变量读取私有请求头文件，请勿将凭据提交到仓库。

## 完整 Case ZIP

Case 详情面板右上角可下载完整 ZIP，包含标准 JSON、说明、对白、全部轨道、语音与等待音效、双声道合成音频，以及可用的源录音和生成记录。Files 栏支持导入 ZIP 或 `.case.json`，同 ID 更新原 Case，刷新后保留。

格式与限制见 [Case 包说明](docs/case-package-v1.md#完整-zip-备份与导入)。音频预览中的最终交付仍为 TAR。
