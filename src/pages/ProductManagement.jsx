import React, { useState, useEffect } from 'react';
import { db } from '../firebaseConfig';
import { 
    collection, 
    addDoc, 
    getDocs, 
    doc, 
    updateDoc, 
    deleteDoc 
} from 'firebase/firestore'; 

const ProductManagement = () => {
    const [products, setProducts] = useState([]);
    const [newProduct, setNewProduct] = useState({ 
        name: '', 
        price: 0, 
        RFID_tag_UID: '',
        category: ''
    });
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [isEditModalOpen, setIsEditModalOpen] = useState(false);
    const [editingProduct, setEditingProduct] = useState(null); 
    
    const productsCollectionRef = collection(db, 'products');

    // 1. Fetch Products Function
    const fetchProducts = async () => {
        setLoading(true);
        setError(null);
        try {
            const data = await getDocs(productsCollectionRef);
            const productsList = data.docs.map(doc => ({ 
                ...doc.data(), 
                id: doc.id 
            }));
            setProducts(productsList);
        } catch (err) {
            console.error("Error fetching products:", err);
            setError("Failed to load products.");
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchProducts();
    }, []);

    // 2. Add Product Function 
    const handleAddProduct = async (e) => {
        e.preventDefault();
        setError(null);

        if (!newProduct.RFID_tag_UID || newProduct.price <= 0 || !newProduct.name) {
            setError("Please provide a name, price, and RFID Tag UID.");
            return;
        }

        try {
            await addDoc(productsCollectionRef, {
                name: newProduct.name,
                price: parseFloat(newProduct.price),
                RFID_tag_UID: newProduct.RFID_tag_UID,
                category: newProduct.category,
                createdAt: new Date().toISOString(),
            });
            
            setNewProduct({ name: '', price: 0, RFID_tag_UID: '', category: '' });
            fetchProducts();
            alert('Product added successfully!');

        } catch (err) {
            console.error("Error adding product:", err);
            setError("Failed to add product.");
        }
    };

    // 3. Edit Product Handlers (Simplified)
    const handleEditClick = (product) => {
        setEditingProduct(product);
        setIsEditModalOpen(true);
    };

    const handleUpdateProduct = async (e) => {
        e.preventDefault();
        const updatedPrice = parseFloat(editingProduct.price);
        
        if (!editingProduct.name || updatedPrice <= 0 || !editingProduct.RFID_tag_UID) {
            setError("All required fields must be filled.");
            return;
        }

        try {
            const productRef = doc(db, 'products', editingProduct.id);
            await updateDoc(productRef, {
                name: editingProduct.name,
                price: updatedPrice,
                RFID_tag_UID: editingProduct.RFID_tag_UID,
                category: editingProduct.category,
            });
            
            setIsEditModalOpen(false);
            setEditingProduct(null);
            fetchProducts();
            alert(`Product ${editingProduct.name} updated successfully!`);

        } catch (err) {
            console.error("Error updating product:", err);
            setError("Failed to update product.");
        }
    };

    // 4. Delete Product Handler
    const handleDeleteProduct = async (productId, productName) => {
        if (window.confirm(`Are you sure you want to delete ${productName}? This action cannot be undone.`)) {
            try {
                const productRef = doc(db, 'products', productId);
                await deleteDoc(productRef);
                fetchProducts();
                alert(`${productName} deleted successfully.`);
            } catch (err) {
                console.error("Error deleting product:", err);
                setError("Failed to delete product.");
            }
        }
    };
    
    // -------------------- RENDER LOGIC --------------------
    if (loading) return <div className="p-8 text-center text-gray-600">Loading Products...</div>;
    if (error && !loading) return <div className="p-8 text-red-600">Error: {error}</div>;

    return (
        <div className="p-4">
            <h1 className="text-3xl font-light text-gray-800 mb-8 uppercase">Product Management</h1>
            
            {/* Add New Product Form - Clean Card Style */}
            <div className="bg-white p-6 rounded-xl shadow-lg mb-10 border border-gray-200">
                <h2 className="text-xl font-medium mb-5 text-gray-700">Add New Product</h2>
                <form onSubmit={handleAddProduct} className="grid grid-cols-6 gap-4 items-end">
                    {/* Input: Product Name (col-span-2) */}
                    <input
                        type="text"
                        placeholder="Product Name"
                        value={newProduct.name}
                        onChange={(e) => setNewProduct({ ...newProduct, name: e.target.value })}
                        className="p-3 border border-gray-300 rounded focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 col-span-2"
                        required
                    />
                    {/* Input: Category */}
                    <input
                        type="text"
                        placeholder="Category"
                        value={newProduct.category}
                        onChange={(e) => setNewProduct({ ...newProduct, category: e.target.value })}
                        className="p-3 border border-gray-300 rounded focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
                    />
                    {/* Input: Price */}
                    <input
                        type="number"
                        placeholder="Price (RM)"
                        value={newProduct.price}
                        onChange={(e) => setNewProduct({ ...newProduct, price: e.target.value })}
                        step="0.01"
                        className="p-3 border border-gray-300 rounded focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
                        required
                    />
                    {/* Input: RFID UID */}
                    <input
                        type="text"
                        placeholder="RFID Tag UID"
                        value={newProduct.RFID_tag_UID}
                        onChange={(e) => setNewProduct({ ...newProduct, RFID_tag_UID: e.target.value })}
                        className="p-3 border border-gray-300 rounded focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
                        required
                    />
                    {/* Button: Add Product */}
                    <button
                        type="submit"
                        className="bg-indigo-600 text-white py-3 rounded hover:bg-indigo-700 font-medium"
                    >
                        Add Product
                    </button>
                </form>
            </div>

            {/* Product List Display - Clean Table Style */}
            <div className="bg-white p-6 rounded-xl shadow-lg border border-gray-200">
                <h2 className="text-xl font-medium mb-5 text-gray-700">Existing Products ({products.length})</h2>
                <div className="overflow-x-auto">
                    <table className="min-w-full divide-y divide-gray-200">
                        <thead className="bg-gray-50">
                            <tr>
                                <th className="px-6 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Name</th>
                                <th className="px-6 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Category</th>
                                <th className="px-6 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Price</th>
                                <th className="px-6 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">RFID UID</th>
                                <th className="px-6 py-3 text-center text-xs font-semibold text-gray-500 uppercase tracking-wider">Actions</th>
                            </tr>
                        </thead>
                        <tbody className="bg-white divide-y divide-gray-100">
                            {products.map((product) => (
                                <tr key={product.id} className="hover:bg-gray-50">
                                    <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">{product.name}</td>
                                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{product.category}</td>
                                    <td className="px-6 py-4 whitespace-nowrap text-sm font-medium">RM{product.price.toFixed(2)}</td>
                                    <td className="px-6 py-4 whitespace-nowrap font-mono text-xs text-gray-600">{product.RFID_tag_UID}</td>
                                    <td className="px-6 py-4 whitespace-nowrap text-center text-sm">
                                        <button 
                                            onClick={() => handleEditClick(product)}
                                            className="text-indigo-600 hover:text-indigo-800 transition duration-150 mr-3 font-medium text-xs"
                                        >
                                            Edit
                                        </button>
                                        <button 
                                            onClick={() => handleDeleteProduct(product.id, product.name)}
                                            className="text-red-600 hover:text-red-800 transition duration-150 font-medium text-xs"
                                        >
                                            Delete
                                        </button>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>

            {/* Edit Product Modal (Minimalist Styling) */}
            {isEditModalOpen && editingProduct && (
                <div className="fixed inset-0 bg-gray-900 bg-opacity-50 flex items-center justify-center z-50 p-4">
                    <div className="bg-white p-8 rounded-xl shadow-2xl w-full max-w-md">
                        <h2 className="text-2xl font-light mb-6 text-gray-800 border-b pb-2">Edit Product</h2>
                        <form onSubmit={handleUpdateProduct}>
                            
                            <label className="block text-sm font-medium text-gray-700 mb-1">Product Name</label>
                            <input
                                type="text"
                                value={editingProduct.name}
                                onChange={(e) => setEditingProduct({ ...editingProduct, name: e.target.value })}
                                className="w-full p-3 mb-4 border border-gray-300 rounded-lg"
                                required
                            />
                            
                            <label className="block text-sm font-medium text-gray-700 mb-1">Category</label>
                            <input
                                type="text"
                                value={editingProduct.category}
                                onChange={(e) => setEditingProduct({ ...editingProduct, category: e.target.value })}
                                className="w-full p-3 mb-4 border border-gray-300 rounded-lg"
                            />

                            <label className="block text-sm font-medium text-gray-700 mb-1">Price (RM)</label>
                            <input
                                type="number"
                                value={editingProduct.price}
                                onChange={(e) => setEditingProduct({ ...editingProduct, price: e.target.value })}
                                step="0.01"
                                className="w-full p-3 mb-4 border border-gray-300 rounded-lg"
                                required
                            />
                            
                            <label className="block text-sm font-medium text-gray-700 mb-1">RFID Tag UID</label>
                            <input
                                type="text"
                                value={editingProduct.RFID_tag_UID}
                                onChange={(e) => setEditingProduct({ ...editingProduct, RFID_tag_UID: e.target.value })}
                                className="w-full p-3 mb-6 border border-gray-300 rounded-lg font-mono text-xs"
                                required
                            />

                            <div className="flex justify-end space-x-3 pt-2">
                                <button
                                    type="button"
                                    onClick={() => {
                                        setIsEditModalOpen(false);
                                        setEditingProduct(null); 
                                    }}
                                    className="px-4 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-100 transition duration-150"
                                >
                                    Cancel
                                </button>
                                <button
                                    type="submit"
                                    className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 font-medium transition duration-150"
                                >
                                    Save Changes
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
};

export default ProductManagement;