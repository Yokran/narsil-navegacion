// NARSIL Intel Collector — utils/scroll.js
// Auto-scroll utility for paginated content extraction.
'use strict'

var NarsilScroll = {
  // Scroll window or element repeatedly until content stops growing.
  // opts: { target, step, delay, maxIter, stopWhen, onStep }
  auto: async function (opts) {
    opts       = opts || {}
    var target  = opts.target   || window
    var step    = opts.step     || 800
    var delay   = opts.delay    || 1400
    var maxIter = opts.maxIter  || 60
    var stopWhen = opts.stopWhen || null
    var onStep   = opts.onStep   || null

    var prev  = -1
    var iters = 0

    while (iters < maxIter) {
      if (stopWhen && stopWhen()) break

      var curr = target === window
        ? document.documentElement.scrollHeight
        : target.scrollHeight

      if (curr === prev) break
      prev = curr

      if (target === window) {
        window.scrollBy(0, step)
      } else {
        target.scrollTop += step
      }

      if (onStep) await onStep(iters)
      await NarsilScroll._sleep(delay)
      iters++
    }
    return iters
  },

  toEl: function (el) {
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' })
  },

  _sleep: function (ms) {
    return new Promise(function (resolve) { setTimeout(resolve, ms) })
  },
}
