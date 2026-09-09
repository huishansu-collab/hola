import type {RuntimeCase} from '../lib/case-package/index.ts';
// 构建产物用 glob 收:往 case-packages/ 里加一个包,重新构建就出现在界面里,
// 不用再回来手写一条 import。planned 包没有音频,runtime.audio 是空的。
const modules=import.meta.glob('../case-packages/*/build/runtime.json',{eager:true,import:'default'}) as Record<string,RuntimeCase>;
export const packageRuntimes=Object.values(modules)
 .sort((a,b)=>String(a.manifest.case_id).localeCompare(String(b.manifest.case_id)));
export const packageFiles=packageRuntimes.map(r=>({
 id:String(r.manifest.case_id),name:String(r.manifest.title),group:String(r.manifest.group??'')}));
