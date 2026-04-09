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

export const shouldTriggerHotspotIdentify = (error: any) => {
  const status = error?.response?.status;
  const message = `${error?.response?.data?.message || ''}`.toLowerCase();

  if (status !== 400) return false;

  return (
    message.includes('missing mac and ip address bindings') ||
    message.includes('not physically connected to the hotspot wi-fi network')
  );
};
