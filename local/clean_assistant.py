"""Reduce stationary room noise for assistant cuts only; preserve sample timing."""
import wave
from pathlib import Path
import numpy as np
root=Path(__file__).resolve().parent
with wave.open(str(root/'audio/session-master.wav')) as f:
 params=f.getparams();rate=f.getframerate();x=np.frombuffer(f.readframes(f.getnframes()),dtype='<i2').reshape(-1,params.nchannels).mean(axis=1)
n=1024;hop=256;win=np.hanning(n);profile=x[int(2.5*rate):int(2.9*rate)]
noise=np.mean([np.abs(np.fft.rfft(profile[i:i+n]*win))**2 for i in range(0,len(profile)-n,hop)],axis=0)
z=np.pad(x,(n,n));out=np.zeros_like(z);weight=np.zeros_like(z)
for i in range(0,len(z)-n,hop):
 s=np.fft.rfft(z[i:i+n]*win);p=np.abs(s)**2
 gain=np.maximum(.015,1-3*noise/(p+1e-8))
 gain=np.convolve(gain,[.2,.6,.2],mode='same')
 out[i:i+n]+=np.fft.irfft(s*gain)*win;weight[i:i+n]+=win**2
out=(out/np.maximum(weight,1e-9))[n:n+len(x)]
with wave.open(str(root/'audio/assistant-clean.wav'),'wb') as f:
 f.setnchannels(1);f.setsampwidth(2);f.setframerate(rate);f.writeframes(np.clip(out,-32768,32767).astype('<i2').tobytes())
print('Assistant noise reduction complete; duration preserved.')
