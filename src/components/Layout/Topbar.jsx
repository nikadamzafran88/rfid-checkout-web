import React, { useState } from 'react'
import { useAuth } from '../../context/AuthContext.jsx'
import { useNavigate } from 'react-router-dom'
import { Bell, Moon, Sun } from 'lucide-react'
import IconButton from '@mui/material/IconButton'
import Menu from '@mui/material/Menu'
import MenuItem from '@mui/material/MenuItem'
import Avatar from '@mui/material/Avatar'
import Box from '@mui/material/Box'
import { useTheme } from '@mui/material/styles'
import { useColorMode } from '../../themes'

export default function Topbar() {
  const { currentRole, currentUser, logout } = useAuth()
  const navigate = useNavigate()
  const theme = useTheme()
  const { toggleColorMode } = useColorMode()
  const [anchorEl, setAnchorEl] = useState(null)

  const open = Boolean(anchorEl)
  const handleOpen = (e) => setAnchorEl(e.currentTarget)
  const handleClose = () => setAnchorEl(null)

  const handleLogout = async () => {
    try {
      await logout()
      try { localStorage.removeItem('station_id'); localStorage.removeItem('station_authenticated') } catch (e) {}
      navigate('/login', { replace: true })
    } catch (err) {
      console.error('Logout failed', err)
      alert('Logout failed. Please try again.')
    }
  }

  return (
    <header
      className="flex items-center shadow-sm border-b sticky top-0 z-20"
      style={{
        backgroundColor: theme.palette.background.paper,
        borderColor: theme.palette.divider,
        color: theme.palette.text.primary,
      }}
    >
      <div className="w-full container-wide" style={{ marginLeft: '0', padding: '0 1rem' }}>
        <div className="flex items-center justify-between py-3">
          <div className="flex items-center gap-4" />

          <div className="flex-1" />

          <div className="flex items-center gap-3">
            <IconButton
              aria-label="notifications"
              sx={{
                position: 'relative',
                borderRadius: 1,
                '&:hover': { bgcolor: 'action.hover' },
              }}
            >
              <Bell size={18} color={theme.palette.text.secondary} />
              <span className="absolute -top-0.5 -right-0.5 inline-flex h-3 w-3 rounded-full bg-red-500 border-2 border-white" />
            </IconButton>

            <IconButton
              aria-label={theme.palette.mode === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
              onClick={toggleColorMode}
              sx={{
                borderRadius: 1,
                '&:hover': { bgcolor: 'action.hover' },
              }}
            >
              {theme.palette.mode === 'dark' ? (
                <Sun size={18} color={theme.palette.text.secondary} />
              ) : (
                <Moon size={18} color={theme.palette.text.secondary} />
              )}
            </IconButton>

            <Box>
              <IconButton onClick={handleOpen} size="small" sx={{ ml: 1 }} aria-controls={open ? 'topbar-menu' : undefined} aria-haspopup="true" aria-expanded={open ? 'true' : undefined}>
                <Avatar sx={{ width: 34, height: 34 }}>
                  {currentUser && currentUser.displayName ? currentUser.displayName.charAt(0).toUpperCase() : (currentRole ? currentRole.charAt(0).toUpperCase() : 'U')}
                </Avatar>
              </IconButton>

              <Menu id="topbar-menu" anchorEl={anchorEl} open={open} onClose={handleClose} onClick={handleClose} transformOrigin={{ horizontal: 'right', vertical: 'top' }} anchorOrigin={{ horizontal: 'right', vertical: 'bottom' }}>
                <MenuItem onClick={() => { navigate('/admin/profile'); }}>
                  Profile
                </MenuItem>
                <MenuItem onClick={handleLogout}>Log out</MenuItem>
              </Menu>
            </Box>
          </div>
        </div>
      </div>
    </header>
  )
}
