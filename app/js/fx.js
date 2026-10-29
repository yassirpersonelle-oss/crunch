// Crunch - sounds (synthesised, no assets), haptics, 3D visual effects and the flame.
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
    better: () => Sound.grade(), worse: () => Sound.soft(),
    tap: () => tone(1400, 0, 0.025, 0.04, 'triangle'),
    seg: () => tone(1760, 0, 0.05, 0.05),
    nudge: () => { tone(987.77, 0, 0.1, 0.14, 'triangle'); tone(1318.5, 0.11, 0.16, 0.12, 'triangle'); },
  };
  // Recorded sounds (howler.js) replace the synthesised ones where we have a file.
  const FILES = {
    tap: ['sounds/tap.mp3', 0.5], check: ['sounds/check.mp3', 0.7], seg: ['sounds/seg.mp3', 0.45],
    win: ['sounds/win.mp3', 0.8], soft: ['sounds/late.mp3', 0.6], better: ['sounds/better.mp3', 0.85], worse: ['sounds/worse.mp3', 0.7],
  };
  if (window.Howl) {
    for (const [k, [src, volume]] of Object.entries(FILES)) {
      const h = new window.Howl({ src: [src], volume, preload: true });
      Sound[k] = () => h.play();
    }
  }

  // ---- haptics on iPhone & Android ----
  let hapSwitch = null;
  function ensureHapSwitch() {
    if (hapSwitch && hapSwitch.isConnected) return hapSwitch;
    const lbl = document.createElement('label');
    lbl.style.cssText = 'position:fixed;left:-9999px;top:-9999px;opacity:0;pointer-events:none;width:1px;height:1px;overflow:hidden';
    lbl.setAttribute('aria-hidden', 'true');
    const inp = document.createElement('input');
    inp.type = 'checkbox';
    inp.setAttribute('switch', '');
    lbl.appendChild(inp);
    document.body.appendChild(lbl);
    if (window.hapticTrigger) {
      try { window.hapticTrigger(lbl); } catch (e) { /* ignore */ }
    }
    hapSwitch = lbl;
    return lbl;
  }

  // Programmatic haptic pulse for each scroll increment
  function haptic(ms = 10) {
    if (navigator.vibrate) {
      try { navigator.vibrate(ms); } catch (e) { /* ignore */ }
    }
    try {
      const sw = ensureHapSwitch();
      if (sw) sw.click();
    } catch (e) { /* ignore */ }
  }

  const HAPTIC = '.act, .btn, .tab-link, .bigcheck, .carry, .theme-dot, .seg-wrap .button, .h-chip, .cel-later, .pill';
  function armHaptics(root) {
    if (!window.hapticTrigger || !root || !root.querySelectorAll) return;
    root.querySelectorAll(HAPTIC).forEach((el) => { if (!el.dataset.hap) { el.dataset.hap = '1'; window.hapticTrigger(el); } });
  }
  document.addEventListener('pointerdown', (e) => { if (e.target.closest && e.target.closest(HAPTIC)) Sound.tap(); }, { passive: true });
  window.addEventListener('haptics-ready', () => {
    armHaptics(document);
    ensureHapSwitch();
    new MutationObserver((ms) => ms.forEach((m) => m.addedNodes.forEach((n) => { if (n.nodeType === 1) armHaptics(n.parentNode || n); })))
      .observe(document.body, { childList: true, subtree: true });
  });

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

  // ---- 3D Interactive Perspective Tilt & Specular Glare ----
  function tilt3D(el, maxDeg = 12) {
    if (!el || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    el.classList.add('card-3d');
    const move = (e) => {
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height) return;
      const x = ((e.clientX - r.left) / r.width) * 2 - 1;
      const y = ((e.clientY - r.top) / r.height) * 2 - 1;
      el.style.setProperty('--rx', `${(-y * maxDeg).toFixed(2)}deg`);
      el.style.setProperty('--ry', `${(x * maxDeg).toFixed(2)}deg`);
      el.style.setProperty('--gx', `${((x + 1) * 50).toFixed(1)}%`);
      el.style.setProperty('--gy', `${((y + 1) * 50).toFixed(1)}%`);
    };
    const reset = () => {
      el.style.setProperty('--rx', '0deg');
      el.style.setProperty('--ry', '0deg');
      el.style.setProperty('--gx', '50%');
      el.style.setProperty('--gy', '20%');
    };
    el.addEventListener('pointermove', move, { passive: true });
    el.addEventListener('pointerleave', reset);
    el.addEventListener('pointerup', reset);
  }

  // ---- 3D Odometer Digit Flip helper ----
  function flipUpdate(el, htmlOrText, isHTML = false) {
    if (!el) return;
    const prev = isHTML ? el.innerHTML : el.textContent;
    if (prev === htmlOrText) return;
    if (isHTML) el.innerHTML = htmlOrText; else el.textContent = htmlOrText;
    el.classList.remove('flip-3d');
    void el.offsetWidth;
    el.classList.add('flip-3d');
  }

  // ---- 3D Metallic Confetti + Glowing Sparks ----
  function confetti(canvas, count = 160) {
    if (!canvas || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const dpr = window.devicePixelRatio || 1, W = canvas.clientWidth, H = canvas.clientHeight;
    canvas.width = W * dpr; canvas.height = H * dpr;
    const g = canvas.getContext('2d'); g.scale(dpr, dpr);
    const colors = ['#ff9f0a', '#ffd60a', '#30d158', '#64d2ff', '#ff375f', '#bf5af2', '#ffffff'];
    const parts = Array.from({ length: count }, (_, i) => ({
      x: W / 2 + (Math.random() - 0.5) * 70,
      y: H * 0.34,
      vx: (Math.random() - 0.5) * 15,
      vy: -Math.random() * 16 - 5,
      r: Math.random() * Math.PI * 2,
      vr: (Math.random() - 0.5) * 0.35,
      pitch: Math.random() * Math.PI * 2,
      vpitch: (Math.random() - 0.5) * 0.28,
      w: 6 + Math.random() * 7,
      h: 4 + Math.random() * 5,
      spark: i % 5 === 0,
      c: colors[(Math.random() * colors.length) | 0],
    }));
    const t0 = performance.now();
    (function frame(t) {
      const age = (t - t0) / 1000; g.clearRect(0, 0, W, H);
      for (const p of parts) {
        p.vy += p.spark ? 0.25 : 0.42;
        p.vx *= 0.99; p.x += p.vx; p.y += p.vy;
        p.r += p.vr; p.pitch += p.vpitch;
        const alpha = Math.max(0, 1 - Math.max(0, age - 1.8));
        g.save();
        g.globalAlpha = alpha;
        g.translate(p.x, p.y);
        if (p.spark) {
          g.shadowColor = p.c;
          g.shadowBlur = 10;
          g.fillStyle = '#fff';
          g.beginPath();
          g.arc(0, 0, 2.2, 0, Math.PI * 2);
          g.fill();
        } else {
          g.rotate(p.r);
          const tilt = Math.cos(p.pitch);
          g.scale(1, tilt);
          g.fillStyle = p.c;
          g.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
          if (tilt > 0.4) {
            g.fillStyle = 'rgba(255,255,255,0.35)';
            g.fillRect(-p.w / 2, -p.h / 2, p.w, p.h * 0.35);
          }
        }
        g.restore();
      }
      if (age < 3.0 && canvas.isConnected) requestAnimationFrame(frame); else g.clearRect(0, 0, W, H);
    })(t0);
  }

  window.FX = { Sound, haptic, flameSVG, confetti, tilt3D, flipUpdate };
})();
