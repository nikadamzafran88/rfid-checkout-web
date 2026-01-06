import React, { useEffect, useMemo, useRef, useState } from 'react';
import { db, rtdb } from '../firebaseConfig';
import PageHeader from '../components/ui/PageHeader';
import SectionCard from '../components/ui/SectionCard';
import { ref as rtdbRef, onValue, set as rtdbSet, get as rtdbGet } from 'firebase/database';
import { collection, getDocs, doc, runTransaction, serverTimestamp } from 'firebase/firestore';
import { useAuth } from '../context/AuthContext.jsx';
import { logAction } from '../utils/logAction';
import {
  Box,
  Typography,
  Grid,
  TextField,
  Button,
  CircularProgress,
  Alert,
  Stack,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Checkbox,
  FormControlLabel,
} from '@mui/material';

const TagUidLink = () => {
  const { currentUser, currentRole } = useAuth();
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [rtdbConnected, setRtdbConnected] = useState(true);
  const [scanStatus, setScanStatus] = useState('Waiting for scan...');
  const [lastScannedUid, setLastScannedUid] = useState('');
  const [lastScannedAt, setLastScannedAt] = useState(null);
  const [scanError, setScanError] = useState('');
  const scanStatusTimerRef = useRef(null);
  const lastScannedUidRef = useRef('');

  const [search, setSearch] = useState('');
  const [selectedProductId, setSelectedProductId] = useState('');
  const [linkBusy, setLinkBusy] = useState(false);

  const [manualUid, setManualUid] = useState('');
  const [manualBusy, setManualBusy] = useState(false);
  const [manualError, setManualError] = useState('');
  const [manualStatus, setManualStatus] = useState('');
  const [showManualUid, setShowManualUid] = useState(false);

  const [batchMode, setBatchMode] = useState(false);
  const [batchCount, setBatchCount] = useState(0);
  const [batchStatus, setBatchStatus] = useState('');
  const [batchError, setBatchError] = useState('');
  const [scanSeq, setScanSeq] = useState(0);
  const batchProcessingRef = useRef(false);
  const processedBatchUidsRef = useRef(new Set());
  const pendingBatchUidsRef = useRef([]);

  const productsCollectionRef = collection(db, 'products');

  const fetchProducts = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await getDocs(productsCollectionRef);
      const productsList = data.docs.map((d) => ({ ...d.data(), id: d.id }));
      setProducts(productsList);
    } catch (err) {
      console.error('Error fetching products:', err);
      setError('Failed to load products.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchProducts();

    const connRef = rtdbRef(rtdb, '.info/connected');
    const unsubConn = onValue(
      connRef,
      (snap) => setRtdbConnected(Boolean(snap.val())),
      (err) => {
        console.warn('RTDB .info/connected listener error', err);
        setRtdbConnected(false);
      }
    );

    const lastScanRef = rtdbRef(rtdb, 'system/last_scanned_uid');
    const unsubScan = onValue(
      lastScanRef,
      (snapshot) => {
        setScanError('');
        const scanned = snapshot.val();
        if (!scanned) return;

        const nextUid = String(scanned);

        // Always show feedback, even if the same UID is scanned again.
        // Some readers write the same UID repeatedly without changing the value.
        const isRepeat = nextUid === lastScannedUidRef.current;
        lastScannedUidRef.current = nextUid;
        setLastScannedUid(nextUid);
        setLastScannedAt(Date.now());
        setScanStatus(isRepeat ? 'Scan detected (same tag)' : 'Scan detected');
        setScanSeq((n) => n + 1);

        if (scanStatusTimerRef.current) clearTimeout(scanStatusTimerRef.current);
        scanStatusTimerRef.current = setTimeout(() => setScanStatus('Waiting for scan...'), 3000);
      },
      (err) => {
        console.warn('RTDB scan listener error', err);
        setScanError(err?.message ? String(err.message) : 'Failed to read system/last_scanned_uid');
      }
    );

    return () => {
      if (scanStatusTimerRef.current) clearTimeout(scanStatusTimerRef.current);
      try {
        unsubConn();
      } catch {
        // ignore
      }
      unsubScan();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const filteredProducts = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return products;

    return products.filter((p) => {
      const name = String(p.name || '').toLowerCase();
      const category = String(p.category || '').toLowerCase();
      const id = String(p.id || '').toLowerCase();
      return name.includes(q) || category.includes(q) || id.includes(q);
    });
  }, [products, search]);

  const selectedProduct = useMemo(
    () => products.find((p) => p.id === selectedProductId) || null,
    [products, selectedProductId]
  );

  const adjustInventoryStock = async (productId, delta) => {
    const pid = String(productId || '').trim();
    if (!pid || !Number.isFinite(delta) || delta === 0) return;

    await runTransaction(db, async (t) => {
      const invRef = doc(db, 'inventory', pid);
      const invSnap = await t.get(invRef);
      const current = invSnap.exists() ? Number(invSnap.data()?.stockLevel ?? 0) || 0 : 0;
      const next = Math.max(0, current + delta);
      t.set(
        invRef,
        {
          productID: pid,
          stockLevel: next,
          lastUpdated: serverTimestamp(),
        },
        { merge: true }
      );
    });
  };

  const linkUidToProduct = async ({ uid, productId }) => {
    const cleanUid = String(uid || '').trim();
    const cleanProductId = String(productId || '').trim();
    if (!cleanUid) throw new Error('UID is required');
    if (!cleanProductId) throw new Error('productId is required');

    const prevSnap = await rtdbGet(rtdbRef(rtdb, `tags/${cleanUid}`));
    const prevProductId = prevSnap.exists() ? String(prevSnap.val() || '') : '';

    await rtdbSet(rtdbRef(rtdb, `tags/${cleanUid}`), cleanProductId);

    // Keep inventory in sync with UID stickers: each UID linked = 1 stock.
    // - If relinking to same product: do nothing
    // - If moving between products: decrement old, increment new
    if (prevProductId && prevProductId !== cleanProductId) {
      await adjustInventoryStock(prevProductId, -1);
    }
    const didAddStock = (!prevProductId || prevProductId !== cleanProductId);
    if (didAddStock) {
      await adjustInventoryStock(cleanProductId, +1);
    }

    await logAction(db, {
      type: 'tag_link',
      source: 'TagUidLink',
      actorUID: currentUser?.uid || null,
      actorRole: currentRole || null,
      targetId: cleanUid,
      targetType: 'tag_uid',
      message: `Linked tag ${cleanUid} to product ${cleanProductId}`,
      metadata: {
        uid: cleanUid,
        productId: cleanProductId,
        prevProductId: prevProductId || null,
        mode: batchMode ? 'batch' : 'single',
      },
    });

    return { prevProductId, didAddStock };
  };

  const clearClipboard = async () => {
    try {
      await rtdbSet(rtdbRef(rtdb, 'system/last_scanned_uid'), '');
      setLastScannedUid('');
      setLastScannedAt(null);
      setScanStatus('Clipboard cleared');
      if (scanStatusTimerRef.current) clearTimeout(scanStatusTimerRef.current);
      scanStatusTimerRef.current = setTimeout(() => setScanStatus('Waiting for scan...'), 1500);

      await logAction(db, {
        type: 'rfid_clipboard_clear',
        source: 'TagUidLink',
        actorUID: currentUser?.uid || null,
        actorRole: currentRole || null,
        message: 'Cleared RFID clipboard (system/last_scanned_uid)',
      });
    } catch (err) {
      console.warn('Failed to clear last_scanned_uid', err);
      setScanStatus('Failed to clear clipboard');
    }
  };

  const linkTagToProduct = async () => {
    const uid = String(lastScannedUid || '').trim();
    if (!uid) {
      alert('Please scan a tag first (system/last_scanned_uid).');
      return;
    }
    if (!selectedProductId) {
      alert('Please select a product to link.');
      return;
    }

    setLinkBusy(true);
    try {
      await linkUidToProduct({ uid, productId: selectedProductId });

      setScanStatus('Tag linked');
      if (scanStatusTimerRef.current) clearTimeout(scanStatusTimerRef.current);
      scanStatusTimerRef.current = setTimeout(() => setScanStatus('Waiting for scan...'), 2500);
      alert(`Success! Tag ${uid} linked.`);
    } catch (err) {
      console.error('Failed to link tag', err);
      alert('Failed to link tag.');
    } finally {
      setLinkBusy(false);
    }
  };

  const onToggleBatchMode = (checked) => {
    setBatchError('');
    setBatchStatus('');
    setManualError('');
    setManualStatus('');
    if (checked && !selectedProductId) {
      setBatchError('Select a product first to enable Batch Mode.');
      return;
    }
    setBatchMode(checked);
    setBatchCount(0);
    processedBatchUidsRef.current = new Set();
    pendingBatchUidsRef.current = [];
  };

  const enqueueBatchUid = (uid) => {
    const clean = String(uid || '').trim();
    if (!clean) return { enqueued: false, reason: 'empty' };
    if (processedBatchUidsRef.current.has(clean)) return { enqueued: false, reason: 'processed' };
    if (pendingBatchUidsRef.current.includes(clean)) return { enqueued: false, reason: 'queued' };
    pendingBatchUidsRef.current.push(clean);
    return { enqueued: true, uid: clean };
  };

  const drainBatchQueue = async (productId) => {
    const pid = String(productId || '').trim();
    if (!pid) return;
    if (batchProcessingRef.current) return;

    batchProcessingRef.current = true;
    setBatchError('');
    try {
      while (pendingBatchUidsRef.current.length > 0) {
        const nextUid = pendingBatchUidsRef.current.shift();
        if (!nextUid) continue;
        if (processedBatchUidsRef.current.has(nextUid)) continue;

        try {
          const res = await linkUidToProduct({ uid: nextUid, productId: pid });

          // Clear clipboard so the next scan always triggers a value change.
          try {
            await rtdbSet(rtdbRef(rtdb, 'system/last_scanned_uid'), '');
          } catch {
            // ignore
          }

          processedBatchUidsRef.current.add(nextUid);
          if (res?.didAddStock) {
            setBatchCount((n) => n + 1);
          }
          setBatchStatus(`Saved ${nextUid}`);
        } catch (e) {
          const msg = e?.message ? String(e.message) : 'Failed to save UID';
          setBatchError(`${msg}: ${String(nextUid)}`);
        }
      }
    } finally {
      batchProcessingRef.current = false;
    }
  };

  const linkManualUid = async () => {
    const uid = String(manualUid || '').trim();
    if (!uid) {
      setManualError('UID is required');
      return;
    }
    if (!selectedProductId) {
      setManualError('Please select a product first');
      return;
    }

    setManualBusy(true);
    setManualError('');
    setManualStatus('');
    try {
      if (batchMode) {
        const res = enqueueBatchUid(uid);
        if (res.reason === 'processed') {
          setManualStatus(`Already saved: ${uid}`);
          return;
        }
        if (res.reason === 'queued') {
          setManualStatus(`Already queued: ${uid}`);
          return;
        }
        if (res.enqueued) {
          setManualUid('');
          setBatchStatus(`Queued ${uid}`);
          await drainBatchQueue(selectedProductId);
          setManualStatus(`Queued: ${uid}`);
        }
        return;
      }

      await linkUidToProduct({ uid, productId: selectedProductId });
      setManualUid('');
      setManualStatus(`Linked: ${uid}`);
    } catch (err) {
      const msg = err?.message ? String(err.message) : 'Failed to link UID';
      setManualError(msg);
    } finally {
      setManualBusy(false);
    }
  };

  const toggleManualUid = () => {
    setManualError('');
    setManualStatus('');
    setManualUid('');
    setShowManualUid((s) => !s);
  };

  useEffect(() => {
    if (!batchMode) return;
    if (!selectedProductId) return;

    const uid = String(lastScannedUid || '').trim();
    if (!uid) return;

    // Only run on actual scan events, not on product selection changes.
    // (scanSeq increments inside the scan listener)
    const res = enqueueBatchUid(uid);
    if (res.reason === 'processed') {
      setBatchStatus(`Already processed: ${uid}`);
      return;
    }
    if (res.enqueued) setBatchStatus(`Queued ${uid}`);
    drainBatchQueue(selectedProductId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scanSeq]);

  if (loading) {
    return (
      <Box sx={{ p: 6, textAlign: 'center' }}>
        <CircularProgress />
      </Box>
    );
  }

  if (error && !loading) {
    return (
      <Box sx={{ p: 6 }}>
        <Alert severity="error">Error: {error}</Alert>
      </Box>
    );
  }

  return (
    <Box sx={{ p: 2 }}>
      <PageHeader
        title="Tag UID Link"
      />

      <SectionCard
        title="Link Tag to Product"
      >

        <Box sx={{ mb: 2 }}>
          {/* Compact scan status (blue info box) */}
          <Alert
            severity="info"
            sx={{
              mb: 1.25,
              py: 0.5,
              '& .MuiAlert-message': { width: '100%' },
            }}
          >
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1, flexWrap: 'wrap' }}>
              <Typography variant="body2" color="text.secondary">
                Last UID{' '}
                <Box component="span" sx={{ fontFamily: 'monospace', color: 'text.primary', fontWeight: 700 }}>
                  {lastScannedUid || '—'}
                </Box>
              </Typography>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                {!rtdbConnected ? (
                  <Typography variant="caption" color="error">
                    RFID disconnected
                  </Typography>
                ) : null}
                <Button size="small" variant="outlined" onClick={clearClipboard}>
                  Clear
                </Button>
              </Box>
            </Box>
          </Alert>

          {scanError ? (
            <Alert severity="error" sx={{ mb: 1.25 }}>
              {scanError}
            </Alert>
          ) : null}

          <FormControlLabel
            control={
              <Checkbox
                checked={batchMode}
                onChange={(e) => onToggleBatchMode(e.target.checked)}
                disabled={!selectedProductId}
              />
            }
            label="Batch Mode"
          />
          {batchMode ? (
            <Typography variant="h4" sx={{ fontWeight: 900, mt: 0.5 }}>
              Stock Added: {batchCount}
            </Typography>
          ) : null}
          {batchMode && selectedProduct ? (
            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.25 }}>
              Locked Product: <strong>{selectedProduct.name}</strong>
            </Typography>
          ) : null}
          {batchMode ? (
            <Box sx={{ mt: 1, display: 'flex', justifyContent: 'flex-end' }}>
              <Button variant="outlined" onClick={() => onToggleBatchMode(false)}>
                Done
              </Button>
            </Box>
          ) : null}
          {batchError ? (
            <Alert severity="error" sx={{ mt: 1 }}>
              {batchError}
            </Alert>
          ) : null}
          {batchMode && batchStatus ? (
            <Alert severity="success" sx={{ mt: 1 }}>
              {batchStatus}
            </Alert>
          ) : null}
        </Box>

        <Grid container spacing={1.5} alignItems="center">
          <Grid item xs={12} md={4}>
            <TextField
              label="Search product"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              disabled={batchMode}
              fullWidth
              placeholder="Search by name/category..."
            />
          </Grid>

          <Grid item xs={12} md={5}>
            <FormControl fullWidth>
              <InputLabel id="link-product-label">Select Product</InputLabel>
              <Select
                labelId="link-product-label"
                label="Select Product"
                value={selectedProductId}
                onChange={(e) => setSelectedProductId(e.target.value)}
                disabled={batchMode}
              >
                <MenuItem value="">-- Choose Product --</MenuItem>
                {filteredProducts.map((p) => (
                  <MenuItem key={p.id} value={p.id}>
                    {p.name} (RM {Number(p.price || 0).toFixed(2)})
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
          </Grid>

          <Grid item xs={12} md={3}>
            <Box sx={{ display: 'flex', gap: 1 }}>
              <Button
                variant="contained"
                color="success"
                onClick={linkTagToProduct}
                disabled={batchMode || linkBusy || !lastScannedUid || !selectedProductId}
                sx={{ flex: 1, minHeight: 40 }}
              >
                {linkBusy ? 'Linking...' : 'Link Tag'}
              </Button>
              <Button
                variant="outlined"
                onClick={toggleManualUid}
                disabled={manualBusy}
                sx={{ flex: 1, minHeight: 40 }}
              >
                {showManualUid ? 'Hide Manual' : 'Manual'}
              </Button>
            </Box>
          </Grid>

          {showManualUid ? (
            <>
              <Grid item xs={12} md={9}>
                <TextField
                  label="Manual UID"
                  value={manualUid}
                  onChange={(e) => {
                    setManualUid(e.target.value);
                    if (manualError) setManualError('');
                    if (manualStatus) setManualStatus('');
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') linkManualUid();
                  }}
                  disabled={manualBusy}
                  fullWidth
                  placeholder="Type UID here (e.g., E200...)"
                  error={Boolean(manualError)}
                  helperText={manualError || 'You can type a UID and link it without scanning.'}
                />
              </Grid>

              <Grid item xs={12} md={3}>
                <Button
                  variant="outlined"
                  fullWidth
                  onClick={linkManualUid}
                  disabled={manualBusy || !selectedProductId || !String(manualUid || '').trim()}
                  sx={{ minHeight: 40 }}
                >
                  {manualBusy ? 'Linking...' : (batchMode ? 'Add UID' : 'Link UID')}
                </Button>
              </Grid>
            </>
          ) : null}

          <Grid item xs={12}>
            <Typography variant="caption" color="text.secondary">
              {lastScannedAt ? `Last scan: ${Math.max(0, Math.floor((Date.now() - lastScannedAt) / 1000))}s ago` : ''}
            </Typography>
            {showManualUid && manualStatus ? (
              <Typography variant="caption" sx={{ display: 'block', mt: 0.25, color: 'success.main', fontWeight: 700 }}>
                {manualStatus}
              </Typography>
            ) : null}
          </Grid>

          {selectedProduct && (
            <Grid item xs={12}>
              <Box sx={{ p: 2, borderRadius: 2, border: '1px solid', borderColor: 'divider', display: 'flex', alignItems: 'center', gap: 2 }}>
                {selectedProduct.image_url ? (
                  <Box
                    component="img"
                    src={selectedProduct.image_url}
                    alt={selectedProduct.name}
                    sx={{ width: 56, height: 56, objectFit: 'cover', borderRadius: 1, border: '1px solid', borderColor: 'divider' }}
                  />
                ) : (
                  <Box sx={{ width: 56, height: 56, borderRadius: 1, border: '1px dashed', borderColor: 'divider' }} />
                )}
                <Box>
                  <Typography sx={{ fontWeight: 600 }}>{selectedProduct.name}</Typography>
                  <Typography variant="body2" color="text.secondary">
                    RM {Number(selectedProduct.price || 0).toFixed(2)}
                  </Typography>
                  {selectedProduct.category ? (
                    <Typography variant="body2" color="text.secondary">
                      {selectedProduct.category}
                    </Typography>
                  ) : null}
                </Box>
              </Box>
            </Grid>
          )}
        </Grid>
      </SectionCard>
    </Box>
  );
};

export default TagUidLink;
