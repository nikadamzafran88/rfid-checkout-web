import React, { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Alert,
  Box,
  Button,
  ButtonGroup,
  Checkbox,
  CircularProgress,
  FormControlLabel,
  FormControl,
  IconButton,
  InputLabel,
  MenuItem,
  Paper,
  Select,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TablePagination,
  TableRow,
  TextField,
  Tooltip,
  Typography,
  useTheme,
} from '@mui/material'
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline'
import RestoreFromTrashIcon from '@mui/icons-material/RestoreFromTrash'
import { collection, deleteDoc, doc, getDocs, serverTimestamp, setDoc } from 'firebase/firestore'
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

function toDateKey(ts) {
  const ms = toMs(ts)
  if (!ms) return 'unknown'
  try {
    return new Date(ms).toISOString().slice(0, 10)
  } catch {
    return 'unknown'
  }
}

function formatDateTime(ms) {
  if (!ms) return '—'
  try {
    return new Date(ms).toLocaleString()
  } catch {
    return '—'
  }
}

function formatRM(v) {
  const n = safeNumber(v, 0)
  return `RM${n.toFixed(2)}`
}

function isPaidTx(tx) {
  const status = String(tx?.paymentStatus ?? tx?.payment_status ?? tx?.status ?? '').toLowerCase()
  if (!status) return true
  if (status.includes('fail') || status.includes('failed') || status.includes('cancel') || status.includes('cancelled') || status.includes('unpaid')) return false
  if (status.includes('paid') || status.includes('success') || status.includes('completed')) return true
  return true
}

function getItemQuantity(it) {
  const q = safeNumber(it?.quantity ?? it?.qty ?? it?.count, 1)
  return Math.max(1, Math.floor(q))
}

function getItemProductId(it) {
  const productId = it?.productId ?? it?.productID ?? it?.id ?? ''
  return String(productId || '').trim()
}

function isUnknownProductId(productId) {
  return productId.startsWith('unknown_')
}

function getUnitCostFromProduct(prod) {
  const raw = prod?.cost ?? prod?.cost_price ?? prod?.costPrice ?? prod?.cogs
  const unitCost = safeNumber(raw, NaN)
  if (!Number.isFinite(unitCost) || unitCost < 0) return null
  return unitCost
}

function getUnitPriceFromItemOrProduct(it, prod) {
  const fromItem = safeNumber(it?.price, NaN)
  if (Number.isFinite(fromItem) && fromItem >= 0) return fromItem
  const fromProduct = safeNumber(prod?.price ?? prod?.sellingPrice ?? prod?.sellPrice, NaN)
  if (Number.isFinite(fromProduct) && fromProduct >= 0) return fromProduct
  return 0
}

