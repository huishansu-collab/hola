export type CaseViewport={mode:'fit'|'custom';scale:number;scrollMs:number};
export const viewportStorageKey='track-studio-case-viewports-v1';
export function readViewports(raw:string|null):Record<string,CaseViewport>{
 try{
  const value=JSON.parse(raw??'{}');
  if(!value||typeof value!=='object'||Array.isArray(value))return {};
  return Object.fromEntries(Object.entries(value).filter((entry):entry is [string,CaseViewport]=>{
   const v=entry[1] as CaseViewport|null;
   return !!v&&(v.mode==='fit'||v.mode==='custom')&&Number.isFinite(v.scale)&&v.scale>0&&Number.isFinite(v.scrollMs)&&v.scrollMs>=0;
  }));
 }catch{return {}}
}
export function resolveViewport(saved:CaseViewport|undefined,width:number,durationMs:number):CaseViewport{
 const min=width/(durationMs/1000);
 const mode=saved?.mode??'custom';
 const scale=mode==='fit'?min:Math.max(min,Math.min(Math.max(700,min),saved?.scale??210));
 const maxScroll=Math.max(0,durationMs-width/scale*1000);
 return {mode,scale,scrollMs:mode==='fit'?0:Math.min(maxScroll,saved?.scrollMs??0)};
}
