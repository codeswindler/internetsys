import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import {
  CheckCircle2,
  Clock,
  Loader2,
  MapPin,
  Phone,
  ShieldCheck,
  Smartphone,
  Wifi,
  Zap,
} from 'lucide-react';
import api from '../../services/api';
import {
  buildHotspotConnectUrl,
  storeHotspotContext,
} from '../../services/hotspot';

type PublicPackage = {
  id: string;
  name: string;
  price: number | string;
  durationType: string;
  durationValue: number;
  dataLimitMB?: number;
  downloadSpeed?: string;
  uploadSpeed?: string;
  maxDevices?: number;
};

type PublicRouter = {
  id: string;
  name: string;
  localGateway?: string;
  connectionMode?: string;
  isOnline?: boolean;
};

export default function QuickBuy() {
  const [phone, setPhone] = useState(localStorage.getItem('phone') || '');
  const [routerId, setRouterId] = useState('');
  const [selectedPkg, setSelectedPkg] = useState<PublicPackage | null>(null);
  const [verifyingSubId, setVerifyingSubId] = useState<string | null>(null);
  const [pollCount, setPollCount] = useState(0);
  const statusInFlightRef = useRef(false);
  const handledSubRef = useRef<string | null>(null);

  const packagesQuery = useQuery({
    queryKey: ['guest-packages'],
    queryFn: () => api.get('/subscriptions/guest/packages').then((res) => res.data),
  });

  const routersQuery = useQuery({
    queryKey: ['guest-routers'],
    queryFn: () => api.get('/subscriptions/guest/routers').then((res) => res.data),
  });

  const packages = useMemo<PublicPackage[]>(() => {
    const data = Array.isArray(packagesQuery.data) ? packagesQuery.data : [];
    return [...data].sort(
      (a, b) => Number(a.price || 0) - Number(b.price || 0),
    );
  }, [packagesQuery.data]);

  const routers = Array.isArray(routersQuery.data) ? routersQuery.data : [];
  const selectedRouter = routers.find((router: PublicRouter) => router.id === routerId);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    storeHotspotContext(params, window.location.origin);

    if (params.size > 0) {
      window.history.replaceState({}, '', window.location.pathname);
    }
  }, []);

  useEffect(() => {
    if (!routerId && routers.length > 0) {
      const savedRouterId = localStorage.getItem('hotspot_router_id');
      const match = savedRouterId
        ? routers.find(
            (router: PublicRouter) =>
              router.id === savedRouterId || router.name === savedRouterId,
          )
        : null;
      setRouterId(match?.id || routers[0].id);
    }
  }, [routerId, routers]);

  const checkoutMutation = useMutation({
    mutationFn: (pkg: PublicPackage) =>
      api
        .post('/subscriptions/guest/checkout', {
          phone,
          packageId: pkg.id,
          routerId,
        })
        .then((res) => res.data),
    onSuccess: (data, pkg) => {
      const subId = data?.sub?.id;
      if (!subId) {
        toast.error('Payment started, but subscription tracking was not returned.');
        return;
      }

      localStorage.setItem('phone', phone);
      handledSubRef.current = null;
      setSelectedPkg(pkg);
      setVerifyingSubId(subId);
      setPollCount(0);
      toast.success('STK prompt sent. Enter your M-Pesa PIN.');
    },
    onError: (err: any) => {
      toast.error(err.response?.data?.message || 'Could not start payment');
    },
  });

  useEffect(() => {
    if (!verifyingSubId) return;

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const maxAttempts = 24;

    const scheduleNext = (delayMs = 4000) => {
      if (cancelled) return;
      timer = window.setTimeout(runPoll, delayMs);
    };

    const finishSuccess = (data: any) => {
      const auth = data?.auth;
      if (!auth?.access_token) {
        toast.error('Payment was confirmed, but login could not be completed.');
        return;
      }

      localStorage.setItem('token', auth.access_token);
      localStorage.setItem('role', 'user');
      localStorage.setItem('user', JSON.stringify(auth.user));
      localStorage.setItem('phone', auth.user?.phone || phone);

      const routerGateway =
        data?.sub?.router?.localGateway ||
        selectedRouter?.localGateway ||
        localStorage.getItem('hotspot_router_id') ||
        '10.5.50.1';

      toast.success('Payment verified. Connecting this device...');
      window.setTimeout(() => {
        window.location.replace(
          buildHotspotConnectUrl(
            verifyingSubId,
            '/buy',
            routerGateway,
            window.location.origin,
          ),
        );
      }, 400);
    };

    const runPoll = async () => {
      if (cancelled || statusInFlightRef.current) {
        scheduleNext();
        return;
      }

      statusInFlightRef.current = true;
      try {
        const res = await api.post('/subscriptions/guest/stk-status', {
          subId: verifyingSubId,
          phone,
        });
        const data = res.data;
        const status = `${data?.status || ''}`.toLowerCase();

        if (data?.success || status === 'paid' || status === 'active') {
          if (handledSubRef.current === verifyingSubId) return;
          handledSubRef.current = verifyingSubId;
          finishSuccess(data);
          return;
        }

        if (data?.failed || data?.cancelled || status === 'cancelled') {
          toast.error(data?.failureReason || 'Payment was not completed.');
          setVerifyingSubId(null);
          return;
        }

        setPollCount((current) => {
          const next = current + 1;
          if (next >= maxAttempts) {
            toast.error('Payment is taking longer than expected. Try checking again shortly.');
            setVerifyingSubId(null);
          } else {
            scheduleNext(data?.transientError ? 6000 : 4000);
          }
          return next;
        });
      } catch (err: any) {
        setPollCount((current) => {
          const next = current + 1;
          if (next >= maxAttempts) {
            toast.error('Could not confirm payment yet. If you paid, use phone OTP login.');
            setVerifyingSubId(null);
          } else {
            scheduleNext(6000);
          }
          return next;
        });
      } finally {
        statusInFlightRef.current = false;
      }
    };

    runPoll();

    return () => {
      cancelled = true;
      statusInFlightRef.current = false;
      if (timer) window.clearTimeout(timer);
    };
  }, [phone, selectedRouter?.localGateway, verifyingSubId]);

  const startCheckout = (pkg: PublicPackage) => {
    const cleanPhone = phone.replace(/\D/g, '');
    if (cleanPhone.length < 9) {
      toast.error('Enter your M-Pesa phone number first');
      return;
    }
    if (!routerId) {
      toast.error('No online hotspot location is available right now');
      return;
    }

    setSelectedPkg(pkg);
    checkoutMutation.mutate(pkg);
  };

  const isBusy = checkoutMutation.isPending || !!verifyingSubId;
  const loading = packagesQuery.isLoading || routersQuery.isLoading;

  return (
    <div className="min-h-screen overflow-hidden bg-[var(--bg-main)] text-main">
      <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(circle_at_top_left,rgba(6,182,212,0.16),transparent_34%),radial-gradient(circle_at_bottom_right,rgba(16,185,129,0.12),transparent_30%)]" />
      <main className="relative mx-auto flex min-h-screen w-full max-w-6xl flex-col px-4 py-6 sm:px-6 lg:px-8">
        <nav className="mb-8 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-cyan-500 text-sm font-black text-white shadow-lg shadow-cyan-500/30">
              PL
            </div>
            <div>
              <p className="text-lg font-black tracking-tight text-main">PulseLynk</p>
              <p className="text-[10px] font-black uppercase tracking-[0.25em] text-cyan-400">
                Quick Internet
              </p>
            </div>
          </div>
          <Link
            to="/login"
            className="rounded-full border border-white/10 px-4 py-2 text-[10px] font-black uppercase tracking-widest text-muted transition hover:border-cyan-400/40 hover:text-cyan-300"
          >
            Login
          </Link>
        </nav>

        <section className="grid flex-1 items-center gap-8 lg:grid-cols-[0.9fr_1.1fr]">
          <div className="space-y-8">
            <div className="inline-flex items-center gap-2 rounded-full border border-emerald-400/20 bg-emerald-400/10 px-4 py-2 text-[10px] font-black uppercase tracking-[0.22em] text-emerald-300">
              <Zap size={14} />
              No signup required
            </div>

            <div>
              <h1 className="max-w-xl text-5xl font-black tracking-tighter text-main sm:text-6xl lg:text-7xl">
                Buy internet in one minute.
              </h1>
              <p className="mt-5 max-w-lg text-base font-semibold text-muted sm:text-lg">
                Pick a package, enter your M-Pesa number, approve the prompt, and we connect this device automatically.
              </p>
            </div>

            <div className="grid max-w-xl grid-cols-1 gap-3 sm:grid-cols-3">
              {[
                ['1', 'Choose plan'],
                ['2', 'Pay STK'],
                ['3', 'Auto connect'],
              ].map(([step, label]) => (
                <div
                  key={step}
                  className="rounded-2xl border border-white/10 bg-white/[0.03] p-4"
                >
                  <p className="mb-2 flex h-7 w-7 items-center justify-center rounded-full bg-cyan-500/15 text-xs font-black text-cyan-300">
                    {step}
                  </p>
                  <p className="text-xs font-black uppercase tracking-widest text-main">
                    {label}
                  </p>
                </div>
              ))}
            </div>
          </div>

          <div className="glass-panel relative overflow-hidden rounded-[2rem] p-5 sm:p-7">
            <div className="absolute right-0 top-0 h-40 w-40 translate-x-16 -translate-y-16 rounded-full bg-cyan-500/20 blur-3xl" />

            <div className="relative mb-6 space-y-4">
              <div>
                <label className="mb-2 flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-muted">
                  <Phone size={14} />
                  M-Pesa Phone
                </label>
                <input
                  type="tel"
                  inputMode="numeric"
                  autoComplete="tel"
                  value={phone}
                  onChange={(event) => setPhone(event.target.value)}
                  placeholder="07XXXXXXXX or 2547XXXXXXXX"
                  className="w-full rounded-2xl border border-white/10 bg-slate-950/70 px-4 py-4 text-lg font-black tracking-wider text-main outline-none transition focus:border-cyan-400"
                />
              </div>

              {routers.length > 1 && (
                <div>
                  <label className="mb-2 flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-muted">
                    <MapPin size={14} />
                    Hotspot Location
                  </label>
                  <select
                    value={routerId}
                    onChange={(event) => setRouterId(event.target.value)}
                    className="w-full rounded-2xl border border-white/10 bg-slate-950/70 px-4 py-4 text-sm font-black text-main outline-none transition focus:border-cyan-400"
                  >
                    {routers.map((router: PublicRouter) => (
                      <option key={router.id} value={router.id}>
                        {router.name}
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </div>

            {loading ? (
              <div className="flex min-h-[20rem] items-center justify-center text-muted">
                <Loader2 className="mr-2 animate-spin" size={18} />
                Loading packages...
              </div>
            ) : (
              <div className="relative grid gap-4">
                {packages.map((pkg) => (
                  <button
                    key={pkg.id}
                    type="button"
                    disabled={isBusy}
                    onClick={() => startCheckout(pkg)}
                    className="group rounded-3xl border border-white/10 bg-slate-950/50 p-5 text-left transition hover:-translate-y-0.5 hover:border-cyan-400/50 hover:bg-cyan-400/5 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <p className="text-2xl font-black tracking-tight text-main">
                          {pkg.name}
                        </p>
                        <div className="mt-3 flex flex-wrap gap-2 text-[10px] font-black uppercase tracking-widest text-muted">
                          <span className="inline-flex items-center gap-1 rounded-full bg-white/5 px-3 py-1">
                            <Clock size={12} />
                            {pkg.durationValue} {pkg.durationType}
                          </span>
                          <span className="inline-flex items-center gap-1 rounded-full bg-white/5 px-3 py-1">
                            <Smartphone size={12} />
                            {pkg.maxDevices || 1} device(s)
                          </span>
                          <span className="inline-flex items-center gap-1 rounded-full bg-white/5 px-3 py-1">
                            <Wifi size={12} />
                            {pkg.downloadSpeed || 'Fast'}
                          </span>
                        </div>
                      </div>
                      <div className="text-right">
                        <p className="text-[10px] font-black uppercase tracking-widest text-cyan-300">
                          KES
                        </p>
                        <p className="text-3xl font-black text-cyan-300">
                          {Number(pkg.price || 0).toLocaleString()}
                        </p>
                      </div>
                    </div>
                    <div className="mt-5 flex items-center justify-between border-t border-white/10 pt-4">
                      <span className="flex items-center gap-2 text-xs font-bold text-emerald-300">
                        <ShieldCheck size={15} />
                        Account saved by phone
                      </span>
                      <span className="rounded-full bg-cyan-500 px-4 py-2 text-[10px] font-black uppercase tracking-widest text-white shadow-lg shadow-cyan-500/20">
                        Buy now
                      </span>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </section>
      </main>

      {verifyingSubId && (
        <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-slate-950/90 p-4 backdrop-blur-xl">
          <div className="glass-panel w-full max-w-sm rounded-[2rem] border-cyan-400/30 p-8 text-center">
            <div className="mx-auto mb-6 flex h-20 w-20 items-center justify-center rounded-full bg-cyan-500/10">
              <Loader2 className="animate-spin text-cyan-300" size={34} />
            </div>
            <h2 className="text-2xl font-black tracking-tight text-main">
              Confirm M-Pesa
            </h2>
            <p className="mt-3 text-sm font-semibold text-muted">
              Enter your PIN on <span className="text-main">{phone}</span>. We will connect you as soon as payment clears.
            </p>
            <div className="mt-6 h-1.5 overflow-hidden rounded-full bg-white/10">
              <div
                className="h-full rounded-full bg-cyan-400 transition-all"
                style={{ width: `${Math.min((pollCount / 24) * 100, 100)}%` }}
              />
            </div>
            <div className="mt-5 flex items-center justify-center gap-2 text-[10px] font-black uppercase tracking-widest text-cyan-300">
              <CheckCircle2 size={14} />
              Waiting for confirmation
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
