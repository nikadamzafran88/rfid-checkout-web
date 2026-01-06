import React, { useState, useEffect } from 'react';
import { db } from '../firebaseConfig';
import PageHeader from '../components/ui/PageHeader';
import SectionCard from '../components/ui/SectionCard';
import {
    collection,
    getDocs,
    onSnapshot,
    doc,
    writeBatch,
} from 'firebase/firestore';
import { Package } from 'lucide-react';
import { useTheme } from '@mui/material/styles';
import {
    Box,
    Typography,
    Button,
    Table,
    TableBody,
    TableCell,
    TableContainer,
    TableHead,
    TableRow,
    TextField,
    Alert,
} from '@mui/material';
import { useAuth } from '../context/AuthContext.jsx';
import { logAction } from '../utils/logAction';

const InventoryManagement = () => {
    const theme = useTheme();
    const { currentUser, currentRole } = useAuth();
    const [inventoryList, setInventoryList] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [stockUpdates, setStockUpdates] = useState({}); // Stores temporary stock edits

    const productsCollectionRef = collection(db, 'products');
    const inventoryCollectionRef = collection(db, 'inventory');

    const resolveInventoryProductId = (invData, invDocId) => {
        const raw = invData?.productID ?? invData?.productId ?? invData?.productRef ?? invData?.product ?? null;
        if (!raw) return '';
        if (typeof raw === 'string') return raw;
        // DocumentReference-like shape
        if (typeof raw === 'object') {
            if (typeof raw.id === 'string') return raw.id;
            if (typeof raw.path === 'string') {
                const parts = raw.path.split('/').filter(Boolean);
                return parts[parts.length - 1] || '';
            }
        }
        console.warn('Unrecognized inventory product reference', { invDocId, raw });
        return '';
    };

    const scoreInventoryRecord = (rec, productId) => {
        if (!rec) return 0;
        const pid = String(productId || '');
        let s = 0;
        if (String(rec.inventoryDocId || '') === pid) s = Math.max(s, 300);
        if (typeof rec.productID === 'string' && rec.productID === pid) s = Math.max(s, 220);
        if (typeof rec.productId === 'string' && rec.productId === pid) s = Math.max(s, 210);

        const refFields = [rec.productID, rec.productRef, rec.product];
        for (const rf of refFields) {
            if (rf && typeof rf === 'object') {
                if (typeof rf.id === 'string' && rf.id === pid) s = Math.max(s, 120);
                if (typeof rf.path === 'string' && rf.path.endsWith(`/products/${pid}`)) s = Math.max(s, 120);
            }
        }
        return s;
    };

    const pickBetterInventoryRecord = (prev, next, productId) => {
        if (!prev) return next;
        const sp = scoreInventoryRecord(prev, productId);
        const sn = scoreInventoryRecord(next, productId);
        if (sn !== sp) return sn > sp ? next : prev;

        const ap = String(prev.inventoryDocId || '');
        const an = String(next.inventoryDocId || '');
        return an.localeCompare(ap) < 0 ? next : prev;
    };

    // 1. Subscribe & Merge Data from Products and Inventory collections
    useEffect(() => {
        setLoading(true);
        setError(null);

        let productsMap = new Map();
        let inventoryByProductId = new Map();

        const recompute = () => {
            const mergedList = [];
            productsMap.forEach((product) => {
                const inv = inventoryByProductId.get(product.id) || null;
                const currentStock = inv ? Number(inv.stockLevel ?? 0) || 0 : 0;
                mergedList.push({
                    ...product,
                    inventoryDocId: inv ? inv.inventoryDocId : null,
                    stockLevel: currentStock,
                });
            });
            setInventoryList(mergedList);
            setLoading(false);
        };

        const unsubProducts = onSnapshot(
            productsCollectionRef,
            (snap) => {
                const next = new Map();
                snap.docs.forEach((d) => {
                    next.set(d.id, { id: d.id, ...d.data() });
                });
                productsMap = next;
                recompute();
            },
            (err) => {
                console.error('Products subscription error:', err);
                setError('Failed to load products.');
                setLoading(false);
            }
        );

        const unsubInventory = onSnapshot(
            inventoryCollectionRef,
            (snap) => {
                const next = new Map();
                snap.docs.forEach((d) => {
                    const data = d.data() || {};
                    const pid = resolveInventoryProductId(data, d.id);
                    if (!pid) return;

                    const rec = { inventoryDocId: d.id, ...data };
                    const prev = next.get(pid);
                    next.set(pid, pickBetterInventoryRecord(prev, rec, pid));
                });
                inventoryByProductId = next;
                recompute();
            },
            (err) => {
                console.error('Inventory subscription error:', err);
                setError('Failed to load inventory.');
                setLoading(false);
            }
        );

        return () => {
            try { unsubProducts(); } catch { /* ignore */ }
            try { unsubInventory(); } catch { /* ignore */ }
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // 2. Handle Local Stock Changes
    const handleStockChange = (productId, newStock) => {
        setStockUpdates(prev => ({
            ...prev,
            [productId]: newStock
        }));
    };
    
    // 3. Handle Batch Update to Firestore
    const handleSaveUpdates = async () => {
        if (Object.keys(stockUpdates).length === 0) return alert("No changes to save.");

        setLoading(true);
        const batch = writeBatch(db);
        let updatesCount = 0;

        try {
            const affected = [];
            for (const productId in stockUpdates) {
                const newStock = parseInt(stockUpdates[productId], 10);
                if (isNaN(newStock) || newStock < 0) continue; 

                const item = inventoryList.find(i => i.id === productId);

                if (item && item.inventoryDocId) {
                    // UPDATE existing inventory document
                    const invRef = doc(db, 'inventory', item.inventoryDocId);
                    batch.update(invRef, { 
                        stockLevel: newStock,
                        lastUpdated: new Date().toISOString()
                    });
                    updatesCount++;
                    affected.push({ productId, stockLevel: newStock, action: 'update' });
                } else if (item) {
                    // CREATE new inventory document (if one was missing)
                    const newInvRef = doc(db, 'inventory', productId);
                    batch.set(newInvRef, {
                        productID: productId,
                        stockLevel: newStock,
                        lastUpdated: new Date().toISOString()
                    }, { merge: true });
                    updatesCount++;
                    affected.push({ productId, stockLevel: newStock, action: 'create' });
                }
            }

            await batch.commit();
            setStockUpdates({}); // Clear temporary changes
            await logAction(db, {
                type: 'inventory_batch_update',
                source: 'InventoryManagement',
                actorUID: currentUser?.uid || null,
                actorRole: currentRole || null,
                message: `Inventory updated for ${updatesCount} product(s)`,
                metadata: { updatesCount, affected: affected.slice(0, 50) },
            });
            alert(`${updatesCount} product stock levels updated successfully.`);

        } catch (err) {
            console.error("Error saving batch updates:", err);
            setError("Failed to save stock updates.");
            setLoading(false);
        }
    };


    // -------------------- RENDER LOGIC --------------------

    const hasPendingUpdates = Object.keys(stockUpdates).length > 0;
    const lowStockCount = inventoryList.filter(item => item.stockLevel < 5).length;

    if (loading)
        return (
            <Box sx={{ p: 6, textAlign: 'center' }}>
                <Typography variant="h6" color="text.secondary">Loading Inventory Data...</Typography>
            </Box>
        );

    if (error && !loading)
        return (
            <Box sx={{ p: 6 }}>
                <Alert severity="error">{error}</Alert>
            </Box>
        );

    return (
        <Box sx={{ p: 3 }}>
            <PageHeader title="Inventory" subtitle="Update stock levels for products. Changes are saved in a single batch update." />

            <Alert
                severity={lowStockCount > 0 ? 'warning' : 'success'}
                icon={<Package size={18} />}
                sx={{ mb: 3, border: '1px solid', borderColor: lowStockCount > 0 ? theme.palette.warning.main : theme.palette.success.main }}
            >
                <Typography sx={{ fontWeight: 700 }}>
                    {lowStockCount > 0
                        ? `${lowStockCount} items are currently at critically low stock (below 5).`
                        : 'Stock levels are healthy across all products.'}
                </Typography>
            </Alert>

            <SectionCard
                title="Product Stock Levels"
                actions={
                    <Button variant="contained" color="primary" onClick={handleSaveUpdates} disabled={!hasPendingUpdates || loading}>
                        {loading ? 'Saving...' : `Save ${Object.keys(stockUpdates).length} Pending Updates`}
                    </Button>
                }
            >

                <TableContainer>
                    <Table>
                        <TableHead
                            sx={{
                                backgroundColor: theme.palette.mode === 'dark' ? theme.palette.background.paper : theme.palette.grey[50],
                                '& th': { color: theme.palette.text.primary },
                            }}
                        >
                            <TableRow>
                                <TableCell sx={{ fontWeight: 600 }}>Product Name</TableCell>
                                <TableCell sx={{ fontWeight: 600 }}>Category</TableCell>
                                <TableCell sx={{ fontWeight: 600 }}>Current Stock</TableCell>
                                <TableCell sx={{ fontWeight: 600 }}>Set New Stock</TableCell>
                            </TableRow>
                        </TableHead>

                        <TableBody>
                            {inventoryList.map((item) => (
                                <TableRow key={item.id} sx={item.stockLevel < 5 ? { bgcolor: 'error.50' } : { '&:hover': { bgcolor: 'grey.50' } }}>
                                    <TableCell sx={{ fontWeight: 700 }}>{item.name}</TableCell>
                                    <TableCell>{item.category}</TableCell>
                                    <TableCell>
                                        <Typography sx={{ fontWeight: 700, color: item.stockLevel < 5 ? 'error.main' : 'text.primary' }}>{item.stockLevel}</Typography>
                                    </TableCell>
                                    <TableCell>
                                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                                            <TextField type="number" size="small" defaultValue={item.stockLevel} inputProps={{ min: 0 }} onChange={(e) => handleStockChange(item.id, e.target.value)} sx={{ width: 120 }} />
                                            {stockUpdates[item.id] !== undefined && <Typography variant="caption" color="primary">Update Pending</Typography>}
                                        </Box>
                                    </TableCell>
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                </TableContainer>
            </SectionCard>
        </Box>
    );
};

export default InventoryManagement;