/* Lab page: fills header, updates, and this lab's events from shared data. */
(async function () {
  const S = window.Site;
  const $ = (id) => document.getElementById(id);
  const slug = document.body.dataset.lab;
  await S.chrome();

  const [labs, events, updates] = await Promise.all([
    S.jsonOr("data/labs.json", []), S.jsonOr("data/events.json", []), S.jsonOr(`labs/${slug}/updates.json`, [])]);
  const bySlug = S.labsBySlug(labs);
  const lab = bySlug[slug];
  if (lab) {
    document.title = lab.name + " · " + document.title;
    $("lab-block").style.background = lab.color;
    $("lab-name").textContent = lab.name;
    $("lab-summary").textContent = lab.summary;
    if (lab.lead) $("lab-lead").textContent = "Lead: " + lab.lead;
  }
  const list = updates.slice().sort((a, b) => b.date.localeCompare(a.date));
  $("updates-list").innerHTML = list.map((u) => S.updateHtml(u, bySlug, false)).join("") || `<li class="empty">No updates yet.</li>`;

  const today = S.today();
  const mine = S.expand(events.filter((e) => e.lab === slug)).starts.filter((o) => (o.endDate || o.start) >= today).slice(0, 6);
  $("events-list").innerHTML = mine.map((o) => S.eventHtml(o, bySlug)).join("") || `<li class="empty">Nothing scheduled.</li>`;
})();
