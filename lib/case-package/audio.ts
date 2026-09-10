// Portable PCM utilities shared by the CLI and browser importer. No resampling.
export function decodeWav(bytes: Uint8Array, allowOtherRates = false) {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength),
    str = (n: number, l: number) =>
      String.fromCharCode(...bytes.slice(n, n + l));
  if (bytes.length < 44 || str(0, 4) !== 'RIFF' || str(8, 4) !== 'WAVE')
    throw Error('音频必须是 PCM WAV');
  let channels = 0,
    rate = 0,
    bits = 0,
    format = 0,
    start = 0,
    size = 0;
  for (let p = 12; p + 8 <= bytes.length;) {
    const n = v.getUint32(p + 4, true);
    if (p + 8 + n > bytes.length) throw Error('WAV 文件不完整');
    if (str(p, 4) === 'fmt ') {
      if (n < 16) throw Error('WAV 格式头不完整');
      format = v.getUint16(p + 8, true);
      channels = v.getUint16(p + 10, true);
      rate = v.getUint32(p + 12, true);
      bits = v.getUint16(p + 22, true);
    }
    if (str(p, 4) === 'data') {
      start = p + 8;
      size = n;
    }
    p += 8 + n + (n % 2);
  }
  if (
    format !== 1 ||
    bits !== 16 ||
    (allowOtherRates ? rate < 8000 || rate > 192000 : rate !== 48000) ||
    ![1, 2].includes(channels) ||
    !size ||
    size % (channels * 2)
  )
    throw Error(allowOtherRates ? '要求 8–192 kHz、16 bit、单声道或双声道 PCM WAV' : 'v1 要求 48 kHz、16 bit、单声道或双声道 PCM WAV');
  const samples = new Float32Array(size / channels / 2);
  for (let i = 0; i < samples.length; i++) {
    let value = 0;
    for (let c = 0; c < channels; c++)
      value += v.getInt16(start + (i * channels + c) * 2, true) / 32768;
    samples[i] = value / channels;
  }
  return { samples, rate };
}
export function wav(channels: Float32Array[], rate = 48000) {
  const n = channels.length,
    frames = channels[0].length,
    b = new Uint8Array(44 + frames * n * 2),
    v = new DataView(b.buffer),
    str = (p: number, s: string) => {
      for (let i = 0; i < s.length; i++) b[p + i] = s.charCodeAt(i);
    };
  str(0, 'RIFF');
  v.setUint32(4, b.length - 8, true);
  str(8, 'WAVE');
  str(12, 'fmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, n, true);
  v.setUint32(24, rate, true);
  v.setUint32(28, rate * n * 2, true);
  v.setUint16(32, n * 2, true);
  v.setUint16(34, 16, true);
  str(36, 'data');
  v.setUint32(40, frames * n * 2, true);
  for (let i = 0; i < frames; i++)
    for (let c = 0; c < n; c++) {
      const x = Math.max(-1, Math.min(1, channels[c][i]));
      v.setInt16(
        44 + (i * n + c) * 2,
        Math.round(x * (x < 0 ? 32768 : 32767)),
        true,
      );
    }
  return b;
}
export function peaks(samples: Float32Array, count = 200) {
  return Array.from({ length: count }, (_, i) => {
    let m = 0;
    for (
      let j = Math.floor((i * samples.length) / count);
      j < Math.floor(((i + 1) * samples.length) / count);
      j++
    )
      m = Math.max(m, Math.abs(samples[j]));
    return m;
  });
}
// Encode fixed-size byte groups without spreading audio into function arguments.
// Browser engines have different call-stack limits, including embedded WebViews.
export function base64(bytes: Uint8Array) {
  const parts: string[] = [];
  // Each complete group is divisible by three, so only the final group is padded.
  for (let i = 0; i < bytes.length; i += 3072) {
    let binary = '';
    const end = Math.min(i + 3072, bytes.length);
    for (let j = i; j < end; j++) binary += String.fromCharCode(bytes[j]);
    parts.push(btoa(binary));
  }
  return parts.join('');
}
export function unbase64(text: string) {
  if (typeof text !== 'string' || text.length % 4 !== 0)
    throw Error('音频编码无效');
  const padding = text.endsWith('==') ? 2 : text.endsWith('=') ? 1 : 0;
  for (let i = 0; i < text.length - padding; i++) {
    const c = text.charCodeAt(i);
    if (!((c >= 65 && c <= 90) || (c >= 97 && c <= 122) ||
          (c >= 48 && c <= 57) || c === 43 || c === 47))
      throw Error('音频编码无效');
  }
  let binary: string;
  try { binary = atob(text); } catch { throw Error('音频编码无效'); }
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
