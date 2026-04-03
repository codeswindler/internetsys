import { useState, useEffect, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useOutletContext } from 'react-router-dom';
import toast from 'react-hot-toast';
import { Wifi, Clock, Activity, Download, Upload, Zap, RefreshCw, ChevronRight, ArrowRight, ShieldCheck, CreditCard } from 'lucide-react';
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

  // Unified Query Key: Centralizes the ACTIVE timer/status
  const { data: activeSubsData, isLoading: activeSubsLoading } = useQuery({
    queryKey: ['active-all-subscriptions'],
    queryFn: () => api.get('/subscriptions/my').then(res => res.data),
    refetchInterval: 5000,
  });

  const subHistory = Array.isArray(activeSubsData) ? activeSubsData : [];
  
  // Filter for ONLY actionable types: active, pending, or allocated
  const allActiveSubs = subHistory.filter((s: any) => 
    ['active', 'pending', 'paid', 'verified', 'allocated'].includes(s.status?.toLowerCase())
  );

  const liveSession = allActiveSubs.find((s: any) => 
    s.startedAt && s.expiresAt && new Date(s.expiresAt) > new Date()
  );
  
  const pendingPlans = allActiveSubs.filter((s: any) => 
    !s.startedAt || !s.expiresAt || new Date(s.expiresAt) <= new Date()
  );

  const isAnyLive = !!liveSession;
  const activeSub = liveSession || (pendingPlans.length > 0 ? pendingPlans[0] : null);

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
    onError: (err: any) => {
      toast.error(err.response?.data?.message || 'Connection failed.');
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
                   <div className={`w-2 h-2 rounded-full ${isAnyLive ? 'bg-emerald-500 animate-pulse' : 'bg-amber-500'}`} />
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

        {allActiveSubs.length > 0 ? (
          <div className="grid grid-cols-1 gap-6">
            {allActiveSubs.map((sub: any) => {
              const isLive = sub.startedAt && new Date(sub.expiresAt) > new Date();
              
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
                            <span className={`text-[10px] font-black uppercase tracking-[0.4em] ${isLive ? 'text-cyan-400' : 'text-slate-500'}`}>
                              {isLive ? 'SYSTEM LIVE' : 'AWAITING START'}
                            </span>
                            {isLive && <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse ring-4 ring-emerald-500/20" />}
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

                            <div className="flex items-center gap-4">
                               <div className="bg-slate-950/80 rounded-2xl px-6 py-3 border border-white/5 flex items-center gap-6 shadow-inner">
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
                            </div>
                          </>
                        ) : (
                          <div className="flex flex-col items-center lg:items-end gap-6">
                            <div className="text-center lg:text-right">
                               <p className="text-[10px] text-slate-500 font-black uppercase tracking-[0.4em] mb-2">SESSION STATUS</p>
                               <h4 className="text-4xl font-black text-cyan-400 tracking-widest">READY</h4>
                             </div>
                             <button 
                              onClick={(e) => { e.stopPropagation(); startMutation.mutate(sub.id); }}
                              disabled={startMutation.isPending || isAnyLive}
                              className={`btn-primary w-full lg:w-64 py-5 text-sm font-black tracking-widest uppercase shadow-2xl transition-all duration-500 transform hover:scale-105 active:scale-95 flex items-center justify-center gap-4 rounded-2xl ${
                                isAnyLive 
                                ? 'opacity-30 cursor-not-allowed grayscale' 
                                : 'shadow-cyan-500/30'
                              }`}
                             >
                              {startMutation.isPending ? <RefreshCw className="animate-spin" size={20} /> : 
                               isAnyLive ? 'SESSION LOCKED' : 
                               'ACTIVATE INTERNET'}
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
    </div>
  );
}
