import React, { useEffect } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext'; 

const BlockedRedirect = ({ untilMs }) => {
    const { logout } = useAuth();
    useEffect(() => {
        // Ensure the blocked user is signed out so the login page doesn't immediately redirect.
        try { logout(); } catch { /* ignore */ }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);
    return <Navigate to="/login" state={{ blockedUntilMs: untilMs }} replace />;
};

// This component accepts an array of roles that are permitted to view the page
const ProtectedRoute = ({ allowedRoles, children }) => {
    const { currentUser, currentRole, loading, blockedUntilMs } = useAuth();
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

    // 2.5 Check temporary block
    if (blockedUntilMs && blockedUntilMs > Date.now()) {
        return <BlockedRedirect untilMs={blockedUntilMs} />;
    }

    // 3. Check Role Authorization
    // Normalize role to lowercase and check if it's in the allowedRoles list.
    const normalizedRole = (currentRole || '').toString().toLowerCase();
    const isAuthorized = normalizedRole && allowedRoles.includes(normalizedRole);

    if (isAuthorized) {
        // If authorized, render the requested component (children)
        return children;
    } else {
        // If unauthorized, redirect to a denied page or a default dashboard
        return <Navigate to="/unauthorized" replace />;
    }
};

export default ProtectedRoute;