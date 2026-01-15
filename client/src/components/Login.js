import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import toast from 'react-hot-toast';

const Login = () => {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [isDesktop, setIsDesktop] = useState(false);
  const { login } = useAuth();
  const navigate = useNavigate();

  // 화면 크기 감지 (데스크톱 여부 확인)
  useEffect(() => {
    const checkScreenSize = () => {
      setIsDesktop(window.innerWidth >= 768);
    };
    
    checkScreenSize();
    window.addEventListener('resize', checkScreenSize);
    
    return () => window.removeEventListener('resize', checkScreenSize);
  }, []);

  // 로그인 페이지에서 App 배경색 제어
  useEffect(() => {
    const app = document.querySelector('.App');
    if (app) {
      const originalBg = app.style.backgroundColor;
      app.style.backgroundColor = '#111827'; // gray-900
      app.style.height = '100%';
      app.style.minHeight = '100%';
      
      return () => {
        app.style.backgroundColor = originalBg;
        app.style.height = '';
        app.style.minHeight = '';
      };
    }
  }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);

    try {
      const result = await login(username, password);
      if (result.success) {
        navigate('/dashboard');
      }
    } catch (error) {
      console.error('로그인 오류:', error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div 
      className="flex relative bg-gray-900"
      style={{
        height: 'calc(100vh / 0.9)', // zoom 0.9를 고려한 높이
        minHeight: 'calc(100vh / 0.9)',
      }}
    >
      {/* 이미지 영역 (왼쪽) */}
      <div 
        className="hidden md:block md:w-[55%] lg:w-[65%] xl:w-[70%] h-full bg-no-repeat bg-contain bg-left-center bg-gray-900"
        style={{
          backgroundImage: 'url(/login.png)',
          backgroundSize: 'contain',
          backgroundPosition: 'left center',
          backgroundAttachment: isDesktop ? 'fixed' : 'scroll',
        }}
      >
        {/* 이미지 영역 그라데이션 오버레이 */}
        <div 
          className="absolute inset-0"
          style={{
            background: 'linear-gradient(to right, rgba(0,0,0,0.1) 0%, rgba(0,0,0,0.2) 100%)',
          }}
        ></div>
      </div>
      
      {/* 검은 여백 영역 (오른쪽) - 이 영역의 정 가운데에 폼 배치 */}
      <div className="w-full md:w-[45%] lg:w-[35%] xl:w-[30%] h-full flex items-center justify-center px-4 sm:px-6 lg:px-8 relative bg-gray-900">
        {/* 여백 영역 오버레이 */}
        <div 
          className="absolute inset-0"
          style={{
            background: 'linear-gradient(to right, rgba(0,0,0,0.2) 0%, rgba(0,0,0,0.5) 100%)',
          }}
        ></div>
        <div className="absolute inset-0 bg-black/10 dark:bg-black/20"></div>
        
        {/* 로그인 폼 - 여백 영역의 정 가운데 */}
        <div className="relative w-full max-w-md space-y-6 sm:space-y-8 bg-black/40 dark:bg-black/50 backdrop-blur-xl border border-amber-500/30 dark:border-amber-400/30 p-8 sm:p-10 md:p-12 rounded-2xl shadow-2xl z-10"
          style={{
            boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.5), 0 0 0 1px rgba(217, 119, 6, 0.1), 0 0 30px rgba(217, 119, 6, 0.1)',
          }}
        >
        <div>
          <h2 className="text-center text-3xl font-bold text-amber-400 dark:text-amber-300 mb-2 tracking-wide">
            로그인
          </h2>
          <p className="text-center text-sm text-gray-300 dark:text-gray-400">
            웹 버전에 로그인하세요
          </p>
        </div>
        <form className="mt-8 space-y-6" onSubmit={handleSubmit}>
          <div className="space-y-4">
            <div>
              <label htmlFor="username" className="sr-only">
                사용자명
              </label>
              <input
                id="username"
                name="username"
                type="text"
                required
                className="appearance-none relative block w-full px-4 py-3 bg-black/30 border border-amber-500/30 placeholder-gray-400 text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-500/50 focus:border-amber-500/50 transition-all sm:text-sm backdrop-blur-sm"
                placeholder="사용자명"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
              />
            </div>
            <div>
              <label htmlFor="password" className="sr-only">
                비밀번호
              </label>
              <input
                id="password"
                name="password"
                type="password"
                required
                className="appearance-none relative block w-full px-4 py-3 bg-black/30 border border-amber-500/30 placeholder-gray-400 text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-500/50 focus:border-amber-500/50 transition-all sm:text-sm backdrop-blur-sm"
                placeholder="비밀번호"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
          </div>

          <div>
            <button
              type="submit"
              disabled={loading}
              className="group relative w-full flex justify-center py-3 px-4 border border-transparent text-sm font-semibold rounded-lg text-black bg-gradient-to-r from-amber-400 to-amber-500 hover:from-amber-500 hover:to-amber-600 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-amber-500/50 disabled:opacity-50 transition-all shadow-lg shadow-amber-500/20 hover:shadow-amber-500/30"
            >
              {loading ? '로그인 중...' : '로그인'}
            </button>
          </div>
        </form>
        
        {/* 법적 고지 */}
        <div className="mt-6 pt-6 border-t border-gray-700/50">
          <div className="text-xs text-gray-400 dark:text-gray-500 text-center leading-relaxed space-y-1">
            <p className="font-semibold text-amber-500/80 dark:text-amber-400/70 mb-2">
              ⚖️ 법적 고지
            </p>
            <p>
              본 시스템은 <span className="text-amber-400/90 dark:text-amber-300/90 font-medium">학습 및 포트폴리오 목적</span>으로 제작된 관리 도구입니다.
            </p>
            <p>
              실제 도박 사이트 운영, 도박 중개, 불법 금융거래 등 
            </p>
            <p className="text-red-400/90 dark:text-red-300/90 font-medium">
              불법적인 용도로 사용할 경우
            </p>
            <p>
              형법 제246조(도박죄), 정보통신망법, 외환거래법 등 관련 법령에 따라
            </p>
            <p className="text-red-400 dark:text-red-300 font-semibold">
              처벌받을 수 있습니다.
            </p>
            <p className="mt-2 text-gray-500 dark:text-gray-600">
              본 시스템은 실제 도박과 무관하며
            </p>
            <p className="mt-2 text-gray-500 dark:text-gray-600">
              불법적인 용도로의 사용을 금지합니다.
            </p>
            
          </div>
        </div>
        </div>
      </div>
    </div>
  );
};

export default Login;
