import React, { useState } from 'react'
import { Button, TextField, Box, Typography } from '@mui/material'
import { useTransaction } from '../../contexts/TransactionContext'

export default function Setup() {
  const { stationId, setStationId } = useTransaction()
  const [val, setVal] = useState(stationId || '')

  const save = () => {
    if (!val) return
    setStationId(val)
  }

  return (
    <Box sx={{ p: 3, maxWidth: 480 }}>
      <Typography variant="h5">Station Setup</Typography>
      <Typography variant="body2" sx={{ mb: 2 }}>Enter the station id (e.g. station_01)</Typography>
      <TextField fullWidth label="Station ID" value={val} onChange={(e) => setVal(e.target.value)} sx={{ mb: 2 }} />
      <Button variant="contained" onClick={save}>Save Station</Button>
    </Box>
  )
}
