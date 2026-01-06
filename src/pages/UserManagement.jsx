import React, { useEffect, useState } from 'react';
import { collection, getDocs, updateDoc, deleteDoc, doc, query, orderBy, where, setDoc, deleteField } from 'firebase/firestore';
import { db } from '../firebaseConfig';
import { useAuth } from '../context/AuthContext.jsx';
import { logAction } from '../utils/logAction';
import PageHeader from '../components/ui/PageHeader';
import SectionCard from '../components/ui/SectionCard';
import { useTheme } from '@mui/material/styles';
import { useNavigate } from 'react-router-dom';
import {
  Box,
  Typography,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  IconButton,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Select,
  MenuItem,
  FormControl,
  InputLabel,
  Switch,
  FormControlLabel,
  Alert,
  CircularProgress,
  Avatar,
  Stack,
} from '@mui/material';
import {
  createUserWithEmailAndPassword,
  EmailAuthProvider,
  getAuth,
  reauthenticateWithCredential,
  signOut,
} from 'firebase/auth';
import firebaseConfig, { auth } from '../firebaseConfig';
import { initializeApp, getApps } from 'firebase/app';
import { Edit2, Trash2, User as UserIcon, Search } from 'lucide-react';

const UserManagement = () => {
  const theme = useTheme();
  const navigate = useNavigate();

  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState('');

  const [editOpen, setEditOpen] = useState(false);
  const [selectedUser, setSelectedUser] = useState(null);
  const [saving, setSaving] = useState(false);
  const [blockDuration, setBlockDuration] = useState('1h');
  const [createOpen, setCreateOpen] = useState(false);
  const [newName, setNewName] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newRole, setNewRole] = useState('staff');
  const [adminPassword, setAdminPassword] = useState('');
  const [createError, setCreateError] = useState('');
  const [creating, setCreating] = useState(false);

  const { currentUser, currentRole } = useAuth();

  const usersRef = collection(db, 'users');

  const getSecondaryAuth = () => {
    // Secondary auth instance used ONLY for account creation, so we don't replace
    // the current admin session (which causes redirects/unauthorized flashes).
    const existing = getApps().find((a) => a.name === 'userCreation');
    const secondaryApp = existing || initializeApp(firebaseConfig, 'userCreation');
    return getAuth(secondaryApp);
  };

  const toMillis = (v) => {
    if (!v) return 0;
    // Firestore Timestamp (seconds/nanoseconds)
    if (typeof v === 'object' && typeof v.seconds === 'number') {
      return Math.floor(v.seconds * 1000);
    }
    // ISO string / Date string
    if (typeof v === 'string') {
      const ms = Date.parse(v);
      return Number.isFinite(ms) ? ms : 0;
    }
    // JS Date
    if (v instanceof Date) {
      const ms = v.getTime();
      return Number.isFinite(ms) ? ms : 0;
    }
    // number millis
    if (typeof v === 'number') {
      return Number.isFinite(v) ? v : 0;
    }
    return 0;
  };

  const formatUntil = (ms) => {
    if (!ms) return '—';
    try {
      return new Date(ms).toLocaleString('en-MY', { year: 'numeric', month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit' });
    } catch {
      return '—';
    }
  };

  const durationToMs = (key) => {
    switch (key) {
      case '15m':
        return 15 * 60 * 1000;
      case '1h':
        return 60 * 60 * 1000;
      case '4h':
        return 4 * 60 * 60 * 1000;
      case '1d':
        return 24 * 60 * 60 * 1000;
      case '7d':
        return 7 * 24 * 60 * 60 * 1000;
      default:
        return 60 * 60 * 1000;
    }
  };

  const fetchUsers = async () => {
    setLoading(true);
    setError(null);
    try {
      // Read unordered from Firestore (avoids requiring index). Normalize fields client-side
      const snap = await getDocs(usersRef);
      console.debug('User fetch (unordered) docs:', snap.size);

      const list = snap.docs.map((d) => {
        const data = d.data() || {};
        const displayName = data.displayName || data.fullName || data.name || '';
        const email = data.email || '';
        // Normalize role to lowercase (allow 'manager' as its own role)
        let role = (data.role || 'user').toString().toLowerCase();
        const uid = data.uid || d.id;
        const active = typeof data.active === 'boolean' ? data.active : !!data.active;
        const timestamp = data.registeredAt || data.createdAt || data.timestamp || null;
        const blockedUntil = data.blockedUntil ?? data.blocked_until ?? data.blockedUntilAt ?? null;
        const blockedUntilMs = toMillis(blockedUntil);

        return {
          id: d.id,
          displayName,
          email,
          role,
          uid,
          active,
          timestamp,
          staffId: data.staffId || data.staffID || '',
          blockedUntilMs,
          raw: data,
        };
      });

      // Sort locally by timestamp (desc) if present
      list.sort((a, b) => {
        const ta = a.timestamp ? Date.parse(a.timestamp) || 0 : 0;
        const tb = b.timestamp ? Date.parse(b.timestamp) || 0 : 0;
        return tb - ta;
      });

      setUsers(list);
    } catch (err) {
      console.error('Failed to fetch users:', err);
      setError(err);
      setUsers([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchUsers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const openEdit = (user) => {
    setSelectedUser({ ...user });
    setBlockDuration('1h');
    setEditOpen(true);
  };

  const closeEdit = () => {
    setSelectedUser(null);
    setEditOpen(false);
  };

  const saveEdit = async () => {
    if (!selectedUser?.id) return;
    setSaving(true);
    try {
      const userDoc = doc(db, 'users', selectedUser.id);
      // Normalize role before saving: lowercase (keep 'manager' if selected)
      let roleToSave = (selectedUser.role || 'user').toString().toLowerCase();
      const payload = {
        role: roleToSave,
        active: !!selectedUser.active,
      };
      // Capture old role for audit logging
      const original = users.find((u) => u.id === selectedUser.id);
      const oldRole = original?.role || null;

      await updateDoc(userDoc, payload);

      // Write an audit log entry about the role change
      await logAction(db, {
        type: 'role_change',
        source: 'UserManagement',
        actorUID: currentUser?.uid || null,
        actorRole: currentRole || null,
        targetUID: selectedUser.id,
        message: `Role changed for ${selectedUser.id}`,
        metadata: { oldRole, newRole: roleToSave },
      });
      setUsers((prev) => prev.map((u) => (u.id === selectedUser.id ? { ...u, ...payload } : u)));
      closeEdit();
    } catch (err) {
      console.error('Failed to update user:', err);
    } finally {
      setSaving(false);
    }
  };

  const blockUser = async () => {
    if (!selectedUser?.id) return;
    if (selectedUser.id === currentUser?.uid) {
      alert('You cannot block your own account.');
      return;
    }
    setSaving(true);
    try {
      const ms = Date.now() + durationToMs(blockDuration);
      const untilIso = new Date(ms).toISOString();
      const userDoc = doc(db, 'users', selectedUser.id);
      await updateDoc(userDoc, { blockedUntil: untilIso });

      await logAction(db, {
        type: 'access_block',
        source: 'UserManagement',
        actorUID: currentUser?.uid || null,
        actorRole: currentRole || null,
        targetUID: selectedUser.id,
        message: `Access blocked for ${selectedUser.id}`,
        metadata: { blockedUntil: untilIso },
      });

      setSelectedUser((s) => ({ ...s, blockedUntilMs: ms, raw: { ...(s?.raw || {}), blockedUntil: untilIso } }));
      setUsers((prev) => prev.map((u) => (u.id === selectedUser.id ? { ...u, blockedUntilMs: ms } : u)));
    } catch (err) {
      console.error('Failed to block user:', err);
      alert('Failed to block user. Check Firestore rules.');
    } finally {
      setSaving(false);
    }
  };

  const unblockUser = async () => {
    if (!selectedUser?.id) return;
    setSaving(true);
    try {
      const userDoc = doc(db, 'users', selectedUser.id);
      await updateDoc(userDoc, { blockedUntil: deleteField() });

      await logAction(db, {
        type: 'access_unblock',
        source: 'UserManagement',
        actorUID: currentUser?.uid || null,
        actorRole: currentRole || null,
        targetUID: selectedUser.id,
        message: `Access unblocked for ${selectedUser.id}`,
      });

      setSelectedUser((s) => ({ ...s, blockedUntilMs: 0, raw: { ...(s?.raw || {}), blockedUntil: undefined } }));
      setUsers((prev) => prev.map((u) => (u.id === selectedUser.id ? { ...u, blockedUntilMs: 0 } : u)));
    } catch (err) {
      console.error('Failed to unblock user:', err);
      alert('Failed to unblock user. Check Firestore rules.');
    } finally {
      setSaving(false);
    }
  };

  const confirmAndDelete = async (user) => {
    const ok = window.confirm(`Delete user ${user.email || user.id}? This cannot be undone.`);
    if (!ok) return;
    try {
      await deleteDoc(doc(db, 'users', user.id));
      setUsers((prev) => prev.filter((u) => u.id !== user.id));
    } catch (err) {
      console.error('Failed to delete user:', err);
    }
  };

  const filtered = users.filter((u) => {
    if (!search) return true;
    const s = search.toLowerCase();
    return (u.displayName || '').toLowerCase().includes(s) || (u.email || '').toLowerCase().includes(s) || (u.role || '').toLowerCase().includes(s);
  });

  return (
    <Box sx={{ p: 3 }}>
      <PageHeader title="User Management" subtitle="Manage staff accounts, roles, and access." />

      <SectionCard sx={{ mb: 3 }}>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} alignItems="center" justifyContent="space-between">
          <Stack direction="row" spacing={1} alignItems="center">
            <Search size={18} />
            <TextField
              size="small"
              placeholder="Search by name, email or role"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </Stack>

          <Box>
            <Stack direction="row" spacing={1}>
              <Button
                variant="contained"
                onClick={() => {
                  setCreateError('');
                  setNewRole('staff');
                  setCreateOpen(true);
                }}
                startIcon={<UserIcon size={16} />}
              >
                Create Staff/Manager
              </Button>
              <Button variant="outlined" onClick={fetchUsers} startIcon={<UserIcon size={16} />}>
                Refresh
              </Button>
            </Stack>
          </Box>
        </Stack>
      </SectionCard>

      {error && (
        <Box sx={{ mb: 2 }}>
          <Alert severity="error">{error?.message || String(error)} — check Firestore rules and your network connection.</Alert>
        </Box>
      )}

      <SectionCard title="Users" sx={{ borderRadius: theme.shape.borderRadius }}>
        <TableContainer>
          <Table size="small">
            <TableHead
              sx={{
                backgroundColor: theme.palette.mode === 'dark' ? theme.palette.background.paper : theme.palette.grey[50],
                '& th': { color: theme.palette.text.primary },
              }}
            >
              <TableRow>
                  <TableCell sx={{ fontWeight: 600 }}>User</TableCell>
                  <TableCell sx={{ fontWeight: 600 }}>Email</TableCell>
                  <TableCell sx={{ fontWeight: 600 }}>Staff ID</TableCell>
                  <TableCell sx={{ fontWeight: 600 }}>Role</TableCell>
                  <TableCell sx={{ fontWeight: 600 }}>Active</TableCell>
                  <TableCell sx={{ fontWeight: 600 }}>Actions</TableCell>
                </TableRow>
            </TableHead>

            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell colSpan={5} sx={{ py: 4, textAlign: 'center' }}>
                    <CircularProgress size={24} />
                  </TableCell>
                </TableRow>
              ) : filtered.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} sx={{ py: 3, textAlign: 'center' }}>
                    No users found.
                  </TableCell>
                </TableRow>
              ) : (
                filtered.map((u) => (
                  <TableRow key={u.id} hover>
                    <TableCell>
                      <Stack direction="row" spacing={2} alignItems="center">
                        <Avatar sx={{ width: 34, height: 34, bgcolor: theme.palette.primary.light }}>
                          {u.displayName ? u.displayName.charAt(0).toUpperCase() : <UserIcon size={14} />}
                        </Avatar>
                        <Box>
                          <Typography variant="body2" sx={{ fontWeight: 600 }}>{u.displayName || '—'}</Typography>
                          <Typography variant="caption" sx={{ color: theme.palette.text.secondary }}>{u.uid || u.id}</Typography>
                        </Box>
                      </Stack>
                    </TableCell>

                    <TableCell sx={{ wordBreak: 'break-word' }}>{u.email || '—'}</TableCell>
                    <TableCell>{u.staffId || '—'}</TableCell>

                    <TableCell>{u.role || 'user'}</TableCell>

                    <TableCell>
                      {u.blockedUntilMs && u.blockedUntilMs > Date.now() ? (
                        <Box>
                          <Typography variant="body2" sx={{ fontWeight: 700, color: theme.palette.error.main }}>
                            Blocked
                          </Typography>
                          <Typography variant="caption" sx={{ color: theme.palette.text.secondary }}>
                            Until {formatUntil(u.blockedUntilMs)}
                          </Typography>
                        </Box>
                      ) : (
                        <FormControlLabel
                          control={<Switch checked={!!u.active} size="small" disabled />}
                          label={u.active ? 'Yes' : 'No'}
                          labelPlacement="end"
                        />
                      )}
                    </TableCell>

                    <TableCell>
                      <IconButton size="small" color="primary" onClick={() => openEdit(u)}>
                        <Edit2 size={16} />
                      </IconButton>
                      <IconButton size="small" color="error" onClick={() => confirmAndDelete(u)}>
                        <Trash2 size={16} />
                      </IconButton>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </TableContainer>
      </SectionCard>

      <Dialog open={editOpen} onClose={closeEdit} fullWidth maxWidth="sm">
        <DialogTitle>Edit User</DialogTitle>
        <DialogContent>
          {selectedUser ? (
            <Box sx={{ mt: 1, display: 'grid', gap: 12 }}>
              <TextField label="Name" size="small" value={selectedUser.displayName || ''} disabled />
              <TextField label="Email" size="small" value={selectedUser.email || ''} disabled />
              <TextField label="Staff ID" size="small" value={selectedUser.staffId || selectedUser.raw?.staffId || '—'} disabled />

              <FormControl fullWidth size="small">
                <InputLabel id="role-label">Role</InputLabel>
                <Select
                  labelId="role-label"
                  label="Role"
                  value={selectedUser.role || 'user'}
                  onChange={(e) => setSelectedUser((s) => ({ ...s, role: e.target.value }))}
                >
                  <MenuItem value="customer">Customer</MenuItem>
                  <MenuItem value="admin">Admin</MenuItem>
                  <MenuItem value="manager">Manager</MenuItem>
                  <MenuItem value="staff">Staff</MenuItem>
                </Select>
              </FormControl>

              <FormControlLabel
                control={<Switch checked={!!selectedUser.active} onChange={(e) => setSelectedUser((s) => ({ ...s, active: e.target.checked }))} />}
                label="Active"
              />

              <Box sx={{ pt: 1, borderTop: '1px solid', borderColor: 'divider' }}>
                <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1 }}>
                  Temporary Block
                </Typography>

                {selectedUser.blockedUntilMs && selectedUser.blockedUntilMs > Date.now() ? (
                  <Alert severity="warning" sx={{ mb: 1.5 }}>
                    This account is blocked until <strong>{formatUntil(selectedUser.blockedUntilMs)}</strong>.
                  </Alert>
                ) : (
                  <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
                    Block this user’s access for a set duration.
                  </Typography>
                )}

                <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} alignItems={{ xs: 'stretch', sm: 'center' }}>
                  <FormControl size="small" sx={{ minWidth: 180 }}>
                    <InputLabel id="block-duration">Duration</InputLabel>
                    <Select
                      labelId="block-duration"
                      label="Duration"
                      value={blockDuration}
                      onChange={(e) => setBlockDuration(e.target.value)}
                      disabled={saving || selectedUser.id === currentUser?.uid}
                    >
                      <MenuItem value="15m">15 minutes</MenuItem>
                      <MenuItem value="1h">1 hour</MenuItem>
                      <MenuItem value="4h">4 hours</MenuItem>
                      <MenuItem value="1d">1 day</MenuItem>
                      <MenuItem value="7d">7 days</MenuItem>
                    </Select>
                  </FormControl>

                  <Button
                    variant="outlined"
                    color="warning"
                    onClick={blockUser}
                    disabled={saving || selectedUser.id === currentUser?.uid}
                  >
                    Block
                  </Button>
                  <Button
                    variant="outlined"
                    onClick={unblockUser}
                    disabled={saving || !(selectedUser.blockedUntilMs && selectedUser.blockedUntilMs > Date.now())}
                  >
                    Unblock
                  </Button>
                </Stack>

                {selectedUser.id === currentUser?.uid ? (
                  <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
                    You can’t block your own account.
                  </Typography>
                ) : null}
              </Box>
            </Box>
          ) : (
            <Typography>Loading…</Typography>
          )}
        </DialogContent>

        <DialogActions>
          <Button onClick={closeEdit} disabled={saving}>Cancel</Button>
          <Button variant="contained" onClick={saveEdit} disabled={saving}>
            {saving ? 'Saving…' : 'Save'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Create Staff Dialog */}
      <Dialog open={createOpen} onClose={() => setCreateOpen(false)} fullWidth maxWidth="sm">
        <DialogTitle>Create User</DialogTitle>
        <DialogContent>
          <Box sx={{ display: 'grid', gap: 2, mt: 1 }}>
            {createError && <Alert severity="error">{createError}</Alert>}
            <TextField label="Name" size="small" value={newName} onChange={(e) => setNewName(e.target.value)} />
            <TextField label="Email" size="small" value={newEmail} onChange={(e) => setNewEmail(e.target.value)} />
            <TextField label="Password" size="small" type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} helperText="Temporary password for staff (they can reset later)" />
            <FormControl size="small">
              <InputLabel id="role-create-label">Role</InputLabel>
              <Select
                labelId="role-create-label"
                value={newRole}
                label="Role"
                onChange={(e) => setNewRole(String(e.target.value || 'staff').toLowerCase())}
              >
                <MenuItem value="staff">Staff</MenuItem>
                <MenuItem value="manager">Manager</MenuItem>
              </Select>
            </FormControl>

            <TextField label="Your Admin Password (confirm)" size="small" type="password" value={adminPassword} onChange={(e) => setAdminPassword(e.target.value)} helperText="Enter your password to confirm creating a staff user" />
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setCreateOpen(false)} disabled={creating}>Cancel</Button>
          <Button variant="contained" onClick={async () => {
            setCreateError('')
            if (!newName || !newEmail || !newPassword || !adminPassword) {
              setCreateError('All fields are required')
              return
            }
            setCreating(true)
            try {
              const adminEmailBefore = currentUser?.email
              if (!currentUser?.uid || !adminEmailBefore) throw new Error('Admin session missing. Please sign in again.')

              // Validate admin password (does not sign out / change session)
              try {
                const cred = EmailAuthProvider.credential(adminEmailBefore, adminPassword)
                await reauthenticateWithCredential(auth.currentUser, cred)
              } catch (reauthErr) {
                console.error('Admin re-authentication failed', reauthErr)
                throw new Error('Admin password is incorrect. Please try again.')
              }

              const roleToCreate = String(newRole || 'staff').toLowerCase()
              if (roleToCreate !== 'staff' && roleToCreate !== 'manager') {
                throw new Error('Invalid role selected')
              }

              const idPrefix = roleToCreate === 'manager' ? 'MID' : 'SID'

              // Generate ID: SID/MID + YY + zero-padded sequence (4 digits)
              const year = (new Date()).getFullYear() % 100
              // Count existing users for that role (no composite index required)
              const q = query(usersRef, where('role', '==', roleToCreate))
              const snap = await getDocs(q)
              const seq = (snap.size || 0) + 1
              const seqStr = String(seq).padStart(4, '0')
              const staffId = `${idPrefix}${String(year).padStart(2,'0')}${seqStr}`

              // Create auth user using a secondary auth instance.
              // This avoids replacing the current admin session (which triggers unauthorized redirects).
              const secondaryAuth = getSecondaryAuth()
              const cred = await createUserWithEmailAndPassword(secondaryAuth, newEmail, newPassword)
              const uid = cred.user.uid

              // Write Firestore user profile using UID as document id
              await setDoc(doc(db, 'users', uid), {
                uid,
                email: newEmail,
                displayName: newName,
                role: roleToCreate,
                active: true,
                staffId,
                registeredAt: new Date().toISOString(),
              })

              // Clean up secondary auth session (best effort)
              try { await signOut(secondaryAuth) } catch { /* ignore */ }

              setCreateOpen(false)
              // Refresh the list to include the new staff
              await fetchUsers()
            } catch (err) {
              console.error('Failed to create staff:', err)
              setCreateError(err?.message || String(err))
            } finally {
              setCreating(false)
            }
          }} disabled={creating}>
            {creating ? 'Creating…' : 'Create Staff'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default UserManagement;

