import axios from 'axios';
import toast from 'react-hot-toast';

// 동적으로 API URL 결정 (같은 호스트의 /api 사용)
const getAPIUrl = () => {
  if (process.env.REACT_APP_API_URL) {
    // 환경변수의 앞뒤 공백 제거
    return process.env.REACT_APP_API_URL.trim();
  }
  
  // 현재 접속한 호스트를 사용 (localhost, 로컬 IP, ngrok, EC2 등)
  const hostname = window.location.hostname;
  const protocol = window.location.protocol; // http: 또는 https:
  const port = window.location.port; // 현재 포트 (없으면 빈 문자열)
  
  // 로컬 환경 (localhost, 127.0.0.1, 192.168.x.x): 5000 포트 사용
  if (hostname === 'localhost' || hostname === '127.0.0.1' || /^192\.168\./.test(hostname)) {
    return `${protocol}//${hostname}:5000/api`;
  }
  
  // 그 외의 경우 (ngrok, EC2 IP, 외부 도메인 등): 같은 호스트의 /api 사용 (Nginx 프록시)
  return `${protocol}//${hostname}${port ? `:${port}` : ''}/api`;
};

const API_URL = getAPIUrl();

// 디버깅용 로그
console.log('🔍 API_URL 설정:', API_URL);
console.log('🔍 환경변수 REACT_APP_API_URL:', process.env.REACT_APP_API_URL);

// Axios 인스턴스 생성
const axiosInstance = axios.create({
  baseURL: API_URL,
  timeout: 10000,
  headers: {
    'Content-Type': 'application/json',
  },
});

// 요청 인터셉터: 모든 요청에 토큰 자동 추가 + 관리자가 선택한 계정 ID 추가
axiosInstance.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem('token');
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    
    // 관리자가 선택한 계정 ID가 있으면 헤더에 추가
    const selectedAccountId = localStorage.getItem('selectedAccountId');
    if (selectedAccountId) {
      config.headers['X-Selected-Account-Id'] = selectedAccountId;
    }

    // Socket.IO 소켓 ID 추가 (실시간 동기화에서 자기 자신 제외용)
    if (window.__socketId) {
      config.headers['X-Socket-Id'] = window.__socketId;
    }
    
    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

// 응답 인터셉터: 401/403 처리
axiosInstance.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      localStorage.removeItem('token');
      localStorage.removeItem('user');
      window.location.href = '/login';
    }
    if (error.response?.status === 403) {
      const message = error.response?.data?.error || '권한이 없습니다. 관리자 위임 설정을 확인하세요.';
      toast.error(message);
    }
    return Promise.reject(error);
  }
);

export default axiosInstance;
export { API_URL };
