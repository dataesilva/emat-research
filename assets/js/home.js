/* Landing page: labs grid, aggregated updates, calendar. */
(async function () {
  const S = window.Site;
  const $ = (id) => document.getElementById(id);
  const site = await S.chrome();
  $("hero-title").textContent = site.tagline || "";
  $("hero-sub").textContent = site.description || "";

  const [labs, events] = await Promise.all([S.jsonOr("data/labs.json", []), S.jsonOr("data/events.json", [])]);
  const bySlug = S.labsBySlug(labs);

  /* ---- Labs ---- */
  $("labs-grid").innerHTML = labs.map((l) => `
    <a class="card" href="labs/${S.esc(l.slug)}/">
      <div class="tile" style="background:${S.esc(l.color)}">${S.esc(l.name)}</div>
      <h3>${S.esc(l.name)}</h3><p>${S.esc(l.summary)}</p></a>`).join("") || `<p class="empty">No labs listed yet.</p>`;

  /* ---- Updates (aggregated from labs/<slug>/updates.json) ---- */
  const perLab = await Promise.all(labs.map(async (l) =>
    (await S.jsonOr(`labs/${l.slug}/updates.json`, [])).map((u) => Object.assign({ lab: l.slug }, u))));
  const updates = perLab.flat().sort((a, b) => b.date.localeCompare(a.date));
  let labFilter = "all";
  const LIMIT = 10;
  const chipBox = $("update-chips");
  chipBox.innerHTML = [`<button class="chip" data-lab="all" aria-pressed="true">All</button>`]
    .concat(labs.map((l) => `<button class="chip" data-lab="${S.esc(l.slug)}" aria-pressed="false">${S.esc(l.name)}</button>`)).join("");
  const drawUpdates = () => {
    const list = updates.filter((u) => labFilter === "all" || u.lab === labFilter).slice(0, LIMIT);
    $("updates-list").innerHTML = list.map((u) => S.updateHtml(u, bySlug, true)).join("") || `<li class="empty">No updates yet.</li>`;
  };
  chipBox.addEventListener("click", (e) => {
    const b = e.target.closest(".chip"); if (!b) return;
    labFilter = b.dataset.lab;
    chipBox.querySelectorAll(".chip").forEach((c) => c.setAttribute("aria-pressed", String(c === b)));
    drawUpdates();
  });
  drawUpdates();

  /* ---- Calendar ---- */
  const { starts, byDay } = S.expand(events);
  const types = ["meeting", "deadline", "cfp", "conference"];
  const active = new Set(types);
  let labCal = "all";
  let view = new Date(); view.setDate(1);
  let selected = null;

  const keep = (o) => active.has(o.type) && (labCal === "all" || o.lab === labCal || (!o.lab && labCal === "none"));

  $("cal-filters").innerHTML =
    types.map((t) => `<button class="chip" data-type="${t}" aria-pressed="true">${S.esc(S.typeLabel[t])}</button>`).join("") +
    `<select id="cal-lab" class="chip" aria-label="Filter by lab"><option value="all">All labs</option>${labs.map((l) => `<option value="${S.esc(l.slug)}">${S.esc(l.name)}</option>`).join("")}<option value="none">Group-wide</option></select>`;
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
    const gridStart = S.addDays(new Date(y, m, 1), -new Date(y, m, 1).getDay());
    const today = S.today();
    let html = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => `<div class="cal-dow">${d}</div>`).join("");
    for (let i = 0; i < 42; i++) {
      const d = S.addDays(gridStart, i), key = S.fmt(d);
      if (i >= 35 && d.getMonth() !== m) break;
      const evs = (byDay[key] || []).filter(keep);
      const cls = ["cal-day", d.getMonth() !== m && "out", key === today && "today", evs.length && "has", key === selected && "sel"].filter(Boolean).join(" ");
      const pips = evs.slice(0, 3).map((o) => `<span class="pip ${S.esc(o.type)}">${S.esc(o.title)}</span>`).join("") + (evs.length > 3 ? `<span class="label">+${evs.length - 3} more</span>` : "");
      html += `<button type="button" class="${cls}" data-day="${key}" aria-label="${S.esc(S.pretty(key))}${evs.length ? ", " + evs.length + " events" : ""}"><span class="n">${d.getDate()}</span>${pips}</button>`;
    }
    $("cal-grid").innerHTML = html;
    drawAgenda();
  }

  function drawAgenda() {
    let list, title;
    if (selected) {
      title = S.pretty(selected, { weekday: "long", month: "long", day: "numeric" });
      list = (byDay[selected] || []).filter(keep);
    } else {
      title = "Upcoming";
      list = starts.filter((o) => (o.endDate || o.start) >= S.today() && keep(o)).slice(0, 8);
    }
    $("agenda-title").textContent = title;
    $("agenda-clear").hidden = !selected;
    $("agenda-list").innerHTML = list.map((o) => S.eventHtml(o, bySlug)).join("") || `<li class="empty">Nothing scheduled.</li>`;
  }

  $("cal-grid").addEventListener("click", (e) => {
    const b = e.target.closest("[data-day]"); if (!b) return;
    selected = selected === b.dataset.day ? null : b.dataset.day;
    drawCal();
  });
  $("agenda-clear").addEventListener("click", () => { selected = null; drawCal(); });
  $("cal-prev").addEventListener("click", () => { view = new Date(view.getFullYear(), view.getMonth() - 1, 1); drawCal(); });
  $("cal-next").addEventListener("click", () => { view = new Date(view.getFullYear(), view.getMonth() + 1, 1); drawCal(); });
  $("cal-today").addEventListener("click", () => { view = new Date(); view.setDate(1); selected = null; drawCal(); });
  $("cal-ics").addEventListener("click", () => S.ics(events));
  drawCal();
})();
