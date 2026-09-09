/*
 * Jade Big Screen — automated overflow / render QA.
 *
 * Renders every live card state at exact pixel size and fails if ANY element
 * escapes its pane. (Scheduling semantics — what is featured when — are covered
 * separately by qa_sched.js; run both before every push.) Overflow on the 442x1080 sidebar is the single most common
 * defect in this project (CLAUDE.md rule 16), so it gets checked by a machine,
 * not by eye.
 *
 * Usage:
 *   npm install @sparticuz/chromium puppeteer-core
 *   python -m http.server 8100      # from this folder, in another shell
 *   node qa_screen.js [http://localhost:8100] [--shots ./qa-shots]
 *
 * Exit code 0 = clean, 1 = defects found.
 */
const chromium = require('@sparticuz/chromium').default;
const puppeteer = require('puppeteer-core');
const fs = require('fs');

const BASE = process.argv[2] && process.argv[2].startsWith('http') ? process.argv[2] : 'http://localhost:8100';
const SHOTS = (function () { var i = process.argv.indexOf('--shots'); return i > 0 ? process.argv[i + 1] : null; })();

/* Longest real strings we ever ship — QA against these, never a short placeholder. */
const LONG = {
  title: 'FLORIDA STATE AT ALABAMA · FLORIDA AT AUBURN',
  theme: '🏈 College Gameday @ Jade'
};

const CASES = [
  { name: 'main-countdown-movie',  page: 'main.html',   q: '?demo=countdown', w: 1920, h: 1080 },
  { name: 'main-countdown-sports', page: 'main.html',   q: '?demo=countdown', w: 1920, h: 1080, sports: true },
  { name: 'main-countdown-long',   page: 'main.html',   q: '?demo=countdown', w: 1920, h: 1080, longTitle: true },
  { name: 'main-showtime-movie',   page: 'main.html',   q: '?demo=showtime',  w: 1920, h: 1080, live: true },
  { name: 'main-showtime-sports',  page: 'main.html',   q: '?demo=showtime',  w: 1920, h: 1080, live: true, sports: true, longTitle: true },
  { name: 'main-weather',          page: 'main.html',   q: '?demo=weather',   w: 1920, h: 1080 },
  { name: 'main-overnight',        page: 'main.html',   q: '?demo=overnight', w: 1920, h: 1080, wait: 9000 },
  { name: 'side-countdown-movie',  page: 'banner.html', q: '?demo=countdown', w: 442,  h: 1080 },
  { name: 'side-countdown-sports', page: 'banner.html', q: '?demo=countdown', w: 442,  h: 1080, sports: true },
  { name: 'side-countdown-long',   page: 'banner.html', q: '?demo=countdown', w: 442,  h: 1080, longTitle: true },
  { name: 'side-showtime-movie',   page: 'banner.html', q: '?demo=showtime',  w: 442,  h: 1080, live: true },
  { name: 'side-showtime-sports',  page: 'banner.html', q: '?demo=showtime',  w: 442,  h: 1080, live: true, sports: true, longTitle: true },
  { name: 'side-weather',          page: 'banner.html', q: '?demo=weather',   w: 442,  h: 1080 },
  { name: 'side-overnight',        page: 'banner.html', q: '?demo=overnight', w: 442,  h: 1080, wait: 9000 },
  { name: 'screen-composite',      page: 'screen.html', q: '',                w: 1920, h: 1080, wait: 15000 }
];

/* Deterministic stand-in for Open-Meteo so QA never depends on the network. */
function mockWeather() {
  var m = { current: { temperature_2m: 94.2, apparent_temperature: 101.4, weather_code: 95, precipitation: 0 },
            hourly: { time: [], temperature_2m: [], weather_code: [], precipitation_probability: [] },
            daily: { time: [], weather_code: [], temperature_2m_max: [], temperature_2m_min: [] } };
  var now = new Date();
  for (var i = 0; i < 48; i++) {
    var t = new Date(now.getTime() + i * 36e5);
    m.hourly.time.push(t.toISOString().slice(0, 16));
    m.hourly.temperature_2m.push(88 + ((i * 7) % 10));
    m.hourly.weather_code.push(i === 3 ? 95 : (i % 4 === 0 ? 2 : 1));
    m.hourly.precipitation_probability.push(i === 3 ? 78 : 12);
  }
  for (var d = 0; d < 6; d++) {
    var dt = new Date(now.getTime() + d * 864e5);
    m.daily.time.push(dt.toISOString().slice(0, 10));
    m.daily.weather_code.push([95, 1, 80, 95, 0, 3][d]);
    m.daily.temperature_2m_max.push([95, 96, 93, 91, 94, 92][d]);
    m.daily.temperature_2m_min.push([77, 78, 76, 74, 77, 75][d]);
  }
  return m;
}

