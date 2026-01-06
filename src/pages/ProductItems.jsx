import React, { useEffect, useMemo, useState } from 'react';
import { db, rtdb } from '../firebaseConfig';
import PageHeader from '../components/ui/PageHeader';
import SectionCard from '../components/ui/SectionCard';
import { collection, getDocs, doc, runTransaction, serverTimestamp } from 'firebase/firestore';
import { ref as rtdbRef, onValue, set as rtdbSet } from 'firebase/database';
import {
  Box,
  Typography,
  Grid,
  TextField,
  CircularProgress,
  Alert,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Button,
} from '@mui/material';

const ProductItems = () => {
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [tagsMap, setTagsMap] = useState({}); // { uid: productId }
  const [rtdbConnected, setRtdbConnected] = useState(true);

  const [categorySearch, setCategorySearch] = useState('');
  const [productSearch, setProductSearch] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('');
  const [selectedProductId, setSelectedProductId] = useState('');
  const [unlinkBusyUid, setUnlinkBusyUid] = useState('');

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const snap = await getDocs(collection(db, 'products'));
        const list = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        list.sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));
        setProducts(list);
      } catch (err) {
        console.error('Failed to load products', err);
        setError('Failed to load products.');
      } finally {
        setLoading(false);
      }
    };

    load();
  }, []);

  useEffect(() => {
    const connRef = rtdbRef(rtdb, '.info/connected');
    const unsubConn = onValue(connRef, (snap) => setRtdbConnected(Boolean(snap.val())));

    const tagsRef = rtdbRef(rtdb, 'tags');
    const unsubTags = onValue(tagsRef, (snap) => {
      const val = snap.val();
      setTagsMap(val && typeof val === 'object' ? val : {});
    });

    return () => {
      try {
        unsubConn();
      } catch {
        // ignore
      }
      try {
        unsubTags();
      } catch {
        // ignore
      }
    };
  }, []);

  const categories = useMemo(() => {
    const map = new Map();
    for (const p of products) {
      const raw = String(p?.category || '').trim();
      const category = raw || 'Uncategorized';
      if (!map.has(category)) {
        map.set(category, { name: category, count: 0, image_url: '' });
      }
      const rec = map.get(category);
      rec.count += 1;
      if (!rec.image_url && p?.image_url) rec.image_url = String(p.image_url);
    }
    const list = Array.from(map.values());
    list.sort((a, b) => a.name.localeCompare(b.name));
    return list;
  }, [products]);

  const filteredCategories = useMemo(() => {
    const q = categorySearch.trim().toLowerCase();
    if (!q) return categories;
    return categories.filter((c) => String(c.name || '').toLowerCase().includes(q));
  }, [categories, categorySearch]);

  const productsInSelectedCategory = useMemo(() => {
    const cat = String(selectedCategory || '').trim();
    const q = productSearch.trim().toLowerCase();

    const list = products.filter((p) => {
      const pcat = String(p?.category || '').trim() || 'Uncategorized';
      if (cat && pcat !== cat) return false;
      if (!q) return true;
      const name = String(p.name || '').toLowerCase();
      const id = String(p.id || '').toLowerCase();
      return name.includes(q) || id.includes(q);
    });

    list.sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));
    return list;
  }, [products, selectedCategory, productSearch]);

  const selectedProduct = useMemo(
    () => products.find((p) => p.id === selectedProductId) || null,
    [products, selectedProductId]
  );

  useEffect(() => {
    // When switching categories, clear selection.
    setSelectedProductId('');
  }, [selectedCategory]);

  const uidsForSelected = useMemo(() => {
    const pid = String(selectedProductId || '');
    if (!pid) return [];

    const uids = [];
    for (const [uid, productId] of Object.entries(tagsMap || {})) {
      if (String(productId) === pid) uids.push(uid);
    }
    uids.sort();
    return uids;
  }, [tagsMap, selectedProductId]);

  const unlinkUid = async (uid) => {
    if (!uid) return;
    const ok = window.confirm(`Unlink UID ${uid} from this product?`);
    if (!ok) return;

    const currentLinkedProductId = String(tagsMap?.[uid] || '');
    if (!currentLinkedProductId) return;

    setUnlinkBusyUid(uid);
    try {
      await rtdbSet(rtdbRef(rtdb, `tags/${uid}`), null);

      // Decrement inventory for the product this UID was linked to.
      const pid = String(currentLinkedProductId || '').trim();
      if (pid) {
        await runTransaction(db, async (t) => {
          const invRef = doc(db, 'inventory', pid);
          const invSnap = await t.get(invRef);
          const current = invSnap.exists() ? Number(invSnap.data()?.stockLevel ?? 0) || 0 : 0;
          const next = Math.max(0, current - 1);
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
      }
    } catch (err) {
      console.error('Failed to unlink UID', err);
      alert('Failed to unlink UID.');
    } finally {
      setUnlinkBusyUid('');
    }
  };

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
    <Box sx={{ p: 3 }}>
      <PageHeader
        title="Product Items"
        subtitle="View how many UID tags are linked to each product (same product can have many UID tags)."
      />

      <SectionCard title="UID Tag Links (Realtime Database)" sx={{ mb: 3 }}>
        <Alert severity={rtdbConnected ? 'info' : 'error'} sx={{ mb: 2 }}>
          {rtdbConnected ? 'Connected to Realtime Database.' : 'Not connected to Realtime Database.'}
          <Box component="span" sx={{ display: 'block', mt: 0.5, fontSize: 12, opacity: 0.85 }}>
            Source: <strong>tags/&lt;UID&gt; = productId</strong>
          </Box>
        </Alert>

        {!selectedCategory ? (
          <Box>
            <Box sx={{ display: 'flex', gap: 1.5, alignItems: 'center', flexWrap: 'wrap', mb: 2 }}>
              <TextField
                label="Search category"
                value={categorySearch}
                onChange={(e) => setCategorySearch(e.target.value)}
                fullWidth
                placeholder="Search categories..."
                sx={{ maxWidth: 420 }}
              />
              <Typography variant="body2" color="text.secondary">
                Choose a category first, then browse products.
              </Typography>
            </Box>

            <Grid container spacing={2}>
              {filteredCategories.map((c) => (
                <Grid item xs={12} sm={6} md={4} lg={3} key={c.name}>
                  <Box
                    role="button"
                    tabIndex={0}
                    onClick={() => setSelectedCategory(c.name)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') setSelectedCategory(c.name);
                    }}
                    sx={{
                      border: '1px solid',
                      borderColor: 'divider',
                      borderRadius: 2,
                      p: 1.5,
                      bgcolor: 'background.paper',
                      cursor: 'pointer',
                      height: '100%',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 1.25,
                      '&:hover': { bgcolor: 'action.hover' },
                      outline: 'none',
                    }}
                  >
                    {c.image_url ? (
                      <Box
                        component="img"
                        src={c.image_url}
                        alt={c.name}
                        sx={{ width: 44, height: 44, borderRadius: 1, objectFit: 'cover', border: '1px solid', borderColor: 'divider' }}
                      />
                    ) : (
                      <Box sx={{ width: 44, height: 44, borderRadius: 1, border: '1px dashed', borderColor: 'divider' }} />
                    )}

                    <Box sx={{ minWidth: 0 }}>
                      <Typography sx={{ fontWeight: 800 }} noWrap>
                        {c.name}
                      </Typography>
                      <Typography variant="caption" color="text.secondary" noWrap>
                        {c.count} product(s)
                      </Typography>
                    </Box>
                  </Box>
                </Grid>
              ))}
            </Grid>
          </Box>
        ) : (
          <Box>
            <Box sx={{ display: 'flex', gap: 1.5, alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', mb: 2 }}>
              <Box>
                <Typography sx={{ fontWeight: 800 }}>Category: {selectedCategory}</Typography>
                <Typography variant="body2" color="text.secondary">
                  Select a product to view its linked UID tags.
                </Typography>
              </Box>

              <Button
                variant="outlined"
                onClick={() => {
                  setSelectedCategory('');
                  setCategorySearch('');
                  setProductSearch('');
                }}
              >
                Back to categories
              </Button>
            </Box>

            <Grid container spacing={2} alignItems="center" sx={{ mb: 1.5 }}>
              <Grid item xs={12} md={6}>
                <TextField
                  label="Search product"
                  value={productSearch}
                  onChange={(e) => setProductSearch(e.target.value)}
                  fullWidth
                  placeholder="Search by name or product id..."
                />
              </Grid>
            </Grid>

            <TableContainer>
              <Table size="small" sx={{
                '& .MuiTableCell-root': { py: 0.85, px: 1.25, fontSize: 12, lineHeight: 1.25 },
                '& .MuiTableCell-head': { py: 1, fontSize: 12 },
              }}>
                <TableHead
                  sx={{
                    backgroundColor: (theme) =>
                      theme.palette.mode === 'dark' ? theme.palette.background.paper : theme.palette.grey[50],
                    '& th': { color: (theme) => theme.palette.text.primary },
                  }}
                >
                  <TableRow>
                    <TableCell sx={{ fontWeight: 700 }}>Image</TableCell>
                    <TableCell sx={{ fontWeight: 700 }}>Name</TableCell>
                    <TableCell sx={{ fontWeight: 700 }}>Product ID</TableCell>
                    <TableCell sx={{ fontWeight: 700, textAlign: 'right' }}>Price</TableCell>
                    <TableCell sx={{ fontWeight: 700, textAlign: 'right' }}>Action</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {productsInSelectedCategory.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={5} sx={{ py: 4, textAlign: 'center' }}>
                        No products found in this category.
                      </TableCell>
                    </TableRow>
                  ) : (
                    productsInSelectedCategory.map((p) => (
                      <TableRow key={p.id} hover>
                        <TableCell>
                          {p.image_url ? (
                            <Box
                              component="img"
                              src={p.image_url}
                              alt={p.name}
                              sx={{ width: 36, height: 36, objectFit: 'cover', borderRadius: 1, border: '1px solid', borderColor: 'divider' }}
                            />
                          ) : (
                            <Box sx={{ width: 36, height: 36, borderRadius: 1, border: '1px dashed', borderColor: 'divider' }} />
                          )}
                        </TableCell>
                        <TableCell sx={{ maxWidth: 420 }}>
                          <Typography sx={{ fontWeight: 700 }} noWrap>
                            {p.name || '—'}
                          </Typography>
                        </TableCell>
                        <TableCell sx={{ fontFamily: 'monospace', whiteSpace: 'nowrap' }}>{p.id}</TableCell>
                        <TableCell sx={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                          RM {Number(p.price || 0).toFixed(2)}
                        </TableCell>
                        <TableCell sx={{ textAlign: 'right' }}>
                          <Button
                            variant="contained"
                            size="small"
                            onClick={() => setSelectedProductId(p.id)}
                            sx={{ minWidth: 0, px: 1.25 }}
                          >
                            View UIDs
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </TableContainer>
          </Box>
        )}

        {selectedProduct ? (
          <Box sx={{ mt: 2, display: 'flex', gap: 2, alignItems: 'center' }}>
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
            <Box sx={{ minWidth: 0 }}>
              <Typography sx={{ fontWeight: 700 }} noWrap>
                {selectedProduct.name}
              </Typography>
              <Typography variant="body2" color="text.secondary" noWrap>
                {selectedProduct.category ? `${selectedProduct.category} • ` : ''}UIDs linked: {uidsForSelected.length}
              </Typography>
            </Box>
          </Box>
        ) : null}
      </SectionCard>

      <SectionCard
        title={selectedProduct ? `UID Tags for ${selectedProduct.name}` : 'UID Tags'}
        subtitle={
          selectedProduct
            ? 'These are the UID tags (stickers) linked to the selected product.'
            : 'Select a product above to view linked UID tags.'
        }
      >
        {!selectedProduct ? (
          <Alert severity="info">Choose a product to view its linked UID tags.</Alert>
        ) : (
          <TableContainer>
            <Table size="small" sx={{
              '& .MuiTableCell-root': { py: 0.75, px: 1, fontSize: 12, lineHeight: 1.25 },
              '& .MuiTableCell-head': { py: 1, fontSize: 12 },
            }}>
              <TableHead
                sx={{
                  backgroundColor: (theme) =>
                    theme.palette.mode === 'dark' ? theme.palette.background.paper : theme.palette.grey[50],
                  '& th': { color: (theme) => theme.palette.text.primary },
                }}
              >
                <TableRow>
                  <TableCell sx={{ fontWeight: 700 }}>UID</TableCell>
                  <TableCell sx={{ fontWeight: 700 }}>Linked Product ID</TableCell>
                  <TableCell sx={{ fontWeight: 700, textAlign: 'right' }}>Actions</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {uidsForSelected.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={3} sx={{ py: 4, textAlign: 'center' }}>
                      No UID tags linked yet. Use Tag UID Link to link tags.
                    </TableCell>
                  </TableRow>
                ) : (
                  uidsForSelected.map((uid) => (
                    <TableRow key={uid} hover>
                      <TableCell sx={{ fontFamily: 'monospace', whiteSpace: 'nowrap' }}>{uid}</TableCell>
                      <TableCell sx={{ fontFamily: 'monospace', whiteSpace: 'nowrap' }}>{selectedProductId}</TableCell>
                      <TableCell align="right">
                        <Button
                          color="error"
                          variant="outlined"
                          size="small"
                          onClick={() => unlinkUid(uid)}
                          disabled={unlinkBusyUid === uid}
                          sx={{ minWidth: 0, px: 1 }}
                        >
                          {unlinkBusyUid === uid ? 'Unlinking…' : 'Unlink'}
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </TableContainer>
        )}
      </SectionCard>
    </Box>
  );
};

export default ProductItems;
