import { useState } from 'react';
import { createPortal } from 'react-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { Ticket, Plus } from 'lucide-react';
import api from '../../services/api';

export default function Vouchers() {
  const queryClient = useQueryClient();
  const [showModal, setShowModal] = useState(false);
  const [formData, setFormData] = useState({ packageId: '', count: 10 });

  const { data: vouchers, isLoading: vouchersLoading } = useQuery({
    queryKey: ['vouchers'],
    queryFn: () => api.get('/vouchers').then(res => res.data),
  });

  const { data: packages, isLoading: pkgsLoading } = useQuery({
    queryKey: ['packages', 'all'],
    queryFn: () => api.get('/packages/all').then(res => res.data),
  });

  const generateMutation = useMutation({
    mutationFn: (data: any) => api.post('/vouchers/generate', data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['vouchers'] });
      setShowModal(false);
      toast.success('Vouchers generated successfully');
    },
    onError: () => toast.error('Failed to generate vouchers')
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.packageId) return toast.error('Please select a package');
    generateMutation.mutate(formData);
  };

  if (vouchersLoading || pkgsLoading) return <div className="p-8">Loading...</div>;

  return (
    <div>
      <div className="flex justify-between items-center mb-6">
        <h2 className="text-2xl font-bold">Voucher Management</h2>
        <button className="btn-primary flex items-center gap-2" onClick={() => setShowModal(true)}>
          <Plus size={18} /> Generate Batch
        </button>
      </div>

      <div className="glass-panel p-6">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-[rgba(255,255,255,0.05)] text-slate-400 text-sm">
                <th className="p-3 font-medium">Code</th>
                <th className="p-3 font-medium">Package</th>
                <th className="p-3 font-medium">Status</th>
                <th className="p-3 font-medium">Redeemed By</th>
                <th className="p-3 font-medium">Created Date</th>
              </tr>
            </thead>
            <tbody>
              {vouchers?.map((v: any) => (
                <tr key={v.id} className="border-b border-[rgba(255,255,255,0.05)] last:border-0 hover:bg-[rgba(255,255,255,0.02)]">
                  <td className="p-3 font-mono font-bold text-lg text-cyan-400 flex items-center gap-2">
                    <Ticket size={16} /> {v.code}
                  </td>
                  <td className="p-3">{v.package?.name}</td>
                  <td className="p-3">
                    <span className={`badge ${v.isRedeemed ? 'badge-danger' : 'badge-success'}`}>
                      {v.isRedeemed ? 'Used' : 'Available'}
                    </span>
                  </td>
                  <td className="p-3">
                    {v.redeemedByUser ? `${v.redeemedByUser.name} (${v.redeemedByUser.phone})` : '-'}
                  </td>
                  <td className="p-3 text-slate-400 text-sm">{new Date(v.createdAt).toLocaleDateString()}</td>
                </tr>
              ))}
              {vouchers?.length === 0 && (
                <tr>
                  <td colSpan={5} className="p-8 text-center text-slate-500">No vouchers generated yet.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {showModal && createPortal(
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[9999] flex flex-col items-center justify-center p-4" onMouseDown={(e) => { if (e.target === e.currentTarget) setShowModal(false); }}>
          <div className="glass-panel p-6 w-full max-w-md animate-fade-in sm:max-w-lg relative z-[10000] bg-slate-900 border border-slate-700 shadow-2xl rounded-2xl">
            <h3 className="text-2xl font-bold mb-6 text-white border-b border-white/10 pb-4">Generate Vouchers</h3>
            <form onSubmit={handleSubmit} className="flex flex-col gap-5">
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-1.5">Select Package</label>
                <select className="w-full bg-slate-800/50 border border-slate-700 rounded-lg p-3 text-white focus:ring-2 focus:ring-cyan-500 transition-all font-medium" value={formData.packageId} onChange={e => setFormData({...formData, packageId: e.target.value})} required>
                  <option value="" disabled>Select a package...</option>
                  {packages?.map((pkg: any) => (
                    <option key={pkg.id} value={pkg.id}>{pkg.name} - KES {pkg.price}</option>
                  ))}
                </select>
              </div>
              
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-1.5">Number of Vouchers</label>
                <input className="w-full bg-slate-800/50 border border-slate-700 rounded-lg p-3 text-white focus:ring-2 focus:ring-cyan-500 transition-all font-medium text-center" type="number" min="1" max="100" value={formData.count} onChange={e => setFormData({...formData, count: parseInt(e.target.value)})} required />
              </div>

              <div className="flex justify-end gap-4 mt-6 pt-4 border-t border-white/5">
                <button type="button" className="px-5 py-2.5 rounded-lg font-bold text-slate-300 hover:text-white hover:bg-slate-800 transition-all border border-transparent hover:border-slate-600" onClick={() => setShowModal(false)}>Cancel</button>
                <button type="submit" className="px-6 py-2.5 rounded-lg font-bold bg-gradient-to-r from-purple-500 to-pink-500 text-white hover:from-purple-400 hover:to-pink-400 shadow-lg shadow-purple-500/25 transition-all transform active:scale-95" disabled={generateMutation.isPending}>Generate</button>
              </div>
            </form>
          </div>
        </div>, document.body
      )}
    </div>
  );
}
