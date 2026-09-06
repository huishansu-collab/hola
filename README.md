# Duplex Studio · 全双工语音 demo 平台

输入 **脚本 + 八轨日志**，生成 **高保真手机 case 演示**，并同步导出 **Live Interaction 规范化 JSON（Draft v5）**。

```
剧本 (script.dsl / script.json)
   ├─▶ 语音生成 (OpenAI TTS · gpt-4o-mini-tts,或离线 Kokoro v1.1-zh,逐句 wav + 缓存)
   ├─▶ 手机演示 (living edge · 双工打断 · 卡片 / 任务卡 / 来电 / 转写 · 八轨日志面板)
   └─▶ 规范化 JSON + 双声道母带 (utterances / events / world_signal / fdx & emotion annotation)
```

演示逻辑复刻自 `duplex-preview.html`（Step 全双工 preview）：嘚嘚建连、模型垫场、开口打断双声重叠后 fade out、执行等待音、Apple-Intelligence 式下拉面板、灵动岛任务卡、来电界面、会议转写……但全部改成 **数据驱动**：任何 case 只是一份剧本。

## 快速开始

```bash
npm install
cp .env.example .env        # 可选：填入 OPENAI_API_KEY（OpenAI 音色）；不配也能跑，内置 case 已带语音，新 case 可用离线引擎生成
npm start                   # http://localhost:5173
```

工作台三个页签：

| 页签 | 做什么 |
| --- | --- |
| 演示 | 选 case → 播放。左：段落 beats + story clock；中：手机舞台（点 living edge 也能开始）；右：八轨日志（可按轨过滤）。授权麦克风后可以**亲口打断**模型，点手机屏幕同样有效 |
| 脚本 · 语音 | 编辑剧本（DSL 或 script.json）→ 解析预览 → 保存；一键生成缺失语音（SSE 进度）；查看说话人音色 |
| 导出 JSON | 生成 Draft v5 规范化 JSON 预览 / 下载；时间轴条；下载双声道 WAV（服务端只混 WAV 片段；导入的 m4a / mp3 用「浏览器混音」） |

命令行：

```bash
npm run parse -- cases/morning/script.dsl          # 剧本 → script.json
npm run validate -- morning
npm run tts -- morning [--force] [--only u001,u002] # OpenAI 生成语音（需 .env）
npm run export -- morning                          # → cases/morning/export/{json,audio}/synthetic/1_s01.*
node server/cli.js list
```

## 内置 case

| 编号 | case | 看点 |
| --- | --- | --- |
| Golden | `morning` 工作日早上 · 起晚出门 | Golden Case 文档全链路 12 段：抢话计时、双平台叫车、门锁回执、brief 打断、长任务承接、朗读零反馈、司机改线核验、最高优预授权穿透、低语零语音、办公室轻震归档。**含完整八轨日志**，剧本即 `cases/morning/script.dsl` |
| 01 | `commute` 出门上班 | 垫场 + 后台查天气 → 开口打断改打车 → CoT 比价 → 一键叫车 → 任务卡 |
| 02 | `bestie` 闺蜜聊天 | 安抚 + 搜索 → 人物卡 → 追问打断 → 纠正"是剧不是电影" |
| 03 | `english` 临时学英语 | 双语示范 + 短语卡 → 选版本打断 → 跟读打断 → 点评 |
| 04 | `ktv` KTV 脱身电话 | 定时任务卡倒计时 → "老妈"来电 → 第三方音色 |
| 05 | `home` 回家开空调 | 设备逐台点亮 → 汇报中被追加 → Home Ready 卡 |
| 06 | `landlord` 房东来电 | 电话助攻：红闪微震 → Memory 命中合同 → 证据卡 + 话术 |
| 07 | `idiom` 成语接龙 | 抢着定规则 → 对局卡 + 30s 倒计时 |
| 08 | `meeting` 会议纪要 | 绿灯静默记录 → 三人分离转写 + 抢话双路 → 纪要卡 |
| 09 | `order` 会议点外卖 | 连摸两下悄悄话模式 → 模型只打字 → 外卖卡 |
| 10 | `read` 伴读 | 文章页 → 读屏卡 → 追问打断 |
| 11 | `stock` 股票查询 | 四次连续抢话 → 行情卡 → "你退下吧" |

