# Case 包 v1

Gmail 已迁移为独立数据包。其余五个 Case 暂时保留原有实现。新增 Case 可以使用新的 ID 导入，网站无需增加专用代码。

## 使用

Node.js 22.18 或更新版本。在项目根目录运行：

```sh
npm ci
npm run case:validate -- case-packages/gmail
npm run case:build -- case-packages/gmail
npm run dev:local
```

在 Files 标题右侧点击“导入 Case 包”，选择 `case-packages/gmail/build/gmail.case.json`。相同 ID 更新当前 Case，保留文件夹和分类；新 ID 添加到当前文件夹。有效包保存到 IndexedDB，刷新后恢复。每个浏览器独立保存，暂未接入团队服务。

数据包最大 64 MB。校验失败会显示错误，原 Case 保持可用。内置的 weather、actor、ride、coffee、sms 尚未迁移，导入时请使用其他 ID；gmail 可覆盖更新。

## 源目录

```text
case-packages/gmail/
  manifest.json
  brief.md
  script.md
  case.json
  timeline.json
  audio/sources/*.wav
  generation/alignment.json
  generation/requests/*.json
```

- manifest：版本、稳定 ID、标题和文件索引。结构定义见 `lib/case-package/manifest.schema.json`。
- brief / script：原始需求和已确认脚本，供人工审阅。
- case.json：Meta、Utterances、Events、Annotation 的完整标准数据。语音和事件时间的事实来源。
- timeline.json：固定七轨、片段引用、响应关系、工具依赖和打断边界。
- alignment.json：每句台词使用哪份原始录音、从哪个毫秒到哪个毫秒。
- requests：可追踪的生成参数，不放凭据、原始 API 响应或签名下载地址。

音频源 v1 使用 48 kHz、16 bit、单声道或双声道 PCM WAV；双声道源在裁切时取均值。没有隐式重采样或变速。Case 最长 600 秒。所有文件引用必须位于包目录内，CLI 拒绝路径越界和指向目录外的符号链接。

## 最小引用示例

语音文字和播放时间只维护在 case.json：

```json
{"id":"u001","speaker":"user","speaker_id":"user_1","text":"就 Gmail。","start_at_ms":11080,"end_at_ms":11830}
```

timeline 的语音片段仅引用它：

```json
{"kind":"speech","utterance_id":"u001"}
```

工具片段使用 `{"kind":"tool","event_id":"gmail_stop"}`，起止时间和工具名称从对应请求与返回派生。说明可放在 `description`。

后台状态、站内操作、世界信号、表达片段分别使用 kind `state`、`action`、`world`、`expression`，包含 `label`、`start_at_ms`、`end_at_ms`。同轨重叠片段需要不同的 `lane`。表达片段可另带 `trigger`、`delivery`、`annotation`，检视面板据此展示；缺省时 `delivery` 取 `label`、`annotation` 取 `description`。

## 未配音的包

台词和时序可以先于录音确定。`constraints.timing_status` 为 `planned` 时，包不携带任何音频：`alignment.clips` 必须为空，`audio_status` 必须为 `none`，校验跳过与录音有关的检查，`case:build` 只产出 `runtime.json`、`case.json` 和 `<id>.case.json`，不产出 `audio.wav`、`clips/` 和 `<id>.tar`——没有录音就没有可交付的合成数据。页面顶部标注「语音待生成」，时间按设计值展示。

补录后把切点写进 `alignment.json`，`timing_status` 改为 `aligned`、`audio_status` 改为 `generated`，重新 build 即可。半对齐的包（部分台词有音频）会被拒绝，避免只校验了一半。

## 打断与附和

助手人声压在用户人声上有两种情形，判据是用户有没有停：

- 用户停声，助手拿走话语权，是**打断**，登记在 `interruptions`，需要完整的检出 / 停播指令 / 淡出 / 实际停声链路和配对的 `audio.stop`。
- 用户继续说完，话语权不转移，是**附和**，登记在 `backchannels`：

```json
{"assistant_id":"u006","over_user_id":"u005"}
```

附和必须完全落在用户人声内部（起声晚于用户、收声早于用户），不能同时登记为打断，也不登记 `response_links`——它不是对用户的回应。

任何一对人声重叠都必须登记为其中之一，漏登记会被拒绝。这条是两者不被混淆的保证：形态相同，只有声明能区分。

## 检查点

没有打断的 Case 也需要指出该看哪里。`timeline.checkpoints` 逐条声明，与打断并列显示在事件条上：

```json
{"name":"首次附和","title":"嗐 + 是啊！","start_at_ms":15200,"end_at_ms":16400,"tag":"助手附和","note":"连说三句后才给一次附和；压在用户人声上，用户没停。"}
```

alignment 记录源录音切点：

```json
{"utterance_id":"u001","source":"audio/sources/user-master.wav","source_start_ms":5050,"source_end_ms":5800}
```

两个时间区间长度必须相同。修改台词后，应生成匹配录音并重新对齐；校验无法判断录音是否准确说出了台词。

## 构建产物

`npm run case:build -- <目录> [--out <产物目录>]` 输出：

| 文件 | 用途 |
| --- | --- |
| `<id>.case.json` | 自包含网站导入包；包含标准数据、时间线、切点和引用的原始 WAV |
| `clips/*.wav` | 每句实际播放的原速音频切片 |
| `runtime.json` | 通用页面数据及裁切后的音频和波形 |
| `audio.wav` | 用户左声道、助手右声道，包含实际静音和打断淡出 |
| `case.json` | 完整标准 JSON，音频引用更新为 audio.wav |
| `peaks.json` | 最终双声道波形 |
| `<id>.tar` | audio.wav 与 case.json，用于交付 |

可编辑源目录用于版本管理；`.case.json` 用于本阶段离线导入，不携带请求提示词和笔记。TAR 为最终合成数据，不能代替可编辑源包。构建产物可删除重建，不提交到 Git。

更新输入后重新 build，再导入。网站使用内容摘要隔离每次导入的音频，并使合成缓存失效；相同内容重复导入可以复用缓存。

## 校验边界

CLI 与浏览器使用同一个校验器，检查：

- 版本、ID、七轨完整性、角色和声道。
- 语音引用、音频存在性、切点范围、时长一致。
- 工具定义、请求参数、请求返回配对、依赖顺序。
- 400 ms 网格、回应间隔、同轨重叠。
- 打断检出、命令、淡出、实际停声顺序，以及重叠区是否有双方实际声音。
- 附和完全落在用户人声内部，且未同时登记为打断或回应。
- 每一对人声重叠都已登记为打断或附和。
- planned 包不得携带音频关联，aligned 包必须逐句关联。
- audio.play 后的 audio.stop 与助手语音间隔。
- Annotation 与表达轨道关联，打断不放入 Annotation。

自然度、音色一致性、台词准确性仍需要试听。v1 的音频构建仅合成语音；外部音效资产的播放映射将在其他 Case 迁移时扩展。该入口不会调用 TTS，也不会发布到服务器。

## 回归

```sh
npm run case:build -- case-packages/gmail
npm run test:case-package
node scripts/check-all-json.mjs
npx tsc --noEmit
```

浏览器测试支持 `PLAYWRIGHT_MODULE`、`CHROME_PATH`、`STUDIO_URL` 环境变量：

```sh
node scripts/check-case-package-browser.cjs
```

Gmail 的历史对照位于 `scripts/fixtures/gmail-parity.json`，仅用于回归；新的制作入口为 `case-packages/gmail`。旧的 `local/gmail` 录音和提示词保留作为制作历史。
