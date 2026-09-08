"""Embed original-speed dialogue cuts for a named Case."""
import base64,io,json,wave,struct,sys
from pathlib import Path
root=Path(__file__).resolve().parent/sys.argv[1]
with wave.open(str(root/'audio/session-master.wav')) as f:
 rate=f.getframerate();channels=f.getnchannels();raw=struct.unpack('<'+'h'*(f.getnframes()*channels),f.readframes(f.getnframes()))
samples=[round(sum(raw[i:i+channels])/channels) for i in range(0,len(raw),channels)]
cuts=json.loads((root/'audio-cuts.json').read_text());out={}
for cut in cuts:
 a,b=cut['start'],cut['end'];assert 0<=a<b<=len(samples)/rate
 x=samples[round(a*rate):round(b*rate)];buf=io.BytesIO()
 with wave.open(buf,'wb') as f:
  f.setnchannels(1);f.setsampwidth(2);f.setframerate(rate);f.writeframes(struct.pack('<'+'h'*len(x),*x))
 step=max(1,len(x)//200)
 out[cut['id']]={'src':'data:audio/wav;base64,'+base64.b64encode(buf.getvalue()).decode(),'start':0,'duration':len(x)/rate,'sourceStart':a,'sourceEnd':b,'source':sys.argv[1]+'-session-master.mp3','peaks':[round(max(map(abs,x[i:i+step]),default=0)/32768,4) for i in range(0,len(x),step)]}
(root.parent.parent/'components/audio'/f'{sys.argv[1]}-clips.json').write_text(json.dumps(out))
print(sys.argv[1],len(out),'original-speed cuts embedded')
