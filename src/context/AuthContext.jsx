/* eslint-disable react-refresh/only-export-components */
import React, { createContext, useContext, useEffect, useState } from 'react';
import { onAuthStateChanged } from 'firebase/auth';
import { doc, getDoc } from 'firebase/firestore';
import { auth, db } from '../firebaseConfig'; // Import initialized services

// 1. Create the Context object
const AuthContext = createContext();

// Hook to easily use the context in any component
export const useAuth = () => useContext(AuthContext);

// 2. The Provider Component
export const AuthProvider = ({ children }) => {
    // State declarations
    const [currentUser, setCurrentUser] = useState(null); 
    const [currentRole, setCurrentRole] = useState(null); 
    const [blockedUntilMs, setBlockedUntilMs] = useState(0);
    const [loading, setLoading] = useState(true); 

    // Define logout here so it's scoped correctly
    const logout = () => {
        return auth.signOut();
    };

    useEffect(() => {
        // Firebase listener for auth state changes
        const unsubscribe = onAuthStateChanged(auth, async (user) => {
            console.debug('[AuthContext] onAuthStateChanged fired - user:', user);
            setCurrentUser(user);
            setCurrentRole(null); // Reset role upon auth change
            setBlockedUntilMs(0);

            if (user) {
                // START: CRITICAL FIX - Ensure loading state resolves
                try {
                    // User is logged in, now fetch their role from Firestore
                    const userRef = doc(db, 'users', user.uid);
                    const docSnap = await getDoc(userRef);

                    if (docSnap.exists()) {
                        // Update the role state (normalize to lowercase to avoid case mismatches)
                        const rawRole = docSnap.data().role;
                        const role = typeof rawRole === 'string' ? rawRole.toLowerCase() : '';
                        console.debug('[AuthContext] fetched role from Firestore (normalized):', role);
                        setCurrentRole(role);

                        // Temporary access block support
                        const rawBlockedUntil = docSnap.data().blockedUntil ?? docSnap.data().blocked_until ?? docSnap.data().blockedUntilAt ?? null;
                        let ms = 0;
                        if (rawBlockedUntil) {
                            if (typeof rawBlockedUntil === 'object' && typeof rawBlockedUntil.seconds === 'number') {
                                ms = Math.floor(rawBlockedUntil.seconds * 1000);
                            } else if (typeof rawBlockedUntil === 'string') {
                                const parsed = Date.parse(rawBlockedUntil);
                                ms = Number.isFinite(parsed) ? parsed : 0;
                            } else if (rawBlockedUntil instanceof Date) {
                                ms = rawBlockedUntil.getTime();
                            } else if (typeof rawBlockedUntil === 'number') {
                                ms = Number.isFinite(rawBlockedUntil) ? rawBlockedUntil : 0;
                            }
                        }
                        setBlockedUntilMs(ms);
                    } else {
                        // If profile is missing (e.g., partial failure), assign a default safe role
                        console.warn("User profile not found in Firestore. Assigning 'customer' role.");
                        setCurrentRole('customer'); 
                    }
                } catch (error) {
                    // CATCH: If the Firestore read fails (e.g., due to security rules or network issue)
                    console.error("Failed to fetch user role from Firestore:", error);
                    setCurrentRole('guest'); // Assign a safe role on failure
                }
                // END: CRITICAL FIX
            }
            console.debug('[AuthContext] setting loading=false, currentUser:', user);
            setLoading(false); // <--- THIS IS NOW GUARANTEED TO RUN, RESOLVING THE FREEZE
        });

        // Cleanup the subscription
        return unsubscribe;
    }, []);

    // 3. Values to be shared globally
    const value = {
        currentUser,
        currentRole,
        blockedUntilMs,
        loading,
        logout,
    };

    // 4. Render the Provider, wrapping all child components
    return (
        <AuthContext.Provider value={value}>
            {/* Display a loading screen or spinner while checking the auth status */}
            {loading ? <div>Loading Authentication...</div> : children}
        </AuthContext.Provider>
    );
};