import { Routes, Route, Navigate, useLocation } from 'react-router-dom';

// Layouts
import MainLayout from './layouts/MainLayout';
import AuthLayout from './layouts/AuthLayout';

// Pages
import Login from './pages/auth/Login';
import Register from './pages/auth/Register';
import AdminDashboard from './pages/admin/Dashboard';
import AdminRouters from './pages/admin/Routers';
import AdminPackages from './pages/admin/Packages';
import AdminUsers from './pages/admin/Users';
import AdminSubscriptions from './pages/admin/Subscriptions';
import AdminVouchers from './pages/admin/Vouchers';
import AdminTransactions from './pages/admin/Transactions';
import AdminSupport from './pages/admin/Support';
import AdminAdmins from './pages/admin/AdminAdmins';
import UserPackages from './pages/user/Packages';
import UserSubscriptions from './pages/user/Subscriptions';
import UserDashboard from './pages/user/UserDashboard';
import HotspotConnect from './pages/user/HotspotConnect';

function RootRedirect() {
  const location = useLocation();
  return <Navigate to="/login" replace state={{ from: location }} search={location.search} />;
}

function App() {
  return (
    <Routes>
      <Route path="/" element={<RootRedirect />} />
      
      {/* Auth Routes */}
      <Route element={<AuthLayout />}>
        <Route path="/login" element={<Login />} />
        <Route path="/register" element={<Register />} />
      </Route>

      {/* Admin Routes */}
      <Route path="/admin" element={<MainLayout role="admin" />}>
        <Route path="dashboard" element={<AdminDashboard />} />
        <Route path="routers" element={<AdminRouters />} />
        <Route path="packages" element={<AdminPackages />} />
        <Route path="users" element={<AdminUsers />} />
        <Route path="subscriptions" element={<AdminSubscriptions />} />
        <Route path="vouchers" element={<AdminVouchers />} />
        <Route path="transactions" element={<AdminTransactions />} />
        <Route path="support" element={<AdminSupport />} />
        <Route path="admins" element={<AdminAdmins />} />
        <Route index element={<Navigate to="/admin/dashboard" replace />} />
      </Route>

      {/* User Routes */}
      <Route path="/user" element={<MainLayout role="user" />}>
        <Route path="dashboard" element={<UserDashboard />} />
        <Route path="packages" element={<UserPackages />} />
        <Route path="subscriptions" element={<UserSubscriptions />} />
        <Route path="connect" element={<HotspotConnect />} />
        <Route index element={<Navigate to="/user/dashboard" replace />} />
      </Route>
    </Routes>
  );
}

export default App;
