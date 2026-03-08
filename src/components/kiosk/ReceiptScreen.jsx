import React, { useMemo, useState, useEffect, useRef } from 'react'
import { Box, Button, Typography, Paper, Divider } from '@mui/material'
import { doc as fsDoc, getDoc as fsGetDoc } from 'firebase/firestore'
import { useTransaction } from '../../contexts/TransactionContext'
import QRCode from 'react-qr-code'
import { jsPDF } from 'jspdf'

export default function ReceiptScreen() {
  const { lastTxId, lastReceiptToken, end, cart, amount, stationId, touchActivity, db, membership, redeemPoints, discountAmount, lastTransactionDiscount, lastTransactionRedeemedAmount } = useTransaction()
  const [kioskLogoUrl, setKioskLogoUrl] = useState('')
  const [serverReceipt, setServerReceipt] = useState(null)
  const [autoReturn, setAutoReturn] = useState(30)
  const [issuedAt] = useState(() => new Date())
  const invoiceRef = useRef(null)

  const receiptUrl = useMemo(() => {
    const token = lastReceiptToken ? String(lastReceiptToken) : ''
    if (!token) return ''
    const path = `/r/${encodeURIComponent(token)}`
    try {
      return new URL(path, window.location.origin).toString()
    } catch {
      return path
    }
  }, [lastReceiptToken])

  const invoiceNumber = useMemo(() => {
    const txId = lastTxId ? String(lastTxId).slice(-8).toUpperCase() : 'N/A'
    return `INV-${txId}`
  }, [lastTxId])

  // finish function (declared before effect so it's available)
  function finish() {
    end()
  }

  // auto-return countdown
  useEffect(() => {
    let t = null
    if (autoReturn > 0) {
      t = setInterval(() => setAutoReturn(s => s - 1), 1000)
    }
    if (autoReturn === 0) {
      finish()
    }
    return () => { if (t) clearInterval(t) }
  }, [autoReturn])

  // Load kiosk logo for this station if available
  useEffect(() => {
    let mounted = true
    const load = async () => {
      if (!stationId || !db) return
      try {
        const sDoc = fsDoc(db, 'stations', String(stationId))
        const snap = await fsGetDoc(sDoc)
        if (!mounted) return
        if (snap.exists()) {
          const data = snap.data() || {}
          const url = String(data.kioskLogoUrl || '').trim()
          if (url) setKioskLogoUrl(url)
        }
      } catch (e) {
        // ignore
      }
    }
    load()
    return () => { mounted = false }
  }, [stationId, db])

  // Load server-side receipt (public_receipts) to ensure totals match billed amount
  useEffect(() => {
    let mounted = true
    const load = async () => {
      if (!lastReceiptToken || !db) {
        if (mounted) setServerReceipt(null)
        return
      }
      try {
        const rRef = fsDoc(db, 'public_receipts', String(lastReceiptToken))
        const snap = await fsGetDoc(rRef)
        if (!mounted) return
        if (snap.exists()) {
          setServerReceipt(snap.data() || null)
        } else {
          setServerReceipt(null)
        }
      } catch (e) {
        console.warn('Failed to load server receipt', e)
        if (mounted) setServerReceipt(null)
      }
    }
    load()
    return () => { mounted = false }
  }, [lastReceiptToken, db])

  // print/send-email features removed for kiosk mode

  const downloadPDF = () => {
    touchActivity?.()
    try {
      const doc = new jsPDF({ unit: 'mm', format: 'a4' })
      const pageWidth = doc.internal.pageSize.getWidth()
      let y = 20

      // Header
      doc.setFontSize(20)
      doc.setFont('helvetica', 'bold')
      doc.text('NAZ Retails', 20, y)
      y += 8

      doc.setFontSize(10)
      doc.setFont('helvetica', 'normal')
      doc.setTextColor(100)
      doc.text('Self-Checkout Receipt', 20, y)
      y += 12

      // Invoice details box
      doc.setDrawColor(200)
      doc.setFillColor(248, 249, 250)
      doc.roundedRect(20, y, pageWidth - 40, 28, 2, 2, 'F')

      doc.setTextColor(100)
      doc.setFontSize(9)
      doc.text('Invoice Number', 25, y + 6)
      doc.text('Date & Time', 25, y + 18)
      doc.text('Station', pageWidth / 2 + 10, y + 6)
      doc.text('Transaction ID', pageWidth / 2 + 10, y + 18)

      doc.setTextColor(0)
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(10)
      doc.text(invoiceNumber, 25, y + 11)
      doc.text(issuedAt.toLocaleString(), 25, y + 23)
      doc.text(stationId || '—', pageWidth / 2 + 10, y + 11)
      doc.text(lastTxId ? String(lastTxId).slice(0, 20) : '—', pageWidth / 2 + 10, y + 23)

      y += 36

      // Items table header
      doc.setFillColor(33, 37, 41)
      doc.rect(20, y, pageWidth - 40, 8, 'F')
      doc.setTextColor(255)
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(9)
      doc.text('No.', 25, y + 5.5)
      doc.text('Item Description', 35, y + 5.5)
      doc.text('SKU/UID', pageWidth - 70, y + 5.5)
      doc.text('Amount', pageWidth - 35, y + 5.5, { align: 'right' })
      y += 8

      // Items
      doc.setTextColor(0)
      doc.setFont('helvetica', 'normal')
      const items = Array.isArray(cart) ? cart : []
      if (items.length === 0) {
        y += 6
        doc.setTextColor(100)
        doc.text('No items', 25, y)
        y += 6
      } else {
        items.forEach((it, idx) => {
          const rowY = y + 6
          const isEven = idx % 2 === 0
          if (isEven) {
            doc.setFillColor(248, 249, 250)
            doc.rect(20, y, pageWidth - 40, 10, 'F')
          }

          doc.setTextColor(0)
          doc.setFont('helvetica', 'normal')
          doc.setFontSize(9)
          doc.text(String(idx + 1), 25, rowY)
          doc.setFont('helvetica', 'bold')
          doc.text(String(it.name || 'Item').slice(0, 40), 35, rowY)
          doc.setFont('helvetica', 'normal')
          doc.setTextColor(100)
          doc.text(String(it.sku || it.uid || '—').slice(0, 18), pageWidth - 70, rowY)
          doc.setTextColor(0)
          doc.text(`RM ${Number(it.price || 0).toFixed(2)}`, pageWidth - 35, rowY, { align: 'right' })
          y += 10
        })
      }

      // Subtotal line (prefer server totals when available)
      y += 4
      doc.setDrawColor(200)
      doc.line(20, y, pageWidth - 20, y)
      y += 8

      const src = serverReceipt || {}
      const pdfSubtotal = Number(src.subtotalAmount ?? amount ?? 0)
      const pdfPromo = Number(src.promoDiscount ?? lastTransactionDiscount ?? 0)
      const pdfRedeemed = Number(src.redeemedAmount ?? lastTransactionRedeemedAmount ?? discountAmount ?? 0)
      const pdfTotalDiscount = Math.round(((pdfPromo + pdfRedeemed) * 100)) / 100
      const pdfTotalPaid = Number(src.totalAmount ?? ((amount || 0) - pdfTotalDiscount))

      doc.setFontSize(10)
      doc.setTextColor(100)
      doc.text('Subtotal', pageWidth - 70, y)
      doc.setTextColor(0)
      doc.setFont('helvetica', 'bold')
      doc.text(`RM ${Number(pdfSubtotal || 0).toFixed(2)}`, pageWidth - 35, y, { align: 'right' })
      y += 10

      // Discounts (promo + redeemed)
      if (pdfTotalDiscount > 0) {
        doc.setFontSize(10)
        doc.setTextColor(100)
        doc.text('Discount', pageWidth - 70, y)
        doc.setTextColor(0)
        doc.text(`- RM ${Number(pdfTotalDiscount).toFixed(2)}`, pageWidth - 35, y, { align: 'right' })
        y += 10
      }

      doc.setFillColor(33, 150, 83)
      doc.roundedRect(pageWidth - 80, y - 2, 60, 12, 2, 2, 'F')
      doc.setTextColor(255)
      doc.setFontSize(11)
      doc.text('PAID', pageWidth - 50, y + 6, { align: 'center' })

      // Show total paid on PDF (prefer server value)
      y += 6
      doc.setFontSize(12)
      doc.setTextColor(255)
      doc.setFont('helvetica', 'bold')
      doc.text(`RM ${Number(pdfTotalPaid || 0).toFixed(2)}`, pageWidth - 35, y + 6, { align: 'right' })

      y += 18

      // Footer
      doc.setTextColor(100)
      doc.setFont('helvetica', 'normal')
      doc.setFontSize(8)
      doc.text('Thank you for shopping with us!', pageWidth / 2, y, { align: 'center' })
      y += 5
      doc.text('This is a computer-generated receipt. No signature required.', pageWidth / 2, y, { align: 'center' })

      // QR code info
      y += 12
      doc.setFontSize(8)
      doc.setTextColor(100)
      doc.text('Scan this receipt online:', 20, y)
      y += 4
      doc.setTextColor(0)
      doc.setFontSize(7)
      doc.text(receiptUrl || 'N/A', 20, y)

      // Save PDF
      doc.save(`${invoiceNumber}.pdf`)
    } catch (err) {
      console.error('PDF generation failed', err)
    }
  }


  return (
    <Box sx={{ p: 3, height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {/* Print styling */}
      <Box
        component="style"
        // eslint-disable-next-line react/no-danger
        dangerouslySetInnerHTML={{
          __html: `
            @media print {
              .print-hidden { display: none !important; }
              .kiosk-header, .kiosk-footer { display: none !important; }
              body { background: #fff !important; }
            }
          `,
        }}
      />

      <Box className="print-hidden" sx={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 2, flexWrap: 'wrap', mb: 2 }}>
        <Box>
          <Typography variant="h4" sx={{ fontWeight: 950, lineHeight: 1.1 }}>Payment Successful</Typography>
          <Typography variant="body2" sx={{ mt: 0.5, color: 'text.secondary' }}>
            Auto returning to start in <strong>{autoReturn}s</strong>
          </Typography>
        </Box>
        <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
          <Button variant="contained" onClick={finish} sx={{ backgroundColor: '#a259ff', color: '#fff', '&:hover': { backgroundColor: '#8b45e6' } }}>
            End now
          </Button>
        </Box>
      </Box>

      <Box
        sx={{
          flex: 1,
          minHeight: 0,
          overflowY: 'auto',
          overscrollBehavior: 'contain',
          WebkitOverflowScrolling: 'touch',
          pr: { xs: 0, sm: 0.5 },
        }}
      >
        {/* Invoice-style receipt */}
        <Paper ref={invoiceRef} variant="outlined" sx={{ p: 0, borderColor: 'divider', overflow: 'hidden' }}>
          {/* Invoice Header */}
          <Box sx={{ bgcolor: 'background.paper', color: 'text.primary', px: 3, py: 2.5 }}>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 2 }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                {kioskLogoUrl ? (
                  <Box component="img" src={kioskLogoUrl} alt="Logo" sx={{ maxHeight: 64, maxWidth: 160, objectFit: 'contain' }} />
                ) : (
                  <Box>
                    <Typography variant="h5" sx={{ fontWeight: 900, letterSpacing: 0.5 }}>NAZ Retails</Typography>
                    <Typography variant="body2" sx={{ opacity: 0.8, mt: 0.25 }}>Self-Checkout Receipt</Typography>
                  </Box>
                )}
              </Box>
              <Box sx={{ textAlign: { xs: 'left', sm: 'right' }, display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 1 }}>
                <Box>
                  <Typography variant="overline" sx={{ opacity: 0.7, letterSpacing: 1.5 }}>INVOICE</Typography>
                  <Typography variant="h6" sx={{ fontWeight: 900 }}>{invoiceNumber}</Typography>
                </Box>
                <Box sx={{ mt: 0.5, display: 'flex', justifyContent: 'flex-end' }}>
                  <Box sx={{ p: 1, border: '1px solid', borderColor: 'divider', borderRadius: 1, bgcolor: 'background.paper', display: 'inline-block' }}>
                    <QRCode value={receiptUrl || 'about:blank'} size={160} level="M" />
                  </Box>
                </Box>
              </Box>
            </Box>
          </Box>

          {/* Invoice Details */}
          <Box sx={{ px: 3, py: 2, bgcolor: 'grey.50', borderBottom: '1px solid', borderColor: 'divider' }}>
            <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr 1fr' }, gap: 2 }}>
              <Box>
                <Typography variant="caption" sx={{ color: 'text.secondary', textTransform: 'uppercase', letterSpacing: 0.5 }}>Date & Time</Typography>
                <Typography sx={{ fontWeight: 700 }}>{issuedAt.toLocaleString()}</Typography>
              </Box>
              <Box>
                <Typography variant="caption" sx={{ color: 'text.secondary', textTransform: 'uppercase', letterSpacing: 0.5 }}>Station</Typography>
                <Typography sx={{ fontWeight: 700 }}>{stationId || '—'}</Typography>
              </Box>
              <Box>
                <Typography variant="caption" sx={{ color: 'text.secondary', textTransform: 'uppercase', letterSpacing: 0.5 }}>Transaction ID</Typography>
                <Typography sx={{ fontWeight: 700, fontSize: 13 }}>{lastTxId || '—'}</Typography>
              </Box>
              {membership && membership.name ? (
                <Box>
                  <Typography variant="caption" sx={{ color: 'text.secondary', textTransform: 'uppercase', letterSpacing: 0.5 }}>Member</Typography>
                  <Typography sx={{ fontWeight: 700 }}>{membership.name} {typeof membership.points === 'number' ? `• ${membership.points} pts` : ''}</Typography>
                </Box>
              ) : null}
            </Box>
          </Box>

          {/* Items Table */}
          <Box sx={{ px: 3, py: 2 }}>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', py: 1, borderBottom: '2px solid', borderColor: 'grey.300' }}>
              <Box sx={{ display: 'flex', gap: 2 }}>
                <Typography variant="caption" sx={{ color: 'text.secondary', fontWeight: 700, width: 32 }}>#</Typography>
                <Typography variant="caption" sx={{ color: 'text.secondary', fontWeight: 700 }}>ITEM DESCRIPTION</Typography>
              </Box>
              <Typography variant="caption" sx={{ color: 'text.secondary', fontWeight: 700 }}>AMOUNT</Typography>
            </Box>

            {cart.length === 0 ? (
              <Box sx={{ py: 2 }}>
                <Typography sx={{ color: 'text.secondary' }}>No items</Typography>
              </Box>
            ) : (
              cart.map((it, idx) => (
                <Box
                  key={`${it.id || it.sku || it.uid || idx}`}
                  sx={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    py: 1.5,
                    borderBottom: '1px solid',
                    borderColor: 'divider',
                    bgcolor: idx % 2 === 0 ? 'transparent' : 'grey.50',
                    mx: -3,
                    px: 3,
                  }}
                >
                  <Box sx={{ display: 'flex', gap: 2, alignItems: 'flex-start', minWidth: 0 }}>
                    <Typography sx={{ color: 'text.secondary', width: 32 }}>{idx + 1}</Typography>
                    <Box sx={{ minWidth: 0 }}>
                      <Typography sx={{ fontWeight: 800 }} noWrap>{it.name || 'Item'}</Typography>
                      <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                        {it.sku || it.uid || '—'}
                      </Typography>
                    </Box>
                  </Box>
                  <Typography sx={{ fontWeight: 800, whiteSpace: 'nowrap' }}>RM {Number(it.price || 0).toFixed(2)}</Typography>
                </Box>
              ))
            )}
          </Box>

          {/* Totals */}
          <Box sx={{ px: 3, py: 2, bgcolor: 'grey.50', borderTop: '2px solid', borderColor: 'grey.300' }}>
            {(() => {
              const src = serverReceipt || {}
              const dispSubtotal = Number(src.subtotalAmount ?? amount ?? 0)
              const dispPromo = Number(src.promoDiscount ?? lastTransactionDiscount ?? 0)
              const dispRedeemed = Number(src.redeemedAmount ?? lastTransactionRedeemedAmount ?? discountAmount ?? 0)
              const dispTotalDiscount = Math.round(((dispPromo + dispRedeemed) * 100)) / 100
              const dispTotalPaid = Number(src.totalAmount ?? ((dispSubtotal || 0) - dispTotalDiscount))

              return (
                <>
                  <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
                    <Typography sx={{ color: 'text.secondary' }}>Subtotal ({cart.length} item{cart.length !== 1 ? 's' : ''})</Typography>
                    <Typography sx={{ fontWeight: 700 }}>RM {Number(dispSubtotal || 0).toFixed(2)}</Typography>
                  </Box>

                  {dispTotalDiscount > 0 ? (
                    <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
                      <Typography sx={{ color: 'text.secondary' }}>Discount</Typography>
                      <Typography sx={{ fontWeight: 700, color: 'text.secondary' }}>- RM {Number(dispTotalDiscount).toFixed(2)}</Typography>
                    </Box>
                  ) : null}

                  <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <Typography variant="h6" sx={{ fontWeight: 900 }}>Total Paid</Typography>
                    <Typography variant="h5" sx={{ fontWeight: 950, color: 'success.main' }}>RM {Number(dispTotalPaid || 0).toFixed(2)}</Typography>
                  </Box>
                </>
              )
            })()}
          </Box>

          {/* Payment Status Badge */}
          <Box sx={{ px: 3, py: 2, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 2 }}>
            <Box
              sx={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 1,
                bgcolor: 'success.main',
                color: 'common.white',
                px: 2,
                py: 0.75,
                borderRadius: 1,
                fontWeight: 900,
              }}
            >
              ✓ PAID
            </Box>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
              <Box sx={{ textAlign: 'right' }}>
                <Typography variant="caption" sx={{ color: 'text.secondary' }}>Digital receipt available (scan QR above)</Typography>
              </Box>
            </Box>
          </Box>

          {/* Footer */}
          <Box sx={{ px: 3, py: 2, bgcolor: 'grey.100', borderTop: '1px solid', borderColor: 'divider', textAlign: 'center' }}>
            <Typography variant="body2" sx={{ color: 'text.secondary', fontWeight: 500 }}>
              Thank you for shopping with us!
            </Typography>
            <Typography variant="caption" sx={{ color: 'text.secondary' }}>
              This is a computer-generated receipt. No signature required.
            </Typography>
          </Box>
        </Paper>

        {/* Send/print controls removed for kiosk experience */}
      </Box>
    </Box>
  )
}
