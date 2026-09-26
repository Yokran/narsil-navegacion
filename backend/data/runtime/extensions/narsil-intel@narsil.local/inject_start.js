// NARSIL Intel Collector — inject_start.js
// Content script, document_start — injects the XHR/fetch hook into MAIN world.
;(function () {
  'use strict'

  function injectFile(path) {
    const s    = document.createElement('script')
    s.src      = browser.runtime.getURL(path)
    s.onload   = () => s.remove()
    s.onerror  = () => s.remove()
    const root = document.head || document.documentElement
    if (root) root.appendChild(s)
  }

  injectFile('injector.js')
})()
