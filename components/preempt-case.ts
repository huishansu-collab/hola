import type {Scenario} from '../app/page';
import {createJsonCase,type RawCase} from './json-case';
import data from './cases/preempt/case.json';
import timeline from './cases/preempt/timeline.json';

// The assistant takes the floor because what the user is still saying has been
// made moot: the seats are gone. Reason first, then the alternative, then the
// floor goes straight back. The half-finished sentence is never completed.
export function createPreemptCase():Scenario {
 return createJsonCase(data as unknown as RawCase,timeline,[
  {t:8400,end:9200,name:'主动打断',title:'查到无票，抢话先给理由',quote:'打断一下，今晚七点以后的票卖完了。',tag:'助手打断',note:'依据 7,600 到达，8,400 起声；用户 9,200 停声，未说完的半句不补全。',overlap:[8400,9200]},
  {t:11600,end:15200,name:'给替代',title:'打断必须带可行方案',note:'说完立即交回话语权，不追问车厢偏好。'},
  {t:17600,end:18800,name:'沿用已说完的偏好',title:'靠窗沿用，被打断段不沿用',note:'完整说出且未撤回的偏好沿用；被打断那段没说完，不沿用。'},
 ]);
}
