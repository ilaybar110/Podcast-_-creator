// MP3 encoding off the main thread, so the page stays responsive on a phone.
// Applies the final loudness gain and a soft peak limiter (-1.5 dBTP) on the way in.
importScripts("../vendor/lame.min.js");

let enc = null;
const parts = [];
const CEIL = 0.84;   // -1.5 dBFS

function limit(x) {
  const a = Math.abs(x);
  if (a <= CEIL) return x;
  return Math.sign(x) * (CEIL + (1 - CEIL) * Math.tanh((a - CEIL) / (1 - CEIL)));
}

onmessage = (e) => {
  const m = e.data;
  if (m.cmd === "init") {
    enc = new lamejs.Mp3Encoder(1, m.rate, m.kbps);
  } else if (m.cmd === "chunk") {
    const s = m.samples, out = new Int16Array(s.length);
    for (let i = 0; i < s.length; i++) out[i] = Math.round(limit(s[i] * m.gain) * 32767);
    for (let i = 0; i < out.length; i += 1152) {
      const b = enc.encodeBuffer(out.subarray(i, i + 1152));
      if (b.length) parts.push(new Uint8Array(b));
    }
  } else if (m.cmd === "end") {
    const b = enc.flush();
    if (b.length) parts.push(new Uint8Array(b));
    postMessage({ parts });
  }
};
