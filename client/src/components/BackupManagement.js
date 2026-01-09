import React, { useState, useEffect } from 'react';
import axiosInstance from '../api/axios';
import toast from 'react-hot-toast';
import { useAuth } from '../contexts/AuthContext';

const BackupManagement = () => {
  const { isAdmin } = useAuth();
  const [backups, setBackups] = useState([]);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [restoring, setRestoring] = useState(null);
  const [description, setDescription] = useState('');

  // 백업 목록 로드
  const loadBackups = async () => {
    try {
      setLoading(true);
      const response = await axiosInstance.get('/backup/list');
      if (response.data.success) {
        setBackups(response.data.backups || []);
      }
    } catch (error) {
      console.error('백업 목록 로드 실패:', error);
      toast.error('백업 목록을 불러오는데 실패했습니다.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isAdmin) {
      loadBackups();
    }
  }, [isAdmin]);

  // 백업 생성
  const handleCreateBackup = async () => {
    if (!window.confirm('현재 데이터베이스를 백업하시겠습니까?')) {
      return;
    }

    try {
      setCreating(true);
      const response = await axiosInstance.post('/backup/create', {
        description: description.trim() || undefined
      });
      
      if (response.data.success) {
        toast.success('백업이 성공적으로 생성되었습니다.');
        setDescription('');
        loadBackups();
      }
    } catch (error) {
      console.error('백업 생성 실패:', error);
      toast.error(error.response?.data?.error || '백업 생성에 실패했습니다.');
    } finally {
      setCreating(false);
    }
  };

  // 백업 복원
  const handleRestoreBackup = async (fileName) => {
    const backup = backups.find(b => b.fileName === fileName);
    if (!backup) return;

    const confirmMsg = `⚠️ 경고: 이 작업은 현재 데이터베이스를 "${backup.fileName}" 백업으로 완전히 교체합니다.\n\n이 작업은 되돌릴 수 없습니다. 계속하시겠습니까?`;
    
    if (!window.confirm(confirmMsg)) {
      return;
    }

    // 추가 확인
    if (!window.confirm('정말로 복원하시겠습니까? 모든 현재 데이터가 백업 데이터로 교체됩니다.')) {
      return;
    }

    try {
      setRestoring(fileName);
      const response = await axiosInstance.post('/backup/restore', { fileName });
      
      if (response.data.success) {
        toast.success('백업이 성공적으로 복원되었습니다. 페이지를 새로고침합니다.');
        setTimeout(() => {
          window.location.reload();
        }, 1500);
      }
    } catch (error) {
      console.error('백업 복원 실패:', error);
      toast.error(error.response?.data?.error || '백업 복원에 실패했습니다.');
      setRestoring(null);
    }
  };

  // 백업 삭제
  const handleDeleteBackup = async (fileName) => {
    if (!window.confirm(`백업 파일 "${fileName}"을 삭제하시겠습니까?`)) {
      return;
    }

    try {
      await axiosInstance.delete(`/backup/${fileName}`);
      toast.success('백업 파일이 삭제되었습니다.');
      loadBackups();
    } catch (error) {
      console.error('백업 삭제 실패:', error);
      toast.error(error.response?.data?.error || '백업 삭제에 실패했습니다.');
    }
  };

  // 날짜 포맷팅
  const formatDate = (dateString) => {
    const date = new Date(dateString);
    return date.toLocaleString('ko-KR', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  if (!isAdmin) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-100 dark:bg-gray-900">
        <div className="text-center">
          <h2 className="text-2xl font-bold text-gray-800 dark:text-white mb-4">
            접근 권한이 없습니다
          </h2>
          <p className="text-gray-600 dark:text-gray-400">
            관리자만 백업 관리 기능을 사용할 수 있습니다.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-100 dark:bg-gray-900 py-8 px-4">
      <div className="max-w-6xl mx-auto">
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-lg p-6">
          <h1 className="text-3xl font-bold text-gray-800 dark:text-white mb-6">
            💾 데이터 백업 관리
          </h1>

          {/* 백업 생성 섹션 */}
          <div className="mb-8 p-6 bg-blue-50 dark:bg-blue-900/20 rounded-lg border border-blue-200 dark:border-blue-800">
            <h2 className="text-xl font-semibold text-gray-800 dark:text-white mb-4">
              새 백업 생성
            </h2>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  설명 (선택사항)
                </label>
                <input
                  type="text"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="백업에 대한 설명을 입력하세요"
                  className="w-full px-4 py-2 border border-gray-300 dark:border-gray-700 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-white"
                />
              </div>
              <button
                onClick={handleCreateBackup}
                disabled={creating}
                className="px-6 py-3 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed font-medium"
              >
                {creating ? '백업 생성 중...' : '📦 백업 생성'}
              </button>
            </div>
          </div>

          {/* 백업 목록 섹션 */}
          <div>
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-xl font-semibold text-gray-800 dark:text-white">
                백업 목록
              </h2>
              <button
                onClick={loadBackups}
                disabled={loading}
                className="px-4 py-2 bg-gray-600 text-white rounded-md hover:bg-gray-700 disabled:opacity-50 text-sm"
              >
                {loading ? '새로고침 중...' : '🔄 새로고침'}
              </button>
            </div>

            {loading && backups.length === 0 ? (
              <div className="text-center py-8">
                <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
                <p className="mt-4 text-gray-600 dark:text-gray-400">백업 목록을 불러오는 중...</p>
              </div>
            ) : backups.length === 0 ? (
              <div className="text-center py-8 bg-gray-50 dark:bg-gray-700/50 rounded-lg">
                <p className="text-gray-600 dark:text-gray-400">백업 파일이 없습니다.</p>
                <p className="text-sm text-gray-500 dark:text-gray-500 mt-2">
                  위에서 "백업 생성" 버튼을 눌러 첫 백업을 만들어보세요.
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full border-collapse">
                  <thead>
                    <tr className="bg-gray-200 dark:bg-gray-700">
                      <th className="border border-gray-300 dark:border-gray-600 px-4 py-3 text-left text-sm font-medium text-gray-700 dark:text-gray-300">
                        파일명
                      </th>
                      <th className="border border-gray-300 dark:border-gray-600 px-4 py-3 text-left text-sm font-medium text-gray-700 dark:text-gray-300">
                        생성일
                      </th>
                      <th className="border border-gray-300 dark:border-gray-600 px-4 py-3 text-left text-sm font-medium text-gray-700 dark:text-gray-300">
                        생성자
                      </th>
                      <th className="border border-gray-300 dark:border-gray-600 px-4 py-3 text-left text-sm font-medium text-gray-700 dark:text-gray-300">
                        크기
                      </th>
                      <th className="border border-gray-300 dark:border-gray-600 px-4 py-3 text-left text-sm font-medium text-gray-700 dark:text-gray-300">
                        설명
                      </th>
                      <th className="border border-gray-300 dark:border-gray-600 px-4 py-3 text-center text-sm font-medium text-gray-700 dark:text-gray-300">
                        작업
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {backups.map((backup, index) => (
                      <tr
                        key={backup.fileName}
                        className={index % 2 === 0 ? 'bg-white dark:bg-gray-800' : 'bg-gray-50 dark:bg-gray-700/50'}
                      >
                        <td className="border border-gray-300 dark:border-gray-600 px-4 py-3 text-sm text-gray-800 dark:text-gray-200 font-mono">
                          {backup.fileName}
                        </td>
                        <td className="border border-gray-300 dark:border-gray-600 px-4 py-3 text-sm text-gray-600 dark:text-gray-400">
                          {formatDate(backup.createdAt)}
                        </td>
                        <td className="border border-gray-300 dark:border-gray-600 px-4 py-3 text-sm text-gray-600 dark:text-gray-400">
                          {backup.createdBy}
                        </td>
                        <td className="border border-gray-300 dark:border-gray-600 px-4 py-3 text-sm text-gray-600 dark:text-gray-400">
                          {backup.sizeFormatted || backup.size}
                        </td>
                        <td className="border border-gray-300 dark:border-gray-600 px-4 py-3 text-sm text-gray-600 dark:text-gray-400">
                          {backup.description || '-'}
                        </td>
                        <td className="border border-gray-300 dark:border-gray-600 px-4 py-3">
                          <div className="flex justify-center space-x-2">
                            <button
                              onClick={() => handleRestoreBackup(backup.fileName)}
                              disabled={restoring === backup.fileName}
                              className="px-3 py-1 bg-green-600 text-white rounded hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed text-sm"
                              title="백업 복원"
                            >
                              {restoring === backup.fileName ? '복원 중...' : '🔄 복원'}
                            </button>
                            <button
                              onClick={() => handleDeleteBackup(backup.fileName)}
                              className="px-3 py-1 bg-red-600 text-white rounded hover:bg-red-700 text-sm"
                              title="백업 삭제"
                            >
                              🗑️ 삭제
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* 안내 메시지 */}
          <div className="mt-6 p-4 bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg">
            <p className="text-sm text-yellow-800 dark:text-yellow-300">
              <strong>⚠️ 주의사항:</strong>
            </p>
            <ul className="mt-2 text-sm text-yellow-700 dark:text-yellow-400 list-disc list-inside space-y-1">
              <li>백업 복원은 현재 데이터베이스를 완전히 교체합니다.</li>
              <li>복원 전에 현재 상태를 백업하는 것을 권장합니다.</li>
              <li>복원 작업은 되돌릴 수 없으니 신중하게 진행하세요.</li>
              <li>백업 파일은 <code className="bg-yellow-100 dark:bg-yellow-900/30 px-1 rounded">web-version/server/backups</code> 폴더에 저장됩니다.</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
};

export default BackupManagement;

