"""Regenerate playlist.json (v3 schema) from the monthly schedule CSV.
Usage: python build_playlist.py [schedule_clean.csv] [--start YYYY-MM-DD]
  --start  campaign start written to every sign (default: today). Pass the original
           campaign start when re-running mid-month so past signs stay in the file
           for the preview's "All signs" tab / scrubbing (e.g. --start 2026-08-04).

Input CSV columns: Date (YYYY-MM-DD), Start Time (h:mm AM/PM), Title, Category, Theme.
(claude-design-handoff\\jade_schedule_aug-sep_2026_clean.csv is the current source.)

How rows become signs
- A row whose own PNG exists (signs/main_signs/<slug(title)>_<date>.png) is a one-shot
  sign: `at` = that date+time.
- A row with no PNG of its own is FOLDED into a shared sign via FOLD (matched on the
  exact Title first, then the exact Theme). Shared signs carry every folded start as
  `airings` (sorted), run through the last airing date, and — when `series` is true —
  are described in the preview by their `cadence` label instead of a one-shot stamp.
  This is the Showrunner fix-brief "option B" (real recurring instances, one card).
- Rows that match nothing and have no PNG are reported and skipped.

Schema v3 (2026-09-07) — read by jade-sched.js / jade-screen.js / preview.html:
  sign: file, title, theme, kind (movie|sports), start, end, and EITHER `at` OR
        `airings: [..]` (+ `series: true`, `cadence: "..."`). Times are timezone-less
        America/New_York wall clock ("2026-09-05T19:00").
  Removed in v3: overnight_mains / overnight_banners (overnight is live HTML —
  `overnight_cards` — the PNG lists were loaded and never used).
"""
import csv, json, os, re, sys
from collections import OrderedDict
from datetime import date

HERE = os.path.dirname(os.path.abspath(__file__))
args = sys.argv[1:]
START = str(date.today())
if "--start" in args:
    i = args.index("--start"); START = args[i + 1]; del args[i:i + 2]
CSV = args[0] if args else os.path.join(HERE, "schedule_clean.csv")
MAIN = os.path.join(HERE, "signs", "main_signs")

def slug(t): return re.sub(r"[^a-z0-9]+", "_", t.lower()).strip("_")
def to24(t12):
    m = re.match(r"\s*(\d+):(\d+)\s*(AM|PM)", t12, re.I)
    if not m: return None   # "TBD" start time -> sign runs in rotation with no countdown
    h = int(m.group(1)); ap = m.group(3).upper()
    if ap == "PM" and h != 12: h += 12
    if ap == "AM" and h == 12: h = 0
    return "%02d:%s" % (h, m.group(2))

# Rows without their own PNG are folded into a shared sign. Key = exact CSV Title or
# exact CSV Theme; value = sign stem (filename = stem + "_" + first airing date + ".png").
FOLD = {
    "College Gameday @ Jade":            "college_gameday_at_jade",
    "NFL Sundays 4 Games":               "nfl_sundays_at_jade",
    "🏈 NFL Sunday Night Football":      "nfl_sundays_at_jade",
    "🏈 NFL Monday Night Football":      "thursday_monday_night_football_at_jade",
    "🏈 NFL Thursday Night Football":    "thursday_monday_night_football_at_jade",
    "🏈 NFL Preseason":                  "nfl_preseason_at_jade",
    "Florida State at Alabama":          "florida_state_at_alabama_florida_at_auburn",
    "Florida at Auburn":                 "florida_state_at_alabama_florida_at_auburn",
}
# One-shot signs whose PNG was named by hand rather than slug(title).
ALIAS = {
    "Ferris Bueller's Day Off": "ferris_bueller",
    "The Lord of the Rings: The Fellowship of the Ring": "lotr_fellowship",
}
# stem -> (display title, theme, cadence label as printed on the art, series?)
SHARED = {
    "college_gameday_at_jade": ("College Gameday @ Jade", "🏈 College Gameday @ Jade", "Saturdays · 12:00 PM", True),
    "nfl_sundays_at_jade": ("NFL Sundays @ Jade", "🏈 NFL Sunday @ Jade", "Sundays · 1:00 PM · 4:05 / 4:25 PM · SNF 8:20 PM", True),
    "thursday_monday_night_football_at_jade": ("Thursday & Monday Night Football @ Jade", "🏈 NFL Weekly", "Mondays & Thursdays · 8:15 PM", True),
    "nfl_preseason_at_jade": ("NFL Preseason @ Jade", "🏈 NFL Preseason", "Aug 14 & Aug 22", True),
    "florida_state_at_alabama_florida_at_auburn": ("Florida State at Alabama + Florida at Auburn", "🏈 College Gameday @ Jade", None, False),
}

