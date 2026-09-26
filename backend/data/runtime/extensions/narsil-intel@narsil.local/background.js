// NARSIL Intel Collector — background.js
'use strict'

// ── Mobile UA spoof for TikTok region extraction ────────────────────────────
// Content scripts add X-Narsil-Mobile: 1 to identify region-fetch requests.
// This listener intercepts those requests, removes the marker, and substitutes
// the mobile User-Agent that TikTok requires to return the true account region.
// Mirrors the GM_xmlhttpRequest + MOBILE_USER_AGENT approach of TikTracker.
const MOBILE_UA = 'Mozilla/5.0 (iPad; CPU OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 musical_ly_40.6.0 BytedanceWebview/d8a21c6'
const FIREFOX_DESKTOP_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:126.0) Gecko/20100101 Firefox/126.0'
const UA_STORAGE_KEY = 'narsil_user_agent_state'
const DEFAULT_UA_STATE = { enabled: false, value: FIREFOX_DESKTOP_UA, label: 'Por defecto' }
const TAB_RECORDER_DEFAULTS = { fps: 3 }
const EVIDENCE_API_BASE = 'http://127.0.0.1:8420/api/evidence/recordings'

let activeUserAgent = Object.assign({}, DEFAULT_UA_STATE)
let tabRecorder = createEmptyTabRecorder()
let lastTabRecorderSummary = null
let mainMenuOpen = false

browser.storage.local.get(UA_STORAGE_KEY).then(data => {
  const stored = data && data[UA_STORAGE_KEY]
  if (stored && typeof stored === 'object') {
    activeUserAgent = normalizeUserAgentState(stored)
  }
}).catch(() => {})

browser.webRequest.onBeforeSendHeaders.addListener(
  function (details) {
    const requestHeaders = details.requestHeaders || []
    const hasMarker = requestHeaders.some(h => h.name === 'X-Narsil-Mobile')
    if (!hasMarker && (!activeUserAgent.enabled || !activeUserAgent.value)) return {}

    const headers = requestHeaders
      .filter(h => h.name !== 'X-Narsil-Mobile' && h.name.toLowerCase() !== 'user-agent')
    headers.push({ name: 'User-Agent', value: hasMarker ? MOBILE_UA : activeUserAgent.value })
    return { requestHeaders: headers }
  },
  { urls: ['<all_urls>'] },
  ['blocking', 'requestHeaders']
)

function normalizeUserAgentState(state) {
  const rawValue = String(state.value || '').replace(/[\r\n]/g, ' ').trim().slice(0, 512)
  const value = rawValue || FIREFOX_DESKTOP_UA
  const defaultProfile = !state.enabled && value === FIREFOX_DESKTOP_UA
  return {
    enabled: !!state.enabled && !!value,
    value: value,
    label: defaultProfile
      ? DEFAULT_UA_STATE.label
      : String(state.label || '').trim().slice(0, 120) || (value ? 'Personalizado' : DEFAULT_UA_STATE.label),
  }
}

async function notifyNarsilUserAgent(state) {
  const profileName = await inferNarsilProfileNameFromTabs()
  const payload = {
    profile_name: profileName || '',
    enabled: !!state.enabled,
    label: state.label || DEFAULT_UA_STATE.label,
    user_agent: state.value || FIREFOX_DESKTOP_UA,
  }
  return fetch('http://127.0.0.1:8420/api/profiles/browser/user-agent', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }).catch(() => null)
}

