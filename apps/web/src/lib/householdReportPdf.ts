import type { HouseholdReport } from '@/components/household/report'

// jsPDF's built-in fonts only know Latin-1: keep to characters they can draw
const clean = (t: string) => t.replace(/…/g, '...').replace(/[−–—]/g, '-').replace(/[“”]/g, '"').replace(/[‘’]/g, "'").replace(/[^\x09\x0A\x0D\x20-\xFF]/g, '')
const cop = (n: number) => `$ ${Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.')}`
const day = (d: Date) => d.toLocaleDateString('es-CO', { day: 'numeric', month: 'short', year: 'numeric' })
const dayShort = (d: Date) => d.toLocaleDateString('es-CO', { day: 'numeric', month: 'short' }).replace('.', '')
const NL = String.fromCharCode(10)

const INK = [24, 39, 52] as [number, number, number]
const MUTED = [100, 116, 130] as [number, number, number]
const BRAND = [10, 31, 47] as [number, number, number]
const ACCENT = [82, 182, 154] as [number, number, number]
const OWE = [201, 133, 0] as [number, number, number]
const GOOD = [25, 158, 112] as [number, number, number]
const GET = [37, 99, 235] as [number, number, number]
const SOFT = [235, 241, 245] as [number, number, number]

export interface PdfExpense { id: string; date: Date; description: string; amount: number; putBy: string }

/**
 * The household's accounts as a landscape PDF to hand to the people who ask "how much do I owe":
 *  1. one row per person — a summary cell that explains WHY, exactly who they pay (or who pays them), and their numbers;
 *  2. expense by expense: what each person's part was and what they put in;
 *  3. the expenses behind everything.
 */
