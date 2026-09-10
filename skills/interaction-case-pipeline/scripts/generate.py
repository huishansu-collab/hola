import sys,json,base64,subprocess
from pathlib import Path
request,auth,output=map(Path,sys.argv[1:])
response=output.with_suffix('.response.json')
output.parent.mkdir(parents=True,exist_ok=True)
if output.exists():raise SystemExit('Use a new staging output, do not overwrite a working master.')
subprocess.run(['curl','--fail-with-body','-sS','--max-time','300','https://openspeech.bytedance.com/api/v3/tts/create','-H','@'+str(auth),'-H','Content-Type: application/json','--data-binary','@'+str(request),'-o',str(response)],check=True)
d=json.loads(response.read_text())
if not d.get('audio'):raise SystemExit('No audio returned; inspect response privately before retrying.')
output.write_bytes(base64.b64decode(d['audio'],validate=True))
print('Master generated:',output,'duration:',d.get('duration'))
