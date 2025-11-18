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
    const [loading, setLoading] = useState(true); 

    // Define logout here so it's scoped correctly
    const logout = () => {
        return auth.signOut();
    };

    useEffect(() => {
        // Firebase listener for auth state changes
        const unsubscribe = onAuthStateChanged(auth, async (user) => {
            setCurrentUser(user);
            setCurrentRole(null); // Reset role upon auth change

            if (user) {
                // START: CRITICAL FIX - Ensure loading state resolves
                try {
                    // User is logged in, now fetch their role from Firestore
                    const userRef = doc(db, 'users', user.uid);
                    const docSnap = await getDoc(userRef);

                    if (docSnap.exists()) {
                        // Update the role state
                        setCurrentRole(docSnap.data().role); 
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
            
            setLoading(false); // <--- THIS IS NOW GUARANTEED TO RUN, RESOLVING THE FREEZE
        });

        // Cleanup the subscription
        return unsubscribe;
    }, []);

    // 3. Values to be shared globally
    const value = {
        currentUser,
        currentRole,
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