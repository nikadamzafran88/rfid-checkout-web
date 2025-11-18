// ... (imports remain the same)
import React, { useState, useEffect, useMemo } from 'react';
import { db, rtdb } from '../firebaseConfig'; 
import { ref, onValue, off, set } from 'firebase/database'; 
import { collection, query, where, getDocs, addDoc } from 'firebase/firestore'; 
import { useAuth } from '../context/AuthContext.jsx'; 

const DEVICE_ID = "DEVICE_001"; 

const CustomerCheckout = () => {
    const { currentUser } = useAuth(); 
    const [scannedUids, setScannedUids] = useState({}); 
    const [cartItems, setCartItems] = useState([]); 
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);

    const transactionsCollectionRef = collection(db, 'transactions');
    
    // ---------------------- 1. RTDB LISTENER & DATA SYNC (NO FUNCTIONALITY CHANGE) ----------------------
    useEffect(() => {
        const cartRef = ref(rtdb, `checkout_cart/${DEVICE_ID}/scanned_items`);
        setLoading(true);

        const unsubscribe = onValue(cartRef, (snapshot) => {
            const data = snapshot.val();
            
            if (data) {
                setScannedUids(data);
            } else {
                setScannedUids({});
            }
            setLoading(false);
        }, (err) => {
            console.error("RTDB Listener Failed:", err);
            setError("Connection error with IoT device sync.");
            setLoading(false);
        });

        return () => {
            off(cartRef, 'value', unsubscribe);
        };
    }, []);

    // ---------------------- 2. FIRESTORE LOOKUP & CART MERGE (NO FUNCTIONALITY CHANGE) ----------------------
    useEffect(() => {
        const fetchProductDetails = async () => {
            if (Object.keys(scannedUids).length === 0) {
                setCartItems([]);
                return;
            }

            setError(null);
            const uidsToQuery = Object.keys(scannedUids);
            
            try {
                const productsQuery = query(
                    collection(db, 'products'),
                    where('RFID_tag_UID', 'in', uidsToQuery)
                );

                const snapshot = await getDocs(productsQuery);
                const mergedCart = [];

                snapshot.docs.forEach(doc => {
                    const product = doc.data();
                    const quantity = scannedUids[product.RFID_tag_UID] || 0;

                    if (quantity > 0) {
                        mergedCart.push({
                            id: doc.id,
                            name: product.name,
                            price: product.price,
                            quantity: quantity,
                            total: product.price * quantity,
                            RFID_tag_UID: product.RFID_tag_UID, 
                        });
                    }
                });

                setCartItems(mergedCart);

            } catch (err) {
                console.error("Firestore Lookup Failed:", err);
                setError("Failed to look up product details.");
            }
        };

        fetchProductDetails();
    }, [scannedUids]); 

    // ---------------------- 3. CALCULATIONS & FINALIZATION (NO FUNCTIONALITY CHANGE) ----------------------
    const cartTotal = useMemo(() => {
        return cartItems.reduce((sum, item) => sum + item.total, 0);
    }, [cartItems]);
    
    const handleCheckout = async () => {
        if (cartTotal <= 0) return alert("Your cart is empty.");
        
        const confirmCheckout = window.confirm(`Confirm payment of RM${cartTotal.toFixed(2)}?`);
        if (!confirmCheckout) return;

        try {
            // STEP A: Create the transaction record in Firestore
            await addDoc(transactionsCollectionRef, {
                timestamp: new Date().toISOString(),
                customerUID: currentUser ? currentUser.uid : 'Guest_Checkout',
                device: DEVICE_ID,
                totalAmount: cartTotal,
                paymentStatus: 'Paid (Simulated)',
                items: cartItems.map(item => ({
                    productId: item.id,
                    name: item.name,
                    quantity: item.quantity,
                    price: item.price,
                    rfid: item.RFID_tag_UID,
                })),
            });
            
            // STEP B: Clear the cart data from the Realtime Database
            const cartRef = ref(rtdb, `checkout_cart/${DEVICE_ID}/scanned_items`);
            await set(cartRef, null); 
            
            alert(`Payment successful! Transaction recorded.`);

        } catch (error) {
            console.error("Checkout Failed:", error);
            alert(`Checkout failed. Please check network/rules. Error: ${error.message}`);
        }
    };
    
    // ---------------------- RENDER LOGIC (Minimalist Design) ----------------------

    if (loading) return <div className="p-8 text-center text-2xl text-gray-600">Awaiting IoT Device Sync...</div>;

    return (
        <div className="p-10 min-h-screen bg-gray-100 flex font-sans">
            
            {/* Left Column: Cart Display */}
            <div className="w-2/3 pr-10">
                <h1 className="text-4xl font-extralight mb-8 text-gray-800 border-b pb-4">
                    <span className="font-semibold text-indigo-600">SCAN</span> & PAY
                </h1>
                
                {error && <div className="p-4 mb-6 text-red-700 bg-red-100 border-l-4 border-red-500 rounded-r-lg">{error}</div>}

                <div className="bg-white p-8 rounded-xl shadow-xl h-[70vh] flex flex-col border border-gray-200">
                    <h2 className="text-2xl font-medium mb-6 text-gray-700">Your Items ({cartItems.length})</h2>
                    
                    {cartItems.length === 0 ? (
                        <div className="flex-1 flex items-center justify-center text-center">
                            <p className="text-gray-500 text-xl font-light">
                                Place your products on the scanner.
                            </p>
                        </div>
                    ) : (
                        <ul className="flex-1 overflow-y-auto divide-y divide-gray-100">
                            {cartItems.map(item => (
                                <li key={item.id} className="py-4 flex justify-between items-center transition duration-100 hover:bg-gray-50">
                                    <div className="flex-1">
                                        <p className="font-medium text-gray-900 text-lg">{item.name}</p>
                                        <p className="text-sm text-gray-500">
                                            {item.quantity} unit{item.quantity > 1 ? 's' : ''} @ RM{item.price.toFixed(2)} each
                                        </p>
                                    </div>
                                    <div className="text-right">
                                        <p className="font-semibold text-xl text-indigo-600">RM{item.total.toFixed(2)}</p>
                                    </div>
                                </li>
                            ))}
                        </ul>
                    )}
                </div>
            </div>

            {/* Right Column: Checkout Summary */}
            <div className="w-1/3 pt-12">
                <div className="bg-white p-8 rounded-xl shadow-2xl sticky top-12 border-t-4 border-indigo-500">
                    <h2 className="text-2xl font-light border-b pb-4 mb-6 text-gray-800">PAYMENT SUMMARY</h2>
                    
                    <div className="space-y-4">
                        <div className="flex justify-between text-lg text-gray-700">
                            <span>Total Items:</span>
                            <span>{cartItems.reduce((sum, item) => sum + item.quantity, 0)}</span>
                        </div>
                        <div className="flex justify-between text-xl font-medium pt-2 text-gray-800">
                            <span>Subtotal:</span>
                            <span>RM{cartTotal.toFixed(2)}</span>
                        </div>
                    </div>
                    
                    <div className="flex justify-between text-3xl font-extrabold mt-8 pt-4 border-t border-gray-200">
                        <span>TOTAL DUE:</span>
                        <span className="text-green-600">RM{cartTotal.toFixed(2)}</span>
                    </div>
                    
                    <button
                        onClick={handleCheckout}
                        disabled={cartTotal <= 0}
                        className="w-full py-5 mt-8 bg-indigo-600 text-white text-xl font-bold rounded-lg shadow-lg hover:bg-indigo-700 transition duration-200 disabled:bg-gray-400 disabled:shadow-none"
                    >
                        COMPLETE PAYMENT
                    </button>

                    <p className="text-xs text-center text-gray-400 mt-4">
                        Powered by IoT & Firebase Real-Time Sync
                    </p>
                </div>
            </div>
        </div>
    );
};

export default CustomerCheckout;