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
import api from '../../services/api';
import { CountdownBadge } from '../../components/CountdownBadge';

export default function Subscriptions() {
  const queryClient = useQueryClient();
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [traffic, setTraffic] = useState<{ downloadSpeed: string, uploadSpeed: string }>({ downloadSpeed: '0 bps', uploadSpeed: '0 bps' });
  const lastTraffic = useRef<{ bytesIn: number, bytesOut: number, time: number } | null>(null);

  const { data: subscriptions, isLoading } = useQuery({
    queryKey: ['my_subscriptions'],
    queryFn: async () => {
      const res = await api.get('/subscriptions/my');
      return res.data;
    }
  });

  const startMutation = useMutation({
    mutationFn: (id: string) => api.post(`/subscriptions/${id}/start`, { 
      mac: localStorage.getItem('hotspot_mac'),
      ip: localStorage.getItem('hotspot_ip')
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['my_subscriptions'] });
      toast.success('Connection Verified!');
    },
    onError: (err: any) => {
      const msg = err.response?.data?.message || 'Connection failed. Try "Verify Device" again.';
      toast.error(msg);
    }
  });

  const activeSub = subscriptions?.active || subscriptions?.find((s: any) => s.status === 'active' || s.status === 'pending');
  const pastSubs = subscriptions?.past || subscriptions?.filter((s: any) => s.status !== 'active' && s.status !== 'pending') || [];

  // Poll traffic for active session
  useEffect(() => {
    if (!activeSub?.id || !activeSub?.startedAt) return;

    const fetchTraffic = async () => {
      try {
        const res = await api.get('/subscriptions/my/traffic');
        const data = res.data;
        const now = Date.now();
        
        if (lastTraffic.current && lastTraffic.current.time && data) {
          const timeDiff = Math.max((now - lastTraffic.current.time) / 1000, 1);
          const bytesIn = Number(data.bytesIn) || 0;
          const bytesOut = Number(data.bytesOut) || 0;
          
          const downBits = Math.max((bytesIn - lastTraffic.current.bytesIn) * 8, 0) / timeDiff;
          const upBits = Math.max((bytesOut - lastTraffic.current.bytesOut) * 8, 0) / timeDiff;

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
    <div className="max-w-4xl mx-auto pb-20">
      <div className="mb-8">
        <h2 className="text-3xl font-bold text-white mb-2">My Connection</h2>
        <p className="text-slate-400">Manage your active Wi-Fi sessions and device identity.</p>
      </div>

      {activeSub && (
        <div className="mb-10 animate-fade-in">
          <h3 className="text-sm font-bold tracking-widest text-cyan-400 uppercase mb-4 flex items-center gap-2">
            <Activity size={16} className="animate-pulse" /> Current Active Session
          </h3>
          
          <div className="glass-panel p-8 relative overflow-hidden border-cyan-500/30 shadow-[0_0_30px_rgba(14,165,233,0.15)] bg-gradient-to-br from-[#0f172a] to-[rgba(14,165,233,0.1)]">
            <div className="absolute top-0 right-0 w-64 h-64 bg-cyan-500/10 blur-[80px] rounded-full pointer-events-none"></div>
            
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-6 relative z-10">
              <div className="flex-1">
                <h4 className="text-3xl font-black text-white mb-2">{activeSub.package.name}</h4>
                <div className="flex items-center gap-2 text-slate-400 mb-4">
                  <RouterIcon size={16} /> 
                  <span>Location: <span className="text-slate-200 font-bold">{activeSub.router.name}</span></span>
                </div>

                <div className="flex flex-col md:flex-row items-center gap-4 bg-slate-800/50 backdrop-blur-sm p-4 rounded-xl border border-slate-700/30">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-lg bg-cyan-500/10 flex items-center justify-center text-cyan-400">
                      <Smartphone size={20} />
                    </div>
                    <div>
                      <div className="text-[10px] text-slate-500 font-bold uppercase tracking-wider">Device Model</div>
                      <div className="text-slate-200 font-mono text-xs font-bold">
                        {activeSub.user?.deviceModel || activeSub.user?.lastMac || localStorage.getItem('hotspot_mac') || 'DETECTING...'}
                      </div>
                    </div>
                  </div>
                  
                  <div className="h-6 w-px bg-slate-700 hidden md:block"></div>
                  
                  <div className="flex items-center gap-3">
                    <div className={`w-2 h-2 rounded-full ${activeSub.user?.lastMac || localStorage.getItem('hotspot_mac') ? 'bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]' : 'bg-amber-500 animate-pulse'}`} />
                    <div className="text-xs font-bold text-slate-400">
                      {activeSub.user?.lastMac || localStorage.getItem('hotspot_mac') ? 'Verified Identity' : 'Identity Sync Required'}
                    </div>
                  </div>
                </div>
              </div>

              <div className="bg-black/40 backdrop-blur-md p-6 rounded-2xl border border-white/10 w-full md:w-auto min-w-[300px]">
                <div className="flex flex-col gap-4">
                  {activeSub.router.connectionMode === 'hotspot' && (
                    <div className="space-y-4">
                      {!(activeSub.user?.lastMac || localStorage.getItem('hotspot_mac')) ? (
                        <button 
                          onClick={(e) => {
                            e.stopPropagation();
                            const gateway = activeSub.router.localGateway || '10.5.50.1';
                            window.location.href = `http://${gateway}/login?dst=${encodeURIComponent(window.location.href)}`;
                          }}
                          className="w-full bg-amber-500 hover:bg-amber-400 text-slate-900 px-6 py-4 rounded-xl flex items-center justify-center gap-3 font-black uppercase tracking-widest shadow-xl shadow-amber-500/20 transition-all hover:scale-105 active:scale-95 border-none"
                        >
                          <RefreshCw size={20} className="animate-spin" />
                          Verify My Device
                        </button>
                      ) : (
                        /* Condition: If speed is > 0 show ONLINE badge */
                        (traffic.downloadSpeed !== '0 bps' || traffic.uploadSpeed !== '0 bps') ? (
                          <div className="w-full flex items-center justify-center gap-3 bg-emerald-500/10 border border-emerald-500/30 px-6 py-4 rounded-xl shadow-[0_0_20px_rgba(16,185,129,0.1)]">
                            <div className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-ping" />
                            <span className="text-emerald-400 font-black tracking-widest uppercase text-sm">SURFING LIVE</span>
                            <button 
                              onClick={() => startMutation.mutate(activeSub.id)}
                              className="ml-4 text-[10px] text-slate-500 hover:text-cyan-400 font-bold uppercase transition-colors"
                            >
                              Sync
                            </button>
                          </div>
                        ) : (
                          <button 
                            onClick={() => {
                              startMutation.mutate(activeSub.id, {
                                onSuccess: () => {
                                  document.getElementById('hotspot-login-form')?.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
                                }
                              });
                            }}
                            disabled={startMutation.isPending}
                            className="w-full bg-cyan-600 hover:bg-cyan-500 text-white font-black uppercase tracking-[0.1em] py-4 rounded-xl flex items-center justify-center gap-2 shadow-lg shadow-cyan-900/40 border border-cyan-400/30 transition-all active:scale-[0.98]"
                          >
                            {startMutation.isPending ? (
                              <RefreshCw size={20} className="animate-spin" />
                            ) : (
                              <Zap size={20} fill="currentColor" />
                            )}
                            {startMutation.isPending ? 'Certifying Connection...' : (activeSub.startedAt ? 'Bring Internet to this Device' : '1-Click Start Internet')}
                          </button>
                        )
                      )}

                      {activeSub.startedAt && (
                        <div className="flex justify-around items-center bg-black/40 p-4 rounded-xl border border-white/5">
                          <div className="flex flex-col items-center gap-1">
                            <div className="flex items-center gap-2 text-cyan-400 font-bold">
                              <Download size={16} />
                              <span className="text-sm font-mono">{traffic.downloadSpeed}</span>
                            </div>
                            <span className="text-[9px] uppercase tracking-tighter text-slate-500">Download</span>
                          </div>
                          <div className="w-px h-8 bg-white/10"></div>
                          <div className="flex flex-col items-center gap-1">
                            <div className="flex items-center gap-2 text-blue-400 font-bold">
                              <Upload size={16} />
                              <span className="text-sm font-mono">{traffic.uploadSpeed}</span>
                            </div>
                            <span className="text-[9px] uppercase tracking-tighter text-slate-500">Upload</span>
                          </div>
                        </div>
                      )}

                      {/* Hidden Router Form */}
                      <form 
                        id="hotspot-login-form"
                        method="POST" 
                        action={`http://${activeSub.router.localGateway || '10.5.50.1'}/login`}
                        className="hidden"
                      >
                        <input type="hidden" name="username" value={activeSub.mikrotikUsername} />
                        <input type="hidden" name="password" value={activeSub.mikrotikPassword} />
                        <input type="hidden" name="dst" value="https://google.com" />
                      </form>
                    </div>
                  )}

                  <div className="pt-4 border-t border-white/10 flex justify-between items-end">
                    <div className="flex flex-col">
                      <span className="text-[10px] text-slate-500 font-bold uppercase tracking-wider">Remaining Time</span>
                      <CountdownBadge expiresAt={activeSub.expiresAt} startedAt={activeSub.startedAt} size="lg" />
                    </div>
                    <div className="text-right">
                       <span className="text-[10px] text-slate-500 font-bold uppercase tracking-wider">Status</span>
                       <div className="text-emerald-400 font-bold text-sm bg-emerald-500/10 px-3 py-1 rounded-full border border-emerald-500/20">
                         {activeSub.startedAt ? 'CONNECTED' : 'READY TO START'}
                       </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      <div>
        <h3 className="text-sm font-bold tracking-widest text-slate-500 uppercase mb-4 flex items-center gap-2">
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
                      <h4 className="font-bold text-white text-lg">{sub.package.name}</h4>
                      <p className="text-xs text-slate-500 flex items-center gap-2">
                        <MapPin size={12} /> {sub.router.name} • {new Date(sub.createdAt).toLocaleDateString()}
                      </p>
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-white font-bold mb-1">KES {sub.amountPaid}</div>
                    <div className="text-[10px] text-slate-500 font-bold px-2 py-1 bg-slate-800 rounded uppercase tracking-wider">
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
