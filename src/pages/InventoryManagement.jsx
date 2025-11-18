import React, { useState, useEffect } from 'react';
import { db } from '../firebaseConfig';
import { 
    collection, 
    getDocs, 
    doc, 
    writeBatch 
} from 'firebase/firestore'; 
import { Package } from 'lucide-react';

const InventoryManagement = () => {
    const [inventoryList, setInventoryList] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [stockUpdates, setStockUpdates] = useState({}); // Stores temporary stock edits

    const productsCollectionRef = collection(db, 'products');
    const inventoryCollectionRef = collection(db, 'inventory');

    // 1. Fetch & Merge Data from Products and Inventory collections
    const fetchInventory = async () => {
        setLoading(true);
        setError(null);
        try {
            // Fetch Products (Master data)
            const productSnap = await getDocs(productsCollectionRef);
            const productsMap = new Map();
            productSnap.docs.forEach(doc => {
                productsMap.set(doc.id, { id: doc.id, ...doc.data() });
            });

            // Fetch Inventory Levels
            const inventorySnap = await getDocs(inventoryCollectionRef);
            const mergedList = [];

            productsMap.forEach(product => {
                let currentStock = 0;
                
                // Find matching inventory document by productID
                const inventoryDoc = inventorySnap.docs.find(invDoc => invDoc.data().productID === product.id);

                if (inventoryDoc) {
                    currentStock = inventoryDoc.data().stockLevel;
                } else {
                    currentStock = 0; 
                }

                mergedList.push({
                    ...product,
                    inventoryDocId: inventoryDoc ? inventoryDoc.id : null, // Used for batch updates
                    stockLevel: currentStock,
                });
            });

            setInventoryList(mergedList);
            
        } catch (err) {
            console.error("Error fetching inventory:", err);
            setError("Failed to load inventory data. Check console for rules error.");
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchInventory();
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
                } else if (item) {
                    // CREATE new inventory document (if one was missing)
                    const newInvRef = doc(inventoryCollectionRef); 
                    batch.set(newInvRef, {
                        productID: productId,
                        stockLevel: newStock,
                        lastUpdated: new Date().toISOString()
                    });
                    updatesCount++;
                }
            }

            await batch.commit();
            setStockUpdates({}); // Clear temporary changes
            fetchInventory(); // Refresh view
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

    if (loading) return <div className="p-8 text-center text-xl text-gray-600">Loading Inventory Data...</div>;
    if (error && !loading) return <div className="p-8 text-red-600">{error}</div>;

    return (
        <div className="p-4">
            <h1 className="text-3xl font-normal text-gray-800 mb-8 uppercase">Manage Inventory</h1>
            
            {/* Low Stock Alert Card */}
            <div className={`p-4 mb-8 rounded-xl shadow-md flex items-center space-x-3 transition duration-300 ${
                lowStockCount > 0 ? 'bg-red-100 border border-red-400' : 'bg-green-100 border border-green-400'
            }`}>
                <Package size={24} className={lowStockCount > 0 ? 'text-red-600' : 'text-green-600'} />
                <p className={`font-semibold ${lowStockCount > 0 ? 'text-red-800' : 'text-green-800'}`}>
                    {lowStockCount > 0 
                        ? `${lowStockCount} items are currently at critically low stock (below 5).`
                        : `Stock levels are healthy across all products.`}
                </p>
            </div>


            <div className="bg-white p-6 rounded-xl shadow-lg border border-gray-200">
                <h2 className="text-xl font-medium mb-6 text-gray-700 border-b pb-3">Product Stock Levels</h2>
                
                <div className="flex justify-end mb-4">
                    <button
                        onClick={handleSaveUpdates}
                        disabled={!hasPendingUpdates || loading}
                        className={`px-6 py-3 rounded-lg font-semibold transition shadow-md ${
                            hasPendingUpdates 
                                ? 'bg-indigo-600 text-white hover:bg-indigo-700' 
                                : 'bg-gray-300 text-gray-500 cursor-not-allowed'
                        }`}
                    >
                        {loading ? 'Saving...' : `Save ${Object.keys(stockUpdates).length} Pending Updates`}
                    </button>
                </div>

                <div className="overflow-x-auto">
                    <table className="min-w-full divide-y divide-gray-200">
                        <thead className="bg-gray-50">
                            <tr>
                                <th className="px-6 py-3 text-left text-xs font-semibold text-gray-800 uppercase tracking-wider">Product Name</th>
                                <th className="px-6 py-3 text-left text-xs font-semibold text-gray-800 uppercase tracking-wider">Category</th>
                                <th className="px-6 py-3 text-left text-xs font-semibold text-gray-800 uppercase tracking-wider">Current Stock</th>
                                <th className="px-6 py-3 text-left text-xs font-semibold text-gray-800 uppercase tracking-wider">Set New Stock</th>
                            </tr>
                        </thead>
                        <tbody className="bg-white divide-y divide-gray-100">
                            {inventoryList.map((item) => (
                                <tr key={item.id} className={item.stockLevel < 5 && lowStockCount > 0 ? 'bg-red-50 hover:bg-red-100' : 'hover:bg-gray-50'}>
                                    <td className="px-6 py-4 whitespace-nowrap font-medium text-gray-900">{item.name}</td>
                                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600">{item.category}</td>
                                    <td className="px-6 py-4 whitespace-nowrap">
                                        <span className={`font-bold text-lg ${item.stockLevel < 5 ? 'text-red-600' : 'text-gray-800'}`}>
                                            {item.stockLevel}
                                        </span>
                                    </td>
                                    <td className="px-6 py-4 whitespace-nowrap flex items-center">
                                        <input
                                            type="number"
                                            min="0"
                                            defaultValue={item.stockLevel}
                                            onChange={(e) => handleStockChange(item.id, e.target.value)}
                                            className="w-24 p-2 border border-gray-300 rounded-lg text-center focus:border-indigo-500"
                                        />
                                        {stockUpdates[item.id] !== undefined && (
                                            <span className="ml-3 text-xs text-blue-600 font-semibold">Update Pending</span>
                                        )}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
};

export default InventoryManagement;