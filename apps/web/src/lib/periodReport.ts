import { format } from 'date-fns'
import { es } from 'date-fns/locale'

/** Everything the period report needs, already worked out by the app: the PDF only lays it out. */
export interface PeriodReportData {
  userName: string
  generatedAt: Date
  /** First day and last day (inclusive) of the salary period. */
  start: Date
  end: Date
  salary: number
  /** Money that came in on top of the salary. */
  extras: { concept: string; date: Date; amount: number }[]
  extraTotal: number
  /** What the previous period left (positive) or lacked (negative). */
  carryIn: number
  available: number
  totals: { fixed: number; additional: number; occasional: number; reserved: number }
  remaining: number
  fixed: { concept: string; category: string; due: Date | null; amount: number; state: 'Pagado' | 'Por pagar' | 'Vencido'; paidOn: Date | null }[]
  additional: { concept: string; category: string; date: Date; amount: number; account: string }[]
  occasional: { concept: string; date: Date; amount: number }[]
  accounts: { name: string; balance: number }[]
}

// jsPDF's built-in fonts only know Latin-1: keep to characters they can draw
const clean = (t: string) => t.replace(/…/g, '...').replace(/[−–—]/g, '-').replace(/[“”]/g, '"').replace(/[‘’]/g, "'").replace(/[^\x09\x0A\x0D\x20-\xFF]/g, '')
const cop = (n: number) => `${n < 0 ? '-' : ''}$ ${Math.abs(Math.round(n)).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.')}`
const day = (d: Date) => format(d, "d 'de' MMM", { locale: es })
const dayYear = (d: Date) => format(d, "d 'de' MMMM 'de' yyyy", { locale: es })
const pct = (part: number, whole: number) => (whole > 0 ? `${(Math.round((part / whole) * 1000) / 10).toString().replace('.', ',')}%` : '0%')

// The app's palette for the four destinations of the money
const COLORS = {
  fixed: [57, 135, 229] as [number, number, number],
  additional: [217, 89, 38] as [number, number, number],
  occasional: [143, 111, 224] as [number, number, number],
  reserved: [201, 133, 0] as [number, number, number],
  left: [25, 158, 112] as [number, number, number],
}
const INK = [24, 39, 52] as [number, number, number]
const MUTED = [100, 116, 130] as [number, number, number]
const BRAND = [10, 31, 47] as [number, number, number]
const ACCENT = [82, 182, 154] as [number, number, number]

