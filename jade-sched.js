/* ==========================================================================
   Jade Big Screen — shared scheduling semantics
   Loaded by main.html / banner.html / screen.html (before jade-screen.js) AND
   by preview.html, so the live screen and the preview can never disagree about
   what is featured, what counts down, or when overnight starts.
   Also loadable in Node (module.exports) for the acceptance harness.

   Rules (2026-09-07, from the Showrunner QA fix brief):
   - All schedule math is in VENUE time, America/New_York, regardless of the
     device clock/timezone. Playlist timestamps are timezone-less ET wall-clock
     strings ("2026-09-05T19:00"); "now" is converted to the same form and
     compared as strings — nothing here ever parses a timezone-less string with
     new Date() (that is device-local on modern engines, UTC on some old ones).
   - A sign may carry `at` (one event) or `airings: [...]` (a series sign — one
     PNG, many real event instances). Every instance is scheduled independently.
   - featured(now): today's next upcoming instance; else today's most recent
     started instance ("live" — grace = rest of the event day); else the next
     future instance (any day). Chip and countdown are BOTH derived from this
     one answer, so they can never point at different events.
   - Countdown card shows for the featured event when upcoming within
     countdown.lead_hours, or when live (the card flips to its SHOWTIME /
     GAME TIME variant with the timer hidden — see jade-screen.js).
   - Chip shows only when the featured event is today. Kicker = TODAY before
     17:00, TONIGHT from 17:00.
   ========================================================================== */