async function inferNarsilProfileNameFromTabs() {
  try {
    const tabs = await browser.tabs.query({})
    for (const tab of tabs || []) {
      const match = String(tab.url || '').match(/^https?:\/\/127\.0\.0\.1:8420\/profile-start\/([^/?#]+)/)
      if (match && match[1]) return decodeURIComponent(match[1])
    }
  } catch (_) {}
  return ''
}

function createEmptyTabRecorder() {
  return {
    recording: false,
    stopping: false,
    sessionId: null,
    startedAt: null,
    frames: 0,
    uploadedFrames: 0,
    captureInProgress: false,
    frameFormat: 'jpeg',
    converterMode: '',
    outputExt: '',
    video: null,
    timeline: [],
    errors: [],
    frameTimer: null,
    lastTabKey: '',
    options: Object.assign({}, TAB_RECORDER_DEFAULTS),
    stopPromise: null,
  }
}

function normalizeTabRecorderOptions(options) {
  options = options || {}
  return {
    fps: clampInt(options.fps, TAB_RECORDER_DEFAULTS.fps, 1, 5),
  }
}

function clampInt(value, fallback, min, max) {
  const parsed = parseInt(value, 10)
  if (!Number.isFinite(parsed)) return fallback
  return Math.max(min, Math.min(max, parsed))
}

function getTabRecorderState() {
  return {
    recording: !!tabRecorder.recording,
    stopping: !!tabRecorder.stopping,
    startedAt: tabRecorder.startedAt ? new Date(tabRecorder.startedAt).toISOString() : null,
    clips: tabRecorder.video ? 1 : 0,
    frames: tabRecorder.frames,
    uploadedFrames: tabRecorder.uploadedFrames,
    fps: tabRecorder.options.fps,
    frameFormat: tabRecorder.frameFormat,
    converterMode: tabRecorder.converterMode,
    outputExt: tabRecorder.outputExt,
    filename: tabRecorder.video && tabRecorder.video.filename || null,
    lastError: tabRecorder.errors.length ? tabRecorder.errors[tabRecorder.errors.length - 1].message : null,
    lastSummary: lastTabRecorderSummary,
  }
}

function recordTabRecorderError(message, err) {
  const detail = err && err.message ? err.message : String(err || '')
  const entry = {
    at: new Date().toISOString(),
    message: detail ? message + ': ' + detail : message,
  }
  tabRecorder.errors.push(entry)
  if (tabRecorder.errors.length > 200) tabRecorder.errors.shift()
  console.warn('NARSIL tab recorder:', entry.message)
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function setRecordingActionIndicator(active) {
  if (active) {
    browser.browserAction.setBadgeText({ text: '●' }).catch(() => {})
    browser.browserAction.setBadgeBackgroundColor({ color: '#ff3348' }).catch(() => {})
    browser.browserAction.setTitle({ title: 'NARSIL Intelligence Collector - grabando' }).catch(() => {})
    return
  }
  browser.browserAction.setBadgeText({ text: '' }).catch(() => {})
  browser.browserAction.setBadgeBackgroundColor({ color: '#9F6A57' }).catch(() => {})
  browser.browserAction.setTitle({ title: 'NARSIL Intelligence Collector' }).catch(() => {})
}

async function startTabRecording(options) {
  if (tabRecorder.recording || tabRecorder.stopping) return getTabRecorderState()

  tabRecorder = createEmptyTabRecorder()
  tabRecorder.options = normalizeTabRecorderOptions(options)
  tabRecorder.startedAt = Date.now()

  const tab = await getFocusedActiveTabForCapture()
  const session = await startEvidenceSession(tab)
  tabRecorder.sessionId = session.session_id
  tabRecorder.frameFormat = session.frame_format || 'jpeg'
  tabRecorder.converterMode = session.converter_mode || ''
  tabRecorder.outputExt = session.output_ext || ''
  tabRecorder.recording = true
  setRecordingActionIndicator(true)

  try {
    await captureActiveTabFrame(true, tabRecorder.sessionId)
  } catch (err) {
    setRecordingActionIndicator(false)
    tabRecorder = createEmptyTabRecorder()
    throw err
  }

  const frameMs = Math.max(250, Math.floor(1000 / tabRecorder.options.fps))
  tabRecorder.frameTimer = setInterval(() => {
    if (tabRecorder.captureInProgress) return
    const sessionId = tabRecorder.sessionId
    tabRecorder.captureInProgress = true
    captureActiveTabFrame(false, sessionId)
      .catch(err => {
        if (tabRecorder.sessionId === sessionId) recordTabRecorderError('No se pudo capturar la pestana activa', err)
      })
      .finally(() => {
        if (tabRecorder.sessionId === sessionId) tabRecorder.captureInProgress = false
      })
  }, frameMs)

  return getTabRecorderState()
}

async function stopTabRecording() {
  if (!tabRecorder.recording && !tabRecorder.stopping) return Promise.resolve(getTabRecorderState())
  if (tabRecorder.stopPromise) return tabRecorder.stopPromise

  tabRecorder.stopPromise = (async () => {
    tabRecorder.stopping = true
    tabRecorder.recording = false
    clearTabRecorderTimers()

    try {
      await waitForCaptureIdle()
      const result = await finishEvidenceSession()
      if (result && result.download_url) {
        await browser.downloads.download({
          url: result.download_url,
          filename: result.filename || undefined,
          saveAs: false,
        })
      }
      return finalizeTabRecording(result)
    } catch (err) {
      recordTabRecorderError('No se pudo finalizar la grabacion', err)
      return finalizeTabRecording(null)
    }
  })()
  return tabRecorder.stopPromise
}

function clearTabRecorderTimers() {
  if (tabRecorder.frameTimer) clearInterval(tabRecorder.frameTimer)
  tabRecorder.frameTimer = null
}

async function getFocusedActiveTabForCapture() {
  let win = null
  try {
    win = await browser.windows.getLastFocused({ populate: false })
  } catch (_) {}

  if (win && win.id !== undefined) {
    const tabs = await browser.tabs.query({ active: true, windowId: win.id })
    if (tabs && tabs[0]) return tabs[0]
  }

  const fallback = await browser.tabs.query({ active: true, currentWindow: true })
  return fallback && fallback[0] ? fallback[0] : null
}

async function captureActiveTabFrame(required, sessionId) {
  if (sessionId && tabRecorder.sessionId !== sessionId) return
  const tab = await getFocusedActiveTabForCapture()
  if (sessionId && tabRecorder.sessionId !== sessionId) return
  if (!tab || tab.windowId === undefined) throw new Error('No hay pestana activa capturable')

  const frameFormat = tabRecorder.frameFormat === 'png' ? 'png' : 'jpeg'
  const captureOptions = { format: frameFormat }
  if (frameFormat === 'jpeg') captureOptions.quality = 100
  const dataUrl = await captureTabImage(tab, captureOptions)
  const blob = await dataUrlToBlob(dataUrl)
  if (sessionId && tabRecorder.sessionId !== sessionId) return

  const index = tabRecorder.frames + 1
  await uploadEvidenceFrame(blob, index, tab)
  tabRecorder.frames += 1
  tabRecorder.uploadedFrames += 1
  noteCapturedTab(tab)

  if (required && tabRecorder.frames < 1) throw new Error('No se pudo capturar el primer frame')
}

async function captureTabImage(tab, captureOptions) {
  if (browser.tabs.captureTab && tab.id !== undefined) {
    try {
      return await browser.tabs.captureTab(tab.id, captureOptions)
    } catch (_) {}
  }
  return browser.tabs.captureVisibleTab(tab.windowId, captureOptions)
}

async function dataUrlToBlob(dataUrl) {
  const response = await fetch(dataUrl)
  return response.blob()
}

function noteCapturedTab(tab) {
  const url = String(tab.url || '').slice(0, 2000)
  const key = [tab.windowId, tab.id, url].join('|')
  if (key === tabRecorder.lastTabKey) return
  tabRecorder.lastTabKey = key
  tabRecorder.timeline.push({
    at: new Date().toISOString(),
    window_id: tab.windowId,
    tab_id: tab.id,
    title: String(tab.title || '').slice(0, 500),
    url: url,
  })
  if (tabRecorder.timeline.length > 500) tabRecorder.timeline.shift()
}

async function startEvidenceSession(tab) {
  return postEvidenceJson(EVIDENCE_API_BASE + '/start', {
    fps: tabRecorder.options.fps,
    source_url: tab && tab.url || '',
    title: tab && tab.title || '',
  })
}

async function uploadEvidenceFrame(blob, index, tab) {
  const params = new URLSearchParams({
    index: String(index),
    captured_at: new Date().toISOString(),
    url: tab && tab.url || '',
    title: tab && tab.title || '',
  })
  const expectedType = tabRecorder.frameFormat === 'png' ? 'image/png' : 'image/jpeg'
  const response = await fetch(EVIDENCE_API_BASE + '/' + encodeURIComponent(tabRecorder.sessionId) + '/frame?' + params.toString(), {
    method: 'POST',
    headers: { 'Content-Type': blob.type || expectedType },
    body: blob,
  })
  const data = await readEvidenceJson(response)
  if (!response.ok || !data.ok) {
    throw new Error(data.detail || data.error || response.statusText || 'Error subiendo frame')
  }
}

async function finishEvidenceSession() {
  if (!tabRecorder.sessionId || !tabRecorder.frames) throw new Error('No hay frames capturados')
  return postEvidenceJson(EVIDENCE_API_BASE + '/' + encodeURIComponent(tabRecorder.sessionId) + '/finish', {
    fps: tabRecorder.options.fps,
  })
}

async function postEvidenceJson(url, payload) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload || {}),
  })
  const data = await readEvidenceJson(response)
  if (!response.ok || data.ok === false) {
    throw new Error(data.detail || data.error || response.statusText || 'Error de evidencia')
  }
  return data
}

