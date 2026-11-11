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
    return `<li class="ev ${typeClass(o.type)}"><span class="dot"></span><div>
      <div class="ev__when mono">${S.esc(S.when(o))}</div>
      <div class="ev__t">${titleLink(o.title, o.url)}</div>
      <div class="ev__meta">${meta}</div></div></li>`;
  };

  /* Row layout (updates page, lab pages) */
  S.updateRow = (u, labs, showLab) => {
    const lab = labs[u.lab];
    const labLink = showLab && lab
      ? `<a class="ulab mono" href="${ROOT}labs/${S.esc(lab.slug)}/" style="--c:${S.safeColor(lab.color)}"><span class="dot"></span>${S.esc(lab.name)}</a>` : "";
    return `<li class="urow"><time class="mono" datetime="${S.esc(u.date)}">${S.esc(S.pretty(u.date))}</time>
      <div><h3>${titleLink(u.title, u.url)}</h3><p>${S.esc(u.summary)}</p>${labLink}</div></li>`;
  };

  /* Card layout (home rail) */
  S.updateCard = (u, labs) => {
    const lab = labs[u.lab];
    return `<li class="rail__item"><article class="ucard">
      <div class="ucard__meta mono"${lab ? ` style="--c:${S.safeColor(lab.color)}"` : ""}><span class="dot"></span>${S.esc(S.pretty(u.date))}${lab ? " · " + S.esc(lab.name) : ""}</div>
      <h3 class="ucard__title">${titleLink(u.title, u.url)}</h3>
      <p class="ucard__dek">${S.esc(u.summary)}</p>
      ${u.type ? `<div class="ucard__foot mono">${S.esc(u.type)}</div>` : ""}
    </article></li>`;
  };

  /* Horizontal rail with prev/next buttons. */
  S.rail = (section) => {
    const rail = section.querySelector(".rail");
    const prev = section.querySelector("[data-rail=prev]"), next = section.querySelector("[data-rail=next]");
    if (!rail || !prev || !next) return;
    const sync = () => {
      prev.disabled = rail.scrollLeft <= 2;
      next.disabled = rail.scrollLeft + rail.clientWidth >= rail.scrollWidth - 2;
    };
    prev.onclick = () => rail.scrollBy({ left: -rail.clientWidth * 0.8, behavior: "smooth" });
    next.onclick = () => rail.scrollBy({ left: rail.clientWidth * 0.8, behavior: "smooth" });
    rail.addEventListener("scroll", sync, { passive: true });
    new ResizeObserver(sync).observe(rail);
    sync();
  };

  /* Small label that follows the pointer over [data-cursor] elements (fine pointers only). */
  S.cursor = () => {
    if (!matchMedia("(hover: hover) and (pointer: fine)").matches) return;
    const el = document.createElement("div");
    el.className = "cursor"; el.setAttribute("aria-hidden", "true");
    document.body.appendChild(el);
    let raf = 0, x = 0, y = 0;
    document.addEventListener("pointermove", (e) => {
      const t = e.target.closest && e.target.closest("[data-cursor]");
      el.classList.toggle("on", !!t);
      if (!t) return;
      el.textContent = t.dataset.cursor;
      x = e.clientX; y = e.clientY;
      raf ||= requestAnimationFrame(() => { raf = 0; el.style.setProperty("--x", x + "px"); el.style.setProperty("--y", y + "px"); });
    });
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
    S.cursor();
    return site;
  };
})();
