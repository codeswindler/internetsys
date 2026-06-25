import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { AlertTriangle, RefreshCw, ShieldCheck, Wifi } from 'lucide-react';
import api from '../../services/api';
import {
  clearHotspotConnectContext,
  clearStoredHotspotIdentity,
  hasFreshHotspotIdentity,
  getStoredHotspotIdentity,
  markHotspotConnectCompleted,
  readHotspotConnectCompleted,
  readHotspotConnectContext,
  resolveHotspotReleaseUrl,
  shouldTriggerHotspotIdentify,
  storeHotspotContext,
  storeHotspotDeviceLimitContext,
  submitHotspotLoginRelease,
  syncStoredHotspotIdentity,
  traceHotspot,
} from '../../services/hotspot';

const INTERNET_LANDING_URL = 'https://www.google.com/';

export default function HotspotConnect() {
  const navigate = useNavigate();
  const location = useLocation();
  const startedRef = useRef(false);
  const [stage, setStage] = useState('Preparing secure connection...');
  const [error, setError] = useState('');
  const [fromPath, setFromPath] = useState('/user/dashboard');
  const [connected, setConnected] = useState(false);
  const [releaseTarget, setReleaseTarget] = useState(INTERNET_LANDING_URL);

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;

    const params = new URLSearchParams(location.search);
    const attemptId = params.get('attempt');
    const connectContext = readHotspotConnectContext(attemptId);
    const subId = params.get('sub');
    const requestedFrom =
      params.get('from') || connectContext?.fromPath || '/user/dashboard';
    const requestedRouterIp =
      params.get('routerIp') || connectContext?.routerIp || undefined;
    const identifyAttempted = params.get('identified') === '1';
    const token = localStorage.getItem('token');

    traceHotspot('connect-mounted', {
      sub: subId,
      detail: `identified=${identifyAttempted};attempt=${attemptId || 'none'}`,
    });

    setFromPath(requestedFrom);
    storeHotspotContext(params, window.location.origin);

    if (!subId) {
      traceHotspot('connect-missing-sub');
      setError('Missing subscription details for this connection attempt.');
      return;
    }

    if (!token) {
      traceHotspot('connect-missing-token', { sub: subId });
      const returnTo = encodeURIComponent(
        `${window.location.pathname}${window.location.search}`,
      );
      navigate(`/login?returnTo=${returnTo}`, { replace: true });
      return;
    }

    const startConnection = async () => {
      const completedAttempt = readHotspotConnectCompleted(attemptId, subId);
      if (completedAttempt) {
        syncStoredHotspotIdentity({
          mac: completedAttempt.resolvedMac,
          ip: completedAttempt.resolvedIp,
        });
        setReleaseTarget(completedAttempt.releaseTarget || INTERNET_LANDING_URL);
        setConnected(true);
        setStage('This device is connected. You can close this tab or continue browsing.');
        clearHotspotConnectContext(attemptId);
        traceHotspot('connect-attempt-reused', {
          sub: subId,
          detail: `mode=${completedAttempt.authorizationMode || 'unknown'}`,
        });
        return;
      }

      const identity = getStoredHotspotIdentity();
      const hasIdentity = !!(identity.mac || identity.ip);
      const hasFreshIdentity = hasFreshHotspotIdentity();

      const completeRouterHandoff = (sub: any) => {
        syncStoredHotspotIdentity({
          mac: sub?.resolvedMac,
          ip: sub?.resolvedIp,
        });

        const releaseUrl = resolveHotspotReleaseUrl(
          window.location.origin,
          connectContext?.releaseUrl,
        );
        const safeReleaseTarget = (() => {
          try {
            const target = new URL(releaseUrl, window.location.origin);
            return target.protocol === 'https:' && !target.href.includes('generate_204')
              ? target.href
              : INTERNET_LANDING_URL;
          } catch {
            return INTERNET_LANDING_URL;
          }
        })();
        const routerGateway =
          requestedRouterIp ||
          sub?.router?.localGateway ||
          localStorage.getItem('hotspot_router_id') ||
          '10.5.50.1';

        setStage('Completing router handoff...');
        setReleaseTarget(safeReleaseTarget);
        toast.success('Device linked. You are online.');
        markHotspotConnectCompleted(attemptId, {
          subId,
          releaseTarget: safeReleaseTarget,
          resolvedMac: sub?.resolvedMac,
          resolvedIp: sub?.resolvedIp,
          authorizationMode: sub?.authorizationMode || 'unknown',
        });
        clearHotspotConnectContext(attemptId);
        traceHotspot('connect-router-release', {
          sub: subId,
          detail: `router=${routerGateway};mode=${sub?.authorizationMode || 'unknown'}`,
        });

        const submitted = submitHotspotLoginRelease({
          routerIp: routerGateway,
          username: sub?.mikrotikUsername,
          password: sub?.mikrotikPassword,
          releaseUrl,
          currentOrigin: window.location.origin,
          target: 'hidden',
        });

        window.setTimeout(() => {
          setConnected(true);
          setStage('This device is connected. You can close this tab or continue browsing.');
          traceHotspot('connect-connected-screen', {
            sub: subId,
            detail: `hiddenLogin=${submitted ? 'submitted' : 'skipped'}`,
          });
        }, submitted ? 900 : 250);
      };

      try {
        traceHotspot('connect-start-api', {
          sub: subId,
          detail: `identity=${hasIdentity ? 'yes' : 'no'};fresh=${hasFreshIdentity ? 'yes' : 'no'};mac=${identity.mac ? 'yes' : 'no'};ip=${identity.ip ? 'yes' : 'no'}`,
        });
        setStage(hasIdentity ? 'Authorizing this device...' : 'Finding this device on the hotspot...');
        const res = await api.post(`/subscriptions/${subId}/start`, {
          mac: identity.mac,
          ip: identity.ip,
        });

        completeRouterHandoff(res.data);
      } catch (err: any) {
        if (hasIdentity && shouldTriggerHotspotIdentify(err)) {
          clearStoredHotspotIdentity();
          traceHotspot('connect-stale-identity-fallback', {
            sub: subId,
            detail: err.response?.data?.message || 'retry without stored identity',
          });

          try {
            setStage('Refreshing hotspot device match...');
            const retryRes = await api.post(`/subscriptions/${subId}/start`, {});
            completeRouterHandoff(retryRes.data);
            return;
          } catch (retryErr: any) {
            err = retryErr;
          }
        }

        if (err.response?.status === 409 && err.response?.data?.connectedDevices) {
          traceHotspot('connect-device-limit', {
            sub: subId,
            detail: `devices=${err.response.data.connectedDevices?.length || 0}`,
          });
          storeHotspotDeviceLimitContext(err.response.data);
          const backUrl = new URL(`${window.location.origin}${requestedFrom}`);
          backUrl.searchParams.set('device_limit', '1');
          backUrl.searchParams.set('subId', err.response.data.subId || subId);
          clearHotspotConnectContext(attemptId);
          window.location.replace(backUrl.toString());
          return;
        }

        if (shouldTriggerHotspotIdentify(err)) {
          traceHotspot('connect-reidentify-error', {
            sub: subId,
            detail: err.response?.data?.message || 'identify error',
          });
          setError(
            'We could not confirm this device on the hotspot yet. Keep Wi-Fi connected and tap Retry.',
          );
          return;
        }

        traceHotspot('connect-start-error', {
          sub: subId,
          detail: err.response?.data?.message || err.message || 'unknown',
        });
        setError(
          err.response?.data?.message ||
            'We could not connect this device right now.',
        );
      }
    };

    startConnection();
  }, [location.search, navigate]);

  return (
    <div className="max-w-2xl mx-auto w-full py-10 md:py-16 animate-fade-in">
      <div className="glass-panel rounded-[2.5rem] p-8 md:p-12 border border-cyan-500/20 bg-panel shadow-[0_20px_60px_rgba(8,145,178,0.15)]">
        <div className="flex flex-col items-center text-center gap-6">
          <div
            className={`w-20 h-20 rounded-3xl flex items-center justify-center ${
              error
                ? 'bg-orange-500/10 text-orange-400'
                : connected
                  ? 'bg-emerald-500/10 text-emerald-400'
                : 'bg-cyan-500/10 text-cyan-400'
            }`}
          >
            {error ? <AlertTriangle size={36} /> : <ShieldCheck size={36} />}
          </div>

          <div className="space-y-3">
            <p className="text-[10px] font-black uppercase tracking-[0.35em] text-cyan-400">
              Secure Device Link
            </p>
            <h1 className="text-3xl md:text-4xl font-black text-main tracking-tight">
              {error
                ? 'Connection Needs Attention'
                : connected
                  ? 'Connected'
                  : 'Connecting This Device'}
            </h1>
            <p className="text-sm md:text-base text-muted max-w-lg leading-relaxed">
              {error || stage}
            </p>
          </div>

          {!error && !connected && (
            <>
              <div className="flex items-center gap-3 px-5 py-3 rounded-full bg-cyan-500/10 border border-cyan-500/20">
                <RefreshCw size={16} className="text-cyan-400 animate-spin" />
                <span className="text-[11px] font-black uppercase tracking-[0.25em] text-cyan-300">
                  Working on it
                </span>
              </div>
            </>
          )}

          {!error && connected && (
            <div className="flex flex-col sm:flex-row gap-4 w-full sm:w-auto">
              <button
                onClick={() => navigate(fromPath, { replace: true })}
                className="px-6 py-4 rounded-2xl bg-main/5 border border-main/10 text-main font-black uppercase tracking-widest hover:bg-main/10 transition-all active:scale-95"
              >
                Dashboard
              </button>
              <button
                onClick={() => window.location.assign(releaseTarget)}
                className="px-6 py-4 rounded-2xl bg-cyan-600 text-white font-black uppercase tracking-widest hover:bg-cyan-500 transition-all active:scale-95 flex items-center justify-center gap-2"
              >
                <Wifi size={16} />
                Open Internet
              </button>
            </div>
          )}

          {error && (
            <div className="flex flex-col sm:flex-row gap-4 w-full sm:w-auto">
              <button
                onClick={() => window.location.reload()}
                className="px-6 py-4 rounded-2xl bg-cyan-600 text-white font-black uppercase tracking-widest hover:bg-cyan-500 transition-all active:scale-95 flex items-center justify-center gap-2"
              >
                <Wifi size={16} />
                Retry
              </button>
              <button
                onClick={() => navigate(fromPath, { replace: true })}
                className="px-6 py-4 rounded-2xl bg-main/5 border border-main/10 text-main font-black uppercase tracking-widest hover:bg-main/10 transition-all active:scale-95"
              >
                Back
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
