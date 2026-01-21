import React, { useMemo, useState, useEffect } from 'react';
import { collection, query, getDocs, orderBy, limit, doc, getDoc, where, Timestamp } from 'firebase/firestore';
import { useNavigate } from 'react-router-dom';
import { db } from '../firebaseConfig';
import { Users, ShoppingBag, DollarSign, AlertTriangle, Package, ArrowRight } from 'lucide-react';
import PageHeader from '../components/ui/PageHeader';
import SectionCard from '../components/ui/SectionCard';
import AiSummary from '../components/AiSummary.jsx';
import { useAuth } from '../context/AuthContext.jsx';

import { useTheme } from '@mui/material/styles';
import { alpha } from '@mui/material/styles';
import {
    Box,
    Grid,
    Typography,
    Button,
    Table,
    TableBody,
    TableCell,
    TableContainer,
    TableHead,
    TableRow,
} from '@mui/material';

import MetricCard from '../components/ui/MetricCard';

const AdminDashboard = () => {
    const navigate = useNavigate();
    const theme = useTheme();
    const { currentRole, currentUser } = useAuth();

    const welcomeName = useMemo(() => {
        const u = currentUser;
        if (!u) return '';
        const name = u.displayName || u.fullName || u.name || u.email || '';
        return String(name || '').trim();
    }, [currentUser]);

    const [recentTransactions, setRecentTransactions] = useState([]);
    const [executiveSalesPayload, setExecutiveSalesPayload] = useState(null);
    const [loading, setLoading] = useState(true);
    const [lowStockPreview, setLowStockPreview] = useState([]);
    const [metricCounts, setMetricCounts] = useState({
        totalItems: 0,
        totalUsers: 0,
        totalTransactions: 0,
        lowStockItems: 0,
    });

    const transactionsCollectionRef = collection(db, 'transactions');

    const toMs = (ts) => {
        if (!ts) return null;
        try {
            if (typeof ts?.toDate === 'function') return ts.toDate().getTime();
            if (typeof ts === 'object' && typeof ts?.seconds === 'number') return Math.floor(ts.seconds * 1000);
            if (typeof ts === 'number') return ts;
            const ms = Date.parse(String(ts));
            return Number.isFinite(ms) ? ms : null;
        } catch {
            return null;
        }
    };

    const isPaidTx = (tx) => {
        const status = String(tx?.paymentStatus ?? tx?.payment_status ?? tx?.status ?? '').toLowerCase();
        if (!status) return true;
        if (status.includes('fail') || status.includes('failed') || status.includes('cancel') || status.includes('cancelled') || status.includes('unpaid')) return false;
        if (status.includes('paid') || status.includes('success') || status.includes('completed')) return true;
        return true;
    };

    const getAmount = (tx) => {
        const v = (tx?.totalAmount ?? tx?.total_amount ?? 0);
        const n = Number(v);
        return Number.isFinite(n) ? n : 0;
    };

    const toDateKey = (ms) => {
        if (!ms) return 'unknown';
        try {
            return new Date(ms).toISOString().slice(0, 10);
        } catch {
            return 'unknown';
        }
    };

    const normalizeProvider = (v) => String(v || '').trim().toLowerCase();

    const getTxnProvider = (tx) => {
        const method = normalizeProvider(tx?.paymentMethod || tx?.payment_method);
        if (method) return method;
        const details = tx?.paymentDetails || tx?.payment_details || {};
        const provider = normalizeProvider(details?.provider);
        return provider || 'unknown';
    };

    const pct = (num, den) => {
        const n = Number(num);
        const d = Number(den);
        if (!Number.isFinite(n) || !Number.isFinite(d) || d === 0) return null;
        return (n / d) * 100;
    };

    const startOfUtcWeekKey = (dateKey) => {
        if (!dateKey) return '';
        const d = new Date(`${dateKey}T00:00:00.000Z`);
        if (Number.isNaN(d.getTime())) return '';
        const day = d.getUTCDay(); // 0..6 (Sun..Sat)
        const backToMonday = (day + 6) % 7;
        d.setUTCDate(d.getUTCDate() - backToMonday);
        return d.toISOString().slice(0, 10);
    };

    const startOfUtcMonthKey = (dateKey) => {
        if (!dateKey) return '';
        const d = new Date(`${dateKey}T00:00:00.000Z`);
        if (Number.isNaN(d.getTime())) return '';
        const y = d.getUTCFullYear();
        const m = d.getUTCMonth();
        const first = new Date(Date.UTC(y, m, 1));
        return first.toISOString().slice(0, 10);
    };

    const clampDayInMonth = (year, monthIndex, day) => {
        const lastDay = new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
        return Math.max(1, Math.min(day, lastDay));
    };

    const shiftMonthSameDayKey = (dateKey, deltaMonths) => {
        if (!dateKey) return '';
        const d = new Date(`${dateKey}T00:00:00.000Z`);
        if (Number.isNaN(d.getTime())) return '';
        const y = d.getUTCFullYear();
        const m = d.getUTCMonth();
        const day = d.getUTCDate();
        const targetMonth = m + deltaMonths;
        const target = new Date(Date.UTC(y, targetMonth, 1));
        const ty = target.getUTCFullYear();
        const tm = target.getUTCMonth();
        const cd = clampDayInMonth(ty, tm, day);
        const out = new Date(Date.UTC(ty, tm, cd));
        return out.toISOString().slice(0, 10);
    };

    const sumInRange = (byDate, fromKey, toKey) => {
        const out = { revenue: 0, txCount: 0 };
        if (!byDate || !fromKey || !toKey) return out;
        Object.keys(byDate).forEach((k) => {
            if (k >= fromKey && k <= toKey) {
                out.revenue += Number(byDate[k]?.revenue || 0) || 0;
                out.txCount += Number(byDate[k]?.txCount || 0) || 0;
            }
        });
        return out;
    };

    const buildExecutiveSalesPayload = (txList) => {
        const todayKey = new Date().toISOString().slice(0, 10);
        const y = new Date();
        y.setDate(y.getDate() - 1);
        const yesterdayKey = y.toISOString().slice(0, 10);

        const lw = new Date();
        lw.setDate(lw.getDate() - 7);
        const lastWeekKey = lw.toISOString().slice(0, 10);

        const start7 = new Date();
        start7.setDate(start7.getDate() - 6);
        const last7FromKey = start7.toISOString().slice(0, 10);

        const totals = {
            today: { date: todayKey, revenue: 0, txCount: 0, bestItem: null, slowWindow: null },
            yesterday: { date: yesterdayKey, revenue: 0, txCount: 0 },
            lastWeekSameWeekday: { date: lastWeekKey, revenue: 0, txCount: 0 },
            last7Days: { fromDate: last7FromKey, toDate: todayKey, revenue: 0, txCount: 0 },
            providerMixToday: {},
            providerMixLast7Days: {},
            failures: { todayFailedCount: 0, last7FailedCount: 0 },
        };

        const hourlyRevenue = new Array(24).fill(0);
        const bestByName = new Map();
        const byDate = {};
        const providerToday = {};
        const providerLast7 = {};

        const addItem = (name, revenue, qty) => {
            const k = String(name || '').trim();
            if (!k) return;
            const prev = bestByName.get(k) || { name: k, revenue: 0, qty: 0 };
            prev.revenue += revenue;
            prev.qty += qty;
            bestByName.set(k, prev);
        };

        (Array.isArray(txList) ? txList : []).forEach((t) => {
            const ms = toMs(t.timestamp ?? t.createdAt ?? t.created_at);
            if (!ms) return;
            const dateKey = toDateKey(ms);
            const amt = getAmount(t);
            const paid = isPaidTx(t);
            const provider = getTxnProvider(t);

            byDate[dateKey] = byDate[dateKey] || { revenue: 0, txCount: 0 };
            if (paid) {
                byDate[dateKey].revenue += amt;
                byDate[dateKey].txCount += 1;
            }

            if (dateKey === todayKey) {
                if (paid) {
                    totals.today.revenue += amt;
                    totals.today.txCount += 1;
                    hourlyRevenue[new Date(ms).getHours()] += amt;
                    providerToday[provider] = (providerToday[provider] || 0) + amt;
                } else {
                    totals.failures.todayFailedCount += 1;
                }

                const items = Array.isArray(t?.items) ? t.items : [];
                items.forEach((it) => {
                    if (!it || typeof it !== 'object') return;
                    const qtyRaw = Number(it?.quantity ?? it?.qty ?? it?.count ?? 1);
                    const qty = Number.isFinite(qtyRaw) && qtyRaw > 0 ? Math.floor(qtyRaw) : 1;
                    const unitPrice = Number(it?.price ?? 0) || 0;
                    const revenue = unitPrice * qty;
                    const name = String(it?.name ?? it?.productName ?? '').trim();
                    addItem(name, revenue, qty);
                });
            } else if (dateKey === yesterdayKey) {
                if (paid) {
                    totals.yesterday.revenue += amt;
                    totals.yesterday.txCount += 1;
                }
            } else if (dateKey === lastWeekKey) {
                if (paid) {
                    totals.lastWeekSameWeekday.revenue += amt;
                    totals.lastWeekSameWeekday.txCount += 1;
                }
            }

            if (dateKey >= last7FromKey && dateKey <= todayKey) {
                if (paid) {
                    totals.last7Days.revenue += amt;
                    totals.last7Days.txCount += 1;
                    providerLast7[provider] = (providerLast7[provider] || 0) + amt;
                } else {
                    totals.failures.last7FailedCount += 1;
                }
            }
        });

        totals.providerMixToday = providerToday;
        totals.providerMixLast7Days = providerLast7;

        let best = null;
        bestByName.forEach((v) => {
            if (!best) best = v;
            else if ((v.revenue || 0) > (best.revenue || 0)) best = v;
        });
        if (best) totals.today.bestItem = { name: best.name, revenue: Number(best.revenue || 0), qty: Number(best.qty || 0) };

        let slow = null;
        for (let h = 0; h < 23; h += 1) {
            const rev2h = (hourlyRevenue[h] || 0) + (hourlyRevenue[h + 1] || 0);
            if (!slow || rev2h < slow.revenue) slow = { startHour: h, endHour: h + 2, revenue: rev2h };
        }
        if (slow && totals.today.txCount > 0) totals.today.slowWindow = slow;

        // Weekly / monthly rollups
        const wtdFrom = startOfUtcWeekKey(todayKey);
        const lastWeekFrom = startOfUtcWeekKey(lastWeekKey);
        const wtd = sumInRange(byDate, wtdFrom, todayKey);
        const lastWeekWtd = sumInRange(byDate, lastWeekFrom, lastWeekKey);

        const mtdFrom = startOfUtcMonthKey(todayKey);
        const lastMonthSameDay = shiftMonthSameDayKey(todayKey, -1);
        const lastMonthFrom = startOfUtcMonthKey(lastMonthSameDay);
        const mtd = sumInRange(byDate, mtdFrom, todayKey);
        const lastMonthMtd = sumInRange(byDate, lastMonthFrom, lastMonthSameDay);

        totals.wtd = { fromDate: wtdFrom, toDate: todayKey, ...wtd };
        totals.lastWeekWtd = { fromDate: lastWeekFrom, toDate: lastWeekKey, ...lastWeekWtd };
        totals.mtd = { fromDate: mtdFrom, toDate: todayKey, ...mtd };
        totals.lastMonthMtd = { fromDate: lastMonthFrom, toDate: lastMonthSameDay, ...lastMonthMtd };

        // Anomaly signals (simple, deterministic)
        const signals = [];
        const revVsY = pct(totals.today.revenue - totals.yesterday.revenue, totals.yesterday.revenue);
        const revVsLW = pct(totals.today.revenue - totals.lastWeekSameWeekday.revenue, totals.lastWeekSameWeekday.revenue);
        if (revVsY !== null && Math.abs(revVsY) >= 20) {
            signals.push({ type: 'revenue_vs_yesterday', severity: Math.abs(revVsY) >= 40 ? 'high' : 'medium', valuePct: revVsY });
        }
        if (revVsLW !== null && Math.abs(revVsLW) >= 20) {
            signals.push({ type: 'revenue_vs_last_week', severity: Math.abs(revVsLW) >= 40 ? 'high' : 'medium', valuePct: revVsLW });
        }

        const totalTodayProviderRev = Object.values(providerToday).reduce((s, v) => s + (Number(v) || 0), 0);
        const totalLast7ProviderRev = Object.values(providerLast7).reduce((s, v) => s + (Number(v) || 0), 0);
        if (totalTodayProviderRev > 0 && totalLast7ProviderRev > 0) {
            const topToday = Object.entries(providerToday).sort((a, b) => (b[1] || 0) - (a[1] || 0))[0];
            if (topToday) {
                const p = String(topToday[0]);
                const shareToday = pct(providerToday[p], totalTodayProviderRev);
                const shareLast7 = pct(providerLast7[p] || 0, totalLast7ProviderRev);
                if (shareToday !== null && shareLast7 !== null && Math.abs(shareToday - shareLast7) >= 25) {
                    signals.push({ type: 'provider_shift', severity: 'medium', provider: p, shareTodayPct: shareToday, shareLast7Pct: shareLast7 });
                }
            }
        }

        if (totals.failures.todayFailedCount >= 3) {
            signals.push({ type: 'payment_failures', severity: 'medium', failedCount: totals.failures.todayFailedCount });
        }

        totals.signals = signals;

        // Provide top items for actionability
        const topItems = Array.from(bestByName.values()).sort((a, b) => (b.revenue || 0) - (a.revenue || 0)).slice(0, 5);
        totals.today.topItems = topItems;

        return totals;
    };

    const formatTimestamp = (timestamp) => {
        if (!timestamp) return 'N/A';
        try {
            const date = new Date(timestamp);
            return date.toLocaleDateString('en-MY', { year: 'numeric', month: 'short', day: 'numeric' });
        } catch {
            return 'Invalid Date';
        }
    };

    const fetchData = async () => {
        try {
            // Load last ~62 days so AI can compute WTD/MTD comparisons.
            const start = new Date();
            start.setDate(start.getDate() - 61);
            const startTs = Timestamp.fromDate(start);

            const txQuery = query(
                transactionsCollectionRef,
                where('timestamp', '>=', startTs),
                orderBy('timestamp', 'desc'),
                limit(5000)
            );
            const txSnap = await getDocs(txQuery);
            const txList = txSnap.docs.map((doc) => ({
                ...doc.data(),
                id: doc.id,
                paymentStatus: doc.data().paymentStatus || 'N/A',
                totalAmount: Number(doc.data().totalAmount),
            }));

            setRecentTransactions(txList.slice(0, 4));
            setExecutiveSalesPayload(buildExecutiveSalesPayload(txList));
        } catch (err) {
            console.error('Dashboard Fetch Error:', err);
        }
    };

    const fetchMetrics = async () => {
        try {
            // Users count
            const usersSnap = await getDocs(collection(db, 'users'));
            const totalUsers = usersSnap.size;

            // Products count
            const productsSnap = await getDocs(collection(db, 'products'));
            const productsList = productsSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
            const productsById = new Map(productsList.map((p) => [p.id, p]));

            // Inventory: total items (sum of stockLevel) and low stock count
            const inventorySnap = await getDocs(collection(db, 'inventory'));
            let totalItems = 0;
            let lowStockItems = 0;
            const lowStockList = [];
            inventorySnap.docs.forEach((d) => {
                const lvl = Number(d.data().stockLevel || 0);
                totalItems += lvl;
                if (lvl < 5) {
                    lowStockItems += 1;
                    const inv = d.data() || {};
                    const pid = String(inv.productID || inv.productId || d.id || '');
                    const prod = productsById.get(pid);
                    lowStockList.push({
                        productId: pid,
                        name: prod?.name || inv.name || pid || 'Unknown Product',
                        stockLevel: lvl,
                    });
                }
            });

            lowStockList.sort((a, b) => a.stockLevel - b.stockLevel);
            setLowStockPreview(lowStockList.slice(0, 6));

            // Transactions count
            const transactionsSnap = await getDocs(collection(db, 'transactions'));
            const totalTransactions = transactionsSnap.size;

            setMetricCounts({
                totalItems,
                totalUsers,
                totalTransactions,
                lowStockItems,
            });
        } catch (err) {
            console.error('Failed to load dashboard metrics:', err);
        }
    };

    useEffect(() => {
        // Fetch both metrics and recent transactions in parallel
        const load = async () => {
            setLoading(true);
            await Promise.all([fetchMetrics(), fetchData()]);
            setLoading(false);
        };
        load();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const executivePayloadWithInventory = useMemo(() => {
        if (!executiveSalesPayload || typeof executiveSalesPayload !== 'object') return executiveSalesPayload;
        const lowStock = Array.isArray(lowStockPreview)
            ? lowStockPreview.map((it) => ({
                productId: String(it?.productId || ''),
                name: String(it?.name || ''),
                stockLevel: Number(it?.stockLevel || 0) || 0,
            })).slice(0, 8)
            : [];

        return {
            ...executiveSalesPayload,
            inventory: { lowStock },
        };
    }, [executiveSalesPayload, lowStockPreview]);


    const metricColors = {
        totalItems: theme.palette.primary.main,
        totalUsers: theme.palette.success.main || '#4caf50',
        totalTransactions: theme.palette.secondary.main || '#2196f3',
        lowStockItems: theme.palette.error.main || '#f44336',
    };

    const getStatusChipStyle = (status) => {
        const isSuccess = status === 'Success';
        const isUnknown = !status || status === 'N/A';
        return {
            backgroundColor: isUnknown
                ? (theme.palette.action?.hover || theme.palette.grey[100])
                : isSuccess
                  ? (theme.palette.success?.light || '#d1fae5')
                  : (theme.palette.error?.light || '#fee2e2'),
            color: isUnknown
                ? theme.palette.text.secondary
                : isSuccess
                  ? (theme.palette.success?.dark || '#065f46')
                  : (theme.palette.error?.dark || '#7f1d1d'),
            borderRadius: theme.shape.borderRadius,
            padding: '4px 8px',
            display: 'inline-flex',
            fontSize: theme.typography.caption?.fontSize || '0.75rem',
            fontWeight: 600,
        };
    };

    const quickActions = useMemo(
        () => [
            { label: 'Manage Inventory', icon: Package, onClick: () => navigate('/admin/inventory') },
            { label: 'Product Master', icon: ShoppingBag, onClick: () => navigate('/admin/products/master') },
            { label: 'View Transactions', icon: DollarSign, onClick: () => navigate('/admin/transactions') },
        ],
        [navigate]
    );

    return (
        <Box sx={{ p: 3, '& > :not(style) + :not(style)': { mt: 3 } }}>
            <PageHeader
                title={welcomeName ? `Welcome, ${welcomeName}` : 'Welcome'}
                subtitle="Overview of users, inventory, and transactions."
            />

            <Grid container spacing={4}>
                <Grid item xs={12} sm={6} md={3}>
                    <MetricCard title="Total Items" value={loading ? '...' : metricCounts.totalItems} color={metricColors.totalItems} icon={ShoppingBag} />
                </Grid>
                <Grid item xs={12} sm={6} md={3}>
                    <MetricCard title="Total Users" value={loading ? '...' : metricCounts.totalUsers} color={metricColors.totalUsers} icon={Users} />
                </Grid>
                <Grid item xs={12} sm={6} md={3}>
                    <MetricCard title="Total Transactions" value={loading ? '...' : metricCounts.totalTransactions} color={metricColors.totalTransactions} icon={DollarSign} />
                </Grid>
                <Grid item xs={12} sm={6} md={3}>
                    <MetricCard title="Low Stock Items" value={loading ? '...' : metricCounts.lowStockItems} color={metricColors.lowStockItems} icon={AlertTriangle} />
                </Grid>
            </Grid>

            <SectionCard
                sx={{
                    position: 'relative',
                    overflow: 'hidden',
                    border: `1px solid ${alpha(theme.palette.primary.main, theme.palette.mode === 'dark' ? 0.35 : 0.25)}`,
                    backgroundColor: alpha(theme.palette.primary.main, theme.palette.mode === 'dark' ? 0.12 : 0.06),
                }}
            >
                <Box
                    sx={{
                        position: 'absolute',
                        left: 0,
                        top: 0,
                        bottom: 0,
                        width: 4,
                        backgroundColor: theme.palette.primary.main,
                    }}
                />

                        <AiSummary sales={executivePayloadWithInventory} disabled={loading} role={currentRole} scope="admin-dashboard" />
            </SectionCard>

            <Grid container spacing={3}>
                <Grid item xs={12} md={8}>
                    <SectionCard
                        title="Recent Transactions"
                        actions={(
                            <Button size="small" variant="outlined" onClick={() => navigate('/admin/transactions')} endIcon={<ArrowRight size={16} />}>
                                View all
                            </Button>
                        )}
                    >
                        <TableContainer>
                            <Table size="small">
                                <TableHead
                                    sx={{
                                        backgroundColor: theme.palette.mode === 'dark' ? theme.palette.background.paper : theme.palette.grey[50],
                                        '& th': { color: theme.palette.text.primary },
                                    }}
                                >
                                    <TableRow>
                                        <TableCell sx={{ fontWeight: 600, textTransform: 'uppercase' }}>Transaction ID</TableCell>
                                        <TableCell sx={{ fontWeight: 600, textTransform: 'uppercase' }}>Amount (RM)</TableCell>
                                        <TableCell sx={{ fontWeight: 600, textTransform: 'uppercase' }}>Status</TableCell>
                                        <TableCell sx={{ fontWeight: 600, textTransform: 'uppercase' }}>Date</TableCell>
                                    </TableRow>
                                </TableHead>

                                <TableBody>
                                    {loading ? (
                                        <TableRow>
                                            <TableCell colSpan={4} sx={{ py: 3, textAlign: 'center' }}>
                                                Loading recent transactions...
                                            </TableCell>
                                        </TableRow>
                                    ) : recentTransactions.length === 0 ? (
                                        <TableRow>
                                            <TableCell colSpan={4} sx={{ py: 3, textAlign: 'center' }}>
                                                No recent transactions found.
                                            </TableCell>
                                        </TableRow>
                                    ) : (
                                        recentTransactions.map((txn, index) => (
                                            <TableRow
                                                key={txn.id || index}
                                                hover
                                                sx={{ cursor: txn.id ? 'pointer' : 'default' }}
                                                onClick={() => {
                                                    if (!txn.id) return;
                                                    navigate(`/admin/transactions/${encodeURIComponent(txn.id)}`);
                                                }}
                                            >
                                                <TableCell sx={{ fontFamily: 'monospace' }}>{txn.id ? txn.id.substring(0, 10) + '...' : 'N/A'}</TableCell>
                                                <TableCell sx={{ fontWeight: 700, color: theme.palette.text.primary }}>
                                                    {Number.isFinite(txn.totalAmount) ? `RM${Number(txn.totalAmount).toFixed(2)}` : 'N/A'}
                                                </TableCell>
                                                <TableCell>
                                                    <Box component="span" sx={getStatusChipStyle(txn.paymentStatus)}>
                                                        {txn.paymentStatus || 'N/A'}
                                                    </Box>
                                                </TableCell>
                                                <TableCell sx={{ color: theme.palette.text.secondary }}>{formatTimestamp(txn.timestamp)}</TableCell>
                                            </TableRow>
                                        ))
                                    )}
                                </TableBody>
                            </Table>
                        </TableContainer>
                    </SectionCard>
                </Grid>

                <Grid item xs={12} md={4}>
                    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                        <SectionCard
                            title="Low Stock Alerts"
                            actions={(
                                <Button size="small" variant="outlined" onClick={() => navigate('/admin/inventory')} endIcon={<ArrowRight size={16} />}>
                                    Inventory
                                </Button>
                            )}
                        >
                            {loading ? (
                                <Typography variant="body2" color="text.secondary">Loading alerts…</Typography>
                            ) : lowStockPreview.length === 0 ? (
                                <Typography variant="body2" color="text.secondary">No low stock items.</Typography>
                            ) : (
                                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.25 }}>
                                    {lowStockPreview.map((it) => (
                                        <Box
                                            key={`${it.productId}-${it.stockLevel}`}
                                            sx={{
                                                display: 'flex',
                                                alignItems: 'center',
                                                justifyContent: 'space-between',
                                                gap: 2,
                                                p: 1.25,
                                                borderRadius: 1.5,
                                                border: '1px solid',
                                                borderColor: 'divider',
                                                bgcolor: 'background.default',
                                            }}
                                        >
                                            <Box sx={{ minWidth: 0 }}>
                                                <Typography sx={{ fontWeight: 650 }} noWrap>
                                                    {it.name}
                                                </Typography>
                                                <Typography variant="caption" color="text.secondary" noWrap>
                                                    Product ID: {it.productId}
                                                </Typography>
                                            </Box>
                                            <Box sx={{ textAlign: 'right' }}>
                                                <Typography sx={{ fontWeight: 800, color: it.stockLevel <= 0 ? 'error.main' : 'warning.main' }}>
                                                    {it.stockLevel}
                                                </Typography>
                                                <Typography variant="caption" color="text.secondary">in stock</Typography>
                                            </Box>
                                        </Box>
                                    ))}
                                </Box>
                            )}
                        </SectionCard>

                        <SectionCard title="Quick Actions" subtitle="Jump to common admin tasks.">
                            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.25 }}>
                                {quickActions.map((a) => {
                                    const Icon = a.icon;
                                    return (
                                        <Button
                                            key={a.label}
                                            variant="outlined"
                                            onClick={a.onClick}
                                            sx={{
                                                justifyContent: 'space-between',
                                                py: 1.25,
                                                textTransform: 'none',
                                                borderColor: 'divider',
                                            }}
                                        >
                                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25 }}>
                                                <Box
                                                    sx={{
                                                        width: 32,
                                                        height: 32,
                                                        borderRadius: 1,
                                                        display: 'grid',
                                                        placeItems: 'center',
                                                        bgcolor: 'background.default',
                                                        border: '1px solid',
                                                        borderColor: 'divider',
                                                        color: 'text.primary',
                                                    }}
                                                >
                                                    <Icon size={16} />
                                                </Box>
                                                <Typography sx={{ fontWeight: 650 }}>{a.label}</Typography>
                                            </Box>
                                            <ArrowRight size={16} />
                                        </Button>
                                    );
                                })}
                            </Box>
                        </SectionCard>

                    </Box>
                </Grid>
            </Grid>
        </Box>
    );
};

export default AdminDashboard;