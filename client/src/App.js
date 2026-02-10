import React from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { SocketProvider } from './contexts/SocketContext';
import Login from './components/Login';
import Dashboard from './components/Dashboard';
import SiteManagement from './components/SiteManagement';
import SettlementManagement from './components/SettlementManagement';
import DRBet from './components/DRBet';
import Finish from './components/Finish';
import Start from './components/Start';
import BackupManagement from './components/BackupManagement';
import SiteInfoView from './components/SiteInfoView';
import OfficeManagement from './components/OfficeManagement';
import AuditLog from './components/AuditLog';
import Layout from './components/Layout';
import './App.css';

// 최근 방문 경로 저장 컴포넌트
const LastRouteTracker = () => {
  const location = useLocation();
  React.useEffect(() => {
    // 로그인/로그아웃/기타 공개 페이지는 제외하고 저장
    if (!location.pathname.startsWith('/login')) {
      localStorage.setItem('last_path', location.pathname + location.search);
    }
  }, [location.pathname, location.search]);
  return null;
};

// 인덱스에서 최근 방문 경로로 리다이렉트
const IndexRedirect = () => {
  const last = localStorage.getItem('last_path');
  const target = last && last.startsWith('/') ? last : '/dashboard';
  return <Navigate to={target} replace />;
};

// 보호된 라우트 컴포넌트
const ProtectedRoute = ({ children }) => {
  const { user, loading } = useAuth();
  
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-32 w-32 border-b-2 border-blue-600"></div>
      </div>
    );
  }
  
  return user ? children : <Navigate to="/login" replace />;
};

// 관리자 계정 선택이 필요한 라우트 (대시보드 제외)
const ProtectedRouteWithAccount = ({ children, path }) => {
  const { user, loading, isAdmin, isOfficeManager, selectedAccountId } = useAuth();
  
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-32 w-32 border-b-2 border-blue-600"></div>
      </div>
    );
  }
  
  if (!user) {
    return <Navigate to="/login" replace />;
  }
  
  // 관리자가 계정을 선택하지 않았으면 대시보드로 리다이렉트
  if ((isAdmin || isOfficeManager) && !selectedAccountId && path !== '/dashboard') {
    return <Navigate to="/dashboard" replace />;
  }
  
  return children;
};

const AdminRoute = ({ children }) => {
  const { user, loading, isAdmin } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-32 w-32 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  if (!isAdmin) {
    return <Navigate to="/dashboard" replace />;
  }

  return children;
};

// 공개 라우트 컴포넌트 (로그인된 사용자는 대시보드로 리다이렉트)
const PublicRoute = ({ children }) => {
  const { user, loading } = useAuth();
  
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-32 w-32 border-b-2 border-blue-600"></div>
      </div>
    );
  }
  
  return user ? <Navigate to="/dashboard" replace /> : children;
};

function App() {
  return (
    <AuthProvider>
      <SocketProvider>
        <Router>
          <LastRouteTracker />
          <div className="App">
            <Routes>
              {/* 공개 라우트 */}
              <Route 
                path="/login" 
                element={
                  <PublicRoute>
                    <Login />
                  </PublicRoute>
                } 
              />
              
              {/* 보호된 라우트들 */}
              <Route 
                path="/" 
                element={
                  <ProtectedRoute>
                    <Layout />
                  </ProtectedRoute>
                }
              >
                <Route index element={<IndexRedirect />} />
                <Route 
                  path="dashboard" 
                  element={
                    <ProtectedRouteWithAccount path="/dashboard">
                      <Dashboard />
                    </ProtectedRouteWithAccount>
                  } 
                />
                <Route 
                  path="sites" 
                  element={
                    <ProtectedRouteWithAccount path="/sites">
                      <SiteManagement />
                    </ProtectedRouteWithAccount>
                  } 
                />
                <Route 
                  path="settlements" 
                  element={
                    <ProtectedRouteWithAccount path="/settlements">
                      <SettlementManagement />
                    </ProtectedRouteWithAccount>
                  } 
                />
                <Route 
                  path="drbet" 
                  element={
                    <ProtectedRouteWithAccount path="/drbet">
                      <DRBet />
                    </ProtectedRouteWithAccount>
                  } 
                />
                <Route 
                  path="finish" 
                  element={
                    <ProtectedRouteWithAccount path="/finish">
                      <Finish />
                    </ProtectedRouteWithAccount>
                  } 
                />
                <Route 
                  path="start" 
                  element={
                    <ProtectedRouteWithAccount path="/start">
                      <Start />
                    </ProtectedRouteWithAccount>
                  } 
                />
                <Route 
                  path="backup" 
                  element={
                    <BackupManagement />
                  } 
                />
                <Route 
                  path="offices" 
                  element={
                    <ProtectedRoute>
                      <OfficeManagement />
                    </ProtectedRoute>
                  } 
                />
                <Route 
                  path="audit-logs" 
                  element={
                    <ProtectedRoute>
                      <AuditLog />
                    </ProtectedRoute>
                  } 
                />
                <Route 
                  path="site-info" 
                  element={
                    <ProtectedRouteWithAccount path="/site-info">
                      <SiteInfoView />
                    </ProtectedRouteWithAccount>
                  } 
                />
              </Route>
              
              {/* 404 페이지 */}
              <Route path="*" element={<Navigate to="/dashboard" replace />} />
            </Routes>
            
            {/* Toast 알림 */}
            <Toaster
              position="top-right"
              toastOptions={{
                duration: 4000,
                style: {
                  background: '#363636',
                  color: '#fff',
                },
                success: {
                  duration: 3000,
                  theme: {
                    primary: '#4aed88',
                  },
                },
                error: {
                  duration: 4000,
                  theme: {
                    primary: '#f56565',
                  },
                },
              }}
            />
          </div>
        </Router>
      </SocketProvider>
      </AuthProvider>
  );
}

export default App;
