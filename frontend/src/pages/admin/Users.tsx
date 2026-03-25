import { useState } from 'react';
import { createPortal } from 'react-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import {
  Plus, User as UserIcon, ShieldBan, ShieldCheck, Phone,
  CalendarDays, PackagePlus, Wifi, WifiOff, Loader2,
  X, Router as RouterIcon, XCircle, RefreshCw, Clock,
} from 'lucide-react';
import api from '../../services/api';
import { CountdownBadge } from '../../components/CountdownBadge';
import { ConfirmModal } from '../../components/ConfirmModal';

// ─── Types ───────────────────────────────────────────────────────────────────

interface Subscription {
  id: string;
  status: 'pending' | 'active' | 'expired' | 'cancelled';
  expiresAt: string | null;
  startedAt: string | null;
  package: { id: string; name: string; price: number };
  router: { id: string; name: string };
  paymentMethod: string;
  mikrotikUsername?: string;
}

interface CustomerUser {
  id: string;
  name: string;
  phone: string;
  isActive: boolean;
  createdAt: string;
  subscriptions: Subscription[];
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getActiveSubs(user: CustomerUser): Subscription[] {
  return (
    user.subscriptions
      ?.filter(s => s.status === 'active' && s.expiresAt && new Date(s.expiresAt).getTime() > Date.now())
      .sort((a, b) => new Date(b.startedAt!).getTime() - new Date(a.startedAt!).getTime())
  ) ?? [];
}

function getInactiveSubs(user: CustomerUser): Subscription[] {
  return user.subscriptions?.filter(s => s.status === 'cancelled' || s.status === 'expired') ?? [];
}

// ─── Active Plans Popup ───────────────────────────────────────────────────────

function ActivePlansPopup({
  user,
  onClose,
  onCancelClick,
  onReactivate,
  cancelPending,
  reactivatePending,
}: {
  user: CustomerUser;
  onClose: () => void;
  onCancelClick: (id: string) => void;
  onReactivate: (id: string, status: string) => void;
  cancelPending: boolean;
  reactivatePending: boolean;
}) {
  const activeSubs = getActiveSubs(user);
  const inactiveSubs = getInactiveSubs(user);

  return createPortal(
    <div 
      className="fixed inset-0 bg-black/70 backdrop-blur-sm z-[9999] flex items-center justify-center p-4"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="glass-panel w-full max-w-xl bg-slate-900 border border-slate-700 shadow-2xl rounded-2xl overflow-hidden animate-fade-in">
        <div className="flex items-center justify-between p-5 border-b border-white/10">
          <div>
            <h3 className="text-lg font-bold text-white">{user.name}'s Plans</h3>
            <p className="text-xs text-slate-400 mt-0.5 font-mono">{user.phone}</p>
          </div>
          <button onClick={onClose} className="p-2 text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg transition-colors">
            <X size={18} />
          </button>
        </div>

        <div className="p-5 space-y-5 max-h-[70vh] overflow-y-auto custom-scrollbar">
          {/* Active */}
          {activeSubs.length > 0 && (
            <div>
              <p className="text-[10px] font-bold text-green-400 uppercase tracking-widest mb-3">Active Plans ({activeSubs.length})</p>
              <div className="space-y-3">
                {activeSubs.map(s => (
                  <div key={s.id} className="bg-green-500/5 border border-green-500/20 rounded-xl p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="font-bold text-white text-sm">{s.package.name}</p>
                        <p className="text-xs text-slate-400 mt-0.5 flex items-center gap-1">
                          <RouterIcon size={11} /> {s.router.name}
                        </p>
                        {s.mikrotikUsername && (
                          <p className="text-xs font-mono text-slate-500 mt-1">{s.mikrotikUsername}</p>
                        )}
                      </div>
                      <div className="flex flex-col items-end gap-2 shrink-0">
                        <CountdownBadge expiresAt={s.expiresAt} variant="inline" />
                        <button
                          onClick={() => onCancelClick(s.id)}
                          disabled={cancelPending}
                          className="flex items-center gap-1 text-[11px] font-bold text-red-400 hover:text-red-300 hover:bg-red-500/10 px-2 py-1 rounded-lg transition-colors"
                        >
                          <XCircle size={12} /> Cancel Plan
                        </button>
                      </div>
                    </div>
                    <p className="text-[10px] text-slate-500 mt-2">
                      Expires {s.expiresAt ? new Date(s.expiresAt).toLocaleString() : '—'}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Inactive */}
          {inactiveSubs.length > 0 && (
            <div>
              <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-3">Inactive & Cancelled ({inactiveSubs.length})</p>
              <div className="space-y-3">
                {inactiveSubs.map(s => (
                  <div key={s.id} className="bg-slate-800/40 border border-slate-700/50 rounded-xl p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 mb-0.5">
                          <p className="font-bold text-slate-300 text-sm">{s.package.name}</p>
                          <span className={`text-[9px] uppercase tracking-wider font-bold px-1.5 py-0.5 rounded border ${s.status === 'expired' ? 'bg-orange-500/10 text-orange-400 border-orange-500/30' : 'bg-slate-700/50 text-slate-400 border-slate-600'}`}>{s.status}</span>
                        </div>
                        <p className="text-xs text-slate-500 flex items-center gap-1">
                          <RouterIcon size={11} /> {s.router.name}
                        </p>
                      </div>
                      {s.status === 'cancelled' && (
                        <button
                          onClick={() => onReactivate(s.id, s.status)}
                          disabled={reactivatePending}
                          className="flex items-center gap-1 text-[11px] font-bold text-cyan-400 hover:text-cyan-300 hover:bg-cyan-500/10 px-2 py-1 rounded-lg transition-colors shrink-0"
                        >
                          <RefreshCw size={12} /> Reactivate
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {activeSubs.length === 0 && inactiveSubs.length === 0 && (
            <p className="text-center text-slate-500 text-sm py-6">No plans found.</p>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function Users() {
  const queryClient = useQueryClient();

  const [showCreateModal, setShowCreateModal] = useState(false);
  const [formData, setFormData] = useState({ name: '', username: '', phone: '', password: '' });
  const [searchQuery, setSearchQuery] = useState('');

  const [allocateTarget, setAllocateTarget] = useState<CustomerUser | null>(null);
  const [allocateForm, setAllocateForm] = useState({ packageId: '', routerId: '' });

  const [plansPopupUserId, setPlansPopupUserId] = useState<string | null>(null);

  const [confirmState, setConfirmState] = useState<{
    isOpen: boolean;
    title: string;
    message: string;
    confirmText?: string;
    onConfirm: () => void;
  }>({ isOpen: false, title: '', message: '', onConfirm: () => {} });

  // ── Queries ──
  const { data: users, isLoading } = useQuery<CustomerUser[]>({
    queryKey: ['admin-users'],
    queryFn: () => api.get('/auth/admin/users').then(r => r.data),
    refetchInterval: 30000,
  });

  const { data: packages } = useQuery<any[]>({
    queryKey: ['packages', 'all'],
    queryFn: () => api.get('/packages/all').then(r => r.data),
    enabled: !!allocateTarget,
  });

  const { data: routers } = useQuery<any[]>({
    queryKey: ['routers'],
    queryFn: () => api.get('/routers').then(r => r.data),
    enabled: !!allocateTarget,
  });

  // ── Mutations ──
  const createMutation = useMutation({
    mutationFn: (data: any) => api.post('/auth/admin/users', data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-users'] });
      setShowCreateModal(false);
      setFormData({ name: '', username: '', phone: '', password: '' });
      toast.success('Customer created successfully');
    },
    onError: (err: any) => toast.error(err.response?.data?.message || 'Failed to create user'),
  });

  const toggleMutation = useMutation({
    mutationFn: (id: string) => api.post(`/auth/admin/users/${id}/toggle`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-users'] });
      toast.success('User status updated');
      setConfirmState(s => ({ ...s, isOpen: false }));
    },
  });

  const allocateMutation = useMutation({
    mutationFn: (data: { userId: string; packageId: string; routerId: string }) =>
      api.post('/subscriptions/allocate', data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-users'] });
      setAllocateTarget(null);
      setAllocateForm({ packageId: '', routerId: '' });
      toast.success('Package allocated & activated successfully!');
    },
    onError: (err: any) => toast.error(err.response?.data?.message || 'Allocation failed'),
  });

  const cancelMutation = useMutation({
    mutationFn: (id: string) => api.post(`/subscriptions/${id}/cancel`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-users'] });
      toast.success('Subscription cancelled');
      setConfirmState(s => ({ ...s, isOpen: false }));
    },
    onError: (err: any) => {
      toast.error(err.response?.data?.message || 'Cancel failed');
      setConfirmState(s => ({ ...s, isOpen: false }));
    },
  });

  const reactivateMutation = useMutation({
    mutationFn: (id: string) => api.post(`/subscriptions/${id}/reactivate`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-users'] });
      toast.success('Subscription reactivated!');
    },
    onError: (err: any) => toast.error(err.response?.data?.message || 'Reactivation failed'),
  });

  // Computed state for popup
  const popupUser = users?.find(u => u.id === plansPopupUserId) || null;

  // Handlers
  const handleCancelClick = (subId: string) => {
    setConfirmState({
      isOpen: true,
      title: 'Cancel Subscription',
      message: 'Are you sure you want to cancel this plan? The user will instantly lose internet access.',
      confirmText: 'Cancel Plan',
      onConfirm: () => cancelMutation.mutate(subId)
    });
  };

  const handleToggleBlockClick = (user: CustomerUser) => {
    setConfirmState({
      isOpen: true,
      title: user.isActive ? 'Suspend User' : 'Unblock User',
      message: user.isActive ? 'Are you sure you want to block this user from logging in?' : 'Restore access for this user?',
      confirmText: user.isActive ? 'Suspend' : 'Unblock',
      onConfirm: () => toggleMutation.mutate(user.id)
    });
  };

  // ── Render ──
  if (isLoading)
    return (
      <div className="flex items-center justify-center p-16 text-slate-400 gap-3">
        <Loader2 className="animate-spin" size={20} /> Loading customers...
      </div>
    );

  const filteredUsers = users?.filter(u => 
    u.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    u.phone.includes(searchQuery) ||
    (u as any).username?.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div>
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-6">
        <div>
          <h2 className="text-2xl font-bold">Manage Customers</h2>
          <p className="text-sm text-slate-400 mt-1">{filteredUsers?.length ?? 0} customers found</p>
        </div>
        
        <div className="flex flex-col sm:flex-row items-center gap-4 w-full md:w-auto">
          <div className="relative w-full sm:w-64">
             <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-500">
               <RefreshCw size={14} className={isLoading ? 'animate-spin' : ''} />
             </div>
             <input 
               type="text" 
               placeholder="Search name, phone, user..."
               className="w-full bg-slate-900 border border-white/5 rounded-xl py-2 pl-9 pr-4 text-sm text-white focus:outline-none focus:border-cyan-500/50 transition-all"
               value={searchQuery}
               onChange={(e) => setSearchQuery(e.target.value)}
             />
          </div>
          <button className="btn-primary flex items-center gap-2 whitespace-nowrap w-full sm:w-auto justify-center" onClick={() => setShowCreateModal(true)}>
            <Plus size={18} /> Add Customer
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {filteredUsers?.map((u) => {
          const activeSubs = getActiveSubs(u);
          const mostRecentActive = activeSubs[0] ?? null;
          const totalSubs = u.subscriptions?.length ?? 0;
          const activeCount = activeSubs.length;
          const inactiveCount = getInactiveSubs(u).length;

          return (
            <div key={u.id} className="glass-panel flex flex-col overflow-hidden">
              {/* ── Card Header ── */}
              <div className="p-5 border-b border-white/5">
                <div className="flex items-start gap-3">
                  {/* Avatar */}
                  <div className="w-10 h-10 rounded-full bg-slate-800 flex items-center justify-center text-cyan-400 font-bold text-base border border-slate-700 shrink-0">
                    {u.name.charAt(0).toUpperCase()}
                  </div>

                  {/* Info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2">
                      <h3 className="text-sm font-bold text-white truncate leading-tight">{u.name}</h3>
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border shrink-0
                        ${u.isActive ? 'bg-green-500/10 border-green-500/30 text-green-400' : 'bg-red-500/10 border-red-500/30 text-red-400'}`}>
                        {u.isActive ? 'Active' : 'Blocked'}
                      </span>
                    </div>
                    {(u as any).username && (
                      <p className="text-[10px] text-cyan-400/70 font-bold mb-1 tracking-widest uppercase truncate truncate-lines-1">@{ (u as any).username }</p>
                    )}
                    <p className="text-xs text-slate-400 font-mono flex items-center gap-1 mt-0.5">
                      <Phone size={10} /> {u.phone}
                    </p>
                  </div>
                </div>

                {/* Stats row */}
                <div className="flex items-center gap-3 mt-3 text-[11px] text-slate-500">
                  <span className="flex items-center gap-1"><CalendarDays size={10} /> Since {new Date(u.createdAt).toLocaleDateString('en-GB', { day:'2-digit', month:'short', year:'numeric' })}</span>
                  <span className="text-slate-700">·</span>
                  <span>{totalSubs} total</span>
                  {activeCount > 0 && (
                    <>
                      <span className="text-slate-700">·</span>
                      <span className="text-cyan-400 font-bold">{activeCount} active</span>
                    </>
                  )}
                </div>
              </div>

              {/* ── Active Plan ── */}
              <div className="p-5 flex-1">
                {mostRecentActive ? (
                  <div className="p-3 rounded-xl bg-cyan-500/5 border border-cyan-500/20">
                    <div className="flex items-center gap-1.5 mb-2">
                      <Wifi size={12} className="text-cyan-400" />
                      <span className="text-[10px] font-bold text-cyan-400 uppercase tracking-wide">Active Plan</span>
                      {activeCount > 1 && (
                        <button
                          className="ml-auto text-[10px] font-bold text-purple-400 hover:text-purple-300 underline underline-offset-2 transition-colors"
                          onClick={() => setPlansPopupUserId(u.id)}
                        >
                          +{activeCount - 1} more
                        </button>
                      )}
                    </div>
                    <p className="text-sm font-bold text-white leading-tight">{mostRecentActive.package.name}</p>
                    <p className="text-[11px] text-slate-400 mt-0.5 flex items-center gap-1">
                      <RouterIcon size={10} /> {mostRecentActive.router.name}
                    </p>
                    <div className="mt-2 flex items-center justify-between gap-2 flex-wrap">
                      <CountdownBadge expiresAt={mostRecentActive.expiresAt} variant="inline" />
                      <div className="flex items-center gap-2">
                        <button
                          className="text-[10px] font-bold text-red-400 hover:text-red-300 flex items-center gap-1 transition-colors"
                          onClick={() => handleCancelClick(mostRecentActive.id)}
                          disabled={cancelMutation.isPending}
                        >
                          <XCircle size={11} /> Cancel
                        </button>
                        {activeCount > 1 && (
                          <button
                            className="text-[10px] font-bold text-purple-400 hover:text-purple-300 transition-colors border border-purple-500/30 rounded px-2 py-0.5"
                            onClick={() => setPlansPopupUserId(u.id)}
                          >
                            View All Plans
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="p-3 rounded-xl bg-slate-800/30 border border-slate-700/30 flex items-center gap-2">
                    <WifiOff size={13} className="text-slate-500" />
                    <span className="text-xs text-slate-500">No active plan</span>
                  </div>
                )}

                {/* Cancelled/Expired plans hint */}
                {inactiveCount > 0 && (
                  <button
                    className="mt-3 w-full text-[10px] font-bold text-slate-400 hover:text-cyan-400 flex items-center justify-center gap-1.5 py-1.5 border border-dashed border-slate-700 hover:border-cyan-500/50 rounded-lg transition-colors"
                    onClick={() => setPlansPopupUserId(u.id)}
                  >
                    <RefreshCw size={10} /> {inactiveCount} inactive plan(s) — view & manage
                  </button>
                )}
              </div>

              {/* ── Actions ── */}
              <div className="px-5 py-3 border-t border-white/5 flex justify-between items-center bg-black/10">
                <button
                  className="text-xs font-semibold flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-purple-400 hover:bg-purple-400/10 transition-colors"
                  onClick={() => {
                    setAllocateTarget(u);
                    setAllocateForm({ packageId: '', routerId: '' });
                  }}
                >
                  <PackagePlus size={14} /> Allocate Package
                </button>

                <button
                  className={`text-xs font-semibold flex items-center gap-1.5 px-3 py-1.5 rounded-lg transition-colors
                    ${u.isActive ? 'text-orange-400 hover:bg-orange-400/10' : 'text-green-400 hover:bg-green-400/10'}`}
                  onClick={() => handleToggleBlockClick(u)}
                  disabled={toggleMutation.isPending}
                >
                  {u.isActive ? <><ShieldBan size={14} /> Block</> : <><ShieldCheck size={14} /> Unblock</>}
                </button>
              </div>
            </div>
          );
        })}

        {users?.length === 0 && (
          <div className="col-span-full text-center p-12 glass-panel text-slate-400">
            No customers yet. Click 'Add Customer' to create one.
          </div>
        )}
      </div>

      {/* ── All Plans Popup ── */}
      {popupUser && (
        <ActivePlansPopup
          user={popupUser}
          onClose={() => setPlansPopupUserId(null)}
          onCancelClick={handleCancelClick}
          onReactivate={(id, status) => {
             reactivateMutation.mutate(id);
          }}
          cancelPending={cancelMutation.isPending}
          reactivatePending={reactivateMutation.isPending}
        />
      )}

      {/* ── Confirm Modal ── */}
      <ConfirmModal
        isOpen={confirmState.isOpen}
        title={confirmState.title}
        message={confirmState.message}
        confirmText={confirmState.confirmText}
        onConfirm={confirmState.onConfirm}
        onCancel={() => setConfirmState(s => ({ ...s, isOpen: false }))}
        isLoading={cancelMutation.isPending || toggleMutation.isPending || reactivateMutation.isPending}
      />

      {/* ── Create Customer Modal ── */}
      {showCreateModal && createPortal(
        <div 
          className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[9999] flex items-center justify-center p-4"
          onMouseDown={(e) => { if (e.target === e.currentTarget) setShowCreateModal(false); }}
        >
          <div className="glass-panel w-full max-w-2xl animate-fade-in bg-slate-900 border border-slate-700 shadow-2xl rounded-2xl overflow-hidden flex flex-col">
            <h3 className="text-2xl font-bold p-6 text-white border-b border-white/10">Create New Customer</h3>
            <form
              onSubmit={(e) => { e.preventDefault(); createMutation.mutate(formData); }}
              className="p-6 overflow-y-auto max-h-[calc(90vh-140px)] custom-scrollbar flex flex-col gap-6"
            >
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-1.5">Full Name</label>
                  <div className="relative">
                    <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-500"><UserIcon size={18} /></div>
                    <input className="w-full bg-slate-800/50 border border-slate-700 rounded-lg py-3 pl-10 pr-4 text-white focus:ring-2 focus:ring-cyan-500 transition-all font-medium" value={formData.name} onChange={e => setFormData({ ...formData, name: e.target.value })} placeholder="e.g. John Doe" required />
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-1.5">Username</label>
                  <div className="relative">
                    <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-500"><UserIcon size={18} /></div>
                    <input className="w-full bg-slate-800/50 border border-slate-700 rounded-lg py-3 pl-10 pr-4 text-white focus:ring-2 focus:ring-cyan-500 transition-all font-medium" value={formData.username} onChange={e => setFormData({ ...formData, username: e.target.value })} placeholder="e.g. john123" required />
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-1.5">Mobile Number</label>
                  <div className="relative">
                    <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-500"><Phone size={18} /></div>
                    <input className="w-full bg-slate-800/50 border border-slate-700 rounded-lg py-3 pl-10 pr-4 text-white focus:ring-2 focus:ring-cyan-500 transition-all font-medium" value={formData.phone} onChange={e => setFormData({ ...formData, phone: e.target.value })} placeholder="e.g. 07XXXXXXXX" required />
                  </div>
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-1.5">Initial Password</label>
                <input className="w-full bg-slate-800/50 border border-slate-700 rounded-lg p-3 text-white focus:ring-2 focus:ring-cyan-500 transition-all font-medium" type="password" value={formData.password} onChange={e => setFormData({ ...formData, password: e.target.value })} placeholder="••••••••" required minLength={6} />
                <p className="mt-2 text-[11px] text-slate-500 italic">Account will be active immediately after creation.</p>
              </div>
              <div className="flex justify-end gap-4 mt-6 pt-6 border-t border-white/5">
                <button type="button" className="px-6 py-2.5 rounded-lg font-bold text-slate-400 hover:text-white hover:bg-slate-800 transition-all" onClick={() => setShowCreateModal(false)}>Cancel</button>
                <button type="submit" className="px-8 py-2.5 rounded-lg font-bold bg-gradient-to-r from-cyan-600 to-blue-600 text-white hover:from-cyan-500 hover:to-blue-500 shadow-lg shadow-cyan-900/20 transition-all transform active:scale-95" disabled={createMutation.isPending}>
                  {createMutation.isPending ? 'Creating...' : 'Create Customer'}
                </button>
              </div>
            </form>
          </div>
        </div>,
        document.body,
      )}

      {/* ── Allocate Package Modal ── */}
      {allocateTarget && createPortal(
        <div 
          className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[9999] flex items-center justify-center p-4"
          onMouseDown={(e) => { if (e.target === e.currentTarget) setAllocateTarget(null); }}
        >
          <div className="glass-panel w-full max-w-2xl animate-fade-in bg-slate-900 border border-slate-700 shadow-2xl rounded-2xl overflow-hidden flex flex-col">
            <div className="flex items-center gap-3 p-6 border-b border-white/10">
              <div className="w-10 h-10 rounded-full bg-purple-500/10 border border-purple-500/30 flex items-center justify-center text-purple-400"><PackagePlus size={18} /></div>
              <div>
                <h3 className="text-xl font-bold text-white">Allocate Package</h3>
                <p className="text-sm text-slate-400">For <span className="text-white font-medium">{allocateTarget.name}</span> <span className="text-slate-500 font-mono text-xs">({allocateTarget.phone})</span></p>
              </div>
            </div>

            <form
              onSubmit={(e) => { e.preventDefault(); allocateMutation.mutate({ userId: allocateTarget.id, packageId: allocateForm.packageId, routerId: allocateForm.routerId }); }}
              className="p-6 overflow-y-auto max-h-[calc(90vh-140px)] custom-scrollbar flex flex-col gap-6"
            >
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-1.5">Select Package</label>
                  <select className="w-full bg-slate-800 border border-slate-700 rounded-lg p-3 text-white focus:ring-2 focus:ring-purple-500 transition-all appearance-none" value={allocateForm.packageId} onChange={e => setAllocateForm({ ...allocateForm, packageId: e.target.value })} required>
                    <option value="">— Choose a package —</option>
                    {packages?.filter(p => p.isActive).map(p => (<option key={p.id} value={p.id}>{p.name}</option>))}
                  </select>
                  {allocateForm.packageId && (
                    <p className="mt-2 text-xs text-purple-400 font-medium">
                      {packages?.find(p => p.id === allocateForm.packageId)?.price} KES / {packages?.find(p => p.id === allocateForm.packageId)?.durationValue} {packages?.find(p => p.id === allocateForm.packageId)?.durationType}
                    </p>
                  )}
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-1.5">Select Router</label>
                  <select className="w-full bg-slate-800 border border-slate-700 rounded-lg p-3 text-white focus:ring-2 focus:ring-purple-500 transition-all appearance-none" value={allocateForm.routerId} onChange={e => setAllocateForm({ ...allocateForm, routerId: e.target.value })} required>
                    <option value="">— Choose a router —</option>
                    {routers?.map(r => (<option key={r.id} value={r.id} disabled={!r.isOnline}>{r.name} {r.isOnline ? '🟢' : '🔴 (offline)'}</option>))}
                  </select>
                </div>
              </div>
              <div className="p-4 rounded-xl bg-purple-500/5 border border-purple-500/20 text-xs text-slate-400 leading-relaxed">
                <strong className="text-purple-300">Note:</strong> This will immediately activate the selected package on the MikroTik router for this user. No payment is required — the subscription will be marked as <strong className="text-white">manual</strong>.
              </div>
              <div className="flex justify-end gap-4 mt-6 pt-6 border-t border-white/5">
                <button type="button" className="px-6 py-2.5 rounded-lg font-bold text-slate-400 hover:text-white hover:bg-slate-800 transition-all" onClick={() => setAllocateTarget(null)} disabled={allocateMutation.isPending}>Cancel</button>
                <button type="submit" className="px-8 py-2.5 rounded-lg font-bold bg-gradient-to-r from-purple-600 to-indigo-600 text-white hover:from-purple-500 hover:to-indigo-500 shadow-lg shadow-purple-900/20 transition-all transform active:scale-95 flex items-center gap-2" disabled={allocateMutation.isPending}>
                  {allocateMutation.isPending ? <><Loader2 size={16} className="animate-spin" /> Activating...</> : <><PackagePlus size={16} /> Activate Package</>}
                </button>
              </div>
            </form>
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}
