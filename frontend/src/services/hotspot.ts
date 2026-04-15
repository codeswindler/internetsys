const HOTSPOT_RELEASE_URL_KEY = 'hotspot_release_url';
const HOTSPOT_RELEASE_FALLBACK_URL = 'http://connectivitycheck.gstatic.com/generate_204';
const HOTSPOT_IDENTITY_UPDATED_AT_KEY = 'hotspot_identity_updated_at';
const HOTSPOT_DEVICE_LIMIT_CONTEXT_KEY = 'hotspot_device_limit_context';
const HOTSPOT_CONNECT_CONTEXT_PREFIX = 'hotspot_connect_context:';

type HotspotConnectContext = {
  subId: string;
  fromPath: string;
  routerIp?: string;
  releaseUrl?: string;
};

export const resolveHotspotLoginUrl = (routerIp: string) => {
  const storedLoginUrl = localStorage.getItem('hotspot_link_login');
  const routerIdentity = localStorage.getItem('hotspot_router_id');

  if (storedLoginUrl) {
    try {
      const parsed = new URL(storedLoginUrl);
      if (parsed.hostname === routerIp || (routerIdentity && parsed.hostname === routerIdentity)) {
        return storedLoginUrl;
      }
    } catch {
      // Ignore stale or malformed router login URLs and fall back to the gateway.
    }
  }

  return `http://${routerIp}/login`;
};

export const buildHotspotIdentifyUrl = (routerIp: string, returnUrl: string) => {
  const loginUrl = new URL(resolveHotspotLoginUrl(routerIp));
  loginUrl.searchParams.set('dst', returnUrl);
  return loginUrl.toString();
};

