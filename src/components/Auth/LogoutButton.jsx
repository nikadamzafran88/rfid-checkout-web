// src/components/Auth/LogoutButton.jsx
import React from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext.jsx';
import { LogOut } from 'lucide-react';

const LogoutButton = () => {
    const { logout } = useAuth();
    const navigate = useNavigate();

    const handleLogout = async () => {
        try {
            await logout();
            // Clear any kiosk station state so logout always goes to admin login
            try {
                localStorage.removeItem('station_id')
                localStorage.removeItem('station_authenticated')
            } catch (e) {
                console.warn('localStorage clear failed on logout', e)
            }
            navigate('/login', { replace: true });
        } catch (error) {
            console.error('Logout Failed:', error);
            alert('Failed to log out. Please try again.');
        }
    };

    return (
        <button
            onClick={handleLogout}
            className="flex items-center justify-center space-x-2 w-full py-2 bg-red-500 text-white font-medium rounded-lg shadow-sm hover:bg-red-600 transition duration-150"
        >
            <LogOut size={18} />
            <span>Log Out</span>
        </button>
    );
};

export default LogoutButton;