import React, { useState, useEffect } from 'react';
import { Outlet, NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import axiosInstance from '../api/axios';
import { getIdentitiesCached } from '../api/identitiesCache';
import toast from 'react-hot-toast';

const Layout = () => {
  const { user, logout, selectedAccountId, setSelectedAccountId, isAdmin, isOfficeManager } = useAuth();
  const navigate = useNavigate();
  const [identities, setIdentities] = useState([]);
  const [showIdentityMenu, setShowIdentityMenu] = useState(false);
  const [accounts, setAccounts] = useState([]);
  const [showAccountMenu, setShowAccountMenu] = useState(false);
  const [isDarkMode, setIsDarkMode] = useState(false);
  const fetchedCommunitiesOnce = React.useRef(false);
  const fetchedAccountsOnce = React.useRef(false);
  const [showCreateAccountModal, setShowCreateAccountModal] = useState(false);
  const [creatingAccount, setCreatingAccount] = useState(false);
  const [newAccountForm, setNewAccountForm] = useState({
    username: '',
    password: '',
    displayName: '',
    isOfficeManager: false
  });
  const [offices, setOffices] = useState([]);
  const [selectedOfficeId, setSelectedOfficeId] = useState('');

  // 다크 모드 상태 로드 및 적용
  useEffect(() => {
    const savedDarkMode = localStorage.getItem('darkMode') === 'true';
    setIsDarkMode(savedDarkMode);
    if (savedDarkMode) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, []);

  // 다크 모드 토글
  const toggleDarkMode = () => {
    const newDarkMode = !isDarkMode;
    setIsDarkMode(newDarkMode);
    localStorage.setItem('darkMode', newDarkMode.toString());
    if (newDarkMode) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  };

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  // 명의 목록 로드
  useEffect(() => {
    const loadIdentities = async () => {
      try {
        const list = await getIdentitiesCached();
        setIdentities(list || []);
      } catch (error) {
        console.error('명의 로드 실패:', error);
      }
    };
    loadIdentities();
  }, []);

  // 관리자용 계정 목록 로드
  useEffect(() => {
    const loadAccounts = async () => {
      try {
        if (fetchedAccountsOnce.current) return;
        fetchedAccountsOnce.current = true;
        const response = await axiosInstance.get('/auth/accounts');
        if (response.data.success) {
          setAccounts(response.data.accounts || []);
        }
      } catch (error) {
        console.error('계정 목록 로드 실패:', error);
      }
    };

    if (isAdmin || isOfficeManager) {
      loadAccounts();
    }
  }, [isAdmin, isOfficeManager]);

  useEffect(() => {
    const loadOffices = async () => {
      try {
        const response = await axiosInstance.get('/offices');
        if (response.data?.success) {
          setOffices(response.data.offices || []);
        }
      } catch (error) {
        console.error('사무실 목록 로드 실패:', error);
      }
    };

    if (isAdmin) {
      loadOffices();
    } else {
      setOffices([]);
    }
  }, [isAdmin]);

  useEffect(() => {
    if (!isOfficeManager) return;
    if (selectedAccountId) return;
    if (!accounts || accounts.length === 0) return;

    const ownAccount = user ? accounts.find(acc => acc.id === user.id) : null;
    const defaultAccountId = ownAccount ? ownAccount.id : accounts[0].id;

    if (defaultAccountId) {
      setSelectedAccountId(defaultAccountId);
    }
  }, [isOfficeManager, accounts, selectedAccountId, setSelectedAccountId, user]);

  // localStorage에서 선택된 계정 ID 복원
  useEffect(() => {
    if (isAdmin) {
      const savedAccountId = localStorage.getItem('selectedAccountId');
      if (savedAccountId) {
        setSelectedAccountId(parseInt(savedAccountId));
      }
    }
  }, [isAdmin, setSelectedAccountId]);

  // 계정 선택 핸들러
  const handleAccountSelect = (accountId) => {
    if (accountId) {
      setSelectedAccountId(accountId);
      localStorage.setItem('selectedAccountId', accountId.toString());
    } else {
      setSelectedAccountId(null);
      localStorage.removeItem('selectedAccountId');
    }
    setShowAccountMenu(false);
    // 페이지 새로고침하여 선택된 계정 데이터 로드
    window.location.reload();
  };

  // 선택된 계정 정보 가져오기
  const selectedAccount = accounts.find(acc => acc.id === selectedAccountId);

  // 계정 삭제 핸들러
  const handleDeleteAccount = async (accountId, accountName) => {
    if (!window.confirm(`"${accountName}" 계정을 정말 삭제하시겠습니까?\n\n이 작업은 되돌릴 수 없으며, 관련된 모든 데이터(명의, 사이트, 커뮤니티 등)가 함께 삭제됩니다.`)) {
      return;
    }

    try {
      const response = await axiosInstance.delete(`/auth/accounts/${accountId}`);
      
      if (response.data?.success) {
        toast.success('계정이 삭제되었습니다.');
        
        // 계정 목록에서 제거
        setAccounts(prev => prev.filter(acc => acc.id !== accountId));
        
        // 삭제된 계정이 현재 선택된 계정이면 계정 선택 해제
        if (selectedAccountId === accountId) {
          setSelectedAccountId(null);
          localStorage.removeItem('selectedAccountId');
          // 페이지 새로고침하여 데이터 리로드
          window.location.reload();
        }
      }
    } catch (error) {
      const errorMessage = error.response?.data?.error || '계정 삭제에 실패했습니다.';
      toast.error(errorMessage);
      console.error('계정 삭제 실패:', error);
    }
  };

  // 관리자가 계정을 선택하지 않았으면 대시보드만 표시
  // 사무실 관리자는 계정 미선택 시 대시보드만, 슈퍼관리자는 계정 미선택 시 대시보드 + 백업관리 + 사무실관리
  const navItems = [
    { to: '/dashboard', label: '대시보드', icon: '📊', alwaysShow: true },
    ...(isAdmin && !selectedAccountId ? [] : [
      { to: '/sites', label: '사이트 관리', icon: '🌐', hasSubmenu: true },
      { to: '/site-info', label: '사이트 정보 조회', icon: '📋' },
      { to: '/settlements', label: '정산 관리', icon: '💰' },
      { to: '/drbet', label: '메인', icon: '🎲' },
      { to: '/start', label: '시작', icon: '🚀' },
      { to: '/finish', label: '마무리', icon: '🏁' },
    ]),
    // 슈퍼관리자 전용 메뉴
    ...(isAdmin && !isOfficeManager ? [
      { to: '/backup', label: '백업 관리', icon: '💾' }
    ] : []),
    // 사무실 관리 메뉴 (슈퍼관리자 또는 사무실 관리자)
    ...(isAdmin || isOfficeManager ? [
      { to: '/offices', label: '사무실 관리', icon: '🏢', alwaysShow: true }
    ] : [])
  ];

  return (
    <div className="bg-gray-100 dark:bg-gray-900 transition-colors duration-200 sm:min-h-screen">
      {/* 상단 네비게이션 */}
      <nav className="bg-white dark:bg-gray-800 shadow-lg dark:shadow-gray-900/50">
        <div className="w-full px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between h-16">
            <div className="flex">
              <div className="flex-shrink-0 flex items-center">
                <h1 className="text-xl font-bold text-blue-600 dark:text-blue-400">
                  🎉 핵수파티
                </h1>
              </div>
              {/* 데스크톱 메뉴 */}
              <div className="hidden sm:ml-6 sm:flex sm:space-x-8">
                {navItems.map((item) => (
                  item.hasSubmenu ? (
                    <div
                      key={item.to}
                      className="relative h-16 flex items-center"
                      onMouseEnter={() => setShowIdentityMenu(true)}
                      onMouseLeave={() => setShowIdentityMenu(false)}
                    >
                      <NavLink
                        to={item.to}
                        className={({ isActive }) =>
                          `inline-flex items-center h-full px-1 pt-1 border-b-2 text-sm font-medium ${
                            isActive
                              ? 'border-blue-500 dark:border-blue-400 text-gray-900 dark:text-white'
                              : 'border-transparent text-gray-500 dark:text-gray-400 hover:border-gray-300 dark:hover:border-gray-600 hover:text-gray-700 dark:hover:text-gray-200'
                          }`
                        }
                      >
                        <span className="mr-2">{item.icon}</span>
                        {item.label}
                      </NavLink>
                      
                      {showIdentityMenu && identities.length > 0 && (
                        <div 
                          className="absolute top-full left-0 pt-1 w-48 z-50"
                          onMouseEnter={() => setShowIdentityMenu(true)}
                          onMouseLeave={() => setShowIdentityMenu(false)}
                        >
                          <div className="bg-white dark:bg-gray-800 rounded-md shadow-lg border border-gray-200 dark:border-gray-700 py-2">
                            {identities.map((identity) => (
                              <button
                                key={identity.id}
                                onClick={(e) => {
                                  e.preventDefault();
                                  navigate(`/sites?identityId=${identity.id}`);
                                  setShowIdentityMenu(false);
                                }}
                                className="w-full text-left px-4 py-2 text-sm text-gray-700 dark:text-white hover:bg-blue-50 dark:hover:bg-gray-700 hover:text-blue-700 dark:hover:text-blue-400 transition-colors"
                              >
                                👤 {identity.name}
                              </button>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  ) : (
                    <NavLink
                      key={item.to}
                      to={item.to}
                      className={({ isActive }) =>
                        `inline-flex items-center gap-2 px-3 py-2 border-b-2 text-sm font-medium whitespace-nowrap ${
                          isActive
                            ? 'border-blue-500 dark:border-blue-400 text-gray-900 dark:text-gray-100'
                            : 'border-transparent text-gray-500 dark:text-gray-400 hover:border-gray-300 dark:hover:bg-gray-700/20 hover:text-gray-700 dark:hover:text-gray-200'
                        }`
                      }
                    >
                      <span className="mr-2">{item.icon}</span>
                      {item.label}
                    </NavLink>
                  )
                ))}
              </div>
            </div>
            <div className="flex items-center space-x-4">
              {/* 다크 모드 토글 버튼 */}
              <button
                onClick={toggleDarkMode}
                className="p-2 rounded-md text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 dark:focus:ring-offset-gray-800 transition-colors"
                aria-label="다크 모드 토글"
                title={isDarkMode ? '라이트 모드로 전환' : '다크 모드로 전환'}
              >
                {isDarkMode ? (
                  <span className="text-xl">☀️</span>
                ) : (
                  <span className="text-xl">🌙</span>
                )}
              </button>
              
              {(isAdmin || isOfficeManager) && (
                <div className="relative">
                  <button
                    onClick={() => setShowAccountMenu(!showAccountMenu)}
                    className="hidden sm:flex items-center px-3 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md hover:bg-gray-50 dark:hover:bg-gray-600 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 dark:focus:ring-offset-gray-800 whitespace-nowrap"
                  >
                    <span className="mr-2">
                      {selectedAccount ? `👤 ${selectedAccount.display_name}` : '전체 계정'}
                    </span>
                    <span className="text-xs">▼</span>
                  </button>
                  
                  {showAccountMenu && (
                    <>
                      <div 
                        className="fixed inset-0 z-40" 
                        onClick={() => setShowAccountMenu(false)}
                      />
                      <div className="absolute right-0 mt-2 w-48 bg-white dark:bg-gray-800 rounded-md shadow-lg border border-gray-200 dark:border-gray-700 z-50">
                        <div className="py-1">
                          {isAdmin && (
                            <button
                              onClick={() => handleAccountSelect(null)}
                            className={`w-full text-left px-4 py-2 text-sm whitespace-nowrap ${
                                !selectedAccountId
                                  ? 'bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400 font-medium'
                                  : 'text-gray-700 dark:text-white hover:bg-gray-50 dark:hover:bg-gray-700'
                              }`}
                            >
                              전체 계정
                            </button>
                          )}
                          {accounts.map((account) => (
                            <button
                              key={account.id}
                              onClick={() => handleAccountSelect(account.id)}
                              className={`w-full text-left px-4 py-2 text-sm whitespace-nowrap ${
                                selectedAccountId === account.id
                                  ? 'bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400 font-medium'
                                  : 'text-gray-700 dark:text-white hover:bg-gray-50 dark:hover:bg-gray-700'
                              }`}
                            >
                              👤 {account.display_name}
                            </button>
                          ))}
                        </div>
                      </div>
                    </>
                  )}
                </div>
              )}
              {(isAdmin || isOfficeManager) && (
                <button
                  onClick={() => setShowCreateAccountModal(true)}
                  className="hidden sm:inline bg-green-600 dark:bg-green-700 text-white px-3 py-2 rounded-md text-sm font-medium hover:bg-green-700 dark:hover:bg-green-600 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-green-500 dark:focus:ring-offset-gray-800 whitespace-nowrap"
                >
                  ➕ 계정 추가
                </button>
              )}
              <span className="hidden sm:inline text-sm text-gray-700 dark:text-white mr-4">
                👤 {user?.displayName}님
                {user?.accountType === 'super_admin' && (
                  <span className="ml-2 text-xs bg-purple-100 dark:bg-purple-900/30 text-purple-800 dark:text-purple-300 px-2 py-1 rounded">
                    관리자
                  </span>
                )}
              </span>
              <button
                onClick={handleLogout}
                className="hidden sm:inline bg-red-600 dark:bg-red-700 text-white px-4 py-2 rounded-md text-sm font-medium hover:bg-red-700 dark:hover:bg-red-600 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-red-500 dark:focus:ring-offset-gray-800 whitespace-nowrap"
              >
                🚪 로그아웃
              </button>
            </div>
          </div>
        </div>
      </nav>

      {/* 메인 콘텐츠 */}
      <main className="mx-auto py-6 px-2 pb-20 sm:pb-6">
        <Outlet />
      </main>

      {/* 모바일 하단 탭바 네비게이션 */}
      <nav className="sm:hidden fixed bottom-0 inset-x-0 z-40 bg-white dark:bg-gray-800 border-t border-gray-200 dark:border-gray-700">
        <div className="grid grid-cols-4">
          {navItems.filter(item => item.alwaysShow || true).slice(0,4).map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                `flex flex-col items-center justify-center py-2 text-xs ${
                  isActive ? 'text-blue-600 dark:text-blue-400' : 'text-gray-600 dark:text-gray-300'
                }`
              }
            >
              <span className="text-lg">{item.icon}</span>
              <span>{item.label}</span>
            </NavLink>
          ))}
        </div>
      </nav>

      {showCreateAccountModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div
            className="absolute inset-0 bg-black bg-opacity-40"
            onClick={() => {
              if (!creatingAccount) {
                setShowCreateAccountModal(false);
                setNewAccountForm({ username: '', password: '', displayName: '', isOfficeManager: false });
                setSelectedOfficeId('');
              }
            }}
          />
          <div className="relative bg-white dark:bg-gray-800 rounded-lg shadow-xl w-full max-w-md mx-4 p-6 z-50">
            <h3 className="text-lg font-bold text-gray-900 dark:text-white mb-4">계정 추가</h3>
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                if (creatingAccount) return;

                const trimmedUsername = newAccountForm.username.trim();
                const trimmedDisplayName = newAccountForm.displayName.trim();

                if (trimmedUsername.length < 3) {
                  toast.error('사용자명은 3자 이상 입력해주세요.');
                  return;
                }

                if (newAccountForm.password.length < 6) {
                  toast.error('비밀번호는 6자 이상 입력해주세요.');
                  return;
                }

                if (isAdmin && newAccountForm.isOfficeManager && !selectedOfficeId) {
                  toast.error('사무실 관리자로 지정하려면 사무실을 선택해주세요.');
                  return;
                }

                try {
                  setCreatingAccount(true);
                  const response = await axiosInstance.post('/auth/accounts', {
                    username: trimmedUsername,
                    password: newAccountForm.password,
                    display_name: trimmedDisplayName || trimmedUsername,
                    office_id: isAdmin ? (selectedOfficeId || null) : undefined,
                    is_office_manager: isAdmin && newAccountForm.isOfficeManager ? 1 : 0
                  });

                  if (response.data?.success && response.data.account) {
                    setAccounts(prev => [...prev, response.data.account]);
                    toast.success('계정을 추가했습니다.');
                    setNewAccountForm({ username: '', password: '', displayName: '', isOfficeManager: false });
                    setSelectedOfficeId('');
                    setShowCreateAccountModal(false);
                  }
                } catch (error) {
                  const message = error.response?.data?.error || '계정 생성에 실패했습니다.';
                  toast.error(message);
                } finally {
                  setCreatingAccount(false);
                }
              }}
              className="space-y-4"
            >
              {isAdmin && (
                <>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">
                      사무실
                    </label>
                    <select
                      value={selectedOfficeId}
                      onChange={(e) => {
                        setSelectedOfficeId(e.target.value);
                        if (!e.target.value) {
                          setNewAccountForm(prev => ({ ...prev, isOfficeManager: false }));
                        }
                      }}
                      className="w-full border border-gray-300 dark:border-gray-600 rounded-md px-3 py-2 text-sm dark:bg-gray-700 dark:text-white"
                      disabled={creatingAccount}
                    >
                      <option value="">(지정 안 함)</option>
                      {offices.map(office => (
                        <option key={office.id} value={office.id}>
                          {office.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  {selectedOfficeId && (
                    <div className="flex items-center">
                      <input
                        type="checkbox"
                        id="isOfficeManager"
                        checked={newAccountForm.isOfficeManager}
                        onChange={(e) => setNewAccountForm(prev => ({ ...prev, isOfficeManager: e.target.checked }))}
                        className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500 dark:focus:ring-blue-600 dark:ring-offset-gray-800 focus:ring-2 dark:bg-gray-700 dark:border-gray-600"
                        disabled={creatingAccount}
                      />
                      <label htmlFor="isOfficeManager" className="ml-2 text-sm font-medium text-gray-700 dark:text-gray-200">
                        사무실 관리자로 지정
                      </label>
                    </div>
                  )}
                </>
              )}
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">
                  사용자명 *
                </label>
                <input
                  type="text"
                  value={newAccountForm.username}
                  onChange={(e) => setNewAccountForm(prev => ({ ...prev, username: e.target.value }))}
                  className="w-full border border-gray-300 dark:border-gray-600 rounded-md px-3 py-2 text-sm dark:bg-gray-700 dark:text-white"
                  placeholder="예: caps_manager01"
                  disabled={creatingAccount}
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">
                  비밀번호 *
                </label>
                <input
                  type="password"
                  value={newAccountForm.password}
                  onChange={(e) => setNewAccountForm(prev => ({ ...prev, password: e.target.value }))}
                  className="w-full border border-gray-300 dark:border-gray-600 rounded-md px-3 py-2 text-sm dark:bg-gray-700 dark:text-white"
                  placeholder="6자 이상"
                  disabled={creatingAccount}
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">
                  표시 이름
                </label>
                <input
                  type="text"
                  value={newAccountForm.displayName}
                  onChange={(e) => setNewAccountForm(prev => ({ ...prev, displayName: e.target.value }))}
                  className="w-full border border-gray-300 dark:border-gray-600 rounded-md px-3 py-2 text-sm dark:bg-gray-700 dark:text-white"
                  placeholder="예: 캡스 메니저"
                  disabled={creatingAccount}
                />
              </div>
              <div className="flex justify-end space-x-2 pt-2">
                <button
                  type="button"
                  onClick={() => {
                    if (!creatingAccount) {
                      setShowCreateAccountModal(false);
                      setNewAccountForm({ username: '', password: '', displayName: '', isOfficeManager: false });
                      setSelectedOfficeId('');
                    }
                  }}
                  className="px-4 py-2 rounded-md border border-gray-300 dark:border-gray-600 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700"
                >
                  취소
                </button>
                <button
                  type="submit"
                  disabled={creatingAccount}
                  className="px-4 py-2 rounded-md bg-blue-600 dark:bg-blue-700 text-white text-sm font-medium hover:bg-blue-700 dark:hover:bg-blue-600 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 dark:focus:ring-offset-gray-800 disabled:opacity-50"
                >
                  {creatingAccount ? '생성 중...' : '계정 생성'}
                </button>
              </div>
            </form>
            <div className="mt-6 border-t border-gray-200 dark:border-gray-700 pt-4">
              <h4 className="text-sm font-semibold text-gray-800 dark:text-gray-100 mb-2">
                {isAdmin ? '계정 목록' : '내 사무실 계정 목록'}
              </h4>
              <div className="max-h-40 overflow-y-auto space-y-2">
                {accounts.length === 0 ? (
                  <div className="text-sm text-gray-500 dark:text-gray-400">등록된 계정이 없습니다.</div>
                ) : (
                  accounts.map(account => (
                    <div
                      key={account.id}
                      className="flex items-center justify-between text-sm text-gray-700 dark:text-gray-200 bg-gray-50 dark:bg-gray-700/50 px-3 py-2 rounded"
                    >
                      <div className="flex flex-col flex-1">
                        <div className="flex items-center gap-2">
                          <span className="font-medium">{account.display_name}</span>
                          {account.isOfficeManager && (
                            <span className="text-xs bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 px-2 py-0.5 rounded">
                              관리자
                            </span>
                          )}
                        </div>
                        {isAdmin && account.office_id && (
                          <span className="text-xs text-gray-500 dark:text-gray-400">
                            사무실 ID: {account.office_id}
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-gray-500 dark:text-gray-400">@{account.username}</span>
                        {/* 자기 자신의 계정은 삭제 불가 */}
                        {account.id !== user?.id && (
                          <button
                            onClick={() => handleDeleteAccount(account.id, account.display_name || account.username)}
                            className="text-red-600 dark:text-red-400 hover:text-red-800 dark:hover:text-red-300 text-xs px-2 py-1 rounded hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
                            title="계정 삭제"
                          >
                            🗑️
                          </button>
                        )}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Layout;
