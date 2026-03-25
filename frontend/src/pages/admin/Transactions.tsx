import { useQuery } from '@tanstack/react-query';
import { DollarSign, Search, Filter, ArrowUpRight, ArrowDownRight, User, Package, Clock } from 'lucide-react';
import api from '../../services/api';

export default function Transactions() {
  const { data: transactions, isLoading } = useQuery({
    queryKey: ['admin_transactions'],
    queryFn: () => api.get('/transactions').then(res => res.data),
  });

  const getMethodBadge = (method: string) => {
    switch (method) {
      case 'mpesa_stk': return 'badge-success bg-green-500/10 text-green-400 border-green-500/20';
      case 'voucher': return 'badge-primary bg-blue-500/10 text-blue-400 border-blue-500/20';
      case 'manual': return 'badge-warning bg-amber-500/10 text-amber-400 border-amber-500/20';
      default: return 'badge-secondary';
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'completed': return 'text-green-400 bg-green-400/10';
      case 'pending': return 'text-amber-400 bg-amber-400/10';
      case 'failed': return 'text-red-400 bg-red-400/10';
      default: return 'text-slate-400 bg-slate-400/10';
    }
  };

  if (isLoading) return <div className="p-8 text-slate-400">Loading transactions...</div>;

  return (
    <div className="animate-fade-in">
      <div className="flex justify-between items-center mb-8">
        <div>
          <h2 className="text-3xl font-extrabold text-white tracking-tight">Revenue & Transactions</h2>
          <p className="text-slate-400 mt-1">Monitor all internet subscription payments and allocations.</p>
        </div>
        
        <div className="flex gap-3">
          <button className="px-4 py-2 bg-slate-800 border border-slate-700 rounded-lg text-slate-300 hover:text-white transition-all text-sm font-bold flex items-center gap-2">
            <Filter size={16} /> Filter
          </button>
          <button className="px-4 py-2 bg-slate-800 border border-slate-700 rounded-lg text-slate-300 hover:text-white transition-all text-sm font-bold flex items-center gap-2">
            <ArrowUpRight size={16} /> Export
          </button>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
        <div className="glass-panel p-6 border-green-500/20">
          <p className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-1">Total Revenue</p>
          <p className="text-3xl font-black text-white">
            <span className="text-sm font-bold text-slate-400 mr-1">KES</span>
            {transactions?.reduce((sum: number, tx: any) => sum + Number(tx.amount), 0).toLocaleString()}
          </p>
          <div className="mt-4 flex items-center gap-2 text-xs text-green-400">
            <ArrowUpRight size={14} /> 12% increase from last month
          </div>
        </div>
        
        <div className="glass-panel p-6 border-blue-500/20">
          <p className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-1">Active Users</p>
          <p className="text-3xl font-black text-white">
            {new Set(transactions?.map((tx: any) => tx.userId)).size}
          </p>
          <div className="mt-4 flex items-center gap-2 text-xs text-blue-400">
            <User size={14} /> Unique paying customers
          </div>
        </div>

        <div className="glass-panel p-6 border-purple-500/20">
          <p className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-1">Avg. Transaction</p>
          <p className="text-3xl font-black text-white">
            <span className="text-sm font-bold text-slate-400 mr-1">KES</span>
            {Math.round((transactions?.reduce((sum: number, tx: any) => sum + Number(tx.amount), 0) / (transactions?.length || 1)) || 0)}
          </p>
          <div className="mt-4 flex items-center gap-2 text-xs text-purple-400">
            <Package size={14} /> Per subscription purchase
          </div>
        </div>
      </div>

      <div className="glass-panel overflow-hidden border-white/5 shadow-2xl">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-white/5 text-[10px] uppercase tracking-widest text-slate-400 font-bold border-b border-white/5">
                <th className="px-6 py-4">Transaction ID</th>
                <th className="px-6 py-4">Customer</th>
                <th className="px-6 py-4">Package</th>
                <th className="px-6 py-4">Method</th>
                <th className="px-6 py-4">Amount</th>
                <th className="px-6 py-4">Status</th>
                <th className="px-6 py-4">Date</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {transactions?.map((tx: any) => (
                <tr key={tx.id} className="hover:bg-white/[0.02] transition-colors group">
                  <td className="px-6 py-4">
                    <span className="font-mono text-xs text-slate-500 group-hover:text-slate-300 transition-colors">
                      {tx.id.substring(0, 8)}...
                    </span>
                  </td>
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-full bg-slate-800 flex items-center justify-center text-[10px] font-bold text-cyan-400">
                        {tx.user?.name?.[0] || 'U'}
                      </div>
                      <div>
                        <p className="text-sm font-bold text-white leading-none">{tx.user?.name || 'Customer'}</p>
                        <p className="text-[10px] text-slate-500 mt-1">{tx.user?.phone}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    <p className="text-sm font-medium text-slate-300">{tx.package?.name}</p>
                  </td>
                  <td className="px-6 py-4">
                    <span className={`px-2.5 py-1 rounded-md text-[10px] font-bold uppercase tracking-wider border ${getMethodBadge(tx.method)}`}>
                      {tx.method.replace('_', ' ')}
                    </span>
                  </td>
                  <td className="px-6 py-4">
                    <p className="text-sm font-bold text-white">KES {tx.amount}</p>
                  </td>
                  <td className="px-6 py-4">
                    <div className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-full text-[10px] font-bold uppercase tracking-tight ${getStatusBadge(tx.status)}`}>
                      <div className={`w-1.5 h-1.5 rounded-full ${tx.status === 'completed' ? 'bg-green-400' : tx.status === 'pending' ? 'bg-amber-400' : 'bg-red-400'}`}></div>
                      {tx.status}
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-2 text-slate-400">
                      <Clock size={14} className="opacity-50" />
                      <span className="text-xs">{new Date(tx.createdAt).toLocaleString()}</span>
                    </div>
                  </td>
                </tr>
              ))}
              {transactions?.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-6 py-12 text-center text-slate-500 italic">
                    No transactions recorded yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
