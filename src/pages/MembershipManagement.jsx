import React, { useEffect, useState } from 'react'
import { collection, getDocs, doc, updateDoc, query, where, deleteDoc } from 'firebase/firestore'
import { db } from '../firebaseConfig'
import PageHeader from '../components/ui/PageHeader'
import SectionCard from '../components/ui/SectionCard'
import {
  Box,
  Typography,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Button,
  IconButton,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  CircularProgress,
  Avatar,
  Stack,
  Alert,
} from '@mui/material'
import { useTheme } from '@mui/material/styles'
import { Search, Edit2, Trash2 } from 'lucide-react'

export default function MembershipManagement() {
  const theme = useTheme()
  const [members, setMembers] = useState([])
  const [filtered, setFiltered] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [search, setSearch] = useState('')
  const [editOpen, setEditOpen] = useState(false)
  const [selectedMember, setSelectedMember] = useState(null)
  const [saving, setSaving] = useState(false)
  const [editError, setEditError] = useState('')

  const fetchMembers = async () => {
    setLoading(true)
    setError(null)
    try {
      const snap = await getDocs(collection(db, 'memberships'))
      const list = snap.docs.map((d) => {
        const data = d.data() || {}

        // Normalize createdAt: support Firestore Timestamp, ISO string, or null
        let createdAtIso = null
        try {
          const raw = data.createdAt || data.created_at || null
          if (raw && typeof raw === 'object' && typeof raw.toDate === 'function') {
            createdAtIso = raw.toDate().toISOString()
          } else if (typeof raw === 'string' && raw.length > 0) {
            createdAtIso = raw
          } else {
            createdAtIso = null
          }
        } catch {
          createdAtIso = null
        }

        return {
          id: d.id,
          name: data.name || '',
          phone: data.phone || '',
          points: Number(data.points || 0),
          lifetimePoints: Number(data.lifetimePoints || 0),
          lifetimeSpend: Number(data.lifetimeSpend || 0),
          createdAtIso,
          raw: data,
        }
      })

      // sort by createdAt desc if available
      list.sort((a, b) => {
        const ta = a.createdAt ? Date.parse(a.createdAt) || 0 : 0
        const tb = b.createdAt ? Date.parse(b.createdAt) || 0 : 0
        return tb - ta
      })

      setMembers(list)
    } catch (e) {
      console.error('Failed to fetch memberships', e)
      setError(e)
      setMembers([])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchMembers()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

    const confirmAndDelete = async (member) => {
      if (!member || !member.id) return
      const ok = window.confirm(`Delete membership "${member.name || member.id}"? This cannot be undone.`)
      if (!ok) return

      setLoading(true)
      try {
        await deleteDoc(doc(db, 'memberships', member.id))
        setMembers(prev => prev.filter((m) => m.id !== member.id))
      } catch (e) {
        console.error('Failed to delete membership', e)
        setError(e)
      } finally {
        setLoading(false)
      }
    }

  useEffect(() => {
    const s = String(search || '').toLowerCase()
    setFiltered(members.filter((m) => {
      if (!s) return true
      return (m.name || '').toLowerCase().includes(s) || (m.phone || '').toLowerCase().includes(s) || (m.id || '').toLowerCase().includes(s)
    }))
  }, [members, search])

  return (
    <Box sx={{ p: 3 }}>
      <PageHeader title="Memberships" subtitle="View and manage registered memberships." />

      <SectionCard sx={{ mb: 3 }}>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} alignItems="center" justifyContent="space-between">
          <Stack direction="row" spacing={1} alignItems="center">
            <Search size={18} />
            <TextField size="small" placeholder="Search by name or phone" value={search} onChange={(e) => setSearch(e.target.value)} />
          </Stack>

          <Box>
            <Stack direction="row" spacing={1}>
              <Button variant="outlined" onClick={fetchMembers}>Refresh</Button>
            </Stack>
          </Box>
        </Stack>
      </SectionCard>

      {error && (
        <Box sx={{ mb: 2 }}>
          <Alert severity="error">Failed to load memberships — check Firestore rules and network.</Alert>
        </Box>
      )}

      <SectionCard title="Members">
        <TableContainer>
          <Table size="small">
            <TableHead sx={{ backgroundColor: theme.palette.grey[50], '& th': { color: theme.palette.text.primary } }}>
              <TableRow>
                  <TableCell sx={{ fontWeight: 600 }}>Member</TableCell>
                  <TableCell sx={{ fontWeight: 600 }}>Phone</TableCell>
                  <TableCell sx={{ fontWeight: 600 }}>Points</TableCell>
                  <TableCell sx={{ fontWeight: 600 }}>Lifetime Spend</TableCell>
                  <TableCell sx={{ fontWeight: 600 }}>Created</TableCell>
                  <TableCell sx={{ fontWeight: 600 }}>Actions</TableCell>
                </TableRow>
            </TableHead>

            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell colSpan={6} sx={{ py: 4, textAlign: 'center' }}>
                    <CircularProgress size={24} />
                  </TableCell>
                </TableRow>
              ) : filtered.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} sx={{ py: 3, textAlign: 'center' }}>No memberships found.</TableCell>
                </TableRow>
              ) : (
                filtered.map((m) => (
                  <TableRow key={m.id} hover>
                    <TableCell>
                      <Stack direction="row" spacing={2} alignItems="center">
                        <Avatar sx={{ width: 34, height: 34, bgcolor: theme.palette.primary.light }}>{m.name ? m.name.charAt(0).toUpperCase() : '?'}</Avatar>
                        <Box>
                          <Typography variant="body2" sx={{ fontWeight: 600 }}>{m.name || '—'}</Typography>
                          <Typography variant="caption" sx={{ color: theme.palette.text.secondary }}>{m.id}</Typography>
                        </Box>
                      </Stack>
                    </TableCell>

                    <TableCell>{m.phone || '—'}</TableCell>
                    <TableCell>{m.points}</TableCell>
                    <TableCell>RM {Number.isFinite(m.lifetimeSpend) ? m.lifetimeSpend.toFixed(2) : '0.00'}</TableCell>
                    <TableCell>{m.createdAtIso ? new Date(m.createdAtIso).toLocaleString('en-MY', { year: 'numeric', month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—'}</TableCell>
                    <TableCell>
                      <Stack direction="row" spacing={0.5} alignItems="center">
                        <IconButton size="small" color="primary" onClick={() => { setSelectedMember({ ...m }); setEditError(''); setEditOpen(true) }}>
                          <Edit2 size={16} />
                        </IconButton>
                        <IconButton size="small" color="error" onClick={() => confirmAndDelete(m)}>
                          <Trash2 size={16} />
                        </IconButton>
                      </Stack>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </TableContainer>
      </SectionCard>
      
      <Dialog open={editOpen} onClose={() => setEditOpen(false)}>
        <DialogTitle>Edit Membership</DialogTitle>
        <DialogContent>
          {selectedMember ? (
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1, mt: 1, minWidth: 360 }}>
              <TextField label="Name" value={selectedMember.name || ''} onChange={(e) => setSelectedMember(s => ({ ...s, name: e.target.value }))} />
              <TextField label="Phone (incl +code)" value={selectedMember.phone || ''} onChange={(e) => setSelectedMember(s => ({ ...s, phone: e.target.value }))} />
              <TextField label="Points" type="number" value={selectedMember.points || 0} onChange={(e) => setSelectedMember(s => ({ ...s, points: Number(e.target.value || 0) }))} />
              {editError ? <Typography variant="caption" sx={{ color: 'error.main' }}>{editError}</Typography> : null}
            </Box>
          ) : null}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setEditOpen(false)}>Cancel</Button>
          <Button variant="contained" onClick={async () => {
            if (!selectedMember) return
            setSaving(true)
            setEditError('')
            try {
              const name = String(selectedMember.name || '').trim()
              const phoneVal = String(selectedMember.phone || '').trim()
              if (!name) throw new Error('Name required')
              if (!/^\+\d{6,15}$/.test(phoneVal)) throw new Error('Phone must include country code, e.g. +60123456789')

              // check uniqueness
              const q = query(collection(db, 'memberships'), where('phone', '==', phoneVal))
              const snap = await getDocs(q)
              const conflict = snap.docs.find(d => d.id !== selectedMember.id)
              if (conflict) throw new Error('Phone number already used by another membership')

              const ref = doc(db, 'memberships', selectedMember.id)
              await updateDoc(ref, {
                name,
                phone: phoneVal,
                points: Number(selectedMember.points || 0),
                updatedAt: new Date().toISOString(),
              })

              setMembers(prev => prev.map(m => m.id === selectedMember.id ? { ...m, name, phone: phoneVal, points: Number(selectedMember.points || 0) } : m))
              setEditOpen(false)
            } catch (e) {
              console.error('Failed to save membership', e)
              setEditError(e?.message || 'Save failed')
            } finally {
              setSaving(false)
            }
          }} disabled={saving}>{saving ? 'Saving…' : 'Save'}</Button>
        </DialogActions>
      </Dialog>
    </Box>
  )
}
