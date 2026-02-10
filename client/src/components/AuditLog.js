import React, { useEffect, useState, useCallback } from 'react';
import axiosInstance from '../api/axios';
import { useAuth } from '../contexts/AuthContext';
import toast from 'react-hot-toast';

const TABLE_NAME_MAP = {
  drbet_records: '메인(DR벳)',
  site_accounts: '사이트',
  identities: '명의',
  settlements: '정산',
  finish_summary: '마무리',
  start_summary: '시작',
  accounts: '계정',
  offices: '사무실'
};

const ACTION_STYLES = {
  CREATE: { label: '생성', cls: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300' },
  UPDATE: { label: '수정', cls: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300' },
  DELETE: { label: '삭제', cls: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300' }
};

const AuditLog = () => {
  const { user, isAdmin, isOfficeManager } = useAuth();
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [pagination, setPagination] = useState({ total: 0, page: 1, limit: 50, totalPages: 0 });

  const [filters, setFilters] = useState({
    action: '',
    tableName: '',
    startDate: '',
    endDate: '',
    keyword: ''
  });

  const [detailModal, setDetailModal] = useState(false);
  const [detailLog, setDetailLog] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [restoring, setRestoring] = useState(false);

  const loadLogs = useCallback(async (page = 1) => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      params.set('page', page);
      params.set('limit', 50);
      if (filters.action) params.set('action', filters.action);
      if (filters.tableName) params.set('tableName', filters.tableName);
      if (filters.startDate) params.set('startDate', filters.startDate);
      if (filters.endDate) params.set('endDate', filters.endDate);
      if (filters.keyword) params.set('keyword', filters.keyword);

      const response = await axiosInstance.get(`/audit-logs?${params.toString()}`);
      setLogs(response.data.logs || []);
      setPagination(response.data.pagination || { total: 0, page: 1, limit: 50, totalPages: 0 });
    } catch (error) {
      console.error('감사 로그 로드 실패:', error);
      toast.error('감사 로그를 불러오지 못했습니다.');
    } finally {
      setLoading(false);
    }
  }, [filters]);

  useEffect(() => {
    loadLogs(1);
  }, [loadLogs]);

  const handleFilterChange = (key, value) => {
    setFilters(prev => ({ ...prev, [key]: value }));
  };

  const handleSearch = () => loadLogs(1);

  const handleReset = () => {
    setFilters({ action: '', tableName: '', startDate: '', endDate: '', keyword: '' });
  };

  const openDetail = async (logId) => {
    setDetailModal(true);
    setDetailLoading(true);
    try {
      const response = await axiosInstance.get(`/audit-logs/${logId}`);
      setDetailLog(response.data);
    } catch (error) {
      console.error('감사 로그 상세 조회 실패:', error);
      toast.error('상세 정보를 불러오지 못했습니다.');
      setDetailModal(false);
    } finally {
      setDetailLoading(false);
    }
  };

  const handleRestore = async (logId) => {
    if (!window.confirm('정말로 이 데이터를 복구하시겠습니까?\n이전 상태로 되돌립니다.')) return;
    setRestoring(true);
    try {
      const response = await axiosInstance.post(`/audit-logs/${logId}/restore`);
      if (response.data.success) {
        toast.success('데이터가 성공적으로 복구되었습니다.');
        setDetailModal(false);
        loadLogs(pagination.page);
      }
    } catch (error) {
      console.error('데이터 복구 실패:', error);
      toast.error(error.response?.data?.error || '데이터 복구에 실패했습니다.');
    } finally {
      setRestoring(false);
    }
  };

  const formatDate = (dateStr) => {
    if (!dateStr) return '-';
    const d = new Date(dateStr);
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  };

  const renderDiff = (oldData, newData) => {
    if (!oldData && !newData) return <p className="text-gray-400 dark:text-gray-500">데이터 없음</p>;

    const allKeys = new Set([
      ...(oldData ? Object.keys(oldData) : []),
      ...(newData ? Object.keys(newData) : [])
    ]);
    const skipKeys = new Set(['password_hash', 'created_at', 'updated_at']);

    const rows = [];
    for (const key of allKeys) {
      if (skipKeys.has(key)) continue;
      const oldVal = oldData ? JSON.stringify(oldData[key] ?? '') : '';
      const newVal = newData ? JSON.stringify(newData[key] ?? '') : '';
      const changed = oldVal !== newVal;

      rows.push(
        <tr key={key} className={changed ? 'bg-yellow-50 dark:bg-yellow-900/10' : ''}>
          <td className="px-3 py-1.5 border border-gray-200 dark:border-gray-600 font-medium text-sm text-gray-700 dark:text-gray-300 min-w-[120px]">
            {key}
          </td>
          <td className={`px-3 py-1.5 border border-gray-200 dark:border-gray-600 text-sm break-all max-w-[300px] ${
            changed && oldData ? 'bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300' : 'text-gray-600 dark:text-gray-400'
          }`}>
            {oldData ? (oldData[key] !== undefined ? String(oldData[key]) : '-') : '-'}
          </td>
          <td className={`px-3 py-1.5 border border-gray-200 dark:border-gray-600 text-sm break-all max-w-[300px] ${
            changed && newData ? 'bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-300' : 'text-gray-600 dark:text-gray-400'
          }`}>
            {newData ? (newData[key] !== undefined ? String(newData[key]) : '-') : '-'}
          </td>
        </tr>
      );
    }

    return (
      <table className="w-full border-collapse mt-2">
        <thead>
          <tr className="bg-gray-50 dark:bg-gray-700/50">
            <th className="px-3 py-2 border border-gray-200 dark:border-gray-600 text-left text-sm font-semibold text-gray-600 dark:text-gray-300">필드</th>
            <th className="px-3 py-2 border border-gray-200 dark:border-gray-600 text-left text-sm font-semibold text-red-500 dark:text-red-400">변경 전</th>
            <th className="px-3 py-2 border border-gray-200 dark:border-gray-600 text-left text-sm font-semibold text-green-500 dark:text-green-400">변경 후</th>
          </tr>
        </thead>
        <tbody>{rows}</tbody>
      </table>
    );
  };

  const canRestore = true; // 모든 사용자 본인 범위 내 복구 가능

  const getPageNumbers = (current, total) => {
    const pages = [];
    const start = Math.max(1, current - 2);
    const end = Math.min(total, current + 2);
    for (let i = start; i <= end; i++) pages.push(i);
    return pages;
  };

  const inputCls = "px-2.5 py-1.5 border border-gray-300 dark:border-gray-600 rounded-md text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:focus:ring-blue-400";

  return (
    <div className="p-6 space-y-5 bg-gray-100 dark:bg-gray-900 min-h-[calc(100vh/0.9-64px)]">
      {/* 헤더 */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">변경 이력 관리</h1>
        <p className="text-gray-600 dark:text-gray-300 mt-1">누가, 언제, 어떤 데이터를 변경했는지 확인할 수 있습니다.</p>
      </div>

      {/* 필터 영역 */}
      <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-4 flex flex-wrap gap-3 items-end">
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-gray-500 dark:text-gray-400">작업 유형</label>
          <select value={filters.action} onChange={(e) => handleFilterChange('action', e.target.value)} className={inputCls}>
            <option value="">전체</option>
            <option value="CREATE">생성</option>
            <option value="UPDATE">수정</option>
            <option value="DELETE">삭제</option>
          </select>
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-gray-500 dark:text-gray-400">대상</label>
          <select value={filters.tableName} onChange={(e) => handleFilterChange('tableName', e.target.value)} className={inputCls}>
            <option value="">전체</option>
            {Object.entries(TABLE_NAME_MAP).map(([key, label]) => (
              <option key={key} value={key}>{label}</option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-gray-500 dark:text-gray-400">시작일</label>
          <input type="date" value={filters.startDate} onChange={(e) => handleFilterChange('startDate', e.target.value)} className={inputCls} />
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-gray-500 dark:text-gray-400">종료일</label>
          <input type="date" value={filters.endDate} onChange={(e) => handleFilterChange('endDate', e.target.value)} className={inputCls} />
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-gray-500 dark:text-gray-400">검색어</label>
          <input
            type="text"
            value={filters.keyword}
            onChange={(e) => handleFilterChange('keyword', e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
            placeholder="설명, 사용자명..."
            className={`${inputCls} w-44`}
          />
        </div>

        <div className="flex gap-2">
          <button onClick={handleSearch} className="px-4 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-md text-sm font-medium focus:outline-none focus:ring-2 focus:ring-blue-500 dark:focus:ring-offset-gray-800">
            검색
          </button>
          <button onClick={handleReset} className="px-4 py-1.5 bg-gray-500 hover:bg-gray-600 text-white rounded-md text-sm font-medium focus:outline-none focus:ring-2 focus:ring-gray-400 dark:focus:ring-offset-gray-800">
            초기화
          </button>
        </div>
      </div>

      {/* 결과 정보 */}
      <div className="text-sm text-gray-500 dark:text-gray-400">
        총 {pagination.total}건 (페이지 {pagination.page}/{pagination.totalPages || 1})
      </div>

      {/* 로그 테이블 */}
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow dark:shadow-gray-900/40 overflow-hidden border border-gray-200 dark:border-gray-700">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
            <thead className="bg-gray-50 dark:bg-gray-700/50">
              <tr>
                <th className="px-3 py-2.5 text-left text-xs font-semibold text-gray-500 dark:text-gray-300 uppercase tracking-wider whitespace-nowrap">시간</th>
                <th className="px-3 py-2.5 text-left text-xs font-semibold text-gray-500 dark:text-gray-300 uppercase tracking-wider whitespace-nowrap">사용자</th>
                <th className="px-3 py-2.5 text-left text-xs font-semibold text-gray-500 dark:text-gray-300 uppercase tracking-wider whitespace-nowrap">작업</th>
                <th className="px-3 py-2.5 text-left text-xs font-semibold text-gray-500 dark:text-gray-300 uppercase tracking-wider whitespace-nowrap">대상</th>
                <th className="px-3 py-2.5 text-left text-xs font-semibold text-gray-500 dark:text-gray-300 uppercase tracking-wider">설명</th>
                <th className="px-3 py-2.5 text-left text-xs font-semibold text-gray-500 dark:text-gray-300 uppercase tracking-wider whitespace-nowrap">IP</th>
                <th className="px-3 py-2.5 text-center text-xs font-semibold text-gray-500 dark:text-gray-300 uppercase tracking-wider w-20">상세</th>
              </tr>
            </thead>
            <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-100 dark:divide-gray-700/50 text-sm">
              {loading ? (
                <tr>
                  <td colSpan={7} className="px-4 py-10 text-center text-gray-400 dark:text-gray-500">로딩 중...</td>
                </tr>
              ) : logs.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-10 text-center text-gray-400 dark:text-gray-500">변경 이력이 없습니다.</td>
                </tr>
              ) : (
                logs.map((log) => {
                  const actionInfo = ACTION_STYLES[log.action] || { label: log.action, cls: 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300' };
                  return (
                    <tr key={log.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/30 transition-colors">
                      <td className="px-3 py-2.5 text-gray-600 dark:text-gray-300 whitespace-nowrap">{formatDate(log.created_at)}</td>
                      <td className="px-3 py-2.5 text-gray-900 dark:text-white font-medium">{log.display_name || log.username}</td>
                      <td className="px-3 py-2.5">
                        <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-semibold ${actionInfo.cls}`}>
                          {actionInfo.label}
                        </span>
                      </td>
                      <td className="px-3 py-2.5 text-gray-700 dark:text-gray-300">
                        {log.table_name_label || log.table_name}
                        {log.record_id && <span className="text-xs text-gray-400 dark:text-gray-500 ml-1">#{log.record_id}</span>}
                      </td>
                      <td className="px-3 py-2.5 text-gray-600 dark:text-gray-400 max-w-[250px] truncate">{log.description || '-'}</td>
                      <td className="px-3 py-2.5 text-xs text-gray-400 dark:text-gray-500 whitespace-nowrap">{log.ip_address || '-'}</td>
                      <td className="px-3 py-2.5 text-center">
                        <button
                          onClick={() => openDetail(log.id)}
                          className="px-2.5 py-1 bg-gray-100 dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded text-xs text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors"
                        >
                          상세
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* 페이지네이션 */}
      {pagination.totalPages > 1 && (
        <div className="flex justify-center gap-1 pt-2">
          <PaginationBtn onClick={() => loadLogs(1)} disabled={pagination.page === 1}>{'<<'}</PaginationBtn>
          <PaginationBtn onClick={() => loadLogs(pagination.page - 1)} disabled={pagination.page === 1}>{'<'}</PaginationBtn>
          {getPageNumbers(pagination.page, pagination.totalPages).map((p) => (
            <PaginationBtn key={p} onClick={() => loadLogs(p)} active={p === pagination.page}>{p}</PaginationBtn>
          ))}
          <PaginationBtn onClick={() => loadLogs(pagination.page + 1)} disabled={pagination.page === pagination.totalPages}>{'>'}</PaginationBtn>
          <PaginationBtn onClick={() => loadLogs(pagination.totalPages)} disabled={pagination.page === pagination.totalPages}>{'>>'}</PaginationBtn>
        </div>
      )}

      {/* 상세 모달 */}
      {detailModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setDetailModal(false)}>
          <div
            className="bg-white dark:bg-gray-800 rounded-xl shadow-xl w-[90%] max-w-3xl max-h-[80vh] overflow-auto p-6 mx-4"
            onClick={(e) => e.stopPropagation()}
          >
            {detailLoading ? (
              <div className="text-center py-10 text-gray-400 dark:text-gray-500">로딩 중...</div>
            ) : detailLog ? (
              <>
                {/* 헤더 */}
                <div className="flex justify-between items-center mb-4">
                  <h3 className="text-lg font-bold text-gray-900 dark:text-white">변경 이력 상세</h3>
                  <button
                    onClick={() => setDetailModal(false)}
                    className="text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 text-2xl leading-none"
                  >
                    &times;
                  </button>
                </div>

                {/* 기본 정보 */}
                <div className="grid grid-cols-2 gap-3 mb-5">
                  <InfoField label="시간" value={formatDate(detailLog.created_at)} />
                  <InfoField label="사용자" value={detailLog.display_name || detailLog.username} />
                  <div>
                    <span className="text-xs text-gray-500 dark:text-gray-400">작업</span>
                    <div className="mt-0.5">
                      <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-semibold ${
                        (ACTION_STYLES[detailLog.action] || {}).cls || 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300'
                      }`}>
                        {(ACTION_STYLES[detailLog.action] || {}).label || detailLog.action}
                      </span>
                    </div>
                  </div>
                  <InfoField
                    label="대상"
                    value={
                      <>
                        {detailLog.table_name_label || TABLE_NAME_MAP[detailLog.table_name] || detailLog.table_name}
                        {detailLog.record_id && <span className="text-gray-400 dark:text-gray-500 ml-1">#{detailLog.record_id}</span>}
                      </>
                    }
                  />
                  <div className="col-span-2">
                    <InfoField label="설명" value={detailLog.description || '-'} />
                  </div>
                  <InfoField label="IP 주소" value={detailLog.ip_address || '-'} muted />
                </div>

                {/* 변경 전/후 비교 */}
                <div className="border-t border-gray-200 dark:border-gray-700 pt-4">
                  <h4 className="text-base font-semibold text-gray-800 dark:text-gray-200 mb-2">데이터 변경 내역</h4>
                  {renderDiff(detailLog.old_data, detailLog.new_data)}
                </div>

                {/* 복구 버튼 */}
                {canRestore && (detailLog.old_data || detailLog.action === 'CREATE') && (
                  <div className="border-t border-gray-200 dark:border-gray-700 pt-4 mt-4 text-right">
                    <button
                      onClick={() => handleRestore(detailLog.id)}
                      disabled={restoring}
                      className={`px-5 py-2 rounded-md text-sm font-semibold text-white ${
                        restoring
                          ? 'bg-gray-400 dark:bg-gray-600 cursor-not-allowed'
                          : 'bg-amber-500 hover:bg-amber-600 dark:bg-amber-600 dark:hover:bg-amber-700 cursor-pointer'
                      } focus:outline-none focus:ring-2 focus:ring-amber-400 dark:focus:ring-offset-gray-800`}
                    >
                      {restoring ? '복구 중...' : detailLog.action === 'CREATE' ? '생성 취소 (삭제)' : '이전 상태로 복구'}
                    </button>
                  </div>
                )}
              </>
            ) : (
              <div className="text-center py-10 text-gray-400 dark:text-gray-500">로그를 찾을 수 없습니다.</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

/* 작은 서브 컴포넌트들 */

const InfoField = ({ label, value, muted }) => (
  <div>
    <span className="text-xs text-gray-500 dark:text-gray-400">{label}</span>
    <div className={`mt-0.5 font-medium ${muted ? 'text-sm text-gray-500 dark:text-gray-400' : 'text-gray-900 dark:text-white'}`}>
      {value}
    </div>
  </div>
);

const PaginationBtn = ({ children, onClick, disabled, active }) => (
  <button
    onClick={onClick}
    disabled={disabled}
    className={`px-3 py-1.5 border rounded text-sm transition-colors
      ${active
        ? 'bg-blue-600 border-blue-600 text-white font-semibold'
        : disabled
          ? 'bg-gray-100 dark:bg-gray-800 border-gray-200 dark:border-gray-700 text-gray-400 dark:text-gray-600 cursor-not-allowed'
          : 'bg-white dark:bg-gray-800 border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 cursor-pointer'
      }`}
  >
    {children}
  </button>
);

export default AuditLog;
