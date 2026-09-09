import {useEffect,useRef,useState} from 'react';
import data from './clips.json';
import actorData from './actor-clips.json';
import rideData from './ride-clips.json';
import coffeeData from './coffee-clips.json';
import smsData from './sms-clips.json';
import gmailRuntime from '../../case-packages/gmail/build/runtime.json';
const gmailData=Object.fromEntries(Object.entries(gmailRuntime.audio).map(([id,clip])=>[`package/gmail/${id}`,clip]));
export type RealClip={a:number;b:number;audioKey?:string;fadeMs?:number;loop?:boolean;gainPoints?:[number,number][]};
export const audioClips={...data,...actorData,...rideData,...coffeeData,...smsData,...gmailData} as Record<string,{src:string;start:number;duration:number;peaks:number[];sourceStart?:number;sourceEnd?:number;source?:string}>;
export function useTimelineAudio(clips:RealClip[],pos:number,playing:boolean){
 const players=useRef<Map<string,HTMLAudioElement>>(new Map());
 const [error,setError]=useState('');
 useEffect(()=>()=>{players.current.forEach(a=>{a.pause();a.src=''});players.current.clear()},[]);
 useEffect(()=>{
  const active=new Set<string>();
  for(const clip of clips){const key=clip.audioKey;if(!key||!audioClips[key])continue;
   let player=players.current.get(key);
   if(!player){player=new Audio(audioClips[key].src);player.preload='auto';player.preservesPitch=true;players.current.set(key,player)}
   const source=audioClips[key];const end=clip.loop?clip.b:Math.min(clip.b,clip.a+source.duration*1000);
   if(!playing||pos<clip.a||pos>=end)continue
   active.add(key);
   player.playbackRate=1;player.loop=!!clip.loop;
   const target=source.start+(clip.loop?((pos-clip.a)/1000)%source.duration:(pos-clip.a)/1000);
   if(player.paused||Math.abs(player.currentTime-target)>.5)player.currentTime=target;
   let volume=1;
   if(clip.gainPoints){const points=clip.gainPoints;volume=points[0][1];for(let i=1;i<points.length;i++){const [t,v]=points[i],prev=points[i-1];if(pos<t){volume=prev[1]+(v-prev[1])*Math.max(0,(pos-prev[0])/(t-prev[0]));break}volume=v}}
   player.volume=clip.fadeMs?Math.max(0,Math.min(1,(clip.b-pos)/clip.fadeMs)):volume;
   if(player.paused)void player.play().catch(()=>setError('音频播放未能启动，请重新点击播放。'));
  }
  players.current.forEach((p,k)=>{if(!active.has(k))p.pause()});
 },[pos,playing,clips]);
 return error;
}
