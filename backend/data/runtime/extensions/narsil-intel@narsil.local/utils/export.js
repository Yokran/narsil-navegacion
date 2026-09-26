// NARSIL Intel Collector — utils/export.js
'use strict'

var NarsilExport = {

  toJSON: function (items) {
    return JSON.stringify(items, null, 2)
  },

  toCSV: function (items) {
    if (!items.length) return ''
    var allKeys = NarsilExport._keys(items)
    function esc(v) {
      if (v === null || v === undefined) return ''
      var s = typeof v === 'object' ? JSON.stringify(v) : String(v)
      return (s.includes(',') || s.includes('"') || s.includes('\n') || s.includes('\r'))
        ? '"' + s.replace(/"/g, '""') + '"' : s
    }
    var rows = [allKeys.join(',')]
    items.forEach(function (item) { rows.push(allKeys.map(function (k) { return esc(item[k]) }).join(',')) })
    return '﻿' + rows.join('\n') // BOM for Excel UTF-8 compatibility
  },

  // Excel-compatible HTML table — opens correctly in LibreOffice and Excel
  toXLS: function (items) {
    if (!items.length) return ''
    var allKeys = NarsilExport._keys(items)
    function escHtml(v) {
      if (v === null || v === undefined) return ''
      var s = typeof v === 'object' ? JSON.stringify(v) : String(v)
      return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    }
    var h = '<html xmlns:o="urn:schemas-microsoft-com:office:office"'
          + ' xmlns:x="urn:schemas-microsoft-com:office:excel"'
          + ' xmlns="http://www.w3.org/TR/REC-html40"><head>'
          + '<meta charset="UTF-8">'
          + '<!--[if gte mso 9]><xml><x:ExcelWorkbook><x:ExcelWorksheets>'
          + '<x:ExcelWorksheet><x:Name>NARSIL Intelligence Collector</x:Name>'
          + '<x:WorksheetOptions><x:DisplayGridlines/></x:WorksheetOptions>'
          + '</x:ExcelWorksheet></x:ExcelWorksheets></x:ExcelWorkbook></xml><![endif]-->'
          + '<style>th{background:#141B2E;color:#C08D4F;font-family:monospace}'
          + 'td{font-family:monospace;font-size:11px}tr:nth-child(even){background:#f0fafa}</style>'
          + '</head><body><table border="1" cellspacing="0" cellpadding="3"><tr>'
    allKeys.forEach(function (k) { h += '<th>' + escHtml(k) + '</th>' })
    h += '</tr>'
    items.forEach(function (item) {
      h += '<tr>'
      allKeys.forEach(function (k) { h += '<td>' + escHtml(item[k]) + '</td>' })
      h += '</tr>'
    })
    h += '</table></body></html>'
    return h
  },

  // Human-readable plain text — best for single profile records
  toTXT: function (items) {
    if (!items.length) return ''
    var lines = ['═══════════════════════════════════════', 'NARSIL Intelligence Collector — ' + new Date().toISOString(), '═══════════════════════════════════════', '']
    items.forEach(function (item, idx) {
      if (idx > 0) lines.push('───────────────────────────────────────')
      Object.keys(item).forEach(function (k) {
        var v = item[k]
        if (v === null || v === undefined || v === '') return
        if (Array.isArray(v) && !v.length) return
        var label = k.replace(/_/g, ' ').toUpperCase()
        var val   = typeof v === 'object' ? JSON.stringify(v, null, 2) : String(v)
        // indent multi-line values
        val = val.split('\n').join('\n    ')
        lines.push(label + ': ' + val)
      })
    })
    return lines.join('\n')
  },

  download: function (items, network, format) {
    format = format || 'json'
    if (!items || !items.length) return
    var ts  = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
    var ext = format === 'csv' ? 'csv' : format === 'xls' ? 'xls' : format === 'txt' ? 'txt' : 'json'
    var filename = 'NARSIL_' + network.toUpperCase() + '_' + ts + '.' + ext
    var content, mimeType
    if (format === 'csv')      { content = NarsilExport.toCSV(items);  mimeType = 'text/csv;charset=utf-8;' }
    else if (format === 'xls') { content = NarsilExport.toXLS(items);  mimeType = 'application/vnd.ms-excel' }
    else if (format === 'txt') { content = NarsilExport.toTXT(items);  mimeType = 'text/plain;charset=utf-8' }
    else                       { content = NarsilExport.toJSON(items); mimeType = 'application/json' }
    browser.runtime.sendMessage({ type: 'DOWNLOAD', filename: filename, content: content, mimeType: mimeType })
  },

  _keys: function (items) {
    var keys = []
    items.forEach(function (item) {
      Object.keys(item).forEach(function (k) { if (!keys.includes(k)) keys.push(k) })
    })
    return keys
  },

  // ── Wrapper para celdas "no visibles en el perfil" ────────────────────────
  // Devuelve un objeto sentinela que toXLSX renderiza con estilo rojo cursiva.
  // Uso:  rows.push({ Username: NarsilExport.missing() })
  //       rows.push({ Region:   NarsilExport.missing('no detectada') })
  missing: function (text) {
    return { __narsilMissing: true, value: text || 'no visible en el perfil' }
  },

  // ── XLSX real (.xlsx) ───────────────────────────────────────────────────────
  // El formato XLSX es un ZIP con archivos XML dentro. Generamos los 6 archivos
  // (Content_Types, .rels, workbook, workbook.rels, sheet1, styles) y los empaquetamos
  // en un ZIP "stored" (sin compresión). Excel/LibreOffice lo abren sin avisos.
  // Devuelve Uint8Array (binario).
  // Las celdas que sean { __narsilMissing: true, value: '...' } se pintan en rojo cursiva.
  toXLSX: function (items) {
    if (!items || !items.length) return null
    var allKeys = NarsilExport._keys(items)

    function xmlEsc(v) {
      if (v == null) return ''
      return String(v)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
        .replace(/[\x00-\x08\x0B-\x0C\x0E-\x1F]/g, '')
    }
    function colName(n) {
      var s = ''
      while (n > 0) { var r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = Math.floor((n - 1) / 26) }
      return s
    }
    // Resuelve una celda a { text, styleIdx }. styleIdx 0 = normal, 1 = rojo cursiva.
    function resolve(val) {
      if (val && typeof val === 'object' && val.__narsilMissing) {
        return { text: val.value || 'no visible en el perfil', styleIdx: 1 }
      }
      return { text: val, styleIdx: 0 }
    }

    // Filas: cabecera + datos
    var rows = [allKeys]
    items.forEach(function (it) { rows.push(allKeys.map(function (k) { return it[k] })) })

    var rowsXml = rows.map(function (row, ri) {
      var cells = row.map(function (val, ci) {
        // La fila de cabecera (ri=0) siempre va en estilo normal
        var c = ri === 0 ? { text: val, styleIdx: 0 } : resolve(val)
        var s = c.styleIdx ? ' s="' + c.styleIdx + '"' : ''
        return '<c r="' + colName(ci + 1) + (ri + 1) + '"' + s + ' t="inlineStr"><is><t>' + xmlEsc(c.text) + '</t></is></c>'
      }).join('')
      return '<row r="' + (ri + 1) + '">' + cells + '</row>'
    }).join('')

    var sheetXml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
      '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
      '<sheetData>' + rowsXml + '</sheetData></worksheet>'

    var contentTypes = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
      '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
      '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
      '</Types>'

    var rootRels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
      '</Relationships>'

    var workbookXml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
      '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"' +
      ' xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
      '<sheets><sheet name="NARSIL Intelligence Collector" sheetId="1" r:id="rId1"/></sheets></workbook>'

    var workbookRels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>' +
      '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
      '</Relationships>'

    // Definimos 2 estilos: 0=normal, 1=rojo cursiva (FFC00000 = rojo oscuro)
    var stylesXml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
      '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
      '<fonts count="2">' +
        '<font><sz val="11"/><name val="Calibri"/><family val="2"/></font>' +
        '<font><sz val="11"/><color rgb="FFC00000"/><name val="Calibri"/><family val="2"/><i/></font>' +
      '</fonts>' +
      '<fills count="1"><fill><patternFill patternType="none"/></fill></fills>' +
      '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>' +
      '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
      '<cellXfs count="2">' +
        '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +
        '<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>' +
      '</cellXfs>' +
      '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>' +
      '<dxfs count="0"/>' +
      '<tableStyles count="0" defaultTableStyle="TableStyleMedium2" defaultPivotStyle="PivotStyleLight16"/>' +
      '</styleSheet>'

    return NarsilExport._zip([
      { name: '[Content_Types].xml',        data: contentTypes },
      { name: '_rels/.rels',                data: rootRels     },
      { name: 'xl/workbook.xml',            data: workbookXml  },
      { name: 'xl/_rels/workbook.xml.rels', data: workbookRels },
      { name: 'xl/styles.xml',              data: stylesXml    },
      { name: 'xl/worksheets/sheet1.xml',   data: sheetXml     },
    ])
  },

  // CRC-32 estándar (polinomio 0xedb88320, formato ZIP)
  _crc32Table: (function () {
    var t = new Uint32Array(256)
    for (var n = 0; n < 256; n++) {
      var c = n
      for (var k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1)
      t[n] = c >>> 0
    }
    return t
  })(),
  _crc32: function (bytes) {
    var crc = 0xffffffff, t = NarsilExport._crc32Table
    for (var i = 0; i < bytes.length; i++) crc = t[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8)
    return (crc ^ 0xffffffff) >>> 0
  },

  // Empaqueta un array de {name, data} en un ZIP "stored" (sin compresión).
  _zip: function (files) {
    var enc     = new TextEncoder()
    var entries = []
    var offset  = 0
    files.forEach(function (f) {
      var nameBytes = enc.encode(f.name)
      var dataBytes = enc.encode(f.data)
      var crc       = NarsilExport._crc32(dataBytes)
      var local     = new Uint8Array(30 + nameBytes.length + dataBytes.length)
      var lv        = new DataView(local.buffer)
      lv.setUint32(0,  0x04034b50, true)         // signature
      lv.setUint16(4,  20, true)                  // version needed
      lv.setUint16(6,  0x0800, true)              // flags: UTF-8 filename
      lv.setUint16(8,  0, true)                   // method: stored
      lv.setUint16(10, 0, true)                   // mod time
      lv.setUint16(12, 0x21, true)                // mod date (1980-01-01)
      lv.setUint32(14, crc, true)
      lv.setUint32(18, dataBytes.length, true)
      lv.setUint32(22, dataBytes.length, true)
      lv.setUint16(26, nameBytes.length, true)
      lv.setUint16(28, 0, true)
      local.set(nameBytes, 30)
      local.set(dataBytes, 30 + nameBytes.length)
      entries.push({ local: local, name: nameBytes, crc: crc, size: dataBytes.length, offset: offset })
      offset += local.length
    })
    var cdParts = [], cdSize = 0
    entries.forEach(function (e) {
      var cd = new Uint8Array(46 + e.name.length)
      var v  = new DataView(cd.buffer)
      v.setUint32(0,  0x02014b50, true)
      v.setUint16(4,  20, true); v.setUint16(6,  20, true)
      v.setUint16(8,  0x0800, true); v.setUint16(10, 0, true)
      v.setUint16(12, 0, true); v.setUint16(14, 0x21, true)
      v.setUint32(16, e.crc, true); v.setUint32(20, e.size, true); v.setUint32(24, e.size, true)
      v.setUint16(28, e.name.length, true)
      v.setUint16(30, 0, true); v.setUint16(32, 0, true); v.setUint16(34, 0, true)
      v.setUint16(36, 0, true); v.setUint32(38, 0, true)
      v.setUint32(42, e.offset, true)
      cd.set(e.name, 46)
      cdParts.push(cd); cdSize += cd.length
    })
    var eocd = new Uint8Array(22), ev = new DataView(eocd.buffer)
    ev.setUint32(0,  0x06054b50, true)
    ev.setUint16(4,  0, true); ev.setUint16(6,  0, true)
    ev.setUint16(8,  entries.length, true); ev.setUint16(10, entries.length, true)
    ev.setUint32(12, cdSize, true); ev.setUint32(16, offset, true); ev.setUint16(20, 0, true)

    var total = offset + cdSize + 22
    var out   = new Uint8Array(total)
    var pos   = 0
    entries.forEach(function (e) { out.set(e.local, pos); pos += e.local.length })
    cdParts.forEach(function (p) { out.set(p, pos); pos += p.length })
    out.set(eocd, pos)
    return out
  },

  // Convierte Uint8Array a base64 (para enviar binario por browser.runtime.sendMessage)
  uint8ToBase64: function (bytes) {
    var s = ''
    for (var i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i])
    return btoa(s)
  },
}
