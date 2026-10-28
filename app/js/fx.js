// Crunch - sounds (synthesised, no assets) and the flame.
(function () {
  let ctx = null;
  const ac = () => {
    if (!ctx) { const C = window.AudioContext || window.webkitAudioContext; if (!C) return null; ctx = new C(); }
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  };
  // iOS only allows audio after a tap: unlock on the first one.
  document.addEventListener('pointerdown', () => ac(), { once: true, capture: true });

  function tone(freq, t0, dur, gain = 0.15, type = 'sine') {
    const c = ac(); if (!c) return;
    const o = c.createOscillator(), g = c.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, c.currentTime + t0);
    g.gain.setValueAtTime(0.0001, c.currentTime + t0);
    g.gain.exponentialRampToValueAtTime(gain, c.currentTime + t0 + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + t0 + dur);
    o.connect(g).connect(c.destination); o.start(c.currentTime + t0); o.stop(c.currentTime + t0 + dur + 0.02);
  }
  function whoosh(t0 = 0, dur = 0.35) {
    const c = ac(); if (!c) return;
    const n = c.sampleRate * dur, buf = c.createBuffer(1, n, c.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.sin((Math.PI * i) / n);
    const src = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain();
    src.buffer = buf; f.type = 'bandpass'; f.Q.value = 1.2;
    f.frequency.setValueAtTime(300, c.currentTime + t0);
    f.frequency.exponentialRampToValueAtTime(2400, c.currentTime + t0 + dur);
    g.gain.value = 0.22;
    src.connect(f).connect(g).connect(c.destination); src.start(c.currentTime + t0);
  }
  const Sound = {
    tick: () => { tone(1760, 0, 0.07, 0.12); tone(2637, 0.03, 0.09, 0.06); },
    check: () => { tone(1046.5, 0, 0.12, 0.12); tone(1568, 0.07, 0.18, 0.1); },
    win: () => { whoosh(0, 0.32); tone(1318.5, 0.18, 0.16, 0.12); tone(1975.5, 0.26, 0.3, 0.1); },
    soft: () => tone(440, 0, 0.12, 0.05, 'triangle'),
    grade: () => { [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => tone(f, i * 0.09, 0.5 - i * 0.05, 0.1)); },
    pop: () => tone(880, 0, 0.05, 0.08, 'triangle'),
  };

  // ---- the flame: number = streak, size/colour = today's combo ----
  const PALETTE = [
    ['#FF9F0A', '#FFD60A'], ['#FF9F0A', '#FFD60A'], ['#FF8A00', '#FFE066'], ['#FF7A00', '#FFF0A0'],
    ['#FF6A00', '#FFF6C8'], ['#FF5A1F', '#FFFFFF'], ['#FF453A', '#FFFFFF'], ['#64D2FF', '#FFFFFF'],
  ];
  function flameSVG(combo, size = 28) {
    const lvl = Math.max(0, Math.min(7, combo));
    const [outer, inner] = PALETTE[lvl];
    const scale = 0.82 + lvl * 0.045;
    const speed = (1.6 - lvl * 0.12).toFixed(2);
    return `<svg class="flame lvl${lvl}" viewBox="0 0 32 40" width="${size}" height="${size * 1.25}"
      style="--fs:${scale};--fspeed:${speed}s" aria-hidden="true">
      <defs><radialGradient id="fg${lvl}" cx="50%" cy="75%" r="65%">
        <stop offset="0%" stop-color="${inner}"/><stop offset="100%" stop-color="${outer}"/></radialGradient></defs>
      <g class="flame-body">
        <path class="flame-outer" fill="url(#fg${lvl})"
          d="M16 1c1.6 6.2 9.6 10.4 11.6 18.4C29.6 27.6 24.2 38 16 38S2.4 30.8 4.2 22.2C5.4 16.6 9.2 14 10.2 9.4c3 2.4 3.4 5.6 3.2 8.2C16.2 13.8 17.4 7.6 16 1Z"/>
        <path class="flame-inner" fill="${inner}" opacity=".92"
          d="M16.4 18.6c.8 3.6 5.6 5.8 5.6 10.4 0 4.6-2.8 7.4-6 7.4s-6-2.6-5.6-6.6c.3-2.8 2.4-4.2 3-6.6 1.4 1.2 1.8 2.6 1.8 3.8 1.4-2 1.8-5.2 1.2-8.4Z"/>
      </g></svg>`;
  }
  // Confetti burst on a canvas that fills its parent.
  function confetti(canvas, count = 140) {
    if (!canvas || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const dpr = window.devicePixelRatio || 1, W = canvas.clientWidth, H = canvas.clientHeight;
    canvas.width = W * dpr; canvas.height = H * dpr;
    const g = canvas.getContext('2d'); g.scale(dpr, dpr);
    const colors = ['#ff9f0a', '#ffd60a', '#30d158', '#64d2ff', '#ff375f', '#bf5af2'];
    const parts = Array.from({ length: count }, () => ({
      x: W / 2 + (Math.random() - 0.5) * 60, y: H * 0.32, vx: (Math.random() - 0.5) * 13, vy: -Math.random() * 15 - 5,
      r: Math.random() * Math.PI, vr: (Math.random() - 0.5) * 0.4, w: 6 + Math.random() * 6, h: 3 + Math.random() * 4,
      c: colors[(Math.random() * colors.length) | 0],
    }));
    const t0 = performance.now();
    (function frame(t) {
      const age = (t - t0) / 1000; g.clearRect(0, 0, W, H);
      for (const p of parts) {
        p.vy += 0.42; p.vx *= 0.99; p.x += p.vx; p.y += p.vy; p.r += p.vr;
        g.save(); g.globalAlpha = Math.max(0, 1 - Math.max(0, age - 1.8)); g.translate(p.x, p.y); g.rotate(p.r);
        g.fillStyle = p.c; g.fillRect(-p.w / 2, -p.h / 2, p.w, p.h * Math.abs(Math.cos(p.r * 2))); g.restore();
      }
      if (age < 2.9 && canvas.isConnected) requestAnimationFrame(frame); else g.clearRect(0, 0, W, H);
    })(t0);
  }
  window.FX = { Sound, flameSVG, confetti };
})();
