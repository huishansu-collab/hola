# 当前源包与标准数据

先检查仓库 `docs/case-package-v1.md`、`lib/case-package/index.ts`。不要把旧 Skill 的辅助 schema 直接写入当前源包。

源包目录：manifest.json、brief.md、script.md、case.json、timeline.json、generation/alignment.json、generation/requests/、audio/sources/。构建产物放 build/，源文件与生成文件分开。

UUID v7 由仓库 `npm run case:id --silent` 生成。manifest.case_id 与 case.meta_data.sample.case_id 一致，名称同样一致。重复构建不改 ID。标题、文件夹和内容指纹都不作为 ID。

case.json 的根字段为 meta_data、static_context、dynamic_context、utterances、events、fdx_annotation、emotion_annotation、paralinguistic_annotation、custom_annotation。

- Meta 总时长为 Case 时间线总长，未知身份字段留 null。不恢复旧 preferences 树。audio.tracks 为 Channel 1/user、Channel 2/assistant。
- static_context.tools 与当前实际 Events 工具名一一对应、去重。每个工具用 function 的 name、description、parameters 描述真实参数。
- Utterances 使用 id、speaker、speaker_id、text、start_at_ms、end_at_ms，毫秒为整数。不输出 sample_seg_id，不把等待音效或丢弃文字当对白。用户的同一完整句不按 400 ms 切片。
- 同次工具调用请求/返回共用 event_id，按 time_at_ms 排序。当前 CLI 的 query 是包含结构化参数的 JSON 字符串；results/result 为对应结果，类型依照当前校验器。返回不能出现在依赖完成前。
- 用户操作、世界信号、平台回传按实际事件类型表示；无工具调用的事件不伪造 tool_name。
- Annotation UI 名称沿用 Annotation。fdx_annotation 默认为垫句、慢说；打断不在其中。情绪、副语言和 custom 默认空数组，按明确需求扩展。

timeline.schema_version 为 1，固定七轨 ID 顺序：user、control、assistant、expression、world、reasoning、tools。

- speech clip：kind=speech、utterance_id，文本和时间从 Utterances 派生。
- tool clip：kind=tool、event_id、可选 description，名称和时间从 Events 派生。
- state/action/world/expression clip：按当前 schema 提供 label、start_at_ms、end_at_ms 与可选 lane/description。同轨并发分 lane。
- response_links 关联真实回应；interruptions 保存打断边界、真实有声起点与 discarded_text；tool_dependencies 保存 event_id 和 depends_on。
- 不在 speech/tool clip 再复制 label 和起止时间。多处同时维护易造成漂移。

alignment.schema_version 为 1，clips 对每个 utterance_id 指向相对 source 路径及 source_start_ms/source_end_ms。来源为本次真实母带；区间长度匹配实播区间。不能把旧母带切点套到新录音。

当前 source/1 CLI 使用 48 kHz、16 bit PCM WAV，只构建语音。网站 snapshot/1 ZIP 可以保留旧 Case 的 Loading 音频与七轨完整状态。需要在新源包中加入当前适配器不支持的非语音播放资产时，先完成相应适配并验证；不能静默删掉资产，也不能把“通过语音校验”当作完整交付。
