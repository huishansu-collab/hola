# 剧本格式 · Script Format

平台的输入是一份 **剧本（脚本 + 八轨日志）**。它有两种等价写法：

| 形式 | 文件 | 适合谁 |
| --- | --- | --- |
| 剧本 DSL（文本） | `cases/<id>/script.dsl` | 产品 / 数据同学，按 Golden Case 文档的表格口径直接写 |
| script.json（结构化） | `cases/<id>/script.json` | 工程同学，或需要精细控制卡片 / 时序时 |

DSL 会被编译成 script.json（`npm run parse -- cases/<id>/script.dsl` 或在工作台点「保存」）。演示引擎与导出器都只读 script.json。

---

## 1. 剧本 DSL

```text
# 工作日早上 · 起晚出门                     ← 案例名
id: morning                                  ← 元信息：id / case_id / group / order / summary / sample_id
scene: 工作日早晨高压场景｜08:03 起晚…       ← 场景描述
clock: 08:03:00                              ← story clock 起点（可省略，取第一条台词的时间）
ambience: scene_morning.mp3                  ← 场景环境音（放在 audio/ 下，可省略）
speaker 司机: role=third_party voice=onyx instructions="…"   ← 额外说话人 / 改音色

```context                                   ← 静态上下文（JSON）：memory / tools / device_state / system_prompts / constraints
{ "memory": {…}, "tools": […] }
```

## 段1｜08:03:00‒08:03:30｜卫生间·快问快答   ← 段落（左侧 beats；时间段决定 story clock）
剧情：…                                      ← 段落说明（考点：/ 助手：同样收进段落备注）
@edge touch                                  ← UI 指令
★ [08:03:00.0‒08:03:03.5] 用户: 几点了？…    ← 台词：★ 特写 · [开始‒结束] · 说话人（舞台提示）: 文本
  【世界信息】场景/状态｜…；信号来源｜…       ← 八轨日志，挂到上一条台词 / 指令 / 系统行
  【任务】任务类型｜查天气（查一下再答（快））：weather.today(本地,当日)→结果 16‒24℃·晴（耗时 0.6s）
  屏幕: LIVING EDGE 亮起，助手对话框展开。    ← 屏幕说明
[08:03:29.8‒08:04:20.0] 系统: 洗漱继续，无对话。 ← 系统行：画面跳过 + 日志；系统（并行）不阻塞
```

### 说话人

`用户 / 助手（AI助手、Step）/ 系统` 为内置。其他名字（司机、老李、房东…）自动成为第三方说话人，
用 `speaker 司机: voice=onyx instructions="…"` 指定音色（`voice` / `instructions` 给 OpenAI TTS；`qwen_voice=Dylan` 给千问 TTS；`volc_persona="安静的室内，没有背景音乐，没有旁白。男子（…）"` 给火山 seed-audio 整段生成（用户 / 助手默认用参考包的定妆描述，其它说话人默认把 instructions 套进模板）；`local_voice=zm_029` 给离线引擎 `tools/offline_tts.py`。不写则按角色默认：OpenAI 助手 coral / 用户 ash，千问 助手 Cherry / 用户 Ethan / 第三方 Dylan，离线 助手 zf_001 / 用户 zm_010 / 第三方轮换）。导出时主用户是 `user_1`，其他真人依出现顺序 `user_2`、`user_3`…，助手为 `assistant`。

### 舞台提示（括号）决定双工行为

| 括号里的词 | 效果 |
| --- | --- |
| 抢话 / 打断 / 硬插话 / 截停 / 抢答 | `barge_in`：叠在对方正在说的话上，对方 0.7s 后淡出让位 |
| 借换气间隙 / 软插话 | `barge_in` + `soft` |
| 与…重叠 / 叠上 / 附和 / 伴听 | `backchannel`：同时开口，对方**不停**（附和重叠 / 合作重叠） |
| 低语 / 压低声音 / 凑近 | `whisper`：音量 0.6，标签「· 低语」 |
| 轻声 / 语气轻缓 | 音量 0.75 |
| 打字 / 不出声 | `typed`：不出声、逐字打出（悄悄话 / 静默模式） |
| 嘟囔 / 自言自语 / 念叨 / 朗读 | `no_bubble`：有声音但对话框不出气泡 |
| 并行（系统行） | 系统行不阻塞，用于「后台任务完成」这类与对话同时发生的事件 |

### 时钟推导时序

台词带 `[开始‒结束]` 时：
- 打断 / 附和的插入点 = 本句开始 − 目标句开始，按目标句时长换算成比例（`at_ratio`），实际语音长度不同也能保持相对位置；
- 句间间隔 = 本句开始 − 上一句结束（0‒2.5s 内生效，中间有系统行时不用）；
- 段落 / 系统行的 `clock_end` 推进手机上的 story clock，长区间自动显示「画面跳过」。

