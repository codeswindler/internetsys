import { useState, useEffect, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useOutletContext } from 'react-router-dom';
import { format } from 'date-fns';
import toast from 'react-hot-toast';
import { Wifi, Clock, Activity, Download, Upload, Zap, RefreshCw, ChevronRight, ArrowRight, ShieldCheck, CreditCard, Smartphone, Link, Trash2, Search, Laptop, AlertTriangle, Monitor, Play, Router, Settings, Activity as ActivityIcon } from 'lucide-react';
import api from '../../services/api';
import { CountdownBadge } from '../../components/CountdownBadge';
import {
  buildHotspotConnectUrl,
  consumeHotspotDeviceLimitContext,
  getStoredHotspotIdentity,
  hasStoredHotspotIdentity,
  matchesStoredHotspotIdentity,
  shouldTriggerHotspotIdentify,
  syncStoredHotspotIdentity,
} from '../../services/hotspot';

export default function UserDashboard() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [traffic, setTraffic] = useState<{ downloadSpeed: string, uploadSpeed: string }>({ downloadSpeed: '0 bps', uploadSpeed: '0 bps' });
  const lastTraffic = useRef<{ bytesIn: number, bytesOut: number, time: number } | null>(null);
  const [isSynced, setIsSynced] = useState(() => hasStoredHotspotIdentity());
  const [deviceManager, setDeviceManager] = useState<{ 
    open: boolean; 
    subId: string | null;
    isScanning: boolean;
    connectedDevices: any[];
    discoveredHosts: any[];
    maxDevices: number;
    pendingSubId: string | null;
  }>({
    open: false,
    subId: null,
    isScanning: false,
    connectedDevices: [],
    discoveredHosts: [],
    maxDevices: 1,
    pendingSubId: null
  });

  const { fireInternet, currentUser } = useOutletContext<{ 
    fireInternet: (u?: string, p?: string, options?: { subId?: string; routerIp?: string; redirectPath?: string; releaseOnly?: boolean }) => void,
    currentUser: any 
  }>();

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const deviceLimitRequested = params.get('device_limit') === '1';
    const deviceLimitSubId = params.get('subId');
    const mac = params.get('mac');
    const ip = params.get('ip');

    if (deviceLimitRequested && deviceLimitSubId) {
      const context = consumeHotspotDeviceLimitContext();
      if (context && context.subId === deviceLimitSubId) {
        setDeviceManager({
          open: true,
          subId: context.subId,
          isScanning: true,
          connectedDevices: context.connectedDevices || [],
          discoveredHosts: [],
          maxDevices: context.maxDevices || 1,
          pendingSubId: context.subId,
        });

        api.get(`/subscriptions/${deviceLimitSubId}/discover-hosts`)
          .then((res) => setDeviceManager((prev) => ({ ...prev, discoveredHosts: res.data, isScanning: false })))
          .catch(() => setDeviceManager((prev) => ({ ...prev, isScanning: false })));
      }
      window.history.replaceState({}, '', window.location.pathname);
      return;
    }

    if (mac || ip) {
      syncStoredHotspotIdentity({ mac: mac || undefined, ip: ip || undefined });
      if (currentUser?.id) {
        queryClient.invalidateQueries({ queryKey: ['active-all-subscriptions', currentUser.id] });
      }
    }

    setIsSynced(hasStoredHotspotIdentity());

    if (mac || ip) {
      toast.success('Device Identified Successfully!', { id: 'url-sync' });
      window.history.replaceState({}, '', window.location.pathname);
    }
  }, [currentUser?.id, queryClient]);
  
  const identifyCurrentDevice = (subId: string) => {
    const targetSub = allActiveSubs.find((sub: any) => sub.id === subId);
    const routerGateway = targetSub?.router?.localGateway || activeSub?.router?.localGateway || '10.5.50.1';
    window.location.replace(buildHotspotConnectUrl(
      subId,
      window.location.pathname,
      routerGateway,
      window.location.origin,
    ));
  };

  const startCurrentDevice = (subId: string) => {
    const identity = getStoredHotspotIdentity();
    if (!identity.mac && !identity.ip) {
      identifyCurrentDevice(subId);
      return;
    }

    startMutation.mutate({
      subId,
      mac: identity.mac,
      ip: identity.ip,
      currentDevice: true,
    });
  };

  const startDiscovery = async (subId: string) => {
    const targetSub = allActiveSubs.find((sub: any) => sub.id === subId);
    setDeviceManager({
      open: true,
      subId,
      isScanning: true,
      connectedDevices: targetSub?.deviceSessions?.filter((s: any) => s.isActive) || [],
      discoveredHosts: [],
      maxDevices: targetSub?.package?.maxDevices || 1,
      pendingSubId: subId
    });
    try {
      const res = await api.get(`/subscriptions/${subId}/discover-hosts`);
      setDeviceManager(prev => ({ ...prev, discoveredHosts: res.data, isScanning: false }));
    } catch (e) {
      toast.error('Failed to scan for devices. Make sure you are on Wi-Fi!');
      setDeviceManager(prev => ({ ...prev, isScanning: false }));
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
    queryKey: ['active-all-subscriptions', currentUser?.id],
    queryFn: () => api.get('/subscriptions/my').then(res => res.data),
    refetchInterval: 5000,
    enabled: !!currentUser?.id,
  });

  const subHistory = Array.isArray(activeSubsData) ? activeSubsData : [];
  
  const allActiveSubs = subHistory.filter((s: any) => 
    ['active', 'paid', 'pending', 'verified', 'allocated', 'awaiting_approval', 'verifying'].includes(s.status?.toLowerCase())
  );

  const activeSub = allActiveSubs.find(s => s.status === 'ACTIVE');

  const linkDevice = (host: { mac: string; ip?: string }) => {
    const targetSubId = deviceManager.pendingSubId || deviceManager.subId;
    if (!targetSubId) return;

    startMutation.mutate({
      subId: targetSubId,
      mac: host.mac,
      ip: host.ip,
    });
  };

  const startMutation = useMutation({
    mutationFn: ({
      subId,
      mac,
      ip,
      currentDevice,
    }: {
      subId: string;
      mac?: string;
      ip?: string;
      currentDevice?: boolean;
    }) => {
      return api.post(`/subscriptions/${subId}/start`, {
        mac,
        ip,
      });
    },
    onSuccess: (response, variables) => {
      const sub = response.data;
      syncStoredHotspotIdentity({
        mac: sub?.resolvedMac,
        ip: sub?.resolvedIp,
      });
      setIsSynced(hasStoredHotspotIdentity());
      queryClient.invalidateQueries({ queryKey: ['active-all-subscriptions', currentUser?.id] });
      setDeviceManager(prev => ({ ...prev, open: false, pendingSubId: null }));
      toast.success('Device linked successfully!');

      if (variables.currentDevice) {
        fireInternet(sub?.mikrotikUsername, sub?.mikrotikPassword, {
          subId: sub?.id || variables.subId,
          routerIp: sub?.router?.localGateway,
          redirectPath: window.location.pathname,
        });
      }
    },
    onError: (err: any, variables) => {
      if (err.response?.status === 409 && err.response?.data?.connectedDevices) {
        setDeviceManager({
          open: true,
          subId: err.response.data.subId,
          isScanning: true,
          connectedDevices: err.response.data.connectedDevices,
          discoveredHosts: [],
          maxDevices: err.response.data.maxDevices,
          pendingSubId: err.response.data.subId
        });

        api.get(`/subscriptions/${err.response.data.subId}/discover-hosts`)
          .then(res => setDeviceManager(prev => ({ ...prev, discoveredHosts: res.data, isScanning: false })))
          .catch(() => setDeviceManager(prev => ({ ...prev, isScanning: false })));
      } else if (variables.currentDevice && shouldTriggerHotspotIdentify(err)) {
        identifyCurrentDevice(variables.subId);
      } else {
        toast.error(err.response?.data?.message || 'Failed to link device');
      }
    }
  });

  const disconnectMutation = useMutation({
    mutationFn: (sessionId: string) => api.post('/subscriptions/disconnect-device', { sessionId }),
    onSuccess: (_data, sessionId) => {
      const pendingSubId = deviceManager.pendingSubId;
      toast.success('Device disconnected! Slot cleared.');
      queryClient.invalidateQueries({ queryKey: ['active-all-subscriptions', currentUser?.id] });

      setDeviceManager(prev => ({
        ...prev,
        connectedDevices: prev.connectedDevices.filter(d => d.id !== sessionId)
      }));

      if (pendingSubId) {
        setDeviceManager(prev => ({ ...prev, open: false, pendingSubId: null }));
        startCurrentDevice(pendingSubId);
      }
    }
  });
  const openDeviceManager = async (sub: any) => {
    setDeviceManager({
      open: true,
      subId: sub.id,
      isScanning: true,
      connectedDevices: sub.deviceSessions?.filter((s: any) => s.isActive) || [],
      discoveredHosts: [],
      maxDevices: sub.package?.maxDevices || 1,
      pendingSubId: null
    });

    try {
      const res = await api.get(`/subscriptions/${sub.id}/discover-hosts`);
      setDeviceManager(prev => ({ ...prev, discoveredHosts: res.data, isScanning: false }));
    } catch (e) {
      setDeviceManager(prev => ({ ...prev, isScanning: false }));
      toast.error('Scan failed. Ensure you are on Wi-Fi!');
    }
  };

  // Poll traffic for active session
  useEffect(() => {
    if (!activeSub?.id || activeSub?.status !== 'ACTIVE') return;

    const fetchTraffic = async () => {
      try {
        const res = await api.get('/subscriptions/my/traffic');
        const data = res.data;
        const now = Date.now();
        
        if (lastTraffic.current && lastTraffic.current.time && data) {
          const timeDiff = Math.max((now - lastTraffic.current.time) / 1000, 1);
          const bytesIn = Number(data.bytesIn) || 0; // Upload
          const bytesOut = Number(data.bytesOut) || 0; // Download
          
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
  }, [activeSub?.id, activeSub?.status]);

  if (activeSubsLoading) return (
    <div className="flex items-center justify-center p-20 animate-fade-in">
       <RefreshCw className="animate-spin text-cyan-500 mr-3" size={24} />
       <span className="text-muted font-black tracking-widest text-sm uppercase">Synchronizing Systems...</span>
    </div>
  );

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 md:py-12 animate-fade-in space-y-12">
      
      {/* Header Banner */}
      <div className="relative overflow-hidden rounded-[2.5rem] bg-gradient-to-br from-slate-900 to-slate-950 shadow-2xl p-8 md:p-12 transition-all duration-500 border border-white/5">
        <div className="absolute top-0 right-0 p-4 opacity-10 group">
          <Zap size={140} className="text-white transform group-hover:rotate-12 transition-transform duration-700" />
        </div>
        <div className="relative z-10 flex flex-col md:flex-row items-center justify-between gap-8">
          <div>
            <h1 className="text-5xl md:text-6xl font-black text-white tracking-tighter mb-4 !text-white">
              Welcome Back, <span className="text-cyan-400 capitalize !text-cyan-400">{currentUser?.name || 'User'}</span>
            </h1>
            <p className="text-blue-200/80 text-sm md:text-lg max-w-xl font-bold uppercase tracking-widest leading-relaxed !text-blue-100">
              Your high-speed internet portal is ready. Manage your connections and browse without limits.
            </p>
          </div>
          <div className="bg-white/10 backdrop-blur-xl border border-white/10 rounded-3xl p-8 shadow-2xl flex flex-col items-center gap-3 min-w-[200px]">
            <p className="text-[10px] font-black text-white/50 uppercase tracking-[0.2em] !text-white/60">STATUS</p>
            <div className="flex items-center gap-4">
              <div className="w-3 h-3 rounded-full bg-emerald-500 animate-pulse shadow-[0_0_15px_#10b981]" />
              <span className="text-3xl font-black text-white tracking-widest uppercase !text-white">READY</span>
            </div>
          </div>
        </div>
      </div>

      <div className="space-y-10">
        <div className="flex items-center justify-between px-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-1 rounded-full bg-cyan-500 shadow-[0_0_10px_#06b6d4]" />
            <h3 className="text-sm font-black text-main uppercase tracking-[0.3em]">LIVE SESSION CONTROL</h3>
          </div>
          <div className="text-[10px] font-black text-muted uppercase tracking-widest bg-main/5 px-4 py-2 rounded-full border border-main/5">
            {allActiveSubs.length} ACTIVE PLANS
          </div>
        </div>

        {allActiveSubs.length === 0 ? (
          <div className="glass-panel p-20 flex flex-col items-center justify-center text-center gap-6 group hover:border-cyan-500/30 transition-all border-dashed bg-opacity-20">
             <div className="w-24 h-24 rounded-full bg-main/5 flex items-center justify-center text-muted opacity-30 group-hover:scale-110 transition-transform">
               <Zap size={48} />
             </div>
             <div className="space-y-2">
               <h4 className="text-3xl font-black text-main uppercase tracking-widest opacity-30">No Active Plans</h4>
               <p className="text-xs text-muted font-bold uppercase tracking-widest opacity-40">Choose a package to get started instantly</p>
             </div>
             <button 
                onClick={() => navigate('/user/packages')}
                className="px-10 py-5 bg-gradient-to-r from-cyan-600 to-blue-600 text-white rounded-2xl font-black uppercase text-xs tracking-[0.3em] shadow-xl hover:shadow-cyan-500/20 active:scale-95 transition-all"
             >
                BROWSE PACKAGES
             </button>
             <button 
                onClick={() => queryClient.invalidateQueries({ queryKey: ['active-all-subscriptions'] })}
                className="px-10 py-5 bg-white/5 border border-white/10 text-white/40 rounded-2xl font-black uppercase text-[10px] tracking-[0.2em] hover:bg-white/10 active:scale-95 transition-all flex items-center gap-3"
             >
                <RefreshCw size={14} />
                SYNC STATUS
             </button>
          </div>
        ) : (
          <div className="grid gap-10">
            {allActiveSubs.map((sub: any) => {
               const isSubLive = sub.status === 'ACTIVE' && sub.expiresAt && new Date(sub.expiresAt) > new Date();
               const storedIdentity = getStoredHotspotIdentity();
               const activeCurrentSession = sub.deviceSessions?.find((ds: any) => matchesStoredHotspotIdentity(ds, storedIdentity));
               const isDeviceLive = !!activeCurrentSession;
               
               return (
                <div key={sub.id} className="relative group animate-fade-in">
                  <div className="glass-panel p-6 md:p-10 border-cyan-500/10 bg-opacity-40 relative overflow-hidden transition-all duration-500 hover:shadow-[0_0_50px_rgba(34,211,238,0.15)] rounded-[2.5rem]" style={{ backgroundColor: 'var(--bg-panel)' }}>
                    
                    <div className="flex flex-col lg:flex-row items-center justify-between mb-8 gap-4 px-2">
                       <div className="flex flex-col lg:flex-row items-center gap-4 lg:gap-10">
                         <div className="flex flex-col">
                           <h3 className="text-4xl font-black text-main tracking-tight leading-none capitalize">{sub.package?.name}</h3>
                           <div className="flex items-center gap-3 mt-2">
                              <div className="flex items-center gap-1.5 font-bold text-[10px] text-muted uppercase tracking-widest">
                                <Clock size={12} className="text-cyan-500/50" />
                                Acquired: <span className="opacity-80">{sub.createdAt ? format(new Date(sub.createdAt), 'MMM d, HH:mm') : 'Unknown'}</span>
                              </div>
                              <div className="w-1 h-1 rounded-full bg-slate-500/20" />
                              <div className="flex items-center gap-1.5 font-bold text-[10px] text-muted uppercase tracking-widest">
                                <CreditCard size={12} className="text-emerald-500/50" />
                                Via: <span className="text-emerald-500 opacity-60">{sub.paymentMethod || 'Manual'}</span>
                              </div>
                           </div>
                         </div>
                         <div className="flex items-center gap-2 text-xs font-bold text-muted uppercase tracking-widest opacity-60">
                           <Wifi size={14} className="text-cyan-500" />
                           Location: <span className="text-main">{sub.router?.name || 'Pulselynk'}</span>
                         </div>
                       </div>
                       <div className="flex flex-col items-center lg:items-end">
                          <p className="text-[10px] font-black text-muted uppercase tracking-[0.25em] mb-1">SESSION STATUS</p>
                          <h4 className={`text-4xl font-black tracking-[0.1em] uppercase ${isSubLive ? 'text-cyan-500' : 'text-main opacity-80'}`}>
                            {sub.status === 'PAID' ? 'READY' : sub.status}
                          </h4>
                       </div>
                    </div>

                    <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 items-center">
                      <div className="lg:col-span-4 h-full">
                        <div className="bg-opacity-20 border border-main/5 rounded-3xl p-6 h-full flex flex-col justify-center gap-6 backdrop-blur-md shadow-2xl group-hover:border-cyan-500/20 transition-colors" style={{ backgroundColor: 'var(--bg-input)' }}>
                          <div className="flex items-center gap-5">
                            <div className="w-14 h-14 rounded-2xl bg-main/5 flex items-center justify-center text-cyan-500 border border-main/10 shrink-0">
                               <Laptop size={28} />
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="text-[9px] font-black text-muted uppercase tracking-[0.25em] mb-1 truncate">THIS DEVICE</p>
                              <h4 className="text-xs font-bold text-main tracking-wide leading-relaxed truncate">
                                {activeCurrentSession?.deviceModel || localDeviceName}
                              </h4>
                              <div className="flex items-center gap-2 mt-2">
                                <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse shadow-[0_0_8px_rgba(16,185,129,0.8)]" />
                                <span className="text-[10px] font-black text-emerald-500 uppercase tracking-widest leading-none truncate">Verified Identity</span>
                              </div>
                            </div>
                          </div>
                        </div>
                      </div>

                      <div className="lg:col-span-8 space-y-4">
                        {isSubLive ? (
                          <>
                            <div className="w-full bg-cyan-950/10 border border-cyan-500/20 rounded-2xl py-6 px-10 flex items-center justify-between group-hover:bg-cyan-900/10 transition-all duration-700 relative overflow-hidden shadow-inner">
                              <div className="absolute inset-0 bg-gradient-to-r from-transparent via-cyan-400/5 to-transparent -translate-x-full animate-[shimmer_3s_infinite]" />
                              <div className="flex items-center gap-4 relative z-10">
                                <div className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-pulse" />
                                <div className="flex flex-col">
                                  <span className="text-sm font-black text-emerald-400 uppercase tracking-[0.3em]">SURFING LIVE</span>
                                  <button 
                                    onClick={async (e) => {
                                     e.stopPropagation();
                                     if (isDeviceLive) return;
                                     startCurrentDevice(sub.id);
                                    }}
                                    className={`text-left text-[9px] font-black uppercase tracking-widest transition-all underline underline-offset-4 relative z-10 ${isDeviceLive ? 'text-emerald-400/50 opacity-50 cursor-default no-underline' : 'text-cyan-500 hover:text-main'}`}
                                  >
                                    {isDeviceLive ? 'DEVICE CONNECTED' : 'CONNECT THIS DEVICE'}
                                  </button>
                                </div>
                              </div>

                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  startDiscovery(sub.id);
                                }}
                                className="relative z-20 flex items-center gap-2 px-4 py-2.5 bg-main/5 border border-main/10 rounded-xl hover:bg-main/10 hover:border-cyan-500/30 transition-all group/btn"
                              >
                                <Settings size={14} className="text-muted group-hover/btn:text-cyan-400 transition-colors" />
                                <span className="text-[10px] font-black text-muted group-hover/btn:text-main uppercase tracking-widest">
                                  MANAGE DEVICES
                                </span>
                              </button>
                            </div>

                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                              <div className="bg-main/5 rounded-2xl p-5 border border-main/5 flex flex-col items-center justify-center gap-1 shadow-inner hover:bg-main/10 transition-colors">
                                <Download size={20} className="text-cyan-400 mb-1" />
                                <span className="text-base font-black text-main">{traffic.downloadSpeed}</span>
                                <span className="text-[9px] font-bold text-muted uppercase tracking-tighter">DOWNLOAD</span>
                              </div>
                              <div className="bg-main/5 rounded-2xl p-5 border border-main/5 flex flex-col items-center justify-center gap-1 shadow-inner hover:bg-main/10 transition-colors">
                                <Upload size={20} className="text-emerald-400 mb-1" />
                                <span className="text-base font-black text-main">{traffic.uploadSpeed}</span>
                                <span className="text-[9px] font-bold text-muted uppercase tracking-tighter">UPLOAD</span>
                              </div>
                            </div>

                            <div className="w-full flex items-center justify-between px-6 pt-4 mt-2">
                               <div className="flex items-center gap-4">
                                 <div className="flex items-center gap-2">
                                   <Clock size={16} className="text-muted" />
                                   <span className="text-[11px] font-black text-muted uppercase tracking-[0.1em]">EXPIRES IN</span>
                                 </div>
                                 <CountdownBadge expiresAt={sub.expiresAt} startedAt={sub.startedAt} variant="inline" size="lg" />
                               </div>
                               <div className="flex items-center gap-2">
                                 <div className="px-6 py-2.5 rounded-full bg-cyan-500/10 border border-cyan-500/30 flex items-center gap-3">
                                   <div className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-pulse shadow-[0_0_8px_#22d3ee]" />
                                   <span className="text-[10px] font-black text-cyan-400 uppercase tracking-widest">SYSTEM LIVE</span>
                                 </div>
                                 <button
                                   onClick={(e) => {
                                     e.stopPropagation();
                                    fireInternet(sub.mikrotikUsername, sub.mikrotikPassword, {
                                      subId: sub.id,
                                      routerIp: sub.router?.localGateway,
                                      redirectPath: window.location.pathname,
                                      releaseOnly: true,
                                    });
                                     toast.success('Refreshing Handshake...');
                                   }}
                                   title="Refresh Connection Handshake"
                                   className="p-2.5 rounded-full bg-main/5 border border-main/10 hover:bg-main/10 hover:border-cyan-500/30 text-muted hover:text-cyan-400 transition-all flex items-center justify-center group"
                                  >
                                   <RefreshCw size={14} className="group-active:rotate-180 transition-transform duration-500" />
                                 </button>
                               </div>
                            </div>
                          </>
                        ) : (
                          <div className="w-full h-full flex flex-col justify-center gap-8 py-4">
                             <div className="flex flex-col items-center lg:items-start">
                                <div className="flex items-center gap-3 mb-2">
                                  <ShieldCheck size={20} className="text-cyan-500" />
                                  <h4 className="text-xl font-black text-main uppercase tracking-widest">START SESSION</h4>
                                </div>
                                <p className="text-[10px] text-muted font-bold uppercase tracking-widest">Identify yourself to begin surfing the web.</p>
                             </div>

                             <div className="flex flex-col lg:flex-row items-center gap-6 w-full">
                               <button 
                                 onClick={() => {
                                   startCurrentDevice(sub.id);
                                 }}
                                 disabled={startMutation.isPending || sub.status === 'AWAITING_APPROVAL' || sub.status === 'VERIFYING'}
                                 className={`w-full lg:flex-1 py-6 text-sm font-black tracking-[0.4em] uppercase shadow-2xl transition-all duration-500 transform hover:scale-105 active:scale-95 flex items-center justify-center gap-4 rounded-3xl ${
                                   startMutation.isPending ? 'opacity-70 cursor-not-allowed' : 
                                   !isSynced ? 'shadow-cyan-500/40' : 'shadow-emerald-500/30'
                                 }`}
                                 style={{ 
                                   background: startMutation.isPending ? '#333' : 
                                              !isSynced ? 'linear-gradient(135deg, #06b6d4 0%, #0891b2 100%)' :
                                              'linear-gradient(135deg, #10b981 0%, #059669 100%)'
                                 }}
                               >
                                {startMutation.isPending ? <RefreshCw className="animate-spin text-white" size={24} /> : 
                                 !isSynced ? <Wifi size={24} className="text-white animate-pulse" /> :
                                 <Zap size={24} className="text-white" />}
                                
                                {startMutation.isPending ? 'CONNECTING...' : 
                                 !isSynced ? 'LINK DEVICE' : 
                                 'JOIN NETWORK'}
                               </button>

                               <button 
                                 onClick={() => openDeviceManager(sub)}
                                 className="w-full lg:w-48 bg-main/5 border border-main/10 rounded-3xl px-8 py-6 text-center hover:bg-main/10 transition-all flex flex-col items-center justify-center"
                               >
                                  <p className="text-[9px] font-black text-muted uppercase tracking-widest mb-1">MANAGE</p>
                                  <div className="flex items-center gap-2">
                                     <Smartphone size={16} className="text-cyan-500" />
                                     <span className="text-xs font-black text-main">DEVICES</span>
                                  </div>
                               </button>
                             </div>

                             <div className="flex items-center justify-between w-full px-2 opacity-50">
                                <div className="flex items-center gap-2">
                                  <Router size={14} className="text-muted" />
                                  <span className="text-[9px] font-black text-muted uppercase tracking-widest">Router: {sub.router?.name}</span>
                                </div>
                                <div className="flex items-center gap-2">
                                  <RefreshCw size={14} className="text-muted" />
                                  <span className="text-[9px] font-black text-muted uppercase tracking-widest">Sync Active</span>
                                </div>
                             </div>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
               );
            })}
          </div>
        )}
      </div>

      {/* Quick Actions */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pb-12">
        <button 
          onClick={() => navigate('/user/packages')}
          className="glass-panel p-8 text-left group hover:border-cyan-500/30 transition-all active:scale-[0.98] relative overflow-hidden"
          style={{ backgroundColor: 'var(--bg-panel)' }}
        >
          <div className="absolute top-0 right-0 p-4 opacity-5 group-hover:opacity-10 transition-opacity">
            <Zap size={80} />
          </div>
          <div className="flex items-center gap-6">
            <div className="w-16 h-16 rounded-2xl bg-cyan-500/10 flex items-center justify-center text-cyan-500 border border-cyan-500/10">
              <Zap size={32} />
            </div>
            <div>
              <h4 className="text-xl font-black text-main uppercase tracking-tight mb-1">Buy New Package</h4>
              <p className="text-[10px] text-muted font-bold uppercase tracking-widest opacity-60">Instant activation for any device</p>
            </div>
            <ChevronRight className="ml-auto text-muted group-hover:text-cyan-500 transition-colors" />
          </div>
        </button>

        <button 
          onClick={() => navigate('/user/subscriptions')}
          className="glass-panel p-8 text-left group hover:border-main/20 transition-all active:scale-[0.98] relative overflow-hidden"
          style={{ backgroundColor: 'var(--bg-panel)' }}
        >
          <div className="absolute top-0 right-0 p-4 opacity-5 group-hover:opacity-10 transition-opacity">
            <Clock size={80} />
          </div>
          <div className="flex items-center gap-6">
            <div className="w-16 h-16 rounded-2xl bg-main/5 flex items-center justify-center text-muted border border-main/10">
              <Clock size={32} />
            </div>
            <div>
              <h4 className="text-xl font-black text-main uppercase tracking-tight mb-1">Session History</h4>
              <p className="text-[10px] text-muted font-bold uppercase tracking-widest opacity-60">Manage past & active plans</p>
            </div>
            <ChevronRight className="ml-auto text-muted group-hover:text-main transition-colors" />
          </div>
        </button>
      </div>

      {/* Device Manager Modal */}
      {deviceManager.open && (
        <div className="fixed inset-0 z-[1000] flex items-center justify-center p-4 backdrop-blur-[30px] bg-slate-950/60 animate-fade-in duration-500 overflow-y-auto">
          <div className="relative w-full max-w-xl mx-auto transition-all duration-700 overflow-hidden bg-white dark:bg-slate-900 border border-white/20 dark:border-white/5 shadow-[0_0_150px_rgba(34,211,238,0.25)] rounded-3xl md:rounded-[3rem]">
            {/* Header */}
            <div className="p-6 pb-4 md:p-10 md:pb-8 flex items-center justify-between relative overflow-hidden">
               <div className="absolute top-0 right-0 w-32 h-32 bg-cyan-500/10 rounded-full blur-3xl -translate-y-12 translate-x-12" />
               <div className="relative z-10">
                 <h3 className="text-3xl font-black text-slate-900 dark:text-white tracking-tighter uppercase mb-2">DEVICE MANAGER</h3>
                 <p className="text-[11px] font-black text-cyan-600 dark:text-cyan-400 uppercase tracking-[0.3em] opacity-80">
                   {deviceManager.connectedDevices.length} / {deviceManager.maxDevices} Devices Active
                 </p>
               </div>
              <button 
                onClick={() => setDeviceManager(prev => ({ ...prev, open: false }))}
                aria-label="Close device manager"
                className="w-12 h-12 md:w-14 md:h-14 rounded-full bg-white/10 dark:bg-slate-800/95 border border-white/30 flex items-center justify-center text-white shadow-lg shadow-slate-950/30 backdrop-blur-md hover:text-white hover:bg-red-500 hover:border-red-300/70 hover:scale-110 transition-all active:scale-95 group relative z-10"
              >
                <span aria-hidden className="text-[30px] font-black leading-none text-white translate-y-[-1px]">X</span>
              </button>
            </div>

            <div className="p-6 pt-0 md:p-10 md:pt-0 max-h-[70vh] overflow-y-auto custom-scrollbar space-y-10">
              
              {/* SECTION 1: CONNECTED DEVICES */}
              {deviceManager.connectedDevices.length > 0 && (
                <div className="space-y-6">
                  <div className="flex items-center gap-4">
                    <div className="w-10 h-1 rounded-full bg-emerald-500" />
                    <h4 className="text-sm font-black text-slate-900 dark:text-white uppercase tracking-widest">Active Sessions</h4>
                  </div>
                  <div className="grid gap-4">
                    {deviceManager.connectedDevices.map((device: any) => (
                      <div key={device.id} className="flex items-center justify-between p-5 bg-slate-50 dark:bg-white/5 border border-slate-100 dark:border-white/5 rounded-2xl group hover:border-red-500/20 transition-all">
                        <div className="flex items-center gap-4">
                          <div className="w-12 h-12 rounded-xl bg-emerald-500/10 flex items-center justify-center text-emerald-500 group-hover:scale-110 transition-transform">
                            <Smartphone size={24} />
                          </div>
                          <div>
                            <p className="text-sm font-black text-slate-900 dark:text-white uppercase tracking-wide">{device.model || 'Connected Device'}</p>
                            <p className="text-[10px] text-slate-400 dark:text-muted font-mono tracking-widest">{device.macAddress || device.mac || 'No MAC'}</p>
                          </div>
                        </div>
                        <button
                          onClick={() => disconnectMutation.mutate(device.id)}
                          disabled={disconnectMutation.isPending}
                          className="px-6 py-2.5 bg-red-500/10 border border-red-500/30 text-red-500 text-[10px] font-black uppercase tracking-[0.2em] rounded-xl hover:bg-red-500 hover:text-white transition-all active:scale-95 shadow-lg shadow-red-500/10"
                        >
                          {disconnectMutation.isPending ? <RefreshCw size={14} className="animate-spin" /> : 'KICK'}
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* SECTION 2: DISCOVERY */}
              <div className="space-y-6 mt-10">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-4">
                    <div className="w-10 h-1 rounded-full bg-cyan-500" />
                    <h4 className="text-sm font-black text-slate-900 dark:text-white uppercase tracking-widest">Nearby Hardware</h4>
                  </div>
                     <button
                        onClick={() => {
                          const targetSubId = deviceManager.pendingSubId || deviceManager.subId;
                          if (!targetSubId) return;
                          identifyCurrentDevice(targetSubId);
                        }}
                    className="text-[10px] font-black text-cyan-500 uppercase tracking-widest hover:underline flex items-center gap-2"
                  >
                    <RefreshCw size={12} />
                    MANUAL IDENTIFY
                  </button>
                </div>

                {deviceManager.isScanning ? (
                  <div className="py-12 flex flex-col items-center justify-center gap-6">
                    <div className="relative">
                      <div className="w-20 h-20 rounded-full border-[4px] border-cyan-500/20 border-t-cyan-500 animate-spin" />
                    </div>
                    <p className="text-[10px] font-black text-cyan-500 uppercase tracking-widest animate-pulse">Scanning Network...</p>
                  </div>
                ) : deviceManager.discoveredHosts.length === 0 ? (
                  <div className="py-10 text-center border-2 border-dashed border-slate-100 dark:border-white/5 rounded-[2rem]">
                    <p className="text-xs text-slate-400 dark:text-muted font-bold uppercase tracking-widest opacity-60">No new devices detected</p>
                    <button 
                      onClick={() => openDeviceManager({ id: deviceManager.subId, package: { maxDevices: deviceManager.maxDevices } })}
                      className="mt-4 text-[10px] font-black text-cyan-500 uppercase tracking-[0.2em] hover:underline"
                    >
                      RE-SCAN
                    </button>
                  </div>
                ) : (
                  <div className="grid gap-4">
                    {deviceManager.discoveredHosts.map((host) => (
                      <button
                        key={host.mac}
                        onClick={() => linkDevice(host)}
                        className="w-full relative group transition-all duration-500 active:scale-95 text-left"
                      >
                        <div className="p-6 rounded-2xl bg-slate-50 dark:bg-slate-800/40 border border-slate-100 dark:border-white/5 group-hover:border-cyan-500/40 flex items-center justify-between">
                          <div className="flex items-center gap-5">
                            <div className="w-14 h-14 rounded-2xl bg-white dark:bg-slate-950 flex items-center justify-center text-cyan-500 border border-slate-100 dark:border-white/5 shadow-sm">
                              {host.deviceName?.toLowerCase().includes('laptop') ? <Laptop size={28} /> : <Smartphone size={28} />}
                            </div>
                            <div>
                               <h5 className="font-black text-slate-900 dark:text-white text-base tracking-tighter uppercase mb-1">{host.deviceName || 'Neighbor Device'}</h5>
                               <span className="text-[10px] font-black text-slate-400 dark:text-muted font-mono tracking-widest">{host.mac}</span>
                            </div>
                          </div>
                          <ArrowRight className="text-cyan-500 opacity-0 group-hover:opacity-100 transition-all" size={20} />
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Footer */}
            <div className="p-8 bg-slate-50 dark:bg-slate-950/20 border-t border-slate-100 dark:border-white/5 flex items-center justify-center">
               <div className="flex items-center gap-3">
                  <ShieldCheck className="text-emerald-500" size={16} />
                  <span className="text-[9px] font-black text-slate-400 dark:text-muted uppercase tracking-[0.2em]">Secure Hardware Isolation</span>
               </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
