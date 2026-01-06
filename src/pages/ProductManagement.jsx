import React from 'react';
import { Navigate } from 'react-router-dom';

const ProductManagement = () => {
  return <Navigate to="/admin/products/master" replace />;
};

export default ProductManagement;