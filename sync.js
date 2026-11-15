/* Sync between devices for the course guide: master-exam history (cg_exam_hist) and personal notes (cg-notes-v1).
   The user keeps one sync code; the server stores the merged data under SHA-256(code), so the code itself never leaves
   the browser. Every sync is pull -> merge -> push, and a push that raced another device is merged again and retried.
   Pages listen for the "cgsync" event (fired when a merge changed local data) and reload their state. */
(function () {
  var URL_ = 'https://paramedic-sync.ziv2.workers.dev/v1/';
  var K = { code: 'cg_sync_code', rev: 'cg_sync_rev', at: 'cg_sync_at', hist: 'cg_exam_hist', reset: 'cg_exam_reset',
            notes: 'cg-notes-v1', del: 'cg-notes-del-v1' };

  function get(k, d) { try { var v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } }
  function set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
  function code() { try { return localStorage.getItem(K.code) || ''; } catch (e) { return ''; } }

  function readLocal() {
    return { v: 1, hist: get(K.hist, {}) || {}, reset: get(K.reset, 0) || 0, notes: get(K.notes, []) || [], del: get(K.del, {}) || {} };
  }
  function writeLocal(d) { set(K.hist, d.hist); set(K.reset, d.reset); set(K.notes, d.notes); set(K.del, d.del); }

  // history entry: [seen, right, lastOk, time]; the newer answer wins, and a reset drops everything answered before it
  function merge(a, b) {
    var reset = Math.max(a.reset || 0, b.reset || 0), hist = {}, del = {}, notes = {}, out = [];
    [a.hist || {}, b.hist || {}].forEach(function (h) {
      Object.keys(h).forEach(function (id) {
        var e = h[id], t = e[3] || 0, cur = hist[id];
        if (t < reset) return;
        if (!cur || t > (cur[3] || 0) || (t === (cur[3] || 0) && e[0] > cur[0])) hist[id] = e;
      });
    });
    [a.del || {}, b.del || {}].forEach(function (d) { Object.keys(d).forEach(function (id) { del[id] = Math.max(del[id] || 0, d[id]); }); });
    [a.notes || [], b.notes || []].forEach(function (list) {
      list.forEach(function (n) {
        if (!n || !n.id || del[n.id]) return;
        var cur = notes[n.id];
        if (!cur || (n.upd || n.ts || 0) > (cur.upd || cur.ts || 0)) notes[n.id] = n;
      });
    });
    Object.keys(notes).sort(function (x, y) { return (notes[x].ts || 0) - (notes[y].ts || 0); }).forEach(function (id) { out.push(notes[id]); });
    return { v: 1, hist: hist, reset: reset, notes: out, del: del };
  }
  var same = function (x, y) { return JSON.stringify(x) === JSON.stringify(y); };

  function keyOf(c) {
    var bytes = new TextEncoder().encode('cg-sync-v1:' + c.trim().toLowerCase());
    return crypto.subtle.digest('SHA-256', bytes).then(function (buf) {
      return Array.prototype.map.call(new Uint8Array(buf), function (x) { return ('0' + x.toString(16)).slice(-2); }).join('');
    });
  }
  function emit(status, detail) {
    try { window.dispatchEvent(new CustomEvent('cgsync', { detail: Object.assign({ status: status }, detail || {}) })); } catch (e) {}
  }

  var running = null, again = false;
  function sync() {
    var c = code();
    if (!c) return Promise.resolve('off');
    if (running) { again = true; return running; }
    emit('busy');
    running = keyOf(c).then(function (key) {
      return fetch(URL_ + key, { cache: 'no-store' }).then(function (r) {
        if (r.status === 404) return { rev: 0, data: null };
        if (!r.ok) throw new Error('get ' + r.status);
        return r.json();
      }).then(function (remote) {
        var local = readLocal(), merged = remote.data ? merge(local, remote.data) : local;
        var changed = !same(merged, local);
        if (changed) writeLocal(merged);
        function push(rev, data, tries) {
          return fetch(URL_ + key, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ rev: rev, data: data }) })
            .then(function (r) {
              if (r.status === 409 && tries > 0) return r.json().then(function (cur) {
                var m = merge(readLocal(), cur.data);
                writeLocal(m); changed = true;
                return push(cur.rev, m, tries - 1);
              });
              if (!r.ok) throw new Error('put ' + r.status);
              return r.json().then(function (x) { set(K.rev, x.rev); });
            });
        }
        return (remote.data && same(merged, remote.data) ? Promise.resolve() : push(remote.rev, merged, 3)).then(function () {
          set(K.at, Date.now());
          emit('ok', { changed: changed });
          return changed ? 'changed' : 'ok';
        });
      });
    }).catch(function (e) {
      emit('error', { message: String(e && e.message || e) });
      return 'error';
    }).then(function (res) {
      running = null;
      if (again) { again = false; setTimeout(sync, 0); }
      return res;
    });
    return running;
  }

  var timer = null;
  function schedule(ms) {
    if (!code()) return;
    clearTimeout(timer);
    timer = setTimeout(sync, ms == null ? 8000 : ms);
  }
  function newCode() {
    var abc = 'abcdefghjkmnpqrstuvwxyz23456789', a = new Uint8Array(12), s = '';
    crypto.getRandomValues(a);
    for (var i = 0; i < 12; i++) s += abc[a[i] % abc.length] + (i % 4 === 3 && i < 11 ? '-' : '');
    return s;
  }
  function setCode(c) {
    try { localStorage.setItem(K.code, c.trim().toLowerCase()); localStorage.removeItem(K.rev); localStorage.removeItem(K.at); } catch (e) {}
    return sync();
  }
  function clearCode() { try { [K.code, K.rev, K.at].forEach(function (k) { localStorage.removeItem(k); }); } catch (e) {} emit('off'); }

  window.CGSync = { sync: sync, schedule: schedule, code: code, setCode: setCode, clear: clearCode, newCode: newCode,
                    lastAt: function () { return get(K.at, 0); }, merge: merge };

  // sync when the page opens, when it comes back into view, and flush pending changes when it's hidden
  if (code()) setTimeout(sync, 300);
  document.addEventListener('visibilitychange', function () {
    if (!code()) return;
    if (document.visibilityState === 'visible') schedule(500);
    else if (timer) { clearTimeout(timer); timer = null; sync(); }
  });
})();
