import { useRef, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useOutletContext } from 'react-router-dom';
import toast from 'react-hot-toast';
import { 
  Wifi, 
  MapPin, 
  Clock, 
  ArrowRight, 
  Activity, 
  ExternalLink, 
  Zap, 
  RefreshCw, 
  Download, 
  Upload, 
  Smartphone, 
  Lock, 
  Laptop, 
  Monitor, 
  Globe, 
  Cpu, 
  ChevronRight, 
  Play,
  CheckCircle2,
  ShieldCheck,
  CreditCard
} from 'lucide-react';
import api from '../../services/api';
import { CountdownBadge } from '../../components/CountdownBadge';
import { format } from 'date-fns';

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
  const [isVerifying, setIsVerifying] = useState(false);
  const [verifyingSubId, setVerifyingSubId] = useState<string | null>(null);
  const [pollCount, setPollCount] = useState(0);
  const [showConnectionModal, setShowConnectionModal] = useState(false);

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

  // NEW: Auto-detect Router from Connected Network
  const [isDetecting, setIsDetecting] = useState(true);
  const [detectionError, setDetectionError] = useState<string | null>(null);

  useEffect(() => {
    const detectRouter = async () => {
      // 1. Check URL Params (from Round-Trip)
      const params = new URLSearchParams(window.location.search);
      const urlMac = params.get('mac');
      const urlIp = params.get('ip');
      if (urlMac) {
        localStorage.setItem('hotspot_mac', urlMac);
        if (urlIp) localStorage.setItem('hotspot_ip', urlIp);
        setIsDetecting(false);
        setDetectionError(null);
        return;
      }

      // 2. Check Static Storage
      if (localStorage.getItem('hotspot_mac')) {
        setIsDetecting(false);
        setDetectionError(null);
        return;
      }

      try {
        setIsDetecting(true);
        setDetectionError(null);
        const existingIp = localStorage.getItem('hotspot_ip');
        const res = await api.post('/subscriptions/detect-router', { ip: existingIp || undefined });
        const { mac } = res.data;
        if (mac) {
          localStorage.setItem('hotspot_mac', mac);
          toast.success("Router Detected! You're on the right network.", { id: 'detect-toast' });
        }
      } catch (err: any) {
        // If we can't find them, offer a manual refresh to the router
        const routerGateway = routers?.[0]?.localGateway || '10.5.50.1';
        const redirectUrl = `http://${routerGateway}/login?dst=${encodeURIComponent(window.location.origin + '/user/packages')}`;

        setDetectionError(
          <div className="flex flex-col gap-3 py-2">
            <p>We can't find your device on the Wi-Fi. Browser privacy may be hiding your ID.</p>
            <button 
               onClick={() => window.location.href = redirectUrl}
               className="bg-cyan-600 hover:bg-cyan-500 text-white font-black text-[10px] uppercase tracking-widest py-2 px-4 rounded-xl transition-all self-start flex items-center gap-2"
            >
               <RefreshCw size={12} /> Identify My Device
            </button>
          </div> as any
        );
      } finally {
        setIsDetecting(false);
      }
    };
    detectRouter();
  }, []);

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
  const { data: activeSubsData, isLoading: activeSubsLoading } = useQuery({
    queryKey: ['active-all-subscriptions'],
    queryFn: () => api.get('/subscriptions/active-all').then(res => res.data),
    refetchInterval: 10000,
  });

  const allActiveSubs = Array.isArray(activeSubsData) ? activeSubsData : [];
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
    mutationFn: (data: { code: string; routerId?: string }) => api.post('/vouchers/redeem', data).then(res => res.data),
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
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['active-all-subscriptions'] });
      queryClient.invalidateQueries({ queryKey: ['my_subscriptions'] });
      
      setVerifyingSubId(variables.subId);
      setIsVerifying(true);
      toast.success('STK Push Sent! Enter your M-Pesa PIN.', { icon: '📲' });
    },
    onError: (err: any, variables) => {
      toast.error(err.response?.data?.message || 'Payment initiation failed');
      setFailedSubId(variables.subId);
      setShowRetryModal(true);
    }
  });

  // Polling logic for STK result
  useEffect(() => {
    if (!isVerifying || !verifyingSubId) return;

    const pollInterval = setInterval(async () => {
      try {
        const res = await api.get(`/subscriptions/${verifyingSubId}/stk-status`);
        const { success, status, cancelled, result } = res.data;

        if (success || status?.toLowerCase() === 'active' || status?.toLowerCase() === 'paid') {
          setIsVerifying(false);
          setVerifyingSubId(null);
          toast.success('Payment Verified! Head to Dashboard to Activate.', { icon: '✅', duration: 5000 });
          
          setTimeout(() => {
            navigate('/user/dashboard');
          }, 2000);
          
          clearInterval(pollInterval);
        } else if (cancelled) {
          setIsVerifying(false);
          setVerifyingSubId(null);
          toast.error('Payment cancelled on your phone.', { icon: '📲' });
          clearInterval(pollInterval);
        }

        setPollCount(prev => prev + 1);
        if (pollCount > 30) { // Timeout after ~60s
          setIsVerifying(false);
          setVerifyingSubId(null);
          toast.error('Payment timeout. If you paid, it will appear in your subscriptions shortly.');
          clearInterval(pollInterval);
        }
      } catch (e) {
        console.error('STK status poll failed', e);
      }
    }, 2000);

    return () => clearInterval(pollInterval);
  }, [isVerifying, verifyingSubId, pollCount, navigate]);

  const deleteSubMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/subscriptions/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['my_subscriptions'] });
      toast.success('Request removed.');
    }
  });

  const [failedSubId, setFailedSubId] = useState<string | null>(null);
  const [showRetryModal, setShowRetryModal] = useState(false);

  const handleSubscribe = async (e: React.FormEvent) => {
    e.preventDefault();
    
    // Proactive Validation: Check if device is synced
    const mac = localStorage.getItem('hotspot_mac');
    if (!mac) {
      setShowConnectionModal(true);
      return;
    }
    
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

  if (pkgsLoading || routersLoading || subsLoading || activeSubsLoading) return <div className="p-8 text-center text-slate-400">Loading availability...</div>;

  return (
    <div>
      <div className="mb-8">
        <h2 className="text-3xl font-bold text-main mb-2">Available Hotspot Plans</h2>
        <p className="text-muted">Select a plan to start browsing the internet instantly.</p>
      </div>


      {isAnyLive && (
        <div className="mb-8 p-4 bg-cyan-500/10 border border-cyan-500/20 rounded-2xl flex items-center justify-between">
          <div className="flex items-center gap-3">
             <Activity className="text-cyan-400 animate-pulse" size={20} />
             <div>
                <p className="text-[10px] font-black text-cyan-400 uppercase tracking-widest">Active Connection Detected</p>
                <p className="text-sm font-bold text-white uppercase">{liveSession?.package?.name || 'Session Live'}</p>
             </div>
          </div>
          <button 
            onClick={() => navigate('/user/dashboard')}
            className="px-4 py-2 bg-cyan-500 text-white text-[10px] font-black uppercase tracking-widest rounded-lg shadow-lg shadow-cyan-500/20"
          >
            Manage Session
          </button>
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

      {/* STK Verification Modal */}
      {isVerifying && createPortal(
        <div className="fixed inset-0 bg-slate-950/90 backdrop-blur-xl z-[10002] flex items-center justify-center p-4">
          <div className="glass-panel w-full max-w-sm bg-slate-900 border border-cyan-500/30 p-10 text-center rounded-[2.5rem] shadow-[0_0_50px_rgba(34,211,238,0.2)] animate-in zoom-in-95 duration-300">
            <div className="relative w-24 h-24 mx-auto mb-8">
              <div className="absolute inset-0 bg-cyan-500/20 rounded-full animate-ping" />
              <div className="relative w-full h-full bg-slate-800 rounded-full flex items-center justify-center border border-cyan-500/30">
                <RefreshCw size={40} className="text-cyan-400 animate-spin" />
              </div>
            </div>
            
            <h3 className="text-2xl font-black text-white uppercase tracking-tighter mb-2">Verifying Payment</h3>
            <p className="text-slate-400 text-sm mb-8 leading-relaxed">
              We've sent an STK push to <span className="text-white font-bold">{stkPhone}</span>. 
              Please enter your PIN. This window will update automatically.
            </p>
            
            <div className="space-y-4">
              <div className="h-1.5 w-full bg-slate-800 rounded-full overflow-hidden">
                <div 
                  className="h-full bg-cyan-500 transition-all duration-500" 
                  style={{ width: `${Math.min((pollCount / 30) * 100, 100)}%` }} 
                />
              </div>
              <p className="text-[10px] font-black text-slate-600 uppercase tracking-widest">
                Waiting for callback... ({60 - pollCount * 2}s)
              </p>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* Connection Required Modal */}
      {showConnectionModal && createPortal(
        <div className="fixed inset-0 bg-slate-950/90 backdrop-blur-xl z-[10002] flex items-center justify-center p-4">
          <div className="glass-panel w-full max-w-md bg-slate-900 border border-orange-500/30 p-10 text-center rounded-[2.5rem] shadow-2xl animate-in zoom-in-95 duration-300">
            <div className="w-20 h-20 bg-orange-500/10 rounded-3xl flex items-center justify-center text-orange-440 mx-auto mb-8">
              <Wifi size={40} className="text-orange-500" />
            </div>
            <h3 className="text-2xl font-black text-white uppercase tracking-tighter mb-4">Connection Required</h3>
            <div className="text-slate-400 text-sm mb-8 space-y-4 leading-relaxed">
              <p>To purchase a package, you must be connected to the <span className="text-white font-bold tracking-widest">HOTSPOT WI-FI</span>.</p>
              <div className="p-4 bg-slate-950/50 rounded-xl border border-white/5 text-xs text-left">
                <p className="text-cyan-400 font-bold mb-1 uppercase tracking-widest text-[10px]">How to fix:</p>
                <ol className="list-decimal list-inside space-y-1 text-slate-500">
                  <li>Connect to the Wi-Fi network.</li>
                  <li>Ensure you see the <span className="text-slate-300 font-bold">Login Page</span> (Captive Portal).</li>
                  <li>Hit "Login" or "Sync" to register your device.</li>
                </ol>
              </div>
              <p className="text-[10px] text-slate-500 italic">Privacy settings on some mobile browsers may hide your identity until you hit the Sync button on your dashboard.</p>
            </div>
            <div className="flex gap-4">
              <button 
                onClick={() => setShowConnectionModal(false)}
                className="flex-1 py-4 bg-slate-800 text-slate-400 font-black uppercase tracking-widest rounded-2xl hover:bg-slate-700 transition-all active:scale-95"
              >
                Dismiss
              </button>
              <button 
                onClick={() => { setShowConnectionModal(false); navigate('/user/dashboard'); }}
                className="flex-1 py-4 bg-orange-500 text-white font-black uppercase tracking-widest rounded-2xl shadow-lg shadow-orange-500/20 hover:bg-orange-400 transition-all active:scale-95"
              >
                Go to Sync
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* Retry/Delete Modal */}
      {showRetryModal && createPortal(
        <div className="fixed inset-0 bg-slate-950/90 backdrop-blur-xl z-[10002] flex items-center justify-center p-4">
          <div className="glass-panel w-full max-w-sm bg-slate-900 border border-red-500/30 p-10 text-center rounded-[2.5rem] shadow-2xl">
            <div className="w-16 h-16 bg-red-500/10 rounded-2xl flex items-center justify-center text-red-500 mx-auto mb-6">
              <RefreshCw className="animate-pulse" size={30} />
            </div>
            <h3 className="text-xl font-black text-white uppercase mb-4">Payment Failed to Start</h3>
            <p className="text-slate-400 text-sm mb-8">
              We couldn't initiate the M-Pesa prompt. Would you like to try again or cancel this request?
            </p>
            <div className="flex flex-col gap-3">
              <button 
                onClick={() => {
                  setShowRetryModal(false);
                  stkPushMutation.mutate({ subId: failedSubId!, phone: stkPhone, amount: selectedPkg.price });
                }}
                className="w-full py-4 bg-cyan-600 text-white font-black uppercase tracking-widest rounded-2xl hover:bg-cyan-500 transition-all active:scale-95"
              >
                Retry STK Push
              </button>
              <button 
                onClick={() => {
                  setShowRetryModal(false);
                  deleteSubMutation.mutate(failedSubId!);
                  setFailedSubId(null);
                }}
                className="w-full py-4 bg-slate-800 text-slate-400 font-black uppercase tracking-widest rounded-2xl hover:bg-slate-700 transition-all active:scale-95"
              >
                No, Delete Request
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {selectedPkg && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-md z-50 flex items-center justify-center p-4" onMouseDown={(e) => { if (e.target === e.currentTarget) setSelectedPkg(null); }}>
          <div className="glass-panel p-8 w-full max-w-lg animate-fade-in relative z-50 bg-panel shadow-2xl overflow-y-auto max-h-[90vh]">
            <h3 className="text-2xl font-bold mb-2 text-main">Purchase {selectedPkg.name}</h3>
            <p className="text-muted mb-6 font-medium">Total: KES {selectedPkg.price}</p>
            
            <form onSubmit={handleSubscribe} className="flex flex-col gap-5">
              <div className="bg-slate-100/50 dark:bg-[rgba(255,255,255,0.02)] p-5 rounded-2xl border border-slate-200 dark:border-[rgba(255,255,255,0.05)]">
                <label className="block text-sm font-black text-slate-900 dark:text-slate-300 mb-3 uppercase tracking-widest">Payment Method</label>
                <div className="flex bg-slate-200/50 dark:bg-[rgba(0,0,0,0.2)] rounded-xl p-1.5 mb-4 border border-slate-300/30 dark:border-none">
                  <button
                    type="button"
                    onClick={() => setPaymentType('mpesa')}
                    className={`flex-1 py-3 text-xs font-black uppercase tracking-widest rounded-lg transition-all ${
                      paymentType === 'mpesa' 
                        ? 'bg-emerald-600 text-white shadow-lg shadow-emerald-600/20 active:scale-95' 
                        : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                    }`}
                  >
                    M-Pesa STK
                  </button>
                  <button
                    type="button"
                    onClick={() => setPaymentType('manual')}
                    className={`flex-1 py-3 text-xs font-black uppercase tracking-widest rounded-lg transition-all ${
                      paymentType === 'manual' 
                        ? 'bg-amber-600 text-white shadow-lg shadow-amber-600/20 active:scale-95' 
                        : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                    }`}
                  >
                    Admin Activation
                  </button>
                </div>

                {paymentType === 'mpesa' && (
                  <div className="p-5 bg-emerald-500/5 dark:bg-green-500/10 rounded-2xl border border-emerald-500/20 animate-in slide-in-from-top-2 duration-300">
                    <p className="font-black text-slate-900 dark:text-green-300 mb-4 block text-[10px] uppercase tracking-[0.2em]">Pay with M-Pesa</p>
                    <div className="flex flex-col gap-2">
                      <span className="text-slate-900 dark:text-slate-400 text-[10px] font-black uppercase tracking-widest">Phone Number:</span>
                      <input 
                        type="tel"
                        className="w-full bg-white dark:bg-[rgba(15,23,42,0.8)] border border-slate-300 dark:border-[rgba(255,255,255,0.1)] focus:border-emerald-500 dark:focus:border-green-400 rounded-xl p-3 text-slate-900 dark:text-white font-mono text-lg tracking-widest shadow-inner outline-none transition-all"
                        placeholder="254712345678"
                        value={stkPhone}
                        onChange={(e) => setStkPhone(e.target.value)}
                        required
                      />
                    </div>
                    <p className="text-[10px] text-slate-600 dark:text-green-200/60 mt-4 leading-relaxed font-bold italic">
                      Confirm or edit the phone number above. An M-Pesa prompt will be sent immediately to complete your payment of KES {selectedPkg.price}.
                    </p>
                  </div>
                )}
              </div>

              <div className="flex justify-end gap-3 mt-4">
                <button type="button" className="px-5 py-2.5 rounded-lg text-slate-300 hover:bg-[rgba(255,255,255,0.05)] font-medium transition-colors" onClick={() => setSelectedPkg(null)}>Cancel</button>
                <button type="submit" className="btn-primary text-base px-8 py-2.5 shadow-lg shadow-cyan-500/30 flex items-center justify-center gap-2" disabled={purchaseMutation.isPending || stkPushMutation.isPending}>
                  {(purchaseMutation.isPending || stkPushMutation.isPending) ? <RefreshCw className="animate-spin" size={18} /> : null}
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
