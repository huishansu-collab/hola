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

- 十一个手写示例 Case：北京天气、演员与电视剧查询、回家叫车、订咖啡、短信提醒、新用户查 Gmail 邮件、播报中打断改口、路况服务超时降级、指代不明先澄清、吐槽时附和、查到无票主动打断。Gmail 与吐槽附和两个 Case 已接入完整对话语音，时序按实际录音对齐。
- 另有 59 个 Case 从《语音双工 - Explicit case》文档导入（文档 58 条，其中 Z5 给了两张表，拆成两个包），按原文分组放在 Files 的 A–Z 文件夹里。前十条（A1–D1）已配音，时间线按真实录音重排；其余为 `planned` 包：台词、后台判断、工具调用与表达控制齐备，语音待生成。导入与配音脚本见 `local/explicit-cases/`。

配音一条 Case 的流程：`voice_request.py` 生成请求 → 把 Case id 写进 `.github/synthesis-tts-request.yml` 并 push（Actions 调火山生成母带并提交回分支）→ `local/align_master.py` 对齐切点 → `local/explicit-cases/retime.py` 按录音重排时间线。重新跑 `import.py` 会把包退回 planned，之后对已配音的 Case 再跑一次 retime 即可。
- 未配音的 Case 时序为设计值，界面顶部会标注「语音待生成」；其余结构与已配音 Case 一致，可直接导出 JSON。
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
npm run case:validate -- case-packages/gmail   # 结构：引用、配对、音频切点、打断边界
npm run case:build -- case-packages/gmail      # 构建导入文件与交付包
npm run case:json                              # 契约体检：字段、轨道顺序、标注归属、等待承接
```

跑一整条的话用流水线，它把创作前后的确定性步骤串起来，并守住「人没点头不配音」这条线：

```sh
npm run ppl -- new taxi-late "加班到十点，让助手叫车回家"   # 建骨架，按 skill 写脚本
npm run ppl -- new milk "培训中低声点奶茶" --script x.dsl   # 脚本直接编成 Case
npm run ppl -- compile meeting-milk-tea                    # 改完 script.dsl 重新切轨
npm run ppl -- review taxi-late                            # 把脚本交给人看
npm run ppl -- approve taxi-late --by 名字                  # 人 review 通过，才允许配音
npm run ppl -- make taxi-late                              # 配音 → 对齐 → 重排 → 校验 → 构建
npm run ppl -- status                                      # 每条走到哪一步
```

## 在时间线上直接改片段

拖动改的是时间，这一节说的是「有哪些片段、它们是什么」：

- **点轨道空白处**新建片段，**双击片段**配置，片段右上角 ⓘ 的悬浮卡里也有「配置 / 删除」。
- 工具片段选工具（Memory / 系统 / MCP / 其他四组）、填参数和模拟返回，保存时按 schema 校验
  必填项、数字和 JSON；片段标题按实际参数渲染，背后自动生成请求 / 返回一对 Events，
  工具定义写进 `meta.static_context.tools`。
- 用户控制和世界片段带来源、动作和内容 JSON，生成对应的 `ui_event` / `world_event`。
- 表达控制片段挑一句助手回复贴上去，起止时间跟着它走；垫句、慢说进 `fdx_annotation`，
  仅文字回复等进 `custom_annotation`。
- 用户和助手语音不在这里建也不在这里删——那是录音和导入的事，界面会直说。
- 删片段会把它背后的 Events 和标注一起删掉；删 `audio.play` 时配对的 `audio.stop` 一起走。
- **⌘Z / Ctrl+Z 撤销，⇧⌘Z / Ctrl+Shift+Z 重做**，按 Case 分开记。
- 在轨道里**框选**一组片段，拖其中任意一个整体移动，相对位置不变。

改动保存在浏览器本地，按 Case 记；导出 ZIP / JSON 时带的是改过之后的数据。

## 流水线这一页：脚本 → 自动切轨 → 手动拖

界面顶部有两页。「时间线」是拖片段的地方，「流水线」是把脚本变成七轨的地方：
左边写脚本，右边实时体检并预览切轨结果，一键导入时间线之后再用手拖。

脚本是一行一件事，行首的词决定它落在哪条轨道：

```
标题 培训中低声点一杯奶茶
用户 帮我点一杯瑞幸的茉莉花奶茶。 [低语]
判断 任务：饮品下单；品牌：瑞幸；商品沿用原话 [时长 800]
助手 嗯……我看一下瑞幸这边。 [垫句] [慢说]
工具 quote: delivery.quote(product=茉莉花奶茶) => price_cny=12 [时长 1600]
助手 好的，一杯瑞幸茉莉花奶茶，送到公司，对吧？ [依赖 quote]
```

时间不用写：台词按字数估时长，助手起点自动对齐 400 ms 微轮次，跨轨道依赖自动留出
400 ms，`[依赖 quote]` 就等这个工具返回，`[并行]` 与上一件后台的事同时开始。
`[打断]` `[附和]` `[垫句]` `[慢说]` `[低语]` 分别落进 interruptions、backchannels、
表达控制与用户侧标注。编译完当场过一遍正式校验器，过不了就不给导入，
并指到具体第几行。估出来的是 `planned` 时间，配音之后按录音重排。

同一个编译器在命令行里也能用：

```sh
node scripts/script-to-package.mjs case-packages/meeting-milk-tea   # 改 script.dsl 后重新切轨
node scripts/check-script-dsl.mjs                                   # 编译器回归检查
```

`case-packages/meeting-milk-tea/` 就是这么来的：`script.dsl` 是脚本源文件，
`case.json` 与 `timeline.json` 是编出来的，两边对不上 `check-script-dsl.mjs` 会红。

`make` 可重入：母带没回来就停在等 CI，回来后再跑一次接着往下走；识别匹配率低于 0.5 直接停，
不带病往下走。状态记在 `local/ppl/<id>.json`，包括谁在什么时候 review 通过的。

`case:json` 查的是 `case:validate` 管不到的那半边——契约里写了但结构上不违法的规矩：
根字段、七轨顺序、语音/工具片段不许重复时间、表达标注只关联助手、跨轨依赖间隔、
等待超过 2 秒有没有垫句、旧目录的 Case 有没有迁到七轨。错会让退出码非零，提醒不会。

导入文件位于 `case-packages/gmail/build/gmail.case.json`，交付文件为同目录的 `gmail.tar`。格式和新增 Case 方法见 [Case 包 v1](docs/case-package-v1.md)。

## 项目结构

- `case-packages/`：独立 Case 源数据和源音频。手写的 `gmail`、`backchannel`，以及文档导入的 `explicit-*`。
- `lib/case-package/`：CLI 与浏览器共用的校验和音频构建。
- `app/`：页面和样式。
- `components/`：时间线、Case、音频与数据面板。
- `components/audio/`：内嵌音频与波形数据、播放和双声道合成。
- `components/cases/`：结构化 Case 数据，每个目录含 `case.json` 与 `timeline.json`。
- `components/json-case.ts`：纯 JSON 驱动 Case 的共用加载器。
- `local/`：离线构建入口、音频生成与整理脚本、提示词及源音频。
- `local/explicit-cases/`：从 Explicit case 文档抽表（`tables.py`）并生成 Case 包（`import.py`）；`parsed.json` 是抽出来的中间结果，改完脚本重跑即可整体重生成。
- `scripts/`：数据与界面回归检查。`check-case-json.mjs` 是契约体检，
  `browser-env.cjs` 让几个浏览器检查按环境变量找 playwright 和页面，不写死本机路径。

## 检查

```sh
npx tsc --noEmit
node scripts/check-all-json.mjs
node scripts/check-case-viewport.mjs
node scripts/check-case-set.mjs
node scripts/check-script-dsl.mjs
node scripts/check-clip-edit.mjs
```

`check-all-json.mjs` 会检查工具与事件关联，并把各 Case 的完整 JSON 写入同级 `Case Exports/` 目录。

`check-case-set.mjs` 针对无语音的五个 Case 检查它们各自的交互约束：打断后停播与改写查询分开成立、工具超时只重试一次且降级时标注数据来源、指代唯一之前不执行发送、附和必须压在用户人声内且用户继续说、主动打断必须先有依据再起声且不补全被打断的半句。

浏览器回归检查需要另行提供 Playwright 和 Chrome：

```sh
PLAYWRIGHT_MODULE=/path/to/playwright \
CHROME_PATH=/path/to/chrome \
node scripts/check-case-viewport-browser.cjs
node scripts/check-script-page-browser.cjs
node scripts/check-clip-edit-browser.cjs
```

运行前先启动本地预览，也可以通过 `STUDIO_URL` 指定已构建页面。

重新生成语音需要自行配置服务访问凭据。生成脚本从 `SEED_AUTH_FILE` 环境变量读取私有请求头文件，请勿将凭据提交到仓库。

## 完整 Case ZIP

Case 详情面板右上角可下载完整 ZIP，包含标准 JSON、说明、对白、全部轨道、语音与等待音效、双声道合成音频，以及可用的源录音和生成记录。Files 栏支持导入 ZIP 或 `.case.json`，同 ID 更新原 Case，刷新后保留。

格式与限制见 [Case 包说明](docs/case-package-v1.md#完整-zip-备份与导入)。音频预览中的最终交付仍为 TAR。

尚未配音的 Case 已备好合成提示词，取得凭据后按下面三步补语音：

```sh
SEED_AUTH_FILE=/path/to/headers python3 local/generate_audio.py backchannel
# 听 local/backchannel/audio/session-master.mp3，把每段台词的起止秒写进 local/backchannel/audio-cuts.json
python3 local/package_case_audio.py backchannel
```

`audio-cuts.json` 里的 `id` 要和 `timeline.json` 里对应片段的 `audio_key` 一致。切片完成后必须按实际录音重排时间线，并把 `timing_status` 与 `audio_status` 改为 `aligned` / `generated`；附和 Case 的重叠区间也要跟着重对，否则 `check-case-set.mjs` 会红。
