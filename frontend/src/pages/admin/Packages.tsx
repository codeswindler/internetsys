import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { Plus, Trash2, Edit } from 'lucide-react';
import api from '../../services/api';
import { ConfirmModal } from '../../components/ConfirmModal';

export default function Packages() {
  const queryClient = useQueryClient();
  const [showModal, setShowModal] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [confirmState, setConfirmState] = useState<{ isOpen: boolean; title: string; message: string; onConfirm: () => void }>({ isOpen: false, title: '', message: '', onConfirm: () => {} });
  
  const [formData, setFormData] = useState({ 
    name: '', durationType: 'hours', durationValue: 1, price: 0, bandwidthProfile: 'default', dataLimitMB: 0, isActive: true,
    downloadSpeed: '', uploadSpeed: '', maxDevices: 1
  });


  useEffect(() => {
    if (formData.bandwidthProfile) {
      if (formData.bandwidthProfile === 'default') {
        setFormData(prev => ({ ...prev, downloadSpeed: 'Unlimited', uploadSpeed: 'Unlimited' }));
        return;
      }
      
      const bProfile = formData.bandwidthProfile.toUpperCase();
      // Test Rx/Tx like 5M/10M
      const rxTxMatch = bProfile.match(/(\d+)[A-Z]*\/(\d+)[A-Z]*/);
      if (rxTxMatch) {
        setFormData(prev => ({ ...prev, uploadSpeed: `${rxTxMatch[1]} Mbps`, downloadSpeed: `${rxTxMatch[2]} Mbps` }));
        return;
      }
      
      // Test single speed like 10Mbps_Home
      const singleMatch = bProfile.match(/(\d+)(M|MBPS)/);
      if (singleMatch) {
        const speed = `${singleMatch[1]} Mbps`;
        setFormData(prev => ({ ...prev, downloadSpeed: speed, uploadSpeed: speed }));
      }
    }
  }, [formData.bandwidthProfile]);

  const { data: packages, isLoading } = useQuery({
    queryKey: ['packages', 'all'],
    queryFn: () => api.get('/packages/all').then(res => res.data),
  });

  const { data: availableProfiles } = useQuery<string[]>({
    queryKey: ['mikrotik-profiles'],
    queryFn: () => api.get('/routers/sync/all-profiles').then(res => res.data),
    enabled: showModal,
  });

  const createMutation = useMutation({
    mutationFn: (newPackage: any) => api.post('/packages', newPackage),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['packages', 'all'] });
      closeModal();
      toast.success('Package added successfully');
    },
    onError: () => toast.error('Failed to create package'),
  });

  const updateMutation = useMutation({
    mutationFn: (updatedPackage: any) => api.put(`/packages/${editingId}`, updatedPackage),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['packages', 'all'] });
      closeModal();
      toast.success('Package updated successfully');
    },
    onError: () => toast.error('Failed to update package'),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/packages/${id}`),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['packages', 'all'] });
      if (res.data?.action === 'archived') {
        toast.success('Package archived and hidden from users');
      } else {
        toast.success('Unused package deleted');
      }
    },
    onError: (err: any) => toast.error(err.response?.data?.message || 'Failed to archive package'),
  });

  const openEditModal = (pkg: any) => {
    setEditingId(pkg.id);
    setFormData({
      name: pkg.name,
      durationType: pkg.durationType,
      durationValue: pkg.durationValue,
      price: pkg.price,
      bandwidthProfile: pkg.bandwidthProfile,
      dataLimitMB: pkg.dataLimitMB,
      isActive: pkg.isActive,
      downloadSpeed: pkg.downloadSpeed || '',
      uploadSpeed: pkg.uploadSpeed || '',
      maxDevices: pkg.maxDevices || 1
    });

    setShowModal(true);
  };

  const closeModal = () => {
    setShowModal(false);
    setEditingId(null);
    setFormData({ 
      name: '', durationType: 'hours', durationValue: 1, price: 0, bandwidthProfile: 'default', dataLimitMB: 0, isActive: true,
      downloadSpeed: '', uploadSpeed: '', maxDevices: 1
    });

  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (editingId) {
      updateMutation.mutate(formData);
    } else {
      createMutation.mutate(formData);
    }
  };

  if (isLoading) return <div className="p-8">Loading packages...</div>;

  return (
    <div>
      <div className="flex justify-between items-center mb-6">
        <h2 className="text-2xl font-bold">Manage Packages</h2>
        <button className="btn-primary flex items-center gap-2" onClick={() => setShowModal(true)}>
          <Plus size={18} /> New Package
        </button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
        {packages?.map((pkg: any) => (
          <div key={pkg.id} className="glass-panel p-4 flex flex-col relative overflow-hidden transition-all hover:border-white/10">
            <div className="flex justify-between items-start mb-1.5">
              <h3 className="text-base font-bold text-white leading-tight">{pkg.name}</h3>
              <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-sm uppercase tracking-wider border shrink-0 ml-2 ${pkg.isActive ? 'bg-green-500/10 text-green-400 border-green-500/30' : 'bg-red-500/10 text-red-400 border-red-500/30'}`}>
                {pkg.isActive ? 'Active' : 'Hidden'}
              </span>
            </div>
            
            <p className="text-xl font-bold text-cyan-400 mb-3 flex items-baseline gap-1">
              <span className="text-xs text-cyan-500 uppercase tracking-widest">KES</span>
              {pkg.price}
              <span className="text-[10px] font-normal text-slate-400">/{pkg.durationValue}{pkg.durationType.charAt(0)}</span>
            </p>

            <div className="bg-black/20 p-2.5 rounded-lg text-xs text-slate-300 mb-4 flex flex-col gap-1.5 border border-white/5">
              <div className="flex justify-between items-center">
                <span className="text-slate-500">Profile</span>
                <span className="font-mono text-cyan-300">{pkg.bandwidthProfile}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-slate-500">Data Limit</span>
                <span className="font-semibold text-white">{pkg.dataLimitMB === 0 ? 'Unlimited' : `${pkg.dataLimitMB} MB`}</span>
              </div>
               <div className="flex justify-between items-center">
                <span className="text-slate-500">Devices</span>
                <span className="font-semibold text-white">{pkg.maxDevices || 1} Device(s)</span>
              </div>
              <div className="flex justify-between items-center border-t border-white/5 pt-1.5 mt-1.5">
                <span className="text-slate-500">Speed</span>
                <span className="font-bold text-cyan-400 text-[10px]">
                  {pkg.downloadSpeed ? `${pkg.downloadSpeed} ↓` : 'N/A'} {pkg.uploadSpeed ? `/ ${pkg.uploadSpeed} ↑` : ''}
                </span>
              </div>

            </div>

            <div className="mt-auto pt-3 border-t border-white/5 flex justify-between items-center">
              <button 
                className="text-cyan-400 hover:text-cyan-300 text-[11px] font-bold uppercase tracking-wider flex items-center gap-1.5 transition-colors"
                onClick={() => openEditModal(pkg)}
              >
                <Edit size={12} /> Edit
              </button>
              <button 
                className="text-red-400 hover:text-red-300 text-[11px] font-bold uppercase tracking-wider flex items-center gap-1.5 transition-colors"
                onClick={() => setConfirmState({
                  isOpen: true,
                  title: 'Archive Package',
                  message: 'Archive this package? It will be hidden from users, while old subscriptions, vouchers, and transactions stay intact.',
                  onConfirm: () => { deleteMutation.mutate(pkg.id); setConfirmState(s => ({ ...s, isOpen: false })); }
                })}
              >
                <Trash2 size={12} /> Archive
              </button>
            </div>
          </div>
        ))}
      </div>

      {showModal && createPortal(
        <div 
          className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[9999] flex flex-col items-center justify-center p-4"
          onMouseDown={(e) => { if (e.target === e.currentTarget) closeModal(); }}
        >
          <div className="glass-panel w-full max-w-4xl animate-fade-in relative z-[10000] bg-slate-900 border border-slate-700 shadow-2xl rounded-2xl overflow-hidden flex flex-col">
            <div className="flex items-center justify-between p-6 border-b border-white/10">
              <h3 className="text-2xl font-bold text-white">
                {editingId ? 'Edit Package' : 'Create Subscription Package'}
              </h3>
              <div className="flex items-center gap-3 bg-slate-800/50 p-1.5 rounded-lg border border-slate-700">
                <label className="text-sm font-medium text-slate-300 ml-2">Visibility</label>
                <button 
                  type="button" 
                  onClick={() => setFormData({ ...formData, isActive: !formData.isActive })}
                  className={`px-3 py-1 text-xs font-bold rounded uppercase tracking-wider transition-colors ${formData.isActive ? 'bg-green-500/20 text-green-400 border border-green-500/30' : 'bg-slate-700 text-slate-400 border border-slate-600'}`}
                >
                  {formData.isActive ? 'Active (Visible)' : 'Hidden'}
                </button>
              </div>
            </div>
            
            <form onSubmit={handleSubmit} className="p-6 overflow-y-auto max-h-[calc(90vh-140px)] custom-scrollbar">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                {/* Left Column: Basic Info */}
                <div className="flex flex-col gap-6">
                  <div>
                    <label className="block text-sm font-medium text-slate-300 mb-2">Package Name</label>
                    <input className="w-full bg-slate-800/50 border border-slate-700 rounded-lg p-3 text-white focus:ring-2 focus:ring-cyan-500 transition-all font-medium" value={formData.name} onChange={e => setFormData({...formData, name: e.target.value})} placeholder="e.g. 1 Hour Unlimited" required />
                  </div>

                  <div className="flex gap-4">
                    <div className="flex-1">
                      <label className="block text-sm font-medium text-slate-300 mb-2">Price (KES)</label>
                      <input className="w-full bg-slate-800/50 border border-slate-700 rounded-lg p-3 text-white focus:ring-2 focus:ring-cyan-500 transition-all font-medium" type="number" min="0" value={formData.price} onChange={e => setFormData({...formData, price: parseFloat(e.target.value)})} required />
                    </div>
                    <div className="flex-1">
                      <label className="block text-sm font-medium text-slate-300 mb-2">Data Limit (MB)</label>
                      <input className="w-full bg-slate-800/50 border border-slate-700 rounded-lg p-3 text-white focus:ring-2 focus:ring-cyan-500 transition-all font-medium" type="number" min="0" value={formData.dataLimitMB} onChange={e => setFormData({...formData, dataLimitMB: parseInt(e.target.value)})} placeholder="0 for unlimited" required />
                    </div>
                  </div>

                  <div className="p-4 bg-cyan-500/5 border border-cyan-500/10 rounded-xl">
                    <h4 className="text-xs font-bold text-cyan-400 uppercase tracking-wider mb-4">Duration Settings</h4>
                    <div className="flex gap-4">
                      <div className="flex-1">
                        <label className="block text-xs font-medium text-slate-400 mb-1.5">Unit</label>
                        <select className="w-full bg-slate-800 border border-slate-600 rounded-lg p-2.5 text-white focus:ring-2 focus:ring-cyan-500 transition-all text-sm" value={formData.durationType} onChange={e => setFormData({...formData, durationType: e.target.value})}>
                          <option value="minutes">Minutes</option>
                          <option value="hours">Hours</option>
                          <option value="days">Days</option>
                          <option value="weeks">Weeks</option>
                          <option value="months">Months</option>
                        </select>
                      </div>
                      <div className="flex-1">
                        <label className="block text-xs font-medium text-slate-400 mb-1.5">Value</label>
                        <input className="w-full bg-slate-800 border border-slate-600 rounded-lg p-2.5 text-white focus:ring-2 focus:ring-cyan-500 transition-all text-sm" type="number" min="1" value={formData.durationValue} onChange={e => setFormData({...formData, durationValue: parseInt(e.target.value)})} required />
                      </div>
                    </div>
                  </div>

                  <div>
                     <label className="block text-sm font-medium text-slate-300 mb-2">Max Devices (Concurrent)</label>
                     <input className="w-full bg-slate-800/50 border border-slate-700 rounded-lg p-3 text-white focus:ring-2 focus:ring-cyan-500 transition-all font-medium" type="number" min="1" value={formData.maxDevices} onChange={e => setFormData({...formData, maxDevices: parseInt(e.target.value)})} required />
                     <p className="text-[10px] text-slate-500 mt-1">Number of unique devices that can use this plan at the same time.</p>
                  </div>


                  <div className="p-4 bg-cyan-500/5 border border-cyan-500/10 rounded-xl relative overflow-hidden">
                    <div className="absolute top-0 right-0 -mr-4 -mt-4 w-20 h-20 bg-cyan-500/10 blur-2xl pointer-events-none rounded-full"></div>
                    <div className="flex justify-between items-center mb-4">
                      <h4 className="text-xs font-bold text-cyan-400 uppercase tracking-wider">Marketing Speeds</h4>
                      <span className="text-[9px] uppercase tracking-wider bg-cyan-500/20 text-cyan-400 px-2 py-0.5 rounded border border-cyan-500/30">Auto-Derived</span>
                    </div>
                    <div className="flex gap-4">
                      <div className="flex-1">
                        <label className="block text-xs font-medium text-slate-400 mb-1.5">Download</label>
                        <input className="w-full bg-slate-900 border border-slate-700/50 rounded-lg p-2.5 text-cyan-300 font-bold focus:outline-none text-sm cursor-not-allowed" value={formData.downloadSpeed || 'N/A'} readOnly title="Auto-derived from Bandwidth Profile" />
                      </div>
                      <div className="flex-1">
                        <label className="block text-xs font-medium text-slate-400 mb-1.5">Upload</label>
                        <input className="w-full bg-slate-900 border border-slate-700/50 rounded-lg p-2.5 text-cyan-300 font-bold focus:outline-none text-sm cursor-not-allowed" value={formData.uploadSpeed || 'N/A'} readOnly title="Auto-derived from Bandwidth Profile" />
                      </div>
                    </div>
                    <p className="text-[10px] text-cyan-200/50 mt-3 flex items-center gap-1.5">
                      <span className="w-1.5 h-1.5 rounded-full bg-cyan-500/50 block"></span>
                      Display speeds for the user dashboard are extracted from the Profile name.
                    </p>
                  </div>
                </div>

                {/* Right Column: Network Profile */}
                <div className="flex flex-col gap-6">
                  <div>
                    <label className="block text-sm font-medium text-slate-300 mb-2">Bandwidth Profile (MikroTik)</label>
                    <input className="w-full bg-slate-800/50 border border-slate-700 rounded-lg p-3 text-white focus:ring-2 focus:ring-cyan-500 transition-all font-mono text-sm" value={formData.bandwidthProfile} onChange={e => setFormData({...formData, bandwidthProfile: e.target.value})} placeholder="e.g. default" required />
                    
                    {availableProfiles && availableProfiles.length > 0 && (
                      <div className="mt-4 bg-slate-800/30 rounded-xl p-4 border border-slate-700/50">
                        <p className="text-xs text-slate-400 mb-3 font-medium flex items-center gap-2">
                          <span className="w-1.5 h-1.5 bg-cyan-500 rounded-full animate-pulse"></span>
                          Available profiles from online routers:
                        </p>
                        <div className="flex flex-wrap gap-2 max-h-32 overflow-y-auto pr-1 custom-scrollbar">
                          {availableProfiles.map(p => (
                            <button
                              key={p}
                              type="button"
                              onClick={() => setFormData({...formData, bandwidthProfile: p})}
                              className={`px-3 py-1.5 text-xs font-mono rounded-md transition-all border ${formData.bandwidthProfile === p ? 'bg-cyan-500/20 text-cyan-400 border-cyan-500/40 ring-1 ring-cyan-500/30' : 'bg-slate-800 text-slate-400 border-slate-700 hover:bg-slate-700 hover:text-white'}`}
                            >
                              {p}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}

                    <div className="mt-4 p-3 bg-amber-500/5 border border-amber-500/10 rounded-lg">
                      <p className="text-[11px] text-amber-200/60 leading-relaxed italic">
                        Must match the exact name of a Profile configured on your MikroTik router. This controls bandwidth limits for users on this plan.
                      </p>
                    </div>
                  </div>
                </div>
              </div>

              <div className="flex justify-end gap-4 mt-8 pt-6 border-t border-white/5">
                <button type="button" className="px-6 py-2.5 rounded-lg font-bold text-slate-400 hover:text-white hover:bg-slate-800 transition-all" onClick={closeModal}>Cancel</button>
                <button type="submit" className="px-8 py-2.5 rounded-lg font-bold bg-gradient-to-r from-cyan-600 to-blue-600 text-white hover:from-cyan-500 hover:to-blue-500 shadow-lg shadow-cyan-900/20 transition-all transform active:scale-95 flex items-center gap-2" disabled={createMutation.isPending || updateMutation.isPending}>
                  {createMutation.isPending || updateMutation.isPending ? 'Saving...' : (editingId ? 'Save Changes' : 'Save Package')}
                </button>
              </div>
            </form>
          </div>
        </div>, document.body
      )}

      <ConfirmModal
        isOpen={confirmState.isOpen}
        title={confirmState.title}
        message={confirmState.message}
        confirmText="Archive"
        onConfirm={confirmState.onConfirm}
        onCancel={() => setConfirmState(s => ({ ...s, isOpen: false }))}
        isLoading={deleteMutation.isPending}
      />
    </div>
  );
}
