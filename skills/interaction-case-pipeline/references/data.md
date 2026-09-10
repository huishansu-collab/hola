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

## 纯文字回复与外部模式信号的适配边界

上文 Utterances、speech clip 和 alignment 的关联约定描述当前语音源包。悄悄话模式需要助手轨道的明确文字输出类型，不能直接给现有 speech clip 去掉音频后当作支持。按当前项目契约补齐文字片段、校验、播放器与导入导出支持，文字回复不需要音频切点或波形，禁止伪造静音 WAV。文字片段的起止时间表示显示窗口，不是录音时长。用户仍可提供真实whisper语音，不能因助手纯文字而删除用户音频。

living_edge.double_tap 是外部世界事件，不填写虚构 tool_name；若信号触发 audio.stop，则停播调用另记工具 Events 并关联实际播放实例。外部信号引起的停声不能套用要求用户语音重叠的 interruption 数据伪造一段用户语音。

表达控制及对应 fdx 标注仅关联助手；用户说话特征不进入 expression 轨道。Loading 是独立音效资产与工具播放事件，不是 Utterance。

工具名称与参数语义优先查阅[工具字典](tools.md)。它是 Case 模拟约定，不代替当前项目结构校验或真实服务接口；需要映射时明确记录差异。

## 显示参数与依赖记录

工具标题由表意英文snake_case变量构成，禁止类型缩写前缀和直接展开实际值；保存逐调用变量绑定映射及真实query，不改真实工具字段契约。标准source/1的tool clip仍仅引用event_id，不违规添加label。通过播放器派生标题或用snapshot/1保留标题，同时携带完整source/；不能将带参数标题塞入tool_name。

跨轨道依赖记录需覆盖判断、世界和用户控制，不能仅检查tool_dependencies。适配器未支持混合事件引用时，以独立依赖清单保存前后片段ID、开始/结束时间和间隔，并验证与标准数据一致。所有非人工片段起点对齐400 ms，每条跨轨道依赖至少间隔400 ms。
