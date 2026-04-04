import { useState } from 'react';
import { Shield, Lock, Eye, EyeOff, RefreshCw } from 'lucide-react';
import { useMutation } from '@tanstack/react-query';
import axios from 'axios';
import toast from 'react-hot-toast';

interface ChangePasswordModalProps {
  userId: string;
  onSuccess: () => void;
}

export default function ChangePasswordModal({ userId, onSuccess }: ChangePasswordModalProps) {
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPass, setShowPass] = useState(false);
  const [showConfirmPass, setShowConfirmPass] = useState(false);
  const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000';

  const mutation = useMutation({
    mutationFn: async (newPassword: string) => {
      const token = localStorage.getItem('token');
      // Use POST (not PUT) /auth/profile which is the correct endpoint
      return axios.post(`${API_URL}/auth/profile`, { password: newPassword }, {
        headers: { Authorization: `Bearer ${token}` }
      });
    },
    onSuccess: () => {
      toast.success('Password updated! Welcome to PulseLynk.');
      
      // Update local storage to reflect change
      const userStr = localStorage.getItem('user');
      if (userStr) {
        try {
          const user = JSON.parse(userStr);
          user.forcePasswordChange = false;
          localStorage.setItem('user', JSON.stringify(user));
        } catch {}
      }
      
      onSuccess();
    },
    onError: (err: any) => {
      toast.error(err.response?.data?.message || 'Failed to update password');
    }
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (password.length < 6) {
      return toast.error('Password must be at least 6 characters');
    }
    if (password !== confirmPassword) {
      return toast.error('Passwords do not match');
    }
    mutation.mutate(password);
  };

  return (
    <div className="fixed inset-0 z-[20000] flex items-center justify-center p-4 overflow-y-auto" style={{ backdropFilter: 'blur(32px)', backgroundColor: 'rgba(5,10,25,0.95)' }}>
      <div className="w-full max-w-md my-auto rounded-[2.5rem] border border-cyan-500/20 bg-slate-900 shadow-2xl p-8 relative overflow-hidden animate-scale-in">
        {/* Glow accents */}
        <div className="absolute -top-20 -right-20 w-40 h-40 bg-cyan-500/10 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute -bottom-20 -left-20 w-40 h-40 bg-blue-500/10 rounded-full blur-3xl pointer-events-none" />

        <div className="relative text-center mb-8">
          <div className="w-16 h-16 bg-cyan-500/10 rounded-2xl flex items-center justify-center mx-auto mb-6 border border-cyan-500/20">
            <Shield size={32} className="text-cyan-400" />
          </div>
          <h2 className="text-2xl font-black text-white uppercase tracking-tighter mb-2 leading-tight">Security Update Required</h2>
          <p className="text-slate-400 font-bold uppercase tracking-widest text-[10px] opacity-70">Please set a private password to secure your account</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-5 relative">
          {/* New Password */}
          <div className="space-y-2">
            <label className="text-[9px] font-black text-slate-400 uppercase tracking-[0.2em] ml-1">New Secret Password</label>
            <div className="relative">
              <div className="absolute left-4 top-1/2 -translate-y-1/2 text-cyan-500/40">
                <Lock size={16} />
              </div>
              <input
                type={showPass ? "text" : "password"}
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full bg-black/40 border border-white/5 focus:border-cyan-500/50 rounded-xl py-4 pl-12 pr-12 text-white font-bold tracking-wider placeholder:text-white/10 transition-all outline-none text-sm"
                placeholder="Min 6 characters"
              />
              <button
                type="button"
                onClick={() => setShowPass(!showPass)}
                className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-500 hover:text-white transition-colors"
              >
                {showPass ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </div>

          {/* Confirm Password */}
          <div className="space-y-2">
            <label className="text-[9px] font-black text-slate-400 uppercase tracking-[0.2em] ml-1">Confirm Secret Password</label>
            <div className="relative">
              <div className="absolute left-4 top-1/2 -translate-y-1/2 text-cyan-500/40">
                <Lock size={16} />
              </div>
              <input
                type={showConfirmPass ? "text" : "password"}
                required
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className="w-full bg-black/40 border border-white/5 focus:border-cyan-500/50 rounded-xl py-4 pl-12 pr-12 text-white font-bold tracking-wider placeholder:text-white/10 transition-all outline-none text-sm"
                placeholder="Repeat password"
              />
              <button
                type="button"
                onClick={() => setShowConfirmPass(!showConfirmPass)}
                className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-500 hover:text-white transition-colors"
              >
                {showConfirmPass ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </div>

          {/* Submit */}
          <button
            type="submit"
            disabled={mutation.isPending}
            className="w-full py-4 bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 text-white font-black uppercase tracking-[0.2em] text-xs rounded-xl shadow-xl shadow-cyan-500/20 active:scale-[0.98] transition-all flex items-center justify-center gap-3 disabled:opacity-60 mt-2"
          >
            {mutation.isPending ? <RefreshCw className="animate-spin" size={16} /> : <Shield size={16} />}
            {mutation.isPending ? 'Updating...' : 'Secure Account'}
          </button>
        </form>
      </div>
    </div>
  );
}
