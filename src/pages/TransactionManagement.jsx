import React, { useState, useEffect } from 'react';
import { db } from '../firebaseConfig';
import { 
    collection, 
    getDocs, 
    query,
    orderBy // Useful for sorting transactions by date
} from 'firebase/firestore'; 

const TransactionManagement = () => {
    const [transactions, setTransactions] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);

    const transactionsCollectionRef = collection(db, 'transactions');

    // Utility function to format timestamp into a readable date/time
    const formatTimestamp = (timestamp) => {
        if (!timestamp) return 'N/A';
        try {
            const date = new Date(timestamp);
            // Format to a standard date/time string
            return date.toLocaleString('en-MY', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
        } catch {
            return 'Invalid Date';
        }
    };

    // 1. Fetch Transactions Function
    const fetchTransactions = async () => {
        setLoading(true);
        setError(null);
        try {
            // Query to sort transactions by timestamp (latest first)
            const q = query(transactionsCollectionRef, orderBy('timestamp', 'desc'));
            
            const data = await getDocs(q);
            const transactionsList = data.docs.map(doc => ({ 
                ...doc.data(), 
                id: doc.id 
            }));
            
            setTransactions(transactionsList);
        } catch (err) {
            console.error("Error fetching transactions:", err);
            setError("Failed to load transactions. Check Firestore access rules.");
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchTransactions();
    }, []);

    // -------------------- RENDER LOGIC --------------------

    if (loading) return <div className="p-8 text-center text-xl text-gray-600">Loading Transactions...</div>;
    if (error && !loading) return <div className="p-8 text-red-600">{error}</div>;

    return (
        <div className="p-4">
            <h1 className="text-3xl font-normal text-gray-800 mb-8 uppercase">View Transactions</h1>
            
            <div className="bg-white p-6 rounded-xl shadow-lg border border-gray-200">
                <h2 className="text-xl font-medium mb-6 text-gray-700 border-b pb-3">Transaction History ({transactions.length} Records)</h2>

                <div className="overflow-x-auto">
                    <table className="min-w-full divide-y divide-gray-200">
                        <thead className="bg-gray-50">
                            <tr>
                                <th className="px-6 py-3 text-left text-xs font-semibold text-gray-800 uppercase tracking-wider">Transaction ID</th>
                                <th className="px-6 py-3 text-left text-xs font-semibold text-gray-800 uppercase tracking-wider">Timestamp</th>
                                <th className="px-6 py-3 text-left text-xs font-semibold text-gray-800 uppercase tracking-wider">Customer UID</th>
                                <th className="px-6 py-3 text-left text-xs font-semibold text-gray-800 uppercase tracking-wider">Items Count</th>
                                <th className="px-6 py-3 text-left text-xs font-semibold text-gray-800 uppercase tracking-wider">Total Amount</th>
                                <th className="px-6 py-3 text-left text-xs font-semibold text-gray-800 uppercase tracking-wider">Status</th>
                            </tr>
                        </thead>
                        <tbody className="bg-white divide-y divide-gray-100">
                            {transactions.map((txn) => {
                                const itemCount = txn.items ? txn.items.length : 0;
                                const isSuccess = txn.paymentStatus && txn.paymentStatus.includes('Paid');

                                return (
                                    <tr key={txn.id} className="hover:bg-gray-50">
                                        <td className="px-6 py-4 whitespace-nowrap font-mono text-sm">{txn.id.substring(0, 10)}...</td>
                                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600">{formatTimestamp(txn.timestamp)}</td>
                                        <td className="px-6 py-4 whitespace-nowrap font-mono text-xs text-gray-500">{txn.customerUID || 'N/A'}</td>
                                        <td className="px-6 py-4 whitespace-nowrap text-center">{itemCount}</td>
                                        <td className="px-6 py-4 whitespace-nowrap font-bold text-base text-green-700">RM{txn.totalAmount ? txn.totalAmount.toFixed(2) : '0.00'}</td>
                                        <td className="px-6 py-4 whitespace-nowrap">
                                            <span className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${
                                                isSuccess ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
                                            }`}>
                                                {txn.paymentStatus || 'Completed'}
                                            </span>
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                    {transactions.length === 0 && <p className="text-center py-8 text-gray-500">No transactions found yet. Try completing a checkout simulation.</p>}
                </div>
            </div>
        </div>
    );
};

export default TransactionManagement;