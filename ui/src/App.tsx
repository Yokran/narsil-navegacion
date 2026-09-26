/**
 * Carcasa de la app de navegación.
 *
 * Una sola pantalla: las identidades. Sin login, sin capas, sin barra lateral — el aislamiento
 * lo da el usuario del sistema operativo y no hay nada más que enseñar.
 *
 * La cabecera lleva dos botones que la plataforma no necesita y esta app sí: **Acceder a
 * S.A.R.A.** (Supervised Autonomous Research Architecture: el arnés y el resto de capas de
 * NARSIL Intelligence Platform) y **Configurar S.A.R.A.** (dónde está). La dirección no se
 * enseña de continuo: se pone una vez por puesto y se olvida. Si no hay S.A.R.A., o la
 * configurada no contesta, el acceso abre un aviso con la vía para obtener acceso completo:
 * el Módulo de navegación es abierto; la plataforma completa la concede el titular.
 */
import { useCallback, useEffect, useState } from 'react'
import { Button, Callout, Dialog, DialogBody, DialogFooter, FormGroup, InputGroup, ProgressBar } from '@blueprintjs/core'
import { LANGUAGE_OPTIONS } from './i18n'
import type { Language } from './i18n'
import { useAppCtx } from './AppContext'
import ProfilesPage from './pages/ProfilesPage'
import { abrirEnlaceAcceso, aplicarActualizacion, cerrarAplicacion, comprobarActualizacion, fetchNode, openNode, probeNode, saveNode } from './api'
import type { InfoActualizacion, NodeProbe } from './api'

interface Status {
  status: string
  version: string
  node: string | null
  platform: string
  hosted?: boolean
  packaged?: boolean
  acceso_url?: string
}

