import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useOutletContext } from 'react-router-dom';
import toast from 'react-hot-toast';
import { Wifi, MapPin, Clock, ArrowRight, Activity, ExternalLink, Zap, RefreshCw, Download, Upload, Smartphone, Lock, Laptop, Monitor, Globe, Cpu, ChevronRight, Play } from 'lucide-react';
import { useRef } from 'react';
import api from '../../services/api';
import { CountdownBadge } from '../../components/CountdownBadge';

export default function Packages() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const formRef = useRef<HTMLFormElement>(null);
  const { fireInternet } = useOutletContext<{ fireInternet: (u?: string, p?: string) => void }>();
  const [selectedPkg, setSelectedPkg] = useState<any>(null);
  const [routerId, setRouterId] = useState('');
  const [isLaunching, setIsLaunching] = useState(false);
  const [paymentType, setPaymentType] = useState<'manual' | 'mpesa'>('mpesa');
  const [voucherCode, setVoucherCode] = useState('');
  const [stkPhone, setStkPhone] = useState(localStorage.getItem('phone') || '');
  const [traffic, setTraffic] = useState<{ downloadSpeed: string, uploadSpeed: string }>({ downloadSpeed: '0 bps', uploadSpeed: '0 bps' });
  const lastTraffic = useRef<{ bytesIn: number, bytesOut: number, time: number } | null>(null);
  const [showScroll, setShowScroll] = useState(false);

  useEffect(() => {
    const handleScroll = () => setShowScroll(window.scrollY > 300);
    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);


  const { data: packages, isLoading: pkgsLoading } = useQuery({
    queryKey: ['packages', 'active'],
    queryFn: () => api.get('/packages').then(res => res.data),
  });

  const { data: routers, isLoading: routersLoading } = useQuery({
    // In a real app, users might only see some abstract locations. We show routers for them to pick where they are.
    queryKey: ['routers'], 
    queryFn: () => api.get('/routers').then(res => res.data.filter((r: any) => r.isOnline)),
  });

  const { data: subs, isLoading: subsLoading } = useQuery({
    queryKey: ['my_subscriptions'],
    queryFn: () => api.get('/subscriptions/my').then(res => res.data),
    refetchInterval: 10000,
  });

  // Auto-select router silently
  useEffect(() => {
    if (routers && routers.length > 0) {
      const savedRouterId = localStorage.getItem('hotspot_router_id');
      const match = savedRouterId
        ? routers.find((r: any) => r.id === savedRouterId || r.name === savedRouterId)
        : null;
      
      setRouterId(match ? match.id : routers[0].id);
    }
  }, [routers]);

  // Unified Query Key: Centralizes the ACTIVE timer/status for the whole app
  const { data: allActiveSubs = [] } = useQuery({
    queryKey: ['active-all-subscriptions'],
    queryFn: () => api.get('/subscriptions/active-all').then(res => res.data),
    refetchInterval: 10000,
  });

  const liveSession = allActiveSubs.find((s: any) => s.startedAt && new Date(s.expiresAt) > new Date());
  const pendingPlans = allActiveSubs.filter((s: any) => !s.startedAt || new Date(s.expiresAt) <= new Date());
  const isAnyLive = !!liveSession;
  const activeSub = liveSession || (pendingPlans.length > 0 ? pendingPlans[0] : null);



  // Poll for real-time traffic
  useEffect(() => {
    if (!activeSub || !activeSub.startedAt) return;

    const fetchTraffic = async () => {
      try {
        const res = await api.get('/subscriptions/my/traffic');
        const data = res.data; // { bytesIn, bytesOut }
        if (!data) return;

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

  const startMutation = useMutation({
    mutationFn: (subId: string) => {
      const mac = localStorage.getItem('hotspot_mac');
      const ip = localStorage.getItem('hotspot_ip');
      return api.post(`/subscriptions/${subId}/start`, { mac, ip });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['my_subscriptions'] });
      queryClient.invalidateQueries({ queryKey: ['active-all-subscriptions'] });
      toast.success('Internet Activated!');
    },
    onError: (err: any) => {
      const msg = err.response?.data?.message || 'Connection failed. Try "Verify Device" again.';
      toast.error(msg);
      console.error('Start session error:', err);
    },
  });

  const purchaseMutation = useMutation({
    mutationFn: (data: { packageId: string; routerId: string }) => api.post('/subscriptions/purchase', data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['my_subscriptions'] });
      queryClient.invalidateQueries({ queryKey: ['active-all-subscriptions'] });
      toast.success('Subscription requested! Admin will review your payment.');
      navigate('/user/subscriptions');
    },
    onError: (err: any) => toast.error(err.response?.data?.message || 'Failed to purchase')
  });

  const redeemMutation = useMutation({
    mutationFn: (data: { code: string; routerId: string }) => api.post('/vouchers/redeem', data).then(res => res.data),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['my_subscriptions'] });
      queryClient.invalidateQueries({ queryKey: ['active-all-subscriptions'] });
      const pkgName = data?.package?.name || 'Package';
      toast.success(`Voucher redeemed! Activated: ${pkgName}`);
      navigate('/user/subscriptions');
    },
    onError: (err: any) => toast.error(err.response?.data?.message || 'Failed to redeem voucher')
  });

  const stkPushMutation = useMutation({
    mutationFn: (data: { subId: string, phone: string, amount: number }) => api.post('/subscriptions/stk-push', data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['active-all-subscriptions'] });
      queryClient.invalidateQueries({ queryKey: ['my_subscriptions'] });
      
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
      
      // If we have identity, trigger the local login form simultaneously
      setTimeout(() => {
        if (formRef.current) formRef.current.submit();
      }, 500);
      
      navigate('/user/subscriptions');
    },
    onError: (err: any) => toast.error(err.response?.data?.message || 'Payment simulation failed')
  });

  const handleSubscribe = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!routerId) return toast.error('Please select an active hotspot location');
    
    if (paymentType === 'mpesa') {
      try {
        if (!stkPhone) return toast.error('Please enter M-Pesa phone number');
        const sub = await api.post('/subscriptions/purchase', { packageId: selectedPkg.id, routerId }).then(res => res.data);
        stkPushMutation.mutate({ subId: sub.id, phone: stkPhone, amount: selectedPkg.price });
      } catch (err: any) {
        toast.error(err.response?.data?.message || 'Failed to initiate STK push');
      }
    } else {
      purchaseMutation.mutate({ packageId: selectedPkg.id, routerId });
    }
  };

  if (pkgsLoading || routersLoading || subsLoading) return <div className="p-8 text-center text-slate-400">Loading availability...</div>;

  return (
    <div>
      <div className="mb-8">
        <h2 className="text-3xl font-bold text-main mb-2">Available Hotspot Plans</h2>
        <p className="text-muted">Select a plan to start browsing the internet instantly.</p>
      </div>




      {allActiveSubs.length > 0 && (
        <div className="mb-12 space-y-4">
          <div className="flex items-center gap-3 px-2 mb-2">
            <Activity size={18} className="text-cyan-400 animate-pulse" />
            <h3 className="text-[10px] font-black text-main uppercase tracking-[0.25em]">ACTIVE CONNECTION DASHBOARD ({allActiveSubs.length})</h3>
          </div>

          {allActiveSubs.map((sub: any) => {
            const isLive = sub.startedAt && new Date(sub.expiresAt) > new Date();
            
            return (
              <div key={sub.id} className="relative group animate-fade-in">
                {/* ── 🚀 AMAZING HORIZONTAL DASHBOARD BAR (Screenshot 2 Match) ── */}
                <div className="glass-panel p-6 md:px-10 md:py-8 border-cyan-500/20 bg-slate-900/40 relative overflow-hidden transition-all duration-500 hover:shadow-[0_0_50px_rgba(34,211,238,0.1)] rounded-[1.5rem]">
                  
                  {/* Subtle Shimmer (Screenshot Match) */}
                  {isLive && (
                    <div className="absolute inset-0 bg-gradient-to-r from-transparent via-cyan-500/5 to-transparent -translate-x-full animate-[shimmer_3s_infinite]" />
                  )}

                  <div className="flex flex-col lg:flex-row items-center justify-between gap-8 relative z-10">
                    
                    {/* Left Section: Icon & Info (Screenshot Match) */}
                    <div className="flex items-center gap-8 w-full lg:w-auto">
                      {/* Waveform Icon Box */}
                      <div className={`w-20 h-20 rounded-2xl flex items-center justify-center border transition-all duration-700 ${isLive ? 'bg-cyan-500/10 border-cyan-500/30 text-cyan-400' : 'bg-slate-900/60 border-white/5 text-slate-700'}`}>
                        <Activity size={32} className={isLive ? 'animate-pulse' : ''} />
                      </div>

                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <span className={`text-[10px] font-black uppercase tracking-[0.3em] ${isLive ? 'text-cyan-400' : 'text-slate-500'}`}>
                            {isLive ? 'ACTIVE SESSION' : 'TIMER PAUSED'}
                          </span>
                          {isLive && <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />}
                        </div>
                        <h3 className="text-4xl font-black text-white tracking-tighter uppercase leading-none">{sub.package?.name}</h3>
                        <div className="flex flex-col gap-1 items-start">
                           <p className="text-xs font-bold text-muted opacity-60 flex items-center gap-2">
                             Connected to <span className="text-white uppercase tracking-widest text-[10px]">{sub.router?.name || 'Pulselynk'}</span>
                           </p>
                           <div className="flex items-center gap-1.5 pt-1">
                             <div className="w-1 h-1 rounded-full bg-cyan-500/40" />
                             <span className="text-[9px] font-black text-slate-500 uppercase tracking-widest">
                               DEVICE ID: <span className="text-slate-400 uppercase tracking-widest text-[9px]">{sub.deviceSessions?.[0]?.macAddress?.substring(0, 12) || 'DETECTING...'}</span>
                             </span>
                           </div>
                        </div>
                      </div>
                    </div>

                    {/* Right Section: Timer & Stats (Screenshot Match) */}
                    <div className="flex flex-col items-center lg:items-end gap-3 w-full lg:w-auto">
                      {isLive ? (
                        <>
                          <div className="flex flex-col items-center lg:items-end">
                            <span className="text-[10px] font-black text-slate-500 uppercase tracking-[0.2em] mb-1">TIME REMAINING</span>
                            <div className="text-5xl lg:text-6xl font-black font-mono text-orange-400 tracking-tighter tabular-nums drop-shadow-[0_0_15px_rgba(251,146,60,0.1)]">
                               <CountdownBadge expiresAt={sub.expiresAt} startedAt={sub.startedAt} variant="block" />
                            </div>
                          </div>

                          <div className="flex items-center gap-3">
                             <div className="bg-slate-950/60 rounded-full px-4 py-1.5 border border-white/5 flex items-center gap-4">
                                <div className="flex items-center gap-2">
                                  <Download size={12} className="text-cyan-500" />
                                  <span className="text-[10px] font-bold text-white font-mono">{traffic.downloadSpeed}</span>
                                </div>
                                <div className="w-px h-3 bg-white/10" />
                                <div className="flex items-center gap-2">
                                  <Upload size={12} className="text-emerald-500" />
                                  <span className="text-[10px] font-bold text-white font-mono">{traffic.uploadSpeed}</span>
                                </div>
                             </div>
                          </div>
                        </>
                      ) : (
                        <div className="flex flex-col items-center lg:items-end gap-4">
                          <div className="text-center lg:text-right">
                             <p className="text-[10px] text-muted font-bold uppercase tracking-widest opacity-60">TIME REMAINING</p>
                             <h4 className="text-3xl font-black text-cyan-400 tracking-[0.2em]">WAITING</h4>
                           </div>
                           <button 
                            onClick={(e) => { e.stopPropagation(); startMutation.mutate(sub.id); }}
                            disabled={startMutation.isPending || isAnyLive}
                            className={`btn-primary w-full lg:w-56 py-4 text-xs font-black tracking-widest uppercase shadow-2xl transition-all duration-500 transform hover:scale-105 active:scale-95 flex items-center justify-center gap-3 ${
                              isAnyLive 
                              ? 'opacity-30 cursor-not-allowed grayscale shadow-none' 
                              : 'shadow-cyan-900/40 hover:shadow-cyan-400/40'
                            }`}
                           >
                            {startMutation.isPending ? <RefreshCw className="animate-spin" size={18} /> : 
                             isAnyLive ? <><Lock size={18} /> LOCKED</> : 
                             'START BROWSING NOW'}
                           </button>
                        </div>
                      )}
                      
                      <div 
                        onClick={() => navigate('/user/subscriptions')}
                        className="text-[10px] font-bold text-slate-500 hover:text-cyan-400 uppercase tracking-widest cursor-pointer group/link flex items-center gap-2 transition-all mt-2"
                      >
                         Manage Connection <ChevronRight size={14} className="group-hover/link:translate-x-1 transition-transform" />
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}


      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {packages?.map((pkg: any) => (
          <div 
            key={pkg.id} 
            className="glass-panel p-6 flex flex-col relative overflow-hidden transition-transform hover:-translate-y-1 cursor-pointer group"
            onClick={() => setSelectedPkg(pkg)}
          >
            <div className="absolute inset-0 bg-gradient-to-br from-[rgba(14,165,233,0.05)] to-transparent pointer-events-none"></div>
            
            <div className="flex justify-between items-start mb-4 relative z-10">
              <h3 className="text-2xl font-bold text-main tracking-tight">{pkg.name}</h3>
              <div className="p-2 bg-cyan-500/10 text-cyan-400 rounded-lg group-hover:scale-110 transition-transform">
                <Wifi size={24} />
              </div>

            </div>
            
            <p className="text-4xl font-black text-cyan-400 mb-6 relative z-10">
              <span className="text-xl font-bold align-top mt-1 mr-1">KES</span>
              {pkg.price}
            </p>

            <ul className="text-sm text-muted mb-8 space-y-3 relative z-10">
              <li className="flex items-center gap-2">
                <div className="w-1.5 h-1.5 rounded-full bg-cyan-400"></div>
                Valid for {pkg.durationValue} {pkg.durationType}
              </li>
              <li className="flex items-center gap-2">
                <div className="w-1.5 h-1.5 rounded-full bg-cyan-400"></div>
                {pkg.dataLimitMB === 0 ? 'Unlimited Data' : `Up to ${pkg.dataLimitMB} MB Data Limit`}
              </li>
              <li className="flex items-center gap-2">
                <div className="w-1.5 h-1.5 rounded-full bg-cyan-400"></div>
                {pkg.downloadSpeed ? `${pkg.downloadSpeed} Download Speed` : 'High-speed connectivity'}
              </li>
              <li className="flex items-center gap-2">
                <div className="w-1.5 h-1.5 rounded-full bg-cyan-400"></div>
                Supports {pkg.maxDevices || 1} Device(s)
              </li>


              {pkg.uploadSpeed && (
                <li className="flex items-center gap-2">
                  <div className="w-1.5 h-1.5 rounded-full bg-cyan-400"></div>
                  {pkg.uploadSpeed} Upload Speed
                </li>
              )}
            </ul>


            <button className="btn-primary w-full mt-auto relative z-10 shadow-lg shadow-cyan-500/20">
              Select Plan
            </button>
          </div>
        ))}
      </div>

      {selectedPkg && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-md z-50 flex items-center justify-center p-4" onMouseDown={(e) => { if (e.target === e.currentTarget) setSelectedPkg(null); }}>
          <div className="glass-panel p-8 w-full max-w-lg animate-fade-in relative z-50 bg-panel shadow-2xl overflow-y-auto max-h-[90vh]">
            <h3 className="text-2xl font-bold mb-2 text-main">Purchase {selectedPkg.name}</h3>
            <p className="text-muted mb-6 font-medium">Total: KES {selectedPkg.price}</p>

            
            <form onSubmit={handleSubscribe} className="flex flex-col gap-5">


              <div className="bg-[rgba(255,255,255,0.02)] p-4 rounded-xl border border-[rgba(255,255,255,0.05)]">
                <label className="block text-sm font-semibold text-slate-300 mb-3">Payment Method</label>
                <div className="flex bg-[rgba(0,0,0,0.2)] rounded-lg p-1 mb-4">
                  <button
                    type="button"
                    onClick={() => setPaymentType('mpesa')}
                    className={`flex-1 py-2 text-sm font-medium rounded-md transition-all ${
                      paymentType === 'mpesa' ? 'bg-green-500/20 text-green-400 shadow translate-y-[0px]' : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    M-Pesa STK
                  </button>
                  <button
                    type="button"
                    onClick={() => setPaymentType('manual')}
                    className={`flex-1 py-2 text-sm font-medium rounded-md transition-all ${
                      paymentType === 'manual' ? 'bg-amber-500/20 text-amber-400 shadow translate-y-[0px]' : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    Request Admin Activation
                  </button>
                </div>

                {paymentType === 'mpesa' && (
                  <div className="p-4 bg-green-500/10 rounded-xl border border-green-500/20 animate-fade-in relative">
                    <p className="font-bold text-green-300 mb-3 block text-sm">Pay with M-Pesa</p>
                    <div className="flex items-center gap-3">
                      <span className="text-slate-400 text-sm font-medium">Phone:</span>
                      <input 
                        type="tel"
                        className="flex-1 bg-[rgba(15,23,42,0.8)] border border-[rgba(255,255,255,0.1)] focus:border-green-400 rounded-lg p-2.5 text-white font-mono"
                        placeholder="e.g. 254712345678"
                        value={stkPhone}
                        onChange={(e) => setStkPhone(e.target.value)}
                        required
                      />
                    </div>
                    <p className="text-[11px] text-green-200/60 mt-3 leading-relaxed">
                      Confirm or edit the phone number above. An M-Pesa prompt will be sent to this number to complete the payment of KES {selectedPkg.price}.
                    </p>
                  </div>
                )}
              </div>

              <div className="flex justify-end gap-3 mt-4">
                <button type="button" className="px-5 py-2.5 rounded-lg text-slate-300 hover:bg-[rgba(255,255,255,0.05)] font-medium transition-colors" onClick={() => setSelectedPkg(null)}>Cancel</button>
                <button type="submit" className="btn-primary text-base px-8 py-2.5 shadow-lg shadow-cyan-500/30" disabled={purchaseMutation.isPending || stkPushMutation.isPending}>
                  {paymentType === 'mpesa' ? 'Send STK Prompt' : 'Submit Request'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
      {showScroll && (
        <button 
          onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
          className="fixed bottom-8 right-8 p-4 bg-cyan-600/80 hover:bg-cyan-500 text-white rounded-full shadow-lg shadow-cyan-900/40 backdrop-blur-md z-[100] transition-all hover:scale-110 active:scale-95 animate-fade-in"
        >
          <ArrowRight className="-rotate-90" size={24} />
        </button>
      )}
    </div>
  );
}
