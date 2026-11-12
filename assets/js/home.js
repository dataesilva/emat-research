/* Landing page: hero mark, labs rail, rotating themes, updates rail, calendar, about. */
(async function () {
  const S = window.Site;
  const $ = (id) => document.getElementById(id);
  const [site, labs, events] = await Promise.all([S.chrome(), S.jsonOr("data/labs.json", []), S.jsonOr("data/events.json", [])]);
  const bySlug = S.labsBySlug(labs);

  /* ---- Hero ---- */
  $("hero-headline").innerHTML = (site.headline || []).map((l) => `<p class="hero__line">${S.esc(l)}</p>`).join("");
  new window.Mark($("hero"), { mask: site.mark, accents: labs.map((l) => S.safeColor(l.color)) });

  /* ---- Labs rail ---- */
  $("labs-list").innerHTML = labs.map((l) => `
    <li class="rail__item"><article class="lcard" data-cursor="Visit lab">
      <div class="lcard__art" style="--c:${S.safeColor(l.color)}">
        ${S.safeUrl(l.image) || /^[\w./-]+$/.test(l.image || "") ? `<img src="${S.esc(l.image)}" alt="" loading="lazy">` : ""}
        <div class="lcard__lens"></div>
        <span class="mono" style="--c:${S.safeColor(l.color)}"><span class="dot"></span>${S.esc((l.themes || [])[0] || "")}</span>
      </div>
      <h3 class="lcard__title"><a class="lcard__link" href="labs/${S.esc(l.slug)}/">${S.esc(l.name)}</a></h3>
      <p class="lcard__dek">${S.esc(l.summary)}</p>
      ${l.lead ? `<p class="mono muted" style="margin:0">${S.esc(l.lead)}</p>` : ""}
    </article></li>`).join("") || `<li class="empty">No labs listed yet.</li>`;
  S.rail($("labs"));

  // Seep + lens follow the pointer inside each tile (CSS transitions the registered props).
  $("labs-list").addEventListener("pointermove", (e) => {
    const art = e.target.closest(".lcard") && e.target.closest(".lcard").querySelector(".lcard__art");
    if (!art) return;
    const r = art.getBoundingClientRect();
    art.style.setProperty("--mx", (((e.clientX - r.left) / r.width) * 100).toFixed(1) + "%");
    art.style.setProperty("--my", (((e.clientY - r.top) / r.height) * 100).toFixed(1) + "%");
  });

  /* ---- Updates (loaded early: they also set the group's activity level) ---- */
  const updates = await S.allUpdates(labs);
  S.setActivity(updates, events);

  /* ---- Rotating themes (collected from every lab) ----
     Drifts upward at a pace set by activity, surges with scroll speed, coasts back,
     and slows almost to a stop (never quite) under the pointer. */
  const themes = labs.flatMap((l) => (l.themes || []).map((t) => ({ t, slug: l.slug })));
  if (themes.length) {
    const track = $("themes-track"), win = track.parentElement;
    const list = `<ul class="themes__list">${themes.map(({ t, slug }) => `<li><a href="labs/${S.esc(slug)}/">${S.esc(t)}</a></li>`).join("")}</ul>`;
    track.innerHTML = list + list.replace("<ul", '<ul aria-hidden="true"');   // duplicated for a seamless loop
    track.lastElementChild.querySelectorAll("a").forEach((a) => (a.tabIndex = -1));
    if (!S.reduce.matches) {
      let off = 0, speed = 0, hover = false, raf = 0, last = 0;
      const base = 0.28 + 0.32 * S.activity;                              // px per frame
      const loop = (now) => {
        const dt = Math.min(3, (now - (last || now)) / 16.67 || 1); last = now;
        const target = hover ? 0.04 : base + Math.min(7, Math.abs(S.scrollVel) * 0.22);
        speed += (target - speed) * (target > speed ? 0.08 : 0.025);      // quick to surge, slow to calm
        const half = track.scrollHeight / 2;
        off = half ? (off + speed * dt) % half : 0;
        track.style.transform = `translateY(${-off.toFixed(2)}px)`;
        raf = requestAnimationFrame(loop);
      };
      win.addEventListener("pointerenter", () => (hover = true));
      win.addEventListener("pointerleave", () => (hover = false));
      win.addEventListener("focusin", () => (hover = true));
      win.addEventListener("focusout", () => (hover = false));
      new IntersectionObserver(([en]) => {
        if (en.isIntersecting && !raf) { last = 0; raf = requestAnimationFrame(loop); }
        else if (!en.isIntersecting) { cancelAnimationFrame(raf); raf = 0; }
      }).observe(win);
    }
  } else {
    document.querySelector(".themes").hidden = true;
  }

  /* ---- Updates rail ---- */
  $("updates-list").innerHTML = updates.slice(0, 12).map((u) => S.updateCard(u, bySlug)).join("") || `<li class="empty">No updates yet.</li>`;
  S.rail($("updates"));

  /* ---- Calendar ---- */
  const { starts, byDay } = S.expand(events);
  const active = new Set(S.types);
  let labCal = "all", selected = null;
  let view = new Date(); view.setDate(1);
  const keep = (o) => active.has(o.type) && (labCal === "all" || o.lab === labCal || (labCal === "none" && !o.lab));

  $("cal-filters").innerHTML =
    S.types.map((t) => `<button class="toggle ${t}" data-type="${t}" aria-pressed="true">${S.esc(S.typeLabel[t])}</button>`).join("") +
    `<select id="cal-lab" class="select mono" aria-label="Filter by lab"><option value="all">All labs</option>${labs.map((l) => `<option value="${S.esc(l.slug)}">${S.esc(l.name)}</option>`).join("")}<option value="none">Group-wide only</option></select>`;
  $("cal-filters").addEventListener("click", (e) => {
    const b = e.target.closest("[data-type]"); if (!b) return;
    const t = b.dataset.type;
    active.has(t) ? active.delete(t) : active.add(t);
    b.setAttribute("aria-pressed", String(active.has(t)));
    drawCal();
  });
  $("cal-lab").addEventListener("change", (e) => { labCal = e.target.value; drawCal(); });

  function drawCal() {
    const y = view.getFullYear(), m = view.getMonth();
    $("cal-title").textContent = view.toLocaleDateString(undefined, { month: "long", year: "numeric" });
    const first = new Date(y, m, 1), gridStart = S.addDays(first, -first.getDay()), today = S.today();
    let html = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => `<div class="cal-dow mono">${d}</div>`).join("");
    for (let i = 0; i < 42; i++) {
      const d = S.addDays(gridStart, i), key = S.fmt(d);
      if (i % 7 === 0 && i >= 28 && d.getMonth() !== m) break;
      const evs = (byDay[key] || []).filter(keep);
      const cls = ["cal-day", d.getMonth() !== m && "out", key === today && "today", evs.length && "has", key === selected && "sel"].filter(Boolean).join(" ");
      const bars = evs.slice(0, 3).map((o) => {
        const p = S.pulse(o);
        return `<span class="bar ${S.types.includes(o.type) ? o.type : ""}${p.cls}" style="${p.style}">${S.esc(o.title)}</span>`;
      }).join("")
        + (evs.length > 3 ? `<span class="cal-more">+${evs.length - 3} more</span>` : "");
      html += `<button type="button" class="${cls}" data-day="${key}" aria-label="${S.esc(S.pretty(key))}${evs.length ? ", " + evs.length + " events" : ""}"><span class="n">${d.getDate()}</span>${bars}</button>`;
    }
    $("cal-grid").innerHTML = html;
    drawAgenda();
  }

  function drawAgenda() {
    const list = selected
      ? (byDay[selected] || []).filter(keep)
      : starts.filter((o) => (o.endDate || o.start) >= S.today() && keep(o)).slice(0, 8);
    $("agenda-title").textContent = selected ? S.pretty(selected, { weekday: "long", month: "long", day: "numeric" }) : "Upcoming";
    $("agenda-clear").hidden = !selected;
    $("agenda-list").innerHTML = list.map((o) => S.eventHtml(o, bySlug)).join("") || `<li class="empty">Nothing scheduled.</li>`;
  }

  $("cal-grid").addEventListener("click", (e) => {
    const b = e.target.closest(".cal-day.has"); if (!b) return;
    selected = selected === b.dataset.day ? null : b.dataset.day;
    drawCal();
  });
  $("agenda-clear").onclick = () => { selected = null; drawCal(); };
  $("cal-prev").onclick = () => { view = new Date(view.getFullYear(), view.getMonth() - 1, 1); drawCal(); };
  $("cal-next").onclick = () => { view = new Date(view.getFullYear(), view.getMonth() + 1, 1); drawCal(); };
  $("cal-today").onclick = () => { view = new Date(); view.setDate(1); selected = null; drawCal(); };
  $("cal-ics").onclick = () => S.ics(events, site.name);
  drawCal();

  /* ---- About ---- */
  $("about-text").textContent = site.about || "";
  $("about-actions").innerHTML = (site.contact ? `<a class="btn" href="mailto:${S.esc(site.contact)}">Get in touch</a>` : "") + `<a class="btn" href="#labs">Explore the labs</a>`;
})();