(function (root) {
  var TZ = "America/New_York";
  var DOW_L = ["SUNDAY","MONDAY","TUESDAY","WEDNESDAY","THURSDAY","FRIDAY","SATURDAY"];
  var DOW_S = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
  var MON_S = ["JAN","FEB","MAR","APR","MAY","JUN","JUL","AUG","SEP","OCT","NOV","DEC"];
  var EVENING_HOUR = 17;

  function pad(n) { return String(n).padStart(2, "0"); }

  /* ---- venue clock ------------------------------------------------------ */
  var fmt = null;
  try {
    fmt = new Intl.DateTimeFormat("en-US", { timeZone: TZ, hour12: false, year: "numeric", month: "2-digit",
                                             day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" });
    fmt.formatToParts(new Date());
  } catch (e) { fmt = null; }
  var TZ_OK = !!fmt;

  /* Wall-clock parts of instant d in venue time. Falls back to the device clock
     only if Intl time zones are unsupported (then the box MUST be set to ET). */
  function parts(d) {
    if (fmt) {
      var o = {};
      fmt.formatToParts(d).forEach(function (p) { o[p.type] = p.value; });
      var H = +o.hour; if (H === 24) H = 0;          /* some engines print 24 at midnight */
      return { y: +o.year, m: +o.month, d: +o.day, H: H, M: +o.minute, S: +o.second };
    }
    return { y: d.getFullYear(), m: d.getMonth() + 1, d: d.getDate(), H: d.getHours(), M: d.getMinutes(), S: d.getSeconds() };
  }
  function wall(p) { return p.y + "-" + pad(p.m) + "-" + pad(p.d) + "T" + pad(p.H) + ":" + pad(p.M); }
  /* QA time travel: setNow("2026-09-05T15:00") shifts the clock so nowMs()/nowWall()
     report that venue moment (and keep ticking from it). The player honors ?at=...;
     the preview has its own picker and never calls this. */
  var clockOffset = 0;
  function setNow(w) { var ms = toInstant(w); clockOffset = isNaN(ms) ? 0 : ms - Date.now(); return clockOffset !== 0; }
  function nowMs() { return Date.now() + clockOffset; }
  /* "now" as an ET wall-clock string, minute precision — the unit of all comparisons. */
  function nowWall(d) { return wall(parts(d || new Date(nowMs()))); }
  function offsetMs(ms) {
    var p = parts(new Date(ms));
    return Date.UTC(p.y, p.m - 1, p.d, p.H, p.M, p.S) - Math.floor(ms / 1000) * 1000;
  }
  /* ET wall string -> epoch ms (DST-safe; used only for countdown arithmetic). */
  function toInstant(w) {
    var m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?/.exec(String(w || ""));
    if (!m) return NaN;
    var y = +m[1], mo = +m[2] - 1, d = +m[3], H = +m[4], M = +m[5], S = +(m[6] || 0);
    if (!fmt) return new Date(y, mo, d, H, M, S).getTime();
    var asUTC = Date.UTC(y, mo, d, H, M, S);
    var inst = asUTC - offsetMs(asUTC);           /* first guess with the offset at that wall time */
    return asUTC - offsetMs(inst);                /* refine once across a DST edge */
  }
  function dateOf(w) { return String(w).slice(0, 10); }
  function timeOf(w) { return String(w).slice(11, 16); }
  function hourOf(w) { return +String(w).slice(11, 13); }
  function dow(w) { var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(w)); return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])).getUTCDay(); }

  /* ---- formatting --------------------------------------------------------- */
  function fmtTime(w) {
    var H = hourOf(w), M = String(w).slice(14, 16);
    return (H % 12 || 12) + ":" + M + " " + (H >= 12 ? "PM" : "AM");
  }
  function fmtStamp(w, longDay) {
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(w));
    var dn = longDay ? DOW_L[dow(w)] : DOW_S[dow(w)];
    var mn = MON_S[+m[2] - 1]; if (!longDay) mn = mn.charAt(0) + mn.slice(1).toLowerCase();
    return dn + ", " + mn + " " + (+m[3]) + " · " + fmtTime(w);
  }
  /* "TODAY" for a same-day event before 17:00, "TONIGHT" from 17:00, else null. */
  function dayWord(w, now) {
    if (dateOf(w) !== dateOf(now)) return null;
    return hourOf(w) < EVENING_HOUR ? "TODAY" : "TONIGHT";
  }
  /* Countdown card when-line: "TONIGHT · 7:00 PM" / "TODAY · 12:00 PM" / "SATURDAY, SEP 5 · 7:00 PM" */
  function fmtWhen(w, now) {
    var dw = dayWord(w, now);
    return dw ? dw + " · " + fmtTime(w) : fmtStamp(w, true);
  }

  /* ---- schedule ----------------------------------------------------------- */
  function timesOf(s) {
    if (s.airings && s.airings.length) return s.airings.slice();
    return s.at ? [s.at] : [];
  }
  /* Every (sign, at) instance across the playlist, sorted by time. */
  function instances(signs) {
    var out = [];
    (signs || []).forEach(function (s) {
      timesOf(s).forEach(function (t) { out.push({ sign: s, at: t }); });
    });
    out.sort(function (a, b) { return a.at < b.at ? -1 : a.at > b.at ? 1 : 0; });
    return out;
  }
  function activeSigns(signs, now) {
    var d = dateOf(now);
    return (signs || []).filter(function (s) { return s.start <= d && d <= s.end; });
  }
  function inOvernight(cfg, now) {
    var o = (cfg && cfg.overnight) || {}; if (!o.start || !o.end) return false;
    var cur = timeOf(now);
    return o.start > o.end ? (cur >= o.start || cur < o.end) : (cur >= o.start && cur < o.end);
  }
  /* The one event the screen is "about" right now — see header. */
  function featured(signs, now) {
    var d = dateOf(now), inst = instances(signs), todays = [], i;
    for (i = 0; i < inst.length; i++) if (dateOf(inst[i].at) === d) todays.push(inst[i]);
    for (i = 0; i < todays.length; i++) {
      if (todays[i].at > now) return { sign: todays[i].sign, at: todays[i].at, state: "upcoming", today: true };
    }
    if (todays.length) {
      var l = todays[todays.length - 1];
      return { sign: l.sign, at: l.at, state: "live", today: true };
    }
    for (i = 0; i < inst.length; i++) {
      if (inst[i].at > now) return { sign: inst[i].sign, at: inst[i].at, state: "upcoming", today: false };
    }
    return null;
  }
  function hoursUntil(w, now) { return (toInstant(w) - toInstant(now)) / 36e5; }
  /* Countdown card target, or null. ignoreLead = demo mode. */
  function countdown(signs, cfg, now, ignoreLead) {
    var f = featured(signs, now);
    if (!f) return null;
    if (f.state === "live") return f;
    var lead = (cfg && cfg.countdown && cfg.countdown.lead_hours) || 36;
    if (!ignoreLead && hoursUntil(f.at, now) > lead) return null;
    return f;
  }
  /* Chip target, or null: featured only when it is today's event. */
  function chip(signs, now) {
    var f = featured(signs, now);
    return f && f.today ? f : null;
  }
  /* Next n future instances (for the preview's reference list). */
  function upcoming(signs, now, n) {
    return instances(signs).filter(function (i) { return i.at > now; }).slice(0, n || 3);
  }
  function nextAiring(s, now) {
    var ts = timesOf(s).filter(function (t) { return t > now; });
    return ts.length ? ts[0] : null;
  }

  var API = {
    TZ: TZ, TZ_OK: TZ_OK, EVENING_HOUR: EVENING_HOUR,
    pad: pad, parts: parts, nowWall: nowWall, nowMs: nowMs, setNow: setNow, toInstant: toInstant, dateOf: dateOf, timeOf: timeOf, hourOf: hourOf, dow: dow,
    fmtTime: fmtTime, fmtStamp: fmtStamp, dayWord: dayWord, fmtWhen: fmtWhen,
    timesOf: timesOf, instances: instances, activeSigns: activeSigns, inOvernight: inOvernight,
    featured: featured, countdown: countdown, chip: chip, upcoming: upcoming, nextAiring: nextAiring, hoursUntil: hoursUntil
  };
  root.JadeSched = API;
  if (typeof module !== "undefined" && module.exports) module.exports = API;
})(typeof window !== "undefined" ? window : this);
