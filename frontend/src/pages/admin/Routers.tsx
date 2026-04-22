import { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import {
  Router as RouterIcon, Wifi, WifiOff,
  RefreshCw, Plus, Edit, Trash2, Eye, EyeOff, ShieldCheck,
  AlertCircle, Signal, ChevronDown, ChevronUp, Zap, ArrowUp, UserPlus, CheckSquare, Square,
  Terminal, Copy
} from 'lucide-react';
import api from '../../services/api';
import { ConfirmModal } from '../../components/ConfirmModal';

export default function Routers() {
  const queryClient = useQueryClient();
  const profilesRef = useRef<HTMLDivElement>(null);

  const [showModal, setShowModal] = useState(false);
  const [showApModal, setShowApModal] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showApPassword, setShowApPassword] = useState(false);
  const [showVpnPassword, setShowVpnPassword] = useState(false);
  const [showCardPasswords, setShowCardPasswords] = useState<Record<string, boolean>>({});
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingApId, setEditingApId] = useState<string | null>(null);
  const [expandedProfiles, setExpandedProfiles] = useState<Record<string, boolean>>({});
  const [apKickMacs, setApKickMacs] = useState<Record<string, string>>({});
  
  const [formData, setFormData] = useState({ 
    name: '', 
    host: '', 
    apiUsername: '', 
    apiPasswordEncrypted: '', 
    port: 8728, 
    connectionMode: 'hotspot',
    isNated: false,
    vpnIp: '',
    vpnUsername: '',
    vpnPasswordEncrypted: '',
    localGateway: '10.5.50.1'
  });
  const [confirmState, setConfirmState] = useState<{ isOpen: boolean; title: string; message: string; onConfirm: () => void }>({ isOpen: false, title: '', message: '', onConfirm: () => {} });
  const [apFormData, setApFormData] = useState({
    name: '',
    provider: 'mikrotik_routeros',
    host: '',
    port: 8728,
    apiUsername: '',
    apiPasswordEncrypted: '',
    isNated: false,
    vpnIp: '',
    isActive: true,
    notes: '',
  });
  
  // Profile Modal State
  const [showProfileModal, setShowProfileModal] = useState(false);
  const [profileData, setProfileData] = useState<{
    name: string;
    downloadLimit: string;
    uploadLimit: string;
    routerIds: string[];
    isAssignOnly: boolean;
  }>({ name: '', downloadLimit: '5M', uploadLimit: '2M', routerIds: [], isAssignOnly: false });

  const { data: routers, isLoading } = useQuery({
    queryKey: ['routers'],
    queryFn: () => api.get('/routers').then(res => res.data),
    refetchInterval: 10000,
  });

  const { data: accessPoints } = useQuery({
    queryKey: ['access-points'],
    queryFn: () => api.get('/access-points').then(res => res.data),
    refetchInterval: 10000,
  });

  const { data: allProfiles } = useQuery<string[]>({
    queryKey: ['available-profiles'],
    queryFn: () => api.get('/routers/sync/all-profiles').then(res => res.data),
    refetchInterval: 60000,
  });

  const { data: vpnSettings } = useQuery({
    queryKey: ['vpn-settings'],
    queryFn: () => api.get('/routers/vpn/settings').then(res => res.data),
    staleTime: Infinity,
  });

  const syncProfileMutation = useMutation({
    mutationFn: (data: any) => api.post('/routers/profiles/sync', data),
    onSuccess: (res: any) => {
      setShowProfileModal(false);
      setProfileData({ name: '', downloadLimit: '5M', uploadLimit: '2M', routerIds: [], isAssignOnly: false });
      toast.success(`Profile synced to ${res.data.success} routers!`);
      queryClient.invalidateQueries({ queryKey: ['available-profiles'] });
      queryClient.invalidateQueries({ queryKey: ['routers'] });
    },
    onError: () => toast.error('Failed to sync profile across network'),
  });

  const createMutation = useMutation({
    mutationFn: (newRouter: any) => api.post('/routers', newRouter),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['routers'] }); closeModal(); toast.success('Router added successfully.'); },
    onError: () => toast.error('Failed to add router'),
  });

  const updateMutation = useMutation({
    mutationFn: (updatedRouter: any) => api.put(`/routers/${editingId}`, updatedRouter),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['routers'] }); closeModal(); toast.success('Router updated'); },
    onError: () => toast.error('Failed to update router'),
  });

  const testMutation = useMutation({
    mutationFn: (id: string) => api.post(`/routers/${id}/test`).then(res => res.data),
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ['routers'] });
      queryClient.invalidateQueries({ queryKey: ['available-profiles'] });
      if (data.success) toast.success('Connection successful!');
      else toast.error(`Failed: ${data.message}`, { duration: 5000 });
    },
    onError: () => toast.error('Unexpected error testing connection'),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/routers/${id}`),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['routers'] }); toast.success('Router deleted'); },
  });

  const createApMutation = useMutation({
    mutationFn: (newAccessPoint: any) => api.post('/access-points', newAccessPoint),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['access-points'] }); closeApModal(); toast.success('AP controller added.'); },
    onError: (err: any) => toast.error(err.response?.data?.message || 'Failed to add AP controller'),
  });

  const updateApMutation = useMutation({
    mutationFn: (updatedAccessPoint: any) => api.put(`/access-points/${editingApId}`, updatedAccessPoint),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['access-points'] }); closeApModal(); toast.success('AP controller updated'); },
    onError: (err: any) => toast.error(err.response?.data?.message || 'Failed to update AP controller'),
  });

  const testApMutation = useMutation({
    mutationFn: (id: string) => api.post(`/access-points/${id}/test`).then(res => res.data),
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ['access-points'] });
      if (data.success) toast.success('AP controller reachable');
      else toast.error(`AP test failed: ${data.message}`, { duration: 5000 });
    },
    onError: () => toast.error('Unexpected error testing AP controller'),
  });

  const testApKickMutation = useMutation({
    mutationFn: ({ id, mac }: { id: string; mac: string }) =>
      api.post(`/access-points/${id}/test-kick`, { mac }).then(res => res.data),
    onSuccess: (data: any) => {
      if (data.success) toast.success(data.message || 'AP kick requested');
      else toast.error(data.message || 'No matching station found', { duration: 5000 });
    },
    onError: (err: any) => toast.error(err.response?.data?.message || 'AP kick test failed'),
  });

  const deleteApMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/access-points/${id}`),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['access-points'] }); toast.success('AP controller deleted'); },
    onError: (err: any) => toast.error(err.response?.data?.message || 'Failed to delete AP controller'),
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (editingId) updateMutation.mutate(formData);
    else createMutation.mutate(formData);
  };

  const handleApSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (editingApId) updateApMutation.mutate(apFormData);
    else createApMutation.mutate(apFormData);
  };

  const openEditModal = (r: any) => {
    setEditingId(r.id);
    setFormData({ 
      name: r.name, 
      host: r.host, 
      apiUsername: r.apiUsername, 
      apiPasswordEncrypted: r.apiPasswordEncrypted || '', 
      port: r.port, 
      connectionMode: r.connectionMode || 'hotspot',
      isNated: r.isNated || false,
      vpnIp: r.vpnIp || '',
      vpnUsername: r.vpnUsername || '',
      vpnPasswordEncrypted: r.vpnPasswordEncrypted || '',
      localGateway: r.localGateway || '10.5.50.1'
    });
    setShowModal(true);
  };

  const closeModal = () => {
    setShowModal(false);
    setEditingId(null);
    setShowPassword(false);
    setShowVpnPassword(false);
    setFormData({ 
      name: '', 
      host: '', 
      apiUsername: '', 
      apiPasswordEncrypted: '', 
      port: 8728, 
      connectionMode: 'hotspot',
      isNated: false,
      vpnIp: '',
      vpnUsername: '',
      vpnPasswordEncrypted: '',
      localGateway: '10.5.50.1'
    });
  };

  const openEditApModal = (ap: any) => {
    setEditingApId(ap.id);
    setApFormData({
      name: ap.name || '',
      provider: ap.provider || 'mikrotik_routeros',
      host: ap.host || '',
      port: ap.port || 8728,
      apiUsername: ap.apiUsername || '',
      apiPasswordEncrypted: ap.apiPasswordEncrypted || '',
      isNated: ap.isNated || false,
      vpnIp: ap.vpnIp || '',
      isActive: ap.isActive ?? true,
      notes: ap.notes || '',
    });
    setShowApModal(true);
  };

  const closeApModal = () => {
    setShowApModal(false);
    setEditingApId(null);
    setShowApPassword(false);
    setApFormData({
      name: '',
      provider: 'mikrotik_routeros',
      host: '',
      port: 8728,
      apiUsername: '',
      apiPasswordEncrypted: '',
      isNated: false,
      vpnIp: '',
      isActive: true,
      notes: '',
    });
  };

  const toggleProfiles = (id: string) => setExpandedProfiles(p => ({ ...p, [id]: !p[id] }));
  const toggleCardPassword = (id: string) => setShowCardPasswords(p => ({ ...p, [id]: !p[id] }));
  const scrollToProfiles = () => profilesRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  const scrollToTop = () => window.scrollTo({ top: 0, behavior: 'smooth' });

  const onlineRouters = routers?.filter((r: any) => r.isOnline) || [];
  const onlineCount = onlineRouters.length;

  const openAssignModal = (profileName: string) => {
    // Collect the IDs of routers that currently have this profile
    const existingRouterIds = onlineRouters
      .filter((r: any) => r.profiles?.includes(profileName))
      .map((r: any) => r.id);

    setProfileData({
      name: profileName,
      downloadLimit: '5M',
      uploadLimit: '2M',
      routerIds: existingRouterIds,
      isAssignOnly: true
    });
    setShowProfileModal(true);
  };

  const openCreateProfileModal = () => {
    setProfileData({
      name: '',
      downloadLimit: '5M',
      uploadLimit: '2M',
      routerIds: onlineRouters.map((r: any) => r.id), // default to all online
      isAssignOnly: false
    });
    setShowProfileModal(true);
  };

  const toggleRouterSelection = (id: string) => {
    setProfileData(prev => ({
      ...prev,
      routerIds: prev.routerIds.includes(id) 
        ? prev.routerIds.filter(rId => rId !== id) 
        : [...prev.routerIds, id]
    }));
  };

  const selectAllRouters = () => {
    setProfileData(prev => ({ ...prev, routerIds: onlineRouters.map((r: any) => r.id) }));
  };

  const selectNoRouters = () => {
    setProfileData(prev => ({ ...prev, routerIds: [] }));
  };

  // Build profile rows: profile name → list of routers that have it
  const profileRows: { name: string; routers: string[] }[] = [];
  if (allProfiles && routers) {
    allProfiles.forEach((profileName: string) => {
      const routersWithProfile = routers
        .filter((r: any) => r.profiles?.includes(profileName))
        .map((r: any) => r.name);
      profileRows.push({ name: profileName, routers: routersWithProfile });
    });
  }

  return (
    <div className="space-y-10">
      {/* ── Header ── */}
      <div id="page-top" className="flex flex-wrap justify-between items-center gap-4">
        <div>
          <h2 className="text-2xl font-bold text-main">Manage Routers</h2>
          <p className="text-sm text-muted mt-1">{onlineCount} online · {routers?.length ?? 0} total</p>
        </div>
        <div className="flex gap-3 flex-wrap">
          <button
            className="px-4 py-2 rounded-lg bg-slate-800 border border-slate-700 text-slate-300 hover:text-white hover:bg-slate-700 transition-all flex items-center gap-2 text-sm font-bold"
            onClick={scrollToProfiles}
          >
            <Signal size={15} className="text-cyan-400" /> View Bandwidth Profiles
          </button>
          <button className="btn-primary flex items-center gap-2" onClick={() => setShowModal(true)}>
            <Plus size={18} /> Add Router
          </button>
          <button
            className="px-4 py-2 rounded-lg bg-cyan-500/10 border border-cyan-500/30 text-cyan-300 hover:text-white hover:border-cyan-400/70 transition-all flex items-center gap-2 text-sm font-bold"
            onClick={() => setShowApModal(true)}
          >
            <Wifi size={18} /> Add AP Controller
          </button>
        </div>
      </div>

      {/* ── Router Cards ── */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
        {routers?.map((r: any) => (
          <div key={r.id} className={`glass-panel flex flex-col overflow-hidden transition-all ${r.isOnline ? '' : 'opacity-75'}`}>
            <div className="p-5 pb-4 border-b border-white/5">
              <div className="flex items-start justify-between gap-3 mb-3">
                <div className="flex items-start gap-3 min-w-0">
                  <div className={`p-2 rounded-xl shrink-0 ${r.isOnline ? 'bg-green-500/10 text-green-400' : 'bg-slate-800 text-slate-500'}`}>
                    <RouterIcon size={20} />
                  </div>
                  <div className="min-w-0">
                    <h3 className="text-base font-bold text-main leading-tight truncate">{r.name}</h3>
                    <p className="text-xs text-muted font-mono mt-0.5">{r.host}:{r.port}</p>
                  </div>
                </div>
                <div className="flex flex-col items-end gap-1.5 shrink-0">
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider border ${r.isOnline ? 'bg-green-500/15 text-green-400 border-green-500/30' : 'bg-red-500/15 text-red-400 border-red-500/30'}`}>
                    {r.isOnline ? 'Online' : 'Offline'}
                  </span>
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider border ${r.connectionMode === 'pppoe' ? 'bg-purple-500/10 border-purple-400 text-purple-400' : 'bg-cyan-500/10 border-cyan-400 text-cyan-400'}`}>
                    {r.connectionMode === 'pppoe' ? 'PPPoE' : 'Hotspot'}
                  </span>
                  {r.isNated && (
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider border bg-orange-500/15 text-orange-400 border-orange-500/30 flex items-center gap-1">
                      <AlertCircle size={10} /> NAT
                    </span>
                  )}
                </div>
              </div>
            </div>

            <div className="p-5 flex flex-col gap-4 flex-1">
              <div className="bg-[var(--bg-main)]/50 rounded-xl p-3 border border-[var(--border-color)] space-y-1.5">
                <div className="flex justify-between items-center">
                  <span className="text-muted text-xs">API User</span>
                  <span className="font-mono text-cyan-400 text-xs font-semibold">{r.apiUsername}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-muted text-xs">Last Check</span>
                  <span className="text-main text-xs">{r.lastCheckedAt ? new Date(r.lastCheckedAt).toLocaleTimeString() : 'Never'}</span>
                </div>
              </div>

              {!r.isOnline && r.lastError && (
                <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/20 flex flex-col gap-1.5">
                  <div className="flex items-center gap-2 text-red-500 font-bold text-[10px] uppercase tracking-wider">
                    <AlertCircle size={12} />
                    Connection Failure Log
                  </div>
                  <span className="text-red-400 text-xs font-mono break-words leading-relaxed">{r.lastError}</span>
                </div>
              )}

              {r.isNated && (
                <div className="p-3 rounded-xl bg-orange-500/5 border border-orange-500/10 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-bold text-orange-400/70 uppercase tracking-widest">VPN Tunnel Info</span>
                    <span className="text-[10px] font-mono text-slate-500">{r.vpnIp || 'No IP assigned'}</span>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div className="bg-black/20 p-1.5 rounded border border-white/5">
                      <p className="text-[9px] text-slate-500 uppercase font-bold mb-0.5">User</p>
                      <p className="text-[10px] text-slate-300 font-mono truncate">{r.vpnUsername || '—'}</p>
                    </div>
                    <div className="bg-black/20 p-1.5 rounded border border-white/5 relative group">
                      <p className="text-[9px] text-slate-500 uppercase font-bold mb-0.5">Pass</p>
                      <div className="flex items-center justify-between gap-1">
                        <p className="text-[10px] text-slate-300 font-mono truncate">
                          {showCardPasswords[r.id] ? (r.vpnPasswordEncrypted || '••••••••') : '••••••••'}
                        </p>
                        <button 
                          onClick={() => toggleCardPassword(r.id)}
                          className="text-slate-500 hover:text-orange-400 transition-colors shrink-0"
                        >
                          {showCardPasswords[r.id] ? <EyeOff size={10} /> : <Eye size={10} />}
                        </button>
                      </div>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <button 
                      onClick={() => {
                        const vpnHost = vpnSettings?.host || window.location.hostname;
                        const script = `/interface sstp-client add name=pulselynk-vpn connect-to=${vpnHost} user=${r.vpnUsername} password=${r.vpnPasswordEncrypted} profile=default-encryption disabled=no;
/ip dhcp-client add interface=pulselynk-vpn disabled=no;`;
                        navigator.clipboard.writeText(script);
                        toast.success('MikroTik CLI Script copied!');
                      }}
                      className="flex-1 py-1.5 rounded-lg border border-orange-500/20 text-[10px] font-bold text-orange-400 hover:bg-orange-500/10 transition-colors flex items-center justify-center gap-1.5"
                    >
                      <Terminal size={10} /> Copy Script
                    </button>
                    <button 
                      onClick={() => {
                        const domain = vpnSettings?.host || window.location.hostname;
                        const text = `MikroTik SSTP VPN Config:\nServer: ${domain}\nUser: ${r.vpnUsername}\nPass: ${r.vpnPasswordEncrypted}\nMode: SSTP Client`;
                        navigator.clipboard.writeText(text);
                        toast.success('Credentials copied!');
                      }}
                      className="flex-1 py-1.5 rounded-lg border border-orange-500/20 text-[10px] font-bold text-orange-400 hover:bg-orange-500/10 transition-colors flex items-center justify-center gap-1.5"
                    >
                      <Copy size={10} /> Copy Credentials
                    </button>
                  </div>
                </div>
              )}

              {/* Profiles */}
              {r.isOnline && r.profiles && r.profiles.length > 0 && (
                <div>
                  <button className="w-full flex items-center justify-between text-[10px] font-bold text-muted uppercase tracking-wider mb-2 hover:text-main" onClick={() => toggleProfiles(r.id)}>
                    <span className="flex items-center gap-1.5">
                      <ShieldCheck size={11} className="text-cyan-500/70" />
                      Profiles ({r.profiles.length})
                    </span>
                    {expandedProfiles[r.id] ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                  </button>
                  {expandedProfiles[r.id] && (
                    <div className="flex flex-wrap gap-1.5">
                      {r.profiles.map((p: string) => (
                        <span key={p} className="px-2 py-0.5 rounded text-[10px] font-medium bg-slate-800 border border-slate-700/60 text-slate-300">{p}</span>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className="px-5 py-3 border-t border-white/5 flex items-center justify-between bg-black/10">
              <div className="flex gap-3">
                <button className="text-cyan-400 hover:text-cyan-300 text-xs font-semibold flex items-center gap-1" onClick={() => testMutation.mutate(r.id)} disabled={testMutation.isPending}>
                  <RefreshCw size={13} className={testMutation.isPending ? 'animate-spin' : ''} /> Test
                </button>
                <button className="text-slate-300 hover:text-white text-xs font-semibold flex items-center gap-1" onClick={() => openEditModal(r)}>
                  <Edit size={13} /> Edit
                </button>
              </div>
              <button 
                className="text-red-400 hover:text-red-300 text-xs font-semibold flex items-center gap-1" 
                onClick={() => setConfirmState({
                  isOpen: true,
                  title: 'Delete Router',
                  message: 'Are you sure you want to delete this router?',
                  onConfirm: () => { deleteMutation.mutate(r.id); setConfirmState(s => ({ ...s, isOpen: false })); }
                })}
              >
                <Trash2 size={13} /> Delete
              </button>
            </div>
          </div>
        ))}
        {routers?.length === 0 && (
          <div className="col-span-full text-center p-12 glass-panel text-muted">
            No routers added yet. Add your first MikroTik router to get started.
          </div>
        )}
      </div>

      {/* AP Controllers Section */}
      <div className="pt-4">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 mb-4">
          <div>
            <h3 className="text-lg font-bold flex items-center gap-2 text-main">
              <Wifi size={18} className="text-cyan-400" /> AP Controllers
            </h3>
            <p className="text-sm text-muted mt-0.5">
              Optional Wi-Fi client kick layer for captive portal reset after cancel or expiry.
            </p>
          </div>
          <button
            className="px-4 py-2 rounded-lg bg-cyan-500/10 border border-cyan-500/30 text-cyan-300 hover:text-white hover:border-cyan-400/70 transition-all flex items-center justify-center gap-2 text-sm font-bold"
            onClick={() => setShowApModal(true)}
          >
            <Wifi size={15} /> Add AP Controller
          </button>
        </div>

        {(accessPoints?.length || 0) > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {accessPoints?.map((ap: any) => {
              const capabilities = ap.capabilities || {};
              const kickMac = apKickMacs[ap.id] || '';
              const isTestingKick = testApKickMutation.isPending;
              return (
                <div key={ap.id} className="glass-panel overflow-hidden flex flex-col">
                  <div className="p-5 flex-1 space-y-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <h4 className="font-bold text-white leading-tight">{ap.name}</h4>
                        <p className="text-[11px] text-slate-500 font-mono uppercase mt-1">
                          {String(ap.provider || '').replace(/_/g, ' ')}
                        </p>
                      </div>
                      <span className={`text-[9px] font-black uppercase tracking-wider px-2 py-1 rounded border ${ap.isOnline ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30' : 'bg-slate-800 text-slate-500 border-slate-700'}`}>
                        {ap.isOnline ? 'Online' : 'Offline'}
                      </span>
                    </div>

                    <div className="rounded-xl bg-black/20 border border-white/5 p-3 space-y-2 text-xs">
                      <div className="flex items-center justify-between gap-3">
                        <span className="text-slate-500">Reachable At</span>
                        <span className="font-mono text-slate-200 truncate">
                          {(ap.isNated ? ap.vpnIp : ap.host) || 'Not set'}:{ap.port || 8728}
                        </span>
                      </div>
                      <div className="flex items-center justify-between gap-3">
                        <span className="text-slate-500">Driver</span>
                        <span className={`font-bold ${ap.provider === 'mikrotik_routeros' ? 'text-cyan-300' : 'text-amber-300'}`}>
                          {ap.provider === 'mikrotik_routeros' ? 'Active' : 'Registered fallback'}
                        </span>
                      </div>
                      <div className="flex items-center justify-between gap-3">
                        <span className="text-slate-500">Last Check</span>
                        <span className="font-mono text-slate-400">
                          {ap.lastCheckedAt ? new Date(ap.lastCheckedAt).toLocaleString() : 'Never'}
                        </span>
                      </div>
                    </div>

                    {ap.lastError && (
                      <div className="rounded-lg border border-red-500/20 bg-red-500/5 p-3 text-[11px] text-red-300 leading-relaxed">
                        {ap.lastError}
                      </div>
                    )}

                    {ap.provider === 'mikrotik_routeros' && (
                      <div className="flex flex-wrap gap-1.5">
                        {['wifi', 'wireless', 'caps-man'].map(key => (
                          <span
                            key={key}
                            className={`text-[10px] px-2 py-1 rounded-full border font-bold ${capabilities[key] ? 'bg-cyan-500/10 text-cyan-300 border-cyan-500/30' : 'bg-slate-800/60 text-slate-500 border-slate-700'}`}
                          >
                            {key}
                          </span>
                        ))}
                      </div>
                    )}

                    <div className="rounded-xl bg-cyan-500/[0.04] border border-cyan-500/10 p-3 space-y-2">
                      <label className="block text-[10px] font-black text-cyan-300 uppercase tracking-widest">Test Client Kick</label>
                      <div className="flex gap-2">
                        <input
                          className="min-w-0 flex-1 bg-slate-950/70 border border-slate-700 rounded-lg px-3 py-2 text-xs text-white font-mono focus:border-cyan-500 outline-none"
                          value={kickMac}
                          onChange={e => setApKickMacs(prev => ({ ...prev, [ap.id]: e.target.value }))}
                          placeholder="BE:6A:40:F0:54:7F"
                        />
                        <button
                          className="px-3 py-2 rounded-lg bg-cyan-500/10 border border-cyan-500/30 text-cyan-300 hover:text-white text-xs font-bold disabled:opacity-50"
                          disabled={!kickMac.trim() || isTestingKick}
                          onClick={() => testApKickMutation.mutate({ id: ap.id, mac: kickMac })}
                        >
                          Kick
                        </button>
                      </div>
                      <p className="text-[10px] text-slate-500">
                        Safe test only disconnects the matching Wi-Fi station if this controller sees it.
                      </p>
                    </div>
                  </div>

                  <div className="px-5 py-3 border-t border-white/5 bg-black/10 flex items-center justify-between">
                    <div className="flex gap-3">
                      <button className="text-cyan-400 hover:text-cyan-300 text-xs font-semibold flex items-center gap-1" onClick={() => testApMutation.mutate(ap.id)} disabled={testApMutation.isPending}>
                        <RefreshCw size={13} className={testApMutation.isPending ? 'animate-spin' : ''} /> Test
                      </button>
                      <button className="text-slate-300 hover:text-white text-xs font-semibold flex items-center gap-1" onClick={() => openEditApModal(ap)}>
                        <Edit size={13} /> Edit
                      </button>
                    </div>
                    <button
                      className="text-red-400 hover:text-red-300 text-xs font-semibold flex items-center gap-1"
                      onClick={() => setConfirmState({
                        isOpen: true,
                        title: 'Delete AP Controller',
                        message: 'Remove this AP controller from PulseLynk? Router hotspot auth will keep working; only the optional client-kick layer is removed.',
                        onConfirm: () => { deleteApMutation.mutate(ap.id); setConfirmState(s => ({ ...s, isOpen: false })); }
                      })}
                    >
                      <Trash2 size={13} /> Delete
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="glass-panel p-6 border border-dashed border-cyan-500/15 bg-cyan-500/[0.02]">
            <div className="flex items-start gap-3">
              <div className="p-2 rounded-xl bg-cyan-500/10 text-cyan-400">
                <Wifi size={18} />
              </div>
              <div>
                <p className="font-bold text-slate-200">No AP controllers configured yet.</p>
                <p className="text-sm text-slate-500 mt-1 max-w-3xl">
                  Your hEX gateway can still revoke access and clear bypasses. Add the actual Wi-Fi AP/controller here when you want cancel/expiry to also force the phone to reconnect without toggling Wi-Fi.
                </p>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Bandwidth Profiles Section */}
      <div ref={profilesRef} className="pt-4 scroll-mt-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-lg font-bold flex items-center gap-2 text-main">
              <Zap size={18} className="text-cyan-400" /> Bandwidth Profiles
            </h3>
            <p className="text-sm text-muted mt-0.5">Manage and assign profiles across your routers</p>
          </div>
          <button
            className="px-4 py-2 rounded-lg bg-gradient-to-r from-cyan-600/20 to-blue-600/20 border border-cyan-500/40 text-cyan-300 hover:text-white hover:border-cyan-400/70 transition-all flex items-center gap-2 text-sm font-bold"
            onClick={openCreateProfileModal}
          >
            <Zap size={15} className="text-cyan-400" /> Add Bandwidth Profile
          </button>
        </div>

        {profileRows.length > 0 ? (
          <div className="glass-panel overflow-hidden">
            <table className="w-full text-left border-collapse">
              <thead className="bg-[var(--bg-main)]/50 text-muted text-xs uppercase tracking-wide">
                <tr className="border-b border-[var(--border-color)]">
                  <th className="p-4 font-medium">#</th>
                  <th className="p-4 font-medium">Profile Name</th>
                  <th className="p-4 font-medium min-w-[300px]">Available On</th>
                  <th className="p-4 font-medium text-right">Coverage</th>
                  <th className="p-4 font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {profileRows.map((row, i) => (
                  <tr key={row.name} className="border-b border-white/4 last:border-0 hover:bg-white/[0.02] transition-colors align-top">
                    <td className="p-4 pt-5 text-slate-600 text-xs font-mono w-10">{String(i + 1).padStart(2, '0')}</td>
                    <td className="p-4 pt-5">
                      <div className="flex items-center gap-2">
                        <Signal size={13} className="text-cyan-500/70 shrink-0" />
                        <span className="font-mono font-semibold text-slate-100 text-sm whitespace-nowrap">{row.name}</span>
                      </div>
                    </td>
                    <td className="p-4 pt-4">
                      <div className="flex flex-wrap gap-1.5">
                        {row.routers.length > 0 ? row.routers.map(rname => (
                          <span key={rname} className="text-[11px] px-2 py-1 rounded-full bg-slate-800 border border-slate-700 text-slate-300 flex items-center gap-1.5 whitespace-nowrap">
                            <RouterIcon size={10} className="text-slate-400" /> {rname}
                          </span>
                        )) : (
                          <span className="text-xs text-slate-600 italic mt-1">Not assigned</span>
                        )}
                      </div>
                    </td>
                    <td className="p-4 pt-5 text-right whitespace-nowrap">
                      <span className={`text-xs font-bold ${row.routers.length === 0 ? 'text-slate-600' : row.routers.length === onlineCount ? 'text-green-400' : 'text-yellow-400'}`}>
                        {row.routers.length}/{onlineCount} routers
                      </span>
                    </td>
                    <td className="p-4 pt-4 text-right">
                       <button
                         className="inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-700 text-[11px] font-bold text-slate-300 hover:text-white hover:bg-slate-800 hover:border-slate-600 transition-all whitespace-nowrap"
                         onClick={() => openAssignModal(row.name)}
                       >
                         <UserPlus size={13} /> {row.routers.length === onlineCount ? 'Manage Sync' : 'Assign Routers'}
                       </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="flex justify-end p-3 border-t border-white/5">
              <button onClick={scrollToTop} className="flex items-center gap-1.5 text-xs text-slate-500 hover:text-slate-300 transition-colors">
                <ArrowUp size={13} /> Back to top
              </button>
            </div>
          </div>
        ) : (
          <div className="glass-panel p-8 text-center text-slate-500 text-sm">
            No profiles synced yet. Add your first bandwidth profile above to get started.
          </div>
        )}
      </div>

      {/* AP Controller Modal */}
      {showApModal && createPortal(
        <div
          className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[9999] flex flex-col items-center justify-center p-4"
          onMouseDown={(e) => { if (e.target === e.currentTarget) closeApModal(); }}
        >
          <div className="glass-panel w-full max-w-3xl animate-fade-in bg-slate-900 border border-slate-700 shadow-2xl rounded-2xl overflow-hidden flex flex-col">
            <div className="p-6 border-b border-white/10 flex items-center justify-between gap-4">
              <div>
                <h3 className="text-2xl font-bold text-white">
                  {editingApId ? 'Edit AP Controller' : 'Add AP Controller'}
                </h3>
                <p className="text-sm text-slate-500 mt-1">
                  Used only for optional Wi-Fi client reconnect after cancel or expiry.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setApFormData({ ...apFormData, isActive: !apFormData.isActive })}
                className={`px-3 py-1 text-xs font-bold rounded uppercase tracking-wider transition-colors border ${apFormData.isActive ? 'bg-green-500/20 text-green-400 border-green-500/30' : 'bg-slate-700 text-slate-400 border-slate-600'}`}
              >
                {apFormData.isActive ? 'Active' : 'Disabled'}
              </button>
            </div>

            <form onSubmit={handleApSubmit} className="p-6 overflow-y-auto max-h-[calc(90vh-140px)] custom-scrollbar">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="space-y-5">
                  <div>
                    <label className="block text-sm font-medium text-slate-300 mb-1.5">Controller Name</label>
                    <input
                      className="w-full bg-slate-800/50 border border-slate-700 rounded-lg p-3 text-white focus:ring-2 focus:ring-cyan-500 transition-all font-medium"
                      value={apFormData.name}
                      onChange={e => setApFormData({ ...apFormData, name: e.target.value })}
                      placeholder="Main Wi-Fi AP"
                      required
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-slate-300 mb-1.5">Controller Driver</label>
                    <select
                      className="w-full bg-slate-800/50 border border-slate-700 rounded-lg p-3 text-white focus:ring-2 focus:ring-cyan-500 transition-all"
                      value={apFormData.provider}
                      onChange={e => setApFormData({ ...apFormData, provider: e.target.value })}
                    >
                      <option value="mikrotik_routeros">MikroTik RouterOS (active)</option>
                      <option value="unifi">UniFi (registered fallback)</option>
                      <option value="omada">Omada (registered fallback)</option>
                      <option value="generic">Generic API (registered fallback)</option>
                    </select>
                    <p className="text-[11px] text-slate-500 mt-1">
                      MikroTik RouterOS is active now. Other drivers are stored safely until we wire their APIs.
                    </p>
                  </div>

                  <div className="p-4 rounded-xl bg-orange-500/5 border border-orange-500/20">
                    <div className="flex items-center justify-between mb-2">
                      <label className="text-sm font-bold text-orange-400 flex items-center gap-2">
                        <AlertCircle size={16} /> Controller is behind NAT?
                      </label>
                      <button
                        type="button"
                        onClick={() => setApFormData({ ...apFormData, isNated: !apFormData.isNated })}
                        className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none ${apFormData.isNated ? 'bg-orange-500' : 'bg-slate-700'}`}
                      >
                        <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${apFormData.isNated ? 'translate-x-6' : 'translate-x-1'}`} />
                      </button>
                    </div>
                    <p className="text-[11px] text-slate-500 leading-relaxed">
                      Enable if PulseLynk reaches this AP through the VPN instead of a public IP.
                    </p>
                  </div>
                </div>

                <div className="space-y-5">
                  <div className="flex gap-4">
                    <div className="flex-[3]">
                      <label className="block text-sm font-medium text-slate-300 mb-1.5">
                        {apFormData.isNated ? 'Public Host (optional)' : 'IP / Host'}
                      </label>
                      <input
                        className="w-full bg-slate-800/50 border border-slate-700 rounded-lg p-3 text-white focus:ring-2 focus:ring-cyan-500 transition-all font-medium font-mono"
                        value={apFormData.host}
                        onChange={e => setApFormData({ ...apFormData, host: e.target.value })}
                        placeholder="192.168.88.2"
                        required={!apFormData.isNated}
                      />
                    </div>
                    <div className="flex-1">
                      <label className="block text-sm font-medium text-slate-300 mb-1.5">Port</label>
                      <input
                        className="w-full bg-slate-800/50 border border-slate-700 rounded-lg p-3 text-white focus:ring-2 focus:ring-cyan-500 transition-all font-medium font-mono"
                        type="number"
                        min="1"
                        value={apFormData.port}
                        onChange={e => setApFormData({ ...apFormData, port: parseInt(e.target.value) || 8728 })}
                        required
                      />
                    </div>
                  </div>

                  {apFormData.isNated && (
                    <div>
                      <label className="block text-sm font-medium text-slate-300 mb-1.5">Reachable VPN IP</label>
                      <input
                        className="w-full bg-slate-800/50 border border-slate-700 rounded-lg p-3 text-white focus:ring-2 focus:ring-cyan-500 transition-all font-medium font-mono"
                        value={apFormData.vpnIp}
                        onChange={e => setApFormData({ ...apFormData, vpnIp: e.target.value })}
                        placeholder="10.8.0.51"
                        required={apFormData.isNated}
                      />
                    </div>
                  )}

                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-slate-300 mb-1.5">API Username</label>
                      <input
                        className="w-full bg-slate-800/50 border border-slate-700 rounded-lg p-3 text-white focus:ring-2 focus:ring-cyan-500 transition-all font-medium font-mono"
                        value={apFormData.apiUsername}
                        onChange={e => setApFormData({ ...apFormData, apiUsername: e.target.value })}
                        placeholder="admin"
                        required
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-slate-300 mb-1.5">API Password</label>
                      <div className="relative">
                        <input
                          className="w-full bg-slate-800/50 border border-slate-700 rounded-lg p-3 pr-12 text-white focus:ring-2 focus:ring-cyan-500 transition-all font-medium"
                          type={showApPassword ? 'text' : 'password'}
                          value={apFormData.apiPasswordEncrypted}
                          onChange={e => setApFormData({ ...apFormData, apiPasswordEncrypted: e.target.value })}
                          placeholder={editingApId ? 'Leave blank to keep' : '********'}
                          required={!editingApId}
                        />
                        <button type="button" onClick={() => setShowApPassword(!showApPassword)} className="absolute right-3 top-1/2 -translate-y-1/2 p-1.5 text-slate-500 hover:text-white transition-colors">
                          {showApPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                        </button>
                      </div>
                    </div>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-slate-300 mb-1.5">Notes</label>
                    <textarea
                      className="w-full bg-slate-800/50 border border-slate-700 rounded-lg p-3 text-white focus:ring-2 focus:ring-cyan-500 transition-all min-h-24"
                      value={apFormData.notes}
                      onChange={e => setApFormData({ ...apFormData, notes: e.target.value })}
                      placeholder="Where this AP lives, which SSID it serves, or controller notes."
                    />
                  </div>
                </div>
              </div>

              <div className="mt-6 p-4 rounded-xl bg-cyan-500/5 border border-cyan-500/10 text-xs text-cyan-200/70 leading-relaxed">
                This does not replace hotspot auth. It only gives PulseLynk a way to ask the AP/controller to reconnect a client after access has already been revoked.
              </div>

              <div className="flex justify-end gap-4 mt-8 pt-6 border-t border-white/5">
                <button type="button" className="px-6 py-2.5 rounded-lg font-bold text-slate-400 hover:text-white" onClick={closeApModal}>Cancel</button>
                <button
                  type="submit"
                  className="px-8 py-2.5 rounded-lg font-bold bg-gradient-to-r from-cyan-600 to-blue-600 text-white shadow-lg transition-all active:scale-95 disabled:opacity-60"
                  disabled={createApMutation.isPending || updateApMutation.isPending}
                >
                  {(createApMutation.isPending || updateApMutation.isPending) ? 'Saving...' : (editingApId ? 'Save AP Controller' : 'Add AP Controller')}
                </button>
              </div>
            </form>
          </div>
        </div>,
        document.body,
      )}

      {/* Add/Edit Router Modal */}
      {showModal && createPortal(
        <div 
          className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[9999] flex flex-col items-center justify-center p-4"
          onMouseDown={(e) => { if (e.target === e.currentTarget) closeModal(); }}
        >
          <div className="glass-panel w-full max-w-4xl animate-fade-in bg-slate-900 border border-slate-700 shadow-2xl rounded-2xl overflow-hidden flex flex-col">
            <h3 className="text-2xl font-bold p-6 text-white border-b border-white/10">
              {editingId ? 'Edit MikroTik Router' : 'Add MikroTik Router'}
            </h3>
            <form onSubmit={handleSubmit} className="p-6 overflow-y-auto max-h-[calc(90vh-140px)] custom-scrollbar">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                <div className="flex flex-col gap-6">
                  <div>
                    <label className="block text-sm font-medium text-slate-300 mb-1.5">Router Name</label>
                    <input className="w-full bg-slate-800/50 border border-slate-700 rounded-lg p-3 text-white focus:ring-2 focus:ring-cyan-500 transition-all font-medium" value={formData.name} onChange={e => setFormData({ ...formData, name: e.target.value })} placeholder="Main HQ Router" required />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-300 mb-3">Connection Mode</label>
                    <div className="grid grid-cols-2 gap-3">
                      <button type="button" onClick={() => setFormData({ ...formData, connectionMode: 'hotspot' })} className={`flex items-center justify-center gap-2 p-3.5 rounded-xl border transition-all ${formData.connectionMode === 'hotspot' ? 'bg-cyan-500/10 border-cyan-500 text-cyan-400' : 'bg-slate-800/50 border-slate-700 text-slate-500 hover:border-slate-600'}`}>
                        <Wifi size={18} /> <span className="text-sm font-bold">Public Hotspot</span>
                      </button>
                      <button type="button" onClick={() => setFormData({ ...formData, connectionMode: 'pppoe' })} className={`flex items-center justify-center gap-2 p-3.5 rounded-xl border transition-all ${formData.connectionMode === 'pppoe' ? 'bg-purple-500/10 border-purple-500 text-purple-400' : 'bg-slate-800/50 border-slate-700 text-slate-500 hover:border-slate-600'}`}>
                        <RouterIcon size={18} /> <span className="text-sm font-bold">Home Router</span>
                       </button>
                    </div>
                  </div>

                  {/* NAT Toggle */}
                  <div className="p-4 rounded-xl bg-orange-500/5 border border-orange-500/20">
                    <div className="flex items-center justify-between mb-2">
                       <label className="text-sm font-bold text-orange-400 flex items-center gap-2">
                         <AlertCircle size={16} /> Router is behind NAT?
                       </label>
                       <button
                         type="button"
                         onClick={() => setFormData({ ...formData, isNated: !formData.isNated })}
                         className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none ${formData.isNated ? 'bg-orange-500' : 'bg-slate-700'}`}
                       >
                         <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${formData.isNated ? 'translate-x-6' : 'translate-x-1'}`} />
                       </button>
                    </div>
                    <p className="text-[11px] text-slate-500 leading-relaxed">
                      Enable this if the router's IP is not publicly reachable. The router will connect to PulseLynk via VPN instead.
                    </p>
                  </div>
                </div>

                <div className="flex flex-col gap-6">
                  {formData.isNated ? (
                    <div className="space-y-4 animate-in fade-in slide-in-from-right-4 duration-300">
                      {/* API Credentials — always needed even for NATed routers */}
                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <label className="block text-sm font-medium text-slate-300 mb-1.5">API Username</label>
                          <input className="w-full bg-slate-800/50 border border-slate-700 rounded-lg p-3 text-white focus:ring-2 focus:ring-cyan-500 transition-all font-medium font-mono" value={formData.apiUsername} onChange={e => setFormData({ ...formData, apiUsername: e.target.value })} placeholder="Pulselynk" required />
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-slate-300 mb-1.5">API Password</label>
                          <div className="relative">
                            <input className="w-full bg-slate-800/50 border border-slate-700 rounded-lg p-3 pr-12 text-white focus:ring-2 focus:ring-cyan-500 transition-all font-medium" type={showPassword ? 'text' : 'password'} value={formData.apiPasswordEncrypted} onChange={e => setFormData({ ...formData, apiPasswordEncrypted: e.target.value })} placeholder={editingId ? 'Leave blank to keep' : '••••••••'} required={!editingId} />
                            <button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute right-3 top-1/2 -translate-y-1/2 p-1.5 text-slate-500 hover:text-white transition-colors">
                              {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                            </button>
                          </div>
                        </div>
                      </div>

                      <div className="p-4 rounded-xl bg-slate-800/50 border border-slate-700 space-y-4">
                        <h4 className="text-xs font-bold text-slate-300 uppercase tracking-widest flex items-center gap-2">
                          <ShieldCheck size={14} className="text-cyan-400" /> VPN Configuration
                        </h4>
                        
                        <div className="grid grid-cols-2 gap-4">
                          <div>
                            <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">VPN Username</label>
                            <input 
                              className="w-full bg-slate-900 border border-slate-700 rounded-lg p-2 text-xs text-white font-mono" 
                              value={formData.vpnUsername} 
                              onChange={e => setFormData({ ...formData, vpnUsername: e.target.value })} 
                              placeholder="router-01" 
                            />
                          </div>
                          <div>
                            <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">VPN Password</label>
                            <div className="relative">
                              <input 
                                className="w-full bg-slate-900 border border-slate-700 rounded-lg p-2 pr-8 text-xs text-white" 
                                type={showVpnPassword ? 'text' : 'password'}
                                value={formData.vpnPasswordEncrypted} 
                                onChange={e => setFormData({ ...formData, vpnPasswordEncrypted: e.target.value })} 
                                placeholder="••••••••" 
                              />
                              <button 
                                type="button" 
                                onClick={() => setShowVpnPassword(!showVpnPassword)}
                                className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-500 hover:text-white"
                              >
                                {showVpnPassword ? <EyeOff size={14} /> : <Eye size={14} />}
                              </button>
                            </div>
                          </div>
                        </div>

                        <div>
                          <div className="flex items-center justify-between mb-1">
                            <label className="block text-[10px] font-bold text-slate-500 uppercase">Static VPN IP (Assigned)</label>
                            <button 
                              type="button" 
                              onClick={async () => {
                                try {
                                  const res = await api.get('/routers/vpn/suggest-ip');
                                  setFormData({ ...formData, vpnIp: res.data.ip });
                                } catch (e) {
                                  toast.error('Failed to suggest IP');
                                }
                              }}
                              className="text-[10px] font-bold text-cyan-400 hover:text-cyan-300 transition-colors"
                            >
                              Suggest IP
                            </button>
                          </div>
                          <input 
                            className="w-full bg-slate-900 border border-slate-700 rounded-lg p-2 text-xs text-white font-mono" 
                            value={formData.vpnIp} 
                            onChange={e => setFormData({ ...formData, vpnIp: e.target.value })} 
                            placeholder="10.8.0.50" 
                          />
                          <p className="text-[10px] text-slate-500 mt-1 italic">PulseLynk will use this IP to reach the router once it's tunneled.</p>
                        </div>
                      </div>

                      <div className="p-3 rounded-lg bg-cyan-500/5 border border-cyan-500/20 text-[11px] text-cyan-400/80 italic">
                        <strong>Client Setup:</strong> Provide the VPN server address, username, and password to your client to configure their MikroTik SSTP client.
                      </div>
                    </div>
                  ) : (
                    <>
                      <div className="flex gap-4">
                        <div className="flex-[3]">
                          <label className="block text-sm font-medium text-slate-300 mb-1.5">IP / Host (Public)</label>
                          <input className="w-full bg-slate-800/50 border border-slate-700 rounded-lg p-3 text-white focus:ring-2 focus:ring-cyan-500 transition-all font-medium font-mono" value={formData.host} onChange={e => setFormData({ ...formData, host: e.target.value })} placeholder="1.2.3.4" required={!formData.isNated} />
                        </div>
                        <div className="flex-1">
                          <label className="block text-sm font-medium text-slate-300 mb-1.5">Port</label>
                          <input className="w-full bg-slate-800/50 border border-slate-700 rounded-lg p-3 text-white focus:ring-2 focus:ring-cyan-500 transition-all font-medium font-mono" type="number" value={formData.port} onChange={e => setFormData({ ...formData, port: parseInt(e.target.value) })} required />
                        </div>
                      </div>
                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <label className="block text-sm font-medium text-slate-300 mb-1.5">API Username</label>
                          <input className="w-full bg-slate-800/50 border border-slate-700 rounded-lg p-3 text-white focus:ring-2 focus:ring-cyan-500 transition-all font-medium font-mono" value={formData.apiUsername} onChange={e => setFormData({ ...formData, apiUsername: e.target.value })} placeholder="admin" required />
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-slate-300 mb-1.5">API Password</label>
                          <div className="relative">
                            <input className="w-full bg-slate-800/50 border border-slate-700 rounded-lg p-3 pr-12 text-white focus:ring-2 focus:ring-cyan-500 transition-all font-medium" type={showPassword ? 'text' : 'password'} value={formData.apiPasswordEncrypted} onChange={e => setFormData({ ...formData, apiPasswordEncrypted: e.target.value })} placeholder={editingId ? 'Leave blank to keep' : '••••••••'} required={!editingId} />
                            <button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute right-3 top-1/2 -translate-y-1/2 p-1.5 text-slate-500 hover:text-white transition-colors">
                              {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                            </button>
                          </div>
                        </div>
                      </div>
                    </>
                  )}
                </div>
              </div>
              <div className="flex justify-end gap-4 mt-8 pt-6 border-t border-white/5">
                <button type="button" className="px-6 py-2.5 rounded-lg font-bold text-slate-400 hover:text-white" onClick={closeModal}>Cancel</button>
                <button type="submit" className="px-8 py-2.5 rounded-lg font-bold bg-gradient-to-r from-cyan-600 to-blue-600 text-white shadow-lg transition-all active:scale-95" disabled={createMutation.isPending || updateMutation.isPending}>
                  {(createMutation.isPending || updateMutation.isPending) ? 'Saving...' : (editingId ? 'Save Changes' : 'Add Router')}
                </button>
              </div>
            </form>
          </div>
        </div>,
        document.body,
      )}

      {/* ── Bandwidth Profile Sync Modal ── */}
      {showProfileModal && createPortal(
        <div 
          className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[9999] flex flex-col items-center justify-center p-4"
          onMouseDown={(e) => { if (e.target === e.currentTarget) setShowProfileModal(false); }}
        >
          <div className="glass-panel p-6 w-full max-w-lg bg-slate-900 border border-slate-700 shadow-2xl rounded-2xl flex flex-col max-h-[95vh]">
            <div className="flex items-start justify-between gap-3 mb-6 border-b border-white/10 pb-4 shrink-0">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-cyan-500/10 text-cyan-400"><Zap size={20} /></div>
                <h3 className="text-xl font-bold text-white">
                  {profileData.isAssignOnly ? `Assign Profile: ${profileData.name}` : 'Add Bandwidth Profile'}
                </h3>
              </div>
            </div>
            
            <form onSubmit={(e) => { 
                e.preventDefault(); 
                syncProfileMutation.mutate({ 
                  name: profileData.name, 
                  rateLimit: `${profileData.uploadLimit}/${profileData.downloadLimit}`,
                  routerIds: profileData.routerIds 
                }); 
              }} 
              className="flex flex-col gap-6 overflow-hidden"
            >
              <div className="overflow-y-auto custom-scrollbar flex flex-col gap-6 pr-2">
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-1.5">Profile Name</label>
                  <input className="w-full bg-slate-800/50 border border-slate-700 rounded-lg p-3 text-white focus:ring-2 focus:ring-cyan-500 transition-all font-medium font-mono" value={profileData.name} onChange={e => setProfileData({ ...profileData, name: e.target.value })} placeholder="e.g. 5Mbps_Home" required disabled={profileData.isAssignOnly} />
                  {!profileData.isAssignOnly && <p className="text-[10px] text-slate-500 mt-1 italic">Creates a new profile on the selected routers.</p>}
                  {profileData.isAssignOnly && <p className="text-[10px] text-slate-500 mt-1 italic">You are re-syncing an existing profile. Provide the limits again below.</p>}
                </div>
                
                <div className="flex gap-4">
                  <div className="flex-1">
                    <label className="block text-sm font-medium text-slate-300 mb-1.5">New Upload Limit</label>
                    <input className="w-full bg-slate-800/50 border border-slate-700 rounded-lg p-3 text-white focus:ring-2 focus:ring-cyan-500 transition-all font-medium font-mono" value={profileData.uploadLimit} onChange={e => setProfileData({ ...profileData, uploadLimit: e.target.value })} placeholder="2M" required />
                  </div>
                  <div className="flex-1">
                    <label className="block text-sm font-medium text-slate-300 mb-1.5">New Download Limit</label>
                    <input className="w-full bg-slate-800/50 border border-slate-700 rounded-lg p-3 text-white focus:ring-2 focus:ring-cyan-500 transition-all font-medium font-mono" value={profileData.downloadLimit} onChange={e => setProfileData({ ...profileData, downloadLimit: e.target.value })} placeholder="5M" required />
                  </div>
                </div>

                {/* Router Assignment Section */}
                <div className="border border-white/5 rounded-xl bg-slate-800/30 overflow-hidden">
                  <div className="p-3 border-b border-white/5 flex items-center justify-between bg-slate-800/50">
                    <label className="text-sm font-bold text-white flex items-center gap-2">
                      <RouterIcon size={14} className="text-cyan-400" /> Target Routers
                    </label>
                    <div className="flex items-center gap-2 text-xs">
                      <button type="button" onClick={selectAllRouters} className="text-cyan-400 hover:underline">Select All</button>
                      <span className="text-slate-600">|</span>
                      <button type="button" onClick={selectNoRouters} className="text-slate-400 hover:text-white hover:underline">Clear</button>
                    </div>
                  </div>
                  <div className="p-2 max-h-48 overflow-y-auto custom-scrollbar flex flex-col gap-1">
                    {onlineRouters.length === 0 ? (
                      <div className="p-4 text-center text-xs text-slate-500">No online routers available.</div>
                    ) : (
                      onlineRouters.map((r: any) => {
                        const isSelected = profileData.routerIds.includes(r.id);
                        return (
                          <label 
                            key={r.id} 
                            onClick={(e) => {
                              e.preventDefault();
                              toggleRouterSelection(r.id);
                            }}
                            className={`flex items-center gap-3 p-2.5 rounded-lg cursor-pointer transition-colors border ${isSelected ? 'bg-cyan-500/10 border-cyan-500/30' : 'hover:bg-slate-800/80 border-transparent'}`}
                          >
                            <div className={`p-0.5 rounded shadow-sm ${isSelected ? 'text-cyan-400' : 'text-slate-600'}`}>
                              {isSelected ? <CheckSquare size={16} /> : <Square size={16} />}
                            </div>
                            <div className="flex flex-col">
                              <span className={`text-sm font-medium ${isSelected ? 'text-white' : 'text-slate-300'}`}>{r.name}</span>
                              <span className="text-[10px] font-mono text-slate-500 uppercase">{r.connectionMode}</span>
                            </div>
                          </label>
                        );
                      })
                    )}
                  </div>
                </div>
              </div>

              <div className="flex justify-end gap-3 pt-4 border-t border-white/5 shrink-0">
                <button type="button" className="px-5 py-2.5 rounded-lg font-bold text-slate-400 hover:text-white hover:bg-slate-800 transition-colors" onClick={() => setShowProfileModal(false)}>Cancel</button>
                <button type="submit" className="px-6 py-2.5 rounded-lg font-bold bg-gradient-to-r from-cyan-600 to-blue-600 text-white shadow-lg disabled:opacity-50 hover:from-cyan-500 hover:to-blue-500 transition-all flex items-center gap-2" disabled={syncProfileMutation.isPending || profileData.routerIds.length === 0}>
                  {syncProfileMutation.isPending ? 'Syncing...' : `Sync to ${profileData.routerIds.length} Router${profileData.routerIds.length === 1 ? '' : 's'}`}
                </button>
              </div>
            </form>
          </div>
        </div>,
        document.body,
      )}

      <ConfirmModal
        isOpen={confirmState.isOpen}
        title={confirmState.title}
        message={confirmState.message}
        onConfirm={confirmState.onConfirm}
        onCancel={() => setConfirmState(s => ({ ...s, isOpen: false }))}
        isLoading={deleteMutation.isPending || deleteApMutation.isPending}
      />
    </div>
  );
}
