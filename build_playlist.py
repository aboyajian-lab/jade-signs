"""Regenerate playlist.json from the clean schedule CSV.
Usage: python build_playlist.py [schedule.csv]
Convention: each sign runs from generation day through the event date itself.
Only rows with a matching PNG in signs/main_signs are included.
"""
import csv, json, os, re, sys
from datetime import date

HERE = os.path.dirname(os.path.abspath(__file__))
CSV = sys.argv[1] if len(sys.argv) > 1 else os.path.join(HERE, "..", "claude-design-handoff", "jade_schedule_aug-sep_2026_clean.csv")

def slug(t):
    return re.sub(r"[^a-z0-9]+", "_", t.lower()).strip("_")

signs = []
with open(CSV, encoding="utf-8-sig") as f:
    for r in csv.DictReader(f):
        fn = f"{slug(r['Title'])}_{r['Date']}.png"
        if os.path.exists(os.path.join(HERE, "signs", "main_signs", fn)):
            signs.append({
                "file": fn,
                "title": r["Title"],
                "start": str(date.today()),
                "end": r["Date"],
                "theme": r["Theme"],
            })
signs.sort(key=lambda s: s["end"])
out = {
    "config": {"dwell_seconds": 12, "data_refresh_minutes": 5, "nightly_reload_hour": 4},
    "signs": signs,
}
with open(os.path.join(HERE, "playlist.json"), "w", encoding="utf-8") as f:
    json.dump(out, f, indent=2, ensure_ascii=False)
print(f"playlist.json written — {len(signs)} active signs")
