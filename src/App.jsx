import React from 'react';
import { Routes, Route } from 'react-router-dom';

// Import your pages
import LoginPage from './pages/Login';
import RegisterPage from './pages/Register';
import AdminDashboard from './pages/AdminDashboard'; 
import InventoryManagement from './pages/InventoryManagement';
import CustomerCheckout from './pages/CustomerCheckout';
import UserManagement from './pages/UserManagement'; 
import TransactionManagement from './pages/TransactionManagement';

// Import the ProtectedRoute and AdminLayout components
import ProtectedRoute from './components/Auth/ProtectedRoute'; 
import AdminLayout from './components/Layout/AdminLayout'; 

const App = () => {
  return (
    <Routes>
      {/* -------------------- Public Routes -------------------- */}
      <Route path="/" element={<LoginPage />} /> 
      <Route path="/login" element={<LoginPage />} />
      <Route path="/register" element={<RegisterPage />} />
      <Route path="/unauthorized" element={<h1>Access Denied!</h1>} />

      {/* -------------------- Customer Checkout Route -------------------- */}
      <Route 
        path="/checkout" 
        element={
          <ProtectedRoute allowedRoles={['customer', 'staff', 'admin']}>
            <CustomerCheckout />
          </ProtectedRoute>
        } 
      />

      {/* -------------------- Admin/Staff Protected Layout -------------------- */}
      <Route 
        path="/admin" 
        element={
          <ProtectedRoute allowedRoles={['admin', 'staff']}>
            <AdminLayout />
          </ProtectedRoute>
        } 
      >
          {/* Dashboard - Landing page for /admin (Index Route) */}
          <Route index element={<AdminDashboard />} /> 
          
          {/* Inventory Management */}
          <Route path="inventory" element={<InventoryManagement />} />

          {/* Transaction Management */}
          <Route path="transactions" element={<TransactionManagement />} />

          {/* User Management */}
          <Route path="users" element={<UserManagement />} /> 
          
          {/* Placeholder for Logs */}
          <Route path="logs" element={<div className="p-8 text-xl">View Logs Module</div>} />

      </Route>

      {/* Catch-all route for 404 */}
      <Route path="*" element={<h1>404 Not Found</h1>} />
    </Routes>
  );
};

export default App;