import React, { useState, useEffect } from 'react';
import { db } from '../firebaseConfig';
import { collection, getDocs, doc, updateDoc } from 'firebase/firestore';

const UserManagement = () => {
    const [userList, setUserList] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);

    const usersCollectionRef = collection(db, 'users');
    const ROLES = ['admin', 'staff', 'customer']; // Defined roles in the system

    // 1. Fetch All Users Function
    const fetchUsers = async () => {
        setLoading(true);
        setError(null);
        try {
            const data = await getDocs(usersCollectionRef);
            const list = data.docs.map(doc => ({ 
                ...doc.data(), 
                id: doc.id 
            }));
            setUserList(list);
        } catch (err) {
            console.error("Error fetching users:", err);
            setError("Failed to load user data. Check console for rules error.");
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchUsers();
    }, []);

    // 2. Update User Role Function
    const handleRoleChange = async (userId, newRole) => {
        if (!ROLES.includes(newRole)) {
            alert("Invalid role selected.");
            return;
        }

        if (window.confirm(`Are you sure you want to change user role to ${newRole}?`)) {
            try {
                const userRef = doc(db, 'users', userId);
                await updateDoc(userRef, { role: newRole });
                
                // Update the local state to reflect the change immediately
                setUserList(prevList => 
                    prevList.map(user => 
                        user.id === userId ? { ...user, role: newRole } : user
                    )
                );
                alert(`User role updated to ${newRole}.`);
            } catch (err) {
                console.error("Error updating role:", err);
                setError("Failed to update user role. You may lack sufficient permissions (Admin access required).");
            }
        }
    };

    // -------------------- RENDER LOGIC --------------------

    if (loading) return <div className="p-8 text-center text-xl text-gray-600">Loading Users...</div>;
    if (error && !loading) return <div className="p-8 text-red-600">{error}</div>;

    return (
        <div className="p-4">
            <h1 className="text-3xl font-normal text-gray-800 mb-8 uppercase">Manage Users</h1>
            
            <div className="bg-white p-6 rounded-xl shadow-lg border border-gray-200">
                <h2 className="text-xl font-medium mb-6 text-gray-700 border-b pb-3">All System Users ({userList.length})</h2>
                <div className="overflow-x-auto">
                    <table className="min-w-full divide-y divide-gray-200">
                        <thead className="bg-gray-50">
                            <tr>
                                <th className="px-6 py-3 text-left text-xs font-semibold text-gray-800 uppercase tracking-wider">Name</th>
                                <th className="px-6 py-3 text-left text-xs font-semibold text-gray-800 uppercase tracking-wider">Email</th>
                                <th className="px-6 py-3 text-left text-xs font-semibold text-gray-800 uppercase tracking-wider">Current Role</th>
                                <th className="px-6 py-3 text-center text-xs font-semibold text-gray-800 uppercase tracking-wider">Action</th>
                            </tr>
                        </thead>
                        <tbody className="bg-white divide-y divide-gray-100">
                            {userList.map((user) => (
                                <tr key={user.id} className="hover:bg-gray-50">
                                    <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">{user.fullName}</td>
                                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600">{user.email}</td>
                                    <td className="px-6 py-4 whitespace-nowrap">
                                        <span className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${
                                            user.role === 'admin' ? 'bg-indigo-100 text-indigo-800' : 
                                            user.role === 'staff' ? 'bg-green-100 text-green-800' : 
                                            'bg-gray-100 text-gray-800'
                                        }`}>
                                            {user.role}
                                        </span>
                                    </td>
                                    <td className="px-6 py-4 whitespace-nowrap text-center text-sm">
                                        <select
                                            onChange={(e) => handleRoleChange(user.id, e.target.value)}
                                            value={user.role}
                                            className="p-2 border border-gray-300 rounded text-sm focus:border-indigo-500"
                                        >
                                            <option value="" disabled>Change Role</option>
                                            {ROLES.map(role => (
                                                <option key={role} value={role}>Set to {role}</option>
                                            ))}
                                        </select>
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

export default UserManagement;