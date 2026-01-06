import React, { useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext.jsx';
import LogoutButton from '../Auth/LogoutButton';
import MiniDrawerStyled from '../../layout/Dashboard/Drawer/MiniDrawerStyled';
import List from '@mui/material/List';
import ListItemButton from '@mui/material/ListItemButton';
import ListItemIcon from '@mui/material/ListItemIcon';
import ListItemText from '@mui/material/ListItemText';
import IconButton from '@mui/material/IconButton';
import Divider from '@mui/material/Divider';
import Box from '@mui/material/Box';
import {
  Home,
  Users,
  ListOrdered,
  Package,
  FileText,
  ShoppingCart,
  Menu,
  Bell,
  Settings,
  Search,
  User,
  ChevronDown,
  ChevronRight,
} from 'lucide-react';
import Collapse from '@mui/material/Collapse';
import Topbar from './Topbar';
import { useTheme } from '@mui/material/styles';

// NavItem helper removed — layout renders items directly using MUI List components

const MainLayout = () => {
  const { currentRole } = useAuth();
  const [collapsed, setCollapsed] = useState(false);
  const location = useLocation();
  const theme = useTheme();

  const [openGroups, setOpenGroups] = useState({});

  // Organize nav links by category for easier scanning
  const navSections = [
    {
      title: 'Overview',
      items: [
        { to: '/admin', Icon: Home, label: 'Dashboard' },
      ],
    },
    {
      title: 'Operations',
      items: [
        {
          label: 'Transactions',
          Icon: ListOrdered,
          children: [
            { to: '/admin/transactions', label: 'All Transactions' },
            { to: '/admin/transactions/stripe', label: 'Stripe Transactions' },
            { to: '/admin/transactions/billplz', label: 'Billplz Transactions' },
          ],
        },
        { to: '/admin/sold-items', Icon: ShoppingCart, label: 'Sold Items' },
        { to: '/admin/inventory', Icon: Package, label: 'Inventory' },
      ],
    },
    {
      title: 'Products',
      items: [
        { to: '/admin/products', Icon: ShoppingCart, label: 'Product Management' },
        { to: '/admin/products/master', Icon: Package, label: 'Product Master' },
        { to: '/admin/products/tags', Icon: Package, label: 'Tag UID Link' },
        { to: '/admin/products/items', Icon: Package, label: 'Product Items' },
      ],
    },
    {
      title: 'People',
      items: [
        { to: '/admin/users', Icon: Users, label: 'Manage Users' },
        { to: '/admin/attendance', Icon: ListOrdered, label: 'Staff Attendance' },
        { to: '/admin/leaves', Icon: FileText, label: 'Leave Requests' },
      ],
    },
    {
      title: 'Reports',
      items: [
        { to: '/admin/reports', Icon: FileText, label: 'Financial Reports' },
      ],
    },
    {
      title: 'System',
      items: [
        // Stations becomes a collapsible group with sub-items
        {
          label: 'Stations',
          Icon: Settings,
          children: [
            { to: '/admin/stations', label: 'Station List' },
            { to: '/admin/stations/create', label: 'Create Station' },
          ],
        },
        { to: '/admin/logs', Icon: FileText, label: 'Logs' },
      ],
    },
  ];

  const isStaff = String(currentRole || '').toLowerCase() === 'staff';
  const filterItem = (item) => {
    if (!isStaff) return true;

    // Keep staff out of routes that are protected to admin/manager.
    // This avoids the UX of clicking a link and landing on "Unauthorized".
    const blockedLabels = new Set(['Manage Users', 'Logs', 'Stations', 'Financial Reports']);
    return !blockedLabels.has(item?.label);
  };

  const filteredSections = navSections
    .map((sec) => ({
      ...sec,
      items: (sec.items || []).filter(filterItem),
    }))
    .filter((sec) => (sec.items || []).length > 0);

  return (
    <div
      className="flex min-h-screen"
      style={{
        backgroundColor: theme.palette.background.default,
        color: theme.palette.text.primary,
      }}
    >
      {/* Sidebar (MUI Drawer) */}
      <MiniDrawerStyled variant="permanent" open={!collapsed}>
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: collapsed ? 'center' : 'space-between',
            p: 1,
            px: collapsed ? 1 : 2,
          }}
        >
          {!collapsed ? (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <Box sx={{ height: 36, width: 36, borderRadius: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', bgcolor: 'primary.main', color: 'common.white', fontWeight: 700 }}>MM</Box>
              <Box>
                <Box component="div" sx={{ fontSize: 13, fontWeight: 'bold' }}>M&amp;M RSCS</Box>
                <Box component="div" sx={{ fontSize: 11, color: 'text.secondary' }}>Admin Portal</Box>
              </Box>
            </Box>
          ) : null}

          <IconButton
            size="small"
            onClick={() => setCollapsed(s => !s)}
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            sx={{ color: 'text.secondary' }}
          >
            <Menu size={18} />
          </IconButton>
        </Box>

        <Divider />

        <List disablePadding>
          {filteredSections.map((section) => (
            <Box key={section.title}>
              {!collapsed ? (
                <Box sx={{ px: 2.5, pt: 2, pb: 0.5, fontSize: 11, color: 'text.secondary', textTransform: 'uppercase', fontWeight: 700 }}>
                  {section.title}
                </Box>
              ) : (
                <Box sx={{ pt: 1 }} />
              )}

              {section.items.map((item, idx) => {
            if (item.children) {
              const groupKey = item.label;
              const isGroupActive = Boolean(item.children?.some((c) => String(location.pathname || '').startsWith(String(c.to || ''))));
              const isGroupOpen = Boolean(openGroups[groupKey]) || isGroupActive;

              return (
                <div key={`group-${idx}`}>
                  <ListItemButton
                    onClick={() => setOpenGroups((prev) => ({ ...prev, [groupKey]: !prev[groupKey] }))}
                    selected={isGroupActive}
                    sx={{ pl: collapsed ? 1.5 : 2.5 }}
                  >
                    <ListItemIcon sx={{ minWidth: 0, mr: collapsed ? 0 : 2, justifyContent: 'center', color: 'inherit' }}>
                      <item.Icon size={18} />
                    </ListItemIcon>
                    {!collapsed && <ListItemText primary={item.label} />}
                    {!collapsed && (isGroupOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />)}
                  </ListItemButton>

                  <Collapse in={isGroupOpen && !collapsed} timeout="auto" unmountOnExit>
                    <List component="div" disablePadding>
                      {item.children.map((child) => (
                        <ListItemButton
                          key={child.to}
                          component={NavLink}
                          to={child.to}
                          selected={location.pathname === child.to}
                          sx={{ pl: 6 }}
                        >
                          <ListItemText primary={child.label} />
                        </ListItemButton>
                      ))}
                    </List>
                  </Collapse>
                </div>
              )
            }

            return (
              <ListItemButton
                key={item.to}
                component={NavLink}
                to={item.to}
                selected={location.pathname === item.to}
                sx={{ pl: collapsed ? 1.5 : 2.5 }}
              >
                <ListItemIcon sx={{ minWidth: 0, mr: collapsed ? 0 : 2, justifyContent: 'center', color: 'inherit' }}>
                  <item.Icon size={18} />
                </ListItemIcon>
                {!collapsed && <ListItemText primary={item.label} />}
              </ListItemButton>
            )
          })}

              <Divider sx={{ mt: 1.5 }} />
            </Box>
          ))}
        </List>

        <Box sx={{ mt: 'auto', p: 2 }}>
          <Box
            component={NavLink}
            to="/station-login"
            sx={{ display: 'flex', alignItems: 'center', gap: 1, textDecoration: 'none', color: 'text.primary', mb: 2 }}
          >
            <ShoppingCart size={16} />
            {!collapsed && <Box component="span" sx={{ fontWeight: 500 }}>Customer Kiosk</Box>}
          </Box>

          {!collapsed && <Box sx={{ fontSize: 11, color: 'text.secondary', textTransform: 'uppercase', mb: 1 }}>{currentRole}</Box>}
          <LogoutButton />
        </Box>
      </MiniDrawerStyled>

      {/* Main content */}
      <main className="flex-1">
        <Topbar />
        <div className="p-6 container-wide">
          <Outlet />
        </div>
      </main>
    </div>
  );
};

export default MainLayout;
