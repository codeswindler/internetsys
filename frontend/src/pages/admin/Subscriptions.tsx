import { useState } from 'react';
import { createPortal } from 'react-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { Router as RouterIcon, Clock, XCircle, RefreshCw, CheckCircle, PackagePlus, Loader2, Download, Upload } from 'lucide-react';
import api from '../../services/api';
import { CountdownBadge } from '../../components/CountdownBadge';
import { ConfirmModal } from '../../components/ConfirmModal';

const STATUS_STYLES: Record<string, string> = {
  active: 'badge-success',
  pending: 'badge-warning',
  expired: 'badge-danger',
  cancelled: 'bg-slate-700/50 text-slate-400 border border-slate-600',
};

function TrafficIndicator({ subId }: { subId: string }) {
  const { data: traffic } = useQuery({
    queryKey: ['traffic', subId],
    queryFn: () => api.get(`/subscriptions/${subId}/traffic`).then(res => res.data),
    refetchInterval: 5000,
  });

  if (!traffic) return <span className="text-xs text-slate-600">—</span>;

  return (
    <div className="flex flex-col gap-1 text-[10px] font-mono whitespace-nowrap">
      <div className="flex items-center gap-1.5 text-cyan-400">
        <Download size={10} />
        <b>{traffic.downloadSpeed}</b>
      </div>
      <div className="flex items-center gap-1.5 text-blue-400">
        <Upload size={10} />
        <b>{traffic.uploadSpeed}</b>
      </div>
    </div>
  );
}

