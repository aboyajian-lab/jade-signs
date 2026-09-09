/* ==========================================================================
   Jade Big Screen — shared player for main.html / banner.html / screen.html
   Each page sets window.PANE_DEFS before loading this file, e.g.
     var PANE_DEFS = [{ sel: "#p-main", kind: "main" }];
   Everything else — rotation, transitions, countdown, Tonight chip, overnight
   and weather — lives here so the three pages can never drift apart again.
   Scheduling semantics (what is featured / counting down / overnight, venue
   time zone) live in jade-sched.js, shared with preview.html — load it first.
   ========================================================================== */
(function () {
  var S = window.JadeSched;
  var DIRS = {
    main: { sign: "signs/main_signs/", general: "signs/general_mains/" },
    side: { sign: "signs/side_banners/", general: "signs/general_banners/" }
  };
  var LOGO = "assets/jade_logo_cream.png?v=2";

  var cfg = {
    dwell_seconds: 12, data_refresh_minutes: 5, nightly_reload_hour: 4,
    transitions: ["slide-left","slide-up","zoom","flip","slide-right"], transition_ms: 650,
    overnight: { start: "22:00", end: "06:00", bounce_seconds: 120, sign_seconds: 25 },
    countdown: { lead_hours: 36, every_n: 3 },
    general_every_n: 3,
    chip: { enabled: true },
    weather: { enabled: true, lat: 28.0222, lon: -81.7328, label: "JADE COURTYARD · WINTER HAVEN",
               every_n: 4, dwell_seconds: 14, refresh_minutes: 20 }
  };
  var OVERNIGHT_CARDS = [
    { kicker: "CLOSED · 10 PM – 6 AM", title: "COURTYARD\nCLOSED", sub: "All activities are recorded." },
    { kicker: "10 PM – 6 AM",          title: "QUIET\nHOURS",      sub: "Please be respectful\nof your neighbors." }
  ];

  /* Overnight cards are live HTML (overnight_cards) — the old overnight_mains /
     overnight_banners PNG lists were never read and are no longer in the schema. */
  var data = { signs: [], general_mains: [], general_banners: [] };
  var wx = null, wxAt = 0;
  var idx = 0, tcount = 0, lastMode = null, curDwell = 0;
  var q = location.search;
  var DEMO_CD = q.indexOf("demo=countdown") >= 0,
      DEMO_ST = q.indexOf("demo=showtime") >= 0,     /* countdown card in its started state */
      DEMO_NIGHT = q.indexOf("demo=overnight") >= 0,
      DEMO_WX = q.indexOf("demo=weather") >= 0;
  /* QA time travel: ?at=2026-09-05T15:00 (venue time) runs the whole page as if it
     were that moment — rotation, chip, countdown state, overnight. Never set on the
     Rockbot URL. Combine with demo=countdown to put the featured card first. */
  var AT = /[?&]at=(\d{4}-\d{2}-\d{2}T\d{2}:\d{2})/.exec(q);
  if (AT) S.setNow(AT[1]);
  var EASE = "cubic-bezier(.22,.61,.36,1)";

  var panes = (window.PANE_DEFS || []).map(function (p) {
    var root = document.querySelector(p.sel);
    var l1 = root.querySelector(".layer1"), l2 = root.querySelector(".layer2");
    var chip = document.createElement("div");
    chip.className = "chip";
    chip.innerHTML = '<span class="k">TONIGHT</span><span class="d"></span><span class="v"></span>';
    root.appendChild(chip);
    return { kind: p.kind, root: root, a: l1, b: l2, front: null, chip: chip };
  });
  var fallback = document.getElementById("fallback");

  function markNarrow() {
    panes.forEach(function (p) {
      var r = p.root.getBoundingClientRect();
      p.root.classList.toggle("narrow", r.height > 0 && (r.width / r.height) < 0.75);
    });
  }
  markNarrow();
  window.addEventListener("resize", markNarrow);

  /* ---------- helpers ---------------------------------------------------- */
  /* All schedule decisions run on the venue clock (America/New_York) via
     jade-sched.js — never on the device clock. See that file for the rules. */
  var pad = S.pad;
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) {
    return { "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;" }[c]; }); }
  function now() { return S.nowWall(); }                     /* "YYYY-MM-DDTHH:MM" in ET */
  function activeSigns() { return S.activeSigns(data.signs, now()); }
  function isSport(s) {
    if (s.kind) return s.kind === "sports";
    return /🏈|🏀|⚾|🏒|⚽|🏎|⛳|🥊|🎾/.test(s.theme || "");
  }
  function inOvernight() {
    if (DEMO_NIGHT) return true;
    return S.inOvernight(cfg, now());
  }
  /* Featured event for the countdown card: { sign, at, state: upcoming|live } or null.
     Demo modes ignore the lead window; demo=showtime forces the started state. */
  function countdownTarget() {
    var f = S.countdown(data.signs, cfg, now(), DEMO_CD || DEMO_ST);
    if (f && DEMO_ST) f = { sign: f.sign, at: f.at, state: "live", today: true };
    return f;
  }
  function chipTarget() { return S.chip(data.signs, now()); }

  /* ---------- weather ----------------------------------------------------- */
  /* Open-Meteo: free, no API key, no attribution requirement for non-commercial. */
  var WMO = {
    0:["sun","Clear"],1:["sun","Mostly Clear"],2:["part","Partly Cloudy"],3:["cloud","Cloudy"],
    45:["fog","Fog"],48:["fog","Fog"],
    51:["rain","Light Drizzle"],53:["rain","Drizzle"],55:["rain","Drizzle"],
    56:["rain","Freezing Drizzle"],57:["rain","Freezing Drizzle"],
    61:["rain","Light Rain"],63:["rain","Rain"],65:["rain","Heavy Rain"],
    66:["rain","Freezing Rain"],67:["rain","Freezing Rain"],
    71:["snow","Light Snow"],73:["snow","Snow"],75:["snow","Heavy Snow"],77:["snow","Snow"],
    80:["rain","Showers"],81:["rain","Showers"],82:["rain","Heavy Showers"],
    85:["snow","Snow Showers"],86:["snow","Snow Showers"],
    95:["storm","Thunderstorms"],96:["storm","Thunderstorms"],99:["storm","Thunderstorms"]
  };
  function wmo(c) { return WMO[c] || ["cloud","—"]; }
  function icon(kind, px) {
    var s = 'width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
            'stroke-width="' + (px || 1.8) + '" stroke-linecap="round" stroke-linejoin="round"';
    var body = {
      sun:   '<circle cx="12" cy="12" r="4.2"/><path d="M12 2.2v2M12 19.8v2M2.2 12h2M19.8 12h2M5 5l1.4 1.4M17.6 17.6L19 19M19 5l-1.4 1.4M6.4 17.6L5 19"/>',
      part:  '<circle cx="8.5" cy="8.5" r="3.2"/><path d="M8.5 1.8v1.6M1.8 8.5h1.6M3.9 3.9l1.1 1.1M13.1 3.9L12 5"/><path d="M17.5 20H8a4 4 0 0 1 0-8 5.2 5.2 0 0 1 9.9 1.3A3.4 3.4 0 0 1 17.5 20z"/>',
      cloud: '<path d="M17.5 19H7a4.2 4.2 0 0 1 0-8.4 5.5 5.5 0 0 1 10.4 1.4A3.5 3.5 0 0 1 17.5 19z"/>',
      rain:  '<path d="M17.5 15.5H7a4.2 4.2 0 0 1 0-8.4 5.5 5.5 0 0 1 10.4 1.4 3.5 3.5 0 0 1 .1 7z"/><path d="M8.5 19l-.9 2.4M12.5 19l-.9 2.4M16.5 19l-.9 2.4"/>',
      storm: '<path d="M17.5 14.5H7a4.2 4.2 0 0 1 0-8.4 5.5 5.5 0 0 1 10.4 1.4 3.5 3.5 0 0 1 .1 7z"/><path d="M12.6 16l-2.4 3.6h3l-2 3.4"/>',
      snow:  '<path d="M17.5 15.5H7a4.2 4.2 0 0 1 0-8.4 5.5 5.5 0 0 1 10.4 1.4 3.5 3.5 0 0 1 .1 7z"/><path d="M9 19.2h.01M12 21h.01M15 19.2h.01"/>',
      fog:   '<path d="M4 9h16M6 13h12M4 17h16"/>'
    }[kind] || '';
    return '<svg ' + s + '>' + body + '</svg>';
  }
  function loadWeather(force) {
    var w = cfg.weather || {};
    if (!w.enabled) return;
    if (!force && wx && (Date.now() - wxAt) < (w.refresh_minutes || 20) * 60000) return;
    var u = "https://api.open-meteo.com/v1/forecast?latitude=" + w.lat + "&longitude=" + w.lon +
      "&current=temperature_2m,apparent_temperature,weather_code,precipitation" +
      "&hourly=temperature_2m,weather_code,precipitation_probability" +
      "&daily=weather_code,temperature_2m_max,temperature_2m_min" +
      "&temperature_unit=fahrenheit&timezone=auto&forecast_days=6";
    fetch(u, { cache: "no-store" })
      .then(function (r) { return r.json(); })
      .then(function (d) { if (d && d.current) { wx = d; wxAt = Date.now(); } })
      .catch(function () {});
  }
  /* Open-Meteo is called with timezone=auto, so its time strings are venue
     wall-clock (America/New_York) — parse them with the same ET helpers. */
  function rainCallout(d) {
    var h = d.hourly || {}, times = h.time || [], nowMs = S.nowMs();
    if ((d.current.precipitation || 0) > 0) return "Raining now";
    for (var i = 0; i < times.length; i++) {
      var t = S.toInstant(times[i]);
      if (t < nowMs) continue;
      var ahead = (t - nowMs) / 36e5;
      if (ahead > 12) break;
      var p = (h.precipitation_probability || [])[i] || 0;
      var code = (h.weather_code || [])[i];
      var wet = p >= 55 || (code >= 61 && code <= 82) || code >= 95;
      if (wet) {
        if (ahead < 1.5) return "Rain likely within the hour";
        var hr = S.hourOf(times[i]);
        return "Rain likely around " + (hr % 12 || 12) + " " + (hr >= 12 ? "PM" : "AM");
      }
    }
    return null;
  }
  function weatherHTML() {
    if (!wx) return null;
    var w = cfg.weather || {}, c = wx.current, h = wx.hourly || {}, dd = wx.daily || {};
    var m = wmo(c.weather_code), kind = m[0];
    var nowMs = S.nowMs(), hrs = [], times = h.time || [];
    for (var i = 0; i < times.length && hrs.length < 4; i++) {
      var t = S.toInstant(times[i]);
      if (t - nowMs < 30 * 60000) continue;
      var p = (h.precipitation_probability || [])[i] || 0, hc = (h.weather_code || [])[i];
      hrs.push({ hr: S.hourOf(times[i]), temp: Math.round((h.temperature_2m || [])[i]), code: hc, p: p,
                 wet: p >= 55 || (hc >= 61 && hc <= 82) || hc >= 95 });
    }
    var DN = ["SUN","MON","TUE","WED","THU","FRI","SAT"];
    var days = (dd.time || []).slice(1, 6).map(function (ds, i) {
      return { d: DN[S.dow(ds)], code: dd.weather_code[i+1],
               hi: Math.round(dd.temperature_2m_max[i+1]), lo: Math.round(dd.temperature_2m_min[i+1]) };
    });
    var call = rainCallout(wx);
    var tint = { sun:["rgba(233,185,73,.62)","rgba(200,116,58,.48)"],
                 part:["rgba(92,225,230,.44)","rgba(58,120,184,.50)"],
                 cloud:["rgba(120,140,150,.44)","rgba(40,60,72,.58)"],
                 rain:["rgba(58,120,184,.66)","rgba(24,86,92,.56)"],
                 storm:["rgba(46,32,74,.74)","rgba(58,120,184,.54)"],
                 snow:["rgba(180,210,225,.52)","rgba(90,120,140,.46)"],
                 fog:["rgba(140,150,155,.50)","rgba(50,60,66,.56)"] }[kind] || ["rgba(92,225,230,.44)","rgba(24,86,92,.50)"];
    var streaks = "";
    if (kind === "rain" || kind === "storm") {
      for (var s = 0; s < 34; s++) {
        streaks += '<s style="left:' + (s * 3 + (s % 5)) + '%;animation-duration:' +
                   (0.85 + (s % 7) * 0.11).toFixed(2) + 's;animation-delay:-' + ((s % 11) * 0.19).toFixed(2) + 's"></s>';
      }
    }
    return '' +
      '<div class="wxwrap">' +
        '<div class="wxbg">' +
          '<i style="background:radial-gradient(46% 38% at 30% 36%,' + tint[0] + ',transparent 68%)"></i>' +
          '<i style="background:radial-gradient(44% 36% at 70% 66%,' + tint[1] + ',transparent 68%);animation-delay:-70s"></i>' +
        '</div>' +
        '<div class="wxvig"></div>' +
        '<div class="wxrain' + (streaks ? " on" : "") + '">' + streaks + '</div>' +
        '<div class="wxin">' +
          '<div class="wxnow">' +
            '<div class="wxloc"><span class="wide">' + esc(w.label || "") + '</span>' +
              '<span class="tight">' + esc(w.label_short || "WINTER HAVEN") + '</span></div>' +
            '<div class="wxtemp">' + Math.round(c.temperature_2m) + '&deg;</div>' +
            '<div class="wxcond">' + esc(m[1]) + '</div>' +
            '<div class="wxfeel">Feels like ' + Math.round(c.apparent_temperature) + '&deg;' +
              (dd.temperature_2m_max ? '&nbsp;&nbsp;·&nbsp;&nbsp;Today ' + Math.round(dd.temperature_2m_max[0]) +
                '&deg; / ' + Math.round(dd.temperature_2m_min[0]) + '&deg;' : '') + '</div>' +
            '<div class="wxalert' + (call ? " on" : "") + '">' + icon("rain") + '<span>' + esc(call || "") + '</span></div>' +
          '</div>' +
          '<div class="wxside">' +
            '<div class="wxhrs">' + hrs.map(function (x) {
              return '<div class="wxhr' + (x.wet ? " wet" : "") + '">' +
                       '<div class="t">' + (x.hr % 12 || 12) + (x.hr >= 12 ? "P" : "A") + '</div>' +
                       '<div class="g">' + icon(wmo(x.code)[0]) + '</div>' +
                       '<div class="v">' + x.temp + '&deg;</div></div>';
            }).join("") + '</div>' +
            '<div class="wxrule"></div>' +
            days.map(function (x) {
              return '<div class="wxday"><span class="d">' + x.d + '</span>' +
                     '<span class="g">' + icon(wmo(x.code)[0]) + '</span>' +
                     '<span class="h">' + x.hi + '&deg;</span><span class="l">' + x.lo + '&deg;</span></div>';
            }).join("") +
          '</div>' +
        '</div>' +
        '<img class="wxlogo" src="' + LOGO + '" alt="">' +
      '</div>';
  }

  /* ---------- sequence ---------------------------------------------------- */
  function seqFor(kind) {
    if (inOvernight()) {
      var sd = (cfg.overnight && cfg.overnight.sign_seconds) || 25;
      var oseq = (cfg.overnight_cards || OVERNIGHT_CARDS).map(function (c) {
        return { k: "night", card: c, dwell: sd };
      });
      if (kind === "main") oseq.unshift({ k: "bounce", dwell: (cfg.overnight && cfg.overnight.bounce_seconds) || 120 });
      return oseq;
    }
    var act = activeSigns(), seq = [], specials = [], si = 0;
    var f = countdownTarget();
    if (f) specials.push({ k: "cd", ev: f.sign, at: f.at, state: f.state, art: DIRS[kind].sign });
    if (kind === "main") {
      (data.general_mains || []).forEach(function (f) { specials.push({ k: "img", dir: DIRS.main.general, f: f }); });
    } else {
      (data.general_banners || []).forEach(function (f) { specials.push({ k: "img", dir: DIRS.side.general, f: f }); });
    }
    if ((cfg.weather || {}).enabled && wx) specials.push({ k: "wx", dwell: (cfg.weather.dwell_seconds || 14) });
    var n = (kind === "main" ? (cfg.countdown && cfg.countdown.every_n) : cfg.general_every_n) || 3;
    if ((DEMO_CD || DEMO_ST) && specials.length && specials[0].k === "cd") seq.push(specials[0]);
    if (DEMO_WX) { var wxi = specials.filter(function (s) { return s.k === "wx"; }); if (wxi.length) seq.push(wxi[0]); }
    for (var i = 0; i < act.length; i++) {
      seq.push({ k: "img", dir: DIRS[kind].sign, f: act[i].file });
      if (specials.length && ((i + 1) % n === 0)) { seq.push(specials[si % specials.length]); si++; }
    }
    if (!seq.length) seq = specials.slice();
    return seq;
  }

  /* ---------- render ------------------------------------------------------ */
  function starField(n, sd) {
    var x = sd, out = "";
    var r = function () { x = (x * 1103515245 + 12345) % 2147483648; return x / 2147483648; };
    for (var i = 0; i < n; i++) {
      var s = (r() * 2.1 + 0.7).toFixed(2);
      out += '<b style="width:' + s + 'px;height:' + s + 'px;left:' + (r() * 100).toFixed(2) +
             '%;top:' + (r() * 100).toFixed(2) + '%;opacity:' + (r() * 0.55 + 0.12).toFixed(2) + '"></b>';
    }
    return out;
  }
  /* Inline DVD-style bouncer (2026-08-29): replaces the bounce.html iframe in
     the overnight cycle. The iframe drew the logo via CSS mask + aspect-ratio —
     either being unsupported on the Rockbot player leaves 2 minutes of pure
     black. This uses only a plain <img> and transforms, which the daytime
     rotation already proves work on the player. bounce.html itself is kept
     for standalone/preview use. */
  function startBounce(layer) {
    layer.innerHTML = '<div class="bouncewrap"><img class="blogo" src="' + LOGO + '" alt=""></div>';
    var logo = layer.querySelector(".blogo");
    var x = 60, y = 80, vx = 2.6, vy = 2.2;
    function step() {
      if (!logo.isConnected) return;               /* layer was recycled — stop */
      var W = layer.clientWidth, H = layer.clientHeight;
      var w = logo.offsetWidth, h = logo.offsetHeight;
      if (W > 0 && w > 0) {
        x += vx; y += vy;
        if (x <= 0)     { x = 0;     vx = Math.abs(vx);  }
        if (x >= W - w) { x = W - w; vx = -Math.abs(vx); }
        if (y <= 0)     { y = 0;     vy = Math.abs(vy);  }
        if (y >= H - h) { y = H - h; vy = -Math.abs(vy); }
        logo.style.transform = "translate(" + x + "px," + y + "px)";
      }
      requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
  }
  function renderItem(layer, item) {
    if (item.k === "bounce") {
      startBounce(layer);
    } else if (item.k === "img") {
      layer.innerHTML = '<img class="fill' + (item.drift ? " drift" : "") + '" src="' + item.dir + item.f + '" alt="">';
    } else if (item.k === "night") {
      var c = item.card;
      layer.innerHTML =
        '<div class="nightwrap">' +
          '<div class="nightbg"></div>' +
          '<div class="nightstars">' + starField(80, 7) + '</div>' +
          '<div class="nightcard">' +
            '<div class="k">' + esc(c.kicker) + '</div><div class="r"></div>' +
            '<h1>' + esc(c.title).replace(/\n/g, "<br>") + '</h1>' +
            '<p>' + esc(c.sub).replace(/\n/g, "<br>") + '</p>' +
            '<img class="lg" src="' + LOGO + '" alt="">' +
          '</div>' +
        '</div>';
    } else if (item.k === "wx") {
      layer.innerHTML = weatherHTML() || "";
    } else if (item.k === "cd") {
      /* Countdown card. state "upcoming" = segmented timer to item.at.
         state "live" (event has started; grace = rest of the event day) = the
         SHOWTIME / GAME TIME variant: same card, timer hidden, kicker swapped.
         Copy states the scheduled start only — never "now playing" — because
         the screen must not claim a status Armand hasn't set (rain calls etc.). */
      var s = item.ev, sport = isSport(s), live = item.state === "live";
      var kick = live ? (sport ? "GAME TIME ON THE BIG SCREEN" : "SHOWTIME ON THE BIG SCREEN") : "UP NEXT ON THE BIG SCREEN";
      layer.innerHTML =
        '<div class="cdwrap' + (live ? " live" : "") + '">' +
          '<img class="cdbg" src="' + (item.art || "signs/main_signs/") + s.file + '" alt="">' +
          '<div class="cdol">' +
            '<div class="cdk' + (sport ? " sport" : "") + '">' + kick + '</div>' +
            '<div class="cdt">' + esc((s.title || "").toUpperCase()) + '</div>' +
            '<div class="cdclock' + (sport ? " sport" : "") + '" data-target="' + esc(item.at) + '">' +
              ["DAYS","HRS","MIN","SEC"].map(function (l) {
                return '<div class="cdseg"><div class="cdnum" data-u="' + l + '">--</div><div class="cdlab">' + l + '</div></div>';
              }).join("") +
            '</div>' +
            '<div class="cdwhen">' + esc(S.fmtWhen(item.at, now())) + '</div>' +
            '<img class="cdlogo" src="' + LOGO + '" alt="The Jade">' +
          '</div>' +
        '</div>';
      tickTimers();
    }
  }
  function tickTimers() {
    var els = document.querySelectorAll(".cdclock[data-target]");
    for (var i = 0; i < els.length; i++) {
      var ms = S.toInstant(els[i].getAttribute("data-target")) - S.nowMs();
      var segs = els[i].querySelectorAll(".cdnum");
      if (ms <= 0) { segs[0].textContent = "00"; segs[1].textContent = "00"; segs[2].textContent = "00"; segs[3].textContent = "00"; continue; }
      var t = Math.floor(ms / 1000);
      var d = Math.floor(t / 86400); t -= d * 86400;
      var h = Math.floor(t / 3600);  t -= h * 3600;
      var m = Math.floor(t / 60);    t -= m * 60;
      segs[0].textContent = String(d); segs[1].textContent = pad(h);
      segs[2].textContent = pad(m);    segs[3].textContent = pad(t);
    }
  }
  setInterval(tickTimers, 500);

  /* Corner chip = today's featured event (same answer as the countdown card):
     the next start still ahead today, else the one that started most recently
     (kept until overnight). Kicker reads TODAY before 5 PM, TONIGHT after. */
  function updateChips() {
    if (!(cfg.chip || {}).enabled) return;
    var t = now(), f = chipTarget(), night = inOvernight();
    panes.forEach(function (p) {
      var showable = f && !night && p.front && !p.front.querySelector(".cdwrap, .nightwrap");
      if (showable) {
        var vEl = p.chip.querySelector(".v");
        var txt = S.fmtTime(f.at) + " · " + (f.sign.title || "").toUpperCase();
        p.chip.querySelector(".k").textContent = S.dayWord(f.at, t) || "TODAY";
        if (vEl.getAttribute("data-txt") !== txt) {
          vEl.setAttribute("data-txt", txt);
          vEl.innerHTML = "<span>" + esc(txt) + "</span>";
        }
        p.chip.classList.add("on");
        /* Long titles shuttle-scroll so the full title is readable (never clipped). */
        var sp = vEl.firstChild;
        var over = sp ? sp.scrollWidth - vEl.clientWidth : 0;
        if (over > 4) {
          vEl.classList.add("scroll");
          vEl.style.setProperty("--shuttle-x", (-over) + "px");
          vEl.style.setProperty("--shuttle-dur", Math.min(14, Math.max(5, over / 25)) + "s");
        } else {
          vEl.classList.remove("scroll");
        }
      } else { p.chip.classList.remove("on"); }
    });
  }

  /* ---------- transitions -------------------------------------------------- */
  function setT(el, transform, opacity, animate) {
    var ms = cfg.transition_ms || 650;
    el.style.transition = animate ? ("transform " + ms + "ms " + EASE + ", opacity " + ms + "ms " + EASE) : "none";
    el.style.transform = transform;
    el.style.opacity = opacity;
  }
  var IN_FROM = { "slide-left": "translateX(102%)", "slide-right": "translateX(-102%)", "slide-up": "translateY(102%)",
                  "zoom": "scale(1.15)", "flip": "perspective(1600px) rotateY(-70deg) scale(.92)" };
  var OUT_TO = { "slide-left": "translateX(-36%)", "slide-right": "translateX(36%)", "slide-up": "translateY(-36%)",
                 "zoom": "scale(.93)", "flip": "perspective(1600px) rotateY(30deg) scale(.95)" };
  function swapPane(p, item, type) {
    var back = (p.front === p.a) ? p.b : p.a;
    var out = p.front;
    renderItem(back, item);
    var img = back.querySelector("img.fill, img.cdbg");
    var go = function () {
      if (!out) { setT(back, "none", 1, false); p.front = back; updateChips(); return; }
      var soft = (type === "zoom" || type === "flip");
      setT(back, IN_FROM[type] || "none", soft ? 0 : 1, false);
      back.style.zIndex = 3; out.style.zIndex = 2;
      void back.offsetWidth;
      setT(back, "none", 1, true);
      setT(out, OUT_TO[type] || "none", 0, true);
      var old = out;
      setTimeout(function () { setT(old, "none", 0, false); old.innerHTML = ""; }, (cfg.transition_ms || 650) + 80);
      p.front = back;
      updateChips();
    };
    if (!img || (img.complete && img.getAttribute("src"))) { go(); } else { img.onload = go; img.onerror = go; }
  }

  /* ---------- loop --------------------------------------------------------- */
  function tick() {
    var mode = inOvernight() ? "night" : "day";
    if (mode !== lastMode) { idx = 0; lastMode = mode; }
    if (mode === "day") loadWeather(false);
    var seqs = {};
    panes.forEach(function (p) { seqs[p.kind] = seqFor(p.kind); });
    var empty = panes.every(function (p) { return !seqs[p.kind].length; });
    if (empty) {
      fallback.style.display = "flex";
      panes.forEach(function (p) { setT(p.a, "none", 0, false); setT(p.b, "none", 0, false); p.front = null; p.chip.classList.remove("on"); });
      return;
    }
    fallback.style.display = "none";
    var types = cfg.transitions && cfg.transitions.length ? cfg.transitions : ["slide-left"];
    var type = types[tcount % types.length]; tcount++;
    panes.forEach(function (p) {
      var seq = seqs[p.kind];
      if (!seq.length) return;
      var item = seq[idx % seq.length];
      if (p === panes[0]) curDwell = item.dwell || cfg.dwell_seconds || 12;
      swapPane(p, item, type);
    });
    idx++;
  }
  function applyData(d) {
    if (d.config) { for (var k in d.config) cfg[k] = d.config[k]; }
    if (d.overnight_cards) cfg.overnight_cards = d.overnight_cards;
    ["signs","general_mains","general_banners"].forEach(function (k) { data[k] = d[k] || []; });
  }
  function load() {
    fetch("playlist.json?t=" + Date.now(), { cache: "no-store" })
      .then(function (r) { return r.json(); }).then(applyData).catch(function () {});
  }
  function loop() { tick(); setTimeout(loop, (curDwell || cfg.dwell_seconds || 12) * 1000); }
  setInterval(load, (cfg.data_refresh_minutes || 5) * 60 * 1000);
  setInterval(function () { loadWeather(true); }, ((cfg.weather || {}).refresh_minutes || 20) * 60 * 1000);
  setInterval(function () {
    var p = S.parts(new Date(S.nowMs()));              /* venue time, like everything else */
    if (p.H === (cfg.nightly_reload_hour || 4) && p.M === 0) location.reload(true);
  }, 55 * 1000);

  fetch("playlist.json?t=" + Date.now(), { cache: "no-store" })
    .then(function (r) { return r.json(); }).then(applyData).catch(function () {})
    .then(function () { loadWeather(true); setTimeout(loop, 250); });
})();
