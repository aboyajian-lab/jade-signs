"""Regenerate playlist.json (v2 schema) from the monthly schedule CSV.
Usage: python build_playlist.py [schedule.csv]
Event signs come from the CSV (+EXTRA consolidated entries below); general/overnight
sets are discovered from the signs/ subfolders. Each sign runs generation-day
through its end date; 'at' powers the live countdown cards.
"""
import csv, json, os, re, sys
from datetime import date

HERE = os.path.dirname(os.path.abspath(__file__))
CSV = sys.argv[1] if len(sys.argv) > 1 else os.path.join(HERE, "schedule_clean.csv")

def slug(t): return re.sub(r"[^a-z0-9]+", "_", t.lower()).strip("_")
def to24(t12):
    m = re.match(r"(\d+):(\d+) (AM|PM)", t12)
    h = int(m.group(1))
    if m.group(3) == "PM" and h != 12: h += 12
    if m.group(3) == "AM" and h == 12: h = 0
    return "%02d:%s" % (h, m.group(2))

EXTRA = {}  # filename -> (title, end_date, theme, at_iso) for consolidated signs

signs, seen = [], set()
if os.path.exists(CSV):
    with open(CSV, encoding="utf-8-sig") as f:
        for r in csv.DictReader(f):
            fn = f"{slug(r['Title'])}_{r['Date']}.png"
            if fn in seen or not os.path.exists(os.path.join(HERE, "signs", "main_signs", fn)): continue
            seen.add(fn)
            signs.append({"file": fn, "title": r["Title"], "start": str(date.today()), "end": r["Date"],
                          "theme": r["Theme"], "at": r["Date"] + "T" + to24(r["Start Time"])})
for fn, (title, end, theme, at) in EXTRA.items():
    if fn not in seen and os.path.exists(os.path.join(HERE, "signs", "main_signs", fn)):
        signs.append({"file": fn, "title": title, "start": str(date.today()), "end": end, "theme": theme, "at": at})
signs.sort(key=lambda s: s["end"])

def listdir(sub):
    p = os.path.join(HERE, "signs", sub)
    return sorted(os.listdir(p)) if os.path.isdir(p) else []

out = {
    "config": {
        "dwell_seconds": 12, "data_refresh_minutes": 5, "nightly_reload_hour": 4,
        "transitions": ["slide-left","slide-up","zoom","flip","slide-right"], "transition_ms": 650,
        "overnight": {"start": "22:00", "end": "06:00"},
        "countdown": {"lead_hours": 36, "every_n": 3},
        "general_every_n": 3
    },
    "signs": signs,
    "general_mains": listdir("general_mains"),
    "general_banners": listdir("general_banners"),
    "overnight_mains": listdir("overnight"),
    "overnight_banners": listdir("overnight_side")
}
json.dump(out, open(os.path.join(HERE, "playlist.json"), "w", encoding="utf-8"), indent=2, ensure_ascii=False)
print(f"playlist.json written - {len(signs)} event signs")
