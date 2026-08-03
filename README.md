# Jade Big Screen — Live Signage

Feeds the Rockbot Live Web zones for The Jade Apartments courtyard TV.

- `main.html` — landscape zone (1920×1080 rotation)
- `banner.html` — sidebar zone (442×1080 rotation)
- `playlist.json` — the deployment: which signs are active, start/end dates, rotation config
- `signs/` — exported sign PNGs (main_signs + side_banners, matching filenames)
- `build_playlist.py` — regenerates playlist.json from the monthly schedule CSV

Pages self-refresh their data every 5 minutes; a sign past its end date drops out
automatically. Publishing = commit new PNGs + updated playlist.json.
