import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import { User as UserIcon, ShieldAlert, ArrowRight, Phone, Mail, Lock, Eye, EyeOff, RefreshCw, Key } from 'lucide-react';
import { useEffect } from 'react';
import api from '../../services/api';
import { storeHotspotContext } from '../../services/hotspot';

export default function Login() {
  const navigate = useNavigate();
  const [role, setRole] = useState<'user' | 'admin'>('user');
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);

  // OTP / 2FA States
  const [isOtpStep, setIsOtpStep] = useState(false);
  const [otp, setOtp] = useState('');
  const [adminId, setAdminId] = useState<string | null>(null);
  const [isFlashLogin, setIsFlashLogin] = useState(false); // For user OTP login

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    storeHotspotContext(params, window.location.origin);
  }, []);

  const handleInitialSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      const endpoint = role === 'admin' ? '/auth/admin/login' : '/auth/user/login';
      const payload = { identifier: identifier.trim(), password };
        
      const res = await api.post(endpoint, payload);
      
      // Check for 2FA challenge (Admin Only)
      if (res.data.challengeRequired) {
        setIsOtpStep(true);
        setAdminId(res.data.adminId);
        toast.success(`Security Code sent to ${res.data.phone}`, { icon: '🔐' });
        setLoading(false);
        return;
      }

      handleSuccess(res.data);
    } catch (err: any) {
      toast.error(err.response?.data?.message || 'Access denied');
      setLoading(false);
    }
  };

  const handleOtpVerify = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      let res;
      if (role === 'admin') {
        res = await api.post('/auth/admin/login-otp', { adminId, code: otp });
      } else {
        res = await api.post('/auth/user/login-otp', { phone: identifier, code: otp });
      }
      handleSuccess(res.data);
    } catch (err: any) {
      toast.error(err.response?.data?.message || 'Invalid or expired code');
      setLoading(false);
    }
  };

  const requestUserFlashLogin = async () => {
    if (!identifier) {
      toast.error('Please enter your phone number first');
      return;
    }
    setLoading(true);
    try {
      await api.post('/auth/user/request-otp', { phone: identifier });
      setIsOtpStep(true);
      setIsFlashLogin(true);
      toast.success('Flash Login code sent!', { icon: '⚡' });
    } catch (err: any) {
      toast.error(err.response?.data?.message || 'Failed to send code');
    } finally {
      setLoading(false);
    }
  };

  const handleSuccess = async (authData: any) => {
    localStorage.setItem('token', authData.access_token);
    
    const profileRes = await api.get('/auth/profile', {
      headers: { Authorization: `Bearer ${authData.access_token}` }
    });
    
    localStorage.setItem('role', profileRes.data.role);
    localStorage.setItem('user', JSON.stringify(profileRes.data));
    
    toast.success('Authentication successful!');
    
    if (profileRes.data.role === 'admin' || profileRes.data.role === 'superadmin') {
      navigate('/admin/dashboard');
    } else {
      navigate('/user/dashboard');
    }
  };

  if (isOtpStep) {
    return (
      <div style={{ width: '100%' }}>
        <div className="auth-header">
           <div className="w-16 h-16 bg-cyan-500/10 rounded-2xl flex items-center justify-center text-cyan-500 mx-auto mb-6 border border-cyan-500/20 animate-pulse">
              <Key size={32} />
           </div>
           <h2>{role === 'admin' ? 'Two-Factor Auth' : 'Flash Login'}</h2>
           <p className="text-sm">Please enter the {otp.length}/4 code sent via SMS.</p>
        </div>

        <form onSubmit={handleOtpVerify} className="auth-form mt-8">
           <div className="form-group">
              <div className="input-wrapper">
                 <input 
                    autoFocus
                    type="text" 
                    className="auth-input text-center tracking-[1em] font-black text-2xl" 
                    placeholder="••••"
                    maxLength={role === 'admin' ? 4 : 4} // Consistent 4-digit code
                    value={otp}
                    onChange={e => setOtp(e.target.value.replace(/\D/g, ''))}
                    required
                 />
              </div>
           </div>

           <button 
            type="submit" 
            disabled={loading || otp.length < 4} 
            className="auth-submit-btn"
          >
            {loading ? 'Verifying...' : 'Unlock Access'}
            {!loading && <ArrowRight size={18} />}
          </button>

          <button 
            type="button"
            onClick={() => { setIsOtpStep(false); setOtp(''); setIsFlashLogin(false); }}
            className="w-full mt-4 text-[10px] font-black uppercase tracking-widest text-muted hover:text-main transition-colors"
          >
            Cancel & Go Back
          </button>
        </form>
      </div>
    );
  }

  return (
    <div style={{ width: '100%' }}>
      <div className="auth-header">
        <h2 className="text-3xl font-black uppercase tracking-tighter text-main">Welcome back</h2>
        <p className="text-sm font-bold uppercase tracking-widest text-muted opacity-60">Please enter your credentials</p>
      </div>

      <div className="role-toggle">
        <button
          type="button"
          onClick={() => { setRole('user'); setIdentifier(''); setPassword(''); setIsFlashLogin(false); }}
          className={`role-btn ${role === 'user' ? 'active user' : ''}`}
        >
          <UserIcon size={16} /> Customer
        </button>
        <button
          type="button"
          onClick={() => { setRole('admin'); setIdentifier(''); setPassword(''); setIsFlashLogin(false); }}
          className={`role-btn ${role === 'admin' ? 'active admin' : ''}`}
        >
          <ShieldAlert size={16} /> Admin
        </button>
      </div>

      <form onSubmit={handleInitialSubmit} className="auth-form">
        <div className="form-group">
            <label className="text-[10px] font-black uppercase tracking-widest text-muted ml-1 mb-2 block">
              {role === 'admin' ? 'Manager ID' : 'Phone Number'}
            </label>
            <div className="input-wrapper">
              <div className="input-icon">
                {role === 'admin' ? <UserIcon size={18} /> : <Phone size={18} />}
              </div>
              <input
                type="text"
                className="auth-input"
                value={identifier}
                onChange={(e) => setIdentifier(e.target.value)}
                placeholder={role === 'admin' ? 'Email or Username' : '07XXXXXXXX'}
                required
              />
          </div>
        </div>

        <div className="form-group">
          <div className="flex items-center justify-between ml-1 mb-2">
            <label className="text-[10px] font-black uppercase tracking-widest text-muted">Password</label>
            {role === 'user' && (
               <button 
                 type="button"
                 onClick={requestUserFlashLogin}
                 className="text-[9px] font-black uppercase tracking-widest text-cyan-400 hover:text-cyan-300"
               >
                 Flash Login (OTP)
               </button>
            )}
          </div>
          <div className="input-wrapper">
            <div className="input-icon">
              <Lock size={18} />
            </div>
            <input
              type={showPassword ? "text" : "password"}
              className={`auth-input ${password ? 'has-toggle' : ''}`}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              required
            />
            {password && (
              <button
                type="button"
                className="password-toggle"
                onClick={() => setShowPassword(!showPassword)}
                aria-label={showPassword ? "Hide password" : "Show password"}
              >
                {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            )}
          </div>
        </div>

        <button 
          type="submit" 
          disabled={loading} 
          className="auth-submit-btn group"
        >
          {loading ? <RefreshCw className="animate-spin" size={18} /> : 'Secure Entry'}
          {!loading && <ArrowRight size={18} className="group-hover:translate-x-1 transition-transform" />}
        </button>
      </form>

      {role === 'user' && (
        <div className="auth-link-section mt-8">
          <p className="text-[10px] font-black uppercase tracking-widest text-muted text-center">
            New to the network?{' '}
            <Link to="/register" className="text-cyan-400 hover:text-cyan-300 transition-colors">
              Create an account
            </Link>
          </p>
        </div>
      )}
    </div>
  );
}
