import React, { useEffect, useState } from 'react'
import { Box, Button, TextField, Typography, Paper, MenuItem, Table, TableBody, TableCell, TableHead, TableRow } from '@mui/material'
import { httpsCallable } from 'firebase/functions'
import { fns, db } from '../services/firebase'
import { collection, getDocs, query, orderBy } from 'firebase/firestore'

export default function PromoCodes() {
  const [code, setCode] = useState('')
  const [type, setType] = useState('fixed')
  const [value, setValue] = useState(0)
  const [maxUses, setMaxUses] = useState(0)
  const [stations, setStations] = useState('')
  const [expiresAt, setExpiresAt] = useState('')
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

  useEffect(() => { loadList() }, [])

  const create = async () => {
    setError('')
    if (!code) return setError('Code required')
    if (!Number.isFinite(Number(value)) || Number(value) <= 0) return setError('Value must be positive')
    setLoading(true)
    try {
      const createFn = httpsCallable(fns, 'createPromoCode')
      const res = await createFn({ code, type, value: Number(value), maxUses: Number(maxUses || 0), stations: stations.split(',').map(s => s.trim()).filter(Boolean), expiresAt: expiresAt || null })
      if (res?.data?.success) {
        setCode('')
        setValue(0)
        setMaxUses(0)
        setStations('')
        setExpiresAt('')
        await loadList()
      }
    } catch (e) {
      console.error('createPromoCode failed', e)
      setError(e?.message || 'Failed')
    } finally { setLoading(false) }
  }

  return (
    <Box>
      <Typography variant="h5" sx={{ mb: 2, fontWeight: 900 }}>Promo Codes</Typography>

      <Paper sx={{ p: 2, mb: 3 }}>
        <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 1 }}>
          <TextField label="Code" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} />
          <TextField select label="Type" value={type} onChange={(e) => setType(e.target.value)}>
            <MenuItem value="fixed">Fixed (MYR)</MenuItem>
            <MenuItem value="percent">Percent (%)</MenuItem>
          </TextField>
          <TextField label="Value" value={value} onChange={(e) => setValue(e.target.value)} />
          <TextField label="Max uses (0=unlimited)" value={maxUses} onChange={(e) => setMaxUses(e.target.value)} />
          <TextField label="Stations (comma-separated)" value={stations} onChange={(e) => setStations(e.target.value)} sx={{ gridColumn: '1 / span 2' }} />
          <TextField label="Expires at (ISO)" value={expiresAt} onChange={(e) => setExpiresAt(e.target.value)} sx={{ gridColumn: '3 / span 2' }} />
        </Box>
        <Box sx={{ display: 'flex', gap: 1, mt: 2 }}>
          <Button variant="contained" onClick={create} disabled={loading}>Create</Button>
          <Button variant="outlined" onClick={loadList}>Refresh</Button>
          {error ? <Typography color="error">{error}</Typography> : null}
        </Box>
      </Paper>

      <Paper sx={{ p: 2 }}>
        <Typography variant="subtitle1" sx={{ mb: 1 }}>Existing Codes</Typography>
        <Table>
          <TableHead>
            <TableRow>
              <TableCell>Code</TableCell>
              <TableCell>Type</TableCell>
              <TableCell>Value</TableCell>
              <TableCell>Uses</TableCell>
              <TableCell>Max</TableCell>
              <TableCell>Active</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {list.map((p) => (
              <TableRow key={p.id}>
                <TableCell>{p.code}</TableCell>
                <TableCell>{p.type}</TableCell>
                <TableCell>{p.type === 'percent' ? `${p.value}%` : `RM ${Number(p.value || 0).toFixed(2)}`}</TableCell>
                <TableCell>{p.uses || 0}</TableCell>
                <TableCell>{p.maxUses || 0}</TableCell>
                <TableCell>{p.active ? 'Yes' : 'No'}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Paper>
    </Box>
  )
}
