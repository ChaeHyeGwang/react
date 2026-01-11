import React, { useEffect, useMemo, useState } from 'react';
import axiosInstance from '../api/axios';
import { useAuth } from '../contexts/AuthContext';
import toast from 'react-hot-toast';

const EMPTY_OFFICE = {
  name: '',
  manager_account_id: '',
  status: 'active',
  description: '',
  address: '',
  phone: '',
  notes: ''
};

const OfficeManagement = () => {
  const { isAdmin, isOfficeManager, user } = useAuth();
  const [offices, setOffices] = useState([]);
  const [accounts, setAccounts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [modalMode, setModalMode] = useState('create');
  const [selectedOfficeId, setSelectedOfficeId] = useState(null);
  const [formState, setFormState] = useState(EMPTY_OFFICE);
  const [saving, setSaving] = useState(false);
  
  // 텔레그램 설정 모달 상태
  const [telegramModalOpen, setTelegramModalOpen] = useState(false);
  const [telegramFormState, setTelegramFormState] = useState({ telegram_bot_token: '', telegram_chat_id: '' });
  const [telegramSaving, setTelegramSaving] = useState(false);
  const [selectedTelegramOfficeId, setSelectedTelegramOfficeId] = useState(null);

  const loadOffices = async () => {
    setLoading(true);
    try {
      const response = await axiosInstance.get('/offices');
      if (response.data?.success) {
        setOffices(response.data.offices || []);
      } else {
        toast.error(response.data?.message || '사무실 목록을 불러오지 못했습니다.');
      }
    } catch (error) {
      console.error('사무실 목록 로드 실패:', error);
      toast.error(error.response?.data?.message || '사무실 목록을 불러오지 못했습니다.');
    } finally {
      setLoading(false);
    }
  };

  const loadAccounts = async () => {
    try {
      const response = await axiosInstance.get('/auth/accounts');
      if (response.data?.success) {
        setAccounts(response.data.accounts || []);
      }
    } catch (error) {
      console.error('계정 목록 로드 실패:', error);
      toast.error('계정 목록을 불러오지 못했습니다.');
    }
  };

  useEffect(() => {
    if (!isAdmin && !isOfficeManager) return;
    
    // 사무실 관리자인 경우 자신의 사무실만 로드
    if (isOfficeManager && user?.officeId) {
      const loadMyOffice = async () => {
        setLoading(true);
        try {
          const response = await axiosInstance.get(`/offices/${user.officeId}`);
          if (response.data?.success) {
            setOffices([response.data.office]);
          } else {
            toast.error(response.data?.message || '사무실 정보를 불러오지 못했습니다.');
          }
        } catch (error) {
          console.error('사무실 조회 실패:', error);
          toast.error(error.response?.data?.message || '사무실 정보를 불러오지 못했습니다.');
        } finally {
          setLoading(false);
        }
      };
      loadMyOffice();
    } else if (isAdmin) {
      // 슈퍼관리자는 모든 사무실 로드
      loadOffices();
      loadAccounts();
    }
  }, [isAdmin, isOfficeManager, user?.officeId]);

  const openModal = (mode, office = null) => {
    setModalMode(mode);
    if (mode === 'edit' && office) {
      setSelectedOfficeId(office.id);
      setFormState({
        name: office.name || '',
        manager_account_id: office.manager_account_id || '',
        status: office.status || 'active',
        description: office.description || '',
        address: office.address || '',
        phone: office.phone || '',
        notes: office.notes || '',
        telegram_bot_token: office.telegram_bot_token || '',
        telegram_chat_id: office.telegram_chat_id || ''
      });
    } else {
      setSelectedOfficeId(null);
      setFormState(EMPTY_OFFICE);
    }
    setModalOpen(true);
  };

  const closeModal = () => {
    if (saving) return;
    setModalOpen(false);
  };

  const handleInputChange = (field, value) => {
    setFormState(prev => ({ ...prev, [field]: value }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSaving(true);
    const payload = {
      ...formState,
      manager_account_id: formState.manager_account_id || null
    };

    try {
      if (modalMode === 'create') {
        const response = await axiosInstance.post('/offices', payload);
        if (response.data?.success) {
          toast.success('사무실이 추가되었습니다.');
          setModalOpen(false);
          await loadOffices();
        } else {
          toast.error(response.data?.message || '사무실 추가에 실패했습니다.');
        }
      } else if (modalMode === 'edit' && selectedOfficeId) {
        const response = await axiosInstance.put(`/offices/${selectedOfficeId}`, payload);
        if (response.data?.success) {
          toast.success('사무실이 수정되었습니다.');
          setModalOpen(false);
          await loadOffices();
        } else {
          toast.error(response.data?.message || '사무실 수정에 실패했습니다.');
        }
      }
    } catch (error) {
      console.error('사무실 저장 실패:', error);
      toast.error(error.response?.data?.message || '사무실 저장에 실패했습니다.');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (officeId) => {
    if (!window.confirm('해당 사무실을 정말 삭제하시겠습니까?\n사무실에 속한 계정이 있으면 삭제할 수 없습니다.')) {
      return;
    }
    try {
      const response = await axiosInstance.delete(`/offices/${officeId}`);
      if (response.data?.success) {
        toast.success('사무실이 삭제되었습니다.');
        await loadOffices();
      } else {
        toast.error(response.data?.message || '사무실 삭제에 실패했습니다.');
      }
    } catch (error) {
      console.error('사무실 삭제 실패:', error);
      toast.error(error.response?.data?.message || '사무실 삭제에 실패했습니다.');
    }
  };

  const managerOptions = useMemo(() => {
    return [
      { id: '', display_name: '관리자 지정 안함' },
      ...accounts.map(acc => ({
        id: acc.id,
        display_name: `${acc.display_name} (@${acc.username})`
      }))
    ];
  }, [accounts]);
  
  // 텔레그램 설정 모달 열기
  const openTelegramModal = async (office) => {
    setSelectedTelegramOfficeId(office.id);
    try {
      const response = await axiosInstance.get(`/offices/${office.id}/telegram`);
      if (response.data?.success) {
        setTelegramFormState({
          telegram_bot_token: response.data.office.telegram_bot_token || '',
          telegram_chat_id: response.data.office.telegram_chat_id || ''
        });
      }
    } catch (error) {
      console.error('텔레그램 설정 조회 실패:', error);
      setTelegramFormState({ telegram_bot_token: '', telegram_chat_id: '' });
    }
    setTelegramModalOpen(true);
  };
  
  // 텔레그램 설정 모달 닫기
  const closeTelegramModal = () => {
    if (telegramSaving) return;
    setTelegramModalOpen(false);
    setSelectedTelegramOfficeId(null);
    setTelegramFormState({ telegram_bot_token: '', telegram_chat_id: '' });
  };
  
  // 텔레그램 설정 저장
  const handleTelegramSubmit = async (e) => {
    e.preventDefault();
    if (!selectedTelegramOfficeId) return;
    
    // 두 필드 모두 필수
    if (!telegramFormState.telegram_bot_token || !telegramFormState.telegram_chat_id) {
      toast.error('텔레그램 봇 토큰과 채팅 ID를 모두 입력해주세요.');
      return;
    }
    
    setTelegramSaving(true);
    try {
      const response = await axiosInstance.put(`/offices/${selectedTelegramOfficeId}/telegram`, {
        telegram_bot_token: telegramFormState.telegram_bot_token.trim(),
        telegram_chat_id: telegramFormState.telegram_chat_id.trim()
      });
      
      if (response.data?.success) {
        toast.success('텔레그램 설정이 저장되었습니다.');
        setTelegramModalOpen(false);
        await loadOffices();
      } else {
        toast.error(response.data?.message || '텔레그램 설정 저장에 실패했습니다.');
      }
    } catch (error) {
      console.error('텔레그램 설정 저장 실패:', error);
      toast.error(error.response?.data?.message || '텔레그램 설정 저장에 실패했습니다.');
    } finally {
      setTelegramSaving(false);
    }
  };

  if (!isAdmin && !isOfficeManager) {
    return (
      <div className="p-6">
        <div className="bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300 px-4 py-3 rounded-md">
          사무실 관리 기능은 슈퍼관리자 또는 사무실 관리자만 접근할 수 있습니다.
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6 bg-gray-100 dark:bg-gray-900 min-h-[calc(100vh/0.9-64px)]">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">🏢 사무실 관리</h1>
          <p className="text-gray-600 dark:text-gray-300 mt-1">
            {isAdmin ? '사무실 추가, 관리자 지정, 상세 정보를 관리할 수 있습니다.' : '텔레그램 설정을 관리할 수 있습니다.'}
          </p>
        </div>
        {isAdmin && (
          <button
            onClick={() => openModal('create')}
            className="inline-flex items-center px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-md font-semibold shadow focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 dark:focus:ring-offset-gray-900"
          >
            ➕ 새 사무실 추가
          </button>
        )}
      </div>

      <div className="bg-white dark:bg-gray-800 rounded-lg shadow dark:shadow-gray-900/40 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
            <thead className="bg-gray-50 dark:bg-gray-700/50">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 dark:text-gray-300 uppercase tracking-wider">이름</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 dark:text-gray-300 uppercase tracking-wider">관리자</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 dark:text-gray-300 uppercase tracking-wider">상태</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 dark:text-gray-300 uppercase tracking-wider">주소</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 dark:text-gray-300 uppercase tracking-wider">연락처</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 dark:text-gray-300 uppercase tracking-wider">비고</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 dark:text-gray-300 uppercase tracking-wider">텔레그램</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 dark:text-gray-300 uppercase tracking-wider">작업</th>
              </tr>
            </thead>
            <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700 text-sm">
              {loading ? (
                <tr>
                  <td colSpan="8" className="px-4 py-6 text-center text-gray-500 dark:text-gray-300">
                    로딩 중...
                  </td>
                </tr>
              ) : offices.length === 0 ? (
                <tr>
                  <td colSpan="8" className="px-4 py-6 text-center text-gray-500 dark:text-gray-300">
                    등록된 사무실이 없습니다. 새 사무실을 추가해 주세요.
                  </td>
                </tr>
              ) : (
                offices.map(office => (
                  <tr key={office.id}>
                    <td className="px-4 py-3 text-gray-900 dark:text-white font-semibold">{office.name}</td>
                    <td className="px-4 py-3 text-gray-700 dark:text-gray-200">
                      {office.manager_account_id
                        ? (() => {
                            const manager = accounts.find(acc => acc.id === office.manager_account_id);
                            return manager ? `${manager.display_name} (@${manager.username})` : '―';
                          })()
                        : '―'}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`px-2 py-1 rounded-full text-xs font-semibold ${
                          office.status === 'active'
                            ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300'
                            : 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300'
                        }`}
                      >
                        {office.status === 'active' ? '활성' : '비활성'}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-gray-600 dark:text-gray-300">{office.address || '―'}</td>
                    <td className="px-4 py-3 text-gray-600 dark:text-gray-300">{office.phone || '―'}</td>
                    <td className="px-4 py-3 text-gray-600 dark:text-gray-300">{office.notes || '―'}</td>
                    <td className="px-4 py-3">
                      <span
                        className={`px-2 py-1 rounded-full text-xs font-semibold ${
                          office.telegram_bot_token && office.telegram_chat_id
                            ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300'
                            : 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300'
                        }`}
                      >
                        {office.telegram_bot_token && office.telegram_chat_id ? '✅ 설정됨' : '❌ 미설정'}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex justify-end gap-2">
                        <button
                          onClick={() => openTelegramModal(office)}
                          className="px-3 py-1 text-xs bg-purple-600 hover:bg-purple-700 text-white rounded-md focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-purple-500 dark:focus:ring-offset-gray-900"
                        >
                          📱 텔레그램
                        </button>
                        {isAdmin && (
                          <>
                            <button
                              onClick={() => openModal('edit', office)}
                              className="px-3 py-1 text-xs bg-blue-600 hover:bg-blue-700 text-white rounded-md focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 dark:focus:ring-offset-gray-900"
                            >
                              수정
                            </button>
                            <button
                              onClick={() => handleDelete(office.id)}
                              className="px-3 py-1 text-xs bg-red-600 hover:bg-red-700 text-white rounded-md focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-red-500 dark:focus:ring-offset-gray-900"
                            >
                              삭제
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black bg-opacity-40" onClick={closeModal} />
          <div className="relative bg-white dark:bg-gray-800 rounded-lg shadow-xl w-full max-w-2xl mx-4 p-6 z-50">
            <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-4">
              {modalMode === 'create' ? '새 사무실 추가' : '사무실 정보 수정'}
            </h2>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-sm font-bold text-gray-700 dark:text-gray-200 mb-1">사무실 이름 *</label>
                <input
                  type="text"
                  value={formState.name}
                  onChange={(e) => handleInputChange('name', e.target.value)}
                  className="w-full border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="예: 강남본부"
                  required
                />
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-bold text-gray-700 dark:text-gray-200 mb-1">사무실 관리자</label>
                  <select
                    value={formState.manager_account_id || ''}
                    onChange={(e) => handleInputChange('manager_account_id', e.target.value)}
                    className="w-full border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    {managerOptions.map(option => (
                      <option key={option.id || 'none'} value={option.id}>
                        {option.display_name}
                      </option>
                    ))}
                  </select>
                  <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                    선택된 계정은 자동으로 사무실 관리자 권한이 부여됩니다.
                  </p>
                </div>
                <div>
                  <label className="block text-sm font-bold text-gray-700 dark:text-gray-200 mb-1">상태</label>
                  <select
                    value={formState.status}
                    onChange={(e) => handleInputChange('status', e.target.value)}
                    className="w-full border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="active">활성</option>
                    <option value="inactive">비활성</option>
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-bold text-gray-700 dark:text-gray-200 mb-1">주소</label>
                  <input
                    type="text"
                    value={formState.address}
                    onChange={(e) => handleInputChange('address', e.target.value)}
                    className="w-full border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="예: 서울시 강남구 ..."
                  />
                </div>
                <div>
                  <label className="block text-sm font-bold text-gray-700 dark:text-gray-200 mb-1">연락처</label>
                  <input
                    type="text"
                    value={formState.phone}
                    onChange={(e) => handleInputChange('phone', e.target.value)}
                    className="w-full border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="예: 02-123-4567"
                  />
                </div>
              </div>
              <div>
                <label className="block text-sm font-bold text-gray-700 dark:text-gray-200 mb-1">설명</label>
                <textarea
                  value={formState.description}
                  onChange={(e) => handleInputChange('description', e.target.value)}
                  className="w-full border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  rows={3}
                  placeholder="사무실에 대한 설명을 입력하세요."
                />
              </div>
              <div>
                <label className="block text-sm font-bold text-gray-700 dark:text-gray-200 mb-1">비고</label>
                <textarea
                  value={formState.notes}
                  onChange={(e) => handleInputChange('notes', e.target.value)}
                  className="w-full border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  rows={2}
                />
              </div>
              {isAdmin && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-bold text-gray-700 dark:text-gray-200 mb-1">텔레그램 봇 토큰</label>
                    <input
                      type="text"
                      value={formState.telegram_bot_token || ''}
                      onChange={(e) => handleInputChange('telegram_bot_token', e.target.value)}
                      className="w-full border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                      placeholder="예: 123456789:ABCdefGHIjklMNOpqrsTUVwxyz"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-bold text-gray-700 dark:text-gray-200 mb-1">텔레그램 채팅 ID</label>
                    <input
                      type="text"
                      value={formState.telegram_chat_id || ''}
                      onChange={(e) => handleInputChange('telegram_chat_id', e.target.value)}
                      className="w-full border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                      placeholder="예: -1001234567890"
                    />
                  </div>
                </div>
              )}
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={closeModal}
                  className="px-4 py-2 rounded-md border border-gray-300 dark:border-gray-600 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700"
                  disabled={saving}
                >
                  취소
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="px-4 py-2 rounded-md bg-blue-600 dark:bg-blue-700 text-white text-sm font-medium hover:bg-blue-700 dark:hover:bg-blue-600 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 dark:focus:ring-offset-gray-900 disabled:opacity-50"
                >
                  {saving ? '저장 중...' : (modalMode === 'create' ? '추가' : '수정')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
      
      {/* 텔레그램 설정 모달 */}
      {telegramModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black bg-opacity-40" onClick={closeTelegramModal} />
          <div className="relative bg-white dark:bg-gray-800 rounded-lg shadow-xl w-full max-w-md mx-4 p-6 z-50">
            <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-4">
              📱 텔레그램 설정
            </h2>
            <form onSubmit={handleTelegramSubmit} className="space-y-4">
              <div>
                <label className="block text-sm font-bold text-gray-700 dark:text-gray-200 mb-1">
                  텔레그램 봇 토큰 *
                </label>
                <input
                  type="text"
                  value={telegramFormState.telegram_bot_token}
                  onChange={(e) => setTelegramFormState(prev => ({ ...prev, telegram_bot_token: e.target.value }))}
                  className="w-full border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-purple-500"
                  placeholder="예: 123456789:ABCdefGHIjklMNOpqrsTUVwxyz"
                  required
                />
                <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                  @BotFather에서 발급받은 봇 토큰을 입력하세요.
                </p>
              </div>
              <div>
                <label className="block text-sm font-bold text-gray-700 dark:text-gray-200 mb-1">
                  텔레그램 채팅 ID *
                </label>
                <input
                  type="text"
                  value={telegramFormState.telegram_chat_id}
                  onChange={(e) => setTelegramFormState(prev => ({ ...prev, telegram_chat_id: e.target.value }))}
                  className="w-full border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-purple-500"
                  placeholder="예: -1001234567890"
                  required
                />
                <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                  메시지를 받을 텔레그램 채팅방 ID를 입력하세요.
                </p>
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={closeTelegramModal}
                  className="px-4 py-2 rounded-md border border-gray-300 dark:border-gray-600 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700"
                  disabled={telegramSaving}
                >
                  취소
                </button>
                <button
                  type="submit"
                  disabled={telegramSaving}
                  className="px-4 py-2 rounded-md bg-purple-600 dark:bg-purple-700 text-white text-sm font-medium hover:bg-purple-700 dark:hover:bg-purple-600 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-purple-500 dark:focus:ring-offset-gray-900 disabled:opacity-50"
                >
                  {telegramSaving ? '저장 중...' : '저장'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default OfficeManagement;

