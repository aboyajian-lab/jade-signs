/*
 * Jade Big Screen — scheduling semantics QA (no browser needed).
 *
 * Runs jade-sched.js — the exact module the live player and preview.html load —
 * against playlist.json at a list of moments and asserts what the screen would
 * feature: mode (overnight / countdown / showtime / normal), the countdown
 * target, and the corner chip. The moments below are the acceptance table from
 * the Showrunner QA fix brief (2026-09-07).
 *
 * Usage:  node qa_sched.js            (run it with TZ=UTC and TZ=America/Los_Angeles
 *         too — results must be identical, because all math is venue time.)
 * Exit code 0 = all rows as expected, 1 = mismatch.
 */
const S = require('./jade-sched.js');
const pl = JSON.parse(require('fs').readFileSync(__dirname + '/playlist.json', 'utf8'));

function state(now) {
  if (S.inOvernight(pl.config, now)) return { mode: 'overnight', cd: null, chip: null, kicker: null };
  const cd = S.countdown(pl.signs, pl.config, now);
  const ch = S.chip(pl.signs, now);
  return {
    mode: cd ? (cd.state === 'live' ? 'showtime' : 'countdown') : 'normal',
    cd: cd ? cd.sign.title + ' @ ' + S.fmtTime(cd.at) : null,
    chip: ch ? ch.sign.title + ' @ ' + S.fmtTime(ch.at) : null,
    kicker: ch ? S.dayWord(ch.at, now) : null
  };
}

/* now (ET wall) -> expected. `cd`/`chip` are substrings of the title (or null = none). */
const ROWS = [
  ['2026-09-05T09:00', { mode: 'countdown', cd: 'College Gameday', chip: 'College Gameday', kicker: 'TODAY' }],
  ['2026-09-05T12:00', { mode: 'countdown', cd: 'Lord of the Rings', chip: 'Lord of the Rings', kicker: 'TONIGHT' }],
  ['2026-09-05T15:00', { mode: 'countdown', cd: 'Lord of the Rings', chip: 'Lord of the Rings', kicker: 'TONIGHT' }],
  ['2026-09-05T18:59', { mode: 'countdown', cd: 'Lord of the Rings', chip: 'Lord of the Rings', kicker: 'TONIGHT' }],
  ['2026-09-05T19:00', { mode: 'showtime',  cd: 'Lord of the Rings', chip: 'Lord of the Rings', kicker: 'TONIGHT' }],
  ['2026-09-05T19:01', { mode: 'showtime',  cd: 'Lord of the Rings', chip: 'Lord of the Rings', kicker: 'TONIGHT' }],
  ['2026-09-05T21:59', { mode: 'showtime',  cd: 'Lord of the Rings', chip: 'Lord of the Rings', kicker: 'TONIGHT' }],
  ['2026-09-05T22:00', { mode: 'overnight' }],
  ['2026-09-06T06:00', { mode: 'countdown', cd: 'Wicked', chip: 'Wicked', kicker: 'TONIGHT' }],
  ['2026-09-06T19:59', { mode: 'countdown', cd: 'Wicked', chip: 'Wicked', kicker: 'TONIGHT' }],
  ['2026-09-06T20:00', { mode: 'showtime',  cd: 'Wicked', chip: 'Wicked', kicker: 'TONIGHT' }],
  ['2026-09-06T20:01', { mode: 'showtime',  cd: 'Wicked', chip: 'Wicked', kicker: 'TONIGHT' }],
  ['2026-09-06T22:00', { mode: 'overnight' }],
  ['2026-09-07T05:59', { mode: 'overnight' }],
  ['2026-09-07T06:00', { mode: 'countdown', cd: 'Shrek', chip: 'Shrek', kicker: 'TONIGHT' }],
  ['2026-09-08T08:19', { mode: 'normal',    cd: null, chip: null }],                       /* Patriots 36h+ out */
  ['2026-09-08T08:21', { mode: 'countdown', cd: 'Patriots at Seahawks', chip: null }],    /* inside 36h, not today -> no chip */
  ['2026-09-09T20:19', { mode: 'countdown', cd: 'Patriots at Seahawks', chip: 'Patriots at Seahawks', kicker: 'TONIGHT' }],
  ['2026-09-09T20:20', { mode: 'showtime',  cd: 'Patriots at Seahawks', chip: 'Patriots at Seahawks', kicker: 'TONIGHT' }],
  ['2026-09-10T09:00', { mode: 'countdown', cd: '49ers at Rams', chip: '49ers at Rams', kicker: 'TONIGHT' }],
  ['2026-09-13T10:00', { mode: 'countdown', cd: 'NFL Sundays @ Jade @ 1:00 PM', chip: 'NFL Sundays', kicker: 'TODAY' }],
  ['2026-09-13T13:00', { mode: 'countdown', cd: 'NFL Sundays @ Jade @ 4:25 PM', chip: 'NFL Sundays @ Jade @ 4:25 PM', kicker: 'TODAY' }],
  ['2026-09-13T18:00', { mode: 'countdown', cd: 'NFL Sundays @ Jade @ 8:20 PM', chip: 'NFL Sundays @ Jade @ 8:20 PM', kicker: 'TONIGHT' }],
  ['2026-09-13T21:00', { mode: 'showtime',  cd: 'NFL Sundays @ Jade @ 8:20 PM', chip: 'NFL Sundays', kicker: 'TONIGHT' }],
  ['2026-09-15T12:00', { mode: 'normal',    cd: null, chip: null }],                       /* Tuesday in the Gameday window: nothing today, TNF Thu 56h out */
  ['2026-09-16T08:14', { mode: 'normal',    cd: null, chip: null }],                       /* TNF Thu 8:15 PM is 36h01m out */
  ['2026-09-16T08:16', { mode: 'countdown', cd: 'Thursday & Monday Night Football', chip: null }],
  ['2026-09-19T14:00', { mode: 'countdown', cd: 'Florida State at Alabama + Florida at Auburn @ 3:30 PM', chip: 'Florida State', kicker: 'TODAY' }],
  ['2026-09-19T15:30', { mode: 'countdown', cd: 'Florida State at Alabama + Florida at Auburn @ 7:00 PM', chip: 'Florida State', kicker: 'TONIGHT' }],
  ['2026-09-19T19:00', { mode: 'showtime',  cd: 'Florida State at Alabama + Florida at Auburn @ 7:00 PM', chip: 'Florida State', kicker: 'TONIGHT' }],
  ['2026-09-26T11:00', { mode: 'countdown', cd: 'College Gameday', chip: 'College Gameday', kicker: 'TODAY' }],
  ['2026-09-26T12:00', { mode: 'countdown', cd: 'Wonder Woman', chip: 'Wonder Woman', kicker: 'TONIGHT' }],
  ['2026-08-23T09:00', { mode: 'showtime',  cd: 'F1 Dutch Grand Prix', chip: 'F1 Dutch Grand Prix', kicker: 'TODAY' }]
];

