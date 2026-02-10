import React, { useState, useEffect, useRef, useLayoutEffect, useMemo, useCallback } from 'react';
import { useLocation } from 'react-router-dom';
import toast from 'react-hot-toast';
import axiosInstance from '../api/axios';
import { getIdentitiesCached, invalidateIdentitiesCache } from '../api/identitiesCache';
import { DragDropContext, Droppable, Draggable } from '@hello-pangea/dnd';
import SiteNotesModal from './SiteNotesModal';
import { useAuth } from '../contexts/AuthContext';
import { useRealtimeSync } from '../hooks/useRealtimeSync';

// Debounce 유틸리티 함수
const useDebounce = (value, delay) => {
  const [debouncedValue, setDebouncedValue] = useState(value);

  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedValue(value);
    }, delay);

    return () => {
      clearTimeout(handler);
    };
  }, [value, delay]);

  return debouncedValue;
};
 
const SiteManagement = () => {
  const location = useLocation();
  const { isOfficeManager, isSuperAdmin, selectedAccountId } = useAuth();
  const [identities, setIdentities] = useState([]);
  const [accounts, setAccounts] = useState([]); // 계정 목록 (관리자용)
  const [selectedIdentity, setSelectedIdentity] = useState(null);
  const [sites, setSites] = useState([]);
  
  // 페이징 상태
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage] = useState(50);
  
  // 커뮤니티 상태
  const [communities, setCommunities] = useState([]);
  const [showCommunityModal, setShowCommunityModal] = useState(false);
  const [editingCommunity, setEditingCommunity] = useState(null);
  
  // 커뮤니티 인라인 편집 상태
  const [editingCommunityCell, setEditingCommunityCell] = useState(null); // { communityId, field }
  const [editingCommunityValue, setEditingCommunityValue] = useState('');
  
  // 승전(approval_call) 인라인 편집 상태
  const [editingApprovalCall, setEditingApprovalCall] = useState(null); // { id, type: 'site' | 'community' }
  const [editingApprovalValue, setEditingApprovalValue] = useState(false);
  
  // 필터 상태
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('전체');
  const [monthFilter, setMonthFilter] = useState('전체');
  
  // Debounced 검색어 (300ms 지연) - 서버 부하 감소
  const debouncedSearchTerm = useDebounce(searchTerm, 300);
  
  // 커뮤니티 필터 상태
  const [communitySearchTerm, setCommunitySearchTerm] = useState('');
  const [communityStatusFilter, setCommunityStatusFilter] = useState('전체');
  const [communityMonthFilter, setCommunityMonthFilter] = useState('전체');
  
  // Debounced 커뮤니티 검색어 (300ms 지연) - 서버 부하 감소
  const debouncedCommunitySearchTerm = useDebounce(communitySearchTerm, 300);
  
  // 인라인 편집 상태
  const [editingCell, setEditingCell] = useState(null); // { siteId, field }
  const [editingValue, setEditingValue] = useState('');
  const [isManualInputMode, setIsManualInputMode] = useState(false); // 수동입력 모드인지 체크
  const [editingStatusDate, setEditingStatusDate] = useState(''); // 승인유무 날짜 (MM.DD 형식)
  const savingCellRef = useRef(false); // 저장 중복 방지
  
  // 이력 개별 편집 상태
  const [editingHistoryIndex, setEditingHistoryIndex] = useState(null); // 편집 중인 이력 인덱스
  const [editingHistoryDate, setEditingHistoryDate] = useState(''); // 편집 중인 이력 날짜
  const [editingHistoryStatus, setEditingHistoryStatus] = useState(''); // 편집 중인 이력 상태
  
  // 새 행 추가 상태
  const [newSiteRow, setNewSiteRow] = useState(null); // 새로 추가할 사이트 행
  const [newCommunityRow, setNewCommunityRow] = useState(null); // 새로 추가할 커뮤니티 행
  
  // 삭제 버튼 클릭 플래그 (onBlur 방지용)
  const [isDeletingHistory, setIsDeletingHistory] = useState(false);
  
  // 강조 표시 상태
  const [highlightedSiteId, setHighlightedSiteId] = useState(null);
  const [highlightedCommunityId, setHighlightedCommunityId] = useState(null);
  
  // 행 refs
  const siteRowRefs = useRef({});
  const communityRowRefs = useRef({});
  
  // 모달 상태
  const [showIdentityModal, setShowIdentityModal] = useState(false);
  const [showSiteModal, setShowSiteModal] = useState(false);
  const [showBulkImportModal, setShowBulkImportModal] = useState(false);
  const [bulkImportMode, setBulkImportMode] = useState('sites'); // 'sites' or 'communities'
  const [editingIdentity, setEditingIdentity] = useState(null);
  const [editingSite, setEditingSite] = useState(null);
  
  // 사이트 메타데이터(이벤트/요율 등) 모달 상태
  const [siteNotesModal, setSiteNotesModal] = useState({
    open: false,
    readonly: false,
    mode: 'site', // 'site' | 'community'
    communityId: null,
    siteName: '',
    identityName: '', // 명의명 추가
    recordedBy: '',
    data: {
      tenure: '', // 만근
      attendanceType: '자동', // 출석구분 (자동/수동)
      attendanceDays: 0, // 출석일
      rollover: '', // 이월유무
      payback: { type: '수동', days: [], percent: '', sameDayPercent: '' }, // 페이백
      rate: '', // 요율
      events: [] // 이벤트 정보 (배열)
    }
  });
  
  // 일괄 등록 데이터
  const [bulkImportText, setBulkImportText] = useState('');
  const [parsedBulkData, setParsedBulkData] = useState([]);
  
  // 사이트명 자동완성 관련 상태
  const [allSiteNames, setAllSiteNames] = useState([]); // 기존 모든 사이트명
  const [siteNameSuggestions, setSiteNameSuggestions] = useState([]); // 자동완성 제안
  const [showSuggestions, setShowSuggestions] = useState(false); // 자동완성 드롭다운 표시
  const [similarWarning, setSimilarWarning] = useState(null); // 유사 사이트명 경고
  const [showMergeModal, setShowMergeModal] = useState(false); // 통합 도구 모달
  const [duplicateGroups, setDuplicateGroups] = useState([]); // 중복/유사 그룹
  const [selectedMergeSource, setSelectedMergeSource] = useState(''); // 통합 원본
  const [selectedMergeTarget, setSelectedMergeTarget] = useState(''); // 통합 대상
  const siteNameInputRef = useRef(null); // 사이트명 입력 필드 ref

  // KST 기준 오늘 날짜 (MM.DD)
  const getTodayKSTDate = useCallback(() => {
    const now = new Date();
    const kstDate = new Date(now.toLocaleString('en-US', {timeZone: 'Asia/Seoul'}));
    const month = String(kstDate.getMonth() + 1).padStart(2, '0');
    const day = String(kstDate.getDate()).padStart(2, '0');
    return `${month}.${day}`;
  }, []);

  // 일괄 등록 상태 초기화
  const resetBulkImportState = () => {
    setBulkImportText('');
    setParsedBulkData([]);
    setBulkImportMode('sites');
  };

  // 사이트 정보를 한 줄 문자열로 만드는 헬퍼
  const buildSiteSummaryString = (site) => {
    // 성함: identity_name 또는 현재 선택된 명의
    const name = site.identity_name || selectedIdentity?.name || '';
    // 아이디
    const accountId = site.account_id || '';
    // 비밀번호
    const password = site.password || '';
    // 환비
    const exchangePassword = site.exchange_password || '';
    // 닉네임
    const nickname = site.nickname || '';
    // 승인유무 (예: "12.03 가입전 / 12.23 대기")
    const status = site.status || '';
    // 경로
    const route = site.referral_path || '';
    // 출석(사이트명)
    const siteName = site.site_name || '';

    // 첫 번째 줄: 성함 아이디 비밀번호 환비 닉네임 승인유무 경로
    const firstLine = [name, accountId, password, exchangePassword, nickname, status, route]
      .map((v) => (v || '').toString().trim())
      .filter((v) => v.length > 0)
      .join(' ');
    
    // 두 번째 줄: 빈 줄
    // 세 번째 줄: 사이트이름
    return `${firstLine}\n\n${siteName}`;
  };

  // 사이트 요약 문자열을 클립보드로 복사
  const copySiteSummary = async (site) => {
    const text = buildSiteSummaryString(site);
    if (!text) {
      toast.error('복사할 문자열이 없습니다');
      return;
    }

    try {
      if (navigator && navigator.clipboard && navigator.clipboard.writeText) {
        // 최신 브라우저 API 사용
        await navigator.clipboard.writeText(text);
      } else {
        // fallback: execCommand 기반 복사
        const textarea = document.createElement('textarea');
        textarea.value = text;
        textarea.setAttribute('readonly', '');
        textarea.style.position = 'fixed';
        textarea.style.top = '-1000px';
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand('copy');
        document.body.removeChild(textarea);
      }
      toast.success('사이트 요약 문자열을 복사했습니다');
    } catch (err) {
      console.error('클립보드 복사 실패:', err);
      toast.error('클립보드 복사에 실패했습니다');
    }
  };

  // 커뮤니티 정보를 한 줄 문자열로 만드는 헬퍼
  const buildCommunitySummaryString = (community) => {
    const name = community.identity_name || selectedIdentity?.name || '';
    const accountId = community.account_id || '';
    const password = community.password || '';
    const exchangePassword = community.exchange_password || '';
    const nickname = community.nickname || '';
    const status = community.status || '';
    const route = community.referral_path || '';
    const siteName = community.site_name || '';

    const firstLine = [name, accountId, password, exchangePassword, nickname, status, route]
      .map((v) => (v || '').toString().trim())
      .filter((v) => v.length > 0)
      .join(' ');
    
    return `${firstLine}\n\n${siteName}`;
  };

  // 커뮤니티 요약 문자열을 클립보드로 복사
  const copyCommunitySummary = async (community) => {
    const text = buildCommunitySummaryString(community);
    if (!text) {
      toast.error('복사할 문자열이 없습니다');
      return;
    }

    try {
      if (navigator && navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        const textarea = document.createElement('textarea');
        textarea.value = text;
        textarea.setAttribute('readonly', '');
        textarea.style.position = 'fixed';
        textarea.style.top = '-1000px';
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand('copy');
        document.body.removeChild(textarea);
      }
      toast.success('커뮤니티 요약 문자열을 복사했습니다');
    } catch (err) {
      console.error('클립보드 복사 실패:', err);
      toast.error('클립보드 복사에 실패했습니다');
    }
  };
  
  // 폼 데이터
  const [identityForm, setIdentityForm] = useState({
    name: '',
    birth_date: '',
    zodiac: '',
    bank_accounts: [],
    phone_numbers: [],
    nicknames: [],
    status: 'active',
    notes: ''
  });
  
  // 생년월일에서 띠 계산 함수 (음력 설날 기준)
  const calculateZodiac = (birthDate) => {
    if (!birthDate) return '';
    
    const date = new Date(birthDate);
    const year = date.getFullYear();
    const month = date.getMonth() + 1; // 1-12
    const day = date.getDate();
    
    // 띠 배열: 쥐, 소, 호랑이, 토끼, 용, 뱀, 말, 양, 원숭이, 닭, 개, 돼지
    const zodiacArray = ['쥐', '소', '호랑이', '토끼', '용', '뱀', '말', '양', '원숭이', '닭', '개', '돼지'];
    
    // 각 년도의 음력 설날 날짜 (월, 일)
    // 설날 이전이면 전년도 띠를 사용
    const lunarNewYearDates = {
      1990: { month: 1, day: 27 },
      1991: { month: 2, day: 15 },
      1992: { month: 2, day: 4 },
      1993: { month: 1, day: 23 },
      1994: { month: 2, day: 10 },
      1995: { month: 1, day: 31 },
      1996: { month: 2, day: 19 },
      1997: { month: 2, day: 7 },
      1998: { month: 1, day: 28 },
      1999: { month: 2, day: 16 },
      2000: { month: 2, day: 5 },
      2001: { month: 1, day: 24 },
      2002: { month: 2, day: 12 },
      2003: { month: 2, day: 1 },
      2004: { month: 1, day: 22 },
      2005: { month: 2, day: 9 },
      2006: { month: 1, day: 29 },
      2007: { month: 2, day: 18 },
      2008: { month: 2, day: 7 },
      2009: { month: 1, day: 26 },
      2010: { month: 2, day: 14 },
      2011: { month: 2, day: 3 },
      2012: { month: 1, day: 23 },
      2013: { month: 2, day: 10 },
      2014: { month: 1, day: 31 },
      2015: { month: 2, day: 19 },
      2016: { month: 2, day: 8 },
      2017: { month: 1, day: 28 },
      2018: { month: 2, day: 16 },
      2019: { month: 2, day: 5 },
      2020: { month: 1, day: 25 },
      2021: { month: 2, day: 12 },
      2022: { month: 2, day: 1 },
      2023: { month: 1, day: 22 },
      2024: { month: 2, day: 10 },
      2025: { month: 1, day: 29 },
      2026: { month: 2, day: 17 },
      2027: { month: 2, day: 6 },
      2028: { month: 1, day: 26 },
      2029: { month: 2, day: 13 },
      2030: { month: 2, day: 3 }
    };
    
    // 실제 띠를 계산할 연도 결정
    let zodiacYear = year;
    
    // 해당 년도의 설날 날짜 확인
    const newYearDate = lunarNewYearDates[year];
    
    if (newYearDate) {
      // 설날 이전이면 전년도 띠 사용
      if (month < newYearDate.month || (month === newYearDate.month && day < newYearDate.day)) {
        zodiacYear = year - 1;
      }
    } else {
      // 설날 정보가 없으면 대략적으로 2월 5일 기준 사용
      if (month === 1 || (month === 2 && day < 5)) {
        zodiacYear = year - 1;
      }
    }
    
    // 1960년이 쥐띠 (0) - 주기 12년
    const zodiacIndex = (zodiacYear - 1960) % 12;
    
    // 음수 처리 (1960년 이전)
    const finalIndex = zodiacIndex < 0 ? zodiacIndex + 12 : zodiacIndex;
    
    return zodiacArray[finalIndex];
  };
  
  const [communityForm, setCommunityForm] = useState({
    site_name: '',      // 출석
    domain: '',         // 도메인
    referral_path: '',  // 경로-코드
    approval_call: false, // 승전 (X/O)
    identity_name: '',  // 성함
    account_id: '',     // 아이디
    password: '',       // 비번
    exchange_password: '', // 환비
    nickname: '',       // 닉네임
    status: '가입전',   // 승인유무
    referral_code: '',  // 경로
    notes: ''           // 장
  });
  
  const [siteForm, setSiteForm] = useState({
    site_name: '',      // 출석
    domain: '',         // 도메인
    referral_path: '',  // 경로-코드
    approval_call: false, // 승전 (X/O)
    identity_name: '',  // 성함
    account_id: '',     // 아이디
    password: '',       // 비번
    exchange_password: '', // 환비
    nickname: '',       // 닉네임
    status: '가입전',   // 승인유무
    referral_code: '',  // 경로
    category: '',       // 장
    notes: ''
  });

  // 승인유무 상태 추출 함수 (드래그 검증용)
  const getStatusGroup = (status) => {
    if (!status) return '가입전';
    const parts = status.split('/');
    const lastPart = parts[parts.length - 1]?.trim() || '';
    const pureStatus = lastPart.replace(/^\d{1,2}\.\d{1,2}\s*/, '').trim().replace(/^수동입력\s+/, '').trim();
    
    if (pureStatus === '가입전') return '가입전';
    if (pureStatus === '대기') return '대기';
    if (pureStatus === '승인') return '승인';
    if (pureStatus === '장점검') return '장점검';
    if (pureStatus === '팅') return '팅';
    if (pureStatus === '졸업') return '졸업';
    return '기타';
  };

  // 드래그 앤 드롭으로 순서 변경 핸들러 (사이트)
  const handleSiteDragEnd = async (result) => {
    if (!result.destination) return;
    
    const sourceIndex = result.source.index;
    const destIndex = result.destination.index;
    
    if (sourceIndex === destIndex) return;
    
    // 같은 승인유무 그룹 내에서만 이동 가능한지 검증
    const sourceItem = filteredSites[sourceIndex];
    const destItem = filteredSites[destIndex];
    
    const sourceGroup = getStatusGroup(sourceItem.status);
    const destGroup = getStatusGroup(destItem.status);
    
    if (sourceGroup !== destGroup) {
      toast.error('같은 승인유무 상태 내에서만 순서를 변경할 수 있습니다');
      return;
    }
    
    // 배열에서 위치 변경
    const reorderedSites = Array.from(filteredSites);
    const [movedItem] = reorderedSites.splice(sourceIndex, 1);
    reorderedSites.splice(destIndex, 0, movedItem);
    
    // 모든 항목의 display_order를 재할당 (0부터 시작)
    const updatedSites = reorderedSites.map((site, index) => ({
      ...site,
      display_order: index
    }));
    
    // filteredSites는 useMemo로 자동 계산되므로 setSites만 업데이트
    
    // sites 상태도 업데이트
    setSites(prev => {
      const updatedMap = new Map(updatedSites.map(s => [s.id, s.display_order]));
      return prev.map(s => updatedMap.has(s.id) ? { ...s, display_order: updatedMap.get(s.id) } : s);
    });
    
    // 서버에 모든 항목의 순서 저장 (새 행 제외)
    const sitesToUpdate = updatedSites.filter(s => !s.isNew && s.id);
    if (sitesToUpdate.length > 0) {
      try {
        await axiosInstance.put('/sites/reorder', {
          sites: sitesToUpdate.map(s => ({ id: s.id, display_order: s.display_order }))
        });
      } catch (error) {
        console.error('사이트 순서 저장 실패:', error);
      }
    }
  };

  // 드래그 앤 드롭으로 순서 변경 핸들러 (커뮤니티)
  const handleCommunityDragEnd = async (result) => {
    if (!result.destination) return;
    
    const sourceIndex = result.source.index;
    const destIndex = result.destination.index;
    
    if (sourceIndex === destIndex) return;
    
    // 같은 승인유무 그룹 내에서만 이동 가능한지 검증
    const sourceItem = filteredCommunities[sourceIndex];
    const destItem = filteredCommunities[destIndex];
    
    const sourceGroup = getStatusGroup(sourceItem.status);
    const destGroup = getStatusGroup(destItem.status);
    
    if (sourceGroup !== destGroup) {
      toast.error('같은 승인유무 상태 내에서만 순서를 변경할 수 있습니다');
      return;
    }
    
    // 배열에서 위치 변경
    const reorderedCommunities = Array.from(filteredCommunities);
    const [movedItem] = reorderedCommunities.splice(sourceIndex, 1);
    reorderedCommunities.splice(destIndex, 0, movedItem);
    
    // 모든 항목의 display_order를 재할당 (0부터 시작)
    const updatedCommunities = reorderedCommunities.map((community, index) => ({
      ...community,
      display_order: index
    }));
    
    // communities 상태 업데이트
    setCommunities(prev => {
      const updatedMap = new Map(updatedCommunities.map(c => [c.id, c.display_order]));
      return prev.map(c => updatedMap.has(c.id) ? { ...c, display_order: updatedMap.get(c.id) } : c);
    });
    
    // 서버에 모든 항목의 순서 저장 (새 행 제외)
    const communitiesToUpdate = updatedCommunities.filter(c => !c.isNew && c.id);
    if (communitiesToUpdate.length > 0) {
      try {
        await axiosInstance.put('/communities/reorder', {
          communities: communitiesToUpdate.map(c => ({ id: c.id, display_order: c.display_order }))
        });
      } catch (error) {
        console.error('커뮤니티 순서 저장 실패:', error);
      }
    }
  };

  // 실시간 동기화: 다른 사용자가 사이트/명의를 변경하면 자동 새로고침
  useRealtimeSync('sites', {
    onDataChanged: useCallback(() => {
      loadIdentities();
      if (selectedIdentity) {
        loadSites(selectedIdentity === 'all' ? 'all' : selectedIdentity);
      }
    // eslint-disable-next-line
    }, [selectedIdentity]),
    events: ['sites:changed', 'identities:changed'],
  });

  // 명의 목록 로드
  const loadIdentities = async () => {
    try {
      const list = await getIdentitiesCached();
      setIdentities(list);
      if (!selectedIdentity && list.length > 0) {
        // 첫 번째 명의 자동 선택은 URL 파라미터 처리 useEffect에서 처리
      }
      return list;
    } catch (error) {
      console.error('명의 로드 실패:', error);
      return [];
    }
  };

  // 사이트 목록 로드
  const loadSites = async (identityId, isAllMode = false) => {
    // identityId가 'all'이면 자동으로 isAllMode를 true로 설정
    if (identityId === 'all') {
      isAllMode = true;
      identityId = null;
    }
    
    // "전체" 모드가 아니고 identityId가 없으면 빈 목록
    if (!isAllMode && !identityId) {
      setSites([]);
      return;
    }
    
    try {
      // "전체" 모드면 all=true 파라미터 추가 (사무실 전체 사이트)
      const url = isAllMode ? '/sites?all=true' : `/sites?identity_id=${identityId}`;
      const response = await axiosInstance.get(url);
      
      if (response.data.success) {
        setSites(response.data.sites);
        setCurrentPage(1); // 페이지 리셋
      }
    } catch (error) {
      console.error('사이트 로드 실패:', error);
      toast.error('사이트 목록을 불러올 수 없습니다');
    }
  };

  // 모든 사이트명 조회 (자동완성용)
  const loadAllSiteNames = async () => {
    try {
      const response = await axiosInstance.get('/sites/all-names');
      if (response.data.success) {
        setAllSiteNames(response.data.names || []);
      }
    } catch (error) {
      console.error('사이트명 목록 조회 실패:', error);
    }
  };

  // 사이트명 입력 시 자동완성 필터링
  const handleSiteNameChange = (value) => {
    setSiteForm({ ...siteForm, site_name: value });
    
    if (value.trim().length > 0) {
      const filtered = allSiteNames.filter(name =>
        name.toLowerCase().includes(value.toLowerCase())
      );
      setSiteNameSuggestions(filtered.slice(0, 10));
      setShowSuggestions(filtered.length > 0);
    } else {
      setSiteNameSuggestions([]);
      setShowSuggestions(false);
    }
    
    // 유사도 경고 초기화
    setSimilarWarning(null);
  };

  // 자동완성 선택
  const handleSuggestionSelect = (name) => {
    setSiteForm({ ...siteForm, site_name: name });
    setShowSuggestions(false);
    setSiteNameSuggestions([]);
    setSimilarWarning(null);
  };

  // 유사 사이트명 확인 (저장 전)
  const checkSimilarSiteNames = async (siteName) => {
    if (!siteName || siteName.trim() === '') return null;
    
    try {
      const response = await axiosInstance.post('/sites/check-similar', {
        siteName: siteName.trim(),
        threshold: 0.5  // 50% 이상 유사하면 경고 (더 민감하게)
      });
      
      if (response.data.success && response.data.similar.length > 0) {
        // 완전히 동일한 이름만 있는 경우 제외 (isExact만 있으면 경고 안함)
        const nonExactMatches = response.data.similar.filter(s => !s.isExact);
        if (nonExactMatches.length > 0) {
          return nonExactMatches;
        }
      }
    } catch (error) {
      console.error('유사 사이트명 확인 실패:', error);
    }
    return null;
  };

  // 중복/유사 사이트 그룹 조회 (통합 도구용)
  const loadDuplicateGroups = async () => {
    try {
      const response = await axiosInstance.get('/sites/duplicates');
      if (response.data.success) {
        setDuplicateGroups(response.data.groups || []);
      }
    } catch (error) {
      console.error('중복 사이트명 조회 실패:', error);
      toast.error('중복 사이트명을 조회할 수 없습니다');
    }
  };

  // 사이트명 통합 실행
  const handleMergeSiteNames = async () => {
    if (!selectedMergeSource || !selectedMergeTarget) {
      toast.error('원본과 대상을 모두 선택해주세요');
      return;
    }
    
    if (selectedMergeSource === selectedMergeTarget) {
      toast.error('원본과 대상이 같습니다');
      return;
    }
    
    try {
      const response = await axiosInstance.post('/sites/merge-names', {
        sourceName: selectedMergeSource,
        targetName: selectedMergeTarget
      });
      
      if (response.data.success) {
        toast.success(response.data.message);
        // 목록 새로고침
        await loadAllSiteNames();
        await loadDuplicateGroups();
        if (selectedIdentity) {
          await loadSites(selectedIdentity.id);
        }
        // 상태 초기화
        setSelectedMergeSource('');
        setSelectedMergeTarget('');
      }
    } catch (error) {
      console.error('사이트명 통합 실패:', error);
      toast.error('사이트명 통합에 실패했습니다');
    }
  };

  // 커뮤니티 목록 로드 (사이트 목록처럼 명의별로 필터링)
  const loadCommunities = async () => {
    // 명의가 선택되지 않았으면 커뮤니티 목록 비우기
    if (!selectedIdentity || !selectedIdentity.name) {
      setCommunities([]);
      return;
    }
    
    try {
      // 사이트 목록처럼 identity_name으로 필터링
      const response = await axiosInstance.get(`/communities?identity_name=${encodeURIComponent(selectedIdentity.name)}`);
      setCommunities(response.data || []);
      // filteredCommunities는 useMemo로 자동 계산됨
    } catch (error) {
      console.error('커뮤니티 로드 실패:', error);
      console.error('에러 상세:', error.response?.data || error.message);
      toast.error('커뮤니티 목록을 불러올 수 없습니다');
      setCommunities([]);
    }
  };

  const initialLoadedRef = useRef(false);

  // 초기 로드 (병렬 처리로 속도 개선)
  useEffect(() => {
    if (initialLoadedRef.current) return;
    initialLoadedRef.current = true;
    
    // 모든 초기 데이터를 병렬로 로드
    Promise.all([
      loadIdentities(),
      loadCommunities(),
      loadAllSiteNames()
    ]).catch(err => console.error('초기 로드 실패:', err));
  }, []);

  // 관리자용 계정 목록 로드 (사무실 관리자가 선택한 계정이 관리자인지 확인용)
  useEffect(() => {
    const loadAccounts = async () => {
      if (!isOfficeManager && !isSuperAdmin) return;
      try {
        const response = await axiosInstance.get('/auth/accounts');
        if (response.data.success) {
          setAccounts(response.data.accounts || []);
        }
      } catch (error) {
        console.error('계정 목록 로드 실패:', error);
      }
    };
    loadAccounts();
  }, [isOfficeManager, isSuperAdmin]);

  // 선택된 계정이 관리자인지 확인
  const selectedAccountIsManager = React.useMemo(() => {
    if (!selectedAccountId || accounts.length === 0) return false;
    const selectedAccount = accounts.find(acc => acc.id === selectedAccountId);
    return selectedAccount?.isOfficeManager || false;
  }, [selectedAccountId, accounts]);

  // "전체" 옵션을 표시할지 여부 결정
  // - 슈퍼 관리자: 항상 표시
  // - 사무실 관리자: 관리자 계정을 선택했을 때만 표시
  const canShowAllOption = isSuperAdmin || (isOfficeManager && selectedAccountIsManager);

  // URL 쿼리 파라미터에서 명의 ID 읽어서 자동 선택 (통합)
  useEffect(() => {
    // identities가 로드되지 않았으면 대기
    if (identities.length === 0) return;
    
    const urlParams = new URLSearchParams(location.search);
    const identityIdParam = urlParams.get('identityId');
    
    // URL에 명의 ID 파라미터가 있는 경우 - 해당 명의 선택
    if (identityIdParam) {
      const identityToSelect = identities.find(id => id.id === parseInt(identityIdParam));
      if (identityToSelect && (!selectedIdentity || selectedIdentity.id !== identityToSelect.id)) {
        handleIdentitySelect(identityToSelect);
        window.history.replaceState({}, '', '/sites');
        return;
      }
    }
    
    // URL 파라미터가 없고, 명의도 선택되지 않은 경우 - 첫 번째 명의 자동 선택 (한 번만)
    if (!selectedIdentity && !identityIdParam && identities.length > 0) {
      handleIdentitySelect(identities[0]);
    }
  }, [location.search, identities.length]); // identities.length만 의존성으로 사용 (목록 크기가 바뀔 때만)
  
  // 강조 표시 자동 제거 (3초 후)
  useEffect(() => {
    if (highlightedSiteId) {
      const timer = setTimeout(() => {
        setHighlightedSiteId(null);
      }, 3000);
      return () => clearTimeout(timer);
    }
  }, [highlightedSiteId]);

  useEffect(() => {
    if (highlightedCommunityId) {
      const timer = setTimeout(() => {
        setHighlightedCommunityId(null);
      }, 3000);
      return () => clearTimeout(timer);
    }
  }, [highlightedCommunityId]);

  // identities 목록이 업데이트될 때, 현재 선택된 명의도 업데이트 (명의 수정 후에만)
  // 단, 사용자가 직접 명의를 선택하는 경우는 제외
  useEffect(() => {
    if (!selectedIdentity || identities.length === 0) {
      // 명의 목록이 비어있거나 선택된 명의가 없으면 커뮤니티 목록 비우기
      if (identities.length === 0) {
        setCommunities([]);
        // filteredCommunities는 useMemo로 자동 계산됨
      }
      return;
    }
    
    const currentId = selectedIdentity.id;
    const updatedIdentity = identities.find(i => i.id === currentId);
    
    if (!updatedIdentity) return;
    
    // 명의 정보가 실제로 변경되었는지 확인 (name, birth_date 등 주요 필드 비교)
    const hasChanged = 
      updatedIdentity.name !== selectedIdentity.name ||
      updatedIdentity.birth_date !== selectedIdentity.birth_date ||
      JSON.stringify(updatedIdentity.bank_accounts) !== JSON.stringify(selectedIdentity.bank_accounts) ||
      JSON.stringify(updatedIdentity.phone_numbers) !== JSON.stringify(selectedIdentity.phone_numbers);
    
    // ID가 같고 정보가 변경된 경우에만 업데이트 (명의 수정 후 동기화)
    if (hasChanged && updatedIdentity.id === currentId) {
      setSelectedIdentity(updatedIdentity);
    }
  }, [identities.length, selectedIdentity?.id]); // 의존성 최소화: 목록 크기와 선택된 명의 ID만
  
  // selectedIdentity가 변경될 때마다 커뮤니티 목록 다시 로드
  // 성능 최적화: ID만 변경될 때만 재로드 (name 변경은 무시)
  useEffect(() => {
    if (selectedIdentity) {
      loadCommunities();
    } else {
      setCommunities([]);
    }
  }, [selectedIdentity?.id]); // name 제거 - ID만 변경될 때만 재로드

  // 필터 적용 (useMemo로 최적화 - 불필요한 재계산 방지)
  const filteredSites = useMemo(() => {
    let filtered = [...sites];
    
    // 검색어 필터 (debounced 값 사용 - 서버 부하 감소)
    if (debouncedSearchTerm) {
      filtered = filtered.filter(site => 
        site.site_name.toLowerCase().includes(debouncedSearchTerm.toLowerCase()) ||
        site.domain.toLowerCase().includes(debouncedSearchTerm.toLowerCase()) ||
        site.nickname.toLowerCase().includes(debouncedSearchTerm.toLowerCase())
      );
    }
    
    // 상태 필터 (날짜가 포함된 경우도 처리)
    if (statusFilter !== '전체') {
      filtered = filtered.filter(site => {
        if (!site.status) return false;
        
        // 슬래시로 구분된 마지막 상태만 사용 (공백 정규화)
        const parts = site.status.split('/').map(s => s.trim());
        const lastPart = parts[parts.length - 1]?.trim() || '';
        
        // 날짜를 제외한 순수 상태만 추출
        const pureStatus = lastPart.replace(/^\d{1,2}\.\d{1,2}\s*/, '').trim() || '';
        
        // "수동입력" 필터의 경우: 유효한 상태 목록에 없는 경우만 수동입력으로 간주
        if (statusFilter === '수동입력') {
          // 유효한 상태 목록
          const validStatuses = ['가입전', '대기', '승인', '장점검', '팅', '졸업'];
          
          // 수동입력 텍스트 제거 후 순수 상태값 추출 (기존 데이터에 있을 수 있음)
          const pureStatusWithoutManual = pureStatus.replace(/^수동입력\s+/, '').trim();
          
          // 빈 값이 아닌 경우에만 체크
          if (!pureStatusWithoutManual) return false;
          
          // 유효한 상태 목록에 없으면 수동입력으로 간주
          return !validStatuses.includes(pureStatusWithoutManual);
        }
        
        // 각 상태에 맞게 체크
        if (statusFilter === '대기') return pureStatus === '대기';
        if (statusFilter === '승인') return pureStatus === '승인';
        if (statusFilter === '팅') return pureStatus === '팅';
        if (statusFilter === '졸업') return pureStatus === '졸업';
        if (statusFilter === '장점검') return pureStatus === '장점검';
        if (statusFilter === '가입전') return pureStatus === '가입전';
        
        return pureStatus === statusFilter;
      });
    }
    
    // 월 필터
    if (monthFilter !== '전체') {
      filtered = filtered.filter(site => {
        if (!site.status) return false;
        
        // 슬래시로 구분된 마지막 상태만 사용
        const parts = site.status.split('/');
        const lastPart = parts[parts.length - 1]?.trim() || '';
        
        // 날짜 추출 (예: "11.02 대기" -> "11")
        const dateMatch = lastPart.match(/^(\d{1,2})\.\d{1,2}/);
        if (dateMatch) {
          const month = parseInt(dateMatch[1], 10);
          const selectedMonth = parseInt(monthFilter, 10);
          return month === selectedMonth;
        }
        
        return false; // 날짜가 없으면 필터에서 제외
      });
    }
    
    // 상태별 정렬 순서: 가입전 > 대기 > 승인 > 장점검 > 수동입력 > 팅 > 졸업
    const getStatusOrder = (status) => {
      if (!status) return 999; // 상태가 없으면 맨 뒤
      
      const parts = status.split('/');
      const lastPart = parts[parts.length - 1]?.trim() || '';
      const pureStatus = lastPart?.replace(/^\d{1,2}\.\d{1,2}\s*/, '').trim() || '';
      
      // 표준 상태값 목록
      const validStatuses = ['가입전', '대기', '승인', '장점검', '팅', '졸업'];
      
      // 수동입력이 포함된 경우 (텍스트에 "수동입력"이 포함되어 있거나, 표준 상태값이 아닌 경우)
      if (lastPart?.includes('수동입력') || (!validStatuses.includes(pureStatus) && pureStatus !== '')) {
        return 5;
      }
      
      // 상태별 순서
      if (pureStatus === '가입전') return 1;
      if (pureStatus === '대기') return 2;
      if (pureStatus === '승인') return 3;
      if (pureStatus === '장점검') return 4;
      if (pureStatus === '팅') return 6;
      if (pureStatus === '졸업') return 7;
      
      return 999; // 알 수 없는 상태는 맨 뒤
    };
    
    // 날짜 추출 함수 (MM.DD 형식을 숫자로 변환)
    const getDateValue = (status) => {
      if (!status) return 0;
      
      const parts = status.split('/');
      const lastPart = parts[parts.length - 1]?.trim() || '';
      
      // 날짜 추출 (예: "11.02 대기" -> "11.02")
      const dateMatch = lastPart.match(/^(\d{1,2})\.(\d{1,2})/);
      if (dateMatch) {
        const month = parseInt(dateMatch[1], 10);
        const day = parseInt(dateMatch[2], 10);
        // 월 * 100 + 일로 정렬 (예: 11월 2일 = 1102, 1월 15일 = 115)
        return month * 100 + day;
      }
      
      return 0; // 날짜가 없으면 맨 앞
    };
    
    // 새 행(isNew)과 기존 항목 분리
    const newItems = filtered.filter(item => item.isNew);
    const existingItems = filtered.filter(item => !item.isNew);
    
    // 전체를 승인유무 우선 정렬, 같은 승인유무 내에서 display_order로 정렬
    existingItems.sort((a, b) => {
      // 1순위: 상태 순서 (승인유무)
      const orderA = getStatusOrder(a.status);
      const orderB = getStatusOrder(b.status);
      if (orderA !== orderB) {
        return orderA - orderB;
      }
      
      // 2순위: display_order ASC (같은 승인유무 내에서 순서)
      const displayA = a.display_order || 0;
      const displayB = b.display_order || 0;
      if (displayA !== displayB) {
        return displayA - displayB;
      }
      
      // 3순위: 날짜 (최신이 먼저)
      const dateA = getDateValue(a.status);
      const dateB = getDateValue(b.status);
      if (dateA !== dateB) {
        return dateB - dateA;
      }
      
      // 4순위: id 내림차순 (최신이 먼저)
      return (b.id || 0) - (a.id || 0);
    });
    
    // 새 행은 항상 맨 앞에 추가
    const allFiltered = [...newItems, ...existingItems];
    return allFiltered;
  }, [debouncedSearchTerm, statusFilter, monthFilter, sites]);
  
  // 필터 변경 시 첫 페이지로 리셋
  useEffect(() => {
    setCurrentPage(1);
  }, [debouncedSearchTerm, statusFilter, monthFilter]);
  
  // totalItems 계산 (메모이제이션)
  const totalItems = useMemo(() => filteredSites.length, [filteredSites]);
  
  // 페이징된 사이트 목록
  const paginatedSites = React.useMemo(() => {
    const startIndex = (currentPage - 1) * itemsPerPage;
    const endIndex = startIndex + itemsPerPage;
    return filteredSites.slice(startIndex, endIndex);
  }, [filteredSites, currentPage, itemsPerPage]);
  
  const totalPages = Math.ceil(totalItems / itemsPerPage);
  
  // 커뮤니티 필터 적용 (useMemo로 최적화 - 불필요한 재계산 방지)
  const filteredCommunities = useMemo(() => {
    let filtered = [...communities];
    
    // 추가 명의 필터는 제거 (identity_name 누락된 기존 데이터가 숨겨지는 문제 방지)
    
    // 검색어 필터 (debounced 값 사용 - 서버 부하 감소)
    if (debouncedCommunitySearchTerm) {
      filtered = filtered.filter(community => 
        community.site_name.toLowerCase().includes(debouncedCommunitySearchTerm.toLowerCase()) ||
        community.domain.toLowerCase().includes(debouncedCommunitySearchTerm.toLowerCase()) ||
        community.nickname.toLowerCase().includes(debouncedCommunitySearchTerm.toLowerCase())
      );
    }
    
    // 상태 필터 (날짜가 포함된 경우도 처리)
    if (communityStatusFilter !== '전체') {
      filtered = filtered.filter(community => {
        if (!community.status) return false;
        
        // 슬래시로 구분된 마지막 상태만 사용
        const parts = community.status.split('/');
        const lastPart = parts[parts.length - 1];
        
        // 날짜를 제외한 순수 상태만 추출
        const pureStatus = lastPart?.replace(/^\d{1,2}\.\d{1,2}\s*/, '').trim() || '';
        
        // "수동입력" 필터의 경우: "수동입력"이 포함된 경우
        if (communityStatusFilter === '수동입력') {
          return lastPart?.includes('수동입력');
        }
        
        // 각 상태에 맞게 체크
        if (communityStatusFilter === '대기') return pureStatus === '대기';
        if (communityStatusFilter === '승인') return pureStatus === '승인';
        if (communityStatusFilter === '팅') return pureStatus === '팅';
        if (communityStatusFilter === '졸업') return pureStatus === '졸업';
        if (communityStatusFilter === '장점검') return pureStatus === '장점검';
        if (communityStatusFilter === '가입전') return pureStatus === '가입전';
        
        return pureStatus === communityStatusFilter;
      });
    }
    
    // 월 필터
    if (communityMonthFilter !== '전체') {
      filtered = filtered.filter(community => {
        if (!community.status) return false;
        
        // 슬래시로 구분된 마지막 상태만 사용
        const parts = community.status.split('/');
        const lastPart = parts[parts.length - 1]?.trim() || '';
        
        // 날짜 추출 (예: "11.02 대기" -> "11")
        const dateMatch = lastPart.match(/^(\d{1,2})\.\d{1,2}/);
        if (dateMatch) {
          const month = parseInt(dateMatch[1], 10);
          const selectedMonth = parseInt(communityMonthFilter, 10);
          return month === selectedMonth;
        }
        
        return false; // 날짜가 없으면 필터에서 제외
      });
    }
    
    // 상태별 정렬 순서: 가입전 > 대기 > 승인 > 장점검 > 수동입력 > 팅 > 졸업
    const getStatusOrder = (status) => {
      if (!status) return 999; // 상태가 없으면 맨 뒤
      
      const parts = status.split('/');
      const lastPart = parts[parts.length - 1]?.trim() || '';
      const pureStatus = lastPart?.replace(/^\d{1,2}\.\d{1,2}\s*/, '').trim() || '';
      
      // 표준 상태값 목록
      const validStatuses = ['가입전', '대기', '승인', '장점검', '팅', '졸업'];
      
      // 수동입력이 포함된 경우 (텍스트에 "수동입력"이 포함되어 있거나, 표준 상태값이 아닌 경우)
      if (lastPart?.includes('수동입력') || (!validStatuses.includes(pureStatus) && pureStatus !== '')) {
        return 5;
      }
      
      // 상태별 순서
      if (pureStatus === '가입전') return 1;
      if (pureStatus === '대기') return 2;
      if (pureStatus === '승인') return 3;
      if (pureStatus === '장점검') return 4;
      if (pureStatus === '팅') return 6;
      if (pureStatus === '졸업') return 7;
      
      return 999; // 알 수 없는 상태는 맨 뒤
    };
    
    // 날짜 추출 함수 (MM.DD 형식을 숫자로 변환)
    const getDateValue = (status) => {
      if (!status) return 0;
      
      const parts = status.split('/');
      const lastPart = parts[parts.length - 1]?.trim() || '';
      
      // 날짜 추출 (예: "11.02 대기" -> "11.02")
      const dateMatch = lastPart.match(/^(\d{1,2})\.(\d{1,2})/);
      if (dateMatch) {
        const month = parseInt(dateMatch[1], 10);
        const day = parseInt(dateMatch[2], 10);
        // 월 * 100 + 일로 정렬 (예: 11월 2일 = 1102, 1월 15일 = 115)
        return month * 100 + day;
      }
      
      return 0; // 날짜가 없으면 맨 앞
    };
    
    // 새 행(isNew)과 기존 항목 분리
    const newItems = filtered.filter(item => item.isNew);
    const existingItems = filtered.filter(item => !item.isNew);
    
    // 전체를 승인유무 우선 정렬, 같은 승인유무 내에서 display_order로 정렬
    existingItems.sort((a, b) => {
      // 1순위: 상태 순서 (승인유무)
      const orderA = getStatusOrder(a.status);
      const orderB = getStatusOrder(b.status);
      if (orderA !== orderB) {
        return orderA - orderB;
      }
      
      // 2순위: display_order ASC (같은 승인유무 내에서 순서)
      const displayA = a.display_order || 0;
      const displayB = b.display_order || 0;
      if (displayA !== displayB) {
        return displayA - displayB;
      }
      
      // 3순위: 날짜 (최신이 먼저)
      const dateA = getDateValue(a.status);
      const dateB = getDateValue(b.status);
      if (dateA !== dateB) {
        return dateB - dateA;
      }
      
      // 4순위: id 내림차순 (최신이 먼저)
      return (b.id || 0) - (a.id || 0);
    });
    
    // 새 행은 항상 맨 앞에 추가
    const allFiltered = [...newItems, ...existingItems];
    return allFiltered;
  }, [debouncedCommunitySearchTerm, communityStatusFilter, communityMonthFilter, communities]);
  
  // 승인유무 필드 색상 결정 함수
  const getStatusColor = (status) => {
    if (!status) return 'bg-white dark:bg-[#363B46] text-black dark:text-white';
    
    // 슬래시로 구분된 마지막 상태만 사용
    const parts = status.split('/');
    const lastPart = parts[parts.length - 1]?.trim() || '';
    
    // 날짜를 제외한 순수 상태만 추출
    const pureStatus = lastPart?.replace(/^\d{1,2}\.\d{1,2}\s*/, '').trim() || '';
    
    // "수동입력"이 포함된 경우
    if (lastPart?.includes('수동입력')) {
      return 'bg-green-100 dark:bg-green-900/50 text-green-800 dark:text-green-300';
    }
    
    // 상태별 색상
    if (pureStatus === '승인') return 'bg-white dark:bg-[#363B46] text-black dark:text-white';
    if (pureStatus === '가입전') return 'bg-purple-100 dark:bg-purple-900/50 text-purple-800 dark:text-purple-300';
    if (pureStatus === '졸업') return 'bg-red-100 dark:bg-red-900/50 text-red-800 dark:text-red-300';
    if (pureStatus === '팅') return 'bg-red-100 dark:bg-red-900/50 text-red-800 dark:text-red-300';
    if (pureStatus === '장점검') return 'bg-green-100 dark:bg-green-900/50 text-green-800 dark:text-green-300';
    if (pureStatus === '대기') return 'bg-yellow-100 dark:bg-yellow-900/50 text-yellow-800 dark:text-yellow-300';
    
    return 'bg-white dark:bg-[#363B46] text-black dark:text-white';
  };

  // 중복 제거: 이미 193줄에서 초기 로드됨

  // 명의 선택 핸들러
  const handleIdentitySelect = (identity) => {
    // 명의 선택 시 즉시 업데이트
    if (!identity) {
      setSelectedIdentity(null);
      setSites([]);
      setCommunities([]);
      return;
    }
    
    // "전체" 선택인 경우 (사무실 관리자용)
    if (identity.id === 'all') {
      setSelectedIdentity({ id: 'all', name: '전체' });
      loadSites(null, true); // 전체 모드로 로드
      setCommunities([]); // 전체 모드에서는 커뮤니티 목록 비움
      // filteredCommunities는 useMemo로 자동 계산됨
      return;
    }
    
    // identities 목록에서 최신 정보 가져오기 (있으면)
    const latestIdentity = identities.find(i => i.id === identity.id) || identity;
    
    // 현재 선택된 명의와 다를 때만 업데이트 (무한 루프 방지 및 불필요한 재렌더링 방지)
    if (!selectedIdentity || selectedIdentity.id !== latestIdentity.id) {
      setSelectedIdentity(latestIdentity);
      loadSites(latestIdentity.id);
      loadCommunities();
    }
  };

  // 명의 추가/수정 모달 열기
  const openIdentityModal = (identity = null) => {
    if (identity) {
      setEditingIdentity(identity);
      // nicknames를 안전하게 배열로 변환
      let nicknamesArray = [];
      if (identity.nicknames) {
        if (Array.isArray(identity.nicknames)) {
          nicknamesArray = identity.nicknames;
        } else if (typeof identity.nicknames === 'string') {
          try {
            nicknamesArray = JSON.parse(identity.nicknames);
            if (!Array.isArray(nicknamesArray)) {
              nicknamesArray = [];
            }
          } catch {
            nicknamesArray = [];
          }
        }
      } else if (identity.nickname) {
        nicknamesArray = [identity.nickname];
      }
      
      setIdentityForm({
        name: identity.name,
        birth_date: identity.birth_date,
        zodiac: identity.zodiac || '',
        bank_accounts: Array.isArray(identity.bank_accounts) ? identity.bank_accounts : [],
        phone_numbers: Array.isArray(identity.phone_numbers) ? identity.phone_numbers : [],
        nicknames: nicknamesArray,
        status: identity.status,
        notes: identity.notes || ''
      });
    } else {
      setEditingIdentity(null);
      setIdentityForm({
        name: '',
        birth_date: '',
        zodiac: '',
        bank_accounts: [],
        phone_numbers: [],
        nicknames: [],
        status: 'active',
        notes: ''
      });
    }
    setShowIdentityModal(true);
  };

  // 명의 저장
  const saveIdentity = async () => {
    try {
      let savedIdentityId = null;
      let savedIdentityName = null;
      
      if (editingIdentity) {
        await axiosInstance.put(`/identities/${editingIdentity.id}`, identityForm);
        toast.success('유저가 수정되었습니다');
        savedIdentityId = editingIdentity.id;
        savedIdentityName = identityForm.name;
      } else {
        const response = await axiosInstance.post('/identities', identityForm);
        toast.success('유저가 추가되었습니다');
        
        // 서버 응답에서 ID 추출 (서버는 identityId로 반환)
        savedIdentityId = response.data?.identityId || 
                         response.data?.identity?.id || 
                         response.data?.id || 
                         response.data?.data?.id ||
                         (response.data?.success && response.data?.identity ? response.data.identity.id : null);
        
        savedIdentityName = identityForm.name;
        
      }
      
      setShowIdentityModal(false);
      
      // 캐시 무효화 후 명의 목록 다시 로드 (약간의 지연을 두어 서버 동기화 보장)
      invalidateIdentitiesCache();
      
      // 약간의 지연 후 명의 목록 다시 로드
      await new Promise(resolve => setTimeout(resolve, 100));
      const updatedIdentities = await loadIdentities();
      
      if (editingIdentity) {
        // 수정된 명의인 경우, 업데이트된 정보로 갱신
        if (selectedIdentity?.id === editingIdentity.id) {
          const updated = updatedIdentities.find(i => i.id === editingIdentity.id);
          if (updated) {
            setSelectedIdentity(updated);
            loadSites(updated.id);
            loadCommunities();
          }
        }
      } else {
        // 새로 추가된 명의인 경우, 자동으로 선택
        let newIdentity = null;
        
        if (savedIdentityId) {
          // ID로 찾기
          newIdentity = updatedIdentities.find(i => i.id === savedIdentityId);
        }
        
        if (!newIdentity && savedIdentityName) {
          // ID로 찾지 못하면 이름으로 찾기
          newIdentity = updatedIdentities.find(i => i.name === savedIdentityName);
        }
        
        if (newIdentity) {
          setSelectedIdentity(newIdentity);
          loadSites(newIdentity.id);
          loadCommunities();
        } else if (updatedIdentities.length > 0) {
          // 찾지 못하면 마지막 명의 선택 (새로 추가된 것이 보통 마지막에 위치)
          const lastIdentity = updatedIdentities[updatedIdentities.length - 1];
          setSelectedIdentity(lastIdentity);
          loadSites(lastIdentity.id);
          loadCommunities();
        }
      }
    } catch (error) {
      console.error('유저 저장 실패:', error);
      toast.error('유저 저장에 실패했습니다');
    }
  };

  // 명의 드래그 앤 드롭 핸들러
  const handleIdentityDragEnd = async (result) => {
    if (!result.destination) {
      return; // 드롭 위치가 없으면 무시
    }

    if (result.source.index === result.destination.index) {
      return; // 위치가 변경되지 않았으면 무시
    }

    // 명의 목록 재정렬
    const items = Array.from(identities);
    const [reorderedItem] = items.splice(result.source.index, 1);
    items.splice(result.destination.index, 0, reorderedItem);

    // display_order 업데이트
    const updatedIdentities = items.map((item, index) => ({
      ...item,
      display_order: index
    }));

    setIdentities(updatedIdentities);

    // 서버에 순서 저장
    try {
      const payload = {
        identities: updatedIdentities.map((item, index) => ({
          id: item.id,
          display_order: index
        }))
      };
      
      const response = await axiosInstance.put('/identities/reorder', payload);
      
      // 캐시 무효화
      invalidateIdentitiesCache();
      
      toast.success('유저 순서가 변경되었습니다');
    } catch (error) {
      console.error('유저 순서 변경 실패:', error);
      console.error('에러 상세:', error.response?.data || error.message);
      const errorMessage = error.response?.data?.message || error.message || '유저 순서 변경에 실패했습니다';
      toast.error(errorMessage);
      // 실패 시 원래 데이터로 복구
      loadIdentities();
    }
  };

  // 명의 삭제
  const deleteIdentity = async (identity) => {
    if (!window.confirm(`"${identity.name}" 유저를 삭제하시겠습니까?\n관련된 모든 사이트도 함께 삭제됩니다.`)) {
      return;
    }
    
    try {
      await axiosInstance.delete(`/identities/${identity.id}`);
      toast.success('유저가 삭제되었습니다');
      
      // 캐시 무효화 후 명의 목록 다시 로드
      invalidateIdentitiesCache();
      const updatedIdentities = await loadIdentities();
      
      // 삭제된 명의가 선택되어 있으면 선택 해제
      if (selectedIdentity?.id === identity.id) {
        setSelectedIdentity(null);
        setSites([]);
        // filteredSites는 useMemo로 자동 계산됨
        setCommunities([]);
        // filteredCommunities는 useMemo로 자동 계산됨
        
        // 다른 명의가 있으면 첫 번째 명의 선택
        if (updatedIdentities.length > 0) {
          setSelectedIdentity(updatedIdentities[0]);
        }
      } else {
        // 선택된 명의가 아니더라도 커뮤니티 목록 다시 로드
        await loadCommunities();
      }
    } catch (error) {
      console.error('유저 삭제 실패:', error);
      toast.error('유저 삭제에 실패했습니다');
    }
  };

  // 사이트 메타데이터 조회 (명의별 출석일 포함)
  const fetchSiteNotes = async (siteName, identityName = null) => {
    try {
      const params = { site_name: siteName };
      if (identityName) {
        params.identity_name = identityName;
      }
      const res = await axiosInstance.get(`/site-notes`, { params });
      if (res.data?.success && res.data.data) {
        return res.data.data;
      }
      return null;
    } catch (e) {
      console.error('사이트 메타데이터 조회 실패:', e);
      return null;
    }
  };

  // 사이트 메타데이터 편집 모달 열기 (사이트용)
  const openSiteNotesEditor = async (siteName, identityName) => {
    if (!siteName) {
      toast.error('사이트 이름이 없습니다');
      return;
    }
    
    // 정착 정보는 명의가 필수이므로 확인
    if (!identityName || identityName.trim() === '') {
      toast.warn('💡 정착 정보를 저장하려면 유저를 먼저 선택해주세요');
    }
    
    const existing = await fetchSiteNotes(siteName, identityName || null);
    
    // 기존 데이터 구조를 새 구조로 변환
    const existingData = existing?.data || {};
    
    // 월 변경 체크하여 출석일 자동 초기화
    // 한국 시간 기준 월 문자열 반환 (YYYY-MM)
    function getKSTMonthString(date = null) {
      const now = date ? new Date(date) : new Date();
      const kstDate = new Date(now.toLocaleString('en-US', {timeZone: 'Asia/Seoul'}));
      const year = kstDate.getFullYear();
      const month = String(kstDate.getMonth() + 1).padStart(2, '0');
      return `${year}-${month}`;
    }
    const currentMonth = getKSTMonthString(); // YYYY-MM
    const lastUpdated = existingData.lastUpdated || currentMonth;
    const rollover = existingData.rollover || 'X';
    let attendanceDays = existingData.attendanceDays || 0;
    
    // 월이 바뀌었고 이월 불가인 경우 출석일 초기화
    if (lastUpdated !== currentMonth && rollover !== 'O') {
      attendanceDays = 0;
    }
    
    const defaultSettlementRules = Array.isArray(existingData.settlementRules)
      ? existingData.settlementRules
      : ((existingData.settlementTotal || existingData.settlementPoint)
          ? [{ total: existingData.settlementTotal || 0, point: existingData.settlementPoint || '' }]
          : []);
    
    const normalizeEvents = Array.isArray(existingData.events) ? existingData.events : [];
    
    const defaultData = {
      tenure: existingData.tenure || '',
      attendanceType: existingData.attendanceType || existingData.autoManual || '자동', // autoManual → attendanceType으로 마이그레이션
      chargeMin: existingData.chargeMin !== undefined && existingData.chargeMin !== null ? Number(existingData.chargeMin) : 0,
      chargeMax: existingData.chargeMax !== undefined && existingData.chargeMax !== null ? Number(existingData.chargeMax) : 0,
      attendanceDays: attendanceDays,
      rollover: rollover,
      settlement: existingData.settlement || '',
      settlementTotal: existingData.settlementTotal || 0,
      settlementPoint: existingData.settlementPoint || '',
      settlementDays: existingData.settlementDays || 0,
      settlementRules: defaultSettlementRules,
      settlementCleared: existingData.settlementCleared || {},
      settlementClearedStart: existingData.settlementClearedStart || null,
      payback: existingData.payback || { type: '수동', days: [], percent: '', sameDayPercent: '' },
      rate: existingData.rate || '',
      events: normalizeEvents,
      pointTypes: existingData.pointTypes || [],
      lastUpdated: currentMonth, // 현재 월로 업데이트
      // ✅ 정착 지급 완료 정보 추가
      settlement_paid: existingData.settlement_paid || false,
      settlement_paid_at: existingData.settlement_paid_at || null
    };
    
    // 구버전 호환성: event, eventDetail이 있으면 events 배열로 변환
    if (existingData.event || existingData.eventDetail) {
      if (defaultData.events.length === 0) {
        defaultData.events = [{
          event: existingData.event || '',
          detail: existingData.eventDetail || '',
          rolling: existingData.eventRolling || ''
        }];
      }
    }
    
    // events 배열의 각 항목에 rolling 필드가 없으면 추가
    defaultData.events = defaultData.events.map(evt => ({
      event: evt.event || '',
      detail: evt.detail || '',
      rolling: evt.rolling || ''
    }));
    
    setSiteNotesModal({
      open: true,
      readonly: false,
      mode: 'site',
      communityId: null,
      siteName,
      identityName: identityName || '', // 명의명 저장
      recordedBy: existing?.recorded_by_identity || '',
      startDate: defaultData.settlementClearedStart || '',
      data: defaultData
    });
  };

  // 커뮤니티 정보기록 편집 모달 열기 (community_notices 사용)
  const openCommunityNotesEditor = async (community) => {
    if (!community || !community.id || !community.site_name) {
      toast.error('커뮤니티 정보가 올바르지 않습니다');
      return;
    }

    try {
      const res = await axiosInstance.get('/community-notes', {
        params: { community_id: community.id }
      });

      const payload = res.data?.data || null;
      const existingData = payload?.data || {};

      // 기존 siteNotesModal 기본값과 병합하여 안정적인 구조 유지
      setSiteNotesModal(prev => ({
        open: true,
        readonly: false,
        mode: 'community',
        communityId: community.id,
        siteName: community.site_name,
        identityName: community.identity_name || '',
        recordedBy: payload?.recorded_by_identity || '',
        startDate: existingData.settlementClearedStart || '',
        data: {
          ...prev.data,
          ...existingData,
          // ✅ 정착 지급 완료 정보 명시적으로 포함
          settlement_paid: existingData.settlement_paid || false,
          settlement_paid_at: existingData.settlement_paid_at || null
        }
      }));
    } catch (e) {
      console.error('커뮤니티 정보기록 조회 실패:', e);
      toast.error('커뮤니티 정보기록을 불러올 수 없습니다');

      // 조회 실패 시에도 빈 모달은 열어줌 (사용자가 새로 입력 가능)
      setSiteNotesModal(prev => ({
        ...prev,
        open: true,
        readonly: false,
        mode: 'community',
        communityId: community.id,
        siteName: community.site_name,
        identityName: community.identity_name || '',
        recordedBy: '',
        startDate: '',
      }));
    }
  };

  // 사이트/커뮤니티 메타데이터 저장
  const saveSiteNotes = async (modalData = null, updateRecordedBy = false) => {
    try {
      // modalData가 전달되면 사용, 없으면 siteNotesModal.data 사용 (하위 호환성)
      const currentData = modalData || siteNotesModal.data || {};
      const d = currentData;
      
      if (d.settlement === 'O') {
        const rows = (d.settlementRules && Array.isArray(d.settlementRules))
          ? d.settlementRules
          : ((d.settlementTotal || d.settlementPoint)
              ? [{ total: d.settlementTotal || 0, point: d.settlementPoint || '' }]
              : []);
        const isValid = (parseInt(d.settlementDays) || 0) > 0
          && rows.length > 0
          && rows.every(r => (r.total || 0) > 0 && (r.point || '').toString().trim() !== '');
        if (!isValid) {
          toast.error('정착 규칙은 누적 충전금액, 포인트를 입력하고 기간(일)을 설정해야 저장됩니다.');
          return;
        }
      }

      // startDate를 data.settlementClearedStart에 포함
      const dataToSave = {
        ...currentData,
        settlementClearedStart: siteNotesModal.startDate || currentData.settlementClearedStart || null
      };

      // 커뮤니티 모드인지 사이트 모드인지에 따라 저장 위치 분기
      if (siteNotesModal.mode === 'community' && siteNotesModal.communityId) {
        const response = await axiosInstance.post('/community-notes', {
          community_id: siteNotesModal.communityId,
          data: dataToSave
        });

        if (response.data.recorded_by) {
          setSiteNotesModal(prev => ({
            ...prev,
            recordedBy: response.data.recorded_by
          }));
        }

        toast.success('커뮤니티 정보가 저장되었습니다');
        setSiteNotesModal(prev => ({ ...prev, open: false }));
        return;
      }

      const response = await axiosInstance.post('/site-notes', {
        site_name: (siteNotesModal.siteName || '').trim(), // ✅ 공백 제거
        identity_name: (siteNotesModal.identityName || '').trim() || null, // ✅ 공백 제거
        // updateRecordedBy: 이벤트 정보가 변경된 경우에만 true
        updateRecordedBy: updateRecordedBy,
        data: dataToSave
      });
      
      // 서버에서 받은 recorded_by 정보로 업데이트
      if (response.data.recorded_by) {
        setSiteNotesModal(prev => ({ 
          ...prev, 
          recordedBy: response.data.recorded_by 
        }));
      }
      
      toast.success('사이트 정보가 저장되었습니다');

      // 🔄 DRBet 출석 타입 캐시 갱신을 위한 전역 이벤트 발행
      try {
        const updatedAttendanceType = dataToSave.attendanceType || '자동';
        window.dispatchEvent(new CustomEvent('attendanceTypeChanged', {
          detail: {
            siteName: siteNotesModal.siteName,
            identityName: siteNotesModal.identityName || null,
            attendanceType: updatedAttendanceType
          }
        }));
      } catch (e) {
        console.warn('attendanceTypeChanged 이벤트 발행 실패:', e);
      }
      
      // 저장 후 최신 데이터 다시 불러오기
      const updatedData = await fetchSiteNotes(siteNotesModal.siteName, siteNotesModal.identityName || null);
      if (updatedData) {
        // 기존 데이터 구조를 새 구조로 변환
        const existingData = updatedData?.data || {};
        
        // 월 변경 체크하여 출석일 자동 초기화
        function getKSTMonthString(date = null) {
          const now = date ? new Date(date) : new Date();
          const kstDate = new Date(now.toLocaleString('en-US', {timeZone: 'Asia/Seoul'}));
          const year = kstDate.getFullYear();
          const month = String(kstDate.getMonth() + 1).padStart(2, '0');
          return `${year}-${month}`;
        }
        const currentMonth = getKSTMonthString();
        const lastUpdated = existingData.lastUpdated || currentMonth;
        const rollover = existingData.rollover || 'X';
        let attendanceDays = existingData.attendanceDays || 0;
        
        if (lastUpdated !== currentMonth && rollover !== 'O') {
          attendanceDays = 0;
        }
        
        const defaultSettlementRules = Array.isArray(existingData.settlementRules)
          ? existingData.settlementRules
          : ((existingData.settlementTotal || existingData.settlementPoint)
              ? [{ total: existingData.settlementTotal || 0, point: existingData.settlementPoint || '' }]
              : []);
        
        const normalizeEvents = Array.isArray(existingData.events) ? existingData.events : [];
        
        const defaultData = {
          tenure: existingData.tenure || '',
          attendanceType: existingData.attendanceType || existingData.autoManual || '자동',
          chargeMin: existingData.chargeMin !== undefined && existingData.chargeMin !== null ? Number(existingData.chargeMin) : 0,
          chargeMax: existingData.chargeMax !== undefined && existingData.chargeMax !== null ? Number(existingData.chargeMax) : 0,
          attendanceDays: attendanceDays,
          rollover: rollover,
          settlement: existingData.settlement || '',
          settlementTotal: existingData.settlementTotal || 0,
          settlementPoint: existingData.settlementPoint || '',
          settlementDays: existingData.settlementDays || 0,
          settlementRules: defaultSettlementRules,
          settlementCleared: existingData.settlementCleared || {},
          settlementClearedStart: existingData.settlementClearedStart || null,
          payback: existingData.payback || { type: '수동', days: [], percent: '', sameDayPercent: '' },
          rate: existingData.rate || '',
          events: normalizeEvents,
          pointTypes: existingData.pointTypes || [],
          lastUpdated: currentMonth
        };
        
        // events 배열의 각 항목에 rolling 필드가 없으면 추가
        defaultData.events = defaultData.events.map(evt => ({
          event: evt.event || '',
          detail: evt.detail || '',
          rolling: evt.rolling || ''
        }));
        
        // 모달 데이터 업데이트 (모달이 열려있으면 최신 데이터로 업데이트)
        setSiteNotesModal(prev => ({
          ...prev,
          data: defaultData,
          recordedBy: updatedData?.recorded_by_identity || prev.recordedBy,
          startDate: defaultData.settlementClearedStart || ''
        }));
      }
      
      setSiteNotesModal(prev => ({ ...prev, open: false }));
    } catch (e) {
      console.error('사이트 메타데이터 저장 실패:', e);
      toast.error('저장 실패');
    }
  };

  // 사이트 추가/수정 모달 열기
  const openSiteModal = (site = null) => {
    if (!selectedIdentity) {
      toast.error('먼저 유저를 선택해주세요');
      return;
    }
    
    if (site) {
      setEditingSite(site);
      setSiteForm({
        site_name: site.site_name,
        domain: site.domain || '',
        referral_path: site.referral_path || '',
        approval_call: site.approval_call || false,
        identity_name: selectedIdentity.name,
        account_id: site.account_id,
        password: site.password,
        exchange_password: site.exchange_password || '',
        nickname: site.nickname || '',
        status: site.status,
        referral_code: site.referral_code || '',
        category: site.category || '',
        notes: site.notes || ''
      });
    } else {
      setEditingSite(null);
      setSiteForm({
        site_name: '',
        domain: '',
        referral_path: '',
        approval_call: false,
        identity_name: selectedIdentity.name,
        account_id: '',
        password: '',
        exchange_password: '',
        nickname: '',
        status: '가입전',
        referral_code: '',
        category: '',
        notes: ''
      });
    }
    // 모달 열 때 사이트명 목록 로드 (비어있으면)
    if (allSiteNames.length === 0) {
      loadAllSiteNames();
    }
    setShowSiteModal(true);
  };

  // 사이트 저장
  const saveSite = async (skipSimilarCheck = false) => {
    try {
      // 유사도 검사 (새 사이트명인 경우만)
      if (!skipSimilarCheck && siteForm.site_name && !editingSite) {
        const similar = await checkSimilarSiteNames(siteForm.site_name);
        if (similar && similar.length > 0) {
          setSimilarWarning(similar);
          // 사용자가 확인하도록 대기 (저장 중단)
          const confirmed = window.confirm(
            `유사한 사이트명이 있습니다:\n${similar.map(s => `• ${s.name} (${Math.round(s.similarity * 100)}%)`).join('\n')}\n\n그래도 "${siteForm.site_name}"으로 저장하시겠습니까?`
          );
          if (!confirmed) {
            return; // 저장 중단
          }
        }
      }
      
      // 현재 날짜를 MM.DD 형식으로 가져오기
      const now = new Date();
      const month = String(now.getMonth() + 1).padStart(2, '0');
      const day = String(now.getDate()).padStart(2, '0');
      const datePrefix = `${month}.${day}`;
      
      // 상태가 변경되었고, 날짜가 없으면 날짜 추가
      let statusWithDate = siteForm.status;
      if (statusWithDate && !statusWithDate.match(/^\d{1,2}\.\d{1,2}/)) {
        statusWithDate = `${datePrefix} ${statusWithDate}`;
      }
      
      const dataToSave = {
        ...siteForm,
        status: statusWithDate
      };
      
      if (editingSite) {
        await axiosInstance.put(`/sites/${editingSite.id}`, dataToSave);
        toast.success('사이트가 수정되었습니다');
      } else {
        await axiosInstance.post('/sites', {
          ...dataToSave,
          identity_id: selectedIdentity.id
        });
        toast.success('사이트가 추가되었습니다');
        // 새 사이트명 추가 후 목록 갱신
        loadAllSiteNames();
      }
      
      setShowSiteModal(false);
      setSimilarWarning(null);
      loadSites(selectedIdentity.id);
    } catch (error) {
      console.error('사이트 저장 실패:', error);
      toast.error('사이트 저장에 실패했습니다');
    }
  };

  // 사이트 삭제
  const deleteSite = async (site) => {
    if (!window.confirm(`"${site.site_name}" 사이트를 삭제하시겠습니까?`)) {
      return;
    }
    
    try {
      await axiosInstance.delete(`/sites/${site.id}`);
      toast.success('사이트가 삭제되었습니다');
      loadSites(selectedIdentity.id);
    } catch (error) {
      console.error('사이트 삭제 실패:', error);
      toast.error('사이트 삭제에 실패했습니다');
    }
  };

  // 커뮤니티 저장
  const saveCommunity = async () => {
    try {
      // 저장할 데이터 준비
      const communityToSave = { ...communityForm };
      
      // identity_name이 없으면 selectedIdentity에서 가져오기
      if (!communityToSave.identity_name && selectedIdentity) {
        communityToSave.identity_name = selectedIdentity.name;
      }
      
      // 상태에 날짜 추가 (날짜가 없으면)
      if (communityToSave.status && !communityToSave.status.match(/^\d{1,2}\.\d{1,2}/)) {
        const now = new Date();
        const month = String(now.getMonth() + 1).padStart(2, '0');
        const day = String(now.getDate()).padStart(2, '0');
        communityToSave.status = `${month}.${day} ${communityToSave.status}`;
      }
      
      if (editingCommunity) {
        await axiosInstance.put(`/communities/${editingCommunity.id}`, communityToSave);
        toast.success('커뮤니티가 수정되었습니다');
      } else {
        await axiosInstance.post('/communities', communityToSave);
        toast.success('커뮤니티가 추가되었습니다');
      }
      
      setShowCommunityModal(false);
      setCommunityForm({
        site_name: '',
        domain: '',
        referral_path: '',
        approval_call: false,
        identity_name: '',
        account_id: '',
        password: '',
        exchange_password: '',
        nickname: '',
        status: '가입전',
        referral_code: '',
        notes: ''
      });
      setEditingCommunity(null);
      loadCommunities();
    } catch (error) {
      console.error('커뮤니티 저장 실패:', error);
      toast.error('커뮤니티 저장에 실패했습니다');
    }
  };

  // 커뮤니티 삭제
  const deleteCommunity = async (community) => {
    if (!window.confirm(`"${community.site_name}" 커뮤니티를 삭제하시겠습니까?`)) {
      return;
    }
    
    try {
      await axiosInstance.delete(`/communities/${community.id}`);
      toast.success('커뮤니티가 삭제되었습니다');
      loadCommunities();
    } catch (error) {
      console.error('커뮤니티 삭제 실패:', error);
      toast.error('커뮤니티 삭제에 실패했습니다');
    }
  };

  // 커뮤니티 편집
  const openEditCommunity = (community) => {
    setEditingCommunity(community);
    setCommunityForm({
      site_name: community.site_name || '',
      domain: community.domain || '',
      referral_path: community.referral_path || '',
      approval_call: community.approval_call || false,
      identity_name: community.identity_name || '',
      account_id: community.account_id || '',
      password: community.password || '',
      exchange_password: community.exchange_password || '',
      nickname: community.nickname || '',
      status: community.status || '가입전',
      referral_code: community.referral_code || '',
      notes: community.notes || ''
    });
    setShowCommunityModal(true);
  };

  // 커뮤니티 인라인 편집 시작
  const startEditingCommunityCell = async (communityId, field, currentValue) => {
    // 다른 필드가 편집 중이면 먼저 저장
    if (editingCommunityCell && (editingCommunityCell.communityId !== communityId || editingCommunityCell.field !== field)) {
      await saveEditingCommunityCell();
    }
    setEditingCommunityCell({ communityId, field });
    setEditingCommunityValue(currentValue || '');
  };

  // 커뮤니티 인라인 편집 취소
  const cancelEditingCommunityCell = () => {
    setEditingCommunityCell(null);
    setEditingCommunityValue('');
  };

  // 커뮤니티 인라인 편집 저장
  const saveEditingCommunityCell = async () => {
    if (!editingCommunityCell) return;
    
    const { communityId, field } = editingCommunityCell;
    const community = communities.find(c => c.id === communityId);
    
    if (!community) return;
    
    try {
      // approval_call은 boolean 변환
      let value = editingCommunityValue;
      if (field === 'approval_call') {
        value = editingCommunityValue === 'O' || editingCommunityValue === 'o' || editingCommunityValue === true;
      }
      
      // status 필드인 경우 날짜 자동 추가
      if (field === 'status') {
        const now = new Date();
        const month = String(now.getMonth() + 1).padStart(2, '0');
        const day = String(now.getDate()).padStart(2, '0');
        const datePrefix = `${month}.${day}`;
        
        if (value && !value.match(/^\d{1,2}\.\d{1,2}/)) {
          value = `${datePrefix} ${value}`;
        }
      }
      
      // 새 행인 경우 POST로 저장
      if (community.isNew) {
        // 필드 업데이트
        const updatedCommunities = communities.map(c => 
          c.id === communityId ? { ...c, [field]: value } : c
        );
        setCommunities(updatedCommunities);
        const updatedCommunity = { ...community, [field]: value };
        
        // selectedIdentity가 없으면 저장하지 않음
        if (!selectedIdentity || !selectedIdentity.name) {
          toast.error('유저를 먼저 선택해주세요');
          cancelEditingCommunityCell();
          return;
        }
        
        // site_name 또는 status 필드가 입력되었을 때만 저장 (site_name은 필수)
        if (field === 'site_name' && value) {
          const communityToSave = {
            ...updatedCommunity,
            identity_name: selectedIdentity.name || community.identity_name || ''
          };
          
          // 상태에 날짜 추가
          if (communityToSave.status && !communityToSave.status.match(/^\d{1,2}\.\d{1,2}/)) {
            const now = new Date();
            const month = String(now.getMonth() + 1).padStart(2, '0');
            const day = String(now.getDate()).padStart(2, '0');
            communityToSave.status = `${month}.${day} ${communityToSave.status}`;
          }
          
          try {
            const response = await axiosInstance.post('/communities', communityToSave);
            toast.success('커뮤니티가 추가되었습니다');
            
            // 새 행 상태 제거
            setNewCommunityRow(null);
            setCommunities(updatedCommunities.filter(c => c.id !== communityId));
            
            // 명의가 선택되어 있으면 목록 다시 로드
            if (selectedIdentity && selectedIdentity.name) {
              await loadCommunities();
            }
          } catch (error) {
            console.error('커뮤니티 추가 실패:', error);
            console.error('에러 상세:', error.response?.data || error.message);
            toast.error(`커뮤니티 추가에 실패했습니다: ${error.response?.data?.error || error.message}`);
          }
        } else if (field === 'status' && community.site_name) {
          // 이미 site_name이 있는 경우 status만 업데이트하여 저장
          const communityToSave = {
            ...updatedCommunity,
            identity_name: selectedIdentity.name || community.identity_name || ''
          };
          
          // 상태에 날짜 추가
          if (communityToSave.status && !communityToSave.status.match(/^\d{1,2}\.\d{1,2}/)) {
            const now = new Date();
            const month = String(now.getMonth() + 1).padStart(2, '0');
            const day = String(now.getDate()).padStart(2, '0');
            communityToSave.status = `${month}.${day} ${communityToSave.status}`;
          }
          
          try {
            const response = await axiosInstance.post('/communities', communityToSave);
            toast.success('커뮤니티가 추가되었습니다');
            
            // 새 행 상태 제거
            setNewCommunityRow(null);
            setCommunities(updatedCommunities.filter(c => c.id !== communityId));
            
            // 명의가 선택되어 있으면 목록 다시 로드
            if (selectedIdentity && selectedIdentity.name) {
              await loadCommunities();
            }
          } catch (error) {
            console.error('커뮤니티 추가 실패:', error);
            console.error('에러 상세:', error.response?.data || error.message);
            toast.error(`커뮤니티 추가에 실패했습니다: ${error.response?.data?.error || error.message}`);
          }
        } else {
          // 다른 필드는 상태만 업데이트하고 저장하지 않음
          cancelEditingCommunityCell();
        }
      } else {
        // 기존 행인 경우 PUT으로 수정
        await axiosInstance.put(`/communities/${communityId}`, {
          ...community,
          [field]: value
        });
        
        toast.success('수정되었습니다');
        
        // 수정된 행 강조 표시
        setHighlightedCommunityId(communityId);
        
        // 성능 최적화: 전체 목록 재로드 대신 로컬 상태만 업데이트
        setCommunities(prevCommunities => 
          prevCommunities.map(c => c.id === communityId ? { ...c, [field]: value } : c)
        );
        
        // 스크롤 및 강조 표시
        setTimeout(() => {
          const rowElement = communityRowRefs.current[communityId];
          if (rowElement) {
            rowElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
          }
        }, 100);
        cancelEditingCommunityCell();
      }
    } catch (error) {
      console.error('커뮤니티 셀 수정 실패:', error);
      toast.error('수정에 실패했습니다');
      cancelEditingCommunityCell();
    }
  };

  // 커뮤니티 인라인 편집 키보드 이벤트
  const handleCommunityCellKeyDown = async (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      await saveEditingCommunityCell();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      cancelEditingCommunityCell();
    } else if (e.key === 'Tab') {
      e.preventDefault();
      
      if (!editingCommunityCell) return;
      
      const { communityId, field } = editingCommunityCell;
      const community = communities.find(c => c.id === communityId);
      if (!community) return;
      
      // 현재 필드 저장
      await saveEditingCommunityCell();
      
      // Shift+Tab: 이전 필드로 이동
      if (e.shiftKey) {
        const previousField = getPreviousCommunityField(field);
        if (previousField) {
          const previousValue = community[previousField] || '';
          // 저장 완료 후 이동
          await startEditingCommunityCell(communityId, previousField, previousValue);
        }
      } else {
        // Tab: 다음 필드로 이동
        const nextField = getNextCommunityField(field);
        if (nextField) {
          const nextValue = community[nextField] || '';
          // 저장 완료 후 이동
          await startEditingCommunityCell(communityId, nextField, nextValue);
        }
      }
    }
  };

  // 편집 가능한 필드 순서 정의 (사이트 테이블 순서대로)
  const editableFields = [
    'domain',           // 도메인
    'referral_path',    // 경로-코드
    'account_id',       // 아이디
    'password',         // 비번
    'exchange_password', // 환비
    'nickname',         // 닉네임
    'referral_code',    // 경로
    'category'          // 장
  ];

  // 커뮤니티 편집 가능한 필드 순서 정의 (테이블 순서대로)
  const editableCommunityFields = [
    'domain',           // 도메인
    'referral_code',    // 경로-코드
    'name',             // 아이디 (커뮤니티는 name 필드)
    'user_id',          // 비번 (커뮤니티는 user_id 필드)
    'password',         // 환비 (커뮤니티는 password 필드)
    'exchange_password', // 환비
    'nickname',         // 닉네임
    'path'              // 경로
  ];

  // 다음 필드 찾기 (사이트용)
  const getNextField = (currentField) => {
    const currentIndex = editableFields.indexOf(currentField);
    if (currentIndex === -1 || currentIndex === editableFields.length - 1) {
      return null; // 마지막 필드이거나 찾을 수 없으면 null
    }
    return editableFields[currentIndex + 1];
  };

  // 이전 필드 찾기 (사이트용)
  const getPreviousField = (currentField) => {
    const currentIndex = editableFields.indexOf(currentField);
    if (currentIndex <= 0) {
      return null; // 첫 번째 필드이거나 찾을 수 없으면 null
    }
    return editableFields[currentIndex - 1];
  };

  // 다음 필드 찾기 (커뮤니티용)
  const getNextCommunityField = (currentField) => {
    const currentIndex = editableCommunityFields.indexOf(currentField);
    if (currentIndex === -1 || currentIndex === editableCommunityFields.length - 1) {
      return null; // 마지막 필드이거나 찾을 수 없으면 null
    }
    return editableCommunityFields[currentIndex + 1];
  };

  // 이전 필드 찾기 (커뮤니티용)
  const getPreviousCommunityField = (currentField) => {
    const currentIndex = editableCommunityFields.indexOf(currentField);
    if (currentIndex <= 0) {
      return null; // 첫 번째 필드이거나 찾을 수 없으면 null
    }
    return editableCommunityFields[currentIndex - 1];
  };

  // 인라인 편집 시작
  const startEditingCell = async (siteId, field, currentValue) => {
    // 다른 필드가 편집 중이면 먼저 저장
    if (editingCell && (editingCell.siteId !== siteId || editingCell.field !== field)) {
      await saveEditingCell();
    }
    setEditingCell({ siteId, field });
    setEditingValue(currentValue || '');
  };

  // 인라인 편집 취소
  const cancelEditingCell = () => {
    setEditingCell(null);
    setEditingValue('');
    setEditingStatusDate('');
  };

  // 승전(approval_call) 더블클릭 편집 시작
  const startEditingApprovalCall = (id, type, currentValue) => {
    setEditingApprovalCall({ id, type });
    setEditingApprovalValue(currentValue);
  };

  // 승전(approval_call) 저장
  const saveApprovalCall = async (newValue) => {
    if (!editingApprovalCall) return;
    
    const { id, type } = editingApprovalCall;
    
    try {
      if (type === 'site') {
        const site = filteredSites.find(s => s.id === id);
        if (!site) return;
        
        if (site.isNew) {
          // 새 행인 경우 로컬에서만 업데이트
          setSites(prevSites => 
            prevSites.map(s => s.id === id ? { ...s, approval_call: newValue } : s)
          );
        } else {
          // 기존 행인 경우 서버에 저장
          await axiosInstance.put(`/sites/${id}`, { ...site, approval_call: newValue });
          setSites(prevSites => 
            prevSites.map(s => s.id === id ? { ...s, approval_call: newValue } : s)
          );
          toast.success('승전 여부가 변경되었습니다');
        }
      } else if (type === 'community') {
        const community = communities.find(c => c.id === id);
        if (!community) return;
        
        if (community.isNew) {
          // 새 행인 경우 로컬에서만 업데이트
          const updatedCommunities = communities.map(c => 
            c.id === id ? { ...c, approval_call: newValue } : c
          );
          setCommunities(updatedCommunities);
        } else {
          // 기존 행인 경우 서버에 저장
          await axiosInstance.put(`/communities/${id}`, { ...community, approval_call: newValue });
          const updatedCommunities = communities.map(c => 
            c.id === id ? { ...c, approval_call: newValue } : c
          );
          setCommunities(updatedCommunities);
          toast.success('승전 여부가 변경되었습니다');
        }
      }
    } catch (error) {
      console.error('승전 여부 변경 실패:', error);
      toast.error('승전 여부 변경에 실패했습니다');
    } finally {
      setEditingApprovalCall(null);
      setEditingApprovalValue(false);
    }
  };

  // 인라인 편집 저장
  const saveEditingCell = async () => {
    if (!editingCell) return;
    
    // 중복 저장 방지
    if (savingCellRef.current) return;
    savingCellRef.current = true;

    const { siteId, field } = editingCell;
    const site = filteredSites.find(s => s.id === siteId);
    
    if (!site) {
      savingCellRef.current = false;
      return;
    }

    try {
      // 날짜 자동 추가 (승인유무만)
      let valueToSave = editingValue;
      if (field === 'status') {
        const now = new Date();
        const month = String(now.getMonth() + 1).padStart(2, '0');
        const day = String(now.getDate()).padStart(2, '0');
        const datePrefix = `${month}.${day}`;
        
        if (valueToSave && !valueToSave.match(/^\d{1,2}\.\d{1,2}/)) {
          valueToSave = `${datePrefix} ${valueToSave}`;
        }
      }

      // 새 행인 경우 POST로 저장
      if (site.isNew) {
        // 필드 업데이트
        const updatedSites = filteredSites.map(s => 
          s.id === siteId ? { ...s, [field]: valueToSave } : s
        );
        const updatedSite = { ...site, [field]: valueToSave };
        
        // site_name 또는 status 필드가 입력되었을 때만 저장 (site_name은 필수)
        if (field === 'site_name' && valueToSave) {
          // 유사 사이트명 경고
          const similar = await checkSimilarSiteNames(valueToSave);
          if (similar && similar.length > 0) {
            const confirmed = window.confirm(
              `유사한 사이트명이 있습니다:\n${similar.map(s => `• ${s.name} (${Math.round(s.similarity * 100)}%)`).join('\n')}\n\n그래도 "${valueToSave}"으로 저장하시겠습니까?`
            );
            if (!confirmed) {
              setEditingCell(null);
              return;
            }
          }
          
          const siteToSave = {
            ...updatedSite,
            identity_id: selectedIdentity.id
          };
          
          // 상태에 날짜 추가
          if (siteToSave.status && !siteToSave.status.match(/^\d{1,2}\.\d{1,2}/)) {
            const now = new Date();
            const month = String(now.getMonth() + 1).padStart(2, '0');
            const day = String(now.getDate()).padStart(2, '0');
            siteToSave.status = `${month}.${day} ${siteToSave.status}`;
          }
          
          try {
            await axiosInstance.post('/sites', siteToSave);
            toast.success('사이트가 추가되었습니다');
            loadAllSiteNames(); // 새 사이트명 추가 후 목록 갱신
            
            // 새 행 상태 제거
            setNewSiteRow(null);
            setSites(prevSites => prevSites.filter(s => s.id !== siteId));
            loadSites(selectedIdentity.id);
          } catch (error) {
            console.error('사이트 추가 실패:', error);
            toast.error('사이트 추가에 실패했습니다');
          }
        } else if (field === 'status' && site.site_name) {
          // 이미 site_name이 있는 경우 status만 업데이트하여 저장
          const siteToSave = {
            ...updatedSite,
            identity_id: selectedIdentity.id
          };
          
          try {
            await axiosInstance.post('/sites', siteToSave);
            toast.success('사이트가 추가되었습니다');
            
            // 새 행 상태 제거
            setNewSiteRow(null);
            setSites(prevSites => prevSites.filter(s => s.id !== siteId));
            loadSites(selectedIdentity.id);
          } catch (error) {
            console.error('사이트 추가 실패:', error);
            toast.error('사이트 추가에 실패했습니다');
          }
        } else {
          // 다른 필드는 상태만 업데이트하고 저장하지 않음
          cancelEditingCell();
        }
      } else {
        // 기존 행인 경우 PUT으로 수정
        
        // site_name 필드 수정 시 유사도 검사
        if (field === 'site_name' && valueToSave && valueToSave !== site.site_name) {
          const similar = await checkSimilarSiteNames(valueToSave);
          if (similar && similar.length > 0) {
            const confirmed = window.confirm(
              `유사한 사이트명이 있습니다:\n${similar.map(s => `• ${s.name} (${Math.round(s.similarity * 100)}%)`).join('\n')}\n\n그래도 "${valueToSave}"으로 수정하시겠습니까?`
            );
            if (!confirmed) {
              cancelEditingCell();
              return;
            }
          }
        }
        
      await axiosInstance.put(`/sites/${siteId}`, {
        ...site,
        [field]: valueToSave
      });
      
      // site_name 변경 시 목록 갱신
      if (field === 'site_name') {
        loadAllSiteNames();
      }
      
      toast.success('수정되었습니다');
      
      // 수정된 행 강조 표시
      setHighlightedSiteId(siteId);
      
      // 성능 최적화: 전체 목록 재로드 대신 로컬 상태만 업데이트
      setSites(prevSites => 
        prevSites.map(s => s.id === siteId ? { ...s, [field]: valueToSave } : s)
      );
      
      // site_name 변경 시에만 전체 사이트명 목록 갱신 (필요한 경우에만 API 호출)
      if (field === 'site_name') {
        loadAllSiteNames();
      }
      
      // 스크롤 및 강조 표시
      setTimeout(() => {
        const rowElement = siteRowRefs.current[siteId];
        if (rowElement) {
          rowElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
      }, 100);
      }
      
      cancelEditingCell();
    } catch (error) {
      console.error('셀 수정 실패:', error);
      toast.error('수정에 실패했습니다');
    } finally {
      savingCellRef.current = false;
    }
  };

  // Enter 키로 저장, ESC 키로 취소, Tab으로 다음 필드로 이동
  const handleCellKeyDown = async (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      await saveEditingCell();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      cancelEditingCell();
    } else if (e.key === 'Tab') {
      e.preventDefault();
      
      if (!editingCell) return;
      
      const { siteId, field } = editingCell;
      const site = filteredSites.find(s => s.id === siteId);
      if (!site) return;
      
      // 현재 필드 저장
      await saveEditingCell();
      
      // Shift+Tab: 이전 필드로 이동
      if (e.shiftKey) {
        const previousField = getPreviousField(field);
        if (previousField) {
          const previousValue = site[previousField] || '';
          // 저장 완료 후 이동
          await startEditingCell(siteId, previousField, previousValue);
        }
      } else {
        // Tab: 다음 필드로 이동
        const nextField = getNextField(field);
        if (nextField) {
          const nextValue = site[nextField] || '';
          // 저장 완료 후 이동
          await startEditingCell(siteId, nextField, nextValue);
        }
      }
    }
  };

  // 일괄 등록 모달 열기
  const openBulkImportModal = () => {
    if (!selectedIdentity) {
      toast.error('먼저 유저를 선택해주세요');
      return;
    }
    resetBulkImportState();
    setShowBulkImportModal(true);
  };

  // 엑셀 데이터 파싱 (탭으로 구분된 데이터)
  const parseBulkData = () => {
    if (!bulkImportText.trim()) {
      toast.error('데이터를 입력해주세요');
      return;
    }

    try {
      const now = new Date();
      const month = String(now.getMonth() + 1).padStart(2, '0');
      const day = String(now.getDate()).padStart(2, '0');
      const datePrefix = `${month}.${day}`;
      
      // 유효한 상태 목록
      const validStatuses = ['가입전', '대기', '승인', '장점검', '팅', '졸업'];
      
      const lines = bulkImportText.trim().split('\n');
      const parsed = lines.map((line, index) => {
        const cells = line.split('\t'); // 탭으로 구분
        
        // 승인유무 원본 값 (날짜가 포함될 수도 있음)
        const inputStatusRaw = (cells[9] || '가입전').trim();
        
        // 원본 값에 날짜가 있는지 확인
        const hasDateInInput = inputStatusRaw.match(/^\d{1,2}\.\d{1,2}/);
        
        // 날짜 제거한 순수 상태값 추출 (수동입력 판단용)
        let pureStatus = inputStatusRaw.replace(/^\d{1,2}\.\d{1,2}\s*/, '').trim();
        
        // "수동입력" 텍스트 제거 (DB에는 저장하지 않음)
        pureStatus = pureStatus.replace(/^수동입력\s+/, '').trim();
        
        // 기존 사이트 찾기 (사이트명과 도메인으로 매칭)
        const siteName = cells[0] || '';
        const domain = cells[1] || '';
        const existingSite = sites.find(s => 
          s.site_name === siteName && s.domain === domain
        );
        
        // 수동입력 여부 판단
        let isManualInput = false;
        
        // 1. 전체 순수 상태값이 유효한 상태 목록에 정확히 일치하는지 확인
        const isExactValidStatus = validStatuses.includes(pureStatus);
        
        if (!isExactValidStatus) {
          // 2. 슬래시로 구분된 복합 상태값인지 확인
          const statusParts = pureStatus.split('/').map(s => s.trim()).filter(s => s);
          
          // 3. 각 부분이 모두 유효한 상태 목록에 정확히 일치하는지 확인
          const allPartsAreValid = statusParts.length > 0 && statusParts.every(part => {
            // 각 부분에서 날짜 제거 후 순수 상태값 확인
            const purePart = part.replace(/^\d{1,2}\.\d{1,2}\s*/, '').trim();
            return validStatuses.includes(purePart);
          });
          
          if (!allPartsAreValid) {
            // 기존 사이트가 있는 경우
            if (existingSite && existingSite.status) {
              // 기존 상태에서 모든 순수 상태값 추출 (슬래시로 구분, 날짜/수동입력 제거)
              const existingStatuses = existingSite.status.split('/').map(s => {
                const trimmed = s.trim();
                // 날짜 제거
                let pure = trimmed.replace(/^\d{1,2}\.\d{1,2}\s*/, '').trim();
                // 수동입력 텍스트 제거
                pure = pure.replace(/^수동입력\s+/, '').trim();
                return pure;
              }).filter(s => s); // 빈 값 제거
              
              // 입력된 순수 상태값이 기존 상태 목록에도 없으면 수동입력
              if (!existingStatuses.includes(pureStatus)) {
                isManualInput = true;
              }
            } else {
              // 기존 사이트가 없으면, 유효한 상태 목록에 없으면 수동입력
              isManualInput = true;
            }
          }
        }
        
        // 최종 상태 문자열 구성
        let status;
        if (hasDateInInput) {
          // 원본에 날짜가 있으면 그대로 사용 (수동입력 텍스트만 제거)
          status = inputStatusRaw.replace(/^수동입력\s+/, '').trim();
        } else {
          // 날짜가 없으면 오늘 날짜(KST) 추가
          const finalStatus = pureStatus;
          status = `${datePrefix} ${finalStatus}`;
        }
        
        // 엑셀 열 순서: 출석, 도메인, 경로-코드, 승전, 성함, 아이디, 비번, 환비, 닉네임, 승인유무, 경로, 장
        return {
          tempId: `temp-${index}`,
          site_name: cells[0] || '',      // 출석
          domain: cells[1] || '',         // 도메인
          referral_path: cells[2] || '',  // 경로-코드
          approval_call: cells[3] === 'O' || cells[3] === 'o', // 승전
          identity_name: cells[4] || selectedIdentity.name, // 성함
          account_id: cells[5] || '',     // 아이디
          password: cells[6] || '',       // 비번
          exchange_password: cells[7] || '', // 환비
          nickname: cells[8] || '',       // 닉네임
          status: status,                 // 승인유무 (날짜 포함)
          referral_code: cells[10] || '', // 경로
          category: cells[11] || '',      // 장
          notes: ''
        };
      });

      setParsedBulkData(parsed);
      toast.success(`${parsed.length}개 행을 파싱했습니다`);
    } catch (error) {
      console.error('파싱 실패:', error);
      toast.error('데이터 파싱에 실패했습니다');
    }
  };

  // 일괄 등록 실행
  const executeBulkImport = async () => {
    if (parsedBulkData.length === 0) {
      toast.error('등록할 데이터가 없습니다');
      return;
    }

    try {
      let successCount = 0;
      let failCount = 0;

      for (const data of parsedBulkData) {
        try {
          await axiosInstance.post('/sites', {
            ...data,
            identity_id: selectedIdentity.id
          });
          successCount++;
        } catch (error) {
          console.error('사이트 등록 실패:', error);
          failCount++;
        }
      }

      toast.success(`일괄 등록 완료: 성공 ${successCount}개, 실패 ${failCount}개`);
      setShowBulkImportModal(false);
      resetBulkImportState();
      loadSites(selectedIdentity.id);
    } catch (error) {
      console.error('일괄 등록 실패:', error);
      toast.error('일괄 등록에 실패했습니다');
    }
  };

  // 엑셀로 내보내기
  const exportToExcel = async () => {
    if (filteredSites.length === 0) {
      toast.error('내보낼 데이터가 없습니다');
      return;
    }

    // TSV 형식으로 변환 (엑셀에서 복사-붙여넣기 용이)
    const headers = ['출석', '도메인', '경로-코드', '승전', '성함', '아이디', '비번', '환비', '닉네임', '승인유무', '경로', '장'];
    const rows = filteredSites.map(site => [
      site.site_name,
      site.domain,
      site.referral_path,
      site.approval_call ? 'O' : 'X',
      selectedIdentity?.name || '',
      site.account_id,
      site.password,
      site.exchange_password,
      site.nickname,
      site.status,
      site.referral_code,
      site.category
    ]);

    const tsvContent = [headers, ...rows].map(row => row.join('\t')).join('\n');
    
    // 클립보드에 복사
    try {
      if (navigator && navigator.clipboard && navigator.clipboard.writeText) {
        // 최신 브라우저 API 사용
        await navigator.clipboard.writeText(tsvContent);
        toast.success('클립보드에 복사되었습니다! 엑셀에 붙여넣기 하세요.');
      } else {
        // fallback: execCommand 기반 복사
        const textarea = document.createElement('textarea');
        textarea.value = tsvContent;
        textarea.setAttribute('readonly', '');
        textarea.style.position = 'fixed';
        textarea.style.top = '-1000px';
        document.body.appendChild(textarea);
        textarea.select();
        const successful = document.execCommand('copy');
        document.body.removeChild(textarea);
        
        if (successful) {
          toast.success('클립보드에 복사되었습니다! 엑셀에 붙여넣기 하세요.');
        } else {
          toast.error('클립보드 복사에 실패했습니다');
        }
      }
    } catch (err) {
      console.error('복사 실패:', err);
      toast.error('클립보드 복사에 실패했습니다');
    }
  };
  
  // 커뮤니티 엑셀로 내보내기
  const exportCommunitiesToExcel = async () => {
    if (filteredCommunities.length === 0) {
      toast.error('내보낼 데이터가 없습니다');
      return;
    }

    // TSV 형식으로 변환 (엑셀에서 복사-붙여넣기 용이)
    const headers = ['출석', '도메인', '경로-코드', '승전', '성함', '아이디', '비번', '환비', '닉네임', '승인유무', '경로', '장'];
    const rows = filteredCommunities.map(community => [
      community.site_name,
      community.domain,
      community.referral_path,
      community.approval_call ? 'O' : 'X',
      community.identity_name || '',
      community.account_id,
      community.password,
      community.exchange_password,
      community.nickname,
      community.status,
      community.referral_code,
      community.category
    ]);

    const tsvContent = [headers, ...rows].map(row => row.join('\t')).join('\n');
    
    // 클립보드에 복사
    try {
      if (navigator && navigator.clipboard && navigator.clipboard.writeText) {
        // 최신 브라우저 API 사용
        await navigator.clipboard.writeText(tsvContent);
        toast.success('클립보드에 복사되었습니다! 엑셀에 붙여넣기 하세요.');
      } else {
        // fallback: execCommand 기반 복사
        const textarea = document.createElement('textarea');
        textarea.value = tsvContent;
        textarea.setAttribute('readonly', '');
        textarea.style.position = 'fixed';
        textarea.style.top = '-1000px';
        document.body.appendChild(textarea);
        textarea.select();
        const successful = document.execCommand('copy');
        document.body.removeChild(textarea);
        
        if (successful) {
          toast.success('클립보드에 복사되었습니다! 엑셀에 붙여넣기 하세요.');
        } else {
          toast.error('클립보드 복사에 실패했습니다');
        }
      }
    } catch (err) {
      console.error('복사 실패:', err);
      toast.error('클립보드 복사에 실패했습니다');
    }
  };
  
  // 커뮤니티 일괄 등록 파싱
  const parseCommunityBulkData = () => {
    if (!bulkImportText.trim()) {
      toast.error('데이터를 입력해주세요');
      return;
    }

    try {
      const now = new Date();
      const month = String(now.getMonth() + 1).padStart(2, '0');
      const day = String(now.getDate()).padStart(2, '0');
      const datePrefix = `${month}.${day}`;

      const lines = bulkImportText.trim().split('\n');
      const parsed = lines.map((line, index) => {
        const cells = line.split('\t'); // 탭으로 구분
        
        // 승인유무에 날짜 추가 (날짜가 없으면)
        let status = cells[9] || '가입전';
        if (status && !status.match(/^\d{1,2}\.\d{1,2}/)) {
          status = `${datePrefix} ${status}`;
        }
        
        // 엑셀 열 순서: 출석, 도메인, 경로-코드, 승전, 성함, 아이디, 비번, 환비, 닉네임, 승인유무, 경로, 장
        return {
          tempId: `temp-${index}`,
          site_name: cells[0] || '',      // 출석
          domain: cells[1] || '',         // 도메인
          referral_path: cells[2] || '',  // 경로-코드
          approval_call: cells[3] === 'O' || cells[3] === 'o', // 승전
          identity_name: cells[4] || selectedIdentity?.name || '', // 성함
          account_id: cells[5] || '',     // 아이디
          password: cells[6] || '',       // 비번
          exchange_password: cells[7] || '', // 환비
          nickname: cells[8] || '',       // 닉네임
          status: status,                 // 승인유무 (날짜 포함)
          referral_code: cells[10] || '', // 경로
          category: cells[11] || '',      // 장
          notes: ''
        };
      });

      setParsedBulkData(parsed);
      toast.success(`${parsed.length}개 행을 파싱했습니다`);
    } catch (error) {
      console.error('파싱 실패:', error);
      toast.error('데이터 파싱에 실패했습니다');
    }
  };

  // 커뮤니티 일괄 등록 실행
  const executeCommunityBulkImport = async () => {
    if (parsedBulkData.length === 0) {
      toast.error('등록할 데이터가 없습니다');
      return;
    }

    try {
      let successCount = 0;
      let failCount = 0;

      for (const data of parsedBulkData) {
        try {
          await axiosInstance.post('/communities', data);
          successCount++;
        } catch (error) {
          console.error('커뮤니티 등록 실패:', error);
          failCount++;
        }
      }

      toast.success(`일괄 등록 완료: 성공 ${successCount}개, 실패 ${failCount}개`);
      setShowBulkImportModal(false);
      resetBulkImportState();
      loadCommunities();
    } catch (error) {
      console.error('일괄 등록 실패:', error);
      toast.error('일괄 등록에 실패했습니다');
    }
  };

  return (
    <>
    <div className="space-y-6 bg-gray-100 dark:bg-gray-900 min-h-[calc(100vh/0.675-64px)]" style={{ zoom: '0.75' }}>
      {/* 유저 선택 영역 */}
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow dark:shadow-gray-900/50 p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-bold text-gray-900 dark:text-white">👤 유저 관리</h2>
          <button
            onClick={() => openIdentityModal()}
            className="bg-green-600 text-white px-4 py-2 rounded-md hover:bg-green-700 font-bold text-sm"
          >
            ➕ 새 유저 추가
          </button>
        </div>
        
        <DragDropContext onDragEnd={handleIdentityDragEnd}>
          <Droppable droppableId="identities" direction="horizontal">
            {(provided) => (
              <div
                {...provided.droppableProps}
                ref={provided.innerRef}
                className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3"
              >
                {/* 사무실 관리자/슈퍼 관리자용 "전체" 옵션 (관리자 계정 선택 시에만 표시) */}
                {canShowAllOption && (
                  <div
                    className={`relative border-2 rounded-lg p-6 cursor-pointer transition-all ${
                      selectedIdentity?.id === 'all'
                        ? 'border-purple-500 bg-purple-50 dark:bg-purple-900/30 shadow-lg'
                        : 'border-gray-300 dark:border-gray-600 hover:border-purple-300 dark:hover:border-purple-500 hover:shadow-md dark:bg-gray-800'
                    }`}
                    onClick={() => handleIdentitySelect({ id: 'all', name: '전체' })}
                  >
                    <div className="text-center">
                      <div className={`text-4xl mb-3 ${
                        selectedIdentity?.id === 'all' ? 'text-purple-600 dark:text-purple-400' : 'text-gray-600 dark:text-white'
                      }`}>
                        🏢
                      </div>
                      <div className="font-bold text-gray-900 dark:text-white text-base mb-2">
                        전체
                      </div>
                      <div className="text-sm text-gray-500 dark:text-gray-300">
                        사무실 전체
                      </div>
                    </div>
                    {selectedIdentity?.id === 'all' && (
                      <div className="absolute top-2 left-2">
                        <span className="bg-purple-500 text-white text-sm px-3 py-1.5 rounded-full">
                          ✓
                        </span>
                      </div>
                    )}
                  </div>
                )}
                {identities.map((identity, index) => (
                  <Draggable key={identity.id} draggableId={`identity-${identity.id}`} index={index}>
                    {(provided, snapshot) => (
                      <div
                        ref={provided.innerRef}
                        {...provided.draggableProps}
                        {...provided.dragHandleProps}
                        className={`relative group border-2 rounded-lg p-6 cursor-pointer transition-all ${
                          selectedIdentity?.id === identity.id
                            ? 'border-blue-500 bg-blue-50 dark:bg-gray-700 shadow-lg'
                            : 'border-gray-300 dark:border-gray-600 hover:border-blue-300 dark:hover:border-blue-500 hover:shadow-md dark:bg-gray-800'
                        } ${
                          snapshot.isDragging ? 'opacity-50 shadow-xl' : ''
                        }`}
                        onClick={() => handleIdentitySelect(identity)}
                      >
              <div className="text-center">
                <div className={`text-4xl mb-3 ${
                  selectedIdentity?.id === identity.id ? 'text-blue-600 dark:text-blue-400' : 'text-gray-600 dark:text-white'
                }`}>
                  👤
                </div>
                <div className="font-bold text-gray-900 dark:text-white text-base mb-2">
                  {identity.name}
                </div>
                <div className="text-sm text-gray-500 dark:text-gray-300">
                  {identity.birth_date}
                </div>
              </div>
              
              {/* 수정/삭제 버튼 (호버 시 표시) */}
              <div className="absolute top-1 right-1 opacity-0 group-hover:opacity-100 transition-opacity">
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    openIdentityModal(identity);
                  }}
                  className="bg-blue-500 text-white p-1 rounded text-xs hover:bg-blue-600 mr-1"
                  title="수정"
                >
                  ✏️
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    deleteIdentity(identity);
                  }}
                  className="bg-red-500 text-white p-1 rounded text-xs hover:bg-red-600"
                  title="삭제"
                >
                  🗑️
                </button>
              </div>
              
                        {/* 선택 표시 */}
                        {selectedIdentity?.id === identity.id && (
                          <div className="absolute top-2 left-2">
                            <span className="bg-blue-500 text-white text-sm px-3 py-1.5 rounded-full">
                              ✓
                            </span>
                          </div>
                        )}
                      </div>
                    )}
                  </Draggable>
                ))}
                {provided.placeholder}
                {identities.length === 0 && (
                  <div className="col-span-full text-center py-8 text-gray-500 dark:text-white">
                    유저가 없습니다. 새 유저를 추가해보세요!
                  </div>
                )}
              </div>
            )}
          </Droppable>
        </DragDropContext>
        
        {selectedIdentity && (
          <div className="mt-4 p-4 bg-gradient-to-r from-blue-50 to-indigo-50 dark:from-[#282C34] dark:to-[#282C34] rounded-lg border-l-4 border-blue-500 dark:border-blue-400">
            <div className="space-y-3">
              <div className="flex items-center gap-4 text-base">
                <span className="font-bold text-blue-700 dark:text-blue-300 text-lg">선택된 유저:</span>
                <span className="text-gray-900 dark:text-white font-bold text-lg">{selectedIdentity.name}</span>
                <span className="text-gray-400 dark:text-white text-lg">|</span>
                <span className="text-gray-600 dark:text-white text-lg">생년월일: {selectedIdentity.birth_date}</span>
                {selectedIdentity.zodiac && (
                  <>
                    <span className="text-gray-400 dark:text-white text-lg">|</span>
                    <span className="text-gray-600 dark:text-white text-lg">띠: {selectedIdentity.zodiac}띠</span>
                  </>
                )}
                {selectedIdentity.notes && (
                  <>
                    <span className="text-gray-400 dark:text-white text-lg">|</span>
                    <span className="text-gray-600 dark:text-white text-lg">메모: {selectedIdentity.notes}</span>
                  </>
                )}
              </div>
              
              {/* 계좌 정보 - 가장 마지막에 등록한 것만 표시 */}
              {selectedIdentity.bank_accounts && selectedIdentity.bank_accounts.length > 0 && (() => {
                const lastAccount = selectedIdentity.bank_accounts[selectedIdentity.bank_accounts.length - 1];
                return (
                <div className="flex items-start gap-2">
                  <span className="font-bold text-green-700 dark:text-green-400 whitespace-nowrap text-lg">💳 계좌:</span>
                    <span className="bg-green-100 dark:bg-gray-800 text-green-800 dark:text-white px-4 py-2 rounded-full text-base font-medium">
                      {lastAccount.bank} {lastAccount.account_number} {lastAccount.holder && `(${lastAccount.holder})`}
                      </span>
                  </div>
                );
              })()}
              
              {/* 전화번호 정보 - 가장 마지막에 등록한 것만 표시 */}
              {selectedIdentity.phone_numbers && selectedIdentity.phone_numbers.length > 0 && (() => {
                const lastPhone = selectedIdentity.phone_numbers[selectedIdentity.phone_numbers.length - 1];
                return (
                <div className="flex items-start gap-2">
                    <span className="font-bold text-purple-700 dark:text-purple-400 whitespace-nowrap text-lg">📱 번호:</span>
                    <span className="bg-purple-100 dark:bg-gray-800 text-purple-800 dark:text-white px-4 py-2 rounded-full text-base font-medium">
                      {lastPhone.number} {lastPhone.carrier && `(${lastPhone.carrier})`}
                      </span>
                  </div>
                );
              })()}
            </div>
          </div>
        )}
      </div>

      {/* 사이트 목록 테이블 */}
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow dark:shadow-gray-900/50 overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700">
          <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-4">📊 사이트 목록 ({filteredSites.length}개)</h2>
        
        <div className="flex items-center gap-4 mb-4 flex-wrap">
          <div className="flex items-center gap-2">
              <label className="font-medium text-gray-700 dark:text-white">검색:</label>
              <input
                type="text"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="사이트명, 도메인, 닉네임"
                className="border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-md px-3 py-2 w-64 focus:ring-blue-500 focus:border-blue-500"
              />
          </div>
          
          <div className="flex items-center gap-2">
              <label className="font-medium text-gray-700 dark:text-white">상태:</label>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
                className="border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-md px-3 py-2 focus:ring-blue-500 focus:border-blue-500"
            >
              <option>전체</option>
                <option>가입전</option>
              <option>대기</option>
              <option>승인</option>
                <option>장점검</option>
                <option>수동입력</option>
              <option>팅</option>
              <option>졸업</option>
              </select>
            </div>
            
            <div className="flex items-center gap-2">
              <label className="font-medium text-gray-700 dark:text-white">월:</label>
              <select
                value={monthFilter}
                onChange={(e) => setMonthFilter(e.target.value)}
                className="border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-md px-3 py-2 focus:ring-blue-500 focus:border-blue-500"
              >
                <option>전체</option>
                <option value="1">1월</option>
                <option value="2">2월</option>
                <option value="3">3월</option>
                <option value="4">4월</option>
                <option value="5">5월</option>
                <option value="6">6월</option>
                <option value="7">7월</option>
                <option value="8">8월</option>
                <option value="9">9월</option>
                <option value="10">10월</option>
                <option value="11">11월</option>
                <option value="12">12월</option>
            </select>
          </div>
        </div>
        
        <div className="flex items-center gap-3">
          <button
            onClick={() => openSiteModal()}
            disabled={!selectedIdentity}
            className="bg-green-600 text-white px-6 py-3 rounded-md hover:bg-green-700 font-bold disabled:bg-gray-400"
          >
              🌐 새 사이트 추가
          </button>
          <button
              onClick={() => {
                setBulkImportMode('sites');
                resetBulkImportState();
                setShowBulkImportModal(true);
              }}
              className="bg-blue-600 text-white px-6 py-3 rounded-md hover:bg-blue-700 font-bold"
          >
            📋 엑셀 일괄 등록
          </button>
          <button
            onClick={exportToExcel}
            disabled={!selectedIdentity || filteredSites.length === 0}
              className="bg-purple-600 text-white px-6 py-3 rounded-md hover:bg-purple-700 font-bold disabled:bg-gray-400"
          >
            📤 엑셀로 복사
          </button>
          {/* 사이트명 통합 도구 (관리자 이상) */}
          {(isOfficeManager || isSuperAdmin) && (
            <button
              onClick={() => {
                loadDuplicateGroups();
                setShowMergeModal(true);
              }}
              className="bg-orange-600 text-white px-6 py-3 rounded-md hover:bg-orange-700 font-bold"
            >
              🔗 사이트명 통합
            </button>
          )}
            {/* 전체 모드에서는 행추가 버튼 숨김 */}
            {selectedIdentity?.id !== 'all' && (
            <button
              onClick={() => {
                if (!selectedIdentity) return;
                
                // 새 사이트 행 추가
                const tempId = `new_${Date.now()}`;
                const newRow = {
                  id: tempId,
                  site_name: '',
                  domain: '',
                  referral_path: '',
                  approval_call: false,
                  identity_id: selectedIdentity.id,
                  identity_name: selectedIdentity.name,
                  account_id: '',
                  password: '',
                  exchange_password: '',
                  nickname: '',
                  status: '가입전',
                  referral_code: '',
                  category: '',
                  notes: '',
                  isNew: true
                };
                
                setNewSiteRow(newRow);
                // sites에도 추가해야 useEffect 정렬에서 인식됨
                setSites(prev => [newRow, ...prev]);
              }}
              className="bg-green-600 text-white px-6 py-3 rounded-md hover:bg-green-700 font-bold"
            >
              + 행추가
            </button>
            )}
        </div>
        </div>
        
        <DragDropContext onDragEnd={handleSiteDragEnd}>
        <div className="overflow-x-auto rounded-2xl shadow-2xl border border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-900/50 backdrop-blur-sm">
          <table className="min-w-[960px] w-full text-base">
            <thead>
              <tr className="bg-gradient-to-br from-blue-600 via-blue-500 to-blue-600 dark:from-slate-900 dark:via-slate-800 dark:to-slate-900">
                {/* 전체 모드에서 유저명 컬럼 추가 */}
                {selectedIdentity?.id === 'all' && (
                  <th className="px-5 py-5 text-center font-semibold text-white text-sm tracking-widest border-r border-white/10 first:rounded-tl-2xl">
                    <span className="flex items-center justify-center gap-2">
                      <span className="w-1.5 h-1.5 rounded-full bg-white/60"></span>
                      유저
                    </span>
                  </th>
                )}
                <th className="px-5 py-5 text-center font-semibold text-white text-sm tracking-widest border-r border-white/10">
                  <span className="flex items-center justify-center gap-2">
                    <span className="w-1.5 h-1.5 rounded-full bg-white/60"></span>
                    출석
                  </span>
                </th>
                <th className="px-5 py-5 text-center font-semibold text-white text-sm tracking-widest border-r border-white/10">도메인</th>
                <th className="px-5 py-5 text-center font-semibold text-white text-sm tracking-widest border-r border-white/10">경로-코드</th>
                <th className="px-5 py-5 text-center font-semibold text-white text-sm tracking-widest border-r border-white/10">승전</th>
                <th className="px-5 py-5 text-center font-semibold text-white text-sm tracking-widest border-r border-white/10">성함</th>
                <th className="px-5 py-5 text-center font-semibold text-white text-sm tracking-widest border-r border-white/10">아이디</th>
                <th className="px-5 py-5 text-center font-semibold text-white text-sm tracking-widest border-r border-white/10">비번</th>
                <th className="px-5 py-5 text-center font-semibold text-white text-sm tracking-widest border-r border-white/10">환비</th>
                <th className="px-5 py-5 text-center font-semibold text-white text-sm tracking-widest border-r border-white/10">닉네임</th>
                <th className="px-5 py-5 text-center font-semibold text-white text-sm tracking-widest border-r border-white/10">승인유무</th>
                <th className="px-5 py-5 text-center font-semibold text-white text-sm tracking-widest border-r border-white/10">경로</th>
                <th className="px-5 py-5 text-center font-semibold text-white text-sm tracking-widest border-r border-white/10">장</th>
                <th className="px-5 py-5 text-center font-semibold text-white text-sm tracking-widest last:rounded-tr-2xl">작업</th>
              </tr>
            </thead>
            <Droppable droppableId="sites-droppable">
              {(provided) => (
            <tbody ref={provided.innerRef} {...provided.droppableProps}>
              {filteredSites.length === 0 ? (
                <tr>
                  <td colSpan="13" className="px-4 py-8 text-center text-gray-500 dark:text-white">
                    {selectedIdentity ? '사이트가 없습니다. 새 사이트를 추가해보세요!' : '유저를 선택해주세요'}
                  </td>
                </tr>
              ) : (
                paginatedSites.map((site, index) => {
                  const renderEditableCell = (field, value, className = '') => {
                    const isEditing = editingCell?.siteId === site.id && editingCell?.field === field;
                    
                    if (isEditing) {
                      // site_name 필드는 자동완성 지원
                      if (field === 'site_name') {
                        return (
                          <div className="relative">
                            <input
                              type="text"
                              value={editingValue}
                              onChange={(e) => {
                                const newValue = e.target.value;
                                setEditingValue(newValue);
                                // 자동완성 필터링
                                if (newValue.trim().length > 0) {
                                  const filtered = allSiteNames.filter(name =>
                                    name.toLowerCase().includes(newValue.toLowerCase())
                                  );
                                  setSiteNameSuggestions(filtered.slice(0, 10));
                                  setShowSuggestions(filtered.length > 0);
                                } else {
                                  setSiteNameSuggestions([]);
                                  setShowSuggestions(false);
                                }
                              }}
                              onBlur={() => {
                                setTimeout(() => {
                                  setShowSuggestions(false);
                                  saveEditingCell();
                                }, 200);
                              }}
                              onKeyDown={handleCellKeyDown}
                              autoFocus
                              autoComplete="off"
                              className={`w-full px-2 py-1 border border-blue-500 rounded focus:outline-none focus:ring-2 focus:ring-blue-500 font-bold dark:bg-[#282C34] dark:text-white dark:border-blue-400 ${className}`}
                            />
                            {/* 인라인 자동완성 드롭다운 */}
                            {showSuggestions && siteNameSuggestions.length > 0 && (
                              <div className="absolute z-[100] w-64 mt-1 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md shadow-lg max-h-48 overflow-y-auto">
                                <div className="px-3 py-1 text-xs text-gray-500 dark:text-gray-400 border-b border-gray-200 dark:border-gray-600">
                                  기존 사이트명 (클릭하여 선택)
                                </div>
                                {siteNameSuggestions.map((name, idx) => (
                                  <div
                                    key={idx}
                                    className="px-3 py-2 cursor-pointer hover:bg-blue-50 dark:hover:bg-blue-900/30 text-gray-800 dark:text-gray-200"
                                    onMouseDown={(e) => {
                                      e.preventDefault();
                                      setEditingValue(name);
                                      setShowSuggestions(false);
                                      setSiteNameSuggestions([]);
                                    }}
                                  >
                                    {name}
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        );
                      }
                      
                      return (
                        <input
                          type="text"
                          value={editingValue}
                          onChange={(e) => setEditingValue(e.target.value)}
                          onBlur={saveEditingCell}
                          onKeyDown={handleCellKeyDown}
                          autoFocus
                          className={`w-full px-2 py-1 border border-blue-500 rounded focus:outline-none focus:ring-2 focus:ring-blue-500 font-bold dark:bg-[#282C34] dark:text-white dark:border-blue-400 ${className}`}
                        />
                      );
                    }
                    
                    // 도메인 필드는 일반 텍스트로 표시
                    if (field === 'domain') {
                      return (
                        <div
                          onDoubleClick={async (e) => {
                            e.stopPropagation();
                            await startEditingCell(site.id, field, value);
                          }}
                          className="cursor-pointer hover:bg-blue-50 dark:hover:bg-gray-700 px-2 py-1 rounded text-center font-medium text-gray-900 dark:text-white"
                          title="더블클릭하여 수정"
                        >
                          {value || '-'}
                        </div>
                      );
                    }
                    
                    // 경로-코드 필드에 '@' 문자가 있으면 파란색으로 표시
                    if (field === 'referral_path' && value && value.includes('@')) {
                    return (
                      <div
                        onClick={async () => await startEditingCell(site.id, field, value)}
                          className="cursor-pointer hover:bg-blue-50 dark:hover:bg-gray-700 px-2 py-1 rounded text-center text-blue-600 dark:text-blue-400 font-bold"
                          title="클릭하여 수정"
                        >
                          {value}
                        </div>
                      );
                    }
                    
                    return (
                      <div
                        onClick={async () => await startEditingCell(site.id, field, value)}
                        className={`cursor-pointer hover:bg-blue-50 dark:hover:bg-gray-700 px-2 py-1 rounded text-center font-bold text-gray-900 dark:text-white ${className}`}
                        title="클릭하여 수정"
                      >
                        {value || <span className="text-gray-400 dark:text-gray-500">-</span>}
                      </div>
                    );
                  };

                  const renderStatusCell = () => {
                    const isEditing = editingCell?.siteId === site.id && editingCell?.field === 'status';
                    
                    if (isEditing) {
                      // 우클릭으로 시작된 경우만 input 표시
                      if (isManualInputMode) {
                        // 수동입력 값을 site.status에서 추출
                        const manualMatch = site.status?.match(/^\d{1,2}\.\d{1,2}\s*수동입력\s+(.+)$/);
                        const initialValue = manualMatch ? manualMatch[1] : '';
                        
                        // useState로 관리할 수 없는 상황이므로 onChange에서 추적
                        let currentValue = initialValue;
                        
                        return (
                          <div className="flex gap-2 items-center">
                            <input
                              type="text"
                              defaultValue={initialValue}
                              onChange={(e) => {
                                currentValue = e.target.value;
                              }}
                              onBlur={async () => {
                                // input의 현재 값을 사용하여 저장
                                const inputText = currentValue || '';
                                
                                // 기존 값을 추출하여 비교
                                const existingMatch = site.status?.match(/^\d{1,2}\.\d{1,2}\s*수동입력\s+(.+)$/);
                                const existingText = existingMatch ? existingMatch[1] : '';
                                
                                // 변경사항이 있는 경우만 저장
                                if (inputText !== existingText) {
                                  // 새로운 값 계산
                                  const now = new Date();
                                  const month = String(now.getMonth() + 1).padStart(2, '0');
                                  const day = String(now.getDate()).padStart(2, '0');
                                  const datePrefix = `${month}.${day}`;
                                  // 수동입력 텍스트 없이 저장 (수동입력 여부는 유효한 상태 목록으로 판단)
                                  const newValue = inputText ? `${datePrefix} ${inputText}` : `${datePrefix}`;
                                  
                                  // 기존 상태가 있으면 슬래시로 구분하여 추가 (앞뒤 공백 포함)
                                  let finalValue = newValue;
                                  if (site.status && site.status.trim()) {
                                    // 기존 상태의 슬래시 앞뒤 공백 정규화 (슬래시 앞뒤에 공백 없으면 추가)
                                    let normalizedStatus = site.status.trim();
                                    normalizedStatus = normalizedStatus.replace(/\s*\/\s*/g, ' / ');
                                    
                                    // 기존 상태가 이미 새 상태값을 포함하고 있는지 확인
                                    const statusParts = normalizedStatus.split('/').map(s => s.trim());
                                    const isAlreadyExists = statusParts.some(part => {
                                      const partWithoutDate = part.replace(/^\d{1,2}\.\d{1,2}\s*/, '').trim();
                                      // 수동입력 텍스트 제거 (DB에는 저장되지 않지만 기존 데이터에 있을 수 있음)
                                      const purePart = partWithoutDate.replace(/^수동입력\s+/, '').trim();
                                      const pureNewValue = inputText ? inputText : '';
                                      return purePart === pureNewValue;
                                    });
                                    
                                    // "가입전"에서 "대기"로 변경하는 경우 "가입전" 이력 자동 삭제
                                    if (inputText === '대기') {
                                      const filteredParts = statusParts.filter(part => {
                                        const partWithoutDate = part.replace(/^\d{1,2}\.\d{1,2}\s*/, '').trim();
                                        const purePart = partWithoutDate.replace(/^수동입력\s+/, '').trim();
                                        return purePart !== '가입전';
                                      });
                                      
                                      if (filteredParts.length > 0) {
                                        // "가입전"을 제외한 기존 이력이 있으면 그 뒤에 "대기" 추가
                                        normalizedStatus = filteredParts.join(' / ');
                                        if (!isAlreadyExists) {
                                          finalValue = `${normalizedStatus} / ${newValue}`;
                                        } else {
                                          finalValue = normalizedStatus;
                                        }
                                      } else {
                                        // "가입전"만 있었다면 "대기"만 저장
                                        finalValue = newValue;
                                      }
                                    } else if (!isAlreadyExists) {
                                      finalValue = `${normalizedStatus} / ${newValue}`;
                                    } else {
                                      // 이미 존재하면 기존 상태 유지 (정규화된 상태)
                                      finalValue = normalizedStatus;
                                    }
                                  }
                                  
                                  try {
                                    await axiosInstance.put(`/sites/${site.id}`, {
                                      ...site,
                                      status: finalValue
                                    });
                                    toast.success('수정되었습니다');
                                    loadSites(selectedIdentity.id);
                                  } catch (error) {
                                    toast.error('수정 실패');
                                  }
                                }
                                
                                setEditingCell(null);
                                setEditingValue('');
                                setIsManualInputMode(false); // 수동입력 모드 비활성화
                              }}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                  e.target.blur();
                                } else if (e.key === 'Escape') {
                                  cancelEditingCell();
                                  setIsManualInputMode(false);
                                }
                              }}
                              autoFocus
                              placeholder="자유롭게 입력하세요"
                              className="w-full px-2 py-1 border border-blue-500 rounded focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-[#282C34] dark:text-white dark:border-blue-400"
                            />
                          </div>
                        );
                      }
                      
                      // isManualInputMode가 false이면 셀렉트박스/일반 input으로 처리
                      // 모든 날짜 제거한 순수 상태값 추출 (날짜가 여러 개 있을 수 있음)
                      let pureStatus = editingValue?.replace(/\d{1,2}\.\d{1,2}\s*/g, '').trim();
                      
                      // 수동입력 텍스트 제거 (DB에는 저장되지 않지만 기존 데이터에 있을 수 있음)
                      pureStatus = pureStatus?.replace(/^수동입력\s+/, '').trim();
                      
                      // 입력 필드 렌더링 (셀렉트박스 + 자유 입력)
                      // 정렬 순서에 맞춘 옵션 리스트: 가입전 > 대기 > 승인 > 장점검 > 수동입력 > 팅 > 졸업
                      const validOptions = ['가입전', '대기', '승인', '장점검', '팅', '졸업'];
                      const isInValidOptions = validOptions.includes(pureStatus);
                      
                      // site.status에서 기존 값을 추출하여 선택 목록에 추가
                      let currentDisplayValue = pureStatus || '';
                      let optionsList = [...validOptions];
                      
                      // site.status에서 마지막 수동입력 값 추출
                      if (site.status?.includes('수동입력')) {
                        const parts = site.status.split('/');
                        const lastPart = parts[parts.length - 1];
                        const manualMatch = lastPart?.match(/^\d{1,2}\.\d{1,2}\s*수동입력\s+(.+)$/);
                        const manualText = manualMatch ? manualMatch[1] : '';
                        if (manualText && !optionsList.includes(manualText)) {
                          optionsList.push(manualText);
                        }
                      }
                      
                      // 기존 상태에서 모든 순수 상태값 추출하여 옵션에 추가
                      if (site.status) {
                        const statusParts = site.status.split('/').map(s => s.trim());
                        statusParts.forEach(part => {
                          let partPure = part.replace(/\d{1,2}\.\d{1,2}\s*/g, '').trim();
                          partPure = partPure.replace(/^수동입력\s+/, '').trim();
                          if (partPure && !optionsList.includes(partPure)) {
                            optionsList.push(partPure);
                          }
                        });
                      }
                      
                      // 전체 이력 목록 (삭제용)
                      const statusHistory = site.status ? site.status.split('/').map(s => s.trim()).filter(s => s) : [];
                      
                      // 기존 상태에서 날짜 추출 (없으면 오늘 날짜)
                      const extractDateFromStatus = (status) => {
                        if (!status) {
                          // 한국 시간 기준 오늘 날짜
                          const now = new Date();
                          const kstDate = new Date(now.toLocaleString('en-US', {timeZone: 'Asia/Seoul'}));
                          const month = String(kstDate.getMonth() + 1).padStart(2, '0');
                          const day = String(kstDate.getDate()).padStart(2, '0');
                          return `${month}.${day}`;
                        }
                        // 상태에서 마지막 날짜 추출 (예: "12.30 승인/01.11 장점검" -> "01.11")
                        const parts = status.split('/');
                        const lastPart = parts[parts.length - 1]?.trim() || '';
                        const match = lastPart.match(/^(\d{1,2}\.\d{1,2})/);
                        if (match) {
                          return match[1];
                        }
                        // 날짜가 없으면 한국 시간 기준 오늘 날짜
                        const now = new Date();
                        const kstDate = new Date(now.toLocaleString('en-US', {timeZone: 'Asia/Seoul'}));
                        const month = String(kstDate.getMonth() + 1).padStart(2, '0');
                        const day = String(kstDate.getDate()).padStart(2, '0');
                        return `${month}.${day}`;
                      };
                      
                      // 편집 시작 시 날짜 초기화 (editingStatusDate가 없으면 오늘 한국 날짜 사용)
                      const getTodayKSTDate = () => {
                        const now = new Date();
                        const kstDate = new Date(now.toLocaleString('en-US', {timeZone: 'Asia/Seoul'}));
                        const month = String(kstDate.getMonth() + 1).padStart(2, '0');
                        const day = String(kstDate.getDate()).padStart(2, '0');
                        return `${month}.${day}`;
                      };
                      
                      // editingStatusDate가 없으면 오늘 한국 날짜를 기본값으로 사용
                      const initialDate = editingStatusDate !== '' ? editingStatusDate : getTodayKSTDate();
                      
                      // 편집 시작 시 editingStatusDate 초기화는 useEffect에서 처리하지 않고
                      // value에서 editingStatusDate || initialDate로 처리
                      
                      // 유효한 상태 옵션
                      const statusOptions = ['가입전', '대기', '승인', '장점검', '팅', '졸업'];
                      
                      // 편집 모드 완전 종료 함수
                      const closeStatusEditor = () => {
                        setEditingCell(null);
                        setEditingValue('');
                        setEditingStatusDate('');
                        setEditingHistoryIndex(null);
                        setEditingHistoryDate('');
                        setEditingHistoryStatus('');
                        setIsManualInputMode(false);
                      };
                      
                      return (
                        <div className="space-y-2 min-w-[280px]">
                          {/* 헤더 */}
                          <div className="flex items-center justify-between border-b border-gray-200 dark:border-gray-600 pb-2">
                            <span className="font-bold text-sm text-gray-700 dark:text-gray-200">📋 승인유무 편집</span>
                            <button
                              type="button"
                              onClick={closeStatusEditor}
                              className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 text-lg font-bold"
                              title="닫기"
                            >
                              ✕
                            </button>
                          </div>
                          
                          {/* 기존 이력 목록 */}
                          {statusHistory.length > 0 && (
                            <div className="space-y-1">
                              <div className="text-xs font-semibold text-gray-500 dark:text-gray-400">기존 이력:</div>
                              {statusHistory.map((historyItem, idx) => {
                                const dateMatch = historyItem.match(/^(\d{1,2}\.\d{1,2})\s*(.*)$/);
                                const itemDate = dateMatch ? dateMatch[1] : '';
                                const itemStatus = dateMatch ? dateMatch[2].trim() : historyItem.trim();
                                const isEditingThis = editingHistoryIndex === idx;
                                
                                if (isEditingThis) {
                                  return (
                                    <div key={idx} className="flex items-center gap-1 bg-blue-50 dark:bg-blue-900/30 p-2 rounded border-2 border-blue-500">
                                      <input
                                        type="text"
                                        value={editingHistoryDate}
                                        onChange={(e) => setEditingHistoryDate(e.target.value)}
                                        placeholder="MM.DD"
                                        className="w-16 px-2 py-1 text-sm border border-blue-400 rounded dark:bg-gray-700 dark:text-white focus:ring-2 focus:ring-blue-500"
                                        autoFocus
                                      />
                                      <select
                                        value={statusOptions.includes(editingHistoryStatus) ? editingHistoryStatus : ''}
                                        onChange={(e) => setEditingHistoryStatus(e.target.value)}
                                        className="flex-1 px-2 py-1 text-sm border border-blue-400 rounded dark:bg-gray-700 dark:text-white"
                                      >
                                        <option value="">직접입력</option>
                                        {statusOptions.map(opt => (
                                          <option key={opt} value={opt}>{opt}</option>
                                        ))}
                                      </select>
                                      {!statusOptions.includes(editingHistoryStatus) && (
                                        <input
                                          type="text"
                                          value={editingHistoryStatus}
                                          onChange={(e) => setEditingHistoryStatus(e.target.value)}
                                          placeholder="상태"
                                          className="w-20 px-2 py-1 text-sm border border-blue-400 rounded dark:bg-gray-700 dark:text-white"
                                        />
                                      )}
                                      <button
                                        type="button"
                                        onClick={async (e) => {
                                          e.stopPropagation();
                                          const datePattern = /^(\d{1,2})\.(\d{1,2})$/;
                                          if (editingHistoryDate && !datePattern.test(editingHistoryDate)) {
                                            toast.error('날짜 형식: MM.DD (예: 01.23)');
                                            return;
                                          }
                                          
                                          const newHistoryItem = editingHistoryDate 
                                            ? `${editingHistoryDate} ${editingHistoryStatus}`.trim()
                                            : editingHistoryStatus.trim();
                                          
                                          const newHistory = [...statusHistory];
                                          newHistory[idx] = newHistoryItem;
                                          const newStatus = newHistory.join(' / ');
                                          
                                          try {
                                            await axiosInstance.put(`/sites/${site.id}`, {
                                              ...site,
                                              status: newStatus
                                            });
                                            toast.success('수정 완료');
                                            closeStatusEditor();
                                            await loadSites(selectedIdentity.id);
                                          } catch (error) {
                                            toast.error('수정 실패');
                                          }
                                        }}
                                        className="px-2 py-1 bg-green-500 hover:bg-green-600 text-white rounded text-sm font-bold"
                                      >
                                        ✓
                                      </button>
                                      <button
                                        type="button"
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          setEditingHistoryIndex(null);
                                          setEditingHistoryDate('');
                                          setEditingHistoryStatus('');
                                        }}
                                        className="px-2 py-1 bg-gray-400 hover:bg-gray-500 text-white rounded text-sm font-bold"
                                      >
                                        취소
                                      </button>
                                    </div>
                                  );
                                }
                                
                                return (
                                  <div
                                    key={idx}
                                    className="flex items-center justify-between bg-white dark:bg-gray-600 px-3 py-2 rounded border border-gray-200 dark:border-gray-500 hover:border-blue-400 dark:hover:border-blue-400 cursor-pointer group transition-colors"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setEditingHistoryIndex(idx);
                                      setEditingHistoryDate(itemDate);
                                      setEditingHistoryStatus(itemStatus);
                                    }}
                                    title="클릭하여 편집"
                                  >
                                    <span className="text-sm font-medium text-gray-700 dark:text-gray-200">{historyItem}</span>
                                    <button
                                      type="button"
                                      onMouseDown={(e) => { e.stopPropagation(); e.preventDefault(); }}
                                      onClick={async (e) => {
                                        e.stopPropagation();
                                        e.preventDefault();
                                        
                                        const newHistory = statusHistory.filter((_, i) => i !== idx);
                                        const newStatus = newHistory.join(' / ');
                                        
                                        try {
                                          await axiosInstance.put(`/sites/${site.id}`, {
                                            ...site,
                                            status: newStatus || ''
                                          });
                                          toast.success('삭제 완료');
                                          closeStatusEditor();
                                          await loadSites(selectedIdentity.id);
                                        } catch (error) {
                                          toast.error('삭제 실패');
                                        }
                                      }}
                                      className="opacity-0 group-hover:opacity-100 text-red-500 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-900/30 rounded p-1 transition-opacity"
                                      title="삭제"
                                    >
                                      🗑️
                                    </button>
                                  </div>
                                );
                              })}
                            </div>
                          )}
                          
                          {/* 구분선 */}
                          {statusHistory.length > 0 && (
                            <div className="border-t border-gray-200 dark:border-gray-600 pt-2"></div>
                          )}
                          
                          {/* 새 상태 추가 영역 */}
                          <div className="space-y-2">
                            <div className="text-xs font-semibold text-gray-500 dark:text-gray-400">새 상태 추가:</div>
                            <div className="flex items-center gap-2">
                              <input
                                type="text"
                                value={editingStatusDate || initialDate}
                                onChange={(e) => setEditingStatusDate(e.target.value)}
                                placeholder="MM.DD"
                                className="w-16 px-2 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded dark:bg-gray-700 dark:text-white focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                              />
                              <select
                                value={(() => {
                                  const currentValue = editingValue?.replace(/^\d{1,2}\.\d{1,2}\s*/, '').trim() || '';
                                  // 표준 상태값이 아니면 '수동입력'으로 표시
                                  if (currentValue && !statusOptions.includes(currentValue)) {
                                    return '수동입력';
                                  }
                                  return currentValue;
                                })()}
                                onChange={(e) => {
                                  const datePrefix = editingStatusDate || initialDate;
                                  if (e.target.value === '수동입력') {
                                    // 수동입력 선택 시 빈 값으로 설정 (사용자가 직접 입력)
                                    setEditingValue(`${datePrefix} `);
                                  } else {
                                    setEditingValue(`${datePrefix} ${e.target.value}`);
                                  }
                                }}
                                className="flex-1 px-2 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded dark:bg-gray-700 dark:text-white focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                              >
                                <option value="">상태 선택</option>
                                {statusOptions.map(opt => (
                                  <option key={opt} value={opt}>{opt}</option>
                                ))}
                                <option value="수동입력">✏️ 수동입력</option>
                              </select>
                            </div>
                            
                            {/* 수동입력 필드 */}
                            {(() => {
                              const currentValue = editingValue?.replace(/^\d{1,2}\.\d{1,2}\s*/, '').trim() || '';
                              const isManualInput = currentValue === '' || (currentValue && !statusOptions.includes(currentValue));
                              const selectedDropdown = (() => {
                                if (currentValue && !statusOptions.includes(currentValue)) return '수동입력';
                                return currentValue;
                              })();
                              
                              if (selectedDropdown === '수동입력' || isManualInput) {
                                return (
                                  <input
                                    type="text"
                                    value={currentValue}
                                    onChange={(e) => {
                                      const datePrefix = editingStatusDate || initialDate;
                                      setEditingValue(`${datePrefix} ${e.target.value}`);
                                    }}
                                    placeholder="상태를 직접 입력 (예: 강아지, 고구마)"
                                    className="w-full px-2 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded dark:bg-gray-700 dark:text-white focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                                    autoFocus
                                  />
                                );
                              }
                              return null;
                            })()}
                            
                            {/* 추가 버튼 */}
                            <button
                              type="button"
                              onClick={async () => {
                                const datePrefix = editingStatusDate || initialDate;
                                const datePattern = /^(\d{1,2})\.(\d{1,2})$/;
                                
                                if (!datePattern.test(datePrefix)) {
                                  toast.error('날짜 형식: MM.DD (예: 01.23)');
                                  return;
                                }
                                
                                const newStatusValue = editingValue?.replace(/^\d{1,2}\.\d{1,2}\s*/, '').trim();
                                if (!newStatusValue) {
                                  toast.error('상태를 선택해주세요');
                                  return;
                                }
                                
                                const newStatusWithDate = `${datePrefix} ${newStatusValue}`;
                                
                                let finalValue = newStatusWithDate;
                                if (site.status && site.status.trim()) {
                                  let normalizedStatus = site.status.trim().replace(/\s*\/\s*/g, ' / ');
                                  const statusParts = normalizedStatus.split('/').map(s => s.trim());
                                  
                                  // 중복 체크
                                  const isAlreadyExists = statusParts.some(part => {
                                    const purePart = part.replace(/^\d{1,2}\.\d{1,2}\s*/, '').trim();
                                    return purePart === newStatusValue;
                                  });
                                  
                                  // "대기" 추가 시 "가입전" 자동 제거
                                  if (newStatusValue === '대기') {
                                    const filteredParts = statusParts.filter(part => {
                                      const purePart = part.replace(/^\d{1,2}\.\d{1,2}\s*/, '').trim();
                                      return purePart !== '가입전';
                                    });
                                    normalizedStatus = filteredParts.join(' / ');
                                  }
                                  
                                  if (!isAlreadyExists) {
                                    finalValue = normalizedStatus ? `${normalizedStatus} / ${newStatusWithDate}` : newStatusWithDate;
                                  } else {
                                    toast.error('이미 존재하는 상태입니다');
                                    return;
                                  }
                                }
                                
                                try {
                                  await axiosInstance.put(`/sites/${site.id}`, {
                                    ...site,
                                    status: finalValue
                                  });
                                  toast.success('상태 추가 완료');
                                  closeStatusEditor();
                                  await loadSites(selectedIdentity.id);
                                } catch (error) {
                                  toast.error('추가 실패');
                                }
                              }}
                              className="w-full px-3 py-2 bg-blue-500 hover:bg-blue-600 text-white rounded font-medium text-sm transition-colors"
                            >
                              ➕ 상태 추가
                            </button>
                          </div>
                        </div>
                      );
                    }
                    
                    // 비편집 모드: 클릭하면 편집 모드로 전환
                    return (
                      <div
                        onClick={() => {
                          const todayDate = getTodayKSTDate();
                          setEditingStatusDate(todayDate);
                          setEditingValue('');
                          setEditingHistoryIndex(null);
                          setEditingCell({ siteId: site.id, field: 'status' });
                        }}
                        className="cursor-pointer hover:bg-blue-50 dark:hover:bg-blue-900/20 px-2 py-1 rounded text-center font-bold text-gray-900 dark:text-white transition-colors"
                        title="클릭하여 편집"
                      >
                        {site.status || '-'}
                      </div>
                    );
                  };

                  // 상태별 행 배경색 결정 (마지막 상태 기반)
                  const getRowBgColor = () => {
                    if (!site.status) return 'bg-white dark:bg-gray-800';
                    
                    // 슬래시로 구분된 마지막 상태만 사용
                    const parts = site.status.split('/').map(s => s.trim());
                    const lastPart = parts[parts.length - 1];
                    
                    // 유효한 상태 목록
                    const validStatuses = ['가입전', '대기', '승인', '장점검', '팅', '졸업'];
                    
                    // 날짜 제거한 순수 상태값 추출
                    const pureStatus = lastPart?.replace(/^\d{1,2}\.\d{1,2}\s*/, '').trim() || '';
                    
                    // 수동입력 텍스트 제거
                    const pureStatusWithoutManual = pureStatus.replace(/^수동입력\s+/, '').trim();
                    
                    // 수동입력 여부 판단: 유효한 상태 목록에 없으면 수동입력 (DB에는 "수동입력" 텍스트가 저장되지 않음)
                    const isManualInput = !validStatuses.includes(pureStatusWithoutManual);
                    
                    if (lastPart?.includes('졸업')) return 'bg-red-100 dark:bg-red-900/50';
                    if (lastPart?.includes('팅')) return 'bg-red-100 dark:bg-red-900/50';
                    if (isManualInput) return 'bg-green-100 dark:bg-green-900/50'; // 수동입력은 초록색
                    if (lastPart?.includes('장점검')) return 'bg-green-100 dark:bg-green-900/50';
                    if (lastPart?.includes('대기')) return 'bg-yellow-100 dark:bg-yellow-900/50';
                    if (lastPart?.includes('가입전')) return 'bg-purple-100 dark:bg-purple-900/50';
                    if (lastPart?.includes('승인')) return 'bg-gray-50 dark:bg-[#363B46]';
                    return 'bg-gray-50 dark:bg-[#363B46]';
                  };
                  
                  const isHighlighted = highlightedSiteId === site.id;
                  
                  return (
                    <Draggable key={site.id} draggableId={String(site.id)} index={index}>
                      {(provided, snapshot) => (
                    <tr 
                      ref={(el) => {
                        provided.innerRef(el);
                        if (el) siteRowRefs.current[site.id] = el;
                      }}
                      {...provided.draggableProps}
                      {...provided.dragHandleProps}
                      className={`group border-b border-gray-100 dark:border-gray-800/50 hover:bg-gradient-to-r hover:from-gray-50 hover:to-gray-100/50 dark:hover:from-gray-800/30 dark:hover:to-gray-800/50 hover:shadow-lg hover:shadow-gray-200/50 dark:hover:shadow-gray-900/50 transition-all duration-300 ease-out cursor-grab active:cursor-grabbing ${getRowBgColor()} ${isHighlighted ? 'bg-gradient-to-r from-yellow-50 to-amber-50 dark:from-yellow-900/30 dark:to-amber-900/30 border-l-4 border-yellow-400 dark:border-yellow-500 shadow-lg ring-2 ring-yellow-200 dark:ring-yellow-800' : ''} ${snapshot.isDragging ? 'bg-gradient-to-r from-blue-50 to-indigo-50 dark:from-blue-900/40 dark:to-indigo-900/40 shadow-2xl scale-[1.02] ring-4 ring-blue-300 dark:ring-blue-700 border-l-4 border-blue-400 dark:border-blue-500' : ''}`}
                    >
                      {/* 전체 모드에서 유저명 컬럼 */}
                      {selectedIdentity?.id === 'all' && (
                        <td className="px-5 py-5 text-center border-r border-gray-100 dark:border-gray-800/30">
                          <span className="inline-flex items-center px-3 py-1.5 rounded-full bg-gradient-to-r from-purple-100 to-violet-100 dark:from-purple-900/40 dark:to-violet-900/40 text-purple-700 dark:text-purple-300 font-medium text-sm shadow-sm">
                            {site.identity_name || '-'}
                          </span>
                        </td>
                      )}
                      <td 
                        className="px-5 py-5 text-center cursor-pointer border-r border-gray-100 dark:border-gray-800/30 transition-all duration-200 group-hover:bg-blue-50/50 dark:group-hover:bg-blue-900/10"
                        onContextMenu={async (e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          await openSiteNotesEditor(site.site_name, selectedIdentity?.name || site.identity_name || '');
                        }}
                      >
                        <span className="inline-flex items-center px-3 py-1.5 rounded-lg bg-gradient-to-br from-blue-50 to-indigo-50 dark:from-blue-900/30 dark:to-indigo-900/30 text-blue-700 dark:text-blue-300 font-semibold text-base shadow-sm hover:shadow-md transition-shadow">
                          {renderEditableCell('site_name', site.site_name, 'font-bold')}
                        </span>
                      </td>
                      <td className="px-5 py-5 text-center border-r border-gray-100 dark:border-gray-800/30 text-base">{renderEditableCell('domain', site.domain, 'font-medium')}</td>
                      <td className="px-5 py-5 text-center border-r border-gray-100 dark:border-gray-800/30 text-base">{renderEditableCell('referral_path', site.referral_path, 'font-medium')}</td>
                      <td className="px-5 py-5 text-center border-r border-gray-100 dark:border-gray-800/30">
                        {editingApprovalCall?.id === site.id && editingApprovalCall?.type === 'site' ? (
                          <select
                            value={editingApprovalValue ? 'O' : 'X'}
                            onChange={(e) => {
                              const newValue = e.target.value === 'O';
                              setEditingApprovalValue(newValue);
                              saveApprovalCall(newValue);
                            }}
                            onBlur={() => setEditingApprovalCall(null)}
                            autoFocus
                            className="px-3 py-1.5 border-2 border-blue-400 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-300 font-semibold dark:bg-gray-800 dark:text-white dark:border-blue-500 transition-all"
                          >
                            <option value="X">X</option>
                            <option value="O">O</option>
                          </select>
                        ) : (
                          <div
                            onClick={() => startEditingApprovalCall(site.id, 'site', site.approval_call)}
                            className="cursor-pointer inline-flex items-center justify-center w-8 h-8 rounded-full transition-all duration-200 hover:scale-110"
                            title="클릭하여 수정"
                          >
                            {site.approval_call ? (
                              <span className="w-8 h-8 rounded-full bg-gradient-to-br from-green-400 to-emerald-500 flex items-center justify-center text-white font-bold text-sm shadow-md">✓</span>
                            ) : (
                              <span className="w-8 h-8 rounded-full bg-gradient-to-br from-red-400 to-rose-500 flex items-center justify-center text-white font-bold text-sm shadow-md">✕</span>
                            )}
                          </div>
                        )}
                      </td>
                      <td className="px-5 py-5 text-center border-r border-gray-100 dark:border-gray-800/30">
                        <span className="inline-flex items-center px-3 py-1.5 rounded-full bg-gradient-to-r from-indigo-100 to-purple-100 dark:from-indigo-900/40 dark:to-purple-900/40 text-indigo-700 dark:text-indigo-300 font-medium text-base shadow-sm">
                          {selectedIdentity?.name}
                        </span>
                      </td>
                      <td className="px-5 py-5 text-center border-r border-gray-100 dark:border-gray-800/30 text-base text-gray-800 dark:text-gray-200">{renderEditableCell('account_id', site.account_id, 'font-medium')}</td>
                      <td className="px-5 py-5 text-center border-r border-gray-100 dark:border-gray-800/30 text-base text-gray-800 dark:text-gray-200">{renderEditableCell('password', site.password, 'font-medium')}</td>
                      <td className="px-5 py-5 text-center border-r border-gray-100 dark:border-gray-800/30 text-base text-gray-800 dark:text-gray-200">{renderEditableCell('exchange_password', site.exchange_password, 'font-medium')}</td>
                      <td className="px-5 py-5 text-center border-r border-gray-100 dark:border-gray-800/30 text-base text-gray-800 dark:text-gray-200">{renderEditableCell('nickname', site.nickname, 'font-medium')}</td>
                      <td className="px-5 py-5 text-center border-r border-gray-100 dark:border-gray-800/30 text-base">{renderStatusCell()}</td>
                      <td className="px-5 py-5 text-center border-r border-gray-100 dark:border-gray-800/30 text-base text-gray-700 dark:text-gray-300">{renderEditableCell('referral_code', site.referral_code, 'font-medium')}</td>
                      <td className="px-5 py-5 text-center border-r border-gray-100 dark:border-gray-800/30 text-base text-gray-700 dark:text-gray-300">{renderEditableCell('category', site.category, 'font-medium')}</td>
                      <td className="px-5 py-5 text-center whitespace-nowrap">
                        <div className="flex items-center justify-center gap-2">
                          <button
                            onClick={() => copySiteSummary(site)}
                            className="px-4 py-2 bg-gradient-to-r from-amber-400 to-orange-500 hover:from-amber-500 hover:to-orange-600 text-white rounded-lg font-medium text-sm shadow-md hover:shadow-lg transition-all duration-200 hover:scale-105 active:scale-95"
                            title="박기효 곡성20 사촌7788 777777 얼굴로는1등 12.03 가입전 / 12.23대기 빠른티비 프리카지노 같은 형식으로 복사"
                          >
                            📋
                          </button>
                          <button
                            onClick={() => openSiteModal(site)}
                            className="px-4 py-2 bg-gradient-to-r from-blue-500 to-indigo-600 hover:from-blue-600 hover:to-indigo-700 text-white rounded-lg font-medium text-sm shadow-md hover:shadow-lg transition-all duration-200 hover:scale-105 active:scale-95"
                          >
                            ✏️
                          </button>
                          <button
                            onClick={() => deleteSite(site)}
                            className="px-4 py-2 bg-gradient-to-r from-red-500 to-rose-600 hover:from-red-600 hover:to-rose-700 text-white rounded-lg font-medium text-sm shadow-md hover:shadow-lg transition-all duration-200 hover:scale-105 active:scale-95"
                          >
                            🗑️
                          </button>
                        </div>
                      </td>
                    </tr>
                      )}
                    </Draggable>
                  );
                })
              )}
              {provided.placeholder}
            </tbody>
              )}
            </Droppable>
          </table>
        </div>
        </DragDropContext>
        
        {/* 페이징 UI */}
        {totalPages > 1 && (
          <div className="px-6 py-4 border-t border-gray-200 dark:border-gray-700 flex items-center justify-between">
            <div className="text-sm text-gray-600 dark:text-gray-300">
              총 {totalItems}개 중 {(currentPage - 1) * itemsPerPage + 1} - {Math.min(currentPage * itemsPerPage, totalItems)}개 표시
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setCurrentPage(1)}
                disabled={currentPage === 1}
                className="px-3 py-1 text-sm border rounded-md disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-100 dark:hover:bg-gray-700 dark:border-gray-600 dark:text-white"
              >
                처음
              </button>
              <button
                onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
                disabled={currentPage === 1}
                className="px-3 py-1 text-sm border rounded-md disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-100 dark:hover:bg-gray-700 dark:border-gray-600 dark:text-white"
              >
                이전
              </button>
              <span className="px-4 py-1 text-sm font-medium dark:text-white">
                {currentPage} / {totalPages}
              </span>
              <button
                onClick={() => setCurrentPage(prev => Math.min(totalPages, prev + 1))}
                disabled={currentPage === totalPages}
                className="px-3 py-1 text-sm border rounded-md disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-100 dark:hover:bg-gray-700 dark:border-gray-600 dark:text-white"
              >
                다음
              </button>
              <button
                onClick={() => setCurrentPage(totalPages)}
                disabled={currentPage === totalPages}
                className="px-3 py-1 text-sm border rounded-md disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-100 dark:hover:bg-gray-700 dark:border-gray-600 dark:text-white"
              >
                마지막
              </button>
            </div>
          </div>
        )}
      </div>

      {/* 커뮤니티 목록 (전체 모드에서는 숨김) - main div 안에 위치 */}
      {selectedIdentity?.id !== 'all' && (
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow dark:shadow-gray-900/50 overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700">
          <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-4">🌐 커뮤니티 목록 ({filteredCommunities.length}개)</h2>
          
          <div className="flex items-center gap-4 mb-4 flex-wrap">
            <div className="flex items-center gap-2">
              <label className="font-medium text-gray-700 dark:text-white">검색:</label>
              <input
                type="text"
                value={communitySearchTerm}
                onChange={(e) => setCommunitySearchTerm(e.target.value)}
                placeholder="사이트명, 도메인, 닉네임"
                className="border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-md px-3 py-2 w-64 focus:ring-blue-500 focus:border-blue-500"
              />
            </div>
            
            <div className="flex items-center gap-2">
              <label className="font-medium text-gray-700 dark:text-white">상태:</label>
              <select
                value={communityStatusFilter}
                onChange={(e) => setCommunityStatusFilter(e.target.value)}
                className="border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-md px-3 py-2 focus:ring-blue-500 focus:border-blue-500"
              >
                <option>전체</option>
                <option>가입전</option>
                <option>대기</option>
                <option>승인</option>
                <option>장점검</option>
                <option>수동입력</option>
                <option>팅</option>
                <option>졸업</option>
              </select>
            </div>
            
            <div className="flex items-center gap-2">
              <label className="font-medium text-gray-700 dark:text-white">월:</label>
              <select
                value={communityMonthFilter}
                onChange={(e) => setCommunityMonthFilter(e.target.value)}
                className="border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-md px-3 py-2 focus:ring-blue-500 focus:border-blue-500"
              >
                <option>전체</option>
                <option>1월</option>
                <option>2월</option>
                <option>3월</option>
                <option>4월</option>
                <option>5월</option>
                <option>6월</option>
                <option>7월</option>
                <option>8월</option>
                <option>9월</option>
                <option>10월</option>
                <option>11월</option>
                <option>12월</option>
              </select>
            </div>
          </div>

          <div className="flex items-center gap-3 flex-wrap">
            <button
              onClick={() => {
                setEditingCommunity(null);
                setCommunityForm({
                  site_name: '',
                  domain: '',
                  referral_path: '',
                  approval_call: false,
                  identity_name: selectedIdentity?.name || '',
                  account_id: '',
                  password: '',
                  exchange_password: '',
                  nickname: '',
                  status: '가입전',
                  referral_code: '',
                  notes: ''
                });
                setShowCommunityModal(true);
              }}
              className="bg-green-600 text-white px-6 py-3 rounded-md hover:bg-green-700 font-bold"
            >
              🌐 새 커뮤니티 추가
            </button>
            <button
              onClick={() => {
                setBulkImportMode('communities');
                setShowBulkImportModal(true);
              }}
              disabled={!selectedIdentity}
              className="bg-blue-600 text-white px-6 py-3 rounded-md hover:bg-blue-700 font-bold disabled:bg-gray-400"
            >
              📋 엑셀 일괄 등록
            </button>
            <button
              onClick={exportCommunitiesToExcel}
              disabled={!selectedIdentity || filteredCommunities.length === 0}
              className="bg-purple-600 text-white px-6 py-3 rounded-md hover:bg-purple-700 font-bold disabled:bg-gray-400"
            >
              📤 엑셀로 복사
            </button>
            <button
              onClick={() => {
                if (selectedIdentity) {
                  setNewCommunityRow({
                    identity_name: selectedIdentity.name,
                    site_name: '',
                    domain: '',
                    referral_code: '',
                    approval_call: false,
                    name: '',
                    user_id: '',
                    password: '',
                    exchange_password: '',
                    nickname: '',
                    status: '가입전',
                    notes: ''
                  });
                } else {
                  toast.error('먼저 유저를 선택해주세요');
                }
              }}
              className="bg-teal-500 text-white px-6 py-3 rounded-md hover:bg-teal-600 font-bold"
            >
              + 행추가
            </button>
          </div>
        </div>

        <DragDropContext onDragEnd={handleCommunityDragEnd}>
        <div className="overflow-x-auto rounded-2xl shadow-2xl border border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-900/50 backdrop-blur-sm">
          <table className="min-w-[960px] w-full text-base">
            <thead>
              <tr className="bg-gradient-to-br from-blue-600 via-blue-500 to-blue-600 dark:from-slate-900 dark:via-slate-800 dark:to-slate-900">
                <th className="px-5 py-5 text-center font-semibold text-white text-sm tracking-widest border-r border-white/10 first:rounded-tl-2xl">
                  <span className="flex items-center justify-center gap-2">
                    <span className="w-1.5 h-1.5 rounded-full bg-white/60"></span>
                    출석
                  </span>
                </th>
                <th className="px-5 py-5 text-center font-semibold text-white text-sm tracking-widest border-r border-white/10">도메인</th>
                <th className="px-5 py-5 text-center font-semibold text-white text-sm tracking-widest border-r border-white/10">경로-코드</th>
                <th className="px-5 py-5 text-center font-semibold text-white text-sm tracking-widest border-r border-white/10">승전</th>
                <th className="px-5 py-5 text-center font-semibold text-white text-sm tracking-widest border-r border-white/10">성함</th>
                <th className="px-5 py-5 text-center font-semibold text-white text-sm tracking-widest border-r border-white/10">아이디</th>
                <th className="px-5 py-5 text-center font-semibold text-white text-sm tracking-widest border-r border-white/10">비번</th>
                <th className="px-5 py-5 text-center font-semibold text-white text-sm tracking-widest border-r border-white/10">환비</th>
                <th className="px-5 py-5 text-center font-semibold text-white text-sm tracking-widest border-r border-white/10">닉네임</th>
                <th className="px-5 py-5 text-center font-semibold text-white text-sm tracking-widest border-r border-white/10">승인유무</th>
                <th className="px-5 py-5 text-center font-semibold text-white text-sm tracking-widest border-r border-white/10">경로</th>
                <th className="px-5 py-5 text-center font-semibold text-white text-sm tracking-widest border-r border-white/10">장</th>
                <th className="px-5 py-5 text-center font-semibold text-white text-sm tracking-widest last:rounded-tr-2xl">작업</th>
              </tr>
            </thead>
            <Droppable droppableId="communities-droppable">
              {(provided) => (
            <tbody ref={provided.innerRef} {...provided.droppableProps}>
              {filteredCommunities.length === 0 && !newCommunityRow ? (
                <tr>
                  <td colSpan="13" className="px-4 py-8 text-center text-gray-500 dark:text-white">
                    {selectedIdentity ? '커뮤니티가 없습니다. 새 커뮤니티를 추가해보세요!' : '유저를 선택해주세요'}
                  </td>
                </tr>
              ) : (
                <>
                {/* 새 커뮤니티 행 (추가 중일 때만 표시) - 사이트 목록과 동일한 UI */}
                {newCommunityRow && (
                  <tr className="bg-green-50 dark:bg-green-900/30 border-b border-gray-200 dark:border-gray-700">
                    <td className="px-5 py-5 text-center border-r border-gray-100 dark:border-gray-800/30">
                      <input
                        type="text"
                        value={newCommunityRow.site_name || ''}
                        onChange={(e) => setNewCommunityRow({...newCommunityRow, site_name: e.target.value})}
                        className="w-full border border-gray-300 dark:border-gray-600 rounded-md px-2 py-1 text-center dark:bg-gray-700 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                        placeholder="출석"
                        autoFocus
                      />
                    </td>
                    <td className="px-5 py-5 text-center border-r border-gray-100 dark:border-gray-800/30">
                      <input
                        type="text"
                        value={newCommunityRow.domain || ''}
                        onChange={(e) => setNewCommunityRow({...newCommunityRow, domain: e.target.value})}
                        className="w-full border border-gray-300 dark:border-gray-600 rounded-md px-2 py-1 text-center dark:bg-gray-700 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                        placeholder="도메인"
                      />
                    </td>
                    <td className="px-5 py-5 text-center border-r border-gray-100 dark:border-gray-800/30">
                      <input
                        type="text"
                        value={newCommunityRow.referral_code || ''}
                        onChange={(e) => setNewCommunityRow({...newCommunityRow, referral_code: e.target.value})}
                        className="w-full border border-gray-300 dark:border-gray-600 rounded-md px-2 py-1 text-center dark:bg-gray-700 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                        placeholder="경로-코드"
                      />
                    </td>
                    <td className="px-5 py-5 text-center border-r border-gray-100 dark:border-gray-800/30">
                      <button
                        onClick={() => setNewCommunityRow({...newCommunityRow, approval_call: !newCommunityRow.approval_call})}
                        className="cursor-pointer inline-flex items-center justify-center w-8 h-8 rounded-full transition-all duration-200 hover:scale-110"
                        title="클릭하여 수정"
                      >
                        {newCommunityRow.approval_call ? (
                          <span className="w-8 h-8 rounded-full bg-gradient-to-br from-green-400 to-emerald-500 flex items-center justify-center text-white font-bold text-sm shadow-md">✓</span>
                        ) : (
                          <span className="w-8 h-8 rounded-full bg-gradient-to-br from-red-400 to-rose-500 flex items-center justify-center text-white font-bold text-sm shadow-md">✕</span>
                        )}
                      </button>
                    </td>
                    <td className="px-5 py-5 text-center border-r border-gray-100 dark:border-gray-800/30">
                      <input
                        type="text"
                        value={newCommunityRow.name || ''}
                        onChange={(e) => setNewCommunityRow({...newCommunityRow, name: e.target.value})}
                        className="w-full border border-gray-300 dark:border-gray-600 rounded-md px-2 py-1 text-center dark:bg-gray-700 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                        placeholder="성함"
                      />
                    </td>
                    <td className="px-5 py-5 text-center border-r border-gray-100 dark:border-gray-800/30">
                      <input
                        type="text"
                        value={newCommunityRow.user_id || ''}
                        onChange={(e) => setNewCommunityRow({...newCommunityRow, user_id: e.target.value})}
                        className="w-full border border-gray-300 dark:border-gray-600 rounded-md px-2 py-1 text-center dark:bg-gray-700 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                        placeholder="아이디"
                      />
                    </td>
                    <td className="px-5 py-5 text-center border-r border-gray-100 dark:border-gray-800/30">
                      <input
                        type="text"
                        value={newCommunityRow.password || ''}
                        onChange={(e) => setNewCommunityRow({...newCommunityRow, password: e.target.value})}
                        className="w-full border border-gray-300 dark:border-gray-600 rounded-md px-2 py-1 text-center dark:bg-gray-700 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                        placeholder="비번"
                      />
                    </td>
                    <td className="px-5 py-5 text-center border-r border-gray-100 dark:border-gray-800/30">
                      <input
                        type="text"
                        value={newCommunityRow.exchange_password || ''}
                        onChange={(e) => setNewCommunityRow({...newCommunityRow, exchange_password: e.target.value})}
                        className="w-full border border-gray-300 dark:border-gray-600 rounded-md px-2 py-1 text-center dark:bg-gray-700 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                        placeholder="환비"
                      />
                    </td>
                    <td className="px-5 py-5 text-center border-r border-gray-100 dark:border-gray-800/30">
                      <input
                        type="text"
                        value={newCommunityRow.nickname || ''}
                        onChange={(e) => setNewCommunityRow({...newCommunityRow, nickname: e.target.value})}
                        className="w-full border border-gray-300 dark:border-gray-600 rounded-md px-2 py-1 text-center dark:bg-gray-700 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                        placeholder="닉네임"
                      />
                    </td>
                    <td className="px-5 py-5 text-center border-r border-gray-100 dark:border-gray-800/30">
                      <select
                        value={newCommunityRow.status || '가입전'}
                        onChange={(e) => setNewCommunityRow({...newCommunityRow, status: e.target.value})}
                        className="w-full border border-gray-300 dark:border-gray-600 rounded-md px-2 py-1 text-center dark:bg-gray-700 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                      >
                        <option value="가입전">가입전</option>
                        <option value="대기">대기</option>
                        <option value="승인">승인</option>
                        <option value="장점검">장점검</option>
                        <option value="팅">팅</option>
                        <option value="졸업">졸업</option>
                      </select>
                    </td>
                    <td className="px-5 py-5 text-center border-r border-gray-100 dark:border-gray-800/30">
                      <input
                        type="text"
                        value={newCommunityRow.referral_path || ''}
                        onChange={(e) => setNewCommunityRow({...newCommunityRow, referral_path: e.target.value})}
                        className="w-full border border-gray-300 dark:border-gray-600 rounded-md px-2 py-1 text-center dark:bg-gray-700 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                        placeholder="경로"
                      />
                    </td>
                    <td className="px-5 py-5 text-center border-r border-gray-100 dark:border-gray-800/30">
                      <input
                        type="text"
                        value={newCommunityRow.notes || ''}
                        onChange={(e) => setNewCommunityRow({...newCommunityRow, notes: e.target.value})}
                        className="w-full border border-gray-300 dark:border-gray-600 rounded-md px-2 py-1 text-center dark:bg-gray-700 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                        placeholder="장"
                      />
                    </td>
                    <td className="px-5 py-5 text-center whitespace-nowrap">
                      <div className="flex items-center justify-center gap-2">
                        <button
                          onClick={async () => {
                            try {
                              const response = await axiosInstance.post('/communities', {
                                ...newCommunityRow,
                                identity_name: selectedIdentity.name
                              });
                              if (response.data.success || response.data.id) {
                                toast.success('커뮤니티가 추가되었습니다');
                                setNewCommunityRow(null);
                                await loadCommunities();
                              }
                            } catch (error) {
                              console.error('커뮤니티 추가 실패:', error);
                              console.error('에러 상세:', error.response?.data || error.message);
                              toast.error('커뮤니티 추가에 실패했습니다');
                            }
                          }}
                          className="bg-green-600 text-white px-4 py-2 rounded-md hover:bg-green-700 font-bold text-sm"
                        >
                          저장
                        </button>
                        <button
                          onClick={() => setNewCommunityRow(null)}
                          className="bg-gray-500 text-white px-4 py-2 rounded-md hover:bg-gray-600 font-bold text-sm"
                        >
                          취소
                        </button>
                      </div>
                    </td>
                  </tr>
                )}
                
                {/* 기존 커뮤니티 목록 - 이 부분은 원본 코드에서 계속됨 */}
                {filteredCommunities.map((community, index) => {
                  const renderCommunityEditableCell = (field, value, className = '') => {
                    const isEditing = editingCommunityCell?.communityId === community.id && editingCommunityCell?.field === field;
                    
                    if (isEditing) {
                      return (
                        <input
                          type="text"
                          value={editingCommunityValue}
                          onChange={(e) => setEditingCommunityValue(e.target.value)}
                          onBlur={() => {
                            if (!isDeletingHistory) {
                              saveEditingCommunityCell();
                            }
                          }}
                          onKeyDown={handleCommunityCellKeyDown}
                          className="w-full border rounded px-2 py-1 text-center dark:bg-gray-700 dark:border-gray-600 dark:text-white"
                          autoFocus
                        />
                      );
                    }
                    
                    // 도메인 필드는 일반 텍스트로 표시
                    if (field === 'domain') {
                      return (
                        <div
                          onDoubleClick={async (e) => {
                            e.stopPropagation();
                            await startEditingCommunityCell(community.id, field, value);
                          }}
                          className={`cursor-pointer hover:bg-blue-50 dark:hover:bg-gray-700 px-2 py-1 rounded text-center font-medium text-gray-900 dark:text-white ${className}`}
                          title="더블클릭하여 수정"
                        >
                          {value || '-'}
                        </div>
                      );
                    }
                    
                    // referral_code 필드는 하이퍼링크 처리
                    if (field === 'referral_code' && value) {
                      return (
                        <div
                          onClick={async () => await startEditingCommunityCell(community.id, field, value)}
                          className="cursor-pointer hover:bg-blue-50 dark:hover:bg-gray-700 px-2 py-1 rounded text-center text-blue-600 dark:text-blue-400 font-bold"
                          title="클릭하여 수정"
                        >
                          {value}
                        </div>
                      );
                    }
                    
                    return (
                      <div
                        onClick={async () => await startEditingCommunityCell(community.id, field, value)}
                        className={`cursor-pointer hover:bg-blue-50 dark:hover:bg-gray-700 px-2 py-1 rounded text-center font-bold text-gray-900 dark:text-white ${className}`}
                        title="클릭하여 수정"
                      >
                        {value || '-'}
                      </div>
                    );
                  };
                  
                  return (
                    <Draggable
                      key={community.id}
                      draggableId={`community-${community.id}`}
                      index={index}
                    >
                      {(provided, snapshot) => (
                        <tr
                          ref={(el) => {
                            provided.innerRef(el);
                            communityRowRefs.current[community.id] = el;
                          }}
                          {...provided.draggableProps}
                          {...provided.dragHandleProps}
                          className={`group border-b border-gray-100 dark:border-gray-800/50 hover:bg-gradient-to-r hover:from-gray-50 hover:to-gray-100/50 dark:hover:from-gray-800/30 dark:hover:to-gray-800/50 hover:shadow-lg hover:shadow-gray-200/50 dark:hover:shadow-gray-900/50 transition-all duration-300 ease-out cursor-grab active:cursor-grabbing ${
                            snapshot.isDragging 
                              ? 'bg-gradient-to-r from-blue-50 to-indigo-50 dark:from-blue-900/40 dark:to-indigo-900/40 shadow-2xl scale-[1.02] ring-4 ring-blue-300 dark:ring-blue-700 border-l-4 border-blue-400 dark:border-blue-500' 
                              : highlightedCommunityId === community.id 
                                ? 'bg-gradient-to-r from-yellow-50 to-amber-50 dark:from-yellow-900/30 dark:to-amber-900/30 border-l-4 border-yellow-400 dark:border-yellow-500 shadow-lg ring-2 ring-yellow-200 dark:ring-yellow-800'
                                : ''
                          }`}
                        >
                          <td 
                            className="px-5 py-5 text-center cursor-pointer border-r border-gray-100 dark:border-gray-800/30 transition-all duration-200 group-hover:bg-blue-50/50 dark:group-hover:bg-blue-900/10"
                            onContextMenu={async (e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              await openCommunityNotesEditor(community);
                            }}
                          >
                            <span className="inline-flex items-center px-3 py-1.5 rounded-lg bg-gradient-to-br from-blue-50 to-indigo-50 dark:from-blue-900/30 dark:to-indigo-900/30 text-blue-700 dark:text-blue-300 font-semibold text-base shadow-sm hover:shadow-md transition-shadow">
                              {renderCommunityEditableCell('site_name', community.site_name, 'font-bold')}
                            </span>
                          </td>
                          <td className="px-5 py-5 text-center border-r border-gray-100 dark:border-gray-800/30 text-base">{renderCommunityEditableCell('domain', community.domain, 'font-medium')}</td>
                          <td className="px-5 py-5 text-center border-r border-gray-100 dark:border-gray-800/30 text-base">{renderCommunityEditableCell('referral_code', community.referral_code, 'font-medium')}</td>
                          <td className="px-5 py-5 text-center border-r border-gray-100 dark:border-gray-800/30">
                            {editingApprovalCall?.id === community.id && editingApprovalCall?.type === 'community' ? (
                              <button
                                onClick={() => {
                                  saveApprovalCall(community.id, 'community', !editingApprovalValue);
                                }}
                                className={`inline-flex items-center justify-center w-8 h-8 rounded-full transition-all duration-200 ${
                                  editingApprovalValue
                                    ? 'bg-gradient-to-br from-green-400 to-emerald-500'
                                    : 'bg-gradient-to-br from-red-400 to-rose-500'
                                }`}
                              >
                                {editingApprovalValue ? (
                                  <span className="text-white font-bold text-sm">✓</span>
                                ) : (
                                  <span className="text-white font-bold text-sm">✕</span>
                                )}
                              </button>
                            ) : (
                              <div
                                onClick={() => startEditingApprovalCall(community.id, 'community', community.approval_call)}
                                className="cursor-pointer inline-flex items-center justify-center w-8 h-8 rounded-full transition-all duration-200 hover:scale-110"
                                title="클릭하여 수정"
                              >
                                {community.approval_call ? (
                                  <span className="w-8 h-8 rounded-full bg-gradient-to-br from-green-400 to-emerald-500 flex items-center justify-center text-white font-bold text-sm shadow-md">✓</span>
                                ) : (
                                  <span className="w-8 h-8 rounded-full bg-gradient-to-br from-red-400 to-rose-500 flex items-center justify-center text-white font-bold text-sm shadow-md">✕</span>
                                )}
                              </div>
                            )}
                          </td>
                          <td className="px-5 py-5 text-center border-r border-gray-100 dark:border-gray-800/30 text-base text-gray-800 dark:text-gray-200">{renderCommunityEditableCell('name', community.name, 'font-medium')}</td>
                          <td className="px-5 py-5 text-center border-r border-gray-100 dark:border-gray-800/30 text-base text-gray-800 dark:text-gray-200">{renderCommunityEditableCell('user_id', community.user_id, 'font-medium')}</td>
                          <td className="px-5 py-5 text-center border-r border-gray-100 dark:border-gray-800/30 text-base text-gray-800 dark:text-gray-200">{renderCommunityEditableCell('password', community.password, 'font-medium')}</td>
                          <td className="px-5 py-5 text-center border-r border-gray-100 dark:border-gray-800/30 text-base text-gray-800 dark:text-gray-200">{renderCommunityEditableCell('exchange_password', community.exchange_password, 'font-medium')}</td>
                          <td className="px-5 py-5 text-center border-r border-gray-100 dark:border-gray-800/30 text-base text-gray-800 dark:text-gray-200">{renderCommunityEditableCell('nickname', community.nickname, 'font-medium')}</td>
                          <td className="px-5 py-5 text-center border-r border-gray-100 dark:border-gray-800/30 text-base">
                            {(() => {
                              const isEditing = editingCommunityCell?.communityId === community.id && editingCommunityCell?.field === 'status';
                              
                              if (isEditing) {
                                return (
                                  <div className="relative">
                                    <input
                                      type="text"
                                      value={editingCommunityValue}
                                      onChange={(e) => setEditingCommunityValue(e.target.value)}
                                      onBlur={() => saveEditingCommunityCell()}
                                      onKeyDown={handleCommunityCellKeyDown}
                                      className="w-full border rounded px-2 py-1 text-center dark:bg-gray-700 dark:border-gray-600 dark:text-white"
                                      autoFocus
                                    />
                                    {/* 상태 이력 표시 (편집/삭제 가능) */}
                                    {Array.isArray(community.status_history) && community.status_history.length > 0 && (
                                      <div className="absolute top-full left-0 right-0 mt-1 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded shadow-lg z-10 max-h-48 overflow-y-auto">
                                        <div className="p-2 text-xs">
                                          <div className="font-bold mb-1 text-gray-700 dark:text-white">📋 이력 (클릭하여 편집):</div>
                                          {community.status_history.slice().reverse().map((history, idx) => {
                                            const actualIdx = community.status_history.length - 1 - idx;
                                            const isEditingThisHistory = editingHistoryIndex === `comm-${community.id}-${actualIdx}`;
                                            
                                            if (isEditingThisHistory) {
                                              const communityStatusOptions = ['가입전', '대기', '승인', '장점검', '팅', '졸업'];
                                              return (
                                                <div key={idx} className="flex items-center gap-1 py-1 bg-blue-50 dark:bg-blue-900/30 px-1 rounded border border-blue-400 mb-1">
                                                  <input
                                                    type="text"
                                                    value={editingHistoryDate}
                                                    onChange={(e) => setEditingHistoryDate(e.target.value)}
                                                    placeholder="MM.DD"
                                                    className="w-14 px-1 py-0.5 text-xs border border-gray-300 dark:border-gray-600 rounded dark:bg-gray-700 dark:text-white"
                                                  />
                                                  <select
                                                    value={communityStatusOptions.includes(editingHistoryStatus) ? editingHistoryStatus : ''}
                                                    onChange={(e) => setEditingHistoryStatus(e.target.value)}
                                                    className="px-1 py-0.5 text-xs border border-gray-300 dark:border-gray-600 rounded dark:bg-gray-700 dark:text-white"
                                                  >
                                                    <option value="">직접입력</option>
                                                    {communityStatusOptions.map(opt => (
                                                      <option key={opt} value={opt}>{opt}</option>
                                                    ))}
                                                  </select>
                                                  {!communityStatusOptions.includes(editingHistoryStatus) && (
                                                    <input
                                                      type="text"
                                                      value={editingHistoryStatus}
                                                      onChange={(e) => setEditingHistoryStatus(e.target.value)}
                                                      placeholder="상태"
                                                      className="w-14 px-1 py-0.5 text-xs border border-gray-300 dark:border-gray-600 rounded dark:bg-gray-700 dark:text-white"
                                                    />
                                                  )}
                                                  <button
                                                    type="button"
                                                    onClick={async (e) => {
                                                      e.stopPropagation();
                                                      const datePattern = /^(\d{1,2})\.(\d{1,2})$/;
                                                      if (editingHistoryDate && !datePattern.test(editingHistoryDate)) {
                                                        toast.error('날짜 형식: MM.DD');
                                                        return;
                                                      }
                                                      
                                                      const newHistory = [...community.status_history];
                                                      newHistory[actualIdx] = {
                                                        date: editingHistoryDate,
                                                        status: editingHistoryStatus
                                                      };
                                                      
                                                      try {
                                                        await axiosInstance.put(`/communities/${community.id}`, {
                                                          status_history: newHistory
                                                        });
                                                        toast.success('이력이 수정되었습니다');
                                                        setEditingHistoryIndex(null);
                                                        setEditingHistoryDate('');
                                                        setEditingHistoryStatus('');
                                                        await loadCommunities();
                                                      } catch (error) {
                                                        toast.error('수정 실패');
                                                      }
                                                    }}
                                                    className="text-green-600 hover:text-green-800 px-1 font-bold"
                                                  >
                                                    ✓
                                                  </button>
                                                  <button
                                                    type="button"
                                                    onClick={(e) => {
                                                      e.stopPropagation();
                                                      setEditingHistoryIndex(null);
                                                    }}
                                                    className="text-gray-500 hover:text-gray-700 px-1 font-bold"
                                                  >
                                                    ✕
                                                  </button>
                                                </div>
                                              );
                                            }
                                            
                                            return (
                                              <div 
                                                key={idx} 
                                                className="flex items-center justify-between py-0.5 border-b border-gray-100 dark:border-gray-700 last:border-0 group cursor-pointer hover:bg-blue-50 dark:hover:bg-blue-900/20 px-1 rounded"
                                                onClick={(e) => {
                                                  e.stopPropagation();
                                                  setEditingHistoryIndex(`comm-${community.id}-${actualIdx}`);
                                                  setEditingHistoryDate(history.date || '');
                                                  setEditingHistoryStatus(history.status || '');
                                                }}
                                                title="클릭하여 편집"
                                              >
                                                <span className="text-gray-600 dark:text-white">
                                                  {history.date}: {history.status}
                                                </span>
                                                <button
                                                  onMouseDown={(e) => {
                                                    e.preventDefault();
                                                    e.stopPropagation();
                                                    setIsDeletingHistory(true);
                                                  }}
                                                  onClick={async (e) => {
                                                    e.stopPropagation();
                                                    try {
                                                      const newHistory = community.status_history.filter((_, i) => i !== actualIdx);
                                                      await axiosInstance.put(`/communities/${community.id}`, {
                                                        status_history: newHistory
                                                      });
                                                      toast.success('이력이 삭제되었습니다');
                                                      await loadCommunities();
                                                    } catch (error) {
                                                      console.error('[커뮤니티 이력 삭제] 삭제 실패:', error);
                                                      toast.error('이력 삭제에 실패했습니다');
                                                    } finally {
                                                      setIsDeletingHistory(false);
                                                    }
                                                  }}
                                                  className="opacity-0 group-hover:opacity-100 text-red-500 hover:text-red-700 ml-2 transition-opacity"
                                                  title="이력 삭제"
                                                >
                                                  ✕
                                                </button>
                                              </div>
                                            );
                                          })}
                                        </div>
                                      </div>
                                    )}
                                  </div>
                                );
                              }
                              
                              return (
                                <div
                                  onClick={async () => {
                                    setIsManualInputMode(false);
                                    
                                    const currentStatus = community.status;
                                    const pureStatus = currentStatus ? currentStatus.replace(/^\d{1,2}\.\d{1,2}\s*/, '').replace(/\s*수동입력$/, '') : '';
                                    const statusOrder = ['가입전', '대기', '승인', '장점검', '팅', '졸업'];
                                    const currentIndex = statusOrder.indexOf(pureStatus);
                                    
                                    const now = new Date();
                                    const month = String(now.getMonth() + 1).padStart(2, '0');
                                    const day = String(now.getDate()).padStart(2, '0');
                                    const datePrefix = `${month}.${day}`;
                                    
                                    let nextStatus;
                                    if (currentIndex === -1 || currentIndex === statusOrder.length - 1) {
                                      nextStatus = statusOrder[0];
                                    } else {
                                      nextStatus = statusOrder[currentIndex + 1];
                                      if (nextStatus !== '가입전' && nextStatus !== '대기') {
                                        nextStatus = `${datePrefix} ${nextStatus}`;
                                      }
                                    }
                                    
                                    try {
                                      await axiosInstance.put(`/communities/${community.id}`, {
                                        ...community,
                                        status: nextStatus
                                      });
                                      toast.success('상태가 변경되었습니다');
                                      loadCommunities();
                                    } catch (error) {
                                      console.error('상태 변경 실패:', error);
                                      toast.error('상태 변경에 실패했습니다');
                                    }
                                  }}
                                  onDoubleClick={async () => {
                                    setIsManualInputMode(true);
                                    await startEditingCommunityCell(community.id, 'status', community.status);
                                  }}
                                  className="cursor-pointer hover:bg-blue-50 dark:hover:bg-gray-700 px-2 py-1 rounded text-center font-bold text-gray-900 dark:text-white"
                                  title="클릭: 상태 순환, 더블클릭: 수동 입력"
                                >
                                  {community.status || '-'}
                                </div>
                              );
                            })()}
                          </td>
                          <td className="px-5 py-5 text-center border-r border-gray-100 dark:border-gray-800/30 text-base text-gray-700 dark:text-gray-300">{renderCommunityEditableCell('path', community.path, 'font-medium')}</td>
                          <td className="px-5 py-5 text-center border-r border-gray-100 dark:border-gray-800/30 text-base text-gray-700 dark:text-gray-300">{renderCommunityEditableCell('category', community.category, 'font-medium')}</td>
                          <td className="px-5 py-5 text-center whitespace-nowrap">
                            <div className="flex items-center justify-center gap-2">
                              <button
                                onClick={() => copyCommunitySummary(community)}
                                className="px-4 py-2 bg-gradient-to-r from-amber-400 to-orange-500 hover:from-amber-500 hover:to-orange-600 text-white rounded-lg font-medium text-sm shadow-md hover:shadow-lg transition-all duration-200 hover:scale-105 active:scale-95"
                                title="커뮤니티 정보 복사"
                              >
                                📋
                              </button>
                              <button
                                onClick={() => openEditCommunity(community)}
                                className="px-4 py-2 bg-gradient-to-r from-blue-500 to-indigo-600 hover:from-blue-600 hover:to-indigo-700 text-white rounded-lg font-medium text-sm shadow-md hover:shadow-lg transition-all duration-200 hover:scale-105 active:scale-95"
                              >
                                ✏️
                              </button>
                              <button
                                onClick={() => deleteCommunity(community)}
                                className="px-4 py-2 bg-gradient-to-r from-red-500 to-rose-600 hover:from-red-600 hover:to-rose-700 text-white rounded-lg font-medium text-sm shadow-md hover:shadow-lg transition-all duration-200 hover:scale-105 active:scale-95"
                              >
                                🗑️
                              </button>
                            </div>
                          </td>
                        </tr>
                      )}
                    </Draggable>
                  );
                })}
                </>
              )}
              {provided.placeholder}
            </tbody>
              )}
            </Droppable>
          </table>
        </div>
        </DragDropContext>
      </div>
      )}
    </div>

      {/* 유저 추가/수정 모달 - transform div 밖에 렌더링 */}
      {showIdentityModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white dark:bg-gray-800 rounded-lg p-6 w-full max-w-2xl max-h-[90vh] overflow-y-auto">
            <h3 className="text-xl font-bold mb-4 text-gray-900 dark:text-white">
              {editingIdentity ? '✏️ 유저 수정' : '➕ 새 유저 추가'}
            </h3>
            
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-bold text-gray-700 dark:text-white mb-1">이름 *</label>
                  <input
                    type="text"
                    value={identityForm.name}
                    onChange={(e) => setIdentityForm({...identityForm, name: e.target.value})}
                    className="w-full border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-md px-3 py-2"
                    placeholder="홍길동"
                    required
                  />
                </div>
                
                <div>
                  <label className="block text-sm font-bold text-gray-700 dark:text-white mb-1">생년월일 *</label>
                  <input
                    type="text"
                    value={identityForm.birth_date}
                    onChange={(e) => {
                      const newBirthDate = e.target.value;
                      // 띠 자동 계산
                      const calculatedZodiac = calculateZodiac(newBirthDate);
                      setIdentityForm({
                        ...identityForm, 
                        birth_date: newBirthDate,
                        zodiac: calculatedZodiac
                      });
                    }}
                    placeholder="1990-01-01"
                    className="w-full border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-md px-3 py-2"
                    required
                  />
                  {identityForm.zodiac && (
                    <div className="mt-2 text-sm text-blue-600 dark:text-blue-400 font-bold">
                      🎯 띠: {identityForm.zodiac}띠
                    </div>
                  )}
                </div>
              </div>
              
              {/* 은행 계좌 관리 */}
              <div className="border-t pt-4">
                <div className="flex items-center justify-between mb-2">
                  <label className="block text-sm font-bold text-gray-700 dark:text-white">💳 은행 계좌</label>
                  <button
                    onClick={() => {
                      const newAccounts = [...(identityForm.bank_accounts || []), { bank: '', account_number: '', holder: identityForm.name }];
                      setIdentityForm({...identityForm, bank_accounts: newAccounts});
                    }}
                    className="text-xs bg-green-500 text-white px-3 py-1 rounded hover:bg-green-600"
                  >
                    ➕ 계좌 추가
                  </button>
                </div>
                {identityForm.bank_accounts?.length > 0 ? (
                  <div className="space-y-2">
                    {identityForm.bank_accounts.map((account, index) => (
                      <div key={index} className="flex gap-2 items-start bg-gray-50 dark:bg-gray-700 p-2 rounded">
                        <div className="flex flex-col gap-1">
                          <button
                            onClick={() => {
                              if (index > 0) {
                                const newAccounts = [...identityForm.bank_accounts];
                                [newAccounts[index - 1], newAccounts[index]] = [newAccounts[index], newAccounts[index - 1]];
                                setIdentityForm({...identityForm, bank_accounts: newAccounts});
                              }
                            }}
                            disabled={index === 0}
                            className="text-blue-500 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 px-1 disabled:opacity-30 disabled:cursor-not-allowed"
                            title="위로 이동"
                          >
                            ⬆️
                          </button>
                          <button
                            onClick={() => {
                              if (index < identityForm.bank_accounts.length - 1) {
                                const newAccounts = [...identityForm.bank_accounts];
                                [newAccounts[index], newAccounts[index + 1]] = [newAccounts[index + 1], newAccounts[index]];
                                setIdentityForm({...identityForm, bank_accounts: newAccounts});
                              }
                            }}
                            disabled={index === identityForm.bank_accounts.length - 1}
                            className="text-blue-500 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 px-1 disabled:opacity-30 disabled:cursor-not-allowed"
                            title="아래로 이동"
                          >
                            ⬇️
                          </button>
                        </div>
                        <input
                          type="text"
                          value={account.bank || ''}
                          onChange={(e) => {
                            const newAccounts = [...identityForm.bank_accounts];
                            newAccounts[index].bank = e.target.value;
                            setIdentityForm({...identityForm, bank_accounts: newAccounts});
                          }}
                          placeholder="은행명"
                          className="flex-1 border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded px-2 py-1 text-sm"
                        />
                        <input
                          type="text"
                          value={account.account_number || ''}
                          onChange={(e) => {
                            const newAccounts = [...identityForm.bank_accounts];
                            newAccounts[index].account_number = e.target.value;
                            setIdentityForm({...identityForm, bank_accounts: newAccounts});
                          }}
                          placeholder="계좌번호"
                          className="flex-1 border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded px-2 py-1 text-sm"
                        />
                        <input
                          type="text"
                          value={account.holder || ''}
                          onChange={(e) => {
                            const newAccounts = [...identityForm.bank_accounts];
                            newAccounts[index].holder = e.target.value;
                            setIdentityForm({...identityForm, bank_accounts: newAccounts});
                          }}
                          placeholder="예금주"
                          className="flex-1 border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded px-2 py-1 text-sm"
                        />
                        <button
                          onClick={() => {
                            const newAccounts = identityForm.bank_accounts.filter((_, i) => i !== index);
                            setIdentityForm({...identityForm, bank_accounts: newAccounts});
                          }}
                          className="text-red-500 dark:text-red-400 hover:text-red-700 dark:hover:text-red-300 px-2"
                        >
                          🗑️
                        </button>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-gray-500 dark:text-gray-400 text-center py-2">등록된 계좌가 없습니다</p>
                )}
              </div>
              
              {/* 전화번호 관리 */}
              <div className="border-t pt-4">
                <div className="flex items-center justify-between mb-2">
                  <label className="block text-sm font-bold text-gray-700 dark:text-white">📱 전화번호</label>
                  <button
                    onClick={() => {
                      const newPhones = [...(identityForm.phone_numbers || []), { number: '', carrier: '' }];
                      setIdentityForm({...identityForm, phone_numbers: newPhones});
                    }}
                    className="text-xs bg-green-500 text-white px-3 py-1 rounded hover:bg-green-600"
                  >
                    ➕ 번호 추가
                  </button>
                </div>
                {identityForm.phone_numbers?.length > 0 ? (
                  <div className="space-y-2">
                    {identityForm.phone_numbers.map((phone, index) => (
                      <div key={index} className="flex gap-2 items-start bg-gray-50 dark:bg-gray-700 p-2 rounded">
                        <div className="flex flex-col gap-1">
                          <button
                            onClick={() => {
                              if (index > 0) {
                                const newPhones = [...identityForm.phone_numbers];
                                [newPhones[index - 1], newPhones[index]] = [newPhones[index], newPhones[index - 1]];
                                setIdentityForm({...identityForm, phone_numbers: newPhones});
                              }
                            }}
                            disabled={index === 0}
                            className="text-blue-500 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 px-1 disabled:opacity-30 disabled:cursor-not-allowed"
                            title="위로 이동"
                          >
                            ⬆️
                          </button>
                          <button
                            onClick={() => {
                              if (index < identityForm.phone_numbers.length - 1) {
                                const newPhones = [...identityForm.phone_numbers];
                                [newPhones[index], newPhones[index + 1]] = [newPhones[index + 1], newPhones[index]];
                                setIdentityForm({...identityForm, phone_numbers: newPhones});
                              }
                            }}
                            disabled={index === identityForm.phone_numbers.length - 1}
                            className="text-blue-500 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 px-1 disabled:opacity-30 disabled:cursor-not-allowed"
                            title="아래로 이동"
                          >
                            ⬇️
                          </button>
                        </div>
                        <input
                          type="text"
                          value={phone.number || ''}
                          onChange={(e) => {
                            const newPhones = [...identityForm.phone_numbers];
                            newPhones[index].number = e.target.value;
                            setIdentityForm({...identityForm, phone_numbers: newPhones});
                          }}
                          placeholder="전화번호 (010-1234-5678)"
                          className="flex-1 border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded px-2 py-1 text-sm"
                        />
                        <input
                          type="text"
                          value={phone.carrier || ''}
                          onChange={(e) => {
                            const newPhones = [...identityForm.phone_numbers];
                            newPhones[index].carrier = e.target.value;
                            setIdentityForm({...identityForm, phone_numbers: newPhones});
                          }}
                          placeholder="통신사 (SKT/KT/LG)"
                          className="flex-1 border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded px-2 py-1 text-sm"
                        />
                        <button
                          onClick={() => {
                            const newPhones = identityForm.phone_numbers.filter((_, i) => i !== index);
                            setIdentityForm({...identityForm, phone_numbers: newPhones});
                          }}
                          className="text-red-500 dark:text-red-400 hover:text-red-700 dark:hover:text-red-300 px-2"
                        >
                          🗑️
                        </button>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-gray-500 dark:text-white text-center py-2">등록된 전화번호가 없습니다</p>
                )}
              </div>
              
              {/* 닉네임 관리 */}
              <div className="border-t pt-4">
                <div className="flex items-center justify-between mb-2">
                  <label className="block text-sm font-bold text-gray-700 dark:text-white">🏷️ 닉네임</label>
                  <button
                    onClick={() => {
                      const newNicknames = [...(identityForm.nicknames || []), ''];
                      setIdentityForm({...identityForm, nicknames: newNicknames});
                    }}
                    className="text-xs bg-green-500 text-white px-3 py-1 rounded hover:bg-green-600"
                  >
                    ➕ 닉네임 추가
                  </button>
                </div>
                {Array.isArray(identityForm.nicknames) && identityForm.nicknames.length > 0 ? (
                  <div className="space-y-2">
                    {identityForm.nicknames.map((nickname, index) => (
                      <div key={index} className="flex gap-2 items-start bg-gray-50 dark:bg-gray-700 p-2 rounded">
                        <div className="flex flex-col gap-1">
                          <button
                            onClick={() => {
                              if (index > 0 && Array.isArray(identityForm.nicknames)) {
                                const newNicknames = [...identityForm.nicknames];
                                [newNicknames[index - 1], newNicknames[index]] = [newNicknames[index], newNicknames[index - 1]];
                                setIdentityForm({...identityForm, nicknames: newNicknames});
                              }
                            }}
                            disabled={index === 0}
                            className="text-blue-500 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 px-1 disabled:opacity-30 disabled:cursor-not-allowed"
                            title="위로 이동"
                          >
                            ⬆️
                          </button>
                          <button
                            onClick={() => {
                              if (Array.isArray(identityForm.nicknames) && index < identityForm.nicknames.length - 1) {
                                const newNicknames = [...identityForm.nicknames];
                                [newNicknames[index], newNicknames[index + 1]] = [newNicknames[index + 1], newNicknames[index]];
                                setIdentityForm({...identityForm, nicknames: newNicknames});
                              }
                            }}
                            disabled={!Array.isArray(identityForm.nicknames) || index === identityForm.nicknames.length - 1}
                            className="text-blue-500 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 px-1 disabled:opacity-30 disabled:cursor-not-allowed"
                            title="아래로 이동"
                          >
                            ⬇️
                          </button>
                        </div>
                        <input
                          type="text"
                          value={nickname || ''}
                          onChange={(e) => {
                            if (Array.isArray(identityForm.nicknames)) {
                              const newNicknames = [...identityForm.nicknames];
                              newNicknames[index] = e.target.value;
                              setIdentityForm({...identityForm, nicknames: newNicknames});
                            }
                          }}
                          placeholder="닉네임"
                          className="flex-1 border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded px-2 py-1 text-sm"
                        />
                        <button
                          onClick={() => {
                            if (Array.isArray(identityForm.nicknames)) {
                              const newNicknames = identityForm.nicknames.filter((_, i) => i !== index);
                              setIdentityForm({...identityForm, nicknames: newNicknames});
                            }
                          }}
                          className="text-red-500 dark:text-red-400 hover:text-red-700 dark:hover:text-red-300 px-2"
                        >
                          🗑️
                        </button>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-gray-500 dark:text-gray-400 text-center py-2">등록된 닉네임이 없습니다</p>
                )}
              </div>
              
              <div>
                <label className="block text-sm font-bold text-gray-700 dark:text-white mb-1">📝 메모</label>
                <textarea
                  value={identityForm.notes}
                  onChange={(e) => setIdentityForm({...identityForm, notes: e.target.value})}
                  className="w-full border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-md px-3 py-2"
                  rows="2"
                  placeholder="추가 메모사항"
                />
              </div>
            </div>
            
            <div className="flex justify-end gap-2 mt-6">
              <button
                onClick={() => setShowIdentityModal(false)}
                className="px-6 py-2 border border-gray-300 dark:border-gray-700 rounded-md hover:bg-gray-50 dark:hover:bg-gray-700 font-medium dark:bg-[#282C34] dark:text-white"
              >
                취소
              </button>
              <button
                onClick={saveIdentity}
                className="px-6 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 font-bold"
              >
                💾 저장
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 사이트 추가/수정 모달 */}
      {showSiteModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow dark:shadow-gray-900/50 p-6 w-full max-w-3xl max-h-[90vh] overflow-y-auto">
            <h3 className="text-xl font-bold mb-4">
              {editingSite ? '🔧 사이트 수정' : '➕ 새 사이트 추가'}
            </h3>
            
            {/* 유사 사이트명 경고 */}
            {similarWarning && (
              <div className="mb-4 p-3 bg-yellow-50 dark:bg-yellow-900/30 border border-yellow-300 dark:border-yellow-700 rounded-md">
                <div className="flex items-start gap-2">
                  <span className="text-yellow-600 dark:text-yellow-400">⚠️</span>
                  <div>
                    <p className="text-sm font-medium text-yellow-800 dark:text-yellow-300">
                      유사한 사이트명이 존재합니다
                    </p>
                    <ul className="mt-1 text-sm text-yellow-700 dark:text-yellow-400">
                      {similarWarning.map((item, idx) => (
                        <li key={idx} className="flex items-center gap-2">
                          <span>• {item.name}</span>
                          <span className="text-xs text-yellow-600 dark:text-yellow-500">
                            (유사도: {Math.round(item.similarity * 100)}%)
                          </span>
                          <button
                            type="button"
                            onClick={() => handleSuggestionSelect(item.name)}
                            className="text-xs px-2 py-0.5 bg-yellow-200 dark:bg-yellow-800 hover:bg-yellow-300 dark:hover:bg-yellow-700 rounded"
                          >
                            이 이름 사용
                          </button>
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              </div>
            )}
            
            <div className="grid grid-cols-2 gap-4">
              <div className="relative">
                <label className="block text-sm font-bold text-gray-700 dark:text-white mb-1">출석 (사이트명) *</label>
                <input
                  ref={siteNameInputRef}
                  type="text"
                  value={siteForm.site_name}
                  onChange={(e) => handleSiteNameChange(e.target.value)}
                  onFocus={() => {
                    if (siteForm.site_name.trim().length > 0 && siteNameSuggestions.length > 0) {
                      setShowSuggestions(true);
                    }
                  }}
                  onBlur={() => {
                    // 클릭 이벤트가 먼저 실행되도록 약간의 딜레이
                    setTimeout(() => setShowSuggestions(false), 200);
                  }}
                  className="w-full border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-md px-3 py-2"
                  placeholder="원탑"
                  required
                  autoComplete="off"
                />
                {/* 자동완성 드롭다운 */}
                {showSuggestions && siteNameSuggestions.length > 0 && (
                  <div className="absolute z-50 w-full mt-1 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md shadow-lg max-h-48 overflow-y-auto">
                    <div className="px-3 py-1 text-xs text-gray-500 dark:text-gray-400 border-b border-gray-200 dark:border-gray-600">
                      기존 사이트명 (클릭하여 선택)
                    </div>
                    {siteNameSuggestions.map((name, idx) => (
                      <div
                        key={idx}
                        className="px-3 py-2 cursor-pointer hover:bg-blue-50 dark:hover:bg-blue-900/30 text-gray-800 dark:text-gray-200"
                        onClick={() => handleSuggestionSelect(name)}
                      >
                        {name}
                      </div>
                    ))}
                  </div>
                )}
              </div>
              
              <div>
                <label className="block text-sm font-bold text-gray-700 dark:text-white mb-1">도메인</label>
                <input
                  type="text"
                  value={siteForm.domain}
                  onChange={(e) => setSiteForm({...siteForm, domain: e.target.value})}
                  className="w-full border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-md px-3 py-2"
                  placeholder="onetop.link"
                />
              </div>
              
              <div>
                <label className="block text-sm font-bold text-gray-700 dark:text-white mb-1">경로-코드</label>
                <input
                  type="text"
                  value={siteForm.referral_path}
                  onChange={(e) => setSiteForm({...siteForm, referral_path: e.target.value})}
                  className="w-full border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-md px-3 py-2"
                  placeholder="둘리티비"
                />
              </div>
              
              <div>
                <label className="block text-sm font-bold text-gray-700 dark:text-white mb-1">승전 (승인전화)</label>
                <select
                  value={siteForm.approval_call ? 'O' : 'X'}
                  onChange={(e) => setSiteForm({...siteForm, approval_call: e.target.value === 'O'})}
                  className="w-full border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-md px-3 py-2"
                >
                  <option value="X">X (필요없음)</option>
                  <option value="O">O (필요함)</option>
                </select>
              </div>
              
              <div>
                <label className="block text-sm font-bold text-gray-700 dark:text-white mb-1">아이디 *</label>
                <input
                  type="text"
                  value={siteForm.account_id}
                  onChange={(e) => setSiteForm({...siteForm, account_id: e.target.value})}
                  className="w-full border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-md px-3 py-2"
                  placeholder="가이07"
                  required
                />
              </div>
              
              <div>
                <label className="block text-sm font-bold text-gray-700 dark:text-white mb-1">비번 *</label>
                <input
                  type="text"
                  value={siteForm.password}
                  onChange={(e) => setSiteForm({...siteForm, password: e.target.value})}
                  className="w-full border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-md px-3 py-2"
                  placeholder="애애99"
                  required
                />
              </div>
              
              <div>
                <label className="block text-sm font-bold text-gray-700 dark:text-white mb-1">환비 (환전비밀번호)</label>
                <input
                  type="text"
                  value={siteForm.exchange_password}
                  onChange={(e) => setSiteForm({...siteForm, exchange_password: e.target.value})}
                  className="w-full border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-md px-3 py-2"
                  placeholder="9090"
                />
              </div>
              
              <div>
                <label className="block text-sm font-bold text-gray-700 dark:text-white mb-1">닉네임</label>
                <input
                  type="text"
                  value={siteForm.nickname}
                  onChange={(e) => setSiteForm({...siteForm, nickname: e.target.value})}
                  className="w-full border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-md px-3 py-2"
                  placeholder="우리의꿈"
                />
              </div>
              
              <div>
                <label className="block text-sm font-bold text-gray-700 dark:text-white mb-1">승인유무 (상태)</label>
                <select
                  value={siteForm.status}
                  onChange={(e) => setSiteForm({...siteForm, status: e.target.value})}
                  className="w-full border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-md px-3 py-2"
                >
                  <option value="선택하세요">선택하세요</option>
                  <option value="가입전">가입전</option>
                          <option value="대기">대기</option>
                          <option value="승인">승인</option>
                  <option value="장점검">장점검</option>
                  <option value="수동입력">수동입력</option>
                          <option value="팅">팅</option>
                          <option value="졸업">졸업</option>
                </select>
              </div>
              
              <div>
                <label className="block text-sm font-bold text-gray-700 dark:text-white mb-1">경로</label>
                <input
                  type="text"
                  value={siteForm.referral_code}
                  onChange={(e) => setSiteForm({...siteForm, referral_code: e.target.value})}
                  className="w-full border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-md px-3 py-2"
                  placeholder="둘리티비"
                />
              </div>
              
              <div>
                <label className="block text-sm font-bold text-gray-700 dark:text-white mb-1">장</label>
                <input
                  type="text"
                  value={siteForm.category}
                  onChange={(e) => setSiteForm({...siteForm, category: e.target.value})}
                  className="w-full border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-md px-3 py-2"
                  placeholder="카페"
                />
              </div>
              
              <div className="col-span-2">
                <label className="block text-sm font-bold text-gray-700 dark:text-white mb-1">메모</label>
                <textarea
                  value={siteForm.notes}
                  onChange={(e) => setSiteForm({...siteForm, notes: e.target.value})}
                  className="w-full border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-md px-3 py-2"
                  rows="2"
                  placeholder="추가 메모사항"
                />
              </div>
            </div>
            
            <div className="flex justify-end gap-2 mt-6">
              <button
                onClick={() => setShowSiteModal(false)}
                className="px-6 py-2 border border-gray-300 dark:border-gray-700 rounded-md hover:bg-gray-50 dark:hover:bg-gray-700 font-medium dark:bg-[#282C34] dark:text-white"
              >
                취소
              </button>
              <button
                onClick={saveSite}
                className="px-6 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 font-bold"
              >
                💾 저장
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 일괄 등록 모달 */}
      {showBulkImportModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow dark:shadow-gray-900/50 p-6 w-full max-w-6xl max-h-[90vh] overflow-y-auto">
            <h3 className="text-xl font-bold mb-4">📋 엑셀 일괄 등록</h3>
            
            <div className="mb-4 p-4 bg-blue-50 dark:bg-gray-700 rounded-lg">
              <p className="text-sm text-gray-700 dark:text-white mb-2">
                <strong>💡 사용 방법:</strong>
              </p>
              <ol className="text-sm text-gray-600 dark:text-white list-decimal list-inside space-y-1">
                <li>엑셀에서 데이터를 선택하고 복사 (Ctrl+C)</li>
                <li>아래 입력란에 붙여넣기 (Ctrl+V)</li>
                <li>"데이터 파싱" 버튼 클릭</li>
                <li>미리보기에서 데이터 확인</li>
                <li>"일괄 등록" 버튼 클릭</li>
              </ol>
              <p className="text-xs text-gray-500 dark:text-gray-300 mt-2">
                ※ 엑셀 열 순서: 출석 | 도메인 | 경로-코드 | 승전 | 성함 | 아이디 | 비번 | 환비 | 닉네임 | 승인유무 | 경로 | 장
              </p>
            </div>
            
            <div className="mb-4">
              <label className="block text-sm font-bold text-gray-700 dark:text-white mb-2">
                엑셀 데이터 붙여넣기:
              </label>
              <textarea
                value={bulkImportText}
                onChange={(e) => setBulkImportText(e.target.value)}
                className="w-full h-32 border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-md px-3 py-2 font-mono text-sm"
                placeholder="엑셀에서 복사한 데이터를 여기에 붙여넣으세요..."
              />
            </div>
            
            <div className="flex gap-2 mb-4">
              <button
                onClick={bulkImportMode === 'communities' ? parseCommunityBulkData : parseBulkData}
                className="px-6 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 font-bold"
              >
                🔍 데이터 파싱
              </button>
              {parsedBulkData.length > 0 && (
                <button
                  onClick={bulkImportMode === 'communities' ? executeCommunityBulkImport : executeBulkImport}
                  className="px-6 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 font-bold"
                >
                  ✅ 일괄 등록 ({parsedBulkData.length}개)
                </button>
              )}
            </div>
            
            {/* 파싱된 데이터 미리보기 */}
            {parsedBulkData.length > 0 && (
              <div className="border border-gray-300 rounded-lg overflow-hidden mb-4">
                <div className="bg-gray-100 dark:bg-gray-700 px-4 py-2 border-b border-gray-300 dark:border-gray-600">
                  <h4 className="font-bold dark:text-white">📊 미리보기 ({parsedBulkData.length}개 행)</h4>
                </div>
                <div className="overflow-x-auto max-h-96">
                  <table className="min-w-[960px] w-full text-xs">
                    <thead className="bg-gray-50 dark:bg-[#282C34] sticky top-0">
                      <tr>
                        <th className="px-2 py-2 text-left border-b dark:text-white dark:border-gray-600">출석</th>
                        <th className="px-2 py-2 text-left border-b dark:text-white dark:border-gray-600">도메인</th>
                        <th className="px-2 py-2 text-left border-b dark:text-white dark:border-gray-600">경로-코드</th>
                        <th className="px-2 py-2 text-center border-b dark:text-white dark:border-gray-600">승전</th>
                        <th className="px-2 py-2 text-left border-b dark:text-white dark:border-gray-600">성함</th>
                        <th className="px-2 py-2 text-left border-b dark:text-white dark:border-gray-600">아이디</th>
                        <th className="px-2 py-2 text-left border-b dark:text-white dark:border-gray-600">비번</th>
                        <th className="px-2 py-2 text-left border-b dark:text-white dark:border-gray-600">환비</th>
                        <th className="px-2 py-2 text-left border-b dark:text-white dark:border-gray-600">닉네임</th>
                        <th className="px-2 py-2 text-left border-b dark:text-white dark:border-gray-600">승인유무</th>
                        <th className="px-2 py-2 text-left border-b dark:text-white dark:border-gray-600">경로</th>
                        <th className="px-2 py-2 text-left border-b dark:text-white dark:border-gray-600">장</th>
                      </tr>
                    </thead>
                    <tbody>
                      {parsedBulkData.map((data, index) => (
                        <tr key={data.tempId} className="border-b hover:bg-gray-50 dark:hover:bg-gray-700">
                          <td className="px-2 py-2 dark:text-white">{data.site_name}</td>
                          <td className="px-2 py-2 text-blue-600 dark:text-blue-400">{data.domain}</td>
                          <td className="px-2 py-2 dark:text-white">{data.referral_path}</td>
                          <td className="px-2 py-2 text-center dark:text-white">{data.approval_call ? 'O' : 'X'}</td>
                          <td className="px-2 py-2 dark:text-white">{data.identity_name}</td>
                          <td className="px-2 py-2 font-mono dark:text-white">{data.account_id}</td>
                          <td className="px-2 py-2 font-mono dark:text-white">{data.password}</td>
                          <td className="px-2 py-2 dark:text-white">{data.exchange_password}</td>
                          <td className="px-2 py-2 dark:text-white">{data.nickname}</td>
                          <td className="px-2 py-2 dark:text-white">{data.status}</td>
                          <td className="px-2 py-2 dark:text-white">{data.referral_code}</td>
                          <td className="px-2 py-2 dark:text-white">{data.category}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
            
            <div className="flex justify-end gap-2">
              <button
                onClick={() => {
                  setShowBulkImportModal(false);
                  resetBulkImportState();
                }}
                className="px-6 py-2 border border-gray-300 dark:border-gray-700 rounded-md hover:bg-gray-50 dark:hover:bg-gray-700 font-medium dark:bg-[#282C34] dark:text-white"
              >
                닫기
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 커뮤니티 추가/수정 모달 */}
      {showCommunityModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow dark:shadow-gray-900/50 p-6 w-full max-w-3xl max-h-[90vh] overflow-y-auto">
            <h3 className="text-xl font-bold mb-4">
              {editingCommunity ? '🔧 커뮤니티 수정' : '➕ 새 커뮤니티 추가'}
            </h3>
            
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-bold text-gray-700 dark:text-white mb-1">출석 (사이트명) *</label>
                <input
                  type="text"
                  value={communityForm.site_name}
                  onChange={(e) => setCommunityForm({ ...communityForm, site_name: e.target.value })}
                  className="w-full border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-md px-3 py-2"
                  placeholder="출석"
                  required
                />
              </div>
              
              <div>
                <label className="block text-sm font-bold text-gray-700 dark:text-white mb-1">도메인</label>
                <input
                  type="text"
                  value={communityForm.domain}
                  onChange={(e) => setCommunityForm({ ...communityForm, domain: e.target.value })}
                  className="w-full border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-md px-3 py-2"
                  placeholder="example.com"
                />
              </div>
              
              <div>
                <label className="block text-sm font-bold text-gray-700 dark:text-white mb-1">경로-코드</label>
                <input
                  type="text"
                  value={communityForm.referral_path}
                  onChange={(e) => setCommunityForm({ ...communityForm, referral_path: e.target.value })}
                  className="w-full border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-md px-3 py-2"
                  placeholder="경로-코드"
                />
              </div>
              
              <div>
                <label className="block text-sm font-bold text-gray-700 dark:text-white mb-1">승전 (승인전화)</label>
                <select
                  value={communityForm.approval_call ? 'O' : 'X'}
                  onChange={(e) => setCommunityForm({ ...communityForm, approval_call: e.target.value === 'O' })}
                  className="w-full border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-md px-3 py-2"
                >
                  <option value="X">X (필요없음)</option>
                  <option value="O">O (필요함)</option>
                </select>
              </div>
              
              <div>
                <label className="block text-sm font-bold text-gray-700 dark:text-white mb-1">성함</label>
                <input
                  type="text"
                  value={communityForm.identity_name}
                  onChange={(e) => setCommunityForm({ ...communityForm, identity_name: e.target.value })}
                  className="w-full border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-md px-3 py-2"
                  placeholder="성함"
                />
              </div>
              
              <div>
                <label className="block text-sm font-bold text-gray-700 dark:text-white mb-1">아이디 *</label>
                <input
                  type="text"
                  value={communityForm.account_id}
                  onChange={(e) => setCommunityForm({ ...communityForm, account_id: e.target.value })}
                  className="w-full border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-md px-3 py-2"
                  placeholder="아이디"
                  required
                />
              </div>
              
              <div>
                <label className="block text-sm font-bold text-gray-700 dark:text-white mb-1">비번 *</label>
                <input
                  type="text"
                  value={communityForm.password}
                  onChange={(e) => setCommunityForm({ ...communityForm, password: e.target.value })}
                  className="w-full border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-md px-3 py-2"
                  placeholder="비번"
                  required
                />
              </div>
              
              <div>
                <label className="block text-sm font-bold text-gray-700 dark:text-white mb-1">환비 (환전비밀번호)</label>
                <input
                  type="text"
                  value={communityForm.exchange_password}
                  onChange={(e) => setCommunityForm({ ...communityForm, exchange_password: e.target.value })}
                  className="w-full border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-md px-3 py-2"
                  placeholder="환비"
                />
              </div>
              
              <div>
                <label className="block text-sm font-bold text-gray-700 dark:text-white mb-1">닉네임</label>
                <input
                  type="text"
                  value={communityForm.nickname}
                  onChange={(e) => setCommunityForm({ ...communityForm, nickname: e.target.value })}
                  className="w-full border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-md px-3 py-2"
                  placeholder="닉네임"
                />
              </div>
              
              <div>
                <label className="block text-sm font-bold text-gray-700 dark:text-white mb-1">승인유무 (상태)</label>
                <select
                  value={communityForm.status}
                  onChange={(e) => setCommunityForm({ ...communityForm, status: e.target.value })}
                  className="w-full border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-md px-3 py-2"
                >
                  <option value="선택하세요">선택하세요</option>
                  <option value="가입전">가입전</option>
                  <option value="대기">대기</option>
                  <option value="승인">승인</option>
                  <option value="장점검">장점검</option>
                  <option value="수동입력">수동입력</option>
                  <option value="팅">팅</option>
                  <option value="졸업">졸업</option>
                </select>
              </div>
              
              <div>
                <label className="block text-sm font-bold text-gray-700 dark:text-white mb-1">경로</label>
                <input
                  type="text"
                  value={communityForm.referral_code}
                  onChange={(e) => setCommunityForm({ ...communityForm, referral_code: e.target.value })}
                  className="w-full border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-md px-3 py-2"
                  placeholder="경로"
                />
              </div>
              
              <div>
                <label className="block text-sm font-bold text-gray-700 dark:text-white mb-1">장</label>
                <input
                  type="text"
                  value={communityForm.notes}
                  onChange={(e) => setCommunityForm({ ...communityForm, notes: e.target.value })}
                  className="w-full border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-md px-3 py-2"
                  placeholder="장"
                />
              </div>
            </div>
            
            <div className="flex justify-end gap-2 mt-6">
              <button
                onClick={() => {
                  setShowCommunityModal(false);
                  setEditingCommunity(null);
                }}
                className="px-6 py-2 border border-gray-300 dark:border-gray-700 rounded-md hover:bg-gray-50 dark:hover:bg-gray-700 font-medium dark:bg-[#282C34] dark:text-white"
              >
                취소
              </button>
              <button
                onClick={saveCommunity}
                className="px-6 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 font-bold"
              >
                💾 저장
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 사이트명 통합 모달 */}
      {showMergeModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow dark:shadow-gray-900/50 p-6 w-full max-w-4xl max-h-[90vh] overflow-y-auto">
            <h3 className="text-xl font-bold mb-4 flex items-center gap-2">
              🔗 사이트명 통합 도구
              <span className="text-sm font-normal text-gray-500 dark:text-gray-400">
                유사하거나 중복된 사이트명을 하나로 통합합니다
              </span>
            </h3>
            
            {/* 수동 통합 */}
            <div className="mb-6 p-4 bg-gray-50 dark:bg-gray-700/50 rounded-lg">
              <h4 className="text-lg font-semibold mb-3">직접 통합</h4>
              <div className="grid grid-cols-3 gap-4 items-end">
                <div>
                  <label className="block text-sm font-medium mb-1">원본 (변경할 이름)</label>
                  <input
                    type="text"
                    value={selectedMergeSource}
                    onChange={(e) => setSelectedMergeSource(e.target.value)}
                    className="w-full border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-md px-3 py-2"
                    placeholder="예: 케이탑25"
                    list="allSiteNamesList"
                  />
                  <datalist id="allSiteNamesList">
                    {allSiteNames.map((name, idx) => (
                      <option key={idx} value={name} />
                    ))}
                  </datalist>
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">대상 (통합할 이름)</label>
                  <input
                    type="text"
                    value={selectedMergeTarget}
                    onChange={(e) => setSelectedMergeTarget(e.target.value)}
                    className="w-full border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-md px-3 py-2"
                    placeholder="예: 케이탑"
                    list="allSiteNamesList"
                  />
                </div>
                <button
                  onClick={() => {
                    if (window.confirm(`"${selectedMergeSource}"를 "${selectedMergeTarget}"으로 통합하시겠습니까?\n이 작업은 되돌릴 수 없습니다.`)) {
                      handleMergeSiteNames();
                    }
                  }}
                  disabled={!selectedMergeSource || !selectedMergeTarget}
                  className="px-4 py-2 bg-orange-600 text-white rounded-md hover:bg-orange-700 font-bold disabled:bg-gray-400"
                >
                  통합 실행
                </button>
              </div>
            </div>
            
            {/* 자동 감지된 유사 그룹 */}
            <div className="mb-4">
              <h4 className="text-lg font-semibold mb-3 flex items-center gap-2">
                유사 사이트명 그룹
                <button
                  onClick={loadDuplicateGroups}
                  className="text-sm px-2 py-1 bg-gray-200 dark:bg-gray-600 rounded hover:bg-gray-300 dark:hover:bg-gray-500"
                >
                  🔄 새로고침
                </button>
              </h4>
              
              {duplicateGroups.length === 0 ? (
                <p className="text-gray-500 dark:text-gray-400 text-center py-4">
                  유사한 사이트명 그룹이 없습니다
                </p>
              ) : (
                <div className="space-y-3 max-h-96 overflow-y-auto">
                  {duplicateGroups.map((group, groupIdx) => (
                    <div key={groupIdx} className="p-3 border border-gray-200 dark:border-gray-600 rounded-lg">
                      <div className="flex flex-wrap gap-2">
                        {group.map((item, itemIdx) => (
                          <div
                            key={itemIdx}
                            className={`flex items-center gap-2 px-3 py-1 rounded-full text-sm ${
                              itemIdx === 0 
                                ? 'bg-blue-100 dark:bg-blue-900/50 text-blue-800 dark:text-blue-300 font-medium' 
                                : 'bg-yellow-100 dark:bg-yellow-900/50 text-yellow-800 dark:text-yellow-300'
                            }`}
                          >
                            <span>{item.name}</span>
                            <span className="text-xs opacity-70">({item.count}개)</span>
                            {item.similarity && (
                              <span className="text-xs opacity-50">
                                {Math.round(item.similarity * 100)}%
                              </span>
                            )}
                            <button
                              onClick={() => {
                                if (itemIdx === 0) {
                                  setSelectedMergeTarget(item.name);
                                } else {
                                  setSelectedMergeSource(item.name);
                                }
                              }}
                              className={`ml-1 px-2 py-0.5 text-xs rounded ${
                                itemIdx === 0 
                                  ? 'bg-blue-200 dark:bg-blue-800 hover:bg-blue-300 dark:hover:bg-blue-700' 
                                  : 'bg-yellow-200 dark:bg-yellow-800 hover:bg-yellow-300 dark:hover:bg-yellow-700'
                              }`}
                            >
                              {itemIdx === 0 ? '대상으로' : '원본으로'}
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
            
            <div className="flex justify-end gap-2 mt-6">
              <button
                onClick={() => {
                  setShowMergeModal(false);
                  setSelectedMergeSource('');
                  setSelectedMergeTarget('');
                }}
                className="px-6 py-2 border border-gray-300 dark:border-gray-700 rounded-md hover:bg-gray-50 dark:hover:bg-gray-700 font-medium dark:bg-[#282C34] dark:text-white"
              >
                닫기
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 사이트 메타데이터(이벤트/요율 등) 모달 */}
      <SiteNotesModal
        isOpen={siteNotesModal.open}
        onClose={() => setSiteNotesModal(prev => ({ ...prev, open: false }))}
        siteName={siteNotesModal.siteName}
        identityName={siteNotesModal.identityName}
        recordedBy={siteNotesModal.recordedBy}
        monthlyStats={null}
        data={siteNotesModal.data}
        readonly={siteNotesModal.readonly}
        onSave={saveSiteNotes}
        onDataChange={(newData) => setSiteNotesModal(prev => ({ ...prev, data: newData }))}
      />
    </>
  );
};

export default SiteManagement;