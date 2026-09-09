# coding: utf-8
"""Generate one full-dialogue master; never synthesize individual regions."""
import os,sys,json,base64,subprocess
from pathlib import Path
root=Path(__file__).resolve().parent/(sys.argv[1] if len(sys.argv)>1 else '')
response=root/'audio'/'master-response.json'
response.parent.mkdir(parents=True,exist_ok=True)
def ask(request_file):
    subprocess.run(['curl','-sS','--max-time','300','https://openspeech.bytedance.com/api/v3/tts/create','-H','@'+os.environ['SEED_AUTH_FILE'],'-H','Content-Type: application/json','--data-binary','@'+str(request_file),'-o',str(response)],check=True)
    return json.loads(response.read_text())

d=ask(root/'master-request.json')
plain=root/'master-request-plain.json'
if not d.get('audio') and plain.exists():
    # 文本审核偶尔会拒掉带逐句读法的那版；退到只有节奏说明的备用请求再试一次。
    print(f'{root.name}: 带读法的请求被拒（{d.get("code")} {d.get("message")}），改用备用请求',file=sys.stderr)
    d=ask(plain)
if not d.get('audio'):
    # 接口没给音频时，把它自己的错误码和说明打出来——不打印请求体，凭据不会进日志。
    detail={k:v for k,v in d.items() if k in ('code','message','error','reqid','Message','BaseResp')}
    raise RuntimeError(f'TTS did not return audio: {json.dumps(detail,ensure_ascii=False)[:400]}')
(root/'audio'/'session-master.mp3').write_bytes(base64.b64decode(d['audio']))
print(f'Generated full-dialogue master in {root}; align its transcript before cutting.')
