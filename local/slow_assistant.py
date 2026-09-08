"""Apply pitch-preserving tempo adjustment to assistant speech only."""
import av,base64,io,json,wave,struct
from pathlib import Path
root=Path(__file__).resolve().parent
p=root.parent/'components/audio/clips.json';clips=json.loads(p.read_text())
for key,c in clips.items():
 if not key.startswith('a') or 'tempo' in c:continue
 source=av.open(io.BytesIO(base64.b64decode(c['src'].split(',')[1])))
 graph=av.filter.Graph();frames=iter(source.decode(audio=0));first=next(frames)
 head=graph.add('abuffer',f'sample_rate={first.sample_rate}:sample_fmt={first.format.name}:channel_layout=mono:time_base=1/{first.sample_rate}');last=head
 rates=[.5,c['duration']/1.5/.5] if key=='a0' else [.9]
 for rate in rates:
  nxt=graph.add('atempo',str(rate));last.link_to(nxt);last=nxt
 sink=graph.add('abuffersink');last.link_to(sink);graph.configure()
 samples=[]
 def drain():
  while True:
   try:samples.append(sink.pull().to_ndarray().reshape(-1))
   except (av.error.BlockingIOError,av.error.EOFError):break
 head.push(first);drain()
 for frame in frames:head.push(frame);drain()
 head.push(None);drain()
 import numpy as np
 data=np.concatenate(samples)
 if data.dtype.kind=='f':data=np.clip(data*32768,-32768,32767).astype('<i2')
 else:data=data.astype('<i2')
 buf=io.BytesIO()
 with wave.open(buf,'wb') as f:f.setnchannels(1);f.setsampwidth(2);f.setframerate(first.sample_rate);f.writeframes(data.tobytes())
 raw=buf.getvalue();(root/'audio'/f'{key}.wav').write_bytes(raw)
 c['src']='data:audio/wav;base64,'+base64.b64encode(raw).decode();c['duration']=len(data)/first.sample_rate
 step=max(1,len(data)//200);c['peaks']=[round(float(np.max(np.abs(data[i:i+step].astype(float))))/32768,4) for i in range(0,len(data),step)]
 c['tempo']=.9 if key!='a0' else c['duration']/1.5
p.write_text(json.dumps(clips))
print('Assistant speech slowed to 0.9× with pitch preserved; humming extended.')
