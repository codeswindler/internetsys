import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import axios from 'axios';
import toast from 'react-hot-toast';
import { 
  Users, 
  Shield, 
  Plus, 
  Trash2, 
  Edit2, 
  MoreVertical, 
  Lock, 
  Phone, 
  Mail, 
  CheckCircle2, 
  XCircle,
  Key
} from 'lucide-react';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000';

export default function AdminAdmins() {
  const queryClient = useQueryClient();
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingAdmin, setEditingAdmin] = useState<any>(null);
  const [formData, setFormData] = useState({
    name: '',
    email: '',
    username: '',
    phone: '',
    password: '',
    role: 'admin',
    forceOtpLogin: false,
    permissionIds: [] as string[]
  });

  const { data: admins = [], isLoading } = useQuery({
    queryKey: ['admin-admins'],
    queryFn: async () => {
      const token = localStorage.getItem('token');
      const res = await axios.get(`${API_URL}/admins`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      return res.data;
    }
  });

  const { data: permissions = [] } = useQuery({
    queryKey: ['admin-permissions'],
    queryFn: async () => {
      const token = localStorage.getItem('token');
      const res = await axios.get(`${API_URL}/admins/permissions`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      return res.data;
    }
  });

  const upsertMutation = useMutation({
    mutationFn: async (data: any) => {
      const token = localStorage.getItem('token');
      if (editingAdmin) {
        return axios.put(`${API_URL}/admins/${editingAdmin.id}`, data, {
          headers: { Authorization: `Bearer ${token}` }
        });
      }
      return axios.post(`${API_URL}/admins`, data, {
        headers: { Authorization: `Bearer ${token}` }
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-admins'] });
      toast.success(editingAdmin ? 'Admin updated!' : 'Admin created!');
      handleCloseModal();
    },
    onError: (err: any) => {
      toast.error(err.response?.data?.message || 'Operation failed');
    }
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const token = localStorage.getItem('token');
      return axios.delete(`${API_URL}/admins/${id}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-admins'] });
      toast.success('Admin deleted');
    }
  });

  const handleOpenModal = (admin?: any) => {
    if (admin) {
      setEditingAdmin(admin);
      setFormData({
        name: admin.name,
        email: admin.email,
        username: admin.username || '',
        phone: admin.phone || '',
        password: '', // Don't show password
        role: admin.role,
        forceOtpLogin: admin.forceOtpLogin,
        permissionIds: admin.permissions?.map((p: any) => p.id) || []
      });
    } else {
      setEditingAdmin(null);
      setFormData({
        name: '',
        email: '',
        username: '',
        phone: '',
        password: '',
        role: 'admin',
        forceOtpLogin: false,
        permissionIds: []
      });
    }
    setIsModalOpen(true);
  };

  const handleCloseModal = () => {
    setIsModalOpen(false);
    setEditingAdmin(null);
  };

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
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
        <div>
          <h2 className="text-4xl font-black text-main uppercase tracking-tight mb-2">Staff Management</h2>
          <p className="text-muted font-bold uppercase tracking-widest text-[10px] opacity-60">Control system access & staff permissions</p>
        </div>
        <button 
          onClick={() => handleOpenModal()}
          className="btn-primary px-8 py-4 flex items-center gap-3 shadow-lg shadow-cyan-500/20"
        >
          <Plus size={20} />
          <span className="font-black uppercase tracking-widest text-xs">Register Admin</span>
        </button>
      </div>

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
              <div className="flex gap-2">
                <button onClick={() => handleOpenModal(admin)} className="p-2 text-muted hover:text-cyan-400 transition-colors">
                  <Edit2 size={18} />
                </button>
                {admin.role !== 'superadmin' && (
                  <button 
                    onClick={() => { if(confirm('Delete admin?')) deleteMutation.mutate(admin.id) }} 
                    className="p-2 text-muted hover:text-red-500 transition-colors"
                  >
                    <Trash2 size={18} />
                  </button>
                )}
              </div>
            </div>

            <div className="mb-6">
              <h3 className="text-xl font-black text-main uppercase tracking-tight">{admin.name}</h3>
              <p className="text-[10px] text-cyan-400 font-bold uppercase tracking-widest">{admin.role}</p>
            </div>

            <div className="space-y-4 mb-8">
              <div className="flex items-center gap-3 text-muted text-xs font-bold uppercase">
                <Mail size={14} className="text-cyan-500/60" />
                <span className="truncate">{admin.email}</span>
              </div>
              <div className="flex items-center gap-3 text-muted text-xs font-bold uppercase">
                <Phone size={14} className="text-cyan-500/60" />
                <span>{admin.phone || 'NO PHONE'}</span>
              </div>
              <div className="flex items-center gap-3">
                <div className={`flex items-center gap-1.5 px-2 py-1 rounded-full text-[9px] font-black tracking-widest uppercase ${admin.forceOtpLogin ? 'bg-emerald-500/10 text-emerald-500' : 'bg-amber-500/10 text-amber-500'}`}>
                   {admin.forceOtpLogin ? <CheckCircle2 size={10} /> : <Lock size={10} />}
                   {admin.forceOtpLogin ? '2FA ENABLED' : 'NO 2FA'}
                </div>
              </div>
            </div>

            <div className="pt-6 border-t border-main/5">
               <p className="text-[9px] font-black text-muted uppercase tracking-widest mb-3">Permissions</p>
               <div className="flex flex-wrap gap-2">
                  {admin.permissions?.length > 0 ? admin.permissions.map((p: any) => (
                    <span key={p.id} className="px-2 py-1 bg-main/5 text-main text-[9px] font-bold uppercase tracking-tighter rounded-md">
                      {p.name.replace('_', ' ')}
                    </span>
                  )) : <span className="text-[9px] text-muted font-bold tracking-widest">Base Role Core Only</span>}
               </div>
            </div>
          </div>
        ))}
      </div>

      {isModalOpen && (
        <div className="fixed inset-0 z-[1200] flex items-start justify-center p-4 backdrop-blur-2xl bg-slate-950/60 transition-all duration-500 overflow-y-auto pt-20">
          <div className="glass-panel w-full max-w-2xl bg-slate-900 border border-main/10 shadow-3xl rounded-[2.5rem] p-8 md:p-12 mb-20 relative" style={{ backgroundColor: 'var(--bg-panel)' }}>
             <div className="flex items-center justify-between mb-10 pb-6 border-b border-main/5">
                <div className="flex items-center gap-6">
                  <div className="w-16 h-16 rounded-2xl bg-cyan-500/10 flex items-center justify-center text-cyan-500 shrink-0">
                    <Shield size={32} />
                  </div>
                  <div>
                    <h3 className="text-2xl font-black text-main uppercase tracking-tight">{editingAdmin ? 'Edit Staff' : 'Staff Enrollment'}</h3>
                    <p className="text-[10px] text-muted font-bold uppercase tracking-widest opacity-60">Set role & security permissions</p>
                  </div>
                </div>
                <button onClick={handleCloseModal} className="p-3 text-muted hover:text-white transition-colors">
                  <XCircle size={32} strokeWidth={1} />
                </button>
             </div>

             <form className="space-y-8" onSubmit={(e) => { e.preventDefault(); upsertMutation.mutate(formData); }}>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                   <div className="space-y-2">
                      <label className="text-[9px] font-black text-muted uppercase tracking-widest ml-1">Full Name</label>
                      <input 
                        className="glass-input" 
                        value={formData.name} onChange={e => setFormData({...formData, name: e.target.value})} 
                        placeholder="Staff Name" required 
                      />
                   </div>
                   <div className="space-y-2">
                      <label className="text-[9px] font-black text-muted uppercase tracking-widest ml-1">Email Access</label>
                      <input 
                        type="email" className="glass-input" 
                        value={formData.email} onChange={e => setFormData({...formData, email: e.target.value})} 
                        placeholder="staff@pulselynk.com" required 
                      />
                   </div>
                   <div className="space-y-2">
                      <label className="text-[9px] font-black text-muted uppercase tracking-widest ml-1">Username (Display)</label>
                      <input 
                        className="glass-input" 
                        value={formData.username} onChange={e => setFormData({...formData, username: e.target.value})} 
                        placeholder="staff001" 
                      />
                   </div>
                   <div className="space-y-2">
                      <label className="text-[9px] font-black text-muted uppercase tracking-widest ml-1">Phone (For 2FA)</label>
                      <input 
                        className="glass-input" 
                        value={formData.phone} onChange={e => setFormData({...formData, phone: e.target.value})} 
                        placeholder="254..." 
                      />
                   </div>
                    <div className="space-y-2">
                       <label className="text-[9px] font-black text-muted uppercase tracking-widest ml-1">{editingAdmin ? 'New Password (Optional)' : 'Access Password'}</label>
                       <input 
                         type="password" className="glass-input text-cyan-400" 
                         value={formData.password} onChange={e => setFormData({...formData, password: e.target.value})} 
                         placeholder="••••••••" required={!editingAdmin}
                       />
                    </div>
                 </div>

                <div className="flex items-center justify-between p-6 bg-main/5 border border-main/10 rounded-2xl">
                   <div>
                      <p className="text-sm font-black text-main uppercase tracking-tight">Enforce OTP Security (2FA)</p>
                      <p className="text-[9px] text-muted font-bold uppercase tracking-widest">Compulsory Advanta SMS code for every login</p>
                   </div>
                   <button 
                     type="button"
                     onClick={() => setFormData({...formData, forceOtpLogin: !formData.forceOtpLogin})}
                     className={`w-14 h-8 rounded-full relative transition-colors ${formData.forceOtpLogin ? 'bg-cyan-500' : 'bg-slate-700'}`}
                   >
                     <div className={`absolute top-1 w-6 h-6 bg-white rounded-full transition-all ${formData.forceOtpLogin ? 'left-7' : 'left-1'}`} />
                   </button>
                </div>

                <div className="space-y-4">
                   <p className="text-[9px] font-black text-muted uppercase tracking-widest ml-1">Granular Capabilities (Permissions)</p>
                   <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                      {permissions.map((p: any) => (
                        <button
                          key={p.id}
                          type="button"
                          onClick={() => togglePermission(p.id)}
                          className={`p-4 rounded-xl text-left border transition-all ${
                            formData.permissionIds.includes(p.id)
                            ? 'bg-cyan-500/10 border-cyan-500/50 text-cyan-400'
                            : 'bg-main/5 border-main/5 text-muted'
                          }`}
                        >
                          <p className="text-[10px] font-black uppercase tracking-tighter">{p.name.replace('_', ' ')}</p>
                        </button>
                      ))}
                   </div>
                </div>

                <button 
                  type="submit" 
                  disabled={upsertMutation.isPending}
                  className="w-full py-6 btn-primary font-black uppercase tracking-[0.3em] text-xs shadow-2xl shadow-cyan-500/20 active:scale-95 transition-all flex items-center justify-center gap-4"
                >
                  {upsertMutation.isPending ? <RefreshCw className="animate-spin" /> : <Shield size={20} />}
                  {editingAdmin ? 'Update Credentials' : 'Enroll Administrator'}
                </button>
             </form>
          </div>
        </div>
      )}
    </div>
  );
}

function RefreshCw(props: any) {
  return (
    <svg 
      {...props}
      xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" 
      className={`lucide lucide-refresh-cw ${props.className}`}
    >
      <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M3 21v-5h5"/>
    </svg>
  );
}
