// Portable PCM utilities shared by the CLI and browser importer. No resampling.
export function decodeWav(bytes: Uint8Array) {
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
    rate !== 48000 ||
    ![1, 2].includes(channels) ||
    !size ||
    size % (channels * 2)
  )
    throw Error('v1 要求 48 kHz、16 bit、单声道或双声道 PCM WAV');
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
export function base64(bytes: Uint8Array) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 8192)
    s += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(s);
}
export function unbase64(text: string) {
  // The grouped form `(?:[A-Za-z0-9+/]{4})*` keeps backtracking state per group
  // and overflows the regex stack a few megabytes in, far below the size this
  // format allows. Length carries the grouping; the alphabet scans linearly.
  const pad = text.endsWith('==') ? 2 : text.endsWith('=') ? 1 : 0;
  if (
    text.length % 4 !== 0 ||
    text.length === pad ||
    !/^[A-Za-z0-9+/]*$/.test(text.slice(0, text.length - pad))
  )
    throw Error('音频编码无效');
  return Uint8Array.from(atob(text), (c) => c.charCodeAt(0));
}
