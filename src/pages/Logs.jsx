import React, { useEffect, useState } from 'react';
import { collection, getDocs } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { db } from '../firebaseConfig';
import { fns } from '../firebaseConfig';
import { useAuth } from '../context/AuthContext.jsx';
import PageHeader from '../components/ui/PageHeader';
import SectionCard from '../components/ui/SectionCard';
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
  Button,
  CircularProgress,
  Alert,
  Chip,
  IconButton,
  Tooltip,
} from '@mui/material';
import { Search, Trash2, Lock } from 'lucide-react';

const Logs = () => {
  const { currentRole } = useAuth();
  const isAdmin = String(currentRole || '').toLowerCase() === 'admin';

  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState('');
  const [deletingId, setDeletingId] = useState('');

  const logsRef = collection(db, 'logs');

  const fetchLogs = async () => {
    setLoading(true);
    setError(null);
    try {
      const snap = await getDocs(logsRef);

      const toMsLocal = (t) => {
        if (!t) return null;
        try {
          if (typeof t?.toDate === 'function') return t.toDate().getTime();
          if (typeof t === 'object' && typeof t?.seconds === 'number') return Math.floor(t.seconds * 1000);
          if (typeof t === 'number') return t;
          const ms = Date.parse(String(t));
          return Number.isFinite(ms) ? ms : null;
        } catch {
          return null;
        }
      };

      const list = snap.docs.map((d) => {
        const data = d.data() || {};
        const timestamp = data.timestamp || data.time || data.createdAt || null;
        const type = data.type || data.eventType || data.action || '';
        const actorUID = data.actorUID || data.actorUid || data.userUID || data.uid || '';
        const actorRole = data.actorRole || data.role || '';
        const target = data.targetId || data.targetUID || data.targetUid || '';
        const metadata = data.metadata || data.payload || data.data || null;

        const createdAt = data.createdAt || null;
        const deletableAfter = data.deletableAfter || null;
        const expiresAt = data.expiresAt || null;

        let message = data.message || data.msg || '';
        if (!message && type) {
          // Friendly fallback for older audit logs that only wrote `type`.
          if (type === 'role_change') message = `Role changed for ${data.targetUID || target || 'user'}`;
          else if (type === 'access_block') message = `Access blocked for ${data.targetUID || target || 'user'}`;
          else if (type === 'access_unblock') message = `Access unblocked for ${data.targetUID || target || 'user'}`;
          else message = type;
        }
        if (!message && metadata) {
          try {
            message = JSON.stringify(metadata);
          } catch {
            message = String(metadata);
          }
        }

        return {
          id: d.id,
          level: data.level || data.severity || 'info',
          type,
          actorUID,
          actorRole,
          target,
          message,
          details: metadata,
          source: data.source || data.module || '',
          timestamp,
          createdAt,
          deletableAfter,
          expiresAt,
          raw: data,
        };
      });

      list.sort((a, b) => {
        const ta = toMsLocal(a.timestamp) ?? 0;
        const tb = toMsLocal(b.timestamp) ?? 0;
        return tb - ta;
      });

      setLogs(list);
    } catch (err) {
      console.error('Failed to fetch logs:', err);
      setError(err?.message || String(err) || 'Unknown error');
      setLogs([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchLogs();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const filtered = logs.filter((l) => {
    if (!search) return true;
    const s = search.toLowerCase();
    return (
      (l.message || '').toLowerCase().includes(s) ||
      (l.level || '').toLowerCase().includes(s) ||
      (l.source || '').toLowerCase().includes(s) ||
      (l.type || '').toLowerCase().includes(s) ||
      (l.actorUID || '').toLowerCase().includes(s) ||
      (l.target || '').toLowerCase().includes(s)
    );
  });

  const fmtTime = (t) => {
    if (!t) return '—';
    try {
      const ms =
        typeof t?.toDate === 'function'
          ? t.toDate().getTime()
          : typeof t === 'object' && typeof t?.seconds === 'number'
            ? Math.floor(t.seconds * 1000)
            : typeof t === 'number'
              ? t
              : Date.parse(String(t));
      if (!Number.isFinite(ms)) return '—';
      return new Date(ms).toLocaleString();
    } catch {
      return '—';
    }
  };

  const toMs = (t) => {
    if (!t) return null;
    try {
      if (typeof t?.toDate === 'function') return t.toDate().getTime();
      if (typeof t === 'object' && typeof t?.seconds === 'number') return Math.floor(t.seconds * 1000);
      if (typeof t === 'number') return t;
      const ms = Date.parse(String(t));
      return Number.isFinite(ms) ? ms : null;
    } catch {
      return null;
    }
  };

  const nowMs = Date.now();
  const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;

  const getLogAgeMs = (l) => {
    const ms = toMs(l?.createdAt) ?? toMs(l?.timestamp);
    if (!ms) return null;
    return Math.max(0, nowMs - ms);
  };

  const canDelete = (l) => {
    const deletableMs = toMs(l?.deletableAfter);
    if (deletableMs) return nowMs >= deletableMs;

    const age = getLogAgeMs(l);
    if (age === null) return true; // legacy/unparseable: don't block UI
    return age >= sevenDaysMs;
  };

  const isLocked = (l) => !canDelete(l);

  const deleteLog = async (logId) => {
    if (!logId) return;
    const ok = window.confirm('Delete this log?');
    if (!ok) return;

    setDeletingId(logId);
    setError(null);
    try {
      const fn = httpsCallable(fns, 'deleteLog');
      await fn({ logId });
      setLogs((prev) => prev.filter((x) => x.id !== logId));
    } catch (err) {
      console.error('deleteLog failed', err);
      const msg = err?.message || 'Delete failed.';
      setError(msg);
    } finally {
      setDeletingId('');
    }
  };

  return (
    <Box sx={{ p: 3 }}>
      <PageHeader title="Logs" subtitle="Audit and debug events recorded in Firestore." />

      <Alert severity="info" sx={{ mb: 2 }}>
        Logs are locked for the first 7 days. After 7 days, logs can be deleted manually (admin only). Logs older than 14 days are automatically removed.
      </Alert>

      <SectionCard sx={{ mb: 3 }}>
        <Box sx={{ display: 'flex', gap: 2, alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap' }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <Search size={16} />
            <TextField size="small" placeholder="Search logs" value={search} onChange={(e) => setSearch(e.target.value)} />
          </Box>

          <Box>
            <Button variant="contained" onClick={fetchLogs} sx={{ ml: 1 }}>
              Refresh
            </Button>
          </Box>
        </Box>
      </SectionCard>

      {error && (
        <Box sx={{ mb: 2 }}>
          <Alert severity="error">{error} — check Firestore rules and network.</Alert>
        </Box>
      )}

      <SectionCard title={`Logs (${filtered.length})`}>
        <TableContainer sx={{ overflowX: 'auto' }}>
          <Table size="small" sx={{ tableLayout: 'fixed', minWidth: 860 }}>
            <TableHead
              sx={{
                backgroundColor: (theme) =>
                  theme.palette.mode === 'dark' ? theme.palette.background.paper : theme.palette.grey[50],
                '& th': {
                  color: (theme) => theme.palette.text.primary,
                  py: 0.75,
                  px: 1,
                  fontSize: 12,
                  whiteSpace: 'nowrap',
                },
              }}
            >
              <TableRow>
                <TableCell sx={{ fontWeight: 600, width: 170 }}>Time</TableCell>
                <TableCell sx={{ fontWeight: 600, width: 120 }}>Type</TableCell>
                <TableCell sx={{ fontWeight: 600, width: 170 }}>Actor</TableCell>
                <TableCell sx={{ fontWeight: 600, width: 160 }}>Target</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>Message</TableCell>
                <TableCell sx={{ fontWeight: 600, width: 110 }}>Source</TableCell>
                <TableCell sx={{ fontWeight: 600, width: 56 }} align="right">Action</TableCell>
              </TableRow>
            </TableHead>

            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell colSpan={7} sx={{ py: 4, textAlign: 'center' }}>
                    <CircularProgress size={24} />
                  </TableCell>
                </TableRow>
              ) : filtered.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} sx={{ py: 3, textAlign: 'center' }}>
                    No logs found.
                  </TableCell>
                </TableRow>
              ) : (
                filtered.map((l) => (
                  <TableRow key={l.id} hover sx={{ '& td': { py: 0.5, px: 1, fontSize: 12, verticalAlign: 'top' } }}>
                    <TableCell sx={{ whiteSpace: 'nowrap' }}>{fmtTime(l.timestamp)}</TableCell>
                    <TableCell>
                      {l.type ? (
                        <Chip size="small" label={l.type} variant="outlined" />
                      ) : (
                        <Typography variant="body2" color="text.secondary">—</Typography>
                      )}
                    </TableCell>
                    <TableCell sx={{ fontFamily: 'monospace' }}>
                      <Tooltip title={`${l.actorUID || '—'}${l.actorRole ? ` (${l.actorRole})` : ''}`}>
                        <Box sx={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {l.actorUID || '—'}{l.actorRole ? ` (${l.actorRole})` : ''}
                        </Box>
                      </Tooltip>
                    </TableCell>
                    <TableCell sx={{ fontFamily: 'monospace' }}>
                      <Tooltip title={l.target || '—'}>
                        <Box sx={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {l.target || '—'}
                        </Box>
                      </Tooltip>
                    </TableCell>
                    <TableCell>
                      <Tooltip title={l.message || '—'}>
                        <Box
                          sx={{
                            display: '-webkit-box',
                            WebkitLineClamp: 2,
                            WebkitBoxOrient: 'vertical',
                            overflow: 'hidden',
                            wordBreak: 'break-word',
                          }}
                        >
                          {l.message || '—'}
                        </Box>
                      </Tooltip>

                      {l.details ? (
                        <Tooltip
                          title={(() => {
                            try {
                              return JSON.stringify(l.details)
                            } catch {
                              return String(l.details)
                            }
                          })()}
                        >
                          <Box
                            component="div"
                            sx={{
                              mt: 0.25,
                              fontSize: 11,
                              color: 'text.secondary',
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              whiteSpace: 'nowrap',
                            }}
                          >
                            {(() => {
                              try {
                                return JSON.stringify(l.details)
                              } catch {
                                return String(l.details)
                              }
                            })()}
                          </Box>
                        </Tooltip>
                      ) : null}
                    </TableCell>
                    <TableCell>
                      <Tooltip title={l.source || '—'}>
                        <Box sx={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {l.source || '—'}
                        </Box>
                      </Tooltip>
                    </TableCell>

                    <TableCell align="right">
                      {!isAdmin ? (
                        <Tooltip title="Admin only">
                          <span>
                            <IconButton size="small" disabled>
                              <Lock size={16} />
                            </IconButton>
                          </span>
                        </Tooltip>
                      ) : isLocked(l) ? (
                        <Tooltip title="Locked for 7 days">
                          <span>
                            <IconButton size="small" disabled>
                              <Lock size={16} />
                            </IconButton>
                          </span>
                        </Tooltip>
                      ) : (
                        <Tooltip title="Delete">
                          <span>
                            <IconButton
                              size="small"
                              color="error"
                              disabled={Boolean(deletingId) && deletingId === l.id}
                              onClick={() => deleteLog(l.id)}
                            >
                              <Trash2 size={16} />
                            </IconButton>
                          </span>
                        </Tooltip>
                      )}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </TableContainer>
      </SectionCard>
    </Box>
  );
};

export default Logs;
