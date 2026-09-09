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

- 十一个示例 Case：北京天气、演员与电视剧查询、回家叫车、订咖啡、短信提醒、新用户查 Gmail 邮件、播报中打断改口、路况服务超时降级、指代不明先澄清、吐槽时附和、查到无票主动打断。Gmail Case 已接入四段完整对话语音，时序按实际录音对齐。
- 后五个 Case 尚未生成语音，时序为设计值，界面顶部会标注「语音待生成」；其余结构与已配音 Case 一致，可直接导出 JSON。
- 附和与打断成对入库：两者都出现助手人声压在用户人声上，判据是用户有没有停——不停是附和（backchannel），停了是打断（preempt）。
- 用户、用户控制、助手、表达控制、世界、后台判断、工具调用七条轨道；播放控制并入工具调用。
- 每个 Case 独立保存缩放、适应窗口和音频预览开关状态。
- 完整双声道音频：用户位于左声道，助手位于右声道。
- TAR 下载包含 `audio.wav` 和合并 Meta、Utterances、Events、Annotation 的 `case.json`。

文件目录与界面状态保存在当前浏览器的本地存储中；合成音频缓存在 IndexedDB 中。更换浏览器或清除站点数据会重置这些本地状态。

## 独立 Case 包

Gmail 与「老板反复改周会 / 吐槽时附和」已使用独立数据包驱动。Files 右侧的“导入 Case 包”支持导入构建生成的 `.case.json`，相同 ID 更新，刷新后保留。

附和 Case 尚未配音，作为 `planned` 包入库：台词、时序与标注齐备，补录后写入切点并改为 `aligned` 即可产出音频与交付 TAR。

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
- `components/cases/`：结构化 Case 数据，每个目录含 `case.json` 与 `timeline.json`。
- `components/json-case.ts`：纯 JSON 驱动 Case 的共用加载器。
- `local/`：离线构建入口、音频生成与整理脚本、提示词及源音频。
- `scripts/`：数据与界面回归检查。

## 检查

```sh
npx tsc --noEmit
node scripts/check-all-json.mjs
node scripts/check-case-viewport.mjs
node scripts/check-case-set.mjs
```

`check-all-json.mjs` 会检查工具与事件关联，并把各 Case 的完整 JSON 写入同级 `Case Exports/` 目录。

`check-case-set.mjs` 针对无语音的五个 Case 检查它们各自的交互约束：打断后停播与改写查询分开成立、工具超时只重试一次且降级时标注数据来源、指代唯一之前不执行发送、附和必须压在用户人声内且用户继续说、主动打断必须先有依据再起声且不补全被打断的半句。

浏览器回归检查需要另行提供 Playwright 和 Chrome：

```sh
PLAYWRIGHT_MODULE=/path/to/playwright \
CHROME_PATH=/path/to/chrome \
node scripts/check-case-viewport-browser.cjs
```

运行前先启动本地预览，也可以通过 `STUDIO_URL` 指定已构建页面。

重新生成语音需要自行配置服务访问凭据。生成脚本从 `SEED_AUTH_FILE` 环境变量读取私有请求头文件，请勿将凭据提交到仓库。

尚未配音的 Case 已备好合成提示词，取得凭据后按下面三步补语音：

```sh
SEED_AUTH_FILE=/path/to/headers python3 local/generate_audio.py backchannel
# 听 local/backchannel/audio/session-master.mp3，把每段台词的起止秒写进 local/backchannel/audio-cuts.json
python3 local/package_case_audio.py backchannel
```

`audio-cuts.json` 里的 `id` 要和 `timeline.json` 里对应片段的 `audio_key` 一致。切片完成后必须按实际录音重排时间线，并把 `timing_status` 与 `audio_status` 改为 `aligned` / `generated`；附和 Case 的重叠区间也要跟着重对，否则 `check-case-set.mjs` 会红。