function buildSoldItemRows({ transactions, productsById, hiddenProductIds, showHidden, fromDate, toDate, search, sortBy }) {
  const txList = Array.isArray(transactions) ? transactions : []
  const q = String(search || '').trim().toLowerCase()

  const inRange = (dateKey) => {
    if (fromDate && dateKey < fromDate) return false
    if (toDate && dateKey > toDate) return false
    return true
  }

  const paidTx = txList
    .map((t) => {
      const ms = toMs(t.timestamp ?? t.createdAt ?? t.created_at)
      return { ...t, __ms: ms ?? 0, __dateKey: toDateKey(t.timestamp ?? t.createdAt ?? t.created_at) }
    })
    .filter((t) => inRange(t.__dateKey))
    .filter((t) => isPaidTx(t))

  const map = new Map()

  for (const tx of paidTx) {
    const txMs = safeNumber(tx.__ms, 0)
    const items = Array.isArray(tx?.items) ? tx.items : []
    for (const it of items) {
      if (!it || typeof it !== 'object') continue

      const productId = getItemProductId(it)
      if (!productId || isUnknownProductId(productId)) continue

      const prod = productsById?.get?.(productId)
      const sku = String(it?.sku ?? prod?.sku ?? '').trim()
      const name = String(it?.name ?? it?.productName ?? prod?.name ?? '').trim()
      const category = String(prod?.category || '').trim() || 'Uncategorized'
      const qty = getItemQuantity(it)

      const unitPrice = getUnitPriceFromItemOrProduct(it, prod)
      const revenue = safeNumber(unitPrice, 0) * qty

      const unitCost = getUnitCostFromProduct(prod)
      const cost = unitCost !== null ? (unitCost * qty) : null
      const grossProfit = cost !== null ? (revenue - cost) : null

      const prev = map.get(productId)
      if (!prev) {
        map.set(productId, {
          productId,
          sku,
          name: name || sku || productId,
          category,
          soldQty: qty,
          revenue,
          cost,
          grossProfit,
          lastSoldMs: txMs || 0,
        })
      } else {
        prev.soldQty += qty
        prev.revenue += revenue
        if (prev.cost !== null && cost !== null) prev.cost += cost
        else if (prev.cost === null && cost !== null) prev.cost = cost
        if (prev.grossProfit !== null && grossProfit !== null) prev.grossProfit += grossProfit
        else if (prev.grossProfit === null && grossProfit !== null) prev.grossProfit = grossProfit
        if (!prev.sku && sku) prev.sku = sku
        if (!prev.name && name) prev.name = name
        if (!prev.category && category) prev.category = category
        if (txMs && txMs > (prev.lastSoldMs || 0)) prev.lastSoldMs = txMs
      }
    }
  }

  const hiddenSet = hiddenProductIds instanceof Set ? hiddenProductIds : new Set()

  let rows = Array.from(map.values()).map((r) => {
    const avgPrice = r.soldQty > 0 ? (safeNumber(r.revenue, 0) / safeNumber(r.soldQty, 0)) : 0
    const margin = (r.grossProfit !== null && safeNumber(r.revenue, 0) > 0)
      ? (safeNumber(r.grossProfit, 0) / safeNumber(r.revenue, 0))
      : null
    return { ...r, avgPrice, margin, hidden: hiddenSet.has(r.productId) }
  })

  if (!showHidden) {
    rows = rows.filter((r) => !r.hidden)
  }

  if (q) {
    rows = rows.filter((r) => {
      const hay = `${r.name || ''} ${r.sku || ''} ${r.productId || ''} ${r.category || ''}`.toLowerCase()
      return hay.includes(q)
    })
  }

  const sorter = {
    qty_desc: (a, b) => safeNumber(b.soldQty, 0) - safeNumber(a.soldQty, 0),
    revenue_desc: (a, b) => safeNumber(b.revenue, 0) - safeNumber(a.revenue, 0),
    profit_desc: (a, b) => safeNumber(b.grossProfit, 0) - safeNumber(a.grossProfit, 0),
    last_sold_desc: (a, b) => safeNumber(b.lastSoldMs, 0) - safeNumber(a.lastSoldMs, 0),
    name_asc: (a, b) => String(a.name || '').localeCompare(String(b.name || '')),
  }[sortBy] || ((a, b) => safeNumber(b.revenue, 0) - safeNumber(a.revenue, 0))

  rows.sort(sorter)

  const totals = rows.reduce(
    (acc, r) => {
      acc.uniqueProducts += 1
      acc.totalUnits += safeNumber(r.soldQty, 0)
      acc.totalRevenue += safeNumber(r.revenue, 0)
      if (r.grossProfit !== null) {
        acc.totalGrossProfit += safeNumber(r.grossProfit, 0)
        acc.coveredRevenue += safeNumber(r.revenue, 0)
      }
      return acc
    },
    { uniqueProducts: 0, totalUnits: 0, totalRevenue: 0, totalGrossProfit: 0, coveredRevenue: 0 }
  )

  const coverage = totals.totalRevenue > 0 ? (totals.coveredRevenue / totals.totalRevenue) : 0
  return { rows, totals: { ...totals, coverage }, paidTxCount: paidTx.length }
}