### 日志 → 自动 step / 标注

| 日志 | 自动产出 |
| --- | --- |
| `【任务】… tool(args)→结果 X（耗时 Ys）` | `tool` step（并行、与该句同步开始；带 agent 卡片）→ `events.function_call` 一对；`∥` 分隔并行调用；`受理 / 进行中` = pending，只出 call；系统行里的长耗时结果按耗时回溯发起时刻 |
| `【记忆】Recall类型｜…；记忆消费｜… · key=value` | `memory` step → `events.memory_call_fast`（含「核对后用」时为 `memory_call`） |
| `【世界信息】场景/状态｜…；信号来源｜…` | `world` step → `dynamic_context.world_signal[]` |
| `【硬件交互】用哪种硬件反馈｜震动 / 闪光 / 边缘灯效·唤醒 / 生卡片 / 音量档·压低 / 无` | 手机震动 / 边缘炫光 / 自动 `edge touch` / 说明卡片 / 该句音量压低 / 仅记录 |
| `【语音·用户】对谁说的｜…；情绪｜…；发声方式｜…；这句之后的停顿｜…；是否重叠｜…` | 写入台词字段 → `fdx_annotation`（打断 / 附和 / 非结束性停顿 / 无关话题语言 / 用户和他人对话…）、`emotion_annotation`、`paralinguistic_annotation` |
| `【语音·助手】助手句性质｜回执（承接…）/ 主动播报 / 接话…` | → `fdx_annotation`（战术性垫句 / 主动开口 / 补话） |
| `【决策点】【对话互动】【自定义】` | 原样保留在 `annotation.track_annotation`，演示时在右侧日志面板逐条显示 |

### UI 指令

```text
@edge touch | double | flash | listen | alert | rec | gflash | on | off
@card icon=car title="Ride Ready" sub="…" eta="3 min" meta="Home → Office|¥18" button="Book Ride" id=ride
@card update=ride title="…" sub="…" meta="…"                 ← 更新已有卡片
@card style=quote title=SpaceX sub="SPCX · NASDAQ" price=428.60 change="+3.20%" up=true
@card style=shot|note icon=screenshot title="已读取当前这一屏" sub="…"
@card … rows=[{"k":"当前租金","v":"¥7,428"},{"k":"可涨到","v":"¥7,800","cls":"cap"}] say="可以直接说的话术"
@card … timer={"from":360,"unit":"","format":"mm:ss"}          ← 卡片倒计时；timer=false 停止
@pill icon=car name="White Sedan" now="3 min" stops="Driver|Home|Office" progress=true theme=green
@pill hide id=call
@call ring 老妈 assist=true wait_ms=4500 | @call connect | @call end
@agent think="…" steps=[{"icon":"loc","doing":"…","done":"…","ms":3200,"tool":"ride.compare","result":"…"}]
@step icon doing done ms                                        ← 单条 agent 步骤
@tool weather.query(本地) result="20℃" elapsed_ms=600 icon=weather doing="…" done="…"
@memory query result kind=memory_call | @backend query result elapsed_ms=14200
@overlay drop | collapse | full | clear | hide  [edge_off=true] [clear=true] [label="…" detail="…"]
@vibrate | @flash | @hardware badge text="已锁门" icon=shield | @hardware none
@banner 悄悄话模式 "· 你轻声说，我只打字"
@rec start from_sec=760 | @rec stop
@transcript open | @split "两人同时开口 · 双路分离"
@article show source="…" title="…" meta="…" body=[{"p":"…"},{"h2":"…"}] hold_ms=2200 | @article hide
@wait 800 | @skip 08:07:10 画面跳过 | @join | @fx ding | @log 标题 详情 | @end 收口
```

复杂参数可以直接给 JSON：`@card {"icon":"doc","title":"…","sections":[…]}`。

---

## 2. script.json

```jsonc
{
  "id": "commute", "case_id": "01", "name": "出门上班", "group": "A · 微意图", "order": 1, "summary": "…",
  "scene": { "title": "…", "desc": "…", "ambience": "scene_commute.m4a", "clock": "07:52:00" },
  "speakers": {
    "user":      { "name": "你",   "tts": { "voice": "ash",   "instructions": "…", "speed": 1.0, "qwen_voice": "Ethan", "local_voice": "zm_010" } },
    "assistant": { "name": "Step", "tts": { "voice": "coral", "instructions": "…" } },
    "driver":    { "name": "司机", "role": "third_party", "tts": { "voice": "onyx" } }
  },
  "context": { "system_prompts": {}, "device_state": {}, "memory": {}, "constraints": {}, "tools": [] },
  "timeline": [ /* steps */ ]
}
```

### say（台词）

