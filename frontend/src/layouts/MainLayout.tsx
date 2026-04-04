import { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Outlet, Navigate, Link, useNavigate, useLocation } from 'react-router-dom';
import { Wifi, Router, Package, Users, LogOut, Ticket, Settings, Menu, X, MessageCircle, Sun, Moon, RefreshCw, Zap, Clock, ArrowRight, Activity, ChevronRight, Shield } from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import axios from 'axios';
import toast from 'react-hot-toast';
import { useTheme } from '../context/ThemeContext';
import { BackToTop } from '../components/BackToTop';
import SupportChat from '../components/SupportChat';
import ProfileModal, { renderAvatar } from '../components/ProfileModal';
import ChangePasswordModal from '../components/ChangePasswordModal';

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
  const formRef = useRef<HTMLFormElement>(null);

  // Voucher Redemption State
  const [isRedeemModalOpen, setIsRedeemModalOpen] = useState(false);
  const [voucherCode, setVoucherCode] = useState('');

  // Expiry Monitor State
  const [isExpiredModalOpen, setIsExpiredModalOpen] = useState(false);
  const warnedRef = useRef<string | null>(null); // To avoid double-toasting for the same sub
  const expiredRef = useRef<string | null>(null); // To avoid double-modals

  const redeemMutation = useMutation({
    mutationFn: async (data: { code: string; routerId: string }) => {
      const token = localStorage.getItem('token');
      const res = await axios.post(`${API_URL}/vouchers/redeem`, data, {
        headers: { Authorization: `Bearer ${token}` }
      });
      return res.data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['my_subscriptions'] });
      queryClient.invalidateQueries({ queryKey: ['active-subscription'] });
      const pkgName = data?.package?.name || 'Package';
      toast.success(`Voucher Redeemed! Activated: ${pkgName}`, {
        icon: '🎉',
        duration: 5000
      });
      setIsRedeemModalOpen(false);
      setVoucherCode('');
      // Auto-Fire Internet after redemption success
      setTimeout(() => fireInternet(), 1000);
    },
    onError: (err: any) => {
      toast.error(err.response?.data?.message || 'Voucher redemption failed');
    }
  });



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

  // Global Sync Sentinal: Monitor Recent/Active Subscription for Banner & Auto-Redirect
  const { data: allSubsData = [] } = useQuery({
    queryKey: ['active-all-subscriptions'],
    queryFn: async () => {
      if (role !== 'user' || !token) return [];
      const res = await axios.get(`${API_URL}/subscriptions/my`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      return res.data;
    },
    refetchInterval: 10000,
    enabled: role === 'user' && !!token,
  });

  // Pick the most relevant one for the quick-actions banner
  const allActiveSubs = allSubsData.filter((s: any) => 
    ['active', 'pending', 'paid', 'verified', 'allocated'].includes(s.status?.toLowerCase())
  );

  // Pick the most relevant one for the quick-actions banner:
  // Priority: 1. Running (Active + startedAt + not expired), 2. Ready (Active but no startedAt or expired)
  const activeSub = ([...allActiveSubs].sort((a: any, b: any) => {
    const aLive = a.startedAt && a.expiresAt && new Date(a.expiresAt) > new Date();
    const bLive = b.startedAt && b.expiresAt && new Date(b.expiresAt) > new Date();
    if (aLive && !bLive) return -1;
    if (!aLive && bLive) return 1;
    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
  })[0]) || null;


  const fireInternet = (customUser?: string, customPass?: string) => {
    if (!activeSub && !customUser) {
       console.log('No active sub to fire');
       return;
    }
    
    // Trigger the hidden MikroTik login form
    if (formRef.current) {
      console.log('FIRING INTERNET FORM...');
      
      // If custom credentials provided, we'd need a way to set them. 
      // For now we assume activeSub is correct or form is already populated.
      formRef.current.submit();
    }

    // Satisfy the phone's OS that we are now UNBLOCKED and redirect to trigger portal dismissal
    // We use a longer delay (2.5s) to ensure the router processes the login before the device checks
    // We use HTTP connectivity check because it's more resilient than HTTPS during the switchover
    setTimeout(() => {
      window.location.href = 'http://connectivitycheck.gstatic.com/generate_204';
    }, 2500);
  };

  // ── SESSION EXPIRY MONITOR ──
  useEffect(() => {
    if (!activeSub || !activeSub.expiresAt || !activeSub.startedAt) return;
    
    // Check if the current sub is valid and not expired
    const checkExpiry = () => {
      const expiresAt = new Date(activeSub.expiresAt).getTime();
      const now = Date.now();
      const remaining = expiresAt - now;

      // 1. Final Expiry detection
      if (remaining <= 0 && expiredRef.current !== activeSub.id) {
        setIsExpiredModalOpen(true);
        expiredRef.current = activeSub.id;
        toast.error('Session Expired!', { id: 'expiry-toast', duration: 10000 });
      }

      // 2. Pre-expiry warning (5 minutes)
      if (remaining > 0 && remaining < 300000 && warnedRef.current !== activeSub.id) {
        toast('Your session expires in less than 5 minutes!', {
          icon: '⏳',
          duration: 6000,
          id: 'warning-toast'
        });
        warnedRef.current = activeSub.id;
      }
    };

    // Run every 2 seconds for low resource usage but decent responsiveness
    const interval = setInterval(checkExpiry, 2000);
    checkExpiry();

    return () => clearInterval(interval);
  }, [activeSub?.id, activeSub?.expiresAt, activeSub?.startedAt]);

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

  // User must explicitly choose which plan to start, so automatic firing is disabled.


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

  const { data: pendingCount = 0 } = useQuery({
    queryKey: ['admin-pending-count'],
    queryFn: async () => {
      if (role !== 'admin') return 0;
      const res = await axios.get(`${API_URL}/subscriptions/pending-count`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      return res.data;
    },
    refetchInterval: 10000,
    enabled: role === 'admin',
  });

  const { data: smsBalance = 0 } = useQuery({
    queryKey: ['admin-sms-balance'],
    queryFn: async () => {
      if (role !== 'admin') return 0;
      const res = await axios.get(`${API_URL}/sms/balance`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      return res.data.balance;
    },
    refetchInterval: 30000,
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




  // Simple auth check
  if (!token) return <Navigate to="/login" replace />;
  if (role === 'admin' && userRole !== 'admin' && userRole !== 'superadmin') {
    return <Navigate to="/user/dashboard" replace />;
  }

  const handleLogout = () => {
    localStorage.clear();
    navigate('/login');
  };

  interface SidebarLink {
    name: string;
    path: string;
    icon: React.ReactNode;
    onClick?: () => void;
    permission?: string;
  }

  const adminLinks: SidebarLink[] = [
    { name: 'Dashboard', path: '/admin/dashboard', icon: <Wifi size={20} /> },
    { name: 'Routers', path: '/admin/routers', icon: <Router size={20} />, permission: 'manage_routers' },
    { name: 'Packages', path: '/admin/packages', icon: <Package size={20} />, permission: 'manage_packages' },
    { name: 'Subscriptions', path: '/admin/subscriptions', icon: <Settings size={20} />, permission: 'view_revenue' },
    { name: 'Vouchers', path: '/admin/vouchers', icon: <Ticket size={20} />, permission: 'manage_vouchers' },
    { name: 'Users', path: '/admin/users', icon: <Users size={20} />, permission: 'manage_users' },
    { name: 'Transactions', path: '/admin/transactions', icon: <Wifi size={20} />, permission: 'view_revenue' }, 
    { name: 'Staff', path: '/admin/admins', icon: <Shield size={18} />, permission: 'manage_admins' },
    { name: 'Support', path: '/admin/support', icon: <MessageCircle size={20} />, permission: 'support_chat' },
  ];

  const userLinks: SidebarLink[] = [
    { name: 'Dashboard', path: '/user/dashboard', icon: <Activity size={20} /> },
    { name: 'Browse Packages', path: '/user/packages', icon: <Package size={20} /> },
    { name: 'My Subscriptions', path: '/user/subscriptions', icon: <Wifi size={20} /> },
    { name: 'Redeem Voucher', path: '#', icon: <Ticket size={20} />, onClick: () => setIsRedeemModalOpen(true) },
  ];

  const filteredAdminLinks = adminLinks.filter(link => {
    if (!link.permission) return true;
    if (currentUser?.role === 'superadmin') return true;
    return currentUser?.permissions?.includes(link.permission);
  });

  const links = role === 'admin' ? filteredAdminLinks : userLinks;

  useEffect(() => {
    setIsMenuOpen(false);
  }, [location.pathname]);

  return (
    <div className="flex min-h-screen md:h-screen overflow-hidden bg-[var(--bg-main)]">
      
      {/* ── MOBILE NAV BAR & HAMBURGER DROPDOWN (NEW) ── */}
      <div className="md:hidden fixed top-0 left-0 right-0 z-[9990] glass-panel rounded-none border-b border-white/5 shadow-2xl">
        <div className="flex items-center justify-between p-4 relative z-20 bg-[var(--bg-panel)]">
          <div className="flex items-center gap-4">
            <button 
              onClick={() => setIsMenuOpen(!isMenuOpen)}
              className="p-2 -ml-2 text-slate-300 hover:text-white transition-all active:scale-95 flex items-center justify-center transform"
            >
              <div className={`transition-transform duration-300 ${isMenuOpen ? 'rotate-90 scale-110' : 'rotate-0'}`}>
                {isMenuOpen ? <X size={24} className="text-cyan-400" /> : <Menu size={24} />}
              </div>
            </button>
            <Link 
              to={role === 'admin' ? '/admin/dashboard' : '/user/dashboard'}
              className="font-extrabold text-lg tracking-tight text-transparent bg-clip-text bg-gradient-to-r from-cyan-400 to-blue-400"
              onClick={() => setIsMenuOpen(false)}
            >
              PulseLynk
            </Link>
          </div>
          <div className="flex items-center gap-3">
             <button 
               onClick={toggleTheme}
               className="p-2 rounded-lg bg-white/5 text-muted hover:text-cyan-400 transition-all border border-white/5"
             >
               {theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
             </button>
             <button 
               onClick={() => {
                 setIsMenuOpen(false);
                 setIsProfileModalOpen(true);
               }}
               className="flex items-center justify-center rounded-full border border-white/10 p-0.5 overflow-hidden"
             >
               {renderAvatar(currentUser?.avatar, userInitials, "w-8 h-8")}
             </button>
          </div>
        </div>

        {/* MOBILE DROPDOWN TRAY */}
        <div className={`absolute top-full left-0 right-0 glass-panel !rounded-none !border-x-0 !border-b border-b-white/10 !border-t-0 shadow-2xl overflow-hidden transition-all duration-500 ease-[cubic-bezier(0.4,0,0.2,1)] origin-top ${isMenuOpen ? 'max-h-[85vh] opacity-100' : 'max-h-0 opacity-0 pointer-events-none'}`}>
           <nav className="flex flex-col p-4 gap-2 overflow-y-auto custom-scrollbar bg-[var(--bg-panel)] backdrop-blur-3xl">
             {links.map((link) => {
               const isActive = location.pathname.startsWith(link.path);
               return (
                   <Link
                     key={link.path}
                     to={link.path}
                     onClick={(e) => {
                       setIsMenuOpen(false);
                       if (link.onClick) {
                         e.preventDefault();
                         link.onClick();
                       }
                     }}
                     className={`flex items-center gap-3 px-4 py-4 rounded-xl transition-all relative ${
                       isActive 
                       ? 'bg-gradient-to-r from-cyan-500/15 to-transparent text-cyan-400 border-l-4 border-cyan-400 font-bold shadow-[inner_0_0_20px_rgba(6,182,212,0.05)]' 
                       : 'text-muted hover:bg-white/5 hover:text-white hover:translate-x-1'
                     }`}
                   >
                     {link.icon}
                     <span className="font-semibold flex-1 tracking-tighter text-sm uppercase">{link.name}</span>
                     {link.name === 'Support' && unreadTotal > 0 && (
                       <span className="bg-red-500 text-white text-[10px] font-black px-2 py-0.5 rounded-full shadow-lg shadow-red-500/40">
                         {unreadTotal}
                       </span>
                     )}
                     {link.name === 'Subscriptions' && role === 'admin' && pendingCount > 0 && (
                       <span className="bg-amber-500 text-black text-[10px] font-black px-2 py-0.5 rounded-full shadow-lg shadow-amber-500/40">
                         {pendingCount}
                       </span>
                     )}
                   </Link>
               )
             })}
             
             {/* Log out button */}
             <button 
               onClick={() => {
                 setIsMenuOpen(false);
                 handleLogout();
               }}
               className="flex items-center gap-3 px-4 py-4 mt-2 w-full text-left rounded-xl text-muted hover:bg-red-500/10 hover:text-red-400 transition-all font-medium border border-transparent hover:border-red-500/20"
             >
               <LogOut size={20} />
               <span className="font-bold flex-1 tracking-tighter text-sm uppercase">Logout</span>
             </button>
           </nav>
        </div>
        
        {/* Dropdown Backdrop to close string clicks below the menu */}
        {isMenuOpen && (
           <div className="fixed inset-0 top-[73px] bg-black/60 z-[-1] min-h-screen" onClick={() => setIsMenuOpen(false)} />
        )}
      </div>

      {/* ── DESKTOP SIDEBAR (HIDDEN ON MOBILE) ── */}
      <aside className="hidden md:flex static inset-y-0 left-0 w-64 glass-panel shrink-0 m-4 flex-col z-[9000] border-none">
        <div className="p-6 flex items-center justify-between border-b-0">
          <Link 
            to={role === 'admin' ? '/admin/dashboard' : '/user/dashboard'} 
            className="flex items-center gap-3 group px-2 py-1 -ml-2 rounded-xl hover:bg-white/5 transition-all"
          >
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-cyan-400 via-blue-500 to-blue-600 flex items-center justify-center font-black text-white shadow-[0_0_20px_rgba(6,182,212,0.3)] group-hover:scale-110 group-hover:rotate-3 transition-all duration-500">
              PL
            </div>
            <span className="font-extrabold text-xl tracking-tighter text-transparent bg-clip-text bg-gradient-to-r from-cyan-400 to-blue-400">
              PulseLynk
            </span>
          </Link>

          <div className="flex items-center gap-2">
            <button 
              onClick={() => {
                toggleTheme();
              }}
              className="p-2 rounded-lg bg-white/5 text-muted hover:text-cyan-400 transition-all border border-white/5 active:scale-95"
              title={theme === 'dark' ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
            >
              {theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
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
                  onClick={(e) => {
                    setIsMenuOpen(false);
                    if (link.onClick) {
                      e.preventDefault();
                      link.onClick();
                    }
                  }}
                  className={`flex items-center gap-3 px-4 py-3.5 rounded-xl transition-all relative group ${
                    isActive 
                    ? 'bg-gradient-to-r from-cyan-500/15 via-cyan-500/5 to-transparent text-cyan-400 border-l-4 border-cyan-400 font-bold active-glow shadow-[inner_0_0_20px_rgba(6,182,212,0.05)]' 
                    : 'text-muted hover:bg-white/5 hover:text-white hover:translate-x-1'
                  } 
                  ${(link.name === 'Support' && unreadTotal > 0) || (link.name === 'Subscriptions' && pendingCount > 0) ? 'ring-1 ring-cyan-500/30' : ''}`}
                >
                  <div className={`relative transition-transform duration-300 ${isActive ? 'scale-110' : 'group-hover:scale-110'}`}>
                    {link.icon}
                    {link.name === 'Support' && unreadTotal > 0 && (
                      <span className="absolute -top-1 -right-1 w-2.5 h-2.5 bg-red-500 rounded-full border-2 border-slate-950 animate-ping" />
                    )}
                    {link.name === 'Support' && unreadTotal > 0 && (
                      <span className="absolute -top-1 -right-1 w-2.5 h-2.5 bg-red-500 rounded-full border-2 border-slate-950" />
                    )}
                    {link.name === 'Subscriptions' && role === 'admin' && pendingCount > 0 && (
                      <span className="absolute -top-1 -right-1 w-2.5 h-2.5 bg-amber-500 rounded-full border-2 border-slate-950 animate-pulse" />
                    )}
                  </div>
                  <span className="font-semibold flex-1 tracking-tight">{link.name}</span>
                  {link.name === 'Support' && unreadTotal > 0 && (
                    <span className="bg-red-500 text-white text-[10px] font-black px-2 py-0.5 rounded-full shadow-lg shadow-red-500/40">
                      {unreadTotal}
                    </span>
                  )}
                  {link.name === 'Subscriptions' && role === 'admin' && pendingCount > 0 && (
                    <span className="bg-amber-500 text-black text-[10px] font-black px-2 py-0.5 rounded-full shadow-lg shadow-amber-500/40">
                      {pendingCount}
                    </span>
                  )}
                </Link>
            )
          })}
        </nav>

        {role === 'user' && activeSub && (
          <div className="p-4 mx-4 mb-4 glass-panel border-cyan-500/30 bg-gradient-to-br from-cyan-950/40 to-transparent shadow-[0_8px_32px_rgba(6,182,212,0.15)]">
            <div className="flex items-center justify-between gap-2 mb-2">
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-cyan-400 animate-pulse shadow-[0_0_8px_rgba(34,211,238,0.8)]" />
                <span className="text-[10px] font-black text-cyan-400 uppercase tracking-widest">Active Session</span>
              </div>
              {allActiveSubs.length > 1 && (
                <span className="px-2 py-0.5 rounded-full bg-slate-900/80 text-white text-[9px] font-black border border-white/10 shadow-xl">
                   +{allActiveSubs.length - 1} MORE
                </span>
              )}
            </div>

            <div className="text-xs text-white font-bold truncate mb-3 tracking-tight">
              {activeSub.package?.name || 'Hotspot Plan'}
            </div>
            <button 
              onClick={() => navigate('/user/subscriptions')}
              className="w-full py-2 rounded-lg bg-cyan-500/10 text-cyan-400 hover:bg-cyan-500/20 text-[10px] font-black uppercase tracking-widest transition-all border border-cyan-500/20 flex items-center justify-center gap-2"
            >
              Control Center <ChevronRight size={12} />
            </button>
          </div>
        )}


        <div className="p-4 border-t border-white/5 space-y-2">
          <div className="flex items-center gap-2 w-full">
            <button 
              onClick={() => {
                setIsMenuOpen(false);
                setIsProfileModalOpen(true);
              }}
              className="hidden md:flex items-center gap-3 px-4 py-3 flex-1 text-left rounded-lg text-muted hover:bg-white/5 hover:text-main transition-all overflow-hidden"
            >
              {renderAvatar(currentUser?.avatar, userInitials, "w-8 h-8 flex-shrink-0")}
              <div className="flex flex-col truncate">
                <span className="font-bold text-sm truncate text-main">{currentUser?.name || currentUser?.username || 'Profile'}</span>
                <span className="text-[10px] text-cyan-400/80 uppercase tracking-wider font-bold">{role}</span>
              </div>
            </button>  </div>

          
          <button 
            onClick={() => {
              setIsMenuOpen(false);
              handleLogout();
            }}
            className="flex items-center gap-3 px-4 py-3 w-full text-left rounded-lg text-muted hover:bg-red-500/10 hover:text-red-400 transition-all font-medium"
          >
            <LogOut size={20} />
            <span className="text-main">Logout</span>
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
        className="flex-1 overflow-y-auto p-4 md:p-8 pt-24 md:pt-8 relative scroll-smooth w-full main-content-scroll"
      >
        {/* Desktop-Only Action Header (Removed Mobile Items) */}
        <header className="hidden md:flex items-center justify-end p-0 mb-10">

          {/* Icons Stack: Right aligned */}
          <div className="flex-1 flex items-center justify-end gap-4">
             {role === 'admin' && (
               <div className="hidden md:flex items-center gap-2 px-4 py-1.5 bg-emerald-500/10 border border-emerald-500/20 rounded-full shadow-[0_0_15px_rgba(16,185,129,0.1)]">
                 <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                 <span className="text-[10px] font-black text-emerald-500 uppercase tracking-widest whitespace-nowrap">SMS: {smsBalance.toLocaleString()} Units</span>
               </div>
             )}

             <button 
               onClick={() => {
                 setIsMenuOpen(false);
                 setIsRedeemModalOpen(true);
               }}
               className="p-1 px-3 text-cyan-400 hover:bg-cyan-500/10 rounded-xl transition-all flex items-center gap-2 border border-transparent hover:border-cyan-500/20 active:scale-95"
               title="Redeem Voucher"
             >
               <Ticket size={18} className="drop-shadow-[0_0_5px_rgba(6,182,212,0.5)]" />
               <span className="hidden md:inline text-[11px] font-black uppercase tracking-widest">Redeem Voucher</span>
             </button>
          </div>
        </header>

        {/* Pull to Refresh Indicator (Mobile Only) */}
        <div className="md:hidden">
          {pullDistance > 10 && (
            <div 
              className="flex flex-col items-center justify-center overflow-hidden transition-all duration-75 overflow-visible"
              style={{ height: `${pullDistance}px`, opacity: Math.min(pullDistance / 60, 1) }}
            >
              <div className="flex items-center gap-2 text-cyan-400 font-bold bg-slate-900/80 px-4 py-2 rounded-full border border-cyan-500/30 shadow-lg mb-4">
                <RefreshCw size={16} className={pullDistance > 60 ? 'animate-spin' : ''} />
                <span className="text-xs uppercase tracking-widest">{pullDistance > 60 ? 'Release to Sync' : 'Pull to Refresh'}</span>
              </div>
            </div>
          )}
        </div>


        {/* Global Hidden MikroTik Login Form */}
        {activeSub && role === 'user' && (
          <form 
            ref={formRef}
            method="post" 
            action={localStorage.getItem('hotspot_link_login') || `http://${activeSub.router?.localGateway || '10.5.50.1'}/login`}
            className="hidden"
            target="ghost-frame"
          >
            <input type="hidden" name="username" value={activeSub.mikrotikUsername} />
            <input type="hidden" name="password" value={activeSub.mikrotikPassword} />
            <input type="hidden" name="dst" value="http://connectivitycheck.gstatic.com/generate_204" />
            <input type="hidden" name="popup" value="true" />
          </form>
        )}
        <iframe name="ghost-frame" className="hidden" />

        {/* Redeem Voucher Modal */}
        {isRedeemModalOpen && createPortal(
          <div 
            className="fixed inset-0 bg-black/80 backdrop-blur-md z-[10001] flex items-center justify-center p-4"
            onMouseDown={(e) => { if (e.target === e.currentTarget) setIsRedeemModalOpen(false); }}
          >
            <div className="glass-panel w-full max-w-md animate-fade-in bg-slate-900 border border-slate-700 shadow-2xl rounded-2xl overflow-hidden">
               <div className="p-6 border-b border-white/10 flex justify-between items-center bg-gradient-to-r from-cyan-900/20 to-transparent">
                  <div className="flex items-center gap-3">
                    <Ticket className="text-cyan-400" size={20} />
                    <h3 className="text-xl font-bold text-white">Redeem Voucher</h3>
                  </div>
                  <button onClick={() => setIsRedeemModalOpen(false)} className="text-slate-400 hover:text-white transition-colors">
                    <X size={20} />
                  </button>
               </div>
               <div className="p-8 flex flex-col gap-6">
                  <p className="text-sm text-slate-400">Enter your voucher code below to instantly activate your internet plan.</p>
                  <form 
                    className="flex flex-col gap-4"
                    onSubmit={(e) => {
                      e.preventDefault();
                      const rid = localStorage.getItem('hotspot_router_id') || activeSub?.router?.id || '';
                      redeemMutation.mutate({ code: voucherCode, routerId: rid });
                    }}
                  >
                    <input 
                      autoFocus
                      className="w-full text-center tracking-[0.4em] uppercase font-mono text-3xl bg-black/40 border-slate-700 focus:border-cyan-500 rounded-xl p-4 text-cyan-400 shadow-inner"
                      value={voucherCode} 
                      onChange={e => setVoucherCode(e.target.value.toUpperCase())} 
                      placeholder="Enter code" 
                      maxLength={12}
                      required 
                    />
                    <button 
                      type="submit" 
                      disabled={redeemMutation.isPending}
                      className="btn-primary w-full py-4 text-lg font-bold shadow-lg shadow-cyan-500/20 flex items-center justify-center gap-2"
                    >
                      {redeemMutation.isPending ? <RefreshCw className="animate-spin" size={20} /> : <Zap size={20} />}
                      {redeemMutation.isPending ? 'Validating...' : 'Activate Now'}
                    </button>
                  </form>
               </div>
            </div>
          </div>,
          document.body
        )}

        {/* Session Expired Modal */}
        {isExpiredModalOpen && createPortal(
          <div className="fixed inset-0 bg-black/90 backdrop-blur-xl z-[10002] flex items-center justify-center p-4 animate-in fade-in duration-300">
            <div className="glass-panel w-full max-w-sm bg-slate-950 border border-red-500/30 shadow-[0_0_50px_rgba(239,68,68,0.2)] rounded-[2.5rem] overflow-hidden p-8 text-center">
              <div className="w-20 h-20 bg-red-500/10 rounded-3xl flex items-center justify-center mx-auto mb-6 border border-red-500/20">
                <Clock size={40} className="text-red-500 animate-pulse" />
              </div>
              
              <h3 className="text-3xl font-black text-white uppercase tracking-tighter mb-2">Session Expired</h3>
              <p className="text-slate-400 font-medium mb-8">Your internet access has been paused. Please renew your plan to stay connected.</p>
              
              <div className="space-y-3">
                <button 
                  onClick={() => {
                    setIsExpiredModalOpen(false);
                    navigate('/user/packages');
                  }}
                  className="w-full py-4 bg-gradient-to-r from-red-600 to-orange-600 text-white font-black uppercase tracking-widest rounded-2xl shadow-lg shadow-red-600/20 hover:scale-[1.02] transition-all active:scale-95 flex items-center justify-center gap-3"
                >
                  <Zap size={20} />
                  Buy New Plan
                </button>
                
                <button 
                  onClick={() => setIsExpiredModalOpen(false)}
                  className="w-full py-4 bg-slate-900 text-slate-500 font-bold uppercase tracking-widest rounded-2xl hover:text-slate-300 transition-all"
                >
                  Close
                </button>
              </div>
            </div>
          </div>,
          document.body
        )}

        <div className="animate-fade-in max-w-7xl mx-auto">
          <Outlet context={{ fireInternet, currentUser }} />
        </div>
        <BackToTop />
        {role === 'user' && <SupportChat />}
        
        {role === 'admin' && currentUser?.forcePasswordChange && (
          <ChangePasswordModal 
            userId={currentUser.id} 
            onSuccess={() => {
              const updated = { ...currentUser, forcePasswordChange: false };
              setCurrentUser(updated);
              localStorage.setItem('user', JSON.stringify(updated));
            }} 
          />
        )}

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
