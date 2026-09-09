# coding: utf-8
"""Generate one full-dialogue master; never synthesize individual regions."""
import os,sys,json,base64,subprocess
from pathlib import Path
root=Path(__file__).resolve().parent/(sys.argv[1] if len(sys.argv)>1 else '')
response=root/'audio'/'master-response.json'
response.parent.mkdir(parents=True,exist_ok=True)
subprocess.run(['curl','-sS','--max-time','300','https://openspeech.bytedance.com/api/v3/tts/create','-H','@'+os.environ['SEED_AUTH_FILE'],'-H','Content-Type: application/json','--data-binary','@'+str(root/'master-request.json'),'-o',str(response)],check=True)
d=json.loads(response.read_text())
if not d.get('audio'):
    # 接口没给音频时，把它自己的错误码和说明打出来——不打印请求体，凭据不会进日志。
    detail={k:v for k,v in d.items() if k in ('code','message','error','reqid','Message','BaseResp')}
    raise RuntimeError(f'TTS did not return audio: {json.dumps(detail,ensure_ascii=False)[:400]}')
(root/'audio'/'session-master.mp3').write_bytes(base64.b64decode(d['audio']))
print(f'Generated full-dialogue master in {root}; align its transcript before cutting.')
