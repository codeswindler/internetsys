import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { 
  Wifi, 
  MapPin, 
  Clock, 
  ArrowRight, 
  Trash2, 
  Play, 
  AlertTriangle, 
  ShieldCheck, 
  Zap, 
  History,
  Smartphone,
  RefreshCw,
  Activity,
  Lock,
  Router as RouterIcon,
  ExternalLink,
  ChevronDown,
  ChevronUp,
  Download,
  Upload,
  Laptop,
  Monitor,
  Cpu,
  CreditCard,
} from 'lucide-react';
import { format } from 'date-fns';
import toast from 'react-hot-toast';
import { useRef, useEffect } from 'react';
import { useOutletContext } from 'react-router-dom';
import api from '../../services/api';
import { CountdownBadge } from '../../components/CountdownBadge';

export default function Subscriptions() {
  const queryClient = useQueryClient();
  const { fireInternet } = useOutletContext<{ fireInternet: (u?: string, p?: string) => void }>();
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [isFixing, setIsFixing] = useState(false);
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [isLaunching, setIsLaunching] = useState(false);
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [traffic, setTraffic] = useState<{ downloadSpeed: string, uploadSpeed: string }>({ downloadSpeed: '0 bps', uploadSpeed: '0 bps' });
  const lastTraffic = useRef<{ bytesIn: number, bytesOut: number, time: number } | null>(null);

  // 1. Fetch ALL subscriptions for the list
  const { data: subscriptions = [], isLoading } = useQuery({
    queryKey: ['my_subscriptions'],
    queryFn: async () => {
      const res = await api.get('/subscriptions/my');
      return res.data;
    }
  });

  // 2. Unified Query Key: Centralizes the ACTIVE timer/status for the whole app
  const { data: allActiveSubsRaw = [] } = useQuery({
    queryKey: ['active-all-subscriptions'],
    queryFn: async () => {
      const res = await api.get('/subscriptions/my');
      return res.data;
    },
    refetchInterval: 10000,
  });

  const allActiveSubs = allActiveSubsRaw.filter((s: any) => 
    ['active', 'paid', 'pending', 'verified', 'allocated', 'awaiting_approval', 'verifying'].includes(s.status?.toLowerCase())
  );

  const activeSub = allActiveSubs.length > 0 ? allActiveSubs[0] : null;
  const lastActiveId = useRef<string | null>(null);

  useEffect(() => {
    // Detect when an active session disappears (Exited/Expired/Cancelled)
    if (lastActiveId.current && !activeSub && !isLoading) {
      toast.error('Session ended. Please renew to continue.', { 
        icon: '🛑',
        duration: 6000 
      });
      // Force a refresh of the lists
      queryClient.invalidateQueries({ queryKey: ['my_subscriptions'] });
    }
    lastActiveId.current = activeSub?.id || null;
  }, [activeSub, isLoading, queryClient]);

  const startMutation = useMutation({
    mutationFn: (id: string) => api.post(`/subscriptions/${id}/start`, { 
      mac: localStorage.getItem('hotspot_mac'),
      ip: localStorage.getItem('hotspot_ip')
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['my_subscriptions'] });
      queryClient.invalidateQueries({ queryKey: ['active-all-subscriptions'] });
      
      setIsLaunching(true);
      toast.success('Internet Activated! Launching...', { 
        icon: '🚀',
        duration: 3000 
      });

      // The "Fluid Magic" Redirect: Satisfies the phone's OS that we are now UNBLOCKED
      setTimeout(() => {
        fireInternet();
      }, 1500);
    },
    onError: (err: any) => {
      const msg = err.response?.data?.message || 'Connection failed. Try "Verify Device" again.';
      toast.error(msg);
    }
  });

  const pastSubs = Array.isArray(subscriptions) 
    ? subscriptions.filter((s: any) => !allActiveSubs.some((a: any) => a.id === s.id))
    : [];

  // Capture Hotspot Metadata (MAC, IP, etc) from URL and save to server
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const mac = params.get('mac');
    const ip = params.get('ip');
    
    if (mac) localStorage.setItem('hotspot_mac', mac);
    if (ip) localStorage.setItem('hotspot_ip', ip);
  }, []);

  // Poll traffic for active session (only for the primary one)
  useEffect(() => {
    if (!activeSub?.id || !activeSub?.startedAt) return;

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
  }, [activeSub?.id, activeSub?.startedAt]);

  if (isLoading) return (
    <div className="flex items-center justify-center p-16 text-slate-400 gap-3">
      <Clock className="animate-spin" size={20} /> Loading your subscriptions...
    </div>
  );

  return (
    <div className="max-w-4xl mx-auto pb-20 px-4">
      <div className="mb-12">
        <h2 className="text-4xl font-black text-main mb-2 tracking-tight uppercase">My Connection</h2>
        <p className="text-muted font-bold opacity-60">Manage your active Wi-Fi sessions and device identity.</p>
      </div>

      {allActiveSubs.length > 0 && (
        <div className="mb-16 space-y-10">
          <div className="flex items-center gap-3 px-2 mb-2">
            <Activity size={18} className="text-cyan-400 animate-pulse" />
            <h3 className="text-sm font-black text-main uppercase tracking-[0.25em]">CURRENT ACTIVE SESSIONS ({allActiveSubs.length})</h3>
          </div>

          {allActiveSubs.map((sub: any) => {
            const isLive = sub.startedAt && new Date(sub.expiresAt) > new Date();
            
            return (
              <div key={sub.id} className="relative group animate-fade-in">
                {/* ── 🚀 AMAZING CONNECTION CARD (Matches Screenshot 2) ── */}
                <div className="glass-panel p-6 md:p-10 border-cyan-500/20 bg-slate-900/40 relative overflow-hidden transition-all duration-500 hover:shadow-[0_0_50px_rgba(34,211,238,0.15)] rounded-[2.5rem]">
                  
                  {/* Status Banner Row (Screenshot 2 Match) */}
                  <div className="flex flex-col lg:flex-row items-center justify-between mb-8 gap-4 px-2">
                    <div className="flex flex-col lg:flex-row items-center gap-4 lg:gap-10">
                      <div className="flex flex-col">
                        <h3 className="text-4xl font-black text-white tracking-tight leading-none capitalize">{sub.package?.name}</h3>
                        <div className="flex items-center gap-3 mt-2">
                           <div className="flex items-center gap-1.5 font-bold text-[10px] text-slate-500 uppercase tracking-widest">
                             <Clock size={12} className="text-cyan-500/50" />
                             Acquired: <span className="text-slate-400">{sub.createdAt ? format(new Date(sub.createdAt), 'MMM d, HH:mm') : 'Unknown'}</span>
                           </div>
                           <div className="w-1 h-1 rounded-full bg-slate-800" />
                           <div className="flex items-center gap-1.5 font-bold text-[10px] text-slate-500 uppercase tracking-widest">
                             <CreditCard size={12} className="text-emerald-500/50" />
                             Via: <span className="text-emerald-400 opacity-60">{sub.paymentMethod || 'Manual'}</span>
                           </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 text-xs font-bold text-muted uppercase tracking-widest opacity-60">
                        <RouterIcon size={14} className="text-cyan-500" />
                        Location: <span className="text-white">{sub.router?.name || 'Pulselynk'}</span>
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 items-center">
                    
                    {/* Left: Device Detail Box (Screenshot Match) */}
                    <div className="lg:col-span-4 h-full">
                      <div className="bg-slate-950/40 border border-white/5 rounded-3xl p-6 h-full flex flex-col justify-center gap-6 backdrop-blur-md shadow-2xl group-hover:border-cyan-500/20 transition-colors">
                        <div className="flex items-center gap-5">
                          <div className="w-14 h-14 rounded-2xl bg-white/5 flex items-center justify-center text-cyan-400 border border-white/10 shrink-0">
                            {sub.deviceSessions?.[0]?.deviceModel?.toLowerCase().includes('iphone') ? <Smartphone size={28} /> : 
                             sub.deviceSessions?.[0]?.deviceModel?.toLowerCase().includes('windows') ? <Monitor size={28} /> : 
                             <Laptop size={28} />}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-[9px] font-black text-muted uppercase tracking-[0.25em] mb-1 truncate">DEVICE MODEL</p>
                            <h4 className="text-xs font-bold text-slate-300 tracking-wide leading-relaxed truncate">
                              {sub.deviceSessions?.[0]?.deviceModel || (sub.startedAt ? 'Detected Device' : 'Your Current Device')}
                            </h4>
                            <div className="flex items-center gap-2 mt-2">
                              <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse shadow-[0_0_8px_rgba(16,185,129,0.8)]" />
                              <span className="text-[10px] font-black text-emerald-400 uppercase tracking-widest leading-none truncate">Verified Identity</span>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Right: Live Connectivity Box (Screenshot 2 Match) */}
                    <div className="lg:col-span-8 space-y-4">
                      {isLive ? (
                        <>
                          <div className="w-full bg-[#0c1a1f] border border-cyan-500/20 rounded-2xl py-6 px-10 flex items-center justify-between group-hover:bg-[#0e2126] transition-all duration-700 relative overflow-hidden shadow-inner">
                            <div className="absolute inset-0 bg-gradient-to-r from-transparent via-cyan-400/5 to-transparent -translate-x-full animate-[shimmer_3s_infinite]" />
                            <div className="flex items-center gap-4 relative z-10">
                              <div className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-pulse" />
                              <span className="text-sm font-black text-emerald-400 uppercase tracking-[0.3em]">SURFING LIVE</span>
                            </div>
                            <button 
                              onClick={() => {
                                startMutation.mutate(sub.id);
                                toast.success('Connecting this device...', { icon: '🔄' });
                              }}
                              className="text-[10px] font-black text-cyan-400 uppercase tracking-widest hover:text-white transition-all underline underline-offset-4 relative z-10"
                            >
                              CONNECT THIS DEVICE
                            </button>
                          </div>

                          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div className="bg-slate-950/40 rounded-2xl p-5 border border-white/5 flex flex-col items-center justify-center gap-1 shadow-inner hover:bg-slate-950/60 transition-colors">
                              <Download size={20} className="text-cyan-400 mb-1" />
                              <span className="text-base font-black text-white">{traffic.downloadSpeed}</span>
                              <span className="text-[9px] font-bold text-muted uppercase tracking-tighter">DOWNLOAD</span>
                            </div>
                            <div className="bg-slate-950/40 rounded-2xl p-5 border border-white/5 flex flex-col items-center justify-center gap-1 shadow-inner hover:bg-slate-950/60 transition-colors">
                              <Upload size={20} className="text-emerald-400 mb-1" />
                              <span className="text-base font-black text-white">{traffic.uploadSpeed}</span>
                              <span className="text-[9px] font-bold text-muted uppercase tracking-tighter">UPLOAD</span>
                            </div>
                          </div>
                        </>
                      ) : (
                        <div className="w-full bg-slate-950/40 border border-white/5 rounded-2xl p-10 flex flex-col items-center justify-center gap-4 group-hover:border-cyan-500/20 transition-all text-center">
                           <Play size={40} className="text-slate-700 mb-2 opacity-30" />
                           <h4 className="text-2xl font-black text-slate-500 tracking-[0.2em] mb-2 uppercase">TIMER READY</h4>
                           <p className="text-[10px] text-muted font-bold uppercase tracking-widest mb-4">Queued and verified</p>
                            <button 
                              onClick={() => startMutation.mutate(sub.id)}
                              disabled={startMutation.isPending || !!allActiveSubs.find((s: any) => s.startedAt && new Date(s.expiresAt) > new Date()) || sub.status === 'AWAITING_APPROVAL' || sub.status === 'VERIFYING'}
                              className={`btn-primary px-10 py-4 text-xs font-black tracking-widest uppercase shadow-lg transition-all transform hover:scale-105 ${
                                (!!allActiveSubs.find((s: any) => s.startedAt && new Date(s.expiresAt) > new Date()) || sub.status === 'AWAITING_APPROVAL' || sub.status === 'VERIFYING') 
                                ? 'opacity-30 cursor-not-allowed grayscale' 
                                : 'bg-gradient-to-r from-emerald-600 to-teal-600 shadow-emerald-900/20 hover:shadow-emerald-400/20'
                              }`}
                            >
                             {startMutation.isPending ? <RefreshCw className="animate-spin" size={18} /> : 
                              (sub.status === 'AWAITING_APPROVAL' || sub.status === 'VERIFYING') ? 'LOCKED' : 
                              !!allActiveSubs.find((s: any) => s.startedAt && new Date(s.expiresAt) > new Date()) ? 'LOCKED' : 'ACTIVATE INTERNET'}
                            </button>
                        </div>
                      )}
                      
                      <div className="flex justify-between items-center px-4 pt-2">
                        <div className="flex items-center gap-4">
                           <div className="flex items-center gap-2">
                             <Clock size={14} className="text-slate-500" />
                             <span className="text-[10px] font-black text-muted uppercase tracking-[0.2em]">REMAINING TIME</span>
                           </div>
                           <CountdownBadge expiresAt={sub.expiresAt} startedAt={sub.startedAt} variant="inline" size="md" />
                        </div>
                        <div className={`px-5 py-2 rounded-full border flex items-center gap-3 ${
                           isLive ? 'bg-cyan-500/10 border-cyan-500/20' : 
                           sub.status === 'AWAITING_APPROVAL' ? 'bg-amber-500/10 border-amber-500/20' :
                           sub.status === 'VERIFYING' ? 'bg-blue-500/10 border-blue-500/20' :
                           sub.status === 'PAID' ? 'bg-emerald-500/10 border-emerald-500/20' :
                           'bg-slate-500/10 border-slate-500/20'
                        }`}>
                           <div className={`w-1.5 h-1.5 rounded-full ${
                             isLive ? 'bg-cyan-400 shadow-[0_0_8px_#22d3ee]' : 
                             sub.status === 'AWAITING_APPROVAL' ? 'bg-amber-400 shadow-[0_0_8px_#f59e0b]' :
                             sub.status === 'VERIFYING' ? 'bg-blue-400 shadow-[0_0_8px_#3b82f6]' :
                             sub.status === 'PAID' ? 'bg-emerald-400 shadow-[0_0_8px_#10b981]' :
                             'bg-slate-400'
                           }`} />
                           <span className={`text-[9px] font-black uppercase tracking-widest ${
                             isLive ? 'text-cyan-400' : 
                             sub.status === 'AWAITING_APPROVAL' ? 'text-amber-400' :
                             sub.status === 'VERIFYING' ? 'text-blue-400' :
                             sub.status === 'PAID' ? 'text-emerald-400' :
                             'text-slate-400'
                           }`}>
                             STATUS: {isLive ? 'CONNECTED' : 
                                     sub.status === 'AWAITING_APPROVAL' ? 'AWAITING ADMIN' :
                                     sub.status === 'VERIFYING' ? 'VERIFYING PAY' :
                                     sub.status === 'PAID' ? 'READY' : 
                                     'READY TO START'}
                           </span>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <div>
        <h3 className="text-sm font-black tracking-widest text-muted uppercase mb-6 flex items-center gap-3 opacity-50">
          <History size={18} /> PAST SESSION HISTORY
        </h3>

        {pastSubs.length === 0 ? (
          <div className="glass-panel p-12 text-center text-slate-500 border-dashed bg-slate-900/20">
            No previous sessions found. Your history will appear here.
          </div>
        ) : (
          <div className="grid gap-6">
            {pastSubs.map((sub: any) => (
              <div 
                key={sub.id}
                className="glass-panel p-6 bg-slate-900/40 border-white/5 hover:border-cyan-500/20 transition-all cursor-pointer group hover:shadow-[0_0_30px_rgba(34,211,238,0.05)]"
                onClick={() => setExpandedId(expandedId === sub.id ? null : sub.id)}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-6">
                    <div className="w-14 h-14 rounded-2xl bg-slate-800 flex items-center justify-center text-slate-500 group-hover:bg-slate-700 group-hover:text-cyan-400 transition-all border border-white/5 shadow-inner">
                      <History size={28} />
                    </div>
                    <div>
                      <h4 className="font-black text-main text-xl tracking-tight leading-none mb-1">{sub.package?.name}</h4>
                      <p className="text-[10px] font-bold text-muted uppercase tracking-widest flex items-center gap-2 opacity-60">
                        <MapPin size={12} /> {sub.router?.name} • {new Date(sub.createdAt).toLocaleDateString()}
                      </p>
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-white font-black text-xl tracking-tighter mb-1">KES {sub.amountPaid}</div>
                    <div className={`text-[9px] font-black px-3 py-1 bg-slate-950/60 border rounded-full uppercase tracking-[0.2em] ${sub.status?.toString().toLowerCase() === 'expired' ? 'text-orange-400 border-orange-500/20' : 'text-emerald-400 border-emerald-500/20'}`}>
                      {sub.status}
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
