import React, { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { db } from '../firebaseConfig'
import PageHeader from '../components/ui/PageHeader'
import SectionCard from '../components/ui/SectionCard'
import { doc, getDoc, collection, query, where, getDocs, orderBy } from 'firebase/firestore'
// (no callable used here)
import AiSummary from '../components/AiSummary.jsx'
import { useTheme } from '@mui/material'
import { useAuth } from '../context/AuthContext.jsx'
import { Box, Paper, Typography, CircularProgress, Alert, Table, TableHead, TableRow, TableCell, TableBody, Button } from '@mui/material'

const MemberDetails = () => {
  const { memberId } = useParams()
  const navigate = useNavigate()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [member, setMember] = useState(null)
  const [transactions, setTransactions] = useState([])
  const [ledger, setLedger] = useState([])
  
  const { currentRole } = useAuth()

  useEffect(() => {
    const load = async () => {
      setLoading(true)
      setError('')
      try {
        const mRef = doc(db, 'memberships', memberId)
        const mSnap = await getDoc(mRef)
        if (!mSnap.exists()) throw new Error('Member not found')
        setMember({ id: mSnap.id, ...mSnap.data() })

        // transactions: top-level collection 'transactions' where membershipId == memberId
        try {
          const tcol = collection(db, 'transactions')
          const tq = query(tcol, where('membershipId', '==', memberId), orderBy('timestamp', 'desc'))
          const tsnap = await getDocs(tq)
          const txs = tsnap.docs.map((d) => ({ id: d.id, ...d.data() }))
          setTransactions(txs)

          // If no top-level transactions found, fall back to ledger entries' txIds
          if (txs.length === 0) {
            try {
              const lcol = collection(db, 'memberships', memberId, 'transactions')
              const lsnap = await getDocs(lcol)
              const ledgerList = lsnap.docs.map((d) => ({ id: d.id, ...d.data() }))
              const txIds = new Set()
              for (const l of ledgerList) {
                if (l.txId) txIds.add(l.txId)
                else if (typeof l.id === 'string') {
                  const parts = l.id.split('_')
                  if (parts[0]) txIds.add(parts[0])
                }
              }
              const fetched = []
              for (const tid of Array.from(txIds)) {
                try {
                  const td = await getDoc(doc(db, 'transactions', tid))
                  if (td.exists()) fetched.push({ id: td.id, ...td.data() })
                } catch {
                  // ignore individual fetch errors
                }
              }
              if (fetched.length > 0) {
                // sort by timestamp desc when possible
                fetched.sort((a, b) => {
                  const ta = a.timestamp && a.timestamp.toDate ? a.timestamp.toDate().getTime() : 0
                  const tb = b.timestamp && b.timestamp.toDate ? b.timestamp.toDate().getTime() : 0
                  return tb - ta
                })
                setTransactions(fetched)
              }
            } catch (e) {
              console.warn('Fallback ledger->transactions failed', e)
            }
          }
        } catch (e) {
          // ignore; maybe no permission or index
          console.warn('Failed to load transactions', e)
          setTransactions([])
        }

          // membership ledger stored under memberships/{memberId}/transactions
          try {
            const lcol = collection(db, 'memberships', memberId, 'transactions')
            const lq = query(lcol, orderBy('timestamp', 'desc'))
            const lsnap = await getDocs(lq)
            const ledgerList = lsnap.docs.map((d) => ({ id: d.id, ...d.data() }))
            setLedger(ledgerList)
          } catch (e) {
            console.warn('Failed to load ledger entries', e)
            setLedger([])
          }

      } catch (e) {
        console.error(e)
        setError(e?.message || 'Failed to load member')
      } finally {
        setLoading(false)
      }
    }
    if (memberId) load()
  }, [memberId])

  // derive promo usage summary from transactions
  const promoSummary = React.useMemo(() => {
    const map = {}
    for (const t of transactions || []) {
      const p = t.promoCode || t.promo || '—'
      map[p] = (map[p] || 0) + 1
    }
    return map
  }, [transactions])

  // update analysis payload when member/tx/ledger change (used by AiSummary payload builder)

  // `buildMemberPayload` is declared after helper resolvers to avoid initialization order issues

  // analysis callable is not used here; `AiSummary` handles summary generation via its own flow.

  const resolveAmount = (t) => {
    if (!t) return 0
    if (t.expectedPayable != null) return Number(t.expectedPayable)
    if (t.expectedPayableCents != null) return Number(t.expectedPayableCents) / 100
    if (t.totalAmount != null) return Number(t.totalAmount)
    if (t.total_amount != null) return Number(t.total_amount)
    if (t.amount != null) return Number(t.amount)
    if (t.amountCents != null) return Number(t.amountCents) / 100
    // nested paymentDetails
    const pd = t.paymentDetails || t.payment_details || null
    if (pd && pd.amount_cents != null) return Number(pd.amount_cents) / 100
    if (pd && pd.amount != null) return Number(pd.amount)
    return 0
  }

  const resolveTimestamp = (t) => {
    if (!t) return null
    // check nested paid_at in paymentDetails
    const pd = t.paymentDetails || t.payment_details || null
    const pdPaid = pd ? (pd.paid_at || pd.paidAt) : null
    const cand = pdPaid || t.paidAt || t.timestamp || t.processedAt || t.completedAt || t.createdAt || t.processedAt || t.processedAt
    if (!cand) return null
    if (cand && typeof cand.toDate === 'function') return cand.toDate()
    if (typeof cand === 'string') return new Date(cand)
    try {
      return new Date(cand)
    } catch {
      return null
    }
  }

  const resolveSubtotal = (t) => {
    if (!t) return 0
    if (t.subtotalAmount != null) return Number(t.subtotalAmount)
    if (t.subtotal_amount != null) return Number(t.subtotal_amount)
    // try items sum
    if (Array.isArray(t.items) && t.items.length > 0) {
      return t.items.reduce((s, it) => s + (Number(it.price || it.price_cents || 0) / (it.price ? 1 : 1)), 0)
    }
    return 0
  }

  const resolvePromo = (t) => {
    if (!t) return 0
    if (t.promoDiscount != null) return Number(t.promoDiscount)
    if (t.discountAmount != null) return Number(t.discountAmount)
    if (t.promo_discount != null) return Number(t.promo_discount)
    // percent-based promo stored differently — skip for now
    return 0
  }

  const resolveRedeemed = (t) => {
    if (!t) return 0
    if (t.redeemedAmount != null) return Number(t.redeemedAmount)
    if (t.redeemed != null) return Number(t.redeemed)
    if (t.redeemed_points != null) return Number(t.redeemed_points)
    return 0
  }

  const buildMemberPayload = React.useMemo(() => {
    if (!member) return null
    const txList = Array.isArray(transactions) ? transactions.slice(0, 200) : []
    const totalSpent = txList.reduce((s, t) => s + Number(resolveAmount(t) || 0), 0)
    const paidTxCount = txList.filter((t) => resolveAmount(t) > 0).length
    const avgSpend = paidTxCount ? totalSpent / paidTxCount : 0
    const lastPurchase = txList.length ? (resolveTimestamp(txList[0]) || null) : null
    return {
      member: { id: member.id, name: member.name, phone: member.phone, points: member.points || 0, lifetimeSpend: member.lifetimeSpend || 0 },
      totals: {
        txCount: txList.length,
        paidTxCount,
        totalSpent: Number(totalSpent.toFixed(2)),
        avgSpend: Number(avgSpend.toFixed(2)),
        lastPurchase: lastPurchase ? lastPurchase.toISOString() : null,
      },
      promoSummary: promoSummary,
      recentTransactions: txList.slice(0, 40).map((t) => ({ id: t.id, subtotal: resolveSubtotal(t), promo: resolvePromo(t), redeemed: resolveRedeemed(t), amount: resolveAmount(t), timestamp: resolveTimestamp(t) ? resolveTimestamp(t).toISOString() : null })),
      ledger: Array.isArray(ledger) ? ledger.slice(0, 80) : [],
    }
  }, [member, transactions, ledger, promoSummary])

  const buildAnalysisPromptFromPayload = React.useMemo(() => {
    if (!buildMemberPayload) return ''
    try {
      const lines = []
      lines.push(`Member Analysis for ${buildMemberPayload.member?.id || ''} - ${buildMemberPayload.member?.name || ''}`)
      lines.push(`Points: ${buildMemberPayload.member?.points || 0}, LifetimeSpend: RM ${Number(buildMemberPayload.member?.lifetimeSpend || 0).toFixed(2)}`)
      lines.push('\nRecent transactions:')
      for (const t of (buildMemberPayload.recentTransactions || []).slice(0, 10)) {
        lines.push(`- ${t.id}: subtotal RM ${Number(t.subtotal || 0).toFixed(2)}, promo RM ${Number(t.promo || 0).toFixed(2)}, redeemed RM ${Number(t.redeemed || 0).toFixed(2)}, paid RM ${Number(t.amount || 0).toFixed(2)}, at ${t.timestamp || '—'}`)
      }
      lines.push('\nPlease provide a concise customer-behaviour analysis focusing on buying frequency, promo responsiveness, redemption patterns, churn risk, and 3 short recommended actions. Return JSON only.')
      return lines.join('\n')
    } catch {
      return ''
    }
  }, [buildMemberPayload])

  const exportCsv = (rows, filename) => {
    if (!rows || rows.length === 0) return
    const keys = Object.keys(rows[0])
    const header = keys.join(',')
    const lines = [header]
    for (const r of rows) {
      const vals = keys.map((k) => {
        let v = r[k]
        if (v && v.toDate) v = v.toDate().toISOString()
        if (v === undefined || v === null) v = ''
        return String(v).replace(/\n/g, ' ').replace(/\r/g, '')
      })
      lines.push(vals.join(','))
    }
    const blob = new Blob([lines.join('\n')], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    a.click()
    URL.revokeObjectURL(url)
  }

  if (loading) return <Box sx={{ p: 6, textAlign: 'center' }}><CircularProgress /></Box>
  if (error) return <Box sx={{ p: 6 }}><Alert severity="error">{error}</Alert></Box>

  return (
    <Box sx={{ p: 3 }}>
      <PageHeader title={`Member: ${member?.name || memberId}`} subtitle={`ID: ${memberId}`} />

      <SectionCard title="Overview">
        <Typography>Name: {member?.name || '—'}</Typography>
        <Typography>Phone: {member?.phone || '—'}</Typography>
        <Typography>Points: {member?.points ?? 0}</Typography>
        <Typography>Lifetime Spend: RM {Number(member?.lifetimeSpend || 0).toFixed(2)}</Typography>
        <Box sx={{ mt: 1 }}>
          <Button variant="outlined" onClick={() => navigate('/admin/memberships')}>Back</Button>
        </Box>
      </SectionCard>

      

      <SectionCard title="Transactions">
        <Box sx={{ display: 'flex', gap: 1, mb: 1 }}>
          <Button size="small" onClick={() => exportCsv(transactions, `member_${memberId}_transactions.csv`)} disabled={!transactions.length}>Export CSV</Button>
        </Box>
        {transactions.length === 0 ? (
          <Typography variant="body2">No transactions found.</Typography>
        ) : (
          <Table size="small">
            <TableHead>
              <TableRow sx={{ backgroundColor: (theme) => theme.palette.mode === 'dark' ? theme.palette.grey[900] : theme.palette.grey[200] }}>
                <TableCell sx={{ color: (theme) => theme.palette.text.primary, fontWeight: 700 }}>TX ID</TableCell>
                <TableCell sx={{ color: (theme) => theme.palette.text.primary, fontWeight: 700 }}>Subtotal</TableCell>
                <TableCell sx={{ color: (theme) => theme.palette.text.primary, fontWeight: 700 }}>Promo</TableCell>
                <TableCell sx={{ color: (theme) => theme.palette.text.primary, fontWeight: 700 }}>Redeemed</TableCell>
                <TableCell sx={{ color: (theme) => theme.palette.text.primary, fontWeight: 700 }}>Total Paid</TableCell>
                <TableCell sx={{ color: (theme) => theme.palette.text.primary, fontWeight: 700 }}>Timestamp</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {transactions.map((t) => (
                <TableRow key={t.id}>
                  <TableCell>{t.id}</TableCell>
                  <TableCell>{`RM ${resolveSubtotal(t).toFixed(2)}`}</TableCell>
                  <TableCell>{`${t.promoCode || t.promo || '—'} (${resolvePromo(t) ? `RM ${Number(resolvePromo(t)).toFixed(2)}` : 'RM 0.00'})`}</TableCell>
                  <TableCell>{`RM ${Number(resolveRedeemed(t) || 0).toFixed(2)}`}</TableCell>
                  <TableCell>{`RM ${resolveAmount(t).toFixed(2)}`}</TableCell>
                  <TableCell>{(() => {
                    const dt = resolveTimestamp(t)
                    return dt ? dt.toLocaleString() : '—'
                  })()}</TableCell>
                  
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </SectionCard>

      <SectionCard title="Membership Ledger">
        <Box sx={{ display: 'flex', gap: 1, mb: 1 }}>
          <Button size="small" onClick={() => exportCsv(ledger, `member_${memberId}_ledger.csv`)} disabled={!ledger.length}>Export CSV</Button>
        </Box>
        {ledger.length === 0 ? (
          <Typography variant="body2">No ledger entries.</Typography>
        ) : (
          <Table size="small">
            <TableHead>
              <TableRow sx={{ backgroundColor: (theme) => theme.palette.mode === 'dark' ? theme.palette.grey[900] : theme.palette.grey[200] }}>
                <TableCell sx={{ color: (theme) => theme.palette.text.primary, fontWeight: 700 }}>Type</TableCell>
                <TableCell sx={{ color: (theme) => theme.palette.text.primary, fontWeight: 700 }}>Points Delta</TableCell>
                <TableCell sx={{ color: (theme) => theme.palette.text.primary, fontWeight: 700 }}>Amount</TableCell>
                <TableCell sx={{ color: (theme) => theme.palette.text.primary, fontWeight: 700 }}>Reason</TableCell>
                <TableCell sx={{ color: (theme) => theme.palette.text.primary, fontWeight: 700 }}>Timestamp</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {ledger.map((l) => (
                <TableRow key={l.id}>
                  <TableCell>{l.type || l.entryType || '—'}</TableCell>
                  <TableCell>{l.pointsDelta ?? l.points ?? 0}</TableCell>
                  <TableCell>{l.amount ? `RM ${Number(l.amount).toFixed(2)}` : '—'}</TableCell>
                  <TableCell>{l.reason || l.message || '—'}</TableCell>
                  <TableCell>{l.timestamp && l.timestamp.toDate ? l.timestamp.toDate().toLocaleString() : (l.processedAt && l.processedAt.toDate ? l.processedAt.toDate().toLocaleString() : '—')}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </SectionCard>

      <SectionCard
        title="Member AI Analysis"
        sx={(theme) => ({
          position: 'relative',
          overflow: 'hidden',
          border: `1px solid ${theme.palette.error.main}`,
          backgroundColor: theme.palette.mode === 'dark' ? 'rgba(255,72,66,0.06)' : 'rgba(255,72,66,0.06)',
        })}
      >
        <Box sx={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 4, backgroundColor: (theme) => theme.palette.error.main }} />
        {buildAnalysisPromptFromPayload ? (
          <Box sx={{ mb: 2 }}>
            <Paper variant="outlined" sx={{ p: 2, backgroundColor: (theme) => theme.palette.mode === 'dark' ? 'rgba(255,255,255,0.02)' : '#fff7f7', border: `1px dashed ${ (theme) => theme.palette.error.main }` }}>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start', gap: 1 }}>
                <Typography variant="subtitle2">Prompt</Typography>
                <Box>
                  <Button size="small" onClick={() => navigator.clipboard?.writeText(buildAnalysisPromptFromPayload)}>Copy Prompt</Button>
                </Box>
              </Box>
              <Box component="pre" sx={{ whiteSpace: 'pre-wrap', fontFamily: 'monospace', fontSize: 12, mt: 1 }}>{buildAnalysisPromptFromPayload}</Box>
            </Paper>
          </Box>
        ) : null}

        <AiSummary
          sales={buildMemberPayload}
          disabled={loading}
          role={currentRole}
          scope="member-details"
          title="Member AI Analysis"
          idleSubtitle="Click Generate to get this member analysis."
          showAudienceButtons={true}
          defaultAudience="owner"
          requireStructured={true}
        />
      </SectionCard>
      {/* Dialog and related code fully removed */}
    </Box>
  )
}

export default MemberDetails
