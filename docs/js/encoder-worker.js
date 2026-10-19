// MP3 encoding off the main thread, so the page stays responsive on a phone.
// Applies the loudness gain, lays a very quiet room tone under everything (pauses never drop to
// digital zero) and runs a look-ahead peak limiter (-1 dBFS) on the way in.
importScripts("../vendor/lame.min.js", "dsp.js");

let enc = null, limiter = null, tone = null;
const parts = [];

function encode(y) {
  const out = new Int16Array(y.length);
  for (let i = 0; i < y.length; i++) out[i] = Math.round(y[i] * 32767);
  for (let i = 0; i < out.length; i += 1152) {
    const b = enc.encodeBuffer(out.subarray(i, i + 1152));
    if (b.length) parts.push(new Uint8Array(b));
  }
}

onmessage = (e) => {
  const m = e.data;
  if (m.cmd === "init") {
    enc = new lamejs.Mp3Encoder(1, m.rate, m.kbps);
    limiter = new PodcastDSP.PeakLimiter({ sampleRate: m.rate, ceilingDb: -1, lookaheadMs: 1.5, releaseMs: 80 });
    tone = new PodcastDSP.RoomTone(-65, 1234, m.rate);
  } else if (m.cmd === "chunk") {
    const s = m.samples;
    const scale = s instanceof Int16Array ? m.gain / 32768 : m.gain;    // parts may be stored as Int16 or float
    const x = new Float32Array(s.length);
    for (let i = 0; i < s.length; i++) x[i] = s[i] * scale + tone.next();
    encode(limiter.process(x));
  } else if (m.cmd === "end") {
    encode(limiter.flush());
    const b = enc.flush();
    if (b.length) parts.push(new Uint8Array(b));
    postMessage({ parts });
  }
};
