/* Lab page: hero mark in the lab's color, updates, and this lab's upcoming events. */
(async function () {
  const S = window.Site;
  const $ = (id) => document.getElementById(id);
  const slug = document.body.dataset.lab;
  const [site, labs, events, updates] = await Promise.all([
    S.chrome(), S.jsonOr("data/labs.json", []), S.jsonOr("data/events.json", []), S.jsonOr(`labs/${slug}/updates.json`, [])]);
  const bySlug = S.labsBySlug(labs);
  const lab = bySlug[slug] || { name: slug, summary: "", color: "#ffffff" };
  const color = S.safeColor(lab.color);

  document.title = lab.name + " · " + (site.name || "");
  $("lab-name").textContent = lab.name;
  $("lab-summary").textContent = lab.summary;
  $("lab-lead").textContent = lab.lead ? "Lead · " + lab.lead : "";
  $("lab-themes").textContent = (lab.themes || []).join(" / ");
  new window.Mark($("hero"), { mask: lab.mark || site.mark, base: color, accents: ["#ffffff"], dust: 50 });

  const list = updates.map((u) => Object.assign({ lab: slug }, u)).sort((a, b) => b.date.localeCompare(a.date));
  $("updates-list").innerHTML = list.map((u) => S.updateRow(u, bySlug, false)).join("") || `<li class="empty">No updates yet.</li>`;

  const today = S.today();
  const mine = S.expand(events.filter((e) => e.lab === slug)).starts.filter((o) => (o.endDate || o.start) >= today).slice(0, 6);
  $("events-list").innerHTML = mine.map((o) => S.eventHtml(o, bySlug)).join("") || `<li class="empty">Nothing scheduled.</li>`;
  $("lab-ics").onclick = () => S.ics(events.filter((e) => e.lab === slug), lab.name);
})();