01‒11 的语音沿用参考包里的定妆音色片段（已转成 mp3，所有浏览器都能解码）；`morning` 的 65 句由离线引擎 Kokoro v1.1-zh 生成（`python3 tools/offline_tts.py morning`，wav 母带 + mp3 一并随仓库附带）。想换成 OpenAI 音色：「脚本 · 语音」页贴上 key 点「全部重新生成」，或 `npm run tts -- morning --force`。

## 剧本怎么写

看 [docs/SCRIPT_FORMAT.md](docs/SCRIPT_FORMAT.md)。核心思路：**台词照 Golden Case 表格写，日志照八轨口径写，UI 靠 `@指令`**。

```text
## 段2｜08:04:20‒08:05:41｜厨房·煮蛋
[08:04:26.4‒08:04:38.0] 助手: 六分钟，捞出来过一下凉水就是溏心。火候上水保持小滚就行，太大了容易——
  【语音·助手】助手句性质｜应答（讲解）；是否重叠｜竞争打断（被用户叠上）
★ [08:04:36.0‒08:04:39.5] 用户（抢话，与 AI 语音重叠）: 行了行了，六分钟就行，你帮我计时！
  【语音·用户】对谁说的｜对助手说；情绪｜不耐烦；是否重叠｜竞争打断（叠在助手上 2.0s）
  【决策点】该不该开口｜闭嘴（≤200ms收口）；打断语义｜改参数；禁止｜接着说旧答案
[08:05:32.3‒08:05:35.3] 助手: 计上了，六分钟，八点十一分半叫你。
  【任务】任务类型｜设闹钟·计时（当场就做）：timer.create(6:00)→结果 到点 08:11:32（耗时 0.3s）
@card id=timer icon=timer title="Egg Timer" eta="6:00" timer={"from":360,"unit":"","format":"mm:ss"}
```

日志里的 `tool(args)→结果…（耗时…）`、`key=value` 记忆引用、世界信息、硬件反馈会**自动**变成演示里的执行卡片 / 震动 / 卡片，和 JSON 里的 `events` / `world_signal` / `annotation`。

## 规范化 JSON

严格按 Draft v5 骨架：`meta_data / static_context / dynamic_context / utterances / events / annotation{fdx_annotation, emotion_annotation, paralinguistic_annotation}`，另加 `annotation.track_annotation` 保留八轨日志原文。JSON Schema 见 [schema/normalized.schema.json](schema/normalized.schema.json)。时间戳与母带 `audio/synthetic/{case_id}_{sample_id}.wav`（Channel 1 用户/第三方，Channel 2 助手，被打断的句子按 0.7s/1.75s 让位包络混入）对齐。

## 语音生成

### 离线引擎（不需要任何 key）

```bash
pip install sherpa-onnx numpy imageio-ffmpeg     # 一次性；imageio-ffmpeg 只为顺手输出 mp3
python3 tools/offline_tts.py morning             # 首次自动从 GitHub Releases 下载模型（≈365MB）到 ~/.cache/duplex-studio/
python3 tools/offline_tts.py mycase --voice user=zm_010 --voice assistant=zf_001 --voice 司机=zm_029
```

引擎是 Kokoro v1.1-zh（82M 参数，中文 100 个音色 + 英文），CPU 上约 3× 实时，65 句两分多钟。台词的舞台提示会影响语速（急促 / 抢话加快，轻缓 / 低语放慢），低语句自动压低音量；`--list-voices` 列出全部音色，剧本里也可以按说话人写 `tts.local_voice`。输出 `<clip>.wav`（24kHz 母带，服务端混音用）和同名 `.mp3`（单文件包 / 网页只带这份），manifest 里 `source=local:kokoro-v1.1-zh:<voice>`；之后 `npm run tts` 不会动这些句子，除非 `--force`。

### OpenAI TTS

三条路都走同一套逻辑（`shared/tts.js`：逐句计划 → `/v1/audio/speech` → 24kHz wav → 按 `model|voice|speed|instructions|text` 的哈希缓存，改了文本只重生成那一句）：