(async () => {
  if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });
  const exe = await chromium.executablePath();
  let bad = 0, run = 0;

  const only = (function () { var i = process.argv.indexOf('--only'); return i > 0 ? process.argv[i + 1] : null; })();
  for (const c of CASES) {
    if (only && c.name.indexOf(only) < 0) continue;
    /* A fresh browser per case. Reusing one instance across all 11 cases will
       exhaust the renderer on a small box and report a bogus "Target closed". */
    const browser = await puppeteer.launch({ args: [...chromium.args], executablePath: exe, headless: 'shell' });
    const page = await browser.newPage();
    await page.setViewport({ width: c.w, height: c.h, deviceScaleFactor: 1 });
    const errs = [];
    page.on('pageerror', e => errs.push('JS: ' + e.message));
    page.on('console', m => { if (m.type() === 'error') errs.push('CONSOLE: ' + m.text()); });

    await page.evaluateOnNewDocument((mock, opt, LONG) => {
      const of = window.fetch;
      window.fetch = function (u, o) {
        if (String(u).indexOf('open-meteo') >= 0) return Promise.resolve({ json: () => Promise.resolve(mock) });
        if (String(u).indexOf('playlist.json') >= 0) {
          return of(u, o).then(r => r.json()).then(d => {
            /* Venue date (America/New_York) — the schedule runs on it, not the device clock. */
            const iso = (window.JadeSched ? window.JadeSched.nowWall() : new Date().toISOString()).slice(0, 10);
            if (d.signs && d.signs.length) {
              const s = Object.assign({}, d.signs[0]);
              delete s.airings; delete s.series; delete s.cadence;
              s.start = iso; s.end = iso;
              /* upcoming -> 23:59 today (countdown); live -> 00:01 today (showtime state) */
              s.at = iso + (opt.live ? 'T00:01' : 'T23:59');
              if (opt.sports) { s.theme = LONG.theme; s.kind = 'sports'; }
              if (opt.longTitle) { s.title = LONG.title; s.theme = LONG.theme; }
              /* Only the QA sign, so the featured event is deterministic whatever day QA runs. */
              d.signs = [s];
            }
            if (d.config && d.config.overnight) d.config.overnight.bounce_seconds = 2;
            return { json: () => Promise.resolve(d) };
          });
        }
        return of(u, o);
      };
    }, mockWeather(), { sports: !!c.sports, longTitle: !!c.longTitle, live: !!c.live }, LONG);

    await page.goto(BASE + '/' + c.page + c.q, { waitUntil: 'networkidle0', timeout: 60000 });
    await new Promise(r => setTimeout(r, c.wait || 5000));

    const report = await page.evaluate(() => {
      const out = [];
      document.querySelectorAll('.pane').forEach(pane => {
        const pr = pane.getBoundingClientRect();
        pane.querySelectorAll('*').forEach(el => {
          /* decorative background layers are intentionally oversized inside overflow:hidden */
          if (el.closest('.wxbg, .nightbg, .nightstars, .wxrain, .cdbg')) return;
          if (el.tagName === 'IFRAME' || el.classList.contains('cdbg')) return;
          const r = el.getBoundingClientRect();
          if (!r.width || !r.height) return;
          const cs = getComputedStyle(el);
          if (cs.visibility === 'hidden' || cs.display === 'none' || +cs.opacity === 0) return;
          const slop = 1.5;
          if (r.left < pr.left - slop || r.right > pr.right + slop ||
              r.top < pr.top - slop || r.bottom > pr.bottom + slop) {
            out.push({ cls: el.className || el.tagName,
                       txt: (el.textContent || '').trim().slice(0, 40),
                       box: [Math.round(r.left), Math.round(r.right), Math.round(r.top), Math.round(r.bottom)],
                       pane: [Math.round(pr.left), Math.round(pr.right), Math.round(pr.top), Math.round(pr.bottom)] });
          }
        });
      });
      /* also catch text truncated by ellipsis / clipping */
      const clipped = [];
      document.querySelectorAll('.pane .cdt, .pane .chip .v, .pane h1, .pane .wxcond, .pane .wxloc')
        .forEach(el => { if (el.scrollWidth > el.clientWidth + 2) clipped.push((el.className || '') + ': ' + (el.textContent || '').trim().slice(0, 40)); });
      return { over: out, clipped: clipped };
    });

    if (SHOTS) await page.screenshot({ path: SHOTS + '/' + c.name + '.png' });

    run++;
    const problems = report.over.length + report.clipped.length + errs.length;
    if (problems) {
      bad++;
      console.log('FAIL  ' + c.name);
      report.over.forEach(o => console.log('        overflow: ' + o.cls + ' "' + o.txt + '" box=' + o.box.join(',') + ' pane=' + o.pane.join(',')));
      report.clipped.forEach(t => console.log('        clipped:  ' + t));
      errs.slice(0, 4).forEach(e => console.log('        ' + e));
    } else {
      console.log('ok    ' + c.name);
    }
    await page.close();
    await browser.close();
  }

  console.log('\n' + (run - bad) + '/' + run + ' clean');
  process.exit(bad ? 1 : 0);
})().catch(e => { console.error(e.message); process.exit(1); });
