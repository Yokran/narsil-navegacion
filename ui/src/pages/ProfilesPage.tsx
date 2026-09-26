import { useState, useEffect, useRef, useCallback } from 'react'
import type { FC, ChangeEvent } from 'react'
import {
  fetchProfiles,
  createProfile,
  deleteProfile,
  renameProfile,
  openProfile,
  uploadAvatar,
  fetchBrowserStatus,
  installBrowser,
  fetchTemplates,
  saveTemplateFromProfile,
  deleteTemplate,
  fetchProfileMeta,
  saveProfileMeta,
} from '../api'
import type { ProfileInfo, ProfileMeta, CloneProgressEvent, InstallEvent, TemplateInfo } from '../api'
import {
  Alert, Button, Dialog, DialogBody, DialogFooter, FormGroup, InputGroup, ProgressBar, Tag,
} from '@blueprintjs/core'
import { useAppCtx } from '../AppContext'
import Dropdown from '../components/Dropdown'

// ── Avatar placeholder ─────────────────────────────────────────────────────
const AvatarIcon: FC = () => (
  <svg width="44" height="44" viewBox="0 0 32 32" fill="none" stroke="currentColor" strokeWidth="1.5" opacity="0.4">
    <circle cx="16" cy="11" r="5"/>
    <path d="M6 26c0-5.52 4.48-10 10-10s10 4.48 10 10"/>
  </svg>
)

// ── Progress modal ─────────────────────────────────────────────────────────
interface ProgressModalProps {
  name: string
  pct: number
  message: string
  onCancel: () => void
}

const ProgressModal: FC<ProgressModalProps> = ({ name, pct, message, onCancel }) => {
  const { t } = useAppCtx()
  return (
  // Creación en curso: sin botón de cierre ni Escape — se sale por «Cancelar», que corta el
  // stream y cierra la ventana. OJO: no detiene la copia en el backend, que sigue hasta
  // terminar; por eso el mensaje de cierre dice que el perfil puede existir igualmente.
  <Dialog isOpen title={t('profiles.creating')} icon="cog"
    isCloseButtonShown={false} canEscapeKeyClose={false} canOutsideClickClose={false}
    style={{ width: 'min(460px, 92vw)' }}>
    <DialogBody>
      <div style={{ fontSize: 12, color: 'var(--n-txt-3)', marginBottom: 12, fontFamily: "var(--n-mono)", letterSpacing: '0.06em' }}>
        {name}
      </div>
      <ProgressBar animate stripes value={pct / 100} intent="primary" />
      <div style={{ fontSize: 11, color: 'var(--n-txt-3)', marginTop: 10, minHeight: 32, lineHeight: 1.5 }}>
        {message}
      </div>
    </DialogBody>
    <DialogFooter minimal actions={<Button text={t('profiles.cancel')} onClick={onCancel} />} />
  </Dialog>
  )
}

// ── Create profile modal ───────────────────────────────────────────────────
interface CreateModalProps {
  templates: TemplateInfo[]
  onConfirm: (name: string, template: string) => void
  onCancel: () => void
}

const CreateModal: FC<CreateModalProps> = ({ templates, onConfirm, onCancel }) => {
  const { t } = useAppCtx()
  const [name, setName]         = useState('')
  const [template, setTemplate] = useState(templates[0]?.name ?? 'narsil-base')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => { inputRef.current?.focus() }, [])

  const handleSubmit = () => {
    const n = name.trim()
    if (n) onConfirm(n, template)
  }

  return (
    <Dialog isOpen onClose={onCancel} title={t('profiles.new').replace('+ ', '')} icon="new-person"
      style={{ width: 'min(480px, 92vw)' }}>
      <DialogBody>
        <FormGroup label={t('profiles.identity_name')}>
          <InputGroup
            inputRef={inputRef}
            placeholder={t('profiles.profile_placeholder')}
            value={name}
            onValueChange={setName}
            onKeyDown={(e) => { if (e.key === 'Enter') handleSubmit() }}
          />
        </FormGroup>
        {templates.length > 0 && (
          <FormGroup label={t('profiles.base_template')}>
            <Dropdown
              value={template}
              onChange={setTemplate}
              style={{ width: '100%' }}
              options={[
                ...templates.map(tpl => ({ value: tpl.name, label: `${tpl.display}${tpl.protected ? ' — protegida' : ''}` })),
                { value: '', label: t('profiles.no_template') },
              ]}
            />
          </FormGroup>
        )}
      </DialogBody>
      <DialogFooter minimal actions={(
        <>
          <Button text={t('profiles.cancel')} onClick={onCancel} />
          <Button intent="primary" text={t('profiles.create')} onClick={handleSubmit} disabled={!name.trim()} />
        </>
      )} />
    </Dialog>
  )
}

// ── Confirm delete modal ───────────────────────────────────────────────────
interface ConfirmDeleteProps {
  name: string
  onConfirm: () => void
  onCancel: () => void
}

const ConfirmDeleteModal: FC<ConfirmDeleteProps> = ({ name, onConfirm, onCancel }) => {
  const { t } = useAppCtx()
  return (
  <Alert isOpen icon="trash" intent="danger"
    confirmButtonText={t('profiles.delete')} cancelButtonText={t('profiles.cancel')}
    onConfirm={onConfirm} onCancel={onCancel} canEscapeKeyCancel canOutsideClickCancel>
    <div style={{ fontSize: 12, color: 'var(--n-txt-3)', lineHeight: 1.6 }}>
      Vas a eliminar el perfil:<br />
      <span style={{ color: '#E4DED9', fontWeight: 700, letterSpacing: '0.06em' }}>{name}</span><br />
      <br />
      Esto borrará su carpeta de perfil (historial, cookies, extensiones).
      <br />Esta acción <strong style={{ color: '#F0736A' }}>no se puede deshacer</strong>.
    </div>
  </Alert>
  )
}

// ── Save-as-template modal ─────────────────────────────────────────────────
interface SaveTemplateModalProps {
  profileName: string
  onConfirm: (templateName: string) => void
  onCancel: () => void
}

const SaveTemplateModal: FC<SaveTemplateModalProps> = ({ profileName, onConfirm, onCancel }) => {
  const { t } = useAppCtx()
  const [tplName, setTplName] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => { inputRef.current?.focus() }, [])

  const handleSubmit = () => {
    const n = tplName.trim()
    if (n) onConfirm(n)
  }

  return (
    <Dialog isOpen onClose={onCancel} title={t('profiles.save_template')} icon="duplicate"
      style={{ width: 'min(480px, 92vw)' }}>
      <DialogBody>
        <div style={{ fontSize: 12, color: 'var(--n-txt-3)', marginBottom: 14, lineHeight: 1.7 }}>
          Las extensiones y su configuración del perfil<br />
          <span style={{ color: '#E4DED9', fontWeight: 700, letterSpacing: '0.06em' }}>{profileName}</span><br />
          se copiarán a la plantilla con el nombre indicado.
          Los nuevos perfiles que crees a partir de ella las heredarán.<br />
          <br />
          Los perfiles ya existentes <strong>no se modifican</strong>.
        </div>
        <FormGroup label="Nombre de la plantilla">
          <InputGroup
            inputRef={inputRef}
            placeholder="Nombre de la plantilla..."
            value={tplName}
            onValueChange={setTplName}
            onKeyDown={(e) => { if (e.key === 'Enter') handleSubmit() }}
          />
        </FormGroup>
      </DialogBody>
      <DialogFooter minimal actions={(
        <>
          <Button text={t('profiles.cancel')} onClick={onCancel} />
          <Button intent="primary" text={t('profiles.save_template')} onClick={handleSubmit} disabled={!tplName.trim()} />
        </>
      )} />
    </Dialog>
  )
}

