import React, { useMemo, useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import LogoutButton from '../Auth/LogoutButton'; // Assuming this handles the actual sign-out logic
import { useAuth } from '../../context/AuthContext.jsx';
import { Home, Package, ListOrdered, Users, ShoppingCart, FileText, LogOut, Bell, Search, Settings, User } from 'lucide-react';
import AppBar from '@mui/material/AppBar';
import Toolbar from '@mui/material/Toolbar';
import IconButton from '@mui/material/IconButton';
import Badge from '@mui/material/Badge';
import InputBase from '@mui/material/InputBase';
import Avatar from '@mui/material/Avatar';
import Typography from '@mui/material/Typography';
import Box from '@mui/material/Box';
import { useTheme, styled } from '@mui/material/styles';
import Drawer from '@mui/material/Drawer';
import List from '@mui/material/List';
import ListItemButton from '@mui/material/ListItemButton';
import ListItemIcon from '@mui/material/ListItemIcon';
import ListItemText from '@mui/material/ListItemText';
import Divider from '@mui/material/Divider';
import Menu from '@mui/material/Menu';
import MenuItem from '@mui/material/MenuItem';
import ListItem from '@mui/material/ListItem';

// Mantis Theme Constant (using a hardcoded value, ideally from a config.js)
const DRAWER_WIDTH = 240;

// ==============================|| CUSTOM STYLED COMPONENTS ||============================== //

// 1. Emulate the Mantis AppBarStyled component for smooth transitions
const AppBarStyled = styled(AppBar)(({ theme }) => ({
  zIndex: theme.zIndex.drawer + 1,
  width: `calc(100% - ${DRAWER_WIDTH}px)`,
  marginLeft: DRAWER_WIDTH,
  boxShadow: theme.shadows[1], // Use theme shadows
  backgroundColor: theme.palette.background.paper,
  borderBottom: `1px solid ${theme.palette.divider}`,
  transition: theme.transitions.create(['width', 'margin'], {
    easing: theme.transitions.easing.sharp,
    duration: theme.transitions.duration.leavingScreen,
  }),
}));

// 2. Emulate the Mantis Main content component to handle the spacing after the fixed header
const Main = styled('main')(({ theme }) => ({
  flexGrow: 1,
  minHeight: '100vh',
  backgroundColor: theme.palette.background.default,
}));

// ==============================|| NAV ITEM COMPONENT ||============================== //

const NavItem = ({ to, icon: Icon, label }) => {
  const theme = useTheme();

  return (
    <ListItemButton
      component={NavLink}
      to={to}
      sx={{
        borderRadius: theme.shape.borderRadius,
        my: 0.5,
        // Mantis often uses primary colors for the selected item background/text
        '&.active': {
          bgcolor: theme.palette.primary.light, 
          color: theme.palette.primary.darker,
          '& .MuiListItemIcon-root': { color: theme.palette.primary.darker },
        },
        // Hover state to maintain Mantis aesthetic
        '&:hover': {
          bgcolor: theme.palette.primary.lighter,
        }
      }}
    >
      <ListItemIcon sx={{ minWidth: 36 }}>
        <Icon size={18} />
      </ListItemIcon>
      <ListItemText primary={label} primaryTypographyProps={{ fontWeight: 600 }} />
    </ListItemButton>
  );
};


// ==============================|| ADMIN LAYOUT ||============================== //

const AdminLayout = () => {
  const { currentRole, currentUser } = useAuth();
  const navigate = useNavigate();
  const theme = useTheme();

  const initials = useMemo(() => {
    // ... (Your existing initials calculation logic)
    if (!currentUser) return '';
    const name = currentUser.displayName || currentUser.fullName || currentUser.name || currentUser.email || '';
    const parts = name.trim().split(/\s+/).filter(Boolean);
    if (parts.length === 0) return (currentUser.email || '').charAt(0).toUpperCase();
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  }, [currentUser]);

  const [anchorEl, setAnchorEl] = useState(null);
  const menuOpen = Boolean(anchorEl);
  const handleAvatarClick = (e) => setAnchorEl(e.currentTarget);
  const handleMenuClose = () => setAnchorEl(null);
  const goTo = (path) => {
    handleMenuClose();
    navigate(path);
  };

  const navigationItems = [
    { path: '/admin', icon: Home, label: 'Dashboard' },
    { path: '/admin/users', icon: Users, label: 'Manage Users' },
    { path: '/admin/stations', icon: Settings, label: 'Stations' },
    { path: '/admin/attendance', icon: ListOrdered, label: 'Staff Attendance' },
    { path: '/admin/leaves', icon: FileText, label: 'Leave Requests' },
    { path: '/admin/reports', icon: FileText, label: 'Financial Reports' },
    { path: '/admin/products', icon: ShoppingCart, label: 'Product Management' },
    { path: '/admin/transactions', icon: ListOrdered, label: 'View Transactions' },
    { path: '/admin/inventory', icon: Package, label: 'Manage Inventory' },
    { path: '/admin/logs', icon: FileText, label: 'View Logs' },
  ];

  const filteredItems =
    currentRole === 'staff'
      ? navigationItems.filter((item) => item.label !== 'Manage Users' && item.label !== 'View Logs')
      : navigationItems;

  return (
    <Box sx={{ display: 'flex', minHeight: '100vh', backgroundColor: theme.palette.background.default }}>
      
      {/* ==============================|| DRAWER (SIDEBAR) ||============================== */}
      <Drawer
        variant="permanent"
        sx={{
          width: DRAWER_WIDTH,
          flexShrink: 0,
          '& .MuiDrawer-paper': {
            width: DRAWER_WIDTH,
            boxSizing: 'border-box',
            // Use the Paper background color for the drawer
            bgcolor: theme.palette.background.paper, 
            borderRight: `1px solid ${theme.palette.divider}`,
            // Ensure shadow is consistent with Mantis design (e.g., z1 when closed, none when open)
            boxShadow: theme.customShadows?.z1 || theme.shadows[1], 
          },
        }}
      >
        {/* LOGO AREA */}
        <Box sx={{ px: 2, py: 3, textAlign: 'center', borderBottom: `1px solid ${theme.palette.divider}` }}>
          <Typography variant="h6" sx={{ fontWeight: 700 }}>
            M&M <Typography component="span" sx={{ fontWeight: 300 }}>RSCS</Typography>
          </Typography>
        </Box>

        {/* NAVIGATION LIST */}
        <List sx={{ p: 2 }}>
          {filteredItems.map((item) => (
            <NavItem key={item.path} {...item} />
          ))}
        </List>

        <Box sx={{ flexGrow: 1 }} />

        {/* BOTTOM SECTION (Checkout & Role Info) */}
        <Divider />
        <Box sx={{ p: 2 }}>
          <ListItemButton component={NavLink} to="/station-login" sx={{ borderRadius: 1 }}>
            <ListItemIcon sx={{ minWidth: 36 }}>
              <ShoppingCart size={18} />
            </ListItemIcon>
            <ListItemText primary="Customer Kiosk" primaryTypographyProps={{ fontSize: 13 }} />
          </ListItemButton>

          <Box sx={{ mt: 1, mb: 1, textAlign: 'center' }}>
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
              {currentRole || 'Admin'} Access
            </Typography>
          </Box>
        </Box>
      </Drawer>

      {/* ==============================|| MAIN CONTENT & HEADER ||============================== */}
      <Box sx={{ flexGrow: 1 }}>
        
        {/* HEADER (AppBarStyled is used here) */}
        <AppBarStyled 
          position="fixed"
          color="inherit"
          elevation={0} // Elevation is added back by AppBarStyled's custom logic
        >
          <Toolbar sx={{ px: { xs: 2, md: 4 }, py: 1 }}>
            
            {/* 1. Header Title Section */}
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, minWidth: 180 }}>
              <Box>
                <Typography variant="h6" sx={{ fontWeight: 600 }}>Dashboard</Typography>
                <Typography variant="body2" color="text.secondary">Overview &amp; quick actions</Typography>
              </Box>
            </Box>

            {/* 2. Centered Search Bar */}
            <Box sx={{ flex: 1, px: 3, display: 'flex', justifyContent: 'center' }}>
              <Box sx={{ width: '100%', maxWidth: 720 }}>
                <Box sx={{ position: 'relative' }}>
                  <Box sx={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'text.secondary' }}>
                    <Search size={16} />
                  </Box>
                  <InputBase
                    placeholder="Search transactions, users, products..."
                    sx={{
                      width: '100%',
                      pl: 6,
                      pr: 2,
                      py: 1,
                      bgcolor: theme.palette.mode === 'light' ? theme.palette.common.white : theme.palette.background.paper,
                      borderRadius: '999px',
                      border: '1px solid',
                      borderColor: theme.palette.divider,
                      boxShadow: theme.shadows[1],
                    }}
                  />
                </Box>
              </Box>
            </Box>

            {/* 3. User Actions (Notifications and Profile) - LOGOUT BUTTON REMOVED */}
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, minWidth: 220, justifyContent: 'flex-end' }}>
              <IconButton aria-label="notifications" color="inherit">
                <Badge color="primary" variant="dot">
                  <Bell size={20} />
                </Badge>
              </IconButton>

              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <IconButton 
                  onClick={handleAvatarClick} 
                  size="small" 
                  sx={{ ml: 1, p: 0 }} 
                  aria-controls={menuOpen ? 'profile-menu' : undefined} 
                  aria-haspopup="true" 
                  aria-expanded={menuOpen ? 'true' : undefined}
                >
                  <Avatar sx={{ bgcolor: theme.palette.primary.main, width: 36, height: 36 }}>{initials || 'A'}</Avatar>
                </IconButton>

                {/* PROFILE MENU */}
                <Menu anchorEl={anchorEl} open={menuOpen} onClose={handleMenuClose} id="profile-menu" anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }} transformOrigin={{ vertical: 'top', horizontal: 'right' }}>
                  
                  {/* Menu Header with User Info (Mantis Style) */}
                
                  <Divider />
                  
                  {/* Profile Actions */}
                  <MenuItem onClick={() => goTo('/profile')}><ListItemIcon><User size={18} /></ListItemIcon>Profile</MenuItem>
                  <MenuItem onClick={() => goTo('/settings')}><ListItemIcon><Settings size={18} /></ListItemIcon>Settings</MenuItem>
                  <Divider />
                  
                  {/* Logout Action (Moved here) */}
                  <MenuItem onClick={handleMenuClose}>
                    <LogoutButton icon={LogOut} />
                  </MenuItem>
                </Menu>
              </Box>
            </Box>
          </Toolbar>
        </AppBarStyled>

        {/* MAIN CONTENT AREA */}
        <Main>
          {/* Spacer for fixed AppBar height */}
          <Toolbar />
          <Box sx={{ p: 3 }}>
            <Outlet />
          </Box>
        </Main>
      </Box>
    </Box>
  );
};

export default AdminLayout;