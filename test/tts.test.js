import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ttsPlan, buildSpeechRequest, buildQwenRequest, synthesizeSpeech, clipHash, wavDurationMs, PROVIDERS } from '../shared/tts.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const commute = JSON.parse(fs.readFileSync(path.join(ROOT, 'cases/commute/script.json'), 'utf8'));

function fakeWav(ms, sr = 24000) {
  const n = Math.round(sr * ms / 1000);
  const buf = Buffer.alloc(44 + n * 2);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + n * 2, 4); buf.write('WAVE', 8); buf.write('fmt ', 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22); buf.writeUInt32LE(sr, 24); buf.writeUInt32LE(sr * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34); buf.write('data', 36); buf.writeUInt32LE(n * 2, 40);
  return buf;
}

test('ttsPlan:逐句计划带音色、instructions 与稳定的缓存键', () => {
  const plan = ttsPlan(commute);
  assert.equal(plan.length, 8);
  assert.deepEqual(plan.map(p => p.clip), ['a0', 'q1', 'a1a', 'a1', 'q2', 'a2', 'a3', 'a4']);
  const a0 = plan.find(p => p.clip === 'a0'), q1 = plan.find(p => p.clip === 'q1');
  assert.equal(a0.voice, 'coral'); assert.equal(q1.voice, 'ash');
  assert.match(a0.instructions, /女性/); assert.match(q1.instructions, /男性/);
  assert.equal(a0.hash.length, 16);
  assert.equal(a0.hash, ttsPlan(commute).find(p => p.clip === 'a0').hash, '同一输入哈希稳定');
  assert.notEqual(a0.hash, ttsPlan(commute, { model: 'tts-1' }).find(p => p.clip === 'a0').hash, '换模型换键');
  assert.notEqual(clipHash({ model: 'm', voice: 'v', speed: 1, instructions: '', text: 'a' }), clipHash({ model: 'm', voice: 'v', speed: 1, instructions: '', text: 'b' }));
});

test('buildSpeechRequest:gpt-4o-mini-tts 带 instructions,tts-1 不带', () => {
  const item = { model: 'gpt-4o-mini-tts', voice: 'coral', text: '我在，你说。', speed: 1, instructions: '温暖松弛' };
  const a = buildSpeechRequest(item);
  assert.deepEqual(a, { model: 'gpt-4o-mini-tts', voice: 'coral', input: '我在，你说。', response_format: 'wav', speed: 1, instructions: '温暖松弛' });
  const b = buildSpeechRequest({ ...item, model: 'tts-1' });
  assert.equal(b.instructions, undefined);
});

test('synthesizeSpeech:5xx 重试后成功,401 直接抛,鉴权头正确', async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    if (calls.length === 1) return new Response('boom', { status: 500 });
    return new Response(fakeWav(1200), { status: 200 });
  };
  const item = { model: 'gpt-4o-mini-tts', voice: 'ash', text: '几点了？', speed: 1, instructions: 'x' };
  const ab = await synthesizeSpeech(item, { apiKey: 'sk-test', fetchImpl, sleepMs: 1 });
  assert.equal(calls.length, 2);
  assert.equal(calls[0].url, 'https://api.openai.com/v1/audio/speech');
  assert.equal(calls[0].init.headers.Authorization, 'Bearer sk-test');
  assert.equal(JSON.parse(calls[0].init.body).input, '几点了？');
  assert.equal(wavDurationMs(ab), 1200);
  await assert.rejects(() => synthesizeSpeech(item, { apiKey: 'sk-bad', fetchImpl: async () => new Response('nope', { status: 401 }), sleepMs: 1 }), /401/);
  await assert.rejects(() => synthesizeSpeech(item, { apiKey: '' }), /key/);
});

test('wavDurationMs:读头不解码', () => {
  assert.equal(wavDurationMs(fakeWav(3500)), 3500);
  assert.equal(wavDurationMs(Buffer.from('not a wav file at all, definitely not')), null);
});

test('ttsPlan(qwen):按角色默认音色、缓存键与 OpenAI 不同、无 instructions', () => {
  const plan = ttsPlan(commute, { provider: 'qwen' });
  assert.equal(plan.length, 8);
  const a0 = plan.find(p => p.clip === 'a0'), q1 = plan.find(p => p.clip === 'q1');
  assert.equal(a0.provider, 'qwen'); assert.equal(a0.model, 'qwen3-tts-flash');
  assert.equal(a0.voice, 'Cherry'); assert.equal(q1.voice, 'Ethan');
  assert.equal(a0.instructions, ''); assert.equal(a0.speed, 1);
  assert.notEqual(a0.hash, ttsPlan(commute).find(p => p.clip === 'a0').hash, '换引擎换键');
  assert.equal(a0.hash, ttsPlan(commute, { provider: 'qwen' }).find(p => p.clip === 'a0').hash, '同一输入稳定');
  const third = ttsPlan({ ...commute, speakers: { ...commute.speakers, 司机: { name: '司机', role: 'third_party' } }, timeline: [...commute.timeline, { type: 'say', speaker: '司机', text: '走辅路吧' }] }, { provider: 'qwen' });
  assert.equal(third.at(-1).voice, PROVIDERS.qwen.defaults.third[0], '第三方默认北京话');
  assert.deepEqual(buildQwenRequest(a0), { model: 'qwen3-tts-flash', input: { text: a0.text, voice: 'Cherry' } });
});

