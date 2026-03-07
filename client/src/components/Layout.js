import React, { useState, useEffect } from 'react';
import { Outlet, NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useSocket } from '../contexts/SocketContext';
import axiosInstance from '../api/axios';
import { getIdentitiesCached } from '../api/identitiesCache';
import toast from 'react-hot-toast';
import { DragDropContext, Droppable, Draggable } from '@hello-pangea/dnd';

const Layout = () => {
  const { user, logout, selectedAccountId, setSelectedAccountId, isAdmin, isOfficeManager } = useAuth();
  const { connected: socketConnected } = useSocket();
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
  const [editingAccountId, setEditingAccountId] = useState(null);
  const [editingAccountName, setEditingAccountName] = useState('');
  const [isEditMode, setIsEditMode] = useState(false);
  const [selectedManagerId, setSelectedManagerId] = useState(() => {
    const saved = localStorage.getItem('selectedManagerId');
    return saved ? parseInt(saved, 10) : null;
  });
  const [subAccounts, setSubAccounts] = useState([]);
  const [showSubAccountMenu, setShowSubAccountMenu] = useState(false);

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

  // 유저 목록 로드
  useEffect(() => {
    const loadIdentities = async () => {
      try {
        const list = await getIdentitiesCached();
        setIdentities(list || []);
      } catch (error) {
        console.error('유저 로드 실패:', error);
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

  // 사무실관리자 전용: selectedManagerId는 슈퍼관리자용이므로 초기화
  useEffect(() => {
    if (isOfficeManager && !isAdmin) {
      setSelectedManagerId(null);
      localStorage.removeItem('selectedManagerId');
    }
  }, [isOfficeManager, isAdmin]);

  useEffect(() => {
    if (!isOfficeManager) return;
    // localStorage에 저장된 선택이 있으면 기본값 설정 스킵 (AuthContext가 이미 복원함)
    const saved = localStorage.getItem('selectedAccountId');
    if (saved) return;
    if (selectedAccountId != null) return;
    if (!accounts || accounts.length === 0) return;

    const ownAccount = user ? accounts.find(acc => acc.id == user.id) : null;
    const defaultAccountId = ownAccount ? ownAccount.id : accounts[0]?.id;

    if (defaultAccountId) {
      setSelectedAccountId(defaultAccountId);
    }
  }, [isOfficeManager, accounts, selectedAccountId, setSelectedAccountId, user]);

  // 선택된 관리자의 사무실 하위 계정 로드
  useEffect(() => {
    const loadSubAccounts = async () => {
      if (!isAdmin || !selectedManagerId) {
        setSubAccounts([]);
        return;
      }
      const manager = accounts.find(acc => acc.id === selectedManagerId);
      if (!manager || !manager.office_id) {
        setSubAccounts([]);
        return;
      }
      try {
        const response = await axiosInstance.get(`/auth/accounts?office_id=${manager.office_id}`);
        if (response.data.success) {
          const subs = (response.data.accounts || []).filter(acc => acc.id !== selectedManagerId);
          setSubAccounts(subs);
        }
      } catch (error) {
        console.error('하위 계정 로드 실패:', error);
        setSubAccounts([]);
      }
    };
    loadSubAccounts();
  }, [isAdmin, selectedManagerId, accounts]);

  // 계정 선택 핸들러
  const handleAccountSelect = (accountId) => {
    if (accountId) {
      setSelectedAccountId(accountId);
      localStorage.setItem('selectedAccountId', accountId.toString());
      if (isAdmin) {
        const account = accounts.find(acc => acc.id === accountId);
        if (account && account.isOfficeManager) {
          setSelectedManagerId(accountId);
          localStorage.setItem('selectedManagerId', accountId.toString());
        } else {
          setSelectedManagerId(null);
          localStorage.removeItem('selectedManagerId');
        }
      }
    } else {
      setSelectedAccountId(null);
      setSelectedManagerId(null);
      localStorage.removeItem('selectedAccountId');
      localStorage.removeItem('selectedManagerId');
    }
    setSubAccounts([]);
    setShowAccountMenu(false);
    window.location.reload();
  };

  // 하위 계정 선택 핸들러
  const handleSubAccountSelect = (accountId) => {
    if (accountId) {
      setSelectedAccountId(accountId);
      localStorage.setItem('selectedAccountId', accountId.toString());
    } else if (selectedManagerId) {
      setSelectedAccountId(selectedManagerId);
      localStorage.setItem('selectedAccountId', selectedManagerId.toString());
    }
    setShowSubAccountMenu(false);
    window.location.reload();
  };

  // 선택된 계정 정보 가져오기 (id 타입 차이 방지: == 사용)
  const selectedAccount = accounts.find(acc => acc.id == selectedAccountId);

  // 계정 삭제 핸들러
  const handleDeleteAccount = async (accountId, accountName) => {
    if (!window.confirm(`"${accountName}" 계정을 정말 삭제하시겠습니까?\n\n이 작업은 되돌릴 수 없으며, 관련된 모든 데이터(유저, 사이트, 커뮤니티 등)가 함께 삭제됩니다.`)) {
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

  // 계정 이름 편집 저장
  const handleSaveAccountName = async (accountId) => {
    if (!editingAccountName.trim()) {
      toast.error('이름을 입력해주세요.');
      return;
    }

    try {
      const response = await axiosInstance.put(`/auth/accounts/${accountId}`, {
        display_name: editingAccountName.trim()
      });

      if (response.data?.success) {
        setAccounts(prev => prev.map(acc => 
          acc.id === accountId 
            ? { ...acc, display_name: editingAccountName.trim() }
            : acc
        ));
        toast.success('계정 이름이 변경되었습니다.');
      }
    } catch (error) {
      toast.error(error.response?.data?.error || '이름 변경에 실패했습니다.');
    } finally {
      setEditingAccountId(null);
      setEditingAccountName('');
    }
  };

  // 드래그 앤 드롭 순서 변경
  const handleDragEnd = async (result) => {
    if (!result.destination) return;

    const sourceIndex = result.source.index;
    const destIndex = result.destination.index;

    if (sourceIndex === destIndex) return;

    // accounts가 비어있으면 처리하지 않음
    if (!accounts || accounts.length === 0) {
      console.warn('계정 목록이 비어있습니다.');
      return;
    }

    const reorderedAccounts = Array.from(accounts);
    const [removed] = reorderedAccounts.splice(sourceIndex, 1);
    reorderedAccounts.splice(destIndex, 0, removed);

    // 즉시 UI 업데이트
    setAccounts(reorderedAccounts);

    // 서버에 순서 저장
    try {
      const accountOrders = reorderedAccounts
        .filter(acc => acc && acc.id) // id가 있는 항목만 포함
        .map((acc, index) => ({
          id: acc.id,
          display_order: index
        }));

      // 빈 배열이면 서버에 요청하지 않음
      if (accountOrders.length === 0) {
        console.warn('유효한 계정이 없습니다.');
        return;
      }

      console.log('순서 변경 요청:', accountOrders);
      await axiosInstance.put('/auth/accounts/reorder', { accountOrders });
      toast.success('순서가 변경되었습니다.');
    } catch (error) {
      console.error('순서 변경 실패:', error.response?.data || error.message);
      toast.error('순서 변경에 실패했습니다.');
      // 실패 시 원래 순서로 복원
      fetchedAccountsOnce.current = false;
      const response = await axiosInstance.get('/auth/accounts');
      if (response.data.success) {
        setAccounts(response.data.accounts || []);
      }
    }
  };

  // 관리자가 계정을 선택하지 않았으면 대시보드만 표시
  // 사무실 관리자는 계정 미선택 시 대시보드만, 슈퍼관리자는 계정 미선택 시 대시보드 + 백업관리 + 사무실관리
  const navItems = [
    { to: '/dashboard', label: '대시보드', icon: '📊', alwaysShow: true },
    // 슈퍼관리자는 계정 미선택 시에도 사이트 정보 조회 표시
    ...(isAdmin && !selectedAccountId ? [
      { to: '/site-info', label: '사이트 정보 조회', icon: '📋', alwaysShow: true },
    ] : [
      { to: '/sites', label: '사이트 관리', icon: '🌐', hasSubmenu: true },
      { to: '/site-info', label: '사이트 정보 조회', icon: '📋' },
      { to: '/settlements', label: '정산 관리', icon: '💰' },
      { to: '/drbet', label: '메인', icon: '🎲', alwaysShow: true },
      { to: '/start', label: '시작', icon: '🚀' },
      { to: '/finish', label: '마무리', icon: '🏁', alwaysShow: true },
    ]),
    // 슈퍼관리자 전용 메뉴
    ...(isAdmin && !isOfficeManager ? [
      { to: '/backup', label: '백업 관리', icon: '💾' }
    ] : []),
    // 사무실 관리 메뉴 (슈퍼관리자 또는 사무실 관리자)
    ...(isAdmin || isOfficeManager ? [
      { to: '/offices', label: '사무실 관리', icon: '🏢', alwaysShow: true }
    ] : []),
    // 변경 이력 메뉴 (모든 로그인 사용자)
    { to: '/audit-logs', label: '변경 이력', icon: '📝', alwaysShow: true }
  ];

  return (
    <div className="bg-gray-100 dark:bg-gray-900 transition-colors duration-200 min-h-screen sm:min-h-[111.12vh] flex flex-col">
      {/* 상단 네비게이션 */}
      <nav className="bg-white dark:bg-gray-800 shadow-lg dark:shadow-gray-900/50">
        <div className="w-full px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between h-16">
            <div className="flex">
              {/* 데스크톱 메뉴 */}
              <div className="hidden sm:ml-6 sm:flex sm:space-x-8">
                {navItems.map((item) => (
                  item.hasSubmenu ? (
                    <div
                      key={item.to}
                      className="relative h-16 flex items-center flex-shrink-0"
                      onMouseEnter={() => setShowIdentityMenu(true)}
                      onMouseLeave={() => setShowIdentityMenu(false)}
                    >
                      <NavLink
                        to={item.to}
                        className={({ isActive }) =>
                          `inline-flex items-center h-full px-1 pt-1 border-b-2 text-sm font-medium whitespace-nowrap ${
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
            <div className="flex items-center space-x-2">
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
                <div className="hidden sm:flex items-center gap-1">
                  {/* 관리자/사무실 관리자 계정 선택 드롭다운 */}
                  <div className="relative">
                    <button
                      onClick={() => { setShowAccountMenu(!showAccountMenu); setShowSubAccountMenu(false); }}
                      className="flex items-center px-2 py-1.5 text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md hover:bg-gray-50 dark:hover:bg-gray-600 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 dark:focus:ring-offset-gray-800"
                    >
                      <span className="max-w-[120px] truncate">
                        {/* 슈퍼관리자만 selectedManagerId 사용, 사무실관리자는 selectedAccount만 사용 */}
                        {isAdmin && selectedManagerId
                          ? `🏢 ${accounts.find(a => a.id == selectedManagerId)?.display_name || '관리자'}`
                          : selectedAccount
                            ? `👤 ${selectedAccount.display_name}`
                            : '전체 계정'}
                      </span>
                      <span className="text-xs ml-1 flex-shrink-0">▼</span>
                    </button>
                    
                    {showAccountMenu && (
                      <>
                        <div 
                          className="fixed inset-0 z-40" 
                          onClick={() => setShowAccountMenu(false)}
                        />
                        <div className="absolute right-0 mt-2 w-48 bg-white dark:bg-gray-800 rounded-md shadow-lg border border-gray-200 dark:border-gray-700 z-50 max-h-80 overflow-y-auto">
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
                                  (isAdmin && selectedManagerId == account.id) || (!isAdmin && selectedAccountId == account.id)
                                    ? 'bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400 font-medium'
                                    : 'text-gray-700 dark:text-white hover:bg-gray-50 dark:hover:bg-gray-700'
                                }`}
                              >
                                {account.isOfficeManager ? '🏢' : '👤'} {account.display_name}
                              </button>
                            ))}
                          </div>
                        </div>
                      </>
                    )}
                  </div>

                  {/* 슈퍼관리자: 하위 계정 선택 드롭다운 */}
                  {isAdmin && selectedManagerId && subAccounts.length > 0 && (
                    <div className="relative">
                      <button
                        onClick={() => { setShowSubAccountMenu(!showSubAccountMenu); setShowAccountMenu(false); }}
                        className="flex items-center px-2 py-1.5 text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md hover:bg-gray-50 dark:hover:bg-gray-600 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 dark:focus:ring-offset-gray-800"
                      >
                        <span className="max-w-[100px] truncate">
                          {selectedAccountId && selectedAccountId != selectedManagerId
                            ? `👤 ${subAccounts.find(a => a.id == selectedAccountId)?.display_name || '계정'}`
                            : '전체 (사무실)'}
                        </span>
                        <span className="text-xs ml-1 flex-shrink-0">▼</span>
                      </button>

                      {showSubAccountMenu && (
                        <>
                          <div 
                            className="fixed inset-0 z-40" 
                            onClick={() => setShowSubAccountMenu(false)}
                          />
                          <div className="absolute right-0 mt-2 w-48 bg-white dark:bg-gray-800 rounded-md shadow-lg border border-gray-200 dark:border-gray-700 z-50 max-h-80 overflow-y-auto">
                            <div className="py-1">
                              <button
                                onClick={() => handleSubAccountSelect(null)}
                                className={`w-full text-left px-4 py-2 text-sm whitespace-nowrap ${
                                  selectedAccountId == selectedManagerId
                                    ? 'bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400 font-medium'
                                    : 'text-gray-700 dark:text-white hover:bg-gray-50 dark:hover:bg-gray-700'
                                }`}
                              >
                                🏢 전체 (사무실)
                              </button>
                              {subAccounts.map((account) => (
                                <button
                                  key={account.id}
                                  onClick={() => handleSubAccountSelect(account.id)}
                                  className={`w-full text-left px-4 py-2 text-sm whitespace-nowrap ${
                                    selectedAccountId == account.id
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
                </div>
              )}
              {(isAdmin || isOfficeManager) && (
                <button
                  onClick={() => setShowCreateAccountModal(true)}
                  className="hidden sm:inline bg-green-600 dark:bg-green-700 text-white px-2 py-1.5 rounded-md text-xs font-medium hover:bg-green-700 dark:hover:bg-green-600 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-green-500 dark:focus:ring-offset-gray-800 whitespace-nowrap"
                >
                  ➕ 계정 추가
                </button>
              )}
              <span className="hidden sm:inline text-xs text-gray-700 dark:text-white">
                👤 {user?.displayName}님
                {user?.accountType === 'super_admin' && (
                  <span className="ml-1 text-xs bg-purple-100 dark:bg-purple-900/30 text-purple-800 dark:text-purple-300 px-1.5 py-0.5 rounded">
                    관리자
                  </span>
                )}
                <span 
                  className={`ml-1 inline-block w-2 h-2 rounded-full ${socketConnected ? 'bg-green-500' : 'bg-red-500'}`}
                  title={socketConnected ? '실시간 동기화 연결됨' : '실시간 동기화 연결 끊김'}
                ></span>
              </span>
              <button
                onClick={handleLogout}
                className="hidden sm:inline bg-red-600 dark:bg-red-700 text-white px-2 py-1.5 rounded-md text-xs font-medium hover:bg-red-700 dark:hover:bg-red-600 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-red-500 dark:focus:ring-offset-gray-800 whitespace-nowrap"
              >
                로그아웃
              </button>
            </div>
          </div>
        </div>
      </nav>

      {/* 메인 콘텐츠 */}
      <main className="flex-1 mx-auto w-full py-6 px-2 pb-20 sm:pb-6">
        <Outlet />
      </main>

      {/* 모바일 하단 탭바 네비게이션 */}
      <nav className="sm:hidden fixed bottom-0 inset-x-0 z-40 bg-white dark:bg-gray-800 border-t border-gray-200 dark:border-gray-700">
        <div className="grid grid-cols-4">
          {navItems.filter(item => item.alwaysShow).slice(0,4).map((item) => (
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
                  toast.error('아이디는 3자 이상 입력해주세요.');
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
                  아이디 *
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
                  닉네임
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
              <div className="flex items-center justify-between mb-2">
                <h4 className="text-sm font-semibold text-gray-800 dark:text-gray-100">
                  {isAdmin ? '계정 목록' : '내 사무실 계정 목록'}
                </h4>
                <button
                  type="button"
                  onClick={() => setIsEditMode(!isEditMode)}
                  className={`text-xs px-2 py-1 rounded transition-colors ${
                    isEditMode 
                      ? 'bg-blue-600 text-white hover:bg-blue-700' 
                      : 'bg-gray-200 dark:bg-gray-600 text-gray-700 dark:text-gray-200 hover:bg-gray-300 dark:hover:bg-gray-500'
                  }`}
                >
                  {isEditMode ? '✓ 편집완료' : '✏️ 편집모드'}
                </button>
              </div>
              
              {isEditMode && (
                <p className="text-xs text-blue-600 dark:text-blue-400 mb-2">
                  💡 드래그하여 순서 변경, 이름 클릭하여 수정
                </p>
              )}
              
              <div className="max-h-48 overflow-y-auto">
                {accounts.length === 0 ? (
                  <div className="text-sm text-gray-500 dark:text-gray-400 py-2">등록된 계정이 없습니다.</div>
                ) : isEditMode ? (
                  <DragDropContext onDragEnd={handleDragEnd}>
                    <Droppable droppableId="accounts-list">
                      {(provided) => (
                        <div 
                          ref={provided.innerRef}
                          {...provided.droppableProps}
                          className="space-y-2"
                        >
                          {accounts.map((account, index) => (
                            <Draggable 
                              key={account.id} 
                              draggableId={String(account.id)} 
                              index={index}
                            >
                              {(provided, snapshot) => (
                                <div
                                  ref={provided.innerRef}
                                  {...provided.draggableProps}
                                  className={`flex items-center justify-between text-sm text-gray-700 dark:text-gray-200 bg-gray-50 dark:bg-gray-700/50 px-3 py-2 rounded border-2 ${
                                    snapshot.isDragging 
                                      ? 'border-blue-500 shadow-lg' 
                                      : 'border-transparent'
                                  }`}
                                >
                                  <div className="flex items-center gap-2 flex-1">
                                    {/* 드래그 핸들 */}
                                    <div 
                                      {...provided.dragHandleProps}
                                      className="cursor-grab active:cursor-grabbing text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
                                    >
                                      ⋮⋮
                                    </div>
                                    
                                    {/* 이름 편집 */}
                                    {editingAccountId === account.id ? (
                                      <input
                                        type="text"
                                        value={editingAccountName}
                                        onChange={(e) => setEditingAccountName(e.target.value)}
                                        onBlur={() => handleSaveAccountName(account.id)}
                                        onKeyDown={(e) => {
                                          if (e.key === 'Enter') handleSaveAccountName(account.id);
                                          if (e.key === 'Escape') {
                                            setEditingAccountId(null);
                                            setEditingAccountName('');
                                          }
                                        }}
                                        autoFocus
                                        className="flex-1 px-2 py-0.5 text-sm border border-blue-500 rounded bg-white dark:bg-gray-700 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                                      />
                                    ) : (
                                      <span 
                                        className="font-medium cursor-pointer hover:text-blue-600 dark:hover:text-blue-400"
                                        onClick={() => {
                                          setEditingAccountId(account.id);
                                          setEditingAccountName(account.display_name);
                                        }}
                                        title="클릭하여 이름 수정"
                                      >
                                        {account.display_name}
                                      </span>
                                    )}
                                    
                                    {account.isOfficeManager && (
                                      <span className="text-xs bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 px-2 py-0.5 rounded">
                                        관리자
                                      </span>
                                    )}
                                  </div>
                                  
                                  <div className="flex items-center gap-2">
                                    <span className="text-xs text-gray-500 dark:text-gray-400">@{account.username}</span>
                                    {account.id !== user?.id && (
                                      <button
                                        type="button"
                                        onClick={() => handleDeleteAccount(account.id, account.display_name || account.username)}
                                        className="text-red-600 dark:text-red-400 hover:text-red-800 dark:hover:text-red-300 text-xs px-2 py-1 rounded hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
                                        title="계정 삭제"
                                      >
                                        🗑️
                                      </button>
                                    )}
                                  </div>
                                </div>
                              )}
                            </Draggable>
                          ))}
                          {provided.placeholder}
                        </div>
                      )}
                    </Droppable>
                  </DragDropContext>
                ) : (
                  <div className="space-y-2">
                    {accounts.map(account => (
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
                          {account.id !== user?.id && (
                            <button
                              type="button"
                              onClick={() => handleDeleteAccount(account.id, account.display_name || account.username)}
                              className="text-red-600 dark:text-red-400 hover:text-red-800 dark:hover:text-red-300 text-xs px-2 py-1 rounded hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
                              title="계정 삭제"
                            >
                              🗑️
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
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
