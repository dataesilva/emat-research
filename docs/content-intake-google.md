# Content intake: Google Forms → GitHub Pages

A plan for letting lab leaders submit updates, publications, opportunities, news and events through a form, and having the site update itself without anyone editing JSON by hand.

Status: **plan only, not built yet.** (Written 2026-11-12.)

---

## Why this fits the site

The site has no build step. Every page reads plain JSON files:

| Content | File |
|---|---|
| A lab's news, publications, opportunities, milestones | `labs/<slug>/updates.json` |
| Meetings, deadlines, CFPs, conferences | `data/events.json` |
| Lab list (name, color, lead, ...) | `data/labs.json` |

GitHub Pages republishes on every commit. The whole job is to **produce those JSON files from the form data and commit them**. Nothing in the site's HTML or JS needs to change.

---

## Overview

```
Lab leader ──► Google Form ──► Google Sheet (source of truth, with an "approved" column)
                                   │
Lab Google Calendars (ICS feeds) ──┤
                                   ▼
        GitHub Action (cron every ~30 min + manual "Run workflow" button)
          1. read the Sheet and the ICS feeds
          2. check each row (date, URL, lab slug, submitter allowed)
          3. rebuild labs/<slug>/updates.json and data/events.json
          4. commit only if something changed
                                   ▼
                        GitHub Pages redeploys
```

Key decisions:

- **Pull, not push.** The GitHub Action reads from Google. No GitHub write token is stored in Google.
- **The Sheet is the source of truth.** Each sync rebuilds the generated files from the whole Sheet instead of appending to them. Editing or deleting a row edits or deletes the post, and running the sync twice is harmless.
- **Calendars come from calendars.** Meetings live in each lab's Google Calendar, not in the form, so recurring meetings, cancellations and time changes need no extra work.

---

## 1. The Google Form (updates, publications, opportunities, news)

Settings:
- **Collect email addresses: verified.** Requires sign-in.
- **Restrict to users in your organization.** Only if the labs share a Google Workspace domain.
- Allow response editing: optional. Edits made through the form update the same Sheet row.

Fields (map one-to-one to the `updates.json` format):

| Form question | Type | JSON field | Notes |
|---|---|---|---|
| Lab | Dropdown (lab names) | `lab` (slug) | Keep options in sync with `data/labs.json` |
| Type | Dropdown | `type` | `news`, `publication`, `opportunity`, `milestone` |
| Title | Short answer | `title` | Required |
| Summary | Paragraph | `summary` | Required; consider a length limit (e.g. 280 chars) |
| Date | Date | `date` | Defaults to submission date if blank |
| Link | Short answer, URL validation | `url` | Optional |
| Image | (skip for v1) | — | File uploads go to Drive and need a private sheet + service account to fetch; add later if needed |

One form with a **Type** dropdown is simpler than separate forms. Use form sections if some types need extra fields (e.g. an application deadline for opportunities).

---

## 2. The Google Sheet

