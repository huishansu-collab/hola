export const caseTags=['explicit','implicit','hf'] as const;
export type CaseTag=typeof caseTags[number];
export type CaseFile={id:string;name:string;tags?:CaseTag[]};
export type Directory={id:string;name:string;cases:CaseFile[]};
export type CaseDrop={folderId:string;caseId?:string;edge?:'before'|'after'};
export function moveCase(directories:Directory[],caseId:string,target:CaseDrop):Directory[]{
 const file=directories.flatMap(f=>f.cases).find(c=>c.id===caseId);
 const destination=directories.find(f=>f.id===target.folderId);
 if(!file||!destination||target.caseId===caseId)return directories;
 if(target.caseId&&!destination.cases.some(c=>c.id===target.caseId))return directories;
 return directories.map(f=>{
  const cases=f.cases.filter(c=>c.id!==caseId);
  if(f.id===target.folderId){
   const index=target.caseId?cases.findIndex(c=>c.id===target.caseId)+(target.edge==='after'?1:0):cases.length;
   cases.splice(index,0,file);
  }
  return {...f,cases};
 });
}
