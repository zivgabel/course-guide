/* Personal notes for the course guide.
   Select text inside a chapter -> "+ הערה" -> the note is saved in localStorage and the text is underlined.
   Notes are anchored by the quoted text plus a little context before and after it, so they survive rebuilds
   as long as the quoted text itself is unchanged. Nothing leaves the browser; export/import is a JSON file. */
(function () {
  var KEY = 'cg-notes-v1', SVGNS = 'http://www.w3.org/2000/svg', CTX = 40;
  var page = (location.pathname.split('/').pop() || 'index').replace(/\.html$/, '') || 'index';
  var notes = load();

  function load() { try { return JSON.parse(localStorage.getItem(KEY)) || []; } catch (e) { return []; } }
  function store() {
    try { localStorage.setItem(KEY, JSON.stringify(notes)); return true; }
    catch (e) { toast('לא הצלחתי לשמור – ייתכן שהדפדפן חוסם אחסון מקומי'); return false; }
  }
  function el(tag, cls, txt) { var e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; }
  function btn(txt, cls, fn) { var b = el('button', cls, txt); b.type = 'button'; b.addEventListener('click', fn); return b; }
  function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }
  function byId(id) { for (var i = 0; i < notes.length; i++) if (notes[i].id === id) return notes[i]; }
  function fmt(ts) { try { return new Date(ts).toLocaleDateString('he-IL', { day: 'numeric', month: 'short', year: 'numeric' }); } catch (e) { return ''; } }
  var PAGES = {};
  Array.prototype.forEach.call(document.querySelectorAll('.vols a'), function (a) {
    PAGES[(a.getAttribute('href') || '').replace(/\.html$/, '')] = a.textContent;
  });

  /* ---------- text model of a chapter: its text nodes (outside SVG) and their offsets ---------- */
  function texts(root) {
    var w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, { acceptNode: function (n) {
      for (var p = n.parentNode; p && p !== root; p = p.parentNode)
        if (p.namespaceURI === SVGNS || p.nodeName === 'STYLE' || p.nodeName === 'SCRIPT') return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    } });
    var list = [], parts = [], pos = 0, n;
    while ((n = w.nextNode())) { list.push({ n: n, s: pos }); parts.push(n.data); pos += n.data.length; }
    return { list: list, text: parts.join('') };
  }
  function offsetOf(t, node, off) {
    if (node.nodeType === 3) for (var i = 0; i < t.list.length; i++) if (t.list[i].n === node) return t.list[i].s + off;
    var r = document.createRange(); r.setStart(node, Math.min(off, node.childNodes.length)); r.collapse(true);
    for (var j = 0; j < t.list.length; j++) if (r.comparePoint(t.list[j].n, 0) >= 0) return t.list[j].s;
    return t.text.length;
  }
  function common(a, b, fromEnd) {
    var k = 0, n = Math.min(a.length, b.length);
    while (k < n && (fromEnd ? a[a.length - 1 - k] === b[b.length - 1 - k] : a[k] === b[k])) k++;
    return k;
  }
  function locate(text, n) {
    var best = -1, bs = -1, i = text.indexOf(n.quote);
    while (i >= 0) {
      var sc = common(text.slice(Math.max(0, i - CTX), i), n.pre || '', true) +
               common(text.slice(i + n.quote.length, i + n.quote.length + CTX), n.suf || '', false);
      if (sc > bs) { bs = sc; best = i; }
      i = text.indexOf(n.quote, i + 1);
    }
    return best;
  }
  function wrap(sec, s, e, id) {
    var made = [];
    texts(sec).list.forEach(function (x) {
      var len = x.n.data.length, a = Math.max(s, x.s) - x.s, b = Math.min(e, x.s + len) - x.s;
      if (a >= b || !/\S/.test(x.n.data.slice(a, b))) return;
      var n = x.n;
      if (b < len) n.splitText(b);
      if (a > 0) n = n.splitText(a);
      var sp = el('span', 'un'); sp.setAttribute('data-nid', id);
      n.parentNode.insertBefore(sp, n); sp.appendChild(n); made.push(sp);
    });
    if (made.length) made[made.length - 1].classList.add('un-end');
    return made;
  }
  function unwrap(id) {
    Array.prototype.forEach.call(document.querySelectorAll('.un[data-nid="' + id + '"]'), function (sp) {
      var p = sp.parentNode;
      while (sp.firstChild) p.insertBefore(sp.firstChild, sp);
      p.removeChild(sp); p.normalize();
    });
  }
  function paint(n) {
    var sec = document.getElementById(n.ch);
    if (!sec) return false;
    var t = texts(sec), i = locate(t.text, n);
    return i >= 0 && wrap(sec, i, i + n.quote.length, n.id).length > 0;
  }

  /* ---------- UI ---------- */
  var ui = el('div', 'un-ui'); document.body.appendChild(ui);
  var toastEl = el('div'); toastEl.id = 'un-toast'; toastEl.hidden = true; ui.appendChild(toastEl);
  var toastT;
  function toast(m) { toastEl.textContent = m; toastEl.hidden = false; clearTimeout(toastT); toastT = setTimeout(function () { toastEl.hidden = true; }, 2600); }

  // "+ הערה" button that follows the selection
  function google(q) { window.open('https://www.google.com/search?q=' + encodeURIComponent(q), '_blank', 'noopener'); }
  var add = el('div'); add.id = 'un-add'; add.hidden = true; ui.appendChild(add);
  add.appendChild(btn('+ הערה', '', function () { if (pending) openEditor(null, pending); hideAdd(); }));
  add.appendChild(btn('חיפוש בגוגל', '', function () { if (pending) google(pending.quote); hideAdd(); }));
  add.addEventListener('pointerdown', function (e) { e.preventDefault(); }); // keep the selection alive
  add.addEventListener('mousedown', function (e) { e.preventDefault(); });
  var pending = null, selT;
  function hideAdd() { add.hidden = true; }
  function readSelection() {
    var sel = window.getSelection();
    if (!sel || sel.isCollapsed || !sel.rangeCount) return null;
    var r = sel.getRangeAt(0), anc = r.commonAncestorContainer;
    if (anc.nodeType !== 1) anc = anc.parentNode;
    if (anc.closest && anc.closest('svg, .un-ui')) return null;
    var sec = anc.closest && anc.closest('section.chapter');
    if (!sec) return null;
    var t = texts(sec), s = offsetOf(t, r.startContainer, r.startOffset), e = offsetOf(t, r.endContainer, r.endOffset);
    while (s < e && /\s/.test(t.text[s])) s++;
    while (e > s && /\s/.test(t.text[e - 1])) e--;
    if (e - s < 1 || e - s > 1500) return null;
    return { ch: sec.id, chTitle: (sec.querySelector('h2') || {}).textContent || sec.id, s: s, e: e,
             quote: t.text.slice(s, e), pre: t.text.slice(Math.max(0, s - CTX), s), suf: t.text.slice(e, e + CTX), rect: r.getBoundingClientRect() };
  }
  function onSel() {
    clearTimeout(selT);
    selT = setTimeout(function () {
      var p = readSelection();
      if (!p) { if (!edBack.hidden) return; pending = null; hideAdd(); return; }
      pending = p;
      var coarse = window.matchMedia && matchMedia('(pointer: coarse)').matches;
      var x = Math.min(Math.max(p.rect.left + p.rect.width / 2, 125), document.documentElement.clientWidth - 125);
      add.style.left = (x + scrollX) + 'px';
      add.style.top = (p.rect.bottom + scrollY + (coarse ? 34 : 10)) + 'px'; // below the native handles/menu on touch
      add.hidden = false;
    }, 180);
  }
  document.addEventListener('selectionchange', onSel);

  // editor
  var edBack = el('div', 'un-back'); edBack.hidden = true;
  var ed = el('div', 'un-card'); ed.setAttribute('role', 'dialog'); ed.setAttribute('aria-modal', 'true');
  var edH = el('h3'), edQ = el('blockquote', 'un-q'), edT = el('textarea');
  edT.setAttribute('aria-label', 'טקסט ההערה'); edT.placeholder = 'הסבר, הגדרה, דרך לזכור…';
  var edRow = el('div', 'un-row'), editing = null, draft = null;
  edRow.appendChild(btn('שמירה', 'pri', saveEditor));
  edRow.appendChild(btn('ביטול', '', closeEditor));
  edRow.appendChild(el('span', 'sp'));
  edRow.appendChild(el('span', 'un-hint', 'Ctrl+Enter לשמירה'));
  ed.appendChild(edH); ed.appendChild(edQ); ed.appendChild(edT); ed.appendChild(edRow);
  edBack.appendChild(ed); ui.appendChild(edBack);
  edBack.addEventListener('click', function (e) { if (e.target === edBack) closeEditor(); });
  edT.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); saveEditor(); }
    if (e.key === 'Escape') closeEditor();
  });
  function openEditor(n, p) {
    editing = n; draft = p; hidePop();
    edH.textContent = n ? 'עריכת הערה' : 'הערה חדשה';
    edQ.textContent = (n || p).quote;
    edT.value = n ? n.text : '';
    edBack.hidden = false; edT.focus();
  }
  function closeEditor() { edBack.hidden = true; editing = draft = null; }
  function saveEditor() {
    var v = edT.value.replace(/\s+$/, '');
    if (!v) { edT.focus(); return; }
    if (editing) { editing.text = v; editing.upd = Date.now(); }
    else {
      var n = { id: uid(), page: page, ch: draft.ch, chTitle: draft.chTitle.trim(), quote: draft.quote, pre: draft.pre, suf: draft.suf, text: v, ts: Date.now() };
      notes.push(n);
      wrap(document.getElementById(n.ch), draft.s, draft.e, n.id);
      var s = window.getSelection(); if (s) s.removeAllRanges();
    }
    store(); closeEditor(); hideAdd(); refresh();
  }

  // popover shown when a highlight is clicked
  var pop = el('div'); pop.id = 'un-pop'; pop.hidden = true; pop.setAttribute('role', 'dialog');
  var popT = el('p', 'txt'), popM = el('div', 'meta'), popRow = el('div', 'un-row'), popN = null;
  var delB = btn('מחיקה', 'del', function () {
    if (delB.getAttribute('data-sure') !== '1') { delB.setAttribute('data-sure', '1'); delB.textContent = 'למחוק?'; return; }
    unwrap(popN.id); notes = notes.filter(function (x) { return x !== popN; }); store(); hidePop(); refresh(); toast('ההערה נמחקה');
  });
  popRow.appendChild(btn('עריכה', '', function () { openEditor(popN); }));
  popRow.appendChild(delB);
  popRow.appendChild(btn('חיפוש בגוגל', '', function () { google(popN.quote); }));
  pop.appendChild(popT); pop.appendChild(popM); pop.appendChild(popRow); ui.appendChild(pop);
  function hidePop() { pop.hidden = true; popN = null; }
  function showPop(n, target) {
    popN = n; popT.textContent = n.text; popM.textContent = fmt(n.upd || n.ts);
    delB.removeAttribute('data-sure'); delB.textContent = 'מחיקה';
    pop.hidden = false;
    var r = target.getBoundingClientRect(), w = pop.offsetWidth, vw = document.documentElement.clientWidth;
    pop.style.left = (Math.min(Math.max(r.left + r.width / 2 - w / 2, 16), vw - w - 16) + scrollX) + 'px';
    pop.style.top = (r.bottom + scrollY + 8) + 'px';
  }
  document.addEventListener('click', function (e) {
    var h = e.target.closest && e.target.closest('.un');
    if (h) {
      var s = window.getSelection(); if (s && !s.isCollapsed) return; // user is selecting, not opening
      var n = byId(h.getAttribute('data-nid')); if (n) { showPop(n, h); e.stopPropagation(); }
      return;
    }
    if (!pop.hidden && !pop.contains(e.target)) hidePop();
  });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') { hidePop(); hidePanel(); } });

  // floating button + side panel
  var fab = btn('ההערות שלי', '', function () { panel.hidden ? showPanel() : hidePanel(); });
  fab.id = 'un-fab'; var fabC = el('span', 'c'); fab.appendChild(fabC); ui.appendChild(fab);
  var panel = el('aside'); panel.id = 'un-panel'; panel.hidden = true; panel.setAttribute('aria-label', 'ההערות שלי');
  var ph = el('header'); ph.appendChild(el('h3', '', 'ההערות שלי')); ph.appendChild(btn('סגירה', '', hidePanel));
  var pb = el('div', 'body'), pf = el('footer'), pfr = el('div', 'un-row');
  var file = el('input'); file.type = 'file'; file.accept = '.json,application/json'; file.hidden = true;
  pfr.appendChild(btn('ייצוא לקובץ', '', exportNotes));
  pfr.appendChild(btn('ייבוא מקובץ', '', function () { file.click(); }));
  pf.appendChild(pfr); pf.appendChild(file);
  pf.appendChild(el('div', '', 'סמנו טקסט בסיכום כדי להוסיף הערה. ההערות נשמרות רק בדפדפן הזה ובמכשיר הזה. כדאי לייצא גיבוי מדי פעם, ובעזרת ייבוא אפשר להעביר אותן למכשיר אחר.'));
  panel.appendChild(ph); panel.appendChild(pb); panel.appendChild(pf); ui.appendChild(panel);
  function hidePanel() { panel.hidden = true; }
  function showPanel() { hidePop(); renderPanel(); panel.hidden = false; }
  function item(n, here) {
    var a;
    if (here) a = btn('', 'it' + (n.orphan ? ' orphan' : ''), function () { if (!n.orphan) jump(n.id); else toast('הטקסט המקורי השתנה ולא נמצא בעמוד'); });
    else { a = el('a', 'it'); a.href = n.page + '.html#note-' + n.id; }
    a.appendChild(el('span', 'q', (n.orphan ? 'מיקום לא נמצא · ' : '') + '„' + n.quote + '“'));
    a.appendChild(el('span', 't', n.text));
    return a;
  }
  function renderPanel() {
    pb.textContent = '';
    if (!notes.length) { pb.appendChild(el('p', 'empty', 'אין עדיין הערות. סמנו מילה או משפט בסיכום ולחצו „+ הערה“.')); return; }
    var mine = notes.filter(function (n) { return n.page === page; });
    var groups = {}, order = [];
    mine.forEach(function (n) { if (!groups[n.ch]) { groups[n.ch] = []; order.push(n.ch); } groups[n.ch].push(n); });
    var secs = Array.prototype.map.call(document.querySelectorAll('section.chapter'), function (s) { return s.id; });
    order.sort(function (a, b) { return secs.indexOf(a) - secs.indexOf(b); });
    order.forEach(function (ch) {
      pb.appendChild(el('h4', '', groups[ch][0].chTitle));
      groups[ch].forEach(function (n) { pb.appendChild(item(n, true)); });
    });
    var other = {}, oo = [];
    notes.forEach(function (n) { if (n.page !== page) { if (!other[n.page]) { other[n.page] = []; oo.push(n.page); } other[n.page].push(n); } });
    oo.forEach(function (p) {
      pb.appendChild(el('h4', '', (PAGES[p] || p) + ' · ' + other[p].length));
      other[p].forEach(function (n) { pb.appendChild(item(n, false)); });
    });
  }
  function jump(id) {
    var sp = document.querySelectorAll('.un[data-nid="' + id + '"]');
    if (!sp.length) return;
    if (matchMedia('(max-width: 700px)').matches) hidePanel();
    sp[0].scrollIntoView({ block: 'center', behavior: 'smooth' });
    Array.prototype.forEach.call(sp, function (s) { s.classList.remove('un-flash'); void s.offsetWidth; s.classList.add('un-flash'); });
  }
  function refresh() {
    fabC.textContent = notes.length;
    fabC.hidden = !notes.length;
    if (!panel.hidden) renderPanel();
  }
  function exportNotes() {
    var blob = new Blob([JSON.stringify({ app: 'course-guide-notes', v: 1, exported: new Date().toISOString(), notes: notes }, null, 1)], { type: 'application/json' });
    var a = el('a'); a.href = URL.createObjectURL(blob);
    a.download = 'הערות-סיכום-פרמדיק-' + new Date().toISOString().slice(0, 10) + '.json';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
  }
  file.addEventListener('change', function () {
    var f = file.files[0]; if (!f) return;
    var rd = new FileReader();
    rd.onload = function () {
      try {
        var d = JSON.parse(rd.result), list = Array.isArray(d) ? d : d.notes, added = 0;
        if (!Array.isArray(list)) throw 0;
        list.forEach(function (n) {
          if (!n || !n.id || typeof n.quote !== 'string' || typeof n.text !== 'string' || byId(n.id)) return;
          notes.push(n); added++;
          if (n.page === page) n.orphan = !paint(n);
        });
        store(); refresh(); toast(added ? 'יובאו ' + added + ' הערות' : 'אין הערות חדשות בקובץ');
      } catch (e) { toast('הקובץ אינו קובץ הערות תקין'); }
      file.value = '';
    };
    rd.readAsText(f);
  });

  // initial paint
  notes.forEach(function (n) { if (n.page === page) n.orphan = !paint(n); });
  refresh();
  var m = /^#note-(.+)$/.exec(location.hash);
  if (m) setTimeout(function () { jump(decodeURIComponent(m[1])); }, 300);
})();
