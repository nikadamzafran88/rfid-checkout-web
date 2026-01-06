import React from 'react'
import { Box, Grid, TextField } from '@mui/material'
import { useAuth } from '../context/AuthContext.jsx'
import PageHeader from '../components/ui/PageHeader'
import SectionCard from '../components/ui/SectionCard'

export default function Profile() {
  const { currentUser, currentRole } = useAuth()

  return (
    <Box sx={{ p: 3 }}>
      <PageHeader title="Profile" subtitle="Your account information." />

      <SectionCard title="Account Details">

        <Grid container spacing={2}>
          <Grid item xs={12} md={6}>
            <TextField
              label="Display Name"
              value={currentUser?.displayName || ''}
              fullWidth
              InputProps={{ readOnly: true }}
            />
          </Grid>
          <Grid item xs={12} md={6}>
            <TextField
              label="Email"
              value={currentUser?.email || ''}
              fullWidth
              InputProps={{ readOnly: true }}
            />
          </Grid>
          <Grid item xs={12} md={6}>
            <TextField
              label="Role"
              value={currentRole || ''}
              fullWidth
              InputProps={{ readOnly: true }}
            />
          </Grid>
          <Grid item xs={12} md={6}>
            <TextField
              label="User ID"
              value={currentUser?.uid || ''}
              fullWidth
              InputProps={{ readOnly: true }}
            />
          </Grid>
        </Grid>
      </SectionCard>
    </Box>
  )
}
