import React, { useState, useEffect, useMemo } from 'react';
import axiosInstance from '../api/axios';
import toast from 'react-hot-toast';
import { 
  LineChart, Line, BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer 
} from 'recharts';

const Dashboard = () => {
  // 년월 형식: YYYY-MM
  const getCurrentYearMonth = () => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  };
  const [selectedYearMonth, setSelectedYearMonth] = useState(getCurrentYearMonth());
  
  // selectedYearMonth에서 년도와 월 추출
  const selectedYear = parseInt(selectedYearMonth.split('-')[0]);
  const selectedMonth = parseInt(selectedYearMonth.split('-')[1]);
  const [loading, setLoading] = useState(true);
  
  // 통계 데이터 상태
  const [summary, setSummary] = useState({
    totalMargin: 0,
    monthlyMargin: 0,
    weeklyMargin: 0,
    totalSites: 0,
    activeSites: 0,
    siteDetails: []
  });
  
  const [monthlyTrend, setMonthlyTrend] = useState([]);
  const [dailyTrend, setDailyTrend] = useState([]);
  const [siteStats, setSiteStats] = useState([]);
  const [identityStats, setIdentityStats] = useState([]);
  const [showSiteDetails, setShowSiteDetails] = useState(false);
  const [siteDetailFilter, setSiteDetailFilter] = useState('all');

  useEffect(() => {
    loadAllData();
    // eslint-disable-next-line
  }, [selectedYearMonth]);

  const loadAllData = async () => {
    setLoading(true);
    try {
      await Promise.all([
        loadSummary(),
        loadMonthlyTrend(),
        loadDailyTrend(),
        loadSiteStats(),
        loadIdentityStats()
      ]);
    } catch (error) {
      console.error('데이터 로드 실패:', error);
      toast.error('데이터를 불러오는데 실패했습니다');
    } finally {
      setLoading(false);
    }
  };

  const loadSummary = async () => {
    try {
      const response = await axiosInstance.get('/statistics/summary', {
        params: { year: selectedYear, month: selectedMonth }
      });
      setSummary(response.data);
    } catch (error) {
      console.error('요약 데이터 로드 실패:', error);
    }
  };

  const loadMonthlyTrend = async () => {
    try {
      const response = await axiosInstance.get('/statistics/monthly-trend');
      setMonthlyTrend(response.data);
    } catch (error) {
      console.error('월별 추이 로드 실패:', error);
    }
  };

  const loadDailyTrend = async () => {
    try {
      const response = await axiosInstance.get('/statistics/daily-trend', {
        params: { year: selectedYear, month: selectedMonth }
      });
      setDailyTrend(response.data);
    } catch (error) {
      console.error('일별 추이 로드 실패:', error);
    }
  };

  const loadSiteStats = async () => {
    try {
      const response = await axiosInstance.get('/statistics/by-site', {
        params: { year: selectedYear, month: selectedMonth }
      });
      setSiteStats(response.data);
    } catch (error) {
      console.error('사이트별 통계 로드 실패:', error);
    }
  };

  const loadIdentityStats = async () => {
    try {
      const response = await axiosInstance.get('/statistics/by-identity', {
        params: { year: selectedYear, month: selectedMonth }
      });
      setIdentityStats(response.data);
    } catch (error) {
      console.error('유저별 통계 로드 실패:', error);
    }
  };

  const formatCurrency = (amount) => {
    if (!amount && amount !== 0) return '0';
    return Math.abs(amount).toLocaleString('ko-KR');
  };

  const formatCurrencyWithSign = (amount) => {
    if (!amount && amount !== 0) return '0';
    const formatted = Math.abs(amount).toLocaleString('ko-KR');
    return amount >= 0 ? `+${formatted}` : `-${formatted}`;
  };

  // 차트 색상
  const COLORS = {
    primary: '#3b82f6',
    success: '#10b981',
    warning: '#f59e0b',
    danger: '#ef4444',
    purple: '#8b5cf6',
    teal: '#14b8a6'
  };

  const PIE_COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#14b8a6', '#ec4899', '#6366f1'];

  const Badge = ({ color = 'blue', children, className = '' }) => {
    const map = {
      blue: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
      green: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300',
      purple: 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300',
      teal: 'bg-teal-100 text-teal-700 dark:bg-teal-900/30 dark:text-teal-300',
      gray: 'bg-gray-100 text-gray-700 dark:bg-gray-700/50 dark:text-gray-200',
      amber: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300'
    };
    return (
      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold ${map[color]} ${className}`}>
        {children}
      </span>
    );
  };

  // 커스텀 툴팁
  const CustomTooltip = ({ active, payload, label }) => {
    if (active && payload && payload.length) {
      return (
        <div className="bg-white dark:bg-gray-800 p-3 border border-gray-300 dark:border-gray-700 rounded shadow-lg">
          <p className="font-semibold text-gray-800 dark:text-white">{label}</p>
          {payload.map((entry, index) => {
            const value = entry.value;
            let displayValue;
            if (value === null || value === undefined) {
              displayValue = '-';
            } else if (value === 0) {
              displayValue = '0원';
            } else {
              // 음수 값도 부호 포함하여 표시
              const formatted = formatCurrencyWithSign(value);
              displayValue = `${formatted}원`;
            }
            return (
              <p key={index} style={{ color: entry.color }} className="text-sm">
                {entry.name}: {displayValue}
              </p>
            );
          })}
        </div>
      );
    }
    // payload가 없어도 label이 있으면 표시 (데이터가 없는 날짜)
    if (active && label) {
      return (
        <div className="bg-white dark:bg-gray-800 p-3 border border-gray-300 dark:border-gray-700 rounded shadow-lg">
          <p className="font-semibold text-gray-800 dark:text-white">{label}</p>
          <p className="text-sm text-gray-600 dark:text-gray-400">수익: -</p>
        </div>
      );
    }
    return null;
  };

  const siteDetails = summary.siteDetails || [];
  
  // useMemo로 필터링 최적화 및 정확성 보장
  const filteredSiteDetails = useMemo(() => {
    console.log('[Dashboard] 필터링 적용:', siteDetailFilter, '전체:', siteDetails.length);
    
    const result = siteDetails.filter(detail => {
      if (siteDetailFilter === 'approved') return detail.includedInApproved === true;
      if (siteDetailFilter === 'excluded') return detail.includedInTotal === false;
      if (siteDetailFilter === 'included') return detail.includedInTotal === true;
      return true; // 'all'
    });
    
    console.log('[Dashboard] 필터링 결과:', result.length, '개');
    return result;
  }, [siteDetails, siteDetailFilter]);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <div className="animate-spin rounded-full h-16 w-16 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p className="text-gray-600 dark:text-white">데이터를 불러오는 중...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 p-4 sm:p-6 bg-gray-50 dark:bg-gray-900 min-h-screen transition-colors duration-200">
      {/* 헤더 */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-3xl font-bold text-gray-900 dark:text-white">📊 통계 대시보드</h1>
          <p className="text-gray-600 dark:text-gray-300 mt-1">정산 수익 분석 및 포인트 통계</p>
        </div>
        
        {/* 년월 선택 */}
        <div className="flex flex-col sm:flex-row sm:items-center gap-3 bg-white dark:bg-gray-800 p-4 rounded-lg shadow dark:shadow-gray-900/50">
          <label className="font-bold text-gray-700 dark:text-white whitespace-nowrap">📅 년월 선택:</label>
          <input
            type="month"
            value={selectedYearMonth}
            onChange={(e) => setSelectedYearMonth(e.target.value)}
            className="border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-md px-4 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <div className="flex gap-2">
            <button
              onClick={() => {
                const date = new Date(selectedYearMonth + '-01');
                date.setMonth(date.getMonth() - 1);
                const prevYear = date.getFullYear();
                const prevMonth = String(date.getMonth() + 1).padStart(2, '0');
                setSelectedYearMonth(`${prevYear}-${prevMonth}`);
              }}
              className="px-3 py-2 bg-gray-200 dark:bg-gray-700 dark:text-white rounded hover:bg-gray-300 dark:hover:bg-gray-600"
            >
              ◀ 이전
            </button>
            <button
              onClick={() => {
                const now = new Date();
                setSelectedYearMonth(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`);
              }}
              className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600 font-medium"
            >
              이번 달
            </button>
            <button
              onClick={() => {
                const date = new Date(selectedYearMonth + '-01');
                date.setMonth(date.getMonth() + 1);
                const nextYear = date.getFullYear();
                const nextMonth = String(date.getMonth() + 1).padStart(2, '0');
                setSelectedYearMonth(`${nextYear}-${nextMonth}`);
              }}
              className="px-3 py-2 bg-gray-200 dark:bg-gray-700 dark:text-white rounded hover:bg-gray-300 dark:hover:bg-gray-600"
            >
              다음 ▶
            </button>
          </div>
          <button
            onClick={loadAllData}
            className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors font-medium"
          >
            🔄 새로고침
          </button>
        </div>
      </div>

      {/* 요약 카드 */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6">
        {/* 이번 주 수익 */}
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow-md dark:shadow-gray-900/50 p-6 border-l-4 border-green-500 hover:shadow-lg transition-shadow">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-600 dark:text-gray-300 font-medium">이번 주 수익</p>
              <p className="text-2xl font-bold text-gray-900 dark:text-white mt-2">
                {formatCurrencyWithSign(summary.weeklyMargin)}
                <span className="text-sm font-normal text-gray-600 dark:text-gray-300 ml-1">원</span>
              </p>
            </div>
            <div className="bg-green-100 p-3 rounded-full">
              <svg className="w-8 h-8 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
              </svg>
            </div>
          </div>
          <div className="mt-4 flex items-center text-xs">
            <span className="text-gray-600 dark:text-gray-300">월요일 ~ 오늘</span>
          </div>
        </div>

        {/* 이번 달 수익 */}
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow-md dark:shadow-gray-900/50 p-6 border-l-4 border-purple-500 hover:shadow-lg transition-shadow">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-600 dark:text-gray-300 font-medium">이번 달 수익</p>
              <p className="text-2xl font-bold text-gray-900 dark:text-white mt-2">
                {formatCurrencyWithSign(summary.monthlyMargin)}
                <span className="text-sm font-normal text-gray-600 dark:text-gray-300 ml-1">원</span>
              </p>
            </div>
            <div className="bg-purple-100 p-3 rounded-full">
              <svg className="w-8 h-8 text-purple-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
            </div>
          </div>
          <div className="mt-4 flex items-center text-xs">
            <span className="text-gray-600 dark:text-gray-300">{selectedMonth}월 누적</span>
          </div>
        </div>

        {/* 승인 사이트 */}
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow-md dark:shadow-gray-900/50 p-6 border-l-4 border-orange-500 hover:shadow-lg transition-shadow">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-600 dark:text-gray-300 font-medium">승인 사이트</p>
              <p className="text-2xl font-bold text-gray-900 dark:text-white mt-2">
                {summary.activeSites}
                <span className="text-sm font-normal text-gray-600 dark:text-gray-300 ml-1">/ {summary.totalSites}</span>
              </p>
            </div>
            <div className="bg-orange-100 dark:bg-orange-900/30 p-3 rounded-full">
              <svg className="w-8 h-8 text-orange-600 dark:text-orange-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9" />
              </svg>
            </div>
          </div>
          <div className="mt-3 text-xs text-gray-500 dark:text-gray-400 space-y-1">
            <p>• <span className="font-semibold text-orange-600 dark:text-orange-400">{summary.activeSites}</span> = 마지막 상태가 "승인"인 사이트</p>
            <p>• <span className="font-semibold text-gray-700 dark:text-gray-300">{summary.totalSites}</span> = 활성 사이트 (졸업/팅/가입전/대기 제외)</p>
          </div>
          <div className="mt-3">
            <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2">
              <div
                className="bg-orange-500 h-2 rounded-full transition-all"
                style={{ width: `${summary.totalSites > 0 ? (summary.activeSites / summary.totalSites) * 100 : 0}%` }}
              ></div>
            </div>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1 text-right">
              승인율 {summary.totalSites > 0 ? Math.round((summary.activeSites / summary.totalSites) * 100) : 0}%
            </p>
          </div>
        </div>
      </div>

      {/* 승인 사이트 검증 패널 */}
      {siteDetails.length > 0 && (
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow-md dark:shadow-gray-900/50 p-6">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div>
              <h2 className="text-xl font-bold text-gray-900 dark:text-white">🧾 승인 사이트 검증 리스트</h2>
              <p className="text-sm text-gray-600 dark:text-gray-300">대시보드 승인/전체 카운트에 포함된 실제 사이트 목록입니다.</p>
            </div>
            <button
              onClick={() => setShowSiteDetails(prev => !prev)}
              className="px-4 py-2 bg-gray-200 dark:bg-gray-700 dark:text-white rounded hover:bg-gray-300 dark:hover:bg-gray-600"
            >
              {showSiteDetails ? '숨기기' : '보기'}
            </button>
          </div>

          {showSiteDetails && (
            <div className="mt-4 space-y-4">
              <div className="flex flex-wrap gap-2">
                {[
                  { key: 'all', label: `전체 (${siteDetails.length})` },
                  { key: 'approved', label: `승인 포함 (${siteDetails.filter(d => d.includedInApproved === true).length})` },
                  { key: 'included', label: `전체 집계 포함 (${siteDetails.filter(d => d.includedInTotal === true).length})` },
                  { key: 'excluded', label: `집계 제외 (${siteDetails.filter(d => d.includedInTotal === false).length})` }
                ].map(filter => (
                  <button
                    key={filter.key}
                    onClick={() => {
                      console.log('[Dashboard] 필터 버튼 클릭:', filter.key);
                      setSiteDetailFilter(filter.key);
                    }}
                    className={`px-3 py-1 rounded-full text-xs font-semibold transition-colors ${
                      siteDetailFilter === filter.key
                        ? 'bg-blue-600 text-white'
                        : 'bg-gray-200 dark:bg-gray-700 dark:text-white text-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600'
                    }`}
                  >
                    {filter.label}
                  </button>
                ))}
              </div>
              
              {/* 현재 필터 상태 표시 */}
              <div className="text-sm text-gray-600 dark:text-gray-400">
                📋 현재 필터: <span className="font-semibold text-purple-600 dark:text-purple-400">{siteDetailFilter}</span> | 
                표시: <span className="font-semibold text-blue-600 dark:text-blue-400">{filteredSiteDetails.length}개</span> / 
                전체: {siteDetails.length}개
              </div>

              <div className="overflow-x-auto max-h-96">
                <table className="w-full border-collapse min-w-[600px]">
                  <thead>
                    <tr className="bg-gray-100 dark:bg-gray-700 text-sm">
                      <th className="border border-gray-300 dark:border-gray-600 px-3 py-2 text-left dark:text-white">사이트명</th>
                      <th className="border border-gray-300 dark:border-gray-600 px-3 py-2 text-left dark:text-white">마지막 상태</th>
                      <th className="border border-gray-300 dark:border-gray-600 px-3 py-2 text-center dark:text-white">전체 집계</th>
                      <th className="border border-gray-300 dark:border-gray-600 px-3 py-2 text-center dark:text-white">승인 포함</th>
                      <th className="border border-gray-300 dark:border-gray-600 px-3 py-2 text-left dark:text-white">제외 사유</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredSiteDetails.length === 0 ? (
                      <tr>
                        <td colSpan={5} className="border border-gray-300 dark:border-gray-600 px-4 py-6 text-center text-gray-500 dark:text-gray-300">
                          선택한 조건에 해당하는 사이트가 없습니다.
                        </td>
                      </tr>
                    ) : (
                      filteredSiteDetails
                        .filter(detail => {
                          // 렌더링 시점에서 한번 더 필터 적용 (안전장치)
                          if (siteDetailFilter === 'approved') return detail.includedInApproved === true;
                          if (siteDetailFilter === 'excluded') return detail.includedInTotal === false;
                          if (siteDetailFilter === 'included') return detail.includedInTotal === true;
                          return true;
                        })
                        .map((detail, idx) => (
                        <tr key={`${detail.siteName}-${detail.lastStatus}-${idx}`} className="text-sm dark:text-white">
                          <td className="border border-gray-300 dark:border-gray-600 px-3 py-2 font-semibold">{detail.siteName}</td>
                          <td className="border border-gray-300 dark:border-gray-600 px-3 py-2">
                            <Badge color={detail.lastStatus.includes('승인') ? 'green' : 'gray'}>{detail.lastStatus}</Badge>
                          </td>
                          <td className="border border-gray-300 dark:border-gray-600 px-3 py-2 text-center">
                            {detail.includedInTotal ? <Badge color="blue">포함</Badge> : <Badge color="gray">제외</Badge>}
                          </td>
                          <td className="border border-gray-300 dark:border-gray-600 px-3 py-2 text-center">
                            {detail.includedInApproved === true ? (
                              <Badge color="green">승인</Badge>
                            ) : (
                              <span className="text-gray-400">
                                - <span className="text-xs">({String(detail.includedInApproved)})</span>
                              </span>
                            )}
                          </td>
                          <td className="border border-gray-300 dark:border-gray-600 px-3 py-2 text-sm text-gray-600 dark:text-gray-300">
                            {detail.exclusionReason || '-'}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* 차트 섹션 */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* 월별 수익 추이 */}
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow-md dark:shadow-gray-900/50 p-6">
          <h2 className="text-lg font-bold text-gray-900 dark:text-white mb-4">📈 월별 수익 추이 (최근 6개월)</h2>
          <ResponsiveContainer width="100%" height={300}>
            <LineChart data={monthlyTrend}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
              <XAxis dataKey="month" stroke="#6b7280" style={{ fontSize: '12px' }} />
              <YAxis stroke="#6b7280" style={{ fontSize: '12px' }} tickFormatter={(value) => `${(value / 10000).toFixed(0)}만`} />
              <Tooltip content={<CustomTooltip />} />
              <Legend />
              <Line 
                type="monotone" 
                dataKey="margin" 
                name="수익" 
                stroke={COLORS.primary} 
                strokeWidth={3}
                dot={{ fill: COLORS.primary, r: 5 }}
                activeDot={{ r: 7 }}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>

        {/* 일별 수익 추이 */}
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow-md dark:shadow-gray-900/50 p-6">
          <h2 className="text-lg font-bold text-gray-900 dark:text-white mb-4">📅 일별 수익 추이 (이번 달)</h2>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={dailyTrend}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
              <XAxis dataKey="date" stroke="#6b7280" style={{ fontSize: '12px' }} />
              <YAxis stroke="#6b7280" style={{ fontSize: '12px' }} tickFormatter={(value) => `${(value / 10000).toFixed(0)}만`} />
              <Tooltip content={<CustomTooltip />} />
              <Legend />
              <Bar 
                dataKey="margin" 
                name="수익" 
                fill={COLORS.success}
                radius={[8, 8, 0, 0]}
                isAnimationActive={false}
              >
                {dailyTrend.map((entry, index) => {
                  const value = entry.margin;
                  let fillColor;
                  if (value === null || value === undefined) {
                    fillColor = '#9ca3af'; // 회색 (데이터 없음)
                  } else if (value < 0) {
                    fillColor = COLORS.danger; // 빨강 (음수)
                  } else {
                    fillColor = COLORS.success; // 초록 (양수)
                  }
                  return <Cell key={`cell-${index}`} fill={fillColor} />;
                })}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* 유저별 통계 */}
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-md dark:shadow-gray-900/50 p-6">
        <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-4">👤 유저별 포인트 분석</h2>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse min-w-[720px] sm:min-w-0">
            <thead>
              <tr className="bg-gray-100 dark:bg-gray-700">
                <th className="border border-gray-300 dark:border-gray-600 sm:px-4 sm:py-2 px-2 py-1 text-left dark:text-white whitespace-nowrap">순위</th>
                <th className="border border-gray-300 dark:border-gray-600 sm:px-4 sm:py-2 px-2 py-1 text-left dark:text-white whitespace-nowrap">유저</th>
                <th className="border border-gray-300 dark:border-gray-600 sm:px-4 sm:py-2 px-2 py-1 text-right dark:text-white whitespace-nowrap">총 포인트</th>
                <th className="border border-gray-300 dark:border-gray-600 sm:px-4 sm:py-2 px-2 py-1 text-center dark:text-white whitespace-nowrap">사이트 수</th>
                <th className="border border-gray-300 dark:border-gray-600 sm:px-4 sm:py-2 px-2 py-1 text-center dark:text-white whitespace-nowrap">승인</th>
                <th className="border border-gray-300 dark:border-gray-600 sm:px-4 sm:py-2 px-2 py-1 text-right dark:text-white whitespace-nowrap">효율성</th>
              </tr>
            </thead>
            <tbody>
              {identityStats.map((item, index) => (
                <tr key={item.identityName} className={`${index % 2 === 0 ? 'bg-white dark:bg-gray-800' : 'bg-gray-50 dark:bg-gray-700/50'} dark:text-white`}>
                  <td className="border border-gray-300 dark:border-gray-600 sm:px-4 sm:py-2 px-2 py-1 whitespace-nowrap">
                    <span className="whitespace-nowrap text-xs sm:text-sm"><Badge color="gray">{index + 1}</Badge></span>
                  </td>
                  <td className="border border-gray-300 dark:border-gray-600 sm:px-4 sm:py-2 px-2 py-1 font-semibold whitespace-nowrap">{item.identityName}</td>
                  <td className="border border-gray-300 dark:border-gray-600 sm:px-4 sm:py-2 px-2 py-1 text-right whitespace-nowrap">
                    <span className="whitespace-nowrap text-xs sm:text-sm"><Badge color="amber">{formatCurrency(item.totalPoints)}원</Badge></span>
                  </td>
                  <td className="border border-gray-300 dark:border-gray-600 sm:px-4 sm:py-2 px-2 py-1 text-center whitespace-nowrap">
                    <Badge color="blue">{item.siteCount}</Badge>
                  </td>
                  <td className="border border-gray-300 dark:border-gray-600 sm:px-4 sm:py-2 px-2 py-1 text-center whitespace-nowrap">
                    <Badge color="green">{item.activeSiteCount}</Badge>
                  </td>
                  <td className="border border-gray-300 dark:border-gray-600 sm:px-4 sm:py-2 px-2 py-1 text-right whitespace-nowrap">
                    <Badge color="gray">{formatCurrency(item.efficiency)}원/개</Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* 사이트별 통계 */}
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-md dark:shadow-gray-900/50 p-6">
        <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-4">🌐 사이트별 포인트 순위 (TOP 10)</h2>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse min-w-[720px] sm:min-w-0">
            <thead>
              <tr className="bg-gray-100 dark:bg-gray-700">
                <th className="border border-gray-300 dark:border-gray-600 sm:px-4 sm:py-2 px-2 py-1 text-left dark:text-white whitespace-nowrap">순위</th>
                <th className="border border-gray-300 dark:border-gray-600 sm:px-4 sm:py-2 px-2 py-1 text-left dark:text-white whitespace-nowrap">사이트</th>
                <th className="border border-gray-300 dark:border-gray-600 sm:px-4 sm:py-2 px-2 py-1 text-right dark:text-white whitespace-nowrap">총 포인트</th>
                <th className="border border-gray-300 dark:border-gray-600 sm:px-4 sm:py-2 px-2 py-1 text-center dark:text-white whitespace-nowrap">기록 수</th>
                <th className="border border-gray-300 dark:border-gray-600 sm:px-4 sm:py-2 px-2 py-1 text-center dark:text-white whitespace-nowrap">유저 수</th>
                <th className="border border-gray-300 dark:border-gray-600 sm:px-4 sm:py-2 px-2 py-1 text-right dark:text-white whitespace-nowrap">평균</th>
              </tr>
            </thead>
            <tbody>
              {siteStats.map((item, index) => (
                <tr key={item.siteName} className={`${index % 2 === 0 ? 'bg-white dark:bg-gray-800' : 'bg-gray-50 dark:bg-gray-700/50'} dark:text-white`}>
                  <td className="border border-gray-300 dark:border-gray-600 sm:px-4 sm:py-2 px-2 py-1 whitespace-nowrap">
                    <span className="whitespace-nowrap text-xs sm:text-sm"><Badge color="gray">{index + 1}</Badge></span>
                  </td>
                  <td className="border border-gray-300 dark:border-gray-600 sm:px-4 sm:py-2 px-2 py-1 font-semibold whitespace-nowrap">{item.siteName}</td>
                  <td className="border border-gray-300 dark:border-gray-600 sm:px-4 sm:py-2 px-2 py-1 text-right whitespace-nowrap">
                    <span className="whitespace-nowrap text-xs sm:text-sm"><Badge color="amber">{formatCurrency(item.totalPoints)}원</Badge></span>
                  </td>
                  <td className="border border-gray-300 dark:border-gray-600 sm:px-4 sm:py-2 px-2 py-1 text-center whitespace-nowrap">
                    <Badge color="purple">{item.recordCount}</Badge>
                  </td>
                  <td className="border border-gray-300 dark:border-gray-600 sm:px-4 sm:py-2 px-2 py-1 text-center whitespace-nowrap">
                    <Badge color="teal">{item.identityCount}</Badge>
                  </td>
                  <td className="border border-gray-300 dark:border-gray-600 sm:px-4 sm:py-2 px-2 py-1 text-right whitespace-nowrap">
                    <Badge color="gray">{formatCurrency(item.avgPoints)}원</Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export default Dashboard;