test('synthesizeSpeech(qwen):POST 拿 url → GET wav;非 wav 报错;429 重试', async () => {
  const calls = [];
  const wav = fakeWav(800);
  const fetchImpl = async (url, init) => {
    calls.push({ url, method: init?.method || 'GET' });
    if (url.endsWith('/generation')) {
      if (calls.filter(c => c.method === 'POST').length === 1) return new Response('busy', { status: 429 });
      const body = JSON.parse(init.body);
      assert.equal(body.model, 'qwen3-tts-flash'); assert.equal(body.input.voice, 'Cherry');
      assert.equal(init.headers.Authorization, 'Bearer sk-qwen');
      return new Response(JSON.stringify({ output: { audio: { url: 'https://dashscope-result.example/x.wav', expires_at: 1 }, finish_reason: 'stop' } }), { status: 200 });
    }
    return new Response(wav, { status: 200 });
  };
  const item = { provider: 'qwen', model: 'qwen3-tts-flash', voice: 'Cherry', text: '我在,你说。' };
  const ab = await synthesizeSpeech(item, { apiKey: 'sk-qwen', fetchImpl, sleepMs: 1 });
  assert.equal(wavDurationMs(ab), 800);
  assert.equal(calls[0].url, 'https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation');
  assert.equal(calls.filter(c => c.method === 'POST').length, 2, '429 后重试一次');
  /* base64 直传 */
  const inline = await synthesizeSpeech(item, { apiKey: 'k', sleepMs: 1, fetchImpl: async () => new Response(JSON.stringify({ output: { audio: { data: wav.toString('base64') } } }), { status: 200 }) });
  assert.equal(wavDurationMs(inline), 800);
  /* 返回的不是 wav */
  await assert.rejects(() => synthesizeSpeech(item, { apiKey: 'k', sleepMs: 1, fetchImpl: async (url) => url.endsWith('/generation') ? new Response(JSON.stringify({ output: { audio: { url: 'https://x/y.mp3' } } })) : new Response(Buffer.from('ID3 not wav at all')) }), /不是 wav/);
  /* DashScope 200 但带错误码 */
  await assert.rejects(() => synthesizeSpeech(item, { apiKey: 'k', sleepMs: 1, fetchImpl: async () => new Response(JSON.stringify({ code: 'InvalidParameter', message: 'voice not found' })) }), /InvalidParameter/);
});

/* ---------- 火山 seed-audio:整段生成 + 静音切分 ---------- */
import { buildVolcPrompt, volcPersona, moodPrefix, VOLC_PERSONAS } from '../shared/tts.js';
import { silenceRegions } from '../server/audio.js';
import { generateCaseAudio } from '../server/tts.js';

/* 合成母带:n 段 0.9s 的 440Hz 正弦,段间 1.4s 静音(48kHz 单声道 wav) */
function burstsWav(n, { sr = 48000, tone = 0.9, gap = 1.4 } = {}) {
  const total = Math.round(sr * (0.5 + n * (tone + gap)));
  const pcm = new Int16Array(total);
  for (let k = 0; k < n; k++) {
    const s0 = Math.round(sr * (0.5 + k * (tone + gap)));
    for (let i = 0; i < Math.round(sr * tone); i++) pcm[s0 + i] = Math.round(8000 * Math.sin(2 * Math.PI * 440 * i / sr));
  }
  const buf = Buffer.alloc(44 + pcm.length * 2);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + pcm.length * 2, 4); buf.write('WAVE', 8); buf.write('fmt ', 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22); buf.writeUInt32LE(sr, 24); buf.writeUInt32LE(sr * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34); buf.write('data', 36); buf.writeUInt32LE(pcm.length * 2, 40);
  for (let i = 0; i < pcm.length; i++) buf.writeInt16LE(pcm[i], 44 + i * 2);
  return { buf, pcm };
}

