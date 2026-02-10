import React, { useEffect, useState } from 'react';
import axiosInstance from '../api/axios';
import { useAuth } from '../contexts/AuthContext';
import toast from 'react-hot-toast';

const EMPTY_OFFICE = {
  name: '',
  status: 'active',
  description: '',
  telegram_id: '',
  notes: ''
};

const OfficeManagement = () => {
  const { isAdmin, isOfficeManager, user } = useAuth();
  const [offices, setOffices] = useState([]);
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
  const [showBotTokenGuide, setShowBotTokenGuide] = useState(false);
  const [showChatIdGuide, setShowChatIdGuide] = useState(false);

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
      loadOffices();
    }
  }, [isAdmin, isOfficeManager, user?.officeId]);

  const openModal = (mode, office = null) => {
    setModalMode(mode);
    if (mode === 'edit' && office) {
      setSelectedOfficeId(office.id);
      setFormState({
        name: office.name || '',
        status: office.status || 'active',
        description: office.description || '',
        telegram_id: office.telegram_id || '',
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
    const payload = { ...formState };

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
    setShowBotTokenGuide(false);
    setShowChatIdGuide(false);
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
            {isAdmin ? '사무실 추가 및 상세 정보를 관리할 수 있습니다.' : '텔레그램 설정을 관리할 수 있습니다.'}
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
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 dark:text-gray-300 uppercase tracking-wider">상태</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 dark:text-gray-300 uppercase tracking-wider">텔레그램 아이디</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 dark:text-gray-300 uppercase tracking-wider">비고</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 dark:text-gray-300 uppercase tracking-wider">텔레그램</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 dark:text-gray-300 uppercase tracking-wider">작업</th>
              </tr>
            </thead>
            <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700 text-sm">
              {loading ? (
                <tr>
                  <td colSpan="6" className="px-4 py-6 text-center text-gray-500 dark:text-gray-300">
                    로딩 중...
                  </td>
                </tr>
              ) : offices.length === 0 ? (
                <tr>
                  <td colSpan="6" className="px-4 py-6 text-center text-gray-500 dark:text-gray-300">
                    등록된 사무실이 없습니다. 새 사무실을 추가해 주세요.
                  </td>
                </tr>
              ) : (
                offices.map(office => (
                  <tr key={office.id}>
                    <td className="px-4 py-3 text-gray-900 dark:text-white font-semibold">{office.name}</td>
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
                    <td className="px-4 py-3 text-gray-600 dark:text-gray-300">{office.telegram_id || '―'}</td>
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
              <div>
                <label className="block text-sm font-bold text-gray-700 dark:text-gray-200 mb-1">텔레그램 아이디</label>
                <input
                  type="text"
                  value={formState.telegram_id}
                  onChange={(e) => handleInputChange('telegram_id', e.target.value)}
                  className="w-full border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="예: @myTelegramId"
                />
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
        <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto py-4">
          <div className="absolute inset-0 bg-black bg-opacity-40" onClick={closeTelegramModal} />
          <div className="relative bg-white dark:bg-gray-800 rounded-lg shadow-xl w-full max-w-lg mx-4 p-6 z-50 max-h-[90vh] overflow-y-auto">
            <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-4">
              📱 텔레그램 설정
            </h2>
            <form onSubmit={handleTelegramSubmit} className="space-y-5">
              {/* 봇 토큰 섹션 */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="block text-sm font-bold text-gray-700 dark:text-gray-200">
                    텔레그램 봇 토큰 *
                  </label>
                  <button
                    type="button"
                    onClick={() => setShowBotTokenGuide(!showBotTokenGuide)}
                    className="text-xs text-purple-600 dark:text-purple-400 hover:text-purple-700 dark:hover:text-purple-300 flex items-center gap-1"
                  >
                    {showBotTokenGuide ? '▲ 가이드 접기' : '❓ 발급 방법 보기'}
                  </button>
                </div>
                <input
                  type="text"
                  value={telegramFormState.telegram_bot_token}
                  onChange={(e) => setTelegramFormState(prev => ({ ...prev, telegram_bot_token: e.target.value }))}
                  className="w-full border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-purple-500"
                  placeholder="예: 123456789:ABCdefGHIjklMNOpqrsTUVwxyz"
                  required
                />
                
                {/* 봇 토큰 가이드 */}
                {showBotTokenGuide && (
                  <div className="mt-3 p-4 bg-gradient-to-br from-purple-50 to-blue-50 dark:from-purple-900/20 dark:to-blue-900/20 rounded-lg border border-purple-200 dark:border-purple-700">
                    <h4 className="font-bold text-purple-800 dark:text-purple-300 mb-3 flex items-center gap-2">
                      🤖 봇 토큰 발급 방법
                    </h4>
                    <ol className="space-y-3 text-sm">
                      <li className="flex gap-3">
                        <span className="flex-shrink-0 w-6 h-6 rounded-full bg-purple-600 text-white flex items-center justify-center text-xs font-bold">1</span>
                        <div>
                          <p className="text-gray-700 dark:text-gray-300">텔레그램에서 <a href="https://t.me/BotFather" target="_blank" rel="noopener noreferrer" className="font-bold text-blue-600 dark:text-blue-400 hover:underline">@BotFather</a>를 검색하여 대화를 시작하세요.</p>
                        </div>
                      </li>
                      <li className="flex gap-3">
                        <span className="flex-shrink-0 w-6 h-6 rounded-full bg-purple-600 text-white flex items-center justify-center text-xs font-bold">2</span>
                        <div>
                          <p className="text-gray-700 dark:text-gray-300 mb-1">다음 명령어를 입력하세요:</p>
                          <code className="block bg-gray-800 text-green-400 px-3 py-1.5 rounded text-xs font-mono">/newbot</code>
                        </div>
                      </li>
                      <li className="flex gap-3">
                        <span className="flex-shrink-0 w-6 h-6 rounded-full bg-purple-600 text-white flex items-center justify-center text-xs font-bold">3</span>
                        <div>
                          <p className="text-gray-700 dark:text-gray-300">봇 이름과 사용자명을 설정하면 토큰이 발급됩니다.</p>
                          <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">예: <code className="bg-gray-200 dark:bg-gray-700 px-1 rounded">7123456789:AAH...</code> 형식</p>
                        </div>
                      </li>
                      <li className="flex gap-3">
                        <span className="flex-shrink-0 w-6 h-6 rounded-full bg-purple-600 text-white flex items-center justify-center text-xs font-bold">4</span>
                        <div>
                          <p className="text-gray-700 dark:text-gray-300 mb-1">생성된 봇을 검색하여 대화를 시작하고 다음을 입력하세요:</p>
                          <code className="block bg-gray-800 text-green-400 px-3 py-1.5 rounded text-xs font-mono">/start</code>
                          <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">⚡ 이 단계를 해야 봇이 메시지를 보낼 수 있습니다!</p>
                        </div>
                      </li>
                      <li className="flex gap-3">
                        <span className="flex-shrink-0 w-6 h-6 rounded-full bg-purple-600 text-white flex items-center justify-center text-xs font-bold">5</span>
                        <div>
                          <p className="text-gray-700 dark:text-gray-300">발급된 토큰을 복사하여 위 입력란에 붙여넣으세요.</p>
                        </div>
                      </li>
                    </ol>
                    <div className="mt-3 p-2 bg-yellow-100 dark:bg-yellow-900/30 rounded border border-yellow-300 dark:border-yellow-700">
                      <p className="text-xs text-yellow-800 dark:text-yellow-300">
                        ⚠️ <strong>중요:</strong> 토큰은 비밀번호와 같습니다. 절대 타인에게 공유하지 마세요!
                      </p>
                    </div>
                  </div>
                )}
              </div>
              
              {/* 채팅 ID 섹션 */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="block text-sm font-bold text-gray-700 dark:text-gray-200">
                    텔레그램 채팅 ID *
                  </label>
                  <button
                    type="button"
                    onClick={() => setShowChatIdGuide(!showChatIdGuide)}
                    className="text-xs text-purple-600 dark:text-purple-400 hover:text-purple-700 dark:hover:text-purple-300 flex items-center gap-1"
                  >
                    {showChatIdGuide ? '▲ 가이드 접기' : '❓ 확인 방법 보기'}
                  </button>
                </div>
                <input
                  type="text"
                  value={telegramFormState.telegram_chat_id}
                  onChange={(e) => setTelegramFormState(prev => ({ ...prev, telegram_chat_id: e.target.value }))}
                  className="w-full border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-purple-500"
                  placeholder="예: -1001234567890 또는 123456789"
                  required
                />
                
                {/* 채팅 ID 가이드 */}
                {showChatIdGuide && (
                  <div className="mt-3 p-4 bg-gradient-to-br from-blue-50 to-cyan-50 dark:from-blue-900/20 dark:to-cyan-900/20 rounded-lg border border-blue-200 dark:border-blue-700">
                    <h4 className="font-bold text-blue-800 dark:text-blue-300 mb-3 flex items-center gap-2">
                      💬 채팅 ID 확인 방법
                    </h4>
                    
                    {/* 방법 1: 개인 채팅 */}
                    <div className="mb-4">
                      <p className="font-semibold text-gray-700 dark:text-gray-300 mb-2 flex items-center gap-2">
                        <span className="px-2 py-0.5 bg-blue-600 text-white text-xs rounded">방법 1</span>
                        개인 채팅 ID (나에게 직접 알림)
                      </p>
                      <ol className="space-y-2 text-sm ml-1">
                        <li className="flex gap-3">
                          <span className="flex-shrink-0 w-5 h-5 rounded-full bg-blue-500 text-white flex items-center justify-center text-xs">1</span>
                          <p className="text-gray-700 dark:text-gray-300">
                            <a href="https://t.me/userinfobot" target="_blank" rel="noopener noreferrer" className="font-bold text-blue-600 dark:text-blue-400 hover:underline">@userinfobot</a>에게 아무 메시지를 보내세요.
                          </p>
                        </li>
                        <li className="flex gap-3">
                          <span className="flex-shrink-0 w-5 h-5 rounded-full bg-blue-500 text-white flex items-center justify-center text-xs">2</span>
                          <p className="text-gray-700 dark:text-gray-300">응답으로 받은 <strong>Id</strong> 숫자를 복사하세요.</p>
                        </li>
                      </ol>
                    </div>
                    
                    {/* 방법 2: 그룹 채팅 */}
                    <div className="pt-3 border-t border-blue-200 dark:border-blue-700">
                      <p className="font-semibold text-gray-700 dark:text-gray-300 mb-2 flex items-center gap-2">
                        <span className="px-2 py-0.5 bg-cyan-600 text-white text-xs rounded">방법 2</span>
                        그룹 채팅 ID (팀 공유용)
                      </p>
                      <ol className="space-y-2 text-sm ml-1">
                        <li className="flex gap-3">
                          <span className="flex-shrink-0 w-5 h-5 rounded-full bg-cyan-500 text-white flex items-center justify-center text-xs">1</span>
                          <p className="text-gray-700 dark:text-gray-300">위에서 만든 봇을 그룹에 초대하세요.</p>
                        </li>
                        <li className="flex gap-3">
                          <span className="flex-shrink-0 w-5 h-5 rounded-full bg-cyan-500 text-white flex items-center justify-center text-xs">2</span>
                          <p className="text-gray-700 dark:text-gray-300">
                            <a href="https://t.me/RawDataBot" target="_blank" rel="noopener noreferrer" className="font-bold text-blue-600 dark:text-blue-400 hover:underline">@RawDataBot</a>을 그룹에 초대하세요.
                          </p>
                        </li>
                        <li className="flex gap-3">
                          <span className="flex-shrink-0 w-5 h-5 rounded-full bg-cyan-500 text-white flex items-center justify-center text-xs">3</span>
                          <p className="text-gray-700 dark:text-gray-300">
                            표시된 JSON에서 <code className="bg-gray-200 dark:bg-gray-700 px-1 rounded">"id": -100...</code>를 복사하세요.
                          </p>
                        </li>
                        <li className="flex gap-3">
                          <span className="flex-shrink-0 w-5 h-5 rounded-full bg-cyan-500 text-white flex items-center justify-center text-xs">4</span>
                          <p className="text-gray-700 dark:text-gray-300">RawDataBot을 그룹에서 제거해도 됩니다.</p>
                        </li>
                      </ol>
                    </div>
                    
                    <div className="mt-3 p-2 bg-green-100 dark:bg-green-900/30 rounded border border-green-300 dark:border-green-700">
                      <p className="text-xs text-green-800 dark:text-green-300">
                        💡 <strong>팁:</strong> 그룹 ID는 <code className="bg-gray-200 dark:bg-gray-700 px-1 rounded">-100</code>으로 시작합니다. 개인 ID는 숫자만 있습니다.
                      </p>
                    </div>
                  </div>
                )}
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