let bad = 0;
const has = (got, want) => (want === null ? got === null : got !== null && got.indexOf(want) >= 0);
ROWS.forEach(([now, exp]) => {
  const got = state(now), problems = [];
  if (got.mode !== exp.mode) problems.push('mode ' + got.mode + ' != ' + exp.mode);
  if (exp.mode !== 'overnight') {
    if (!has(got.cd, exp.cd)) problems.push('countdown ' + JSON.stringify(got.cd) + ' !~ ' + JSON.stringify(exp.cd));
    if (!has(got.chip, exp.chip)) problems.push('chip ' + JSON.stringify(got.chip) + ' !~ ' + JSON.stringify(exp.chip));
    if (exp.kicker && got.kicker !== exp.kicker) problems.push('kicker ' + got.kicker + ' != ' + exp.kicker);
  }
  const line = now.replace('T', ' ') + '  ' + got.mode.padEnd(9) + ' cd=' + (got.cd || '—').padEnd(48) + ' chip=' + (got.kicker ? got.kicker + ' · ' : '') + (got.chip || '—');
  if (problems.length) { bad++; console.log('FAIL ' + line + '\n      ' + problems.join('; ')); }
  else console.log('ok   ' + line);
});

/* Series signs must never present as a one-shot that already happened. */
pl.signs.forEach(s => {
  if (s.series && (s.at || !(s.airings && s.airings.length) || !s.cadence)) { bad++; console.log('FAIL series sign ' + s.file + ' needs airings + cadence and no at'); }
  if (!s.series && !s.at && !(s.airings && s.airings.length)) { bad++; console.log('FAIL sign ' + s.file + ' has no time at all'); }
});
['overnight_mains', 'overnight_banners'].forEach(k => { if (k in pl) { bad++; console.log('FAIL dead playlist key ' + k); } });

console.log('\nTZ=' + (process.env.TZ || 'system') + ' · venue ' + S.TZ + ' (Intl ' + (S.TZ_OK ? 'ok' : 'UNAVAILABLE — device clock fallback') + ') · ' + (ROWS.length - bad) + '/' + ROWS.length + ' rows as expected');
process.exit(bad ? 1 : 0);
