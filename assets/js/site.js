/* Shared helpers + header/footer. No dependencies, no build step. */
(function () {
  const script = document.currentScript;
  const ROOT = (script && script.dataset.root) || "./";

  const S = (window.Site = {});
  S.root = ROOT;

  S.esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  S.safeUrl = (u) => (/^https?:\/\//i.test(u || "") ? u : "");
  S.json = (path) => fetch(ROOT + path).then((r) => { if (!r.ok) throw new Error(path + " " + r.status); return r.json(); });
  S.jsonOr = (path, fallback) => S.json(path).catch(() => fallback);

  // Dates are handled as local "YYYY-MM-DD" strings to avoid timezone shifts.
  S.parse = (s) => { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); };
  S.fmt = (d) => d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  S.addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
  S.pretty = (s, opts) => S.parse(s).toLocaleDateString(undefined, opts || { year: "numeric", month: "short", day: "numeric" });
  S.today = () => S.fmt(new Date());

  S.labsBySlug = (labs) => Object.fromEntries(labs.map((l) => [l.slug, l]));

  /* Expand events (incl. weekly repeats and multi-day spans).
     Returns { starts: [occurrence], byDay: {date: [occurrence]} } */
  S.expand = (events) => {
    const starts = [], byDay = {};
    for (const e of events) {
      const first = S.parse(e.date);
      const last = e.repeat === "weekly" ? S.parse(e.until || S.fmt(S.addDays(first, 364))) : first;
      for (let d = first; d <= last; d = S.addDays(d, e.repeat === "weekly" ? 7 : 1)) {
        const start = S.fmt(d);
        const occ = Object.assign({}, e, { start });
        starts.push(occ);
        const span = e.endDate ? Math.round((S.parse(e.endDate) - first) / 864e5) : 0;
        for (let i = 0; i <= span; i++) (byDay[S.fmt(S.addDays(d, i))] ||= []).push(occ);
        if (e.repeat !== "weekly") break;
      }
    }
    const key = (o) => o.start + (o.time || "");
    starts.sort((a, b) => key(a).localeCompare(key(b)));
    return { starts, byDay };
  };

  S.typeLabel = { meeting: "Meeting", deadline: "Deadline", cfp: "Call for papers", conference: "Conference" };

  S.when = (o) => {
    let s = S.pretty(o.start, { weekday: "short", month: "short", day: "numeric", year: "numeric" });
    if (o.endDate && o.endDate !== o.start) s += " – " + S.pretty(o.endDate, { month: "short", day: "numeric" });
    if (o.time) s += " · " + o.time + (o.endTime ? "–" + o.endTime : "");
    return s;
  };

  S.eventHtml = (o, labs) => {
    const lab = o.lab && labs[o.lab];
    const url = S.safeUrl(o.url);
    const title = url ? `<a href="${S.esc(url)}" rel="noopener">${S.esc(o.title)}</a>` : S.esc(o.title);
    const meta = [o.location && "📍 " + S.esc(o.location), lab && S.esc(lab.name), o.notes && S.esc(o.notes)].filter(Boolean).join(" · ");
    return `<li class="ev"><div class="when">${S.esc(S.when(o))}</div>
      <div class="t"><span class="type ${S.esc(o.type)}">${S.esc(S.typeLabel[o.type] || o.type)}</span>${title}</div>
      ${meta ? `<div class="meta">${meta}</div>` : ""}</li>`;
  };

  S.updateHtml = (u, labs, showLab) => {
    const lab = labs[u.lab];
    const url = S.safeUrl(u.url);
    const title = url ? `<a href="${S.esc(url)}" rel="noopener">${S.esc(u.title)}</a>` : S.esc(u.title);
    const tag = showLab && lab ? `<a class="tag" style="background:${S.esc(lab.color)}" href="${ROOT}labs/${S.esc(lab.slug)}/">${S.esc(lab.name)}</a>` : "";
    return `<li class="update"><time datetime="${S.esc(u.date)}">${S.esc(S.pretty(u.date))}</time>
      <div><h3>${title}</h3><p>${tag}${S.esc(u.summary)}</p></div></li>`;
  };

  /* Download every event as an .ics file (floating local times). */
  S.ics = (events) => {
    const compact = (s) => s.replace(/-/g, "");
    const t = (x) => x.replace(":", "") + "00";
    const esc = (s) => String(s || "").replace(/([,;\\])/g, "\\$1").replace(/\n/g, "\\n");
    const L = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//EMAT Research//Calendar//EN"];
    events.forEach((e, i) => {
      L.push("BEGIN:VEVENT", `UID:emat-${i}-${compact(e.date)}@emat-research`, `DTSTAMP:${compact(S.today())}T000000`);
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
    const blob = new Blob([L.join("\r\n")], { type: "text/calendar" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = "emat-research.ics"; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };

  /* Header + footer */
  S.chrome = async () => {
    const site = await S.jsonOr("data/site.json", { name: "Research Group" });
    const h = document.getElementById("site-header");
    const f = document.getElementById("site-footer");
    if (h) {
      h.className = "site-header";
      h.innerHTML = `<div class="wrap"><a class="brand" href="${ROOT}"><span class="blocks" aria-hidden="true"><i></i><i></i><i></i></span>${S.esc(site.name)}</a>
        <nav class="nav" aria-label="Main"><a href="${ROOT}#labs">Labs</a><a href="${ROOT}#updates">Updates</a><a href="${ROOT}#calendar">Calendar</a></nav></div>`;
    }
    if (f) {
      f.className = "site-footer";
      f.innerHTML = `<div class="wrap"><div>© ${new Date().getFullYear()} ${S.esc(site.name)}</div>
        <div>${site.contact ? `<a href="mailto:${S.esc(site.contact)}">${S.esc(site.contact)}</a>` : ""}</div></div>`;
    }
    return site;
  };
})();
