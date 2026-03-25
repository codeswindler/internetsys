import { Outlet, Navigate } from 'react-router-dom';
import bgImage from '../assets/auth_background.png';
import '../auth.css';

export default function AuthLayout() {
  const token = localStorage.getItem('token');
  const role = localStorage.getItem('role');

  if (token) {
    if (role === 'admin' || role === 'superadmin') {
      return <Navigate to="/admin/dashboard" replace />;
    }
    return <Navigate to="/user/packages" replace />;
  }

  return (
    <div className="auth-wrapper">
      {/* Left Side - Image/Branding */}
      <div className="auth-left">
        <div className="auth-bg-overlay-1"></div>
        <div className="auth-bg-overlay-2"></div>
        <img 
          src={bgImage} 
          alt="ISP Background" 
          className="auth-bg-image"
        />
        
        <div className="auth-brand-content">
          <div className="auth-logo-large animate-pulse-slow">PL</div>
          <h1 className="auth-title-large">PulseLynk</h1>
          <p className="auth-subtitle">
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-cyan-400 to-blue-400 font-bold">
              Affordable. Reliable. Flexible. Convenient.
            </span>
          </p>
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
          <div className="auth-logo-small animate-pulse-slow">PL</div>
          <h1 className="auth-title-small">PulseLynk</h1>
          <p className="auth-subtitle-small">Affordable. Reliable. Flexible.</p>
        </div>

        {/* Dynamic Outlet Form */}
        <div className="auth-form-container animate-fade-in">
          <Outlet />
        </div>
        
        <div className="auth-footer">
          &copy; {new Date().getFullYear()} PulseLynk ISP Management. All rights reserved.
        </div>
      </div>
    </div>
  );
}
