import React, { useState, useEffect } from 'react';
import { collection, query, getDocs, orderBy, limit } from 'firebase/firestore';
import { useNavigate } from 'react-router-dom';
import { db } from '../firebaseConfig'; 
import { Users, ShoppingBag, DollarSign, AlertTriangle } from 'lucide-react'; 

// Utility component for Key Metric Cards (Material Elevated Style)
const MetricCard = ({ title, value, color, icon: Icon }) => (
    <div className={`p-4 bg-white rounded-xl shadow-xl hover:shadow-2xl transition duration-300`}>
        {/* Prominent Icon container (like in the template) */}
        <div className={`p-3 -mt-6 rounded-xl text-white shadow-lg`} style={{ backgroundColor: color }}>
            <Icon size={24} />
        </div>
        <div className="mt-4">
            <p className="text-sm font-light text-gray-500 uppercase">{title}</p>
            <h3 className="text-3xl font-extrabold text-gray-900 mt-1">{value}</h3>
        </div>
    </div>
);

const AdminDashboard = () => {
    const navigate = useNavigate();
    const [recentTransactions, setRecentTransactions] = useState([]);
    const [loading, setLoading] = useState(true);
    const [metricCounts] = useState({
        totalItems: '258', 
        totalUsers: '12', 
        totalTransactions: '12764',
        lowStockItems: '24' 
    });
    const transactionsCollectionRef = collection(db, 'transactions');

    const formatTimestamp = (timestamp) => {
        if (!timestamp) return 'N/A';
        try {
            const date = new Date(timestamp);
            return date.toLocaleDateString('en-MY', { year: 'numeric', month: 'short', day: 'numeric' });
        } catch {
            return 'Invalid Date';
        }
    };
    
    const fetchData = async () => {
        try {
            const txQuery = query(transactionsCollectionRef, orderBy('timestamp', 'desc'), limit(4));
            const txSnap = await getDocs(txQuery);
            const txList = txSnap.docs.map(doc => ({ 
                ...doc.data(), 
                id: doc.id,
                paymentStatus: doc.data().paymentStatus || (Math.random() > 0.5 ? 'Success' : 'Failed'),
                totalAmount: doc.data().totalAmount || (Math.random() * 50 + 10),
            }));
            setRecentTransactions(txList);
        } catch (err) {
            console.error("Dashboard Fetch Error:", err);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchData();
    }, []);

    // Material Colors (Defined locally)
    const metricColors = {
        totalItems: '#3f51b5', // Blue
        totalUsers: '#4caf50', // Green
        totalTransactions: '#2196f3', // Sky Blue
        lowStockItems: '#f44336' // Red
    };

    // -------------------- RENDER LOGIC --------------------

    return (
        <div className="p-4 space-y-8">
            <h1 className="text-3xl font-bold text-gray-900 mb-4">Dashboard</h1>
            
            {/* 1. Key Metrics Cards (Material Grid) */}
            <div className="grid grid-cols-4 gap-8">
                <MetricCard title="Total Items" value={loading ? '...' : metricCounts.totalItems} color={metricColors.totalItems} icon={ShoppingBag} />
                <MetricCard title="Total Users" value={loading ? '...' : metricCounts.totalUsers} color={metricColors.totalUsers} icon={Users} />
                <MetricCard title="Total Transactions" value={loading ? '...' : metricCounts.totalTransactions} color={metricColors.totalTransactions} icon={DollarSign} />
                <MetricCard title="Low Stock Items" value={loading ? '...' : metricCounts.lowStockItems} color={metricColors.lowStockItems} icon={AlertTriangle} />
            </div>

            {/* 2. Recent Transactions Table (Clean Material Table) */}
            <div className="material-card p-6 mt-8 bg-white rounded-xl shadow-lg border border-gray-200">
                <h2 className="text-xl font-medium text-gray-700 border-b pb-3 mb-6">Recent Transactions</h2>
                
                <table className="min-w-full divide-y divide-gray-200">
                    <thead className="bg-gray-50">
                        <tr>
                            <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">Transaction ID</th>
                            <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">Amount (RM)</th>
                            <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">Status</th>
                            <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">Date</th>
                        </tr>
                    </thead>
                    <tbody className="bg-white divide-y divide-gray-100">
                        {loading ? (
                            <tr><td colSpan="4" className="px-4 py-8 text-center text-gray-500">Loading recent transactions...</td></tr>
                        ) : recentTransactions.length === 0 ? (
                            <tr><td colSpan="4" className="px-4 py-8 text-center text-gray-500">No recent transactions found.</td></tr>
                        ) : (
                            recentTransactions.map((txn, index) => (
                                <tr key={txn.id || index} className="hover:bg-gray-50">
                                    <td className="px-4 py-3 whitespace-nowrap font-mono text-sm">{txn.id ? txn.id.substring(0, 10) + '...' : 'N/A'}</td>
                                    <td className="px-4 py-3 whitespace-nowrap font-bold text-green-600">{txn.totalAmount ? `RM${txn.totalAmount.toFixed(2)}` : 'N/A'}</td>
                                    <td className="px-4 py-3 whitespace-nowrap">
                                        <span className={`inline-flex items-center px-3 py-1 rounded-full text-xs font-medium ${
                                            txn.paymentStatus === 'Success' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
                                        }`}>
                                            {txn.paymentStatus}
                                        </span>
                                    </td>
                                    <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-500">{formatTimestamp(txn.timestamp)}</td>
                                </tr>
                            ))
                        )}
                    </tbody>
                </table>
            </div> 
        </div>
    );
};

export default AdminDashboard;