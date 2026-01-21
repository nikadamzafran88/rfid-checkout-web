import React, { useEffect, useState } from 'react'
import { Box, Button, Typography, TextField } from '@mui/material'
import { useTransaction } from '../../contexts/TransactionContext'
import { doc, getDoc } from 'firebase/firestore'
import { db } from '../../firebaseConfig'

export default function StartScreen() {
  const { stationId, start } = useTransaction()
  const [temp, setTemp] = useState(stationId || '')

  const [kioskWelcomeMessage, setKioskWelcomeMessage] = useState('')

  useEffect(() => {
    let mounted = true
    const load = async () => {
      try {
        let msg = ''

        if (stationId) {
          try {
            const s = await getDoc(doc(db, 'stations', String(stationId)))
            const data = s.exists() ? (s.data() || {}) : {}
            msg = String(data.kioskWelcomeMessage || '').trim()
          } catch {
            // ignore
          }
        }

        if (!msg) {
          try {
            const snap = await getDoc(doc(db, 'system', 'config'))
            const data = snap.exists() ? (snap.data() || {}) : {}
            if (!msg) msg = String(data.kioskWelcomeMessage || '').trim()
          } catch {
            // ignore
          }
        }

        if (!mounted) return
        setKioskWelcomeMessage(msg)
      } catch {
        // ignore
      }
    }
    load()
    return () => { mounted = false }
  }, [stationId])

  const welcomeFallback = 'Welcome to NAZ Retails\nClick the Start button to start'
  const welcomeRaw = (kioskWelcomeMessage && kioskWelcomeMessage.trim().length > 0)
    ? kioskWelcomeMessage.trim()
    : welcomeFallback
  const welcomeLines = welcomeRaw.split(/\r?\n/)
  const welcomeTitle = welcomeLines[0] || 'Welcome'
  const welcomeSubtitle = welcomeLines.slice(1).join('\n')

  return (
    <Box
      sx={{
        p: 6,
        textAlign: 'center',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Typography
        variant="h4"
        sx={{
          fontWeight: 900,
          letterSpacing: 0.3,
          mb: welcomeSubtitle ? 0.75 : 3.5,
          textAlign: 'center',
          whiteSpace: 'pre-line',
        }}
      >
        {welcomeTitle}
      </Typography>
      {welcomeSubtitle ? (
        <Typography
          variant="body2"
          sx={{
            opacity: 0.9,
            fontStyle: 'italic',
            textAlign: 'center',
            whiteSpace: 'pre-line',
            mb: 3.5,
          }}
        >
          {welcomeSubtitle}
        </Typography>
      ) : null}

      {!stationId && (
        <TextField label="Station ID" value={temp} onChange={(e) => setTemp(e.target.value)} sx={{ mb: 3, maxWidth: 560 }} fullWidth />
      )}

      <Box>
        <Button
          variant="contained"
          size="large"
          onClick={() => start(temp || stationId)}
          disabled={!(temp || stationId)}
          sx={{
            width: '100%',
            maxWidth: 920,
            py: { xs: 3.75, sm: 4.25 },
            minHeight: { xs: 84, sm: 96 },
            fontSize: { xs: 26, sm: 32 },
            fontWeight: 900,
            letterSpacing: 0.5,
            borderRadius: 1,
            backgroundColor: '#a259ff',
            color: '#fff',
            '&:hover': { backgroundColor: '#8b45e6' },
          }}
        >
          Start Checkout
        </Button>
      </Box>
    </Box>
  )
}
