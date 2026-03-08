import React, { useEffect, useState } from 'react';
import { db } from '../firebaseConfig';
import PageHeader from '../components/ui/PageHeader';
import SectionCard from '../components/ui/SectionCard';
import { collection, getDocs, doc, query, orderBy } from 'firebase/firestore';
import {
  Box,
  Typography,
  CircularProgress,
  Table,
  TableHead,
  TableRow,
  TableCell,
  TableBody,
  Button,
  Alert,
} from '@mui/material';

const TaggingBatches = () => {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [batches, setBatches] = useState([]);
  const [selectedBatch, setSelectedBatch] = useState(null);
  const [uids, setUids] = useState([]);
  const [loadingUids, setLoadingUids] = useState(false);

  const fetchBatches = async () => {
    setLoading(true);
    setError('');
    try {
      const col = collection(db, 'tagging_batches');
      const q = query(col, orderBy('createdAt', 'desc'));
      const snap = await getDocs(q);
      const list = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      setBatches(list);
    } catch (e) {
      console.error('Failed to load tagging batches', e);
      setError(e?.message || 'Failed to load batches');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchBatches();
  }, []);

  const openBatch = async (batch) => {
    setSelectedBatch(batch);
    setUids([]);
    setLoadingUids(true);
    try {
      const ucol = collection(db, 'tagging_batches', batch.id, 'uids');
      const q = query(ucol, orderBy('processedAt', 'asc'));
      const snap = await getDocs(q);
      const list = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      setUids(list);
    } catch (e) {
      console.error('Failed to load batch uids', e);
      setUids([]);
    } finally {
      setLoadingUids(false);
    }
  };

  const exportBatchCsv = (batchId, rows) => {
    if (!rows || rows.length === 0) return;
    const cols = ['uid', 'prevProductId', 'newProductId', 'addedStock', 'status', 'error', 'processedAt'];
    const lines = [cols.join(',')];
    for (const r of rows) {
      const vals = cols.map((c) => {
        let v = r[c];
        if (c === 'processedAt' && v && v.toDate) {
          v = v.toDate().toISOString();
        }
        if (v === undefined || v === null) v = '';
        return String(v).replace(/\n/g, ' ').replace(/\r/g, '');
      });
      lines.push(vals.join(','));
    }
    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `tagging_batch_${batchId || 'export'}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <Box sx={{ p: 2 }}>
      <PageHeader title="Tagging Batches" />

      <SectionCard title="Batches">
        {loading ? (
          <Box sx={{ p: 6, textAlign: 'center' }}>
            <CircularProgress />
          </Box>
        ) : error ? (
          <Alert severity="error">{error}</Alert>
        ) : (
          <>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Batch ID</TableCell>
                  <TableCell>Product</TableCell>
                  <TableCell>Created</TableCell>
                  <TableCell>Status</TableCell>
                  <TableCell>Action</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {batches.map((b) => (
                  <TableRow key={b.id} hover>
                    <TableCell>{b.id}</TableCell>
                    <TableCell>{b.productId || '—'}</TableCell>
                    <TableCell>{b.createdAt && b.createdAt.toDate ? b.createdAt.toDate().toLocaleString() : '—'}</TableCell>
                    <TableCell>{b.status || '—'}</TableCell>
                    <TableCell>
                      <Button size="small" onClick={() => openBatch(b)}>View</Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>

            {selectedBatch ? (
              <Box sx={{ mt: 2 }}>
                <Typography variant="h6">Batch: {selectedBatch.id}</Typography>
                <Typography variant="body2" color="text.secondary">Product: {selectedBatch.productId || '—'}</Typography>
                <Box sx={{ mt: 1, display: 'flex', gap: 1 }}>
                  <Button size="small" onClick={() => exportBatchCsv(selectedBatch.id, uids)} disabled={uids.length === 0}>Export CSV</Button>
                  <Button size="small" onClick={() => { setSelectedBatch(null); setUids([]); }}>Close</Button>
                </Box>

                <Box sx={{ mt: 1 }}>
                  {loadingUids ? (
                    <CircularProgress size={18} />
                  ) : uids.length === 0 ? (
                    <Typography variant="body2" sx={{ mt: 1 }}>No UIDs recorded for this batch.</Typography>
                  ) : (
                    <Table size="small">
                      <TableHead>
                        <TableRow>
                          <TableCell>UID</TableCell>
                          <TableCell>Prev Product</TableCell>
                          <TableCell>New Product</TableCell>
                          <TableCell>Added Stock</TableCell>
                          <TableCell>Status</TableCell>
                          <TableCell>Processed At</TableCell>
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {uids.map((u) => (
                          <TableRow key={u.id}>
                            <TableCell sx={{ fontFamily: 'monospace' }}>{u.uid}</TableCell>
                            <TableCell>{u.prevProductId || '—'}</TableCell>
                            <TableCell>{u.newProductId || '—'}</TableCell>
                            <TableCell>{u.addedStock ? 'Yes' : 'No'}</TableCell>
                            <TableCell>{u.status || '—'}</TableCell>
                            <TableCell>{u.processedAt && u.processedAt.toDate ? u.processedAt.toDate().toLocaleString() : '—'}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  )}
                </Box>
              </Box>
            ) : null}
          </>
        )}
      </SectionCard>
    </Box>
  );
};

export default TaggingBatches;
