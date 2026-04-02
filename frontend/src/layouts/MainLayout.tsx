import { useState, useEffect, useRef } from 'react';
import { Outlet, Navigate, Link, useNavigate, useLocation } from 'react-router-dom';
import { Wifi, Router, Package, Users, LogOut, Ticket, Settings, Menu, X, MessageCircle, Sun, Moon, RefreshCw, Zap, Clock } from 'lucide-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import axios from 'axios';
import toast from 'react-hot-toast';
import { useTheme } from '../context/ThemeContext';
import { BackToTop } from '../components/BackToTop';
import SupportChat from '../components/SupportChat';
import ProfileModal, { renderAvatar } from '../components/ProfileModal';

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

  const [userInitials, setUserInitials] = useState(role[0].toUpperCase());
  const [currentUser, setCurrentUser] = useState<any>(null);
  const [isProfileModalOpen, setIsProfileModalOpen] = useState(false);

  const queryClient = useQueryClient();
  const [pullDistance, setPullDistance] = useState(0);
  const [isPulling, setIsPulling] = useState(false);
  const startY = useRef(0);
  const mainRef = useRef<HTMLElement>(null);

  const handleTouchStart = (e: React.TouchEvent) => {
    // Only START pulling if we are precisely at the top of the content
    if (mainRef.current && mainRef.current.scrollTop <= 0) {
      startY.current = e.touches[0].pageY;
      setIsPulling(true);
    } else {
      setIsPulling(false);
    }
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (isPulling) {
      const currentY = e.touches[0].pageY;
      const diff = currentY - startY.current;
      
      // If pull is downward and we are at top
      if (diff > 0 && mainRef.current && mainRef.current.scrollTop <= 0) {
        setPullDistance(Math.min(diff / 2.8, 100)); // More resistance
      } else {
        // If they pull up, they are just naturally scrolling down
        setIsPulling(false);
        setPullDistance(0);
      }
    }
  };

  const handleTouchEnd = () => {
    if (isPulling) {
      if (pullDistance > 60) {
        toast.promise(
          queryClient.invalidateQueries(),
          {
            loading: 'Refreshing...',
            success: 'Updated!',
            error: 'Refresh failed'
          }
        );
      }
      setPullDistance(0);
      setIsPulling(false);
    }
  };

  // Automatically heal or load user details on mount
  useEffect(() => {
    const fetchProfile = async () => {
      try {
        let identifier = null;
        const userStr = localStorage.getItem('user');
        
        if (userStr) {
          const u = JSON.parse(userStr);
          setCurrentUser(u);
          identifier = u.username || u.name || u.firstName || u.phone;
        }

        // If local storage lacks the real name, fetch from backend to heal the cache
        if (!identifier && token) {
          const profileRes = await axios.get(`${API_URL}/auth/profile`, {
            headers: { Authorization: `Bearer ${token}` }
          });
          
          if (profileRes.data) {
            localStorage.setItem('user', JSON.stringify(profileRes.data));
            const u = profileRes.data;
            setCurrentUser(u);
            identifier = u.username || u.name || u.firstName || u.phone;
          }
        }
        
        if (identifier) {
          setUserInitials(identifier.substring(0, 2).toUpperCase());
        }
      } catch (err) {
        console.error('Failed to load full profile initials', err);
      }
    };
    fetchProfile();
  }, [token, API_URL]);

  // Capture Hotspot Metadata (MAC, IP, etc) from URL and save to server
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const mac = params.get('mac');
    const ip = params.get('ip');
    const routerIdentity = params.get('router'); // MikroTik router's ID or hostname
    const linkLogin = params.get('link-login') || params.get('link-login-only') || params.get('link-login-esc');
    
    if (mac || ip || routerIdentity) {
      if (mac) localStorage.setItem('hotspot_mac', mac);
      if (ip) localStorage.setItem('hotspot_ip', ip);
      if (routerIdentity) localStorage.setItem('hotspot_router_id', routerIdentity);
      if (linkLogin) localStorage.setItem('hotspot_link_login', linkLogin);

      // Save to server if logged in
      if (token) {
        axios.post(`${API_URL}/auth/heartbeat`, { mac, ip }, {
          headers: { Authorization: `Bearer ${token}` }
        }).catch(() => {}); // Silently ignore heartbeat errors
      }
    }
  }, [location.search, token, API_URL]);

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
    if (role === 'admin' && unreadTotal > 0) {
      if (!initialToastDone.current) {
        toast(`Welcome back! You have ${unreadTotal} unread support message${unreadTotal > 1 ? 's' : ''}.`, {
          icon: '🔔',
          duration: 5000,
          className: 'glass-panel',
          style: {
            borderRadius: '10px',
            background: theme === 'dark' ? '#0f172a' : '#ffffff',
            color: theme === 'dark' ? '#fff' : '#0f172a',
            border: '1px solid var(--border-color)'
          },
        });
        initialToastDone.current = true;
      } else if (unreadTotal > prevUnreadRef.current) {
        toast('New support message received!', {
          icon: '💬',
          duration: 4000,
          className: 'glass-panel',
          style: {
            borderRadius: '10px',
            background: theme === 'dark' ? '#0f172a' : '#ffffff',
            color: theme === 'dark' ? '#fff' : '#0f172a',
            border: '1px solid var(--border-color)'
          },
        });
      }
    }
  prevUnreadRef.current = unreadTotal;
  }, [unreadTotal, role, theme]);

  // Global Sync Sentinal: Monitor Active Subscription for Timer & Auto-Redirect
  const { data: activeSub = null } = useQuery({
    queryKey: ['active-subscription'],
    queryFn: async () => {
      if (role !== 'user' || !token) return null;
      const res = await axios.get(`${API_URL}/subscriptions/active`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      return res.data;
    },
    refetchInterval: 10000,
    enabled: role === 'user' && !!token,
  });

  // Auto-Redirect Sentinel: Detect Expiration and Nudge User
  useEffect(() => {
    if (role === 'user' && activeSub) {
      const isExpired = activeSub.expiresAt && new Date(activeSub.expiresAt).getTime() < Date.now();
      
      if (isExpired && location.pathname.includes('/user/subscriptions')) {
        toast('Your plan has ended. Redirecting to packages...', { icon: '⌛' });
        setTimeout(() => navigate('/user/packages'), 2000);
      }
    }
  }, [activeSub, location.pathname, navigate, role]);


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
    <div className="flex h-[118vh] md:h-screen overflow-hidden bg-[var(--bg-main)]">
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

        <div className="p-4 border-t border-white/5 space-y-2">
          {/* Desktop User Profile Button */}
          <button 
            onClick={() => setIsProfileModalOpen(true)}
            className="hidden md:flex items-center gap-3 px-4 py-3 w-full text-left rounded-lg text-slate-300 hover:bg-white/5 hover:text-white transition-all overflow-hidden"
          >
            {renderAvatar(currentUser?.avatar, userInitials, "w-8 h-8 flex-shrink-0")}
            <div className="flex flex-col truncate">
              <span className="font-bold text-sm truncate">{currentUser?.name || currentUser?.username || 'Profile'}</span>
              <span className="text-[10px] text-cyan-400/80 uppercase tracking-wider font-bold">{role}</span>
            </div>
          </button>
          
          <button 
            onClick={handleLogout}
            className="flex items-center gap-3 px-4 py-3 w-full text-left rounded-lg text-slate-400 hover:bg-red-500/10 hover:text-red-400 transition-all font-medium"
          >
            <LogOut size={20} />
            <span>Logout</span>
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <main 
        id="page-top"
        ref={mainRef}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        className="flex-1 overflow-y-auto p-4 md:p-8 relative scroll-smooth w-full main-content-scroll"
      >
        {/* Pull to Refresh Indicator */}
        {pullDistance > 10 && (
          <div 
            className="flex flex-col items-center justify-center overflow-hidden transition-all duration-75 overflow-visible"
            style={{ height: `${pullDistance}px`, opacity: Math.min(pullDistance / 60, 1) }}
          >
            <div className="flex items-center gap-2 text-cyan-400 font-bold bg-slate-900/80 px-4 py-2 rounded-full border border-cyan-500/30 shadow-lg">
              <RefreshCw size={16} className={pullDistance > 60 ? 'animate-spin' : ''} />
              <span className="text-xs uppercase tracking-widest">{pullDistance > 60 ? 'Release to Sync' : 'Pull to Refresh'}</span>
            </div>
          </div>
        )}
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
          
          <div className="flex items-center gap-3">
             {role === 'user' && activeSub && (
               <div 
                 onClick={() => navigate('/user/packages')}
                 className="flex items-center gap-2 bg-cyan-500/10 border border-cyan-500/30 px-3 py-1.5 rounded-full animate-pulse cursor-pointer hover:bg-cyan-500/20 transition-all"
               >
                 <Zap size={14} className="text-cyan-400 fill-cyan-400" />
                 <span className="text-[10px] font-black text-cyan-400 uppercase tracking-tighter">
                   {new Date(activeSub.expiresAt).getTime() < Date.now() ? 'RENEW NOW' : 'ACTIVE'}
                 </span>
               </div>
             )}
             <button 
               onClick={() => setIsProfileModalOpen(true)}
               className="flex-shrink-0 focus:outline-none transition-transform active:scale-95"
             >
               {renderAvatar(currentUser?.avatar, userInitials, "w-8 h-8")}
             </button>
           </div>
        </header>

        <div className="animate-fade-in max-w-7xl mx-auto">
          <Outlet />
        </div>
        <BackToTop />
        {role === 'user' && <SupportChat />}

        <ProfileModal 
          isOpen={isProfileModalOpen} 
          onClose={() => setIsProfileModalOpen(false)} 
          currentUser={currentUser}
          onSuccess={(u) => {
            setCurrentUser(u);
            localStorage.setItem('user', JSON.stringify(u));
            const identifier = u.username || u.name || u.firstName || u.phone;
            if (identifier) setUserInitials(identifier.substring(0, 2).toUpperCase());
            setIsProfileModalOpen(false);
          }}
        />
      </main>
    </div>
  );
}
