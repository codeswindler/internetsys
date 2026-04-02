import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Wifi, Clock, Activity, Lock, Router as RouterIcon, ExternalLink, ChevronDown, ChevronUp, Zap, Download, Upload, RefreshCw } from 'lucide-react';
import toast from 'react-hot-toast';
import { useRef, useEffect } from 'react';
import api from '../../services/api';
import { CountdownBadge } from '../../components/CountdownBadge';

export default function Subscriptions() {
  const queryClient = useQueryClient();
  const [showManual, setShowManual] = useState(false);
  const [traffic, setTraffic] = useState<{ downloadSpeed: string, uploadSpeed: string }>({ downloadSpeed: '0 bps', uploadSpeed: '0 bps' });
  const lastTraffic = useRef<{ bytesIn: number, bytesOut: number, time: number } | null>(null);

  const { data: subs, isLoading } = useQuery({
    queryKey: ['my_subscriptions'],
    queryFn: () => api.get('/subscriptions/my').then(res => res.data),
    refetchInterval: 10000,
  });

  const startMutation = useMutation({
    mutationFn: (subId: string) => {
      const mac = localStorage.getItem('hotspot_mac');
      const ip = localStorage.getItem('hotspot_ip');
      return api.post(`/subscriptions/${subId}/start`, { mac, ip });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['my_subscriptions'] });
      toast.success('Session started! You are now connected.');
    },
    onError: () => toast.error('Failed to start session timer'),
  });

  const activeSub = subs?.find((s: any) => s.status === 'active');
  const pastSubs = subs?.filter((s: any) => s.status !== 'active') || [];

  // Poll for real-time traffic
  useEffect(() => {
    if (!activeSub || !activeSub.startedAt) return;

    const fetchTraffic = async () => {
      try {
        const res = await api.get('/subscriptions/my/traffic');
        const data = res.data;
        if (!data) return;

        const now = Date.now();
        if (lastTraffic.current) {
          const timeDiff = (now - lastTraffic.current.time) / 1000;
          const downBits = (data.bytesOut - lastTraffic.current.bytesOut) * 8;
          const upBits = (data.bytesIn - lastTraffic.current.bytesIn) * 8;
          
          const formatSpeed = (bits: number) => {
            const bps = bits / timeDiff;
            if (bps > 1000000) return `${(bps / 1000000).toFixed(1)} Mbps`;
            if (bps > 1000) return `${(bps / 1000).toFixed(0)} Kbps`;
            return `${bps.toFixed(0)} bps`;
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
    <div className="max-w-4xl mx-auto">
      <div className="mb-8">
        <h2 className="text-3xl font-bold text-white mb-2">My Connection History</h2>
        <p className="text-slate-400">View your active Wi-Fi credentials and past sessions.</p>
      </div>

      {activeSub && (
        <div className="mb-10 animate-fade-in">
          <h3 className="text-sm font-bold tracking-widest text-cyan-400 uppercase mb-4 flex items-center gap-2">
            <Activity size={16} className="animate-pulse" /> Active Session
          </h3>
          
          <div className="glass-panel p-8 relative overflow-hidden border-cyan-500/30 shadow-[0_0_30px_rgba(14,165,233,0.15)] bg-gradient-to-br from-[#0f172a] to-[rgba(14,165,233,0.1)]">
            <div className="absolute top-0 right-0 w-64 h-64 bg-cyan-500/10 blur-[80px] rounded-full pointer-events-none"></div>
            
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-6 relative z-10">
              <div>
                <h4 className="text-3xl font-black text-white mb-2">{activeSub.package.name}</h4>
                <div className="flex flex-col gap-1 text-slate-300">
                  <div className="flex items-center gap-2">
                    <RouterIcon size={16} /> Connected to <span className="font-medium text-white">{activeSub.router.name}</span>
                  </div>
                   <div className="flex items-center gap-1.5 mt-1">
                    <div className={`w-1.5 h-1.5 rounded-full ${activeSub.user?.lastMac || localStorage.getItem('hotspot_mac') ? 'bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.6)]' : 'bg-amber-500 animate-pulse'}`}></div>
                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-tight flex items-center gap-1.5">
                      Device ID: {activeSub.user?.lastMac || localStorage.getItem('hotspot_mac') ? 'Verified' : 'Detecting...'}
                      {!activeSub.user?.lastMac && !localStorage.getItem('hotspot_mac') && (
                        <button 
                          onClick={(e) => {
                            e.stopPropagation();
                            const gateway = activeSub.router.localGateway || '10.5.50.1';
                            window.location.href = `http://${gateway}/login?dst=${encodeURIComponent(window.location.href)}`;
                          }}
                          className="flex items-center gap-1 bg-amber-500/20 hover:bg-amber-500/40 text-amber-500 px-2 py-0.5 rounded border border-amber-500/30 transition-all"
                        >
                          <RefreshCw size={10} />
                          Fix Connection
                        </button>
                      )}
                    </span>
                  </div>
                </div>
              </div>

              <div className="bg-black/40 backdrop-blur-md p-5 rounded-2xl border border-white/10 w-full md:w-auto min-w-[280px]">
                <div className="flex flex-col gap-4">
                  {activeSub.router.connectionMode === 'hotspot' && (
                    <div className="space-y-4">
                      {/* 1-Click Connect Button */}
                      <button 
                        onClick={() => {
                          if (!activeSub.startedAt) {
                            startMutation.mutate(activeSub.id, {
                              onSuccess: () => {
                                // After starting session, submit the form to the router
                                document.getElementById('hotspot-login-form')?.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
                              }
                            });
                          } else {
                            // If already started, just submit
                            (document.getElementById('hotspot-login-form') as HTMLFormElement)?.submit();
                          }
                        }}
                        disabled={startMutation.isPending}
                        className="w-full py-4 rounded-xl font-black uppercase tracking-widest bg-gradient-to-r from-cyan-500 to-blue-600 text-white shadow-[0_0_20px_rgba(6,182,212,0.4)] hover:shadow-[0_0_30px_rgba(6,182,212,0.6)] transition-all flex items-center justify-center gap-3 active:scale-95"
                      >
                        {startMutation.isPending ? (
                          <Clock className="animate-spin" size={20} />
                        ) : (
                          <>
                            <Zap size={20} fill="currentColor" />
                            {activeSub.startedAt ? 'Bring Internet to this Device' : '1-Click Start Internet'}
                          </>
                        )}
                      </button>

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
                        action={`http://10.10.1.1/login`} 
                        method="get" 
                        target="_self"
                        className="hidden"
                      >
                        <input type="hidden" name="username" value={activeSub.mikrotikUsername} />
                        <input type="hidden" name="password" value={activeSub.mikrotikPassword} />
                        <input type="hidden" name="dst" value="http://www.google.com" />
                      </form>

                      {/* Expandable Manual Details */}
                      <div className="border-t border-white/5 pt-3">
                        <button 
                          onClick={() => setShowManual(!showManual)}
                          className="text-[10px] text-slate-500 hover:text-cyan-400 font-bold uppercase tracking-widest flex items-center gap-1.5 transition-colors mx-auto"
                        >
                          {showManual ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                          {showManual ? 'Hide Manual Details' : 'Show Manual Login Details'}
                        </button>

                        {showManual && (
                          <div className="mt-4 p-4 rounded-xl bg-black/30 border border-white/5 animate-in fade-in slide-in-from-top-2 duration-300">
                            <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-3 flex items-center gap-2">
                              <Lock size={12}/> Hotspot Credentials
                            </p>
                            <div className="space-y-3">
                              <div className="flex justify-between items-center gap-6 text-sm">
                                <span className="text-slate-400">Username:</span>
                                <span className="font-mono font-bold text-cyan-400 bg-cyan-950/50 px-2 py-0.5 rounded">{activeSub.mikrotikUsername}</span>
                              </div>
                              <div className="flex justify-between items-center gap-6 text-sm">
                                <span className="text-slate-400">Password:</span>
                                <span className="font-mono font-bold text-cyan-400 bg-cyan-950/50 px-2 py-0.5 rounded">{activeSub.mikrotikPassword}</span>
                              </div>
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  {activeSub.router.connectionMode === 'pppoe' && (
                    <div className="space-y-4">
                       <p className="text-xs font-bold text-slate-400 uppercase tracking-widest flex items-center gap-2">
                        <Lock size={14}/> PPPoE WAN Credentials
                      </p>
                      <div className="bg-black/30 p-4 rounded-xl border border-white/5 space-y-3">
                        <div className="flex justify-between items-center gap-6 text-sm">
                          <span className="text-slate-400">Username:</span>
                          <span className="font-mono font-bold text-purple-400 bg-purple-950/50 px-2 py-0.5 rounded">{activeSub.mikrotikUsername}</span>
                        </div>
                        <div className="flex justify-between items-center gap-6 text-sm">
                          <span className="text-slate-400">Password:</span>
                          <span className="font-mono font-bold text-purple-400 bg-purple-950/50 px-2 py-0.5 rounded">{activeSub.mikrotikPassword}</span>
                        </div>
                      </div>
                      <div className="p-3 rounded-lg bg-white/5 text-[10px] text-slate-400 leading-relaxed italic">
                        <strong>Setup:</strong> Enter these details into your home router's WAN settings. Timer starts on first connection.
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Countdown section */}
            <div className="mt-8 pt-6 border-t border-white/10 flex flex-col md:flex-row justify-between items-center gap-6 relative z-10">
              {activeSub.startedAt ? (
                <>
                  <CountdownBadge expiresAt={activeSub.expiresAt} variant="block" />
                  <div className="text-xs text-slate-500 bg-slate-800/50 px-3 py-2 rounded-lg border border-white/5">
                    Expires on {new Date(activeSub.expiresAt).toLocaleString()}
                  </div>
                </>
              ) : (
                <div className="flex items-center gap-3 text-cyan-400/80 font-bold text-sm bg-cyan-500/5 px-4 py-3 rounded-xl border border-cyan-500/20 w-full animate-pulse">
                  <Clock size={18} />
                  Session not started yet. Clock starts when you click connect.
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {!activeSub && !isLoading && (
        <div className="mb-10 glass-panel p-8 text-center text-slate-400 border border-dashed border-slate-700">
          <Wifi size={32} className="mx-auto mb-3 text-slate-600" />
          <p className="font-medium">No active subscription</p>
          <p className="text-sm text-slate-500 mt-1">Contact your ISP to activate a plan.</p>
        </div>
      )}

      <div>
        <h3 className="text-sm font-bold tracking-widest text-slate-500 uppercase mb-4">Past Sessions</h3>
        
        {pastSubs.length === 0 ? (
          <div className="glass-panel p-8 text-center text-slate-400">
            No past subscriptions found.
          </div>
        ) : (
          <div className="grid gap-4">
            {pastSubs.map((sub: any) => (
              <div key={sub.id} className="glass-panel p-5 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 hover:bg-[rgba(255,255,255,0.02)] transition-colors">
                <div className="flex items-start gap-4">
                  <div className={`p-3 rounded-xl ${sub.status === 'pending' ? 'bg-amber-500/10 text-amber-400' : 'bg-slate-800 text-slate-400'}`}>
                    <Wifi size={20} />
                  </div>
                  <div>
                    <h4 className="font-bold text-white text-lg">{sub.package.name}</h4>
                    <p className="text-sm text-slate-400 mt-1">Via {sub.router.name}</p>
                  </div>
                </div>
                
                <div className="flex flex-col items-start sm:items-end gap-2 w-full sm:w-auto mt-2 sm:mt-0">
                  <span className={`badge shrink-0 ${sub.status === 'pending' ? 'badge-warning' : 'badge-danger'}`}>
                    {sub.status === 'pending' ? 'Pending Validation' : 'Expired'}
                  </span>
                  
                  {/* Show countdown if still pending and has expiry */}
                  {sub.status === 'pending' && sub.expiresAt && (
                    <CountdownBadge expiresAt={sub.expiresAt} variant="inline" />
                  )}

                  <span className="text-xs text-slate-500 text-right">
                    {sub.status === 'pending' ? 'Requested: ' : 'Expired: '} 
                    {sub.expiresAt
                      ? new Date(sub.expiresAt).toLocaleDateString()
                      : new Date(sub.createdAt).toLocaleDateString()}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