| 字段 | 说明 |
| --- | --- |
| `speaker` `text` `id` `clip` | 说话人 key、台词、utterance id（默认 u001…）、音频片段名（默认 = id；`audio/<clip>.wav\|m4a\|mp3`） |
| `clock` `clock_end` | 剧本时钟（story clock） |
| `barge_in` + `at_ms` / `at_ratio` | 打断上一条另一说话人的话；插入点（默认 60%） |
| `backchannel` | 附和 / 伴听：同时开口，对方不停 |
| `parallel` | 开口后不阻塞，后续 step 与之并行（垫场 + 后台查询） |
| `gap_ms` `delay_ms` | 覆盖默认首包间隔（换人 400ms / 同人 300ms） |
| `typed` `whisper` `volume` `no_bubble` `alert` `label` `transcript` `tags` | 打字 / 低语 / 音量 / 不出气泡 / 红色告警标签 / 自定义标签 / 会议转写行 / 转写标签 |
| `to` `kind` `emotion` `voicing` `pause_after` `overlap` `nature` `tone` `fdx` `paralinguistic` | 标注字段（多数由日志自动填充），导出成 annotation |
| `log` `screen` `star` `direction` | 八轨日志 / 屏幕说明 / 特写 / 舞台提示 |

### 其他 step

`section` `edge` `tool` `agent` `memory` `backend` `world` `card` `pill` `call` `hardware` `overlay` `rec` `banner` `transcript` `article` `wait` `skip` `system` `join` `fx` `log` `end` — 字段与上面的指令参数一一对应。通用字段：`parallel`（不阻塞）、`delay_ms`、`anchor: "prev_start"`（从上一条台词 / 系统行开口的时刻起算，用于「边说边查」）、`log`、`screen`、`clock`。

### 时序规则（引擎与 `shared/schedule.js` 一致）

- 换说话人首包 400ms，同人 300ms；`edge touch` 1.7s（嘚嘚 1s + 面板落下 0.7s）
- 打断：目标句在插入点后 0.7s 全音量重叠 → 1.25s 降到 12% → 1.75s 归零
- agent / tool：逐字打出 22ms/字 + 执行时长 + 180ms 收尾；执行 ≥3s 且模型没在说话时铺等待音
- 带按钮的卡片默认等 6s 自动确认；系统行 / 画面跳过停留 0.8s
- 无音频的台词按语速上屏（中文 ~230ms/字），有音频后自动改走真实语音

---

## 3. 导出：Live Interaction Normalized JSON（Draft v5）

`GET /api/cases/<id>/normalized.json` · `npm run export -- <id>` → `cases/<id>/export/json/synthetic/{case_id}_{sample_id}.json` + `audio/synthetic/{case_id}_{sample_id}.wav`

| 规范字段 | 来源 |
| --- | --- |
| `meta_data.sample` | id / name / case_id / case_name / `source_type: synthetic_generation` / `case_spec_ref` |
| `meta_data.media.audio` | 总时长 = 时间轴长度；`tracks`：Channel 1 = 用户 + 第三方，Channel 2 = 助手；附 `clips` 片段清单 |
| `static_context` | `context.system_prompts / device_state / memory / constraints / tools` |
| `dynamic_context.world_signal[]` | `world` step（多数来自【世界信息】日志），带 `time_at_ms` |
| `utterances[]` | 每条 say：`speaker`（user / assistant / third_party）、`speaker_id`、`text`、`start_at_ms / end_at_ms`；扩展：`cut_at_ms`（被打断让位时刻）、`interrupts`、`modality: text`（打字）、`story_clock_ms` |
| `events[]` | `function_call`（call + results 成对，同 `event_id`）、`memory_call / memory_call_fast`（query + result/confidence）、`backend_call` |
| `annotation.fdx_annotation` | 由台词标注推导：打断 / 附和 / 非结束性停顿 / 主动开口 / 战术性垫句 / 补话 / 无关话题语言 / 用户和他人对话 / 他人多人聊天 |
| `annotation.emotion_annotation` `paralinguistic_annotation` | `emotion` / `voicing`（低语、叹气、轻笑、语气词…） |
| `annotation.track_annotation`（扩展） | 八轨日志原文 + 结构化字段 + 时间，供数据检索；模型不消费 |

时间戳全部以混音母带（`audio/synthetic/*.wav`）为准，与演示引擎的实际播放对齐（±0.5s 内）。

## 环境音

`ambience:` / `ambience_prompt:`（头部，开场带入）；正文里 `@ambience file=scene_x.mp3 vol=0.3 fade=1.5 label="…" prompt="纯环境音效，没有旁白和音乐：…"` 在该处切换循环环境音。`prompt` 给火山 seed-audio 生成文件用（`--only ambience`）。
