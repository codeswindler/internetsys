const HOTSPOT_RELEASE_URL_KEY = 'hotspot_release_url';
const HOTSPOT_RELEASE_FALLBACK_URL = 'http://connectivitycheck.gstatic.com/generate_204';

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

export const getStoredHotspotIdentity = () => ({
  mac: localStorage.getItem('hotspot_mac') || undefined,
  ip: localStorage.getItem('hotspot_ip') || undefined,
});

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
  if (routerIdentity) localStorage.setItem('hotspot_router_id', routerIdentity);
  if (linkLogin) localStorage.setItem('hotspot_link_login', linkLogin);

  const parsedOriginal = parseHotspotUrl(originalDestination, currentOrigin);
  if (parsedOriginal && !isAppOrRouterDestination(parsedOriginal, currentOrigin)) {
    localStorage.setItem(HOTSPOT_RELEASE_URL_KEY, parsedOriginal.toString());
  }
};

export const resolveHotspotReleaseUrl = (currentOrigin?: string) => {
  const stored = parseHotspotUrl(localStorage.getItem(HOTSPOT_RELEASE_URL_KEY), currentOrigin);
  if (stored && !isAppOrRouterDestination(stored, currentOrigin)) {
    return stored.toString();
  }

  return HOTSPOT_RELEASE_FALLBACK_URL;
};

export const shouldTriggerHotspotIdentify = (error: any) => {
  const status = error?.response?.status;
  const message = `${error?.response?.data?.message || ''}`.toLowerCase();

  if (status !== 400) return false;

  return (
    message.includes('missing mac and ip address bindings') ||
    message.includes('not physically connected to the hotspot wi-fi network')
  );
};
