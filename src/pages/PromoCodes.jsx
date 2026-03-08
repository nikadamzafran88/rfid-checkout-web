import React, { useEffect, useState } from 'react'
import { Box, Button, TextField, Typography, MenuItem, Table, TableBody, TableCell, TableHead, TableRow, TableContainer, CircularProgress, Stack, Alert, Checkbox, FormControlLabel, Dialog, DialogTitle, DialogContent, DialogActions } from '@mui/material'
import { httpsCallable } from 'firebase/functions'
import { fns, db } from '../services/firebase'
import { collection, getDocs, query, orderBy, doc as fsDoc, updateDoc, deleteDoc, serverTimestamp, onSnapshot } from 'firebase/firestore'
import PageHeader from '../components/ui/PageHeader'
import SectionCard from '../components/ui/SectionCard'

export default function PromoCodes() {
  const [code, setCode] = useState('')
  const [type, setType] = useState('fixed')
  const [value, setValue] = useState(0)
  const [maxUses, setMaxUses] = useState(0)
  const [expiresDate, setExpiresDate] = useState('')
  const [neverExpire, setNeverExpire] = useState(false)
  const [startsDate, setStartsDate] = useState('')
  const [onePerCustomer, setOnePerCustomer] = useState(false)
  const [editOpen, setEditOpen] = useState(false)
  const [editing, setEditing] = useState(null)
  const [loading, setLoading] = useState(false)
  const [list, setList] = useState([])
  const [error, setError] = useState('')

  const loadList = async () => {
    try {
      const q = query(collection(db, 'promo_codes'), orderBy('createdAt', 'desc'))
      const snap = await getDocs(q)
      const items = snap.docs.map(d => ({ id: d.id, ...(d.data() || {}) }))
      setList(items)
    } catch (e) {
      console.error('Failed to load promo codes', e)
    }
  }

  useEffect(() => {
    const q = query(collection(db, 'promo_codes'), orderBy('createdAt', 'desc'))
    const unsub = onSnapshot(q, (snap) => {
      const items = snap.docs.map(d => ({ id: d.id, ...(d.data() || {}) }))
      setList(items)
    }, (err) => {
      console.error('promo_codes onSnapshot failed', err)
      // fallback to one-time load
      loadList()
    })
    return () => { try { unsub() } catch {} }
  }, [])

  const create = async () => {
    setError('')
    if (!code) return setError('Code required')
    if (!Number.isFinite(Number(value)) || Number(value) <= 0) return setError('Value must be positive')
    setLoading(true)
    try {
      const createFn = httpsCallable(fns, 'createPromoCode')
      let expiresIso = null
      if (!neverExpire && expiresDate) {
        const d = new Date(expiresDate)
        d.setHours(23, 59, 59, 999)
        expiresIso = d.toISOString()
      }
      const payload = { code, type, value: Number(value), maxUses: Number(maxUses || 0), expiresAt: expiresIso, startsAt: (startsDate && !neverExpire) ? (new Date(startsDate)).toISOString() : null, onePerCustomer: !!onePerCustomer }
      const res = await createFn(payload)
      if (res?.data?.success) {
        setCode('')
        setValue(0)
        setMaxUses(0)
        setExpiresDate('')
        setNeverExpire(false)
        setStartsDate('')
        setOnePerCustomer(false)
        await loadList()
      }
    } catch (e) {
      console.error('createPromoCode failed', e)
      setError(e?.message || 'Failed')
    } finally { setLoading(false) }
  }

  return (
    <Box sx={{ p: 3 }}>
      <PageHeader title="Discounts" subtitle="Create and manage discount codes." />

      <SectionCard sx={{ mb: 3 }}>
        <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} alignItems="center" justifyContent="space-between">
            <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: 'repeat(4, 1fr)' }, gap: 2, width: '100%' }}>
            <TextField fullWidth label="Code" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} />
            <TextField fullWidth select label="Type" value={type} onChange={(e) => setType(e.target.value)}>
              <MenuItem value="fixed">Fixed (MYR)</MenuItem>
              <MenuItem value="percent">Percent (%)</MenuItem>
            </TextField>
            <TextField fullWidth label="Value" value={value} onChange={(e) => setValue(e.target.value)} />
            <TextField fullWidth label="Max uses (0=unlimited)" value={maxUses} onChange={(e) => setMaxUses(e.target.value)} />
            <FormControlLabel sx={{ gridColumn: '1 / span 2' }} control={<Checkbox checked={onePerCustomer} onChange={(e) => setOnePerCustomer(e.target.checked)} />} label="One use per customer" />
            <TextField fullWidth type="date" label="Starts on" InputLabelProps={{ shrink: true }} value={startsDate} onChange={(e) => setStartsDate(e.target.value)} sx={{ gridColumn: { xs: '1 / -1', md: '1 / span 2' } }} />
            <Box sx={{ display: 'flex', gap: 2, alignItems: 'center', gridColumn: { xs: '1 / -1', md: '3 / span 2' } }}>
              <TextField
                fullWidth
                type="date"
                label="Expires on"
                InputLabelProps={{ shrink: true }}
                value={expiresDate}
                onChange={(e) => setExpiresDate(e.target.value)}
                disabled={neverExpire}
              />
              <FormControlLabel control={<Checkbox checked={neverExpire} onChange={(e) => setNeverExpire(e.target.checked)} />} label="Never expire" />
            </Box>
          </Box>

          <Box>
            <Button variant="outlined" onClick={loadList} sx={{ mr: 1 }}>Refresh</Button>
            <Button variant="contained" onClick={create} disabled={loading}>Create</Button>
          </Box>
        </Stack>
        {error ? <Typography color="error" sx={{ mt: 2 }}>{error}</Typography> : null}
      </SectionCard>

      {/* Split active and archived (expired/deactivated) discounts */}
      <SectionCard sx={{ mb: 3 }}>
        <Typography variant="subtitle1" sx={{ mb: 1, fontWeight: 600 }}>Active Discounts</Typography>
        <TableContainer>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Code</TableCell>
                <TableCell>Type</TableCell>
                <TableCell>Value</TableCell>
                <TableCell>Uses</TableCell>
                <TableCell>Max</TableCell>
                <TableCell>Active</TableCell>
                <TableCell align="right">Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell colSpan={7} sx={{ py: 4, textAlign: 'center' }}>
                    <CircularProgress size={24} />
                  </TableCell>
                </TableRow>
              ) : (() => {
                const nowMs = Date.now()
                const activeList = (list || []).filter((p) => {
                  if (p.archived) return false
                  const exp = p.expiresAt && p.expiresAt.toMillis ? p.expiresAt.toMillis() : (p.expiresAt ? Date.parse(p.expiresAt) : null)
                  if (exp && nowMs > exp) return false
                  return p.active !== false
                })
                if (activeList.length === 0) {
                  return (<TableRow><TableCell colSpan={7} sx={{ py: 3, textAlign: 'center' }}>No active discounts.</TableCell></TableRow>)
                }
                return activeList.map((p) => (
                  <TableRow key={p.id} hover>
                    <TableCell>{p.code}</TableCell>
                    <TableCell>{p.type}</TableCell>
                    <TableCell>{p.type === 'percent' ? `${p.value}%` : `RM ${Number(p.value || 0).toFixed(2)}`}</TableCell>
                    <TableCell>{p.uses || 0}</TableCell>
                    <TableCell>{p.maxUses || 0}</TableCell>
                    <TableCell>{p.active ? 'Yes' : 'No'}</TableCell>
                    <TableCell align="right">
                      <Button size="small" variant="outlined" sx={{ mr: 1 }} onClick={() => { setEditing(p); setEditOpen(true) }}>Edit</Button>
                      <Button size="small" color={p.active ? 'warning' : 'success'} variant="contained" sx={{ mr: 1 }} onClick={async () => {
                        try {
                          await updateDoc(fsDoc(db, 'promo_codes', p.code), { active: !p.active })
                          await loadList()
                        } catch (e) { console.error('toggle active failed', e) }
                      }}>{p.active ? 'Deactivate' : 'Activate'}</Button>
                      <Button size="small" color="error" variant="outlined" onClick={async () => {
                        if (!window.confirm(`Archive discount ${p.code}?`)) return
                        try { await updateDoc(fsDoc(db, 'promo_codes', p.code), { archived: true, deletedAt: serverTimestamp(), active: false }); await loadList() } catch (e) { console.error('archive failed', e) }
                      }}>Archive</Button>
                    </TableCell>
                  </TableRow>
                ))
              })()}
            </TableBody>
          </Table>
        </TableContainer>
      </SectionCard>

      <SectionCard>
        <Typography variant="subtitle1" sx={{ mb: 1, fontWeight: 600 }}>Archived Discounts</Typography>
        <TableContainer>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Code</TableCell>
                <TableCell>Type</TableCell>
                <TableCell>Value</TableCell>
                <TableCell>Uses</TableCell>
                <TableCell>Max</TableCell>
                <TableCell>Archived</TableCell>
                <TableCell align="right">Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {(() => {
                const nowMs = Date.now()
                const archivedList = (list || []).filter((p) => {
                  if (p.archived) return true
                  const exp = p.expiresAt && p.expiresAt.toMillis ? p.expiresAt.toMillis() : (p.expiresAt ? Date.parse(p.expiresAt) : null)
                  if (exp && nowMs > exp) return true
                  return false
                })
                if (archivedList.length === 0) {
                  return (<TableRow><TableCell colSpan={7} sx={{ py: 3, textAlign: 'center' }}>No archived discounts.</TableCell></TableRow>)
                }
                return archivedList.map((p) => (
                  <TableRow key={p.id} hover>
                    <TableCell>{p.code}</TableCell>
                    <TableCell>{p.type}</TableCell>
                    <TableCell>{p.type === 'percent' ? `${p.value}%` : `RM ${Number(p.value || 0).toFixed(2)}`}</TableCell>
                    <TableCell>{p.uses || 0}</TableCell>
                    <TableCell>{p.maxUses || 0}</TableCell>
                    <TableCell>{p.archived ? 'Yes' : (p.expiresAt ? 'Expired' : 'Yes')}</TableCell>
                    <TableCell align="right">
                      <Button size="small" variant="outlined" sx={{ mr: 1 }} onClick={() => { setEditing(p); setEditOpen(true) }}>Edit</Button>
                      <Button size="small" variant="contained" sx={{ mr: 1 }} onClick={async () => {
                        try { await updateDoc(fsDoc(db, 'promo_codes', p.code), { archived: false, active: false }); await loadList() } catch (e) { console.error('unarchive failed', e) }
                      }}>Unarchive</Button>
                      <Button size="small" color="error" variant="outlined" onClick={async () => {
                        if (!window.confirm(`Permanently delete discount ${p.code}? This cannot be undone.`)) return
                        try { await deleteDoc(fsDoc(db, 'promo_codes', p.code)); await loadList() } catch (e) { console.error('delete failed', e) }
                      }}>Delete</Button>
                    </TableCell>
                  </TableRow>
                ))
              })()}
            </TableBody>
          </Table>
        </TableContainer>
      </SectionCard>

      {/* Edit dialog (simple inline) */}
      {editing && (
        <Dialog open={editOpen} onClose={() => { setEditOpen(false); setEditing(null) }}>
          <DialogTitle>Edit Discount</DialogTitle>
          <DialogContent>
            <Box sx={{ display: 'grid', gap: 2, width: 520, mt: 1 }}>
              <TextField label="Code" value={editing.code} disabled />
              <TextField select label="Type" value={editing.type} onChange={(e) => setEditing(s => ({ ...s, type: e.target.value }))}>
                <MenuItem value="fixed">Fixed (MYR)</MenuItem>
                <MenuItem value="percent">Percent (%)</MenuItem>
              </TextField>
              <TextField label="Value" value={editing.value} onChange={(e) => setEditing(s => ({ ...s, value: e.target.value }))} />
              <TextField label="Max uses (0=unlimited)" value={editing.maxUses || 0} onChange={(e) => setEditing(s => ({ ...s, maxUses: e.target.value }))} />
              <TextField type="date" label="Starts on" InputLabelProps={{ shrink: true }} value={editing.startsAt ? (new Date(editing.startsAt.seconds ? editing.startsAt.toDate() : editing.startsAt).toISOString().slice(0,10)) : ''} onChange={(e) => setEditing(s => ({ ...s, startsAt: e.target.value }))} />
              <TextField type="date" label="Expires on" InputLabelProps={{ shrink: true }} value={editing.expiresAt ? (new Date(editing.expiresAt.seconds ? editing.expiresAt.toDate() : editing.expiresAt).toISOString().slice(0,10)) : ''} onChange={(e) => setEditing(s => ({ ...s, expiresAt: e.target.value }))} />
            </Box>
          </DialogContent>
          <DialogActions>
            <Button onClick={() => { setEditOpen(false); setEditing(null) }}>Cancel</Button>
            <Button onClick={async () => {
              try {
                const u = { type: editing.type, value: Number(editing.value || 0), maxUses: Number(editing.maxUses || 0) }
                if (editing.expiresAt) { const d = new Date(editing.expiresAt); d.setHours(23,59,59,999); u.expiresAt = d.toISOString() } else { u.expiresAt = null }
                if (editing.startsAt) { const d2 = new Date(editing.startsAt); d2.setHours(0,0,0,0); u.startsAt = d2.toISOString(); u.active = Date.now() >= d2.getTime() } else { u.startsAt = null }
                await updateDoc(fsDoc(db, 'promo_codes', editing.code), u)
                setEditOpen(false); setEditing(null); await loadList()
              } catch (e) { console.error('update promo failed', e) }
            }} variant="contained">Save</Button>
          </DialogActions>
        </Dialog>
      )}
    </Box>
  )
}