/** Builds the report and returns the PDF file. */
export async function buildPeriodReport(d: PeriodReportData): Promise<Blob> {
  const { jsPDF } = await import('jspdf')
  const autoTable = (await import('jspdf-autotable')).default
  const doc = new jsPDF({ unit: 'pt', format: 'a4' })
  const W = doc.internal.pageSize.getWidth()
  const H = doc.internal.pageSize.getHeight()
  const M = 42
  const CW = W - M * 2
  let y = 0

  const used = d.totals.fixed + d.totals.additional + d.totals.occasional + d.totals.reserved
  const periodName = `${day(d.start)} al ${day(d.end)}`

  const ensure = (needed: number) => {
    if (y + needed > H - 60) { doc.addPage(); y = M }
  }
  const text = (t: string, x: number, size: number, color: [number, number, number], style: 'normal' | 'bold' = 'normal') => {
    doc.setFont('helvetica', style); doc.setFontSize(size); doc.setTextColor(...color); doc.text(clean(t), x, y)
  }
  const paragraph = (t: string, size = 10, color = INK) => {
    doc.setFont('helvetica', 'normal'); doc.setFontSize(size); doc.setTextColor(...color)
    const lines = doc.splitTextToSize(clean(t), CW) as string[]
    ensure(lines.length * (size + 4) + 4)
    lines.forEach((l) => { doc.text(l, M, y); y += size + 4 })
    y += 4
  }
  const heading = (n: number, title: string, intro?: string) => {
    ensure(70)
    y += 10
    doc.setFillColor(...ACCENT); doc.rect(M, y - 12, 4, 16, 'F')
    text(`${n}. ${title}`, M + 12, 14, BRAND, 'bold')
    y += 20
    if (intro) paragraph(intro, 10, MUTED)
  }
  const after = () => ((doc as any).lastAutoTable?.finalY ?? y) + 14
  const tableStyle = {
    styles: { font: 'helvetica', fontSize: 9, textColor: INK, cellPadding: 5, lineColor: [226, 232, 240] as [number, number, number], lineWidth: 0.4 },
    headStyles: { fillColor: BRAND, textColor: [255, 255, 255] as [number, number, number], fontStyle: 'bold' as const },
    alternateRowStyles: { fillColor: [246, 249, 251] as [number, number, number] },
    margin: { left: M, right: M },
  }

  // ── Cover band ────────────────────────────────────────────────────────────
  doc.setFillColor(...BRAND); doc.rect(0, 0, W, 118, 'F')
  doc.setFillColor(...ACCENT); doc.rect(0, 118, W, 4, 'F')
  y = 46; text('GASTOS HOGAR', M, 10, ACCENT, 'bold')
  y = 72; text('Reporte del período de sueldo', M, 24, [255, 255, 255], 'bold')
  y = 96; text(`${dayYear(d.start)}  al  ${dayYear(d.end)}`, M, 12, [203, 213, 225])
  y = 146
  text(`Preparado para ${d.userName}`, M, 10, MUTED)
  text(`Generado el ${dayYear(d.generatedAt)}`, W - M - doc.getTextWidth(clean(`Generado el ${dayYear(d.generatedAt)}`)), 10, MUTED)
  y += 22

  // ── 1. Resumen ────────────────────────────────────────────────────────────
  heading(1, 'Resumen del período', 'Este es el panorama general: cuánto dinero tuviste disponible, a dónde se fue y cuánto te quedó.')
  const story: string[] = [
    `Entre el ${day(d.start)} y el ${day(d.end)} recibiste ${cop(d.salary)} de sueldo` +
      (d.extraTotal > 0 ? ` y ${cop(d.extraTotal)} de ingresos adicionales` : '') +
      (d.carryIn > 0 ? `, y venías con un sobrante de ${cop(d.carryIn)} del período anterior` : d.carryIn < 0 ? `, y venías con un faltante de ${cop(-d.carryIn)} del período anterior` : '') +
      `. En total tuviste ${cop(d.available)} disponibles.`,
    `De ese dinero se comprometieron ${cop(used)} (${pct(used, d.available)}): ${cop(d.totals.fixed)} en gastos fijos, ${cop(d.totals.additional)} en gastos adicionales, ${cop(d.totals.occasional)} en gastos ocasionales y ${cop(d.totals.reserved)} reservados para lo que aún pueda gastarse en ocasionales.`,
    d.remaining >= 0
      ? `Te quedan ${cop(d.remaining)} libres para lo que resta del período.`
      : `Los gastos superan lo disponible por ${cop(-d.remaining)}: conviene revisar qué se puede reducir o aplazar.`,
  ]
  story.forEach((s) => paragraph(s))

  // Key figures as four cards
  ensure(70)
  const cards = [
    { label: 'Disponible', value: cop(d.available), color: INK },
    { label: 'Comprometido', value: cop(used), color: INK },
    { label: d.remaining < 0 ? 'Faltante' : 'Te queda', value: cop(d.remaining), color: d.remaining < 0 ? ([185, 28, 28] as [number, number, number]) : COLORS.left },
  ]
  const cw = (CW - 20) / 3
  cards.forEach((c, i) => {
    const x = M + i * (cw + 10)
    doc.setDrawColor(226, 232, 240); doc.setFillColor(246, 249, 251); doc.roundedRect(x, y, cw, 52, 4, 4, 'FD')
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(...MUTED); doc.text(clean(c.label.toUpperCase()), x + 10, y + 17)
    doc.setFont('helvetica', 'bold'); doc.setFontSize(15); doc.setTextColor(...c.color); doc.text(clean(c.value), x + 10, y + 40)
  })
  y += 70

  // ── 2. De dónde viene y a dónde va ────────────────────────────────────────
  heading(2, 'De dónde viene y a dónde va el dinero', 'La tabla suma lo que entró y resta lo que salió. La barra muestra el reparto del dinero disponible.')
  const flow: [string, string][] = [
    ['Sueldo del período', cop(d.salary)],
    ...(d.extraTotal > 0 ? [['Ingresos adicionales', `+ ${cop(d.extraTotal)}`] as [string, string]] : []),
    ...(d.carryIn !== 0 ? [[d.carryIn > 0 ? 'Sobrante del período anterior' : 'Faltante del período anterior', `${d.carryIn > 0 ? '+' : '-'} ${cop(Math.abs(d.carryIn))}`] as [string, string]] : []),
    ['Dinero disponible', cop(d.available)],
    ['Gastos fijos', `- ${cop(d.totals.fixed)}`],
    ['Gastos adicionales', `- ${cop(d.totals.additional)}`],
    ['Gastos ocasionales', `- ${cop(d.totals.occasional)}`],
    ['Reservado para ocasionales', `- ${cop(d.totals.reserved)}`],
    [d.remaining < 0 ? 'Faltante del período' : 'Te queda', cop(d.remaining)],
  ]
  autoTable(doc, {
    ...tableStyle,
    startY: y,
    body: flow.map(([a, b]) => [clean(a), clean(b)]),
    columnStyles: { 0: { cellWidth: CW - 130 }, 1: { halign: 'right', fontStyle: 'bold' } },
    didParseCell: (h) => {
      const label = String(h.row.raw && (h.row.raw as string[])[0])
      if (/disponible|te queda|faltante del período$/i.test(label) && h.section === 'body') { h.cell.styles.fontStyle = 'bold'; h.cell.styles.fillColor = [236, 244, 247] }
    },
  })
  y = after()

  const parts = [
    { label: 'Gastos fijos', value: d.totals.fixed, color: COLORS.fixed },
    { label: 'Adicionales', value: d.totals.additional, color: COLORS.additional },
    { label: 'Ocasionales', value: d.totals.occasional, color: COLORS.occasional },
    { label: 'Reservado', value: d.totals.reserved, color: COLORS.reserved },
    { label: 'Te queda', value: Math.max(0, d.remaining), color: COLORS.left },
  ].filter((p) => p.value > 0)
  const whole = Math.max(used, d.available, 1)
  ensure(70)
  let bx = M
  parts.forEach((p) => {
    const w = (p.value / whole) * CW
    doc.setFillColor(...p.color); doc.rect(bx, y, Math.max(w, 1.5), 16, 'F')
    bx += w
  })
  y += 32
  let lx = M
  parts.forEach((p) => {
    const label = clean(`${p.label}: ${cop(p.value)} (${pct(p.value, whole)})`)
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5)
    const tw = doc.getTextWidth(label) + 18
    if (lx + tw > W - M) { lx = M; y += 14 }
    doc.setFillColor(...p.color); doc.rect(lx, y - 7, 8, 8, 'F')
    doc.setTextColor(...INK); doc.text(label, lx + 12, y)
    lx += tw + 8
  })
  y += 22

  // ── 3. Gastos fijos ───────────────────────────────────────────────────────
  heading(3, 'Gastos fijos', 'Los pagos que se repiten y que caen dentro de este período, en orden de fecha. "Por pagar" y "Vencido" aún no han salido de tu dinero.')
  if (d.fixed.length === 0) {
    paragraph('Este período no tiene gastos fijos.', 10, MUTED)
  } else {
    autoTable(doc, {
      ...tableStyle,
      startY: y,
      head: [['Fecha', 'Concepto', 'Categoría', 'Estado', 'Monto']],
      body: d.fixed.map((f) => [
        f.due ? day(f.due) : 'Sin fecha',
        clean(f.concept),
        clean(f.category),
        f.state === 'Pagado' && f.paidOn ? `Pagado el ${day(f.paidOn)}` : f.state,
        cop(f.amount),
      ]),
      columnStyles: { 0: { cellWidth: 62 }, 3: { cellWidth: 92 }, 4: { halign: 'right', cellWidth: 82, fontStyle: 'bold' } },
      didParseCell: (h) => {
        if (h.section !== 'body' || h.column.index !== 3) return
        const v = String(h.cell.raw)
        if (v.startsWith('Pagado')) h.cell.styles.textColor = [21, 128, 94]
        else if (v === 'Vencido') { h.cell.styles.textColor = [185, 28, 28]; h.cell.styles.fontStyle = 'bold' }
        else h.cell.styles.textColor = [161, 98, 7]
      },
    })
    y = after()
    const paid = d.fixed.filter((f) => f.state === 'Pagado').reduce((s, f) => s + f.amount, 0)
    paragraph(`Total de gastos fijos: ${cop(d.totals.fixed)}. Ya pagado: ${cop(paid)}. Por pagar: ${cop(Math.max(0, d.totals.fixed - paid))}.`, 10)
  }

  // ── 4. Gastos adicionales ─────────────────────────────────────────────────
  heading(4, 'Gastos adicionales', 'Lo que gastaste además de tus gastos fijos: comidas, compras, salidas… Cada uno descontó dinero de la cuenta indicada.')
  if (d.additional.length === 0) {
    paragraph('No registraste gastos adicionales en este período.', 10, MUTED)
  } else {
    autoTable(doc, {
      ...tableStyle,
      startY: y,
      head: [['Fecha', 'Descripción', 'Categoría', 'Cuenta', 'Monto']],
      body: d.additional.map((a) => [day(a.date), clean(a.concept), clean(a.category), clean(a.account || '-'), cop(a.amount)]),
      columnStyles: { 0: { cellWidth: 62 }, 4: { halign: 'right', cellWidth: 82, fontStyle: 'bold' } },
    })
    y = after()
    // where the additional money went, by category
    const byCat = new Map<string, number>()
    d.additional.forEach((a) => byCat.set(a.category, (byCat.get(a.category) ?? 0) + a.amount))
    const ranked = [...byCat.entries()].sort((a, b) => b[1] - a[1])
    paragraph(`Total de gastos adicionales: ${cop(d.totals.additional)}. Por categoría: ${ranked.map(([c, v]) => `${c} ${cop(v)} (${pct(v, d.totals.additional)})`).join('; ')}.`, 10)
  }

  // ── 5. Ocasionales y reservado ────────────────────────────────────────────
  heading(5, 'Gastos ocasionales y dinero reservado', 'Son gastos sin fecha ni valor fijo (gasolina, tarjeta…). Cada uno tiene un valor aproximado por período: lo que aún no gastas queda reservado y se libera cuando termina el período.')
  if (d.occasional.length > 0) {
    autoTable(doc, {
      ...tableStyle,
      startY: y,
      head: [['Fecha', 'Concepto', 'Monto']],
      body: d.occasional.map((o) => [day(o.date), clean(o.concept), cop(o.amount)]),
      columnStyles: { 0: { cellWidth: 62 }, 2: { halign: 'right', cellWidth: 100, fontStyle: 'bold' } },
    })
    y = after()
  }
  paragraph(`Gastado en ocasionales: ${cop(d.totals.occasional)}. Reservado todavía: ${cop(d.totals.reserved)}.`, 10)

  // ── 6. Ingresos adicionales ───────────────────────────────────────────────
  if (d.extras.length > 0) {
    heading(6, 'Ingresos adicionales', 'Dinero extra que recibiste además del sueldo y que se suma a lo disponible.')
    autoTable(doc, {
      ...tableStyle,
      startY: y,
      head: [['Fecha', 'Concepto', 'Monto']],
      body: d.extras.map((x) => [day(x.date), clean(x.concept), `+ ${cop(x.amount)}`]),
      columnStyles: { 0: { cellWidth: 62 }, 2: { halign: 'right', cellWidth: 100, fontStyle: 'bold' } },
    })
    y = after()
  }

  // ── 7. Cuentas ────────────────────────────────────────────────────────────
  if (d.accounts.length > 0) {
    heading(d.extras.length > 0 ? 7 : 6, 'Tus cuentas hoy', `Saldo de cada cuenta al ${dayYear(d.generatedAt)}. Cada ingreso, pago y gasto registrado con una cuenta sube o baja su saldo.`)
    autoTable(doc, {
      ...tableStyle,
      startY: y,
      head: [['Cuenta', 'Saldo']],
      body: [...d.accounts.map((a) => [clean(a.name), cop(a.balance)]), ['Total', cop(d.accounts.reduce((s, a) => s + a.balance, 0))]],
      columnStyles: { 1: { halign: 'right', cellWidth: 120, fontStyle: 'bold' } },
      didParseCell: (h) => { if (h.section === 'body' && String(h.row.raw && (h.row.raw as string[])[0]) === 'Total') { h.cell.styles.fontStyle = 'bold'; h.cell.styles.fillColor = [236, 244, 247] } },
    })
    y = after()
  }

  // ── Cómo leer este reporte ────────────────────────────────────────────────
  heading(d.accounts.length > 0 ? (d.extras.length > 0 ? 8 : 7) : (d.extras.length > 0 ? 7 : 6), 'Cómo leer este reporte')
  ;[
    'Período de sueldo: va de un pago de sueldo al siguiente. Pertenece al mes en que termina (el que cierra el 29 de noviembre es el período de noviembre).',
    'Disponible: sueldo + ingresos adicionales + lo que sobró (o faltó) del período anterior.',
    'Comprometido: gastos fijos + gastos adicionales + gastos ocasionales + el dinero reservado para ocasionales.',
    'Te queda: lo disponible menos lo comprometido. Si es negativo, se muestra como faltante.',
    'Por pagar y Vencido: gastos fijos del período que todavía no se han pagado; vencido significa que su fecha ya pasó.',
  ].forEach((t) => paragraph(`- ${t}`, 9.5))

  // ── Footer on every page ──────────────────────────────────────────────────
  const pages = doc.getNumberOfPages()
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i)
    doc.setDrawColor(226, 232, 240); doc.line(M, H - 40, W - M, H - 40)
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(...MUTED)
    doc.text(clean(`Gastos Hogar - Reporte del período ${periodName}`), M, H - 26)
    doc.text(`Página ${i} de ${pages}`, W - M - doc.getTextWidth(`Página ${i} de ${pages}`), H - 26)
  }

  return doc.output('blob')
}

/** Builds the report and hands it to the browser as a download. */
export async function downloadPeriodReport(d: PeriodReportData): Promise<void> {
  const blob = await buildPeriodReport(d)
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `reporte-periodo-${format(d.start, 'yyyy-MM-dd')}-a-${format(d.end, 'yyyy-MM-dd')}.pdf`
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 5000)
}