Link the form to a Sheet (Responses → Link to Sheets). Google adds `Timestamp` and `Email Address` columns. Add these columns to the right of the form columns (Google won't overwrite them):

| Column | Purpose |
|---|---|
| `approved` | Checkbox. Only checked rows are published. Skip if you don't want moderation (then publish every row) |
| `hidden` | Checkbox. Unpublish a post without deleting the row |
| `id` | Optional stable ID (e.g. `=TEXT(A2,"yyyymmddhhmmss")`) for sorting/debugging |

To **edit** a post, edit the cell. To **remove** it, delete the row or tick `hidden`. The next sync picks it up.

### Sheet access: pick one

| Option | How | Pros | Cons |
|---|---|---|---|
| **A. Private sheet + service account (recommended)** | Create a Google Cloud service account, share the Sheet with its email as **Viewer**, store its JSON key as the GitHub secret `GOOGLE_SA_KEY`. Action reads via the Sheets API. | Sheet stays private (emails, unapproved rows not exposed). Can fetch Drive uploads later. | One-time Cloud Console setup. Some Workspace admins block sharing with outside service accounts. |
| B. "Publish to web" CSV | File → Share → Publish to web → CSV. Store the URL as a secret `SHEET_CSV_URL`. | Zero setup. | **Anyone with the URL can read every row**, including submitter emails and unapproved posts. Only OK if nothing in the sheet is sensitive. |

---

## 3. Who can post for which lab

Add an `editors` list to each lab in `data/labs.json`:

```json
{
  "slug": "gandolfi-lab",
  "name": "Gandolfi Lab",
  "editors": ["lead@university.edu", "manager@university.edu"]
}
```

The Action drops (and reports) any row where the submitter's email isn't in that lab's `editors`. This works together with the `approved` checkbox.

---

## 4. Calendars (meetings, deadlines, CFPs, conferences)

- Each lab keeps its meetings in a Google Calendar (lab-specific or shared).
- Get the feed: Calendar settings → *Integrate calendar* → **Secret address in iCal format** (private calendars) or **Public address** (public calendars).
- Store the feed URLs as secrets, not in the repo, because secret ICS URLs grant read access. For example, a single secret `CALENDAR_FEEDS`:
  ```json
  { "gandolfi-lab": "https://calendar.google.com/...basic.ics",
    "_group": "https://calendar.google.com/...basic.ics" }
  ```
  `_group` = group-wide calendar (deadlines, CFPs, conferences). Those events get no `lab` field, so they show as group-wide.
- **Event type:** derive from a tag in the event title or description, e.g. `[deadline]`, `[cfp]`, `[conference]`; default `meeting`.
- **Recurrence:** the site understands `"repeat": "weekly", "until": "YYYY-MM-DD"`. Map `RRULE:FREQ=WEEKLY;UNTIL=...` to that. For anything more complex, expand occurrences over a window (e.g. the next 6 months) into individual events. Python's `icalendar` + `recurring-ical-events` handle this, including cancelled occurrences.

### Generated vs. hand-edited events

Rather than mixing hand edits and sync output in one file, keep them apart:
- `data/events.manual.json`: anything hand-maintained (optional).
- `data/events.json`: **generated** by the sync from ICS feeds plus `events.manual.json`.

The site keeps reading `data/events.json` unchanged.

---

## 5. The GitHub Action

`.github/workflows/sync-content.yml` (sketch):

```yaml
name: Sync content
on:
  schedule:
    - cron: "*/30 * * * *"      # every 30 min (GitHub may delay this)
  workflow_dispatch: {}          # "Run workflow" button
  repository_dispatch:
    types: [sync]                # optional instant trigger (see §6)

permissions:
  contents: write

concurrency:
  group: sync-content
  cancel-in-progress: false

jobs:
  sync:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with: { python-version: "3.12" }
      - run: pip install google-api-python-client google-auth icalendar recurring-ical-events requests
      - name: Build JSON from Sheet + calendars
        env:
          GOOGLE_SA_KEY: ${{ secrets.GOOGLE_SA_KEY }}
          SHEET_ID: ${{ secrets.SHEET_ID }}
          CALENDAR_FEEDS: ${{ secrets.CALENDAR_FEEDS }}
        run: python scripts/sync_content.py
      - name: Commit if changed
        run: |
          git config user.name  "content-bot"
          git config user.email "41898282+github-actions[bot]@users.noreply.github.com"
          git add labs/*/updates.json data/events.json
          git diff --cached --quiet || git commit -m "Sync content from form + calendars"
          git push
```

`scripts/sync_content.py` responsibilities:
1. Load `data/labs.json` (slugs, `editors`).
2. Read Sheet rows. Keep rows that are `approved`, not `hidden`, and whose submitter is an editor of the chosen lab.
3. Check each row: valid `YYYY-MM-DD` date, `http(s)` URL, known type, non-empty title. **Skip bad rows and list them in the job summary** (`$GITHUB_STEP_SUMMARY`) so one bad row doesn't block everything.
4. Write `labs/<slug>/updates.json` for every lab, sorted newest first, pretty-printed with stable key order so diffs stay readable. Labs with no rows get `[]`.
5. Fetch ICS feeds, convert to the event format, merge with `data/events.manual.json`, write `data/events.json`.
6. If a feed or the Sheet can't be reached, **fail without writing**, so a Google outage doesn't wipe the site.

### Cron caveats
- GitHub cron is best-effort; runs can be several minutes to an hour late at busy times.
- In **public repos, scheduled workflows are disabled after 60 days without repo activity.** The bot's commits count as activity, but a quiet stretch can still disable it. GitHub emails a warning; re-enable from the Actions tab.

---

## 6. Optional: instant updates (push trigger)

If 30 minutes is too slow, have Google *notify* GitHub to run the sync right away. Google still sends no data; the Action reads it the usual way.

- In the Sheet: Extensions → Apps Script, add an `onFormSubmit` (installable) trigger that POSTs to
  `https://api.github.com/repos/<owner>/<repo>/dispatches` with body `{"event_type":"sync"}`.
- Needs a **fine-grained personal access token** limited to **this one repo**, with **Contents: read & write** (required for `repository_dispatch`), stored in Apps Script's Script Properties, not in the code.
- Trade-off: a token that can write to the repo lives in Google. Keep the cron as a fallback.

---

## 7. Migration

Before the first sync, copy the existing entries in `labs/*/updates.json` into the Sheet (approved, with an editor's email), and move any hand-made events into `data/events.manual.json` or a calendar. The first sync rebuilds these files and **will overwrite anything that isn't in the Sheet or a calendar.**

Also update the README's "Lab members editing their own pages" section: once this is live, those JSON files are generated, so hand edits to them get overwritten.

---

## 8. Setup checklist

- [ ] Create the Google Form (fields in §1), restrict to org, collect verified emails
- [ ] Link to a Sheet; add `approved` / `hidden` columns
- [ ] Create a service account; share the Sheet with it (Viewer); add `GOOGLE_SA_KEY` and `SHEET_ID` secrets
- [ ] Add `editors` to each lab in `data/labs.json`
- [ ] Collect ICS URLs per lab plus the group calendar; add the `CALENDAR_FEEDS` secret
- [ ] Agree on calendar title tags (`[deadline]`, `[cfp]`, `[conference]`)
- [ ] Add `scripts/sync_content.py` and `.github/workflows/sync-content.yml`
- [ ] Migrate existing content (§7)
- [ ] Run the workflow manually once; check the job summary and the site
- [ ] (Optional) Apps Script instant trigger (§6)
- [ ] Write a one-paragraph "how to post" note for lab leaders (form link, what `approved` means, how to edit/remove)

## Open decisions

- Moderation: does someone approve each post, or do editors publish directly?
- Image uploads: needed in v1?
- Private vs. published Sheet (§2)
- Sync interval vs. instant trigger

---

## Alternatives considered

- **Microsoft Forms + Power Automate → GitHub issue → Action.** The equivalent if labs live in Microsoft 365. Uses the Standard GitHub connector; avoid the Premium HTTP action. Forms only adds posts; use a Microsoft List as the source of truth if posts need editing.
- **Pages CMS / Sveltia CMS.** A proper editing UI over the existing JSON files, but every editor needs a GitHub account and repo access.
- **GitHub Issue Forms.** Everything stays in GitHub, but it needs GitHub accounts and is awkward for edits.
- **Site reads the Google Sheet directly in the browser.** Rejected: no review step, no history, no validation, and the site breaks if Google changes anything.
