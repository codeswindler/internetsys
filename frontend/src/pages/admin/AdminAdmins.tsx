import { useState } from 'react';
import { createPortal } from 'react-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import axios from 'axios';
import toast from 'react-hot-toast';
import { 
  Shield, Plus, Trash2, Edit2, Lock, Phone, Mail,
  CheckCircle2, XCircle, Key, AlertTriangle, RefreshCw
} from 'lucide-react';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000';

// Premium Confirmation Modal
function ConfirmDialog({ 
  open, title, message, confirmLabel, variant = 'danger',
  onConfirm, onCancel, loading 
}: {
  open: boolean; title: string; message: string; confirmLabel: string;
  variant?: 'danger' | 'warning' | 'info'; onConfirm: () => void;
  onCancel: () => void; loading?: boolean;
}) {
  if (!open) return null;
  const colors = {
    danger: { bg: 'bg-red-500/10', border: 'border-red-500/30', icon: 'text-red-400', btn: 'bg-red-500 hover:bg-red-400' },
    warning: { bg: 'bg-amber-500/10', border: 'border-amber-500/30', icon: 'text-amber-400', btn: 'bg-amber-500 hover:bg-amber-400' },
    info: { bg: 'bg-cyan-500/10', border: 'border-cyan-500/30', icon: 'text-cyan-400', btn: 'bg-cyan-500 hover:bg-cyan-400' },
  }[variant];

  return createPortal(
    <div className="fixed inset-0 z-[10010] flex items-center justify-center p-4" style={{ backdropFilter: 'blur(24px)', backgroundColor: 'rgba(5,10,25,0.85)' }}>
      <div className="w-full max-w-sm rounded-[2rem] border border-white/10 bg-slate-900 shadow-2xl p-8 flex flex-col items-center gap-5 animate-scale-in">
        <div className={`w-16 h-16 rounded-2xl ${colors.bg} border ${colors.border} flex items-center justify-center`}>
          <AlertTriangle size={30} className={colors.icon} />
        </div>
        <div className="text-center">
          <h3 className="text-lg font-black text-white uppercase tracking-tight mb-1">{title}</h3>
          <p className="text-[11px] text-slate-400 font-bold uppercase tracking-widest leading-relaxed">{message}</p>
        </div>
        <div className="flex gap-3 w-full">
          <button
            onClick={onCancel}
            className="flex-1 py-3 rounded-2xl bg-white/5 border border-white/10 text-slate-300 font-black uppercase tracking-wider text-xs hover:bg-white/10 transition-all"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={loading}
            className={`flex-1 py-3 rounded-2xl ${colors.btn} text-white font-black uppercase tracking-wider text-xs transition-all flex items-center justify-center gap-2 disabled:opacity-50`}
          >
            {loading ? <RefreshCw size={14} className="animate-spin" /> : confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}

export default function AdminAdmins() {
  const queryClient = useQueryClient();
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingAdmin, setEditingAdmin] = useState<any>(null);
  const [formData, setFormData] = useState({
    name: '', email: '', username: '', phone: '',
    password: '', role: 'admin', forceOtpLogin: false,
    permissionIds: [] as string[]
  });
  const [generatedCreds, setGeneratedCreds] = useState<any>(null);

  // Confirm dialog state
  const [confirm, setConfirm] = useState<{
    open: boolean; title: string; message: string; confirmLabel: string;
    variant: 'danger' | 'warning' | 'info'; action: () => void;
  }>({ open: false, title: '', message: '', confirmLabel: '', variant: 'danger', action: () => {} });

  const showConfirm = (opts: Omit<typeof confirm, 'open'>) =>
    setConfirm({ ...opts, open: true });
  const closeConfirm = () =>
    setConfirm(c => ({ ...c, open: false }));

  const { data: admins = [] } = useQuery({
    queryKey: ['admin-admins'],
    queryFn: async () => {
      const token = localStorage.getItem('token');
      const res = await axios.get(`${API_URL}/admins`, { headers: { Authorization: `Bearer ${token}` } });
      return res.data;
    }
  });

  const { data: permissions = [] } = useQuery({
    queryKey: ['admin-permissions'],
    queryFn: async () => {
      const token = localStorage.getItem('token');
      const res = await axios.get(`${API_URL}/admins/permissions`, { headers: { Authorization: `Bearer ${token}` } });
      return res.data;
    }
  });

  const upsertMutation = useMutation({
    mutationFn: async (data: any) => {
      const token = localStorage.getItem('token');
      if (editingAdmin) {
        return axios.put(`${API_URL}/admins/${editingAdmin.id}`, data, { headers: { Authorization: `Bearer ${token}` } });
      }
      return axios.post(`${API_URL}/admins`, data, { headers: { Authorization: `Bearer ${token}` } });
    },
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['admin-admins'] });
      toast.success(editingAdmin ? 'Staff updated!' : 'Staff enrolled! Credentials sent via SMS.');
      if (!editingAdmin && res.data?.rawPassword) {
        setGeneratedCreds({ username: res.data.username || res.data.email, password: res.data.rawPassword });
      }
      handleCloseModal();
    },
    onError: (err: any) => toast.error(err.response?.data?.message || 'Operation failed')
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const token = localStorage.getItem('token');
      return axios.delete(`${API_URL}/admins/${id}`, { headers: { Authorization: `Bearer ${token}` } });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-admins'] });
      toast.success('Staff member removed');
      closeConfirm();
    },
    onError: (err: any) => toast.error(err.response?.data?.message || 'Delete failed')
  });

  const resetPasswordMutation = useMutation({
    mutationFn: async (id: string) => {
      const token = localStorage.getItem('token');
      return axios.post(`${API_URL}/admins/${id}/reset-password`, {}, { headers: { Authorization: `Bearer ${token}` } });
    },
    onSuccess: (res) => {
      closeConfirm();
      toast.success('New credentials sent via SMS!');
      if (res.data?.rawPassword) {
        setGeneratedCreds({ username: 'Staff Member', password: res.data.rawPassword });
      }
    },
    onError: (err: any) => toast.error(err.response?.data?.message || 'Reset failed')
  });

  const toggleOtpMutation = useMutation({
    mutationFn: async ({ id, value }: { id: string; value: boolean }) => {
      const token = localStorage.getItem('token');
      return axios.put(`${API_URL}/admins/${id}`, { forceOtpLogin: value }, { headers: { Authorization: `Bearer ${token}` } });
    },
    onSuccess: (_, vars) => {
      queryClient.invalidateQueries({ queryKey: ['admin-admins'] });
      closeConfirm();
      toast.success(`2FA ${vars.value ? 'enabled' : 'disabled'}`);
    },
    onError: (err: any) => toast.error(err.response?.data?.message || 'Failed to toggle 2FA')
  });

  const handleOpenModal = (admin?: any) => {
    if (admin) {
      setEditingAdmin(admin);
      setFormData({
        name: admin.name || '',
        email: admin.email || '',
        username: admin.username || '',
        phone: admin.phone || '',
        password: '',
        role: admin.role || 'admin',
        forceOtpLogin: !!admin.forceOtpLogin,
        permissionIds: admin.permissions?.map((p: any) => p.id) || []
      });
    } else {
      setEditingAdmin(null);
      setFormData({ name: '', email: '', username: '', phone: '', password: '', role: 'admin', forceOtpLogin: false, permissionIds: [] });
    }
    setIsModalOpen(true);
  };

  const handleCloseModal = () => { setIsModalOpen(false); setEditingAdmin(null); };

  const togglePermission = (id: string) => {
    setFormData(prev => ({
      ...prev,
      permissionIds: prev.permissionIds.includes(id)
        ? prev.permissionIds.filter(pid => pid !== id)
        : [...prev.permissionIds, id]
    }));
  };

  return (
    <div className="space-y-8 animate-fade-in pb-20">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
        <div>
          <h2 className="text-4xl font-black text-main uppercase tracking-tight mb-2">Staff Management</h2>
          <p className="text-muted font-bold uppercase tracking-widest text-[10px] opacity-60">Control system access &amp; staff permissions</p>
        </div>
        <button onClick={() => handleOpenModal()} className="btn-primary px-8 py-4 flex items-center gap-3 shadow-lg shadow-cyan-500/20">
          <Plus size={20} />
          <span className="font-black uppercase tracking-widest text-xs">Register Admin</span>
        </button>
      </div>

      {/* Staff Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {admins.filter((a: any) => a.role !== 'superadmin').map((admin: any) => (
          <div key={admin.id} className="glass-panel group hover:border-cyan-500/30 transition-all p-8 relative overflow-hidden" style={{ backgroundColor: 'var(--bg-panel)' }}>
            <div className="absolute top-0 right-0 p-4 opacity-5 group-hover:opacity-10 transition-opacity">
              <Shield size={100} />
            </div>

            <div className="flex items-start justify-between mb-6">
              <div className="w-16 h-16 rounded-2xl bg-cyan-500/10 flex items-center justify-center text-cyan-500 border border-cyan-500/10 group-hover:scale-110 transition-transform">
                <Shield size={32} />
              </div>
              <div className="flex gap-1">
                {/* Reset Credentials */}
                <button
                  onClick={(e) => { e.stopPropagation(); showConfirm({ title: 'Reset Credentials', message: 'Generate a new password and send it to their phone via SMS?', confirmLabel: 'Reset & Send', variant: 'info', action: () => resetPasswordMutation.mutate(admin.id) }); }}
                  className="p-2 rounded-xl text-muted hover:text-cyan-400 hover:bg-cyan-500/10 transition-all"
                  title="Reset & Send Credentials"
                >
                  <Key size={16} />
                </button>
                {/* Edit */}
                <button
                  onClick={(e) => { e.stopPropagation(); handleOpenModal(admin); }}
                  className="p-2 rounded-xl text-muted hover:text-cyan-400 hover:bg-cyan-500/10 transition-all"
                  title="Edit Staff"
                >
                  <Edit2 size={16} />
                </button>
                {/* Delete */}
                <button
                  onClick={(e) => { e.stopPropagation(); showConfirm({ title: 'Remove Staff', message: `Remove ${admin.name} from the system? This action is irreversible.`, confirmLabel: 'Delete', variant: 'danger', action: () => deleteMutation.mutate(admin.id) }); }}
                  className="p-2 rounded-xl text-muted hover:text-red-400 hover:bg-red-500/10 transition-all"
                  title="Delete Staff"
                >
                  <Trash2 size={16} />
                </button>
              </div>
            </div>

            <div className="mb-6">
              <h3 className="text-xl font-black text-main uppercase tracking-tight">{admin.name}</h3>
              <p className="text-[10px] text-cyan-400 font-bold uppercase tracking-widest">{admin.role}</p>
            </div>

            <div className="space-y-3 mb-8">
              <div className="flex items-center gap-3 text-muted text-xs font-bold uppercase">
                <Mail size={14} className="text-cyan-500/60 shrink-0" />
                <span className="truncate">{admin.email}</span>
              </div>
              <div className="flex items-center gap-3 text-muted text-xs font-bold uppercase">
                <Phone size={14} className="text-cyan-500/60 shrink-0" />
                <span>{admin.phone || 'No Phone'}</span>
              </div>
              {/* 2FA Toggle — clickable directly on card */}
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  const newVal = !admin.forceOtpLogin;
                  showConfirm({
                    title: newVal ? 'Enable 2FA' : 'Disable 2FA',
                    message: newVal ? `Require OTP verification for every login by ${admin.name}?` : `Remove OTP requirement for ${admin.name}?`,
                    confirmLabel: newVal ? 'Enable' : 'Disable',
                    variant: newVal ? 'info' : 'warning',
                    action: () => toggleOtpMutation.mutate({ id: admin.id, value: newVal })
                  });
                }}
                className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-[9px] font-black tracking-widest uppercase transition-all ${admin.forceOtpLogin ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 hover:bg-emerald-500/20' : 'bg-amber-500/10 text-amber-400 border border-amber-500/20 hover:bg-amber-500/20'}`}
              >
                {admin.forceOtpLogin ? <CheckCircle2 size={10} /> : <Lock size={10} />}
                {admin.forceOtpLogin ? '2FA ON' : '2FA OFF'}
                <span className="opacity-50 font-normal">— tap to toggle</span>
              </button>
            </div>

            <div className="pt-6 border-t border-main/5">
              <p className="text-[9px] font-black text-muted uppercase tracking-widest mb-3">Permissions</p>
              <div className="flex flex-wrap gap-2">
                {admin.permissions?.length > 0 ? admin.permissions.map((p: any) => (
                  <span key={p.id} className="px-2 py-1 bg-main/5 text-main text-[9px] font-bold uppercase tracking-tighter rounded-md">
                    {p.name.replace(/_/g, ' ')}
                  </span>
                )) : <span className="text-[9px] text-muted font-bold tracking-widest">Base Role Only</span>}
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Enroll / Edit Modal */}
      {isModalOpen && createPortal(
        <div
          className="fixed inset-0 z-[10005] overflow-y-auto flex items-start justify-center pt-16 pb-20 p-4"
          style={{ backdropFilter: 'blur(24px)', backgroundColor: 'rgba(5,10,25,0.80)' }}
          onMouseDown={(e) => { if (e.target === e.currentTarget) handleCloseModal(); }}
        >
          <div className="glass-panel w-full max-w-2xl bg-slate-900 border border-main/10 shadow-3xl rounded-[2.5rem] p-8 md:p-12 relative animate-scale-in" style={{ backgroundColor: 'var(--bg-panel)' }}>
            <div className="flex items-center justify-between mb-10 pb-6 border-b border-main/5">
              <div className="flex items-center gap-6">
                <div className="w-16 h-16 rounded-2xl bg-cyan-500/10 flex items-center justify-center text-cyan-500 shrink-0 border border-cyan-500/20">
                  <Shield size={32} />
                </div>
                <div>
                  <h3 className="text-2xl font-black text-main uppercase tracking-tight">{editingAdmin ? 'Edit Staff' : 'Staff Enrollment'}</h3>
                  <p className="text-[10px] text-muted font-bold uppercase tracking-widest opacity-60">Set role &amp; security permissions</p>
                </div>
              </div>
              <button onClick={handleCloseModal} className="p-3 text-muted hover:text-white transition-colors rounded-xl hover:bg-white/5">
                <XCircle size={28} strokeWidth={1.5} />
              </button>
            </div>

            <form className="space-y-8" onSubmit={(e) => { e.preventDefault(); upsertMutation.mutate(formData); }}>
              {/* Fields */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                {[
                  { label: 'Full Name', key: 'name', placeholder: 'Staff Name', type: 'text', required: true },
                  { label: 'Email Access', key: 'email', placeholder: 'staff@pulselynk.com', type: 'email', required: true },
                  { label: 'Username', key: 'username', placeholder: 'staff001', type: 'text', required: false },
                  { label: 'Phone (2FA & Credentials)', key: 'phone', placeholder: '254...', type: 'text', required: false },
                ].map(f => (
                  <div key={f.key} className="space-y-2">
                    <label className="text-[9px] font-black text-muted uppercase tracking-widest ml-1">{f.label}</label>
                    <input
                      type={f.type}
                      className="glass-input"
                      value={(formData as any)[f.key]}
                      onChange={e => setFormData({ ...formData, [f.key]: e.target.value })}
                      placeholder={f.placeholder}
                      required={f.required}
                    />
                  </div>
                ))}
                {editingAdmin && (
                  <div className="space-y-2">
                    <label className="text-[9px] font-black text-muted uppercase tracking-widest ml-1">New Password (Optional)</label>
                    <input
                      type="password" className="glass-input"
                      value={formData.password}
                      onChange={e => setFormData({ ...formData, password: e.target.value })}
                      placeholder="Leave blank to keep current"
                    />
                  </div>
                )}
              </div>

              {/* 2FA Toggle */}
              <div className="flex items-center justify-between p-5 rounded-2xl border border-main/10" style={{ background: 'rgba(255,255,255,0.03)' }}>
                <div>
                  <p className="text-sm font-black text-main uppercase tracking-tight">Enforce OTP Security (2FA)</p>
                  <p className="text-[9px] text-muted font-bold uppercase tracking-widest mt-0.5">Compulsory 2FA OTP code for every login</p>
                </div>
                <button
                  type="button"
                  onClick={() => setFormData({ ...formData, forceOtpLogin: !formData.forceOtpLogin })}
                  className={`relative w-14 h-8 rounded-full transition-colors duration-300 focus:outline-none ${formData.forceOtpLogin ? 'bg-cyan-500' : 'bg-slate-700'}`}
                >
                  <div className={`absolute top-1 w-6 h-6 bg-white rounded-full shadow transition-all duration-300 ${formData.forceOtpLogin ? 'left-7' : 'left-1'}`} />
                </button>
              </div>

              {/* Permissions */}
              <div className="space-y-4">
                <div className="flex items-center justify-between ml-1">
                  <p className="text-[9px] font-black text-muted uppercase tracking-widest">Granular Capabilities</p>
                  {permissions.length === 0 && (
                    <button
                      type="button"
                      onClick={() => {
                        const token = localStorage.getItem('token');
                        axios.post(`${API_URL}/admins/seed`, {}, { headers: { Authorization: `Bearer ${token}` } })
                          .then(() => { queryClient.invalidateQueries({ queryKey: ['admin-permissions'] }); toast.success('Permissions synced!'); })
                          .catch(() => toast.error('Seeding failed'));
                      }}
                      className="text-[9px] font-black text-cyan-400 uppercase tracking-widest hover:underline"
                    >
                      Emergency Re-sync
                    </button>
                  )}
                </div>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                  {permissions.length > 0 ? permissions.map((p: any) => (
                    <button
                      key={p.id} type="button"
                      onClick={() => togglePermission(p.id)}
                      className={`p-4 rounded-xl text-left border transition-all ${formData.permissionIds.includes(p.id) ? 'bg-cyan-500/10 border-cyan-500/40 text-cyan-400' : 'bg-white/3 border-white/5 text-muted hover:border-white/20'}`}
                    >
                      <p className="text-[10px] font-black uppercase tracking-tighter">{p.name.replace(/_/g, ' ')}</p>
                    </button>
                  )) : (
                    <div className="col-span-full py-6 text-center border border-dashed border-main/10 rounded-xl">
                      <p className="text-[10px] text-muted font-bold uppercase tracking-widest italic">No permissions found — try Re-sync above</p>
                    </div>
                  )}
                </div>
              </div>

              {/* Actions */}
              <div className="flex gap-4 pt-2">
                <button
                  type="submit"
                  disabled={upsertMutation.isPending}
                  className="flex-1 py-5 btn-primary font-black uppercase tracking-[0.3em] text-xs shadow-2xl shadow-cyan-500/20 flex items-center justify-center gap-3 disabled:opacity-60"
                >
                  {upsertMutation.isPending ? <RefreshCw size={18} className="animate-spin" /> : <Shield size={18} />}
                  {editingAdmin ? 'Save Changes' : 'Enroll & Send Credentials'}
                </button>
                {editingAdmin && (
                  <button
                    type="button"
                    onClick={() => showConfirm({ title: 'Reset Credentials', message: 'Generate a new password and send it to their phone via SMS?', confirmLabel: 'Reset & Send', variant: 'info', action: () => resetPasswordMutation.mutate(editingAdmin.id) })}
                    className="px-6 rounded-[2rem] bg-slate-800 border border-main/10 text-cyan-400 hover:bg-slate-700 transition-all flex items-center justify-center gap-2 text-xs font-black uppercase tracking-widest"
                    title="Reset & Send Credentials"
                  >
                    <Key size={18} />
                  </button>
                )}
              </div>
            </form>
          </div>
        </div>,
        document.body
      )}

      {/* Credentials Success Modal */}
      {generatedCreds && createPortal(
        <div className="fixed inset-0 z-[10006] flex items-center justify-center p-4" style={{ backdropFilter: 'blur(24px)', backgroundColor: 'rgba(5,10,25,0.90)' }}>
          <div className="w-full max-w-md rounded-[2.5rem] border border-emerald-500/30 bg-slate-900 shadow-2xl p-10 text-center animate-scale-in">
            <div className="w-20 h-20 bg-emerald-500/10 rounded-3xl flex items-center justify-center mx-auto mb-8 border border-emerald-500/20">
              <CheckCircle2 size={40} className="text-emerald-500" />
            </div>
            <h3 className="text-3xl font-black text-white uppercase tracking-tighter mb-2">Credentials Ready</h3>
            <p className="text-slate-400 font-bold uppercase tracking-widest text-[10px] mb-8">Sent to their phone via SMS</p>
            <div className="space-y-4 mb-8">
              <div className="p-4 bg-black/40 rounded-2xl border border-white/5 flex flex-col items-center">
                <span className="text-[9px] font-black text-muted uppercase tracking-widest mb-1">Username / Email</span>
                <span className="text-lg font-bold text-white">{generatedCreds.username}</span>
              </div>
              <div className="p-4 bg-cyan-500/10 rounded-2xl border border-cyan-500/20 flex flex-col items-center">
                <span className="text-[9px] font-black text-cyan-400/60 uppercase tracking-widest mb-1">Generated Password</span>
                <span className="text-2xl font-black text-cyan-400 tracking-[0.3em]">{generatedCreds.password}</span>
                <button
                  onClick={() => { navigator.clipboard.writeText(generatedCreds.password); toast.success('Copied!'); }}
                  className="mt-3 text-[10px] font-black text-cyan-400 uppercase tracking-widest hover:text-white transition-colors flex items-center gap-2"
                >
                  Copy to Clipboard
                </button>
              </div>
            </div>
            <button onClick={() => setGeneratedCreds(null)} className="btn-primary w-full py-4 text-xs font-black uppercase tracking-[0.2em]">
              Got it, Continue
            </button>
          </div>
        </div>,
        document.body
      )}

      {/* Custom Confirm Dialog */}
      <ConfirmDialog
        open={confirm.open}
        title={confirm.title}
        message={confirm.message}
        confirmLabel={confirm.confirmLabel}
        variant={confirm.variant}
        loading={deleteMutation.isPending || resetPasswordMutation.isPending || toggleOtpMutation.isPending}
        onConfirm={confirm.action}
        onCancel={closeConfirm}
      />
    </div>
  );
}
