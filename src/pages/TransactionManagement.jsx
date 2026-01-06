import React, { useMemo, useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { db } from '../firebaseConfig';
import PageHeader from '../components/ui/PageHeader';
import SectionCard from '../components/ui/SectionCard';
import { collection, getDocs, query, orderBy, deleteDoc, doc } from 'firebase/firestore';
import {
    Box,
    Button,
    Typography,
    Table,
    TableBody,
    TableCell,
    TableContainer,
    TableHead,
    TableRow,
    CircularProgress,
    Alert,
    FormControl,
    InputLabel,
    MenuItem,
    Select,
    TextField,
} from '@mui/material';

function normalizeProvider(v) {
    return String(v || '').trim().toLowerCase();
}

function getTxnProvider(txn) {
    const method = normalizeProvider(txn?.paymentMethod || txn?.payment_method);
    if (method) return method;

    const paymentDetails = txn?.paymentDetails || txn?.payment_details || {};
    const provider = normalizeProvider(paymentDetails?.provider);
    return provider;
}

const TransactionManagement = ({ provider = 'all' }) => {
    const navigate = useNavigate();
    const [transactions, setTransactions] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [actionError, setActionError] = useState(null);
    const [deletingId, setDeletingId] = useState(null);

    const normalizedProvider = normalizeProvider(provider);
    const isBillplzPage = normalizedProvider === 'billplz';
    const isStripePage = normalizedProvider === 'stripe';
    const isAllPage = !normalizedProvider || normalizedProvider === 'all';

    const emptyColSpan = 7 + (isAllPage ? 3 : isBillplzPage ? 2 : isStripePage ? 1 : 0);

    const [rangeType, setRangeType] = useState('WEEK'); // DAY | WEEK | MONTH
    const [rangeDate, setRangeDate] = useState(() => new Date().toISOString().slice(0, 10)); // YYYY-MM-DD
    const [rangeMonth, setRangeMonth] = useState(() => new Date().toISOString().slice(0, 7)); // YYYY-MM

    const transactionsCollectionRef = collection(db, 'transactions');

    const toMs = (timestamp) => {
        if (!timestamp) return null;
        try {
            if (typeof timestamp?.toDate === 'function') return timestamp.toDate().getTime();
            if (typeof timestamp === 'object' && timestamp?.seconds) return Number(timestamp.seconds) * 1000;
            if (typeof timestamp === 'number') return timestamp;
            const d = new Date(timestamp);
            if (Number.isNaN(d.getTime())) return null;
            return d.getTime();
        } catch {
            return null;
        }
    };

    const getTxMs = (txn) => {
        return (
            toMs(txn?.timestamp) ??
            toMs(txn?.createdAt) ??
            toMs(txn?.created_at) ??
            null
        );
    };

    const formatTimestamp = (timestamp) => {
        if (!timestamp) return 'N/A';
        try {
            // Firestore Timestamp
            if (typeof timestamp?.toDate === 'function') {
                return timestamp.toDate().toLocaleString('en-MY', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
            }

            // Firestore Timestamp-like { seconds, nanoseconds }
            if (typeof timestamp === 'object' && timestamp?.seconds) {
                const ms = Number(timestamp.seconds) * 1000;
                return new Date(ms).toLocaleString('en-MY', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
            }

            // millis number or string
            const date = new Date(timestamp);
            if (Number.isNaN(date.getTime())) return 'Invalid Date';
            return date.toLocaleString('en-MY', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
        } catch {
            return 'Invalid Date';
        }
    };

    const fetchTransactions = async () => {
        setLoading(true);
        setError(null);
        try {
            const q = query(transactionsCollectionRef, orderBy('timestamp', 'desc'));
            const data = await getDocs(q);
            const transactionsList = data.docs.map((d) => ({ id: d.id, ...d.data() }));
            setTransactions(transactionsList);
        } catch (err) {
            console.error('Error fetching transactions:', err);
            setError('Failed to load transactions. Check Firestore access rules.');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchTransactions();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const { startMs, endMs, rangeLabel } = useMemo(() => {
        // Use local time boundaries for user-friendly filtering
        if (rangeType === 'MONTH') {
            const [y, m] = String(rangeMonth || '').split('-').map(Number);
            const start = (y && m) ? new Date(y, m - 1, 1, 0, 0, 0, 0) : new Date();
            const end = new Date(start.getFullYear(), start.getMonth() + 1, 1, 0, 0, 0, 0);
            const label = `${String(start.getFullYear())}-${String(start.getMonth() + 1).padStart(2, '0')}`;
            return { startMs: start.getTime(), endMs: end.getTime(), rangeLabel: `month-${label}` };
        }

        const d = rangeDate ? new Date(`${rangeDate}T00:00:00`) : new Date();
        const dayStart = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0);
        const dayEnd = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1, 0, 0, 0, 0);

        if (rangeType === 'DAY') {
            return { startMs: dayStart.getTime(), endMs: dayEnd.getTime(), rangeLabel: `day-${rangeDate}` };
        }

        // WEEK: 7-day window ending on selected date
        const weekStart = new Date(dayStart.getFullYear(), dayStart.getMonth(), dayStart.getDate() - 6, 0, 0, 0, 0);
        return { startMs: weekStart.getTime(), endMs: dayEnd.getTime(), rangeLabel: `week-ending-${rangeDate}` };
    }, [rangeType, rangeDate, rangeMonth]);

    const filteredTransactions = useMemo(() => {
        const list = transactions
            .map((t) => ({ ...t, __ms: getTxMs(t) ?? 0 }))
            .filter((t) => t.__ms >= startMs && t.__ms < endMs)
            .filter((t) => {
                if (isAllPage) return true;
                const p = getTxnProvider(t);
                return p === normalizedProvider;
            })
            .sort((a, b) => (b.__ms || 0) - (a.__ms || 0));
        return list;
    }, [transactions, startMs, endMs, isAllPage, normalizedProvider]);

    const toCsvCell = (value) => {
        const s = value === undefined || value === null ? '' : String(value);
        const escaped = s.replace(/"/g, '""');
        return `"${escaped}"`;
    };

    const downloadCsv = () => {
        setActionError(null);
        try {
            const headers = [
                'transaction_id',
                'timestamp',
                'station_id',
                'customer_uid',
                'total_amount',
                'payment_status',
                'payment_method',
                'billplz_bill_id',
                'billplz_state',
                'billplz_paid_at',
            ];

            const rows = filteredTransactions.map((txn) => {
                const paymentDetails = txn.paymentDetails || txn.payment_details || {};
                const provider = String(paymentDetails.provider || '').toLowerCase();
                const billId = provider === 'billplz' ? (paymentDetails.bill_id || paymentDetails.billId || '') : '';
                const state = provider === 'billplz' ? (paymentDetails.state || '') : '';
                const paidAt = provider === 'billplz' ? (paymentDetails.paid_at || paymentDetails.paidAt || '') : '';

                const ms = getTxMs(txn);
                const tsIso = ms ? new Date(ms).toISOString() : '';

                const station = txn.stationId || txn.station_id || '';
                const customer = txn.customerUID || txn.customerUid || txn.customer_id || 'Guest';
                const total = (txn.totalAmount ?? txn.total_amount ?? 0);
                const paymentStatus = txn.paymentStatus || txn.payment_status || txn.status || '';
                const paymentMethod = txn.paymentMethod || txn.payment_method || '';

                const values = [
                    txn.id,
                    tsIso,
                    station,
                    customer,
                    Number(total || 0).toFixed(2),
                    paymentStatus,
                    paymentMethod,
                    billId,
                    state,
                    paidAt,
                ];

                return values.map(toCsvCell).join(',');
            });

            const csv = [headers.map(toCsvCell).join(','), ...rows].join('\n');
            const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `transactions-${rangeLabel}.csv`;
            document.body.appendChild(a);
            a.click();
            a.remove();
            URL.revokeObjectURL(url);
        } catch (e) {
            console.error('CSV export failed', e);
            setActionError('Failed to export CSV. See console for details.');
        }
    };

    const handleDelete = async (txId) => {
        if (!txId) return;
        setActionError(null);

        const ok = window.confirm('Delete this transaction? This cannot be undone.');
        if (!ok) return;

        setDeletingId(txId);
        try {
            await deleteDoc(doc(db, 'transactions', txId));
            setTransactions((prev) => prev.filter((t) => t.id !== txId));
        } catch (err) {
            console.error('Failed to delete transaction:', err);
            setActionError(err?.message || 'Failed to delete transaction. Check Firestore access rules.');
        } finally {
            setDeletingId(null);
        }
    };

    return (
        <Box sx={{ p: 2 }}>
            <PageHeader
                title={isStripePage ? 'Stripe Transactions' : isBillplzPage ? 'Billplz Transactions' : 'Transactions'}
                subtitle={isStripePage ? 'Stripe payments only.' : isBillplzPage ? 'Billplz payments only.' : 'Filter by date range, export to CSV, and view transaction details.'}
                actions={
                    <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                        <Button
                            size="small"
                            variant={isAllPage ? 'contained' : 'outlined'}
                            onClick={() => navigate('/admin/transactions')}
                        >
                            All
                        </Button>
                        <Button
                            size="small"
                            variant={isStripePage ? 'contained' : 'outlined'}
                            onClick={() => navigate('/admin/transactions/stripe')}
                        >
                            Stripe
                        </Button>
                        <Button
                            size="small"
                            variant={isBillplzPage ? 'contained' : 'outlined'}
                            onClick={() => navigate('/admin/transactions/billplz')}
                        >
                            Billplz
                        </Button>
                    </Box>
                }
            />

            <SectionCard
                title={`Transaction History (${filteredTransactions.length} records)`}
                sx={{ mb: 2 }}
            >
                <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', alignItems: 'center', mb: 1 }}>
                    <FormControl size="small" sx={{ minWidth: 160 }}>
                        <InputLabel id="tx-range-type">Range</InputLabel>
                        <Select
                            labelId="tx-range-type"
                            value={rangeType}
                            label="Range"
                            onChange={(e) => setRangeType(String(e.target.value))}
                        >
                            <MenuItem value="DAY">Day</MenuItem>
                            <MenuItem value="WEEK">Week</MenuItem>
                            <MenuItem value="MONTH">Month</MenuItem>
                        </Select>
                    </FormControl>

                    {rangeType === 'MONTH' ? (
                        <TextField
                            size="small"
                            label="Select month"
                            type="month"
                            value={rangeMonth}
                            onChange={(e) => setRangeMonth(e.target.value)}
                            InputLabelProps={{ shrink: true }}
                        />
                    ) : (
                        <TextField
                            size="small"
                            label="Select date"
                            type="date"
                            value={rangeDate}
                            onChange={(e) => setRangeDate(e.target.value)}
                            InputLabelProps={{ shrink: true }}
                        />
                    )}

                    <Button variant="outlined" onClick={downloadCsv} disabled={loading || filteredTransactions.length === 0}>
                        Download CSV
                    </Button>
                </Box>

                {actionError && <Alert severity="error" sx={{ mb: 2 }}>{actionError}</Alert>}

                {loading ? (
                    <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', py: 6 }}>
                        <CircularProgress />
                    </Box>
                ) : error ? (
                    <Alert severity="error">{error}</Alert>
                ) : (
                    <TableContainer>
                        <Table
                            size="small"
                            sx={{
                                '& .MuiTableCell-root': {
                                    py: 0.75,
                                    px: 1,
                                    fontSize: 12,
                                    lineHeight: 1.25,
                                },
                                '& .MuiTableCell-head': {
                                    py: 1,
                                    fontSize: 12,
                                },
                            }}
                        >
                            <TableHead
                                sx={{
                                    backgroundColor: (theme) =>
                                        theme.palette.mode === 'dark' ? theme.palette.background.paper : theme.palette.grey[50],
                                    '& th': { color: (theme) => theme.palette.text.primary },
                                }}
                            >
                                <TableRow>
                                    <TableCell sx={{ fontWeight: 600 }}>Transaction ID</TableCell>
                                    <TableCell sx={{ fontWeight: 600 }}>Timestamp</TableCell>
                                    <TableCell sx={{ fontWeight: 600 }}>Station</TableCell>
                                    <TableCell sx={{ fontWeight: 600 }}>Customer UID</TableCell>
                                    {isAllPage ? (
                                        <>
                                            <TableCell sx={{ fontWeight: 600 }}>Provider</TableCell>
                                            <TableCell sx={{ fontWeight: 600 }}>Reference ID</TableCell>
                                            <TableCell sx={{ fontWeight: 600 }}>Paid At</TableCell>
                                        </>
                                    ) : isStripePage ? (
                                        <TableCell sx={{ fontWeight: 600 }}>Stripe Session</TableCell>
                                    ) : isBillplzPage ? (
                                        <>
                                            <TableCell sx={{ fontWeight: 600 }}>Billplz Bill ID</TableCell>
                                            <TableCell sx={{ fontWeight: 600 }}>Billplz Paid At</TableCell>
                                        </>
                                    ) : null}
                                    <TableCell sx={{ fontWeight: 600 }}>Total</TableCell>
                                    <TableCell sx={{ fontWeight: 600 }}>Payment Status</TableCell>
                                    <TableCell sx={{ fontWeight: 600, textAlign: 'right' }}>Actions</TableCell>
                                </TableRow>
                            </TableHead>

                            <TableBody>
                                {filteredTransactions.length === 0 ? (
                                    <TableRow>
                                        <TableCell colSpan={emptyColSpan} sx={{ py: 6, textAlign: 'center' }}>
                                            No transactions found yet. Try completing a checkout simulation.
                                        </TableCell>
                                    </TableRow>
                                ) : (
                                    filteredTransactions.map((txn) => {
                                        const paymentDetails = txn.paymentDetails || txn.payment_details || {};
                                        const provider = String(paymentDetails.provider || '').toLowerCase();
                                        const billId = provider === 'billplz' ? (paymentDetails.bill_id || paymentDetails.billId || '') : '';
                                        const paidAt = provider === 'billplz' ? (paymentDetails.paid_at || paymentDetails.paidAt || '') : '';
                                        const stripeSessionId = provider === 'stripe' ? (paymentDetails.session_id || paymentDetails.sessionId || '') : '';

                                        const providerDisplay = provider || getTxnProvider(txn) || '—';
                                        const referenceId = provider === 'stripe' ? stripeSessionId : provider === 'billplz' ? billId : '';

                                        const station = txn.stationId || txn.station_id || '—';
                                        const customer = txn.customerUID || txn.customerUid || txn.customer_id || 'Guest';
                                        const total = (txn.totalAmount ?? txn.total_amount ?? 0);
                                        const paymentStatus = txn.paymentStatus || txn.payment_status || txn.status || 'Completed';

                                        const isSuccess = String(paymentStatus).toLowerCase().includes('paid') || String(paymentStatus).toLowerCase().includes('success');

                                        return (
                                            <TableRow key={txn.id} hover>
                                                <TableCell sx={{ fontFamily: 'monospace', whiteSpace: 'nowrap' }}>{txn.id?.substring(0, 8) || '—'}…</TableCell>
                                                <TableCell sx={{ whiteSpace: 'nowrap' }}>{formatTimestamp(txn.timestamp)}</TableCell>
                                                <TableCell sx={{ fontFamily: 'monospace', whiteSpace: 'nowrap' }}>{station}</TableCell>
                                                <TableCell sx={{ fontFamily: 'monospace', whiteSpace: 'nowrap' }}>{customer}</TableCell>
                                                {isAllPage ? (
                                                    <>
                                                        <TableCell sx={{ fontFamily: 'monospace', whiteSpace: 'nowrap' }}>{providerDisplay}</TableCell>
                                                        <TableCell sx={{ fontFamily: 'monospace', whiteSpace: 'nowrap' }}>{referenceId ? String(referenceId) : '—'}</TableCell>
                                                        <TableCell sx={{ whiteSpace: 'nowrap' }}>{paidAt ? String(paidAt) : '—'}</TableCell>
                                                    </>
                                                ) : isStripePage ? (
                                                    <TableCell sx={{ fontFamily: 'monospace', whiteSpace: 'nowrap' }}>{stripeSessionId ? String(stripeSessionId) : '—'}</TableCell>
                                                ) : isBillplzPage ? (
                                                    <>
                                                        <TableCell sx={{ fontFamily: 'monospace', whiteSpace: 'nowrap' }}>{billId ? String(billId) : '—'}</TableCell>
                                                        <TableCell sx={{ whiteSpace: 'nowrap' }}>{paidAt ? String(paidAt) : '—'}</TableCell>
                                                    </>
                                                ) : null}
                                                <TableCell sx={{ fontWeight: 700, color: (theme) => theme.palette.success.dark, whiteSpace: 'nowrap' }}>
                                                    RM{Number(total || 0).toFixed(2)}
                                                </TableCell>
                                                <TableCell>
                                                    <Box component="span" sx={{ px: 1, py: 0.5, borderRadius: 999, bgcolor: isSuccess ? 'success.light' : 'error.light', color: isSuccess ? 'success.dark' : 'error.dark', fontSize: 12, fontWeight: 600 }}>
                                                        {paymentStatus}
                                                    </Box>
                                                </TableCell>
                                                <TableCell align="right">
                                                    <Button
                                                        sx={{ mr: 1, minWidth: 0, px: 1 }}
                                                        variant="outlined"
                                                        size="small"
                                                        onClick={() => navigate(`/admin/transactions/${encodeURIComponent(txn.id)}`)}
                                                    >
                                                        View
                                                    </Button>
                                                    <Button
                                                        color="error"
                                                        variant="outlined"
                                                        size="small"
                                                        disabled={deletingId === txn.id}
                                                        onClick={() => handleDelete(txn.id)}
                                                        sx={{ minWidth: 0, px: 1 }}
                                                    >
                                                        {deletingId === txn.id ? 'Deleting…' : 'Delete'}
                                                    </Button>
                                                </TableCell>
                                            </TableRow>
                                        );
                                    })
                                )}
                            </TableBody>
                        </Table>
                    </TableContainer>
                )}
            </SectionCard>
        </Box>
    );
};

export default TransactionManagement;