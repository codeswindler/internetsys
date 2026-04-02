import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { Wifi, MapPin, Clock, ArrowRight, Activity, ExternalLink, Zap, RefreshCw, Download, Upload, Smartphone } from 'lucide-react';
import { useRef } from 'react';
import api from '../../services/api';
import { CountdownBadge } from '../../components/CountdownBadge';

export default function Packages() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const formRef = useRef<HTMLFormElement>(null);
  const [selectedPkg, setSelectedPkg] = useState<any>(null);
  const [routerId, setRouterId] = useState('');
  const [paymentType, setPaymentType] = useState<'voucher' | 'manual' | 'mpesa'>('voucher');
  const [voucherCode, setVoucherCode] = useState('');
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

  // Auto-select router if we caught it in the URL
  useEffect(() => {
    const savedRouterId = localStorage.getItem('hotspot_router_id');
    if (savedRouterId && routers) {
      // Find the router in our list that matches the ID or name
      const match = routers.find((r: any) => r.id === savedRouterId || r.name === savedRouterId);
      if (match) setRouterId(match.id);
    }
  }, [routers]);

  const activeSub = subs?.find((s: any) => s.status === 'active');

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
      toast.success('Subscription requested! Admin will review your payment.');
      navigate('/user/subscriptions');
    },
    onError: (err: any) => toast.error(err.response?.data?.message || 'Failed to purchase')
  });

  const redeemMutation = useMutation({
    mutationFn: (data: { code: string; routerId: string }) => api.post('/vouchers/redeem', data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['my_subscriptions'] });
      toast.success('Voucher redeemed! Internet activated.');
      navigate('/user/subscriptions');
    },
    onError: (err: any) => toast.error(err.response?.data?.message || 'Failed to redeem voucher')
  });

  const stkPushMutation = useMutation({
    mutationFn: (data: { subId: string }) => api.post('/subscriptions/stk-push', data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['active-subscription'] });
      queryClient.invalidateQueries({ queryKey: ['active-subscription-list'] });
      queryClient.invalidateQueries({ queryKey: ['my_subscriptions'] });
      toast.success('Payment successful! Your internet is now active.');
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
    
    if (paymentType === 'voucher') {
      if (!voucherCode) return toast.error('Enter voucher code');
      redeemMutation.mutate({ code: voucherCode, routerId });
    } else if (paymentType === 'mpesa') {
      // First create pure pending sub, then trigger STK
      try {
        const sub = await api.post('/subscriptions/purchase', { packageId: selectedPkg.id, routerId }).then(res => res.data);
        stkPushMutation.mutate({ subId: sub.id });
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
        <h2 className="text-3xl font-bold text-white mb-2">Available Hotspot Plans</h2>
        <p className="text-slate-400">Select a plan to start browsing the internet instantly.</p>
      </div>

      {activeSub && (
        <div 
          onClick={() => navigate('/user/subscriptions')}
          className="mb-10 glass-panel p-6 border-cyan-500/30 bg-gradient-to-r from-[rgba(14,165,233,0.1)] to-transparent flex flex-col md:flex-row justify-between items-center gap-6 cursor-pointer hover:border-cyan-400/50 transition-all group animate-fade-in"
        >
          {/* Left Side: Session Info */}
          <div className="flex items-center gap-5">
            <div className="p-4 bg-cyan-500/20 text-cyan-400 rounded-2xl group-hover:scale-110 transition-transform">
              <Activity className="animate-pulse" size={32} />
            </div>
            <div>
              <div className="flex items-center gap-2 mb-1">
                <span className="text-[10px] font-black uppercase tracking-[0.2em] text-cyan-400/80">Active Session</span>
                <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-ping"></span>
              </div>
              <h3 className="text-2xl font-black text-white">{activeSub.package.name}</h3>
              <div className="flex flex-col gap-1">
                <p className="text-xs text-slate-500">Connected to <span className="font-bold text-slate-300">{activeSub.router.name}</span></p>
                  {/* Hidden MikroTik Login Form */}
                  {activeSub && (
                    <form 
                      ref={formRef}
                      method="post" 
                      action={`http://${activeSub.router.localGateway || '10.5.50.1'}/login`}
                      className="hidden"
                      target="ghost-frame"
                    >
                      <input type="hidden" name="username" value={activeSub.mikrotikUsername} />
                      <input type="hidden" name="password" value={activeSub.mikrotikPassword} />
                      <input type="hidden" name="dst" value="https://google.com" />
                    </form>
                  )}
                  <iframe name="ghost-frame" className="hidden" />

                  <div className="flex flex-col md:flex-row items-center gap-4 bg-slate-800/50 backdrop-blur-sm p-4 rounded-2xl border border-slate-700/50">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-cyan-500/20 flex items-center justify-center text-cyan-400">
                      <Smartphone size={20} />
                    </div>
                    <div>
                      <div className="text-xs text-slate-400 font-bold uppercase tracking-wider">Device ID</div>
                      <div className="text-slate-100 font-black font-mono">
                        {activeSub.user?.deviceModel || activeSub.user?.lastMac || localStorage.getItem('hotspot_mac') || 'DETECTING...'}
                      </div>
                    </div>
                  </div>
                  
                  <div className="h-8 w-px bg-slate-700 hidden md:block"></div>
                  
                  <div className="flex items-center gap-3">
                    <div className={`w-3 h-3 rounded-full animate-pulse ${activeSub.user?.lastMac || localStorage.getItem('hotspot_mac') ? 'bg-emerald-500 shadow-[0_0_12px_rgba(16,185,129,0.5)]' : 'bg-amber-500 shadow-[0_0_12px_rgba(245,158,11,0.5)]'}`} />
                    <div className="text-sm font-bold text-slate-300">
                      {activeSub.user?.lastMac || localStorage.getItem('hotspot_mac') ? 'Verified' : 'Identity Required'}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Right Side: Action or Status */}
          <div className="flex flex-col items-center md:items-end gap-3 w-full md:w-auto">
            {activeSub.startedAt ? (
              <div className="flex flex-col items-center md:items-end gap-2 text-right">
                <CountdownBadge expiresAt={activeSub.expiresAt} variant="block" />
                <p className="text-[10px] text-slate-500 font-bold uppercase tracking-widest">Time Remaining</p>
                
                {/* Traffic Speedometer - Only active when internet is running */}
                <div className="flex items-center gap-3 mt-1 bg-black/40 px-3 py-1 rounded-lg border border-white/5">
                  <div className="flex items-center gap-1.5 text-cyan-400">
                    <Download size={12} />
                    <span className="text-[10px] font-mono font-bold">{traffic.downloadSpeed}</span>
                  </div>
                  <div className="flex items-center gap-1.5 text-blue-400">
                    <Upload size={12} />
                    <span className="text-[10px] font-mono font-bold">{traffic.uploadSpeed}</span>
                  </div>
                </div>
              </div>
            ) : (
              <div className="w-full md:w-auto">
                {!(activeSub.user?.lastMac || localStorage.getItem('hotspot_mac')) ? (
                  /* STEP 1: Verify Identity if missing */
                  <button 
                    onClick={(e) => {
                      e.stopPropagation();
                      const gateway = activeSub.router.localGateway || '10.5.50.1';
                      window.location.href = `http://${gateway}/login?dst=${encodeURIComponent(window.location.href)}`;
                    }}
                    className="w-full md:w-auto bg-amber-500 hover:bg-amber-400 text-slate-900 px-6 py-3 rounded-xl flex items-center justify-center gap-3 font-black uppercase tracking-widest shadow-xl shadow-amber-500/20 transition-all hover:scale-105 active:scale-95"
                  >
                    <RefreshCw size={18} className="animate-spin" />
                    Verify Device
                  </button>
                ) : (
                  /* STEP 2: Connect once identity is known */
                  /* Condition: If session is STARTED and within validity, show ONLINE badge */
                  (activeSub.startedAt || traffic.downloadSpeed !== '0 bps' || traffic.uploadSpeed !== '0 bps') ? (
                    <div className="w-full md:w-auto flex items-center justify-between gap-4 bg-emerald-500/10 border border-emerald-500/30 px-6 py-3 rounded-xl shadow-[0_0_20px_rgba(16,185,129,0.1)]">
                      <div className="flex items-center gap-3">
                        <div className="w-2 h-2 rounded-full bg-emerald-500 animate-ping" />
                        <span className="text-emerald-400 font-black tracking-widest uppercase text-sm">SURFING LIVE & ACTIVE</span>
                      </div>
                      <button 
                        onClick={() => {
                          localStorage.removeItem('hotspot_mac');
                          localStorage.removeItem('hotspot_ip');
                          startMutation.mutate(activeSub.id);
                        }}
                        className="text-[10px] text-slate-500 hover:text-cyan-400 font-bold uppercase transition-colors"
                        title="Click if no internet"
                      >
                        FIX IDENTITY
                      </button>
                    </div>
                  ) : (
                    <button 
                      onClick={(e) => {
                        e.stopPropagation();
                        startMutation.mutate(activeSub.id);
                      }}
                      disabled={startMutation.isPending}
                      className="w-full md:w-auto bg-cyan-500 hover:bg-cyan-400 text-slate-900 px-6 py-3 rounded-xl flex items-center justify-center gap-3 font-black uppercase tracking-widest shadow-xl shadow-cyan-500/20 transition-all hover:scale-105 active:scale-95"
                    >
                      {startMutation.isPending ? <RefreshCw className="animate-spin" size={18} /> : <Zap size={18} fill="currentColor" />}
                      {startMutation.isPending ? 'Certifying...' : '1-Click Connect'}
                    </button>
                  )
                )}
              </div>
            )}
            
            <div className="flex items-center gap-2 text-cyan-400 text-xs font-bold group-hover:gap-3 transition-all">
              Manage Connection <ArrowRight size={14} />
            </div>
          </div>
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
              <h3 className="text-2xl font-bold text-white tracking-tight">{pkg.name}</h3>
              <div className="p-2 bg-[rgba(14,165,233,0.1)] text-cyan-400 rounded-lg group-hover:scale-110 transition-transform">
                <Wifi size={24} />
              </div>
            </div>
            
            <p className="text-4xl font-black text-cyan-400 mb-6 relative z-10">
              <span className="text-xl font-bold align-top mt-1 mr-1">KES</span>
              {pkg.price}
            </p>

            <ul className="text-sm text-slate-300 mb-8 space-y-3 relative z-10">
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
          <div className="glass-panel p-8 w-full max-w-lg animate-fade-in relative z-50 bg-[#0f172a] shadow-2xl overflow-y-auto max-h-[90vh]">
            <h3 className="text-2xl font-bold mb-2 text-white">Purchase {selectedPkg.name}</h3>
            <p className="text-slate-400 mb-6 font-medium">Total: KES {selectedPkg.price}</p>
            
            <form onSubmit={handleSubscribe} className="flex flex-col gap-5">
              <div className="bg-[rgba(255,255,255,0.02)] p-4 rounded-xl border border-[rgba(255,255,255,0.05)]">
                <label className="block text-sm font-semibold text-slate-300 mb-2 flex items-center gap-2">
                  <MapPin size={16} className="text-purple-400"/> Select Hotspot Location
                </label>
                <select 
                  className="w-full bg-[rgba(15,23,42,0.8)] border border-[rgba(255,255,255,0.1)] rounded-lg p-3 text-white focus:border-cyan-400 transition-colors"
                  value={routerId} 
                  onChange={e => setRouterId(e.target.value)} 
                  required
                >
                  <option value="" disabled>Where are you browsing from?</option>
                  {routers?.map((r: any) => (
                    <option key={r.id} value={r.id}>{r.name} (Online)</option>
                  ))}
                </select>
              </div>

              <div className="bg-[rgba(255,255,255,0.02)] p-4 rounded-xl border border-[rgba(255,255,255,0.05)]">
                <label className="block text-sm font-semibold text-slate-300 mb-3">Payment Method</label>
                <div className="flex bg-[rgba(0,0,0,0.2)] rounded-lg p-1 mb-4">
                  <button
                    type="button"
                    onClick={() => setPaymentType('voucher')}
                    className={`flex-1 py-2 text-sm font-medium rounded-md transition-all ${
                      paymentType === 'voucher' ? 'bg-cyan-500/20 text-cyan-400 shadow translate-y-[0px]' : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    Voucher Code
                  </button>
                  <button
                    type="button"
                    onClick={() => setPaymentType('manual')}
                    className={`flex-1 py-2 text-sm font-medium rounded-md transition-all ${
                      paymentType === 'manual' ? 'bg-amber-500/20 text-amber-400 shadow translate-y-[0px]' : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    Pay via Admin
                  </button>
                  <button
                    type="button"
                    onClick={() => setPaymentType('mpesa')}
                    className={`flex-1 py-2 text-sm font-medium rounded-md transition-all ${
                      paymentType === 'mpesa' ? 'bg-green-500/20 text-green-400 shadow translate-y-[0px]' : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    M-Pesa STK
                  </button>
                </div>

                {paymentType === 'voucher' && (
                  <div className="animate-fade-in">
                    <input 
                      className="w-full text-center tracking-widest uppercase font-mono text-lg bg-[rgba(15,23,42,0.8)] border-[rgba(255,255,255,0.1)] focus:border-cyan-400"
                      value={voucherCode} 
                      onChange={e => setVoucherCode(e.target.value.toUpperCase())} 
                      placeholder="ENTER VOUCHER CODE" 
                      required 
                    />
                    <p className="text-xs text-slate-500 mt-2 text-center">Codes are case-insensitive</p>
                  </div>
                )}
                {paymentType === 'mpesa' && (
                  <div className="p-4 bg-green-500/10 rounded-xl text-green-200 text-sm leading-relaxed animate-fade-in border border-green-500/20">
                    <p className="font-bold mb-2">Automated Payment (STK Push)</p>
                    Click the button below and you will receive a prompt on your phone (<strong>{localStorage.getItem('phone')}</strong>) to enter your M-Pesa PIN.
                  </div>
                )}
              </div>

              <div className="flex justify-end gap-3 mt-4">
                <button type="button" className="px-5 py-2.5 rounded-lg text-slate-300 hover:bg-[rgba(255,255,255,0.05)] font-medium transition-colors" onClick={() => setSelectedPkg(null)}>Cancel</button>
                <button type="submit" className="btn-primary text-base px-8 py-2.5 shadow-lg shadow-cyan-500/30" disabled={purchaseMutation.isPending || redeemMutation.isPending || stkPushMutation.isPending}>
                  {paymentType === 'voucher' ? 'Redeem & Connect' : paymentType === 'mpesa' ? 'Pay Now (STK Push)' : 'Request Connection'}
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
