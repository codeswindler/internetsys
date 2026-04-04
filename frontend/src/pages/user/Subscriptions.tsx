import { useState, useEffect, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import toast from 'react-hot-toast';
import { Wifi, Clock, CreditCard, Smartphone, ShieldCheck, Download, Upload, Zap, RefreshCw, ChevronRight, Laptop, Monitor, ArrowRight, X, Search, AlertTriangle, Monitor as MonitorIcon, Laptop as LaptopIcon, Play, Router } from 'lucide-react';
import api from '../../services/api';
import { CountdownBadge } from '../../components/CountdownBadge';

export default function Subscriptions() {
  const queryClient = useQueryClient();
  const [traffic, setTraffic] = useState<{ downloadSpeed: string, uploadSpeed: string }>({ downloadSpeed: '0 bps', uploadSpeed: '0 bps' });
  const lastTraffic = useRef<{ bytesIn: number, bytesOut: number, time: number } | null>(null);
  
  const [isSynced, setIsSynced] = useState(!!localStorage.getItem('hotspot_mac'));
  const [showDiscovery, setShowDiscovery] = useState(false);
  const [discoverySubId, setDiscoverySubId] = useState<string | null>(null);
  const [discoveredHosts, setDiscoveredHosts] = useState<Array<{ mac: string; ip: string; deviceName?: string }>>([]);
  const [isScanning, setIsScanning] = useState(false);

  // Proximity check for 10.5.50.1
  const checkRouterProximity = async (gateway: string) => {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 2000);
      await fetch(`http://${gateway}/favicon.ico`, { mode: 'no-cors', signal: controller.signal, cache: 'no-cache' });
      clearTimeout(timeoutId);
      return true;
    } catch (e) {
      return false;
    }
  };

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
      queryClient.invalidateQueries({ queryKey: ['my-subscriptions'] });
      toast.success('Connection Successful! Surf away.', { icon: '🚀' });
    },
    onError: (err: any) => {
      toast.error(err.response?.data?.message || 'Failed to start session');
    }
  });

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
  }, [activeSubs.find(s => s.status === 'ACTIVE')?.id]);

  if (isLoading) return (
    <div className="flex items-center justify-center p-20">
       <RefreshCw className="animate-spin text-cyan-500 mr-2" size={20} />
       <span className="text-muted font-bold uppercase tracking-widest text-xs">Loading Subscriptions...</span>
    </div>
  );

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 md:py-12 animate-fade-in space-y-12">
      
      {/* ── 🌓 PERMANENT ELITE DARK HEADER (FOR PEAK READABILITY) ── */}
      <div className="relative overflow-hidden rounded-[2.5rem] bg-gradient-to-br from-slate-900 via-slate-950 to-black shadow-[0_20px_50px_rgba(0,0,0,0.5)] p-10 md:p-14 transition-all duration-500 border border-white/10">
        <div className="absolute inset-0 bg-noise opacity-5 pointer-events-none" />
        <div className="absolute top-0 right-0 p-4 opacity-10 group pointer-events-none">
          <ShieldCheck size={140} className="text-white transform group-hover:-rotate-12 transition-transform duration-700" />
        </div>
        <div className="relative z-10">
          <h1 className="text-5xl md:text-6xl font-black text-white tracking-tighter mb-4 leading-none">
             My <span className="text-transparent bg-clip-text bg-gradient-to-r from-cyan-400 to-blue-400">Subscriptions</span>
          </h1>
          <p className="text-blue-100/60 text-sm md:text-lg max-w-xl font-bold uppercase tracking-widest leading-relaxed">
             Track your active sessions, traffic usage, and historical plans with <span className="text-cyan-400">PulseLynk</span> precision.
          </p>
        </div>
      </div>

      <div className="space-y-10">
        <div className="flex items-center gap-4 px-4 overflow-x-auto pb-4 no-scrollbar">
           <div className="flex items-center gap-2 whitespace-nowrap px-6 py-2 rounded-full bg-cyan-500/10 border border-cyan-500/20">
              <Zap size={14} className="text-cyan-500" />
              <span className="text-[10px] font-black text-cyan-500 uppercase tracking-widest">{activeSubs.length} Active Plans</span>
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
              const isDeviceLive = sub.deviceSessions?.some((ds: any) => ds.macAddress === localStorage.getItem('hotspot_mac') && ds.isActive);
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
                               Acquired: <span className="opacity-80 font-bold dark:font-normal">{sub.createdAt ? format(new Date(sub.createdAt), 'MMM d, HH:mm') : 'Unknown'}</span>
                             </div>
                             <div className="w-1 h-1 rounded-full bg-slate-500/20" />
                             <div className="flex items-center gap-1.5 font-black text-[10px] text-slate-900 dark:text-muted uppercase tracking-widest">
                               <CreditCard size={12} className="text-emerald-500/50" />
                               Via: <span className="text-emerald-600 dark:text-emerald-500 font-bold dark:font-normal opacity-80 dark:opacity-60">{sub.paymentMethod || 'Manual'}</span>
                             </div>
                          </div>
                        </div>
                         <div className="flex items-center gap-2 text-xs font-black text-slate-900 dark:text-muted uppercase tracking-widest opacity-80 dark:opacity-60">
                           <Wifi size={14} className="text-cyan-500" />
                           Location: <span className="text-main font-bold dark:font-normal">{sub.router?.name || 'Pulselynk'}</span>
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
                                {sub.deviceSessions?.[0]?.deviceModel || (sub.startedAt ? 'Detected Device' : 'Your Current Device')}
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
                        {isLive ? (
                          <>
                            <div className="w-full bg-cyan-950/10 border border-cyan-500/20 rounded-2xl py-6 px-10 flex items-center justify-between group-hover:bg-cyan-900/10 transition-all duration-700 relative overflow-hidden shadow-inner">
                              <div className="absolute inset-0 bg-gradient-to-r from-transparent via-cyan-400/5 to-transparent -translate-x-full animate-[shimmer_3s_infinite]" />
                              <div className="flex items-center gap-4 relative z-10">
                                <div className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-pulse" />
                                <span className="text-sm font-black text-emerald-400 uppercase tracking-[0.3em]">SURFING LIVE</span>
                              </div>
                               <button 
                                 onClick={async (e) => {
                                   e.stopPropagation();
                                   if (isDeviceLive) return;
                                   if (!isSynced) {
                                      startDiscovery(sub.id);
                                      return;
                                   }
                                   startMutation.mutate(sub.id);
                                 }}
                                 className={`text-[10px] font-black uppercase tracking-widest transition-all underline underline-offset-4 relative z-10 ${isDeviceLive ? 'text-emerald-400 opacity-50 cursor-default no-underline' : 'text-cyan-500 hover:text-main'}`}
                               >
                                 {isDeviceLive ? 'DEVICE CONNECTED' : 'CONNECT THIS DEVICE'}
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
                               <div className="px-6 py-2.5 rounded-full bg-cyan-500/10 border border-cyan-500/30 flex items-center gap-3">
                                 <div className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-pulse shadow-[0_0_8px_#22d3ee]" />
                                 <span className="text-[10px] font-black text-cyan-400 uppercase tracking-widest">SYSTEM LIVE</span>
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
                                 onClick={async () => {
                                   if (!isSynced) {
                                      startDiscovery(sub.id);
                                      return;
                                   }
                                   startMutation.mutate(sub.id);
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
                                
                                {startMutation.isPending ? 'SCANNING...' : 
                                 !isSynced ? 'LINK DEVICE' : 
                                 'JOIN NETWORK'}
                               </button>

                               <div className="w-full lg:w-48 bg-main/5 border border-main/5 rounded-3xl px-8 py-4 text-center">
                                  <p className="text-[9px] font-black text-muted uppercase tracking-widest mb-1">TOTAL TIME</p>
                                  <span className="text-xl font-black text-main">{sub.package?.durationText || 'Ready'}</span>
                               </div>
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

      {/* ── 💎 ELITE CRYSTAL DISCOVERY MODAL (CENTERED RESTORATION) ── */}
      {showDiscovery && (
        <div className="fixed inset-0 z-[1000] flex items-center justify-center p-4 backdrop-blur-[30px] bg-slate-950/60 animate-fade-in duration-500 overflow-y-auto">
          <div className="relative w-full max-w-xl mx-auto transition-all duration-700 overflow-hidden bg-white dark:bg-slate-900 border border-white/20 dark:border-white/5 shadow-[0_0_150px_rgba(34,211,238,0.25)] rounded-3xl md:rounded-[3rem]">
            {/* Header / Top Shelf */}
            <div className="p-6 pb-4 md:p-10 md:pb-8 flex items-center justify-between relative overflow-hidden">
               <div className="absolute top-0 right-0 w-32 h-32 bg-cyan-500/10 rounded-full blur-3xl -translate-y-12 translate-x-12" />
               <div className="relative z-10">
                 <h3 className="text-3xl font-black text-slate-900 dark:text-white tracking-tighter uppercase mb-2">LINK THIS DEVICE</h3>
                 <p className="text-[11px] font-black text-cyan-600 dark:text-cyan-400 uppercase tracking-[0.3em] opacity-80">Hardware Identification Active</p>
               </div>
               <button 
                 onClick={() => setShowDiscovery(false)}
                 className="w-12 h-12 md:w-14 md:h-14 rounded-full bg-white/5 border border-white/10 flex items-center justify-center text-slate-400 hover:text-white hover:bg-red-500 hover:scale-110 transition-all active:scale-95 group relative z-10"
               >
                 <X size={26} strokeWidth={2.5} />
               </button>
            </div>

            <div className="p-6 pt-0 md:p-10 md:pt-0 max-h-[70vh] overflow-y-auto custom-scrollbar">
              {isScanning ? (
                <div className="py-20 flex flex-col items-center justify-center gap-10">
                   <div className="relative">
                      <div className="w-32 h-32 rounded-full border-[6px] border-cyan-500/20 border-t-cyan-500 animate-[spin_1.5s_linear_infinite]" />
                      <div className="absolute inset-0 flex items-center justify-center">
                         <div className="w-20 h-20 rounded-full bg-cyan-500/10 flex items-center justify-center animate-pulse">
                           <Search className="text-cyan-500" size={40} />
                         </div>
                      </div>
                      <div className="absolute -inset-4 rounded-full border border-cyan-500/10 animate-[ping_3s_infinite]" />
                   </div>
                   <div className="text-center space-y-3">
                     <h4 className="text-xl font-black text-slate-900 dark:text-white uppercase tracking-[0.2em] animate-pulse">Scanning Router OS...</h4>
                     <p className="text-[10px] text-slate-400 dark:text-muted font-black uppercase tracking-widest leading-relaxed max-w-[300px] mx-auto opacity-70">
                       Direct Router Integration: Searching for active hardware signatures on your local network.
                     </p>
                   </div>
                </div>
              ) : discoveredHosts.length === 0 ? (
                <div className="py-24 text-center">
                  <div className="w-24 h-24 bg-amber-500/10 rounded-[2rem] flex items-center justify-center mx-auto mb-8 rotate-12">
                    <AlertTriangle size={48} className="text-amber-500 animate-pulse" />
                  </div>
                  <h4 className="text-2xl font-black text-slate-900 dark:text-white mb-4 uppercase tracking-[0.1em]">Signal Not Detected</h4>
                  <p className="text-xs text-slate-400 dark:text-muted mb-10 leading-relaxed max-w-[320px] mx-auto font-bold uppercase tracking-widest opacity-60 px-4">
                    PulseLynk couldn't detect your hardware signature. Verify you are connected to the <span className="text-cyan-500 font-black">PulseLynk Wi-Fi</span> network.
                  </p>
                  <button 
                    onClick={() => discoverySubId && startDiscovery(discoverySubId)}
                    className="group px-12 py-5 bg-slate-900 dark:bg-white text-white dark:text-slate-900 text-xs font-black uppercase tracking-[0.4em] rounded-2xl hover:scale-105 active:scale-95 transition-all shadow-2xl flex items-center gap-4 mx-auto"
                  >
                    <RefreshCw size={18} className="group-hover:rotate-180 transition-transform duration-700" />
                    RE-SCAN NETWORK
                  </button>
                </div>
              ) : (
                <div className="space-y-6">
                  <div className="flex items-center gap-4 px-6 py-4 bg-cyan-500/5 dark:bg-cyan-500/10 rounded-2xl border border-cyan-500/20 mb-8">
                     <ShieldCheck className="text-cyan-500 shrink-0" size={24} />
                     <p className="text-[10px] font-black text-cyan-600 dark:text-cyan-400 uppercase tracking-widest leading-none">Select your detected device to bind with this plan</p>
                  </div>
                  <div className="grid gap-6">
                    {discoveredHosts.map((host) => (
                      <button
                        key={host.mac}
                        onClick={() => linkDevice(host.mac)}
                        className="w-full relative group transition-all duration-500 active:scale-95 text-left"
                      >
                        <div className="p-8 rounded-[2.5rem] bg-slate-900/40 border border-white/5 group-hover:border-cyan-500/40 group-hover:bg-slate-900 transition-all shadow-xl group-hover:shadow-[0_20px_50px_rgba(6,182,212,0.15)] flex items-center justify-between">
                          <div className="flex items-center gap-8">
                            <div className="w-20 h-20 rounded-3xl bg-white dark:bg-slate-950 flex items-center justify-center text-cyan-500 shadow-xl group-hover:scale-110 transition-transform border border-slate-100 dark:border-white/5">
                              {host.deviceName === 'Apple' ? <Smartphone size={36} /> : <Laptop size={36} />}
                            </div>
                            <div>
                               <h5 className="font-black text-slate-900 dark:text-white text-lg tracking-tighter uppercase mb-2">{host.deviceName || 'Neighbor Device'}</h5>
                               <div className="flex items-center gap-4">
                                 <span className="text-[11px] font-black text-slate-400 dark:text-muted font-mono tracking-widest">{host.mac}</span>
                                 {host.ip && (
                                   <>
                                     <div className="w-1.5 h-1.5 rounded-full bg-cyan-500/30" />
                                     <span className="text-[11px] font-black text-cyan-500/60 font-mono italic">{host.ip}</span>
                                   </>
                                 )}
                               </div>
                            </div>
                          </div>
                          <div className="w-12 h-12 rounded-full bg-cyan-500 flex items-center justify-center text-white scale-0 group-hover:scale-100 transition-all shadow-[0_0_20px_rgba(6,182,212,0.4)]">
                            <ArrowRight size={20} />
                          </div>
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
            <div className="p-8 bg-slate-50 dark:bg-slate-950/20 border-t border-main/5 flex items-center justify-between px-12">
               <div className="flex items-center gap-3">
                  <div className="w-2 h-2 rounded-full bg-emerald-500" />
                  <span className="text-[9px] font-black text-slate-400 dark:text-muted uppercase tracking-widest">Router Protected</span>
               </div>
               <span className="text-[9px] font-black text-slate-400 dark:text-muted uppercase tracking-tighter opacity-50 font-mono">ID: {discoverySubId?.slice(-8).toUpperCase()}</span>
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
                     <span className="text-[9px] font-black text-muted uppercase tracking-[0.2em]">{sub.status}</span>
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
