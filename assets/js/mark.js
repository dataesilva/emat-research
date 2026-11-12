/* Hero field: one plane of orbs receding back from the screen, flowing like water.
   The E is not a separate element. It is a relief in the same field: orbs inside a
   soft E-shaped mask rise toward the viewer (bigger, brighter), then sink below the
   surface (smaller, dimmer) until the letter reads as a void. A wavefront sweeps the
   letter so it never moves all at once.
   Interactions (kept from the earlier particle mark, softened): the pointer lifts and
   gently parts the orbs under it and warms them toward the accent colors (lab colors on
   the home page); a click scatters the orbs outward on a ripple that springs back;
   while idle, the odd orb flickers warm.

   Usage: new Mark(rootEl, { mask, base, accents }) where rootEl contains a <canvas> covering it
   and an element with [data-mark-anchor] whose box sets where and how big the E is.
   mark.render(seconds) draws a single frame (handy for testing). */
(function () {
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)");
  const DEFAULT_MASK = ["#######", "#......", "#......", "#..####", "#......", "#......", "#######"];

  const TILT = (55 * Math.PI) / 180;            // plane leans back 55° from facing the viewer
  const SIN = Math.sin(TILT), COS = Math.cos(TILT);
  const D = 10;                                   // depth of the plane's center (the E's center)
  const PERIOD = 9;                               // seconds for a full rise → sink → rise

  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
  const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
  const rgb = (h) => {
    const m = /^#?([0-9a-f]{6})$/i.exec(h || "");
    const n = m ? parseInt(m[1], 16) : 0xffffff;
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  };

  /* One soft orb, drawn once and stamped thousands of times. */
  const CORE = 0.55;                              // solid core as a fraction of the sprite radius
  function makeSprite([r, g, b]) {
    const c = document.createElement("canvas"), n = 64;
    c.width = c.height = n;
    const x = c.getContext("2d"), grd = x.createRadialGradient(n / 2, n / 2, 0, n / 2, n / 2, n / 2);
    grd.addColorStop(0, `rgba(${r},${g},${b},1)`);
    grd.addColorStop(CORE * 0.75, `rgba(${r},${g},${b},0.95)`);
    grd.addColorStop(CORE, `rgba(${r},${g},${b},0.4)`);
    grd.addColorStop(1, `rgba(${r},${g},${b},0)`);
    x.fillStyle = grd; x.fillRect(0, 0, n, n);
    return c;
  }

  class Mark {
    constructor(root, opts = {}) {
      this.root = root;
      this.canvas = root.querySelector("canvas");
      this.anchor = root.querySelector("[data-mark-anchor]");
      if (!this.canvas || !this.anchor) return;
      this.ctx = this.canvas.getContext("2d");
      this.mask = opts.mask && opts.mask.length ? opts.mask : DEFAULT_MASK;
      this.cols = Math.max(...this.mask.map((r) => r.length));
      this.rows = this.mask.length;
      this.cells = [];
      this.mask.forEach((row, r) => [...row].forEach((ch, c) => { if (ch === "#") this.cells.push([c, r]); }));
      this.anchor.style.aspectRatio = this.cols + " / " + this.rows;
      this.sprite = makeSprite(rgb(opts.base || "#ffffff"));
      this.accentSprites = (opts.accents && opts.accents.length ? opts.accents : ["#ffffff"]).map((c) => makeSprite(rgb(c)));
      this.pointer = { on: false, u: 0, v: 0, su: 0, sv: 0, amt: 0 };
      this.ripples = [];
      this.activity = (window.Site && window.Site.activity) || 0;
      window.addEventListener("site:activity", (e) => { this.activity = e.detail || 0; });

      this.resize();
      new ResizeObserver(() => { this.resize(); if (!this.running) this.drawStill(); }).observe(root);
      root.addEventListener("pointermove", (e) => this.track(e));
      root.addEventListener("pointerleave", () => { this.pointer.on = false; });
      root.addEventListener("pointerdown", (e) => {
        if (reduce.matches || !this.track(e)) return;
        this.ripples.push({ u: this.pointer.u, v: this.pointer.v, t0: this.t });
        if (this.ripples.length > 3) this.ripples.shift();
      });
      new IntersectionObserver(([en]) => (en.isIntersecting ? this.start() : this.stop())).observe(root);
      reduce.addEventListener && reduce.addEventListener("change", () => { this.stop(); this.start(); });
    }

    /* ---------- layout: build the grid of orbs for the current size ---------- */
    resize() {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = this.root.clientWidth, h = this.root.clientHeight;
      Object.assign(this, { w, h, dpr });
      this.canvas.width = Math.round(w * dpr);
      this.canvas.height = Math.round(h * dpr);
      const a = this.anchor.getBoundingClientRect(), r = this.root.getBoundingClientRect();
      this.cx = a.left - r.left + a.width / 2;
      this.cy = a.top - r.top + a.height / 2;
      this.f = Math.max(h, w * 0.55) * 1.45;       // long lens: depth without a ballooning foreground

      // E size on the plane. The tilt squashes depth by ~COS; stretch partly to compensate
      // (fully would make the E a tall trapezoid).
      const boxW = 0.9 * Math.min(a.width, (a.height * this.cols) / this.rows) || 300;
      this.ew = (boxW * D) / this.f;
      this.eh = (this.ew * this.rows) / this.cols / Math.sqrt(COS);
      this.U = this.ew / this.cols;                 // one mask cell, the unit for every motion

      const budget = w < 700 ? 3200 : 7000;
      let s = this.ew / 22;
      for (let i = 0; i < 4 && this.build(s) > budget; i++) s *= Math.sqrt(this.n / budget) * 1.03;
      this.s = s;
    }

    /* Even spacing on the plane; only the part that's on screen. Rows run near → far. */
    build(s) {
      const { w, h, cx, cy, f } = this;
      const vAt = (sy) => { const q = -(sy - cy) / f, den = COS - q * SIN; return den > 0.04 ? (q * D) / den : Infinity; };
      const vmin = vAt(h + 40);
      const vmax = Math.min(vAt(-40), (D * 6 - D) / SIN);
      const U = [], V = [], R = [], Q = [];
      for (let j = Math.ceil(vmin / s); j * s <= vmax; j++) {
        const v = j * s, Z = D + v * SIN;
        if (Z < 1) continue;
        const reach = ((Math.max(cx, w - cx) + 60) * Z) / f, kmax = Math.ceil(reach / s);
        for (let k = -kmax; k <= kmax; k++) {
          const u = k * s;
          U.push(u); V.push(v); R.push(this.relief(u, v)); Q.push(Math.hypot(u / this.ew, v / this.eh));
        }
      }
      this.n = U.length;
      this.pu = Float32Array.from(U); this.pv = Float32Array.from(V);
      this.pr = Float32Array.from(R); this.pq = Float32Array.from(Q);
      this.heat = new Float32Array(this.n);                                  // 0..1 warmth, decays
      this.tint = Uint8Array.from({ length: this.n }, () => Math.floor(Math.random() * this.accentSprites.length));
      this.zFar = D + vmax * SIN;
      return this.n;
    }

    /* 0..1: how much of the E's relief this plane point carries (soft shoulders). */
    relief(u, v) {
      const mx = (u / this.ew + 0.5) * this.cols, my = (0.5 - v / this.eh) * this.rows;
      if (mx < -1 || my < -1 || mx > this.cols + 1 || my > this.rows + 1) return 0;
      let best = 0;
      for (const [c, r] of this.cells) {
        const dx = Math.max(c - mx, 0, mx - (c + 1)), dy = Math.max(r - my, 0, my - (r + 1));
        best = Math.max(best, 1 - smooth(0, 0.6, Math.hypot(dx, dy)));
        if (best === 1) break;
      }
      return best;
    }

    /* Screen point → plane coords (ray hits the undisturbed plane). False above the horizon. */
    track(e) {
      const r = this.root.getBoundingClientRect();
      const dx = (e.clientX - r.left - this.cx) / this.f, dy = -(e.clientY - r.top - this.cy) / this.f;
      const den = SIN * dy - COS;
      const t = den < 0 ? (-COS * D) / den : -1;
      if (t <= 0) { this.pointer.on = false; return false; }
      const y = t * dy, z = t;
      this.pointer.u = t * dx;
      this.pointer.v = y * COS + (z - D) * SIN;
      this.pointer.on = true;
      return true;
    }

    /* ---------- animation ---------- */
    start() {
      if (reduce.matches) return this.drawStill();
      if (this.running) return;
      this.running = true;
      const t0 = performance.now() - (this.t || 0) * 1000;
      const loop = (now) => { if (!this.running) return; this.render((now - t0) / 1000); requestAnimationFrame(loop); };
      requestAnimationFrame(loop);
    }
    stop() { this.running = false; }

    /* Reduced motion / not yet animating: the E held fully raised, field at rest. */
    drawStill() { this.render(3, { still: true, phase: 1 }); }

    render(t, { still = false, phase = null } = {}) {
      this.t = t;
      const c = this.ctx, { U, f, cx, cy, w, h, n, pu, pv, pr, pq, sprite } = this;
      if (!n) return;
      c.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      c.clearRect(0, 0, w, h);

      const intro = still ? 1 : smooth(0, 1.6, t);
      const Ab = U * 0.24 * (1 + 0.6 * this.activity);   // background swell
      const Ar = U * 0.95;                                  // E relief height
      const R0 = this.s * 0.15;                             // orb radius on the plane
      const rMax = 13;                                      // cap foreground bokeh (sprite half-size, px)
      const omega = (2 * Math.PI) / PERIOD;
      const zNear = D * 0.75, zFar = this.zFar;

      // pointer swell follows the pointer softly and fades in/out
      const p = this.pointer;
      p.amt += ((p.on && !still ? 1 : 0) - p.amt) * 0.06;
      p.su += (p.u - p.su) * 0.12; p.sv += (p.v - p.sv) * 0.12;
      const Ap = U * 0.55 * p.amt, sig2 = (U * 1.8) ** 2;
      const rips = still ? [] : (this.ripples = this.ripples.filter((r) => t - r.t0 < 4.5));

      // warmth decays frame to frame; idle shimmer lights the odd orb
      const heat = this.heat, tint = this.tint, accents = this.accentSprites;
      const dt = clamp(t - (this.lastT ?? t), 0, 0.1); this.lastT = t;
      const cool = Math.pow(0.4, dt);                       // ~60% of warmth gone per second
      if (!still && Math.random() < dt * 5) heat[Math.floor(Math.random() * n)] = 0.55;

      for (let i = n - 1; i >= 0; i--) {                    // far rows first
        let u = pu[i], v = pv[i];
        const rel = pr[i];
        const ut = u / U, vt = v / U;
        const hb = still ? 0 :
          0.55 * Math.sin(0.8 * ut + 0.5 * vt - 1.0 * t) +
          0.30 * Math.sin(-0.45 * ut + 1.1 * vt - 0.65 * t + 1.3) +
          0.15 * Math.sin(1.6 * ut - 0.35 * vt + 1.4 * t);

        let P = 0;                                          // E phase: +1 raised … −1 sunk
        if (rel > 0) {
          const s = phase != null ? phase : Math.sin(omega * t - 1.4 * pq[i]);
          P = Math.sign(s) * Math.abs(s) ** 0.7 * intro;   // linger at the extremes
        }

        let hz = Ab * hb * (1 - 0.5 * rel) + Ar * rel * P, glow = 0;
        if (Ap > 0.001) {                                   // lift + part the orbs under the pointer
          const du = u - p.su, dv = v - p.sv, d = Math.hypot(du, dv) || 1;
          const g = Math.exp(-(d * d) / sig2);
          hz += Ap * g; glow = g * p.amt;
          const push = U * 0.32 * p.amt * g * Math.min(1, d / U);
          u += (du / d) * push; v += (dv / d) * push;
          if (g * p.amt > heat[i]) heat[i] = g * p.amt * 0.8;
        }
        for (const r of rips) {                             // scatter outward on a ring, then settle
          const age = t - r.t0, du = u - r.u, dv = v - r.v, d = Math.hypot(du, dv) || 1;
          const x = d - age * U * 6;
          const env = Math.exp(-(x * x) / (U * U * 2.5)) * Math.exp(-age / 1.4);
          hz += U * 0.5 * env * Math.cos((x / U) * 2.2);
          u += (du / d) * U * 0.45 * env; v += (dv / d) * U * 0.45 * env;
          glow += env * 0.45;
          if (env * 0.9 > heat[i]) heat[i] = env * 0.9;
        }
        heat[i] *= cool;

        // project (the plane normal points up and toward the viewer)
        const Y = v * COS + hz * SIN, Z = D + v * SIN - hz * COS;
        if (Z < 0.5) continue;
        const sx = cx + (f * u) / Z, sy = cy - (f * Y) / Z;
        if (sx < -20 || sx > w + 20 || sy < -20 || sy > h + 20) continue;

        // quiet field, loud letter; when sunk, the E's shoulders catch a little light (a carved rim)
        const rim = P < 0 ? 4 * rel * (1 - rel) * 0.16 * -P : 0;
        const light = 0.14 + 0.09 * hb + rel * 0.66 * P + rim + 0.2 * glow;
        const fog = 1 - 0.85 * smooth(zNear * 1.6, zFar, Z);
        const edge = 1 - smooth(h * 0.8, h, sy);
        const a = clamp(light, 0.025, 1) * fog * edge * (still ? 1 : smooth(0, 1.2, t));
        if (a < 0.01) continue;
        const rad = Math.min(rMax, ((R0 * f) / Z) * (1 + 0.32 * rel * P) / CORE);
        const warm = still ? 0 : Math.min(0.5, heat[i]);
        c.globalAlpha = a * (1 - warm);
        c.drawImage(sprite, sx - rad, sy - rad, rad * 2, rad * 2);
        if (warm > 0.02) {                                  // cross-fade toward the orb's accent color
          c.globalAlpha = Math.min(1, a * 1.3 + 0.08) * warm;
          c.drawImage(accents[tint[i]], sx - rad, sy - rad, rad * 2, rad * 2);
        }
      }
      c.globalAlpha = 1;
    }
  }

  window.Mark = Mark;
})();