export default function App() {
  const { language, setLanguage } = useAppCtx()
  const [status, setStatus] = useState<Status | null>(null)
  const [nodeUrl, setNodeUrl] = useState('')
  const [busy, setBusy] = useState(false)

  // La pantalla de arranque se retira cuando el estado y las identidades han llegado, y nunca
  // antes de un mínimo: el lanzador ya la mostró 1,3 s mientras levantaba el servidor, y esta la
  // continúa sin salto otros 0,7 s (2,0 s en total, decisión del Señor) hasta que hay algo que
  // enseñar. Si se toca aquí, se toca MINIMO_VISIBLE en backend/app/arranque.py.
  const [estadoListo, setEstadoListo] = useState(false)
  const [identidadesListas, setIdentidadesListas] = useState(false)
  const [minimoPasado, setMinimoPasado] = useState(false)
  useEffect(() => {
    const id = window.setTimeout(() => setMinimoPasado(true), 700)
    return () => window.clearTimeout(id)
  }, [])
  const arranqueListo = estadoListo && identidadesListas && minimoPasado
  const alCargarIdentidades = useCallback(() => setIdentidadesListas(true), [])
  // La pantalla es estática en index.html (está desde el primer fotograma, antes de este
  // código): aquí solo se funde y, pasado el fundido, se retira del documento.
  useEffect(() => {
    if (!arranqueListo) return
    const pantalla = document.getElementById('arranque')
    if (!pantalla) return
    pantalla.classList.add('arranque--fundido')
    const id = window.setTimeout(() => pantalla.remove(), 400)
    return () => window.clearTimeout(id)
  }, [arranqueListo])

  const [configAbierta, setConfigAbierta] = useState(false)
  const [actualizarAbierto, setActualizarAbierto] = useState(false)
  const [avisoAbierto, setAvisoAbierto] = useState(false)
  const [motivo, setMotivo] = useState('')

  const cargarEstado = useCallback(async () => {
    try {
      const r = await fetch('/api/status')
      setStatus(r.ok ? await r.json() : null)
    } catch {
      setStatus(null)
    }
    try {
      const { url } = await fetchNode()
      setNodeUrl(url)
    } catch {
      /* sin S.A.R.A. configurada: modo autónomo, que es un estado válido */
    }
    setEstadoListo(true)
  }, [])

  useEffect(() => { void cargarEstado() }, [cargarEstado])

  /** Acceso a S.A.R.A.: si hay dirección y contesta, se viaja; si no, el aviso. */
  const acceder = async () => {
    setBusy(true)
    try {
      const { url } = await fetchNode()
      if (!url) {
        setMotivo('No hay ninguna S.A.R.A. configurada en este puesto.')
        setAvisoAbierto(true)
        return
      }
      const sonda = await probeNode()
      if (!sonda.reachable) {
        setMotivo(`S.A.R.A. (${url}) no responde.`)
        setAvisoAbierto(true)
        return
      }
      await openNode()
    } catch (err) {
      setMotivo(err instanceof Error ? err.message : String(err))
      setAvisoAbierto(true)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="nav-app">
      <header className="nav-header">
        <div className="nav-brand">
          {/* Escudo sin nombre + el nombre escrito al lado: el logotipo completo
              del kit recorta la palabra NARSIL. */}
          <img className="nav-escudo" src="/marca/escudo.png" alt="" />
          <span className="nav-brand-mark">NARSIL</span>
          <span className="nav-brand-sub">Navegación</span>
        </div>

        <div className="nav-nodo">
          <button className="btn btn-primary" disabled={busy} onClick={() => void acceder()}
            title={nodeUrl ? `Abre NARSIL S.A.R.A. (${nodeUrl})` : 'Acceder a NARSIL S.A.R.A.'}>
            Acceder a S.A.R.A.
          </button>
          <button className="btn btn-ghost" disabled={busy} onClick={() => setConfigAbierta(true)}
            title="Dirección de NARSIL S.A.R.A. de este puesto">
            <span className="nav-nodo__engranaje" aria-hidden="true">⚙</span>Configurar S.A.R.A.
          </button>
          <button className="btn btn-ghost" disabled={busy} onClick={() => setActualizarAbierto(true)}
            title="Consulta las versiones publicadas en GitHub (solo al pulsar)">
            <span className="nav-nodo__engranaje" aria-hidden="true">↻</span>Buscar actualizaciones
          </button>
        </div>

        <div className="nav-status">
          <span className={`nav-dot ${status ? 'on' : 'off'}`} />
          <span>{status ? status.platform : 'sin servicio local'}</span>
          <span className="nav-sep">·</span>
          <span>{nodeUrl ? 'S.A.R.A. configurada' : 'modo autónomo'}</span>
          <select
            className="nav-lang"
            value={language}
            onChange={(e) => setLanguage(e.target.value as Language)}
          >
            {LANGUAGE_OPTIONS.map((o) => (
              <option key={o.id} value={o.id}>{o.native}</option>
            ))}
          </select>
        </div>
      </header>
      <main className="nav-main">
        <ProfilesPage alCargar={alCargarIdentidades} />
      </main>

      <ConfigurarNodo
        abierta={configAbierta}
        actual={nodeUrl}
        alCerrar={() => { setConfigAbierta(false); void cargarEstado() }}
      />

      <Actualizar
        abierto={actualizarAbierto}
        version={status?.version ?? ''}
        empaquetada={status?.packaged ?? false}
        alCerrar={() => setActualizarAbierto(false)}
      />

      <AvisoAcceso
        abierto={avisoAbierto}
        motivo={motivo}
        enlace={status?.acceso_url ?? ''}
        alCerrar={() => setAvisoAbierto(false)}
        alConfigurar={() => { setAvisoAbierto(false); setConfigAbierta(true) }}
      />
    </div>
  )
}

/* ── Configuración de S.A.R.A. ───────────────────────────────────────────────── */

function ConfigurarNodo({ abierta, actual, alCerrar }: {
  abierta: boolean
  actual: string
  alCerrar: () => void
}) {
  const [borrador, setBorrador] = useState(actual)
  const [resultado, setResultado] = useState<NodeProbe | null>(null)
  const [error, setError] = useState('')
  const [ocupado, setOcupado] = useState(false)

  useEffect(() => {
    if (abierta) { setBorrador(actual); setResultado(null); setError('') }
  }, [abierta, actual])

  const guardar = async () => {
    setOcupado(true)
    setError('')
    setResultado(null)
    try {
      const guardada = await saveNode(borrador)
      setBorrador(guardada)
      // Se comprueba nada más guardar: el operador sale de aquí sabiendo si S.A.R.A. contesta.
      setResultado(guardada ? await probeNode() : { configured: false, reachable: false, detail: 'Modo autónomo: sin S.A.R.A.' })
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setOcupado(false)
    }
  }

  return (
    <Dialog isOpen={abierta} onClose={alCerrar} title="Configurar S.A.R.A." icon="cog"
      canEscapeKeyClose canOutsideClickClose style={{ width: 520 }}>
      <DialogBody>
        <div className="nodo-config">
          <FormGroup label="Dirección de NARSIL S.A.R.A. (Supervised Autonomous Research Architecture)" labelFor="nodo-url"
            helperText="Servidor de su organización que sirve la plataforma, con http:// o https:// y su puerto. Vacío = modo autónomo.">
            <InputGroup id="nodo-url" value={borrador} placeholder="https://sara.interno:7420"
              spellCheck={false} autoFocus
              onValueChange={setBorrador}
              onKeyDown={(e) => { if (e.key === 'Enter') void guardar() }} />
          </FormGroup>
          <div className="nodo-config__ayuda">
            La dirección la facilita el administrador de su organización. Una vez guardada, el
            botón «Acceder a S.A.R.A.» lleva directamente a la plataforma.
          </div>
          {error && <Callout intent="danger">{error}</Callout>}
          {resultado && (
            <Callout intent={resultado.reachable ? 'success' : resultado.configured ? 'warning' : 'none'}>
              {resultado.detail}{resultado.version ? ` Versión ${resultado.version}.` : ''}
            </Callout>
          )}
        </div>
      </DialogBody>
      <DialogFooter minimal actions={(
        <>
          <Button text="Cerrar" onClick={alCerrar} />
          <Button intent="primary" text="Guardar y comprobar" loading={ocupado} onClick={() => void guardar()} />
        </>
      )} />
    </Dialog>
  )
}

/* ── Aviso de acceso sin S.A.R.A. ─────────────────────────────────────────────── */

function AvisoAcceso({ abierto, motivo, enlace, alCerrar, alConfigurar }: {
  abierto: boolean
  motivo: string
  enlace: string
  alCerrar: () => void
  alConfigurar: () => void
}) {
  const [aviso, setAviso] = useState('')
  const enlaceVisible = enlace.replace(/^https?:\/\//, '')

  const abrirEnlace = async () => {
    setAviso('')
    try {
      await abrirEnlaceAcceso()
    } catch (err) {
      setAviso(err instanceof Error ? err.message : String(err))
    }
  }

  return (
    <Dialog isOpen={abierto} onClose={alCerrar} title="Acceso a S.A.R.A." icon="shield"
      canEscapeKeyClose canOutsideClickClose style={{ width: 560 }}>
      <DialogBody>
        <div className="aviso-licencia">
          {motivo && <div className="aviso-licencia__motivo">{motivo}</div>}
          <p style={{ margin: 0 }}>
            Si su organización ya dispone de acceso completo a NARSIL Intelligence Platform,
            póngase en contacto con su administrador por la vía facilitada.
          </p>
          <p style={{ margin: 0 }}>
            Si no, aquí tiene la información para obtener acceso completo:
          </p>
          <button type="button" className="aviso-licencia__enlace" onClick={() => void abrirEnlace()}
            title="Se abre en el navegador del sistema">
            <span aria-hidden="true">↗</span>{enlaceVisible || 'narsilintelligence.com/narsil-ip'}
          </button>
          {aviso && <Callout intent="danger">{aviso}</Callout>}
        </div>
      </DialogBody>
      <DialogFooter minimal actions={(
        <>
          <Button text="Configurar S.A.R.A." icon="cog" onClick={alConfigurar} />
          <Button intent="primary" text="Cerrar" onClick={alCerrar} />
        </>
      )} />
    </Dialog>
  )
}

/* ── Actualizaciones ──────────────────────────────────────────────────────── */

type FaseActualizacion = 'comprobando' | 'al-dia' | 'disponible' | 'aplicando' | 'instalada' | 'cerrando' | 'error'

function Actualizar({ abierto, version, empaquetada, alCerrar }: {
  abierto: boolean
  version: string
  empaquetada: boolean
  alCerrar: () => void
}) {
  const [fase, setFase] = useState<FaseActualizacion>('comprobando')
  const [info, setInfo] = useState<InfoActualizacion | null>(null)
  const [error, setError] = useState('')
  const [pct, setPct] = useState(0)
  const [mensaje, setMensaje] = useState('')

  // Se consulta GitHub al abrir el diálogo, es decir, al pulsar el botón. Nunca antes.
  useEffect(() => {
    if (!abierto) return
    let cancelado = false
    setFase('comprobando'); setInfo(null); setError(''); setPct(0); setMensaje('')
    comprobarActualizacion()
      .then((i) => { if (cancelado) return; setInfo(i); setFase(i.disponible ? 'disponible' : 'al-dia') })
      .catch((err) => { if (cancelado) return; setError(err instanceof Error ? err.message : String(err)); setFase('error') })
    return () => { cancelado = true }
  }, [abierto])

  const aplicar = async () => {
    setFase('aplicando'); setPct(0); setMensaje('Preparando…')
    try {
      await aplicarActualizacion((e) => {
        if (e.type === 'progress') { setPct(e.pct ?? 0); setMensaje(e.message) }
        else if (e.ok && e.instalada) { setFase('instalada'); setMensaje(e.message) }
        else { setError(e.message); setFase('error') }
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err)); setFase('error')
    }
  }

  const cerrable = fase !== 'aplicando' && fase !== 'cerrando'
  const cerrar = async () => { setFase('cerrando'); try { await cerrarAplicacion() } catch { /* ya se está cerrando */ } }
  const mb = info ? (info.tamano / 1048576).toFixed(0) : ''

  return (
    <Dialog isOpen={abierto} onClose={cerrable ? alCerrar : undefined} title="Actualizaciones" icon="refresh"
      isCloseButtonShown={cerrable} canEscapeKeyClose={cerrable} canOutsideClickClose={cerrable} style={{ width: 560 }}>
      <DialogBody>
        <div className="actualizar">
          <div className="actualizar__version">Versión instalada: <span className="mono">{version || '—'}</span></div>
          {fase === 'comprobando' && <Callout>Consultando las versiones publicadas…</Callout>}
          {fase === 'al-dia' && <Callout intent="success">Tiene la última versión{info ? ` (${info.publicada})` : ''}.</Callout>}
          {fase === 'disponible' && info && (
            <>
              <Callout intent="primary" icon="download">
                Hay una versión nueva: <strong>{info.publicada}</strong>{mb ? ` (${mb} MB)` : ''}.
                {!info.aplicable && ' No trae ejecutable verificado para este equipo: descárguela a mano desde la página de la versión.'}
                {!empaquetada && ' Está ejecutando la app desde el código: actualice con git.'}
              </Callout>
              {info.notas && <pre className="actualizar__notas">{info.notas}</pre>}
              <div className="actualizar__ayuda">
                Se descarga el ejecutable de GitHub, se comprueba su suma SHA-256 contra la publicada y, si
                coincide, la app se cierra y vuelve a abrirse ya actualizada. Sus identidades, credenciales,
                avatares y la dirección de S.A.R.A. no se tocan: viven en <span className="mono">data\</span>, fuera del ejecutable.
              </div>
            </>
          )}
          {fase === 'aplicando' && (
            <>
              <ProgressBar value={pct / 100} intent="primary" stripes animate />
              <div className="actualizar__ayuda">{mensaje}</div>
            </>
          )}
          {fase === 'instalada' && (
            <Callout intent="success" icon="tick">
              {mensaje} Pulse <strong>Cerrar la aplicación</strong> y ábrala de nuevo desde su acceso directo:
              ya será la versión nueva. Sus identidades y ajustes están donde estaban.
            </Callout>
          )}
          {fase === 'cerrando' && <Callout intent="success" icon="tick">Cerrando… Vuelva a abrir NARSIL Navegación desde su acceso directo.</Callout>}
          {fase === 'error' && <Callout intent="danger">{error}</Callout>}
        </div>
      </DialogBody>
      <DialogFooter minimal actions={(
        <>
          {fase !== 'instalada' && <Button text="Cerrar" onClick={alCerrar} disabled={!cerrable} />}
          {fase === 'instalada' && <Button intent="primary" icon="power" text="Cerrar la aplicación" onClick={() => void cerrar()} />}
          {fase === 'disponible' && info?.aplicable && empaquetada && (
            <Button intent="primary" icon="download" text={`Actualizar a ${info.publicada}`} onClick={() => void aplicar()} />
          )}
          {fase === 'error' && <Button text="Reintentar" onClick={() => { setFase('comprobando'); setError('');
            comprobarActualizacion().then((i) => { setInfo(i); setFase(i.disponible ? 'disponible' : 'al-dia') })
              .catch((err) => { setError(err instanceof Error ? err.message : String(err)); setFase('error') }) }} />}
        </>
      )} />
    </Dialog>
  )
}
