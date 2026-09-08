import base64,io,json,wave,struct,math
from pathlib import Path
root=Path(__file__).resolve().parent
with wave.open(str(root/'audio/session-master.wav')) as f:r=f.getframerate();c=f.getnchannels();v=struct.unpack('<'+'h'*(f.getnframes()*c),f.readframes(f.getnframes()))
x=[round(sum(v[i:i+c])/c) for i in range(0,len(v),c)]
cuts=[('actor_u0',2.35,5.16),('actor_intro',5.38,8.06),('actor_a0',10.55,12.10),('actor_u1',14.78,17.43),('actor_a1',19.14,20.50),('actor_u2',22.00,24.34),('actor_a2',24.42,26.46),('actor_a3',27.26,30.02),('actor_u3',31.43,32.232)]
out={}
def pack(key,samples,rate,**meta):
 buf=io.BytesIO()
 with wave.open(buf,'wb') as f:f.setnchannels(1);f.setsampwidth(2);f.setframerate(rate);f.writeframes(struct.pack('<'+'h'*len(samples),*samples))
 step=max(1,len(samples)//200)
 out[key]=dict(src='data:audio/wav;base64,'+base64.b64encode(buf.getvalue()).decode(),start=0,duration=len(samples)/rate,peaks=[round(max(map(abs,samples[i:i+step]),default=0)/32768,4) for i in range(0,len(samples),step)],**meta)
 (root/'audio'/f'{key}.wav').write_bytes(buf.getvalue())
for key,a,b in cuts:pack(key,x[round(a*r):round(b*r)],r,sourceStart=a,sourceEnd=b,source='actor-session-master.mp3')
rate=24000
samples=[round(1600*(math.sin(math.pi*(i/rate)/.3)**2 if i/rate<.3 else 0)*(math.sin(2*math.pi*440*i/rate)+.3*math.sin(2*math.pi*660*i/rate))) for i in range(int(1.5*rate))]
pack('actor_loading',samples,rate)
(root/'audio-cuts.json').write_text(json.dumps([dict(id=k,start=a,end=b) for k,a,b in cuts],indent=2))
(root.parent.parent/'components/audio/actor-clips.json').write_text(json.dumps(out))
print('9 original-speed dialogue cuts packaged.')
