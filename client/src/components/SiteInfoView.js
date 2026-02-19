import React, { useState, useEffect, useMemo } from 'react';
import axiosInstance from '../api/axios';
import { useAuth } from '../contexts/AuthContext';
import { getIdentitiesCached } from '../api/identitiesCache';
import toast from 'react-hot-toast';

const formatPayback = (payback) => {
  if (!payback) return '';
  if (typeof payback === 'string') return payback;

  if (payback.type === '수동') {
    return payback.sameDayPercent ? `당일 ${payback.sameDayPercent}%` : '';
  } else if (payback.type === '요일별') {
    const days = payback.days || [];
    const percent = payback.percent || '';
    if (days.length > 0 && percent) {
      const dayNames = ['일', '월', '화', '수', '목', '금', '토'];
      const dayStr = days.map(d => dayNames[d]).join(',');
      return `${dayStr} ${percent}%`;
    }
  }
  return '';
};

const formatCurrency = (amount) => {
  if (!amount && amount !== 0) return '0';
  return Math.abs(amount).toLocaleString('ko-KR');
};

// ─────────────────────────────────────────────────────
// 슈퍼관리자 전용 오버뷰
// ─────────────────────────────────────────────────────
function SuperAdminOverview() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [officeFilter, setOfficeFilter] = useState('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [expandedEvents, setExpandedEvents] = useState(new Set());
  const [collapsedOffices, setCollapsedOffices] = useState(new Set());

  useEffect(() => {
    loadOverview();
  }, []);

  const loadOverview = async () => {
    setLoading(true);
    try {
      const response = await axiosInstance.get('/site-notes/admin/overview');
      if (response.data.success) {
        setData(response.data);
      }
    } catch (error) {
      console.error('오버뷰 로드 실패:', error);
      toast.error('사이트 정보를 불러오는데 실패했습니다');
    } finally {
      setLoading(false);
    }
  };

  const toggleOffice = (officeId) => {
    setCollapsedOffices(prev => {
      const next = new Set(prev);
      if (next.has(officeId)) next.delete(officeId);
      else next.add(officeId);
      return next;
    });
  };

  const toggleEvents = (siteId) => {
    setExpandedEvents(prev => {
      const next = new Set(prev);
      if (next.has(siteId)) next.delete(siteId);
      else next.add(siteId);
      return next;
    });
  };

  const filteredOffices = useMemo(() => {
    if (!data?.offices) return [];

    let offices = data.offices;

    if (officeFilter !== 'all') {
      const officeId = parseInt(officeFilter);
      offices = offices.filter(o => (o.id || 0) === officeId);
    }

    if (searchTerm.trim()) {
      const term = searchTerm.toLowerCase();
      offices = offices
        .map(office => ({
          ...office,
          identities: office.identities
            .map(identity => ({
              ...identity,
              sites: identity.sites.filter(site =>
                site.site_name.toLowerCase().includes(term)
              )
            }))
            .filter(identity => identity.sites.length > 0)
        }))
        .filter(office => office.identities.length > 0);
    }

    return offices;
  }, [data, officeFilter, searchTerm]);

  const filteredSummary = useMemo(() => {
    let totalIdentities = 0;
    let totalSites = 0;
    let totalEvents = 0;
    filteredOffices.forEach(office => {
      totalIdentities += office.identities.length;
      office.identities.forEach(identity => {
        totalSites += identity.sites.length;
        identity.sites.forEach(site => {
          totalEvents += site.events.length;
        });
      });
    });
    return { totalOffices: filteredOffices.length, totalIdentities, totalSites, totalEvents };
  }, [filteredOffices]);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p className="text-gray-600 dark:text-gray-400">사이트 정보를 불러오는 중...</p>
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="text-center py-12 text-gray-500 dark:text-gray-400">
        <p className="text-lg mb-2">데이터를 불러올 수 없습니다</p>
        <button onClick={loadOverview} className="text-blue-600 hover:text-blue-700 text-sm">
          다시 시도
        </button>
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6 space-y-4 bg-gray-50 dark:bg-gray-900 min-h-screen">
      {/* 헤더 */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
            📋 전체 사이트 정보 현황
          </h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            사무실 {filteredSummary.totalOffices}개 · 유저 {filteredSummary.totalIdentities}명 · 사이트 {filteredSummary.totalSites}개 · 이벤트 {filteredSummary.totalEvents}건
          </p>
        </div>
        <button
          onClick={loadOverview}
          className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm font-medium transition-colors"
        >
          🔄 새로고침
        </button>
      </div>

      {/* 필터 바 */}
      <div className="flex flex-col sm:flex-row gap-3 bg-white dark:bg-gray-800 p-3 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700">
        <select
          value={officeFilter}
          onChange={(e) => setOfficeFilter(e.target.value)}
          className="px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          <option value="all">전체 사무실</option>
          {(data.offices || []).map(office => (
            <option key={office.id || 0} value={office.id || 0}>
              🏢 {office.name}
            </option>
          ))}
        </select>
        <div className="relative flex-1">
          <input
            type="text"
            placeholder="사이트명 검색..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full px-3 py-2 pl-8 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <span className="absolute left-2.5 top-2.5 text-gray-400 text-sm">🔍</span>
        </div>
        {searchTerm && (
          <button
            onClick={() => setSearchTerm('')}
            className="px-3 py-2 text-sm text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white"
          >
            초기화
          </button>
        )}
      </div>

      {/* 사무실 섹션 */}
      {filteredOffices.map(office => {
        const officeKey = office.id || 0;
        const isCollapsed = collapsedOffices.has(officeKey);
        const totalSitesInOffice = office.identities.reduce((sum, i) => sum + i.sites.length, 0);
        const totalEventsInOffice = office.identities.reduce(
          (sum, i) => sum + i.sites.reduce((s, site) => s + site.events.length, 0), 0
        );

        return (
          <div
            key={officeKey}
            className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 overflow-hidden"
          >
            {/* 사무실 헤더 */}
            <div
              className="px-4 py-3 bg-gradient-to-r from-gray-50 to-gray-100 dark:from-gray-700 dark:to-gray-700/80 cursor-pointer select-none"
              onClick={() => toggleOffice(officeKey)}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <span className="text-gray-500 dark:text-gray-400 text-sm w-4">
                    {isCollapsed ? '▶' : '▼'}
                  </span>
                  <div>
                    <span className="font-bold text-gray-900 dark:text-white text-base">
                      🏢 {office.name}
                    </span>
                    <span className="text-sm text-gray-500 dark:text-gray-400 ml-3">
                      유저 {office.identities.length}명 · 사이트 {totalSitesInOffice}개 · 이벤트 {totalEventsInOffice}건
                    </span>
                  </div>
                </div>
                <div className="text-sm hidden sm:block">
                  <span className="text-gray-500 dark:text-gray-400 mr-1">이번달:</span>
                  <span
                    className={`font-bold ${
                      office.monthlyPoints > 0
                        ? 'text-green-600 dark:text-green-400'
                        : office.monthlyPoints < 0
                        ? 'text-red-600 dark:text-red-400'
                        : 'text-gray-500 dark:text-gray-400'
                    }`}
                  >
                    {office.monthlyPoints > 0 ? '+' : office.monthlyPoints < 0 ? '-' : ''}
                    {formatCurrency(office.monthlyPoints)}원
                  </span>
                </div>
              </div>
              {/* 모바일용 포인트 */}
              <div className="text-sm sm:hidden mt-1 ml-7">
                <span className="text-gray-500 dark:text-gray-400 mr-1">이번달:</span>
                <span
                  className={`font-bold ${
                    office.monthlyPoints > 0
                      ? 'text-green-600 dark:text-green-400'
                      : office.monthlyPoints < 0
                      ? 'text-red-600 dark:text-red-400'
                      : 'text-gray-500 dark:text-gray-400'
                  }`}
                >
                  {office.monthlyPoints > 0 ? '+' : office.monthlyPoints < 0 ? '-' : ''}
                  {formatCurrency(office.monthlyPoints)}원
                </span>
              </div>
            </div>

            {/* 사무실 내용 */}
            {!isCollapsed && (
              <div className="divide-y divide-gray-100 dark:divide-gray-700/50">
                {office.identities.map(identity => {
                  const identityEventCount = identity.sites.reduce(
                    (sum, site) => sum + site.events.length, 0
                  );

                  return (
                    <div key={identity.id} className="p-4">
                      {/* 유저 헤더 */}
                      <div className="flex items-center gap-2 mb-3">
                        <span className="font-semibold text-gray-800 dark:text-gray-200">
                          👤 {identity.name}
                        </span>
                        <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 dark:bg-gray-600 text-gray-600 dark:text-gray-300">
                          사이트 {identity.sites.length}개
                        </span>
                        {identityEventCount > 0 && (
                          <span className="text-xs px-2 py-0.5 rounded-full bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300">
                            이벤트 {identityEventCount}건
                          </span>
                        )}
                      </div>

                      {/* 사이트 테이블 */}
                      <div className="overflow-x-auto border border-gray-200 dark:border-gray-600 rounded-lg">
                        <table className="w-full min-w-[760px]">
                          <thead>
                            <tr className="bg-gray-50 dark:bg-gray-700/50">
                              <th className="px-3 py-2 text-left text-xs font-semibold text-gray-600 dark:text-gray-300">사이트명</th>
                              <th className="px-3 py-2 text-center text-xs font-semibold text-gray-600 dark:text-gray-300 w-16">만근</th>
                              <th className="px-3 py-2 text-center text-xs font-semibold text-gray-600 dark:text-gray-300 w-20">출석구분</th>
                              <th className="px-3 py-2 text-center text-xs font-semibold text-gray-600 dark:text-gray-300 w-14">이월</th>
                              <th className="px-3 py-2 text-center text-xs font-semibold text-gray-600 dark:text-gray-300 w-14">승전</th>
                              <th className="px-3 py-2 text-center text-xs font-semibold text-gray-600 dark:text-gray-300 w-16">요율</th>
                              <th className="px-3 py-2 text-center text-xs font-semibold text-gray-600 dark:text-gray-300 w-28">페이백</th>
                              <th className="px-3 py-2 text-center text-xs font-semibold text-gray-600 dark:text-gray-300 w-20">이벤트</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-gray-100 dark:divide-gray-700/50">
                            {identity.sites.map(site => {
                              const isExpanded = expandedEvents.has(site.id);
                              const hasEvents = site.events.length > 0;

                              return (
                                <React.Fragment key={site.id}>
                                  <tr
                                    className={`text-sm transition-colors ${
                                      isExpanded
                                        ? 'bg-blue-50/70 dark:bg-blue-900/20'
                                        : 'hover:bg-gray-50 dark:hover:bg-gray-700/30'
                                    }`}
                                  >
                                    <td className="px-3 py-2.5">
                                      <span className="font-medium text-gray-900 dark:text-white">
                                        {site.site_name}
                                      </span>
                                      {site.recorded_by && (
                                        <span className="text-xs text-gray-400 dark:text-gray-500 ml-1.5">
                                          ({site.recorded_by})
                                        </span>
                                      )}
                                    </td>
                                    <td className="px-3 py-2.5 text-center text-gray-700 dark:text-gray-300">
                                      {site.tenure || '-'}
                                    </td>
                                    <td className="px-3 py-2.5 text-center">
                                      <span
                                        className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${
                                          site.attendanceType === '수동'
                                            ? 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300'
                                            : 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300'
                                        }`}
                                      >
                                        {site.attendanceType}
                                      </span>
                                    </td>
                                    <td className="px-3 py-2.5 text-center text-gray-700 dark:text-gray-300">
                                      {site.rollover || '-'}
                                    </td>
                                    <td className="px-3 py-2.5 text-center text-gray-700 dark:text-gray-300">
                                      {site.settlement || '-'}
                                    </td>
                                    <td className="px-3 py-2.5 text-center text-gray-700 dark:text-gray-300">
                                      {site.rate || '-'}
                                    </td>
                                    <td className="px-3 py-2.5 text-center text-gray-700 dark:text-gray-300 text-xs">
                                      {formatPayback(site.payback) || '-'}
                                    </td>
                                    <td className="px-3 py-2.5 text-center">
                                      {hasEvents ? (
                                        <button
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            toggleEvents(site.id);
                                          }}
                                          className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium transition-colors ${
                                            isExpanded
                                              ? 'bg-blue-200 text-blue-800 dark:bg-blue-800 dark:text-blue-200'
                                              : 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300 hover:bg-blue-200 dark:hover:bg-blue-900/50'
                                          }`}
                                        >
                                          📌 {site.events.length}건
                                          <span className="text-[10px]">{isExpanded ? '▲' : '▼'}</span>
                                        </button>
                                      ) : (
                                        <span className="text-xs text-gray-400 dark:text-gray-500">없음</span>
                                      )}
                                    </td>
                                  </tr>

                                  {/* 이벤트 상세 펼침 */}
                                  {isExpanded && hasEvents && (
                                    <tr>
                                      <td
                                        colSpan={8}
                                        className="px-0 py-0 bg-blue-50/50 dark:bg-blue-950/20"
                                      >
                                        <div className="px-4 py-3 ml-4 mr-4 mb-1">
                                          <table className="w-full">
                                            <thead>
                                              <tr className="text-xs text-gray-500 dark:text-gray-400 border-b border-blue-200/50 dark:border-blue-800/50">
                                                <th className="text-left py-1.5 pr-4 font-semibold w-32">이벤트</th>
                                                <th className="text-left py-1.5 pr-4 font-semibold">이벤트내용</th>
                                                <th className="text-left py-1.5 font-semibold w-28">이벤트롤링</th>
                                              </tr>
                                            </thead>
                                            <tbody>
                                              {site.events.map((event, idx) => (
                                                <tr
                                                  key={idx}
                                                  className="text-sm border-b border-blue-100/50 dark:border-blue-900/30 last:border-0"
                                                >
                                                  <td className="py-1.5 pr-4 font-medium text-gray-800 dark:text-gray-200">
                                                    {event.event || ''}
                                                  </td>
                                                  <td className="py-1.5 pr-4 text-gray-700 dark:text-gray-300 whitespace-pre-wrap">
                                                    {event.detail || ''}
                                                  </td>
                                                  <td className="py-1.5 text-gray-700 dark:text-gray-300">
                                                    {event.rolling || 'X'}
                                                  </td>
                                                </tr>
                                              ))}
                                            </tbody>
                                          </table>
                                        </div>
                                      </td>
                                    </tr>
                                  )}
                                </React.Fragment>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}

      {filteredOffices.length === 0 && (
        <div className="text-center py-16 text-gray-500 dark:text-gray-400">
          <p className="text-lg mb-2">
            {searchTerm ? '검색 결과가 없습니다' : '사이트 데이터가 없습니다'}
          </p>
          {searchTerm && (
            <button
              onClick={() => setSearchTerm('')}
              className="text-blue-600 hover:text-blue-700 dark:text-blue-400 text-sm"
            >
              검색어 초기화
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────
// 일반 사용자용 기존 사이트 정보 조회
// ─────────────────────────────────────────────────────
function RegularSiteInfoView() {
  const [identities, setIdentities] = useState([]);
  const [allSites, setAllSites] = useState([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [filteredSites, setFilteredSites] = useState([]);
  const [selectedSite, setSelectedSite] = useState(null);
  const [siteData, setSiteData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(-1);

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

  useEffect(() => {
    const loadAllSites = async () => {
      if (identities.length === 0) return;

      try {
        const allSitesList = [];

        for (const identity of identities) {
          try {
            const response = await axiosInstance.get(`/sites?identity_id=${identity.id}`);
            if (response.data.success && response.data.sites) {
              response.data.sites.forEach(site => {
                if (!allSitesList.find(s => s.site_name === site.site_name)) {
                  allSitesList.push({
                    ...site,
                    identity_name: identity.name
                  });
                }
              });
            }
          } catch (error) {
            console.error(`유저 ${identity.name}의 사이트 로드 실패:`, error);
          }
        }

        allSitesList.sort((a, b) => a.site_name.localeCompare(b.site_name));
        setAllSites(allSitesList);
        setFilteredSites(allSitesList);
      } catch (error) {
        console.error('사이트 목록 로드 실패:', error);
        toast.error('사이트 목록을 불러오는데 실패했습니다');
      }
    };

    loadAllSites();
  }, [identities]);

  useEffect(() => {
    if (!searchTerm.trim()) {
      setFilteredSites(allSites);
      setShowSuggestions(false);
      return;
    }

    const filtered = allSites.filter(site =>
      site.site_name.toLowerCase().includes(searchTerm.toLowerCase())
    );
    setFilteredSites(filtered);
    setShowSuggestions(filtered.length > 0);
    setHighlightedIndex(-1);
  }, [searchTerm, allSites]);

  const loadSiteData = async (siteName) => {
    if (!siteName) {
      setSiteData(null);
      return;
    }

    setLoading(true);
    try {
      const response = await axiosInstance.get(`/site-notes?site_name=${encodeURIComponent(siteName)}`);

      if (response.data.success) {
        setSiteData(response.data.data);
      } else {
        toast.error('사이트 정보를 불러오는데 실패했습니다');
        setSiteData(null);
      }
    } catch (error) {
      console.error('사이트 정보 로드 실패:', error);
      toast.error('사이트 정보를 불러오는데 실패했습니다');
      setSiteData(null);
    } finally {
      setLoading(false);
    }
  };

  const handleSiteSelect = (site) => {
    setSelectedSite(site);
    setSearchTerm(site.site_name);
    setShowSuggestions(false);
    setHighlightedIndex(-1);
    loadSiteData(site.site_name);
  };

  const handleSearchKeyDown = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();

      if (highlightedIndex >= 0 && filteredSites[highlightedIndex]) {
        handleSiteSelect(filteredSites[highlightedIndex]);
        return;
      }

      const exactMatch = filteredSites.find(
        site => site.site_name.toLowerCase() === searchTerm.toLowerCase()
      );

      if (exactMatch) {
        handleSiteSelect(exactMatch);
      } else if (filteredSites.length === 1) {
        handleSiteSelect(filteredSites[0]);
      } else if (filteredSites.length > 0) {
        handleSiteSelect(filteredSites[0]);
      }
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (filteredSites.length > 0) {
        setHighlightedIndex(prev =>
          prev < filteredSites.length - 1 ? prev + 1 : prev
        );
        setShowSuggestions(true);
      }
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlightedIndex(prev => prev > 0 ? prev - 1 : -1);
    } else if (e.key === 'Escape') {
      setShowSuggestions(false);
      setHighlightedIndex(-1);
    }
  };

  return (
    <div
      className="p-4 md:p-6 max-w-7xl mx-auto flex flex-col"
      style={{
        height: 'calc((100vh - 64px) / 0.9)',
        minHeight: 'calc((100vh - 64px) / 0.9)',
      }}
    >
      <h1 className="text-2xl font-bold text-gray-900 dark:text-white mb-6 flex-shrink-0">
        📋 사이트 정보 조회
      </h1>

      {/* 사이트 검색 영역 */}
      <div className="mb-6 flex-shrink-0">
        <div className="relative">
          <input
            type="text"
            placeholder="사이트명으로 검색... (Enter로 선택)"
            value={searchTerm}
            onChange={(e) => {
              setSearchTerm(e.target.value);
              setShowSuggestions(true);
            }}
            onKeyDown={handleSearchKeyDown}
            onFocus={() => {
              if (filteredSites.length > 0) {
                setShowSuggestions(true);
              }
            }}
            className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500 dark:focus:ring-blue-400"
          />
          <span className="absolute right-3 top-2.5 text-gray-400">🔍</span>
        </div>

        {showSuggestions && searchTerm && filteredSites.length > 0 && (
          <div className="mt-2 max-h-60 overflow-y-auto border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 shadow-lg">
            {filteredSites.map((site, index) => (
              <button
                key={index}
                onClick={() => handleSiteSelect(site)}
                onMouseEnter={() => setHighlightedIndex(index)}
                className={`w-full text-left px-4 py-2 transition-colors ${
                  highlightedIndex === index
                    ? 'bg-blue-100 dark:bg-blue-900/30'
                    : selectedSite?.site_name === site.site_name
                    ? 'bg-blue-50 dark:bg-blue-900/20'
                    : 'hover:bg-blue-50 dark:hover:bg-gray-700'
                }`}
              >
                <div className="text-sm font-medium text-gray-900 dark:text-white">
                  {site.site_name}
                </div>
                <div className="text-xs text-gray-500 dark:text-gray-400">
                  유저: {site.identity_name}
                </div>
              </button>
            ))}
          </div>
        )}

        {searchTerm && filteredSites.length === 0 && (
          <div className="mt-2 text-sm text-gray-500 dark:text-gray-400 text-center py-4">
            검색 결과가 없습니다
          </div>
        )}
      </div>

      {/* 선택된 사이트 정보 표시 */}
      {loading && (
        <div className="text-center py-8 flex-1 flex flex-col justify-center">
          <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
          <p className="mt-2 text-gray-600 dark:text-gray-400">로딩 중...</p>
        </div>
      )}

      {!loading && selectedSite && siteData && (
        <div className="flex-1">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* 왼쪽: 사이트 기본 정보 */}
            <div className="lg:col-span-1">
              <div className="bg-white dark:bg-gray-800 rounded-lg shadow-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
                <div className="bg-orange-500 dark:bg-orange-600 px-4 py-2">
                  <h2 className="text-lg font-bold text-white">사이트 기본 정보</h2>
                </div>
                <div className="p-4 space-y-3">
                  <div className="bg-blue-50 dark:bg-blue-900/30 px-3 py-2 rounded">
                    <div className="text-xs text-gray-600 dark:text-gray-400 mb-1">사이트</div>
                    <div className="text-sm font-semibold text-gray-900 dark:text-white">
                      {selectedSite.site_name}
                    </div>
                  </div>
                  <div className="bg-yellow-50 dark:bg-yellow-900/30 px-3 py-2 rounded">
                    <div className="text-xs text-gray-600 dark:text-gray-400 mb-1">정리한사람</div>
                    <div className="text-sm font-semibold text-gray-900 dark:text-white">
                      {siteData.recorded_by_identity || '(없음)'}
                    </div>
                  </div>
                  <div className="bg-white dark:bg-gray-700 px-3 py-2 rounded border border-gray-200 dark:border-gray-600">
                    <div className="text-xs text-gray-600 dark:text-gray-400 mb-1">만근</div>
                    <div className="text-sm font-semibold text-gray-900 dark:text-white">
                      {siteData.data?.tenure || ''}
                    </div>
                  </div>
                  <div className="bg-white dark:bg-gray-700 px-3 py-2 rounded border border-gray-200 dark:border-gray-600">
                    <div className="text-xs text-gray-600 dark:text-gray-400 mb-1">자동수동</div>
                    <div className="text-sm font-semibold text-gray-900 dark:text-white">
                      {siteData.data?.attendanceType || siteData.data?.autoManual || '자동'}
                    </div>
                  </div>
                  <div className="bg-blue-50 dark:bg-blue-900/30 px-3 py-2 rounded">
                    <div className="text-xs text-gray-600 dark:text-gray-400 mb-1">이월유무</div>
                    <div className="text-sm font-semibold text-gray-900 dark:text-white">
                      {siteData.data?.rollover || ''}
                    </div>
                  </div>
                  <div className="bg-blue-50 dark:bg-blue-900/30 px-3 py-2 rounded">
                    <div className="text-xs text-gray-600 dark:text-gray-400 mb-1">승전</div>
                    <div className="text-sm font-semibold text-gray-900 dark:text-white">
                      {siteData.data?.settlement || 'X'}
                    </div>
                  </div>
                  <div className="bg-blue-50 dark:bg-blue-900/30 px-3 py-2 rounded">
                    <div className="text-xs text-gray-600 dark:text-gray-400 mb-1">페이백</div>
                    <div className="text-sm font-semibold text-gray-900 dark:text-white">
                      {formatPayback(siteData.data?.payback) || ''}
                    </div>
                  </div>
                  <div className="bg-white dark:bg-gray-700 px-3 py-2 rounded border border-gray-200 dark:border-gray-600">
                    <div className="text-xs text-gray-600 dark:text-gray-400 mb-1">요율</div>
                    <div className="text-sm font-semibold text-gray-900 dark:text-white">
                      {siteData.data?.rate || ''}
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* 오른쪽: 이벤트 목록 */}
            <div className="lg:col-span-2">
              <div className="bg-white dark:bg-gray-800 rounded-lg shadow-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
                <div className="bg-orange-500 dark:bg-orange-600 px-4 py-2">
                  <h2 className="text-lg font-bold text-white">이벤트 목록</h2>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead>
                      <tr className="bg-gray-100 dark:bg-gray-700">
                        <th className="px-4 py-2 text-left text-sm font-semibold text-gray-900 dark:text-white border-b border-gray-200 dark:border-gray-600">
                          이벤트
                        </th>
                        <th className="px-4 py-2 text-left text-sm font-semibold text-gray-900 dark:text-white border-b border-gray-200 dark:border-gray-600">
                          이벤트내용
                        </th>
                        <th className="px-4 py-2 text-left text-sm font-semibold text-gray-900 dark:text-white border-b border-gray-200 dark:border-gray-600">
                          이벤트롤링
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {siteData.data?.events && siteData.data.events.length > 0 ? (
                        siteData.data.events.map((event, index) => (
                          <tr
                            key={index}
                            className="border-b border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors"
                          >
                            <td className="px-4 py-3 text-sm text-gray-900 dark:text-white">
                              {event.event || ''}
                            </td>
                            <td className="px-4 py-3 text-sm text-gray-900 dark:text-white whitespace-pre-wrap">
                              {event.detail || ''}
                            </td>
                            <td className="px-4 py-3 text-sm text-gray-900 dark:text-white">
                              {event.rolling || 'X'}
                            </td>
                          </tr>
                        ))
                      ) : (
                        <tr>
                          <td colSpan="3" className="px-4 py-8 text-center text-gray-500 dark:text-gray-400">
                            등록된 이벤트가 없습니다
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {!loading && !selectedSite && (
        <div className="text-center py-12 text-gray-500 dark:text-gray-400 flex-1 flex flex-col justify-center">
          <p className="text-lg mb-2">사이트를 검색하여 선택해주세요</p>
          <p className="text-sm">검색창에 사이트명을 입력하면 목록이 표시됩니다</p>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────
// 메인 컴포넌트: 역할에 따라 분기
// ─────────────────────────────────────────────────────
function SiteInfoView() {
  const { isSuperAdmin } = useAuth();

  if (isSuperAdmin) {
    return <SuperAdminOverview />;
  }

  return <RegularSiteInfoView />;
}

export default SiteInfoView;
