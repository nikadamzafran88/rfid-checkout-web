import React from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'

// Allows access if either a kiosk station is configured in localStorage OR
// the current user is authenticated with one of the allowed roles.
const KioskOrAuthRoute = ({ allowedRoles = [], children }) => {
  const { currentUser, currentRole, loading } = useAuth()
  const location = useLocation()

  // If loading auth state, show a simple placeholder
  if (loading) return <div className="p-8 text-center">Checking access permissions...</div>

  // 1) Kiosk path: check localStorage for station_id
  try {
    const stationId = localStorage.getItem('station_id')
    if (stationId) return children
  } catch (e) {
    // ignore storage errors
    console.warn('localStorage unavailable', e)
  }

  // 2) Authenticated user path — reuse existing role checking logic
  if (!currentUser) {
    return <Navigate to="/login" state={{ from: location }} replace />
  }

  const normalizedRole = (currentRole || '').toString().toLowerCase()
  const isAuthorized = normalizedRole && allowedRoles.includes(normalizedRole)

  if (isAuthorized) return children

  return <Navigate to="/unauthorized" replace />
}

export default KioskOrAuthRoute
