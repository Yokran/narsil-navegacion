// NARSIL Intel Collector - ua_inject_start.js
// Lightweight all-sites content script for navigator.userAgent override.
;(function () {
  'use strict'

  function injectUaShim(ua) {
    if (!ua) return
    document.documentElement.setAttribute('data-narsil-ua-override', ua)
    const s = document.createElement('script')
    s.src = browser.runtime.getURL('ua_shim.js')
    s.onload = () => s.remove()
    s.onerror = () => s.remove()
    const root = document.head || document.documentElement
    if (root) root.appendChild(s)
  }

  browser.storage.local.get('narsil_user_agent_state').then(data => {
    const state = data && data.narsil_user_agent_state
    const ua = state && state.enabled && state.value && String(state.value).replace(/[\r\n]/g, ' ').trim()
    injectUaShim(ua)
  }).catch(() => {})
})()