| 方式 | 在哪 | 怎么用 |
| --- | --- | --- |
| 浏览器直连 | 工作台「脚本 · 语音」页 | 贴上你的 OpenAI key（只存本机 `localStorage`），点「生成缺失语音」。浏览器直接调 OpenAI，结果缓存在 IndexedDB，演示与 JSON 导出立即生效；本地运行时还会 `PUT /api/cases/<id>/clips/<clip>` 写回 `cases/<id>/audio/`。在 `dist/duplex-demo.html`、GitHub Pages 版里同样可用 |
| 服务端 | `.env` 里的 `OPENAI_API_KEY` | 「脚本 · 语音」页的服务端按钮，或 `npm run tts -- <id> [--force] [--only u001,u002]`；走代理时 `NODE_USE_ENV_PROXY=1`（Node 自带 fetch 默认不读 HTTPS_PROXY） |
| 手动导入 | `cases/<id>/audio/` | 放入 `<clip>.wav\|mp3\|m4a`（文件名 = 台词 id 或 `clip`），服务重新扫描即可 |

- 模型默认 `gpt-4o-mini-tts`：每个说话人的 `instructions`（定妆音色描述）+ `voice` 决定音色；台词的舞台提示（急促 / 轻缓 / 低语）会附加进 instructions。`tts-1 / tts-1-hd` 不支持 instructions。
- claude.ai 上的 Artifact 版受内容安全策略限制无法访问外网，浏览器直连在那里不可用；用 GitHub Pages 版（仓库 Settings → Pages → Source 选 GitHub Actions，`.github/workflows/pages.yml` 会自动发布）或本地运行。
- `.env` 不会被提交；不要把 key 写进任何脚本。

### 在 Claude 云端会话里用 OpenAI（沙箱默认连不到 api.openai.com）

Claude Code 云端环境默认是 **Trusted** 网络策略，只放行包管理源和 GitHub，`api.openai.com` 会被拒。两条路，都只要在你这边做一次设置：

| 路 | 一次性设置 | 之后怎么生成 |
| --- | --- | --- |
| **A. 环境 API credential**（推荐，key 不进沙箱） | claude.ai/code 消息框上方的云朵图标（显示当前环境名，如 Default）→ 悬停环境 → 齿轮 → 对话框底部 **API credentials → Add credential**：Name `OpenAI`，Allowed websites `api.openai.com`，Header `Authorization` / Prefix `Bearer` / Value 填 key → Connect。Anthropic 的代理会在请求出沙箱后自动加上 key（Pro / Max 可用） | 在该环境的会话里运行：`OPENAI_API_KEY=proxy-injected NODE_USE_ENV_PROXY=1 npm run tts -- morning --force`（`proxy-injected` 只是占位，真正的 key 由代理注入） |
| **B. GitHub Actions** | 仓库 **Settings → Secrets and variables → Actions → New repository secret**：Name `OPENAI_API_KEY`，Secret 填 key | Actions 页签 → **Generate voices with OpenAI** → Run workflow（选分支、填 case）；或改一下 `.github/tts-request.yml` 再 push。3‒5 分钟后 wav + mp3 自动提交回分支，并重新发布 Pages |

也可以把环境的 Network access 改成 **Full** 或 **Custom**（加 `api.openai.com`），再按普通方式配 `.env`。

## 目录

```
server/    index.js (Express API) · tts.js (OpenAI) · audio.js (wav 混音) · cases.js (存储/清单) · cli.js
tools/     offline_tts.py (离线 Kokoro 语音) · build-static.mjs (单文件包)
shared/    script.js (格式/校验) · dsl.js (剧本编译) · tracks.js (八轨日志解析) · schedule.js (时间轴) · normalize.js (Draft v5)
public/    index.html · css/platform.css · js/engine.js (演示引擎) · js/app.js (工作台) · assets/{icons,fonts,img,fx}
cases/<id>/ script.dsl? · script.json · audio/{clips, manifest.json} · export/ (gitignored)
schema/    normalized.schema.json
docs/      SCRIPT_FORMAT.md
```

## 已知边界

- 片段格式：wav / mp3 所有浏览器都能解码（参考包的 m4a 已用 ffmpeg 转成 64kbps mp3）；若自行导入 m4a（AAC），纯开源 Chromium / 部分 Linux 浏览器无解码器时会退化为按语速上屏。
- 服务端混音只处理 wav 片段（OpenAI / 离线引擎生成的即是）；其它格式请用工作台的「浏览器混音 WAV」。同名 wav 与 mp3 并存时，服务端与混音用 wav，单文件包只带 mp3 以控制体积。
- 场景环境音（scene_*.m4a）来自参考包；新 case 的环境音需自行准备后放入 `audio/` 并在剧本里 `ambience:` 指定。
