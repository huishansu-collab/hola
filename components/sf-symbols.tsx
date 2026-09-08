import symbols from "./sf-symbols.json";
import type { CSSProperties } from "react";
type Props = {size?:number; className?:string};
function symbol(name:keyof typeof symbols){return function Symbol({size=18,className=""}:Props){return <svg aria-hidden="true" width={size+4} height={size+4} viewBox="0 0 24 24" className={className} style={{flexShrink:0}}><foreignObject width="24" height="24"><span style={{display:"block",width:24,height:24,backgroundColor:"currentColor",maskImage:`url(${symbols[name]})`,WebkitMaskImage:`url(${symbols[name]})`,maskSize:"contain",WebkitMaskSize:"contain"} as CSSProperties}/></foreignObject></svg>}}
export const ArrowRight=symbol("ArrowRight");
export const AudioLines=symbol("AudioLines");
export const Brackets=symbol("Brackets");
export const Check=symbol("Check");
export const ChevronRight=symbol("ChevronRight");
export const Clock3=symbol("Clock3");
export const Crosshair=symbol("Crosshair");
export const Flag=symbol("Flag");
export const Info=symbol("Info");
export const MousePointer2=symbol("MousePointer2");
export const PanelLeftClose=symbol("PanelLeftClose");
export const PanelLeftOpen=symbol("PanelLeftOpen");
export const Pause=symbol("Pause");
export const Play=symbol("Play");
export const ScanLine=symbol("ScanLine");
export const SkipBack=symbol("SkipBack");
export const SlidersHorizontal=symbol("SlidersHorizontal");
export const X=symbol("X");
export const ZoomIn=symbol("ZoomIn");
export const ZoomOut=symbol("ZoomOut");

export const Code=symbol("Code");

export const Folder=symbol("Folder");
export const Document=symbol("Document");
export const Plus=symbol("Plus");

export const FolderOpen=symbol("FolderOpen");
export const NewCase=symbol("NewCase");

export const Download=symbol("Download");
