import type {Scenario} from '../app/page';
import {createJsonCase,type RawCase} from './json-case';
import data from './cases/retry/case.json';
import timeline from './cases/retry/timeline.json';

// A timeout is an error, not an answer: the assistant retries once, then says
// which data it fell back to instead of presenting history as live traffic.
export function createRetryCase():Scenario {
 return createJsonCase(data as unknown as RawCase,timeline,[
  {t:4400,end:7600,name:'首次超时',title:'路况服务 3.2 秒超时',note:'工具返回错误，不当作“不堵”；错误标记 retryable。'},
  {t:8000,end:11200,name:'重试失败',title:'第二次仍然超时',note:'按策略只重试一次，不无限重试，也不编造实时数据。'},
  {t:13200,end:21600,name:'降级播报',title:'用历史记录估算并说明来源',note:'播报中明确数据来自历史通勤记录，实时路况仍然缺失。'},
 ]);
}
