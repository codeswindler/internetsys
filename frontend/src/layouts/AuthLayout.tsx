import { Outlet, Navigate, useLocation } from 'react-router-dom';
import bgImage from '../assets/auth_background.png';
import '../auth.css';

export default function AuthLayout() {
  const token = localStorage.getItem('token');
  const role = localStorage.getItem('role');
  const location = useLocation();
  const params = new URLSearchParams(location.search);
  const returnTo = params.get('returnTo');

  if (token) {
    if (role === 'admin' || role === 'superadmin') {
      return <Navigate to={`/admin/dashboard${location.search}`} replace />;
    }
    return <Navigate to={returnTo || `/user/dashboard${location.search}`} replace />;
  }

  return (
    <div className="auth-wrapper glass-noise">
      {/* Left Side - Image/Branding */}
      <div className="auth-left">
        <div className="auth-bg-overlay-1"></div>
        <div className="auth-bg-overlay-2"></div>
        <img 
          src={bgImage} 
          alt="ISP Background" 
          className="auth-bg-image"
        />
        
        <div className="auth-brand-content animate-fade-in px-10">
          <div className="auth-logo-large shadow-[0_0_60px_rgba(6,182,212,0.6)] border border-white/20">PL</div>
          <h1 className="auth-title-large">PulseLynk</h1>
          <div className="auth-subtitle">
            <span className="text-cyan-400 font-black">PREMIUM</span>
            <span className="opacity-40">•</span>
            <span>ISP CONNECT</span>
          </div>
        </div>
      </div>

      {/* Right Side - Form Container */}
      <div className="auth-right">
        {/* Mobile Header */}
        <div className="auth-mobile-header">
          <div className="auth-mobile-bg">
            <img src={bgImage} alt="" className="auth-mobile-bg-img" />
            <div className="auth-mobile-overlay"></div>
          </div>
          <div className="auth-logo-small">PL</div>
          <h1 className="auth-title-small">PulseLynk</h1>
          <p className="auth-subtitle-small">Premium ISP Experience</p>
        </div>

        {/* Dynamic Outlet Form */}
        <div className="auth-form-container animate-fade-in shadow-2xl">
          <Outlet />
        </div>
        
        <div className="auth-footer">
          &copy; {new Date().getFullYear()} PulseLynk ISP Management. <span className="text-cyan-500/50">v6.0</span>
        </div>

        <a 
          href="https://pulsecloud.theleasemaster.com" 
          target="_blank" 
          rel="noopener noreferrer" 
          className="auth-powered"
        >
          <div className="auth-powered-dot"></div>
          <span>Powered by LeaseMaster Pulse Cloud</span>
        </a>
      </div>
    </div>
  );
}
