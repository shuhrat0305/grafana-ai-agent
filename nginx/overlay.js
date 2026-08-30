// Chat overlay injected into Grafana by the nginx sidecar.
//
// Reads nothing from Grafana's markup; POSTs to /agent/api/chat and renders the
// server-sent {type, content} stream. type is one of: thinking, tool_start,
// answer, error. Self-contained, no build step, no external assets.
(function () {
  'use strict';
  if (window.__agentOverlayLoaded) { return; }
  window.__agentOverlayLoaded = true;

  var BASE = '/agent';
  var TITLE = 'Ask the agent';
  var ACCENT = '#34b414';               // teal, distinct from Grafana's blue chrome
  var LS_UI = 'agent_ui';               // size + open state, across tabs
  var SS_LOG = 'agent_log';             // transcript, per tab
  var SS_SID = 'agent_session';         // session id, per tab
  var MIN_W = 320, MIN_H = 260;

  // ---- persistence --------------------------------------------------------
  function load(store, key, fb) { try { return JSON.parse(store.getItem(key)) || fb; } catch (e) { return fb; } }
  function save(store, key, v) { try { store.setItem(key, JSON.stringify(v)); } catch (e) {} }
  var ui = load(localStorage, LS_UI, { w: 440, h: 560, open: false });
  var history = load(sessionStorage, SS_LOG, []);
  function sessionId() {
    var v = sessionStorage.getItem(SS_SID);
    if (!v) { v = 'session_' + Date.now() + '_' + Math.random().toString(36).slice(2, 11); sessionStorage.setItem(SS_SID, v); }
    return v;
  }

  // ---- styles -------------------------------------------------------------
  function injectStyles() {
    if (document.getElementById('agent-styles')) { return; }
    if (!document.getElementById('agent-fonts')) {
      var f = document.createElement('link');
      f.id = 'agent-fonts'; f.rel = 'stylesheet';
      f.href = 'https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500&family=IBM+Plex+Sans:wght@400;500;600;700&display=swap';
      document.head.appendChild(f);
    }
    var css = [
      '.ag-root{--ag:' + ACCENT + ';--blue:#0078F7;--red:#FF2945;--cyan:#09C2FE;',
      '  --ink:#0f1117;--surface:#1a1f2e;--line:#2d3748;--text:#e2e8f0;--muted:#64748b;',
      '  --mono:"IBM Plex Mono",ui-monospace,Menlo,Consolas,monospace;',
      '  --body:"IBM Plex Sans",Inter,-apple-system,system-ui,sans-serif}',
      '.ag-pill{position:fixed;right:16px;bottom:16px;height:40px;padding:0 16px 0 14px;display:flex;',
      '  align-items:center;gap:8px;border:1px solid var(--line);border-radius:20px;cursor:pointer;',
      '  background:var(--ink);color:var(--text);font:600 12px/1 var(--mono);letter-spacing:.08em;',
      '  text-transform:uppercase;box-shadow:0 6px 20px rgba(0,0,0,.5);z-index:2147483000}',
      '.ag-pill:hover{border-color:var(--ag);color:#fff}',
      '.ag-dot{width:7px;height:7px;border-radius:50%;background:var(--ag);flex:none}',
      '.ag-panel{position:fixed;right:16px;bottom:68px;display:none;flex-direction:column;',
      '  max-width:calc(100vw - 32px);max-height:calc(100vh - 100px);background:var(--ink);color:var(--text);',
      '  border:1px solid var(--line);border-top:1px solid var(--ag);border-radius:10px;',
      '  box-shadow:0 18px 50px rgba(0,0,0,.6);font:14px/1.55 var(--body);z-index:2147483000;overflow:hidden}',
      '.ag-head{display:flex;align-items:center;gap:8px;padding:9px 10px 9px 16px;border-bottom:1px solid var(--line);',
      '  flex:none;font:600 12px/1 var(--mono);letter-spacing:.1em;text-transform:uppercase}',
      '.ag-sp{flex:1}',
      '.ag-act{background:none;border:0;color:var(--muted);cursor:pointer;padding:3px 6px;border-radius:4px;',
      '  font:500 11px/1 var(--mono);letter-spacing:.06em}',
      '.ag-act:hover{color:var(--text);background:var(--surface)}',
      '.ag-x{font-size:16px}',
      '.ag-grip{position:absolute;top:0;left:0;width:18px;height:18px;cursor:nwse-resize;',
      '  border-left:2px solid var(--line);border-top:2px solid var(--ag);border-top-left-radius:10px}',
      '.ag-log{flex:1;overflow-y:auto;padding:14px 12px;display:flex;flex-direction:column;gap:14px}',
      '.ag-log::-webkit-scrollbar{width:8px}.ag-log::-webkit-scrollbar-thumb{background:var(--line);border-radius:4px}',
      '.ag-turn{display:flex;flex-direction:column;gap:3px;max-width:94%}',
      '.ag-turn.me{align-self:flex-end;align-items:flex-end;max-width:82%}',
      '.ag-msg{padding:9px 12px;border-radius:8px;overflow-wrap:anywhere}',
      '.ag-turn.me .ag-msg{background:var(--blue);color:#fff;font-weight:500;border-bottom-right-radius:2px}',
      '.ag-turn.agent .ag-msg{background:var(--surface);border-left:2px solid var(--ag);border-radius:2px 8px 8px 2px}',
      '.ag-meta{display:flex;gap:10px;align-items:center;padding:0 2px;font:400 10px/1 var(--mono);letter-spacing:.06em;color:var(--muted)}',
      '.ag-copy{background:none;border:0;color:var(--muted);cursor:pointer;padding:0;font:400 10px/1 var(--mono)}',
      '.ag-copy:hover{color:var(--ag)}',
      '.ag-form{display:flex;gap:8px;padding:10px;border-top:1px solid var(--line);flex:none;align-items:flex-end}',
      '.ag-input{flex:1;background:#080a0d;color:var(--text);border:1px solid var(--line);border-radius:6px;',
      '  padding:8px 10px;font:14px/1.4 var(--body);resize:none;max-height:120px;overflow-y:auto}',
      '.ag-input:focus{outline:0;border-color:var(--ag)}',
      '.ag-send{flex:none;width:34px;height:34px;display:flex;align-items:center;justify-content:center;border:0;',
      '  border-radius:6px;cursor:pointer;background:var(--blue);color:#fff}',
      '.ag-send:hover{filter:brightness(1.12)}.ag-send.busy{background:var(--red)}',
      '.ag-h{font:600 12px/1.3 var(--mono);letter-spacing:.08em;text-transform:uppercase;color:var(--ag);margin:12px 0 5px}',
      '.ag-h:first-child{margin-top:0}.ag-p{margin:4px 0}.ag-ul,.ag-ol{margin:5px 0;padding-left:18px}.ag-li{margin:2px 0}',
      '.ag-code{font:12px/1.4 var(--mono);background:#080a0d;color:var(--cyan);padding:1px 5px;border-radius:3px}',
      '.ag-pre{background:#080a0d;border-left:2px solid var(--line);padding:9px 10px;border-radius:4px;overflow-x:auto;margin:7px 0}',
      '.ag-pre code{font:12px/1.5 var(--mono);color:var(--text);background:none;padding:0}',
      '.ag-hr{border:0;border-top:1px solid var(--line);margin:10px 0}.ag-a{color:var(--ag)}',
      '.ag-table{border-collapse:collapse;margin:8px 0;width:100%;font:12px/1.5 var(--mono);font-variant-numeric:tabular-nums}',
      '.ag-table th{padding:4px 8px;border-bottom:1px solid var(--ag);font-weight:600;color:var(--muted);text-transform:uppercase;letter-spacing:.06em;font-size:10px;white-space:nowrap}',
      '.ag-table td{padding:4px 8px;border-bottom:1px solid var(--line);white-space:nowrap}.ag-table tr:last-child td{border-bottom:0}',
      '.ag-think{display:flex;align-items:center;gap:8px;color:var(--muted);font:400 12px/1.4 var(--body)}',
      '.ag-dots{display:inline-flex;gap:4px;flex:none}',
      '.ag-dots i{width:5px;height:5px;border-radius:50%;background:var(--ag);display:inline-block;animation:ag-blink 1.2s infinite ease-in-out}',
      '.ag-dots i:nth-child(2){animation-delay:.16s}.ag-dots i:nth-child(3){animation-delay:.32s}',
      '@keyframes ag-blink{0%,80%,100%{opacity:.25;transform:translateY(0)}40%{opacity:1;transform:translateY(-3px)}}',
      '.ag-trace{margin:2px 0 7px;border-left:2px solid var(--line);padding-left:9px}',
      '.ag-trace summary{cursor:pointer;color:var(--muted);list-style:none;font:600 10px/1.3 var(--mono);letter-spacing:.08em;text-transform:uppercase}',
      '.ag-trace summary::-webkit-details-marker{display:none}',
      '.ag-trace-body{margin-top:5px;color:var(--muted);white-space:pre-wrap;font:italic 12px/1.5 var(--body)}',
      '.ag-status{color:var(--muted);font:italic 12px/1.4 var(--body);margin-top:5px}',
      '.ag-msg.ag-err{border-left:2px solid var(--red)}',
      '.ag-errline{color:var(--red);font:500 12px/1.45 var(--body)}',
      '.ag-retry{margin-top:9px;display:inline-flex;gap:6px;background:rgba(255,41,69,.12);color:var(--red);cursor:pointer;',
      '  border:1px solid rgba(255,41,69,.35);border-radius:6px;padding:5px 12px;font:600 11px/1 var(--mono);letter-spacing:.06em;text-transform:uppercase}',
      '.ag-retry:hover{background:rgba(255,41,69,.22)}',
      '@media (prefers-reduced-motion:reduce){.ag-dots i{animation:none}}'
    ].join('');
    var s = document.createElement('style');
    s.id = 'agent-styles';
    s.appendChild(document.createTextNode(css));
    document.head.appendChild(s);
  }

  // ---- markdown (small subset, HTML escaped first) ------------------------
  function esc(s) { return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
  function unesc(s) { return s.replace(/\\r\\n/g, '\n').replace(/\\n/g, '\n').replace(/\\t/g, '  '); }
  function inline(s) {
    return s
      .replace(/`([^`]+)`/g, '<code class="ag-code">$1</code>')
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/(^|[^*])\*([^*]+)\*/g, '$1<em>$2</em>')
      .replace(/\[([^\]]+)\]\((https?:[^)]+)\)/g, '<a class="ag-a" href="$2" target="_blank" rel="noopener">$1</a>');
  }
  function renderMd(raw) {
    var text = unesc(esc(raw));
    var lines = text.split('\n'), out = [], list = null, inCode = false;
    function closeList() { if (list) { out.push(list === 'ul' ? '</ul>' : '</ol>'); list = null; } }
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i];
      var fence = line.match(/^```(.*)$/);
      if (fence) { if (inCode) { out.push('</code></pre>'); inCode = false; } else { closeList(); out.push('<pre class="ag-pre"><code>'); inCode = true; } continue; }
      if (inCode) { out.push(esc ? line : line); out.push('\n'); continue; }
      // table: header | --- | rows
      if (/^\s*\|.*\|\s*$/.test(line) && i + 1 < lines.length && /^\s*\|[\s:|-]+\|\s*$/.test(lines[i + 1])) {
        closeList();
        var head = line.trim().replace(/^\||\|$/g, '').split('|').map(function (c) { return '<th>' + inline(c.trim()) + '</th>'; }).join('');
        out.push('<table class="ag-table"><thead><tr>' + head + '</tr></thead><tbody>');
        i += 2;
        for (; i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i]); i++) {
          var cells = lines[i].trim().replace(/^\||\|$/g, '').split('|').map(function (c) { return '<td>' + inline(c.trim()) + '</td>'; }).join('');
          out.push('<tr>' + cells + '</tr>');
        }
        i--; out.push('</tbody></table>'); continue;
      }
      var h = line.match(/^(#{1,4})\s+(.*)$/);
      if (h) { closeList(); out.push('<div class="ag-h">' + inline(h[2]) + '</div>'); continue; }
      var ulm = line.match(/^\s*[-*]\s+(.*)$/);
      if (ulm) { if (list !== 'ul') { closeList(); out.push('<ul class="ag-ul">'); list = 'ul'; } out.push('<li class="ag-li">' + inline(ulm[1]) + '</li>'); continue; }
      var olm = line.match(/^\s*\d+[.)]\s+(.*)$/);
      if (olm) { if (list !== 'ol') { closeList(); out.push('<ol class="ag-ol">'); list = 'ol'; } out.push('<li class="ag-li">' + inline(olm[1]) + '</li>'); continue; }
      if (/^\s*[-—]{3,}\s*$/.test(line)) { closeList(); out.push('<hr class="ag-hr">'); continue; }
      if (!line.trim()) { closeList(); continue; }
      closeList(); out.push('<div class="ag-p">' + inline(line) + '</div>');
    }
    if (inCode) { out.push('</code></pre>'); }
    closeList();
    return out.join('');
  }

  // ---- dom helper ---------------------------------------------------------
  function el(tag, props, kids) {
    var n = document.createElement(tag);
    Object.keys(props || {}).forEach(function (k) {
      if (k === 'style') { n.setAttribute('style', props[k]); }
      else if (k.indexOf('on') === 0) { n.addEventListener(k.slice(2), props[k]); }
      else { n.setAttribute(k, props[k]); }
    });
    (kids || []).forEach(function (c) { n.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
    return n;
  }
  function stamp() { var d = new Date(); return ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2); }

  function mount() {
    injectStyles();
    var log = el('div', { 'class': 'ag-log' });
    var input = el('textarea', { rows: '1', placeholder: 'Ask about this dashboard', 'aria-label': TITLE, 'class': 'ag-input' });
    input.addEventListener('input', function () { input.style.height = 'auto'; input.style.height = Math.min(input.scrollHeight, 120) + 'px'; });
    input.addEventListener('keydown', function (e) { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); form.dispatchEvent(new Event('submit', { cancelable: true })); } });

    var panel = el('div', { role: 'dialog', 'aria-label': TITLE, 'class': 'ag-root ag-panel', style: 'width:' + ui.w + 'px;height:' + ui.h + 'px' });
    var grip = el('div', { title: 'Drag to resize', 'class': 'ag-grip' });
    var header = el('div', { 'class': 'ag-head' }, [TITLE, el('span', { 'class': 'ag-sp' })]);
    var copyAll = el('button', { type: 'button', 'class': 'ag-act', title: 'Copy the whole conversation',
      onclick: function () { copyText(history.map(function (m) { return (m.role === 'user' ? 'Q: ' : 'A: ') + m.text; }).join('\n\n'), copyAll, 'Copy all'); } }, ['Copy all']);
    var newChat = el('button', { type: 'button', 'class': 'ag-act', title: 'Start a new conversation',
      onclick: function () { history = []; save(sessionStorage, SS_LOG, history); sessionStorage.removeItem(SS_SID); log.innerHTML = ''; input.focus(); } }, ['New chat']);
    var closeBtn = el('button', { type: 'button', 'class': 'ag-act ag-x', title: 'Close', onclick: function () { toggle(false); } }, ['\u00d7']);
    header.appendChild(copyAll); header.appendChild(newChat); header.appendChild(closeBtn);

    var ICON_SEND = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19V5"/><path d="M5 12l7-7 7 7"/></svg>';
    var ICON_STOP = '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><rect x="5" y="5" width="14" height="14" rx="2"/></svg>';
    var sendBtn = el('button', { type: 'submit', title: 'Send', 'aria-label': 'Send', 'class': 'ag-send' });
    sendBtn.innerHTML = ICON_SEND;
    var form = el('form', { 'class': 'ag-form' }, [input, sendBtn]);

    panel.appendChild(grip); panel.appendChild(header); panel.appendChild(log); panel.appendChild(form);
    var button = el('button', { type: 'button', 'aria-label': 'Open ' + TITLE, 'class': 'ag-root ag-pill', onclick: function () { toggle(); } }, [el('span', { 'class': 'ag-dot' }), TITLE]);
    document.body.appendChild(panel); document.body.appendChild(button);

    grip.addEventListener('pointerdown', function (e) {
      e.preventDefault(); var sx = e.clientX, sy = e.clientY, sw = panel.offsetWidth, sh = panel.offsetHeight;
      function move(ev) { panel.style.width = Math.max(MIN_W, sw + (sx - ev.clientX)) + 'px'; panel.style.height = Math.max(MIN_H, sh + (sy - ev.clientY)) + 'px'; }
      function up() { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); ui.w = panel.offsetWidth; ui.h = panel.offsetHeight; save(localStorage, LS_UI, ui); }
      window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
    });

    function toggle(force) {
      var open = typeof force === 'boolean' ? force : panel.style.display === 'none' || !panel.style.display;
      panel.style.display = open ? 'flex' : 'none';
      button.setAttribute('aria-expanded', open ? 'true' : 'false');
      ui.open = open; save(localStorage, LS_UI, ui);
      if (open) { input.focus(); log.scrollTop = log.scrollHeight; }
    }
    panel.addEventListener('keydown', function (e) { if (e.key === 'Escape') { e.stopPropagation(); toggle(false); button.focus(); } });

    function copyText(text, btn, restore) {
      function done(ok) { if (!btn) { return; } btn.textContent = ok ? 'Copied' : 'Failed'; setTimeout(function () { btn.textContent = restore; }, 1200); }
      if (navigator.clipboard && window.isSecureContext) { navigator.clipboard.writeText(text).then(function () { done(true); }, function () { done(false); }); return; }
      try { var ta = document.createElement('textarea'); ta.value = text; ta.setAttribute('style', 'position:fixed;left:-9999px'); document.body.appendChild(ta); ta.select(); var ok = document.execCommand('copy'); document.body.removeChild(ta); done(ok); } catch (e) { done(false); }
    }

    function bubble(role, html, raw) {
      var wrap = el('div', { 'class': 'ag-turn ' + (role === 'user' ? 'me' : 'agent') });
      var b = el('div', { 'class': 'ag-msg' }); b.innerHTML = html; b.__raw = raw;
      var meta = el('div', { 'class': 'ag-meta' }, [stamp()]);
      var cp = el('button', { type: 'button', title: 'Copy this message', 'class': 'ag-copy' }, ['Copy']);
      cp.addEventListener('click', function () { copyText(b.__raw !== undefined ? b.__raw : raw, cp, 'Copy'); });
      meta.appendChild(cp); wrap.appendChild(b); wrap.appendChild(meta); log.appendChild(wrap); log.scrollTop = log.scrollHeight;
      return b;
    }
    function say(role, raw) { return bubble(role, role === 'user' ? esc(raw) : renderMd(raw), raw); }
    function remember(role, text) { history.push({ role: role, text: text }); if (history.length > 80) { history = history.slice(-80); } save(sessionStorage, SS_LOG, history); }

    history.forEach(function (m) { say(m.role, m.text); });
    if (ui.open) { toggle(true); }

    var inflight = null;
    function setBusy(b) { sendBtn.innerHTML = b ? ICON_STOP : ICON_SEND; sendBtn.setAttribute('class', b ? 'ag-send busy' : 'ag-send'); sendBtn.setAttribute('title', b ? 'Stop' : 'Send'); }

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      if (inflight) { inflight.abort(); inflight = null; setBusy(false); return; }
      var q = input.value.trim(); if (!q) { return; }
      input.value = ''; input.style.height = 'auto';
      say('user', q); remember('user', q);
      run(q, say('agent', ''));
    });

    function thinking(label) { return '<div class="ag-think"><span class="ag-dots"><i></i><i></i><i></i></span><span>' + esc(label || 'Thinking\u2026') + '</span></div>'; }

    function run(question, answer) {
      answer.setAttribute('class', 'ag-msg'); answer.innerHTML = thinking(); answer.__raw = '';
      var controller = new AbortController(); inflight = controller; setBusy(true);
      var text = '', thoughts = '', status = '', phaseBreak = false, seen = {};
      function render() {
        var parts = [];
        var trace = unesc(esc(thoughts)).replace(/^[ \t]*-{3,}[ \t]*$/gm, '').replace(/\s*-{3,}\s*$/, '').replace(/\n{3,}/g, '\n\n').replace(/^\s+|\s+$/g, '');
        if (trace) { parts.push('<details class="ag-trace"' + (text ? '' : ' open') + '><summary>Thinking</summary><div class="ag-trace-body">' + trace + '</div></details>'); }
        if (text) { parts.push(renderMd(text)); if (status) { parts.push('<div class="ag-status">' + esc(status) + '</div>'); } }
        else { parts.push(thinking(status)); }
        answer.innerHTML = parts.join(''); answer.__raw = text; log.scrollTop = log.scrollHeight;
      }
      function handle(payload) {
        if (payload === '[DONE]') { return; }
        var ev; try { ev = JSON.parse(payload); } catch (e) { text += payload; render(); return; }
        if (ev.error) { text += '\n\n[error] ' + ev.error; render(); return; }
        if (ev.type === 'thinking') { var c = ev.content || ''; if (thoughts && phaseBreak) { thoughts = thoughts.replace(/\s+$/, '') + '\n\n'; c = c.replace(/^\s+/, ''); } phaseBreak = false; thoughts += c; render(); return; }
        if (ev.type === 'tool_start') { status = 'running ' + ev.name + '\u2026'; phaseBreak = true; render(); return; }
        if (ev.type === 'tool_end') { status = ''; phaseBreak = true; render(); return; }
        if (ev.content) { status = ''; phaseBreak = true; text += ev.content; render(); }
      }
      fetch(BASE + '/api/chat', {
        method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
        signal: controller.signal, body: JSON.stringify({ message: question, session_id: sessionId() })
      }).then(function (res) {
        if (!res.ok) { throw new Error('agent returned ' + res.status); }
        var reader = res.body.getReader(), dec = new TextDecoder(), buf = '';
        return (function pump() {
          return reader.read().then(function (chunk) {
            if (chunk.done) { render(); remember('agent', text); return; }
            buf += dec.decode(chunk.value, { stream: true });
            var lines = buf.split('\n'); buf = lines.pop();
            lines.forEach(function (line) { if (line.indexOf('data: ') === 0) { handle(line.slice(6)); } });
            return pump();
          });
        })();
      }).catch(function (err) {
        if (err && err.name === 'AbortError') { answer.setAttribute('class', 'ag-msg'); answer.innerHTML = renderMd((text || '') + '\n\n*stopped*'); answer.__raw = text; return; }
        showError(err.message, question, answer);
      }).then(function () { inflight = null; setBusy(false); });
    }

    function showError(message, question, answer) {
      answer.setAttribute('class', 'ag-msg ag-err'); answer.innerHTML = '';
      answer.appendChild(el('div', { 'class': 'ag-errline' }, ['Could not reach the agent: ' + message]));
      var retry = el('button', { type: 'button', 'class': 'ag-retry', title: 'Send this question again' }, ['\u21bb Retry']);
      retry.addEventListener('click', function () { if (inflight) { return; } run(question, answer); });
      answer.appendChild(retry); answer.__raw = 'Could not reach the agent: ' + message; log.scrollTop = log.scrollHeight;
    }
  }

  if (document.readyState === 'loading') { document.addEventListener('DOMContentLoaded', mount); } else { mount(); }
})();
