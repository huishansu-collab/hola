import {audioClips, type RealClip} from './use-timeline-audio';
export type SpeechClip=RealClip & {role:'user'|'assistant'};
export type Synthesis={key:string;wav:Blob;peaks:number[][];durationMs:number;sampleRate:number};
const memory=new Map<string,Synthesis>();
async function database(){return new Promise<IDBDatabase>((resolve,reject)=>{const r=indexedDB.open('track-studio-synthesis-v1',1);r.onupgradeneeded=()=>r.result.createObjectStore('audio',{keyPath:'key'});r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error)})}
async function cached(key:string){if(memory.has(key))return memory.get(key);try{const db=await database();return await new Promise<Synthesis|undefined>((resolve,reject)=>{const t=db.transaction('audio');const r=t.objectStore('audio').get(key);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);t.oncomplete=()=>db.close()})}catch{return undefined}}
async function save(value:Synthesis){memory.set(value.key,value);try{const db=await database();await new Promise<void>((resolve,reject)=>{const t=db.transaction('audio','readwrite');t.objectStore('audio').put(value);t.oncomplete=()=>{db.close();resolve()};t.onerror=()=>{db.close();reject(t.error)}})}catch{/* Current session remains usable when storage is unavailable. */}}
export async function synthesisKey(caseId:string,durationMs:number,clips:SpeechClip[]){const text=JSON.stringify({version:1,caseId,durationMs,clips:clips.map(c=>({...c,source:audioClips[c.audioKey??'']}))});const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text));return caseId+':'+Array.from(new Uint8Array(bytes),v=>v.toString(16).padStart(2,'0')).join('')}
export function encodeWav(channels:Float32Array[],rate:number){const frames=channels[0].length,buf=new ArrayBuffer(44+frames*4),v=new DataView(buf);const str=(n:number,s:string)=>{for(let i=0;i<s.length;i++)v.setUint8(n+i,s.charCodeAt(i))};str(0,'RIFF');v.setUint32(4,buf.byteLength-8,true);str(8,'WAVE');str(12,'fmt ');v.setUint32(16,16,true);v.setUint16(20,1,true);v.setUint16(22,2,true);v.setUint32(24,rate,true);v.setUint32(28,rate*4,true);v.setUint16(32,4,true);v.setUint16(34,16,true);str(36,'data');v.setUint32(40,frames*4,true);for(let i=0;i<frames;i++)for(let c=0;c<2;c++){const x=Math.max(-1,Math.min(1,channels[c][i]));v.setInt16(44+i*4+c*2,Math.round(x*(x<0?32768:32767)),true)}return new Blob([buf],{type:'audio/wav'})}
export async function synthesize(caseId:string,durationMs:number,clips:SpeechClip[]):Promise<Synthesis>{
 const key=await synthesisKey(caseId,durationMs,clips),hit=await cached(key);if(hit)return hit;
 if(!clips.length)throw new Error('这个 Case 还没有可合成的语音。');
 const rate=48000,frames=Math.round(durationMs*rate/1000),channels=[new Float32Array(frames),new Float32Array(frames)];
 const context=new OfflineAudioContext(1,1,rate),decoded=new Map<string,AudioBuffer>();
 for(const clip of clips){const source=audioClips[clip.audioKey??''];if(!source)throw new Error('语音文件缺失，请先生成这个 Case 的语音。');let audio=decoded.get(source.src);if(!audio){const r=await fetch(source.src);if(!r.ok)throw new Error('语音文件读取失败，请重试。');audio=await context.decodeAudioData(await r.arrayBuffer());decoded.set(source.src,audio)}
  const start=Math.round(clip.a*rate/1000),length=Math.min(Math.round((clip.b-clip.a)*rate/1000),Math.round(source.duration*rate),frames-start),offset=Math.round(source.start*rate);
  if(offset+length>audio.length+2)throw new Error('语音文件长度与时间线不一致，请检查音频。');
  const out=channels[clip.role==='user'?0:1];
  for(let i=0;i<length;i++){const time=clip.a+i/rate*1000;let gain=1;if(clip.gainPoints?.length){const p=clip.gainPoints;gain=p[0][1];for(let j=1;j<p.length;j++){if(time<p[j][0]){gain=p[j-1][1]+(p[j][1]-p[j-1][1])*Math.max(0,(time-p[j-1][0])/(p[j][0]-p[j-1][0]));break}gain=p[j][1]}}if(clip.fadeMs)gain=Math.max(0,Math.min(1,(clip.b-time)/clip.fadeMs));let sample=0;for(let c=0;c<audio.numberOfChannels;c++)sample+=audio.getChannelData(c)[offset+i]??0;out[start+i]+=sample/audio.numberOfChannels*gain}
 }
 // A shared gain keeps channel balance intact if overlapping clips exceed full scale.
 let max=1;for(const ch of channels)for(const value of ch)max=Math.max(max,Math.abs(value));if(max>1)for(const ch of channels)for(let i=0;i<ch.length;i++)ch[i]/=max;
 const peaks=channels.map(ch=>Array.from({length:2000},(_,i)=>{let max=0;for(let j=Math.floor(i*frames/2000);j<Math.floor((i+1)*frames/2000);j++)max=Math.max(max,Math.abs(ch[j]));return max}));
 const result={key,wav:encodeWav(channels,rate),peaks,durationMs,sampleRate:rate};await save(result);return result;
}
// Standard USTAR archive, generated locally without recompressing PCM audio.
export async function tarFiles(files:{name:string;blob:Blob}[]){
 const parts:BlobPart[]=[],encoder=new TextEncoder();
 for(const file of files){
  const header=new Uint8Array(512),name=encoder.encode(file.name);
  if(name.length>100||!file.name||file.name.includes('/')||file.name.includes('\\'))throw new Error('Invalid archive filename');
  const text=(offset:number,value:string)=>header.set(encoder.encode(value),offset);
  const octal=(offset:number,length:number,value:number)=>{const digits=value.toString(8);if(digits.length>length-1)throw new Error('Archive file too large');text(offset,digits.padStart(length-1,'0')+'\0')};
  header.set(name);octal(100,8,0o644);octal(108,8,0);octal(116,8,0);octal(124,12,file.blob.size);octal(136,12,Math.floor(Date.now()/1000));
  header.fill(32,148,156);text(156,'0');text(257,'ustar\0');text(263,'00');
  const checksum=header.reduce((sum,byte)=>sum+byte,0);text(148,checksum.toString(8).padStart(6,'0')+'\0 ');
  parts.push(header,file.blob);
  const padding=(512-file.blob.size%512)%512;if(padding)parts.push(new Uint8Array(padding));
 }
 parts.push(new Uint8Array(1024));return new Blob(parts,{type:'application/x-tar'});
}
