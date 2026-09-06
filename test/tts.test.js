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
