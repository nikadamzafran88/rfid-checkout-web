import React from 'react';
import { Routes, Route } from 'react-router-dom';

// Pages
import LoginPage from './pages/Login';
import RegisterPage from './pages/Register';
import StationLogin from './pages/StationLogin';
import AdminDashboard from './pages/AdminDashboard'; 
import InventoryManagement from './pages/InventoryManagement';
import CustomerCheckout from './pages/CustomerCheckout';
import UserManagement from './pages/UserManagement'; 
import TransactionManagement from './pages/TransactionManagement';
import StripeTransactions from './pages/StripeTransactions';
import BillplzTransactions from './pages/BillplzTransactions';
import TransactionDetails from './pages/TransactionDetails'
import SoldItems from './pages/SoldItems'
import Logs from './pages/Logs';
import ProductManagement from './pages/ProductManagement';
import ProductMaster from './pages/ProductMaster';
import TagUidLink from './pages/TagUidLink';
import ProductItems from './pages/ProductItems';
import FinancialReports from './pages/FinancialReports';
import StaffAttendance from './pages/StaffAttendance';
import LeaveManagement from './pages/LeaveManagement';
import Profile from './pages/Profile';
import PublicReceipt from './pages/PublicReceipt';
import { Navigate } from 'react-router-dom';

// Protected Route
import ProtectedRoute from './components/Auth/ProtectedRoute'; 
import KioskOrAuthRoute from './components/Auth/KioskOrAuthRoute'
import { AdminThemeCustomization } from './themes'

// Mantis Main Layout
import AdminMainLayout from './components/Layout/MainLayout';
const StationManagement = React.lazy(() => import('./pages/StationManagement'));

const App = () => {
  return (
    <Routes>
      {/* Public Routes */}
      <Route path="/" element={<StationLogin />} /> 
      <Route path="/station-login" element={<StationLogin />} />
      <Route path="/login" element={<LoginPage />} />
      <Route path="/register" element={<RegisterPage />} />
      <Route path="/unauthorized" element={<h1>Access Denied!</h1>} />

      {/* Public receipt (customer phone) */}
      <Route path="/r/:token" element={<PublicReceipt />} />

      {/* Customer Checkout */}
      <Route 
        path="/checkout" 
        element={
          <KioskOrAuthRoute allowedRoles={['customer', 'staff', 'admin']}>
            <CustomerCheckout />
          </KioskOrAuthRoute>
        } 
      />

      {/* Compatibility route (older layout used /profile) */}
      <Route path="/profile" element={<Navigate to="/admin/profile" replace />} />

      {/* Admin/Staff Protected Layout */}
      <Route 
        path="/admin" 
        element={
          <AdminThemeCustomization>
            <ProtectedRoute allowedRoles={['admin', 'staff', 'manager']}>
              <AdminMainLayout />
            </ProtectedRoute>
          </AdminThemeCustomization>
        } 
      >
          <Route index element={<AdminDashboard />} /> 
          <Route path="inventory" element={<InventoryManagement />} />
          <Route path="products" element={<ProductManagement />} />
          <Route path="products/master" element={<ProductMaster />} />
          <Route path="products/tags" element={<TagUidLink />} />
          <Route path="products/items" element={<ProductItems />} />
          <Route path="profile" element={<Profile />} />
          <Route path="attendance" element={
            <ProtectedRoute allowedRoles={['admin','manager','staff']}>
              <StaffAttendance />
            </ProtectedRoute>
          } />
          <Route path="leaves" element={
            <ProtectedRoute allowedRoles={['admin','manager','staff']}>
              <LeaveManagement />
            </ProtectedRoute>
          } />
          <Route path="reports" element={
            <ProtectedRoute allowedRoles={['admin','manager']}>
              <FinancialReports />
            </ProtectedRoute>
          } />
          <Route path="transactions" element={<TransactionManagement />} />
          <Route path="transactions/stripe" element={<StripeTransactions />} />
          <Route path="transactions/billplz" element={<BillplzTransactions />} />
          <Route path="transactions/:txId" element={<TransactionDetails />} />
          <Route path="sold-items" element={<SoldItems />} />
          <Route path="stations" element={
            <ProtectedRoute allowedRoles={['admin','manager']}>
              <React.Suspense fallback={<div>Loading...</div>}>
                <StationManagement />
              </React.Suspense>
            </ProtectedRoute>
          } />
          <Route path="stations/create" element={
            <ProtectedRoute allowedRoles={['admin','manager']}>
              <React.Suspense fallback={<div>Loading...</div>}>
                <StationManagement />
              </React.Suspense>
            </ProtectedRoute>
          } />
          <Route path="users" element={<UserManagement />} /> 
          <Route path="logs" element={<Logs />} />
      </Route>

      {/* Catch-all 404 */}
      <Route path="*" element={<h1>404 Not Found</h1>} />
    </Routes>
  );
};

export default App;
