// NARSIL Intel Collector — content.js
// Shadow DOM panel + message routing + dynamic per-network action buttons.
'use strict'

;(function () {
  if (window.__narsil_panel_loaded) return
  window.__narsil_panel_loaded = true

  var network = NarsilDetector.current()
  if (!network) return

  // ──────────────────────────────────────────────────────────────────────────
  // CSS
  // ──────────────────────────────────────────────────────────────────────────
  var CSS = `
    /* Sin @import a Google: este CSS se inyecta en CADA web visitada, y pedir ahí una
       fuente a un CDN delata a la identidad ante un tercero en cada página. Se usa la
       mono que el sistema ya tenga. */
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    :host { all: initial; }

    #narsil-tab {
      position: fixed; top: 72px; right: 0;
      width: 26px; height: 90px;
      background: #141B2E;
      border: 1px solid rgba(192, 141, 79, .4); border-right: none;
      border-radius: 5px 0 0 5px;
      display: flex; align-items: center; justify-content: center;
      cursor: pointer; z-index: 2147483646;
      writing-mode: vertical-rl; color: #DEC1B7;
      font-family: 'JetBrains Mono', ui-monospace, monospace; font-size: 10px; letter-spacing: 2px;
      user-select: none;
      box-shadow: -2px 0 12px rgba(192, 141, 79, .1);
    }
    #narsil-tab:hover { background: #041420; }

    #narsil-root {
      position: fixed; top: 0; right: 0;
      width: 310px; height: 100vh;
      background: #141B2E;
      border-left: 1px solid rgba(192, 141, 79, .3);
      color: #E4DED9;
      font-family: 'JetBrains Mono', ui-monospace, 'Courier New', monospace; font-size: 12px; line-height: 1.5;
      display: flex; flex-direction: column; overflow: hidden;
      z-index: 2147483647;
      box-shadow: -6px 0 32px rgba(0,0,0,.6);
      transition: transform .2s cubic-bezier(.4,0,.2,1);
    }
    #narsil-root.hidden { transform: translateX(100%); }

    .hdr {
      padding: 10px 12px 9px;
      border-bottom: 1px solid rgba(192, 141, 79, .2);
      display: flex; align-items: center; justify-content: space-between;
      flex-shrink: 0; background: #030d18;
    }
    .hdr-title { color: #DEC1B7; font-size: 10px; letter-spacing: 1.5px; white-space: nowrap; }
    .hdr-close {
      background: none; border: none; color: rgba(192, 141, 79, .5);
      cursor: pointer; font-size: 14px; line-height: 1; padding: 0 2px;
    }
    .hdr-close:hover { color: #DEC1B7; }

    .net-row {
      padding: 5px 12px; font-size: 10px;
      color: rgba(224,244,242,.5); letter-spacing: 1px;
      border-bottom: 1px solid rgba(192, 141, 79, .08); flex-shrink: 0;
    }
    .net-row span { color: #00ffdd; }

    .stats {
      display: flex; gap: 3px; padding: 7px 12px;
      border-bottom: 1px solid rgba(192, 141, 79, .08); flex-shrink: 0;
    }
    .stat-pill {
      flex: 1; background: rgba(192, 141, 79, .06);
      border: 1px solid rgba(192, 141, 79, .15); border-radius: 3px;
      padding: 4px 4px; text-align: center;
    }
    .stat-v { color: #DEC1B7; font-size: 13px; display: block; }
    .stat-l { color: rgba(224,244,242,.38); font-size: 9px; letter-spacing: 1px; text-transform: uppercase; }

    .section-hdr {
      padding: 5px 12px 3px;
      font-size: 9px; letter-spacing: 2px; text-transform: uppercase;
      color: rgba(192, 141, 79, .5);
      flex-shrink: 0;
    }
    .section-hdr.log-hdr {
      display: flex; justify-content: space-between; align-items: center;
    }
    .log-clear {
      background: none; border: 1px solid rgba(192, 141, 79, .2);
      border-radius: 3px; color: rgba(192, 141, 79, .55);
      font-family: inherit; font-size: 8px; letter-spacing: 1.5px;
      padding: 2px 6px; cursor: pointer; transition: all .12s;
    }
    .log-clear:hover { border-color: rgba(192, 141, 79, .6); color: #DEC1B7; background: rgba(192, 141, 79, .06); }

    #actions-wrap { padding: 0 12px 6px; display: flex; flex-direction: column; gap: 5px; flex-shrink: 0; }

    .panel-log {
      flex: 1; overflow-y: auto; padding: 5px 12px;
      min-height: 60px; border-top: 1px solid rgba(192, 141, 79, .08);
    }
    .log-line { padding: 2px 0; border-bottom: 1px solid rgba(192, 141, 79, .05); color: rgba(224,244,242,.6); word-break: break-word; font-size: 11px; }
    .log-line.ok  { color: #DEC1B7; }
    .log-line.err { color: #ff6060; }

    .export-wrap {
      padding: 7px 12px 10px;
      border-top: 1px solid rgba(192, 141, 79, .1); flex-shrink: 0;
      display: flex; flex-direction: column; gap: 5px;
    }
    .filter-row { display: flex; gap: 3px; margin-bottom: 2px; }
    .filter-btn {
      flex: 1; background: rgba(192, 141, 79, .04); border: 1px solid rgba(192, 141, 79, .15);
      border-radius: 3px; color: rgba(224,244,242,.45);
      font-family: inherit; font-size: 9px; letter-spacing: .5px; text-transform: uppercase;
      padding: 3px 4px; cursor: pointer; text-align: center; transition: all .12s;
    }
    .filter-btn:hover  { border-color: rgba(192, 141, 79, .4); color: rgba(224,244,242,.8); }
    .filter-btn.active { background: rgba(192, 141, 79, .14); border-color: #DEC1B7; color: #DEC1B7; }
    .btn-row2 { display: grid; grid-template-columns: 1fr 1fr; gap: 5px; }
    .btn-row4 { display: grid; grid-template-columns: 1fr 1fr 1fr 1fr; gap: 4px; }

    .btn {
      background: rgba(192, 141, 79, .07); border: 1px solid rgba(192, 141, 79, .28);
      border-radius: 3px; color: #E4DED9;
      font-family: inherit; font-size: 10px; letter-spacing: 1px; text-transform: uppercase;
      padding: 6px 8px; cursor: pointer; transition: background .12s; text-align: left;
    }
    .btn:hover  { background: rgba(192, 141, 79, .16); border-color: rgba(192, 141, 79, .55); }
    .btn:active { background: rgba(192, 141, 79, .26); }
    .btn.primary { border-color: rgba(192, 141, 79, .7); color: #DEC1B7; }
    .btn.danger  { border-color: rgba(255,80,80,.35); color: rgba(255,120,120,.8); }
    .btn.danger:hover { background: rgba(255,80,80,.1); border-color: rgba(255,80,80,.6); }
    .btn.small   { font-size: 9px; padding: 4px 6px; letter-spacing: .5px; }

    .footer { padding: 4px 12px; font-size: 9px; color: rgba(192, 141, 79, .25); letter-spacing: 2px; text-align: center; border-top: 1px solid rgba(192, 141, 79, .07); flex-shrink: 0; }
  `

  // ── Build Shadow DOM ───────────────────────────────────────────────────────
  var host   = document.createElement('div')
  host.id    = 'narsil-intel-host'
  document.body.appendChild(host)
  var shadow = host.attachShadow({ mode: 'closed' })

  var styleEl = document.createElement('style')
  styleEl.textContent = CSS
  shadow.appendChild(styleEl)

  // Tab toggle (always visible)
  var tabEl = document.createElement('div')
  tabEl.id  = 'narsil-tab'
  tabEl.textContent = 'NIT'
  shadow.appendChild(tabEl)

  // Root panel
  var root = document.createElement('div')
  root.id  = 'narsil-root'
  root.classList.add('hidden')
  shadow.appendChild(root)

  root.innerHTML = `
    <div class="hdr">
      <span class="hdr-title">◈ NARSIL INTELLIGENCE COLLECTOR</span>
      <button class="hdr-close" id="btn-close">✕</button>
    </div>
    <div class="net-row">RED: <span id="net-label">—</span></div>
    <div class="stats">
      <div class="stat-pill"><span class="stat-v" id="s-p">0</span><span class="stat-l">Perfiles</span></div>
      <div class="stat-pill"><span class="stat-v" id="s-po">0</span><span class="stat-l">Posts</span></div>
      <div class="stat-pill"><span class="stat-v" id="s-c">0</span><span class="stat-l">Contactos</span></div>
    </div>
    <div class="section-hdr">// Acciones</div>
    <div id="actions-wrap"></div>
    <div class="section-hdr log-hdr">
      <span>// Registro</span>
      <button class="log-clear" id="btn-clear-log" title="Limpiar registro">⊘ LIMPIAR</button>
    </div>
    <div class="panel-log" id="panel-log"></div>
    <div class="footer">Ctrl+Shift+Space — NARSIL v2026</div>
  `

  // ── Panel state ───────────────────────────────────────────────────────────
  var panelVisible = false
  var _refreshActionsTimer = null

  function showPanel()  { root.classList.remove('hidden'); tabEl.style.display = 'none';  panelVisible = true }
  function hidePanel()  { root.classList.add('hidden');    tabEl.style.display = '';       panelVisible = false }
  function togglePanel() { panelVisible ? hidePanel() : showPanel() }

  // ── NarsilPanel global API (used by modules) ──────────────────────────────
  window.NarsilPanel = {
    log: function (msg, type) {
      var logEl = shadow.getElementById('panel-log')
      if (!logEl) return
      var line = document.createElement('div')
      line.className = 'log-line' + (type ? ' ' + type : '')
      line.textContent = msg
      logEl.appendChild(line)
      while (logEl.children.length > 80) logEl.removeChild(logEl.firstChild)
      logEl.scrollTop = logEl.scrollHeight
    },
    refresh: function () {
      var mod = NarsilModules[network]
      if (!mod) return
      var st = mod.stats()
      var el
      el = shadow.getElementById('s-p');  if (el) el.textContent = st.profiles
      el = shadow.getElementById('s-po'); if (el) el.textContent = st.posts
      el = shadow.getElementById('s-c');  if (el) el.textContent = st.contacts
      var total = st.profiles + st.posts + st.contacts
      browser.runtime.sendMessage({ type: 'PANEL_BADGE', count: total }).catch(function () {})
    },
    refreshActions: function () {
      clearTimeout(_refreshActionsTimer)
      _refreshActionsTimer = setTimeout(_renderActions, 100)
    },
  }

  // ── Render action buttons ─────────────────────────────────────────────────
  function _renderActions() {
    var wrap = shadow.getElementById('actions-wrap')
    if (!wrap) return
    wrap.innerHTML = ''
    var mod = NarsilModules[network]
    if (!mod || typeof mod.getActions !== 'function') return
    var actions = mod.getActions()
    actions.forEach(function (action) {
      var btn = document.createElement('button')
      btn.className   = 'btn primary'
      btn.textContent = action.label + (action.note || '')
      btn.addEventListener('click', function () {
        try { mod.runAction(action.id) } catch (e) {
          NarsilPanel.log('Error: ' + e.message, 'err')
        }
      })
      wrap.appendChild(btn)
    })
    if (!actions.length) {
      var p = document.createElement('div')
      p.style.cssText = 'padding:4px 0; color:rgba(224,244,242,.35); font-size:10px;'
      p.textContent = 'Navega a un perfil, post o grupo.'
      wrap.appendChild(p)
    }
  }

  // ── SPA navigation detection: refresh actions on URL change ──────────────
  var _prevHref = location.href
  setInterval(function () {
    if (location.href !== _prevHref) {
      _prevHref = location.href
      clearTimeout(_refreshActionsTimer)
      _refreshActionsTimer = setTimeout(_renderActions, 800)
    }
  }, 500)

  // ── Init labels + actions ─────────────────────────────────────────────────
  var netLabel = shadow.getElementById('net-label')
  if (netLabel) netLabel.textContent = NarsilDetector.label(network)
  _renderActions()

  // ── Clear log ─────────────────────────────────────────────────────────────
  shadow.getElementById('btn-clear-log').addEventListener('click', function () {
    var logEl = shadow.getElementById('panel-log')
    if (logEl) logEl.innerHTML = ''
  })

  // ── Toggle buttons ────────────────────────────────────────────────────────
  shadow.getElementById('btn-close').addEventListener('click', hidePanel)
  tabEl.addEventListener('click', togglePanel)

  // ── Keyboard shortcut ─────────────────────────────────────────────────────
  document.addEventListener('keydown', function (e) {
    if (e.ctrlKey && e.shiftKey && e.code === 'Space') { e.preventDefault(); togglePanel() }
  })

  // ── Background toggle command ─────────────────────────────────────────────
  browser.runtime.onMessage.addListener(function (msg) {
    if (msg && msg.type === 'TOGGLE_PANEL') togglePanel()
  })

  // ── Route messages from injector.js ──────────────────────────────────────
  window.addEventListener('message', function (event) {
    if (!event.data || !event.data.__narsil) return
    var msg = event.data
    var mod = NarsilModules[network]
    if (!mod) return

    if ((msg.type === 'XHR_RESPONSE' || msg.type === 'FETCH_RESPONSE' || msg.type === 'WS_MESSAGE') && msg.data) {
      try { mod.onNetworkRequest(msg.data.url, msg.data.body) } catch (_) {}
    }

    if (msg.type === 'PAGE_DATA' && msg.data && typeof mod.onPageData === 'function') {
      try { mod.onPageData(msg.data.key, msg.data.data) } catch (_) {}
      clearTimeout(_refreshActionsTimer)
      _refreshActionsTimer = setTimeout(_renderActions, 200)
    }

    // TikTok secUid returned by injector on demand
    if (msg.type === 'TIKTOK_SECUID' && msg.data && msg.data.secUid) {
      var tt = NarsilModules['tiktok']
      if (tt && typeof tt.setSecUid === 'function') tt.setSecUid(msg.data.secUid)
    }
  })

  // Ask the injector to re-send page data once content.js is ready
  setTimeout(function () {
    window.postMessage({ __narsil_cmd: 'EXTRACT_PAGE_DATA' }, '*')
  }, 600)

  // ── Init log ──────────────────────────────────────────────────────────────
  NarsilPanel.log('NARSIL Intelligence Collector activo — ' + NarsilDetector.label(network))
})()
