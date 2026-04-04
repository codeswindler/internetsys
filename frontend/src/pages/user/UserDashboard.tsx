import { useState, useEffect, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useOutletContext } from 'react-router-dom';
import { format } from 'date-fns';
import toast from 'react-hot-toast';
import { Wifi, Clock, Activity, Download, Upload, Zap, RefreshCw, ChevronRight, ArrowRight, ShieldCheck, CreditCard, Smartphone, Link, Trash2, X, Search, Laptop, AlertTriangle } from 'lucide-react';
import api from '../../services/api';
import { CountdownBadge } from '../../components/CountdownBadge';

export default function UserDashboard() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const formRef = useRef<HTMLFormElement>(null);
  const { fireInternet, currentUser } = useOutletContext<{ 
    fireInternet: (u?: string, p?: string) => void,
    currentUser: any 
  }>();
  const [traffic, setTraffic] = useState<{ downloadSpeed: string, uploadSpeed: string }>({ downloadSpeed: '0 bps', uploadSpeed: '0 bps' });
  const lastTraffic = useRef<{ bytesIn: number, bytesOut: number, time: number } | null>(null);
  const [isSynced, setIsSynced] = useState(!!localStorage.getItem('hotspot_mac'));
  const [showDiscovery, setShowDiscovery] = useState(false);
  const [discoverySubId, setDiscoverySubId] = useState<string | null>(null);
  const [discoveredHosts, setDiscoveredHosts] = useState<Array<{ mac: string; ip: string; deviceName?: string }>>([]);
  const [isScanning, setIsScanning] = useState(false);
  
  // URL Parameter Capture (from Router Round-Trip)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const mac = params.get('mac');
    const ip = params.get('ip');
    const autoStartId = params.get('auto_start');

    if (mac || ip) {
      if (mac) localStorage.setItem('hotspot_mac', mac);
      if (ip) localStorage.setItem('hotspot_ip', ip);
      setIsSynced(true);
      
      // Auto-start if requested
      if (autoStartId) {
        startMutation.mutate(autoStartId);
         // Clean URL
         window.history.replaceState({}, '', window.location.pathname);
      } else {
        toast.success("Device Identified Successfully!", { id: 'url-sync' });
      }
    }
  }, [window.location.search]);
  
  // Router proximity check to prevent 10.5.50.1 timeouts
  const checkRouterProximity = async (gateway: string) => {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 2000);
      await fetch(`http://${gateway}/favicon.ico`, { 
        mode: 'no-cors', 
        signal: controller.signal,
        cache: 'no-cache'
      });
      clearTimeout(timeoutId);
      return true;
    } catch (e) {
      return false;
    }
  };

  const [localDeviceName, setLocalDeviceName] = useState('Unknown Device');
  useEffect(() => {
    const ua = navigator.userAgent;
    if (/Windows NT 10.0/.test(ua)) setLocalDeviceName('Windows 10/11');
    else if (/Windows NT/.test(ua)) setLocalDeviceName('Windows PC');
    else if (/Mac OS X/.test(ua)) setLocalDeviceName('MacBook');
    else if (/iPhone/.test(ua)) setLocalDeviceName('iPhone');
    else if (/iPad/.test(ua)) setLocalDeviceName('iPad');
    else if (/Android/.test(ua)) {
      const match = ua.match(/Android\s[0-9.]+;\s([^;]+)/);
      setLocalDeviceName(match ? match[1].trim() : 'Android Device');
    }
  }, []);

  // Unified Query Key: Centralizes the ACTIVE timer/status
  const { data: activeSubsData, isLoading: activeSubsLoading } = useQuery({
    queryKey: ['active-all-subscriptions'],
    queryFn: () => api.get('/subscriptions/my').then(res => res.data),
    refetchInterval: 5000,
  });

  const subHistory = Array.isArray(activeSubsData) ? activeSubsData : [];
  
  // Filter for ONLY actionable types: active, pending, or allocated
  const allActiveSubs = subHistory.filter((s: any) => 
    ['active', 'paid', 'pending', 'verified', 'allocated', 'awaiting_approval', 'verifying'].includes(s.status?.toLowerCase())
  );

  // Global Check: Is ANY session live?
  const isAnyLive = allActiveSubs.some((s: any) => 
    s.status === 'ACTIVE' && s.expiresAt && new Date(s.expiresAt) > new Date()
  );

  const reviewPlans = allActiveSubs.filter((s: any) => 
    s.status === 'AWAITING_APPROVAL' || s.status === 'VERIFYING'
  );

  const activeSub = allActiveSubs.find(s => s.status === 'ACTIVE');

  // Poll for real-time traffic
  useEffect(() => {
    if (!activeSub || !activeSub.startedAt) return;

    const fetchTraffic = async () => {
      try {
        const res = await api.get('/subscriptions/my/traffic');
        const data = res.data;
        if (!data) return;

        const now = Date.now();
        if (lastTraffic.current && lastTraffic.current.time) {
          const timeDiff = Math.max((now - lastTraffic.current.time) / 1000, 1);
          const bytesIn = Number(data.bytesIn) || 0;
          const bytesOut = Number(data.bytesOut) || 0;
          
          const downBits = Math.max((bytesOut - lastTraffic.current.bytesOut) * 8, 0) / timeDiff;
          const upBits = Math.max((bytesIn - lastTraffic.current.bytesIn) * 8, 0) / timeDiff;

          const formatSpeed = (bits: number) => {
            if (!bits || isNaN(bits)) return '0 bps';
            if (bits > 1000000) return (bits / 1000000).toFixed(1) + ' Mbps';
            if (bits > 1000) return (bits / 1000).toFixed(0) + ' Kbps';
            return bits.toFixed(0) + ' bps';
          };

          setTraffic({
            downloadSpeed: formatSpeed(downBits),
            uploadSpeed: formatSpeed(upBits)
          });
        }
        lastTraffic.current = { ...data, time: now };
      } catch (e) {
        console.error('Traffic poll failed', e);
      }
    };

    const interval = setInterval(fetchTraffic, 5000);
    fetchTraffic();
    return () => clearInterval(interval);
  }, [activeSub?.id, activeSub?.startedAt]);

  // Device limit modal state
  const [deviceLimitModal, setDeviceLimitModal] = useState<{
    open: boolean;
    maxDevices: number;
    connectedDevices: Array<{ id: string; mac: string; ip: string; model: string; connectedAt: string }>;
    pendingSubId: string;
  }>({ open: false, maxDevices: 1, connectedDevices: [], pendingSubId: '' });

  const startDiscovery = async (subId: string) => {
    setDiscoverySubId(subId);
    setShowDiscovery(true);
    setIsScanning(true);
    setDiscoveredHosts([]);
    try {
      const res = await api.get(`/subscriptions/${subId}/discover-hosts`);
      setDiscoveredHosts(res.data);
    } catch (e) {
      toast.error('Failed to scan for devices. Make sure you are on Wi-Fi!');
    } finally {
      setIsScanning(false);
    }
  };

  const linkDevice = (mac: string) => {
    localStorage.setItem('hotspot_mac', mac);
    setIsSynced(true);
    setShowDiscovery(false);
    toast.success('Device linked successfully! Ready to start.', { icon: '🔗' });
  };

  const startMutation = useMutation({
    mutationFn: (subId: string) => {
      const mac = localStorage.getItem('hotspot_mac');
      const ip = localStorage.getItem('hotspot_ip');
      return api.post(`/subscriptions/${subId}/start`, { mac, ip });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['active-all-subscriptions'] });
      toast.success('Internet Activated!');
      setTimeout(() => fireInternet(), 1000);
    },
    onError: (err: any, subId: string) => {
      const data = err.response?.data;
      if (data?.error === 'DEVICE_LIMIT_REACHED') {
        setDeviceLimitModal({
          open: true,
          maxDevices: data.maxDevices || 1,
          connectedDevices: data.connectedDevices || [],
          pendingSubId: subId,
        });
        toast.error(data.message || 'Device limit reached', { id: 'limit-reached' });
      } else {
        toast.error(data?.message || 'Connection failed.');
      }
    },
  });

  const disconnectMutation = useMutation({
    mutationFn: (sessionId: string) => api.post('/subscriptions/disconnect-device', { sessionId }),
    onSuccess: (_, sessionId) => {
      toast.success('Device disconnected!');
      queryClient.invalidateQueries({ queryKey: ['active-all-subscriptions'] });
      // Remove from modal list
      setDeviceLimitModal(prev => ({
        ...prev,
        connectedDevices: prev.connectedDevices.filter(d => d.id !== sessionId),
      }));
    },
    onError: (err: any) => {
      toast.error(err.response?.data?.message || 'Failed to disconnect device.');
    },
  });

  const syncMutation = useMutation({
    mutationFn: () => {
      const existingIp = localStorage.getItem('hotspot_ip');
      const existingMac = localStorage.getItem('hotspot_mac');
      return api.post('/subscriptions/sync-device', { 
        ip: existingIp || undefined,
        mac: existingMac || undefined
      });
    },
    onSuccess: (res) => {
      const { mac, ip } = res.data;
      if (mac) {
        localStorage.setItem('hotspot_mac', mac);
        if (ip) localStorage.setItem('hotspot_ip', ip);
        setIsSynced(true);
        toast.success(`Connected!`, { id: 'syncing-toast', icon: '📱' });
        queryClient.invalidateQueries({ queryKey: ['active-all-subscriptions'] });
      }
    },
    onError: (err: any) => {
      const data = err.response?.data;
      if (data?.error === 'DEVICE_LIMIT_REACHED') {
        setDeviceLimitModal({
          open: true,
          maxDevices: data.maxDevices || 1,
          connectedDevices: data.connectedDevices || [],
          pendingSubId: '', 
        });
        toast.error(data.message || 'All device slots are full.', { id: 'limit-reached' });
      } else {
        const routerGateway = activeSub?.router?.localGateway || '10.5.50.1';
        const redirectUrl = `http://${routerGateway}/login?dst=${encodeURIComponent(window.location.origin + '/user/dashboard?mac=detect')}`;
        
        toast((t) => (
          <div className="flex flex-col gap-2">
            <span className="text-sm font-medium">Auto-Sync Failed. Link this device?</span>
            <div className="flex gap-2">
              <button 
                onClick={() => { window.location.href = redirectUrl; toast.dismiss(t.id); }}
                className="bg-cyan-600 text-white text-[10px] uppercase font-bold py-1.5 px-3 rounded-lg hover:bg-cyan-500 transition-colors"
              >
                Yes, Link Device
              </button>
              <button 
                onClick={() => toast.dismiss(t.id)}
                className="bg-slate-800 text-slate-400 text-[10px] uppercase font-bold py-1.5 px-3 rounded-lg"
              >
                Try Later
              </button>
            </div>
          </div>
        ), { id: 'syncing-toast', duration: 8000 });
      }
    },
  });

  if (activeSubsLoading) return <div className="p-8 text-center text-slate-400">Loading your session...</div>;

  return (
    <div className="space-y-10 pb-20">
      {/* ── HEADER SECTION ── */}
      <div className="relative overflow-hidden rounded-[2rem] bg-gradient-to-br from-slate-900 to-slate-950 p-8 md:p-12 border border-white/5 shadow-2xl">
        <div className="absolute top-0 right-0 w-64 h-64 bg-cyan-500/10 blur-[100px] -mr-32 -mt-32 rounded-full" />
        <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-8">
          <div>
            <h1 className="text-4xl md:text-5xl font-black text-white tracking-tight leading-tight mb-4">
              Welcome Back, <span className="text-cyan-400">{currentUser?.name?.split(' ')[0] || currentUser?.username || 'Surfer'}</span>
            </h1>
            <p className="text-slate-400 text-lg max-w-xl font-medium">
              Your high-speed internet portal is ready. Manage your connections and browse without limits.
            </p>
          </div>
          <div className="flex items-center gap-4">
             <div className="p-4 bg-slate-900/60 rounded-2xl border border-white/5 shadow-xl glass-panel text-center min-w-[120px]">
                <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-1">Status</p>
                <div className="flex items-center justify-center gap-2">
                   <div className={`w-2 h-2 rounded-full ${isAnyLive ? 'bg-emerald-500 animate-pulse' : 'bg-orange-500'}`} />
                   <span className="text-sm font-bold text-white uppercase tracking-tighter">{isAnyLive ? 'Online' : 'Paused'}</span>
                </div>
             </div>
          </div>
        </div>
      </div>

      {/* ── ACTIVE CONNECTION DASHBOARD (Amazing Cards) ── */}
      <div className="space-y-6">
        <div className="flex items-center justify-between px-2">
          <div className="flex items-center gap-3">
            <Activity size={20} className="text-cyan-400 animate-pulse" />
            <h2 className="text-xs font-black text-slate-400 uppercase tracking-[0.3em]">Live Session Control</h2>
          </div>
          {allActiveSubs.length > 1 && (
            <span className="px-3 py-1 rounded-full bg-cyan-500/10 text-cyan-400 text-[10px] font-black tracking-widest border border-cyan-500/20">
               {allActiveSubs.length} ACTIVE PLANS
            </span>
          )}
        </div>

        {/* ── PENDING APPROVALS SECTION ── */}
        {reviewPlans.length > 0 && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-8">
            {reviewPlans.map((sub: any) => (
              <div key={sub.id} className="p-4 bg-amber-500/5 border border-amber-500/20 rounded-2xl flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <div className="w-10 h-10 rounded-xl bg-amber-500/10 flex items-center justify-center text-amber-500">
                    <RefreshCw className="animate-spin" size={18} />
                  </div>
                  <div>
                    <h4 className="text-xs font-black text-white uppercase tracking-widest">{sub.package?.name}</h4>
                    <p className="text-[9px] font-bold text-amber-500/70 uppercase">
                      {sub.status === 'AWAITING_APPROVAL' ? 'Awaiting Human Review' : 'Verifying M-Pesa Transaction'}
                    </p>
                  </div>
                </div>
                <div className="text-[8px] font-black text-slate-500 uppercase tracking-widest bg-slate-900 px-3 py-1 rounded-lg">
                  LOCKED
                </div>
              </div>
            ))}
          </div>
        )}

        {allActiveSubs.filter(s => !['AWAITING_APPROVAL', 'VERIFYING'].includes(s.status)).length > 0 ? (
          <div className="grid grid-cols-1 gap-6">
            {allActiveSubs.filter(s => !['AWAITING_APPROVAL', 'VERIFYING'].includes(s.status)).map((sub: any) => {
              // Robust check: If status is ACTIVE and haven't reached expiresAt, it is LIVE.
              const now = new Date();
              const isLive = sub.status === 'ACTIVE' && sub.expiresAt && new Date(sub.expiresAt) > now;
              const isDeviceLive = sub.deviceSessions?.some((ds: any) => ds.macAddress === localStorage.getItem('hotspot_mac') && ds.isActive);
              
              return (
                <div key={sub.id} className="relative group animate-in fade-in slide-in-from-bottom-5 duration-700">
                  <div className="glass-panel p-6 md:p-10 border-cyan-500/20 bg-slate-900/40 relative overflow-hidden transition-all duration-500 hover:shadow-[0_0_60px_rgba(34,211,238,0.15)] rounded-[2rem]">
                    
                    {isLive && (
                      <div className="absolute inset-0 bg-gradient-to-r from-transparent via-cyan-500/5 to-transparent -translate-x-full animate-[shimmer_4s_infinite]" />
                    )}

                    <div className="flex flex-col lg:flex-row items-center justify-between gap-10 relative z-10">
                      
                      <div className="flex items-center gap-8 w-full lg:w-auto">
                        <div className={`w-24 h-24 rounded-3xl flex items-center justify-center border transition-all duration-1000 ${isLive ? 'bg-cyan-500/10 border-cyan-500/30 text-cyan-400 shadow-[0_0_30px_rgba(34,211,238,0.2)]' : 'bg-slate-900/80 border-white/5 text-slate-700'}`}>
                          <Activity size={40} className={isLive ? 'animate-pulse' : ''} />
                        </div>

                        <div className="space-y-2">
                          <div className="flex items-center gap-3">
                            <span className={`text-[10px] font-black uppercase tracking-[0.4em] ${
                               sub.status === 'AWAITING_APPROVAL' ? 'text-amber-500' :
                               sub.status === 'VERIFYING' ? 'text-blue-400' :
                               sub.status === 'PAID' ? 'text-emerald-400' :
                               'text-slate-500'
                             }`}>
                               {isLive ? 'SYSTEM LIVE' : 
                                sub.status === 'AWAITING_APPROVAL' ? 'AWAITING ADMIN' :
                                sub.status === 'VERIFYING' ? 'VERIFYING PAYMENT' :
                                sub.status === 'PAID' ? 'READY TO START' :
                                'AWAITING START'}
                             </span>
                             {isLive && <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse ring-4 ring-emerald-500/20" />}
                             {(sub.status === 'AWAITING_APPROVAL' || sub.status === 'VERIFYING') && (
                               <RefreshCw size={12} className="text-current animate-spin opacity-50" />
                             )}
                          </div>
                          <h3 className="text-5xl font-black text-white tracking-tighter uppercase leading-none">{sub.package?.name || 'Hotspot'}</h3>
                          <div className="flex flex-col gap-1.5">
                             <p className="text-xs font-bold text-slate-400 flex items-center gap-2">
                               Router: <span className="text-white uppercase tracking-widest text-[10px]">{sub.router?.name || 'Pulselynk Edge'}</span>
                             </p>
                             <div className="flex items-center gap-2">
                               <ShieldCheck size={12} className="text-cyan-500" />
                               <span className="text-[9px] font-black text-slate-500 uppercase tracking-widest">
                                 ID: <span className="text-slate-400">{sub.id.substring(0, 8)}</span>
                               </span>
                             </div>

                             <div className="flex items-center gap-4 mt-1">
                               <div className="flex items-center gap-1.5">
                                 <Clock size={10} className="text-slate-500" />
                                 <span className="text-[9px] font-black text-slate-500 uppercase tracking-widest">
                                   Acquired: <span className="text-slate-400">{sub.createdAt ? format(new Date(sub.createdAt), 'MMM d, HH:mm') : 'Unknown'}</span>
                                 </span>
                               </div>
                               <div className="flex items-center gap-1.5">
                                 <CreditCard size={10} className="text-cyan-500/50" />
                                 <span className="text-[9px] font-black text-slate-500 uppercase tracking-widest">
                                   Via: <span className="text-cyan-400/70 capitalize">{sub.paymentMethod || 'Manual'}</span>
                                 </span>
                               </div>
                             </div>

                             {/* Connected Devices List */}
                             {(sub.deviceSessions?.filter((s: any) => s.isActive).length > 0) ? (
                               <div className="flex flex-col gap-1.5 mt-2">
                                 <div className="flex items-center gap-1.5 mb-1">
                                   <span className="text-[8px] font-black text-emerald-500 uppercase tracking-widest">
                                     DEVICES: {sub.deviceSessions.filter((s: any) => s.isActive).length}/{sub.package?.maxDevices || 1}
                                   </span>
                                 </div>
                                 {sub.deviceSessions.filter((s: any) => s.isActive).map((ds: any) => (
                                   <div key={ds.id} className="flex items-center justify-between gap-4 px-3 py-1.5 bg-slate-950/50 border border-emerald-500/10 rounded-xl group/device hover:border-emerald-500/30 transition-all max-w-sm">
                                      <div className="flex items-center gap-2">
                                        <Smartphone size={10} className="text-emerald-400" />
                                        <span className="text-[8px] font-black text-slate-300 uppercase tracking-widest leading-none">
                                          {ds.deviceModel || 'Matched Device'} <span className="text-slate-600 ml-1">({ds.macAddress?.slice(-8)})</span>
                                        </span>
                                      </div>
                                      <button 
                                        onClick={(e) => { e.stopPropagation(); disconnectMutation.mutate(ds.id); }}
                                        className="w-5 h-5 flex items-center justify-center bg-red-500/10 hover:bg-red-500/30 border border-red-500/20 rounded-lg transition-all"
                                        title="Disconnect Device"
                                      >
                                        <X size={8} className="text-red-400" />
                                      </button>
                                   </div>
                                 ))}
                               </div>
                             ) : (isSynced && localDeviceName) ? (
                               <div className="flex items-center gap-2 mt-1 px-2 py-1 bg-slate-900/50 border border-slate-800 rounded-md max-w-fit">
                                 <Smartphone size={10} className="text-blue-500" />
                                 <span className="text-[8px] font-black text-slate-400 uppercase tracking-widest">
                                   DEVICE: <span className="text-blue-300 ml-1">{localDeviceName}</span>
                                 </span>
                               </div>
                             ) : null}
                          </div>
                        </div>
                      </div>

                      <div className="flex flex-col items-center lg:items-end gap-6 w-full lg:w-auto">
                        {isLive ? (
                          <>
                            <div className="flex flex-col items-center lg:items-end">
                              <span className="text-[10px] font-black text-slate-500 uppercase tracking-[0.3em] mb-2">VALID REMAINING</span>
                              <div className="text-6xl lg:text-7xl font-black font-mono text-orange-400 tracking-tighter tabular-nums drop-shadow-[0_0_20px_rgba(251,146,60,0.2)]">
                                 <CountdownBadge expiresAt={sub.expiresAt} startedAt={sub.startedAt} variant="block" />
                              </div>
                            </div>

                            <div className="flex flex-col w-full gap-3 mt-2">
                               <div className="bg-slate-950/80 rounded-2xl px-6 py-3 border border-white/5 flex items-center justify-between gap-6 shadow-inner w-full">
                                  <div className="flex items-center gap-3">
                                    <div className="p-2 bg-cyan-500/10 rounded-lg"><Download size={14} className="text-cyan-400" /></div>
                                    <span className="text-sm font-black text-white font-mono">{traffic.downloadSpeed}</span>
                                  </div>
                                  <div className="w-px h-6 bg-white/5" />
                                  <div className="flex items-center gap-3">
                                    <div className="p-2 bg-emerald-500/10 rounded-lg"><Upload size={14} className="text-emerald-400" /></div>
                                    <span className="text-sm font-black text-white font-mono">{traffic.uploadSpeed}</span>
                                  </div>
                               </div>
                               <button 
                                 onClick={async (e) => { 
                                    e.stopPropagation(); 
                                    if (isDeviceLive) return;
                                    const gateway = sub.router?.localGateway || '10.5.50.1';

                                    if (!isSynced) { startDiscovery(sub.id); return; } if (false) {
                                       const isNear = await checkRouterProximity(gateway);
                                       if (!isNear) {
                                         toast.error("Not on PulseLynk Wi-Fi! Please connect your device to the 'PulseLynk' Wi-Fi network first to sync.", {
                                           duration: 5000,
                                           icon: '📡'
                                         });
                                         return;
                                       }
                                       window.location.href = `http://${gateway}/login?dst=${encodeURIComponent(window.location.origin + '/user/dashboard?mac=detect&auto_start=' + sub.id)}`;
                                       return;
                                    }
                                    startMutation.mutate(sub.id); 
                                 }}
                                 disabled={startMutation.isPending}
                                 className={`rounded-2xl py-3 px-6 flex items-center justify-center gap-3 transition-all duration-300 w-full active:scale-95 group/btn ${
                                   isDeviceLive 
                                     ? 'bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 cursor-default' 
                                     : 'bg-white hover:bg-zinc-100 text-black border border-white shadow-xl'
                                 }`}
                               >
                                 {startMutation.isPending ? <RefreshCw size={16} className="animate-spin text-orange-500" /> : 
                                  isDeviceLive ? <ShieldCheck size={16} className="text-emerald-500" /> :
                                  <Zap size={16} className="text-orange-500 group-hover/btn:animate-pulse" />}
                                 
                                 <span className="text-[10px] font-black uppercase tracking-[0.2em]">
                                   {startMutation.isPending ? 'Connecting...' : 
                                    isDeviceLive ? 'CONNECTED' : 
                                    'USE ON THIS DEVICE'}
                                 </span>
                               </button>
                            </div>
                          </>
                        ) : (
                             <div className="flex flex-col items-center lg:items-end gap-6 text-center lg:text-right">
                               <div className="flex flex-col items-center lg:items-end">
                                 <p className="text-[10px] text-slate-500 font-black uppercase tracking-[0.4em] mb-2">SESSION STATUS</p>
                                 <h4 className={`text-4xl font-black tracking-widest ${sub.status === 'PAID' ? 'text-emerald-400' : 'text-cyan-400'}`}>
                                   {sub.status === 'PAID' ? 'READY' : 'WAITING'}
                                 </h4>
                               </div>

                               <button 
                                 onClick={async (e) => { 
                                   e.stopPropagation(); 
                                   const gateway = sub.router?.localGateway || '10.5.50.1';
                                   
                                   if (!isSynced) { startDiscovery(sub.id); return; } if (false) {
                                      const isNear = await checkRouterProximity(gateway);
                                      if (!isNear) {
                                        toast.error("Not on PulseLynk Wi-Fi! Please connect your device to the 'PulseLynk' Wi-Fi network first.", {
                                          duration: 5000,
                                          icon: '📡'
                                        });
                                        return;
                                      }
                                      window.location.href = `http://${gateway}/login?dst=${encodeURIComponent(window.location.origin + '/user/dashboard?mac=detect&auto_start=' + sub.id)}`;
                                      return;
                                   }
                                   startMutation.mutate(sub.id); 
                                 }}
                                 disabled={startMutation.isPending}
                                 className={`w-full lg:w-64 py-5 text-sm font-black tracking-widest uppercase shadow-2xl transition-all duration-500 transform hover:scale-105 active:scale-95 flex items-center justify-center gap-4 rounded-2xl ${
                                   startMutation.isPending ? 'opacity-70 cursor-not-allowed' : 
                                   !isSynced ? 'shadow-cyan-500/40' : 'shadow-emerald-500/30'
                                 }`}
                                 style={{ 
                                   background: startMutation.isPending ? '#333' : 
                                              !isSynced ? 'linear-gradient(135deg, #0891b2 0%, #0e7490 100%)' : // Blue for Connect
                                              'linear-gradient(135deg, #10b981 0%, #059669 100%)' // Green for Start
                                 }}
                               >
                                  {startMutation.isPending ? <RefreshCw size={20} className="animate-spin text-white" /> : 
                                   !isSynced ? <Wifi size={20} className="text-white animate-pulse" /> :
                                   <Zap size={20} className="text-white" />}
                                  
                                  {startMutation.isPending ? 'AUTHORIZING...' : 
                                   !isSynced ? 'JOIN NETWORK' : 
                                   'START SESSION'}
                               </button>
                             </div>
                        )}
                        
                        <div 
                          onClick={() => navigate('/user/subscriptions')}
                          className="flex items-center gap-2 text-[10px] font-black text-slate-500 hover:text-cyan-400 uppercase tracking-[0.2em] cursor-pointer group/link transition-colors"
                        >
                           Session Details <ChevronRight size={16} className="group-hover/link:translate-x-1 transition-transform" />
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="glass-panel p-16 text-center border-dashed border-white/5 bg-slate-900/20 rounded-[2rem] animate-pulse">
            <Wifi size={48} className="mx-auto text-slate-700 mb-6" />
            <h3 className="text-2xl font-bold text-slate-500 mb-4 uppercase tracking-widest">No Active Connections</h3>
            <button 
              onClick={() => navigate('/user/packages')}
              className="px-8 py-4 bg-cyan-500/10 text-cyan-400 border border-cyan-500/20 rounded-xl font-black text-xs uppercase tracking-[0.2em] hover:bg-cyan-500 hover:text-white transition-all shadow-lg hover:shadow-cyan-500/40 transform hover:-translate-y-1"
            >
              Browse Available Plans
            </button>
          </div>
        )}
      </div>

      {/* ── QUICK ACTIONS ── */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
        <div 
          onClick={() => navigate('/user/packages')}
          className="glass-panel p-8 group cursor-pointer border border-white/5 hover:border-cyan-500/30 transition-all rounded-[2rem] bg-slate-900/40 overflow-hidden relative"
        >
          <div className="absolute top-0 right-0 p-8 text-slate-800 group-hover:text-cyan-500/10 transition-colors">
            <CreditCard size={120} strokeWidth={1} />
          </div>
          <div className="relative z-10">
            <div className="w-12 h-12 rounded-xl bg-cyan-500/10 flex items-center justify-center text-cyan-400 mb-6 group-hover:scale-110 transition-transform">
              <Zap size={24} />
            </div>
            <h3 className="text-2xl font-black text-white uppercase tracking-tight mb-2">Buy New Plan</h3>
            <p className="text-slate-400 font-medium">Browse our range of high-speed hotspot packages.</p>
          </div>
        </div>

        <div 
          onClick={() => navigate('/user/subscriptions')}
          className="glass-panel p-8 group cursor-pointer border border-white/5 hover:border-emerald-500/30 transition-all rounded-[2rem] bg-slate-900/40 overflow-hidden relative"
        >
          <div className="absolute top-0 right-0 p-8 text-slate-800 group-hover:text-emerald-500/10 transition-colors">
            <Clock size={120} strokeWidth={1} />
          </div>
          <div className="relative z-10">
            <div className="w-12 h-12 rounded-xl bg-emerald-500/10 flex items-center justify-center text-emerald-400 mb-6 group-hover:scale-110 transition-transform">
              <Clock size={24} />
            </div>
            <h3 className="text-2xl font-black text-white uppercase tracking-tight mb-2">History</h3>
            <p className="text-slate-400 font-medium">View your past sessions and usage analytics.</p>
          </div>
        </div>
      </div>

      {/* ── DEVICE LIMIT MODAL ── */}
      {deviceLimitModal.open && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-slate-900 border border-orange-500/30 rounded-3xl p-6 md:p-8 max-w-md w-full shadow-2xl shadow-orange-500/10">
            <div className="flex items-center gap-3 mb-6">
              <div className="w-12 h-12 rounded-2xl bg-orange-500/10 flex items-center justify-center">
                <Smartphone size={24} className="text-orange-400" />
              </div>
              <div>
                <h3 className="text-lg font-black text-white uppercase tracking-wide">Device Limit Reached</h3>
                <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest">
                  Max {deviceLimitModal.maxDevices} device{deviceLimitModal.maxDevices > 1 ? 's' : ''} allowed
                </p>
              </div>
            </div>

            <p className="text-sm text-slate-400 mb-6">
              Disconnect a device below to free up a slot for this device.
            </p>

            <div className="space-y-3 mb-6">
              {deviceLimitModal.connectedDevices.map((device) => (
                <div key={device.id} className="flex items-center justify-between p-4 bg-slate-950/80 border border-slate-800 rounded-2xl">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-emerald-500/10 flex items-center justify-center">
                      <Smartphone size={18} className="text-emerald-400" />
                    </div>
                    <div>
                      <p className="text-sm font-black text-white">{device.model}</p>
                      <p className="text-[9px] text-slate-500 font-mono">{device.mac}</p>
                    </div>
                  </div>
                  <button
                    onClick={() => disconnectMutation.mutate(device.id)}
                    disabled={disconnectMutation.isPending}
                    className="px-4 py-2 bg-red-500/10 border border-red-500/30 text-red-400 text-[10px] font-black uppercase tracking-widest rounded-xl hover:bg-red-500/20 transition-all active:scale-95"
                  >
                    {disconnectMutation.isPending ? <RefreshCw size={12} className="animate-spin" /> : 'Disconnect'}
                  </button>
                </div>
              ))}
            </div>

            <div className="flex gap-3">
              <button
                onClick={() => setDeviceLimitModal(prev => ({ ...prev, open: false }))}
                className="flex-1 py-3 bg-slate-800 border border-slate-700 text-slate-400 text-xs font-black uppercase tracking-widest rounded-2xl hover:bg-slate-700 transition-all"
              >
                Cancel
              </button>
              {deviceLimitModal.connectedDevices.length < deviceLimitModal.maxDevices && (
                <button
                  onClick={() => {
                    setDeviceLimitModal(prev => ({ ...prev, open: false }));
                    startMutation.mutate(deviceLimitModal.pendingSubId);
                  }}
                  className="flex-1 py-3 bg-gradient-to-r from-cyan-500 to-blue-500 text-white text-xs font-black uppercase tracking-widest rounded-2xl hover:shadow-lg hover:shadow-cyan-500/20 transition-all active:scale-95"
                >
                  Connect Now
                </button>
              )}
            </div>
          </div>
        </div>
      )}
      {/* 📡 DEVICE DISCOVERY MODAL */}
      {showDiscovery && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 sm:p-6 backdrop-blur-xl bg-slate-950/80 animate-fade-in">
          <div className="glass-panel w-full max-w-lg overflow-hidden border-cyan-500/30 bg-slate-900/90 shadow-[0_0_80px_rgba(34,211,238,0.15)] rounded-[2.5rem]">
            <div className="p-8 border-b border-white/5 flex items-center justify-between bg-white/[0.02]">
              <div>
                <h3 className="text-2xl font-black text-white tracking-tight uppercase mb-1">LINK THIS DEVICE</h3>
                <p className="text-[10px] font-bold text-muted uppercase tracking-widest opacity-60">Identify yourself in the PulseLynk network</p>
              </div>
              <button 
                onClick={() => setShowDiscovery(false)}
                className="w-10 h-10 rounded-full bg-white/5 flex items-center justify-center text-slate-400 hover:bg-white/10 hover:text-white transition-all"
              >
                <X size={20} />
              </button>
            </div>

            <div className="p-8 max-h-[60vh] overflow-y-auto custom-scrollbar">
              {isScanning ? (
                <div className="py-12 flex flex-col items-center justify-center gap-6">
                  <div className="relative">
                    <div className="w-24 h-24 rounded-full border-t-2 border-cyan-500 animate-spin" />
                    <div className="absolute inset-0 flex items-center justify-center">
                      <Search className="text-cyan-400 animate-pulse" size={32} />
                    </div>
                  </div>
                  <div className="text-center">
                    <h4 className="text-lg font-black text-white mb-2 uppercase tracking-widest">Scanning Network...</h4>
                    <p className="text-xs text-muted leading-relaxed max-w-[250px] mx-auto font-medium">Looking for connected devices on the Wi-Fi. This will only take a moment.</p>
                  </div>
                </div>
              ) : discoveredHosts.length === 0 ? (
                <div className="py-16 text-center">
                  <div className="w-20 h-20 bg-slate-800/50 rounded-full flex items-center justify-center mx-auto mb-6">
                    <AlertTriangle size={32} className="text-amber-500/50" />
                  </div>
                  <h4 className="text-xl font-black text-slate-400 mb-4 uppercase">No Devices Found</h4>
                  <p className="text-xs text-muted mb-8 leading-relaxed max-w-[280px] mx-auto font-medium">
                    We couldn't detect any newly connected devices. Please make sure you are physically connected to the <span className="text-cyan-400">PulseLynk Wi-Fi</span> on this device.
                  </p>
                  <button 
                    onClick={() => discoverySubId && startDiscovery(discoverySubId)}
                    className="btn-primary-outline px-10 py-4 text-[10px] font-black uppercase tracking-[0.2em] hover:bg-cyan-500/10"
                  >
                    Try Scan Again
                  </button>
                </div>
              ) : (
                <div className="space-y-4">
                  <p className="text-[10px] font-black text-cyan-400 uppercase tracking-widest mb-6 block text-center bg-cyan-400/5 py-3 rounded-xl border border-cyan-400/10">Select your device from the list below</p>
                  <div className="grid gap-3">
                    {discoveredHosts.map((host) => (
                      <button
                        key={host.mac}
                        onClick={() => linkDevice(host.mac)}
                        className="w-full glass-panel p-5 bg-slate-800/40 border-white/5 hover:border-cyan-500/50 hover:bg-slate-800/60 transition-all flex items-center justify-between group rounded-2xl text-left"
                      >
                        <div className="flex items-center gap-5">
                          <div className="w-12 h-12 rounded-xl bg-white/5 flex items-center justify-center text-cyan-400 group-hover:scale-110 transition-transform">
                            {host.deviceName === 'Apple' ? <Smartphone size={24} /> : <Laptop size={24} />}
                          </div>
                          <div>
                            <h5 className="font-black text-white text-sm tracking-wide uppercase mb-1">{host.deviceName || 'Neighbor Device'}</h5>
                            <div className="flex items-center gap-3">
                              <span className="text-[10px] font-bold text-slate-500 font-mono tracking-widest">{host.mac}</span>
                              {host.ip && (
                                <>
                                  <div className="w-1 h-1 rounded-full bg-slate-700" />
                                  <span className="text-[10px] font-bold text-slate-600 font-mono">{host.ip}</span>
                                </>
                              )}
                            </div>
                          </div>
                        </div>
                        <div className="w-8 h-8 rounded-full bg-cyan-500/10 flex items-center justify-center text-cyan-400 group-hover:bg-cyan-500 group-hover:text-white transition-all">
                          <ArrowRight size={16} />
                        </div>
                      </button>
                    ))}
                  </div>
                  <div className="mt-8 pt-8 border-t border-white/5 text-center px-4">
                    <p className="text-[10px] text-muted leading-relaxed font-bold uppercase tracking-widest opacity-40">
                      Don't see your device? Make sure you have connected to the Wi-Fi and refresh the scan.
                    </p>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