export default function Subscriptions() {
  const queryClient = useQueryClient();

  const [confirmState, setConfirmState] = useState<{ isOpen: boolean; title: string; message: string; onConfirm: () => void }>({ isOpen: false, title: '', message: '', onConfirm: () => {} });

  // Allocate Package State
  const [showAllocateModal, setShowAllocateModal] = useState(false);
  const [allocateForm, setAllocateForm] = useState({ userId: '', packageId: '', routerId: '' });
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'pending' | 'expired' | 'cancelled'>('all');

  const { data: subs, isLoading } = useQuery({
    queryKey: ['admin_subscriptions'],
    queryFn: () => api.get('/subscriptions').then(res => res.data),
    refetchInterval: 30000,
  });

  const { data: users } = useQuery<any[]>({
    queryKey: ['admin-users'],
    queryFn: () => api.get('/auth/admin/users').then(r => r.data),
    enabled: showAllocateModal,
  });

  const { data: packages } = useQuery<any[]>({
    queryKey: ['packages', 'all'],
    queryFn: () => api.get('/packages/all').then(r => r.data),
    enabled: showAllocateModal,
  });

  const { data: routers } = useQuery<any[]>({
    queryKey: ['routers'],
    queryFn: () => api.get('/routers').then(r => r.data),
    enabled: showAllocateModal,
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['admin_subscriptions'] });

  const allocateMutation = useMutation({
    mutationFn: (data: { userId: string; packageId: string; routerId: string }) =>
      api.post('/subscriptions/allocate', data),
    onSuccess: () => {
      invalidate();
      setShowAllocateModal(false);
      setAllocateForm({ userId: '', packageId: '', routerId: '' });
      toast.success('Package allocated & activated successfully!');
    },
    onError: (err: any) => toast.error(err.response?.data?.message || 'Allocation failed'),
  });

  const activateMutation = useMutation({
    mutationFn: (id: string) =>
      api.post(`/subscriptions/${id}/activate`, { paymentMethod: 'manual', paymentRef: 'ADMIN_MANUAL' }),
    onSuccess: () => { invalidate(); toast.success('Subscription activated'); },
    onError: (err: any) => toast.error(err.response?.data?.message || 'Activation failed'),
  });

  const cancelMutation = useMutation({
    mutationFn: (id: string) => api.post(`/subscriptions/${id}/cancel`),
    onSuccess: () => { invalidate(); toast.success('Subscription cancelled'); },
    onError: (err: any) => toast.error(err.response?.data?.message || 'Cancel failed'),
  });

  const reactivateMutation = useMutation({
    mutationFn: (id: string) => api.post(`/subscriptions/${id}/reactivate`),
    onSuccess: () => { invalidate(); toast.success('Subscription reactivated!'); },
    onError: (err: any) => toast.error(err.response?.data?.message || 'Reactivation failed'),
  });

  if (isLoading)
    return (
      <div className="p-8 flex items-center gap-3 text-slate-400">
        <Clock className="animate-spin" size={20} /> Loading subscriptions...
      </div>
    );

  const activeCount = subs?.filter((s: any) => s.status?.toString().toLowerCase() === 'active').length ?? 0;

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-2xl font-bold">User Subscriptions</h2>
          <p className="text-sm text-slate-400 mt-1">
            {activeCount} active · {subs?.length ?? 0} total
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex bg-[rgba(0,0,0,0.2)] rounded-lg p-1 border border-white/5 mr-2">
            {(['all', 'pending', 'active', 'expired'] as const).map((f) => (
              <button
                key={f}
                onClick={() => setStatusFilter(f)}
                className={`px-3 py-1.5 text-[11px] font-bold uppercase tracking-wider rounded-md transition-all ${
                  statusFilter === f 
                  ? 'bg-cyan-500/20 text-cyan-400 shadow-sm' 
                  : 'text-slate-500 hover:text-slate-300'
                }`}
              >
                {f}
                {f === 'pending' && (subs?.filter((s:any) => s.status?.toString().toLowerCase() === 'pending').length || 0) > 0 && (
                  <span className="ml-1.5 w-1.5 h-1.5 bg-amber-500 rounded-full inline-block animate-pulse" />
                )}
              </button>
            ))}
          </div>
          <button
            className="btn-primary flex items-center gap-2"
            onClick={() => setShowAllocateModal(true)}
          >
            <PackagePlus size={18} /> Allocate Package
          </button>
        </div>
      </div>

      <div className="glass-panel p-0 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse min-w-[960px]">
            <thead className="bg-[rgba(0,0,0,0.2)]">
              <tr className="border-b border-[rgba(255,255,255,0.05)] text-slate-400 text-xs uppercase tracking-wide">
                <th className="p-4 font-semibold">User</th>
                <th className="p-4 font-semibold">Package</th>
                <th className="p-4 font-semibold">Router</th>
                <th className="p-4 font-semibold">Status</th>
                <th className="p-4 font-semibold">Countdown</th>
                <th className="p-4 font-semibold">Speed</th>
                <th className="p-4 font-semibold">Dates</th>
                <th className="p-4 font-semibold text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {subs
                ?.filter((s: any) => statusFilter === 'all' || s.status?.toString().toLowerCase() === statusFilter)
                ?.map((s: any) => (
                <tr
                  key={s.id}
                  className={`border-b border-[rgba(255,255,255,0.04)] last:border-0 hover:bg-[rgba(255,255,255,0.02)] transition-colors align-top
                    ${s.status?.toString().toLowerCase() === 'cancelled' || s.status?.toString().toLowerCase() === 'expired' ? 'opacity-60' : ''}`}
                >
                  {/* User */}
                  <td className="p-4">
                    <p className="font-semibold text-white text-sm">{s.user.name}</p>
                    <p className="text-xs text-slate-400 font-mono">{s.user.phone}</p>
                  </td>

                  {/* Package */}
                  <td className="p-4">
                    <p className="font-semibold text-cyan-400 text-sm">{s.package.name}</p>
                    <p className="text-xs text-slate-400">KES {s.amountPaid}</p>
                    {s.mikrotikUsername && (
                      <p className="text-[10px] font-mono text-slate-500 mt-1">{s.mikrotikUsername}</p>
                    )}
                  </td>

                  {/* Router */}
                  <td className="p-4">
                    <div className="flex items-center gap-1.5">
                      <RouterIcon size={13} className="text-slate-400 shrink-0" />
                      <span className="text-sm text-slate-300">{s.router.name}</span>
                    </div>
                  </td>

                  {/* Status */}
                  <td className="p-4">
                    <span className={`badge text-[11px] ${STATUS_STYLES[s.status?.toString().toLowerCase()] ?? 'badge-danger'}`}>
                      {s.status}
                    </span>
                  </td>

                  {/* Countdown */}
                  <td className="p-4">
                    {s.status?.toString().toLowerCase() === 'active' && s.expiresAt ? (
                      <CountdownBadge expiresAt={s.expiresAt} startedAt={s.startedAt} variant="inline" />
                    ) : (
                      <span className="text-xs text-slate-600">—</span>
                    )}
                  </td>

                  {/* Speed */}
                  <td className="p-4">
                    {s.status?.toString().toLowerCase() === 'active' ? (
                      <TrafficIndicator subId={s.id} />
                    ) : (
                      <span className="text-xs text-slate-600">—</span>
                    )}
                  </td>

                  {/* Dates */}
                  <td className="p-4 text-xs text-slate-400 space-y-0.5">
                    <p>Created: {new Date(s.createdAt).toLocaleString()}</p>
                    {s.expiresAt && (
                      <p className={new Date(s.expiresAt) < new Date() ? 'text-red-400' : ''}>
                        Expires: {new Date(s.expiresAt).toLocaleString()}
                      </p>
                    )}
                  </td>

                  {/* Actions */}
                  <td className="p-4 text-right">
                    <div className="flex items-center justify-end gap-2">
                      {s.status?.toString().toLowerCase() === 'pending' && (
                        <button
                          className="flex items-center gap-1 text-xs font-bold text-white bg-cyan-600 hover:bg-cyan-500 px-3 py-1.5 rounded-lg transition-colors"
                          onClick={() => setConfirmState({
                            isOpen: true,
                            title: 'Activate Manually',
                            message: 'Activate this subscription manually?',
                            onConfirm: () => { activateMutation.mutate(s.id); setConfirmState(st => ({...st, isOpen: false})); }
                          })}
                          disabled={activateMutation.isPending}
                        >
                          <CheckCircle size={13} /> Activate
                        </button>
                      )}

                      {s.status?.toString().toLowerCase() === 'active' && (
                        <button
                          className="flex items-center gap-1 text-xs font-bold text-red-400 hover:bg-red-500/10 border border-red-500/30 hover:border-red-500/60 px-3 py-1.5 rounded-lg transition-colors"
                          onClick={() => setConfirmState({
                            isOpen: true,
                            title: 'Cancel Subscription',
                            message: 'Cancel this subscription? The user will lose access immediately.',
                            onConfirm: () => { cancelMutation.mutate(s.id); setConfirmState(st => ({...st, isOpen: false})); }
                          })}
                          disabled={cancelMutation.isPending}
                        >
                          <XCircle size={13} /> Cancel
                        </button>
                      )}

                      {s.status?.toString().toLowerCase() === 'cancelled' && (
                        <button
                          className="flex items-center gap-1 text-xs font-bold text-cyan-400 hover:bg-cyan-500/10 border border-cyan-500/30 hover:border-cyan-500/60 px-3 py-1.5 rounded-lg transition-colors"
                          onClick={() => reactivateMutation.mutate(s.id)}
                          disabled={reactivateMutation.isPending}
                        >
                          <RefreshCw size={13} /> Reactivate
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}

              {subs?.length === 0 && (
                <tr>
                  <td colSpan={7} className="p-8 text-center text-slate-500">No subscriptions found</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── Global Allocate Package Modal ── */}
      {showAllocateModal && createPortal(
        <div 
          className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[9999] flex items-center justify-center p-4"
          onMouseDown={(e) => { if (e.target === e.currentTarget) setShowAllocateModal(false); }}
        >
          <div className="glass-panel w-full max-w-2xl animate-fade-in bg-slate-900 border border-slate-700 shadow-2xl rounded-2xl overflow-hidden flex flex-col">
            <div className="flex items-center gap-3 p-6 border-b border-white/10">
              <div className="w-10 h-10 rounded-full bg-purple-500/10 border border-purple-500/30 flex items-center justify-center text-purple-400">
                <PackagePlus size={18} />
              </div>
              <div>
                <h3 className="text-xl font-bold text-white">Allocate Package</h3>
                <p className="text-sm text-slate-400">Assign a new plan to any customer</p>
              </div>
            </div>

            <form
              onSubmit={(e) => { 
                e.preventDefault(); 
                allocateMutation.mutate({ 
                  userId: allocateForm.userId, 
                  packageId: allocateForm.packageId, 
                  routerId: allocateForm.routerId 
                }); 
              }}
              className="p-6 overflow-y-auto max-h-[calc(90vh-140px)] custom-scrollbar flex flex-col gap-6"
            >
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-1.5">Select Customer</label>
                <select 
                  className="w-full bg-slate-800 border border-slate-700 rounded-lg p-3 text-white focus:ring-2 focus:ring-purple-500 transition-all appearance-none" 
                  value={allocateForm.userId} 
                  onChange={e => setAllocateForm({ ...allocateForm, userId: e.target.value })} 
                  required
                >
                  <option value="">— Choose a customer —</option>
                  {users?.map(u => (
                    <option key={u.id} value={u.id}>
                      {u.name} ({u.phone})
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-1.5">Select Package</label>
                  <select 
                    className="w-full bg-slate-800 border border-slate-700 rounded-lg p-3 text-white focus:ring-2 focus:ring-purple-500 transition-all appearance-none" 
                    value={allocateForm.packageId} 
                    onChange={e => setAllocateForm({ ...allocateForm, packageId: e.target.value })} 
                    required
                  >
                    <option value="">— Choose a package —</option>
                    {packages?.filter(p => p.isActive).map(p => (
                      <option key={p.id} value={p.id}>{p.name}</option>
                    ))}
                  </select>
                  {allocateForm.packageId && (
                    <p className="mt-2 text-xs text-purple-400 font-medium">
                      {packages?.find(p => p.id === allocateForm.packageId)?.price} KES / {packages?.find(p => p.id === allocateForm.packageId)?.durationValue} {packages?.find(p => p.id === allocateForm.packageId)?.durationType}
                    </p>
                  )}
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-1.5">Select Router</label>
                  <select 
                    className="w-full bg-slate-800 border border-slate-700 rounded-lg p-3 text-white focus:ring-2 focus:ring-purple-500 transition-all appearance-none" 
                    value={allocateForm.routerId} 
                    onChange={e => setAllocateForm({ ...allocateForm, routerId: e.target.value })} 
                    required
                  >
                    <option value="">— Choose a router —</option>
                    {routers?.map(r => (
                      <option key={r.id} value={r.id} disabled={!r.isOnline}>
                        {r.name} {r.isOnline ? '🟢' : '🔴 (offline)'}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="p-4 rounded-xl bg-purple-500/5 border border-purple-500/20 text-xs text-slate-400 leading-relaxed">
                <strong className="text-purple-300">Note:</strong> This will immediately activate the selected package on the MikroTik router for this user. No payment is required — the subscription will be marked as <strong className="text-white">manual</strong>.
              </div>

              <div className="flex justify-end gap-4 mt-6 pt-6 border-t border-white/5">
                <button 
                  type="button" 
                  className="px-6 py-2.5 rounded-lg font-bold text-slate-400 hover:text-white hover:bg-slate-800 transition-all" 
                  onClick={() => setShowAllocateModal(false)} 
                  disabled={allocateMutation.isPending}
                >
                  Cancel
                </button>
                <button 
                  type="submit" 
                  className="px-8 py-2.5 rounded-lg font-bold bg-gradient-to-r from-purple-600 to-indigo-600 text-white hover:from-purple-500 hover:to-indigo-500 shadow-lg shadow-purple-900/20 transition-all transform active:scale-95 flex items-center gap-2" 
                  disabled={allocateMutation.isPending}
                >
                  {allocateMutation.isPending ? <><Loader2 size={16} className="animate-spin" /> Activating...</> : <><PackagePlus size={16} /> Activate Package</>}
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
        isLoading={activateMutation.isPending || cancelMutation.isPending}
      />
    </div>
  );
}
