// NARSIL Intel Collector — utils/react.js
// React fiber introspection for reading component state from DOM nodes.
'use strict'

var NarsilReact = {
  // Return the React fiber attached to a DOM element, if any.
  fiber: function (el) {
    if (!el) return null
    var key = Object.keys(el).find(function (k) {
      return k.startsWith('__reactFiber') || k.startsWith('__reactInternalInstance')
    })
    return key ? el[key] : null
  },

  // Walk fiber ancestors looking for a component that has a specific prop.
  findProp: function (el, propName, maxDepth) {
    maxDepth = maxDepth || 30
    var fiber = NarsilReact.fiber(el)
    var depth = 0
    while (fiber && depth < maxDepth) {
      var props = fiber.memoizedProps || fiber.pendingProps
      if (props && propName in props) return props[propName]
      fiber = fiber.return
      depth++
    }
    return null
  },

  // Get the memoized props of the nearest fiber.
  props: function (el) {
    var fiber = NarsilReact.fiber(el)
    return fiber ? (fiber.memoizedProps || fiber.pendingProps || {}) : {}
  },

  // Walk fiber ancestors looking for memoized state with a specific key.
  findState: function (el, stateKey, maxDepth) {
    maxDepth = maxDepth || 30
    var fiber = NarsilReact.fiber(el)
    var depth = 0
    while (fiber && depth < maxDepth) {
      var hook = fiber.memoizedState
      while (hook) {
        var s = hook.memoizedState
        if (s && typeof s === 'object' && stateKey in s) return s[stateKey]
        hook = hook.next
      }
      fiber = fiber.return
      depth++
    }
    return null
  },
}