// ── Templates list modal ───────────────────────────────────────────────────
interface TemplatesModalProps {
  templates: TemplateInfo[]
  onDelete: (name: string) => void
  onClose: () => void
}

const TemplatesModal: FC<TemplatesModalProps> = ({ templates, onDelete, onClose }) => {
  const { t } = useAppCtx()
  return (
  <Dialog isOpen onClose={onClose} title={t('profiles.templates')} icon="duplicate"
    style={{ width: 'min(460px, 92vw)' }}>
    <DialogBody>
      {templates.length === 0 ? (
        <div style={{ fontSize: 12, color: 'var(--n-txt-3)' }}>
          {t('profiles.no_templates')}
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {templates.map(tpl => (
            <div key={tpl.name} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', background: 'var(--n-sup-alta)', borderRadius: 6 }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 12, color: 'var(--n-txt)', letterSpacing: '0.05em' }}>{tpl.display}</div>
                {tpl.protected && (
                  <Tag minimal intent="primary" style={{ marginTop: 2 }}>{t('profiles.protected')}</Tag>
                )}
              </div>
              {!tpl.protected && (
                <Button small intent="danger" text={t('profiles.delete')} onClick={() => onDelete(tpl.name)} />
              )}
            </div>
          ))}
        </div>
      )}
    </DialogBody>
    <DialogFooter minimal actions={<Button text={t('win.close')} onClick={onClose} />} />
  </Dialog>
  )
}

// ── Profile tile ───────────────────────────────────────────────────────────
interface TileProps {
  profile: ProfileInfo
  selected: boolean
  onSelect: () => void
  onOpen: () => void
  /** Sube cuando el operador cambia un avatar; sólo entonces se vuelve a pedir la imagen. */
  avatarVersion: number
}

const ProfileTile: FC<TileProps> = ({ profile, selected, onSelect, onOpen, avatarVersion }) => {
  const [imgErr, setImgErr] = useState(false)
  // El sufijo llevaba `Date.now()`: cambiaba en cada render y la lista se refresca cada cuatro
  // segundos, así que el navegador volvía a descargar el avatar de CADA identidad cada cuatro
  // segundos —con cuarenta identidades, seiscientas peticiones por minuto sin tocar nada—
  // además del parpadeo de la imagen. Con una versión explícita sólo se recarga cuando cambia.
  const avatar_url = profile.avatar_url ? `${profile.avatar_url}?v=${avatarVersion}` : null

  return (
    <div
      className={`profile-tile${selected ? ' selected' : ''}`}
      onClick={onSelect}
      onDoubleClick={onOpen}
      title="Doble clic para abrir"
    >
      <div className="profile-avatar">
        {avatar_url && !imgErr
          ? <img src={avatar_url} alt={profile.name} onError={() => setImgErr(true)} />
          : <AvatarIcon />
        }
      </div>
      <div className="profile-name">{profile.name}</div>
      {profile.running && (
        <div className="profile-running-badge">
          <div style={{ width: 5, height: 5, borderRadius: '50%', background: 'var(--n-brillo)', boxShadow: '0 0 5px var(--n-brillo)' }} />
          ACTIVO
        </div>
      )}
    </div>
  )
}

// ── Browser setup panel ────────────────────────────────────────────────────
interface SetupPanelProps {
  installing: boolean
  installPct: number
  installMsg: string
  onInstall: () => void
  /** Por qué el navegador que hay no sirve (p. ej. es release y no ESR). Vacío = no hay ninguno. */
  motivo?: string
}

const BrowserSetupPanel: FC<SetupPanelProps> = ({ installing, installPct, installMsg, onInstall, motivo }) => (
  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', flex: 1, gap: 24, padding: '60px 0' }}>
    <svg width="56" height="56" viewBox="0 0 56 56" fill="none" stroke="currentColor" strokeWidth="1.2" opacity="0.3">
      <circle cx="28" cy="28" r="22"/>
      <path d="M28 16v12l8 4"/>
      <path d="M20 40l-6 6M36 40l6 6"/>
    </svg>
    <div style={{ textAlign: 'center', maxWidth: 520 }}>
      <div style={{ fontSize: 13, letterSpacing: '0.12em', color: 'var(--n-txt)', marginBottom: 6 }}>
        {motivo ? 'EL NAVEGADOR QUE HAY NO SIRVE' : 'NAVEGADOR NO ENCONTRADO'}
      </div>
      <div style={{ fontSize: 11, color: 'var(--n-txt-3)', lineHeight: 1.7, fontFamily: "var(--n-mono)" }}>
        {motivo || <>Este módulo requiere Firefox ESR para gestionar<br />navegadores aislados por identidad digital.</>}
      </div>
    </div>

    {installing ? (
      <div style={{ width: '100%', maxWidth: 360 }}>
        <div className="progress-bar-track">
          <div className="progress-bar-fill" style={{ width: `${installPct}%` }} />
        </div>
        <div style={{ fontSize: 11, color: 'var(--n-txt-3)', marginTop: 8, textAlign: 'center', fontFamily: "var(--n-mono)", lineHeight: 1.5 }}>
          {installMsg}
        </div>
      </div>
    ) : (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
        <button className="btn btn-primary" onClick={onInstall} style={{ minWidth: 220 }}>
          Instalar Firefox ESR
        </button>
        <div style={{ fontSize: 10, color: 'var(--n-clas-sin)', fontFamily: "var(--n-mono)", letterSpacing: '0.06em' }}>
          ~65 MB · descarga directa desde mozilla.org
        </div>
      </div>
    )}
  </div>
)

// ── Field label helper ─────────────────────────────────────────────────────
const FL: FC<{ children: string }> = ({ children }) => (
  <div style={{
    fontSize: 9, letterSpacing: '0.2em', color: 'var(--n-txt-3)',
    fontFamily: "var(--n-mono)", marginBottom: 4,
  }}>
    {children}
  </div>
)

// ── Custom select (evita el popup nativo del OS) ───────────────────────────
interface CustomSelectProps {
  value: string
  options: { value: string; label: string }[]
  onChange: (v: string) => void
  baseStyle: React.CSSProperties
}