export default function SoldItems() {
  const theme = useTheme()
  const { currentRole, currentUser } = useAuth()
  const isAdmin = String(currentRole || '').toLowerCase() === 'admin'
  const navigate = useNavigate()

  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [transactions, setTransactions] = useState([])
  const [productsById, setProductsById] = useState(() => new Map())
  const [hiddenProductIds, setHiddenProductIds] = useState(() => new Set())
  const [showHidden, setShowHidden] = useState(false)

  // Default: last 30 days
  const [fromDate, setFromDate] = useState(() => {
    const now = new Date()
    const from = new Date(now)
    from.setDate(from.getDate() - 29)
    return from.toISOString().slice(0, 10)
  })
  const [toDate, setToDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [search, setSearch] = useState('')
  const [sortBy, setSortBy] = useState('revenue_desc')

  const [page, setPage] = useState(0)
  const [rowsPerPage, setRowsPerPage] = useState(10)

  const setPreset = (preset) => {
    const now = new Date()
    const todayKey = now.toISOString().slice(0, 10)
    if (preset === 'ALL') {
      setFromDate('')
      setToDate(todayKey)
      return
    }
    const days = preset === '7D' ? 7 : preset === '30D' ? 30 : preset === '90D' ? 90 : 30
    const from = new Date(now)
    from.setDate(from.getDate() - (days - 1))
    setFromDate(from.toISOString().slice(0, 10))
    setToDate(todayKey)
  }

  const refresh = async () => {
    setLoading(true)
    setError('')
    try {
      const [txSnap, productsSnap] = await Promise.all([
        getDocs(collection(db, 'transactions')),
        getDocs(collection(db, 'products')),
      ])
      const list = txSnap.docs.map((d) => ({ id: d.id, ...d.data() }))
      setTransactions(list)
      const productsList = productsSnap.docs.map((d) => ({ id: d.id, ...d.data() }))
      setProductsById(new Map(productsList.map((p) => [p.id, p])))

      // Hidden products (soft-delete from report)
      try {
        const hiddenSnap = await getDocs(collection(db, 'sold_items_hidden'))
        const next = new Set()
        hiddenSnap.docs.forEach((d) => {
          const data = d.data() || {}
          if (data.hidden === true) next.add(d.id)
        })
        setHiddenProductIds(next)
      } catch (e) {
        // If rules block this collection, we still want the page usable.
        console.warn('Failed to load sold_items_hidden. Continuing without hidden list.', e)
        setHiddenProductIds(new Set())
      }
    } catch (e) {
      console.error('Failed to load sold items data', e)
      setError(e?.message || 'Failed to load sold items data.')
      setTransactions([])
      setProductsById(new Map())
      setHiddenProductIds(new Set())
    } finally {
      setLoading(false)
    }
  }

  const hideFromReport = async (productId) => {
    const pid = String(productId || '').trim()
    if (!isAdmin || !pid) return
    const ok = window.confirm('Remove this product from the Sold Items report?\n\nThis will NOT delete transaction history.')
    if (!ok) return

    try {
      await setDoc(
        doc(db, 'sold_items_hidden', pid),
        {
          hidden: true,
          hiddenAt: serverTimestamp(),
          hiddenBy: currentUser?.uid || null,
        },
        { merge: true }
      )
      setHiddenProductIds((prev) => {
        const next = new Set(prev instanceof Set ? Array.from(prev) : [])
        next.add(pid)
        return next
      })
    } catch (e) {
      console.error('Failed to hide sold item', e)
      setError(e?.message || 'Failed to delete from Sold Items.')
    }
  }

  const restoreToReport = async (productId) => {
    const pid = String(productId || '').trim()
    if (!isAdmin || !pid) return
    const ok = window.confirm('Restore this product back into the Sold Items report?')
    if (!ok) return

    try {
      await deleteDoc(doc(db, 'sold_items_hidden', pid))
      setHiddenProductIds((prev) => {
        const next = new Set(prev instanceof Set ? Array.from(prev) : [])
        next.delete(pid)
        return next
      })
    } catch (e) {
      console.error('Failed to restore sold item', e)
      setError(e?.message || 'Failed to restore item.')
    }
  }

  useEffect(() => {
    refresh()
  }, [])

  useEffect(() => {
    setPage(0)
  }, [fromDate, toDate, search, sortBy, showHidden])

  const computed = useMemo(
    () => buildSoldItemRows({ transactions, productsById, hiddenProductIds, showHidden, fromDate, toDate, search, sortBy }),
    [transactions, productsById, hiddenProductIds, showHidden, fromDate, toDate, search, sortBy]
  )
  const rows = computed.rows
  const totals = computed.totals
  const paidTxCount = computed.paidTxCount

  const showActions = isAdmin

  const pagedRows = useMemo(() => {
    const start = page * rowsPerPage
    return rows.slice(start, start + rowsPerPage)
  }, [rows, page, rowsPerPage])

  return (
    <Box sx={{ p: 3, display: 'flex', flexDirection: 'column', gap: 2 }}>
      <PageHeader
        title="Sold Items"
        subtitle="Item-level sales breakdown (paid transactions only), with revenue and profit from your product master." 
        actions={(
          <>
            {isAdmin && (
              <Button variant="outlined" onClick={() => navigate('/admin/sold-items/deleted')}>
                Deleted Items
              </Button>
            )}
            <Button variant="outlined" onClick={refresh} disabled={loading}>Refresh</Button>
          </>
        )}
      />

      <SectionCard
        title="Filters"
        subtitle="Use date range and search to focus your sold items list."
        actions={(
          <ButtonGroup variant="outlined" size="small">
            <Button onClick={() => setPreset('7D')}>7D</Button>
            <Button onClick={() => setPreset('30D')}>30D</Button>
            <Button onClick={() => setPreset('90D')}>90D</Button>
            <Button onClick={() => setPreset('ALL')}>ALL</Button>
          </ButtonGroup>
        )}
      >
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1.5, alignItems: 'center' }}>
          <TextField
            label="From"
            type="date"
            size="small"
            value={fromDate}
            onChange={(e) => setFromDate(e.target.value)}
            InputLabelProps={{ shrink: true }}
            sx={{ minWidth: 170 }}
          />
          <TextField
            label="To"
            type="date"
            size="small"
            value={toDate}
            onChange={(e) => setToDate(e.target.value)}
            InputLabelProps={{ shrink: true }}
            sx={{ minWidth: 170 }}
          />
          <TextField
            label="Search"
            placeholder="Name / SKU / Product ID / Category"
            size="small"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            sx={{ minWidth: { xs: '100%', sm: 360 } }}
          />

          <FormControl size="small" sx={{ minWidth: 220 }}>
            <InputLabel id="sold-items-sort">Sort by</InputLabel>
            <Select
              labelId="sold-items-sort"
              label="Sort by"
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value)}
            >
              <MenuItem value="revenue_desc">Revenue (high → low)</MenuItem>
              <MenuItem value="qty_desc">Quantity sold (high → low)</MenuItem>
              <MenuItem value="profit_desc">Gross profit (high → low)</MenuItem>
              <MenuItem value="last_sold_desc">Last sold (new → old)</MenuItem>
              <MenuItem value="name_asc">Product name (A → Z)</MenuItem>
            </Select>
          </FormControl>

          {isAdmin && (
            <FormControlLabel
              control={<Checkbox checked={showHidden} onChange={(e) => setShowHidden(e.target.checked)} />}
              label="Show deleted"
              sx={{ ml: { xs: 0, sm: 1 } }}
            />
          )}
        </Box>
      </SectionCard>

      {loading && (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <CircularProgress size={18} />
          <Typography variant="body2">Loading…</Typography>
        </Box>
      )}

      {error && <Alert severity="error">{error}</Alert>}

      {!loading && !error && (
        <>
          <SectionCard title="Overview" subtitle="Quick totals for the selected range.">
            <Box
              sx={{
                display: 'grid',
                gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr', lg: '1fr 1fr 1fr 1fr' },
                gap: 1.5,
              }}
            >
              <Paper variant="outlined" sx={{ p: 2, borderRadius: 2 }}>
                <Typography variant="caption" color="text.secondary">Paid transactions</Typography>
                <Typography variant="h5" sx={{ fontWeight: 750 }}>{paidTxCount}</Typography>
              </Paper>
              <Paper variant="outlined" sx={{ p: 2, borderRadius: 2 }}>
                <Typography variant="caption" color="text.secondary">Unique products sold</Typography>
                <Typography variant="h5" sx={{ fontWeight: 750 }}>{totals.uniqueProducts}</Typography>
              </Paper>
              <Paper variant="outlined" sx={{ p: 2, borderRadius: 2 }}>
                <Typography variant="caption" color="text.secondary">Units sold</Typography>
                <Typography variant="h5" sx={{ fontWeight: 750 }}>{totals.totalUnits}</Typography>
              </Paper>
              <Paper variant="outlined" sx={{ p: 2, borderRadius: 2 }}>
                <Typography variant="caption" color="text.secondary">Item revenue</Typography>
                <Typography variant="h5" sx={{ fontWeight: 750 }}>{formatRM(totals.totalRevenue)}</Typography>
                <Typography variant="caption" color="text.secondary">
                  Profit coverage: {(safeNumber(totals.coverage, 0) * 100).toFixed(0)}%
                </Typography>
              </Paper>

              <Paper
                variant="outlined"
                sx={{
                  p: 2,
                  borderRadius: 2,
                  gridColumn: { xs: 'auto', lg: 'span 2' },
                  borderColor: theme.palette.divider,
                }}
              >
                <Typography variant="caption" color="text.secondary">Gross profit (known cost only)</Typography>
                <Typography variant="h5" sx={{ fontWeight: 750 }}>{formatRM(totals.totalGrossProfit)}</Typography>
              </Paper>

              <Paper
                variant="outlined"
                sx={{
                  p: 2,
                  borderRadius: 2,
                  gridColumn: { xs: 'auto', lg: 'span 2' },
                  borderColor: theme.palette.divider,
                }}
              >
                <Typography variant="caption" color="text.secondary">Average selling price</Typography>
                <Typography variant="h5" sx={{ fontWeight: 750 }}>
                  {totals.totalUnits > 0 ? formatRM(totals.totalRevenue / totals.totalUnits) : formatRM(0)}
                </Typography>
              </Paper>
            </Box>
          </SectionCard>

          <SectionCard title={`Sold Items (${rows.length})`} subtitle="Per-product totals aggregated from transaction items.">
            <Table size="small" stickyHeader>
              <TableHead>
                <TableRow>
                  <TableCell sx={{ fontWeight: 700 }}>Product</TableCell>
                  <TableCell sx={{ fontWeight: 700 }}>Category</TableCell>
                  <TableCell sx={{ fontWeight: 700 }}>SKU</TableCell>
                  <TableCell sx={{ fontWeight: 700 }} align="right">Qty</TableCell>
                  <TableCell sx={{ fontWeight: 700 }} align="right">Revenue (RM)</TableCell>
                  <TableCell sx={{ fontWeight: 700 }} align="right">Avg Price (RM)</TableCell>
                  <TableCell sx={{ fontWeight: 700 }} align="right">Gross Profit (RM)</TableCell>
                  <TableCell sx={{ fontWeight: 700 }} align="right">Margin</TableCell>
                  <TableCell sx={{ fontWeight: 700 }}>Last Sold</TableCell>
                  {showActions && (
                    <TableCell sx={{ fontWeight: 700 }} align="right">Actions</TableCell>
                  )}
                </TableRow>
              </TableHead>
              <TableBody>
                {pagedRows.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={showActions ? 10 : 9}>
                      <Typography variant="body2" color="text.secondary">No sold items found for the selected filters.</Typography>
                    </TableCell>
                  </TableRow>
                ) : (
                  pagedRows.map((r) => (
                    <TableRow key={r.productId} hover sx={r.hidden ? { opacity: 0.55 } : null}>
                      <TableCell>
                        <Typography sx={{ fontWeight: 650 }}>{r.name}</Typography>
                        <Typography variant="caption" color="text.secondary">Product ID: {r.productId}</Typography>
                      </TableCell>
                      <TableCell>{r.category || 'Uncategorized'}</TableCell>
                      <TableCell>{r.sku || '—'}</TableCell>
                      <TableCell align="right">{safeNumber(r.soldQty, 0)}</TableCell>
                      <TableCell align="right">{formatRM(r.revenue)}</TableCell>
                      <TableCell align="right">{formatRM(r.avgPrice)}</TableCell>
                      <TableCell align="right">{r.grossProfit === null ? '—' : formatRM(r.grossProfit)}</TableCell>
                      <TableCell align="right">
                        {r.margin === null ? '—' : `${(safeNumber(r.margin, 0) * 100).toFixed(0)}%`}
                      </TableCell>
                      <TableCell>{formatDateTime(r.lastSoldMs)}</TableCell>

                      {showActions && (
                        <TableCell align="right">
                          {r.hidden ? (
                            <Tooltip title="Restore to Sold Items">
                              <IconButton size="small" onClick={() => restoreToReport(r.productId)}>
                                <RestoreFromTrashIcon fontSize="small" />
                              </IconButton>
                            </Tooltip>
                          ) : (
                            <Tooltip title="Delete from Sold Items (hide from report)">
                              <IconButton size="small" color="error" onClick={() => hideFromReport(r.productId)}>
                                <DeleteOutlineIcon fontSize="small" />
                              </IconButton>
                            </Tooltip>
                          )}
                        </TableCell>
                      )}
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>

            <TablePagination
              component="div"
              count={rows.length}
              page={page}
              onPageChange={(_, nextPage) => setPage(nextPage)}
              rowsPerPage={rowsPerPage}
              onRowsPerPageChange={(e) => {
                setRowsPerPage(parseInt(e.target.value, 10))
                setPage(0)
              }}
              rowsPerPageOptions={[10, 25, 50, 100]}
            />
          </SectionCard>
        </>
      )}
    </Box>
  )
}
