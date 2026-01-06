import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.jsx';
import './index.css'; 
import './App.css';
import { AuthProvider } from './context/AuthContext.jsx'; // Corrected extension
import { BrowserRouter } from 'react-router-dom'; 
import ThemeCustomization from './themes';
import ErrorBoundary from './components/ErrorBoundary';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ThemeCustomization>
      <BrowserRouter>
        {/* AuthProvider must wrap the entire application */}
        <AuthProvider>
          <ErrorBoundary>
            <App />
          </ErrorBoundary>
        </AuthProvider>
      </BrowserRouter>
    </ThemeCustomization>
  </React.StrictMode>,
);