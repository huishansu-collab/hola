import type {Scenario} from '../app/page';
import {createJsonCase,type RawCase} from './json-case';
import data from './cases/clarify/case.json';
import timeline from './cases/clarify/timeline.json';

// Two ambiguous references in one sentence. Candidates are fetched to make the
// question concrete, and both gaps are closed in a single turn.
export function createClarifyCase():Scenario {
 return createJsonCase(data as unknown as RawCase,timeline,[
  {t:3600,end:6800,name:'指代歧义',title:'“那个文件”和“他”都不唯一',note:'两处指代都不唯一，先取候选再提问，不默认最近一次。'},
  {t:6800,end:13200,name:'一次问清',title:'把两处歧义合并成一次提问',note:'文件与收件人在同一轮问清，避免连续追问。'},
  {t:17600,end:18400,name:'补全后发送',title:'指代唯一后才发送',note:'补全前不发送；以发送返回为准，不以提示音为准。'},
 ]);
}
