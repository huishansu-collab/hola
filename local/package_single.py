from pathlib import Path
import re,json,zipfile
root=Path(__file__).resolve().parents[1]
dist=root/'local-dist'
html=(dist/'index.html').read_text()
script=re.search(r'<script[^>]+src="([^"]+)"[^>]*></script>',html)
style=re.search(r'<link[^>]+href="([^"]+\.css)"[^>]*>',html)
assert script and style
js=(dist/script[1].removeprefix('./')).read_text().replace('</script','<\\/script')
css=(dist/style[1].removeprefix('./')).read_text().replace('</style','<\\/style')
html=html.replace(script[0],'<script type="module">'+js+'</script>').replace(style[0],'<style>'+css+'</style>')
assert not re.search(r'<script[^>]+src=|<link[^>]+href=',html)
out=root.parent/'Track Studio Local'
out.mkdir(exist_ok=True)
(out/'Track Studio.html').write_text(html)
(out/'README.txt').write_text('Track Studio — Local prototype\n\nDouble-click Track Studio.html to open it in a browser.\nNo server, installation, or internet connection is required.\n\nControls\n- Drag on the timeline to select a range.\n- Zoom controls change the shared time scale.\n- Click Interrupt 01 / 02 / Revision 03 to focus an event.\n- Click a region to inspect its annotations.\n- Space plays or pauses the synthesized audio and playhead.\n\nFont: PingFang SC, Light (300). Uses the system font on macOS;\nother systems fall back to a sans-serif font. No font files are bundled.\n\nCases with generated audio use a complete dialogue, cut at original speed. The coffee Case includes generated speech and loading audio at original speed. Its hum is shorter than the requested target; the UI reports that limitation. Source timestamps are saved with each Case.\nAudio and measured waveform peaks are embedded for offline playback.\nAudio plays at its original speed from its timeline start; silence follows shorter clips. Discarded content is silent.\nInterruption timing remains an annotation prototype, not a measured system latency.\n\nDesign reference: Logic Pro main window\nhttps://support.apple.com/guide/logicpro/logic-pro-main-window-lgcp2a07a994/mac\n\nSource build: npm install, then npm run build:local.\nThe local build uses vite.local.config.ts and does not deploy to a cloud service.\n')
with zipfile.ZipFile(out/'Track Studio Source.zip','w',zipfile.ZIP_DEFLATED) as z:
 for item in ['app','components','lib','hooks','local','public','scripts','case-packages','docs','README.md','package.json','package-lock.json','tsconfig.json','vite.local.config.ts','next.config.ts','components.json']:
  p=root/item
  for f in ([p] if p.is_file() else p.rglob('*')):
   if not f.is_file():continue
   rel=f.relative_to(root)
   if 'build' in rel.parts or 'node_modules' in rel.parts or '__pycache__' in rel.parts:continue
   if 'response' in f.name.lower() or f.name.startswith('.env') or f.suffix=='.pem':continue
   if f.suffix=='.wav' and rel.parts[0]!='case-packages':continue
   z.write(f,'track-studio/'+str(rel))
 z.write(out/'README.txt','track-studio/README.txt')
print(out/'Track Studio.html')
print('Standalone HTML bytes:',len(html.encode()))
