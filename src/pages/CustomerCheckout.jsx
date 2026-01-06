import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  IconButton,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material'
import FullscreenIcon from '@mui/icons-material/Fullscreen'
import FullscreenExitIcon from '@mui/icons-material/FullscreenExit'
import { TransactionProvider, useTransaction } from '../contexts/TransactionContext'
import Setup from '../components/staff/Setup'
import StartScreen from '../components/kiosk/StartScreen'
import ScanningScreen from '../components/kiosk/ScanningScreen'
import PaymentScreen from '../components/kiosk/PaymentScreen'
import ReceiptScreen from '../components/kiosk/ReceiptScreen'
import { doc, getDoc } from 'firebase/firestore'
import { db } from '../firebaseConfig'
import { LogOut } from 'lucide-react'

function KioskProgress({ step }) {
  const steps = useMemo(
    () => [
      { key: 'IDLE', label: 'Start' },
      { key: 'SCANNING', label: 'Scan' },
      { key: 'PAYMENT', label: 'Pay' },
      { key: 'RECEIPT', label: 'Done' },
    ],
    []
  )

  const activeIdx = Math.max(0, steps.findIndex((s) => s.key === step))

  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: { xs: 1.25, sm: 2 } }}>
      {steps.map((s, idx) => {
        const active = idx === activeIdx
        const done = idx < activeIdx
        return (
          <Box key={s.key} sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
            <Box
              aria-current={active ? 'step' : undefined}
              sx={{
                width: 10,
                height: 10,
                borderRadius: '50%',
                bgcolor: active ? 'primary.main' : done ? 'success.main' : 'action.disabled',
              }}
            />
            <Typography
              variant="caption"
              sx={{
                color: active ? 'text.primary' : 'text.secondary',
                fontWeight: active ? 700 : 500,
                display: { xs: 'none', sm: 'block' },
              }}
            >
              {s.label}
            </Typography>
          </Box>
        )
      })}
    </Box>
  )
}

function KioskHeader() {
  const { stationId, step, idleRemainingSeconds } = useTransaction()
  const [logoUrl, setLogoUrl] = useState('')

  const idleLabel = useMemo(() => {
    const s = Number(idleRemainingSeconds || 0)
    if (!Number.isFinite(s) || s <= 0) return ''
    const mm = Math.floor(s / 60)
    const ss = s % 60
    return `${mm}:${String(ss).padStart(2, '0')}`
  }, [idleRemainingSeconds])

  useEffect(() => {
    let mounted = true
    const load = async () => {
      try {
        let url = ''
        if (stationId) {
          try {
            const s = await getDoc(doc(db, 'stations', String(stationId)))
            const data = s.exists() ? (s.data() || {}) : {}
            url = String(data.kioskLogoUrl || '').trim()
          } catch {
            // ignore
          }
        }
        if (!url) {
          try {
            const snap = await getDoc(doc(db, 'system', 'config'))
            const data = snap.exists() ? (snap.data() || {}) : {}
            url = String(data.kioskLogoUrl || '').trim()
          } catch {
            // ignore
          }
        }
        if (!mounted) return
        setLogoUrl(url)
      } catch {
        // ignore
      }
    }

    load()
    return () => {
      mounted = false
    }
  }, [stationId])

  return (
    <Box className="kiosk-header">
      <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', justifyContent: 'center', gap: 0.5, minWidth: 0 }}>
        {logoUrl ? (
          <Box
            component="img"
            src={logoUrl}
            alt="Logo"
            sx={{ height: { xs: 40, sm: 52 }, width: 'auto', maxWidth: 320, objectFit: 'contain' }}
          />
        ) : null}
      </Box>

      {stationId ? (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: { xs: 1.25, sm: 2 }, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
          <KioskProgress step={step} />
          {(step === 'SCANNING' || step === 'PAYMENT') && idleLabel ? (
            <Box
              sx={{
                px: 1,
                py: 0.5,
                borderRadius: 1,
                border: '1px solid',
                borderColor: 'divider',
                bgcolor: 'background.paper',
                lineHeight: 1,
              }}
            >
              <Typography variant="caption" sx={{ color: 'text.secondary', whiteSpace: 'nowrap' }}>
                Auto reset in <Box component="span" sx={{ color: 'text.primary', fontWeight: 900 }}>{idleLabel}</Box>
              </Typography>
            </Box>
          ) : null}
        </Box>
      ) : (
        <Typography variant="caption" sx={{ color: 'text.secondary' }}>
          Station setup
        </Typography>
      )}
    </Box>
  )
}

