/* Shared helpers, header/footer, rails and cursor label. No dependencies, no build step. */
(function () {
  const script = document.currentScript;
  const ROOT = (script && script.dataset.root) || "./";
  const S = (window.Site = { root: ROOT });

  S.esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  S.safeUrl = (u) => (/^https?:\/\//i.test(u || "") ? u : "");
  S.safeColor = (c) => (/^#[0-9a-f]{3,8}$/i.test(c || "") ? c : "#ffffff");
  S.json = (path) => fetch(ROOT + path).then((r) => { if (!r.ok) throw new Error(path + " " + r.status); return r.json(); });
  S.jsonOr = (path, fallback) => S.json(path).catch(() => fallback);

  // Dates are handled as local "YYYY-MM-DD" strings to avoid timezone shifts.
  S.parse = (s) => { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); };
  S.fmt = (d) => d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  S.addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
  S.pretty = (s, opts) => S.parse(s).toLocaleDateString(undefined, opts || { year: "numeric", month: "short", day: "numeric" });
  S.today = () => S.fmt(new Date());
  S.labsBySlug = (labs) => Object.fromEntries(labs.map((l) => [l.slug, l]));

  /* Load every lab's updates.json and merge them, newest first. */
  S.allUpdates = async (labs) => {
    const perLab = await Promise.all(labs.map(async (l) =>
      (await S.jsonOr(`labs/${l.slug}/updates.json`, [])).map((u) => Object.assign({ lab: l.slug }, u))));
    return perLab.flat().sort((a, b) => b.date.localeCompare(a.date));
  };

  /* Expand events (weekly repeats + multi-day spans).
     Returns { starts: [occurrence], byDay: {date: [occurrence]} } */
  S.expand = (events) => {
    const starts = [], byDay = {};
    for (const e of events) {
      const weekly = e.repeat === "weekly";
      const first = S.parse(e.date);
      const last = weekly ? S.parse(e.until || S.fmt(S.addDays(first, 364))) : first;
      const span = e.endDate ? Math.round((S.parse(e.endDate) - first) / 864e5) : 0;
      for (let d = first; d <= last; d = S.addDays(d, 7)) {
        const occ = Object.assign({}, e, { start: S.fmt(d) });
        starts.push(occ);
        for (let i = 0; i <= span; i++) (byDay[S.fmt(S.addDays(d, i))] ||= []).push(occ);
        if (!weekly) break;
      }
    }
    const key = (o) => o.start + (o.time || "");
    starts.sort((a, b) => key(a).localeCompare(key(b)));
    return { starts, byDay };
  };

  S.typeLabel = { meeting: "Lab meeting", deadline: "Deadline", cfp: "Call for papers", conference: "Conference" };
  S.types = Object.keys(S.typeLabel);
  const typeClass = (t) => (S.types.includes(t) ? t : "");

  /* ---- Energy that means something ---- */
  S.reduce = matchMedia("(prefers-reduced-motion: reduce)");
  S.fine = matchMedia("(hover: hover) and (pointer: fine)");
  const clamp01 = (x) => Math.max(0, Math.min(1, x));
  S.daysUntil = (dateStr) => Math.round((S.parse(dateStr) - S.parse(S.today())) / 864e5);

  /* Deadlines and CFPs heat up over the final 30 days: returns { cls, style } for the pulse. */
  S.pulse = (o) => {
    if (o.type !== "deadline" && o.type !== "cfp") return { cls: "", style: "" };
    const d = S.daysUntil(o.start);
    if (d < 0 || d > 30) return { cls: "", style: "" };
    const u = 1 - d / 30;                                   // 0 → 1 as the date nears
    return { cls: " pulse", style: `--pulse:${(4 - 3.1 * u).toFixed(2)}s` };
  };
  /* Updates are warm for a week after posting: 1 → 0. */
  S.freshness = (u) => clamp01(1 + S.daysUntil(u.date) / 7);

  /* Group-wide activity 0..1 from recent updates and near deadlines. Exposed as --activity
     and Site.activity (and a "site:activity" event) for anything that wants to feel it. */
  S.setActivity = (updates, events) => {
    const recent = updates.filter((u) => S.daysUntil(u.date) >= -30).length;
    const soon = events.filter((e) => (e.type === "deadline" || e.type === "cfp") && S.daysUntil(e.date) >= 0 && S.daysUntil(e.date) <= 30).length;
    S.activity = clamp01(0.6 * Math.min(1, recent / 6) + 0.4 * Math.min(1, soon / 3));
    document.documentElement.style.setProperty("--activity", S.activity.toFixed(3));
    window.dispatchEvent(new CustomEvent("site:activity", { detail: S.activity }));
    return S.activity;
  };

  /* Smoothed scroll velocity (px/frame), decays to 0 when scrolling stops. */
  S.scrollVel = 0;
  (() => {
    let lastY = scrollY, raf = 0;
    const tick = () => {
      const dy = scrollY - lastY; lastY = scrollY;
      S.scrollVel = S.scrollVel * 0.85 + dy * 0.15;
      if (Math.abs(S.scrollVel) > 0.05 || dy) raf = requestAnimationFrame(tick); else { S.scrollVel = 0; raf = 0; }
    };
    addEventListener("scroll", () => { raf ||= requestAnimationFrame(tick); }, { passive: true });
  })();

  /* Display type gains a little weight near the pointer and while scrolling fast. */
  S.flexType = () => {
    if (S.reduce.matches) return;
    const sel = ".sec-head h2, .themes, .about p, .page-title, .gf__word";
    const els = new Map();                                   // el -> { cur, vis }
    const io = new IntersectionObserver((ents) => ents.forEach((en) => { const s = els.get(en.target); if (s) s.vis = en.isIntersecting; }));
    document.querySelectorAll(sel).forEach((el) => { els.set(el, { cur: 0, vis: false }); io.observe(el); });
    let px = -1e4, py = -1e4, raf = 0;
    const frame = () => {
      raf = 0; let busy = false;
      const vel = Math.min(1, Math.abs(S.scrollVel) / 30);
      els.forEach((s, el) => {
        if (!s.vis && s.cur < 0.002) return;
        const r = el.getBoundingClientRect();
        const dx = Math.max(r.left - px, 0, px - r.right), dy = Math.max(r.top - py, 0, py - r.bottom);
        const prox = S.fine.matches ? 1 - Math.min(1, Math.hypot(dx, dy) / 320) : 0;
        const target = s.vis ? Math.max(prox * 0.85, vel) : 0;
        s.cur += (target - s.cur) * 0.12;
        if (Math.abs(target - s.cur) > 0.002) busy = true;
        el.style.setProperty("--flex", s.cur.toFixed(3));
      });
      if (busy || S.scrollVel) raf = requestAnimationFrame(frame);
    };
    const kick = () => { raf ||= requestAnimationFrame(frame); };
    addEventListener("pointermove", (e) => { px = e.clientX; py = e.clientY; kick(); }, { passive: true });
    addEventListener("scroll", kick, { passive: true });
  };

  S.when = (o) => {
    let s = S.pretty(o.start, { weekday: "short", month: "short", day: "numeric", year: "numeric" });
    if (o.endDate && o.endDate !== o.start) s += " – " + S.pretty(o.endDate, { month: "short", day: "numeric" });
    if (o.time) s += " · " + o.time + (o.endTime ? "–" + o.endTime : "");
    return s;
  };

  const titleLink = (title, url) => (S.safeUrl(url) ? `<a href="${S.esc(url)}" rel="noopener">${S.esc(title)}</a>` : S.esc(title));

  S.eventHtml = (o, labs) => {
    const lab = o.lab && labs[o.lab];
    const meta = [S.typeLabel[o.type] || o.type, o.location, lab && lab.name, o.notes].filter(Boolean).map(S.esc).join(" · ");
    const p = S.pulse(o);
    return `<li class="ev ${typeClass(o.type)}${p.cls}" style="${p.style}"><span class="dot"></span><div>
      <div class="ev__when mono">${S.esc(S.when(o))}</div>
      <div class="ev__t">${titleLink(o.title, o.url)}</div>
      <div class="ev__meta">${meta}</div></div></li>`;
  };

  /* Row layout (updates page, lab pages) */
  S.updateRow = (u, labs, showLab) => {
    const lab = labs[u.lab];
    const labLink = showLab && lab
      ? `<a class="ulab mono" href="${ROOT}labs/${S.esc(lab.slug)}/" style="--c:${S.safeColor(lab.color)}"><span class="dot"></span>${S.esc(lab.name)}</a>` : "";
    const warm = lab ? ` style="--c:${S.safeColor(lab.color)};--fresh:${S.freshness(u).toFixed(2)}"` : "";
    return `<li class="urow"${warm}><time class="mono" datetime="${S.esc(u.date)}">${S.esc(S.pretty(u.date))}</time>
      <div><h3>${titleLink(u.title, u.url)}</h3><p>${S.esc(u.summary)}</p>${labLink}</div></li>`;
  };

  /* Card layout (home rail) */
  S.updateCard = (u, labs) => {
    const lab = labs[u.lab];
    const warm = lab ? ` style="--c:${S.safeColor(lab.color)};--fresh:${S.freshness(u).toFixed(2)}"` : "";
    return `<li class="rail__item"><article class="ucard"${warm}>
      <div class="ucard__meta mono"><span class="dot"></span>${S.esc(S.pretty(u.date))}${lab ? " · " + S.esc(lab.name) : ""}</div>
      <h3 class="ucard__title">${titleLink(u.title, u.url)}</h3>
      <p class="ucard__dek">${S.esc(u.summary)}</p>
      ${u.type ? `<div class="ucard__foot mono">${S.esc(u.type)}</div>` : ""}
    </article></li>`;
  };

  /* Horizontal rail: prev/next buttons, mouse drag with momentum, rubber-band ends.
     Touch keeps native scrolling. */
  S.rail = (section) => {
    const rail = section.querySelector(".rail");
    const list = rail && rail.querySelector(".rail__list");
    const prev = section.querySelector("[data-rail=prev]"), next = section.querySelector("[data-rail=next]");
    if (!rail || !list || !prev || !next) return;
    const max = () => rail.scrollWidth - rail.clientWidth;
    const sync = () => {
      prev.disabled = rail.scrollLeft <= 2;
      next.disabled = rail.scrollLeft >= max() - 2;
    };
    prev.onclick = () => rail.scrollBy({ left: -rail.clientWidth * 0.8, behavior: "smooth" });
    next.onclick = () => rail.scrollBy({ left: rail.clientWidth * 0.8, behavior: "smooth" });
    rail.addEventListener("scroll", sync, { passive: true });
    new ResizeObserver(sync).observe(rail);
    sync();
    if (S.reduce.matches || !S.fine.matches) return;

    // Rubber band: resistance grows the further you pull past an end.
    const band = (over) => Math.sign(over) * 70 * (1 - Math.exp(-Math.abs(over) / 180));
    const stretch = (over) => { list.style.transition = "none"; list.style.transform = over ? `translateX(${band(over)}px)` : ""; };
    const release = () => { list.style.transition = "transform .7s var(--spring)"; list.style.transform = ""; };

    let drag = null, coast = 0;
    rail.classList.add("rail--drag");
    rail.addEventListener("dragstart", (e) => e.preventDefault());
    rail.addEventListener("pointerdown", (e) => {
      if (e.pointerType !== "mouse" || e.button !== 0) return;
      cancelAnimationFrame(coast);
      drag = { x0: e.clientX, s0: rail.scrollLeft, lx: e.clientX, lt: performance.now(), v: 0, moved: 0 };
    });
    addEventListener("pointermove", (e) => {
      if (!drag) return;
      const dx = e.clientX - drag.x0;
      drag.moved = Math.max(drag.moved, Math.abs(dx));
      if (drag.moved < 4) return;
      if (!rail.classList.contains("rail--dragging")) { rail.classList.add("rail--dragging"); rail.style.scrollSnapType = "none"; }
      const want = drag.s0 - dx, m = max();
      rail.scrollLeft = Math.max(0, Math.min(m, want));
      stretch(want < 0 ? -want : want > m ? m - want : 0);
      const now = performance.now(), dt = Math.max(1, now - drag.lt);
      drag.v = 0.8 * ((e.clientX - drag.lx) / dt) + 0.2 * drag.v;   // px/ms
      drag.lx = e.clientX; drag.lt = now;
    });
    addEventListener("pointerup", () => {
      if (!drag) return;
      const { moved } = drag;
      let v = -drag.v * 16;                                        // px/frame
      drag = null;
      rail.classList.remove("rail--dragging");
      release();
      if (moved < 4) return;
      // The click that follows a drag must not open a card; drop the guard right after.
      const guard = (e) => { e.preventDefault(); e.stopPropagation(); };
      rail.addEventListener("click", guard, true);
      setTimeout(() => rail.removeEventListener("click", guard, true), 0);
      const step = () => {
        const m = max(), before = rail.scrollLeft;
        rail.scrollLeft = before + v;
        v *= 0.94;
        const hitEnd = (before + v < 0 && v < 0) || (before + v > m && v > 0);
        if (hitEnd && Math.abs(v) > 2) {                            // bump the end, then spring back
          stretch(-v * 6); requestAnimationFrame(release); v = 0;
        }
        if (Math.abs(v) > 0.4) coast = requestAnimationFrame(step);
        else rail.style.scrollSnapType = "";                       // let snap settle it
      };
      coast = requestAnimationFrame(step);
    });
  };

  /* Cursor blob: trails the pointer on a spring, stretches with speed, is pulled toward and
     swells over interactive elements, and shows a label over [data-cursor]. */
  S.blob = () => {
    if (!S.fine.matches || S.reduce.matches) return;
    const el = document.createElement("div");
    el.className = "blob"; el.setAttribute("aria-hidden", "true");
    el.innerHTML = `<div class="blob__dot"></div><div class="blob__label"></div>`;
    document.body.appendChild(el);
    const dot = el.firstElementChild, label = el.lastElementChild;
    let x = -100, y = -100, vx = 0, vy = 0, tx = -100, ty = -100, s = 1, ts = 1, raf = 0;
    const loop = () => {
      vx = (vx + (tx - x) * 0.2) * 0.62; vy = (vy + (ty - y) * 0.2) * 0.62;   // a little underdamped
      x += vx; y += vy; s += (ts - s) * 0.18;
      const sp = Math.min(0.55, Math.hypot(vx, vy) / 45), ang = Math.atan2(vy, vx);
      el.style.transform = `translate(${x}px, ${y}px)`;
      dot.style.transform = `rotate(${ang}rad) scale(${s * (1 + sp)}, ${s * (1 - sp * 0.45)})`;
      raf = Math.abs(tx - x) + Math.abs(ty - y) + Math.abs(vx) + Math.abs(vy) + Math.abs(ts - s) > 0.05 ? requestAnimationFrame(loop) : 0;
    };
    addEventListener("pointermove", (e) => {
      if (e.pointerType !== "mouse") return;
      el.classList.add("on");
      tx = e.clientX; ty = e.clientY; ts = 1;
      if (!e.target.closest) return;
      const tagged = e.target.closest("[data-cursor]");
      const t = e.target.closest("a, button, select, .rail--drag");
      el.classList.toggle("blob--label", !!tagged);
      if (tagged) { label.textContent = tagged.dataset.cursor; ts = 0.6; }
      else if (t && t.matches(".rail--drag")) { ts = 1.6; }
      else if (t) {
        const r = t.getBoundingClientRect();
        tx += (r.left + r.width / 2 - tx) * 0.28; ty += (r.top + r.height / 2 - ty) * 0.28;   // magnetic pull
        ts = Math.min(4, Math.max(2.6, r.height / 10));
      }
      raf ||= requestAnimationFrame(loop);
    }, { passive: true });
    document.documentElement.addEventListener("pointerleave", () => el.classList.remove("on"));
  };

  /* Download every event as an .ics file (floating local times). */
  S.ics = (events, name) => {
    const compact = (s) => s.replace(/-/g, "");
    const t = (x) => x.replace(":", "") + "00";
    const esc = (s) => String(s || "").replace(/([,;\\])/g, "\\$1").replace(/\n/g, "\\n");
    const L = ["BEGIN:VCALENDAR", "VERSION:2.0", `PRODID:-//${esc(name)}//Calendar//EN`];
    events.forEach((e, i) => {
      L.push("BEGIN:VEVENT", `UID:ev-${i}-${compact(e.date)}@research-site`, `DTSTAMP:${compact(S.today())}T000000`);
      if (e.time) {
        L.push(`DTSTART:${compact(e.date)}T${t(e.time)}`, `DTEND:${compact(e.date)}T${t(e.endTime || e.time)}`);
      } else {
        L.push(`DTSTART;VALUE=DATE:${compact(e.date)}`, `DTEND;VALUE=DATE:${compact(S.fmt(S.addDays(S.parse(e.endDate || e.date), 1)))}`);
      }
      if (e.repeat === "weekly") L.push("RRULE:FREQ=WEEKLY" + (e.until ? `;UNTIL=${compact(e.until)}T235959` : ""));
      L.push(`SUMMARY:${esc(e.title)}`);
      if (e.location) L.push(`LOCATION:${esc(e.location)}`);
      if (S.safeUrl(e.url)) L.push(`URL:${e.url}`);
      L.push("END:VEVENT");
    });
    L.push("END:VCALENDAR");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([L.join("\r\n")], { type: "text/calendar" }));
    a.download = "calendar.ics"; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };

  /* Header + footer */
  S.chrome = async () => {
    const site = await S.jsonOr("data/site.json", { name: "Research Group" });
    const [first, ...rest] = String(site.name || "").split(" ");
    const links = [["Labs", "#labs"], ["Updates", "updates/"], ["Calendar", "#calendar"], ["About", "#about"]]
      .map(([label, href]) => `<a href="${ROOT}${href}">${label}</a>`).join("");
    const h = document.getElementById("site-header");
    if (h) {
      h.className = "gh";
      h.innerHTML = `<div class="gh__inner">
          <a class="gh__brand" href="${ROOT}">${S.esc(first)}<span>${S.esc(rest.join(" "))}</span></a>
          <nav class="gh__nav" aria-label="Main">${links}</nav>
          <div class="gh__right">
            ${site.contact ? `<a class="gh__contact" href="mailto:${S.esc(site.contact)}">Contact</a>` : ""}
            <button class="gh__menu-btn" type="button" aria-expanded="false" aria-controls="gh-overlay">Menu</button>
          </div>
        </div>
        <div class="gh__overlay" id="gh-overlay">
          <button class="gh__menu-btn" type="button">Close</button>
          <nav aria-label="Main (mobile)">${links}${site.contact ? `<a href="mailto:${S.esc(site.contact)}">Contact</a>` : ""}</nav>
        </div>`;
      const btns = h.querySelectorAll(".gh__menu-btn");
      const setOpen = (open) => {
        h.classList.toggle("gh--open", open);
        btns[0].setAttribute("aria-expanded", String(open));
        document.body.style.overflow = open ? "hidden" : "";
        (open ? btns[1] : btns[0]).focus();
      };
      btns[0].onclick = () => setOpen(true);
      btns[1].onclick = () => setOpen(false);
      h.querySelectorAll(".gh__overlay nav a").forEach((a) => a.addEventListener("click", () => setOpen(false)));
      document.addEventListener("keydown", (e) => { if (e.key === "Escape" && h.classList.contains("gh--open")) setOpen(false); });
    }
    const f = document.getElementById("site-footer");
    if (f) {
      f.className = "gf";
      f.innerHTML = `<nav class="gf__nav" aria-label="Footer">${links}${site.contact ? `<a href="mailto:${S.esc(site.contact)}">${S.esc(site.contact)}</a>` : ""}</nav>
        <p class="gf__word" aria-hidden="true">${S.esc(site.name)}</p>
        <div class="gf__row mono"><span>© ${new Date().getFullYear()} ${S.esc(site.name)}</span><span>Sociotechnical research network</span></div>`;
    }
    S.blob();
    S.flexType();
    return site;
  };
})();
