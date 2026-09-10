import {useEffect,useRef,useState} from 'react';
import data from './clips.json';
import actorData from './actor-clips.json';
import rideData from './ride-clips.json';
import coffeeData from './coffee-clips.json';
import smsData from './sms-clips.json';
import {packageRuntimes} from '../case-packages';
// Case 包的音频按 `package/<id>/<utterance>` 注册，与 packageToScenario 生成的
// audioKey 一致。漏注册的后果是静默无声：播放循环里查不到 key 就直接跳过——
// 所以这里收全部包，新配音的 Case 不用回来补一行 import。
const packageData=Object.fromEntries(packageRuntimes.flatMap(
 r=>Object.entries(r.audio).map(([id,clip])=>[`package/${r.manifest.case_id}/${id}`,clip])));
export type RealClip={audioEnd?:number;a:number;b:number;audioKey?:string;fadeMs?:number;loop?:boolean;gainPoints?:[number,number][]};
export const audioClips={...data,...actorData,...rideData,...coffeeData,...smsData,...packageData} as Record<string,{src:string;start:number;duration:number;peaks:number[];sourceStart?:number;sourceEnd?:number;source?:string}>;
export function useTimelineAudio(clips:RealClip[],pos:number,playing:boolean){
 const players=useRef<Map<string,HTMLAudioElement>>(new Map());
 const [error,setError]=useState('');
 useEffect(()=>()=>{players.current.forEach(a=>{a.pause();a.src=''});players.current.clear()},[]);
 useEffect(()=>{
  const active=new Set<string>();
  for(const clip of clips){const key=clip.audioKey;if(!key||!audioClips[key])continue;
   let player=players.current.get(key);
   if(!player){player=new Audio(audioClips[key].src);player.preload='auto';player.preservesPitch=true;players.current.set(key,player)}
   const source=audioClips[key];const end=clip.loop?clip.b:Math.min(clip.audioEnd??clip.b,clip.a+source.duration*1000);
   if(!playing||pos<clip.a||pos>=end)continue
   active.add(key);
   player.playbackRate=1;player.loop=!!clip.loop;
   const target=source.start+(clip.loop?((pos-clip.a)/1000)%source.duration:(pos-clip.a)/1000);
   if(player.paused||Math.abs(player.currentTime-target)>.5)player.currentTime=target;
   let volume=1;
   if(clip.gainPoints){const points=clip.gainPoints;volume=points[0][1];for(let i=1;i<points.length;i++){const [t,v]=points[i],prev=points[i-1];if(pos<t){volume=prev[1]+(v-prev[1])*Math.max(0,(pos-prev[0])/(t-prev[0]));break}volume=v}}
   player.volume=clip.fadeMs?Math.max(0,Math.min(1,((clip.audioEnd??clip.b)-pos)/clip.fadeMs)):volume;
   if(player.paused)void player.play().catch(()=>setError('音频播放未能启动，请重新点击播放。'));
  }
  players.current.forEach((p,k)=>{if(!active.has(k))p.pause()});
 },[pos,playing,clips]);
 return error;
}
