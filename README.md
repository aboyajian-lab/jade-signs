# Jade Big Screen — Live Signage

Feeds the Rockbot Live Web zone for The Jade Apartments courtyard TV.

- `main.html` — landscape zone (1920×1080 rotation)
- `banner.html` — sidebar zone (442×1080 rotation)
- `screen.html` — main + sidebar composite in one 1920×1080 (the Rockbot content-area asset)
- `preview.html` — view-only: what is in rotation at any moment (venue time, scrubbable)
- `jade-sched.js` — **shared scheduling semantics** (venue time zone, featured event, countdown,
  chip, overnight). Loaded by the player pages *and* the preview so they cannot disagree.
- `jade-screen.js` / `jade-screen.css` — the player (rotation, transitions, cards, weather)
- `playlist.json` — the deployment: which signs are active, their times, rotation config
- `signs/` — exported sign PNGs (main_signs + side_banners, matching filenames)
- `build_playlist.py` — regenerates playlist.json from the monthly schedule CSV
- `qa_sched.js` — scheduling QA (Node, no browser): scrubs the acceptance moments through
  jade-sched.js. Run with `TZ=UTC` too — output must not change.
- `qa_screen.js` — render QA (headless Chromium): every card state at exact pixel size, fails
  on overflow / clipping / JS errors.

Pages self-refresh their data every 5 minutes; a sign past its end date drops out
automatically. Publishing = commit new PNGs + updated playlist.json.

## Scheduling rules (v3, 2026-09-07)

All times are **America/New_York wall clock**, regardless of the device the page runs on
(`jade-sched.js` converts "now" with `Intl`; playlist strings like `2026-09-05T19:00` are
never parsed with `new Date()`). Comparisons are string comparisons at minute precision.

- A sign has `at` (one event) **or** `airings: [...]` (many real instances, one PNG).
  Series signs (`series: true`, `cadence: "Saturdays · 12:00 PM"`) are the consolidated
  Gameday / NFL Sundays / TNF-MNF cards; each airing counts down and chips like a normal event.
- **Featured event** = today's next start still ahead → else today's most recent start
  ("live", kept for the rest of the day) → else the next future instance.
  The corner chip and the countdown card are both derived from this one answer.
- **Countdown card** shows when the featured event is upcoming within
  `config.countdown.lead_hours` (36) or live. Live = the SHOWTIME / GAME TIME variant
  (`.cdwrap.live`): timer hidden, when-line keeps the scheduled start. Grace = rest of the
  event day (overnight at 22:00 ends it; the next countdown begins at 06:00).
- **Chip** shows only for today's featured event. Kicker = TODAY before 17:00, TONIGHT after.
- **Overnight** 22:00–06:00 venue time: bouncer + live night cards, no chip, no countdown.
- Demo params: `?demo=countdown`, `?demo=showtime`, `?demo=overnight`, `?demo=weather`.
  QA time travel: `?at=2026-09-05T15:00` (venue time) runs the page as if it were that moment — never on the Rockbot URL.

Removed in v3: `overnight_mains` / `overnight_banners` (overnight is live HTML — the PNG lists
were never read). The PNGs stay in `signs/overnight*` only as archive.

## Before every push

```
node qa_sched.js && TZ=UTC node qa_sched.js
python -m http.server 8100      # from this folder, in another shell
node qa_screen.js http://localhost:8100 --shots ./qa-shots
```
