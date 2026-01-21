import React, { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  IconButton,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Tooltip,
  Typography,
} from '@mui/material'
import DeleteForeverIcon from '@mui/icons-material/DeleteForever'
import RestoreFromTrashIcon from '@mui/icons-material/RestoreFromTrash'
import { collection, deleteDoc, doc, getDocs } from 'firebase/firestore'
import { db } from '../firebaseConfig'
import PageHeader from '../components/ui/PageHeader'
import SectionCard from '../components/ui/SectionCard'
import { useAuth } from '../context/AuthContext.jsx'

function safeNumber(v, fallback = 0) {
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : fallback
}

function toMs(ts) {
  if (!ts) return null
  if (typeof ts?.toDate === 'function') return ts.toDate().getTime()
  if (typeof ts === 'object' && ts?.seconds) return Number(ts.seconds) * 1000
  if (typeof ts === 'number') return ts
  const d = new Date(ts)
  if (Number.isNaN(d.getTime())) return null
  return d.getTime()
}

function formatDateTime(ts) {
  const ms = toMs(ts)
  if (!ms) return '—'
  try {
    return new Date(ms).toLocaleString()
  } catch {
    return '—'
  }
}

export default function DeletedSoldItems() {
  const navigate = useNavigate()
  const { currentRole } = useAuth()
  const isAdmin = String(currentRole || '').toLowerCase() === 'admin'

  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [hiddenDocs, setHiddenDocs] = useState([])
  const [productsById, setProductsById] = useState(() => new Map())

  const refresh = async () => {
    setLoading(true)
    setError('')
    try {
      const [hiddenSnap, productsSnap] = await Promise.all([
        getDocs(collection(db, 'sold_items_hidden')),
        getDocs(collection(db, 'products')),
      ])

      const hiddenList = hiddenSnap.docs
        .map((d) => ({ id: d.id, ...d.data() }))
        .filter((x) => x?.hidden === true)
        .sort((a, b) => safeNumber(toMs(b.hiddenAt), 0) - safeNumber(toMs(a.hiddenAt), 0))

      setHiddenDocs(hiddenList)

      const productsList = productsSnap.docs.map((d) => ({ id: d.id, ...d.data() }))
      setProductsById(new Map(productsList.map((p) => [p.id, p])))
    } catch (e) {
      console.error('Failed to load deleted sold items', e)
      setError(e?.message || 'Failed to load deleted items.')
      setHiddenDocs([])
      setProductsById(new Map())
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    refresh()
  }, [])

  const rows = useMemo(() => {
    return (hiddenDocs || []).map((h) => {
      const prod = productsById.get(h.id)
      return {
        productId: h.id,
        name: String(prod?.name || '').trim() || h.id,
        sku: String(prod?.sku || '').trim(),
        category: String(prod?.category || '').trim() || 'Uncategorized',
        hiddenAt: h.hiddenAt,
        hiddenBy: h.hiddenBy,
      }
    })
  }, [hiddenDocs, productsById])

  const restore = async (productId) => {
    const pid = String(productId || '').trim()
    if (!isAdmin || !pid) return

    const ok = window.confirm('Restore this product back into the Sold Items report?')
    if (!ok) return

    try {
      await deleteDoc(doc(db, 'sold_items_hidden', pid))
      setHiddenDocs((prev) => (prev || []).filter((x) => x.id !== pid))
    } catch (e) {
      console.error('Failed to restore deleted sold item', e)
      setError(e?.message || 'Failed to restore item.')
    }
  }

  const deleteFromDatabase = async (productId) => {
    const pid = String(productId || '').trim()
    if (!isAdmin || !pid) return

    const ok1 = window.confirm(
      'Permanently delete this product from Firestore?\n\nThis will delete:\n- products/' + pid + '\n- inventory/' + pid + '\n\nIt will NOT delete past transactions history.'
    )
    if (!ok1) return

    const ok2 = window.confirm('Are you sure? This cannot be undone.')
    if (!ok2) return

    try {
      await Promise.all([
        deleteDoc(doc(db, 'products', pid)),
        deleteDoc(doc(db, 'inventory', pid)),
        // Clean up the hidden marker so it doesn't show here again
        deleteDoc(doc(db, 'sold_items_hidden', pid)),
      ])

      setHiddenDocs((prev) => (prev || []).filter((x) => x.id !== pid))
      setProductsById((prev) => {
        const next = new Map(prev instanceof Map ? Array.from(prev.entries()) : [])
        next.delete(pid)
        return next
      })
    } catch (e) {
      console.error('Failed to permanently delete product', e)
      setError(e?.message || 'Failed to delete product from database.')
    }
  }

  return (
    <Box sx={{ p: 3, display: 'flex', flexDirection: 'column', gap: 2 }}>
      <PageHeader
        title="Deleted Sold Items"
        subtitle="Items hidden from the Sold Items report (transaction history is not deleted)."
        actions={(
          <>
            <Button variant="outlined" onClick={() => navigate('/admin/sold-items')}>Back</Button>
            <Button variant="outlined" onClick={refresh} disabled={loading}>Refresh</Button>
          </>
        )}
      />

      {!isAdmin && (
        <Alert severity="warning">Only admins can view and restore deleted sold items.</Alert>
      )}

      {loading && (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <CircularProgress size={18} />
          <Typography variant="body2">Loading…</Typography>
        </Box>
      )}

      {error && <Alert severity="error">{error}</Alert>}

      {isAdmin && !loading && !error && (
        <SectionCard title={`Deleted (${rows.length})`} subtitle="Restore any item to show it again in Sold Items.">
          <Paper variant="outlined" sx={{ borderRadius: 2, overflow: 'hidden' }}>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell sx={{ fontWeight: 700 }}>Product</TableCell>
                  <TableCell sx={{ fontWeight: 700 }}>Category</TableCell>
                  <TableCell sx={{ fontWeight: 700 }}>SKU</TableCell>
                  <TableCell sx={{ fontWeight: 700 }}>Deleted At</TableCell>
                  <TableCell sx={{ fontWeight: 700 }}>Deleted By</TableCell>
                  <TableCell sx={{ fontWeight: 700 }} align="right">Actions</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {rows.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6}>
                      <Typography variant="body2" color="text.secondary">No deleted items.</Typography>
                    </TableCell>
                  </TableRow>
                ) : (
                  rows.map((r) => (
                    <TableRow key={r.productId} hover>
                      <TableCell>
                        <Typography sx={{ fontWeight: 650 }}>{r.name}</Typography>
                        <Typography variant="caption" color="text.secondary">Product ID: {r.productId}</Typography>
                      </TableCell>
                      <TableCell>{r.category}</TableCell>
                      <TableCell>{r.sku || '—'}</TableCell>
                      <TableCell>{formatDateTime(r.hiddenAt)}</TableCell>
                      <TableCell>{r.hiddenBy || '—'}</TableCell>
                      <TableCell align="right">
                        <Tooltip title="Restore to Sold Items">
                          <IconButton size="small" onClick={() => restore(r.productId)}>
                            <RestoreFromTrashIcon fontSize="small" />
                          </IconButton>
                        </Tooltip>
                        <Tooltip title="Delete from database (permanent)">
                          <IconButton size="small" color="error" onClick={() => deleteFromDatabase(r.productId)}>
                            <DeleteForeverIcon fontSize="small" />
                          </IconButton>
                        </Tooltip>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </Paper>
        </SectionCard>
      )}
    </Box>
  )
}
