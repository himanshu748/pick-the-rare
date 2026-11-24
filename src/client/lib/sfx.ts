// One soft click, off by default. No audio assets, WebAudio only.
const KEY = 'ptr:sound';
let enabled = false;
try { enabled = localStorage.getItem(KEY) === '1'; } catch { /* private contexts */ }
export const sfx = {
  get enabled() { return enabled; },
  toggle() {
    enabled = !enabled;
    try { localStorage.setItem(KEY, enabled ? '1' : '0'); } catch { /* noop */ }
    return enabled;
  },
  click() {
    if (!enabled) return;
    try {
      const ctx = new AudioContext();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.frequency.value = 540;
      gain.gain.setValueAtTime(0.06, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.12);
      osc.connect(gain).connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.12);
      osc.onended = () => void ctx.close().catch(() => undefined);
    } catch { /* audio unavailable */ }
  },
};
