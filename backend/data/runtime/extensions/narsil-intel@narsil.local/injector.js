// NARSIL Intel Collector — injector.js
// Runs in MAIN world. Hooks XHR/fetch and extracts page-level data stores.
;(function () {
  'use strict'

  if (window.__narsil_injected) return
  window.__narsil_injected = true

  var _recentNetwork = []

  function _isReplayHost() {
    return /(^|\.)x\.com$/i.test(location.hostname) ||
      /(^|\.)twitter\.com$/i.test(location.hostname) ||
      /(^|\.)instagram\.com$/i.test(location.hostname) ||
      /(^|\.)discord\.com$/i.test(location.hostname) ||
      /(^|\.)linkedin\.com$/i.test(location.hostname) ||
      /(^|\.)youtube\.com$/i.test(location.hostname)
  }

  function _rememberNetwork(type, data) {
    if (!_isReplayHost()) return
    if (type !== 'XHR_RESPONSE' && type !== 'FETCH_RESPONSE' && type !== 'WS_MESSAGE') return
    if (!data || !data.body || typeof data.body !== 'object') return
    _recentNetwork.push({ type: type, data: data })
    while (_recentNetwork.length > 80) _recentNetwork.shift()
  }

  var _emit = function (type, data) {
    window.postMessage({ __narsil: true, type: type, data: data }, '*')
  }

  var _post = function (type, data) {
    _rememberNetwork(type, data)
    _emit(type, data)
  }

  // ── XHR hook ──────────────────────────────────────────────────────────────
  var _open      = XMLHttpRequest.prototype.open
  var _send      = XMLHttpRequest.prototype.send
  var _setHeader = XMLHttpRequest.prototype.setRequestHeader
  var _xhrMeta   = new WeakMap()

  XMLHttpRequest.prototype.open = function (method, url) {
    _xhrMeta.set(this, { url: url, method: method, headers: {} })
    return _open.apply(this, arguments)
  }

  XMLHttpRequest.prototype.setRequestHeader = function (name, value) {
    var m = _xhrMeta.get(this)
    if (m) m.headers[name.toLowerCase()] = value
    return _setHeader.apply(this, arguments)
  }

  XMLHttpRequest.prototype.send = function () {
    var xhr = this
    xhr.addEventListener('load', function () {
      try {
        var ct = xhr.getResponseHeader('content-type') || ''
        if (!ct.includes('json') && !ct.includes('javascript')) return
        var json = JSON.parse(xhr.responseText)
        var m    = _xhrMeta.get(xhr) || {}
        _post('XHR_RESPONSE', { url: m.url || '', method: m.method || 'GET', status: xhr.status, body: json })
      } catch (_) {}
    })
    return _send.apply(this, arguments)
  }

  // ── Fetch hook ────────────────────────────────────────────────────────────
  var _fetch = window.fetch
  window.fetch = function (input, init) {
    var url    = typeof input === 'string' ? input : (input && input.url) || String(input)
    var method = (init && init.method || 'GET').toUpperCase()
    return _fetch.apply(this, arguments).then(function (res) {
      try {
        var ct = res.headers.get('content-type') || ''
        if (ct.includes('json') || ct.includes('javascript')) {
          res.clone().json().then(function (json) {
            _post('FETCH_RESPONSE', { url: url, method: method, status: res.status, body: json })
          }).catch(function () {})
        }
      } catch (_) {}
      return res
    })
  }

  // ── ct0 cookie accessor (Twitter) ─────────────────────────────────────────
  // Passive Discord gateway hook. Member lists are commonly delivered through
  // WebSocket events, so we forward only structural guild/member payloads.
  function _postDiscordGateway(url, event) {
    try {
      if (!/(^|\.)discord\.com$/i.test(location.hostname)) return
      if (!event || typeof event.data !== 'string') return
      if (event.data.length > 1500000) return
      var json = JSON.parse(event.data)
      var eventType = json && json.t
      if (['GUILD_MEMBER_LIST_UPDATE', 'GUILD_CREATE', 'READY', 'READY_SUPPLEMENTAL'].indexOf(eventType) === -1) return
      _post('WS_MESSAGE', { url: String(url || 'discord_gateway'), body: json })
    } catch (_) {}
  }

  try {
    var _WebSocket = window.WebSocket
    if (_WebSocket && !_WebSocket.__narsil_wrapped) {
      var NarsilWebSocket = function (url, protocols) {
        var ws = protocols !== undefined ? new _WebSocket(url, protocols) : new _WebSocket(url)
        try {
          ws.addEventListener('message', function (event) { _postDiscordGateway(url, event) })
        } catch (_) {}
        return ws
      }
      NarsilWebSocket.prototype = _WebSocket.prototype
      ;['CONNECTING', 'OPEN', 'CLOSING', 'CLOSED'].forEach(function (key) {
        try { NarsilWebSocket[key] = _WebSocket[key] } catch (_) {}
      })
      Object.defineProperty(NarsilWebSocket, '__narsil_wrapped', { value: true })
      window.WebSocket = NarsilWebSocket
    }
  } catch (_) {}

  Object.defineProperty(window, '__narsil_ct0', {
    get: function () {
      return document.cookie.split(';').reduce(function (acc, c) {
        var p = c.trim().split('=')
        return p[0] === 'ct0' ? decodeURIComponent(p[1] || '') : acc
      }, '')
    },
    configurable: true,
  })

  // ── Page-level data store extraction (TikTok SIGI_STATE, Next.js, etc.) ──
  var PAGE_STORES = ['SIGI_STATE', '__NEXT_DATA__', '__UNIVERSAL_DATA__', 'ssrRenderData', 'INITIAL_STATE', 'ytInitialData', 'ytInitialPlayerResponse']

  function _extractPageData() {
    // Read window globals (Next.js, Instagram, etc.)
    PAGE_STORES.forEach(function (key) {
      try {
        var data = window[key]
        if (data && typeof data === 'object') {
          _post('PAGE_DATA', { key: key, data: data, href: location.href })
        }
      } catch (_) {}
    })
    // TikTok embeds SIGI_STATE (and sometimes __NEXT_DATA__) as
    // <script id="KEY" type="application/json">…</script>, NOT as window globals.
    PAGE_STORES.forEach(function (key) {
      try {
        var el = document.getElementById(key)
        if (!el || el.tagName !== 'SCRIPT') return
        var txt = el.textContent || el.innerText || ''
        if (!txt.trim()) return
        var parsed = JSON.parse(txt)
        if (parsed && typeof parsed === 'object') {
          _post('PAGE_DATA', { key: key, data: parsed, href: location.href })
        }
      } catch (_) {}
    })
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', _extractPageData)
  } else {
    _extractPageData()
  }
  // Delayed re-fire so content.js (loaded at document_idle) doesn't miss it
  setTimeout(_extractPageData, 2500)

  // SPA navigation detection
  var _lastHref = location.href
  setInterval(function () {
    if (location.href !== _lastHref) {
      _lastHref = location.href
      setTimeout(_extractPageData, 1200)
    }
  }, 600)

  // Respond to on-demand requests from content.js
  window.addEventListener('message', function (e) {
    if (!e.data || e.data.__narsil_cmd !== 'EXTRACT_PAGE_DATA') return
    _extractPageData()
    if (_isReplayHost() && _recentNetwork.length) {
      _recentNetwork.forEach(function (entry) {
        _emit(entry.type, entry.data)
      })
    }
    // TikTok-specific: also fish secUid out of SIGI_STATE directly
    try {
      var state = window.SIGI_STATE || (window.__UNIVERSAL_DATA__ && window.__UNIVERSAL_DATA__)
      if (state) {
        var users = state.UserModule && state.UserModule.users
        if (users) {
          var ids = Object.keys(users)
          if (ids.length) {
            var u = users[ids[0]]
            if (u && u.secUid) {
              _post('TIKTOK_SECUID', { secUid: u.secUid, uniqueId: u.uniqueId })
            }
          }
        }
      }
    } catch (_) {}
  })

  _post('INJECTOR_READY', { href: location.href })
})()
