/* Drug cards for the course guide.
   assemble.py wraps every drug name in the chapters in <span class="drug" data-drug="id">. Tapping one opens a card
   (data from drugs.json, built from drugs/data/*.json): how the drug comes, how to prepare it, and its pharmacology.
   When the text right after the name states a dose ("ונטולין 5 מ"ג"), the card converts it to mL of each presentation;
   a per-kg dose gets a weight box. */
(function () {
  var data = null, loading = null;
  function load() {
    if (data) return Promise.resolve(data);
    if (!loading) loading = fetch('drugs.json').then(function (r) { return r.json(); })
      .then(function (list) { data = {}; list.forEach(function (d) { data[d.id] = d; }); return data; });
    return loading;
  }

  function el(tag, cls, txt) { var e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; }
  var U = { mg: 'מ"ג', mcg: 'מק"ג', g: 'גרם', units: 'יחידות', mEq: 'מאק"ו' };
  var TO_MG = { mg: 1, mcg: 0.001, g: 1000 };
  // numbers and ranges ("0.05–0.1") inside Hebrew text: isolate them so RTL doesn't flip the range
  function ltr(e, t) {
    t.split(/(\d+(?:\.\d+)?(?:\s*[-–]\s*\d+(?:\.\d+)?)?)/).forEach(function (x, i) {
      if (i % 2) { var b = document.createElement('bdi'); b.dir = 'ltr'; b.textContent = x; e.appendChild(b); }
      else if (x) e.appendChild(document.createTextNode(x));
    });
    return e;
  }
  function num(x) { return String(Math.round(x * 100) / 100); }

  /* ---------- the dose written next to the name ---------- */
  var UNIT = '(מק"ג|מיקרוגרם|מ"ג|מיליגרם|גרם|גר\'|ג\'|יחידות|יח\'|מאק"ו|mcg|mg|gr|g|mEq)';
  var DOSE = new RegExp('^[^.;:!?\\n\\d]{0,28}?(\\d+(?:\\.\\d+)?)(?:\\s*[-–]\\s*(\\d+(?:\\.\\d+)?))?\\s*' + UNIT +
                        '(\\s*(?:\\/|ל)\\s*ק"ג)?(\\s*\\/\\s*(?:דקה|דק\'))?');
  function unitOf(u) {
    if (/^(מק"ג|מיקרוגרם|mcg)$/.test(u)) return 'mcg';
    if (/^(מ"ג|מיליגרם|mg)$/.test(u)) return 'mg';
    if (/^(גרם|גר'|ג'|gr|g)$/.test(u)) return 'g';
    if (/^(יחידות|יח')$/.test(u)) return 'units';
    if (/^(מאק"ו|mEq)$/.test(u)) return 'mEq';
    return u;
  }
  function doseAfter(span) {
    var block = span.closest('p, li, td, dd, .calc, .big, figcaption, div') || span.parentNode;
    var r = document.createRange();
    r.setStartAfter(span);
    r.setEnd(block, block.childNodes.length);
    var next = null, all = block.querySelectorAll('.drug');  // stop at the next drug name
    for (var i = 0; i < all.length; i++) if (span.compareDocumentPosition(all[i]) & Node.DOCUMENT_POSITION_FOLLOWING) { next = all[i]; break; }
    if (next) r.setEndBefore(next);
    var t = r.toString().replace(/[״”“]/g, '"').replace(/[׳’]/g, "'").replace(/\s+/g, ' ');
    var m = DOSE.exec(t);
    if (!m) return null;
    return { lo: +m[1], hi: m[2] ? +m[2] : null, unit: unitOf(m[3]), perKg: !!m[4], perMin: !!m[5], text: m[0].replace(/^[^\d]*/, '').trim() };
  }

  function mlOf(amount, unit, f) {
    if (!f.ml || !f.amount) return null;
    var a = amount;
    if (unit !== f.unit) {
      if (!(unit in TO_MG) || !(f.unit in TO_MG)) return null;
      a = amount * TO_MG[unit] / TO_MG[f.unit];
    }
    return a / (f.amount / f.ml);
  }
  function conc(f) {
    if (!f.ml || !f.amount) return '';
    return num(f.amount / f.ml) + ' ' + U[f.unit] + '/מ"ל';
  }
  function hasConc(f) { return f.text.replace(/\s/g, '').indexOf(conc(f).replace(/\s/g, '')) >= 0; }
  function mlText(dose, f) {
    var a = mlOf(dose.lo, dose.unit, f);
    if (a == null) return null;
    var s = num(a) + ' מ"ל';
    if (dose.hi != null) s = num(a) + '-' + num(mlOf(dose.hi, dose.unit, f)) + ' מ"ל';
    return s;
  }

  /* ---------- the card ---------- */
  var back = el('div', 'dg-back'); back.hidden = true;
  var card = el('div', 'dg-card'); card.setAttribute('role', 'dialog'); card.setAttribute('aria-modal', 'true');
  back.appendChild(card); document.body.appendChild(back);
  back.addEventListener('click', function (e) { if (e.target === back) close(); });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && !back.hidden) close(); });
  var lastFocus = null;
  function close() { back.hidden = true; document.documentElement.classList.remove('dg-open'); if (lastFocus) lastFocus.focus(); }

  function section(title, items, cls) {
    if (!items || (Array.isArray(items) && !items.length)) return null;
    var s = el('section', cls || '');
    s.appendChild(el('h4', '', title));
    if (Array.isArray(items)) {
      var ul = el('ul'); items.forEach(function (t) { ul.appendChild(el('li', '', t)); }); s.appendChild(ul);
    } else s.appendChild(el('p', '', items));
    return s;
  }

  function here(d, dose) {
    var box = el('div', 'dg-here');
    box.appendChild(el('div', 'k', 'בטקסט כאן'));
    var forms = (d.forms || []).filter(function (f) { return f.ml && f.amount; });
    if (!dose.perKg) {
      box.appendChild(ltr(el('div', 'dg-dose'), dose.text));
      var lines = dose.perMin ? [] : forms.map(function (f) { var m = mlText(dose, f); return m && { m: m, f: f }; }).filter(Boolean);
      lines.forEach(function (x) {
        var row = el('div', 'ml');
        row.appendChild(ltr(el('b'), x.m));
        row.appendChild(document.createTextNode(' מתוך ' + x.f.text + (hasConc(x.f) ? '' : ' (' + conc(x.f) + ')')));
        box.appendChild(row);
      });
      if (!lines.length) box.appendChild(el('div', 'hint', dose.perMin ? 'מינון לדקה בטפטוף: את הריכוז ואת קצב הזרימה מוצאים בהכנה למטה.' : 'אין צורת הופעה בנפח לחישוב מ"ל.'));
      return box;
    }
    // per kg: ask for the weight
    box.appendChild(ltr(el('div', 'dg-dose'), dose.text));
    var lab = el('label', 'wt'); lab.appendChild(document.createTextNode('משקל המטופל: '));
    var inp = el('input'); inp.type = 'number'; inp.inputMode = 'decimal'; inp.min = '0'; inp.step = 'any'; inp.placeholder = 'ק"ג';
    lab.appendChild(inp); lab.appendChild(document.createTextNode(' ק"ג')); box.appendChild(lab);
    var out = el('div', 'out'); box.appendChild(out);
    function calc() {
      out.textContent = '';
      var w = parseFloat(inp.value);
      if (!(w > 0)) { out.appendChild(el('div', 'hint', 'הקלידו משקל כדי לראות מנה ומ"ל.')); return; }
      var dd = { lo: dose.lo * w, hi: dose.hi != null ? dose.hi * w : null, unit: dose.unit };
      var t = num(dd.lo) + (dd.hi != null ? '-' + num(dd.hi) : '') + ' ' + (U[dd.unit] || dd.unit) + (dose.perMin ? '/דקה' : '');
      out.appendChild(el('div', 'ml')).appendChild(ltr(el('b'), t));
      if (dose.perMin) return;
      forms.forEach(function (f) {
        var m = mlText(dd, f); if (!m) return;
        var row = el('div', 'ml'); row.appendChild(ltr(el('b'), m)); row.appendChild(document.createTextNode(' מתוך ' + f.text)); out.appendChild(row);
      });
      out.appendChild(el('div', 'hint', 'לפני מתן: בדקו מנה מקסימלית בכרטיס.'));
    }
    inp.addEventListener('input', calc); calc();
    return box;
  }

  function open(d, dose, from) {
    lastFocus = from;
    card.textContent = '';
    var head = el('header');
    var t = el('div', 't'); t.appendChild(el('h3', '', d.name)); if (d.en) t.appendChild(el('span', 'en', d.en));
    head.appendChild(t);
    var x = el('button', 'x', '×'); x.type = 'button'; x.setAttribute('aria-label', 'סגירה'); x.addEventListener('click', close);
    head.appendChild(x); card.appendChild(head);
    if (d.group) card.appendChild(el('div', 'grp', d.group));
    if (dose) card.appendChild(here(d, dose));

    var forms = section('צורת הופעה', (d.forms || []).map(function (f) { var c = conc(f); return f.text + (c && !hasConc(f) ? '  ·  ' + c : ''); }), 'dg-forms');
    if (forms) card.appendChild(forms);
    var prep = (d.prep || []).map(function (p) { return p.use ? p.use + ': ' + p.how : p.how; });
    [section('הכנה', prep, 'dg-prep'),
     section('מנגנון פעולה', d.action),
     d.receptors ? section('קולטנים', d.receptors, 'dg-rec') : null,
     section('פרמקוקינטיקה', d.kinetics),
     section('התוויות', d.indications),
     section('מינון מבוגרים', d.adult),
     section('מינון ילדים', d.peds),
     section('התוויות נגד', d.contra, 'dg-contra'),
     section('תופעות לוואי', d.side),
     section('שימו לב', d.notes)].forEach(function (s) { if (s) card.appendChild(s); });
    var foot = el('footer');
    if (d.src && d.src.length) foot.appendChild(el('div', '', 'מקור: ' + d.src.join(' · ')));
    if (d.page) { var b = el('a', '', 'דף התרופה בספר הפרוטוקולים (עמ׳ ' + d.page + ') ←'); b.href = 'protocols.html#p=' + d.page; foot.appendChild(b); }
    var a = el('a', '', 'לכל כרטיסי המינון (פרק 13) ←'); a.href = 'inter.html#ch13'; foot.appendChild(a);
    card.appendChild(foot);

    back.hidden = false; document.documentElement.classList.add('dg-open');
    card.scrollTop = 0; x.focus();
    var inp = card.querySelector('.dg-here input'); if (inp && matchMedia('(hover: hover)').matches) inp.focus();
  }

  // capture phase: a drug inside a personal note opens the drug, not the note
  document.addEventListener('click', function (e) {
    var s = e.target.closest && e.target.closest('.drug');
    if (!s) return;
    var sel = window.getSelection(); if (sel && !sel.isCollapsed) return;  // selecting text for a note
    e.stopPropagation(); e.preventDefault();
    var dose = doseAfter(s);
    load().then(function (all) { var d = all[s.getAttribute('data-drug')]; if (d) open(d, dose, s); })
      .catch(function () { /* offline and never loaded: nothing to show */ });
  }, true);
  document.addEventListener('keydown', function (e) {
    if ((e.key === 'Enter' || e.key === ' ') && e.target.classList && e.target.classList.contains('drug')) { e.preventDefault(); e.target.click(); }
  });
  // fetch the data once the page is idle, so the first tap opens at once
  setTimeout(function () { if (document.querySelector('.drug')) load().catch(function () {}); }, 2000);
})();
