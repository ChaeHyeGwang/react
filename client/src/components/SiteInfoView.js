import React, { useState, useEffect } from 'react';
import axiosInstance from '../api/axios';
import { getIdentitiesCached } from '../api/identitiesCache';
import toast from 'react-hot-toast';

function SiteInfoView() {
  const [identities, setIdentities] = useState([]);
  const [allSites, setAllSites] = useState([]); // 모든 명의의 사이트 목록
  const [searchTerm, setSearchTerm] = useState('');
  const [filteredSites, setFilteredSites] = useState([]);
  const [selectedSite, setSelectedSite] = useState(null);
  const [siteData, setSiteData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(-1);

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

  // 모든 명의의 사이트 목록 로드
  useEffect(() => {
    const loadAllSites = async () => {
      if (identities.length === 0) return;

      try {
        const allSitesList = [];
        
        for (const identity of identities) {
          try {
            const response = await axiosInstance.get(`/sites?identity_id=${identity.id}`);
            if (response.data.success && response.data.sites) {
              // 사이트명 중복 제거 (같은 사이트는 한 번만 표시)
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
            console.error(`명의 ${identity.name}의 사이트 로드 실패:`, error);
          }
        }

        // 사이트명으로 정렬
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

  // 검색어로 사이트 필터링
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

  // 선택한 사이트의 정보 로드
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

  // 사이트 선택 핸들러
  const handleSiteSelect = (site) => {
    setSelectedSite(site);
    setSearchTerm(site.site_name);
    setShowSuggestions(false);
    setHighlightedIndex(-1);
    loadSiteData(site.site_name);
  };

  // 검색어 입력 필드 키보드 이벤트
  const handleSearchKeyDown = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      
      // 하이라이트된 항목이 있으면 선택
      if (highlightedIndex >= 0 && filteredSites[highlightedIndex]) {
        handleSiteSelect(filteredSites[highlightedIndex]);
        return;
      }
      
      // 정확히 일치하는 사이트가 있으면 선택
      const exactMatch = filteredSites.find(
        site => site.site_name.toLowerCase() === searchTerm.toLowerCase()
      );
      
      if (exactMatch) {
        handleSiteSelect(exactMatch);
      } else if (filteredSites.length === 1) {
        // 검색 결과가 하나면 자동 선택
        handleSiteSelect(filteredSites[0]);
      } else if (filteredSites.length > 0) {
        // 여러 결과가 있으면 첫 번째 항목 선택
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

  // 페이백 데이터 포맷팅
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

  return (
    <div 
      className="p-4 md:p-6 max-w-7xl mx-auto flex flex-col"
      style={{
        height: 'calc((100vh - 64px) / 0.9)', // 네비게이션 높이(64px)를 제외하고 zoom 0.9를 고려한 높이
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

        {/* 검색 결과 목록 */}
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
                  명의: {site.identity_name}
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

export default SiteInfoView;

