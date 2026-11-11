/* Interactive particle mark.
   Particles fly in and assemble into a glyph (a mask of "#" cells), get pushed by
   the pointer, shimmer while idle, and burst apart on click/tap, then re-form.
   Usage: new Mark(rootEl, { mask, base, accents }) where rootEl contains a <canvas>
   (covering rootEl) and an element with [data-mark-anchor] that sets the glyph's box. */
(function () {
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)");
  const DEFAULT_MASK = ["#######", "#......", "#......", "#..####", "#......", "#......", "#######"];

  const rgb = (h) => {
    const m = /^#?([0-9a-f]{6})$/i.exec(h || "");
    const n = m ? parseInt(m[1], 16) : 0xffffff;
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  };
  const mix = (a, b, t) => `rgb(${a.map((v, i) => Math.round(v + (b[i] - v) * t)).join(",")})`;

  class Mark {
    constructor(root, opts = {}) {
      this.root = root;
      this.canvas = root.querySelector("canvas");
      this.anchor = root.querySelector("[data-mark-anchor]");
      if (!this.canvas || !this.anchor) return;
      this.ctx = this.canvas.getContext("2d");
      this.mask = opts.mask && opts.mask.length ? opts.mask : DEFAULT_MASK;
      this.sub = opts.sub || 3;
      this.base = rgb(opts.base || "#ffffff");
      this.accents = (opts.accents && opts.accents.length ? opts.accents : ["#ffffff"]).map(rgb);
      this.cols = Math.max(...this.mask.map((r) => r.length));
      this.rows = this.mask.length;
      this.anchor.style.aspectRatio = this.cols + " / " + this.rows;
      this.pointer = { x: 0, y: 0, on: false };
      this.parts = [];
      this.dust = [];
      this.build(opts.dust ?? 80);
      this.resize(true);

      new ResizeObserver(() => this.resize(false)).observe(root);
      root.addEventListener("pointermove", (e) => this.track(e));
      root.addEventListener("pointerleave", () => (this.pointer.on = false));
      root.addEventListener("pointerdown", (e) => this.burst(e));
      new IntersectionObserver(([en]) => (en.isIntersecting ? this.start() : this.stop())).observe(root);
      reduce.addEventListener && reduce.addEventListener("change", () => this.resize(true));
    }

    build(dustCount) {
      const s = this.sub;
      this.mask.forEach((row, r) => [...row].forEach((ch, c) => {
        if (ch !== "#") return;
        for (let i = 0; i < s; i++) for (let j = 0; j < s; j++) {
          this.parts.push({
            u: c + (i + 0.5) / s, v: r + (j + 0.5) / s,
            x: 0, y: 0, vx: 0, vy: 0, a: 0, heat: 0,
            delay: Math.random() * 1100,
            accent: this.accents[Math.floor(Math.random() * this.accents.length)],
          });
        }
      }));
      for (let i = 0; i < dustCount; i++) {
        this.dust.push({ fx: Math.random(), fy: Math.random(), vx: (Math.random() - 0.5) * 0.25, vy: (Math.random() - 0.5) * 0.25, a: 0.08 + Math.random() * 0.3, x: 0, y: 0 });
      }
    }

    resize(reset) {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = this.root.clientWidth, h = this.root.clientHeight;
      this.w = w; this.h = h; this.dpr = dpr;
      this.canvas.width = Math.round(w * dpr);
      this.canvas.height = Math.round(h * dpr);
      const a = this.anchor.getBoundingClientRect(), r = this.root.getBoundingClientRect();
      this.cell = Math.min(a.width / this.cols, a.height / this.rows) || 0;
      this.ox = a.left - r.left + (a.width - this.cell * this.cols) / 2;
      this.oy = a.top - r.top + (a.height - this.cell * this.rows) / 2;

      if (reset) {
        const cx = w / 2, cy = this.oy + (this.cell * this.rows) / 2, R = Math.max(w, h) * 0.55;
        for (const p of this.parts) {
          const ang = Math.random() * Math.PI * 2, d = R * Math.random() ** 0.6;
          p.x = cx + Math.cos(ang) * d; p.y = cy + Math.sin(ang) * d; p.vx = p.vy = 0; p.a = 0;
        }
        for (const d of this.dust) { d.x = d.fx * w; d.y = d.fy * h; }
        this.t0 = null;
      }
      if (reduce.matches) this.drawStatic();
    }

    home(p) { return [this.ox + p.u * this.cell, this.oy + p.v * this.cell]; }

    track(e) {
      const r = this.root.getBoundingClientRect();
      this.pointer.x = e.clientX - r.left; this.pointer.y = e.clientY - r.top; this.pointer.on = true;
    }

    burst(e) {
      if (reduce.matches) return;
      this.track(e);
      const { x, y } = this.pointer, reach = this.cell * 6;
      for (const p of this.parts) {
        const dx = p.x - x, dy = p.y - y, d = Math.hypot(dx, dy) || 1;
        const f = this.cell * (0.35 + 0.9 * Math.max(0, 1 - d / reach));
        p.vx += (dx / d) * f + (Math.random() - 0.5) * this.cell * 0.2;
        p.vy += (dy / d) * f + (Math.random() - 0.5) * this.cell * 0.2;
        p.heat = Math.max(p.heat, Math.max(0, 1 - d / reach));
      }
    }

    start() {
      if (reduce.matches) return this.drawStatic();
      if (this.running) return;
      this.running = true;
      this.last = performance.now();
      const loop = (now) => { if (!this.running) return; this.step(now); this.draw(); requestAnimationFrame(loop); };
      requestAnimationFrame(loop);
    }
    stop() { this.running = false; }

    step(now) {
      if (this.t0 == null) this.t0 = now;
      const dt = Math.max(0, Math.min(48, now - this.last)) / 16.67; this.last = now;
      const t = now - this.t0, damp = Math.pow(0.86, dt);
      const { x: px, y: py, on } = this.pointer, R = this.cell * 1.7, push = this.cell * 0.14;

      for (const p of this.parts) {
        if (t < p.delay) continue;
        p.a = Math.min(1, p.a + 0.035 * dt);
        const [tx, ty] = this.home(p);
        const k = 0.012 + 0.04 * Math.min(1, (t - p.delay) / 1400);   // soft fly-in, then firm
        let ax = (tx - p.x) * k, ay = (ty - p.y) * k;
        if (on) {
          const dx = p.x - px, dy = p.y - py, d = Math.hypot(dx, dy);
          if (d < R && d > 0.01) {
            const f = (1 - d / R) ** 2 * push;
            ax += (dx / d) * f; ay += (dy / d) * f;
            p.heat = Math.max(p.heat, 1 - d / R);
          }
        }
        p.vx = (p.vx + ax * dt) * damp; p.vy = (p.vy + ay * dt) * damp;
        p.x += p.vx * dt; p.y += p.vy * dt;
        p.heat *= Math.pow(0.955, dt);
      }
      if (Math.random() < 0.12 * dt) {                                   // idle shimmer
        const p = this.parts[Math.floor(Math.random() * this.parts.length)];
        if (p) p.heat = Math.max(p.heat, 0.85);
      }
      for (const d of this.dust) {
        d.x += d.vx * dt; d.y += d.vy * dt;
        if (d.x < 0) d.x += this.w; if (d.x > this.w) d.x -= this.w;
        if (d.y < 0) d.y += this.h; if (d.y > this.h) d.y -= this.h;
      }
    }

    draw() {
      const c = this.ctx, s = (this.cell / this.sub) * 0.72;
      c.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      c.clearRect(0, 0, this.w, this.h);
      c.fillStyle = mix(this.base, this.base, 0);
      for (const d of this.dust) { c.globalAlpha = d.a; c.fillRect(d.x, d.y, 1.5, 1.5); }
      for (const p of this.parts) {
        if (p.a <= 0) continue;
        const z = s * (1 + p.heat * 0.35);
        c.globalAlpha = p.a;
        c.fillStyle = p.heat > 0.03 ? mix(this.base, p.accent, Math.min(1, p.heat * 1.4)) : `rgb(${this.base})`;
        c.fillRect(p.x - z / 2, p.y - z / 2, z, z);
      }
      c.globalAlpha = 1;
    }

    drawStatic() {
      for (const p of this.parts) { [p.x, p.y] = this.home(p); p.a = 1; p.heat = 0; }
      this.draw();
    }
  }

  window.Mark = Mark;
})();
