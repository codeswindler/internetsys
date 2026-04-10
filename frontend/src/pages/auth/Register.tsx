import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import { User as UserIcon, Phone, Lock, ArrowRight } from 'lucide-react';
import { useEffect } from 'react';
import api from '../../services/api';
import { storeHotspotContext } from '../../services/hotspot';

export default function Register() {
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [username, setUsername] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    storeHotspotContext(params, window.location.origin);
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    if (!username) {
      toast.error('Username is compulsory');
      setLoading(false);
      return;
    }

    try {
      const res = await api.post('/auth/user/register', { name, phone, password, username });
      
      localStorage.setItem('token', res.data.access_token);
      localStorage.setItem('role', 'user');
      
      toast.success('Registration successful! Welcome aboard.');
      navigate('/user/dashboard');
    } catch (err: any) {
      toast.error(err.response?.data?.message || 'Registration failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ width: '100%' }}>
      <div className="auth-header" style={{ textAlign: 'center' }}>
        <h2>Create your account</h2>
        <p>Join our network for high-speed internet access.</p>
      </div>

      <form onSubmit={handleSubmit} className="auth-form">
        <div className="form-group">
          <label>Unique Username</label>
          <div className="input-wrapper">
            <div className="input-icon">
              <UserIcon size={18} />
            </div>
            <input
              type="text"
              className="auth-input"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="e.g. johndoe123"
              required
            />
          </div>
        </div>

        <div className="form-group">
          <label>Full Legal Name</label>
          <div className="input-wrapper">
            <div className="input-icon">
              <UserIcon size={18} />
            </div>
            <input
              type="text"
              className="auth-input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. John Doe"
              required
            />
          </div>
        </div>

        <div className="form-group">
          <label>Mobile Number</label>
          <div className="input-wrapper">
            <div className="input-icon">
              <Phone size={18} />
            </div>
            <input
              type="text"
              className="auth-input"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="e.g. 07XXXXXXXX"
              required
            />
          </div>
        </div>

        <div className="form-group">
          <label>Secure Password</label>
          <div className="input-wrapper">
            <div className="input-icon">
              <Lock size={18} />
            </div>
            <input
              type="password"
              className="auth-input"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              required
              minLength={6}
            />
          </div>
        </div>

        <button 
          type="submit" 
          disabled={loading} 
          className="auth-submit-btn"
        >
          {loading ? 'Processing...' : 'Complete Registration'}
          {!loading && <ArrowRight size={18} />}
        </button>
      </form>

      <div className="auth-link-section">
        <p>
          Already have an account?{' '}
          <Link to="/login" className="auth-link">
            Sign In here
          </Link>
        </p>
      </div>
    </div>
  );
}
