import React, { useEffect, useMemo, useRef, useState } from 'react';
import { db, storage } from '../firebaseConfig';
import PageHeader from '../components/ui/PageHeader';
import SectionCard from '../components/ui/SectionCard';
import { useAuth } from '../context/AuthContext.jsx';
import { logAction } from '../utils/logAction';
import {
  collection,
  addDoc,
  getDocs,
  doc,
  updateDoc,
  deleteDoc,
  setDoc,
  serverTimestamp,
} from 'firebase/firestore';
import { getDownloadURL, ref as storageRef, uploadBytesResumable } from 'firebase/storage';
import {
  Box,
  Typography,
  Grid,
  TextField,
  Button,
  CircularProgress,
  Alert,
  LinearProgress,
  Chip,
  TableContainer,
  Table,
  TableHead,
  TableRow,
  TableCell,
  TableBody,
  IconButton,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
} from '@mui/material';
import MenuItem from '@mui/material/MenuItem';
import { Edit, Trash2, Upload } from 'lucide-react';

const CATEGORIES = [
  'T-Shirts',
  'Shirts',
  'Blouses',
  'Knitwear',
  'Hoodies & Sweatshirts',
  'Jackets',
  'Coats',
  'Pants',
  'Jeans',
  'Shorts',
  'Skirts',
  'Dresses',
  'Jumpsuits',
  'Activewear',
  'Innerwear',
  'Sleepwear',
  'Socks',
  'Shoes',
  'Accessories',
  'Bags',
  'Hats & Caps',
];

const GENDER_OPTIONS = ['Unisex', 'Men', 'Women', 'Kids'];

const COLOR_OPTIONS = [
  'Black',
  'White',
  'Grey',
  'Red',
  'Blue',
  'Green',
  'Yellow',
  'Orange',
  'Purple',
  'Pink',
  'Brown',
  'Beige',
  'Navy',
  'Maroon',
];

