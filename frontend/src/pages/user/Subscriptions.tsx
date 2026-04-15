import { useState, useEffect, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useOutletContext } from 'react-router-dom';
import { format } from 'date-fns';
import toast from 'react-hot-toast';
import { Wifi, Clock, CreditCard, Smartphone, ShieldCheck, Download, Upload, Zap, RefreshCw, ChevronRight, Laptop, Monitor, ArrowRight, X, Search, AlertTriangle, Monitor as MonitorIcon, Laptop as LaptopIcon, Play, Router } from 'lucide-react';
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

export default function Subscriptions() {
  const queryClient = useQueryClient();
  const [traffic, setTraffic] = useState<{ downloadSpeed: string, uploadSpeed: string }>({ downloadSpeed: '0 bps', uploadSpeed: '0 bps' });
  const lastTraffic = useRef<{ bytesIn: number, bytesOut: number, time: number } | null>(null);
  
  const [isSynced, setIsSynced] = useState(() => hasStoredHotspotIdentity());
  const [showDiscovery, setShowDiscovery] = useState(false);
  const [discoverySubId, setDiscoverySubId] = useState<string | null>(null);
  const [localDeviceName, setLocalDeviceName] = useState('Unknown Device');
  const [pendingStartSubId, setPendingStartSubId] = useState<string | null>(null);
  const [deviceLimitSessions, setDeviceLimitSessions] = useState<any[]>([]);
  const [deviceLimitMaxDevices, setDeviceLimitMaxDevices] = useState<number | null>(null);
  const { fireInternet } = useOutletContext<{
    fireInternet: (u?: string, p?: string, options?: { subId?: string; routerIp?: string; redirectPath?: string; releaseOnly?: boolean }) => void
  }>();

  useEffect(() => {
    const ua = navigator.userAgent;
    if (/Windows NT 10.0/.test(ua)) setLocalDeviceName('Windows 10/11 Device');
    else if (/Windows NT/.test(ua)) setLocalDeviceName('Windows Device');
    else if (/Mac OS X/.test(ua)) setLocalDeviceName('Apple Mac');
    else if (/Android/.test(ua)) setLocalDeviceName('Android Device');
    else if (/iPhone|iPad|iPod/.test(ua)) setLocalDeviceName('Apple iOS');
    else if (/Linux/.test(ua)) setLocalDeviceName('Linux Device');
    else setLocalDeviceName('Dashboard Browser');
  }, []);

  const { data: subsData, isLoading } = useQuery({
    queryKey: ['my-subscriptions'],
    queryFn: () => api.get('/subscriptions/my').then(res => res.data),
    refetchInterval: 5000,
  });

  const subHistory = Array.isArray(subsData) ? subsData : [];
  
  const activeSubs = subHistory.filter((s: any) => 
    ['active', 'paid', 'pending', 'verified', 'allocated', 'awaiting_approval', 'verifying'].includes(s.status?.toLowerCase())
  );
  const pastSubs = subHistory.filter((s: any) => 
    !['active', 'paid', 'pending', 'verified', 'allocated', 'awaiting_approval', 'verifying'].includes(s.status?.toLowerCase())
  );

  const startDiscovery = (subId: string) => {
    const targetSub = subHistory.find((sub: any) => sub.id === subId);
    const routerGateway = targetSub?.router?.localGateway || '10.5.50.1';
    window.location.replace(buildHotspotConnectUrl(
      subId,
      window.location.pathname,
      routerGateway,
      window.location.origin,
    ));
  };

  const startCurrentDevice = (subId: string) => {
    const identity = getStoredHotspotIdentity();
    startMutation.mutate({
      subId,
      mac: identity.mac,
      ip: identity.ip,
      currentDevice: true,
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
    }) =>
      api.post(`/subscriptions/${subId}/start`, {
        mac,
        ip,
      }),
    onMutate: ({ subId }) => {
      setPendingStartSubId(subId);
    },
    onSuccess: (response, variables) => {
      const sub = response.data;
      syncStoredHotspotIdentity({
        mac: sub?.resolvedMac,
        ip: sub?.resolvedIp,
      });
      setIsSynced(hasStoredHotspotIdentity());
      setPendingStartSubId(null);
      setShowDiscovery(false);
      queryClient.invalidateQueries({ queryKey: ['my-subscriptions'] });
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
      setPendingStartSubId(null);
      if (err.response?.status === 409 && err.response?.data?.connectedDevices) {
        setPendingStartSubId(err.response.data.subId || variables.subId);
        setDiscoverySubId(err.response.data.subId || variables.subId);
        setDeviceLimitMaxDevices(err.response.data.maxDevices || 1);
        setDeviceLimitSessions(
          (err.response.data.connectedDevices || []).map((device: any) => ({
            id: device.id,
            macAddress: device.mac,
            ipAddress: device.ip,
            deviceModel: device.model,
            isActive: true,
          })),
        );
        setShowDiscovery(true);
      } else if (variables.currentDevice && shouldTriggerHotspotIdentify(err)) {
        startDiscovery(variables.subId);
      } else {
        toast.error(err.response?.data?.message || 'Failed to prepare device connection');
      }
    }
  });

  const disconnectMutation = useMutation({
    mutationFn: (sessionId: string) => api.post('/subscriptions/disconnect-device', { sessionId }),
    onSuccess: (_data, sessionId) => {
        toast.success('Device disconnected! You have a free slot.');
        queryClient.invalidateQueries({ queryKey: ['my-subscriptions'] });
        setDeviceLimitSessions((prev) => prev.filter((session) => session.id !== sessionId));
        if (pendingStartSubId) {
          const nextSubId = pendingStartSubId;
          setPendingStartSubId(null);
          startCurrentDevice(nextSubId);
        }
      }
    });
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const mac = params.get('mac');
    const ip = params.get('ip');
    const deviceLimitRequested = params.get('device_limit') === '1';
    const deviceLimitSubId = params.get('subId');

    if (deviceLimitRequested && deviceLimitSubId) {
      const context = consumeHotspotDeviceLimitContext();
      if (context && context.subId === deviceLimitSubId) {
        setPendingStartSubId(context.subId);
        setDiscoverySubId(context.subId);
        setDeviceLimitMaxDevices(context.maxDevices || 1);
        setDeviceLimitSessions(
          (context.connectedDevices || []).map((device: any) => ({
            id: device.id,
            macAddress: device.mac,
            ipAddress: device.ip,
            deviceModel: device.model,
            isActive: true,
          })),
        );
        setShowDiscovery(true);
      }
      window.history.replaceState({}, '', window.location.pathname);
      return;
    }

    if (mac || ip) {
      syncStoredHotspotIdentity({
        mac: mac || undefined,
        ip: ip || undefined,
      });
      setIsSynced(hasStoredHotspotIdentity());
      toast.success('Device Identified Successfully!', { id: 'subscription-url-sync' });
      window.history.replaceState({}, '', window.location.pathname);
      return;
    }

    setIsSynced(hasStoredHotspotIdentity());
  }, []);
  // Traffic Polling
  useEffect(() => {
    const activeSub = activeSubs.find(s => s.status === 'ACTIVE');
    if (!activeSub?.id) return;

    const fetchTraffic = async () => {
      try {
        const res = await api.get('/subscriptions/my/traffic');
        const data = res.data;
        const now = Date.now();
        
        if (lastTraffic.current && lastTraffic.current.time && data) {
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

          setTraffic({ downloadSpeed: formatSpeed(downBits), uploadSpeed: formatSpeed(upBits) });
        }
        lastTraffic.current = { ...data, time: now };
      } catch (e) {
        console.error('Traffic poll failed', e);
      }
    };

    const interval = setInterval(fetchTraffic, 5000);
    fetchTraffic();
    return () => clearInterval(interval);
  }, [activeSubs.find((s: any) => s.status === 'ACTIVE')?.id]);

  const activeManageSub = activeSubs.find((s: any) => s.id === discoverySubId) || pastSubs.find((s: any) => s.id === discoverySubId);
  const activeManageSessions =
    deviceLimitSessions.length > 0 && discoverySubId
      ? deviceLimitSessions
      : activeManageSub?.deviceSessions?.filter((ds: any) => ds.isActive) || [];

  if (isLoading) return (
    <div className="flex items-center justify-center p-20">
       <RefreshCw className="animate-spin text-cyan-500 mr-2" size={20} />
       <span className="text-muted font-bold uppercase tracking-widest text-xs">X</span>
    </div>
  );

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 md:py-12 animate-fade-in space-y-12">
      
      {/* Header */}
      <div className="relative overflow-hidden rounded-[2.5rem] bg-gradient-to-br from-slate-900 via-slate-950 to-black shadow-[0_20px_50px_rgba(0,0,0,0.5)] p-10 md:p-14 transition-all duration-500 border border-white/10">
        <div className="absolute inset-0 bg-noise opacity-5 pointer-events-none" />
        <div className="absolute top-0 right-0 p-4 opacity-10 group pointer-events-none">
          <ShieldCheck size={140} className="text-white transform group-hover:-rotate-12 transition-transform duration-700" />
        </div>
        <div className="relative z-10">
          <h1 className="text-5xl md:text-6xl font-black text-white tracking-tighter mb-4 leading-none">
             My <span className="text-transparent bg-clip-text bg-gradient-to-r from-cyan-400 to-blue-400">X</span>
          </h1>
          <p className="text-blue-100/60 text-sm md:text-lg max-w-xl font-bold uppercase tracking-widest leading-relaxed">
             Track your active sessions, traffic usage, and historical plans with <span className="text-cyan-400">X</span> precision.
          </p>
        </div>
      </div>

      <div className="space-y-10">
        <div className="flex items-center gap-4 px-4 overflow-x-auto pb-4 no-scrollbar">
           <div className="flex items-center gap-2 whitespace-nowrap px-6 py-2 rounded-full bg-cyan-500/10 border border-cyan-500/20">
              <Zap size={14} className="text-cyan-500" />
              <span className="text-[10px] font-black text-cyan-500 uppercase tracking-widest">X</span>
           </div>
        </div>

        {activeSubs.length === 0 ? (
          <div className="glass-panel p-20 flex flex-col items-center justify-center text-center gap-6 group hover:border-cyan-500/30 transition-all border-dashed bg-opacity-20">
             <div className="w-20 h-20 bg-main/5 rounded-full flex items-center justify-center text-muted opacity-30 group-hover:scale-110 transition-transform">
               <ShieldCheck size={40} />
             </div>
             <div className="space-y-2">
               <h4 className="text-3xl font-black text-main uppercase tracking-widest opacity-30">No Active Plans</h4>
               <p className="text-xs text-muted font-bold uppercase tracking-widest opacity-40">Choose a package to get started instantly</p>
             </div>
          </div>
        ) : (
          <div className="grid gap-10">
            {activeSubs.map((sub: any) => {
              const isSubLive = sub.status === 'ACTIVE' && sub.expiresAt && new Date(sub.expiresAt) > new Date();
              const storedIdentity = getStoredHotspotIdentity();
              const activeCurrentSession = sub.deviceSessions?.find((ds: any) => matchesStoredHotspotIdentity(ds, storedIdentity));
              const isThisDeviceLive = !!activeCurrentSession;
              const hasActiveSession = sub.deviceSessions?.some((ds: any) => ds.isActive);
              const isOtherDeviceLive = hasActiveSession && !isThisDeviceLive;
              const isLive = isSubLive;

              return (
                <div key={sub.id} className="relative group animate-fade-in">
                  <div className="glass-panel p-6 md:p-10 relative overflow-hidden transition-all duration-500 hover:shadow-[0_0_50px_rgba(6,182,212,0.15)] rounded-[2.5rem] bg-gradient-to-br from-slate-900/40 to-transparent">
                    
                    <div className="flex flex-col lg:flex-row items-center justify-between mb-8 gap-4 px-2">
                      <div className="flex flex-col lg:flex-row items-center gap-4 lg:gap-10">
                        <div className="flex flex-col">
                          <h3 className="text-4xl font-black text-main tracking-tight leading-none capitalize">{sub.package?.name}</h3>
                          <div className="flex items-center gap-3 mt-2">
                             <div className="flex items-center gap-1.5 font-black text-[10px] text-slate-900 dark:text-muted uppercase tracking-widest">
                               <Clock size={12} className="text-cyan-500/50" />
                               Acquired: <span className="opacity-80 font-bold dark:font-normal">X</span>
                             </div>
                             <div className="w-1 h-1 rounded-full bg-slate-500/20" />
                             <div className="flex items-center gap-1.5 font-black text-[10px] text-slate-900 dark:text-muted uppercase tracking-widest">
                               <CreditCard size={12} className="text-emerald-500/50" />
                               Via: <span className="text-emerald-600 dark:text-emerald-500 font-bold dark:font-normal opacity-80 dark:opacity-60">X</span>
                             </div>
                          </div>
                        </div>
                         <div className="flex items-center gap-2 text-xs font-black text-slate-900 dark:text-muted uppercase tracking-widest opacity-80 dark:opacity-60">
                           <Wifi size={14} className="text-cyan-500" />
                           Location: <span className="text-main font-bold dark:font-normal">X</span>
                         </div>
                      </div>
                      <div className="flex flex-col items-center lg:items-end">
                          <p className="text-[10px] font-black text-muted uppercase tracking-[0.25em] mb-1">SESSION STATUS</p>
                          <h4 className={`text-4xl font-black tracking-[0.1em] uppercase ${sub.status === 'ACTIVE' ? 'text-cyan-500' : 'text-main opacity-80'}`}>
                            {sub.status === 'PAID' ? 'READY' : sub.status}
                          </h4>
                       </div>
                    </div>

                    <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 items-center">
                      <div className="lg:col-span-4 h-full">
                        <div className="rounded-3xl p-6 h-full flex flex-col justify-center gap-6 backdrop-blur-md shadow-2xl group-hover:border-cyan-500/30 transition-all border border-white/5 bg-slate-950/30">
                          <div className="flex items-center gap-5">
                            <div className="w-14 h-14 rounded-2xl bg-main/5 flex items-center justify-center text-cyan-400 border border-main/10 shrink-0">
                               <Laptop size={28} />
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="text-[9px] font-black text-muted uppercase tracking-[0.25em] mb-1 truncate">DEVICE MODEL</p>
                              <h4 className="text-xs font-bold text-main tracking-wide leading-relaxed truncate">
                                {isThisDeviceLive ? (activeCurrentSession?.deviceModel || localDeviceName) : (sub.deviceSessions?.find((ds: any) => ds.isActive)?.deviceModel || localDeviceName)}
                              </h4>
                              <div className="flex items-center gap-2 mt-2">
                                <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse shadow-[0_0_8px_rgba(16,185,129,0.8)]" />
                                <span className="text-[10px] font-black text-emerald-500 uppercase tracking-widest leading-none truncate">X</span>
                              </div>
                            </div>
                          </div>
                        </div>
                      </div>

                      <div className="lg:col-span-8 space-y-4">
                        {isLive ? (
                          <>
                            <div className="w-full bg-cyan-950/10 border border-cyan-500/20 rounded-2xl py-6 px-10 flex items-center justify-between group-hover:bg-cyan-900/10 transition-all duration-700 relative overflow-hidden shadow-inner">
                              <div className="absolute inset-0 bg-gradient-to-r from-transparent via-cyan-400/5 to-transparent -translate-x-full animate-[shimmer_3s_infinite]" />
                              <div className="flex items-center gap-4 relative z-10">
                                <div className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-pulse" />
                                <span className="text-sm font-black text-emerald-400 uppercase tracking-[0.3em]">X</span>
                              </div>
                               <button 
                                 onClick={async (e) => {
                                  e.stopPropagation();
                                  if (isThisDeviceLive) return;
                                  startCurrentDevice(sub.id);
                                 }}
                                 className={`text-[10px] font-black uppercase tracking-widest transition-all underline underline-offset-4 relative z-10 ${isThisDeviceLive ? 'text-emerald-400 opacity-50 cursor-default no-underline' : isOtherDeviceLive ? 'text-cyan-500 hover:text-main' : 'text-cyan-500 hover:text-main'}`}
                               >
                                 {isThisDeviceLive ? 'THIS DEVICE CONNECTED' : 'CONNECT THIS DEVICE'}
                               </button>
                            </div>

                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                              <div className="bg-main/5 rounded-2xl p-5 border border-main/5 flex flex-col items-center justify-center gap-1 shadow-inner hover:bg-main/10 transition-colors">
                                <Download size={20} className="text-cyan-400 mb-1" />
                                <span className="text-base font-black text-main">X</span>
                                <span className="text-[9px] font-bold text-muted uppercase tracking-tighter">X</span>
                              </div>
                              <div className="bg-main/5 rounded-2xl p-5 border border-main/5 flex flex-col items-center justify-center gap-1 shadow-inner hover:bg-main/10 transition-colors">
                                <Upload size={20} className="text-emerald-400 mb-1" />
                                <span className="text-base font-black text-main">X</span>
                                <span className="text-[9px] font-bold text-muted uppercase tracking-tighter">X</span>
                              </div>
                            </div>

                            <div className={`p-4 rounded-2xl flex items-center justify-between transition-all border ${
                              isThisDeviceLive 
                                ? 'bg-cyan-500/10 border-cyan-500/30' 
                                : isOtherDeviceLive 
                                  ? 'bg-amber-500/5 border-amber-500/20' 
                                  : 'bg-slate-800/50 border-white/5 hover:border-white/10'
                            }`}>
                              <div className="flex items-center gap-3">
                                <div className={`w-2 h-2 rounded-full ${hasActiveSession ? 'bg-cyan-400 animate-[pulse_2s_ease-in-out_infinite]' : 'bg-slate-600'}`} />
                                <span className={`text-[11px] font-black tracking-[0.2em] uppercase ${hasActiveSession ? 'text-cyan-400' : 'text-slate-400'}`}>X</span>
                              </div>
                              
                              <span className={`text-[9px] font-black uppercase tracking-[0.2em] ${isThisDeviceLive ? 'text-cyan-400/70' : isOtherDeviceLive ? 'text-amber-500/80' : 'text-slate-500'}`}>X</span>
                            </div>

                            <div className="w-full flex items-center justify-between px-6 pt-4 mt-2">
                               <div className="flex items-center gap-4">
                                 <div className="flex items-center gap-2">
                                   <Clock size={16} className="text-muted" />
                                   <span className="text-[11px] font-black text-muted uppercase tracking-[0.1em]">X</span>
                                 </div>
                                 <CountdownBadge expiresAt={sub.expiresAt} startedAt={sub.startedAt} variant="inline" size="lg" />
                               </div>
                               <div className="px-6 py-2.5 rounded-full bg-cyan-500/10 border border-cyan-500/30 flex items-center gap-3">
                                 <div className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-pulse shadow-[0_0_8px_#22d3ee]" />
                                 <span className="text-[10px] font-black text-cyan-400 uppercase tracking-widest">X</span>
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
                                   if (isThisDeviceLive) return;
                                   startCurrentDevice(sub.id);
                                 }}
                                 disabled={startMutation.isPending || sub.status === 'AWAITING_APPROVAL' || sub.status === 'VERIFYING'}
                                 className={`w-full lg:flex-1 py-6 text-sm font-black tracking-[0.4em] uppercase shadow-2xl transition-all duration-500 transform hover:scale-105 active:scale-95 flex items-center justify-center gap-4 rounded-3xl ${
                                   startMutation.isPending ? 'opacity-70 cursor-not-allowed' : 
                                   !isSynced ? 'shadow-cyan-500/40 border-cyan-500/20' : 'shadow-emerald-500/30 border-emerald-500/20'
                                 } border`}
                                 style={{ 
                                   background: startMutation.isPending ? '#333' : 
                                               !isSynced ? 'linear-gradient(135deg, var(--accent-primary) 0%, var(--accent-secondary) 100%)' :
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

                               <div className="w-full lg:w-48 bg-main/5 border border-main/5 rounded-3xl px-8 py-4 text-center">
                                  <p className="text-[9px] font-black text-muted uppercase tracking-widest mb-1">TOTAL TIME</p>
                                  <span className="text-xl font-black text-main">X</span>
                               </div>
                             </div>

                             <div className="flex items-center justify-between w-full px-2 opacity-50">
                                <div className="flex items-center gap-2">
                                  <Router size={14} className="text-muted" />
                                  <span className="text-[9px] font-black text-muted uppercase tracking-widest">X</span>
                                </div>
                                <div className="flex items-center gap-2">
                                  <RefreshCw size={14} className="text-muted" />
                                  <span className="text-[9px] font-black text-muted uppercase tracking-widest">X</span>
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

      {/* Manage Linked Devices Modal */}
      {showDiscovery && (
        <div className="fixed inset-0 z-[1000] flex items-center justify-center p-4 backdrop-blur-[30px] bg-slate-950/60 animate-fade-in duration-500 overflow-y-auto">
          <div className="relative w-full max-w-xl mx-auto transition-all duration-700 overflow-hidden bg-white dark:bg-slate-900 border border-white/20 dark:border-white/5 shadow-[0_0_150px_rgba(34,211,238,0.25)] rounded-3xl md:rounded-[3rem]">
            {/* Header / Top Shelf */}
            <div className="p-6 pb-4 md:p-10 md:pb-8 flex items-center justify-between relative overflow-hidden">
               <div className="absolute top-0 right-0 w-32 h-32 bg-cyan-500/10 rounded-full blur-3xl -translate-y-12 translate-x-12" />
               <div className="relative z-10">
                 <h3 className="text-3xl font-black text-slate-900 dark:text-white tracking-tighter uppercase mb-2">LINKED DEVICES</h3>
                 <p className="text-[11px] font-black text-cyan-600 dark:text-cyan-400 uppercase tracking-[0.3em] opacity-80">Manage Active Sessions</p>
               </div>
               <button 
                  onClick={() => setShowDiscovery(false)}
                  aria-label="Close linked devices"
                  className="w-12 h-12 md:w-14 md:h-14 rounded-full bg-white/10 dark:bg-slate-800/95 border border-white/30 flex items-center justify-center text-white shadow-lg shadow-slate-950/30 backdrop-blur-md hover:text-white hover:bg-red-500 hover:border-red-300/70 hover:scale-110 transition-all active:scale-95 group relative z-10"
                >
                  <span aria-hidden className="text-[30px] font-black leading-none text-white translate-y-[-1px]">X</span>
                </button>
            </div>

            <div className="p-6 pt-0 md:p-10 md:pt-0 max-h-[70vh] overflow-y-auto custom-scrollbar">
              <div className="space-y-6">
                <div className="flex items-center gap-4 px-6 py-4 bg-cyan-500/5 dark:bg-cyan-500/10 rounded-2xl border border-cyan-500/20 mb-8">
                   <ShieldCheck className="text-cyan-500 shrink-0" size={24} />
                   <div className="flex flex-col">
                     <p className="text-[10px] font-black text-cyan-600 dark:text-cyan-400 uppercase tracking-widest leading-none mb-1">Select an active device to disconnect</p>
                     <p className="text-[9px] font-black text-slate-500 uppercase tracking-[0.2em]">Max Allowed: {deviceLimitMaxDevices || activeManageSub?.package?.maxDevices || 1}</p>
                   </div>
                </div>
                <div className="grid gap-6">
                  {activeManageSessions.map((session: any) => (
                    <div
                      key={session.id}
                      className="w-full relative group transition-all duration-500"
                    >
                      <div className="absolute inset-0 bg-gradient-to-r from-cyan-500/20 via-blue-500/10 to-transparent opacity-0 group-hover:opacity-100 transition-opacity rounded-[2rem] blur-xl" />
                      <div className="relative p-6 md:p-8 bg-slate-50 dark:bg-slate-950/40 border border-slate-200 dark:border-white/5 rounded-[2rem] shadow-sm hover:shadow-2xl transition-all hover:-translate-y-1">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-6">
                            <div className="w-16 h-16 rounded-[1.5rem] bg-cyan-500/10 flex items-center justify-center text-cyan-500 border border-cyan-500/20 group-hover:scale-110 transition-transform">
                               <Laptop size={32} strokeWidth={1.5} />
                            </div>
                            <div className="flex flex-col text-left">
                               <h4 className="text-xl font-black text-slate-900 dark:text-white uppercase tracking-tight mb-2">
                                 {session.deviceModel || 'Unknown Device'}
                               </h4>
                               <div className="flex items-center gap-4 opacity-70">
                                 <div className="flex items-center gap-2">
                                   <div className="w-1.5 h-1.5 rounded-full bg-cyan-500 animate-pulse" />
                                   <span className="text-[11px] font-black text-slate-600 dark:text-cyan-500/60 font-mono italic">X</span>
                                 </div>
                               </div>
                            </div>
                          </div>
                          
                          <button
                            onClick={() => disconnectMutation.mutate(session.id)}
                            disabled={disconnectMutation.isPending}
                            className="w-14 h-14 md:w-32 md:h-12 rounded-full md:rounded-2xl bg-red-500/10 border border-red-500/30 flex items-center justify-center text-red-500 shadow-[0_0_20px_rgba(239,68,68,0.1)] hover:bg-red-500 hover:text-white hover:scale-105 active:scale-95 transition-all group/kick"
                          >
                            {disconnectMutation.isPending ? (
                              <RefreshCw size={20} className="animate-spin" />
                            ) : (
                              <>
                                <X size={20} className="md:hidden stroke-[3px]" />
                                <span className="hidden md:inline text-[10px] font-black uppercase tracking-[0.3em]">X</span>
                              </>
                            )}
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                  
                  {activeManageSessions.length === 0 && (
                    <div className="py-12 text-center border border-dashed border-white/10 rounded-3xl bg-white/5">
                       <Smartphone className="mx-auto text-slate-500 mb-4 opacity-30" size={40} />
                       <h4 className="text-sm font-black text-white uppercase tracking-widest opacity-50">No Devices Linked</h4>
                       <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest max-w-[200px] mx-auto mt-2 opacity-50">Connecting a device will register it here</p>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Historical Plans */}
      {pastSubs.length > 0 && (
        <div className="space-y-8 pt-10 border-t border-main/5">
          <div className="flex items-center gap-3 px-4">
            <RefreshCw size={18} className="text-muted opacity-50" />
            <h3 className="text-sm font-black text-muted uppercase tracking-[0.3em]">PAST SUBSCRIPTIONS</h3>
          </div>
          <div className="grid gap-4">
            {pastSubs.map((sub: any) => (
               <div key={sub.id} className="glass-panel p-6 bg-opacity-20 border-main/5 flex items-center justify-between group grayscale hover:grayscale-0 transition-all">
                  <div className="flex items-center gap-6">
                    <div className="w-12 h-12 rounded-xl bg-main/5 flex items-center justify-center text-muted group-hover:text-cyan-500 transition-colors">
                       <Zap size={24} />
                    </div>
                    <div>
                       <h5 className="font-black text-main text-lg tracking-tight capitalize leading-none mb-2">{sub.package?.name}</h5>
                       <p className="text-[10px] font-black text-muted uppercase tracking-widest">{format(new Date(sub.createdAt), 'MMM d, yyyy')}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-4">
                     <span className="text-[9px] font-black text-muted uppercase tracking-[0.2em]">X</span>
                     <CountdownBadge expiresAt={sub.expiresAt} startedAt={sub.startedAt} variant="inline" size="sm" />
                  </div>
               </div>
            ))}
          </div>
        </div>
      )}


    </div>
  );
}
