import { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import {
  Router as RouterIcon, Wifi, WifiOff,
  RefreshCw, Plus, Edit, Trash2, Eye, EyeOff, ShieldCheck,
  AlertCircle, Signal, ChevronDown, ChevronUp, Zap, ArrowUp, UserPlus, CheckSquare, Square
} from 'lucide-react';
import api from '../../services/api';
import { ConfirmModal } from '../../components/ConfirmModal';

export default function Routers() {
  const queryClient = useQueryClient();
  const profilesRef = useRef<HTMLDivElement>(null);

  const [showModal, setShowModal] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [expandedProfiles, setExpandedProfiles] = useState<Record<string, boolean>>({});
  
  const [formData, setFormData] = useState({ name: '', host: '', apiUsername: '', apiPasswordEncrypted: '', port: 8728, connectionMode: 'hotspot' });
  const [confirmState, setConfirmState] = useState<{ isOpen: boolean; title: string; message: string; onConfirm: () => void }>({ isOpen: false, title: '', message: '', onConfirm: () => {} });
  
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

  const { data: allProfiles } = useQuery<string[]>({
    queryKey: ['available-profiles'],
    queryFn: () => api.get('/routers/sync/all-profiles').then(res => res.data),
    refetchInterval: 60000,
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

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (editingId) updateMutation.mutate(formData);
    else createMutation.mutate(formData);
  };

  const openEditModal = (r: any) => {
    setEditingId(r.id);
    setFormData({ name: r.name, host: r.host, apiUsername: r.apiUsername, apiPasswordEncrypted: r.apiPasswordEncrypted || '', port: r.port, connectionMode: r.connectionMode || 'hotspot' });
    setShowModal(true);
  };

  const closeModal = () => {
    setShowModal(false);
    setEditingId(null);
    setShowPassword(false);
    setFormData({ name: '', host: '', apiUsername: '', apiPasswordEncrypted: '', port: 8728, connectionMode: 'hotspot' });
  };

  const toggleProfiles = (id: string) => setExpandedProfiles(p => ({ ...p, [id]: !p[id] }));
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
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider border ${r.connectionMode === 'pppoe' ? 'bg-purple-500/10 border-purple-500/40 text-purple-400' : 'bg-cyan-500/10 border-cyan-500/40 text-cyan-400'}`}>
                    {r.connectionMode === 'pppoe' ? 'PPPoE' : 'Hotspot'}
                  </span>
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

      {/* ── Bandwidth Profiles Section ── */}
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

      {/* ── Add/Edit Router Modal ── */}
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
                </div>
                <div className="flex flex-col gap-6">
                  <div className="flex gap-4">
                    <div className="flex-[3]">
                      <label className="block text-sm font-medium text-slate-300 mb-1.5">IP / Host</label>
                      <input className="w-full bg-slate-800/50 border border-slate-700 rounded-lg p-3 text-white focus:ring-2 focus:ring-cyan-500 transition-all font-medium font-mono" value={formData.host} onChange={e => setFormData({ ...formData, host: e.target.value })} placeholder="192.168.88.1" required />
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
        isLoading={deleteMutation.isPending}
      />
    </div>
  );
}
