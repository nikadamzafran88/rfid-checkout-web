import regression from 'regression';

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

const toDateKeyUtc = (ms) => {
  if (!ms) return null;
  try {
    return new Date(ms).toISOString().slice(0, 10);
  } catch {
    return null;
  }
};

const addDaysToDateKeyUtc = (dateKey, days) => {
  if (!dateKey) return '';
  const d = new Date(`${dateKey}T00:00:00.000Z`);
  if (Number.isNaN(d.getTime())) return '';
  d.setUTCDate(d.getUTCDate() + Number(days || 0));
  return d.toISOString().slice(0, 10);
};

export const calculateTrend = (orders, { daysToPredict = 3 } = {}) => {
  const salesByDate = {};

  (Array.isArray(orders) ? orders : []).forEach((order) => {
    if (!order || typeof order !== 'object') return;

    const ms = toMs(order.timestamp ?? order.time ?? order.createdAt ?? order.created_at);
    const dateKey = toDateKeyUtc(ms);
    if (!dateKey) return;

    const amountRaw = order.totalAmount ?? order.total_amount ?? order.amount ?? 0;
    const amount = Number(amountRaw);
    if (!Number.isFinite(amount)) return;

    if (!salesByDate[dateKey]) salesByDate[dateKey] = 0;
    salesByDate[dateKey] += amount;
  });

  const dates = Object.keys(salesByDate).sort();
  const dataPoints = dates.map((date, index) => [index, salesByDate[date]]);

  if (dataPoints.length < 2) {
    return { chartData: [], forecast: [] };
  }

  const result = regression.linear(dataPoints);

  const slope = Array.isArray(result?.equation) ? Number(result.equation[0]) : NaN;
  const intercept = Array.isArray(result?.equation) ? Number(result.equation[1]) : NaN;
  const r2 = Number(result?.r2);

  const lastDayIndex = dataPoints.length - 1;
  const lastDateKey = dates[dates.length - 1];
  const futurePredictions = [];

  for (let i = 1; i <= daysToPredict; i += 1) {
    const nextDayIndex = lastDayIndex + i;
    const predictedSales = result.predict(nextDayIndex)[1];

    futurePredictions.push({
      name: addDaysToDateKeyUtc(lastDateKey, i) || `Day +${i}`,
      sales: Math.max(0, Number(predictedSales) || 0),
      isPrediction: true,
    });
  }

  const historicalData = dates.map((date) => ({
    name: date,
    sales: salesByDate[date],
    isPrediction: false,
  }));

  return {
    chartData: [...historicalData, ...futurePredictions],
    forecast: futurePredictions,
    quality: {
      r2: Number.isFinite(r2) ? r2 : null,
      slope: Number.isFinite(slope) ? slope : null,
      intercept: Number.isFinite(intercept) ? intercept : null,
      pointsUsed: dataPoints.length,
      fromDate: dates[0] || null,
      toDate: lastDateKey || null,
    },
  };
};