async function readEvidenceJson(response) {
  try {
    return await response.json()
  } catch (_) {
    return {}
  }
}

async function waitForCaptureIdle() {
  for (let i = 0; i < 80 && tabRecorder.captureInProgress; i++) {
    await delay(100)
  }
}

function finalizeTabRecording(result) {
  clearTabRecorderTimers()
  setRecordingActionIndicator(false)
  const stoppedAt = Date.now()
  const finalState = {
    recording: false,
    stopping: false,
    startedAt: tabRecorder.startedAt ? new Date(tabRecorder.startedAt).toISOString() : null,
    stoppedAt: new Date(stoppedAt).toISOString(),
    clips: result ? 1 : 0,
    frames: tabRecorder.frames,
    uploadedFrames: tabRecorder.uploadedFrames,
    filename: result && result.filename || null,
    outputFormat: result && result.format || null,
    converterMode: result && result.converter_mode || tabRecorder.converterMode || null,
    lastError: result ? null : (tabRecorder.errors.length ? tabRecorder.errors[tabRecorder.errors.length - 1].message : null),
  }
  if (result) {
    tabRecorder.video = {
      filename: result.filename,
      format: result.format,
      sizeBytes: result.size_bytes,
    }
  }
  lastTabRecorderSummary = finalState
  tabRecorder = createEmptyTabRecorder()
  return finalState
}