test('volc:定妆描述与整段 prompt', () => {
  const s = { speakers: { user: { role: 'user' }, assistant: { role: 'assistant' }, 司机: { role: 'third_party', tts: { instructions: '四十多岁的出租车司机，热情健谈' } }, 妈: { role: 'third_party', tts: { instructions: '五十多岁的女性，温柔' } } } };
  assert.equal(volcPersona(s, 'user'), VOLC_PERSONAS.user);
  assert.equal(volcPersona(s, 'assistant'), VOLC_PERSONAS.assistant);
  assert.match(volcPersona(s, '司机'), /^安静的室内，没有背景音乐，没有旁白。男子（四十多岁的出租车司机，热情健谈）$/);
  assert.match(volcPersona(s, '妈'), /女子（五十多岁的女性，温柔）/);
  const p = buildVolcPrompt({ persona: VOLC_PERSONAS.assistant, lines: [{ text: '我在，你说。' }, { text: '行了行了！', mood: moodPrefix({ direction: '抢话，与 AI 语音重叠' }) }] });
  assert.match(p, /她依次说了下面两句话，每句之间停顿两秒以上，只念引号里的内容：\n“我在，你说。”\n用打断对方、略带决断的语气说：“行了行了！”$/);
  assert.equal(moodPrefix({ whisper: true }), '压低声音、贴近麦克风地说');
  assert.equal(moodPrefix({ direction: '走进卫生间' }), '');
});

test('silenceRegions:按参考包参数切出正确段数', () => {
  const { pcm } = burstsWav(5);
  const regs = silenceRegions(pcm, 48000);
  assert.equal(regs.length, 5);
  for (const [a, b] of regs) assert.ok(b - a > 0.9 && b - a < 1.4, `段长 ${b - a}`);
});

test('generateCaseAudio(volc):整段生成 → 切段 → 每句 wav;段数不对会重试', async () => {
  const id = 'zz-volc-test';
  const dir = path.join(ROOT, 'cases', id);
  await fs.promises.rm(dir, { recursive: true, force: true });
  await fs.promises.mkdir(path.join(dir, 'audio'), { recursive: true });
  const script = { case_id: 'zz', name: 't', speakers: { user: { name: '你' }, assistant: { name: 'Step' } }, timeline: [
    { type: 'say', speaker: 'user', text: '今天出门要带伞么？' }, { type: 'say', speaker: 'assistant', text: '我在，你说。' },
    { type: 'say', speaker: 'assistant', text: '下午有雨，带把伞。' }, { type: 'say', speaker: 'user', text: '那打个车吧。' }, { type: 'say', speaker: 'assistant', text: '好，帮你叫。' },
  ] };
  await fs.promises.writeFile(path.join(dir, 'script.json'), JSON.stringify(script));
  const calls = [];
  const fetchImpl = async (url, init) => {
    const body = JSON.parse(init.body); calls.push(body);
    assert.equal(url, 'https://openspeech.bytedance.com/api/v3/tts/create'); assert.equal(init.headers['X-Api-Key'], 'volc-key'); assert.equal(body.model, 'seed-audio-1.0');
    const n = (body.text_prompt.match(/“/g) || []).length;
    /* 助手第一次故意少切一段(两句连读),第二次正常 */
    const bursts = n === 3 && calls.filter(c => c.text_prompt.includes('女子')).length === 1 ? 2 : n;
    return new Response(JSON.stringify({ audio: burstsWav(bursts).buf.toString('base64') }), { status: 200 });
  };
  process.env.VOLC_TTS_API_KEY = 'volc-key';
  const events = [];
  const r = await generateCaseAudio(id, script, { provider: 'volc', fetchImpl, onProgress: e => events.push(e) });
  delete process.env.VOLC_TTS_API_KEY;
  assert.equal(r.generated.length, 5); assert.equal(r.failed.length, 0);
  assert.equal(calls.length, 3, '用户 1 次 + 助手 2 次(第一次段数不对重生成)');
  assert.match(calls[0].text_prompt, /^安静的清晨室内.*他依次说了下面两句话/s);
  assert.match(calls[1].text_prompt, /^安静的室内.*她依次说了下面三句话/s);
  const manifest = JSON.parse(await fs.promises.readFile(path.join(dir, 'audio', 'manifest.json'), 'utf8'));
  assert.equal(Object.keys(manifest.clips).length, 5);
  assert.equal(manifest.clips.u001.source, 'volc:seed-audio-1.0:user'); assert.equal(manifest.clips.u001.sample_rate, 24000);
  assert.ok(manifest.clips.u001.duration_ms > 900 && manifest.clips.u001.duration_ms < 1400, `时长 ${manifest.clips.u001.duration_ms}`);
  assert.ok(fs.existsSync(path.join(dir, 'audio', 'master_user.mp3')) && fs.existsSync(path.join(dir, 'audio', 'master_assistant.mp3')));
  assert.ok(events.some(e => /切出 2 段,期望 3 段/.test(e.message)), '重试原因有上报');
  /* 再跑一次:全部沿用缓存 */
  process.env.VOLC_TTS_API_KEY = 'volc-key';
  const r2 = await generateCaseAudio(id, script, { provider: 'volc', fetchImpl });
  delete process.env.VOLC_TTS_API_KEY;
  assert.equal(r2.skipped.length, 5); assert.equal(calls.length, 3);
  await fs.promises.rm(dir, { recursive: true, force: true });
});
