import React from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import LogoutButton from '../Auth/LogoutButton';
import { useAuth } from '../../context/AuthContext.jsx';
import { Home, Package, ListOrdered, Users, ShoppingCart, FileText, LogOut, Bell, Search } from 'lucide-react'; // Added Bell and Search

const NavItem = ({ to, icon: Icon, label }) => (
    <NavLink 
        to={to} 
        // Material Standard: Dark Sidebar, Primary Accent on Active Link, Rounded Edges
        className={({ isActive }) => 
            `flex items-center space-x-4 p-3 rounded-lg transition duration-200 mx-3 ${
                isActive 
                    ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-600/50' // Active Link Style (Elevated)
                    : 'text-gray-300 hover:text-white hover:bg-gray-700' // Inactive Link Style
            }`
        }
    >
        <Icon size={20} />
        <span className="font-medium">{label}</span>
    </NavLink>
);

const AdminLayout = () => {
    const { currentRole } = useAuth();

    const navigationItems = [
        { path: '/admin', icon: Home, label: 'Dashboard' }, 
        { path: '/admin/users', icon: Users, label: 'Manage Users' },
        { path: '/admin/transactions', icon: ListOrdered, label: 'View Transactions' },
        { path: '/admin/inventory', icon: Package, label: 'Manage Inventory' },
        { path: '/admin/logs', icon: FileText, label: 'View Logs' }, 
    ];
    
    const filteredItems = currentRole === 'staff'
        ? navigationItems.filter(item => item.label !== 'Manage Users' && item.label !== 'View Logs')
        : navigationItems;

    return (
        <div className="flex min-h-screen">
            {/* Sidebar (Dark Theme - Matching Material Standard) */}
            <div className="w-64 bg-gray-900 shadow-2xl sticky top-0 h-screen flex flex-col">
                
                {/* Logo/Header Bar */}
                <div className="text-white p-6 border-b border-gray-700 text-center">
                    <h1 className="text-2xl font-bold">M&M <span className="font-light">RSCS</span></h1>
                </div>

                {/* Navigation Links */}
                <nav className="flex flex-col flex-grow pt-4 space-y-1">
                    {filteredItems.map(item => (
                        <NavItem key={item.path} {...item} />
                    ))}
                </nav>
                
                <div className="p-4 border-t border-gray-700 mt-auto">
                    <a href="/checkout" className="flex items-center space-x-4 p-3 rounded-lg transition duration-200 text-gray-300 hover:text-white hover:bg-gray-700 mb-3">
                        <ShoppingCart size={18} />
                        <span className="text-sm font-medium">Customer Kiosk</span>
                    </a>
                    
                    <p className="text-xs text-gray-400 mb-2 uppercase font-semibold text-center">
                        {currentRole} Access
                    </p>
                    <LogoutButton icon={LogOut} /> 
                </div>
            </div>

            {/* Main Content Area (Light Background) */}
            <main className="flex-1 p-8 overflow-auto bg-gray-100">
                
                {/* Topbar: Matching the template's search/profile header */}
                <div className="flex justify-between items-center bg-white p-4 rounded-xl shadow-md mb-8 sticky top-0 z-10">
                    <h2 className="text-sm font-medium text-gray-700">Dashboard / Home</h2>
                    <div className="flex items-center space-x-4">
                        <div className="relative">
                            <Search size={16} className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" />
                            <input type="text" placeholder="Search" className="border border-gray-300 rounded-md pl-10 pr-3 py-1.5 text-sm focus:ring-indigo-500 focus:border-indigo-500" />
                        </div>
                        <Bell size={20} className="text-gray-600 cursor-pointer hover:text-indigo-600" />
                        <span className="text-gray-600 text-sm font-medium border-l pl-4">Sign In</span>
                        <div className="h-8 w-8 rounded-full bg-indigo-500 flex items-center justify-center text-white text-sm font-bold">NA</div>
                    </div>
                </div>
                
                <Outlet /> 
            </main>
        </div>
    );
};

export default AdminLayout;