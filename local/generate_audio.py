# coding: utf-8
"""Generate one full-dialogue master; never synthesize individual regions."""
import os,sys,json,base64,subprocess
from pathlib import Path
root=Path(__file__).resolve().parent/(sys.argv[1] if len(sys.argv)>1 else '')
response=root/'audio'/'master-response.json'
subprocess.run(['curl','-sS','--max-time','300','https://openspeech.bytedance.com/api/v3/tts/create','-H','@'+os.environ['SEED_AUTH_FILE'],'-H','Content-Type: application/json','--data-binary','@'+str(root/'master-request.json'),'-o',str(response)],check=True)
d=json.loads(response.read_text())
if not d.get('audio'):raise RuntimeError('TTS did not return audio')
(root/'audio'/'session-master.mp3').write_bytes(base64.b64decode(d['audio']))
print(f'Generated full-dialogue master in {root}; align its transcript before cutting.')