const ProductMaster = () => {
  const { currentUser, currentRole } = useAuth();
  const [products, setProducts] = useState([]);
  const [selectedCategory, setSelectedCategory] = useState('');
  const [categorySearch, setCategorySearch] = useState('');
  const [productSearch, setProductSearch] = useState('');
  const [newProduct, setNewProduct] = useState({
    name: '',
    brand: '',
    gender: 'Unisex',
    color: '',
    price: 0,
    cost: '',
    category: '',
    image_url: '',
  });
  const [newImageFile, setNewImageFile] = useState(null);
  const [uploadingNewImage, setUploadingNewImage] = useState(false);
  const [newUploadProgress, setNewUploadProgress] = useState(0);
  const [newUploadDetail, setNewUploadDetail] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState(null);
  const [editImageFile, setEditImageFile] = useState(null);
  const [uploadingEditImage, setUploadingEditImage] = useState(false);
  const [editUploadProgress, setEditUploadProgress] = useState(0);
  const [editUploadDetail, setEditUploadDetail] = useState(null);
  const newFileInputRef = useRef(null);
  const editFileInputRef = useRef(null);

  const [newImagePreviewUrl, setNewImagePreviewUrl] = useState('');
  const [editImagePreviewUrl, setEditImagePreviewUrl] = useState('');
  const [newDropActive, setNewDropActive] = useState(false);

  const productsCollectionRef = collection(db, 'products');

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
    return categories.filter((c) => String(c?.name || '').toLowerCase().includes(q));
  }, [categories, categorySearch]);

  const productsInSelectedCategory = useMemo(() => {
    const cat = String(selectedCategory || '').trim();
    const q = productSearch.trim().toLowerCase();

    const list = products.filter((p) => {
      const pcat = String(p?.category || '').trim() || 'Uncategorized';
      if (cat && pcat !== cat) return false;
      if (!q) return true;
      return String(p?.name || '').toLowerCase().includes(q);
    });

    list.sort((a, b) => String(a?.name || '').localeCompare(String(b?.name || '')));
    return list;
  }, [products, selectedCategory, productSearch]);

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!newImageFile) {
      setNewImagePreviewUrl('');
      return;
    }
    const url = URL.createObjectURL(newImageFile);
    setNewImagePreviewUrl(url);
    return () => {
      try {
        URL.revokeObjectURL(url);
      } catch {
        // ignore
      }
    };
  }, [newImageFile]);

  useEffect(() => {
    if (!editImageFile) {
      setEditImagePreviewUrl('');
      return;
    }
    const url = URL.createObjectURL(editImageFile);
    setEditImagePreviewUrl(url);
    return () => {
      try {
        URL.revokeObjectURL(url);
      } catch {
        // ignore
      }
    };
  }, [editImageFile]);

  const safeFilename = (name) => String(name || 'image').replace(/[^a-zA-Z0-9._-]+/g, '_');


  // Standardize product images before upload:
  // - Center-crop to a fixed aspect ratio
  // - Resize to a predictable size
  // - Compress to reduce bandwidth/storage
  const STANDARD_IMAGE_WIDTH = 800;
  const STANDARD_IMAGE_HEIGHT = 800;
  const STANDARD_IMAGE_ASPECT = STANDARD_IMAGE_WIDTH / STANDARD_IMAGE_HEIGHT; // 1:1
  const STANDARD_IMAGE_MIME = 'image/jpeg';
  const STANDARD_IMAGE_QUALITY = 0.82;

  const getFileBaseName = (name) => {
    const n = String(name || 'image');
    const dot = n.lastIndexOf('.');
    const base = dot > 0 ? n.slice(0, dot) : n;
    return safeFilename(base);
  };

  const fileToImageBitmap = async (file) => {
    // Prefer createImageBitmap (faster, avoids DOM Image in most cases)
    if (typeof createImageBitmap === 'function') {
      return await createImageBitmap(file);
    }
    // Fallback to HTMLImageElement
    const url = URL.createObjectURL(file);
    try {
      const img = await new Promise((resolve, reject) => {
        const i = new Image();
        i.onload = () => resolve(i);
        i.onerror = reject;
        i.src = url;
      });
      return img;
    } finally {
      try { URL.revokeObjectURL(url); } catch { /* ignore */ }
    }
  };

  const preprocessImageForUpload = async (file) => {
    if (!file) return file;
    if (!String(file.type || '').startsWith('image/')) return file;

    try {
      const source = await fileToImageBitmap(file);
      const srcW = source.width || source.naturalWidth;
      const srcH = source.height || source.naturalHeight;
      if (!srcW || !srcH) return file;

      // Compute centered crop rect to match target aspect.
      const srcAspect = srcW / srcH;
      let cropW = srcW;
      let cropH = srcH;
      let cropX = 0;
      let cropY = 0;

      if (srcAspect > STANDARD_IMAGE_ASPECT) {
        // Too wide -> crop left/right
        cropW = Math.round(srcH * STANDARD_IMAGE_ASPECT);
        cropH = srcH;
        cropX = Math.round((srcW - cropW) / 2);
        cropY = 0;
      } else if (srcAspect < STANDARD_IMAGE_ASPECT) {
        // Too tall -> crop top/bottom
        cropW = srcW;
        cropH = Math.round(srcW / STANDARD_IMAGE_ASPECT);
        cropX = 0;
        cropY = Math.round((srcH - cropH) / 2);
      }

      const canvas = document.createElement('canvas');
      canvas.width = STANDARD_IMAGE_WIDTH;
      canvas.height = STANDARD_IMAGE_HEIGHT;

      const ctx = canvas.getContext('2d');
      if (!ctx) return file;
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';

      ctx.drawImage(
        source,
        cropX,
        cropY,
        cropW,
        cropH,
        0,
        0,
        STANDARD_IMAGE_WIDTH,
        STANDARD_IMAGE_HEIGHT
      );

      const blob = await new Promise((resolve) => {
        // `toBlob` can return null in rare cases; handle gracefully.
        canvas.toBlob((b) => resolve(b || null), STANDARD_IMAGE_MIME, STANDARD_IMAGE_QUALITY);
      });

      // Best-effort close ImageBitmap to release memory
      try {
        if (source && typeof source.close === 'function') source.close();
      } catch {
        // ignore
      }

      if (!blob) return file;

      const base = getFileBaseName(file.name);
      const outName = `${base}_std_${STANDARD_IMAGE_WIDTH}x${STANDARD_IMAGE_HEIGHT}.jpg`;
      return new File([blob], outName, { type: STANDARD_IMAGE_MIME, lastModified: Date.now() });
    } catch (err) {
      console.warn('Image preprocess failed; uploading original file', err);
      return file;
    }
  };

  const uploadProductImage = async ({ file, productId, onProgress, onDetail }) => {
    if (!file) throw new Error('No file selected');
    if (!productId) throw new Error('Missing productId');

    const ext = safeFilename(file.name);
    const path = `product-images/${productId}/${Date.now()}_${ext}`;
    const objRef = storageRef(storage, path);

    const task = uploadBytesResumable(objRef, file, {
      contentType: file.type || undefined,
      cacheControl: 'public,max-age=31536000',
    });

    const timeoutMs = 2 * 60 * 1000;
    let timeoutId = null;

    const formatStorageError = (err) => {
      const code = err?.code ? String(err.code) : '';
      const msg = err?.message ? String(err.message) : 'Upload failed';

      if (code === 'storage/unauthorized') {
        return `${msg} (storage/unauthorized). This usually means Firebase Storage Rules are blocking this user, or you are not signed in.`;
      }
      if (code === 'storage/bucket-not-found') {
        return `${msg} (storage/bucket-not-found). The Storage bucket name may be wrong. Check the bucket shown on this page and your Firebase Console.`;
      }
      if (code === 'storage/retry-limit-exceeded') {
        return `${msg} (storage/retry-limit-exceeded). Network/firewall may be blocking firebasestorage.googleapis.com.`;
      }
      if (code === 'storage/quota-exceeded') {
        return `${msg} (storage/quota-exceeded). Your Storage quota may be exceeded.`;
      }
      if (code === 'storage/canceled') {
        return `${msg} (storage/canceled).`;
      }

      return code ? `${msg} (${code})` : msg;
    };

    const url = await new Promise((resolve, reject) => {
      timeoutId = setTimeout(() => {
        try {
          task.cancel();
        } catch {
          // ignore
        }
        reject(new Error('Upload timed out. If progress stays at 0%, it is usually Storage Rules (unauthorized), wrong bucket, or network/firewall blocking Storage.'));
      }, timeoutMs);

      task.on(
        'state_changed',
        (snap) => {
          if (!snap || !snap.totalBytes) return;
          const pct = Math.round((snap.bytesTransferred / snap.totalBytes) * 100);
          if (typeof onProgress === 'function') onProgress(pct);
          if (typeof onDetail === 'function') {
            onDetail({
              state: snap.state,
              bytesTransferred: snap.bytesTransferred,
              totalBytes: snap.totalBytes,
            });
          }
        },
        (err) => {
          if (typeof onDetail === 'function') {
            onDetail({
              state: 'error',
              bytesTransferred: 0,
              totalBytes: file?.size || 0,
              error: {
                code: err?.code || null,
                message: err?.message || String(err),
              },
            });
          }
          reject(new Error(formatStorageError(err)));
        },
        async () => {
          try {
            const downloadUrl = await getDownloadURL(task.snapshot.ref);
            resolve(downloadUrl);
          } catch (e) {
            reject(e);
          }
        }
      );
    });

    if (timeoutId) clearTimeout(timeoutId);
    return url;
  };

  const handleAddProduct = async (e) => {
    e.preventDefault();
    setError(null);

    const priceNumber = parseFloat(newProduct.price);
    const costNumber = parseFloat(newProduct.cost);
    if (!newProduct.name || !Number.isFinite(priceNumber) || priceNumber <= 0 || !Number.isFinite(costNumber) || costNumber < 0) {
      setError('Please provide a name, a valid price, and a valid cost (>= 0).');
      return;
    }

    try {
      const docRef = await addDoc(productsCollectionRef, {
        name: newProduct.name,
        brand: String(newProduct.brand || '').trim(),
        gender: String(newProduct.gender || 'Unisex').trim(),
        color: String(newProduct.color || '').trim(),
        price: priceNumber,
        cost: costNumber,
        category: newProduct.category || '',
        image_url: newProduct.image_url || '',
        createdAt: new Date().toISOString(),
      });

      // Ensure inventory doc exists for this product (prevents Functions "No inventory record" failures)
      try {
        await setDoc(
          doc(db, 'inventory', docRef.id),
          {
            productID: docRef.id,
            stockLevel: 0,
            lastUpdated: serverTimestamp(),
          },
          { merge: true }
        );
      } catch (invErr) {
        console.warn('Failed to create inventory doc for product', { productId: docRef.id, invErr });
      }

      if (newImageFile) {
        try {
          setUploadingNewImage(true);
          setNewUploadProgress(0);
          setNewUploadDetail({ state: 'preprocessing', bytesTransferred: 0, totalBytes: newImageFile.size || 0 });
          const preparedFile = await preprocessImageForUpload(newImageFile);
          setNewUploadDetail({ state: 'starting', bytesTransferred: 0, totalBytes: preparedFile?.size || 0 });
          const url = await uploadProductImage({
            file: preparedFile,
            productId: docRef.id,
            onProgress: (p) => setNewUploadProgress(p),
            onDetail: (d) => setNewUploadDetail(d),
          });
          await updateDoc(doc(db, 'products', docRef.id), { image_url: url });
        } finally {
          setUploadingNewImage(false);
        }
      }

      setNewProduct({
        name: '',
        brand: '',
        gender: 'Unisex',
        color: '',
        price: 0,
        cost: '',
        category: '',
        image_url: '',
      });
      setNewImageFile(null);
      setNewUploadProgress(0);
      setNewUploadDetail(null);
      if (newFileInputRef.current) newFileInputRef.current.value = '';
      fetchProducts();
      await logAction(db, {
        type: 'product_create',
        source: 'ProductMaster',
        actorUID: currentUser?.uid || null,
        actorRole: currentRole || null,
        targetId: docRef.id,
        targetType: 'product',
        message: `Product created: ${newProduct.name}`,
        metadata: {
          name: newProduct.name,
          price: priceNumber,
          cost: costNumber,
          category: newProduct.category || '',
        },
      });
      alert('Product added successfully!');
    } catch (err) {
      console.error('Error adding product:', err);
      const code = err?.code ? ` (${err.code})` : '';
      setError(`Failed to add product.${code} ${err?.message || ''}`.trim());
      setUploadingNewImage(false);
    }
  };

  const clearAddForm = () => {
    setNewProduct({
      name: '',
      brand: '',
      gender: 'Unisex',
      color: '',
      price: 0,
      cost: '',
      category: '',
      image_url: '',
    });
    setNewImageFile(null);
    setNewUploadProgress(0);
    setNewUploadDetail(null);
    setError(null);
    if (newFileInputRef.current) newFileInputRef.current.value = '';
  };

  const handleNewDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setNewDropActive(false);
    if (uploadingNewImage) return;
    const f = e.dataTransfer?.files && e.dataTransfer.files[0] ? e.dataTransfer.files[0] : null;
    if (!f) return;
    if (String(f.type || '').startsWith('image/')) {
      setNewImageFile(f);
    }
  };

  const handleEditClick = (product) => {
    const inferredCost = (
      product?.cost ??
      product?.cost_price ??
      product?.costPrice ??
      product?.cogs ??
      ''
    );

    setEditingProduct({
      ...product,
      image_url: product.image_url || '',
      category: product.category || '',
      cost: inferredCost,
      brand: String(product?.brand || '').trim(),
      gender: String(product?.gender || 'Unisex').trim() || 'Unisex',
      color: String(product?.color || '').trim(),
    });
    setEditImageFile(null);
    setEditUploadProgress(0);
    setEditUploadDetail(null);
    if (editFileInputRef.current) editFileInputRef.current.value = '';
    setIsEditModalOpen(true);
  };

  const handleUpdateProduct = async (e) => {
    e.preventDefault();
    setError(null);

    const updatedPrice = parseFloat(editingProduct.price);
    const updatedCost = parseFloat(editingProduct.cost);
    if (!editingProduct.name || !Number.isFinite(updatedPrice) || updatedPrice <= 0 || !Number.isFinite(updatedCost) || updatedCost < 0) {
      setError('Name, valid price, and valid cost are required.');
      return;
    }

    try {
      const productRef = doc(db, 'products', editingProduct.id);
      await updateDoc(productRef, {
        name: editingProduct.name,
        brand: String(editingProduct.brand || '').trim(),
        gender: String(editingProduct.gender || 'Unisex').trim(),
        color: String(editingProduct.color || '').trim(),
        price: updatedPrice,
        cost: updatedCost,
        category: editingProduct.category || '',
        image_url: editingProduct.image_url || '',
      });

      if (editImageFile) {
        try {
          setUploadingEditImage(true);
          setEditUploadProgress(0);
          setEditUploadDetail({ state: 'preprocessing', bytesTransferred: 0, totalBytes: editImageFile.size || 0 });
          const preparedFile = await preprocessImageForUpload(editImageFile);
          setEditUploadDetail({ state: 'starting', bytesTransferred: 0, totalBytes: preparedFile?.size || 0 });
          const url = await uploadProductImage({
            file: preparedFile,
            productId: editingProduct.id,
            onProgress: (p) => setEditUploadProgress(p),
            onDetail: (d) => setEditUploadDetail(d),
          });
          await updateDoc(productRef, { image_url: url });
        } finally {
          setUploadingEditImage(false);
        }
      }

      setIsEditModalOpen(false);
      setEditingProduct(null);
      setEditImageFile(null);
      setEditUploadProgress(0);
      setEditUploadDetail(null);
      fetchProducts();
      await logAction(db, {
        type: 'product_update',
        source: 'ProductMaster',
        actorUID: currentUser?.uid || null,
        actorRole: currentRole || null,
        targetId: editingProduct.id,
        targetType: 'product',
        message: `Product updated: ${editingProduct.name}`,
        metadata: {
          name: editingProduct.name,
          price: updatedPrice,
          cost: updatedCost,
          category: editingProduct.category || '',
        },
      });
      alert(`Product ${editingProduct.name} updated successfully!`);
    } catch (err) {
      console.error('Error updating product:', err);
      const code = err?.code ? ` (${err.code})` : '';
      setError(`Failed to update product.${code} ${err?.message || ''}`.trim());
      setUploadingEditImage(false);
    }
  };

  const canSubmitAdd = useMemo(() => {
    const priceNumber = parseFloat(newProduct.price);
    const costNumber = parseFloat(newProduct.cost);
    return Boolean(newProduct.name) && Number.isFinite(priceNumber) && priceNumber > 0 && Number.isFinite(costNumber) && costNumber >= 0 && !uploadingNewImage;
  }, [newProduct.name, newProduct.price, newProduct.cost, uploadingNewImage]);

  const handleDeleteProduct = async (productId, productName) => {
    if (!window.confirm(`Are you sure you want to delete ${productName}? This action cannot be undone.`)) {
      return;
    }

    try {
      const productRef = doc(db, 'products', productId);
      await deleteDoc(productRef);
      fetchProducts();
      await logAction(db, {
        type: 'product_delete',
        source: 'ProductMaster',
        actorUID: currentUser?.uid || null,
        actorRole: currentRole || null,
        targetId: productId,
        targetType: 'product',
        message: `Product deleted: ${productName}`,
        metadata: {
          name: productName,
        },
      });
      alert(`${productName} deleted successfully.`);
    } catch (err) {
      console.error('Error deleting product:', err);
      setError('Failed to delete product.');
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
        title="Product Master"
      />

      <SectionCard title="Add Product" sx={{ mb: 4 }}>
        <Box component="form" id="add-product-form" onSubmit={handleAddProduct} sx={{ flexGrow: 1 }}>
          <Grid container spacing={3}>
            <Grid item xs={12} md={8}>
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                <SectionCard title="Products Description" subtitle="Basic product details." sx={{ p: { xs: 2, md: 2 } }}>
                  <Grid container spacing={2}>
                    <Grid item xs={12}>
                      <TextField
                        label="Product Name"
                        value={newProduct.name}
                        onChange={(e) => setNewProduct({ ...newProduct, name: e.target.value })}
                        required
                        fullWidth
                      />
                    </Grid>

                    <Grid item xs={12}>
                      <TextField
                        label="Brand"
                        value={newProduct.brand}
                        onChange={(e) => setNewProduct({ ...newProduct, brand: e.target.value })}
                        fullWidth
                      />
                    </Grid>

                    <Grid item xs={12}>
                      <TextField
                        select
                        label="Category"
                        value={newProduct.category}
                        onChange={(e) => setNewProduct({ ...newProduct, category: e.target.value })}
                        fullWidth
                        InputLabelProps={{ shrink: true }}
                        SelectProps={{ displayEmpty: true }}
                      >
                        <MenuItem value="">
                          None
                        </MenuItem>
                        {CATEGORIES.map((c) => (
                          <MenuItem key={c} value={c}>
                            {c}
                          </MenuItem>
                        ))}
                      </TextField>
                    </Grid>

                    <Grid item xs={12} md={6}>
                      <TextField
                        select
                        label="Gender"
                        value={newProduct.gender}
                        onChange={(e) => setNewProduct({ ...newProduct, gender: e.target.value })}
                        fullWidth
                      >
                        {GENDER_OPTIONS.map((g) => (
                          <MenuItem key={g} value={g}>
                            {g}
                          </MenuItem>
                        ))}
                      </TextField>
                    </Grid>

                    <Grid item xs={12} md={6}>
                      <TextField
                        select
                        label="Color"
                        value={newProduct.color}
                        onChange={(e) => setNewProduct({ ...newProduct, color: e.target.value })}
                        fullWidth
                        InputLabelProps={{ shrink: true }}
                        SelectProps={{ displayEmpty: true }}
                      >
                        <MenuItem value="">
                          None
                        </MenuItem>
                        {COLOR_OPTIONS.map((c) => (
                          <MenuItem key={c} value={c}>
                            {c}
                          </MenuItem>
                        ))}
                      </TextField>
                    </Grid>

                    <Grid item xs={12} md={6}>
                      
                    </Grid>
                  </Grid>
                </SectionCard>

                <SectionCard title="Pricing & Availability" subtitle="Pricing for checkout." sx={{ p: { xs: 2, md: 2 } }}>
                  <Grid container spacing={2}>
                    <Grid item xs={12}>
                      <TextField
                        label="Price (RM)"
                        type="number"
                        inputProps={{ step: '0.01' }}
                        value={newProduct.price}
                        onChange={(e) => setNewProduct({ ...newProduct, price: e.target.value })}
                        required
                        fullWidth
                      />
                    </Grid>

                    <Grid item xs={12}>
                      <TextField
                        label="Cost (RM)"
                        type="number"
                        inputProps={{ step: '0.01', min: 0 }}
                        value={newProduct.cost}
                        onChange={(e) => setNewProduct({ ...newProduct, cost: e.target.value })}
                        required
                        fullWidth
                        helperText="Used for Gross Profit / Margin analytics"
                      />
                    </Grid>
                  </Grid>
                </SectionCard>
              </Box>
            </Grid>

            <Grid item xs={12} md={4}>
              <SectionCard title="Products Images" subtitle="Upload or paste an image URL." sx={{ p: { xs: 2, md: 2 } }}>
                {uploadingNewImage ? (
                  <Box sx={{ mb: 2 }}>
                    <Typography variant="caption" color="text.secondary">Uploading image… {newUploadProgress}%</Typography>
                    <LinearProgress variant="determinate" value={newUploadProgress} sx={{ mt: 0.5 }} />
                    {newUploadDetail ? (
                      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
                        State: <strong>{newUploadDetail.state}</strong> • {newUploadDetail.bytesTransferred || 0} / {newUploadDetail.totalBytes || 0} bytes
                      </Typography>
                    ) : null}
                    {newUploadProgress === 0 ? (
                      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.25 }}>
                        If this stays at 0%, it’s usually Storage Rules (unauthorized) or network/firewall blocking `firebasestorage.googleapis.com`.
                      </Typography>
                    ) : null}
                  </Box>
                ) : null}

                <Box
                  component="label"
                  onDragEnter={() => setNewDropActive(true)}
                  onDragLeave={() => setNewDropActive(false)}
                  onDragOver={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setNewDropActive(true);
                  }}
                  onDrop={handleNewDrop}
                  sx={{
                    width: '100%',
                    minHeight: 260,
                    borderRadius: 2,
                    border: '2px dashed',
                    borderColor: newDropActive ? 'primary.main' : 'divider',
                    bgcolor: newDropActive ? 'action.hover' : 'background.default',
                    overflow: 'hidden',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    position: 'relative',
                    mb: 1.5,
                    cursor: uploadingNewImage ? 'not-allowed' : 'pointer',
                  }}
                >
                  <input
                    ref={newFileInputRef}
                    hidden
                    type="file"
                    accept="image/*"
                    disabled={uploadingNewImage}
                    onChange={(e) => setNewImageFile(e.target.files && e.target.files[0] ? e.target.files[0] : null)}
                  />

                  {(newImagePreviewUrl || newProduct.image_url) ? (
                    <Box
                      component="img"
                      src={newImagePreviewUrl || newProduct.image_url}
                      alt={newProduct.name || 'Preview'}
                      sx={{ width: '100%', height: '100%', objectFit: 'cover' }}
                    />
                  ) : (
                    <Box sx={{ textAlign: 'center', px: 2 }}>
                      <Box
                        sx={{
                          width: 56,
                          height: 56,
                          borderRadius: '50%',
                          border: '1px solid',
                          borderColor: 'divider',
                          display: 'grid',
                          placeItems: 'center',
                          mx: 'auto',
                          mb: 2,
                          color: 'text.secondary',
                          bgcolor: 'background.paper',
                        }}
                      >
                        <Upload size={22} />
                      </Box>

                      <Typography variant="body2" sx={{ lineHeight: 1.6 }}>
                        <Box component="span" sx={{ fontWeight: 650, color: 'text.primary' }}>
                          Click to upload
                        </Box>
                        <Box component="span" sx={{ color: 'text.secondary' }}> or drag and drop </Box>
                        <Box component="span" sx={{ color: 'text.secondary' }}>SVG, PNG, JPG or GIF </Box>
                        <Box component="span" sx={{ color: 'text.secondary' }}>(auto-crops to 1:1 and resizes to 800×800)</Box>
                      </Typography>
                    </Box>
                  )}
                </Box>

                {newImageFile ? (
                  <Box sx={{ mb: 1.5, display: 'flex', justifyContent: 'flex-end' }}>
                    <Chip
                      size="small"
                      label={newImageFile.name}
                      onDelete={uploadingNewImage ? undefined : () => {
                        setNewImageFile(null);
                        if (newFileInputRef.current) newFileInputRef.current.value = '';
                      }}
                      sx={{ maxWidth: '100%' }}
                    />
                  </Box>
                ) : null}

                <TextField
                  label="Image URL"
                  value={newProduct.image_url}
                  onChange={(e) => setNewProduct({ ...newProduct, image_url: e.target.value })}
                  fullWidth
                  placeholder="https://..."
                />
              </SectionCard>
            </Grid>
          </Grid>

          <Box sx={{ mt: 3, display: 'flex', gap: 1.5, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
            <Button variant="outlined" onClick={clearAddForm} disabled={uploadingNewImage}>
              Draft
            </Button>
            <Button type="submit" variant="contained" disabled={!canSubmitAdd}>
              {uploadingNewImage ? 'Uploading…' : 'Publish Product'}
            </Button>
          </Box>
        </Box>
      </SectionCard>

      <SectionCard
        title={
          selectedCategory
            ? `Products • ${selectedCategory} (${productsInSelectedCategory.length})`
            : `Categories (${categories.length})`
        }
        actions={<Button variant="outlined" onClick={fetchProducts}>Refresh</Button>}
        sx={{ p: { xs: 2, md: 2 } }}
      >
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
                Click a category tile to view products.
              </Typography>
            </Box>

            <Grid container spacing={2}>
              {filteredCategories.map((c) => (
                <Grid item xs={12} sm={6} md={4} lg={3} key={c.name}>
                  <Box
                    role="button"
                    tabIndex={0}
                    onClick={() => {
                      setSelectedCategory(c.name);
                      setProductSearch('');
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        setSelectedCategory(c.name);
                        setProductSearch('');
                      }
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
              <TextField
                label="Search product name"
                value={productSearch}
                onChange={(e) => setProductSearch(e.target.value)}
                fullWidth
                placeholder="Search products in this category..."
                sx={{ maxWidth: 520 }}
              />

              <Button
                variant="outlined"
                onClick={() => {
                  setSelectedCategory('');
                  setProductSearch('');
                }}
              >
                Back to categories
              </Button>
            </Box>

            <TableContainer>
              <Table>
                <TableHead>
                  <TableRow>
                    <TableCell>Image</TableCell>
                    <TableCell>Product ID</TableCell>
                    <TableCell>Name</TableCell>
                    <TableCell>Category</TableCell>
                    <TableCell>Price</TableCell>
                    <TableCell>Cost</TableCell>
                    <TableCell align="center">Actions</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {productsInSelectedCategory.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={7} sx={{ py: 4, textAlign: 'center' }}>
                        No products found.
                      </TableCell>
                    </TableRow>
                  ) : (
                    productsInSelectedCategory.map((product) => (
                      <TableRow key={product.id} hover>
                        <TableCell>
                          {product.image_url ? (
                            <Box
                              component="img"
                              src={product.image_url}
                              alt={product.name}
                              sx={{
                                width: 44,
                                height: 44,
                                objectFit: 'cover',
                                borderRadius: 1,
                                border: '1px solid',
                                borderColor: 'divider',
                              }}
                            />
                          ) : (
                            <Box sx={{ width: 44, height: 44, borderRadius: 1, border: '1px dashed', borderColor: 'divider' }} />
                          )}
                        </TableCell>
                        <TableCell sx={{ fontFamily: 'monospace', whiteSpace: 'nowrap' }}>{product.id}</TableCell>
                        <TableCell>{product.name}</TableCell>
                        <TableCell>{product.category}</TableCell>
                        <TableCell>RM{Number(product.price || 0).toFixed(2)}</TableCell>
                        <TableCell>
                          {Number.isFinite(Number(product.cost)) ? `RM${Number(product.cost).toFixed(2)}` : '—'}
                        </TableCell>
                        <TableCell align="center">
                          <IconButton size="small" onClick={() => handleEditClick(product)} aria-label="edit">
                            <Edit size={16} />
                          </IconButton>
                          <IconButton size="small" onClick={() => handleDeleteProduct(product.id, product.name)} aria-label="delete">
                            <Trash2 size={16} />
                          </IconButton>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </TableContainer>
          </Box>
        )}
      </SectionCard>

      <Dialog open={isEditModalOpen} onClose={() => setIsEditModalOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Edit Product</DialogTitle>
        <DialogContent>
          {uploadingEditImage ? (
            <Box sx={{ mt: 1, mb: 2 }}>
              <Typography variant="caption" color="text.secondary">Uploading image… {editUploadProgress}%</Typography>
              <LinearProgress variant="determinate" value={editUploadProgress} sx={{ mt: 0.5 }} />
              {editUploadDetail ? (
                <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
                  State: <strong>{editUploadDetail.state}</strong> • {editUploadDetail.bytesTransferred || 0} / {editUploadDetail.totalBytes || 0} bytes
                </Typography>
              ) : null}
              {editUploadProgress === 0 ? (
                <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.25 }}>
                  If this stays at 0%, it’s usually Storage Rules (unauthorized) or network/firewall blocking `firebasestorage.googleapis.com`.
                </Typography>
              ) : null}
            </Box>
          ) : null}
          {editingProduct && (
            <Box component="form" id="edit-product-form" onSubmit={handleUpdateProduct} sx={{ mt: 1 }}>
              <Grid container spacing={3}>
                <Grid item xs={12} md={8}>
                  <Grid container spacing={2}>
                    <Grid item xs={12}>
                      <TextField
                        label="Product Name"
                        value={editingProduct.name}
                        onChange={(e) => setEditingProduct({ ...editingProduct, name: e.target.value })}
                        required
                        fullWidth
                      />
                    </Grid>

                    <Grid item xs={12}>
                      <TextField
                        label="Brand"
                        value={editingProduct.brand || ''}
                        onChange={(e) => setEditingProduct({ ...editingProduct, brand: e.target.value })}
                        fullWidth
                      />
                    </Grid>

                    <Grid item xs={12}>
                      <TextField
                        select
                        label="Category"
                        value={editingProduct.category || ''}
                        onChange={(e) => setEditingProduct({ ...editingProduct, category: e.target.value })}
                        fullWidth
                        InputLabelProps={{ shrink: true }}
                        SelectProps={{ displayEmpty: true }}
                      >
                        <MenuItem value="">
                          None
                        </MenuItem>
                        {CATEGORIES.map((c) => (
                          <MenuItem key={c} value={c}>
                            {c}
                          </MenuItem>
                        ))}
                      </TextField>
                    </Grid>

                    <Grid item xs={12} md={6}>
                      <TextField
                        select
                        label="Gender"
                        value={editingProduct.gender || 'Unisex'}
                        onChange={(e) => setEditingProduct({ ...editingProduct, gender: e.target.value })}
                        fullWidth
                      >
                        {GENDER_OPTIONS.map((g) => (
                          <MenuItem key={g} value={g}>
                            {g}
                          </MenuItem>
                        ))}
                      </TextField>
                    </Grid>

                    <Grid item xs={12} md={6}>
                      <TextField
                        select
                        label="Color"
                        value={editingProduct.color || ''}
                        onChange={(e) => setEditingProduct({ ...editingProduct, color: e.target.value })}
                        fullWidth
                        InputLabelProps={{ shrink: true }}
                        SelectProps={{ displayEmpty: true }}
                      >
                        <MenuItem value="">
                          None
                        </MenuItem>
                        {COLOR_OPTIONS.map((c) => (
                          <MenuItem key={c} value={c}>
                            {c}
                          </MenuItem>
                        ))}
                      </TextField>
                    </Grid>

                    <Grid item xs={12} md={6}>
                      
                    </Grid>

                    <Grid item xs={12}>
                      <TextField
                        label="Price (RM)"
                        type="number"
                        inputProps={{ step: '0.01' }}
                        value={editingProduct.price}
                        onChange={(e) => setEditingProduct({ ...editingProduct, price: e.target.value })}
                        required
                        fullWidth
                      />
                    </Grid>

                    <Grid item xs={12}>
                      <TextField
                        label="Cost (RM)"
                        type="number"
                        inputProps={{ step: '0.01', min: 0 }}
                        value={editingProduct.cost ?? ''}
                        onChange={(e) => setEditingProduct({ ...editingProduct, cost: e.target.value })}
                        required
                        fullWidth
                        helperText="Used for Gross Profit / Margin analytics"
                      />
                    </Grid>

                    <Grid item xs={12}>
                      <TextField
                        label="Image URL"
                        value={editingProduct.image_url || ''}
                        onChange={(e) => setEditingProduct({ ...editingProduct, image_url: e.target.value })}
                        fullWidth
                      />
                    </Grid>
                  </Grid>
                </Grid>

                <Grid item xs={12} md={4}>
                  <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
                    <Box
                      sx={{
                        width: '100%',
                        aspectRatio: '1 / 1',
                        borderRadius: 2,
                        border: '1px solid',
                        borderColor: 'divider',
                        overflow: 'hidden',
                        bgcolor: 'background.default',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                      }}
                    >
                      {(editImagePreviewUrl || editingProduct.image_url) ? (
                        <Box
                          component="img"
                          src={editImagePreviewUrl || editingProduct.image_url}
                          alt={editingProduct.name || 'Preview'}
                          sx={{ width: '100%', height: '100%', objectFit: 'cover' }}
                        />
                      ) : (
                        <Typography variant="caption" color="text.secondary">Image preview</Typography>
                      )}
                    </Box>

                    <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', flexWrap: 'wrap' }}>
                      <Button variant="outlined" component="label" disabled={uploadingEditImage}>
                        Choose Image
                        <input
                          ref={editFileInputRef}
                          hidden
                          type="file"
                          accept="image/*"
                          onChange={(e) => setEditImageFile(e.target.files && e.target.files[0] ? e.target.files[0] : null)}
                        />
                      </Button>
                      {editImageFile ? (
                        <Chip
                          size="small"
                          label={editImageFile.name}
                          onDelete={uploadingEditImage ? undefined : () => {
                            setEditImageFile(null);
                            if (editFileInputRef.current) editFileInputRef.current.value = '';
                          }}
                        />
                      ) : (
                        <Typography variant="caption" color="text.secondary">Upload from device/Drive (optional)</Typography>
                      )}
                    </Box>
                  </Box>
                </Grid>
              </Grid>
            </Box>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setIsEditModalOpen(false)}>Cancel</Button>
          <Button
            type="submit"
            form="edit-product-form"
            variant="contained"
            color="primary"
            disabled={uploadingEditImage}
          >
            {uploadingEditImage ? 'Uploading...' : 'Save Changes'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default ProductMaster;