// ── Download handler ────────────────────────────────────────────────────────
browser.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'MAIN_MENU_OPEN') {
    mainMenuOpen = true
    sendResponse({ ok: true })
    return false
  }

  if (msg.type === 'MAIN_MENU_CLOSED') {
    mainMenuOpen = false
    sendResponse({ ok: true })
    return false
  }

  if (msg.type === 'GET_UA_STATE') {
    sendResponse({ ok: true, state: activeUserAgent })
    return false
  }

  if (msg.type === 'SET_UA_STATE') {
    activeUserAgent = normalizeUserAgentState(msg.state || {})
    browser.storage.local.set({ [UA_STORAGE_KEY]: activeUserAgent }).then(() => {
      notifyNarsilUserAgent(activeUserAgent).catch(() => {})
      sendResponse({ ok: true, state: activeUserAgent })
    }).catch(err => {
      sendResponse({ ok: false, error: err.message })
    })
    return true
  }

  if (msg.type === 'GET_TAB_RECORDER_STATE') {
    sendResponse({ ok: true, state: getTabRecorderState() })
    return false
  }

  if (msg.type === 'START_TAB_RECORDING') {
    startTabRecording(msg.options || {}).then(state => {
      sendResponse({ ok: true, state: state })
    }).catch(err => {
      sendResponse({ ok: false, error: err.message })
    })
    return true
  }

  if (msg.type === 'STOP_TAB_RECORDING') {
    stopTabRecording().then(state => {
      sendResponse({ ok: true, state: state })
    }).catch(err => {
      sendResponse({ ok: false, error: err.message })
    })
    return true
  }

  if (msg.type === 'DOWNLOAD' || msg.type === 'DOWNLOAD_BINARY') {
    const { filename, mimeType } = msg
    const isBase64 = msg.type === 'DOWNLOAD_BINARY' || msg.base64 === true
    const content = msg.content !== undefined ? msg.content : msg.base64
    let blob
    if (isBase64) {
      const binStr = atob(content || '')
      const bytes  = new Uint8Array(binStr.length)
      for (let i = 0; i < bytes.length; i++) bytes[i] = binStr.charCodeAt(i)
      blob = new Blob([bytes], { type: mimeType })
    } else {
      blob = new Blob([content], { type: mimeType })
    }
    const url = URL.createObjectURL(blob)

    browser.downloads.download({ url, filename, saveAs: false })
      .then(downloadId => {
        sendResponse({ ok: true, downloadId })
        setTimeout(() => URL.revokeObjectURL(url), 8000)
      })
      .catch(err => {
        sendResponse({ ok: false, error: err.message })
        URL.revokeObjectURL(url)
      })
    return true // keep message channel open for async response
  }

  if (msg.type === 'PANEL_BADGE') {
    if (tabRecorder.recording || tabRecorder.stopping) {
      setRecordingActionIndicator(true)
      return false
    }
    const { count } = msg
    browser.browserAction.setBadgeText({ text: count > 0 ? String(count) : '', tabId: sender.tab?.id })
    browser.browserAction.setBadgeBackgroundColor({ color: '#9F6A57' })
  }

  // ── Facebook: extracción en pestaña de fondo (live DOM hidratado) ──────────
  // El módulo facebook.js delega aquí para extraer datos de cada amigo.
  // Razón: www.facebook.com es SPA; los campos del Intro card (Vive en, De,
  // Trabaja en) no están en el HTML SSR, solo aparecen tras la hidratación de
  // React. No hay forma de obtenerlos vía fetch programático. La única vía
  // fiable es abrir el perfil en una pestaña real, esperar la hidratación,
  // y leer del DOM vivo (lo mismo que hace el usuario manualmente).
  if (msg.type === 'FB_EXTRACT_PROFILE_IN_TAB') {
    fbExtractInTab(msg.url).then(data => {
      sendResponse({ ok: true, data: data })
    }).catch(err => {
      sendResponse({ ok: false, error: err && err.message })
    })
    return true // async
  }
})

