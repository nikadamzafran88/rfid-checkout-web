import React, { useMemo, useState, useEffect } from 'react'
import { Box, Typography, TextField, Button, Alert, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, IconButton, Chip } from '@mui/material'
import { doc, getDoc, setDoc, serverTimestamp, collection, getDocs, deleteDoc } from 'firebase/firestore'
import { db, rtdb, storage } from '../firebaseConfig'
import { ref as rdbRef, onValue } from 'firebase/database'
import { useLocation, useNavigate } from 'react-router-dom'
import { Trash2, Edit2 } from 'lucide-react'
import PageHeader from '../components/ui/PageHeader'
import SectionCard from '../components/ui/SectionCard'
import { useAuth } from '../context/AuthContext.jsx'
import { logAction } from '../utils/logAction'

import { ref as storageRef, uploadBytesResumable, getDownloadURL } from 'firebase/storage'

export default function StationManagement() {
  const { currentUser, currentRole } = useAuth()
  const [stationId, setStationId] = useState('')
  const [stationName, setStationName] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [loading, setLoading] = useState(false)

  const [stations, setStations] = useState([])
  const [listLoading, setListLoading] = useState(false)
  const [presenceByStation, setPresenceByStation] = useState({})

  const [kioskStationId, setKioskStationId] = useState('')
  const [kioskLoading, setKioskLoading] = useState(false)
  const [kioskSaveLoading, setKioskSaveLoading] = useState(false)
  const [kioskLogoUrl, setKioskLogoUrl] = useState('')
  const [kioskWelcomeMessage, setKioskWelcomeMessage] = useState('')
  const [kioskUploadProgress, setKioskUploadProgress] = useState(0)
  const [kioskUploadLoading, setKioskUploadLoading] = useState(false)
  const [kioskError, setKioskError] = useState('')
  const [kioskSuccess, setKioskSuccess] = useState('')

  const presenceStaleMs = 90 * 1000

  const toMillis = (v) => {
    if (!v) return 0
    if (typeof v === 'number') return Number.isFinite(v) ? v : 0
    if (typeof v === 'string') {
      const ms = Date.parse(v)
      return Number.isFinite(ms) ? ms : 0
    }
    if (typeof v === 'object' && typeof v.seconds === 'number') return Math.floor(v.seconds * 1000)
    return 0
  }

  const formatLastSeen = (ms) => {
    if (!ms) return '—'
    const diff = Math.max(0, Date.now() - ms)
    const s = Math.floor(diff / 1000)
    if (s < 60) return `${s}s ago`
    const m = Math.floor(s / 60)
    if (m < 60) return `${m}m ago`
    const h = Math.floor(m / 60)
    return `${h}h ago`
  }

  const location = useLocation()
  const navigate = useNavigate()

  const handleCreate = async (e) => {
    e.preventDefault()
    setError('')
    setSuccess('')
    if (!stationId) return setError('Station ID is required')
    if (!password) return setError('Station password is required')
    setLoading(true)
    try {
      const ref = doc(db, 'stations', stationId)
      const snap = await getDoc(ref)
      if (snap.exists()) {
        setError('Station ID already exists')
        setLoading(false)
        return
      }

      await setDoc(ref, {
        name: stationName || stationId,
        password: password,
        createdAt: serverTimestamp(),
        // Live online/offline is tracked in RTDB `stations_presence/<stationId>`.
        // Keep legacy `status` optional for backwards compatibility.
        status: 'offline'
      })

      await logAction(db, {
        type: 'station_create',
        source: 'StationManagement',
        actorUID: currentUser?.uid || null,
        actorRole: currentRole || null,
        targetId: stationId,
        targetType: 'station',
        message: `Station created: ${stationId}`,
        metadata: { name: stationName || stationId },
      })

      setSuccess(`Station ${stationId} created`)
      setStationId('')
      setStationName('')
      setPassword('')
    } catch (err) {
      console.error('create station error', err)
      setError('Failed to create station')
    } finally {
      setLoading(false)
    }
  }

  const fetchStations = async () => {
    setListLoading(true)
    try {
      const col = collection(db, 'stations')
      const snap = await getDocs(col)
      const list = snap.docs.map(d => ({ id: d.id, ...d.data() }))
      setStations(list)
    } catch (err) {
      console.error('fetch stations failed', err)
    } finally {
      setListLoading(false)
    }
  }

  useEffect(() => { fetchStations() }, [])

  useEffect(() => {
    const load = async () => {
      if (!kioskStationId) return
      setKioskError('')
      setKioskSuccess('')
      setKioskLoading(true)
      try {
        const snap = await getDoc(doc(db, 'stations', kioskStationId))
        const data = snap.exists() ? (snap.data() || {}) : {}
        setKioskLogoUrl(String(data.kioskLogoUrl || '').trim())
        setKioskWelcomeMessage(String(data.kioskWelcomeMessage || '').trim())
      } catch (e) {
        console.error('load kiosk setup failed', e)
        setKioskError('Failed to load kiosk setup')
      } finally {
        setKioskLoading(false)
      }
    }
    load()
  }, [kioskStationId])

  const uploadKioskLogo = async (file) => {
    if (!kioskStationId) return
    if (!file) return
    setKioskError('')
    setKioskSuccess('')
    setKioskUploadProgress(0)
    setKioskUploadLoading(true)
    try {
      const safeName = String(file.name || 'logo').replace(/[^a-zA-Z0-9._-]+/g, '_')
      const path = `branding/kiosk-logo/${kioskStationId}/${Date.now()}_${safeName}`
      const r = storageRef(storage, path)
      const task = uploadBytesResumable(r, file, { contentType: file.type || 'image/*' })

      const url = await new Promise((resolve, reject) => {
        task.on(
          'state_changed',
          (snap) => {
            const total = snap.totalBytes || 0
            const transferred = snap.bytesTransferred || 0
            const pct = total ? Math.round((transferred / total) * 100) : 0
            setKioskUploadProgress(pct)
          },
          (err) => reject(err),
          async () => {
            try {
              const dl = await getDownloadURL(task.snapshot.ref)
              resolve(dl)
            } catch (e) {
              reject(e)
            }
          }
        )
      })

      await setDoc(doc(db, 'stations', kioskStationId), { kioskLogoUrl: url, kioskBrandingUpdatedAt: serverTimestamp() }, { merge: true })
      setKioskLogoUrl(url)

      await logAction(db, {
        type: 'station_kiosk_logo_update',
        source: 'StationManagement',
        actorUID: currentUser?.uid || null,
        actorRole: currentRole || null,
        targetId: kioskStationId,
        targetType: 'station',
        message: `Kiosk logo updated for station ${kioskStationId}`,
      })

      setKioskSuccess('Logo uploaded')
    } catch (e) {
      console.error('kiosk logo upload failed', e)
      setKioskError(e?.message || 'Failed to upload logo')
    } finally {
      setKioskUploadLoading(false)
    }
  }

  const saveKioskMessage = async () => {
    if (!kioskStationId) return
    setKioskError('')
    setKioskSuccess('')
    setKioskSaveLoading(true)
    try {
      await setDoc(
        doc(db, 'stations', kioskStationId),
        { kioskWelcomeMessage: String(kioskWelcomeMessage || ''), kioskBrandingUpdatedAt: serverTimestamp() },
        { merge: true }
      )

      await logAction(db, {
        type: 'station_kiosk_message_update',
        source: 'StationManagement',
        actorUID: currentUser?.uid || null,
        actorRole: currentRole || null,
        targetId: kioskStationId,
        targetType: 'station',
        message: `Kiosk welcome message updated for station ${kioskStationId}`,
      })

      setKioskSuccess('Welcome message saved')
    } catch (e) {
      console.error('save kiosk message failed', e)
      setKioskError('Failed to save welcome message')
    } finally {
      setKioskSaveLoading(false)
    }
  }

  // Subscribe to RTDB presence for all stations (live online/offline).
  useEffect(() => {
    const root = rdbRef(rtdb, 'stations_presence')
    const unsub = onValue(root, (snap) => {
      const v = snap.val() || {}
      setPresenceByStation(v)
    })
    return () => {
      try { unsub() } catch { /* ignore */ }
    }
  }, [])

  const mergedStations = useMemo(() => {
    const now = Date.now()
    return (stations || []).map((s) => {
      const p = presenceByStation?.[s.id] || null
      const lastSeenMs = toMillis(p?.lastSeen)
      const onlineFlag = p?.online === true
      const isStale = lastSeenMs ? (now - lastSeenMs > presenceStaleMs) : true
      const online = onlineFlag && !isStale
      return {
        ...s,
        liveOnline: online,
        liveLastSeenMs: lastSeenMs,
      }
    })
  }, [stations, presenceByStation])

  const handleDelete = async (id) => {
    if (!confirm(`Delete station ${id}? This cannot be undone.`)) return
    try {
      await deleteDoc(doc(db, 'stations', id))
      setStations(s => s.filter(x => x.id !== id))

      await logAction(db, {
        type: 'station_delete',
        source: 'StationManagement',
        actorUID: currentUser?.uid || null,
        actorRole: currentRole || null,
        targetId: id,
        targetType: 'station',
        message: `Station deleted: ${id}`,
      })
    } catch (err) {
      console.error('delete station failed', err)
      setError('Failed to delete station')
    }
  }

  // Render list or create form depending on route
  const showingCreate = location.pathname.endsWith('/create')

  return (
    <Box sx={{ p: 3 }}>
      <PageHeader
        title="Station Management"
        subtitle="Create and manage checkout stations stored in Firestore."
        actions={
          !showingCreate ? (
            <Button variant="contained" onClick={() => navigate('create')}>Create Station</Button>
          ) : (
            <Button variant="outlined" onClick={() => navigate('/admin/stations')}>Back to list</Button>
          )
        }
      />

      {!showingCreate && (
        <SectionCard title="Station List" sx={{ mb: 2 }}>
          <TableContainer>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Station ID</TableCell>
                  <TableCell>Name</TableCell>
                  <TableCell>Live Status</TableCell>
                  <TableCell>Created</TableCell>
                  <TableCell>Actions</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {listLoading ? (
                  <TableRow>
                    <TableCell colSpan={5} sx={{ py: 3, textAlign: 'center' }}>
                      Loading stations…
                    </TableCell>
                  </TableRow>
                ) : mergedStations.map(s => (
                  <TableRow key={s.id}>
                    <TableCell>{s.id}</TableCell>
                    <TableCell>{s.name}</TableCell>
                    <TableCell>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
                        <Chip
                          size="small"
                          label={s.liveOnline ? 'Online' : 'Offline'}
                          sx={{
                            bgcolor: s.liveOnline ? 'success.light' : 'error.light',
                            color: s.liveOnline ? 'success.dark' : 'error.dark',
                            fontWeight: 700,
                          }}
                        />
                        <Typography variant="caption" color="text.secondary">
                          Last seen: {formatLastSeen(s.liveLastSeenMs)}
                        </Typography>
                      </Box>
                    </TableCell>
                    <TableCell>{s.createdAt ? new Date(s.createdAt.seconds * 1000).toLocaleString() : '—'}</TableCell>
                    <TableCell>
                      <Button
                        size="small"
                        variant={kioskStationId === s.id ? 'contained' : 'outlined'}
                        onClick={() => setKioskStationId(s.id)}
                        sx={{ mr: 1, textTransform: 'none' }}
                      >
                        Kiosk Setup
                      </Button>
                      <IconButton size="small" onClick={() => navigate(`create?edit=${s.id}`)}><Edit2 size={14} /></IconButton>
                      <IconButton size="small" color="error" onClick={() => handleDelete(s.id)}><Trash2 size={14} /></IconButton>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        </SectionCard>
      )}

      {!showingCreate && kioskStationId && (
        <SectionCard title="Kiosk Setup" subtitle={`Configure the kiosk landing page for station: ${kioskStationId}`} sx={{ mb: 2 }}>
          {kioskError ? <Alert severity="error" sx={{ mb: 2 }}>{kioskError}</Alert> : null}
          {kioskSuccess ? <Alert severity="success" sx={{ mb: 2 }}>{kioskSuccess}</Alert> : null}

          {kioskLoading ? (
            <Typography variant="body2" color="text.secondary">Loading kiosk setup…</Typography>
          ) : (
            <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' }, gap: 2 }}>
              <Box>
                <Typography sx={{ fontWeight: 700, mb: 1 }}>Logo</Typography>
                <Box
                  sx={{
                    border: '1px solid',
                    borderColor: 'divider',
                    borderRadius: 1.5,
                    bgcolor: 'background.default',
                    p: 2,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    minHeight: 140,
                    mb: 1,
                  }}
                >
                  {kioskLogoUrl ? (
                    <Box component="img" src={kioskLogoUrl} alt="Kiosk Logo" sx={{ maxHeight: 96, maxWidth: '100%', objectFit: 'contain' }} />
                  ) : (
                    <Typography variant="body2" color="text.secondary">No logo uploaded</Typography>
                  )}
                </Box>

                <Button variant="contained" component="label" disabled={kioskUploadLoading} sx={{ textTransform: 'none' }}>
                  {kioskUploadLoading ? `Uploading… ${kioskUploadProgress}%` : 'Upload Logo'}
                  <input
                    hidden
                    type="file"
                    accept="image/*"
                    onChange={(e) => {
                      const f = e.target.files && e.target.files[0]
                      e.target.value = ''
                      uploadKioskLogo(f)
                    }}
                  />
                </Button>
                <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.75 }}>
                  Tip: PNG with transparent background works best.
                </Typography>
              </Box>

              <Box>
                <Typography sx={{ fontWeight: 700, mb: 1 }}>Welcome Message</Typography>
                <TextField
                  value={kioskWelcomeMessage}
                  onChange={(e) => setKioskWelcomeMessage(e.target.value)}
                  placeholder="Example: Welcome to Uniqlo\nScan your items to begin"
                  fullWidth
                  multiline
                  minRows={4}
                />
                <Box sx={{ display: 'flex', gap: 1, mt: 1.25 }}>
                  <Button variant="contained" onClick={saveKioskMessage} disabled={kioskSaveLoading}>
                    {kioskSaveLoading ? 'Saving…' : 'Save Message'}
                  </Button>
                  <Button variant="outlined" onClick={() => { setKioskStationId(''); setKioskError(''); setKioskSuccess('') }}>
                    Close
                  </Button>
                </Box>
              </Box>
            </Box>
          )}
        </SectionCard>
      )}

      {showingCreate && (
        <SectionCard title="Create Station" sx={{ maxWidth: 640 }}>
          {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
          {success && <Alert severity="success" sx={{ mb: 2 }}>{success}</Alert>}

          <Box component="form" onSubmit={handleCreate}>
            <TextField label="Station ID" value={stationId} onChange={(e) => setStationId(e.target.value)} fullWidth sx={{ mb: 2 }} helperText="e.g. station_01" />
            <TextField label="Station Name" value={stationName} onChange={(e) => setStationName(e.target.value)} fullWidth sx={{ mb: 2 }} />
            <TextField label="Station Password" value={password} onChange={(e) => setPassword(e.target.value)} fullWidth sx={{ mb: 2 }} type="password" />

            <Box sx={{ display: 'flex', gap: 2 }}>
              <Button type="submit" variant="contained" disabled={loading}>Create Station</Button>
              <Button variant="outlined" onClick={() => navigate('/admin/stations')}>Back to list</Button>
            </Box>
          </Box>
        </SectionCard>
      )}
    </Box>
  )
}
