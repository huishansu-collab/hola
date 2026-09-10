标题 培训中低声点一杯奶茶
分组 B 下单与支付
目标 培训进行中不方便出声，用户压着嗓子让助手点一杯瑞幸茉莉花奶茶送到公司
边界 订单已创建、金额与预计送达已反馈，并引导用户点卡片付款；点击支付与支付回调不在本 Case 内
说明 语音待生成；时间按字数估算，配音后按录音重排。用户全程耳语，助手轻声跟着走。

// 一、听清要什么：任务是饮品下单，品牌是瑞幸，商品用用户的原话，不改成「咖啡」。
用户 帮我点一杯瑞幸的茉莉花奶茶。 [低语] [培训中压着嗓子，语速偏慢]
判断 任务：饮品下单；品牌：瑞幸；商品沿用原话「茉莉花奶茶」，不归类成订咖啡 [时长 800]

// 二、边等边说一句，后台四件事同时开跑：位置、常用地址、偏好、下单能力。
助手 嗯……我看一下瑞幸这边。 [垫句] [慢说] [跟着耳语压低音量，不外放]
工具 loc: location.current() => district=朝阳区, place_name=创研中心, accuracy_m=25 [时长 800] [取当前位置]
工具 addr: memory.get(key=user_frequent_addresses_key) => positions=["公司","家","健身房"] [时长 800] [并行] [读记忆里的常用地址]
工具 pref: memory.get(key=drink_preferences_key) => value=null, status=not_recorded [时长 800] [并行] [没记过偏好就如实返回，不编]
工具 mcp: mcps.search(capability_query=支持瑞幸饮品报价与建单的服务) => selected_connector_id=sim_luckin_delivery, connection_status=connected, authorization_status=authorized [时长 2000] [并行] [先确认有这个能力，再谈下单]
判断 当前位置对上常用地址里的「公司」；偏好没记录，不编；选中已连接已授权的瑞幸下单能力 [依赖 loc,addr,pref,mcp] [时长 800]
工具 quote: delivery.quote(product=茉莉花奶茶, address_label=公司, connector_id=sim_luckin_delivery) => quote_id=q_5512, price_cny=12, eta_min=30 [依赖 mcp] [时长 1600]

// 三、下单前先跟人对一遍：商品、地点。卡片同时铺开，语音不等卡片。
助手 好的，一杯瑞幸茉莉花奶茶，送到公司，对吧？ [依赖 quote] [轻声，句尾上扬，等一个确认]
工具 card: ui.show_card(card_id=order_confirm_1, card_type=order_confirm, source_event_id=quote, content_summary=茉莉花奶茶 x1 / 公司 / 12 元 / 约 30 分钟) [依赖 quote] [时长 1200] [确认卡片：商品、地址、金额、预计送达、支付按钮]
用户 是的。 [低语]

// 四、口头确认只覆盖下单：建单和卡片同时走，付款仍旧要用户自己点。
助手 好，这就下单。 [垫句] [不等] [轻声一句，只表示收到，不宣布成功]
判断 用户口头确认的是订单内容，不是支付；建单可以走，付款按钮仍要用户自己点 [时长 800]
工具 order: delivery.create_order(quote_id=q_5512, address_label=公司, connector_id=sim_luckin_delivery, confirmation=voice) => order_id=LK20260910_0417, status=created_pending_payment, amount_cny=12, eta_min=30 [依赖 quote] [时长 2400]
工具 confirm: ui.update_card(card_id=order_confirm_1, status=confirmed_by_voice) [依赖 card] [时长 1000] [并行] [卡片按语音自动确认，不需要用户去点确认]
判断 订单已创建、待支付；金额与预计送达按返回值播报，接单与配送不在本 Case 内 [依赖 order] [时长 800]
工具 pay: ui.update_card(card_id=order_confirm_1, status=pending_payment, amount_cny=12, eta_min=30) [依赖 order] [时长 1200] [卡片转成待支付，付款按钮亮起]
助手 下好了，一共十二块，大概三十分钟送到。付款点一下卡片就行。 [依赖 order] [轻声收住，不催]
