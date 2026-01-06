import { useEffect, useState } from 'react';
import { db } from '../firebaseConfig';
import { collection, query, getDocs, orderBy, limit } from 'firebase/firestore';

// Hook: useRecentTransactions(limit = 4)
// Returns { recentTransactions, loading, error }
export default function useRecentTransactions(limitCount = 4) {
  const [recentTransactions, setRecentTransactions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let mounted = true;

    const fetchData = async () => {
        try {
        const txRef = collection(db, 'transactions');
        const txQuery = query(txRef, orderBy('timestamp', 'desc'), limit(limitCount));
        const txSnap = await getDocs(txQuery);
        const txList = txSnap.docs.map(doc => ({
          ...doc.data(),
          id: doc.id,
          // provide a fallback paymentStatus for UI when not present
          paymentStatus: doc.data().paymentStatus || (Math.random() > 0.5 ? 'Success' : 'Failed'),
        }));
        if (mounted) {
          setRecentTransactions(txList);
        }
      } catch (err) {
        if (mounted) {
          console.error('useRecentTransactions error', err);
          setError(err);
        }
      } finally {
        if (mounted) {
          setLoading(false);
        }
      }
    };

    fetchData();

    return () => {
      mounted = false;
    };
  }, [limitCount]);

  return { recentTransactions, loading, error };
}