export async function buildHouseholdReportPdf(r: HouseholdReport, expenses: PdfExpense[]): Promise<Blob> {
  const { jsPDF } = await import('jspdf')
  const autoTable = (await import('jspdf-autotable')).default
  const doc = new jsPDF({ unit: 'pt', format: 'a4', orientation: 'landscape' })
  const W = doc.internal.pageSize.getWidth()
  const H = doc.internal.pageSize.getHeight()
  const M = 36
  const CW = W - M * 2
  let y = 0

  // header band
  doc.setFillColor(...BRAND)
  doc.rect(0, 0, W, 70, 'F')
  doc.setFillColor(...ACCENT)
  doc.rect(0, 70, W, 3, 'F')
  doc.setTextColor(255, 255, 255)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(19)
  doc.text(clean(`Cuentas de ${r.name}`), M, 36)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(9.5)
  doc.setTextColor(190, 205, 215)
  doc.text(clean(`Generado el ${day(r.generatedAt)}  ·  ${r.expenseCount} ${r.expenseCount === 1 ? 'gasto compartido' : 'gastos compartidos'}`), M, 55)

  // the numbers that matter, in one line across the sheet
  y = 98
  const payers = r.people.filter((p) => p.position < 0).length
  const kpis: [string, string, [number, number, number], string?][] = [
    ['Total gastado', cop(r.total), INK],
    ['Falta por pagar', cop(r.toMove), r.toMove > 0 ? OWE : GOOD],
    ['Pagos necesarios', String(r.plan.length), INK],
    ['Les toca pagar', `${payers} de ${r.people.length}`, INK],
  ]
  const kw = CW / kpis.length
  kpis.forEach(([label, value, color, sub], i) => {
    const x = M + kw * i
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(...MUTED)
    doc.text(clean(label.toUpperCase()), x, y)
    doc.setFont('helvetica', 'bold'); doc.setFontSize(16); doc.setTextColor(...color)
    doc.text(clean(value), x, y + 20)
    if (sub) { doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5); doc.setTextColor(...MUTED); doc.text(clean(sub), x, y + 31) }
  })
  y += 46

  const title = (t: string, hint?: string) => {
    if (y > H - 110) { doc.addPage(); y = M }
    doc.setFont('helvetica', 'bold'); doc.setFontSize(12); doc.setTextColor(...INK)
    doc.text(clean(t), M, y)
    if (hint) { doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5); doc.setTextColor(...MUTED); doc.text(clean(hint), M, y + 12) }
    y += hint ? 20 : 12
  }
  const after = () => { y = (doc as any).lastAutoTable.finalY + 20 }

  // 1 — one row per person: WHY, who to pay, numbers
  title('Como se paga entre todos', 'Cada quien termina a mano con los menos pagos posibles. Primero quien mas debe pagar.')
  autoTable(doc, {
    startY: y, margin: { left: M, right: M },
    head: [['Persona', 'Por que', 'Tiene que pagar / Se lo pagan', 'Puso', 'Le toco', 'Ya pago', 'Recibio', 'Queda']],
    body: r.people.map((p) => [
      clean(p.name) + (p.isGuest ? NL + '(invitado)' : ''),
      clean(p.summary),
      p.position < 0
        ? p.pays.map((l) => clean(`Paga a ${l.name}: ${cop(l.amount)}`)).join(NL)
        : p.position > 0 ? p.receives.map((l) => clean(`${l.name} le paga: ${cop(l.amount)}`)).join(NL) : 'A mano',
      p.put ? cop(p.put) : '-', cop(p.share), p.paid ? cop(p.paid) : '-', p.received ? cop(p.received) : '-',
      p.position < 0 ? `Debe ${cop(-p.position)}` : p.position > 0 ? `Le deben ${cop(p.position)}` : 'A mano',
    ]),
    styles: { fontSize: 8.5, cellPadding: 5, textColor: INK, valign: 'top', lineColor: [220, 228, 234], lineWidth: 0.4 },
    headStyles: { fillColor: BRAND, textColor: 255, fontSize: 8.5 },
    alternateRowStyles: { fillColor: [248, 250, 252] },
    columnStyles: {
      0: { cellWidth: 60, fontStyle: 'bold' },
      1: { cellWidth: 225 },
      2: { cellWidth: 125 },
      3: { halign: 'right' }, 4: { halign: 'right' }, 5: { halign: 'right' }, 6: { halign: 'right' },
      7: { halign: 'right', fontStyle: 'bold', cellWidth: 70 },
    },
    // colour the last column: amber to pay, blue to receive
    didParseCell: (d: any) => {
      if (d.section !== 'body' || d.column.index !== 7) return
      const p = r.people[d.row.index]
      d.cell.styles.textColor = p.position < 0 ? OWE : p.position > 0 ? GET : GOOD
    },
    foot: [['', '', `Total a mover: ${cop(r.toMove)} en ${r.plan.length} ${r.plan.length === 1 ? 'pago' : 'pagos'}`, '', '', '', '', '']],
    footStyles: { fillColor: SOFT, textColor: INK, fontStyle: 'bold' },
  })
  after()

  // 2 — expense by expense: each person's part, and what they put in
  const withLines = expenses.length > 0 && expenses.length <= 8
  if (withLines) {
    title('Detalle gasto por gasto', 'Lo que le toco a cada persona en cada gasto (y, si lo adelanto, cuanto puso).')
    autoTable(doc, {
      startY: y, margin: { left: M, right: M },
      head: [['Persona', ...expenses.map((e) => clean(`${e.description}${NL}${dayShort(e.date)} - ${cop(e.amount)}`)), 'Su parte total']],
      body: r.people.map((p) => [
        clean(p.name),
        ...expenses.map((e) => {
          const l = p.lines.find((x) => x.expenseId === e.id)
          if (!l || (l.share === 0 && l.put === 0)) return '-'
          return `${l.share > 0 ? cop(l.share) : 'no le toco'}${l.put > 0 ? `${NL}puso ${cop(l.put)}` : ''}`
        }),
        cop(p.share),
      ]),
      styles: { fontSize: 8, cellPadding: 4, textColor: INK, lineColor: [225, 232, 238], lineWidth: 0.3, halign: 'right' },
      headStyles: { fillColor: BRAND, textColor: 255, halign: 'right' },
      columnStyles: { 0: { halign: 'left', fontStyle: 'bold' }, [expenses.length + 1]: { fontStyle: 'bold' } },
    })
    after()
  }

  // 3 — the expenses behind the numbers
  if (expenses.length > 0) {
    title('Gastos registrados')
    autoTable(doc, {
      startY: y, margin: { left: M, right: M },
      head: [['Fecha', 'Gasto', 'Lo pago', 'Total']],
      body: expenses.map((e) => [day(e.date), clean(e.description), clean(e.putBy), cop(e.amount)]),
      styles: { fontSize: 8.5, cellPadding: 4, textColor: INK },
      headStyles: { fillColor: BRAND, textColor: 255 },
      columnStyles: { 3: { halign: 'right' } },
    })
    after()
  }

  if (r.unconfirmed > 0) {
    if (y > H - 60) { doc.addPage(); y = M }
    doc.setFont('helvetica', 'italic'); doc.setFontSize(8.5); doc.setTextColor(...OWE)
    doc.text(clean(`Hay ${r.unconfirmed} aporte${r.unconfirmed === 1 ? '' : 's'} por confirmar: algunas cuentas pueden cambiar cuando se confirmen.`), M, y)
  }

  // footer on every page
  const pages = doc.getNumberOfPages()
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i)
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(...MUTED)
    doc.text(clean(`${r.name}  ·  cuentas al ${day(r.generatedAt)}`), M, H - 18)
    doc.text(`${i} / ${pages}`, W - M, H - 18, { align: 'right' })
  }
  return doc.output('blob')
}