const CustomSelect: FC<CustomSelectProps> = ({ value, options, onChange, baseStyle }) => {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const label = options.find(o => o.value === value)?.label ?? 'Sin asignar'

  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        style={{
          ...baseStyle,
          width: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          cursor: 'pointer',
          borderRadius: open ? '4px 4px 0 0' : 4,
          borderColor: open ? 'rgba(192, 141, 79, 0.5)' : 'rgba(192, 141, 79, 0.18)',
          color: value ? 'var(--n-brillo)' : 'var(--n-txt-3)',
        }}
      >
        <span>{label}</span>
        <svg width="9" height="5" viewBox="0 0 9 5" fill="none" stroke="currentColor" strokeWidth="1.5" opacity="0.5"
          style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s', flexShrink: 0 }}>
          <path d="M1 1l3.5 3L8 1"/>
        </svg>
      </button>
      {open && (
        <div style={{
          position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 200,
          background: '#1D2742',
          border: '1px solid rgba(192, 141, 79, 0.4)',
          borderTop: '1px solid rgba(192, 141, 79, 0.15)',
          borderRadius: '0 0 4px 4px',
          overflow: 'hidden',
        }}>
          {options.map(opt => (
            <div
              key={opt.value}
              onClick={() => { onChange(opt.value); setOpen(false) }}
              style={{
                padding: '6px 8px',
                fontSize: 12,
                fontFamily: "var(--n-mono)",
                letterSpacing: '0.06em',
                cursor: 'pointer',
                color: opt.value === value ? 'var(--n-brillo)' : (opt.value ? 'var(--n-txt)' : 'var(--n-txt-3)'),
                background: opt.value === value ? 'rgba(192, 141, 79, 0.1)' : 'transparent',
                transition: 'background 0.1s',
              }}
              onMouseEnter={e => { e.currentTarget.style.background = 'rgba(192, 141, 79, 0.08)' }}
              onMouseLeave={e => { e.currentTarget.style.background = opt.value === value ? 'rgba(192, 141, 79, 0.1)' : 'transparent' }}
            >
              {opt.label}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Field expand modal ─────────────────────────────────────────────────────
interface FieldExpandModalProps {
  title: string
  value: string
  editing: boolean
  obscure?: boolean
  placeholder?: string
  onChange?: (v: string) => void
  onClose: () => void
}

const FieldExpandModal: FC<FieldExpandModalProps> = ({ title, value, editing, obscure, placeholder, onChange, onClose }) => {
  const [revealed, setRevealed] = useState(!obscure)
  const taStyle: React.CSSProperties = {
    background: 'rgba(192, 141, 79, 0.04)',
    border: '1px solid rgba(192, 141, 79, 0.3)',
    borderRadius: 4,
    color: 'var(--n-txt)',
    fontFamily: "var(--n-mono)",
    fontSize: 12,
    padding: '10px 12px',
    width: '100%',
    height: '42vh',
    resize: 'vertical',
    outline: 'none',
    lineHeight: 1.65,
    letterSpacing: '0.04em',
    boxSizing: 'border-box',
  }
  return (
    <Dialog isOpen onClose={onClose} title={title} icon="document"
      style={{ minWidth: 540, maxWidth: 720, width: '58vw' }}>
      <DialogBody>
        {obscure && !editing && (
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 10 }}>
            <Button small variant="minimal"
              icon={revealed ? 'eye-off' : 'eye-open'}
              text={revealed ? 'Ocultar' : 'Mostrar'}
              onClick={() => setRevealed(v => !v)} />
          </div>
        )}
        {editing ? (
          <textarea
            className="bp6-input"
            style={taStyle}
            value={value}
            onChange={e => onChange?.(e.target.value)}
            placeholder={placeholder}
            autoFocus
          />
        ) : (
          <div style={{
            ...taStyle, height: undefined, minHeight: '28vh', maxHeight: '50vh',
            overflowY: 'auto', resize: undefined,
            filter: obscure && !revealed ? 'blur(6px)' : 'none',
            transition: 'filter 0.25s ease',
            userSelect: obscure && !revealed ? 'none' : 'text',
            whiteSpace: 'pre-wrap',
            color: value ? 'var(--n-txt)' : 'var(--n-txt-3)',
          }}>
            {value || '—'}
          </div>
        )}
      </DialogBody>
      <DialogFooter minimal actions={<Button text="Cerrar" onClick={onClose} />} />
    </Dialog>
  )
}

// ── Services catalogue ─────────────────────────────────────────────────────
const SERVICES = [
  { id: 'google',    label: 'Google',    color: '#4285F4', bg: 'rgba(66,133,244,0.12)',   init: 'G'  },
  { id: 'youtube',   label: 'YouTube',   color: '#FF0000', bg: 'rgba(255,0,0,0.10)',      init: '▶'  },
  { id: 'facebook',  label: 'Facebook',  color: '#1877F2', bg: 'rgba(24,119,242,0.12)',   init: 'F'  },
  { id: 'instagram', label: 'Instagram', color: '#E4405F', bg: 'rgba(228,64,95,0.12)',    init: 'IG' },
  { id: 'twitter',   label: 'X/Twitter', color: '#e7e7e7', bg: 'rgba(231,231,231,0.08)', init: 'X'  },
  { id: 'whatsapp',  label: 'WhatsApp',  color: '#25D366', bg: 'rgba(37,211,102,0.12)',   init: 'WA' },
  { id: 'tiktok',    label: 'TikTok',    color: '#69C9D0', bg: 'rgba(105,201,208,0.12)',  init: 'TK' },
  { id: 'linkedin',  label: 'LinkedIn',  color: '#0A66C2', bg: 'rgba(10,102,194,0.12)',   init: 'in' },
  { id: 'snapchat',  label: 'Snapchat',  color: '#FFFC00', bg: 'rgba(255,252,0,0.10)',    init: 'SC' },
  { id: 'pinterest', label: 'Pinterest', color: '#E60023', bg: 'rgba(230,0,35,0.12)',     init: 'P'  },
  { id: 'reddit',    label: 'Reddit',    color: '#FF4500', bg: 'rgba(255,69,0,0.12)',     init: 'RD' },
  { id: 'telegram',  label: 'Telegram',  color: '#2AABEE', bg: 'rgba(42,171,238,0.12)',   init: 'TG' },
  { id: 'discord',   label: 'Discord',   color: '#5865F2', bg: 'rgba(88,101,242,0.12)',   init: 'DC' },
  { id: 'twitch',    label: 'Twitch',    color: '#9146FF', bg: 'rgba(145,70,255,0.12)',   init: 'TV' },
  { id: 'netflix',   label: 'Netflix',   color: '#E50914', bg: 'rgba(229,9,20,0.12)',     init: 'NF' },
  { id: 'amazon',    label: 'Amazon',    color: '#FF9900', bg: 'rgba(255,153,0,0.12)',    init: 'Az' },
  { id: 'spotify',   label: 'Spotify',   color: '#1DB954', bg: 'rgba(29,185,84,0.12)',    init: '♫'  },
  { id: 'gmail',     label: 'Gmail',     color: '#EA4335', bg: 'rgba(234,67,53,0.12)',    init: 'GM' },
  { id: 'github',    label: 'GitHub',    color: '#c9d1d9', bg: 'rgba(201,209,217,0.08)',  init: 'GH' },
  { id: 'paypal',    label: 'PayPal',    color: '#009cde', bg: 'rgba(0,156,222,0.12)',    init: 'PP' },
  { id: 'ebay',      label: 'eBay',      color: '#E53238', bg: 'rgba(229,50,56,0.12)',    init: 'eB' },
  { id: 'airbnb',    label: 'Airbnb',    color: '#FF5A5F', bg: 'rgba(255,90,95,0.12)',    init: 'AB' },
  { id: 'microsoft', label: 'Microsoft', color: '#00A4EF', bg: 'rgba(0,164,239,0.12)',    init: 'MS' },
  { id: 'apple',     label: 'Apple',     color: '#A2AAAD', bg: 'rgba(162,170,173,0.10)', init: '⌘'  },
  { id: 'booking',   label: 'Booking',   color: '#003580', bg: 'rgba(0,53,128,0.15)',     init: 'BK' },
] as const

// ── Services selector modal ────────────────────────────────────────────────
interface ServicesModalProps {
  selected: string[]
  onApply: (services: string[]) => void
  onClose: () => void
}

const ServicesModal: FC<ServicesModalProps> = ({ selected, onApply, onClose }) => {
  const { t } = useAppCtx()
  const [draft, setDraft] = useState<string[]>([...selected])

  const toggle = (id: string) =>
    setDraft(d => d.includes(id) ? d.filter(x => x !== id) : [...d, id])

  return (
    <Dialog isOpen onClose={onClose} title={t('profiles.active_services')} icon="grid-view"
      style={{ minWidth: 520, maxWidth: 640 }}>
      <DialogBody>
        <div style={{ fontSize: 11, color: 'var(--n-txt-3)', marginBottom: 16, lineHeight: 1.5, fontFamily: "var(--n-mono)" }}>
          {t('profiles.services_hint')}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 8 }}>
          {SERVICES.map(svc => {
            const active = draft.includes(svc.id)
            return (
              <div
                key={svc.id}
                onClick={() => toggle(svc.id)}
                title={svc.label}
                style={{
                  display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6,
                  padding: '10px 4px 8px', borderRadius: 8, cursor: 'pointer',
                  border: `1px solid ${active ? svc.color + '88' : 'rgba(255,255,255,0.06)'}`,
                  background: active ? svc.bg : 'transparent',
                  transition: 'border-color 0.12s, background 0.12s',
                }}
              >
                <div style={{
                  width: 34, height: 34, borderRadius: 7,
                  background: active ? svc.bg : 'rgba(255,255,255,0.04)',
                  border: `1px solid ${active ? svc.color + '66' : 'rgba(255,255,255,0.08)'}`,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  color: svc.color, fontSize: 13,
                  fontFamily: "var(--n-mono)", fontWeight: 700,
                }}>
                  {svc.init}
                </div>
                <div style={{
                  fontSize: 8, letterSpacing: '0.06em', textAlign: 'center',
                  color: active ? svc.color : 'var(--n-txt-3)',
                  fontFamily: "var(--n-mono)", lineHeight: 1.3,
                }}>
                  {svc.label}
                </div>
              </div>
            )
          })}
        </div>
      </DialogBody>
      <DialogFooter minimal actions={(
        <>
          <span style={{ fontSize: 10, color: 'var(--n-txt-3)', fontFamily: "var(--n-mono)", letterSpacing: '0.06em', marginRight: 6 }}>
            {draft.length} {t('profiles.selected_count')}
          </span>
          <Button text={t('profiles.cancel')} onClick={onClose} />
          <Button intent="primary" text={t('profiles.apply')} onClick={() => { onApply(draft); onClose() }} />
        </>
      )} />
    </Dialog>
  )
}

// ── Main page ──────────────────────────────────────────────────────────────
interface ProfilesPageProps {
  /** Se llama una vez, cuando la primera carga (navegador e identidades) ha terminado. */
  alCargar?: () => void
}

const ProfilesPage: FC<ProfilesPageProps> = ({ alCargar }) => {
  const { t } = useAppCtx()
  const [profiles, setProfiles]   = useState<ProfileInfo[]>([])
  const [templates, setTemplates] = useState<TemplateInfo[]>([])
  const [selected, setSelected]   = useState<string | null>(null)
  const [loading, setLoading]     = useState(true)
  const cargadoUnaVez = useRef(false)   // `alCargar` avisa de la PRIMERA carga, no de cada refresco
  const [status, setStatus]       = useState('')
  const [conteo, setConteo]       = useState('')
  const [avatarVersion, setAvatarVersion] = useState(0)

  const [showCreate,       setShowCreate]       = useState(false)
  const [showDelete,       setShowDelete]       = useState(false)
  const [showSaveTemplate, setShowSaveTemplate] = useState(false)
  const [showTemplates,    setShowTemplates]    = useState(false)

  const [cloning, setCloning] = useState<{ name: string; pct: number; message: string } | null>(null)
  const abortRef    = useRef<AbortController | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [browserReady, setBrowserReady] = useState<boolean | null>(null)
  const [browserMotivo, setBrowserMotivo] = useState('')
  const [installing,   setInstalling]   = useState(false)
  const [installPct,   setInstallPct]   = useState(0)
  const [installMsg,   setInstallMsg]   = useState('')

  // ── Metadata panel ─────────────────────────────────────────────────────
  const EMPTY_META: ProfileMeta = { category: '', description: '', notes: '', credentials: '', services: [] }
  const [meta,       setMeta]       = useState<ProfileMeta>(EMPTY_META)
  const [metaDraft,  setMetaDraft]  = useState<ProfileMeta>(EMPTY_META)
  const [metaDirty,  setMetaDirty]  = useState(false)
  const [metaSaving, setMetaSaving] = useState(false)
  const [editing,    setEditing]    = useState(false)
  const [profileNameDraft, setProfileNameDraft] = useState('')
  const [showCreds,     setShowCreds]     = useState(false)
  const [showServices,  setShowServices]  = useState(false)
  const [expandedField, setExpandedField] = useState<'description' | 'notes' | 'credentials' | null>(null)

  const checkBrowser = useCallback(async () => {
    try {
      const s = await fetchBrowserStatus()
      // `installed` no basta y por eso el backend devuelve `apto`: un Firefox release existe,
      // arranca y deja fuera la extensión Collector sin decir nada. Con uno así no se opera, y
      // la pantalla tiene que explicar por qué en vez de dejar crear identidades mudas.
      setBrowserReady(s.installed && s.apto)
      setBrowserMotivo(s.installed && !s.apto ? s.detalle : '')
    } catch {
      setBrowserReady(false)
      setBrowserMotivo('')
    }
  }, [])

  const load = useCallback(async () => {
    try {
      const ps = await fetchProfiles()
      setProfiles(ps)
      // El recuento va en su propio estado: cuando lo escribía en `status`, el refresco de cada
      // cuatro segundos borraba el último mensaje al operador —incluidos los errores— antes de
      // que le diera tiempo a leerlo.
      setConteo(`${ps.length} perfil(es)`)
    } catch (err) {
      setStatus(`Error: ${err}`)
    } finally {
      setLoading(false)
      if (!cargadoUnaVez.current) {
        cargadoUnaVez.current = true
        alCargar?.()
      }
    }
  }, [alCargar])

  const loadTemplates = useCallback(async () => {
    try {
      const ts = await fetchTemplates()
      setTemplates(ts)
    } catch {
      // non-fatal
    }
  }, [])

  useEffect(() => {
    void checkBrowser()
    void load()
    void loadTemplates()
    const interval = setInterval(() => void load(), 4000)
    return () => clearInterval(interval)
  }, [checkBrowser, load, loadTemplates])

  // Carga metadatos cuando cambia el perfil seleccionado
  useEffect(() => {
    setEditing(false)
    setShowCreds(false)
    setShowServices(false)
    setExpandedField(null)
    setProfileNameDraft(selected ?? '')
    if (!selected) {
      setMeta(EMPTY_META)
      setMetaDraft(EMPTY_META)
      setMetaDirty(false)
      return
    }
    fetchProfileMeta(selected)
      .then(m => { setMeta(m); setMetaDraft(m); setMetaDirty(false) })
      .catch(() => {})
  }, [selected]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!selected) return
    let alive = true
    const refresh = () => {
      fetchProfileMeta(selected)
        .then(m => {
          if (!alive) return
          setMeta(m)
          if (!editing && !metaDirty) {
            setMetaDraft(m)
          }
        })
        .catch(() => {})
    }
    const interval = setInterval(refresh, 4000)
    return () => {
      alive = false
      clearInterval(interval)
    }
  }, [selected, editing, metaDirty])

  const patchMeta = (patch: Partial<ProfileMeta>) => {
    const next = { ...metaDraft, ...patch }
    setMetaDraft(next)
    setMetaDirty(JSON.stringify(next) !== JSON.stringify(meta))
  }

  const handleStartEdit = () => {
    if (!selected) return
    if (selectedProfile?.running) {
      setStatus('Cierra el navegador de este perfil antes de editar sus datos.')
      return
    }
    setProfileNameDraft(selected)
    setMetaDraft(meta)
    setMetaDirty(false)
    setEditing(true)
  }

  const handleMetaSave = async () => {
    if (!selected) return
    if (selectedProfile?.running) {
      setStatus('Cierra el navegador de este perfil antes de guardar cambios.')
      setEditing(false)
      return
    }
    const newName = profileNameDraft.trim()
    const nameDirty = !!newName && newName !== selected
    if (!newName) {
      setStatus('El nombre del perfil no puede estar vacio.')
      return
    }
    if (!metaDirty && !nameDirty) return

    const oldName = selected
    let finalName = oldName
    let updatedProfile: ProfileInfo | null = null
    setMetaSaving(true)
    try {
      if (nameDirty) {
        updatedProfile = await renameProfile(oldName, newName)
        finalName = updatedProfile.name
        setProfiles(prev => prev.map(p => p.name === oldName ? updatedProfile! : p)
          .sort((a, b) => a.name.localeCompare(b.name)))
        setSelected(finalName)
        setProfileNameDraft(finalName)
      }
      if (metaDirty) {
        await saveProfileMeta(finalName, metaDraft)
      }
      setMeta(metaDraft)
      setMetaDirty(false)
      setProfileNameDraft(finalName)
      setEditing(false)
      setStatus(nameDirty ? `Perfil renombrado a '${finalName}'.` : 'Metadatos guardados.')
    } catch (err) {
      setStatus(`Error guardando perfil: ${err}`)
    } finally {
      setMetaSaving(false)
    }
  }

  const handleInstall = async () => {
    setInstalling(true)
    setInstallPct(0)
    setInstallMsg('Iniciando...')
    try {
      await installBrowser((evt: InstallEvent) => {
        if (evt.type === 'progress') {
          setInstallPct(evt.pct ?? 0)
          setInstallMsg(evt.message ?? '')
        } else if (evt.type === 'done') {
          // Se vuelve a preguntar al backend en vez de dar por bueno lo instalado: lo que decide
          // si se puede operar es que el binario sea ESR, no que la descarga terminara.
          if (evt.ok) { setInstallMsg(evt.message ?? 'Instalado.'); void checkBrowser() }
          else setInstallMsg(`Error: ${evt.message}`)
        }
      })
    } catch (err) {
      setInstallMsg(`Error: ${err}`)
    } finally {
      setInstalling(false)
    }
  }

  const handleSaveTemplate = async (templateName: string) => {
    if (!selected) return
    setShowSaveTemplate(false)
    setStatus(`Guardando plantilla '${templateName}' desde '${selected}'...`)
    try {
      const r = await saveTemplateFromProfile(selected, templateName)
      setStatus(`Plantilla '${templateName}' guardada (${r.synced.join(', ')}).`)
      void loadTemplates()
    } catch (err) { setStatus(`Error: ${err}`) }
  }

  const handleDeleteTemplate = async (name: string) => {
    setStatus(`Eliminando plantilla '${name}'...`)
    try {
      await deleteTemplate(name)
      setStatus(`Plantilla '${name}' eliminada.`)
      void loadTemplates()
    } catch (err) { setStatus(`Error: ${err}`) }
  }

  const handleCreate = async (name: string, template: string) => {
    setShowCreate(false)
    const ctrl = new AbortController()
    abortRef.current = ctrl
    setCloning({ name, pct: 0, message: 'Iniciando...' })
    setStatus(`Creando '${name}'...`)
    // El stream termina siempre en un evento `done`, y puede venir con `ok:false` (el nombre ya
    // existe, no hay navegador, falla el copiado). Se guarda para decidir DESPUÉS: anunciar el
    // éxito sin mirarlo pintaba «Perfil creado» encima del error y el operador se iba
    // convencido de tener una identidad que no existe.
    let fallo = ''
    try {
      await createProfile(name, template, (evt: CloneProgressEvent) => {
        if (evt.type === 'progress') setCloning({ name, pct: evt.pct ?? 0, message: evt.message ?? '' })
        else if (evt.type === 'done' && !evt.ok) fallo = evt.message ?? 'Error desconocido.'
      }, ctrl.signal)
      setStatus(fallo ? `Error: ${fallo}` : `Perfil '${name}' creado.`)
    } catch (err: unknown) {
      setStatus(err instanceof Error && err.name === 'AbortError'
        // Cortar el stream cierra la ventana, no la copia: el backend sigue creando el perfil.
        // Se dice tal cual en vez de un «cancelado» que no es verdad.
        ? `Creación interrumpida; el perfil '${name}' puede haberse creado igualmente. Mira la lista.`
        : `Error: ${err}`)
    } finally {
      setCloning(null)
      abortRef.current = null
      void load()   // salga bien, mal o a medias, la lista tiene que decir lo que hay en disco
    }
  }

  const handleDelete = async () => {
    if (!selected) return
    setShowDelete(false)
    setStatus(`Eliminando '${selected}'...`)
    try {
      await deleteProfile(selected)
      setSelected(null)
      setStatus('Perfil eliminado.')
      void load()
    } catch (err) { setStatus(`Error: ${err}`) }
  }

  const handleOpen = async (name?: string) => {
    const n = name ?? selected
    if (!n) return
    try {
      await openProfile(n)
      setStatus(`Abriendo '${n}'...`)
      setTimeout(() => void load(), 1500)
    } catch (err) { setStatus(`Error: ${err}`) }
  }

  const handleAvatarClick = () => { if (selected) fileInputRef.current?.click() }

  const handleAvatarFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file || !selected) return
    try {
      await uploadAvatar(selected, file)
      setAvatarVersion(v => v + 1)   // única razón legítima para volver a pedir las imágenes
      setStatus('Avatar actualizado.')
      void load()
    } catch (err) { setStatus(`Error subiendo avatar: ${err}`) }
    e.target.value = ''
  }

  const cancelClone = () => abortRef.current?.abort()

  const selectedProfile = profiles.find(p => p.name === selected)
  const profileNameDirty = !!selected && profileNameDraft.trim() !== selected
  const profileDirty = metaDirty || profileNameDirty

  const fmtDate = (iso: string) => {
    if (!iso) return '—'
    try {
      return new Date(iso).toLocaleDateString('es-ES', {
        day: '2-digit', month: 'short', year: 'numeric',
        hour: '2-digit', minute: '2-digit',
      })
    } catch { return iso }
  }

  // ── Estilos compartidos del panel de detalle ───────────────────────────
  const fieldBase: React.CSSProperties = {
    background: 'rgba(192, 141, 79, 0.04)',
    border: '1px solid rgba(192, 141, 79, 0.18)',
    borderRadius: 4,
    color: 'var(--n-txt)',
    fontFamily: "var(--n-mono)",
    fontSize: 12,
    padding: '5px 8px',
    letterSpacing: '0.04em',
  }
  const fieldView: React.CSSProperties = { ...fieldBase, lineHeight: 1.5, whiteSpace: 'pre-wrap', minHeight: 28 }

  return (
    <>
      <div className="page-content" style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <div className="page-title">{t('profiles.title')}</div>
        <div className="page-subtitle">{t('profiles.subtitle')}</div>

        {/* ── Firefox no detectado ── */}
        {browserReady === false && (
          <BrowserSetupPanel installing={installing} installPct={installPct} installMsg={installMsg}
            motivo={browserMotivo} onInstall={() => void handleInstall()} />
        )}

        {/* ── Comprobando ── */}
        {browserReady === null && (
          <div style={{ color: 'var(--n-txt-3)', fontSize: 12, fontFamily: "var(--n-mono)", padding: '20px 0' }}>
            {t('profiles.checking_browser')}
          </div>
        )}

        {/* ── Gestión de perfiles ── */}
        {browserReady === true && (
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minHeight: 0 }}>

            {/* Barra de acciones */}
            <div className="topbar">
              <button className="btn btn-primary" onClick={() => setShowCreate(true)}>{t('profiles.new')}</button>
              <button className="btn btn-ghost" disabled={!selected} onClick={handleAvatarClick}>{t('profiles.avatar')}</button>
              <button className="btn btn-ghost" disabled={!selected} onClick={() => void handleOpen()}>{t('profiles.open')}</button>
              <button className="btn btn-danger" disabled={!selected} onClick={() => setShowDelete(true)}>{t('profiles.delete')}</button>
              <button className="btn btn-ghost" onClick={() => void load()}>{t('profiles.refresh')}</button>
              <button className="btn btn-ghost" disabled={!selected} onClick={() => setShowSaveTemplate(true)}
                title="Copia las extensiones de este perfil a una nueva plantilla">
                {t('profiles.save_template')}
              </button>
              <button className="btn btn-ghost" onClick={() => { void loadTemplates(); setShowTemplates(true) }}
                title="Ver y gestionar plantillas disponibles">
                {t('profiles.templates')}
              </button>
              <input ref={fileInputRef} type="file" accept="image/png,image/jpeg,image/webp"
                style={{ display: 'none' }} onChange={handleAvatarFile} />
            </div>

            {/* ── Área dividida ── */}
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minHeight: 0 }}>

              {/* MITAD SUPERIOR — cuadrícula de perfiles con scroll */}
              <div style={{ flex: '0 0 auto', maxHeight: '42%', overflowY: 'auto', paddingBottom: 4 }}>
                {loading ? (
                  <div style={{ color: 'var(--n-txt-3)', fontSize: 12, fontFamily: "var(--n-mono)", padding: '20px 0' }}>
                    {t('profiles.loading')}
                  </div>
                ) : profiles.length === 0 ? (
                  <div style={{ padding: '40px 0', textAlign: 'center', color: 'var(--n-clas-sin)', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
                    <svg width="56" height="56" viewBox="0 0 56 56" fill="none" stroke="currentColor" strokeWidth="1.2" opacity="0.25">
                      <circle cx="28" cy="20" r="10"/>
                      <path d="M8 48c0-11.05 8.95-20 20-20s20 8.95 20 20"/>
                    </svg>
                    <div style={{ fontSize: 12, letterSpacing: '0.1em' }}>{t('profiles.empty')}</div>
                  </div>
                ) : (
                  <div className="profile-grid">
                    {profiles.map((p) => (
                      <ProfileTile
                        key={p.name} profile={p}
                        selected={selected === p.name}
                        avatarVersion={avatarVersion}
                        onSelect={() => setSelected(selected === p.name ? null : p.name)}
                        onOpen={() => void handleOpen(p.name)}
                      />
                    ))}
                  </div>
                )}
              </div>

              {/* Divisor */}
              <div style={{ height: 1, background: 'var(--n-linea-sutil)', flexShrink: 0, margin: '0 0 0 0' }} />

              {/* MITAD INFERIOR — panel de detalle del perfil */}
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, overflow: 'hidden' }}>

                {/* ── Cabecera: hijo directo del flex-column → ancho = 100% garantizado */}
                <div style={{ display: 'flex', alignItems: 'center', padding: '10px 0 6px', flexShrink: 0 }}>
                  {!selected ? (
                    <>
                      <svg width="20" height="20" viewBox="0 0 28 28" fill="none" stroke="currentColor" strokeWidth="1" opacity="0.2" style={{ marginRight: 8 }}>
                        <circle cx="14" cy="10" r="5"/><path d="M4 24c0-5.52 4.48-10 10-10s10 4.48 10 10"/>
                      </svg>
                      <div style={{ color: 'var(--n-txt-3)', fontSize: 9, fontFamily: "var(--n-mono)", letterSpacing: '0.2em' }}>
                        {t('profiles.select')}
                      </div>
                    </>
                  ) : (
                    <>
                      {editing ? (
                        <input
                          className="input"
                          value={profileNameDraft}
                          onChange={(e) => setProfileNameDraft(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') void handleMetaSave()
                            if (e.key === 'Escape') {
                              setProfileNameDraft(selected)
                              setMetaDraft(meta)
                              setMetaDirty(false)
                              setEditing(false)
                            }
                          }}
                          style={{
                            width: 220,
                            height: 28,
                            fontSize: 14,
                            color: 'var(--n-brillo)',
                            fontFamily: "var(--n-mono)",
                            letterSpacing: '0.08em',
                          }}
                        />
                      ) : (
                        <div style={{ fontSize: 14, color: 'var(--n-brillo)', fontFamily: "var(--n-mono)", letterSpacing: '0.12em' }}>
                          {selected}
                        </div>
                      )}
                      {selectedProfile?.running && (
                        <div style={{ fontSize: 9, color: 'var(--n-brillo)', fontFamily: "var(--n-mono)", letterSpacing: '0.15em', opacity: 0.75, marginLeft: 8 }}>
                          ● {t('common.active')}
                        </div>
                      )}
                      {editing ? (
                        <div style={{ display: 'flex', gap: 8, marginLeft: 16 }}>
                          <button className="btn btn-ghost" style={{ fontSize: 10, padding: '3px 14px', letterSpacing: '0.06em' }}
                            onClick={() => { setProfileNameDraft(selected); setMetaDraft(meta); setMetaDirty(false); setEditing(false) }}>
                            {t('profiles.cancel')}
                          </button>
                          <button className="btn btn-primary" style={{ fontSize: 10, padding: '3px 14px', letterSpacing: '0.06em' }}
                            onClick={() => void handleMetaSave()} disabled={!profileDirty || !profileNameDraft.trim() || metaSaving}>
                            {metaSaving ? '...' : t('profiles.save')}
                          </button>
                        </div>
                      ) : (
                        <button className="btn btn-ghost" style={{ fontSize: 10, padding: '3px 14px', letterSpacing: '0.08em', marginLeft: 16 }}
                          title={selectedProfile?.running ? t('profiles.close_before_edit') : t('profiles.edit')}
                          onClick={handleStartEdit}>
                          ✎ {t('profiles.edit_short')}
                        </button>
                      )}
                    </>
                  )}
                </div>

                {/* ── Cuerpo: columnas de campos */}
                {selected && (
                  <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, overflowY: 'auto', paddingBottom: 6 }}>

                    {/* Fila superior: dos columnas */}
                    <div style={{ display: 'flex', gap: 20, flexShrink: 0 }}>

                    {/* Izquierda — datos de identidad */}
                    <div style={{ flex: '0 0 155px', display: 'flex', flexDirection: 'column', gap: 12 }}>
                      <div>
                        <FL>{t('profiles.category')}</FL>
                        {editing ? (
                          <CustomSelect
                            value={metaDraft.category}
                            baseStyle={fieldBase}
                            options={[
                              { value: '', label: 'Sin asignar' },
                              { value: 'OSINT', label: 'OSINT' },
                              { value: 'SOCMINT', label: 'SOCMINT' },
                              { value: 'V.HUMINT', label: 'V.HUMINT' },
                              { value: 'OTROS', label: 'OTROS' },
                            ]}
                            onChange={v => patchMeta({ category: v })}
                          />
                        ) : (
                          <div style={{ ...fieldView, color: metaDraft.category ? 'var(--n-brillo)' : 'var(--n-txt-3)', letterSpacing: '0.1em' }}>
                            {metaDraft.category || '—'}
                          </div>
                        )}
                      </div>
                      <div>
                        <FL>{t('profiles.created')}</FL>
                        <div style={{ ...fieldView, color: 'var(--n-txt-3)', fontSize: 11 }}>
                          {fmtDate(selectedProfile?.created_at ?? '')}
                        </div>
                      </div>
                      <div>
                        <FL>{t('profiles.state')}</FL>
                        <div style={{ ...fieldView, letterSpacing: '0.1em', color: selectedProfile?.running ? 'var(--n-brillo)' : 'var(--n-txt-3)' }}>
                          {selectedProfile?.running ? `● ${t('common.active')}` : `○ ${t('common.inactive')}`}
                        </div>
                      </div>
                    </div>

                    {/* Centro — campos de texto */}
                    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 10 }}>

                      {/* DESCRIPCIÓN */}
                      <div style={{ display: 'flex', flexDirection: 'column' }}>
                        <FL>{t('profiles.description')}</FL>
                        <div
                          style={{ ...fieldView, maxHeight: 52, overflow: 'hidden', cursor: 'pointer', color: metaDraft.description ? 'var(--n-txt)' : 'var(--n-txt-3)' }}
                          onClick={() => setExpandedField('description')}
                          title="Clic para ampliar"
                        >
                          {metaDraft.description || (editing ? 'Objetivo y alcance de este perfil...' : '—')}
                        </div>
                      </div>

                      {/* NOTAS OPERATIVAS */}
                      <div style={{ display: 'flex', flexDirection: 'column' }}>
                        <FL>{t('profiles.notes')}</FL>
                        <div
                          style={{ ...fieldView, maxHeight: 52, overflow: 'hidden', cursor: 'pointer', color: metaDraft.notes ? 'var(--n-txt)' : 'var(--n-txt-3)' }}
                          onClick={() => setExpandedField('notes')}
                          title="Clic para ampliar"
                        >
                          {metaDraft.notes || (editing ? 'Observaciones y anotaciones operativas...' : '—')}
                        </div>
                      </div>

                      {/* CREDENCIALES */}
                      <div style={{ display: 'flex', flexDirection: 'column' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                          <div style={{ fontSize: 9, letterSpacing: '0.2em', color: 'var(--n-txt-3)', fontFamily: "var(--n-mono)", display: 'flex', alignItems: 'center', gap: 5 }}>
                            <svg width="9" height="11" viewBox="0 0 9 11" fill="none" stroke="currentColor" strokeWidth="1.2" opacity="0.6">
                              <rect x="1" y="5" width="7" height="5.5" rx="1"/>
                              <path d="M2.5 5V3.5a2 2 0 0 1 4 0V5"/>
                            </svg>
                            {t('profiles.credentials')}
                          </div>
                          {!editing && (
                            <button className="btn btn-ghost"
                              style={{ fontSize: 9, padding: '1px 8px', letterSpacing: '0.1em', display: 'flex', alignItems: 'center', gap: 4 }}
                              onClick={() => setShowCreds(v => !v)}>
                              {showCreds
                                ? <><svg width="10" height="7" viewBox="0 0 10 7" fill="none" stroke="currentColor" strokeWidth="1.2"><path d="M1 3.5C2 1.5 3.5.5 5 .5s3 1 4 3c-1 2-2.5 3-4 3S2 5.5 1 3.5Z"/><circle cx="5" cy="3.5" r="1.2"/><line x1="1" y1="6.5" x2="9" y2=".5"/></svg>{t('profiles.hide')}</>
                                : <><svg width="10" height="7" viewBox="0 0 10 7" fill="none" stroke="currentColor" strokeWidth="1.2"><path d="M1 3.5C2 1.5 3.5.5 5 .5s3 1 4 3c-1 2-2.5 3-4 3S2 5.5 1 3.5Z"/><circle cx="5" cy="3.5" r="1.2"/></svg>{t('profiles.show')}</>
                              }
                            </button>
                          )}
                        </div>
                        <div
                          style={{ ...fieldView, position: 'relative', minHeight: 48, maxHeight: 48, overflow: 'hidden', borderColor: 'rgba(192, 141, 79, 0.28)', background: 'rgba(192, 141, 79, 0.06)', cursor: 'pointer' }}
                          onClick={() => setExpandedField('credentials')}
                          title="Clic para ampliar"
                        >
                          {metaDraft.credentials ? (
                            <div style={{ filter: showCreds ? 'none' : 'blur(5px)', userSelect: showCreds ? 'text' : 'none', transition: 'filter 0.25s ease', color: 'var(--n-txt)' }}>
                              {metaDraft.credentials}
                            </div>
                          ) : (
                            <div style={{ color: 'var(--n-txt-3)' }}>{editing ? 'usuario: ...' : '—'}</div>
                          )}
                          {!showCreds && !editing && metaDraft.credentials && (
                            <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 4 }}>
                              <svg width="14" height="18" viewBox="0 0 16 20" fill="none" stroke="currentColor" strokeWidth="1.3" opacity="0.35">
                                <rect x="1" y="9" width="14" height="10" rx="2"/>
                                <path d="M4 9V6a4 4 0 0 1 8 0v3"/>
                              </svg>
                              <div style={{ fontSize: 8, letterSpacing: '0.2em', color: 'var(--n-txt-3)', fontFamily: "var(--n-mono)" }}>{t('profiles.protected')}</div>
                            </div>
                          )}
                        </div>
                      </div>

                    </div>
                    </div>

                    {/* SERVICIOS ACTIVOS */}
                    <div style={{ flexShrink: 0, marginTop: 12 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                        <FL>{t('profiles.active_services')}</FL>
                        {editing && (
                          <button className="btn btn-ghost"
                            style={{ fontSize: 9, padding: '1px 8px', letterSpacing: '0.1em', marginBottom: 4 }}
                            onClick={() => setShowServices(true)}>
                            {t('profiles.manage')}
                          </button>
                        )}
                      </div>
                      {(metaDraft.services ?? []).length === 0 ? (
                        <div style={{ ...fieldView, color: 'var(--n-txt-3)' }}>—</div>
                      ) : (
                        <div style={{
                          display: 'flex', flexWrap: 'wrap', gap: 5, padding: '5px 8px',
                          background: 'rgba(192, 141, 79, 0.04)', border: '1px solid rgba(192, 141, 79, 0.18)', borderRadius: 4,
                        }}>
                          {(metaDraft.services ?? []).map(id => {
                            const svc = SERVICES.find(s => s.id === id)
                            if (!svc) return null
                            return (
                              <div key={id} title={svc.label} style={{
                                width: 22, height: 22, borderRadius: 5,
                                background: svc.bg,
                                border: `1px solid ${svc.color}55`,
                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                                color: svc.color, fontSize: 9,
                                fontFamily: "var(--n-mono)", fontWeight: 700, cursor: 'default',
                              }}>
                                {svc.init}
                              </div>
                            )
                          })}
                        </div>
                      )}
                    </div>

                    {/* USER AGENT */}
                    <div style={{ flexShrink: 0, marginTop: 10 }}>
                      <FL>USER AGENT</FL>
                      <div style={{ ...fieldView, fontSize: 10, color: metaDraft.user_agent ? 'var(--n-txt-3)' : 'var(--n-clas-sin)', wordBreak: 'break-all', lineHeight: 1.4 }}>
                        {metaDraft.user_agent || t('profiles.unused')}
                      </div>
                    </div>

                    {/* ÚLTIMA IP DETECTADA */}
                    <div style={{ flexShrink: 0, marginTop: 10 }}>
                      <FL>{t('profiles.last_ip')}</FL>
                      {metaDraft.last_ip ? (
                        <div style={{ ...fieldView, display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 6 }}>
                          <span style={{ color: 'var(--n-brillo)', fontFamily: "var(--n-mono)", fontSize: 12 }}>
                            {metaDraft.last_ip}
                          </span>
                          {metaDraft.last_ip_vpn && (
                            <span style={{
                              fontSize: 8, color: '#A98BE0', background: 'rgba(169, 139, 224, 0.15)',
                              border: '1px solid rgba(169, 139, 224, 0.35)', borderRadius: 3,
                              padding: '1px 5px', letterSpacing: '0.12em',
                              fontFamily: "var(--n-mono)",
                            }}>VPN/PROXY</span>
                          )}
                          <span style={{ fontSize: 10, color: 'var(--n-txt-3)', fontFamily: "var(--n-mono)" }}>
                            {[metaDraft.last_ip_isp, metaDraft.last_ip_country].filter(Boolean).join(' · ')}
                          </span>
                        </div>
                      ) : (
                        <div style={{ ...fieldView, color: 'var(--n-clas-sin)' }}>{t('profiles.unused')}</div>
                      )}
                    </div>

                  </div>
                )}
              </div>
            </div>

          </div>
        )}
      </div>

      {/* Barra de estado */}
      <div className="status-bar">
        <div className="status-dot" />
        <span>{status || conteo || t('profiles.ready')}</span>
      </div>

      {/* Modales */}
      {browserReady === true && showCreate && (
        <CreateModal templates={templates} onConfirm={(name, tpl) => void handleCreate(name, tpl)} onCancel={() => setShowCreate(false)} />
      )}
      {cloning && (
        <ProgressModal name={cloning.name} pct={cloning.pct} message={cloning.message} onCancel={cancelClone} />
      )}
      {browserReady === true && showDelete && selected && (
        <ConfirmDeleteModal name={selected} onConfirm={() => void handleDelete()} onCancel={() => setShowDelete(false)} />
      )}
      {browserReady === true && showSaveTemplate && selected && (
        <SaveTemplateModal profileName={selected} onConfirm={(tplName) => void handleSaveTemplate(tplName)} onCancel={() => setShowSaveTemplate(false)} />
      )}
      {showTemplates && (
        <TemplatesModal templates={templates} onDelete={(name) => void handleDeleteTemplate(name)} onClose={() => setShowTemplates(false)} />
      )}
      {showServices && editing && (
        <ServicesModal
          selected={metaDraft.services ?? []}
          onApply={services => patchMeta({ services })}
          onClose={() => setShowServices(false)}
        />
      )}
      {expandedField === 'description' && (
        <FieldExpandModal
          title={t('profiles.description')}
          value={metaDraft.description}
          editing={editing}
          placeholder="Objetivo y alcance de este perfil..."
          onChange={v => patchMeta({ description: v })}
          onClose={() => setExpandedField(null)}
        />
      )}
      {expandedField === 'notes' && (
        <FieldExpandModal
          title={t('profiles.notes')}
          value={metaDraft.notes}
          editing={editing}
          placeholder="Observaciones y anotaciones operativas..."
          onChange={v => patchMeta({ notes: v })}
          onClose={() => setExpandedField(null)}
        />
      )}
      {expandedField === 'credentials' && (
        <FieldExpandModal
          title={t('profiles.credentials')}
          value={metaDraft.credentials}
          editing={editing}
          obscure={!showCreds}
          placeholder={'usuario:      ...\ncontraseña:   ...\nurl:          ...\nnotas:        ...'}
          onChange={v => patchMeta({ credentials: v })}
          onClose={() => setExpandedField(null)}
        />
      )}
    </>
  )
}

export default ProfilesPage