def kind_of(category, theme):
    """'sports' drives the broadcast countdown variant. Anything not a Movie is sports
    (Category 'Sports' or 'Recurring Watch Party')."""
    return "movie" if (category or "").strip().lower() == "movie" else "sports"

today = START
signs, shared, skipped = [], OrderedDict(), []
if os.path.exists(CSV):
    with open(CSV, encoding="utf-8-sig") as f:
        for r in csv.DictReader(f):
            t24 = to24(r["Start Time"])
            at = (r["Date"] + "T" + t24) if t24 else None
            own = f"{ALIAS.get(r['Title'].strip(), slug(r['Title']))}_{r['Date']}.png"
            if not at:   # TBD start time: never publish a sign without a time (qa_sched rule) — add it when the kickoff is set
                skipped.append(f"{r['Date']} {r['Title']} (start time TBD — re-run when set)"); continue
            if os.path.exists(os.path.join(MAIN, own)):
                if any(s["file"] == own for s in signs): continue
                sign = {"file": own, "title": r["Title"], "theme": r["Theme"],
                        "kind": kind_of(r.get("Category"), r["Theme"]),
                        "start": today, "end": r["Date"]}
                sign["at"] = at
                signs.append(sign)
                continue
            stem = FOLD.get(r["Title"].strip()) or FOLD.get(r["Theme"].strip())
            if not stem:
                skipped.append(f"{r['Date']} {r['Title']} (no PNG, no FOLD rule)"); continue
            shared.setdefault((stem, at[:7]), []).append(at)   # one shared sign per stem per month (each month has its own art)
else:
    print(f"WARNING: {CSV} not found — no event signs written", file=sys.stderr)

for (stem, _month), ats in shared.items():
    ats = sorted(set(ats))
    fn = f"{stem}_{ats[0][:10]}.png"
    if not os.path.exists(os.path.join(MAIN, fn)):
        skipped.append(f"{fn} (shared sign PNG missing)"); continue
    title, theme, cadence, series = SHARED[stem]
    s = {"file": fn, "title": title, "theme": theme, "kind": "sports",
         "start": today, "end": ats[-1][:10], "airings": ats}
    if series: s["series"] = True; s["cadence"] = cadence
    signs.append(s)

signs.sort(key=lambda s: s["end"])
# A sign whose last event date is already past would get end < start and never show.
signs = [s for s in signs if s["end"] >= s["start"]]

def listdir(sub):
    """Files in signs/<sub>/. A sign listed in signs/<sub>/_dates.json as
    {"file.png": {"start": "YYYY-MM-DD", "end": "YYYY-MM-DD"}} is emitted as a dated
    object and only shows between those dates (season signs like Spooktober)."""
    p = os.path.join(HERE, "signs", sub)
    if not os.path.isdir(p): return []
    dates = {}
    dj = os.path.join(p, "_dates.json")
    if os.path.exists(dj): dates = json.load(open(dj, encoding="utf-8"))
    out = []
    for f in sorted(os.listdir(p)):
        if not f.lower().endswith(".png"): continue
        out.append({"file": f, **dates[f]} if f in dates else f)
    return out

out = {
    "config": {
        "dwell_seconds": 12, "data_refresh_minutes": 5, "nightly_reload_hour": 4,
        "transitions": ["slide-left","slide-up","zoom","flip","slide-right"], "transition_ms": 650,
        "overnight": {"start": "22:00", "end": "06:00", "bounce_seconds": 120, "sign_seconds": 25},
        "countdown": {"lead_hours": 36, "every_n": 3},
        "general_every_n": 3,
        "chip": {"enabled": True},
        "weather": {"enabled": True, "lat": 28.0222, "lon": -81.7328,
                    "label": "JADE COURTYARD · WINTER HAVEN", "label_short": "WINTER HAVEN",
                    "every_n": 4, "dwell_seconds": 14, "refresh_minutes": 20}
    },
    # Overnight cards are rendered live by jade-screen.js (moving background). Edit copy here.
    "overnight_cards": [
        {"kicker": "CLOSED · 10 PM – 6 AM", "title": "COURTYARD\nCLOSED",
         "sub": "All activities are recorded."},
        {"kicker": "10 PM – 6 AM", "title": "QUIET\nHOURS",
         "sub": "Please be respectful\nof your neighbors."}
    ],
    "signs": signs,
    "general_mains": listdir("general_mains"),
    "general_banners": listdir("general_banners")
}
json.dump(out, open(os.path.join(HERE, "playlist.json"), "w", encoding="utf-8"), indent=2, ensure_ascii=False)
n_air = sum(len(s.get("airings", [])) for s in signs)
print(f"playlist.json written - {len(signs)} event signs ({n_air} series/shared airings)")
for s in skipped: print("  skipped:", s)
