import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import { User as UserIcon, ShieldAlert, ArrowRight, Phone, Mail, Lock, Eye, EyeOff } from 'lucide-react';
import api from '../../services/api';

export default function Login() {
  const navigate = useNavigate();
  const [role, setRole] = useState<'user' | 'admin'>('user');
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      const endpoint = role === 'admin' ? '/auth/admin/login' : '/auth/user/login';
      const payload = { identifier, password };
        
      const res = await api.post(endpoint, payload);
      
      localStorage.setItem('token', res.data.access_token);
      
      const profileRes = await api.get('/auth/profile', {
        headers: { Authorization: `Bearer ${res.data.access_token}` }
      });
      
      localStorage.setItem('role', profileRes.data.role);
      localStorage.setItem('user', JSON.stringify(profileRes.data));
      
      toast.success('Authentication successful!');
      
      if (profileRes.data.role === 'admin' || profileRes.data.role === 'superadmin') {
        navigate('/admin/dashboard');
      } else {
        navigate('/user/packages');
      }
    } catch (err: any) {
      toast.error(err.response?.data?.message || 'Access denied');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ width: '100%' }}>
      <div className="auth-header">
        <h2>Welcome back</h2>
        <p>Please enter your details to sign in.</p>
      </div>

      <div className="role-toggle">
        <button
          type="button"
          onClick={() => { setRole('user'); setIdentifier(''); setPassword(''); }}
          className={`role-btn ${role === 'user' ? 'active user' : ''}`}
        >
          <UserIcon size={16} /> Customer
        </button>
        <button
          type="button"
          onClick={() => { setRole('admin'); setIdentifier(''); setPassword(''); }}
          className={`role-btn ${role === 'admin' ? 'active admin' : ''}`}
        >
          <ShieldAlert size={16} /> Admin
        </button>
      </div>

      <form onSubmit={handleSubmit} className="auth-form">
        <div className="form-group">
            <label>
              {role === 'admin' ? 'Admin ID' : 'Mobile Number'}
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
                placeholder={role === 'admin' ? 'Email, Username or Phone' : 'e.g. 0712345678'}
                required
              />
          </div>
        </div>

        <div className="form-group">
          <label>Password</label>
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
          className="auth-submit-btn"
        >
          {loading ? 'Authenticating...' : 'Sign In'}
          {!loading && <ArrowRight size={18} />}
        </button>
      </form>

      {role === 'user' && (
        <div className="auth-link-section">
          <p>
            New to the network?{' '}
            <Link to="/register" className="auth-link">
              Create an account
            </Link>
          </p>
        </div>
      )}
    </div>
  );
}
