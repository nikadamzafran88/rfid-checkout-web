import React, { useEffect, useState, useMemo, useRef } from 'react';
import { Box, Typography, CircularProgress, List, ListItem, ListItemText, TextField, Alert, Divider, Button, ButtonGroup } from '@mui/material';
import { alpha } from '@mui/material/styles';
import { useTheme } from '@mui/material/styles';
import { collection, getDocs } from 'firebase/firestore';
import { db } from '../firebaseConfig';
import SectionCard from '../components/ui/SectionCard';
import AiSummary from '../components/AiSummary.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { Line, Bar, Doughnut } from 'react-chartjs-2';
import { ResponsiveContainer, LineChart, Line as RLine, XAxis, YAxis, CartesianGrid, Tooltip as RTooltip } from 'recharts';
import { toPng } from 'html-to-image';
import jsPDF from 'jspdf';
import * as XLSX from 'xlsx';
import { calculateTrend } from '../utils/forecasting';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
  ArcElement,
  Title,
  Tooltip,
  Legend,
} from 'chart.js';

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, BarElement, ArcElement, Title, Tooltip, Legend);

const FinancialReports = () => {
  const theme = useTheme();
  const { currentRole } = useAuth();
  const dashboardRef = useRef(null);
  const [loading, setLoading] = useState(true);
  const [transactions, setTransactions] = useState([]);
  const [productsById, setProductsById] = useState(() => new Map());
  const [error, setError] = useState(null);
  const [exporting, setExporting] = useState(false);

  // Date range filter state (default: last 30 days)
  const [fromDate, setFromDate] = useState(() => {
    const now = new Date();
    const from = new Date(now);
    from.setDate(from.getDate() - 29);
    return from.toISOString().slice(0, 10);
  });
  const [toDate, setToDate] = useState(() => new Date().toISOString().slice(0, 10));

  const toMs = (ts) => {
    if (!ts) return null;
    if (typeof ts?.toDate === 'function') return ts.toDate().getTime();
    if (typeof ts === 'object' && ts?.seconds) return Number(ts.seconds) * 1000;
    if (typeof ts === 'number') return ts;
    const d = new Date(ts);
    if (Number.isNaN(d.getTime())) return null;
    return d.getTime();
  };

  const toDateKey = (ts) => {
    const ms = toMs(ts);
    if (!ms) return 'unknown';
    try {
      return new Date(ms).toISOString().slice(0, 10);
    } catch {
      return 'unknown';
    }
  };

  const getAmount = (tx) => {
    const v = (tx?.totalAmount ?? tx?.total_amount ?? 0);
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  };

  const getPaymentMethod = (tx) => {
    const m = (tx?.paymentMethod ?? tx?.payment_method ?? 'UNKNOWN');
    return String(m || 'UNKNOWN').toUpperCase();
  };

  const normalizeProvider = (v) => String(v || '').trim().toLowerCase();

  const getTxnProvider = (tx) => {
    const method = normalizeProvider(tx?.paymentMethod || tx?.payment_method);
    if (method) return method;

    const details = tx?.paymentDetails || tx?.payment_details || {};
    const provider = normalizeProvider(details?.provider);
    return provider || 'unknown';
  };

  const safeNumber = (v, fallback = 0) => {
    const n = typeof v === 'number' ? v : Number(v);
    return Number.isFinite(n) ? n : fallback;
  };

  const getItemQuantity = (it) => {
    const q = safeNumber(it?.quantity ?? it?.qty ?? it?.count, 1);
    return Math.max(1, Math.floor(q));
  };

  const getItemProductId = (it) => {
    const productId = it?.productId ?? it?.productID ?? it?.id ?? '';
    return String(productId || '').trim();
  };

  const isUnknownProductId = (productId) => String(productId || '').startsWith('unknown_');

  const isPaidTx = (tx) => {
    const status = String(tx?.paymentStatus ?? tx?.payment_status ?? tx?.status ?? '').toLowerCase();
    if (!status) return true; // legacy docs: assume completed
    if (status.includes('fail') || status.includes('failed') || status.includes('cancel') || status.includes('cancelled') || status.includes('unpaid')) return false;
    if (status.includes('paid') || status.includes('success') || status.includes('completed')) return true;
    return true;
  };

  const loadTransactions = async () => {
    setLoading(true);
    setError(null);
    try {
      const [txSnap, productsSnap] = await Promise.all([
        getDocs(collection(db, 'transactions')),
        getDocs(collection(db, 'products')),
      ]);

      const txList = txSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
      setTransactions(txList);

      const productsList = productsSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
      setProductsById(new Map(productsList.map((p) => [p.id, p])));
    } catch (err) {
      console.error('Failed to load transactions:', err);
      setError('Failed to load transactions. See console for details.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadTransactions();
  }, []);

  const forecast = useMemo(() => {
    const txList = Array.isArray(transactions) ? transactions : [];

    // Use recent history for forecasting to keep it stable.
    const now = Date.now();
    const fromMs = now - (30 * 24 * 60 * 60 * 1000);

    const orders = txList
      .filter((t) => isPaidTx(t))
      .map((t) => ({
        timestamp: toMs(t.timestamp ?? t.createdAt ?? t.created_at),
        totalAmount: getAmount(t),
      }))
      .filter((t) => typeof t.timestamp === 'number' && t.timestamp >= fromMs);

    return calculateTrend(orders, { daysToPredict: 3 });
  }, [transactions]);

  const parseDateKeyToMsStart = (dateKey) => {
    if (!dateKey) return null;
    const d = new Date(`${dateKey}T00:00:00.000Z`);
    if (Number.isNaN(d.getTime())) return null;
    return d.getTime();
  };

  const addDaysToDateKey = (dateKey, days) => {
    const ms = parseDateKeyToMsStart(dateKey);
    if (!ms) return '';
    const d = new Date(ms);
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().slice(0, 10);
  };

  const setPreset = (preset) => {
    const now = new Date();
    const todayKey = now.toISOString().slice(0, 10);
    if (preset === 'ALL') {
      setFromDate('');
      setToDate(todayKey);
      return;
    }
    if (preset === 'YTD') {
      setFromDate(`${now.getUTCFullYear()}-01-01`);
      setToDate(todayKey);
      return;
    }
    const days = preset === '7D' ? 7 : preset === '30D' ? 30 : preset === '90D' ? 90 : 30;
    const from = new Date(now);
    from.setDate(from.getDate() - (days - 1));
    setFromDate(from.toISOString().slice(0, 10));
    setToDate(todayKey);
  };

  const buildMetrics = (txList, range) => {
    const rangeFrom = range?.fromDate || '';
    const rangeTo = range?.toDate || '';

    const inRange = (dateKey) => {
      if (rangeFrom && dateKey < rangeFrom) return false;
      if (rangeTo && dateKey > rangeTo) return false;
      return true;
    };

    const paidTx = txList
      .map((t) => {
        const ms = toMs(t.timestamp ?? t.createdAt ?? t.created_at);
        return { ...t, __ms: ms ?? 0, __dateKey: toDateKey(t.timestamp ?? t.createdAt ?? t.created_at) };
      })
      .filter((t) => inRange(t.__dateKey))
      .filter((t) => isPaidTx(t));

    paidTx.sort((a, b) => (b.__ms || 0) - (a.__ms || 0));

    const dailyRevenue = {};
    const dailyCount = {};
    const dailyGrossProfit = {};
    const paymentMethodCounts = {};
    const paymentMethodRevenue = {};
    const providerRevenue = {};
    const categoryRevenue = {};
    const categoryGrossProfit = {};
    const weekdayRevenue = { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 };
    const topProducts = new Map();
    let sum = 0;
    let maxTxAmount = 0;
    let grossProfitSum = 0;
    let grossProfitCoveredRevenue = 0;
    let grossProfitUnknownRevenue = 0;

    paidTx.forEach((t) => {
      const amt = getAmount(t);
      if (amt > maxTxAmount) maxTxAmount = amt;
      const key = t.__dateKey || 'unknown';
      const method = getPaymentMethod(t);
      const provider = getTxnProvider(t);

      sum += amt;
      dailyRevenue[key] = (dailyRevenue[key] || 0) + amt;
      dailyCount[key] = (dailyCount[key] || 0) + 1;
      paymentMethodCounts[method] = (paymentMethodCounts[method] || 0) + 1;
      paymentMethodRevenue[method] = (paymentMethodRevenue[method] || 0) + amt;
      providerRevenue[provider] = (providerRevenue[provider] || 0) + amt;

      const weekday = Number.isFinite(t.__ms) && t.__ms ? new Date(t.__ms).getDay() : null;
      if (weekday !== null) weekdayRevenue[weekday] = (weekdayRevenue[weekday] || 0) + amt;

      const items = Array.isArray(t?.items) ? t.items : [];
      let txItemRevenue = 0;
      let txItemCost = 0;
      let txHasAnyCost = false;
      let txHasAnyUnknownCost = false;

      items.forEach((it) => {
        if (!it || typeof it !== 'object') return;

        const productId = getItemProductId(it);
        if (!productId || isUnknownProductId(productId)) return;

        const sku = String(it?.sku ?? '').trim();
        const name = String(it?.name ?? it?.productName ?? '').trim();
        const qty = getItemQuantity(it);
        const unitPrice = safeNumber(it?.price, 0);
        const revenue = unitPrice * qty;

        txItemRevenue += revenue;

        const prod = productsById.get(productId);
        const category = String(prod?.category || '').trim() || 'Uncategorized';
        categoryRevenue[category] = (categoryRevenue[category] || 0) + revenue;

        const unitCostRaw = prod?.cost ?? prod?.cost_price ?? prod?.costPrice ?? prod?.cogs;
        const unitCost = safeNumber(unitCostRaw, NaN);
        if (Number.isFinite(unitCost) && unitCost >= 0) {
          txHasAnyCost = true;
          txItemCost += unitCost * qty;
        } else {
          txHasAnyUnknownCost = true;
        }

        const prev = topProducts.get(productId);
        if (!prev) {
          topProducts.set(productId, {
            productId,
            sku,
            name: name || sku || productId,
            soldQty: qty,
            revenue,
          });
        } else {
          prev.soldQty += qty;
          prev.revenue += revenue;
          if (!prev.sku && sku) prev.sku = sku;
          if (!prev.name && name) prev.name = name;
        }
      });

      // Profit (only meaningful when some cost data exists)
      const revenueBasis = txItemRevenue > 0 ? txItemRevenue : amt;
      if (txHasAnyCost) {
        const gp = revenueBasis - txItemCost;
        grossProfitSum += gp;
        grossProfitCoveredRevenue += revenueBasis;
        dailyGrossProfit[key] = (dailyGrossProfit[key] || 0) + gp;

        // Allocate GP to categories proportionally by revenue (simple approximation)
        // If there are multiple categories, this will still align totals.
        if (items.length > 0) {
          const perCategoryRevenue = {};
          items.forEach((it) => {
            if (!it || typeof it !== 'object') return;
            const pid = getItemProductId(it);
            if (!pid || isUnknownProductId(pid)) return;
            const q = getItemQuantity(it);
            const p = safeNumber(it?.price, 0);
            const rev = p * q;
            const prod = productsById.get(pid);
            const cat = String(prod?.category || '').trim() || 'Uncategorized';
            perCategoryRevenue[cat] = (perCategoryRevenue[cat] || 0) + rev;
          });
          const totalRev = Object.values(perCategoryRevenue).reduce((s, v) => s + safeNumber(v, 0), 0);
          if (totalRev > 0) {
            Object.entries(perCategoryRevenue).forEach(([cat, rev]) => {
              const share = safeNumber(rev, 0) / totalRev;
              categoryGrossProfit[cat] = (categoryGrossProfit[cat] || 0) + (gp * share);
            });
          }
        }
      } else if (txHasAnyUnknownCost) {
        grossProfitUnknownRevenue += revenueBasis;
      }
    });

    const count = paidTx.length;

    const maxDailyCount = Object.entries(dailyCount)
      .filter(([k]) => k !== 'unknown')
      .reduce((m, [, v]) => Math.max(m, Number(v || 0)), 0);

    const peakDay = Object.entries(dailyRevenue)
      .filter(([k]) => k !== 'unknown')
      .reduce((best, [dateKey, rev]) => {
        if (!best) return { dateKey, revenue: rev };
        return (rev > best.revenue) ? { dateKey, revenue: rev } : best;
      }, null);

    const bestMethodByRevenue = Object.entries(paymentMethodRevenue)
      .reduce((best, [method, rev]) => {
        if (!best) return { method, revenue: rev };
        return (rev > best.revenue) ? { method, revenue: rev } : best;
      }, null);

    const topProductsList = Array.from(topProducts.values())
      .sort((a, b) => (b.revenue || 0) - (a.revenue || 0));

    return {
      totalRevenue: sum,
      txCount: count,
      avgSale: count > 0 ? sum / count : 0,
      maxTxAmount,
      maxDailyCount,
      dailyRevenue,
      dailyCount,
      dailyGrossProfit,
      paymentMethodCounts,
      paymentMethodRevenue,
      providerRevenue,
      categoryRevenue,
      categoryGrossProfit,
      grossProfit: grossProfitSum,
      grossMargin: grossProfitCoveredRevenue > 0 ? (grossProfitSum / grossProfitCoveredRevenue) : null,
      grossProfitCoverage: (grossProfitCoveredRevenue + grossProfitUnknownRevenue) > 0
        ? (grossProfitCoveredRevenue / (grossProfitCoveredRevenue + grossProfitUnknownRevenue))
        : 0,
      weekdayRevenue,
      peakDay,
      bestMethodByRevenue,
      topProducts: topProductsList,
    };
  };

  const executiveSalesPayload = useMemo(() => {
    // Build a small JSON payload for AI (today vs yesterday), independent of the selected date range.
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
      profitToday: { grossProfit: null, grossMargin: null, coveredRevenue: 0 },
      signals: [],
    };

    const hourlyRevenue = new Array(24).fill(0);
    const bestByName = new Map();
    const providerToday = {};
    const providerLast7 = {};

    const pct = (num, den) => {
      const n = Number(num);
      const d = Number(den);
      if (!Number.isFinite(n) || !Number.isFinite(d) || d === 0) return null;
      return (n / d) * 100;
    };

    const addItem = (name, revenue, qty) => {
      const k = String(name || '').trim();
      if (!k) return;
      const prev = bestByName.get(k) || { name: k, revenue: 0, qty: 0 };
      prev.revenue += revenue;
      prev.qty += qty;
      bestByName.set(k, prev);
    };

    const txList = Array.isArray(transactions) ? transactions : [];
    txList.forEach((t) => {
      const ms = toMs(t.timestamp ?? t.createdAt ?? t.created_at);
      if (!ms) return;
      const dateKey = toDateKey(ms);
      const amt = getAmount(t);
      const paid = isPaidTx(t);
      const provider = getTxnProvider(t);

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
        let txCoveredRevenue = 0;
        let txGrossProfit = 0;
        items.forEach((it) => {
          if (!it || typeof it !== 'object') return;
          const qty = getItemQuantity(it);
          const unitPrice = safeNumber(it?.price, 0);
          const revenue = unitPrice * qty;
          const productId = getItemProductId(it);
          const prod = productId ? productsById.get(productId) : null;
          const name = String(it?.name ?? it?.productName ?? prod?.name ?? '').trim();
          addItem(name, revenue, qty);

          // Profit coverage (only for known products with cost)
          const unitCostRaw = prod?.cost ?? prod?.cost_price ?? prod?.costPrice ?? prod?.cogs;
          const unitCost = safeNumber(unitCostRaw, NaN);
          if (Number.isFinite(unitCost) && unitCost >= 0) {
            txCoveredRevenue += revenue;
            txGrossProfit += (revenue - (unitCost * qty));
          }
        });

        if (paid && txCoveredRevenue > 0) {
          totals.profitToday.coveredRevenue += txCoveredRevenue;
          totals.profitToday.grossProfit = (totals.profitToday.grossProfit || 0) + txGrossProfit;
        }
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

    if (totals.profitToday.coveredRevenue > 0 && totals.profitToday.grossProfit !== null) {
      totals.profitToday.grossMargin = totals.profitToday.grossProfit / totals.profitToday.coveredRevenue;
    }

    // Best-selling item today
    let best = null;
    bestByName.forEach((v) => {
      if (!best) best = v;
      else if ((v.revenue || 0) > (best.revenue || 0)) best = v;
    });
    if (best) totals.today.bestItem = { name: best.name, revenue: Number(best.revenue || 0), qty: Number(best.qty || 0) };

    // Slow 2-hour window today (by revenue)
    let slow = null;
    for (let h = 0; h < 23; h += 1) {
      const rev2h = (hourlyRevenue[h] || 0) + (hourlyRevenue[h + 1] || 0);
      if (!slow || rev2h < slow.revenue) slow = { startHour: h, endHour: h + 2, revenue: rev2h };
    }
    if (slow && totals.today.txCount > 0) totals.today.slowWindow = slow;

    // Anomaly signals (deterministic)
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

    if (totals.profitToday.grossMargin !== null && totals.profitToday.grossMargin < 0.2) {
      signals.push({ type: 'low_margin', severity: 'medium', grossMargin: totals.profitToday.grossMargin });
    }

    totals.signals = signals;

    return totals;
  }, [transactions, productsById]);

  const metrics = useMemo(() => {
    return buildMetrics(transactions, { fromDate, toDate });
  }, [transactions, fromDate, toDate, productsById]);

  const prevRange = useMemo(() => {
    if (!fromDate || !toDate) return null;
    const fromMs = parseDateKeyToMsStart(fromDate);
    const toMs2 = parseDateKeyToMsStart(toDate);
    if (!fromMs || !toMs2) return null;
    const days = Math.max(1, Math.round((toMs2 - fromMs) / (24 * 60 * 60 * 1000)) + 1);
    const prevTo = addDaysToDateKey(fromDate, -1);
    const prevFrom = addDaysToDateKey(prevTo, -(days - 1));
    if (!prevFrom || !prevTo) return null;
    return { fromDate: prevFrom, toDate: prevTo, days };
  }, [fromDate, toDate]);

  const prevMetrics = useMemo(() => {
    if (!prevRange) return null;
    return buildMetrics(transactions, { fromDate: prevRange.fromDate, toDate: prevRange.toDate });
  }, [transactions, prevRange, productsById]);

  const deltaText = (current, prev, formatter) => {
    const c = Number(current);
    const p = Number(prev);
    if (!Number.isFinite(c) || !Number.isFinite(p)) return '—';
    const diff = c - p;
    const pct = p !== 0 ? (diff / p) : null;
    const sign = diff > 0 ? '+' : diff < 0 ? '' : '';
    const left = formatter ? formatter(diff) : String(diff);
    const right = pct === null ? '' : ` (${sign}${Math.round(pct * 100)}%)`;
    return `${sign}${left}${right}`;
  };

  const fmtCurrency = (v) => `RM${Number(v || 0).toFixed(2)}`;

  const forecastDataPreviewRows = useMemo(() => {
    const data = Array.isArray(forecast?.chartData) ? forecast.chartData : [];
    const historical = data.filter((d) => !d?.isPrediction);
    const latest = historical.slice(Math.max(0, historical.length - 10));

    return latest.map((d) => ({
      label: String(d?.name ?? ''),
      value: fmtCurrency(Number(d?.sales) || 0),
    }));
  }, [forecast]);

  const forecastExplainPayload = useMemo(() => {
    if (!forecast?.chartData?.length) return null;

    const all = Array.isArray(forecast.chartData) ? forecast.chartData : [];
    const historical = all.filter((d) => !d?.isPrediction);
    if (historical.length < 2) return null;

    const history30 = historical.slice(Math.max(0, historical.length - 30)).map((d) => ({
      date: String(d?.name ?? ''),
      revenue: Number(d?.sales) || 0,
    }));

    const history10 = history30.slice(Math.max(0, history30.length - 10));
    const maxDay = history30.reduce((best, cur) => (cur.revenue > (best?.revenue ?? -Infinity) ? cur : best), null);
    const minDay = history30.reduce((best, cur) => (cur.revenue < (best?.revenue ?? Infinity) ? cur : best), null);
    const last = history30[history30.length - 1] || null;
    const prev = history30[history30.length - 2] || null;

    return {
      today: { date: new Date().toISOString().slice(0, 10) },
      forecast: {
        algorithm: 'linear_regression_daily',
        horizonDays: Array.isArray(forecast?.forecast) ? forecast.forecast.length : 0,
        quality: forecast?.quality ?? null,
        last30Days: history30,
        last10Days: history10,
        lastDay: last,
        prevDay: prev,
        maxDay,
        minDay,
        nextDays: (Array.isArray(forecast?.forecast) ? forecast.forecast : []).map((d) => ({
          date: String(d?.name ?? ''),
          revenue: Number(d?.sales) || 0,
        })),
      },
      instructions: {
        intent: 'Explain the sales forecast in plain English focusing on trend direction, recent spikes/dips, and confidence.'
      }
    };
  }, [forecast]);

  const fmtInt = (v) => {
    const n = Number(v);
    if (!Number.isFinite(n)) return '0';
    return String(Math.round(n));
  };

  const fileDateSuffix = useMemo(() => {
    const f = fromDate || 'all';
    const t = toDate || 'now';
    return `${f}_to_${t}`;
  }, [fromDate, toDate]);

  const downloadDataUrl = (dataUrl, filename) => {
    const a = document.createElement('a');
    a.href = dataUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
  };

  const captureDashboardPng = async () => {
    const el = dashboardRef.current;
    if (!el) throw new Error('Dashboard element not found');

    return toPng(el, {
      cacheBust: true,
      pixelRatio: 2,
      backgroundColor: theme.palette.background.default,
      style: {
        transform: 'scale(1)',
        transformOrigin: 'top left',
      },
    });
  };

  const handleExportPng = async () => {
    if (exporting) return;
    setExporting(true);
    try {
      const dataUrl = await captureDashboardPng();
      downloadDataUrl(dataUrl, `financial_dashboard_${fileDateSuffix}.png`);
    } catch (e) {
      console.error('Export PNG failed', e);
      setError(`Export PNG failed. ${e?.message || ''}`.trim());
    } finally {
      setExporting(false);
    }
  };

  const handleExportPdf = async () => {
    if (exporting) return;
    setExporting(true);
    try {
      const dataUrl = await captureDashboardPng();
      const pdf = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' });
      const pageWidth = pdf.internal.pageSize.getWidth();
      const pageHeight = pdf.internal.pageSize.getHeight();

      // Create an image element to read dimensions
      const img = new Image();
      img.src = dataUrl;
      await new Promise((resolve, reject) => {
        img.onload = resolve;
        img.onerror = reject;
      });

      const margin = 24;
      const maxW = pageWidth - margin * 2;
      const maxH = pageHeight - margin * 2;
      const scale = Math.min(maxW / img.width, maxH / img.height);
      const w = img.width * scale;
      const h = img.height * scale;
      const x = (pageWidth - w) / 2;
      const y = (pageHeight - h) / 2;

      pdf.addImage(dataUrl, 'PNG', x, y, w, h);
      pdf.save(`financial_dashboard_${fileDateSuffix}.pdf`);
    } catch (e) {
      console.error('Export PDF failed', e);
      setError(`Export PDF failed. ${e?.message || ''}`.trim());
    } finally {
      setExporting(false);
    }
  };

  const handleExportExcel = async () => {
    if (exporting) return;
    setExporting(true);
    try {
      const wb = XLSX.utils.book_new();

      const summaryRows = [
        { Metric: 'From', Value: fromDate || 'All' },
        { Metric: 'To', Value: toDate || 'Now' },
        { Metric: 'Total Revenue', Value: Number(metrics.totalRevenue || 0) },
        { Metric: 'Transactions', Value: Number(metrics.txCount || 0) },
        { Metric: 'Average Sale', Value: Number(metrics.avgSale || 0) },
        { Metric: 'Gross Profit', Value: Number(metrics.grossProfit || 0) },
        { Metric: 'Gross Margin', Value: (metrics.grossMargin === null ? null : Number(metrics.grossMargin || 0)) },
        { Metric: 'Gross Profit Coverage', Value: Number(metrics.grossProfitCoverage || 0) },
      ];
      if (prevRange && prevMetrics) {
        summaryRows.push(
          { Metric: 'Prev From', Value: prevRange.fromDate },
          { Metric: 'Prev To', Value: prevRange.toDate },
          { Metric: 'Prev Total Revenue', Value: Number(prevMetrics.totalRevenue || 0) },
          { Metric: 'Prev Transactions', Value: Number(prevMetrics.txCount || 0) },
          { Metric: 'Prev Average Sale', Value: Number(prevMetrics.avgSale || 0) },
          { Metric: 'Prev Gross Profit', Value: Number(prevMetrics.grossProfit || 0) },
          { Metric: 'Prev Gross Margin', Value: (prevMetrics.grossMargin === null ? null : Number(prevMetrics.grossMargin || 0)) },
        );
      }
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(summaryRows), 'Summary');

      const dailyKeys = Array.from(
        new Set([
          ...Object.keys(metrics.dailyRevenue || {}),
          ...Object.keys(metrics.dailyCount || {}),
          ...Object.keys(metrics.dailyGrossProfit || {}),
        ])
      )
        .filter((k) => k !== 'unknown')
        .sort();

      const dailyRows = dailyKeys.map((k) => ({
        Date: k,
        Revenue: Number(metrics.dailyRevenue?.[k] || 0),
        Transactions: Number(metrics.dailyCount?.[k] || 0),
        GrossProfit: Number(metrics.dailyGrossProfit?.[k] || 0),
      }));
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(dailyRows), 'Daily');

      const providerRows = Object.entries(metrics.providerRevenue || {})
        .sort((a, b) => (b[1] || 0) - (a[1] || 0))
        .map(([provider, revenue]) => ({ Provider: provider, Revenue: Number(revenue || 0) }));
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(providerRows), 'Provider');

      const categoryRows = Object.entries(metrics.categoryRevenue || {})
        .sort((a, b) => (b[1] || 0) - (a[1] || 0))
        .map(([category, revenue]) => ({
          Category: category,
          Revenue: Number(revenue || 0),
          GrossProfit: Number(metrics.categoryGrossProfit?.[category] || 0),
        }));
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(categoryRows), 'Category');

      const topRows = (metrics.topProducts || []).slice(0, 100).map((p) => ({
        ProductId: p.productId,
        Name: p.name,
        SKU: p.sku,
        SoldQty: Number(p.soldQty || 0),
        Revenue: Number(p.revenue || 0),
      }));
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(topRows), 'TopProducts');

      XLSX.writeFile(wb, `financial_dashboard_${fileDateSuffix}.xlsx`);
    } catch (e) {
      console.error('Export Excel failed', e);
      setError(`Export Excel failed. ${e?.message || ''}`.trim());
    } finally {
      setExporting(false);
    }
  };

  const isDarkMode = theme.palette.mode === 'dark';
  const chartGridColor = alpha(theme.palette.text.primary, isDarkMode ? 0.22 : 0.10);
  const chartTickColor = alpha(theme.palette.text.primary, isDarkMode ? 0.88 : 0.72);
  const chartBorderColor = alpha(theme.palette.text.primary, isDarkMode ? 0.28 : 0.14);
  const chartTooltipBg = alpha(theme.palette.background.paper, isDarkMode ? 0.92 : 0.96);

  const resolveColor = (c, fallback) => {
    return typeof c === 'string' && c.trim() ? c : fallback;
  };

  const palettePrimary = theme.palette.primary?.main;
  const paletteSuccess = resolveColor(theme.palette.success?.main, palettePrimary);
  const paletteInfo = resolveColor(theme.palette.info?.main, palettePrimary);
  const paletteWarning = resolveColor(theme.palette.warning?.main, palettePrimary);

  const datasetColors = (baseColor, kind) => {
    const isBar = kind === 'bar';
    const fillAlpha = isBar
      ? (isDarkMode ? 0.46 : 0.30)
      : (isDarkMode ? 0.24 : 0.16);

    return {
      borderColor: alpha(baseColor, 0.98),
      backgroundColor: alpha(baseColor, fillAlpha),
      borderWidth: isBar ? 1.5 : 2,
      pointBackgroundColor: alpha(baseColor, 1),
      pointBorderColor: theme.palette.background.paper,
      pointRadius: 2,
      pointHoverRadius: 4,
    };
  };

  const commonChartOptions = useMemo(() => {
    return {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          labels: {
            color: chartTickColor,
            boxWidth: 10,
            boxHeight: 10,
            usePointStyle: true,
          },
        },
        tooltip: {
          backgroundColor: chartTooltipBg,
          titleColor: theme.palette.text.primary,
          bodyColor: theme.palette.text.primary,
          borderColor: chartBorderColor,
          borderWidth: 1,
        },
      },
      scales: {
        x: {
          ticks: { color: chartTickColor },
          grid: { color: chartGridColor },
        },
        y: {
          ticks: { color: chartTickColor },
          grid: { color: chartGridColor },
        },
      },
    };
  }, [chartTickColor, chartGridColor, chartBorderColor, chartTooltipBg, theme.palette.text.primary]);

  const commonPieOptions = useMemo(() => {
    return {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          position: 'bottom',
          labels: {
            color: chartTickColor,
            boxWidth: 10,
            boxHeight: 10,
            usePointStyle: true,
          },
        },
        tooltip: {
          backgroundColor: chartTooltipBg,
          titleColor: theme.palette.text.primary,
          bodyColor: theme.palette.text.primary,
          borderColor: chartBorderColor,
          borderWidth: 1,
        },
      },
      cutout: '62%',
    };
  }, [chartTickColor, chartBorderColor, chartTooltipBg, theme.palette.text.primary]);

  const revenueChartData = useMemo(() => {
    const labels = Object.keys(metrics.dailyRevenue).filter((k) => k !== 'unknown').sort();
    const data = labels.map((d) => metrics.dailyRevenue[d] || 0);
    return {
      labels,
      datasets: [
        {
          label: 'Daily Revenue (RM)',
          data,
          ...datasetColors(palettePrimary, 'line'),
        },
      ],
    };
  }, [metrics.dailyRevenue, palettePrimary, isDarkMode]);

  const grossProfitChartData = useMemo(() => {
    const labels = Object.keys(metrics.dailyGrossProfit || {}).filter((k) => k !== 'unknown').sort();
    const data = labels.map((d) => metrics.dailyGrossProfit[d] || 0);
    return {
      labels,
      datasets: [
        {
          label: 'Daily Gross Profit (RM)',
          data,
          ...datasetColors(paletteSuccess, 'line'),
        },
      ],
    };
  }, [metrics.dailyGrossProfit, paletteSuccess, isDarkMode]);

  const txCountChartData = useMemo(() => {
    const labels = Object.keys(metrics.dailyCount).filter((k) => k !== 'unknown').sort();
    const data = labels.map((d) => metrics.dailyCount[d] || 0);
    return {
      labels,
      datasets: [
        {
          label: 'Daily Transactions',
          data,
          ...datasetColors(palettePrimary, 'bar'),
        },
      ],
    };
  }, [metrics.dailyCount, palettePrimary, isDarkMode]);

  const providerRevenueDoughnutData = useMemo(() => {
    const entries = Object.entries(metrics.providerRevenue || {})
      .filter(([k]) => String(k || 'unknown').toLowerCase() !== 'unknown')
      .sort((a, b) => (b[1] || 0) - (a[1] || 0));

    const top = entries.slice(0, 5);
    const others = entries.slice(5);
    const othersSum = others.reduce((acc, [, v]) => acc + safeNumber(v, 0), 0);

    const labels = top.map(([k]) => String(k || 'unknown').toUpperCase());
    const data = top.map(([, v]) => safeNumber(v, 0));

    if (othersSum > 0) {
      labels.push('OTHERS');
      data.push(othersSum);
    }

    const paletteSecondary = resolveColor(theme.palette.secondary?.main, palettePrimary);
    const paletteError = resolveColor(theme.palette.error?.main, palettePrimary);
    const colorPool = [paletteInfo, palettePrimary, paletteSuccess, paletteWarning, paletteSecondary, paletteError];

    const backgroundColor = labels.map((_, idx) => alpha(colorPool[idx % colorPool.length], isDarkMode ? 0.82 : 0.78));
    const borderColor = labels.map(() => alpha(theme.palette.background.paper, isDarkMode ? 0.85 : 1));

    return {
      labels,
      datasets: [
        {
          label: 'Revenue by Provider (RM)',
          data,
          backgroundColor,
          borderColor,
          borderWidth: 2,
        },
      ],
    };
  }, [
    metrics.providerRevenue,
    paletteInfo,
    palettePrimary,
    paletteSuccess,
    paletteWarning,
    isDarkMode,
    theme.palette.background.paper,
    theme.palette.secondary?.main,
    theme.palette.error?.main,
  ]);

  const categoryRevenueChartData = useMemo(() => {
    const entries = Object.entries(metrics.categoryRevenue || {})
      .sort((a, b) => (b[1] || 0) - (a[1] || 0))
      .slice(0, 12);
    const labels = entries.map(([k]) => String(k || 'Uncategorized'));
    const data = entries.map(([, v]) => safeNumber(v, 0));
    return {
      labels,
      datasets: [
        {
          label: 'Revenue by Category (RM)',
          data,
          ...datasetColors(palettePrimary, 'bar'),
        },
      ],
    };
  }, [metrics.categoryRevenue, palettePrimary, isDarkMode]);

  const categoryGrossProfitChartData = useMemo(() => {
    const entries = Object.entries(metrics.categoryGrossProfit || {})
      .sort((a, b) => (b[1] || 0) - (a[1] || 0))
      .slice(0, 12);
    const labels = entries.map(([k]) => String(k || 'Uncategorized'));
    const data = entries.map(([, v]) => safeNumber(v, 0));
    return {
      labels,
      datasets: [
        {
          label: 'Gross Profit by Category (RM)',
          data,
          ...datasetColors(paletteSuccess, 'bar'),
        },
      ],
    };
  }, [metrics.categoryGrossProfit, paletteSuccess, isDarkMode]);

  const weekdayRevenueChartData = useMemo(() => {
    const labels = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const data = labels.map((_, idx) => safeNumber(metrics.weekdayRevenue?.[idx], 0));
    return {
      labels,
      datasets: [
        {
          label: 'Revenue by Weekday (RM)',
          data,
          ...datasetColors(paletteWarning, 'bar'),
        },
      ],
    };
  }, [metrics.weekdayRevenue, paletteWarning, isDarkMode]);

  const topProductsQtyChartData = useMemo(() => {
    const top = (metrics.topProducts || []).slice(0, 10);
    const labels = top.map((p) => (p.name || p.sku || p.productId).slice(0, 28));
    const data = top.map((p) => safeNumber(p.soldQty, 0));
    return {
      labels,
      datasets: [
        {
          label: 'Top Products (Qty Sold)',
          data,
          ...datasetColors(palettePrimary, 'bar'),
        },
      ],
    };
  }, [metrics.topProducts, palettePrimary, isDarkMode]);

  const showGrossProfitTrend = useMemo(() => {
    return (
      metrics.grossProfitCoverage > 0 &&
      Number.isFinite(metrics.grossProfit) &&
      Object.keys(metrics.dailyGrossProfit || {}).some((k) => k !== 'unknown')
    );
  }, [metrics.grossProfitCoverage, metrics.grossProfit, metrics.dailyGrossProfit]);

  const revenuePreview = useMemo(() => {
    const labels = Object.keys(metrics.dailyRevenue || {}).filter((k) => k !== 'unknown').sort();
    const last = labels.slice(-7).reverse();
    return last.map((k) => ({ label: k, value: fmtCurrency(metrics.dailyRevenue[k] || 0) }));
  }, [metrics.dailyRevenue, theme.palette.text.primary]);

  const grossProfitPreview = useMemo(() => {
    const labels = Object.keys(metrics.dailyGrossProfit || {}).filter((k) => k !== 'unknown').sort();
    const last = labels.slice(-7).reverse();
    return last.map((k) => ({ label: k, value: fmtCurrency(metrics.dailyGrossProfit[k] || 0) }));
  }, [metrics.dailyGrossProfit, theme.palette.text.primary]);

  const weekdayPreview = useMemo(() => {
    const labels = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    return labels.map((d, idx) => ({ label: d, value: fmtCurrency(metrics.weekdayRevenue?.[idx] || 0) }));
  }, [metrics.weekdayRevenue, theme.palette.text.primary]);

  const topProductsPreview = useMemo(() => {
    return (metrics.topProducts || []).slice(0, 6).map((p) => ({
      label: (p.name || p.sku || p.productId).slice(0, 28),
      value: `${fmtInt(p.soldQty || 0)} pcs • ${fmtCurrency(p.revenue || 0)}`,
    }));
  }, [metrics.topProducts, theme.palette.text.primary]);

  const providerPreview = useMemo(() => {
    return Object.entries(metrics.providerRevenue || {})
      .sort((a, b) => (b[1] || 0) - (a[1] || 0))
      .slice(0, 8)
      .map(([k, v]) => ({ label: String(k || 'unknown').toUpperCase(), value: fmtCurrency(v || 0) }));
  }, [metrics.providerRevenue, theme.palette.text.primary]);

  const txCountPreview = useMemo(() => {
    const labels = Object.keys(metrics.dailyCount || {}).filter((k) => k !== 'unknown').sort();
    const last = labels.slice(-7).reverse();
    return last.map((k) => ({ label: k, value: fmtInt(metrics.dailyCount[k] || 0) }));
  }, [metrics.dailyCount, theme.palette.text.primary]);

  const categoryRevenuePreview = useMemo(() => {
    return Object.entries(metrics.categoryRevenue || {})
      .sort((a, b) => (b[1] || 0) - (a[1] || 0))
      .slice(0, 10)
      .map(([k, v]) => ({ label: String(k || 'Uncategorized'), value: fmtCurrency(v || 0) }));
  }, [metrics.categoryRevenue, theme.palette.text.primary]);

  const categoryGrossProfitPreview = useMemo(() => {
    return Object.entries(metrics.categoryGrossProfit || {})
      .sort((a, b) => (b[1] || 0) - (a[1] || 0))
      .slice(0, 10)
      .map(([k, v]) => ({ label: String(k || 'Uncategorized'), value: fmtCurrency(v || 0) }));
  }, [metrics.categoryGrossProfit, theme.palette.text.primary]);

  const kpis = useMemo(() => {
    const hasProfit = Number.isFinite(Number(metrics.grossProfit)) && metrics.grossProfitCoverage > 0;
    const grossMarginPct = (metrics.grossMargin === null || !Number.isFinite(metrics.grossMargin)) ? null : metrics.grossMargin;

    const prevHasProfit = prevMetrics && Number.isFinite(Number(prevMetrics.grossProfit)) && prevMetrics.grossProfitCoverage > 0;

    const total = Number(metrics.totalRevenue || 0);
    const bestMethodShare = total > 0 ? Number(metrics.bestMethodByRevenue?.revenue || 0) / total : 0;

    const count = Number(metrics.txCount || 0);
    const peakCountShare = count > 0 ? Number(metrics.maxDailyCount || 0) / count : 0;

    const maxTx = Number(metrics.maxTxAmount || 0);
    const avg = Number(metrics.avgSale || 0);
    const avgToMaxShare = maxTx > 0 ? avg / maxTx : 0;

    const peakShare = total > 0 ? Number(metrics.peakDay?.revenue || 0) / total : 0;

    return {
      totalRevenue: {
        title: 'Total Revenue',
        value: fmtCurrency(metrics.totalRevenue),
        hint: metrics.bestMethodByRevenue?.method ? `Top method share: ${Math.round(bestMethodShare * 100)}%` : 'Top method share: —',
        ratio: bestMethodShare,
        delta: prevMetrics ? deltaText(metrics.totalRevenue, prevMetrics.totalRevenue, fmtCurrency) : '—',
      },
      grossProfit: {
        title: 'Gross Profit',
        value: hasProfit ? fmtCurrency(metrics.grossProfit) : '—',
        hint: hasProfit ? `Coverage: ${Math.round(metrics.grossProfitCoverage * 100)}%` : 'Add product cost to enable',
        ratio: hasProfit && total > 0 ? (metrics.grossProfit / total) : 0,
        delta: (prevMetrics && hasProfit && prevHasProfit) ? deltaText(metrics.grossProfit, prevMetrics.grossProfit, fmtCurrency) : '—',
      },
      grossMargin: {
        title: 'Gross Margin',
        value: (hasProfit && grossMarginPct !== null) ? `${Math.round(grossMarginPct * 100)}%` : '—',
        hint: (hasProfit && grossMarginPct !== null) ? 'Gross profit / revenue' : 'Add product cost to enable',
        ratio: (hasProfit && grossMarginPct !== null) ? grossMarginPct : 0,
        delta: (prevMetrics && hasProfit && prevHasProfit && Number.isFinite(prevMetrics.grossMargin))
          ? deltaText(grossMarginPct, prevMetrics.grossMargin, (v) => `${Math.round(v * 100)}%`)
          : '—',
      },
      txCount: {
        title: 'Transactions',
        value: String(metrics.txCount || 0),
        hint: `Peak day share: ${Math.round(peakCountShare * 100)}%`,
        ratio: peakCountShare,
        delta: prevMetrics ? deltaText(metrics.txCount, prevMetrics.txCount, (v) => String(Math.round(v))) : '—',
      },
      avgSale: {
        title: 'Average Sale',
        value: fmtCurrency(metrics.avgSale),
        hint: maxTx > 0 ? `Avg vs max: ${Math.round(avgToMaxShare * 100)}%` : 'Avg vs max: —',
        ratio: avgToMaxShare,
        delta: prevMetrics ? deltaText(metrics.avgSale, prevMetrics.avgSale, fmtCurrency) : '—',
      },
      bestDay: {
        title: 'Best Day',
        value: metrics.peakDay?.dateKey ? String(metrics.peakDay.dateKey) : '—',
        hint: metrics.peakDay?.dateKey ? `Share: ${Math.round(peakShare * 100)}%` : 'Share: —',
        ratio: peakShare,
        delta: '—',
      },
    };
  }, [metrics, prevMetrics]);

  const panelSx = useMemo(() => {
    return {
      p: { xs: 1.25, md: 1.5 },
      borderRadius: 2,
      borderColor: alpha(theme.palette.text.primary, 0.14),
      '& .MuiTypography-h6': {
        fontSize: '0.9rem',
        fontWeight: 800,
        letterSpacing: 0.3,
      },
    };
  }, [theme.palette.text.primary]);

  const kpiValueSx = {
    fontVariantNumeric: 'tabular-nums',
    fontWeight: 900,
    letterSpacing: 0.2,
    lineHeight: 1.15,
  };

  const DataPreviewTable = ({ title, rows, col1 = 'Label', col2 = 'Value', divider = true, sx }) => {
    const safeRows = Array.isArray(rows) ? rows : [];

    return (
      <Box
        sx={{
          mt: 0.75,
          pt: 0.75,
          ...(divider ? { borderTop: `1px solid ${alpha(theme.palette.text.primary, 0.08)}` } : { borderTop: 'none' }),
          ...(sx || {}),
        }}
      >
        {title ? (
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.5 }}>
            {title}
          </Typography>
        ) : null}

        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: 'minmax(0, 1fr) auto',
            columnGap: 1,
            rowGap: 0.4,
            alignItems: 'baseline',
          }}
        >
          <Typography variant="caption" sx={{ fontWeight: 800, color: 'text.secondary' }}>{col1}</Typography>
          <Typography variant="caption" sx={{ fontWeight: 800, color: 'text.secondary', textAlign: 'right' }}>{col2}</Typography>

          {safeRows.length === 0 ? (
            <>
              <Typography variant="caption" color="text.secondary">—</Typography>
              <Typography variant="caption" color="text.secondary" sx={{ textAlign: 'right' }}>—</Typography>
            </>
          ) : (
            safeRows.map((r, idx) => (
              <React.Fragment key={`${r?.label || 'row'}_${idx}`}>
                <Typography
                  variant="caption"
                  sx={{
                    color: 'text.secondary',
                    fontWeight: 650,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                    pr: 1,
                  }}
                  title={String(r?.label ?? '')}
                >
                  {String(r?.label ?? '')}
                </Typography>
                <Typography
                  variant="caption"
                  sx={{
                    textAlign: 'right',
                    fontVariantNumeric: 'tabular-nums',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {String(r?.value ?? '')}
                </Typography>
              </React.Fragment>
            ))
          )}
        </Box>
      </Box>
    );
  };

  const compareRows = useMemo(() => {
    if (!prevRange || !prevMetrics) return [];

    const hasProfitNow = metrics.grossProfitCoverage > 0 && Number.isFinite(metrics.grossProfit);
    const hasProfitPrev = prevMetrics.grossProfitCoverage > 0 && Number.isFinite(prevMetrics.grossProfit);

    return [
      {
        label: 'Revenue',
        current: fmtCurrency(metrics.totalRevenue),
        prev: fmtCurrency(prevMetrics.totalRevenue),
        delta: deltaText(metrics.totalRevenue, prevMetrics.totalRevenue, fmtCurrency),
      },
      {
        label: 'Gross Profit',
        current: hasProfitNow ? fmtCurrency(metrics.grossProfit) : '—',
        prev: hasProfitPrev ? fmtCurrency(prevMetrics.grossProfit) : '—',
        delta: (hasProfitNow && hasProfitPrev)
          ? deltaText(metrics.grossProfit, prevMetrics.grossProfit, fmtCurrency)
          : '—',
      },
      {
        label: 'Gross Margin',
        current: (metrics.grossMargin !== null && Number.isFinite(metrics.grossMargin)) ? `${Math.round(metrics.grossMargin * 100)}%` : '—',
        prev: (prevMetrics.grossMargin !== null && Number.isFinite(prevMetrics.grossMargin)) ? `${Math.round(prevMetrics.grossMargin * 100)}%` : '—',
        delta: (metrics.grossMargin !== null && prevMetrics.grossMargin !== null && Number.isFinite(metrics.grossMargin) && Number.isFinite(prevMetrics.grossMargin))
          ? deltaText(metrics.grossMargin, prevMetrics.grossMargin, (v) => `${Math.round(v * 100)}%`)
          : '—',
      },
      {
        label: 'Transactions',
        current: fmtInt(metrics.txCount),
        prev: fmtInt(prevMetrics.txCount),
        delta: deltaText(metrics.txCount, prevMetrics.txCount, (v) => String(Math.round(Number(v) || 0))),
      },
      {
        label: 'Avg Sale',
        current: fmtCurrency(metrics.avgSale),
        prev: fmtCurrency(prevMetrics.avgSale),
        delta: deltaText(metrics.avgSale, prevMetrics.avgSale, fmtCurrency),
      },
    ];
  }, [prevRange, prevMetrics, metrics]);

  return (
    <Box sx={{ p: { xs: 1.5, md: 2 } }}>
      <Box ref={dashboardRef} sx={{ borderRadius: 2 }}>
        <Box sx={{ display: 'flex', alignItems: { xs: 'flex-start', md: 'center' }, justifyContent: 'space-between', gap: 1.5, mb: 1.5 }}>
          <Box>
            <Typography variant="subtitle1" sx={{ fontWeight: 900, letterSpacing: 0.6, textTransform: 'uppercase' }}>
              Financial Dashboard
            </Typography>
            <Typography variant="caption" color="text.secondary">
              KPI overview • {fromDate || 'All time'} {toDate ? `→ ${toDate}` : ''}{prevRange ? ` • Prev: ${prevRange.fromDate} → ${prevRange.toDate}` : ''}
            </Typography>
          </Box>

          <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
            <ButtonGroup size="small" variant="outlined" disabled={exporting}>
              <Button onClick={() => setPreset('7D')}>7D</Button>
              <Button onClick={() => setPreset('30D')}>30D</Button>
              <Button onClick={() => setPreset('90D')}>90D</Button>
              <Button onClick={() => setPreset('YTD')}>YTD</Button>
              <Button onClick={() => setPreset('ALL')}>ALL</Button>
            </ButtonGroup>

            <TextField
              label="From"
              type="date"
              size="small"
              InputLabelProps={{ shrink: true }}
              value={fromDate}
              onChange={(e) => setFromDate(e.target.value)}
              disabled={exporting}
            />
            <TextField
              label="To"
              type="date"
              size="small"
              InputLabelProps={{ shrink: true }}
              value={toDate}
              onChange={(e) => setToDate(e.target.value)}
              disabled={exporting}
            />

            <ButtonGroup size="small" variant="contained" disabled={exporting}>
              <Button onClick={handleExportPng}>PNG</Button>
              <Button onClick={handleExportPdf}>PDF</Button>
              <Button onClick={handleExportExcel}>Excel</Button>
            </ButtonGroup>
          </Box>
        </Box>

        {loading ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}><CircularProgress /></Box>
        ) : (
          <Box
            sx={{
              display: 'grid',
              gap: 0.75,
              gridTemplateColumns: { xs: '1fr', md: 'repeat(12, 1fr)' },
              alignItems: 'stretch',
            }}
          >
          {/* KPI tiles */}
          <SectionCard
            title={null}
            sx={{ ...panelSx, gridColumn: { md: 'span 2' } }}
          >
            <Typography variant="caption" sx={{ fontWeight: 800, letterSpacing: 0.6, textTransform: 'uppercase' }} color="text.secondary">
              {kpis.totalRevenue.title}
            </Typography>
            <Typography variant="h6" sx={kpiValueSx}>
              {kpis.totalRevenue.value}
            </Typography>
            <Typography variant="caption" color="text.secondary">{kpis.totalRevenue.hint}</Typography>
            <Typography variant="caption" color="text.secondary">Δ {kpis.totalRevenue.delta}</Typography>
          </SectionCard>

          <SectionCard
            title={null}
            sx={{ ...panelSx, gridColumn: { md: 'span 2' } }}
          >
            <Typography variant="caption" sx={{ fontWeight: 800, letterSpacing: 0.6, textTransform: 'uppercase' }} color="text.secondary">
              {kpis.grossProfit.title}
            </Typography>
            <Typography variant="h6" sx={kpiValueSx}>
              {kpis.grossProfit.value}
            </Typography>
            <Typography variant="caption" color="text.secondary">{kpis.grossProfit.hint}</Typography>
            <Typography variant="caption" color="text.secondary">Δ {kpis.grossProfit.delta}</Typography>
          </SectionCard>

          <SectionCard
            title={null}
            sx={{ ...panelSx, gridColumn: { md: 'span 2' } }}
          >
            <Typography variant="caption" sx={{ fontWeight: 800, letterSpacing: 0.6, textTransform: 'uppercase' }} color="text.secondary">
              {kpis.grossMargin.title}
            </Typography>
            <Typography variant="h6" sx={kpiValueSx}>
              {kpis.grossMargin.value}
            </Typography>
            <Typography variant="caption" color="text.secondary">{kpis.grossMargin.hint}</Typography>
            <Typography variant="caption" color="text.secondary">Δ {kpis.grossMargin.delta}</Typography>
          </SectionCard>

          <SectionCard
            title={null}
            sx={{ ...panelSx, gridColumn: { md: 'span 2' } }}
          >
            <Typography variant="caption" sx={{ fontWeight: 800, letterSpacing: 0.6, textTransform: 'uppercase' }} color="text.secondary">
              {kpis.txCount.title}
            </Typography>
            <Typography variant="h6" sx={kpiValueSx}>
              {kpis.txCount.value}
            </Typography>
            <Typography variant="caption" color="text.secondary">{kpis.txCount.hint}</Typography>
            <Typography variant="caption" color="text.secondary">Δ {kpis.txCount.delta}</Typography>
          </SectionCard>

          <SectionCard
            title={null}
            sx={{ ...panelSx, gridColumn: { md: 'span 2' } }}
          >
            <Typography variant="caption" sx={{ fontWeight: 800, letterSpacing: 0.6, textTransform: 'uppercase' }} color="text.secondary">
              {kpis.avgSale.title}
            </Typography>
            <Typography variant="h6" sx={kpiValueSx}>
              {kpis.avgSale.value}
            </Typography>
            <Typography variant="caption" color="text.secondary">{kpis.avgSale.hint}</Typography>
            <Typography variant="caption" color="text.secondary">Δ {kpis.avgSale.delta}</Typography>
          </SectionCard>

          <SectionCard
            title={null}
            sx={{ ...panelSx, gridColumn: { md: 'span 2' } }}
          >
            <Typography variant="caption" sx={{ fontWeight: 800, letterSpacing: 0.6, textTransform: 'uppercase' }} color="text.secondary">
              {kpis.bestDay.title}
            </Typography>
            <Typography variant="h6" sx={kpiValueSx}>
              {kpis.bestDay.value}
            </Typography>
            <Typography variant="caption" color="text.secondary">{kpis.bestDay.hint}</Typography>
            <Typography variant="caption" color="text.secondary">Δ {kpis.bestDay.delta}</Typography>
          </SectionCard>

          {/* Large chart on the right, spanning two rows on desktop */}
          <SectionCard
            title="Revenue Trend"
            sx={{ ...panelSx, gridColumn: { md: 'span 7' }, gridRow: { md: 'span 2' } }}
          >
            <Box sx={{ height: showGrossProfitTrend ? 220 : 320 }}>
              <Line data={revenueChartData} options={commonChartOptions} />
            </Box>
            <DataPreviewTable title="Data (latest 7)" rows={revenuePreview} col1="Date" col2="Revenue" />

            {showGrossProfitTrend ? (
              <Box sx={{ mt: 0.75, height: 150 }}>
                <Line data={grossProfitChartData} options={commonChartOptions} />
              </Box>
            ) : null}

            {showGrossProfitTrend ? (
              <DataPreviewTable title="Gross Profit data (latest 7)" rows={grossProfitPreview} col1="Date" col2="Gross Profit" />
            ) : null}
            <Divider sx={{ my: 1 }} />
            <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 2, flexWrap: 'wrap' }}>
              <Typography variant="caption" color="text.secondary">
                Best method: <Box component="span" sx={{ fontWeight: 700 }}>{metrics.bestMethodByRevenue?.method || '—'}</Box>
              </Typography>
              <Typography variant="caption" color="text.secondary">
                Revenue: <Box component="span" sx={{ fontWeight: 700 }}>{metrics.bestMethodByRevenue?.method ? fmtCurrency(metrics.bestMethodByRevenue?.revenue) : '—'}</Box>
              </Typography>
            </Box>
          </SectionCard>

          {/* Left breakdown card */}
          <SectionCard
            title="Summary"
            sx={{ ...panelSx, gridColumn: { md: 'span 5' }, gridRow: { md: 'span 2' } }}
          >
            <AiSummary sales={executiveSalesPayload} disabled={loading} role={currentRole} scope="financial-reports" />
            <Divider sx={{ my: 1 }} />
            <List dense>
              <ListItem divider>
                <ListItemText
                  primary="Total Revenue"
                  secondary={fmtCurrency(metrics.totalRevenue)}
                  primaryTypographyProps={{ variant: 'body2', color: 'text.secondary', fontWeight: 600 }}
                  secondaryTypographyProps={{ variant: 'subtitle2' }}
                />
              </ListItem>
              <ListItem divider>
                <ListItemText
                  primary="Transactions"
                  secondary={String(metrics.txCount || 0)}
                  primaryTypographyProps={{ variant: 'body2', color: 'text.secondary', fontWeight: 600 }}
                  secondaryTypographyProps={{ variant: 'subtitle2' }}
                />
              </ListItem>
              <ListItem divider>
                <ListItemText
                  primary="Average Sale"
                  secondary={fmtCurrency(metrics.avgSale)}
                  primaryTypographyProps={{ variant: 'body2', color: 'text.secondary', fontWeight: 600 }}
                  secondaryTypographyProps={{ variant: 'subtitle2' }}
                />
              </ListItem>
              <ListItem divider>
                <ListItemText
                  primary="Gross Profit"
                  secondary={(metrics.grossProfitCoverage > 0 && Number.isFinite(metrics.grossProfit)) ? fmtCurrency(metrics.grossProfit) : '—'}
                  primaryTypographyProps={{ variant: 'body2', color: 'text.secondary', fontWeight: 600 }}
                  secondaryTypographyProps={{ variant: 'subtitle2' }}
                />
              </ListItem>
              <ListItem divider>
                <ListItemText
                  primary="Gross Margin"
                  secondary={(metrics.grossMargin !== null && Number.isFinite(metrics.grossMargin)) ? `${Math.round(metrics.grossMargin * 100)}%` : '—'}
                  primaryTypographyProps={{ variant: 'body2', color: 'text.secondary', fontWeight: 600 }}
                  secondaryTypographyProps={{ variant: 'subtitle2' }}
                />
              </ListItem>
              <ListItem divider>
                <ListItemText
                  primary="Best Day"
                  secondary={metrics.peakDay?.dateKey ? `${metrics.peakDay.dateKey} • ${fmtCurrency(metrics.peakDay.revenue)}` : '—'}
                  primaryTypographyProps={{ variant: 'body2', color: 'text.secondary', fontWeight: 600 }}
                  secondaryTypographyProps={{ variant: 'subtitle2' }}
                />
              </ListItem>
              <ListItem>
                <ListItemText
                  primary="Best Payment Method"
                  secondary={metrics.bestMethodByRevenue?.method ? `${metrics.bestMethodByRevenue.method} • ${fmtCurrency(metrics.bestMethodByRevenue.revenue)}` : '—'}
                  primaryTypographyProps={{ variant: 'body2', color: 'text.secondary', fontWeight: 600 }}
                  secondaryTypographyProps={{ variant: 'subtitle2' }}
                />
              </ListItem>
            </List>
            {(metrics.grossProfitCoverage === 0) ? (
              <Alert severity="info" sx={{ mt: 1.5 }}>
                To enable Profit analytics, add a numeric <strong>cost</strong> field to each product.
              </Alert>
            ) : null}

            {prevRange && prevMetrics ? (
              <>
                <Divider sx={{ my: 1.25 }} />
                <Typography variant="caption" color="text.secondary">
                  Comparison • Current ({fromDate || 'All'} → {toDate || 'Now'}) vs Previous ({prevRange.fromDate} → {prevRange.toDate})
                </Typography>

                <Box
                  sx={{
                    mt: 0.75,
                    display: 'grid',
                    gridTemplateColumns: '1.2fr 1fr 1fr 1fr',
                    gap: 0.75,
                    alignItems: 'baseline',
                  }}
                >
                  <Typography variant="caption" sx={{ fontWeight: 800, color: 'text.secondary' }}>Metric</Typography>
                  <Typography variant="caption" sx={{ fontWeight: 800, color: 'text.secondary', textAlign: 'right' }}>Current</Typography>
                  <Typography variant="caption" sx={{ fontWeight: 800, color: 'text.secondary', textAlign: 'right' }}>Previous</Typography>
                  <Typography variant="caption" sx={{ fontWeight: 800, color: 'text.secondary', textAlign: 'right' }}>Δ</Typography>

                  {compareRows.map((r) => (
                    <React.Fragment key={r.label}>
                      <Typography variant="caption" sx={{ fontWeight: 650, color: 'text.secondary' }}>{r.label}</Typography>
                      <Typography variant="caption" sx={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{r.current}</Typography>
                      <Typography variant="caption" sx={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{r.prev}</Typography>
                      <Typography variant="caption" sx={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{r.delta}</Typography>
                    </React.Fragment>
                  ))}
                </Box>
              </>
            ) : null}
          </SectionCard>

          <SectionCard
            title="Sales Forecasting"
            sx={{ ...panelSx, gridColumn: { md: 'span 12' }, gridRow: { md: 'span 2' } }}
          >
            {forecast?.chartData?.length ? (
              <>
              <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '2fr 1fr' }, gap: 1.5, alignItems: 'stretch' }}>
                <Box sx={{ height: '100%', minHeight: 230 }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={forecast.chartData} margin={{ top: 10, right: 10, bottom: 0, left: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke={alpha(theme.palette.text.primary, 0.12)} />
                      <XAxis dataKey="name" tick={{ fill: theme.palette.text.secondary, fontSize: 11 }} />
                      <YAxis tick={{ fill: theme.palette.text.secondary, fontSize: 11 }} />
                      <RTooltip />
                      <RLine type="monotone" dataKey="sales" stroke={theme.palette.primary.main} strokeWidth={2} dot={{ r: 2 }} />
                    </LineChart>
                  </ResponsiveContainer>
                </Box>

                <Box>
                  <Typography variant="caption" sx={{ fontWeight: 800, letterSpacing: 0.6, textTransform: 'uppercase' }} color="text.secondary">
                    Next 3 days (prediction)
                  </Typography>
                  <Box sx={{ mt: 0.75, display: 'grid', gap: 0.75 }}>
                    {(forecast.forecast || []).map((d) => (
                      <Box
                        key={d.name}
                        sx={{
                          border: `1px solid ${alpha(theme.palette.text.primary, 0.12)}`,
                          borderRadius: 1,
                          px: 1,
                          py: 0.75,
                        }}
                      >
                        <Typography variant="caption" color="text.secondary">{d.name}</Typography>
                        <Typography variant="subtitle2" sx={{ fontWeight: 800 }}>
                          {fmtCurrency(d.sales)}
                        </Typography>
                      </Box>
                    ))}
                  </Box>

                  <Box
                    sx={{
                      mt: 1,
                      border: `1px solid ${alpha(theme.palette.text.primary, 0.12)}`,
                      borderRadius: 1,
                      px: 1,
                      py: 0.75,
                    }}
                  >
                    <Typography variant="caption" sx={{ fontWeight: 800 }} color="text.secondary">
                      Forecast quality
                    </Typography>
                    <Box sx={{ mt: 0.5, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 0.75 }}>
                      <Box>
                        <Typography variant="caption" color="text.secondary">R²</Typography>
                        <Typography variant="subtitle2" sx={{ fontWeight: 800, fontVariantNumeric: 'tabular-nums' }}>
                          {Number.isFinite(forecast?.quality?.r2) ? forecast.quality.r2.toFixed(2) : '—'}
                        </Typography>
                      </Box>
                      <Box>
                        <Typography variant="caption" color="text.secondary">Points used</Typography>
                        <Typography variant="subtitle2" sx={{ fontWeight: 800, fontVariantNumeric: 'tabular-nums' }}>
                          {Number.isFinite(forecast?.quality?.pointsUsed) ? forecast.quality.pointsUsed : '—'}
                        </Typography>
                      </Box>
                      <Box sx={{ gridColumn: '1 / -1' }}>
                        <Typography variant="caption" color="text.secondary">Slope (revenue change/day)</Typography>
                        <Typography variant="subtitle2" sx={{ fontWeight: 800, fontVariantNumeric: 'tabular-nums' }}>
                          {Number.isFinite(forecast?.quality?.slope)
                            ? `${forecast.quality.slope >= 0 ? '+' : '-'}${fmtCurrency(Math.abs(forecast.quality.slope))}/day`
                            : '—'}
                        </Typography>
                        {forecast?.quality?.fromDate && forecast?.quality?.toDate ? (
                          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.25 }}>
                            Range: {forecast.quality.fromDate} → {forecast.quality.toDate}
                          </Typography>
                        ) : null}
                      </Box>
                    </Box>
                  </Box>

                  <DataPreviewTable
                    title="Data used (latest 10 days)"
                    rows={forecastDataPreviewRows}
                    col1="Date"
                    col2="Revenue"
                  />

                  <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.75 }}>
                    Based on the last 30 days.
                  </Typography>
                </Box>
              </Box>

              <Box
                sx={{
                  mt: 1.25,
                  pt: 1,
                  borderTop: `1px solid ${alpha(theme.palette.text.primary, 0.08)}`,
                }}
              >
                <AiSummary
                  sales={forecastExplainPayload}
                  disabled={loading || !forecastExplainPayload}
                  role={currentRole}
                  scope="sales-forecast-explain"
                  title="Why this forecast"
                  idleSubtitle="Generate a short plain-English explanation of this forecast."
                />
              </Box>
              </>
            ) : (
              <Typography variant="body2" color="text.secondary">
                Not enough data to predict yet. (Need 2+ days)
              </Typography>
            )}
          </SectionCard>

          <SectionCard
            title="Top Products Sold (Qty)"
            sx={{ ...panelSx, gridColumn: { md: 'span 7' } }}
          >
            <Box sx={{ height: 160 }}>
              <Bar data={topProductsQtyChartData} options={commonChartOptions} />
            </Box>
            <DataPreviewTable title="Data (top 6)" rows={topProductsPreview} col1="Product" col2="Qty • Revenue" />
          </SectionCard>

          <SectionCard
            title="Sales by Weekday"
            sx={{ ...panelSx, gridColumn: { md: 'span 5' } }}
          >
            <Box sx={{ height: 150 }}>
              <Bar data={weekdayRevenueChartData} options={commonChartOptions} />
            </Box>
            <DataPreviewTable title="Data" rows={weekdayPreview} col1="Day" col2="Revenue" />
          </SectionCard>

          <SectionCard
            title="Revenue by Provider"
            sx={{ ...panelSx, gridColumn: { md: 'span 5' } }}
          >
            <Box sx={{ height: 160 }}>
              <Doughnut data={providerRevenueDoughnutData} options={commonPieOptions} />
            </Box>
            <DataPreviewTable title="Data" rows={providerPreview} col1="Provider" col2="Revenue" />
          </SectionCard>

          <SectionCard
            title="Daily Transaction Count"
            sx={{ ...panelSx, gridColumn: { md: 'span 7' } }}
          >
            <Box sx={{ height: 160 }}>
              <Bar data={txCountChartData} options={commonChartOptions} />
            </Box>
            <DataPreviewTable title="Data (latest 7)" rows={txCountPreview} col1="Date" col2="Transactions" />
          </SectionCard>

          <SectionCard
            title="Revenue by Category"
            sx={{ ...panelSx, gridColumn: { md: 'span 12' } }}
          >
            <Box sx={{ height: 200 }}>
              <Bar data={categoryRevenueChartData} options={commonChartOptions} />
            </Box>
            <DataPreviewTable title="Data (top 10)" rows={categoryRevenuePreview} col1="Category" col2="Revenue" />
            {(metrics.grossProfitCoverage > 0 && Object.keys(metrics.categoryGrossProfit || {}).length > 0) ? (
              <>
                <Box sx={{ mt: 1, height: 170 }}>
                  <Bar data={categoryGrossProfitChartData} options={commonChartOptions} />
                </Box>
                <DataPreviewTable title="Gross Profit data (top 10)" rows={categoryGrossProfitPreview} col1="Category" col2="Gross Profit" />
              </>
            ) : null}
          </SectionCard>

            {error ? (
              <Alert severity="error">{error}</Alert>
            ) : null}
          </Box>
        )}
      </Box>
    </Box>
  );
};

export default FinancialReports;
