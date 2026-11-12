// Module test overlay for the courtyard screen. Loaded only by screen-test.html.
// The normal courtyard signage keeps running; one module-sized box (or a whole panel)
// cycles test colors on top of it. Plain divs only (no masks, iframes or blur).
//
// URL options (screen-test.html?...):
//   cell=H9        module to test: column letter A-O (left to right), row number 1-18 (top down)
//   panel=3,2      test a whole panel instead: panel column 1-5, panel row 1-3
//   grid=1         show the labeled module grid (use this first to check it lines up)
//   area=0,0,1,1   where the LED wall sits in the page: left,top,right,bottom as fractions.
//                  Default is the whole page. Values past 1 mean the wall extends below/right
//                  of the page (e.g. under the Rockbot bottom bar: area=0,0,1,1.1)
//   secs=10        seconds per test color
//   only=red,white limit the test colors
//   cols=15&rows=18  module grid size (courtyard: 5x3 panels of 3x6 modules)
(function () {
  var q = new URLSearchParams(location.search);
  if (!q.has('cell') && !q.has('panel') && !q.has('grid')) return;

  var COLS = Number(q.get('cols') || 15), ROWS = Number(q.get('rows') || 18);
  var PCOLS = 3, PROWS = 6;   // modules per panel (across, down)
  var SECS = Math.max(2, Number(q.get('secs') || 10));
  var area = (q.get('area') || '0,0,1,1').split(',').map(Number);
  var LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

  var root = document.createElement('div');
  root.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:2147483000;';
  document.body.appendChild(root);

  function pct(v) { return (v * 100) + '%'; }
  function cellBox(c0, r0, cw, rh) {      // module coords (0-based) -> page box
    var W = area[2] - area[0], H = area[3] - area[1];
    return {
      left: pct(area[0] + W * c0 / COLS), top: pct(area[1] + H * r0 / ROWS),
      width: pct(W * cw / COLS), height: pct(H * rh / ROWS)
    };
  }
  function place(el, b) { el.style.left = b.left; el.style.top = b.top; el.style.width = b.width; el.style.height = b.height; }

  // ---- labeled grid -------------------------------------------------------
  if (q.get('grid') === '1') {
    for (var r = 0; r < ROWS; r++) {
      for (var c = 0; c < COLS; c++) {
        var g = document.createElement('div');
        var panelEdgeR = (c + 1) % PCOLS === 0, panelEdgeB = (r + 1) % PROWS === 0;
        g.style.cssText = 'position:absolute;box-sizing:border-box;color:#fff;font:700 1.6vmin Arial,sans-serif;' +
          'text-shadow:0 0 3px #000,0 0 3px #000;display:flex;align-items:center;justify-content:center;' +
          'border-right:' + (panelEdgeR ? '3px solid #ff0' : '1px solid rgba(255,255,255,.6)') + ';' +
          'border-bottom:' + (panelEdgeB ? '3px solid #ff0' : '1px solid rgba(255,255,255,.6)') + ';';
        place(g, cellBox(c, r, 1, 1));
        g.textContent = LETTERS[c] + (r + 1);
        root.appendChild(g);
      }
    }
  }

  // ---- test box -----------------------------------------------------------
  var box = null;
  if (q.has('panel')) {
    var pp = q.get('panel').split(',').map(Number);   // panel col, panel row (1-based)
    box = cellBox((pp[0] - 1) * PCOLS, (pp[1] - 1) * PROWS, PCOLS, PROWS);
  } else if (q.has('cell')) {
    var m = /^([A-Za-z])(\d+)$/.exec(q.get('cell').trim());
    if (m) box = cellBox(LETTERS.indexOf(m[1].toUpperCase()), Number(m[2]) - 1, 1, 1);
  }
  if (!box) return;

  var t = document.createElement('div');
  t.style.cssText = 'position:absolute;overflow:hidden;background:#000;';
  place(t, box);
  root.appendChild(t);

  var ALL = [
    ['red', '#ff0000'], ['green', '#00ff00'], ['blue', '#0000ff'], ['white', '#ffffff'],
    ['black', '#000000'], ['gray50', '#808080'], ['gray25', '#404040'],
    ['cyan', '#00ffff'], ['magenta', '#ff00ff'], ['yellow', '#ffff00'],
    ['checker', null], ['vline', null], ['hline', null]
  ];
  var only = (q.get('only') || '').split(',').filter(Boolean);
  var list = only.length ? ALL.filter(function (x) { return only.indexOf(x[0]) >= 0; }) : ALL;
  if (!list.length) list = ALL;

  var i = -1, tick = null;
  function stop() { if (tick) { clearInterval(tick); tick = null; } t.innerHTML = ''; t.style.background = '#000'; }
  function next() {
    i = (i + 1) % list.length;
    stop();
    var name = list[i][0], color = list[i][1];
    if (color) { t.style.background = color; return; }
    if (name === 'checker') {
      var flip = false;
      var draw = function () {
        var a = flip ? '#fff' : '#000', b = flip ? '#000' : '#fff';
        t.style.background = 'repeating-conic-gradient(' + a + ' 0 25%, ' + b + ' 0 50%) 0 0 / 8px 8px';
      };
      draw(); tick = setInterval(function () { flip = !flip; draw(); }, 1000);
      return;
    }
    var line = document.createElement('div');
    line.style.cssText = 'position:absolute;background:#fff;' +
      (name === 'vline' ? 'top:0;bottom:0;width:3px;' : 'left:0;right:0;height:3px;');
    t.appendChild(line);
    var pos = 0, steps = 40;   // one slow pass every ~SECS/2 seconds
    tick = setInterval(function () {
      pos = (pos + 1) % steps;
      line.style[name === 'vline' ? 'left' : 'top'] = (pos / steps * 100) + '%';
    }, SECS * 1000 / 2 / steps);
  }
  next();
  setInterval(next, SECS * 1000);
})();