function KioskFooterDock({ supportsFullscreen, isFullscreen, onToggleFullscreen }) {
  const { stationId, rtdbConnected, end, setStationId } = useTransaction()
  const [open, setOpen] = useState(false)
  const [pwd, setPwd] = useState('')
  const [err, setErr] = useState('')
  const [checking, setChecking] = useState(false)

  const close = () => {
    setOpen(false)
    setPwd('')
    setErr('')
  }

  const confirm = async () => {
    if (!stationId) return
    if (!pwd) {
      setErr('Enter station password')
      return
    }

    setChecking(true)
    setErr('')
    try {
      const snap = await getDoc(doc(db, 'stations', String(stationId)))
      if (!snap.exists()) {
        setErr('Station not found')
        setChecking(false)
        return
      }
      const data = snap.data() || {}
      const stored = String(data.password || '')
      if (stored !== String(pwd)) {
        setErr('Incorrect password')
        setChecking(false)
        return
      }

      try { end() } catch { /* ignore */ }
      try { setStationId('') } catch { /* ignore */ }
      try { localStorage.removeItem('station_id') } catch { /* ignore */ }
      try { localStorage.removeItem('station_authenticated') } catch { /* ignore */ }
      close()
      // navigate to station login/start
      try { window.location.assign('/') } catch { /* ignore */ }
    } catch (e) {
      console.error('Station password check failed', e)
      setErr('Failed to verify password')
    } finally {
      setChecking(false)
    }
  }

  if (!stationId) return null

  return (
    <>
      <Box className="kiosk-footer">
        <Box sx={{ display: 'flex', alignItems: 'center' }}>
          <IconButton
            aria-label="Station Logout"
            onClick={() => setOpen(true)}
            sx={{
              bgcolor: 'error.main',
              color: 'common.white',
              '&:hover': { bgcolor: 'error.dark' },
              width: 40,
              height: 40,
            }}
          >
            <LogOut size={16} />
          </IconButton>

          <Box
            sx={{
              ml: 1.25,
              px: 1,
              py: 0.5,
              borderRadius: 1,
              border: '1px solid',
              borderColor: 'divider',
              bgcolor: 'background.paper',
              lineHeight: 1,
              display: 'flex',
              alignItems: 'center',
              gap: 0.75,
            }}
          >
            <Tooltip title={rtdbConnected ? 'RFID connected' : 'RFID disconnected'}>
              <Box
                aria-label={rtdbConnected ? 'RFID connected' : 'RFID disconnected'}
                sx={{
                  width: 10,
                  height: 10,
                  borderRadius: '50%',
                  bgcolor: rtdbConnected ? 'success.main' : 'error.main',
                }}
              />
            </Tooltip>
            <Typography variant="caption" sx={{ color: 'text.secondary', lineHeight: 1.1 }}>
              Kiosk: <Box component="span" sx={{ color: 'text.primary', fontWeight: 700 }}>{stationId}</Box>
            </Typography>
          </Box>
        </Box>

        {supportsFullscreen ? (
          <Tooltip title={isFullscreen ? 'Exit full screen' : 'Full screen'}>
            <IconButton
              aria-label={isFullscreen ? 'Exit full screen' : 'Enter full screen'}
              onClick={onToggleFullscreen}
              size="small"
              sx={{ ml: 1 }}
            >
              {isFullscreen ? <FullscreenExitIcon /> : <FullscreenIcon />}
            </IconButton>
          </Tooltip>
        ) : null}
      </Box>

      <Dialog open={open} onClose={close}>
        <DialogTitle>Station Logout</DialogTitle>
        <DialogContent>
          <DialogContentText>
            Enter the station password to close this kiosk session.
          </DialogContentText>
          <TextField
            autoFocus
            margin="dense"
            label="Station Password"
            type="password"
            fullWidth
            value={pwd}
            onChange={(e) => { setPwd(e.target.value); setErr('') }}
            helperText={err}
            error={!!err}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={close}>Cancel</Button>
          <Button color="error" onClick={confirm} disabled={checking}>
            {checking ? 'Checking…' : 'Confirm Logout'}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  )
}

