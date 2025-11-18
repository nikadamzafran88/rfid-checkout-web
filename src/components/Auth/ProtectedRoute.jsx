import React from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext'; 

// This component accepts an array of roles that are permitted to view the page
const ProtectedRoute = ({ allowedRoles, children }) => {
    const { currentUser, currentRole, loading } = useAuth();
    const location = useLocation();

    // 1. Show Loading Status
    if (loading) {
        return <div className="p-8 text-center">Checking access permissions...</div>;
    }

    // 2. Check Authentication Status
    // If user is NOT logged in, redirect them to the login page.
    if (!currentUser) {
        // Pass the current location in state so we can redirect back after login
        return <Navigate to="/login" state={{ from: location }} replace />;
    }

    // 3. Check Role Authorization
    // If the user IS logged in, check if their role is in the list of allowedRoles.
    const isAuthorized = currentRole && allowedRoles.includes(currentRole);

    if (isAuthorized) {
        // If authorized, render the requested component (children)
        return children;
    } else {
        // If unauthorized, redirect to a denied page or a default dashboard
        return <Navigate to="/unauthorized" replace />;
    }
};

export default ProtectedRoute;