import { useState, useEffect, useRef } from 'react';
import { Outlet, Navigate, Link, useNavigate, useLocation } from 'react-router-dom';
import { Wifi, Router, Package, Users, LogOut, Ticket, Settings, Menu, X, MessageCircle, Sun, Moon } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import axios from 'axios';
import toast from 'react-hot-toast';
import { useTheme } from '../context/ThemeContext';
import { BackToTop } from '../components/BackToTop';
import SupportChat from '../components/SupportChat';

interface LayoutProps {
  role: 'admin' | 'user';
}

export default function MainLayout({ role }: LayoutProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const { theme, toggleTheme } = useTheme();
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const token = localStorage.getItem('token');
  const userRole = localStorage.getItem('role');
  const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000';

  const { data: unreadTotal = 0 } = useQuery({
    queryKey: ['admin-unread-total'],
    queryFn: async () => {
      if (role !== 'admin') return 0;
      const token = localStorage.getItem('token');
      const res = await axios.get(`${API_URL}/support/admin/unread-total`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      return res.data;
    },
    refetchInterval: 10000,
    enabled: role === 'admin',
  });

  const prevUnreadRef = useRef<number>(0);
  const initialToastDone = useRef<boolean>(false);

  useEffect(() => {
    if (role === 'admin' && unreadTotal > 0 && !initialToastDone.current) {
      toast.success(`Welcome back! You have ${unreadTotal} unread support messages.`, {
        duration: 5000,
        icon: '✉️'
      });
      initialToastDone.current = true;
    }
    
    if (role === 'admin' && unreadTotal > prevUnreadRef.current && initialToastDone.current) {
      toast('🔔 New support message received!', {
        icon: '💬',
        className: 'glass-panel',
        style: {
          borderRadius: '10px',
          background: theme === 'dark' ? '#0f172a' : '#ffffff',
          color: theme === 'dark' ? '#fff' : '#0f172a',
          border: '1px solid var(--border-color)'
        },
      });
    }
    prevUnreadRef.current = unreadTotal;
  }, [unreadTotal, role]);

  // Simple auth check
  if (!token) return <Navigate to="/login" replace />;
  if (role === 'admin' && userRole !== 'admin' && userRole !== 'superadmin') {
    return <Navigate to="/user/packages" replace />;
  }

  const handleLogout = () => {
    localStorage.clear();
    navigate('/login');
  };

  const adminLinks = [
    { name: 'Dashboard', path: '/admin/dashboard', icon: <Wifi size={20} /> },
    { name: 'Routers', path: '/admin/routers', icon: <Router size={20} /> },
    { name: 'Packages', path: '/admin/packages', icon: <Package size={20} /> },
    { name: 'Subscriptions', path: '/admin/subscriptions', icon: <Settings size={20} /> },
    { name: 'Vouchers', path: '/admin/vouchers', icon: <Ticket size={20} /> },
    { name: 'Users', path: '/admin/users', icon: <Users size={20} /> },
    { name: 'Transactions', path: '/admin/transactions', icon: <Wifi size={20} /> }, // Wifi as fallback for now
    { name: 'Support', path: '/admin/support', icon: <MessageCircle size={20} /> },
  ];

  const userLinks = [
    { name: 'Browse Packages', path: '/user/packages', icon: <Package size={20} /> },
    { name: 'My Subscriptions', path: '/user/subscriptions', icon: <Wifi size={20} /> },
  ];

  const links = role === 'admin' ? adminLinks : userLinks;

  useEffect(() => {
    setIsMenuOpen(false);
  }, [location.pathname]);

  return (
    <div className="flex h-screen overflow-hidden bg-[var(--bg-main)]">
      {/* Mobile Backdrop */}
      {isMenuOpen && (
        <div 
          className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[9998] md:hidden transition-opacity duration-300 pointer-events-auto"
          onClick={() => setIsMenuOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside className={`
        fixed md:static inset-y-0 left-0 w-64 glass-panel shrink-0 m-0 md:m-4 flex flex-col z-[9999]
        transition-transform duration-300 ease-in-out border-r border-white/5 md:border-none
        ${isMenuOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'}
      `}>
        <div className="p-6 flex items-center justify-between border-b border-white/5 md:border-b-0">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-md bg-gradient-to-br from-cyan-400 to-blue-600 flex items-center justify-center font-bold text-white shadow-md">
              PL
            </div>
            <span className="font-bold text-lg tracking-wide text-transparent bg-clip-text bg-gradient-to-r from-cyan-400 to-blue-300">
              PulseLynk
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button 
              onClick={toggleTheme}
              className="p-2 mr-1 rounded-lg bg-white/5 text-slate-400 hover:text-cyan-400 hover:bg-white/10 transition-all border border-white/5"
              title={theme === 'dark' ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
            >
              {theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
            </button>
            <button 
              className="md:hidden text-slate-400 hover:text-white"
              onClick={() => setIsMenuOpen(false)}
            >
              <X size={20} />
            </button>
          </div>
        </div>
        
        <nav className="flex-1 p-4 flex flex-col gap-2 overflow-y-auto">
          {links.map((link) => {
            const isActive = location.pathname.startsWith(link.path);
            return (
              <Link
                key={link.path}
                to={link.path}
                className={`flex items-center gap-3 px-4 py-3 rounded-lg transition-all relative ${
                  isActive 
                  ? 'bg-gradient-to-r from-cyan-500/10 to-transparent text-cyan-400 border-l-2 border-cyan-400 font-bold' 
                  : 'text-muted hover:bg-slate-500/5 hover:text-main'
                } ${link.name === 'Support' && unreadTotal > 0 ? 'ring-1 ring-cyan-500/50 shadow-[0_0_15px_rgba(6,182,212,0.1)]' : ''}`}
              >
                <div className="relative">
                  {link.icon}
                  {link.name === 'Support' && unreadTotal > 0 && (
                    <span className="absolute -top-1 -right-1 w-2.5 h-2.5 bg-red-500 rounded-full border-2 border-slate-950 animate-ping" />
                  )}
                  {link.name === 'Support' && unreadTotal > 0 && (
                    <span className="absolute -top-1 -right-1 w-2.5 h-2.5 bg-red-500 rounded-full border-2 border-slate-950" />
                  )}
                </div>
                <span className="font-medium flex-1">{link.name}</span>
                {link.name === 'Support' && unreadTotal > 0 && (
                  <span className="bg-red-500 text-white text-[10px] font-bold px-2 py-0.5 rounded-full shadow-lg shadow-red-500/20">
                    {unreadTotal}
                  </span>
                )}
              </Link>
            )
          })}
        </nav>

        <div className="p-4 border-t border-white/5">
          <button 
            onClick={handleLogout}
            className="flex items-center gap-3 px-4 py-3 w-full text-left rounded-lg text-slate-400 hover:bg-red-500/10 hover:text-red-400 transition-all"
          >
            <LogOut size={20} />
            <span className="font-medium">Logout</span>
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 overflow-y-auto p-4 md:p-8 relative scroll-smooth w-full">
        {/* Mobile Header */}
        <header className="md:hidden flex items-center justify-between p-4 glass-panel mb-6 border border-white/5">
          <button 
            onClick={() => setIsMenuOpen(true)}
            className="p-2 -ml-2 text-slate-300 hover:text-white transition-colors"
          >
            <Menu size={24} />
          </button>
          
          <span className="font-bold text-lg tracking-wide text-transparent bg-clip-text bg-gradient-to-r from-cyan-400 to-blue-300">
             PulseLynk
          </span>
          
          <div className="w-8 h-8 rounded-full bg-slate-800 border border-white/10 flex items-center justify-center text-[10px] font-bold text-cyan-400 uppercase">
            {role[0]}
          </div>
        </header>

        <div className="animate-fade-in max-w-7xl mx-auto">
          <Outlet />
        </div>
        <BackToTop />
        {role === 'user' && <SupportChat />}
      </main>
    </div>
  );
}
