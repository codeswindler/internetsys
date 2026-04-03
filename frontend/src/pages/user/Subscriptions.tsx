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
  Upload
} from 'lucide-react';
import toast from 'react-hot-toast';
import { useRef, useEffect } from 'react';
import { useOutletContext } from 'react-router-dom';
import api from '../../services/api';
import { CountdownBadge } from '../../components/CountdownBadge';

export default function Subscriptions() {
  const queryClient = useQueryClient();
  const { fireInternet } = useOutletContext<{ fireInternet: (u?: string, p?: string) => void }>();
  const [isFixing, setIsFixing] = useState(false);
  const [isLaunching, setIsLaunching] = useState(false);
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
  const { data: allActiveSubs = [] } = useQuery({
    queryKey: ['active-all-subscriptions'],
    queryFn: async () => {
      const res = await api.get('/subscriptions/active-all');
      return res.data;
    },
    refetchInterval: 10000,
  });

  const activeSub = allActiveSubs.length > 0 ? allActiveSubs[0] : null;

  const startMutation = useMutation({
    mutationFn: (id: string) => api.post(`/subscriptions/${id}/start`, { 
      mac: localStorage.getItem('hotspot_mac'),
      ip: localStorage.getItem('hotspot_ip')
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['my_subscriptions'] });
      queryClient.invalidateQueries({ queryKey: ['active-all-subscriptions'] });
      
      setIsLaunching(true);
      toast.success('Internet Flowing! Launching in 3s...', { 
        icon: '🚀',
        duration: 3000 
      });

      // The "Fluid Magic" Redirect: Satisfies the phone's OS that we are now UNBLOCKED
      // We use HTTP first (pulselynk.co.ke) to avoid SSL-intercept errors
      setTimeout(() => {
        window.location.href = 'http://pulselynk.co.ke';
      }, 3000);
    },
    onError: (err: any) => {
      const msg = err.response?.data?.message || 'Connection failed. Try "Verify Device" again.';
      toast.error(msg);
    }
  });

  const pastSubs = Array.isArray(subscriptions) 
    ? subscriptions.filter((s: any) => !allActiveSubs.some((a: any) => a.id === s.id))
    : [];

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
      <div className="mb-8">
        <h2 className="text-3xl font-bold text-main mb-2">My Connection</h2>
        <p className="text-muted">Manage your active Wi-Fi sessions and device identity.</p>
      </div>

      {allActiveSubs.length > 0 && (
        <div className="mb-12 space-y-6">
          <h3 className="text-sm font-bold tracking-widest text-cyan-400 uppercase mb-4 flex items-center gap-2">
            <Activity size={16} className="animate-pulse" />
            Current Active Sessions ({allActiveSubs.length})
          </h3>
          
          {allActiveSubs.map((sub: any) => (
            <div key={sub.id} className="glass-panel p-6 border-cyan-500/30 bg-panel shadow-lg shadow-cyan-900/10 animate-fade-in relative overflow-hidden group">
              <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-6 relative z-10">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <span className={`text-[10px] font-black uppercase tracking-widest px-2 py-0.5 rounded-full ${sub.startedAt ? 'bg-emerald-500/20 text-emerald-400' : 'bg-cyan-500/20 text-cyan-400'}`}>
                      {sub.startedAt ? 'Online Now' : 'READY TO START'}
                    </span>
                    {sub.startedAt && <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-ping"></span>}
                  </div>
                  <h4 className="text-3xl font-black text-main mb-2">{sub.package.name}</h4>
                  <div className="flex items-center gap-2 text-muted mb-4">
                    <RouterIcon size={16} /> 
                    <span>Authorized for: <span className="text-main font-bold">{sub.router.name}</span></span>
                  </div>

                  <div className="flex flex-wrap gap-4">
                    {sub.deviceSessions && sub.deviceSessions.length > 0 ? (
                      sub.deviceSessions.map((session: any) => (
                        <div key={session.id} className="flex items-center gap-3 bg-panel p-3 rounded-xl border border-border-color shadow-sm">
                          <Smartphone size={16} className="text-cyan-400" />
                          <div>
                            <div className="text-[10px] text-main font-bold font-mono">
                              {session.deviceModel || 'Connected Device'}
                            </div>
                            <div className="text-[8px] text-muted font-mono">{session.macAddress}</div>
                          </div>
                        </div>
                      ))
                    ) : (
                      <div className="flex items-center gap-3 bg-panel p-3 rounded-xl border border-border-color shadow-sm border-dashed">
                        <Smartphone size={16} className="text-muted" />
                        <div className="text-[10px] text-muted font-bold">READY TO CONNECT</div>
                      </div>
                    )}
                  </div>
                </div>

                <div className="flex flex-col items-center md:items-end gap-3 w-full md:w-auto">
                  {sub.startedAt ? (
                    <div className="flex flex-col items-center md:items-end gap-2">
                      <CountdownBadge expiresAt={sub.expiresAt} startedAt={sub.startedAt} variant="block" />
                      
                      {sub.id === activeSub?.id && (
                        <div className="flex items-center gap-4 bg-muted/5 px-4 py-2 rounded-xl border border-border-color">
                           <div className="flex items-center gap-2 text-cyan-400">
                             <Download size={14} />
                             <span className="text-xs font-mono font-bold">{traffic.downloadSpeed}</span>
                           </div>
                           <div className="flex items-center gap-2 text-blue-400">
                             <Upload size={14} />
                             <span className="text-xs font-mono font-bold">{traffic.uploadSpeed}</span>
                           </div>
                        </div>
                      )}
                    </div>
                  ) : (
                    <button 
                      onClick={() => startMutation.mutate(sub.id)}
                      disabled={startMutation.isPending || !!allActiveSubs.find((s: any) => s.startedAt && new Date(s.expiresAt) > new Date())}
                      className={`btn-primary w-full md:w-56 py-4 text-sm font-black tracking-widest uppercase shadow-lg transform hover:scale-105 transition-all flex items-center justify-center gap-3 ${
                        !!allActiveSubs.find((s: any) => s.startedAt && new Date(s.expiresAt) > new Date()) 
                        ? 'opacity-50 cursor-not-allowed grayscale shadow-none' 
                        : 'shadow-cyan-900/40'
                      }`}
                    >
                      {startMutation.isPending ? (
                        <RefreshCw className="animate-spin" size={18} />
                      ) : (
                        !!allActiveSubs.find((s: any) => s.startedAt && new Date(s.expiresAt) > new Date()) ? (
                          <><Lock size={18} /> Locked</>
                        ) : (
                          <><Play size={18} /> Start Browsing</>
                        )
                      )}
                    </button>
                  )}
                  
                  <button 
                    onClick={() => {
                        localStorage.removeItem('hotspot_mac');
                        localStorage.removeItem('hotspot_ip');
                        startMutation.mutate(sub.id);
                        toast.success('Repaired device identity!', { icon: '🔧' });
                    }}
                    className="text-[10px] font-bold text-muted hover:text-cyan-400 flex items-center gap-1.5 transition-colors"
                  >
                    <RefreshCw size={12} /> Fix Connection
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <div>
        <h3 className="text-sm font-bold tracking-widest text-muted uppercase mb-4 flex items-center gap-2">
          <History size={16} /> Past Sessions
        </h3>

        {pastSubs.length === 0 ? (
          <div className="glass-panel p-8 text-center text-slate-500 border-dashed">
            No previous sessions found. Your history will appear here.
          </div>
        ) : (
          <div className="grid gap-4">
            {pastSubs.map((sub: any) => (
              <div 
                key={sub.id}
                className="glass-panel p-5 hover:border-slate-600 transition-all cursor-pointer group"
                onClick={() => setExpandedId(expandedId === sub.id ? null : sub.id)}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-4">
                    <div className="w-12 h-12 rounded-xl bg-slate-800 flex items-center justify-center text-slate-400 group-hover:bg-slate-700 transition-all">
                      <History size={24} />
                    </div>
                    <div>
                      <h4 className="font-bold text-main text-lg">{sub.package.name}</h4>
                      <p className="text-xs text-muted flex items-center gap-2">
                        <MapPin size={12} /> {sub.router.name} • {new Date(sub.createdAt).toLocaleDateString()}
                      </p>
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-main font-bold mb-1">KES {sub.amountPaid}</div>
                    <div className={`text-[10px] font-bold px-2 py-1 bg-panel border rounded uppercase tracking-wider ${sub.status?.toString().toLowerCase() === 'expired' ? 'text-orange-400 border-orange-500/20' : 'text-emerald-400 border-emerald-500/20'}`}>
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