// Abre un perfil de Facebook en pestaña no activa, espera carga + hidratación,
// ejecuta extracción del DOM vía tabs.executeScript, y cierra la pestaña.
function fbExtractInTab(url) {
  return new Promise(resolve => {
    const TIMEOUT_MS       = 35000  // máximo total por amigo
    const PRE_SCROLL_MS    = 4000   // espera inicial tras 'complete' antes del scroll
    const POST_SCROLL_MS   = 4000   // espera tras scroll para que se hidraten secciones below-fold
                                    // (la "Información de contacto" suele estar al final
                                    // del perfil y solo se hidrata cuando entra en viewport)

    let tabId    = null
    let finished = false

    const finish = (data) => {
      if (finished) return
      finished = true
      clearTimeout(timer)
      browser.tabs.onUpdated.removeListener(onUpdate)
      if (tabId !== null) browser.tabs.remove(tabId).catch(() => {})
      resolve(data || {})
    }

    const timer = setTimeout(() => finish({}), TIMEOUT_MS)

    const onUpdate = (updatedTabId, changeInfo) => {
      if (updatedTabId !== tabId) return
      if (changeInfo.status !== 'complete') return
      browser.tabs.onUpdated.removeListener(onUpdate)

      // Fase 1: esperar hidratación inicial de React
      setTimeout(() => {
        if (finished) return

        // Fase 2: scroll a fondo para forzar hidratación de secciones below-fold
        // (la sección "Información de contacto" está al final del perfil y solo
        // hidrata sus enlaces cuando entra en viewport en navegadores reales).
        browser.tabs.executeScript(tabId, {
          code: 'window.scrollTo(0, document.body.scrollHeight); 1'
        }).catch(() => {})

        // Fase 3: esperar a que la hidratación post-scroll termine
        setTimeout(() => {
          if (finished) return

        // Código de extracción que se inyecta en el DOM vivo de la pestaña.
        // ESTRATEGIA: priorizar JSON embebido en innerHTML (siempre disponible,
        // no depende de layout). Usar innerText/textContent solo como fallback.
        // Razón: Firefox throttlea layout en pestañas de fondo, por lo que
        // document.body.innerText devuelve texto incompleto. Pero el HTML fuente
        // (innerHTML) sí contiene los datos crudos en el JSON SSR de Facebook.
        const code = `(function(){
          var bodyText = (document.body && document.body.innerText)   || '';
          var bodyTC   = (document.body && document.body.textContent) || '';
          var html     = document.documentElement.innerHTML;

          function ok(t){
            if(!t) return false;
            t = t.trim();
            if(!t) return false;
            if(/[€$£¥₹₩]/.test(t)) return false;
            if(/^\\d/.test(t)) return false;
            if(/\\b(credit|ads?|USD|EUR|GBP|JPY|promo|discount|bonus|coupon)\\b/i.test(t)) return false;
            return /^[\\p{L}]/u.test(t);
          }
          // Decodifica escapes JSON \\uXXXX → carácter Unicode real
          function decode(s){
            return s.replace(/\\\\u([0-9a-fA-F]{4})/g, function(_,h){
              return String.fromCharCode(parseInt(h,16));
            });
          }
          // Prueba patrones contra HTML primero (JSON SSR), luego texto rendered
          function tryAll(htmlPats, textPats) {
            var i, m, v;
            for (i = 0; i < htmlPats.length; i++) {
              m = html.match(htmlPats[i]);
              if (m && m[1]) { v = decode(m[1]).trim(); if (ok(v)) return v; }
            }
            for (i = 0; i < textPats.length; i++) {
              m = bodyText.match(textPats[i]);
              if (m && m[1]) { v = m[1].trim(); if (ok(v)) return v; }
            }
            for (i = 0; i < textPats.length; i++) {
              m = bodyTC.match(textPats[i]);
              if (m && m[1]) { v = m[1].trim(); if (ok(v)) return v; }
            }
            return '';
          }

          // ── Identidad ──────────────────────────────────────────────────────
          var i = html.match(/"(?:userID|pageID)":"(\\d+)"/);

          function cleanValue(s){
            if(!s) return '';
            s = decode(String(s)).replace(/\\\\n/g, ' ').replace(/\\\\r/g, ' ')
              .replace(/\\\\"/g, '"').replace(/\\\\\\//g, '/')
              .replace(/&amp;/g, '&').replace(/&quot;/g, '"')
              .replace(/&#039;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>')
              .replace(/\\s+/g, ' ').trim();
            return s;
          }
          function okBio(t){
            t = cleanValue(t);
            if(!t || t.length < 2 || t.length > 500) return '';
            if(/^(amigos|friends|fotos|photos|videos|publicaciones|posts|informaci[oó]n|about|intro|detalles|ver m[aá]s|see more)$/i.test(t)) return '';
            if(/^(vive en|lives in|de |from |trabaja en|works at|estudi[oó] en|studied at)/i.test(t)) return '';
            if(/\\b(amigos? en com[uú]n|mutual friends?|mensaje|message|seguir|follow)\\b/i.test(t)) return '';
            return t;
          }

          var bio = '';
          var bioPats = [
            /"bio_text"\\s*:\\s*\\{[\\s\\S]{0,2000}?"text"\\s*:\\s*"((?:\\\\.|[^"\\\\]){1,1000})"/,
            /"intro_card"[^{}]{0,5000}"text"\\s*:\\s*"((?:\\\\.|[^"\\\\]){1,1000})"/
          ];
          for (var bp = 0; bp < bioPats.length && !bio; bp++) {
            var bioJson = html.match(bioPats[bp]);
            if (bioJson) bio = okBio(bioJson[1]);
          }
          if (!bio) {
            var nodes = document.querySelectorAll('div[role="main"] [dir="auto"]');
            for (var bn = 0; bn < nodes.length && !bio && bn < 120; bn++) {
              if (nodes[bn].closest && nodes[bn].closest('a[href], [role="button"]')) continue;
              bio = okBio(nodes[bn].innerText || nodes[bn].textContent || '');
            }
          }

          // ── Lugar de residencia (current_city) ─────────────────────────────
          var ciudad = tryAll(
            [/"current_city":\\s*\\{[^{}]*?"name":"([^"\\\\]+)"/],
            [/(?:Vive en|Lives in)\\s+([\\p{L}][\\p{L} ,.\\-]{2,100})/u]
          );

          // ── Lugar de origen (hometown) ─────────────────────────────────────
          var origen = tryAll(
            [/"hometown":\\s*\\{[^{}]*?"name":"([^"\\\\]+)"/,
             /"text":"(?:De|From) ([^"\\n]{2,100}?)"/],
            [/(?:^|[\\s\\n])(?:De|From)\\s+([\\p{Lu}][\\p{L} ,.\\-]{2,100})/u]
          );

          return {
            id:           i ? i[1] : '',
            bio:          bio,
            ciudad:       ciudad,
            origen:       origen
          };

          /*

          // ── Trabajo actual (primer employer en work[]) ─────────────────────
          var trabajo = tryAll(
            [/"employer":\\s*\\{[^{}]*?"name":"([^"\\\\]+)"/],
            [/(?:Trabaja en|Works at)\\s+([\\p{L} ,.\\-&]{3,100})/u]
          );

          // ── Trabajo anterior (segundo employer en work[]) ──────────────────
          var trabajoPrev = '';
          var employers = html.match(/"employer":\\s*\\{[^{}]*?"name":"[^"\\\\]+"/g) || [];
          if (employers.length > 1) {
            var snd = employers[1].match(/"name":"([^"\\\\]+)"/);
            if (snd && ok(decode(snd[1]))) trabajoPrev = decode(snd[1]).trim();
          }
          if (!trabajoPrev) {
            var wpM = bodyText.match(/(?:Trabajó en|Worked at|Trabajaba en)\\s+([\\p{L} ,.\\-&]{3,100})/u);
            if (wpM && ok(wpM[1])) trabajoPrev = wpM[1].trim();
          }

          // ── Estudios (school) ──────────────────────────────────────────────
          var estudios = tryAll(
            [/"school":\\s*\\{[^{}]*?"name":"([^"\\\\]+)"/],
            [/(?:Estudió en|Studied at|Estudia en|Studies at)\\s+([\\p{L} ,.\\-]{3,100})/u]
          );

          // ── Estado civil (relationship_status code → texto en español) ─────
          var estadoCivil = '', pareja = '';
          var rsCodes = {
            MARRIED:'Casado/a', SINGLE:'Soltero/a', IN_RELATIONSHIP:'En relación',
            ENGAGED:'Comprometido/a', SEPARATED:'Separado/a', DIVORCED:'Divorciado/a',
            WIDOWED:'Viudo/a', COMPLICATED:'Es complicado',
            IN_OPEN_RELATIONSHIP:'En relación abierta',
            IN_CIVIL_UNION:'Unión civil', IN_DOMESTIC_PARTNERSHIP:'Pareja de hecho'
          };
          var rsM = html.match(/"relationship_status":"([A-Z_]+)"/);
          if (rsM && rsCodes[rsM[1]]) estadoCivil = rsCodes[rsM[1]];

          // Pareja (sólo desde texto cuando es visible)
          var matr = bodyText.match(/(?:Casado con|Casada con|Married to)\\s+([\\p{L} ,.\\-]{3,100})/u);
          var rel  = bodyText.match(/(?:Tiene una relación con|En una relación con|In a relationship with)\\s+([\\p{L} ,.\\-]{3,100})/u);
          if (matr) { pareja = matr[1].trim(); if (!estadoCivil) estadoCivil = 'Casado/a'; }
          else if (rel) { pareja = rel[1].trim(); if (!estadoCivil) estadoCivil = 'En relación'; }
          if (!estadoCivil) {
            var solt = bodyText.match(/(?:^|\\n)(Soltero|Soltera|Single|Separado|Separada|Divorciado|Divorciada|Viudo|Viuda)(?:\\n|$)/u);
            if (solt) estadoCivil = solt[1];
          }

          // ── Cumpleaños (día + mes en español + año si público) ─────────────
          var bday = '';
          var monthNames = ['enero','febrero','marzo','abril','mayo','junio',
                            'julio','agosto','septiembre','octubre','noviembre','diciembre'];
          var bdayPats = [
            /"birthdate"\\s*:\\s*\\{[^}]*?"day"\\s*:\\s*(\\d+)[^}]*?"month"\\s*:\\s*(\\d+)(?:[^}]*?"year"\\s*:\\s*(\\d+))?/,
            /"birthday_field"[^{]*\\{[^}]*?"day"\\s*:\\s*(\\d+)[^}]*?"month"\\s*:\\s*(\\d+)(?:[^}]*?"year"\\s*:\\s*(\\d+))?/,
            /"birth_date"\\s*:\\s*\\{[^}]*?"day"\\s*:\\s*(\\d+)[^}]*?"month"\\s*:\\s*(\\d+)(?:[^}]*?"year"\\s*:\\s*(\\d+))?/
          ];
          for (var bi = 0; bi < bdayPats.length; bi++) {
            var bm = html.match(bdayPats[bi]);
            if (!bm) continue;
            var dd = parseInt(bm[1]), mo = parseInt(bm[2]), yr = bm[3] ? parseInt(bm[3]) : null;
            bday = dd + ' de ' + (monthNames[mo-1] || mo) + (yr ? ' de ' + yr : '');
            break;
          }

          // ── Género ─────────────────────────────────────────────────────────
          var genero = '';
          var gM = html.match(/"gender":"([^"]+)"/);
          if (gM && gM[1] !== 'UNKNOWN') genero = gM[1];

          // ── Redes vinculadas: Instagram, X/Twitter, Web, Email ─────────────
          // ── Instagram (linked account, URL directa, o URL codificada en l.facebook.com) ──
          var instagram = '';
          var igPats = [
            /"instagram_username"\\s*:\\s*"([a-zA-Z0-9_.]{1,30})"/,
            /instagram\\.com(?:\\/|%2F)([a-zA-Z0-9_.]{1,30})/i
          ];
          var igBlack = /^(p|reel|reels|stories|explore|directory|web|accounts|tv|developer|about|legal|privacy|terms|tags?|invite|emails?|signup|login)$/i;
          for (var ii = 0; ii < igPats.length; ii++) {
            var im = html.match(igPats[ii]);
            if (im && im[1] && !igBlack.test(im[1])) { instagram = im[1]; break; }
          }

          // ── YouTube (handle @user, channel, c/, user/) ───────────────────────
          var youtube = '';
          var ytPats = [
            /youtube\\.com(?:\\/|%2F)(?:@|c\\/|c%2F|channel\\/|channel%2F|user\\/|user%2F)?([a-zA-Z0-9_.\\-]{1,50})/i
          ];
          var ytBlack = /^(watch|results|embed|shorts|playlist|feed|gaming|sports|music|trending|premium|signin|signup|t|account|reporthistory|paid_memberships|new|live|hashtag)$/i;
          for (var yi = 0; yi < ytPats.length; yi++) {
            var ymm = html.match(ytPats[yi]);
            if (ymm && ymm[1] && !ytBlack.test(ymm[1])) { youtube = ymm[1]; break; }
          }

          // ── X / Twitter ──────────────────────────────────────────────────────
          var twitter = '';
          var twPats = [
            /"twitter"\\s*:\\s*"([a-zA-Z0-9_]{1,15})"/,
            /(?:twitter|x)\\.com(?:\\/|%2F)([a-zA-Z0-9_]{1,15})/i
          ];
          var twBlack = /^(home|search|explore|notifications|messages|i|intent|share|about|tos|status|compose|account|signup|login)$/i;
          for (var ti = 0; ti < twPats.length; ti++) {
            var tm = html.match(twPats[ti]);
            if (tm && tm[1] && !twBlack.test(tm[1])) { twitter = tm[1]; break; }
          }

          // ── Threads (Meta) ───────────────────────────────────────────────────
          var threads = '';
          var thPats = [
            /threads\\.(?:com|net)(?:\\/|%2F)@?([a-zA-Z0-9_.]{1,30})/i
          ];
          for (var thi = 0; thi < thPats.length; thi++) {
            var thm = html.match(thPats[thi]);
            if (thm && thm[1] && !/^(home|search|explore|intent|login|signup|terms|privacy)$/i.test(thm[1])) {
              threads = thm[1]; break;
            }
          }

          // ── Sitio web (campo JSON específico) ────────────────────────────────
          var web = '';
          var webM = html.match(/"websites?"\\s*:\\s*\\[\\s*"(https?:\\/\\/[^"\\\\]+)"/);
          if (webM) web = decode(webM[1]);

          // ── Email: buscar en TODO el HTML (a menudo está en el bio text),
          //          filtrar dominios de plataforma y placeholders ──────────────
          var email = '';
          var allEmails = html.match(/[a-zA-Z0-9._%+\\-]{1,64}@[a-zA-Z0-9.\\-]+\\.[a-zA-Z]{2,}/g) || [];
          var blockedDomains = /^(.*\\.)?(facebook|fbcdn|fbsbx|messenger|fb|workplace|whatsapp|instagram|sentry|sentry-cdn|noreply|example|ejemplo|test|correo|fburl)\\.(com|net|org|io|dev)$/i;
          for (var ei = 0; ei < allEmails.length; ei++) {
            var d = (allEmails[ei].split('@')[1] || '').toLowerCase();
            if (!blockedDomains.test(d)) { email = decode(allEmails[ei]); break; }
          }

          return {
            id:           i ? i[1] : '',
            bio:          bio,
            ciudad:       ciudad,
            origen:       origen,
            trabajo:      trabajo,
            trabajoPrev:  trabajoPrev,
            estudios:     estudios,
            estadoCivil:  estadoCivil,
            pareja:       pareja,
            cumpleanos:   bday,
            genero:       genero,
            instagram:    instagram,
            twitter:      twitter,
            youtube:      youtube,
            threads:      threads,
            web:          web,
            email:        email
          };
          */
        })()`

          browser.tabs.executeScript(tabId, { code: code }).then(results => {
            finish((results && results[0]) || {})
          }).catch(() => finish({}))
        }, POST_SCROLL_MS)
      }, PRE_SCROLL_MS)
    }

    browser.tabs.create({ url: url, active: false }).then(tab => {
      tabId = tab.id
      browser.tabs.onUpdated.addListener(onUpdate)
    }).catch(() => finish({}))
  })
}

// ── Keyboard commands ───────────────────────────────────────────────────────
browser.commands.onCommand.addListener(cmd => {
  if (cmd === 'toggle-panel') {
    browser.tabs.query({ active: true, currentWindow: true }).then(tabs => {
      if (tabs[0]?.id) {
        browser.tabs.sendMessage(tabs[0].id, { type: 'TOGGLE_PANEL' }).catch(() => {})
      }
    })
    return
  }

  if (cmd === 'open-main-menu') {
    if (mainMenuOpen) {
      browser.runtime.sendMessage({ type: 'CLOSE_MAIN_MENU' }).catch(() => {})
      mainMenuOpen = false
    } else if (browser.browserAction.openPopup) {
      browser.browserAction.openPopup().catch(() => {})
    }
  }
})

// ── Toggle panel on browser action click (no popup fallback) ────────────────
// popup.html handles the click; this is a fallback for tabs without popup support
browser.browserAction.onClicked.addListener(tab => {
  if (tab?.id) {
    browser.tabs.sendMessage(tab.id, { type: 'TOGGLE_PANEL' }).catch(() => {})
  }
})
