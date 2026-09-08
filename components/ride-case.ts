import type {Scenario} from '../app/page';
import {grid,voice,block,interruption,expression,sound,toolPair,finish} from './scenario-utils';
export function createRideCase():Scenario{
 const u0=voice('ride_u0',0,'现在回家堵不堵车？');
 const homeAt=grid(u0.b+400)+400,homeEnd=homeAt+1200,gpsAt=homeEnd,gpsEnd=gpsAt+1200,savedAt=gpsEnd,savedEnd=savedAt+400,matchAt=savedEnd,matchEnd=matchAt+400,routeAt=matchEnd+400,routeEnd=routeAt+8000;
 const a0=voice('ride_a0',homeAt,'嗯，等一下，我看看。');a0.expression=0;
 const a1=voice('ride_a1',grid(Math.max(routeEnd+400,a0.b+400)),'现在打车回家大概要四十五分钟，有点堵。');
 const a2=voice('ride_a2',grid(a1.b),'要不要现在帮你[丢弃：叫一辆车]',0);a2.fadeMs=120;
 const u1=voice('ride_u1',a2.b-400,'叫一辆快车。',0);
 const decisionAt=grid(u1.b+400),a3=voice('ride_a3',decisionAt+400,'好的，这就叫。');
 const bookAt=grid(a3.b),bookEnd=bookAt+10000,cardAt=bookEnd+400;
 const a4=voice('ride_a4',cardAt,'车叫到了，白色比亚迪，尾号六八二一，预计三分钟到，预估车费五十八元。');
 const users=[u0,u1],assistants=[a0,a1,a2,a3,a4];
 const events=[interruption(0,u1,a2,'要不要现在帮你叫一辆车？','叫一辆车',['用户明确要求叫快车','淡出后停止提议，让出话权','听完整句，确认车型和回家目的地','使用已确认的公司上车点，提交模拟订单'])];
 const expressions=[expression(a0,'拖音 · 0.85 倍速 · 战术性垫句','获取家庭地址与实时位置')];
 const firstSound=sound(gpsAt,routeEnd+400,[...users,...assistants]),bookingSound=sound(bookAt,bookEnd+400,[...users,...assistants]);
 bookingSound.sub='接单等待 10 秒，收到结果后淡出 400 毫秒；提前完成或失败时停止';
 bookingSound.gainPoints=[[bookAt,0],[bookAt+120,.35],[bookEnd,.35],[bookEnd+400,0]];
 const order={simulated:true,status:'司机已接单',vehicle:'白色比亚迪',plate:'沪AD6821（模拟）',driver:'李师傅（模拟）',eta_minutes:3,pickup:'已确认的公司上车点（模拟）',destination:'家（模拟地址）',estimated_fare_cny:58,fare_note:'预估费用，最终以实际结算为准',actions:['联系司机','查看车辆位置','取消订单']};
 const tracks:Scenario['tracks']=[
 {name:'用户',en:'音频',color:'green',clips:users},
 {name:'助手',en:'实际播出',color:'blue',clips:assistants},
 {name:'表达控制',en:'拖音与慢说',color:'purple',clips:expressions.map((e,i)=>({...e,expression:i,sub:e.delivery}))},
 {name:'后台判断',en:'意图与上下文',color:'amber',clips:[block(400,grid(u0.b),'逐步识别回家路况查询'),block(homeAt-400,homeAt,'确认需要家庭地址与当前位置'),block(homeEnd,gpsAt+400,'家庭地址已获取 · 决定读取 GPS'),block(gpsEnd,savedAt+400,'读取已记录地点及标签'),block(matchEnd,routeAt,'已匹配公司 · 路线使用实时 GPS','在公司不等于上车出口；本例另有已确认上车点'),block(routeEnd,a1.a,'路线返回 · 预计 45 分钟，部分拥堵','路线和路况为模拟数据'),block(grid(u1.a),grid(u1.b),'收听叫车要求 · 暂不提交',undefined,0),block(decisionAt,a3.a,'确认快车、回家目的地与已确认上车点','本例已授权；缺少上车点时应先补问'),block(bookEnd,cardAt,'司机已接单 · 核对车辆与费用','只有接单后才说“车叫到了”')]},
 {name:'播报控制',en:'音效与播报',color:'pink',clips:[firstSound,block(grid(u1.a),Math.max(grid(u1.a)+400,grid(a2.b)),'淡出 → 停止',`控制窗口至少 400 毫秒；尾部淡出 120 毫秒，实际停止于 ${Math.round(a2.b)} 毫秒`,0),bookingSound]},
 {name:'工具调用',en:'模拟请求与结果',color:'teal',clips:[block(homeAt,homeEnd,'memory.get("home")','返回已保存家庭地址（模拟）'),block(gpsAt,gpsEnd,'gps.get_location()','实时位置（模拟）'),block(savedAt,savedEnd,'memory.get_saved_positions()','已记录的公司、家及标签（模拟）'),block(matchAt,matchEnd,'position.match(gps, saved_positions)','at_office · 与已确认上车点分开'),block(routeAt,routeEnd,'amap.route(gps, home, driving)','8,000 毫秒 · 预计 45 分钟，部分路段拥堵'),block(bookAt,bookEnd,'ride.book(快车, 公司上车点, 家)','10,000 毫秒 · 等待司机接单；非下单即成功'),block(cardAt,cardAt+400,'information_card.show(order)','模拟订单：李师傅 · 白色比亚迪 · 沪AD6821 · 3 分钟到达 · 预估 ¥58；最终以实际结算为准。操作：联系司机、查看车辆位置、取消订单。')]},
 {name:'回复计划',en:'完整回复内容',color:'purple',clips:assistants.map((a,i)=>block(a.a,a.b,i===2?events[0].plan:a.label))},
 {name:'回复修订',en:'丢弃与抑制',color:'pink',clips:[{...block(grid(a2.b),grid(a2.b)+400,'丢弃：叫一辆车','承接用户授权，停止重复提议',0),muted:true}]}
 ];
 return finish(tracks,events,expressions,[...toolPair('ride_home','memory.get',homeAt,homeEnd,'home',{address:'家庭地址（模拟）',simulated:true}),...toolPair('ride_gps','gps.get_location',gpsAt,gpsEnd,'获取当前位置',{position_ref:'demo_office_gps',simulated:true}),...toolPair('ride_saved','memory.get_saved_positions',savedAt,savedEnd,'读取已保存地点',{positions:['公司','家'],simulated:true}),...toolPair('ride_match','position.match',matchAt,matchEnd,'匹配 GPS 与已保存地点',{match:'at_office',confirmed_pickup:'公司上车点（模拟）',simulated:true}),...toolPair('ride_route','amap.route',routeAt,routeEnd,'origin=gps, destination=home, mode=driving',{duration_minutes:45,traffic:'部分路段拥堵',simulated:true}),...toolPair('ride_booking','ride.book',bookAt,bookEnd,'快车；已确认公司上车点 → 家',order),...toolPair('ride_card','information_card.show',cardAt,cardAt+400,'展示完整模拟订单',order),...toolPair('ride_loading_route','audio.play',firstSound.a,firstSound.b,'路况查询等待音效',{status:'completed',duration_ms:firstSound.b-firstSound.a}),...toolPair('ride_loading_booking','audio.play',bookAt,bookEnd+400,'等待接单 10000 毫秒，结果返回后淡出 400 毫秒',{status:'completed',wait_ms:10000,fade_out_ms:400})]);
}
