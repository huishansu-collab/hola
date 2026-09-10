# Case 工具字典

版本：3。MCP能力发现统一命名mcps.search，参数query保持兼容；显示变量继续使用无类型缩写的英文snake_case。用途：持续维护 Case 的统一工具名称、参数语义、结果与编排边界。下列名称和调用意图来自用户；结构化参数与返回信息为 Case 模拟约定，不代表真实服务 SDK 或已安装可执行工具。真实接口接入时以已验证契约映射，差异须明确记录。

## 是否需要工具

查汉字、读音、字义、词义、拼写、造句等模型凭已有知识即可可靠解决的问题，直接回答。没有`dictionary.search()`这样的工具，不创建同名或类似的虚构模拟工具。需要实时信息、外部资料、私有数据或核实不确定内容时才使用实际可用能力。查询与展示分别判断；文字学习场景默认使用 `ui.show_card` 展示专用卡片，遵循[文字学习场景的专用卡片](interaction.md#文字学习场景的专用卡片)。无需查询不能作为删除卡片的理由；确实没有查询、展示或其他工具动作时，工具轨道才留空。

## 工具标题与参数变量

所有工具的显示标题必须列出所需参数，采用含义明确、全小写下划线分隔的英文snake_case变量。不使用驼峰命名、匈牙利命名或str_、obj_、arr_等类型缩写；不要使用无意义的缩写。以下规则替代旧显示习惯，适用于全部工具。

- `memory.get(user_frequent_addresses_key)`：该变量绑定“用户常用地址”；偏好查询可用`memory.get(coffee_preferences_key)`。
- `location.match(current_location, user_frequent_addresses)`：位置与上游地址数组均为变量。
- `ui.show_card(payment_card_id, payment_card_type, payment_card_title, source_event_id, payment_card_content)`。
- `tools.check_order_status(order_id)`。

标题不直接展开字符串字面量、对象或数组。真实参数值、schema及请求/返回继续保存在结构化数据中，另存每次调用的变量→参数字段→实际值映射。不要把变量名字符串当成真实参数值传入。真正无参数的`location.current()`可保留空括号；需要关联播放实例的`audio.stop(playback_event_id)`不能显示为无参数。

字典下文的引号内容是参数取值说明，不是界面标题格式；最终标题必须转换为上述变量表示。确保标题被交付包保留并经实际导入验证，不能只改JSON而在界面仍显示空括号。

地点匹配通常先执行`memory.get(user_frequent_addresses_key)`，独立获取`location.current()`；两者返回后按跨轨道400 ms依赖窗口安排判断和匹配，匹配数组必须与上游记忆返回一致。保存地址不能代替实时定位。

## 工具说明速览

这套工具集统一交互 Case 的工具名称、参数含义和执行边界，后续持续补充。调用方式是 Case 编排约定，不表示真实服务已接入。下表用于快速理解，后面的清单保留时间窗口，参数章节保留具体契约。

| 工具 | 参数说明 | 用途与返回信息 |
| --- | --- | --- |
| memory.get(label) | preference：用户偏好；locations：保存地点 | 读取出行偏好、家或公司等记忆；保存地点不等于当前位置。 |
| location.current() | 无 | 获取当前位置，返回地址、经纬度等可用信息。 |
| location.match(current_location, user_frequent_addresses) | 待匹配地点描述、候选地点集合 | 找到用户所指地点；存在歧义时需确认。 |
| ui.show_card(...) | 卡片标识、类型、标题、内容及查询来源事件 | 显示或更新卡片；相同标识更新已有卡片。 |
| audio.play(sound) | 音效名称，如 loading | 开始播放，记录实例及实际开始时间。 |
| audio.stop() | 脚本可省略参数，底层明确关联播放实例 | 停止此前已启动音效，记录实际停止时间；禁止单独出现。 |
| web_search(query) | 搜索内容 | 返回候选结果、摘要及可用来源；不等于已读全部网页。 |
| weather.query(location, date) | 地点、日期 | 返回天气和温度，区分实时温度与全天最高／最低温。 |
| mcps.search(capability_query) | 所需MCP服务或工具能力描述 | 返回候选能力及已知配置／授权状态，不代表已执行业务。 |
| amap.route(location, destination, way) | 起点、终点、方式，如 driving | 返回路线、距离和预计行程时间。 |
| didi.book(type, location, destination) | 车辆／服务类型、上车点、目的地 | 返回订单标识及受理／派单状态，车型按实际约定。 |

## 编排要点

- 先明确输入、返回和依赖：读取保存地点后再匹配“公司”，确定起终点后再规划路线或叫车。
- 查询结果可用后，助手讲解可与卡片显示并行；引用屏幕内容时须等其可见。
- 音效按 audio.play → audio.stop 配对，关联同一 Case 中的同一播放实例。预计播放时长与调用耗时分开记录。
- 打车止于订单派出，不把受理表述成司机接单、车辆到达或行程完成。
- living_edge.double_tap 是世界输入，不是助手工具；悄悄话模式仅显示文字，不播放语音或 Loading。
- 工具轨道保存请求、返回、发生时间和依赖，同次调用使用同一 event_id；模拟数据标记 simulated。

## 使用与维护

- 新建或修改 Case 时先从本字典选择工具，不为同一能力随意新增别名。现有 Case 不自动改名或迁移。
- 此处调用写法用于脚本阅读；标准数据中 query 为结构化参数对象的 JSON 字符串，static_context.tools 仅列该 Case 实际调用的工具，并提供相符的 parameters schema。
- 工具请求和返回共用 event_id，映射工具轨道，并记录真实依赖。未调用的工具不为凑完整性写入 Case。
- 模拟返回明确标记 simulated；实际执行不能以本字典代替接口认证、能力核验或业务授权。没有结果时不编造成功。
- 时间范围引用 interaction.md 的工具窗口，均为模拟预算。播放命令受理耗时、音效播放时长和任务执行耗时分别记录；不能把一次播放的 3 秒当作 audio.play 接口耗时。
- 后续新增工具时维护名称、参数、返回、时间类别和依赖边界；变更既有参数语义时递增版本并说明兼容映射。未定义参数枚举不自行固定成真实服务支持列表。

## 工具清单

初始 9 组、11 个工具；新增订单状态查询后共 12 个工具。

| 工具 | 脚本调用示例 | 作用 | 常规模拟窗口（秒） |
| --- | --- | --- | --- |
| memory.get | memory.get(user_preferences_key) / memory.get(user_frequent_addresses_key) | 读取记忆字段 | 0.3–1 |
| location.current | location.current() | 获取当前定位 | 1–3（初始模拟建议；已有可靠缓存可缩短） |
| location.match | location.match(current_location, user_frequent_addresses) | 从候选地点中匹配用户所指位置 | 本地匹配 0.3–1；需要联网检索 1–3 |
| ui.show_card | ui.show_card(...) | 展示或更新卡片 | 新卡 1–2；更新 0.8–1.5 |
| audio.play | audio.play(loading_sound) | 启动指定音效 | 命令受理 0.2–0.6（初始模拟建议）；播放区间另计 |
| audio.stop | audio.stop(playback_event_id) | 停止对应音效 | 命令受理 0.2–0.6（初始模拟建议）；记录实际停声 |
| web_search | web_search(query) | 网络搜索并返回结果 | 1.5–4 |
| weather.query | weather.query(location, date) | 查询指定地点、日期的天气 | 0.8–2.5 |
| mcps.search | mcps.search(capability_query) | 发现与任务匹配的MCP能力 | 0.8–2.5（按简单网络查询初始编排） |
| amap.route | amap.route(current_location, destination, travel_mode) | 计算路线 | 1–3 |
| didi.book | didi.book(type, location, destination) | 提交叫车并派出订单 | 1–3，止于派单受理 |

定位、音频命令与连接器发现的专属范围是本版补充的初始模拟建议，可按后续用户反馈更新；其他范围沿用已确认窗口。较慢情况、并行原则、等待表达和异步边界参见 [交互展开](interaction.md)。

## 参数和结果约定

### memory.get

- 参数：label，当前支持 preference、locations，保持用户指定的单数 preference，不改成 preferences。
- 返回：对应标签下的记忆内容或空结果。preference 表示偏好；locations 表示保存的地点集合。
- 依赖：需要“家”“公司”或已存偏好时读取；不能把保存地点当作当前实时位置。

### location.current

- 参数：无。
- 返回：当前地点信息；可包含名称、地址、经纬度、定位时间和精度，缺失信息不补造。
- 依赖：确定实时起点时使用；当前位置吻合不代表已确认具体上车点或出口。

### location.match

- 参数：value（用户给出的地点名称、描述或待匹配位置），list（实际已有的候选地点数组）。
- 返回：匹配结果、候选项或无匹配／歧义状态；有歧义时不能强行选定。
- 依赖：list 来自 memory.get 或其他工具时，等待候选返回再匹配。匹配不代替当前定位。

### ui.show_card

- 参数：沿用当前 Case 约定的 card_id、card_type、title、content；卡片内容来自实际查询结果时带 source_event_id；模型直接回答的卡片不伪造查询来源。重复 card_id 表示更新同一卡片。
- 返回：卡片标识与显示／更新状态，实际可见时刻作为完成依据。
- 依赖：先有相应结果再格式化显示。助手回答可与渲染并行；引用“屏幕上这个”则须等内容可见。

### audio.play / audio.stop

- play 参数：sound，当前已明确的音效名称为 loading；其他音效须有实际资产后扩充。预计播放时长按当前项目契约记录。
- play 返回：播放实例或可关联的播放事件、实际开始时刻。
- stop 的脚本简写可为 audio.stop()；标准数据须明确 playback_event_id 或项目对应的播放实例字段，不得存在停止对象歧义。
- stop 返回：停止状态与实际 stopped_at_ms。并非执行命令后瞬时停声。
- 强制配对：每个 audio.stop 都必须对应同一 Case 中此前已出现且已启动的 audio.play，明确关联同一个播放实例。工具轨道顺序必须先 play 后 stop；不允许单独出现 stop，也不能引用 Case 外未记录的播放。
- 依赖：停止时间晚于对应播放启动，依赖记录指向该播放。Loading 与助手语音前后至少隔 400 ms；悄悄话模式禁止新增播放，已有播放需停止时仍保留前面的 play 记录。

### web_search

- 参数：query（搜索文字）。
- 返回：搜索结果条目，可包含标题、摘要、来源链接；模拟数据不编造真实来源链接。
- 依赖：搜索返回不等于完成网页全文阅读。需要额外读取工具时先扩充字典，不把搜索结果冒充已读正文。

### weather.query

- 参数：location（明确地点），date（目标日期）。“今天”等相对日期按 Case 日期、时区解析，并保留解释依据。
- 返回：对应地点和日期的天气与温度，明确单位、查询时间；实时温度与全天最高／最低温分开。
- 依赖：用户未给地点且没有可靠上下文时，先获取或确认地点。

### mcps.search

- 显示调用：`mcps.search(capability_query)`；品牌场景使用`mcps.search(luckin_ordering_capability_query)`等表意变量。
- 参数：query，所需MCP服务或工具能力描述；显示变量绑定实际查询值，不将变量名当作查询内容。
- 返回：候选服务标识、目标品牌或业务支持范围、可调用能力，以及已知连接状态和授权状态。未知状态如实保留。
- 时间：常规模拟0.8–2.5秒，按简单网络查询；可与独立位置和偏好读取并行。
- 依赖：发现不代表已授权、已连接或已执行业务。确认支持范围和可用状态后，再按400 ms依赖窗口选择并执行；后续业务调用关联所选服务。
- 命名迁移：此前用于MCP发现的`connectors.search()`统一改为`mcps.search()`，同步字典、示例、事件、参数显示和依赖引用；参数字段query保持兼容。只在创建或明确修订相关Case时迁移，不批量改写无关旧Case。
- 这是Case工具契约约定，不宣称存在同名通用标准接口；真实执行须映射到实际可用的能力发现接口。不得因该命名规则虚构已安装服务。

### amap.route

- 参数：location（起点），destination（终点），way（方式）；用户指定的 way--driving 表达规范化为对象字段 way: "driving"。其他方式暂不设固定枚举。
- 返回：路线选项、距离、预计行程时间和必要导航信息。
- 依赖：起终点已解析后计算；路线计算耗时与行程时间分开。此工具不提交叫车订单。

### didi.book

- 参数：type（用户选择的车辆／服务类型），location（上车点），destination（目的地）。type 的支持枚举以后续确认或真实接口为准。
- 返回：订单标识、已受理／已派单状态；失败或待确认据实返回。
- 依赖：必要参数与用户叫车意图明确后执行。Case 止于订单派出，不包含司机接单、车辆到达或行程完成，也不将派单成功说成司机已接单。

## 世界信号的独立归属

living_edge.double_tap 属于世界信号，规则见 interaction.md；不列为助手可调用工具，不因维护工具字典而赋予其 tool_name。模式引起的停播可另行调用 audio.stop。

## tools.check_order_status

- 脚本调用：tools.check_order_status(order_id)。
- 参数：order_id，当前已创建订单的标识。
- 返回：订单状态、商家接单或订单确认状态，以及可用的最新预计送达信息；未确认、失败、取消据实表达。
- 时间：按简单网络查询，常规模拟 0.8–2.5 秒，较慢 2.5–5 秒。
- 依赖：外卖／购物支付流程中收到关联订单的支付成功回调后查询。支付成功不代替接单确认；查询结果可用后可并行更新卡片和口头反馈。
- 这是 Case 工具约定，不声明真实服务已接入；业务流程见 [支付确认规则](payment.md)。
