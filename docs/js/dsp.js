// Streaming DSP shared by the page (ES module import) and the MP3 encoder worker (importScripts),
// so it is a plain script that publishes `globalThis.PodcastDSP` instead of using `export`.
(function (g) {
  "use strict";

  /** Small deterministic PRNG (mulberry32): the same seed always gives the same room tone. */
  function rng(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /**
   * Very quiet, gentle pink-ish noise ("room tone") so pauses never drop to digital zero.
   * Paul Kellett's economy pink filter on seeded white noise, a low cut at ~100 Hz and a soft
   * top-end roll-off, calibrated to an exact RMS level.
   */
  class RoomTone {
    constructor(levelDb = -65, seed = 1234, sampleRate = 24000) {
      this.seed = seed;
      this.hpA = Math.exp(-2 * Math.PI * 100 / sampleRate);
      this._reset();
      // Calibrate on 4 s of the same sequence, then start over so the stream is reproducible.
      let s = 0;
      const n = 96000;
      for (let i = 0; i < n; i++) { const v = this._raw(); s += v * v; }
      this.scale = 10 ** (levelDb / 20) / Math.sqrt(s / n);
      this._reset();
    }
    _reset() { this.rand = rng(this.seed); this.b0 = this.b1 = this.b2 = this.lp = this.hp = 0; }
    _raw() {
      const w = this.rand() * 2 - 1;
      this.b0 = 0.99765 * this.b0 + w * 0.099046;
      this.b1 = 0.963 * this.b1 + w * 0.2965164;
      this.b2 = 0.57 * this.b2 + w * 1.0526913;
      const pink = this.b0 + this.b1 + this.b2 + w * 0.1848;
      const prev = this.lp;
      this.lp += 0.5 * (pink - this.lp);        // gentle roll-off of the hiss
      this.hp = this.hpA * (this.hp + this.lp - prev);   // and of the rumble
      return this.hp;
    }
    next() { return this._raw() * this.scale; }
    fill(n) { const out = new Float32Array(n); for (let i = 0; i < n; i++) out[i] = this.next(); return out; }
  }

  /**
   * Look-ahead peak limiter. Gain is the minimum required over the look-ahead window,
   * released smoothly (exponential), then smoothed by a moving average as long as the
   * look-ahead - which ramps the gain down *before* a peak and guarantees |out| <= ceiling.
   * Output is delayed by the look-ahead; process() hides that delay (call flush() at the end),
   * so the total output length equals the total input length.
   */
  class PeakLimiter {
    constructor({ sampleRate = 24000, ceilingDb = -1, lookaheadMs = 1.5, releaseMs = 80 } = {}) {
      this.ceil = 10 ** (ceilingDb / 20);
      const L = this.L = Math.max(1, Math.round(sampleRate * lookaheadMs / 1000));
      this.rel = Math.exp(-1 / (sampleRate * releaseMs / 1000));
      this.delay = new Float32Array(L);          // x[n-L .. n-1]
      this.box = new Float64Array(L).fill(1);    // smoothed gains for the moving average
      this.sum = L;
      this.qIdx = new Float64Array(L + 2);        // monotonic deque: window minimum of required gain
      this.qVal = new Float64Array(L + 2);
      this.qHead = 0; this.qLen = 0;
      this.held = 1; this.n = 0; this.primed = 0;
      this.minGain = 1;                          // deepest gain reduction so far (for reporting)
    }
    _step(x) {
      const L = this.L, W = L + 2, a = Math.abs(x);
      const r = a > this.ceil ? this.ceil / a : 1;
      // Push r, keep the deque increasing, drop indices that fell out of [n-L, n].
      while (this.qLen && this.qVal[(this.qHead + this.qLen - 1) % W] >= r) this.qLen--;
      const t = (this.qHead + this.qLen) % W;
      this.qIdx[t] = this.n; this.qVal[t] = r; this.qLen++;
      while (this.qIdx[this.qHead] < this.n - L) { this.qHead = (this.qHead + 1) % W; this.qLen--; }
      const h = this.qVal[this.qHead];
      const released = 1 - (1 - this.held) * this.rel;
      this.held = h < released ? h : released;
      const k = this.n % L;
      this.sum += this.held - this.box[k];
      this.box[k] = this.held;
      if ((this.n & 4095) === 0) { let s = 0; for (let i = 0; i < L; i++) s += this.box[i]; this.sum = s; }
      const gain = this.sum / L;
      if (gain < this.minGain) this.minGain = gain;
      const xd = this.delay[k];
      this.delay[k] = x;
      this.n++;
      const y = xd * gain;
      return y > this.ceil ? this.ceil : y < -this.ceil ? -this.ceil : y;
    }
    /** Limit `x * gain`; returns the limited samples available so far (delay hidden). */
    process(x, gain = 1) {
      const skip = Math.min(this.L - this.primed, x.length);
      const out = new Float32Array(x.length - skip);
      let o = 0;
      for (let i = 0; i < x.length; i++) {
        const y = this._step(x[i] * gain);
        if (this.primed < this.L) this.primed++; else out[o++] = y;
      }
      return out;
    }
    /** The samples still held in the look-ahead delay. */
    flush() {
      const tail = new Float32Array(this.L);
      for (let i = 0; i < this.L; i++) tail[i] = this._step(0);
      const out = tail.subarray(this.L - this.primed);   // fewer than L inputs in total: the rest were padding
      this.primed = 0;
      return out;
    }
  }

  g.PodcastDSP = { rng, RoomTone, PeakLimiter };
})(typeof globalThis !== "undefined" ? globalThis : self);