export const buildHotspotConnectUrl = (
  subId: string,
  fromPath: string,
  routerIp?: string,
  currentOrigin?: string,
) => {
  const connectUrl = new URL('/connect', currentOrigin || window.location.origin);
  const attemptId = `hc_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  persistHotspotConnectContext(attemptId, {
    subId,
    fromPath,
    routerIp,
    releaseUrl: getStoredHotspotReleaseUrl(currentOrigin),
  });

  connectUrl.searchParams.set('attempt', attemptId);
  connectUrl.searchParams.set('sub', subId);
  connectUrl.searchParams.set('from', fromPath);
  if (routerIp) {
    connectUrl.searchParams.set('routerIp', routerIp);
  }
  return connectUrl.toString();
};

export const getStoredHotspotIdentity = () => ({
  mac: localStorage.getItem('hotspot_mac') || undefined,
  ip: localStorage.getItem('hotspot_ip') || undefined,
});

const normalizeMac = (mac?: string | null) =>
  mac ? mac.replace(/[^a-fA-F0-9]/g, '').toUpperCase() : '';

const touchHotspotIdentity = () => {
  localStorage.setItem(HOTSPOT_IDENTITY_UPDATED_AT_KEY, `${Date.now()}`);
};

export const syncStoredHotspotIdentity = (identity?: { mac?: string; ip?: string }) => {
  if (!identity) return;

  let changed = false;

  if (identity.mac) {
    localStorage.setItem('hotspot_mac', identity.mac);
    changed = true;
  }

  if (identity.ip) {
    localStorage.setItem('hotspot_ip', identity.ip);
    changed = true;
  }

  if (changed) {
    touchHotspotIdentity();
  }
};

export const hasStoredHotspotIdentity = () => {
  const identity = getStoredHotspotIdentity();
  return !!(identity.mac || identity.ip);
};

export const hasFreshHotspotIdentity = (maxAgeMs = 5 * 60 * 1000) => {
  if (!hasStoredHotspotIdentity()) {
    return false;
  }

  const updatedAt = Number(localStorage.getItem(HOTSPOT_IDENTITY_UPDATED_AT_KEY) || 0);
  if (!updatedAt) {
    return false;
  }

  return Date.now() - updatedAt <= maxAgeMs;
};

export const matchesStoredHotspotIdentity = (
  session?: { macAddress?: string; ipAddress?: string; isActive?: boolean },
  identity = getStoredHotspotIdentity(),
) => {
  if (!session?.isActive) return false;

  const storedMac = normalizeMac(identity.mac);
  const sessionMac = normalizeMac(session.macAddress);
  const macMatches = !!storedMac && !!sessionMac && storedMac === sessionMac;
  const ipMatches = !!identity.ip && !!session.ipAddress && identity.ip === session.ipAddress;

  return macMatches || ipMatches;
};

const parseHotspotUrl = (value?: string | null, currentOrigin?: string) => {
  if (!value) return null;

  let candidate = value.trim();
  if (!candidate) return null;

  try {
    candidate = decodeURIComponent(candidate);
  } catch {
    // Keep the raw value when it is already decoded.
  }

  try {
    return new URL(candidate, currentOrigin || window.location.origin);
  } catch {
    return null;
  }
};

const getHotspotConnectContextKey = (attemptId: string) =>
  `${HOTSPOT_CONNECT_CONTEXT_PREFIX}${attemptId}`;

export const persistHotspotConnectContext = (
  attemptId: string,
  context: HotspotConnectContext,
) => {
  sessionStorage.setItem(
    getHotspotConnectContextKey(attemptId),
    JSON.stringify(context),
  );
};

export const readHotspotConnectContext = (
  attemptId?: string | null,
): HotspotConnectContext | null => {
  if (!attemptId) return null;

  const raw = sessionStorage.getItem(getHotspotConnectContextKey(attemptId));
  if (!raw) return null;

  try {
    return JSON.parse(raw) as HotspotConnectContext;
  } catch {
    return null;
  }
};

export const clearHotspotConnectContext = (attemptId?: string | null) => {
  if (!attemptId) return;
  sessionStorage.removeItem(getHotspotConnectContextKey(attemptId));
};

const isAppOrRouterDestination = (url: URL, currentOrigin?: string) => {
  const appOrigin = currentOrigin || window.location.origin;
  const routerIdentity = localStorage.getItem('hotspot_router_id');
  const loginUrl = parseHotspotUrl(localStorage.getItem('hotspot_link_login'), currentOrigin);
  const isPrivateHost =
    url.hostname === 'localhost' ||
    /^10\./.test(url.hostname) ||
    /^192\.168\./.test(url.hostname) ||
    /^172\.(1[6-9]|2\d|3[0-1])\./.test(url.hostname);

  if (url.origin === appOrigin) {
    return true;
  }

  if (routerIdentity && url.hostname === routerIdentity) {
    return true;
  }

  if (loginUrl && url.host === loginUrl.host) {
    return true;
  }

  return isPrivateHost;
};

export const storeHotspotContext = (params: URLSearchParams, currentOrigin?: string) => {
  const mac = params.get('mac');
  const ip = params.get('ip');
  const routerIdentity = params.get('router');
  const linkLogin =
    params.get('link-login') ||
    params.get('link-login-only') ||
    params.get('link-login-esc');
  const originalDestination =
    params.get('link-orig') ||
    params.get('link-orig-esc') ||
    params.get('link-orig-only') ||
    params.get('dst') ||
    params.get('orig') ||
    params.get('orig-url');

  if (mac) localStorage.setItem('hotspot_mac', mac);
  if (ip) localStorage.setItem('hotspot_ip', ip);
  if (mac || ip) touchHotspotIdentity();
  if (routerIdentity) localStorage.setItem('hotspot_router_id', routerIdentity);
  if (linkLogin) localStorage.setItem('hotspot_link_login', linkLogin);

  const parsedOriginal = parseHotspotUrl(originalDestination, currentOrigin);
  if (parsedOriginal && !isAppOrRouterDestination(parsedOriginal, currentOrigin)) {
    localStorage.setItem(HOTSPOT_RELEASE_URL_KEY, parsedOriginal.toString());
  }
};

export const getStoredHotspotReleaseUrl = (currentOrigin?: string) => {
  const stored = parseHotspotUrl(localStorage.getItem(HOTSPOT_RELEASE_URL_KEY), currentOrigin);
  if (stored && !isAppOrRouterDestination(stored, currentOrigin)) {
    return stored.toString();
  }

  return undefined;
};

export const resolveHotspotReleaseUrl = (
  currentOrigin?: string,
  fallbackUrl = HOTSPOT_RELEASE_FALLBACK_URL,
) => {
  const stored = getStoredHotspotReleaseUrl(currentOrigin);
  if (stored) {
    return stored;
  }

  return fallbackUrl;
};

export const submitHotspotLoginRelease = ({
  routerIp,
  username,
  password,
  releaseUrl,
  currentOrigin,
}: {
  routerIp?: string;
  username?: string;
  password?: string;
  releaseUrl?: string;
  currentOrigin?: string;
}) => {
  if (
    typeof document === 'undefined' ||
    !routerIp ||
    !username ||
    !password
  ) {
    return false;
  }

  const form = document.createElement('form');
  form.method = 'POST';
  form.action = resolveHotspotLoginUrl(routerIp);
  form.style.display = 'none';

  const payload: Record<string, string> = {
    username,
    password,
    dst: resolveHotspotReleaseUrl(currentOrigin, releaseUrl),
    popup: 'true',
  };

  Object.entries(payload).forEach(([name, value]) => {
    const input = document.createElement('input');
    input.type = 'hidden';
    input.name = name;
    input.value = value;
    form.appendChild(input);
  });

  document.body.appendChild(form);
  form.submit();
  window.setTimeout(() => form.remove(), 1000);
  return true;
};

export const shouldTriggerHotspotIdentify = (error: any) => {
  const status = error?.response?.status;
  const message = `${error?.response?.data?.message || ''}`.toLowerCase();

  if (status !== 400) return false;

  return (
    message.includes('missing mac and ip address bindings') ||
    message.includes('not physically connected to the hotspot wi-fi network') ||
    message.includes('unable to identify your device on the hotspot')
  );
};

export const storeHotspotDeviceLimitContext = (context: any) => {
  sessionStorage.setItem(HOTSPOT_DEVICE_LIMIT_CONTEXT_KEY, JSON.stringify(context));
};

export const consumeHotspotDeviceLimitContext = () => {
  const raw = sessionStorage.getItem(HOTSPOT_DEVICE_LIMIT_CONTEXT_KEY);
  if (!raw) return null;

  sessionStorage.removeItem(HOTSPOT_DEVICE_LIMIT_CONTEXT_KEY);

  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
};
