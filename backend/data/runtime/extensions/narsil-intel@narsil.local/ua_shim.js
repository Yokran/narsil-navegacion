// NARSIL Intel Collector - ua_shim.js
// Runs in the page MAIN world. Complements header spoofing by overriding the
// visible navigator User-Agent after a reload.
;(function () {
  'use strict'
  var ua = document.documentElement.getAttribute('data-narsil-ua-override') || ''
  ua = String(ua).replace(/[\r\n]/g, ' ').trim()
  if (!ua) return

  function defineGetter(target, property, value) {
    try {
      Object.defineProperty(target, property, {
        get: function () { return value },
        configurable: true,
      })
    } catch (_) {}
  }

  defineGetter(Navigator.prototype, 'userAgent', ua)
  defineGetter(window.navigator, 'userAgent', ua)
  defineGetter(Navigator.prototype, 'appVersion', ua.replace(/^Mozilla\//, ''))
  defineGetter(window.navigator, 'appVersion', ua.replace(/^Mozilla\//, ''))
})()
