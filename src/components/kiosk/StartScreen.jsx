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
      {kioskWelcomeMessage ? (
        <Typography
          sx={{
            mb: 3.5,
            color: 'text.primary',
            fontWeight: 650,
            fontSize: { xs: 24, sm: 30 },
            lineHeight: 1.15,
            maxWidth: 920,
            whiteSpace: 'pre-line',
          }}
        >
          {kioskWelcomeMessage}
        </Typography>
      ) : (
        <Box sx={{ mb: 3 }} />
      )}

      {!stationId && (
        <TextField label="Station ID" value={temp} onChange={(e) => setTemp(e.target.value)} sx={{ mb: 3, maxWidth: 560 }} fullWidth />
      )}

      <Box>
        <Button
          variant="contained"
          size="large"
          color="error"
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
          }}
        >
          Start Checkout
        </Button>
      </Box>
    </Box>
  )
}