function KioskInner() {
  const { stationId, step } = useTransaction()

  if (!stationId) return <Setup />

  switch (step) {
    case 'IDLE':
      return <StartScreen />
    case 'SCANNING':
      return <ScanningScreen />
    case 'PAYMENT':
      return <PaymentScreen />
    case 'RECEIPT':
      return <ReceiptScreen />
    default:
      return <StartScreen />
  }
}

export default function CustomerCheckout() {
  const kioskRootRef = useRef(null)
  const supportsFullscreen = useMemo(() => {
    if (typeof document === 'undefined') return false
    const doc = document
    return Boolean(
      doc.fullscreenEnabled ||
        doc.webkitFullscreenEnabled ||
        doc.mozFullScreenEnabled ||
        doc.msFullscreenEnabled
    )
  }, [])

  const getFullscreenElement = useCallback(() => {
    if (typeof document === 'undefined') return null
    const doc = document
    return (
      doc.fullscreenElement ||
      doc.webkitFullscreenElement ||
      doc.mozFullScreenElement ||
      doc.msFullscreenElement ||
      null
    )
  }, [])

  const [isFullscreen, setIsFullscreen] = useState(() => {
    if (typeof document === 'undefined') return false
    return Boolean(
      document.fullscreenElement ||
        document.webkitFullscreenElement ||
        document.mozFullScreenElement ||
        document.msFullscreenElement
    )
  })

  useEffect(() => {
    const handler = () => setIsFullscreen(Boolean(getFullscreenElement()))
    document.addEventListener('fullscreenchange', handler)
    document.addEventListener('webkitfullscreenchange', handler)
    document.addEventListener('mozfullscreenchange', handler)
    document.addEventListener('MSFullscreenChange', handler)
    handler()
    return () => {
      document.removeEventListener('fullscreenchange', handler)
      document.removeEventListener('webkitfullscreenchange', handler)
      document.removeEventListener('mozfullscreenchange', handler)
      document.removeEventListener('MSFullscreenChange', handler)
    }
  }, [getFullscreenElement])

  useEffect(() => {
    // Lock page scroll only while this route is mounted.
    const html = document.documentElement
    const body = document.body
    const prevHtmlOverflow = html.style.overflow
    const prevBodyOverflow = body.style.overflow
    const prevHtmlOverscroll = html.style.overscrollBehavior
    const prevBodyOverscroll = body.style.overscrollBehavior

    html.style.overflow = 'hidden'
    body.style.overflow = 'hidden'
    html.style.overscrollBehavior = 'none'
    body.style.overscrollBehavior = 'none'

    return () => {
      html.style.overflow = prevHtmlOverflow
      body.style.overflow = prevBodyOverflow
      html.style.overscrollBehavior = prevHtmlOverscroll
      body.style.overscrollBehavior = prevBodyOverscroll
    }
  }, [])

  const toggleFullscreen = useCallback(async () => {
    if (!supportsFullscreen) return

    const doc = document
    const rootEl = kioskRootRef.current
    const currentFsEl = getFullscreenElement()

    try {
      if (currentFsEl) {
        if (doc.exitFullscreen) await doc.exitFullscreen()
        else if (doc.webkitExitFullscreen) await doc.webkitExitFullscreen()
        else if (doc.mozCancelFullScreen) await doc.mozCancelFullScreen()
        else if (doc.msExitFullscreen) await doc.msExitFullscreen()
        return
      }

      if (!rootEl) return
      if (rootEl.requestFullscreen) await rootEl.requestFullscreen()
      else if (rootEl.webkitRequestFullscreen) await rootEl.webkitRequestFullscreen()
      else if (rootEl.mozRequestFullScreen) await rootEl.mozRequestFullScreen()
      else if (rootEl.msRequestFullscreen) await rootEl.msRequestFullscreen()
    } catch {
      // Intentionally ignore — Fullscreen API can fail based on user gesture/browser policies.
    }
  }, [getFullscreenElement, supportsFullscreen])

  return (
    <TransactionProvider>
      <div className="kiosk-root" ref={kioskRootRef}>
        <div className="kiosk-shell">
          <KioskHeader />

          <div className="kiosk-content">
            <div className="kiosk-body">
              <KioskInner />
            </div>

            <KioskFooterDock
              supportsFullscreen={supportsFullscreen}
              isFullscreen={isFullscreen}
              onToggleFullscreen={toggleFullscreen}
            />
          </div>
        </div>
      </div>
    </TransactionProvider>
  )
}