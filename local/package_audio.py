# coding: utf-8
"""Cut every region from a single master, using reviewed source timestamps."""
import base64,io,json,struct,wave
from pathlib import Path
root=Path(__file__).resolve().parent
with wave.open(str(root/'audio/session-master.wav')) as f:
 rate=f.getframerate();channels=f.getnchannels();raw=f.readframes(f.getnframes())
values=struct.unpack('<'+'h'*(len(raw)//2),raw)
mono=[round(sum(values[i:i+channels])/channels) for i in range(0,len(values),channels)]
out={}
for clip in json.loads((root/'audio-cuts.json').read_text()):
 start,end=clip['start'],clip['end'];samples=mono[round(start*rate):round(end*rate)]
 assert samples and end>start
 buf=io.BytesIO()
 with wave.open(buf,'wb') as f:
  f.setnchannels(1);f.setsampwidth(2);f.setframerate(rate);f.writeframes(struct.pack('<'+'h'*len(samples),*samples))
 content=buf.getvalue();(root/'audio'/f"{clip['id']}.wav").write_bytes(content)
 step=max(1,len(samples)//200)
 peaks=[round(max(map(abs,samples[i:i+step]),default=0)/32768,4) for i in range(0,len(samples),step)]
 out[clip['id']]={'src':'data:audio/wav;base64,'+base64.b64encode(content).decode(),'start':0,'duration':len(samples)/rate,'peaks':peaks,'sourceStart':start,'sourceEnd':end,'source':'session-master.mp3'}
(root.parent/'components/audio/clips.json').write_text(json.dumps(out))
print('Cut',len(out),'clips from one master')
