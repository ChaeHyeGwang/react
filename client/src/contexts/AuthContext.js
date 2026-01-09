import React, { createContext, useContext, useState, useEffect, useRef } from 'react';
import toast from 'react-hot-toast';
import axiosInstance from '../api/axios';

const AuthContext = createContext();

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [selectedAccountId, _setSelectedAccountId] = useState(null); // 관리자가 선택한 계정 ID
  const initRanRef = useRef(false);

  // 토큰을 axios 헤더에 설정
  const setAuthToken = (token) => {
    if (token) {
      localStorage.setItem('token', token);
      // axiosInstance는 인터셉터에서 자동으로 토큰을 추가하므로 여기서는 저장만
    } else {
      localStorage.removeItem('token');
    }
  };

  // selectedAccountId setter (localStorage 연동)
  const setSelectedAccountId = (val) => {
    _setSelectedAccountId(val);
    if (val) {
      localStorage.setItem('selectedAccountId', String(val));
    } else {
      localStorage.removeItem('selectedAccountId');
    }
  };

  // 로그인 함수
  const login = async (username, password) => {
    try {
      const response = await axiosInstance.post('/auth/login', {
        username,
        password
      });

      const { token, user: userData } = response.data;
      
      setAuthToken(token);
      setUser(userData);
      
      // 로그인 시 직전에 저장된 계정 선택 복원
      if (userData?.accountType === 'super_admin') {
        const saved = localStorage.getItem('selectedAccountId');
        if (saved) _setSelectedAccountId(parseInt(saved, 10));
        else setSelectedAccountId(null);
      } else if (userData?.isOfficeManager) {
        const saved = localStorage.getItem('selectedAccountId');
        if (saved) {
          setSelectedAccountId(parseInt(saved, 10));
        } else {
          setSelectedAccountId(userData.id);
        }
      } else {
        setSelectedAccountId(null);
      }
      
      toast.success(`환영합니다, ${userData.displayName}님!`);
      return { success: true };
    } catch (error) {
      const message = error.response?.data?.error || '로그인에 실패했습니다.';
      toast.error(message);
      return { success: false, error: message };
    }
  };

  // 로그아웃 함수
  const logout = async () => {
    try {
      await axiosInstance.post('/auth/logout');
    } catch (error) {
      console.error('로그아웃 요청 실패:', error);
    } finally {
      setAuthToken(null);
      setUser(null);
      setSelectedAccountId(null);
      toast.success('로그아웃되었습니다.');
    }
  };

  // 사용자 정보 새로고침
  const refreshUser = async () => {
    try {
      const response = await axiosInstance.get('/auth/me');
      setUser(response.data);
    } catch (error) {
      console.error('사용자 정보 새로고침 실패:', error);
      // 토큰이 유효하지 않은 경우 로그아웃
      if (error.response?.status === 401) {
        logout();
      }
    }
  };

  // 컴포넌트 마운트 시 토큰/선택계정 확인
  useEffect(() => {
    const initAuth = async () => {
      if (initRanRef.current) return; // StrictMode에서 중복 실행 방지
      initRanRef.current = true;
      const token = localStorage.getItem('token');
      // 선택된 계정 미리 복원 (가드보다 먼저 반영되도록)
      const savedAccountId = localStorage.getItem('selectedAccountId');
      if (savedAccountId) {
        _setSelectedAccountId(parseInt(savedAccountId));
      }
      
      if (token) {
        setAuthToken(token);
        
        try {
          // 토큰 유효성 검증
          const response = await axiosInstance.get('/auth/verify');
          setUser(response.data.user);
        } catch (error) {
          console.error('토큰 검증 실패:', error);
          // 유효하지 않은 토큰 제거
          setAuthToken(null);
        }
      }
      
      setLoading(false);
    };

    initAuth();
  }, []);

  const value = {
    user,
    loading,
    login,
    logout,
    refreshUser,
    isAdmin: user?.accountType === 'super_admin',
    isSuperAdmin: user?.accountType === 'super_admin',
    isOfficeManager: !!user?.isOfficeManager,
    officeId: user?.officeId || null,
    selectedAccountId,
    setSelectedAccountId
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
};
