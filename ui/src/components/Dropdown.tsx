// Desplegable de NARSIL. Sustituye a los <select> nativos: el popup del sistema
// (Fluent en Edge/Chrome sobre Windows) ignora el CSS de los <option> y deja la
// lista o el resalte ilegibles sobre el tema oscuro.
//
// Implementado sobre <Select> de Blueprint conservando la MISMA API que la
// versión artesanal previa, de modo que los ocho puntos de uso no cambian. Lo
// que se gana respecto a aquella: navegación por teclado (flechas/Enter/Escape/
// Home/End), gestión de foco, y render en un portal — la lista ya no la recorta
// el overflow del contenedor, que era el motivo de la prop `direction`.
import type { CSSProperties, FC } from 'react'
import { Button, MenuItem } from '@blueprintjs/core'
import { Select } from '@blueprintjs/select'

export interface DropdownOption { value: string; label: string }

interface Props {
  value: string
  options: DropdownOption[]
  onChange: (value: string) => void
  /** Color de acento (identidad del módulo); bronce NARSIL por defecto. */
  accentColor?: string
  /** 'up' para cajas pegadas al borde inferior (p. ej. la consola de chat). */
  direction?: 'up' | 'down'
  placeholder?: string
  title?: string
  style?: CSSProperties
  disabled?: boolean
}

/** A partir de esta cantidad de opciones el desplegable se vuelve filtrable
 *  (caso real: la lista de modelos detectados en Ollama). */
const FILTER_THRESHOLD = 8

const Dropdown: FC<Props> = ({
  value, options, onChange, accentColor = '#C08D4F', direction = 'down',
  placeholder = '—', title, style, disabled = false,
}) => {
  const current = options.find(o => o.value === value)
  const filterable = options.length >= FILTER_THRESHOLD

  return (
    <div
      title={title}
      style={{ position: 'relative', ...style, ['--narsil-accent' as string]: accentColor }}
    >
      <Select<DropdownOption>
        items={options}
        filterable={filterable}
        disabled={disabled}
        activeItem={current ?? null}
        itemPredicate={(query, item) =>
          item.label.toLowerCase().includes(query.toLowerCase())}
        itemRenderer={(item, { handleClick, handleFocus, modifiers }) =>
          modifiers.matchesPredicate ? (
            <MenuItem
              key={item.value}
              text={item.label}
              roleStructure="listoption"
              active={modifiers.active}
              selected={item.value === value}
              onClick={handleClick}
              onFocus={handleFocus}
            />
          ) : null}
        onItemSelect={(item) => onChange(item.value)}
        noResults={<MenuItem disabled text="Sin coincidencias" roleStructure="listoption" />}
        popoverProps={{
          minimal: true,
          matchTargetWidth: true,
          position: direction === 'up' ? 'top-left' : 'bottom-left',
          popoverClassName: 'narsil-dropdown-popover',
        }}
        fill
      >
        <Button
          fill
          alignText="left"
          disabled={disabled}
          endIcon={direction === 'up' ? 'caret-up' : 'caret-down'}
          text={current ? current.label : placeholder}
          style={{
            background: '#111829',
            border: `1px solid ${accentColor}40`,
            color: current ? 'var(--n-txt)' : 'var(--n-txt-3)',
            textTransform: 'none',
            letterSpacing: 0,
            fontSize: 13,
            height: 32,
          }}
        />
      </Select>
    </div>
  )
}

export default Dropdown
