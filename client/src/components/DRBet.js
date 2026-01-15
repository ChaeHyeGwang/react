import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { flushSync } from 'react-dom';
import axiosInstance from '../api/axios';
import toast from 'react-hot-toast';
import { DragDropContext, Droppable, Draggable } from '@hello-pangea/dnd';
import SiteNotesModal from './SiteNotesModal';
import { useAuth } from '../contexts/AuthContext';
import { getAttendanceStats } from '../utils/attendanceUtils';

// 디버그 로그 비활성화
const DEBUG = false;
const log = DEBUG ? console.log.bind(console) : () => {};
const logWarn = DEBUG ? console.warn.bind(console) : () => {};
const logTable = DEBUG ? console.table.bind(console) : () => {};

// Debounce 유틸리티 훅 (서버 부하 감소용)
const useDebounce = (value, delay) => {
  const [debouncedValue, setDebouncedValue] = React.useState(value);

  React.useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedValue(value);
    }, delay);

    return () => {
      clearTimeout(handler);
    };
  }, [value, delay]);

  return debouncedValue;
};
 
// 한국 시간 기준 날짜 문자열 반환 (YYYY-MM-DD)
function getKSTDateString(date = null) {
  const now = date ? new Date(date) : new Date();
  const kstDate = new Date(now.toLocaleString('en-US', {timeZone: 'Asia/Seoul'}));
  const year = kstDate.getFullYear();
  const month = String(kstDate.getMonth() + 1).padStart(2, '0');
  const day = String(kstDate.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

// 한국 시간 기준 월 문자열 반환 (YYYY-MM)
function getKSTMonthString(date = null) {
  const now = date ? new Date(date) : new Date();
  const kstDate = new Date(now.toLocaleString('en-US', {timeZone: 'Asia/Seoul'}));
  const year = kstDate.getFullYear();
  const month = String(kstDate.getMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
}

// 이름 정규화 함수 (서버와 동일 - trim + 연속 공백 제거)
function normalizeName(name) {
  if (!name) return '';
  return String(name).trim().replace(/\s+/g, ' ');
}

function DRBet() {
  const { selectedAccountId } = useAuth();
  const [records, setRecords] = useState([]);
  const [editingCell, setEditingCell] = useState(null);
  const [editingValue, setEditingValue] = useState('');
  
  // localStorage에서 저장된 날짜 불러오기, 없으면 오늘 날짜
  const getInitialDate = () => {
    const savedDate = localStorage.getItem('drbet_selected_date');
    if (savedDate) {
      // 저장된 날짜가 유효한지 확인
      const date = new Date(savedDate);
      if (!isNaN(date.getTime())) {
        return getKSTDateString(date);
      }
    }
    return getKSTDateString();
  };
  
  const [selectedDate, setSelectedDate] = useState(getInitialDate());
  const [allRecords, setAllRecords] = useState([]);
  const [sites, setSites] = useState([]);
  const [showSiteModal, setShowSiteModal] = useState(false);
  const [selectedRecord, setSelectedRecord] = useState(null);
  const [siteInputs, setSiteInputs] = useState({});
  
  // 사이트 수정 모달 상태 (사이트 관리와 동일)
  const [showSiteEditModal, setShowSiteEditModal] = useState(false);
  const [editingSite, setEditingSite] = useState(null);
  const [isManualInputMode, setIsManualInputMode] = useState(false); // 수동입력 모드인지 체크
  const [manualInputValue, setManualInputValue] = useState(''); // 수동입력 값
  const [siteForm, setSiteForm] = useState({
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
    category: '',
    notes: ''
  });
  
  // 사이트 계정 정보 모달 상태
  const [showSiteAccountModal, setShowSiteAccountModal] = useState(false);
  const [siteAccountInfo, setSiteAccountInfo] = useState(null);
  const getInitialExtraNoteInputs = () => ({
    bategiAmount: '',
    bategiType: '',
    manualText: ''
  });
  const [extraNoteInputs, setExtraNoteInputs] = useState(getInitialExtraNoteInputs());
  
  // 인라인 특이사항 편집 상태
  const [editingNotesRecordId, setEditingNotesRecordId] = useState(null); // 편집 중인 레코드 ID
  const [notesEditData, setNotesEditData] = useState({}); // 편집 데이터: { recordId: { sites: { siteName: { points: [], chips: [] } }, bategis: [], manuals: [] } }
  const [editingNotesRecordMeta, setEditingNotesRecordMeta] = useState(null); // { id, tmpId }
  const [expandedSites, setExpandedSites] = useState({}); // 펼쳐진 사이트: { recordId: { siteName: true } }
  const addingItemRef = useRef(false); // 항목 추가 중복 방지
  const [identities, setIdentities] = useState([]);
  const [identitySitesMap, setIdentitySitesMap] = useState({});
  const [suggestions, setSuggestions] = useState([]);
  const [paybackData, setPaybackData] = useState([]);
  const [settlementBanners, setSettlementBanners] = useState([]); // [{identity, site, startDate, totalTarget, totalCharge}]
  const [siteAttendanceTypes, setSiteAttendanceTypes] = useState({}); // 사이트별 출석 타입 캐시
  const [siteAttendanceDays, setSiteAttendanceDays] = useState({}); // 사이트별 연속 출석일 캐시 (새로운 로그 방식)
  const [siteRolloverStatus, setSiteRolloverStatus] = useState({}); // 사이트별 이월유무 캐시
  const [siteLastUpdated, setSiteLastUpdated] = useState({}); // 사이트별 마지막 업데이트 날짜 캐시
  const [paybackClearedMap, setPaybackClearedMap] = useState({}); // 페이백 지급 여부 캐시: { "identity||site||weekStart": true/false }
  const [attendanceStates, setAttendanceStates] = useState({}); // 출석 상태 캐시 {recordId-siteIndex: boolean}
  const [refreshTick, setRefreshTick] = useState(0); // 강제 렌더 트리거 (출석일 즉시 반영용)
  const isComposingRef = useRef(false); // IME 조합 중 플래그
  const editingLockRef = useRef(false); // 편집 락: 편집 중 외부 데이터 리로드 차단
  const savingNotesInlineRef = useRef(false); // 특이사항 인라인 편집 저장 중복 방지
  const [isComposingUI, setIsComposingUI] = useState(false); // 조합 중 UI 변경(제안 숨김 등)
  const [pendingSites, setPendingSites] = useState([]); // 장점검/수동입력 사이트 목록 [{identityName, siteName, siteId}]
  const siteNotesCacheRef = useRef({});
  const savingSiteNotesRef = useRef(false); // 사이트 정보 저장 중복 방지
  const attendanceStatsCacheRef = useRef({}); // 출석 통계 캐시: { "siteName||identityName": { consecutiveDays, timestamp } }
  const previousCombosRef = useRef(null); // 이전 사이트/유저 조합 (중복 호출 방지용)
  const savingRecordRef = useRef({}); // 레코드 저장 중복 방지: { recordId: true }
  const isFirstMountRef = useRef(true); // 초기 마운트 여부 (중복 API 호출 방지)
  const fetchingDailySummaryRef = useRef(false); // fetchDailySummary 중복 호출 방지

  // 사이트 정보 기록(출석구분 등) 변경 전파용 이벤트 리스너
  useEffect(() => {
    const handleAttendanceTypeChanged = (event) => {
      try {
        const { siteName, identityName, attendanceType } = event.detail || {};
        if (!siteName) return;

        const cacheKey = getAttendanceCacheKey(siteName, identityName || null);
        const notesKey = getSiteNotesCacheKey(siteName, identityName || null);

        // 1) 출석구분 캐시 갱신
        setSiteAttendanceTypes((prev) => ({
          ...prev,
          [cacheKey]: attendanceType || '자동',
        }));

        // 2) siteNotes 캐시 안에도 반영 (있을 경우)
        if (siteNotesCacheRef.current[notesKey]) {
          siteNotesCacheRef.current[notesKey] = {
            ...siteNotesCacheRef.current[notesKey],
            data: {
              ...(siteNotesCacheRef.current[notesKey].data || {}),
              attendanceType: attendanceType || '자동',
            },
          };
        }

        log('[DRBet] attendanceTypeChanged 수신, 캐시 갱신:', {
          cacheKey,
          notesKey,
          siteName,
          identityName,
          attendanceType,
        });
      } catch (e) {
        logWarn('[DRBet] attendanceTypeChanged 처리 실패:', e);
      }
    };

    window.addEventListener('attendanceTypeChanged', handleAttendanceTypeChanged);
    return () => window.removeEventListener('attendanceTypeChanged', handleAttendanceTypeChanged);
  }, []);
  
  // 달력 이벤트 관련 state
  const [calendarEvents, setCalendarEvents] = useState([]);
  const [calendarMonth, setCalendarMonth] = useState(new Date());
  const [selectedCalendarDate, setSelectedCalendarDate] = useState(null);
  const [showEventModal, setShowEventModal] = useState(false);
  const [editingEvent, setEditingEvent] = useState(null);
  const [eventFormData, setEventFormData] = useState({ title: '', description: '', type: 'normal', date: '' });

  const getSiteNotesCacheKey = useCallback((siteName = '', identityName = '') => (
    `${siteName}||${identityName || ''}`
  ), []);

  const updateSiteNotesCache = useCallback((siteName, identityName, data) => {
    if (!siteName) return;
    const key = getSiteNotesCacheKey(siteName, identityName);
    siteNotesCacheRef.current = {
      ...siteNotesCacheRef.current,
      [key]: data
    };
  }, [getSiteNotesCacheKey]);

  const bulkFetchSiteNotes = useCallback(async (requests = [], { force = false } = {}) => {
    if (!Array.isArray(requests) || requests.length === 0) return;
    const normalized = [];
    const seen = new Set();

    requests.forEach((req) => {
      const siteName = (req.siteName || req.site_name || '').trim();
      if (!siteName) return;
      const identityName = req.identityName ?? req.identity_name ?? null;
      const key = getSiteNotesCacheKey(siteName, identityName);
      if (seen.has(key)) return;
      seen.add(key);
      if (!force && siteNotesCacheRef.current[key]) return;
      normalized.push({
        site_name: siteName,
        identity_name: identityName
      });
    });

    if (normalized.length === 0) return;

    try {
      const res = await axiosInstance.post('/site-notes/bulk', { requests: normalized });
      if (res.data?.success && Array.isArray(res.data.results)) {
        const newCache = { ...siteNotesCacheRef.current };
        res.data.results.forEach((item) => {
          if (item?.site_name) {
            const key = getSiteNotesCacheKey(item.site_name, item.identity_name);
            // ✅ item.data를 캐시에 저장 (GET /site-notes와 구조 통일)
            // bulk 응답: { site_name, identity_name, data: getSiteNoteData()결과 }
            // GET 응답: getSiteNoteData()결과
            newCache[key] = item.data || null;
          }
        });
        siteNotesCacheRef.current = newCache;
      }
    } catch (error) {
      console.error('사이트 메타데이터 bulk 조회 실패:', error);
    }
  }, [getSiteNotesCacheKey]);
  const isCompactLayout = true;

  const resetExtraNoteInputs = () => setExtraNoteInputs(getInitialExtraNoteInputs());
  const closeSiteModal = () => {
    setShowSiteModal(false);
    setSiteInputs({});
    resetExtraNoteInputs();
  };

  const getAttendanceCacheKey = useCallback((siteName, identityName) => {
    const identityKey = identityName ? encodeURIComponent(identityName) : 'shared';
    const siteKey = siteName ? encodeURIComponent(siteName) : '';
    return `${identityKey}|${siteKey}`;
  }, []);
  
  // 캐시 무효화 함수 (getAttendanceCacheKey 이후에 선언)
  const invalidateAttendanceCache = useCallback((siteName, identityName) => {
    const cacheKey = getAttendanceCacheKey(siteName, identityName);
    delete attendanceStatsCacheRef.current[cacheKey];
  }, [getAttendanceCacheKey]);

  // 날짜 유틸 (문자열 기반 비교로 TZ 이슈 제거)
  const toDateString = (d) => {
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  };
  const addDaysStr = (ymd, days) => {
    const d = new Date(`${ymd}T00:00:00`);
    d.setDate(d.getDate() + days);
    return toDateString(d);
  };
  // 사이트 메타데이터(이벤트/요율 등) 모달 상태
  const [siteNotesModal, setSiteNotesModal] = useState({
    open: false,
    readonly: false,
    siteName: '',
    identityName: '', // 유저명 추가
    recordedBy: '',
    startDate: '',
    monthlyStats: {
      totalCharge: 0,
      totalWithdraw: 0,
      recovery: 0
    },
    weeklyStats: {
      totalCharge: 0,
      totalWithdraw: 0,
      recovery: 0
    },
    data: {
      tenure: '', // 만근
      attendanceType: '자동', // 출석구분 (자동/수동)
      attendanceDays: 0, // 출석일
      rollover: '', // 이월유무
        settlement: '', // 정착 유무 (O/X)
        settlementTotal: 0,
        settlementPoint: '',
        settlementDays: 0,
      payback: '', // 페이백
      rate: '', // 요율
      event: '', // 이벤트
      eventDetail: '', // 이벤트내용
      eventRolling: '' // 이벤트로밍
    }
  });

  // loadPendingSites는 loadIdentities에 통합됨 (중복 API 호출 제거)

  useEffect(() => {
    loadRecords();
    loadIdentities(); // loadPendingSites는 loadIdentities 내부에서 처리됨
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // 초기 마운트 시에만 실행
  
  // 계정 전환 시 데이터 다시 로드 (초기 마운트 제외)
  useEffect(() => {
    if (isFirstMountRef.current) {
      isFirstMountRef.current = false;
      return; // 초기 마운트 시에는 빈 의존성 useEffect에서 이미 로드함
    }
    if (selectedAccountId !== undefined) {
      log('[DRBet] 계정 전환 감지, 데이터 다시 로드', { selectedAccountId });
      siteNotesCacheRef.current = {};
      loadRecords(true);
      loadIdentities(); // loadPendingSites는 loadIdentities 내부에서 처리됨
      // 페이백과 정착 배너도 초기화
      setPaybackData([]);
      setSettlementBanners([]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedAccountId]); // loadRecords, loadIdentities는 useCallback으로 안정적이므로 의존성 제외
  
  // 출석 타입 및 연속 출석일 로드 (통합된 useEffect - 중복 제거)
  const loadAttendanceData = useCallback(async (targetRecords, previousCombos = null) => {
    if (!targetRecords || targetRecords.length === 0) return;
    
    const combos = {};
    targetRecords.forEach(record => {
      for (let i = 1; i <= 4; i++) {
        const siteName = record[`site_name${i}`];
        const identityName = record[`identity${i}`] || null;
        if (!siteName) continue;
        const cacheKey = getAttendanceCacheKey(siteName, identityName);
        if (!combos[cacheKey]) {
          combos[cacheKey] = { siteName, identityName };
        }
      }
    });

    if (Object.keys(combos).length === 0) return;
    
    // 이전 조합과 동일하면 API 호출 스킵 (불필요한 호출 방지)
    if (previousCombos) {
      const currentKeys = Object.keys(combos).sort().join(',');
      const previousKeys = Object.keys(previousCombos).sort().join(',');
      if (currentKeys === previousKeys) {
        return; // 조합이 동일하면 스킵
      }
    }

    await bulkFetchSiteNotes(Object.values(combos));

    // 1) 출석 타입 캐시 갱신 (site_notes 기반)
    const typeUpdates = {};
    for (const key of Object.keys(combos)) {
      const { siteName, identityName } = combos[key];
      const notesCacheKey = getSiteNotesCacheKey(siteName, identityName);
      const siteNotes = siteNotesCacheRef.current[notesCacheKey];
      const attendanceType = siteNotes?.data?.attendanceType || '자동';
      const cacheKey = getAttendanceCacheKey(siteName, identityName);
      typeUpdates[cacheKey] = attendanceType;
    }
    if (Object.keys(typeUpdates).length > 0) {
      setSiteAttendanceTypes(prev => ({
        ...prev,
        ...typeUpdates
      }));
    }
    
    // 2) 연속 출석일 로드 (유저가 있는 경우만, 캐시 활용)
    const toLoadStats = [];
    const cacheKeyToCombo = {};
    for (const key of Object.keys(combos)) {
      const { siteName, identityName } = combos[key];
      if (siteName && identityName) {
        const cacheKey = getAttendanceCacheKey(siteName, identityName);
        const cacheEntry = attendanceStatsCacheRef.current[cacheKey];
        const CACHE_TTL = 15 * 60 * 1000; // 15분 캐시 (5분 → 15분으로 증가)
        
        // 캐시가 있고 15분 이내면 캐시 사용
        if (cacheEntry && (Date.now() - cacheEntry.timestamp < CACHE_TTL)) {
          setSiteAttendanceDays(prev => ({
            ...prev,
            [cacheKey]: cacheEntry.consecutiveDays
          }));
        } else {
          toLoadStats.push({ siteName, identityName });
          cacheKeyToCombo[cacheKey] = { siteName, identityName };
        }
      }
    }
    
    if (toLoadStats.length > 0) {
      try {
        // 배치 API로 한 번에 조회
        const response = await axiosInstance.post('/attendance/stats/batch', {
          sites: toLoadStats
        });
        
        if (response.data?.success && Array.isArray(response.data.results)) {
          const newCache = {};
          
          response.data.results.forEach(result => {
            const { siteName, identityName, consecutiveDays, error } = result;
            const cacheKey = getAttendanceCacheKey(siteName, identityName);
            
            if (!error) {
              // 캐시에 저장 (타임스탬프 포함)
              attendanceStatsCacheRef.current[cacheKey] = {
                consecutiveDays: consecutiveDays || 0,
                timestamp: Date.now()
              };
              
              newCache[cacheKey] = consecutiveDays || 0;
            } else {
              console.error('배치 조회 중 오류:', { siteName, identityName, error });
              newCache[cacheKey] = 0;
            }
          });
          
          setSiteAttendanceDays(prev => ({
            ...prev,
            ...newCache
          }));
        }
      } catch (error) {
        console.error('배치 출석 통계 조회 실패:', error);
        
        // 폴백: 개별 API 호출
        const results = await Promise.all(
          toLoadStats.map(async ({ siteName, identityName }) => {
            try {
              const stats = await getAttendanceStats(siteName, identityName);
              const cacheKey = getAttendanceCacheKey(siteName, identityName);
              const consecutiveDays = stats?.consecutiveDays || 0;
              
              // 캐시에 저장
              attendanceStatsCacheRef.current[cacheKey] = {
                consecutiveDays,
                timestamp: Date.now()
              };
              
              return {
                cacheKey,
                consecutiveDays
              };
            } catch (error) {
              console.error('연속 출석일 로드 실패:', { siteName, identityName, error });
              const cacheKey = getAttendanceCacheKey(siteName, identityName);
              return {
                cacheKey,
                consecutiveDays: 0
              };
            }
          })
        );
        
        const newCache = {};
        results.forEach(({ cacheKey, consecutiveDays }) => {
          newCache[cacheKey] = consecutiveDays;
        });
        
        setSiteAttendanceDays(prev => ({
          ...prev,
          ...newCache
        }));
      }
    }
  }, [bulkFetchSiteNotes, getAttendanceCacheKey, getSiteNotesCacheKey]);

  // 날짜 변경 시 필터링 및 출석 데이터 로드
  const filteredRecords = useMemo(() => {
    if (editingLockRef.current) return records; // 편집 중에는 현재 records 유지
    return allRecords
      .filter(record => record.record_date === selectedDate)
      .sort((a, b) => (a.display_order || 0) - (b.display_order || 0));
  }, [selectedDate, allRecords]); // records 제거: filteredRecords가 records를 생성하므로 순환 참조 방지
  
  // 승인된 사이트 중 등록되지 않은 사이트 목록 계산 (날짜별)
  const unregisteredApprovedSites = useMemo(() => {
    if (!filteredRecords || filteredRecords.length === 0) return [];
    
    // 현재 날짜에 등록된 사이트 수집
    const registeredSites = new Set();
    filteredRecords.forEach(record => {
      for (let i = 1; i <= 4; i++) {
        const siteName = record[`site_name${i}`];
        const identityName = record[`identity${i}`];
        if (siteName && identityName) {
          registeredSites.add(`${identityName}||${siteName}`);
        }
      }
    });
    
    // 승인된 사이트 중 등록되지 않은 사이트 찾기
    const unregistered = [];
    identities.forEach(identity => {
      const sites = identitySitesMap[identity.id] || [];
      sites.forEach(site => {
        const key = `${identity.name}||${site.site_name}`;
        if (!registeredSites.has(key)) {
          unregistered.push({
            identityName: identity.name,
            siteName: site.site_name,
            siteId: site.id,
            status: site.status,
            notes: site.notes || '', // 사이트 관리의 메모 필드
            identityId: identity.id,
            site: site // 전체 사이트 정보 저장 (모달에서 사용)
          });
        }
      });
    });
    
    return unregistered;
  }, [filteredRecords, identities, identitySitesMap]);

  // unregisteredApprovedSites는 이미 notes 필드를 포함하므로 별도 로드 불필요
  const unregisteredSitesWithMemo = unregisteredApprovedSites;

  useEffect(() => {
    if (!editingLockRef.current) {
      setRecords(filteredRecords);
      
      // 출석 상태를 별도 state에 저장
      const newAttendanceStates = {};
      filteredRecords.forEach(record => {
        for (let i = 1; i <= 4; i++) {
          const key = `${record.id}-${i}`;
          newAttendanceStates[key] = !!record[`attendance${i}`];
        }
      });
      setAttendanceStates(newAttendanceStates);
    }
  }, [filteredRecords]);

  // 날짜 변경 시 출석 데이터 로드 (필터링된 레코드 기준)
  // 편집 중이 아닐 때만 호출 (Enter/Tab 키로 입력 완료 후에만 호출)
  useEffect(() => {
    if (allRecords.length > 0 && selectedDate && filteredRecords.length > 0 && !editingCell) {
      // 현재 조합 계산
      const currentCombos = {};
      filteredRecords.forEach(record => {
        for (let i = 1; i <= 4; i++) {
          const siteName = record[`site_name${i}`];
          const identityName = record[`identity${i}`] || null;
          if (!siteName) continue;
          const cacheKey = getAttendanceCacheKey(siteName, identityName);
          if (!currentCombos[cacheKey]) {
            currentCombos[cacheKey] = { siteName, identityName };
          }
        }
      });
      
      // 이전 조합과 비교하여 변경된 경우에만 호출
      const currentKeys = Object.keys(currentCombos).sort().join(',');
      const previousKeys = previousCombosRef.current ? Object.keys(previousCombosRef.current).sort().join(',') : '';
      
      if (currentKeys !== previousKeys) {
        loadAttendanceData(filteredRecords, previousCombosRef.current);
        previousCombosRef.current = currentCombos;
      }
    }
  }, [selectedDate, allRecords, filteredRecords, loadAttendanceData, editingCell, getAttendanceCacheKey]);

  // 성능 최적화: useCallback으로 메모이제이션 + N+1 문제 해결
  const loadRecords = useCallback(async (force = false) => {
    try {
      if (editingLockRef.current && !force) return; // 편집 중에는 외부 로드 차단 (강제 아니면)
      const response = await axiosInstance.get('/drbet');
      const records = response.data;
      
      // 성능 최적화: 개별 getAttendanceStats 호출 제거
      // 출석일 데이터는 loadAttendanceData에서 배치 API로 한 번에 조회하므로
      // 여기서는 레코드만 로드하고 출석일은 나중에 loadAttendanceData에서 처리
      setAllRecords(records);
      setRefreshTick((t) => t + 1);
    } catch (error) {
      console.error('DR벳 기록 로드 실패:', error);
      toast.error('DR벳 기록을 불러오는데 실패했습니다');
    }
  }, [selectedDate]); // selectedDate는 의존성에 포함 (필요시 사용)

  const fetchDailySummary = useCallback(async () => {
    if (!selectedDate) {
      log('[클라이언트] fetchDailySummary: selectedDate 없음 - 스킵');
      setPaybackData([]);
      setSettlementBanners([]);
      setPaybackClearedMap({});
      return;
    }
    
    // 성능 최적화: 중복 호출 방지
    if (fetchingDailySummaryRef.current) {
      log('[클라이언트] fetchDailySummary: 이미 호출 중 - 스킵');
      return;
    }
    
    fetchingDailySummaryRef.current = true;
    
    // 선택된 날짜의 요일 계산
    const dateObj = new Date(`${selectedDate}T00:00:00+09:00`);
    const dayOfWeek = dateObj.getDay(); // 0=일요일, 1=월요일, ..., 6=토요일
    const dayNames = ['일', '월', '화', '수', '목', '금', '토'];
    const currentDayName = dayNames[dayOfWeek];
    
    console.log('📅 [선택된 날짜 정보]', {
      selectedDate: selectedDate,
      dayOfWeek: dayOfWeek,
      dayName: currentDayName,
      fullDate: dateObj.toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })
    });
    
    log(`[클라이언트] fetchDailySummary 호출: selectedDate=${selectedDate}, 요일=${currentDayName}`);
    try {
      log(`[클라이언트] API 호출: GET /drbet/summary/${selectedDate}`);
      const response = await axiosInstance.get(`/drbet/summary/${selectedDate}`);
      log(`[클라이언트] API 응답 받음:`, response.data);
      
      // 페이백 데이터의 지급요일 정보도 로그로 출력
      if (response.data?.success && response.data.paybackData) {
        console.log('💰 [페이백 데이터 지급요일 정보]', {
          selectedDate: selectedDate,
          currentDayName: currentDayName,
          paybackItems: response.data.paybackData.map(item => ({
            identityName: item.identityName,
            siteName: item.siteName,
            paybackAmounts: item.paybackAmounts,
            paybackDays: Object.keys(item.paybackAmounts || {}).filter(k => !k.startsWith('당일'))
          }))
        });
      }
      
      if (response.data?.success) {
        const summaryPaybacks = response.data.paybackData || [];
        const summarySettlements = response.data.settlementBanners || [];
        setPaybackData(summaryPaybacks);
        setSettlementBanners(summarySettlements);
        const newClearedMap = {};
        summaryPaybacks.forEach(item => {
          if (item.weekStartDate) {
            const key = `${item.identityName}||${item.siteName}||${item.weekStartDate}`;
            newClearedMap[key] = !!item.cleared;
          }
        });
        setPaybackClearedMap(newClearedMap);
      } else {
        setPaybackData([]);
        setSettlementBanners([]);
        setPaybackClearedMap({});
      }
    } catch (error) {
      console.error('DR벳 요약 조회 실패:', error);
      setPaybackData([]);
      setSettlementBanners([]);
      setPaybackClearedMap({});
    } finally {
      // 성능 최적화: 중복 호출 방지 플래그 해제
      fetchingDailySummaryRef.current = false;
    }
  }, [selectedAccountId, selectedDate]);

  useEffect(() => {
    fetchDailySummary();
  }, [fetchDailySummary]); // refreshTick 제거: 날짜나 계정 변경 시에만 호출

  const getApprovedSites = useCallback((sites = []) => {
    return (sites || []).filter(site => {
      const statusHistory = site.status || '';
      if (!statusHistory) return false;
      const parts = statusHistory.split('/');
      const lastStatus = parts[parts.length - 1]?.trim() || '';
      return lastStatus.includes('승인');
    });
  }, []);

  const loadIdentities = useCallback(async () => {
    try {
      const response = await axiosInstance.get('/identities');
      log('[DRBet] 유저 로드 응답:', response.data);
      
      // success가 false이거나 없어도 identities 배열이 있으면 사용
      const identityList = response.data?.identities || response.data || [];
      
      if (Array.isArray(identityList) && identityList.length > 0) {
        setIdentities(identityList);
        
        // 각 유저별로 사이트 목록 병렬로 가져오기 (성능 개선)
        const sitesPromises = identityList.map(async (identity) => {
          try {
            const sitesResponse = await axiosInstance.get(`/sites?identity_id=${identity.id}`);
            const rawSites = sitesResponse.data?.sites || sitesResponse.data || [];
            const approvedSites = getApprovedSites(rawSites);
            
            // 장점검/수동입력 사이트 필터링 (loadPendingSites 로직 통합)
            const pendingList = [];
            for (const site of rawSites) {
              const status = site.status || '';
              const pureStatus = status.split('/').map(s => s.trim()).pop() || '';
              const statusWithoutDate = pureStatus.replace(/^\d{1,2}\.\d{1,2}\s*/, '').trim();
              const statusWithoutManual = statusWithoutDate.replace(/^수동입력\s+/, '').trim();
              
              const validStatuses = ['가입전', '대기', '승인', '팅', '졸업'];
              const isPending = statusWithoutManual.includes('장점검') || 
                               (!validStatuses.includes(statusWithoutManual) && statusWithoutManual !== '');
              
              if (isPending) {
                pendingList.push({
                  identityName: identity.name,
                  siteName: site.site_name,
                  siteId: site.id,
                  status: status,
                  notes: site.notes || '', // 사이트 관리의 메모 필드
                  identityId: identity.id,
                  site: site // 전체 사이트 정보 저장 (모달에서 사용)
                });
              }
            }
            
            return { 
              identityId: identity.id, 
              sites: approvedSites,
              pendingSites: pendingList
            };
          } catch (err) {
            console.error(`유저 ${identity.id}의 사이트 로드 실패:`, err);
            return { identityId: identity.id, sites: [], pendingSites: [] };
          }
        });
        
        const sitesResults = await Promise.all(sitesPromises);
        const sitesMap = {};
        const allPendingSites = [];
        sitesResults.forEach(({ identityId, sites, pendingSites }) => {
          sitesMap[identityId] = sites;
          allPendingSites.push(...pendingSites);
        });
        setIdentitySitesMap(sitesMap);
        setPendingSites(allPendingSites);
      } else if (response.data?.success === false) {
        console.error('[DRBet] 유저 로드 실패:', response.data.message || '알 수 없는 오류');
        toast.error(response.data.message || '유저 목록을 불러오는데 실패했습니다');
        setIdentities([]);
        setIdentitySitesMap({});
        setPendingSites([]);
      } else {
        // 빈 배열인 경우
        setIdentities([]);
        setIdentitySitesMap({});
        setPendingSites([]);
      }
    } catch (error) {
      console.error('[DRBet] 유저 로드 실패:', error);
      console.error('[DRBet] 오류 상세:', error.response?.data || error.message);
      toast.error(`유저 목록을 불러오는데 실패했습니다: ${error.response?.data?.message || error.message}`);
      setIdentities([]);
      setIdentitySitesMap({});
      setPendingSites([]);
    }
  }, [getApprovedSites]);

  // filterRecordsByDate는 useMemo로 대체됨 (위의 filteredRecords)

  // 주의 시작일(월요일)과 종료일(일요일) 계산 (페이백 계산용)
  const getWeekRange = (dateStr) => {
    // 페이백 날짜 기준으로 전날까지의 7일 계산
    const date = new Date(dateStr);
    
    // 종료일: 페이백 날짜 전날
    const endDate = new Date(date);
    endDate.setDate(date.getDate() - 1);
    
    // 시작일: 종료일로부터 6일 전 (총 7일간)
    const startDate = new Date(endDate);
    startDate.setDate(endDate.getDate() - 6);
    
    return {
      start: getKSTDateString(startDate),
      end: getKSTDateString(endDate)
    };
  };

  // 실제 주간 범위 계산 (이주의 충환 정보 표시용: 월요일 ~ 일요일)
  const getActualWeekRange = (dateStr) => {
    const date = new Date(`${dateStr}T00:00:00+09:00`);
    const dayOfWeek = date.getDay(); // 0=일요일, 1=월요일, ..., 6=토요일
    
    // 월요일로부터 며칠 지났는지 계산 (월요일=0, 일요일=6)
    const daysFromMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
    
    // 시작일: 월요일
    const startDate = new Date(date);
    startDate.setDate(date.getDate() - daysFromMonday);
    
    // 종료일: 일요일
    const endDate = new Date(startDate);
    endDate.setDate(startDate.getDate() + 6);
    
    return {
      start: getKSTDateString(startDate),
      end: getKSTDateString(endDate)
    };
  };

  /*
  // 페이백 금액 계산
  const calculatePaybacks = async () => {
    if (allRecords.length === 0) {
      log('[페이백] allRecords가 비어있어 페이백 계산을 건너뜁니다');
      setPaybackData([]);
      return;
    }
    
    log('[페이백] 계산 시작', {
      selectedDate,
      allRecordsCount: allRecords.length,
      sampleRecords: allRecords.slice(0, 3).map(r => ({
        date: r.record_date,
        identity1: r.identity1,
        site1: r.site_name1
      }))
    });

    const weekRange = getWeekRange(selectedDate);
    
    const weekRecords = allRecords.filter(record => 
      record.record_date >= weekRange.start && record.record_date <= weekRange.end
    );

    // 사이트별로 충전/환전 합산
    const siteStats = {};
    
    weekRecords.forEach((record) => {
      try {
        // 각 사이트 컬럼(1~4)에서 충전/환전 정보 추출 (유저별로)
        for (let i = 1; i <= 4; i++) {
          const identityName = record[`identity${i}`];
          const siteName = record[`site_name${i}`];
          const chargeWithdraw = record[`charge_withdraw${i}`];
          
          if (identityName && identityName.trim() && siteName && siteName.trim()) {
            const trimmedSiteName = siteName.trim();
            // 페이백 설정 조회를 위해 전체 사이트 이름 사용 (substring 제거)
            let deposit = 0;
            let withdraw = 0;
            
            // charge_withdraw 필드에서 충전/환전 추출
            if (chargeWithdraw && chargeWithdraw.trim()) {
              const parts = chargeWithdraw.trim().split(/\s+/);
              
              if (parts.length >= 2) {
                deposit = parseFloat(parts[0]) || 0;
                withdraw = parseFloat(parts[1]) || 0;
              } else if (parts.length === 1) {
                deposit = parseFloat(parts[0]) || 0;
              }
            }
            
            // 유저별 사이트 통계를 위한 복합 키 생성 (계정ID 포함)
            const accountId = record.account_id || 'unknown';
            const statsKey = `${accountId}-${identityName}-${trimmedSiteName}`;
            
            if (trimmedSiteName && trimmedSiteName.length >= 2) {
              if (!siteStats[statsKey]) {
                siteStats[statsKey] = {
                  accountId,
                  identityName: identityName,
                  siteName: trimmedSiteName, // 전체 사이트 이름 저장
                  weeklyDeposit: 0,
                  weeklyWithdraw: 0,
                  todayDeposit: 0,
                  todayWithdraw: 0
                };
              }

              siteStats[statsKey].weeklyDeposit += deposit;
              siteStats[statsKey].weeklyWithdraw += withdraw;

              // 선택한 날짜의 데이터인 경우
              if (record.record_date === selectedDate) {
                siteStats[statsKey].todayDeposit += deposit;
                siteStats[statsKey].todayWithdraw += withdraw;
              }
            }
          }
        }
      } catch (e) {
        console.error('레코드 처리 오류:', e, record);
      }
    });

    // 현재 날짜의 요일 확인
    const currentDate = new Date(selectedDate);
    const dayNames = ['일', '월', '화', '수', '목', '금', '토'];
    const currentDayName = dayNames[currentDate.getDay()];

    // 각 유저별 사이트의 페이백 설정 가져오기 (병렬 처리로 속도 향상)
    const paybackResults = [];
    const statsKeys = Object.keys(siteStats);
    
    // 모든 사이트 노트를 병렬로 미리 조회
    const siteNotesMap = {};
    if (statsKeys.length > 0) {
      const siteNotesPromises = statsKeys.map(async (statsKey) => {
        const stats = siteStats[statsKey];
        const { identityName, siteName } = stats;
        const siteNotes = await fetchSiteNotes(siteName, identityName);
        return { statsKey, siteNotes };
      });
      
      const siteNotesResults = await Promise.all(siteNotesPromises);
      siteNotesResults.forEach(({ statsKey, siteNotes }) => {
        siteNotesMap[statsKey] = siteNotes;
      });
    }
    
    for (const statsKey of statsKeys) {
      const stats = siteStats[statsKey];
      const { identityName, siteName, accountId } = stats;
      
      const siteNotes = siteNotesMap[statsKey];
      const paybackConfig = siteNotes?.data?.payback || {};
      
      log('[페이백] 사이트 설정 조회', {
        identityName,
        siteName,
        hasPaybackConfig: !!paybackConfig,
        percent: paybackConfig.percent,
        sameDayPercent: paybackConfig.sameDayPercent,
        days: paybackConfig.days
      });
      
      const percent = parseFloat(paybackConfig.percent) || 0;
      const sameDayPercent = parseFloat(paybackConfig.sameDayPercent) || 0;
      const days = paybackConfig.days || [];

      if (days.length === 0 || (percent === 0 && sameDayPercent === 0)) {
        continue;
      }
      const weeklyNet = stats.weeklyDeposit - stats.weeklyWithdraw;
      const todayNet = stats.todayDeposit - stats.todayWithdraw;

      // 페이백 계산
      const paybackAmounts = {};
      const sameDayPayback = {};
      
      const dateObj = new Date(selectedDate);
      const month = String(dateObj.getMonth() + 1).padStart(2, '0');
      const dateNum = String(dateObj.getDate()).padStart(2, '0');
      const dateLabel = `${month}-${dateNum}`;
      
      days.forEach(day => {
          if (day === '당일') {
            if (sameDayPercent > 0 && todayNet > 0) {
              const rawWon = todayNet * 10000 * (sameDayPercent / 100);
              const amountInWon = Math.floor(rawWon / 100) * 100; // 100원 단위
              const amount = amountInWon / 10000;
              sameDayPayback[`당일(${dateLabel}) 페이백`] = amount;
            }
          } else {
            if (currentDayName === day && percent > 0 && weeklyNet > 0) {
              const rawWon = weeklyNet * 10000 * (percent / 100);
              const amountInWon = Math.floor(rawWon / 100) * 100; // 100원 단위
              const amount = amountInWon / 10000;
              paybackAmounts[day] = amount;
            }
          }
      });
      
      // 요일 페이백을 먼저 추가하고, 당일 페이백을 나중에 추가
      Object.assign(paybackAmounts, sameDayPayback);



      if (Object.keys(paybackAmounts).length > 0) {
        // 출석 타입 가져오기
        const attendanceType = siteNotes?.data?.attendanceType || '자동';
        
        // 페이백 지급 여부 확인
        const weekRange = getWeekRange(selectedDate);
        const weekStartDate = weekRange.start;
        const clearedMap = siteNotes?.data?.paybackCleared || {};
        const isCleared = !!clearedMap[weekStartDate];
        
        // 페이백 지급 여부 캐시 업데이트
        const paybackKey = `${identityName}||${siteName}||${weekStartDate}`;
        setPaybackClearedMap(prev => ({
          ...prev,
          [paybackKey]: isCleared
        }));
        
        paybackResults.push({
          accountId,
          identityName,
          siteName,
          paybackAmounts,
          weeklyNet,
          todayNet,
          percent,
          sameDayPercent,
          attendanceType
        });
      } else {





      }
    }



    setPaybackData(paybackResults);
  };
  */

  // 정착 배너 계산 역시 서버 요약 API(fetchDailySummary)에서 수행됩니다.

  // 페이백 금액 계산 로직은 서버 요약 API(fetchDailySummary)로 이전되었습니다.

  // 사이트 메타데이터 조회 (유저별 출석일 포함)
  const fetchSiteNotes = async (siteName, identityName = null, options = {}) => {
    if (!siteName) return null;
    const cacheKey = getSiteNotesCacheKey(siteName, identityName);
    if (!options.force && siteNotesCacheRef.current[cacheKey]) {
      return siteNotesCacheRef.current[cacheKey];
    }

    await bulkFetchSiteNotes(
      [{ siteName, identityName }],
      { force: options.force }
    );

    return siteNotesCacheRef.current[cacheKey] || null;
  };

  // 정착 시작일 계산: 해당 유저/사이트로 충환전이 최초 기록된 날짜
  const findSettlementStartDate = (identityName, siteName) => {
    const dates = allRecords
      .filter(r => !!r.record_date)
      .filter(r => {
        for (let i = 1; i <= 4; i++) {
          if (r[`identity${i}`] === identityName && r[`site_name${i}`] === siteName && r[`charge_withdraw${i}`]) {
            return true;
          }
        }
        return false;
      })
      .map(r => r.record_date)
      .sort();
    return dates.length > 0 ? dates[0] : null;
  };

  /*
  // 정착 금액 배너 계산 함수 (외부에서도 호출 가능하도록 분리)
  const computeSettlementBanner = async () => {
      try {
        log('[정착배너] 계산 시작', {
          selectedDate,
          recordsCount: records.length,
          allRecordsCount: allRecords.length,
          sampleRecords: allRecords.slice(0, 3).map(r => ({
            date: r.record_date,
            identity1: r.identity1,
            site1: r.site_name1
          }))
        });
        // 수집: 현재 화면(records)에 표시된 (identity, site) 쌍만 대상으로 계산
        // (요청: 등록되어 보이는 항목만 디버그/배너 대상으로)
        const pairs = new Set();
        records.forEach(rec => {
          for (let i = 1; i <= 4; i++) {
            const idn = rec[`identity${i}`];
            const site = rec[`site_name${i}`];
            if (idn && site) pairs.add(`${idn}||${site}`);
          }
        });
        log('[정착배너] 대상 쌍', Array.from(pairs));

        // 사이트별 설정 캐시 채우기 (병렬 처리로 속도 향상)
        const configs = { ...settlementConfigs };
        const sitesToLoad = [];
        for (const key of Array.from(pairs)) {
          const [, site] = key.split('||');
          if (!configs[site]) {
            sitesToLoad.push(site);
          }
        }
        
        // 병렬로 사이트 설정 조회
        if (sitesToLoad.length > 0) {
          const siteNotesResults = await Promise.all(
            sitesToLoad.map(site => fetchSiteNotes(site))
          );
          sitesToLoad.forEach((site, index) => {
            configs[site] = siteNotesResults[index] || {};
            log('[정착배너] 사이트 설정 로드', site, configs[site]);
          });
        }
        setSettlementConfigs(configs);

        // 각 쌍에 대해 조건 충족 검사
        const banners = [];
        const debugRows = [];
        const pairsArray = Array.from(pairs);
        
        // 유저별 사이트 노트를 병렬로 미리 조회
        const notesForIdsMap = {};
        const notesToLoad = pairsArray.map(key => {
          const [idn, site] = key.split('||');
          return { key, idn, site };
        });
        
        if (notesToLoad.length > 0) {
          const notesResults = await Promise.all(
            notesToLoad.map(({ site, idn }) => fetchSiteNotes(site, idn))
          );
          notesToLoad.forEach(({ key }, index) => {
            notesForIdsMap[key] = notesResults[index];
          });
        }
        
        for (const key of pairsArray) {
          const [idn, site] = key.split('||');
          const cfg = configs[site] || {};
          const cfgData = cfg.data || {};
          const rules = Array.isArray(cfgData.settlementRules) ? cfgData.settlementRules : [];
          const settlementFlag = cfgData.settlement || '-';
          const days = parseInt(cfgData.settlementDays) || 0; // 단일 기간 적용

          // 시작일 계산 시도 (미리 조회한 데이터 사용)
          const notesForId = notesForIdsMap[key];
          let startDate = notesForId?.startDate || findSettlementStartDate(idn, site) || '';
          const startStr = startDate || '';
          const endStr = startStr ? addDaysStr(startStr, Math.max(days - 1, 0)) : '';

        // 기간 내 충전 합계(만 단위 -> 원 단위 계산 후 100원 단위로 반올림)
        let totalChargeWon = 0;
          if (startStr && endStr) {
            allRecords.forEach(r => {
              const dateStr = r.record_date;
              if (!dateStr || dateStr < startStr || dateStr > endStr) return;
              for (let i = 1; i <= 4; i++) {
                if (r[`identity${i}`] === idn && r[`site_name${i}`] === site) {
                  const cw = r[`charge_withdraw${i}`];
                  if (cw && cw.trim()) {
                    const p = cw.trim().split(/\s+/);
                  const amount = parseFloat(p[0]) || 0;
                  totalChargeWon += amount * 10000;
                  }
                }
              }
            });
          }

        const totalChargeWonRounded = Math.floor(totalChargeWon / 100) * 100;
        const totalChargeManRounded = totalChargeWonRounded / 10000;

          // 디버그 행은 조건과 무관하게 모두 출력
          debugRows.push({
            유저: idn,
            사이트: site,
            기간: startStr && endStr ? `${startStr} ~ ${endStr}` : '(시작일 없음)',
          '충전 합계(만)': totalChargeManRounded,
            '정착 유무': settlementFlag,
            포인트: (rules[0]?.point || cfgData.settlementPoint || '-') ,
            '목표(만)': (rules[0]?.total || cfgData.settlementTotal || 0),
            통과: settlementFlag === 'O' && !!startStr && !!endStr && !!days
          });

        // 배너는 규칙별로 확인: 이미 지급되지 않았고 조건을 충족한 규칙을 모두 추가
        const clearedIndices = (notesForId?.data?.settlementCleared && notesForId.data.settlementCleared[startStr]) || [];
        const clearedSet = new Set(Array.isArray(clearedIndices) ? clearedIndices : []);
        const legacyCleared = notesForId?.data?.settlementClearedStart && (notesForId.data.settlementClearedStart === startStr);

        if (settlementFlag === 'O' && !!startStr && !!endStr && !!days) {
          if (Array.isArray(rules) && rules.length > 0) {
            rules.forEach((rule, idx) => {
              const ruleTarget = parseFloat(rule.total) || 0;
              if (!ruleTarget) return;
              const ruleTargetWon = ruleTarget * 10000;
              if (clearedSet.has(idx)) return; // 이미 지급된 규칙은 제외
              if (legacyCleared && idx === 0) return; // 구버전 단일 체크 호환
              if (totalChargeWonRounded >= ruleTargetWon) {
                const pointRaw = rule.point || '';
                const pointNum = pointRaw !== null && pointRaw !== undefined && /^\d+(\.\d+)?$/.test(String(pointRaw))
                  ? parseFloat(pointRaw)
                  : null;
                const pointDisplay = pointNum !== null ? `${pointNum}만` : (String(pointRaw) || '-');
                banners.push({ identity: idn, site, startDate: startStr, totalTarget: ruleTarget, totalCharge: totalChargeManRounded, pointDisplay, days, ruleIndex: idx });
              }
            });
          } else {
            // 규칙이 없고 단일 필드 사용 시 기존 방식 유지
            const targetSingle = parseFloat(cfgData.settlementTotal) || 0;
            const targetSingleWon = targetSingle * 10000;
            if (!legacyCleared && !!targetSingle && totalChargeWonRounded >= targetSingleWon) {
              const pointRaw = cfgData.settlementPoint || '';
              const pointNum = pointRaw !== null && pointRaw !== undefined && /^\d+(\.\d+)?$/.test(String(pointRaw))
                ? parseFloat(pointRaw)
                : null;
              const pointDisplay = pointNum !== null ? `${pointNum}만` : (String(pointRaw) || '-');
              banners.push({ identity: idn, site, startDate: startStr, totalTarget: targetSingle, totalCharge: totalChargeManRounded, pointDisplay, days });
            }
          }
        }
        }

        // 정렬: 합계 큰 순
        banners.sort((a, b) => (b.totalCharge - a.totalCharge));
        setSettlementBanners(banners);
        log('\n[정착배너] 계산 요약');
        logTable(debugRows);
        log('[정착배너] 배너 노출 대상', banners);
      } catch (err) {
        console.error('정착 배너 계산 실패:', err);
      }
  };
  */

  // 클릭: 편집 모달 열기 (현재 행의 유저를 정리한사람으로 기록)
  const openSiteNotesEditor = async (record, siteIndex) => {
    const siteField = `site_name${siteIndex}`;
    const identityField = `identity${siteIndex}`;
    const siteName = record[siteField];
    const identityName = record[identityField] || '';
    if (!siteName) {
      toast.error('사이트를 먼저 선택하세요');
      return;
    }
    const existing = await fetchSiteNotes(siteName, identityName);
    
    // 이달의 충환 정보 계산 (유저별 필터링)
    const yearMonth = selectedDate.substring(0, 7); // "YYYY-MM"
    const monthlyRecords = allRecords.filter(r => r.record_date && r.record_date.startsWith(yearMonth));
    

    
    let totalCharge = 0;
    let totalWithdraw = 0;
    // 날짜별 재충 횟수(동일 유저+사이트가 하루에 2건 이상인 경우: (건수-1))
    const dailyCounts = {};
    
    monthlyRecords.forEach(rec => {
      // site_name1~4와 charge_withdraw1~4 확인
      for (let i = 1; i <= 4; i++) {
        const siteNameField = `site_name${i}`;
        const identityField = `identity${i}`;
        const chargeWithdrawField = `charge_withdraw${i}`;
        
        // 사이트 이름 AND 유저 이름이 모두 일치하는 경우만
        if (rec[siteNameField] === siteName && rec[identityField] === identityName && rec[chargeWithdrawField]) {
          const parts = rec[chargeWithdrawField].split(' ');
          const charge = parseFloat(parts[0]) || 0;
          const withdraw = parseFloat(parts[1]) || 0;
          

          
          totalCharge += charge;
          totalWithdraw += withdraw;
          const d = rec.record_date;
          dailyCounts[d] = (dailyCounts[d] || 0) + 1;
        }
      }
    });
    
    const recovery = totalCharge - totalWithdraw;
    
    // 이주의 충환 정보 계산 (유저별 필터링)
    // 실제 주간 범위 사용 (월요일 ~ 일요일)
    const actualWeekRange = getActualWeekRange(selectedDate);
    const weeklyRecords = allRecords.filter(r => 
      r.record_date && r.record_date >= actualWeekRange.start && r.record_date <= actualWeekRange.end
    );
    
    let weeklyCharge = 0;
    let weeklyWithdraw = 0;
    
    weeklyRecords.forEach(rec => {
      // site_name1~4와 charge_withdraw1~4 확인
      for (let i = 1; i <= 4; i++) {
        const siteNameField = `site_name${i}`;
        const identityField = `identity${i}`;
        const chargeWithdrawField = `charge_withdraw${i}`;
        
        // 사이트 이름 AND 유저 이름이 모두 일치하는 경우만
        if (rec[siteNameField] === siteName && rec[identityField] === identityName && rec[chargeWithdrawField]) {
          const parts = rec[chargeWithdrawField].split(' ');
          const charge = parseFloat(parts[0]) || 0;
          const withdraw = parseFloat(parts[1]) || 0;
          
          weeklyCharge += charge;
          weeklyWithdraw += withdraw;
        }
      }
    });
    
    const weeklyRecovery = weeklyCharge - weeklyWithdraw;
    
    // 기존 데이터 구조를 새 구조로 변환
    const existingData = existing?.data || {};
    
    // 월 변경 체크하여 출석일 자동 초기화
    const currentMonth = getKSTMonthString(); // YYYY-MM
    const lastUpdated = existingData.lastUpdated || currentMonth;
    const rollover = existingData.rollover || 'X';
    let attendanceDays = existingData.attendanceDays || 0;
    
    // 월이 바뀌었고 이월 불가인 경우 출석일 초기화
    if (lastUpdated !== currentMonth && rollover !== 'O') {

      attendanceDays = 0;
    }
    
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
      settlementRules: existingData.settlementRules || [],
      settlementCleared: existingData.settlementCleared || {},
      payback: existingData.payback || { type: '수동', days: [], percent: '', sameDayPercent: '' },
      rate: existingData.rate || '',
      events: existingData.events || [],
      lastUpdated: currentMonth, // 현재 월로 업데이트
      // ✅ 정착 지급 완료 정보 추가
      settlement_paid: existingData.settlement_paid || false,
      settlement_paid_at: existingData.settlement_paid_at || null
    };
    
    // 구버전 호환성
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
    
    // 시작일 계산 (해당 유저/사이트의 최초 충환전 입력일)
    const startDate = findSettlementStartDate(identityName, siteName) || '';

    // 재충 배열 생성 (건수-1이 1 이상인 날만)
    const rechargeList = Object.entries(dailyCounts)
      .map(([date, cnt]) => ({ date, count: Math.max(0, cnt - 1) }))
      .filter(item => item.count > 0)
      .sort((a, b) => a.date.localeCompare(b.date));

    setSiteNotesModal({
      open: true,
      readonly: false,
      siteName,
      identityName,
      recordedBy: existing?.recorded_by_identity || '', // 기존 데이터의 정리한 사람 정보 사용
      startDate,
      monthlyStats: {
        totalCharge,
        totalWithdraw,
        recovery
      },
      weeklyStats: {
        totalCharge: weeklyCharge,
        totalWithdraw: weeklyWithdraw,
        recovery: weeklyRecovery
      },
      weekRange: actualWeekRange, // 실제 주간 범위 전달
      recharges: rechargeList,
      data: defaultData
    });
  };

  // 장점검/수동입력 사이트 우클릭: 사이트 수정 모달 열기
  const handlePendingSiteContextMenu = async (e, site) => {
    e.preventDefault();
    e.stopPropagation();
    
    // 기존 메뉴가 있으면 제거
    const existingMenu = document.getElementById('pending-site-context-menu');
    if (existingMenu) {
      try {
        document.body.removeChild(existingMenu);
      } catch (err) {
        // 이미 제거된 경우 무시
      }
    }
    
    // 컨텍스트 메뉴 생성
    const menu = document.createElement('div');
    menu.id = 'pending-site-context-menu';
    menu.className = 'fixed bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg shadow-lg z-50 py-1';
    menu.style.left = `${e.clientX}px`;
    menu.style.top = `${e.clientY}px`;
    
    const menuItem = document.createElement('div');
    menuItem.className = 'px-4 py-2 hover:bg-gray-100 dark:hover:bg-gray-700 cursor-pointer text-sm text-gray-900 dark:text-white';
    menuItem.textContent = '사이트 수정';
    
    let menuRemoved = false;
    const removeMenu = () => {
      if (menuRemoved) return;
      menuRemoved = true;
      try {
        if (menu.parentNode === document.body) {
          document.body.removeChild(menu);
        }
      } catch (err) {
        // 이미 제거된 경우 무시
      }
      document.removeEventListener('click', closeMenu);
    };
    
    menuItem.onclick = async () => {
      removeMenu();
      openSiteEditModalForPending(site);
    };
    menu.appendChild(menuItem);
    
    document.body.appendChild(menu);
    
    // 메뉴 외부 클릭 시 닫기
    const closeMenu = (event) => {
      if (!menu.contains(event.target)) {
        removeMenu();
      }
    };
    setTimeout(() => document.addEventListener('click', closeMenu), 0);
  };

  // 장점검/수동입력 사이트 수정 모달 열기
  const openSiteEditModalForPending = (site) => {
    if (!site || !site.site) {
      toast.error('사이트 정보를 불러올 수 없습니다');
      return;
    }
    
    const fullSite = site.site;
    setEditingSite(fullSite);
    setIsManualInputMode(false);
    setManualInputValue('');
    setSiteForm({
      site_name: fullSite.site_name || '',
      domain: fullSite.domain || '',
      referral_path: fullSite.referral_path || '',
      approval_call: fullSite.approval_call || false,
      identity_name: site.identityName || '',
      account_id: fullSite.account_id || '',
      password: fullSite.password || '',
      exchange_password: fullSite.exchange_password || '',
      nickname: fullSite.nickname || '',
      status: fullSite.status || '가입전',
      referral_code: fullSite.referral_code || '',
      category: fullSite.category || '',
      notes: fullSite.notes || ''
    });
    setShowSiteEditModal(true);
  };

  // 미등록 사이트 우클릭: 사이트 수정 모달 열기
  const handleUnregisteredSiteContextMenu = async (e, site) => {
    e.preventDefault();
    e.stopPropagation();
    
    // 기존 메뉴가 있으면 제거
    const existingMenu = document.getElementById('unregistered-site-context-menu');
    if (existingMenu) {
      try {
        document.body.removeChild(existingMenu);
      } catch (err) {
        // 이미 제거된 경우 무시
      }
    }
    
    // 컨텍스트 메뉴 생성
    const menu = document.createElement('div');
    menu.id = 'unregistered-site-context-menu';
    menu.className = 'fixed bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg shadow-lg z-50 py-1';
    menu.style.left = `${e.clientX}px`;
    menu.style.top = `${e.clientY}px`;
    
    const menuItem = document.createElement('div');
    menuItem.className = 'px-4 py-2 hover:bg-gray-100 dark:hover:bg-gray-700 cursor-pointer text-sm text-gray-900 dark:text-white';
    menuItem.textContent = '사이트 수정';
    
    let menuRemoved = false;
    const removeMenu = () => {
      if (menuRemoved) return;
      menuRemoved = true;
      try {
        if (menu.parentNode === document.body) {
          document.body.removeChild(menu);
        }
      } catch (err) {
        // 이미 제거된 경우 무시
      }
      document.removeEventListener('click', closeMenu);
    };
    
    menuItem.onclick = async () => {
      removeMenu();
      openSiteEditModalForUnregistered(site);
    };
    menu.appendChild(menuItem);
    
    document.body.appendChild(menu);
    
    // 메뉴 외부 클릭 시 닫기
    const closeMenu = (event) => {
      if (!menu.contains(event.target)) {
        removeMenu();
      }
    };
    setTimeout(() => document.addEventListener('click', closeMenu), 0);
  };

  // 미등록 사이트 수정 모달 열기
  const openSiteEditModalForUnregistered = (site) => {
    if (!site || !site.site) {
      toast.error('사이트 정보를 불러올 수 없습니다');
      return;
    }
    
    const fullSite = site.site;
    setEditingSite(fullSite);
    setIsManualInputMode(false);
    setManualInputValue('');
    setSiteForm({
      site_name: fullSite.site_name || '',
      domain: fullSite.domain || '',
      referral_path: fullSite.referral_path || '',
      approval_call: fullSite.approval_call || false,
      identity_name: site.identityName || '',
      account_id: fullSite.account_id || '',
      password: fullSite.password || '',
      exchange_password: fullSite.exchange_password || '',
      nickname: fullSite.nickname || '',
      status: fullSite.status || '가입전',
      referral_code: fullSite.referral_code || '',
      category: fullSite.category || '',
      notes: fullSite.notes || ''
    });
    setShowSiteEditModal(true);
  };

  // 사이트 저장 (사이트 관리와 동일)
  const saveSite = async () => {
    try {
      // siteForm.status는 이미 셀렉트박스 onChange에서 날짜와 함께 처리됨
      const dataToSave = {
        ...siteForm,
        status: siteForm.status || editingSite?.status || ''
      };
      
      if (editingSite) {
        await axiosInstance.put(`/sites/${editingSite.id}`, dataToSave);
        toast.success('사이트가 수정되었습니다');
        // 사이트 목록 새로고침
        loadIdentities();
      } else {
        // 미등록 사이트는 수정만 가능
        toast.error('사이트를 찾을 수 없습니다');
        return;
      }
      
      setShowSiteEditModal(false);
    } catch (error) {
      console.error('사이트 저장 실패:', error);
      toast.error('사이트 저장에 실패했습니다');
    }
  };

  // 사이트 우클릭: 컨텍스트 메뉴 표시
  const handleSiteContextMenu = async (e, record, siteIndex, currentIdentity, siteName) => {
    e.preventDefault();
    e.stopPropagation();
    
    // 기존 메뉴가 있으면 제거
    const existingMenu = document.getElementById('site-context-menu');
    if (existingMenu) {
      try {
        document.body.removeChild(existingMenu);
      } catch (err) {
        // 이미 제거된 경우 무시
      }
    }
    
    // 컨텍스트 메뉴 생성
    const menu = document.createElement('div');
    menu.id = 'site-context-menu';
    menu.className = 'fixed bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg shadow-lg z-50 py-1';
    menu.style.left = `${e.clientX}px`;
    menu.style.top = `${e.clientY}px`;
    
    // 사이트 정보기록 메뉴 항목
    const menuItem1 = document.createElement('div');
    menuItem1.className = 'px-4 py-2 hover:bg-gray-100 dark:hover:bg-gray-700 cursor-pointer text-sm text-gray-900 dark:text-white';
    menuItem1.textContent = '사이트 정보기록';
    
    // 사이트 계정 정보 메뉴 항목
    const menuItem2 = document.createElement('div');
    menuItem2.className = 'px-4 py-2 hover:bg-gray-100 dark:hover:bg-gray-700 cursor-pointer text-sm text-gray-900 dark:text-white';
    menuItem2.textContent = '사이트 계정 정보';
    
    let menuRemoved = false;
    const removeMenu = () => {
      if (menuRemoved) return;
      menuRemoved = true;
      try {
        if (menu.parentNode === document.body) {
          document.body.removeChild(menu);
        }
      } catch (err) {
        // 이미 제거된 경우 무시
      }
      document.removeEventListener('click', closeMenu);
    };
    
    menuItem1.onclick = async () => {
      removeMenu();
      await openSiteNotesEditor(record, siteIndex);
    };
    
    menuItem2.onclick = () => {
      removeMenu();
      // 사이트 계정 정보 찾기
      const identityId = currentIdentity.id;
      const sites = identitySitesMap[identityId] || [];
      const siteInfo = sites.find(s => s.site_name === siteName);
      
      if (siteInfo) {
        setSiteAccountInfo({
          identityName: currentIdentity.name,
          siteName: siteInfo.site_name,
          account_id: siteInfo.account_id || '',
          password: siteInfo.password || '',
          exchange_password: siteInfo.exchange_password || '',
          nickname: siteInfo.nickname || ''
        });
        setShowSiteAccountModal(true);
      } else {
        toast.error('사이트 계정 정보를 찾을 수 없습니다');
      }
    };
    
    menu.appendChild(menuItem1);
    menu.appendChild(menuItem2);
    
    document.body.appendChild(menu);
    
    // 메뉴 외부 클릭 시 닫기
    const closeMenu = (event) => {
      if (!menu.contains(event.target)) {
        removeMenu();
      }
    };
    setTimeout(() => document.addEventListener('click', closeMenu), 0);
  };

  // 우클릭: 조회/수정 모달 열기
  const openSiteNotesViewer = async (siteName) => {
    if (!siteName) return;
    const existing = await fetchSiteNotes(siteName);
    if (!existing) {
      toast('등록된 메타데이터가 없습니다');
      return;
    }
    
    // 기존 데이터 구조를 새 구조로 변환
    const existingData = existing.data || {};
    
    // 월 변경 체크하여 출석일 자동 초기화
    const currentMonth = getKSTMonthString(); // YYYY-MM
    const lastUpdated = existingData.lastUpdated || currentMonth;
    const rollover = existingData.rollover || 'X';
    let attendanceDays = existingData.attendanceDays || 0;
    
    // 월이 바뀌었고 이월 불가인 경우 출석일 초기화
    if (lastUpdated !== currentMonth && rollover !== 'O') {

      attendanceDays = 0;
    }
    
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
      settlementRules: existingData.settlementRules || [],
      settlementCleared: existingData.settlementCleared || {},
      payback: existingData.payback || { type: '수동', days: [], percent: '', sameDayPercent: '' },
      rate: existingData.rate || '',
      events: existingData.events || [],
      lastUpdated: currentMonth, // 현재 월로 업데이트
      // ✅ 정착 지급 완료 정보 추가 (우클릭 시)
      settlement_paid: existingData.settlement_paid || false,
      settlement_paid_at: existingData.settlement_paid_at || null
    };
    
    // 구버전 호환성
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
    
    // 이달의 충환 정보 계산 (현재 계정의 모든 유저 합계)
    const yearMonth = selectedDate.substring(0, 7); // "YYYY-MM"
    const monthlyRecords = allRecords.filter(r => r.record_date && r.record_date.startsWith(yearMonth));
    

    
    let totalCharge = 0;
    let totalWithdraw = 0;
    
    monthlyRecords.forEach(record => {
      // site_name1~4와 charge_withdraw1~4 확인
      for (let i = 1; i <= 4; i++) {
        const siteNameField = `site_name${i}`;
        const chargeWithdrawField = `charge_withdraw${i}`;
        
        // 현재 계정의 모든 유저 데이터 (allRecords는 이미 계정별로 필터링됨)
        if (record[siteNameField] === siteName && record[chargeWithdrawField]) {
          const parts = record[chargeWithdrawField].split(' ');
          const charge = parseFloat(parts[0]) || 0;
          const withdraw = parseFloat(parts[1]) || 0;
          

          
          totalCharge += charge;
          totalWithdraw += withdraw;
        }
      }
    });
    
    const recovery = totalCharge - totalWithdraw;
    
    // 이주의 충환 정보 계산 (현재 계정의 모든 유저 합계)
    // 실제 주간 범위 사용 (월요일 ~ 일요일)
    const actualWeekRange = getActualWeekRange(selectedDate);
    const weeklyRecords = allRecords.filter(r => 
      r.record_date && r.record_date >= actualWeekRange.start && r.record_date <= actualWeekRange.end
    );
    
    let weeklyCharge = 0;
    let weeklyWithdraw = 0;
    
    weeklyRecords.forEach(record => {
      // site_name1~4와 charge_withdraw1~4 확인
      for (let i = 1; i <= 4; i++) {
        const siteNameField = `site_name${i}`;
        const chargeWithdrawField = `charge_withdraw${i}`;
        
        // 현재 계정의 모든 유저 데이터 (allRecords는 이미 계정별로 필터링됨)
        if (record[siteNameField] === siteName && record[chargeWithdrawField]) {
          const parts = record[chargeWithdrawField].split(' ');
          const charge = parseFloat(parts[0]) || 0;
          const withdraw = parseFloat(parts[1]) || 0;
          
          weeklyCharge += charge;
          weeklyWithdraw += withdraw;
        }
      }
    });
    
    const weeklyRecovery = weeklyCharge - weeklyWithdraw;
    
    setSiteNotesModal({
      open: true,
      readonly: false, // 수정 가능하도록 변경
      siteName,
      identityName: '', // 우클릭 시에는 유저 정보 없음 (모든 유저 합계 표시)
      recordedBy: existing.recorded_by_identity || '',
      monthlyStats: {
        totalCharge,
        totalWithdraw,
        recovery
      },
      weeklyStats: {
        totalCharge: weeklyCharge,
        totalWithdraw: weeklyWithdraw,
        recovery: weeklyRecovery
      },
      weekRange: actualWeekRange, // 실제 주간 범위 전달
      data: defaultData
    });
  };

  const saveSiteNotes = async (modalData = null, updateRecordedBy = false) => {
    // 중복 실행 방지
    if (savingSiteNotesRef.current) {
      log('사이트 정보 저장 중... 중복 요청 무시');
      return;
    }
    
    try {
      savingSiteNotesRef.current = true;
      
      // modalData가 전달되면 사용, 없으면 siteNotesModal.data 사용 (하위 호환성)
      const currentData = modalData || siteNotesModal.data || {};
      const d = currentData;
      
      // 정착 규칙 유효성 검사: 누적금액/포인트 + 단일 기간 필수
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

      log('[DRBet] 저장할 데이터:', {
        site_name: (siteNotesModal.siteName || '').trim(),
        chargeMin: currentData.chargeMin,
        chargeMax: currentData.chargeMax,
        fullData: currentData
      });
      
      const response = await axiosInstance.post('/site-notes', {
        site_name: (siteNotesModal.siteName || '').trim(), // ✅ 공백 제거
        identity_name: (siteNotesModal.identityName || '').trim() || null, // ✅ 공백 제거
        // updateRecordedBy: 이벤트/메모가 변경된 경우에만 true
        updateRecordedBy: updateRecordedBy,
        data: currentData
      });
      
      log('[DRBet] 저장 응답:', response.data);
      
      // 서버에서 받은 recorded_by 정보로 업데이트
      if (response.data.recorded_by) {
        setSiteNotesModal(prev => ({ 
          ...prev, 
          recordedBy: response.data.recorded_by 
        }));
      }
      updateSiteNotesCache(
        siteNotesModal.siteName,
        siteNotesModal.identityName || null,
        {
          ...(siteNotesCacheRef.current[getSiteNotesCacheKey(siteNotesModal.siteName, siteNotesModal.identityName || null)] || {}),
          site_name: siteNotesModal.siteName,
          recorded_by_identity: response.data.recorded_by || siteNotesModal.recordedBy || '',
          data: currentData
        }
      );
      
      toast.success('사이트 정보가 저장되었습니다');
      setSiteNotesModal(prev => ({ ...prev, open: false }));
      
      // 출석 관련 정보가 변경되었을 수 있으므로 캐시 무효화
      if (siteNotesModal.siteName && siteNotesModal.identityName) {
        invalidateAttendanceCache(siteNotesModal.siteName, siteNotesModal.identityName);
      }
      
      // 페이백/정착 정보가 변경되었으므로 요약 재로드
      fetchDailySummary();
    } catch (e) {
      console.error('사이트 메타데이터 저장 실패:', e);
      toast.error('저장 실패');
    } finally {
      savingSiteNotesRef.current = false;
    }
  };

  // 배너에서 직접 지급 처리: 해당 유저/사이트/시작일에 대해 settlementCleared[startDate]에 규칙 인덱스 추가
  // 정착 지급 완료 처리 (단일 체크박스 - 모든 조건 영구 숨김)
  const markSettlementPaidFromBanner = async (identityName, siteName) => {
    try {
      const confirmed = window.confirm(
        `${siteName} - ${identityName}\n\n정착 지급을 완료하시겠습니까?\n\n✅ 확인 시:\n- 모든 정착 조건이 배너에서 영구적으로 사라집니다\n- 다시 표시하려면 사이트 정보에서 직접 수정해야 합니다`
      );
      
      if (!confirmed) return;
      
      // 새로운 API 호출: settlement_paid 플래그 설정
      await axiosInstance.post('/site-notes/settlement-paid', {
        site_name: siteName,
        identity_name: identityName,
        is_paid: true
      });

      // 캐시 업데이트
      const cacheKey = getSiteNotesCacheKey(siteName, identityName);
      const existing = siteNotesCacheRef.current[cacheKey] || {};
      updateSiteNotesCache(
        siteName,
        identityName,
        {
          ...existing,
          site_name: siteName,
          data: {
            ...(existing.data || {}),
            settlement_paid: true,
            settlement_paid_at: new Date().toISOString()
          }
        }
      );

      // 해당 사이트+유저의 모든 배너 제거
      setSettlementBanners(prev => prev.filter(b => !(
        b.identity === identityName && b.site === siteName
      )));
      
      // 요약 데이터 재로드
      await new Promise(resolve => setTimeout(resolve, 100));
      await fetchDailySummary();
      
      toast.success('✅ 정착 지급 완료 처리되었습니다. 더 이상 배너에 표시되지 않습니다.');
    } catch (e) {
      console.error('정착 지급 처리 실패:', e);
      const errorMsg = e.response?.data?.message || '지급 처리 실패';
      toast.error(errorMsg);
    }
  };

  // 사이트 출석 타입 로드
  const loadSiteAttendanceType = async (siteName, identityName = null, forceReload = false) => {
    if (!siteName) return '자동';
    
    const cacheKey = getAttendanceCacheKey(siteName, identityName);
    
    // 캐시 확인 (강제 재로드가 아닌 경우에만)
    if (!forceReload && siteAttendanceTypes[cacheKey]) {
      return siteAttendanceTypes[cacheKey];
    }
    
    try {
      const siteNotes = await fetchSiteNotes(siteName, identityName || null);
      const attendanceType = siteNotes?.data?.attendanceType || '자동';
      const rollover = siteNotes?.data?.rollover || 'X';
      const lastUpdated =
        siteNotes?.data?.attendanceLastRecordedAt ||
        siteNotes?.data?.lastUpdated ||
        getKSTMonthString(); // YYYY-MM 형식
      
      // 캐시에 저장
      setSiteAttendanceTypes(prev => ({
        ...prev,
        [cacheKey]: attendanceType
      }));
      
      setSiteRolloverStatus(prev => ({
        ...prev,
        [cacheKey]: rollover
      }));
      
      setSiteLastUpdated(prev => ({
        ...prev,
        [cacheKey]: lastUpdated
      }));
      
      return attendanceType;
    } catch (error) {
      console.error('출석 타입 로드 실패:', error);
      return '자동';
    }
  };

  // 사이트 삭제 함수
  const handleDeleteSite = async (record, siteIndex) => {
    const identityField = `identity${siteIndex}`;
    const siteField = `site_name${siteIndex}`;
    const chargeWithdrawField = `charge_withdraw${siteIndex}`;
    
    const identityValue = record[identityField] || '';
    const siteValue = record[siteField] || '';
    const chargeWithdrawValue = record[chargeWithdrawField] || '';
    
    // 유저, 사이트, 충환전이 모두 비어있으면 삭제할 것이 없음
    if (!identityValue && !siteValue && !chargeWithdrawValue) {
      return;
    }
    
    // 확인 다이얼로그
    const confirmMessage = `정말 삭제하시겠습니까?\n유저: ${identityValue || '(없음)'}\n사이트: ${siteValue || '(없음)'}\n충환전: ${chargeWithdrawValue || '(없음)'}`;
    if (!window.confirm(confirmMessage)) {
      return;
    }
    
    try {
      // 삭제 전 충전금액 확인 (자동 출석 감소용)
      const oldChargeWithdraw = chargeWithdrawValue || '';
      const oldIdentity = identityValue || '';
      const oldSite = siteValue || '';
      
      // 레코드 업데이트: 유저, 사이트, 충환전 필드를 모두 비움
      const updatedRecord = {
        ...record,
        [identityField]: '',
        [siteField]: '',
        [chargeWithdrawField]: ''
      };
      
      // 서버에 저장
      if (record.isNew || !record.id) {
        await axiosInstance.post('/drbet', updatedRecord);
      } else {
        await axiosInstance.put(`/drbet/${record.id}`, updatedRecord);
      }
      
      // 자동 출석 감소 처리 (유저+사이트+충전금액이 있었던 경우)
      if (oldIdentity && oldSite && oldChargeWithdraw) {
        // 충전금액이 있었는지 확인
        const parseCharge = (str) => {
          if (!str || str.trim() === '') return 0;
          const parts = str.split(' ');
          return parseFloat(parts[0]) || 0;
        };
        const oldCharge = parseCharge(oldChargeWithdraw);
        
        if (oldCharge > 0) {
          // 자동 출석 감소: 충전금액이 있었는데 없어지면 출석일 -1
          await handleAutoAttendance(oldSite, oldIdentity, oldChargeWithdraw, '', record, siteIndex);
        }
      }
      
      // 성능 최적화: 전체 목록 재로드 대신 로컬 상태만 업데이트
      setRecords(prev => prev.map(r => 
        r.id === record.id ? updatedRecord : r
      ));
      setAllRecords(prev => prev.map(r => 
        r.id === record.id ? updatedRecord : r
      ));
      setRefreshTick(prev => prev + 1);
      
      toast.success('사이트 정보가 삭제되었습니다');
    } catch (error) {
      console.error('사이트 삭제 실패:', error);
      toast.error('사이트 삭제에 실패했습니다');
    }
  };

  // 페이백 지급 처리 함수
  const markPaybackPaid = async (identityName, siteName, weekStartDate, currentCleared) => {
    try {
      const existing = await fetchSiteNotes(siteName, identityName);
      const existingData = existing?.data || {};
      const clearedMap = { ...(existingData.paybackCleared || {}) };
      
      // 토글: 현재 상태의 반대로 변경
      const newClearedState = !currentCleared;
      if (newClearedState) {
        clearedMap[weekStartDate] = true;
      } else {
        // false로 변경 시 해당 키 삭제
        delete clearedMap[weekStartDate];
      }
      
      const updated = {
        ...existingData,
        paybackCleared: clearedMap
      };
      
      await axiosInstance.post('/site-notes', {
        site_name: siteName,
        identity_name: identityName,
        data: updated
      });

      updateSiteNotesCache(
        siteName,
        identityName,
        {
          ...(siteNotesCacheRef.current[getSiteNotesCacheKey(siteName, identityName)] || {}),
          site_name: siteName,
          data: updated
        }
      );
      
      // paybackClearedMap 즉시 업데이트 (서버 응답 전에 UI 반영)
      const paybackKey = `${identityName}||${siteName}||${weekStartDate}`;
      setPaybackClearedMap(prev => ({
        ...prev,
        [paybackKey]: newClearedState
      }));
      
      toast.success(newClearedState ? '페이백 지급 처리되었습니다' : '페이백 지급 취소되었습니다');
      
      // 페이백 요약 재로드 (서버에서 최신 데이터 가져오기)
      // fetchDailySummary는 paybackClearedMap을 서버 값으로 업데이트함
      // 방금 저장한 값이 서버에 반영되어 있으므로 올바른 값이 반환됨
      await fetchDailySummary();
    } catch (e) {
      console.error('페이백 지급 처리 실패:', e);
      toast.error('페이백 지급 처리 실패');
      // 에러 발생 시 로컬 상태도 롤백
      const paybackKey = `${identityName}||${siteName}||${weekStartDate}`;
      setPaybackClearedMap(prev => ({
        ...prev,
        [paybackKey]: currentCleared
      }));
    }
  };

  // 출석 버튼 렌더링 함수 (인라인)
  const renderAttendanceButton = (record, siteIndex, siteValue, options = {}) => {
    const { variant = 'default', layout = 'column' } = options;
    const isCompactVariant = variant === 'compact';
    const isRowLayout = layout === 'row';
    // 사이트가 없으면 버튼 표시 안 함
    if (!siteValue) return null;
    
    const identityName = record[`identity${siteIndex}`] || '';
    const cacheKey = getAttendanceCacheKey(siteValue, identityName || null);
    const notesKey = getSiteNotesCacheKey(siteValue, identityName || null);
    
    // 출석 타입 확인 (siteNotes 캐시 우선, 없으면 타입 캐시)
    const cachedNotes = siteNotesCacheRef.current[notesKey];
    const attendanceTypeFromNotes = cachedNotes?.data?.attendanceType;
    const attendanceType = attendanceTypeFromNotes || siteAttendanceTypes[cacheKey] || '자동';
    
    // 출석일 가져오기 - 레코드의 _siteAttendanceDays 필드 우선 사용
    // 서버에서 normalizeName으로 정규화된 키를 사용하므로 클라이언트에서도 동일하게 정규화
    const normalizedIdentity = normalizeName(identityName);
    const normalizedSite = normalizeName(siteValue);
    const mapKey = `${normalizedIdentity}||${normalizedSite}`;
    
    // 우선순위: 레코드 필드 > 레코드 맵 > ref 캐시 > state 캐시
    const recordFieldValue = record[`_attendanceDays_${siteIndex}`];
    const recordMapValue = record._attendanceDays?.[mapKey];
    const refCacheValue = attendanceStatsCacheRef.current[cacheKey]?.consecutiveDays;
    const stateValue = siteAttendanceDays[cacheKey];
    
    // 우선순위: 레코드 필드 > 레코드 맵 > ref 캐시 > state 캐시
    // 레코드 필드가 undefined가 아닌 경우에도, 값이 0이면 레코드 맵을 확인 (업데이트된 값이 있을 수 있음)
    let attendanceDays;
    
    // 레코드 맵을 우선 확인 (가장 최신 값)
    if (recordMapValue !== undefined && recordMapValue !== null) {
      attendanceDays = recordMapValue;
    } else if (recordFieldValue !== undefined && recordFieldValue !== null) {
      // 레코드 필드에 값이 있으면 사용
      attendanceDays = recordFieldValue;
    } else if (refCacheValue !== undefined && refCacheValue !== null) {
      // ref 캐시에 값이 있으면 사용
      attendanceDays = refCacheValue;
    } else {
      // state 캐시 사용 (없으면 0)
      attendanceDays = stateValue || 0;
    }
    
    
    // 출석 상태 확인 (DB 값 우선, 없으면 state)
    const attendanceField = `attendance${siteIndex}`;
    const dbAttendanceValue = record[attendanceField];
    const key = `${record.id}-${siteIndex}`;
    const stateAttendanceValue = attendanceStates[key];
    
    // 충전금액 확인
    const chargeWithdrawField = `charge_withdraw${siteIndex}`;
    const chargeWithdraw = record[chargeWithdrawField] || '';
    const hasChargeValue = chargeWithdraw.trim() !== '';
    
    // 자동/수동 모두 충전금액이 없으면 출석 버튼 표시 안 함
    if (!hasChargeValue) {
      return null;
    }
    
    // 출석 여부 판단
    let hasAttended;
    log(attendanceType)
    if (attendanceType === '자동') {
      // 자동 모드: 충전금액으로 출석 여부 판단
      const parseCharge = (str) => {
        if (!str || str.trim() === '') return 0;
        const parts = str.split(' ');
        return parseFloat(parts[0]) || 0;
      };
      const charge = parseCharge(chargeWithdraw);
      hasAttended = charge > 0; // 충전금액이 있으면 출석 완료
    } else {
      // 수동 모드: 반드시 버튼을 눌러야 출석 인정
      // -> state 값이 있으면 state 사용, 없으면 "출필" 상태로 간주
      hasAttended = stateAttendanceValue !== undefined ? stateAttendanceValue : false;
    }
    
    // 페이백 지급 여부 확인
    const weekRange = getWeekRange(selectedDate);
    const weekStartDate = weekRange.start;
    const paybackInfo = paybackData.find(p => 
      p.identityName === identityName && p.siteName === siteValue && p.weekStartDate === weekStartDate
    );
    const hasPayback = !!paybackInfo && Object.keys(paybackInfo.paybackAmounts).length > 0;
    const paybackType = paybackInfo?.paybackType || '수동';
    const paybackKey = `${identityName}||${siteValue}||${weekStartDate}`;
    const paybackCleared = paybackInfo?.cleared ?? (paybackClearedMap[paybackKey] || false);
    
    // 재충전 여부 확인: 같은 유저, 같은 사이트에서 현재 레코드보다 앞에 있는 레코드가 있는지 확인
    const isRecharge = (() => {
      if (!identityName || !siteValue) return false;
      
      // 현재 레코드의 display_order
      const currentOrder = record.display_order || 0;
      
      // 동일한 유저/사이트를 가진 다른 레코드 찾기
      const duplicateRecords = records.filter(r => {
        if (r.id === record.id) return false; // 자기 자신 제외
        
        // siteIndex에 해당하는 유저/사이트가 동일한지 확인
        const otherIdentity = r[`identity${siteIndex}`];
        const otherSite = r[`site_name${siteIndex}`];
        
        return otherIdentity === identityName && otherSite === siteValue;
      });
      
      // 중복이 있으면 가장 위에 있는지 확인
      if (duplicateRecords.length > 0) {
        // 중복 레코드들의 display_order와 현재 레코드의 display_order를 모두 포함
        const allDuplicateRecords = [...duplicateRecords, record];
        const sortedRecords = allDuplicateRecords
          .map(r => ({
            record: r,
            order: r.display_order || 0,
            index: records.findIndex(item => item.id === r.id)
          }))
          .sort((a, b) => a.order - b.order || a.index - b.index);
        
        const baseRecord = sortedRecords[0]?.record;
        if (baseRecord) {
          const baseChargeField = `charge_withdraw${siteIndex}`;
          const baseChargeRaw = baseRecord[baseChargeField] || '';
          const baseChargeParts = baseChargeRaw.trim().split(/\s+/);
          const baseDeposit = baseChargeParts.length > 0 ? (parseFloat(baseChargeParts[0]) || 0) : 0;
          
          // 기준이 되는 첫 레코드에 충전금액이 없으면 재충으로 보지 않음
          if (baseDeposit <= 0) {
            return false;
          }
        }
        
        // 현재 레코드의 인덱스를 records 배열에서 찾기
        const currentIndex = records.findIndex(r => r.id === record.id);
        
        // 현재 레코드보다 앞에 있는 중복 레코드가 있는지 확인
        const hasEarlierDuplicate = records.slice(0, currentIndex).some(r => {
          const otherIdentity = r[`identity${siteIndex}`];
          const otherSite = r[`site_name${siteIndex}`];
          return otherIdentity === identityName && otherSite === siteValue;
        });
        
        // 앞에 중복이 있으면 재충전
        return hasEarlierDuplicate;
      }
      
      return false;
    })();
    
    // 재충전이면 출석/페이백 버튼 모두 표시 안 함
    if (isRecharge) return null;
    
    const attendanceLabel = hasAttended ? `출완(${attendanceDays})` : `출필(${attendanceDays})`;
    // 사이트 이름(및 유저)과 동일한 글자 크기 사용
    const textSizeClass = isCompactVariant ? 'text-sm' : 'text-lg';
    const paddingClass = isCompactVariant ? 'px-1.5 py-0.5' : 'px-2 py-1';
    const widthClass = isRowLayout ? 'flex-shrink-0' : '';
    const wrapperClass = isRowLayout
      ? 'flex items-center gap-1.5'
      : isCompactVariant
        ? 'flex flex-col gap-1'
        : 'flex items-center gap-1.5';
    const attendanceButtonBaseClass = `${textSizeClass} border rounded ${paddingClass} ${widthClass} cursor-pointer text-center whitespace-nowrap font-semibold transition-colors duration-150`;
    const paybackButtonBaseClass = `${textSizeClass} border rounded ${paddingClass} ${widthClass} cursor-pointer text-center whitespace-nowrap font-semibold transition-colors duration-150`;
    const autoLabelClass = `${textSizeClass} border rounded ${paddingClass} ${widthClass} text-center whitespace-nowrap font-semibold ${
      hasAttended
        ? 'border-green-200 dark:border-green-800 bg-green-50 dark:bg-green-900/20 text-green-600 dark:text-green-400'
        : 'border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400'
    }`;
    const autoWrapperClass = isRowLayout ? 'flex items-center gap-1.5' : wrapperClass;
    const autoPaybackClass = `${textSizeClass} border rounded ${paddingClass} ${widthClass} text-center whitespace-nowrap font-semibold ${
      hasPayback
        ? 'border-green-200 dark:border-green-800 bg-green-50 dark:bg-green-900/20 text-green-600 dark:text-green-400'
        : 'border-yellow-200 dark:border-yellow-800 bg-yellow-50 dark:bg-yellow-900/20 text-yellow-600 dark:text-yellow-400'
    }`;

    // 출석 타입이 자동일 때는 읽기 전용으로 출석일만 표시
    if (attendanceType === '자동') {
      // 자동 모드에서는 충전금액이 있으면 자동으로 출석 완료, 없으면 버튼 표시 안 함
      if (!hasAttended) {
        // 충전금액이 없으면 출석 버튼 표시 안 함 (페이백만 표시)
        const isPaybackAuto = paybackType === '자동';
        const paybackButtonText = isPaybackAuto ? '페완' : (paybackCleared ? '페완' : '페필');
        const paybackButtonColor = isPaybackAuto || paybackCleared
          ? 'border-green-200 dark:border-green-800 bg-green-50 dark:bg-green-900/20 text-green-600 dark:text-green-400'
          : 'border-yellow-200 dark:border-yellow-800 bg-yellow-50 dark:bg-yellow-900/20 text-yellow-600 dark:text-yellow-400';
        
        // 페이백이 있으면 페이백만 표시, 없으면 아무것도 표시 안 함
        if (!hasPayback) {
          return null;
        }
        
        return (
          <div className={autoWrapperClass}>
            {isPaybackAuto ? (
              <div className={autoPaybackClass}>
                {paybackButtonText}
              </div>
            ) : (
              <button
                onClick={async (e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  
                  log('🔍 [페이백 버튼 클릭 - 자동 출석]', {
                    identityName,
                    siteValue,
                    paybackType,
                    isPaybackAuto,
                    paybackCleared,
                    paybackButtonText,
                    weekStartDate
                  });
                  
                  // 상태 먼저 업데이트 (낙관적 업데이트)
                  const newClearedState = !paybackCleared;
                  log('✅ [페이백 버튼] 상태 변경:', { paybackCleared, newClearedState });
                  
                  setPaybackClearedMap(prev => ({
                    ...prev,
                    [paybackKey]: newClearedState
                  }));
                  
                  // 서버에 저장
                  await markPaybackPaid(identityName, siteValue, weekStartDate, paybackCleared);
                }}
                className={`${textSizeClass} border rounded ${paddingClass} ${widthClass} cursor-pointer text-center whitespace-nowrap font-semibold transition-colors duration-150 ${paybackButtonColor} hover:bg-opacity-20`}
              >
                {paybackButtonText}
              </button>
            )}
          </div>
        );
      }
      
      // 자동 모드에서 충전금액이 있으면 "출완"으로 표시 (읽기 전용)
      // 페이백 타입에 따라 표시 결정
      const isPaybackAuto = paybackType === '자동';
      const paybackButtonText = isPaybackAuto ? '페완' : (paybackCleared ? '페완' : '페필');
      const paybackButtonColor = isPaybackAuto || paybackCleared
        ? 'border-green-200 dark:border-green-800 bg-green-50 dark:bg-green-900/20 text-green-600 dark:text-green-400'
        : 'border-yellow-200 dark:border-yellow-800 bg-yellow-50 dark:bg-yellow-900/20 text-yellow-600 dark:text-yellow-400';
      
      return (
        <div className={autoWrapperClass}>
          <div className={autoLabelClass}>
            {attendanceLabel}
          </div>
          {hasPayback && (
            isPaybackAuto ? (
              <div className={autoPaybackClass}>
                {paybackButtonText}
              </div>
            ) : (
              <button
                onClick={async (e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  
                  log('🔍 [페이백 버튼 클릭 - 자동 출석]', {
                    identityName,
                    siteValue,
                    paybackType,
                    isPaybackAuto,
                    paybackCleared,
                    paybackButtonText,
                    weekStartDate
                  });
                  
                  // 상태 먼저 업데이트 (낙관적 업데이트)
                  const newClearedState = !paybackCleared;
                  log('✅ [페이백 버튼] 상태 변경:', { paybackCleared, newClearedState });
                  
                  setPaybackClearedMap(prev => ({
                    ...prev,
                    [paybackKey]: newClearedState
                  }));
                  
                  // 서버에 저장
                  await markPaybackPaid(identityName, siteValue, weekStartDate, paybackCleared);
                }}
                className={`${textSizeClass} border rounded ${paddingClass} ${widthClass} cursor-pointer text-center whitespace-nowrap font-semibold transition-colors duration-150 ${paybackButtonColor} hover:bg-opacity-20`}
              >
                {paybackButtonText}
              </button>
            )
          )}
        </div>
      );
    }
    
    // 출석 타입이 수동일 때만 버튼 표시
    if (attendanceType !== '수동') return null;
    
    // 페이백 타입에 따라 표시 결정
    // 자동: 항상 "페완" (클릭 불가)
    // 수동: paybackCleared에 따라 "페필" 또는 "페완" (클릭 가능)
    const isPaybackAuto = paybackType === '자동';
    const paybackButtonText = isPaybackAuto ? '페완' : (paybackCleared ? '페완' : '페필');
    const paybackButtonColor = isPaybackAuto || paybackCleared
      ? 'border-green-200 dark:border-green-800 bg-green-50 dark:bg-green-900/20 text-green-600 dark:text-green-400 hover:bg-green-100 dark:hover:bg-green-900/30'
      : 'border-yellow-200 dark:border-yellow-800 bg-yellow-50 dark:bg-yellow-900/20 text-yellow-600 dark:text-yellow-400 hover:bg-yellow-100 dark:hover:bg-yellow-900/30';
    
    return (
      <div className={wrapperClass}>
        <button
          onClick={async () => {
            const newState = !hasAttended;
            
            // UI 즉시 업데이트 (낙관적 업데이트)
            setAttendanceStates(prev => ({
              ...prev,
              [key]: newState
            }));
            
            // 출석 처리 (새로운 상태 전달)
            await handleAttendance(record, siteIndex, newState);
          }}
          className={`${attendanceButtonBaseClass} ${
            hasAttended 
              ? 'border-green-200 dark:border-green-800 bg-green-50 dark:bg-green-900/20 text-green-600 dark:text-green-400 hover:bg-green-100 dark:hover:bg-green-900/30' 
              : 'border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400 hover:bg-blue-100 dark:hover:bg-blue-900/30'
          }`}
          title={hasAttended 
            ? `✅ 출석 완료 (연속 ${attendanceDays}일) - 클릭하여 취소 가능` 
            : `⚠️ 출석 필요! (현재 ${attendanceDays}일) - 클릭하여 출석 완료 (안 하면 연속 끊김)`
          }
        >
          {attendanceLabel}
        </button>
        {hasPayback && (
          <button
            onClick={async (e) => {
              e.preventDefault();
              e.stopPropagation();
              
              log('🔍 [페이백 버튼 클릭]', {
                identityName,
                siteValue,
                paybackType,
                isPaybackAuto,
                paybackCleared,
                paybackButtonText,
                weekStartDate
              });
              
              // 자동 타입이면 클릭 불가
              if (isPaybackAuto) {
                log('⏭️ [페이백 버튼] 자동 타입이므로 클릭 불가');
                return;
              }
              
              // 상태 먼저 업데이트 (낙관적 업데이트)
              const newClearedState = !paybackCleared;
              log('✅ [페이백 버튼] 상태 변경:', { paybackCleared, newClearedState });
              
              setPaybackClearedMap(prev => ({
                ...prev,
                [paybackKey]: newClearedState
              }));
              
              // 서버에 저장
              await markPaybackPaid(identityName, siteValue, weekStartDate, paybackCleared);
            }}
            className={`${paybackButtonBaseClass} ${paybackButtonColor} ${isPaybackAuto ? 'cursor-default' : 'cursor-pointer'}`}
          >
            {paybackButtonText}
          </button>
        )}
      </div>
    );
  };

  // 출석 처리 함수 (토글) - 새로운 로그 방식
  const handleAttendance = async (record, siteIndex, newState) => {
    const siteField = `site_name${siteIndex}`;
    const identityField = `identity${siteIndex}`;
    const attendanceField = `attendance${siteIndex}`;
    const siteName = record[siteField];
    const identityName = record[identityField] || '';
    const key = `${record.id}-${siteIndex}`;
    const oldState = !newState; // 이전 상태 (롤백용)
    
    // 레코드의 실제 날짜 사용 (selectedDate가 아닌 record.record_date)
    const attendanceDate = record.record_date || selectedDate;
    
    log('🔔 수동 출석 처리 시작:', { 
      recordId: record.id, 
      siteIndex, 
      siteName,
      identityName,
      oldState,
      newState,
      recordDate: record.record_date,
      attendanceDate: attendanceDate
    });
    
    if (!siteName || !identityName) {
      // 롤백
      setAttendanceStates(prev => ({
        ...prev,
        [key]: oldState
      }));
      toast.error('사이트와 유저를 먼저 선택하세요');
      return;
    }
    
    if (!attendanceDate) {
      toast.error('레코드 날짜가 없습니다');
      return;
    }
    
    try {
      // 새로운 로그 방식 API 호출
      // desiredState: true = 출완, false = 출필
      const response = await axiosInstance.post('/attendance/toggle', {
        siteName,
        identityName,
        attendanceDate: attendanceDate,
        desiredState: newState
      });
      
      if (response.data.success) {
        const { consecutiveDays, totalDays, action } = response.data;
        
        log('✅ 수동 출석 처리 완료:', { 
          consecutiveDays,
          totalDays,
          action,
          newState
        });
        
        // 연속 출석일 캐시 업데이트 (state + ref 캐시 모두 갱신)
        const attendanceCacheKey = getAttendanceCacheKey(siteName, identityName || null);
        
        // state 업데이트
        setSiteAttendanceDays(prev => ({
          ...prev,
          [attendanceCacheKey]: consecutiveDays || 0
        }));
        
        // ref 캐시도 업데이트 (즉시 반영)
        attendanceStatsCacheRef.current[attendanceCacheKey] = {
          consecutiveDays: consecutiveDays || 0,
          timestamp: Date.now()
        };
        
        // 대시보드 갱신을 위한 refreshTick 증가
        setRefreshTick(prev => prev + 1);

        // DRBet 레코드의 attendance 플래그를 DB에 반영 (새로고침 후에도 출완 유지)
        if (record.id) {
          try {
            const updatedRecordForServer = {
              ...record,
              [attendanceField]: newState ? 1 : 0
            };
            await axiosInstance.put(`/drbet/${record.id}`, updatedRecordForServer);
          } catch (err) {
            console.error('DRBet 출석 플래그 업데이트 실패:', err);
          }
        }
        
        // 레코드 상태 업데이트 (클라이언트 메모리)
        setRecords(prev => prev.map(r => 
          r.id === record.id 
            ? { ...r, [attendanceField]: newState ? 1 : 0 }
            : r
        ));
        setAllRecords(prev => prev.map(r =>
          r.id === record.id
            ? { ...r, [attendanceField]: newState ? 1 : 0 }
            : r
        ));
        
        // 성공 메시지
        if (newState) {
          toast.success(`출석 완료! 연속 ${consecutiveDays}일 / 총 ${totalDays}일`);
        } else {
          toast(`출석 취소 (연속 ${consecutiveDays}일 / 총 ${totalDays}일)`, {
            icon: 'ℹ️',
          });
        }
      } else {
        throw new Error(response.data.message || '출석 처리 실패');
      }
    } catch (error) {
      console.error('❌ 수동 출석 처리 실패:', error);
      console.error('에러 상세:', error.response?.data || error.message);
      
      // 실패 시 롤백
      setAttendanceStates(prev => ({
        ...prev,
        [key]: oldState
      }));
      
      toast.error('출석 처리에 실패했습니다');
    }
  };

  // 재충 여부 확인 함수
  const isRechargeRecord = (record, siteIndex, allRecordsList) => {
    const identityField = `identity${siteIndex}`;
    const siteField = `site_name${siteIndex}`;
    const chargeWithdrawField = `charge_withdraw${siteIndex}`;
    
    const identityName = record[identityField] || '';
    const siteName = record[siteField] || '';
    
    if (!identityName || !siteName) return false;
    
    // 같은 유저, 같은 사이트를 가진 다른 레코드 찾기
    const duplicateRecords = allRecordsList.filter(r => {
      if (r.id === record.id) return false; // 자기 자신 제외
      const otherIdentity = r[identityField];
      const otherSite = r[siteField];
      return otherIdentity === identityName && otherSite === siteName;
    });
    
    // 중복이 있으면 가장 위에 있는지 확인
    if (duplicateRecords.length > 0) {
      // 중복 레코드들의 display_order와 현재 레코드의 display_order를 모두 포함
      const allDuplicateRecords = [...duplicateRecords, record];
      const sortedRecords = allDuplicateRecords
        .map(r => ({
          record: r,
          order: r.display_order || 0,
          index: allRecordsList.findIndex(item => item.id === r.id)
        }))
        .sort((a, b) => a.order - b.order || a.index - b.index);
      
      const baseRecord = sortedRecords[0]?.record;
      if (baseRecord) {
        const baseChargeRaw = baseRecord[chargeWithdrawField] || '';
        const baseChargeParts = baseChargeRaw.trim().split(/\s+/);
        const baseDeposit = baseChargeParts.length > 0 ? (parseFloat(baseChargeParts[0]) || 0) : 0;
        
        // 기준이 되는 첫 레코드에 충전금액이 없으면 재충으로 보지 않음
        if (baseDeposit <= 0) {
          return false;
        }
      }
      
      // 현재 레코드의 인덱스를 allRecordsList 배열에서 찾기
      const currentIndex = allRecordsList.findIndex(r => r.id === record.id);
      
      // 현재 레코드보다 앞에 있는 중복 레코드가 있는지 확인
      const hasEarlierDuplicate = allRecordsList.slice(0, currentIndex).some(r => {
        const otherIdentity = r[identityField];
        const otherSite = r[siteField];
        return otherIdentity === identityName && otherSite === siteName;
      });
      
      // 앞에 중복이 있으면 재충전
      return hasEarlierDuplicate;
    }
    
    return false;
  };

  // 자동 출석 처리 함수 (충전금액 변화에 따라) - 새로운 로그 방식
  const handleAutoAttendance = async (siteName, identityName, oldChargeWithdraw, newChargeWithdraw, record = null, siteIndex = null) => {
    if (!siteName || !identityName) return;
    
    try {
      // 재충 레코드는 자동 출석 처리하지 않음
      if (record && siteIndex !== null) {
        const allRecordsList = allRecords.filter(r => r.record_date === selectedDate);
        if (isRechargeRecord(record, siteIndex, allRecordsList)) {
          log('⏭️ [자동출석] 재충 레코드는 자동 출석 처리하지 않음:', { siteName, identityName });
          return;
        }
      }
      
      // 성능 최적화: 캐시에서 먼저 확인
      const notesCacheKey = getSiteNotesCacheKey(siteName, identityName || null);
      let attendanceType = '자동'; // 기본값
      
      if (siteNotesCacheRef.current[notesCacheKey]) {
        // 캐시에서 출석구분 확인
        attendanceType = siteNotesCacheRef.current[notesCacheKey]?.data?.attendanceType || '자동';
      } else {
        // 캐시에 없으면 조회 (하지만 서버에서 자동 처리되므로 실제로는 불필요할 수 있음)
        const siteNotes = await fetchSiteNotes(siteName, identityName || null);
        const currentData = siteNotes?.data || {};
        attendanceType = currentData.attendanceType || '자동';
      }
      
      // 출석구분이 "자동"이 아니면 처리하지 않음
      if (attendanceType !== '자동') {
        return;
      }
      
      // 충전금액 파싱 (예: "100 10" → 100)
      const parseCharge = (str) => {
        if (str === undefined || str === null || str === '') return 0;
        if (typeof str !== 'string') {
          const num = parseFloat(str);
          return isNaN(num) ? 0 : num;
        }
        const trimmed = str.trim();
        if (trimmed === '') return 0;
        const parts = trimmed.split(' ');
        const firstPart = parts[0] || '';
        const num = parseFloat(firstPart);
        return isNaN(num) ? 0 : num;
      };
      
      const oldCharge = parseCharge(oldChargeWithdraw);
      const newCharge = parseCharge(newChargeWithdraw);
      
      // 레코드의 record_date 사용 (없으면 selectedDate 사용)
      const recordDate = record?.record_date || selectedDate;
      
      log('💰 [자동출석] 충전금액 변화 감지 (서버에서 자동 처리됨):', { 
        siteName, 
        identityName,
        oldCharge, 
        newCharge,
        recordDate
      });
      
      // ⚠️ 서버에서 PUT /drbet 시 자동으로 출석 로그를 처리합니다.
      // 클라이언트에서 중복 호출하면 토글되어 삭제됩니다.
      // 따라서 여기서는 아무것도 하지 않습니다.
      
    } catch (error) {
      console.error('❌ [자동출석] 처리 실패:', error);
    }
  };

  // 레코드 저장 후 출석일 캐시 업데이트 함수
  const refreshAttendanceDaysForRecord = (record) => {
    try {
      // 서버에서 반환한 _attendanceDays 사용 (있으면)
      const attendanceDaysMap = record._attendanceDays || {};
      
      log('🔄 [출석일 캐시] 서버 응답:', attendanceDaysMap);
      
      // 한 번에 모든 업데이트를 모아서 처리
      const daysUpdates = {};
      const stateUpdates = {};
      
      // 레코드의 각 사이트(1~4)에 대해 출석일 업데이트 수집
      for (let i = 1; i <= 4; i++) {
        const identityName = record[`identity${i}`];
        const siteName = record[`site_name${i}`];
        const attendanceValue = record[`attendance${i}`];
        
        if (!identityName || !siteName) continue;
        
        const attendanceCacheKey = getAttendanceCacheKey(siteName, identityName);
        // 서버에서 normalizeName으로 정규화된 키를 사용하므로 클라이언트에서도 동일하게 정규화
        const normalizedIdentity = normalizeName(identityName);
        const normalizedSite = normalizeName(siteName);
        const mapKey = `${normalizedIdentity}||${normalizedSite}`;
        
        // 서버에서 반환한 출석일 사용 (없으면 기존 캐시 유지)
        if (attendanceDaysMap[mapKey] !== undefined) {
          daysUpdates[attendanceCacheKey] = attendanceDaysMap[mapKey];
          log(`   ✅ ${identityName} - ${siteName} → ${attendanceDaysMap[mapKey]}일`);
        }
        
        // 출석 상태도 업데이트 (서버에서 반환한 attendance 값 사용)
        if (attendanceValue !== undefined) {
          const key = `${record.id}-${i}`;
          stateUpdates[key] = Boolean(attendanceValue);
        }
        
        // 사이트 노트 캐시 무효화
        const notesCacheKey = getSiteNotesCacheKey(siteName, identityName);
        delete siteNotesCacheRef.current[notesCacheKey];
      }
      
      // flushSync로 즉시 렌더링 강제 (React 배칭 우회)
      if (Object.keys(daysUpdates).length > 0 || Object.keys(stateUpdates).length > 0) {
        flushSync(() => {
          if (Object.keys(daysUpdates).length > 0) {
            setSiteAttendanceDays(prev => ({
              ...prev,
              ...daysUpdates
            }));
          }
          
          if (Object.keys(stateUpdates).length > 0) {
            setAttendanceStates(prev => ({
              ...prev,
              ...stateUpdates
            }));
          }
          
          // 즉시 리렌더링 트리거
          setRefreshTick((t) => t + 1);
        });
      }
    } catch (error) {
      console.error('출석일 캐시 업데이트 실패:', error);
    }
  };

  // 장점검/수동입력 사이트 드롭 핸들러
  // 미등록 승인 사이트 드롭 핸들러
  const handleUnregisteredSiteDrop = async (unregisteredSite, recordId, siteIndex) => {
    try {
      log('[미등록 사이트 드롭] 시작:', { unregisteredSite, recordId, siteIndex });
      
      let record;
      // 새 레코드 생성이 필요한 경우
      if (recordId === 'new') {
        log('[미등록 사이트 드롭] 새 레코드 생성');
        const newRecord = {
          tmpId: `new-${Date.now()}`,
          isNew: true,
          record_date: selectedDate,
          [`identity${siteIndex}`]: unregisteredSite.identityName,
          [`site_name${siteIndex}`]: unregisteredSite.siteName,
          [`charge_withdraw${siteIndex}`]: '',
          display_order: records.length,
          _v: 0
        };
        
        setRecords(prev => [...prev, newRecord]);
        setAllRecords(prev => [...prev, newRecord]);
        setRefreshTick(t => t + 1);
        
        // 서버에 저장
        const response = await axiosInstance.post('/drbet', newRecord);
        const saved = response.data;
        setRecords(prev => prev.map(r => (r.tmpId && r.tmpId === newRecord.tmpId ? { ...saved, tmpId: undefined, isNew: false, _v: (r._v || 0) + 1 } : r)));
        setAllRecords(prev => prev.map(r => (r.tmpId && r.tmpId === newRecord.tmpId ? { ...saved, tmpId: undefined, isNew: false, _v: (r._v || 0) + 1 } : r)));
        setRefreshTick(t => t + 1);
        
        record = saved;
      } else {
        // 기존 레코드 찾기
        record = records.find(r => {
          return (r.id && String(r.id) === recordId) || (r.tmpId && String(r.tmpId) === recordId);
        });
      }

      if (!record) {
        console.error('[미등록 사이트 드롭] 레코드를 찾을 수 없음:', recordId);
        toast.error('레코드를 찾을 수 없습니다');
        return;
      }
      
      // 레코드 업데이트
      const updatedRecord = {
        ...record,
        [`identity${siteIndex}`]: unregisteredSite.identityName,
        [`site_name${siteIndex}`]: unregisteredSite.siteName,
        _v: (record._v || 0) + 1
      };
      
      setRecords(prev => prev.map(r => {
        const match = (r.id && r.id === record.id) || (r.tmpId && r.tmpId === record.tmpId);
        return match ? updatedRecord : r;
      }));
      setAllRecords(prev => prev.map(r => {
        const match = (r.id && r.id === record.id) || (r.tmpId && r.tmpId === record.tmpId);
        return match ? updatedRecord : r;
      }));
      setRefreshTick(t => t + 1);
      
      // 서버 업데이트
      if (record.id) {
        await axiosInstance.put(`/drbet/${record.id}`, updatedRecord);
      }
      
      toast.success(`${unregisteredSite.identityName} - ${unregisteredSite.siteName}이 추가되었습니다`);
    } catch (error) {
      console.error('미등록 사이트 드롭 실패:', error);
      toast.error('사이트 추가에 실패했습니다');
    }
  };

  const handlePendingSiteDrop = async (pendingSite, recordId, siteIndex) => {
    try {
      log('[드롭] handlePendingSiteDrop 호출:', { pendingSite, recordId, siteIndex, recordsCount: records.length });
      
      // 레코드 찾기
      let record = null;
      if (recordId === 'new') {
        // 'new'인 경우 빈 행 찾기 또는 새 행 생성
        record = records.find(r => !r.id && !r.tmpId);
        if (!record) {
          // 빈 행이 없으면 새 행 생성
          const newRecord = {
            tmpId: `new-${Date.now()}`,
            isNew: true,
            record_date: selectedDate,
            [`identity${siteIndex}`]: pendingSite.identityName,
            [`site_name${siteIndex}`]: pendingSite.siteName,
            [`charge_withdraw${siteIndex}`]: '',
            display_order: records.length,
            _v: 0
          };
          
          setRecords(prev => [...prev, newRecord]);
          setAllRecords(prev => [...prev, newRecord]);
          setRefreshTick(t => t + 1);
          
          // 서버에 저장
          const response = await axiosInstance.post('/drbet', newRecord);
          const saved = response.data;
          setRecords(prev => prev.map(r => (r.tmpId && r.tmpId === newRecord.tmpId ? { ...saved, tmpId: undefined, isNew: false, _v: (r._v || 0) + 1 } : r)));
          setAllRecords(prev => prev.map(r => (r.tmpId && r.tmpId === newRecord.tmpId ? { ...saved, tmpId: undefined, isNew: false, _v: (r._v || 0) + 1 } : r)));
          setRefreshTick(t => t + 1);
          
          // 사이트 상태 업데이트는 아래에서 처리
          record = saved;
        }
      } else {
        // 기존 레코드 찾기
        record = records.find(r => {
          return (r.id && String(r.id) === recordId) || (r.tmpId && String(r.tmpId) === recordId);
        });
      }

      if (!record) {
        console.error('[드롭] 레코드를 찾을 수 없음:', recordId);
        toast.error('레코드를 찾을 수 없습니다');
        return;
      }
      
      // 레코드 업데이트
      const updatedRecord = {
        ...record,
        [`identity${siteIndex}`]: pendingSite.identityName,
        [`site_name${siteIndex}`]: pendingSite.siteName,
        _v: (record._v || 0) + 1
      };
      
      setRecords(prev => prev.map(r => {
        const match = (r.id && r.id === record.id) || (r.tmpId && r.tmpId === record.tmpId);
        return match ? updatedRecord : r;
      }));
      setAllRecords(prev => prev.map(r => {
        const match = (r.id && r.id === record.id) || (r.tmpId && r.tmpId === record.tmpId);
        return match ? updatedRecord : r;
      }));
      setRefreshTick(t => t + 1);
      
      // 서버에 저장
      if (updatedRecord.isNew || !updatedRecord.id) {
        await axiosInstance.post('/drbet', updatedRecord);
      } else {
        await axiosInstance.put(`/drbet/${updatedRecord.id}`, updatedRecord);
      }
      
      // 사이트 상태에 "승인" 추가
      const now = new Date();
      const month = String(now.getMonth() + 1).padStart(2, '0');
      const day = String(now.getDate()).padStart(2, '0');
      const datePrefix = `${month}.${day}`;
      
      // 현재 상태 가져오기
      const siteResponse = await axiosInstance.get(`/sites/${pendingSite.siteId}`);
      const currentSite = siteResponse.data.site;
      const currentStatus = currentSite.status || '';
      
      // 승인 추가 (중복 방지)
      // 상태에서 순수 상태값 추출하여 승인 여부 확인
      const statusParts = currentStatus.split('/').map(s => s.trim());
      const hasApproval = statusParts.some(part => {
        const pureStatus = part.replace(/^\d{1,2}\.\d{1,2}\s*/, '').trim();
        return pureStatus === '승인';
      });
      
      let newStatus = `${datePrefix} 승인`;
      if (currentStatus && !hasApproval) {
        // 기존 상태가 있으면 슬래시로 구분하여 추가
        newStatus = `${currentStatus} / ${newStatus}`;
      }
      
      // 사이트 상태 업데이트
      await axiosInstance.put(`/sites/${pendingSite.siteId}`, {
        ...currentSite,
        status: newStatus
      });
      
      // 목록 새로고침 (loadIdentities가 pending sites도 함께 로드)
      await loadIdentities();
      
      toast.success(`${pendingSite.identityName} - ${pendingSite.siteName}이 추가되었고 승인 상태로 변경되었습니다`);
    } catch (error) {
      console.error('장점검/수동입력 사이트 드롭 실패:', error);
      toast.error('사이트 추가에 실패했습니다');
    }
  };

  // 드래그 앤 드롭 핸들러
  const handleDragEnd = async (result) => {
    log('[드래그] handleDragEnd 호출:', result);
    if (!result.destination) {
      log('[드래그] destination이 없음');
      return;
    }


    // 사이트 컬럼 드래그인지 확인
    if (result.draggableId.startsWith('site-') && result.destination.droppableId.startsWith('site-drop-')) {
      await handleSiteDragEnd(result);
      return;
    }
    
    // 미등록 승인 사이트 드래그인지 확인
    if (result.draggableId.startsWith('unregistered-site-') && result.destination.droppableId.startsWith('site-drop-')) {
      log('[드래그] 미등록 승인 사이트 드롭 감지:', result);
      const unregisteredSiteIndex = parseInt(result.draggableId.replace('unregistered-site-', ''));
      const unregisteredSite = unregisteredApprovedSites[unregisteredSiteIndex];
      
      log('[드래그] unregisteredSite:', unregisteredSite, 'index:', unregisteredSiteIndex);
      
      if (unregisteredSite) {
        // 드롭 위치 파싱
        const destMatch = result.destination.droppableId.match(/^site-drop-(.+)-(\d+)$/);
        log('[드래그] destMatch:', destMatch, 'droppableId:', result.destination.droppableId);
        if (destMatch) {
          const destRecordId = destMatch[1];
          const destSiteIndex = parseInt(destMatch[2]);
          log('[드래그] 미등록 사이트 드롭 처리:', { destRecordId, destSiteIndex });
          await handleUnregisteredSiteDrop(unregisteredSite, destRecordId, destSiteIndex);
        } else {
          console.error('[드래그] destMatch 실패:', result.destination.droppableId);
        }
      } else {
        console.error('[드래그] unregisteredSite를 찾을 수 없음:', unregisteredSiteIndex);
      }
      return;
    }
    
    // 장점검/수동입력 사이트 드래그인지 확인
    if (result.draggableId.startsWith('pending-site-') && result.destination.droppableId.startsWith('site-drop-')) {
      log('[드래그] 장점검/수동입력 사이트 드롭 감지:', result);
      const pendingSiteIndex = parseInt(result.draggableId.replace('pending-site-', ''));
      const pendingSite = pendingSites[pendingSiteIndex];
      
      log('[드래그] pendingSite:', pendingSite, 'index:', pendingSiteIndex, 'pendingSites:', pendingSites);
      
      if (pendingSite) {
        // 드롭 위치 파싱
        const destMatch = result.destination.droppableId.match(/^site-drop-(.+)-(\d+)$/);
        log('[드래그] destMatch:', destMatch, 'droppableId:', result.destination.droppableId);
        if (destMatch) {
          const destRecordId = destMatch[1];
          const destSiteIndex = parseInt(destMatch[2]);
          log('[드래그] handlePendingSiteDrop 호출:', { destRecordId, destSiteIndex });
          await handlePendingSiteDrop(pendingSite, destRecordId, destSiteIndex);
        } else {
          console.error('[드래그] destMatch 실패:', result.destination.droppableId);
        }
      } else {
        console.error('[드래그] pendingSite를 찾을 수 없음:', pendingSiteIndex, pendingSites);
      }
      return;
    }

    // 행 드래그인 경우 확인 (draggableId가 record- 또는 tmp-로 시작하고, destination이 drbet-table)
    const isRowDrag = (result.draggableId.startsWith('record-') || result.draggableId.startsWith('tmp-')) && 
                      result.destination.droppableId === 'drbet-table';
    
    if (!isRowDrag) {
      log('[드래그] 행 드래그가 아님:', result);
      return;
    }

    // 행 드래그인 경우 기존 로직
    const items = Array.from(records);
    const [reorderedItem] = items.splice(result.source.index, 1);
    items.splice(result.destination.index, 0, reorderedItem);

    // display_order 업데이트
    const updatedItems = items.map((item, index) => ({
      ...item,
      display_order: index
    }));

    setRecords(updatedItems);

    // 서버에 순서 저장 (저장된 기록만)
    try {
      const savedRecords = updatedItems.filter(item => item.id && !item.isNew);
      if (savedRecords.length > 0) {
        await axiosInstance.put('/drbet/reorder', {
          records: savedRecords.map((item, index) => ({
            id: item.id,
            display_order: index
          }))
        });
        toast.success('순서가 변경되었습니다');
      }
    } catch (error) {
      console.error('순서 변경 실패:', error);
      toast.error('순서 변경에 실패했습니다');
      loadRecords(); // 실패 시 원래 데이터로 복구
    }
  };

  // 사이트 컬럼 드래그 앤 드롭 핸들러
  const handleSiteDragEnd = async (result) => {
    if (!result.destination) return;

    // 드래그한 사이트 정보 파싱: "site-{recordId}-{siteIndex}"
    const sourceMatch = result.draggableId.match(/^site-(.+)-(\d+)$/);
    if (!sourceMatch) return;
    const sourceRecordId = sourceMatch[1];
    const sourceSiteIndex = parseInt(sourceMatch[2]);

    // 드롭 위치 정보 파싱: "site-drop-{recordId}-{siteIndex}"
    const destMatch = result.destination.droppableId.match(/^site-drop-(.+)-(\d+)$/);
    if (!destMatch) return;
    const destRecordId = destMatch[1];
    const destSiteIndex = parseInt(destMatch[2]);

    // 소스와 목적지 레코드 찾기
    const sourceRecord = records.find(r => {
      if (sourceRecordId === 'new') {
        return !r.id && !r.tmpId;
      }
      return (r.id && String(r.id) === sourceRecordId) || (r.tmpId && String(r.tmpId) === sourceRecordId);
    });

    const destRecord = records.find(r => {
      if (destRecordId === 'new') {
        return !r.id && !r.tmpId;
      }
      return (r.id && String(r.id) === destRecordId) || (r.tmpId && String(r.tmpId) === destRecordId);
    });

    if (!sourceRecord || !destRecord) return;

    // 같은 레코드인 경우: 두 사이트 데이터 교환
    if (sourceRecord.id === destRecord.id || (sourceRecord.tmpId && sourceRecord.tmpId === destRecord.tmpId)) {
      const sourceIdentity = sourceRecord[`identity${sourceSiteIndex}`] || '';
      const sourceSite = sourceRecord[`site_name${sourceSiteIndex}`] || '';
      const sourceChargeWithdraw = sourceRecord[`charge_withdraw${sourceSiteIndex}`] || '';

      const destIdentity = destRecord[`identity${destSiteIndex}`] || '';
      const destSite = destRecord[`site_name${destSiteIndex}`] || '';
      const destChargeWithdraw = destRecord[`charge_withdraw${destSiteIndex}`] || '';

      // 데이터 교환
      const updatedRecord = {
        ...sourceRecord,
        [`identity${sourceSiteIndex}`]: destIdentity,
        [`site_name${sourceSiteIndex}`]: destSite,
        [`charge_withdraw${sourceSiteIndex}`]: destChargeWithdraw,
        [`identity${destSiteIndex}`]: sourceIdentity,
        [`site_name${destSiteIndex}`]: sourceSite,
        [`charge_withdraw${destSiteIndex}`]: sourceChargeWithdraw,
        _v: (sourceRecord._v || 0) + 1
      };

      // UI 즉시 업데이트
      setRecords(prev => prev.map(r => {
        const match = (r.id && r.id === sourceRecord.id) || (r.tmpId && r.tmpId === sourceRecord.tmpId);
        return match ? updatedRecord : r;
      }));
      setAllRecords(prev => prev.map(r => {
        const match = (r.id && r.id === sourceRecord.id) || (r.tmpId && r.tmpId === sourceRecord.tmpId);
        return match ? updatedRecord : r;
      }));
      setRefreshTick(t => t + 1);

      // 서버에 저장
      try {
        if (updatedRecord.isNew || !updatedRecord.id) {
          await axiosInstance.post('/drbet', updatedRecord);
        } else {
          await axiosInstance.put(`/drbet/${updatedRecord.id}`, updatedRecord);
        }
        toast.success('사이트 위치가 변경되었습니다');
        await loadRecords();
      } catch (error) {
        console.error('사이트 위치 변경 실패:', error);
        toast.error('사이트 위치 변경에 실패했습니다');
        await loadRecords();
      }
    } else {
      // 다른 레코드인 경우: 드래그한 사이트와 드롭 위치의 데이터를 교환
      const sourceIdentity = sourceRecord[`identity${sourceSiteIndex}`] || '';
      const sourceSite = sourceRecord[`site_name${sourceSiteIndex}`] || '';
      const sourceChargeWithdraw = sourceRecord[`charge_withdraw${sourceSiteIndex}`] || '';
      const sourceAttendance = sourceRecord[`attendance${sourceSiteIndex}`] || 0;

      const destIdentity = destRecord[`identity${destSiteIndex}`] || '';
      const destSite = destRecord[`site_name${destSiteIndex}`] || '';
      const destChargeWithdraw = destRecord[`charge_withdraw${destSiteIndex}`] || '';
      const destAttendance = destRecord[`attendance${destSiteIndex}`] || 0;

      // 소스 레코드: 목적지 데이터로 교환
      const updatedSourceRecord = {
        ...sourceRecord,
        [`identity${sourceSiteIndex}`]: destIdentity,
        [`site_name${sourceSiteIndex}`]: destSite,
        [`charge_withdraw${sourceSiteIndex}`]: destChargeWithdraw,
        [`attendance${sourceSiteIndex}`]: destAttendance,
        _v: (sourceRecord._v || 0) + 1
      };

      // 목적지 레코드: 소스 데이터로 교환
      const updatedDestRecord = {
        ...destRecord,
        [`identity${destSiteIndex}`]: sourceIdentity,
        [`site_name${destSiteIndex}`]: sourceSite,
        [`charge_withdraw${destSiteIndex}`]: sourceChargeWithdraw,
        [`attendance${destSiteIndex}`]: sourceAttendance,
        _v: (destRecord._v || 0) + 1
      };

      // UI 즉시 업데이트
      setRecords(prev => prev.map(r => {
        if ((r.id && r.id === sourceRecord.id) || (r.tmpId && r.tmpId === sourceRecord.tmpId)) {
          return updatedSourceRecord;
        }
        if ((r.id && r.id === destRecord.id) || (r.tmpId && r.tmpId === destRecord.tmpId)) {
          return updatedDestRecord;
        }
        return r;
      }));
      setAllRecords(prev => prev.map(r => {
        if ((r.id && r.id === sourceRecord.id) || (r.tmpId && r.tmpId === sourceRecord.tmpId)) {
          return updatedSourceRecord;
        }
        if ((r.id && r.id === destRecord.id) || (r.tmpId && r.tmpId === destRecord.tmpId)) {
          return updatedDestRecord;
        }
        return r;
      }));
      setRefreshTick(t => t + 1);

      // 서버에 저장 (순차적으로 실행하여 트랜잭션 충돌 방지)
      try {
        // 소스 레코드 먼저 저장
        if (updatedSourceRecord.isNew || !updatedSourceRecord.id) {
          await axiosInstance.post('/drbet', updatedSourceRecord);
        } else {
          await axiosInstance.put(`/drbet/${updatedSourceRecord.id}`, updatedSourceRecord);
        }
        // 목적지 레코드 저장
        if (updatedDestRecord.isNew || !updatedDestRecord.id) {
          await axiosInstance.post('/drbet', updatedDestRecord);
        } else {
          await axiosInstance.put(`/drbet/${updatedDestRecord.id}`, updatedDestRecord);
        }
        toast.success('사이트 위치가 변경되었습니다');
        await loadRecords();
      } catch (error) {
        console.error('사이트 위치 변경 실패:', error);
        toast.error('사이트 위치 변경에 실패했습니다');
        await loadRecords();
      }
    }
  };

  // 입력 파싱 함수 (useCallback으로 메모이제이션)
  const parseSiteData = useCallback((input) => {
    if (!input) return { charge: 0, withdraw: 0 };
    const match = input.match(/(\d+)\s*(\d+)?/);
    if (match) {
      return {
        charge: parseInt(match[1]) * 10000,
        withdraw: match[2] ? parseInt(match[2]) * 10000 : 0
      };
    }
    return { charge: 0, withdraw: 0 };
  }, []);

  // charge_withdraw 필드 파싱 (예: "10 20" => charge=10만, withdraw=20만) - useCallback으로 메모이제이션
  const parseChargeWithdraw = useCallback((input) => {
    if (!input) return { charge: 0, withdraw: 0 };
    const match = input.match(/(\d+)\s*(\d+)?/);
    if (match) {
      return {
        charge: parseInt(match[1]) * 10000,
        withdraw: match[2] ? parseInt(match[2]) * 10000 : 0
      };
    }
    return { charge: 0, withdraw: 0 };
  }, []);

  const parseNotes = useCallback((input) => {
    if (!input) return { charge: 0, withdraw: 0 };
    let totalCharge = 0;
    let totalWithdraw = 0;
    
    // 정규식으로 충전/환전 정보 추출 (엑셀 수식과 동일)
    const chargeMatches = input.match(/(\d{1,3})충/g);
    const withdrawMatches = input.match(/(\d{1,3})환/g);
    
    if (chargeMatches) {
      chargeMatches.forEach(m => {
        const amount = parseInt(m.replace('충', ''));
        totalCharge += amount * 10000;
      });
    }
    
    if (withdrawMatches) {
      withdrawMatches.forEach(m => {
        const amount = parseInt(m.replace('환', ''));
        totalWithdraw += amount * 10000;
      });
    }
    
    return { charge: totalCharge, withdraw: totalWithdraw };
  }, []);

  // 자동 계산 함수들 (useCallback으로 메모이제이션)
  const calculatePrivateAmount = useCallback((record) => {
    // 새로운 구조: charge_withdraw1~4 필드에서 충전 금액 추출
    const chargeWithdraw1 = parseChargeWithdraw(record.charge_withdraw1);
    const chargeWithdraw2 = parseChargeWithdraw(record.charge_withdraw2);
    const chargeWithdraw3 = parseChargeWithdraw(record.charge_withdraw3);
    const chargeWithdraw4 = parseChargeWithdraw(record.charge_withdraw4);
    
    const newWayTotal = chargeWithdraw1.charge + chargeWithdraw2.charge + chargeWithdraw3.charge + chargeWithdraw4.charge;
    
    // 새로운 방식에 값이 있으면 사용
    if (newWayTotal > 0) {
      return newWayTotal;
    }
    
    // 기존 site1~4 방식으로 계산 (하위 호환성)
    const site1Data = parseSiteData(record.site1);
    const site2Data = parseSiteData(record.site2);
    const site3Data = parseSiteData(record.site3);
    const site4Data = parseSiteData(record.site4);
    
    return site1Data.charge + site2Data.charge + site3Data.charge + site4Data.charge;
  }, [parseChargeWithdraw, parseSiteData]);

  const calculateTotalCharge = useCallback((record, drbetAmount = null) => {
    const drbet = drbetAmount !== null ? drbetAmount : (record.drbet_amount || 0);
    return drbet + calculatePrivateAmount(record);
  }, [calculatePrivateAmount]);

  // DR벳 자동 계산 (이전 행 기반) - useCallback으로 메모이제이션
  const calculateDRBet = useCallback((record, previousRecord) => {
    if (!previousRecord) {
      // 첫 행은 입력값 사용 + 특이사항 충전 금액 추가 - 특이사항 환전 금액 차감
      const notesData = parseNotes(record.notes);
      return (record.drbet_amount || 0) + notesData.charge - notesData.withdraw;
    }
    
    // 이전 행의 환전 금액 추출 (새로운 구조: charge_withdraw)
    const prevChargeWithdraw1 = parseChargeWithdraw(previousRecord.charge_withdraw1);
    const prevChargeWithdraw2 = parseChargeWithdraw(previousRecord.charge_withdraw2);
    const prevChargeWithdraw3 = parseChargeWithdraw(previousRecord.charge_withdraw3);
    const prevChargeWithdraw4 = parseChargeWithdraw(previousRecord.charge_withdraw4);
    
    const newWayWithdraw = prevChargeWithdraw1.withdraw + prevChargeWithdraw2.withdraw + prevChargeWithdraw3.withdraw + prevChargeWithdraw4.withdraw;
    
    // 현재 행의 특이사항 충전/환전 금액 추출
    const currentNotesData = parseNotes(record.notes);
    
    // 새로운 방식에 값이 있으면 사용
    if (newWayWithdraw > 0) {
      // 기본 받치기 금액 = 이전 행 토탈금액 - (이전 행 사이트1~4 환전 합계) + 이전 행 요율
      // 현재 행의 특이사항 충전/환전을 현재 행의 받치기 금액에 반영
      const baseDrbetAmount = (previousRecord.total_amount || 0) - newWayWithdraw + (previousRecord.rate_amount || 0);
      return baseDrbetAmount + currentNotesData.charge - currentNotesData.withdraw;
    }
    
    // 기존 site1~4 방식으로 계산 (하위 호환성)
    const prevSite1Data = parseSiteData(previousRecord.site1);
    const prevSite2Data = parseSiteData(previousRecord.site2);
    const prevSite3Data = parseSiteData(previousRecord.site3);
    const prevSite4Data = parseSiteData(previousRecord.site4);
    
    const prevTotalWithdraw = prevSite1Data.withdraw + prevSite2Data.withdraw + prevSite3Data.withdraw + prevSite4Data.withdraw;
    
    // 기본 받치기 금액 = 이전 행 토탈금액 - (이전 행 사이트1~4 환전 합계) + 이전 행 요율
    // 현재 행의 특이사항 충전/환전을 현재 행의 받치기 금액에 반영
    const baseDrbetAmount = (previousRecord.total_amount || 0) - prevTotalWithdraw + (previousRecord.rate_amount || 0);
    return baseDrbetAmount + currentNotesData.charge - currentNotesData.withdraw;
  }, [parseChargeWithdraw, parseSiteData, parseNotes]);

  const calculateMargin = useCallback((record, totalCharge) => {
    // 토탈금액이 없거나 0이면 마진을 0으로 반환
    if (!record.total_amount || record.total_amount === 0) {
      return 0;
    }
    return record.total_amount - totalCharge;
  }, []);

  const formatCurrency = (amount) => {
    if (!amount && amount !== 0) return '0';
    return amount.toLocaleString('ko-KR');
  };

  // 현재 레코드를 복사하여 바로 아래에 새 행으로 추가
  const copyRow = async (sourceIndex) => {
    try {
      const source = records[sourceIndex];
      if (!source) return;

      // 편집 모드 해제 및 락 해제 후 추가
      editingLockRef.current = false;
      setEditingCell(null);

      const insertIndex = sourceIndex + 1;
      let displayOrder;

      if (insertIndex >= 0 && insertIndex < records.length) {
        // 복사 행을 삽입할 위치 기준으로 display_order 재정렬
        const targetOrder = (records[insertIndex].display_order || 0) || insertIndex;
        displayOrder = targetOrder;

        const recordsToUpdate = records
          .filter(r => r.id && (r.display_order || 0) >= targetOrder)
          .map(r => ({
            id: r.id,
            display_order: (r.display_order || 0) + 1
          }));

        if (recordsToUpdate.length > 0) {
          await axiosInstance.put('/drbet/reorder', {
            records: recordsToUpdate
          });
        }
      } else {
        // 맨 끝에 추가하는 경우
        const maxOrder = records.length > 0 ? Math.max(...records.map(r => r.display_order || 0)) : -1;
        displayOrder = maxOrder + 1;
      }

      // 원본 레코드에서 서버용 필드만 복사 (id, created_at 등은 제외)
      const {
        id,
        created_at,
        updated_at,
        _v,
        isNew,
        ...rest
      } = source || {};

      const newRecordPayload = {
        ...rest,
        record_date: selectedDate,
        display_order: displayOrder,
        // 복사 시 빈 상태로 설정할 필드들
        notes: '', // 특이사항
        charge_withdraw1: '', // 충환전 금액
        charge_withdraw2: '',
        charge_withdraw3: '',
        charge_withdraw4: '',
        total_amount: 0, // 토탈금액
        rate_amount: 0 // 요율
      };

      await axiosInstance.post('/drbet', newRecordPayload);
      toast.success('행이 복사되었습니다');
      await loadRecords(true); // 강제 새로고침
    } catch (error) {
      console.error('행 복사 실패:', error);
      toast.error('행 복사에 실패했습니다');
    }
  };

  // 새 행 추가 (즉시 서버 저장)
  const addNewRow = async (insertIndex = null) => {
    try {
      // 편집 모드 해제 및 락 해제 후 추가
      editingLockRef.current = false;
      setEditingCell(null);
      
      let displayOrder;
      if (insertIndex !== null && insertIndex >= 0 && insertIndex < records.length) {
        // 특정 위치에 삽입하는 경우
        const targetOrder = records[insertIndex].display_order || insertIndex;
        displayOrder = targetOrder;
        
        // 삽입 위치 이후의 모든 행의 display_order를 1씩 증가
        const recordsToUpdate = records
          .filter(r => r.id && (r.display_order || 0) >= targetOrder)
          .map(r => ({
            id: r.id,
            display_order: (r.display_order || 0) + 1
          }));
        
        if (recordsToUpdate.length > 0) {
          await axiosInstance.put('/drbet/reorder', {
            records: recordsToUpdate
          });
        }
      } else {
        // 맨 끝에 추가하는 경우
        const maxOrder = records.length > 0 ? Math.max(...records.map(r => r.display_order || 0)) : -1;
        displayOrder = maxOrder + 1;
      }
      
      await axiosInstance.post('/drbet', {
        record_date: selectedDate,
        display_order: displayOrder
      });
      toast.success('행이 추가되었습니다');
      await loadRecords(true); // 강제 새로고침
    } catch (error) {
      console.error('행 추가 실패:', error);
      toast.error('행 추가에 실패했습니다');
    }
  };

  // 자동어제불러오기: 어제 데이터의 유저/사이트 조합을 그대로 가져와서 충전금액 범위 기반으로 자동 생성
  const loadAutoYesterdayData = async () => {
    try {
      const today = new Date(selectedDate);
      const yesterday = new Date(today);
      yesterday.setDate(yesterday.getDate() - 1);
      const yesterdayStr = getKSTDateString(yesterday);
      
      // 어제 데이터 가져오기
      const response = await axiosInstance.get('/drbet');
      const allRecords = response.data;
      const yesterdayRecords = allRecords.filter(r => r.record_date === yesterdayStr);
      
      if (yesterdayRecords.length === 0) {
        toast.error('어제 데이터가 없습니다');
        return;
      }
      
      // 어제 데이터에서 유저/사이트 조합 추출 (재충 제외, 충전금액 없는 것 제외)
      const yesterdayPairs = []; // { identityName, siteName, yesterdayCharge }[]
      const yesterdayCharges = {}; // { "identityName||siteName": chargeAmount } (어제와 다른 금액 생성용)
      const seenPairs = new Set(); // 이미 본 유저/사이트 조합 (재충 확인용)
      
      // 통계용
      let totalItems = 0; // 전체 항목 수 (유저/사이트/충환전이 모두 있는 것)
      let noChargeCount = 0; // 충전금액 없는 항목 수
      let duplicateCount = 0; // 재충 항목 수
      const duplicatePairs = []; // 재충된 조합 목록
      const noChargePairs = []; // 충전금액 없는 조합 목록
      
      yesterdayRecords.forEach(record => {
        for (let i = 1; i <= 4; i++) {
          const identityName = record[`identity${i}`];
          const siteName = record[`site_name${i}`];
          const chargeWithdraw = record[`charge_withdraw${i}`];
          
          if (identityName && siteName && chargeWithdraw) {
            totalItems++;
            const parts = chargeWithdraw.trim().split(/\s+/);
            const charge = parts[0] ? parseFloat(parts[0]) : 0;
            
            const pairKey = `${identityName.trim()}||${siteName.trim()}`;
            
            // 충전금액이 없으면 제외
            if (charge <= 0) {
              noChargeCount++;
              noChargePairs.push({ identityName: identityName.trim(), siteName: siteName.trim() });
              continue;
            }
            
            // 재충(중복된 유저/사이트 조합) 제외
            if (seenPairs.has(pairKey)) {
              duplicateCount++;
              duplicatePairs.push({ identityName: identityName.trim(), siteName: siteName.trim() });
              continue;
            }
            
            seenPairs.add(pairKey);
            
            // 어제 충전금액 저장 (어제와 다른 금액 생성용) - 유저+사이트 조합별로 저장
            yesterdayCharges[pairKey] = charge;
            
            // 유저/사이트 조합 저장
            yesterdayPairs.push({
              identityName: identityName.trim(),
              siteName: siteName.trim(),
              yesterdayCharge: charge
            });
          }
        }
      });
      
      if (yesterdayPairs.length === 0) {
        toast.error('어제 데이터에 유효한 유저/사이트 조합이 없습니다');
        return;
      }
      
      log('[자동어제불러오기] 어제 데이터 분석:');
      log('  - 전체 어제 레코드 수:', yesterdayRecords.length, '개');
      log('  - 전체 항목 수 (유저/사이트/충환전 모두 있는 것):', totalItems, '개');
      log('  - 충전금액 없는 항목:', noChargeCount, '개', noChargePairs.length > 0 ? noChargePairs : '');
      log('  - 재충 항목:', duplicateCount, '개', duplicatePairs.length > 0 ? duplicatePairs : '');
      log('  - 재충 및 충전금액 없는 항목 제외 후:', yesterdayPairs.length, '개');
      log('  - 계산 확인:', totalItems, '-', noChargeCount, '-', duplicateCount, '=', yesterdayPairs.length);
      log('  - 유효한 유저/사이트 조합:', yesterdayPairs);
      
      // 어제 조합에서 사용된 사이트 목록 수집 (중복 제거)
      const uniqueSites = [...new Set(yesterdayPairs.map(p => p.siteName))];
      
      // 사이트별 충전금액 범위 정보 bulk 조회
      const siteRequests = uniqueSites.map(siteName => ({
        site_name: siteName,
        identity_name: null // 공유 데이터 조회
      }));
      
      const bulkResponse = await axiosInstance.post('/site-notes/bulk', { 
        requests: siteRequests 
      });
      
      const siteChargeRanges = {}; // { "siteName": { chargeMin, chargeMax } }
      
      if (bulkResponse.data?.success && Array.isArray(bulkResponse.data.results)) {
        bulkResponse.data.results.forEach(item => {
          if (item?.site_name && item?.data) {
            const actualData = item.data.data || item.data;
            const chargeMin = actualData.chargeMin !== undefined && actualData.chargeMin !== null ? Number(actualData.chargeMin) : null;
            const chargeMax = actualData.chargeMax !== undefined && actualData.chargeMax !== null ? Number(actualData.chargeMax) : null;
            
            if (chargeMin !== null && chargeMax !== null && chargeMax > chargeMin) {
              siteChargeRanges[item.site_name] = { chargeMin, chargeMax };
            }
          }
        });
      }
      
      // 충전금액 범위가 설정되지 않은 사이트 필터링
      const validPairs = yesterdayPairs.filter(pair => {
        return siteChargeRanges[pair.siteName] !== undefined;
      });
      
      const noChargeRangePairs = yesterdayPairs.filter(pair => {
        return siteChargeRanges[pair.siteName] === undefined;
      });
      
      log('[자동어제불러오기] 충전금액 범위 필터링:');
      log('  - 어제 조합 (재충/충전금액 없는 것 제외 후):', yesterdayPairs.length, '개');
      log('  - 충전금액 범위가 설정되지 않은 사이트:', noChargeRangePairs.length, '개', noChargeRangePairs);
      log('  - 최종 유효한 조합 (충전금액 범위 있는 것만):', validPairs.length, '개');
      
      if (validPairs.length === 0) {
        toast.error('충전금액 범위가 설정된 사이트가 없습니다');
        return;
      }
      
      // 유저 순서 기준으로 정렬 (사이트 관리의 유저 순서 사용)
      // identities 배열의 순서를 기준으로 유저 우선순위 설정
      const identityOrder = identities.map(id => id.name);
      const identityOrderMap = new Map();
      identityOrder.forEach((name, index) => {
        identityOrderMap.set(name, index);
      });
      
      // 거리 기반 매칭 + 그룹 보조
      // 각 조합의 충전금액 범위 중간값과 그룹 키 계산
      const pairsWithDistance = validPairs.map(pair => {
        const range = siteChargeRanges[pair.siteName];
        const mid = (range.chargeMin + range.chargeMax) / 2;
        const groupKey = Math.round(mid / 10) * 10; // 10 단위로 반올림 (보조용)
        const identityOrderIndex = identityOrderMap.get(pair.identityName) ?? 999; // 유저 순서 인덱스
        return { ...pair, mid, groupKey, identityOrderIndex };
      });
      
      // 유저 순서 우선으로 정렬 (첫 번째 항목 선택을 위해)
      pairsWithDistance.sort((a, b) => {
        if (a.identityOrderIndex !== b.identityOrderIndex) {
          return a.identityOrderIndex - b.identityOrderIndex;
        }
        // 같은 유저면 중간값 순서
        return a.mid - b.mid;
      });
      
      // 거리 기반으로 행 생성
      const newRecords = [];
      let remainingPairs = [...pairsWithDistance];
      const usedPairsGlobal = new Set(); // 전체 행에서 사용된 유저/사이트 조합 (전역 중복 방지)
      const skippedPairs = []; // 전역 중복으로 스킵된 조합 (디버깅용)
      
      log('[자동어제불러오기] 행 생성 시작:', {
        totalPairs: pairsWithDistance.length,
        pairs: pairsWithDistance.map(p => `${p.identityName}||${p.siteName} (mid: ${p.mid})`)
      });
      
      // 모든 항목이 처리될 때까지 반복
      while (remainingPairs.length > 0) {
        let currentRow = { sites: [] };
        const usedIdentitiesInRow = new Set(); // 현재 행에서 사용된 유저
        const usedSitesInRow = new Set(); // 현재 행에서 사용된 사이트
        const processedIndices = []; // 이번 반복에서 처리된 인덱스
        let baseMid = null; // 첫 번째 항목의 중간값 (거리 계산 기준)
        let baseGroupKey = null; // 첫 번째 항목의 그룹 키 (보조 기준)
        let firstCharge = null; // 첫 번째 항목의 충전금액 (나머지 항목들이 사용할 값)
        
        // 첫 번째 항목 선택 (유저 순서 우선, 이미 사용된 조합 제외)
        let firstPairIndex = -1;
        for (let i = 0; i < remainingPairs.length; i++) {
          const pair = remainingPairs[i];
          const pairKey = `${pair.identityName}||${pair.siteName}`;
          
          // 이미 다른 행에서 사용된 조합이면 스킵
          if (usedPairsGlobal.has(pairKey)) {
            if (pairKey.includes('김동욱') && pairKey.includes('골든런')) {
              log('[자동어제불러오기] 김동욱 골든런이 전역 중복으로 스킵됨:', {
                pairKey,
                usedPairsGlobal: Array.from(usedPairsGlobal),
                remainingPairs: remainingPairs.map(p => `${p.identityName}||${p.siteName}`)
              });
            }
            skippedPairs.push({ pairKey, reason: '전역 중복' });
            continue;
          }
          
          firstPairIndex = i;
          const { identityName, siteName, mid, groupKey } = pair;
          
          if (pairKey.includes('김동욱') && pairKey.includes('골든런')) {
            log('[자동어제불러오기] 김동욱 골든런이 첫 번째 항목으로 선택됨:', {
              pairKey,
              mid,
              groupKey,
              currentRowSites: currentRow.sites.length
            });
          }
          
          // 충전금액 범위 내에서 랜덤 금액 생성 (어제와 다른 금액) - 첫 번째 항목만 랜덤
          // 유저+사이트 조합별로 어제 충전금액과 비교
          const range = siteChargeRanges[siteName];
          const currentPairKey = `${identityName}||${siteName}`;
          const yesterdayCharge = yesterdayCharges[currentPairKey];
          let charge;
          let attempts = 0;
          do {
            charge = Math.floor(Math.random() * (range.chargeMax - range.chargeMin + 1)) + range.chargeMin;
            attempts++;
          } while (yesterdayCharge !== undefined && yesterdayCharge === charge && attempts < 10);
          
          firstCharge = charge; // 첫 번째 항목의 충전금액 저장
          
          currentRow.sites.push({ siteName, identityName, charge });
          usedIdentitiesInRow.add(identityName);
          usedSitesInRow.add(siteName);
          usedPairsGlobal.add(pairKey); // 전역 사용 표시
          processedIndices.push(i);
          baseMid = mid;
          baseGroupKey = groupKey;
          break;
        }
        
        // 첫 번째 항목을 찾지 못했으면 이번 반복 종료
        if (firstPairIndex === -1) {
          const remainingKeys = remainingPairs.map(p => `${p.identityName}||${p.siteName}`);
          if (remainingKeys.some(k => k.includes('김동욱') && k.includes('골든런'))) {
            log('[자동어제불러오기] 첫 번째 항목을 찾지 못함, 김동욱 골든런이 남아있음:', {
              remainingPairs: remainingKeys,
              usedPairsGlobal: Array.from(usedPairsGlobal)
            });
          }
          break;
        }
        
        // 두 번째 항목부터: 첫 번째 항목의 금액이 포함되는 충전금액 범위를 가진 사이트들 찾기
        // 그 다음 유저 순서대로 정렬해서 배치
        const compatiblePairs = remainingPairs
          .map((pair, idx) => ({ pair, idx }))
          .filter(({ pair, idx }) => {
            // 이미 처리된 항목은 제외
            if (processedIndices.includes(idx)) return false;
            
            const pairKey = `${pair.identityName}||${pair.siteName}`;
            
            // 이미 다른 행에서 사용된 조합이면 제외
            if (usedPairsGlobal.has(pairKey)) return false;
            
            // 현재 행에 이미 사용된 유저나 사이트면 제외
            if (usedIdentitiesInRow.has(pair.identityName) || usedSitesInRow.has(pair.siteName)) return false;
            
            // 첫 번째 항목의 금액이 이 사이트의 충전금액 범위에 포함되는지 확인
            const range = siteChargeRanges[pair.siteName];
            if (!range) return false;
            return firstCharge >= range.chargeMin && firstCharge <= range.chargeMax;
          })
          .map(({ pair, idx }) => ({ ...pair, originalIndex: idx }))
          .sort((a, b) => {
            // 유저 순서 우선
            if (a.identityOrderIndex !== b.identityOrderIndex) {
              return a.identityOrderIndex - b.identityOrderIndex;
            }
            // 같은 유저면 원래 인덱스 순서 유지
            return a.originalIndex - b.originalIndex;
          });
        
        // 호환되는 항목들을 유저 순서대로 추가 (최대 4개까지)
        // 한 행에는 같은 유저나 같은 사이트가 중복되지 않도록 체크
        for (let j = 0; j < compatiblePairs.length && currentRow.sites.length < 4; j++) {
          const compatiblePair = compatiblePairs[j];
          const pairKey = `${compatiblePair.identityName}||${compatiblePair.siteName}`;
          
          // 한 행에 같은 유저나 같은 사이트가 중복되지 않도록 다시 한 번 확인
          if (usedIdentitiesInRow.has(compatiblePair.identityName)) {
            log(`[자동어제불러오기] 유저 중복으로 스킵: ${compatiblePair.identityName} (이미 사용됨)`);
            continue;
          }
          if (usedSitesInRow.has(compatiblePair.siteName)) {
            log(`[자동어제불러오기] 사이트 중복으로 스킵: ${compatiblePair.siteName} (이미 사용됨)`);
            continue;
          }
          if (usedPairsGlobal.has(pairKey)) {
            log(`[자동어제불러오기] 조합 중복으로 스킵: ${pairKey} (이미 전역 사용됨)`);
            continue;
          }
          
          currentRow.sites.push({ 
            siteName: compatiblePair.siteName, 
            identityName: compatiblePair.identityName, 
            charge: firstCharge 
          });
          usedIdentitiesInRow.add(compatiblePair.identityName);
          usedSitesInRow.add(compatiblePair.siteName);
          usedPairsGlobal.add(pairKey); // 전역 사용 표시
          processedIndices.push(compatiblePair.originalIndex);
        }
        
        // 처리된 항목들을 remainingPairs에서 제거 (역순으로 제거하여 인덱스 유지)
        // processedIndices를 정렬한 후 역순으로 제거해야 인덱스가 맞음
        const sortedIndices = [...processedIndices].sort((a, b) => b - a);
        sortedIndices.forEach(idx => {
          const removedPair = remainingPairs[idx];
          if (removedPair) {
            const removedPairKey = `${removedPair.identityName}||${removedPair.siteName}`;
            if (removedPairKey.includes('김동욱') && removedPairKey.includes('골든런')) {
              log('[자동어제불러오기] 김동욱 골든런이 remainingPairs에서 제거됨:', {
                idx,
                pairKey: removedPairKey,
                remainingPairsBefore: remainingPairs.map(p => `${p.identityName}||${p.siteName}`),
                processedIndices
              });
            }
          }
          remainingPairs.splice(idx, 1);
        });
        
        if (remainingPairs.some(p => `${p.identityName}||${p.siteName}`.includes('김동욱') && `${p.identityName}||${p.siteName}`.includes('골든런'))) {
          log('[자동어제불러오기] 김동욱 골든런이 remainingPairs에 아직 남아있음:', {
            remainingPairs: remainingPairs.map(p => `${p.identityName}||${p.siteName}`),
            usedPairsGlobal: Array.from(usedPairsGlobal)
          });
        }
        
        // 행이 비어있지 않으면 추가 (1개라도 있으면 추가)
        if (currentRow.sites.length > 0) {
          newRecords.push(currentRow);
        } else {
          // 더 이상 추가할 수 없으면 종료 (무한 루프 방지)
          break;
        }
      }
      
      // 조합 개수가 가장 많은 행부터 정렬
      newRecords.sort((a, b) => b.sites.length - a.sites.length);
      
      // 생성된 조합 목록
      const createdPairs = new Set();
      newRecords.forEach(row => {
        row.sites.forEach(site => {
          createdPairs.add(`${site.identityName}||${site.siteName}`);
        });
      });
      
      // 예상 조합 목록
      const expectedPairsSet = new Set(pairsWithDistance.map(p => `${p.identityName}||${p.siteName}`));
      
      // 누락된 조합 찾기
      const missingPairs = [];
      pairsWithDistance.forEach(pair => {
        const pairKey = `${pair.identityName}||${pair.siteName}`;
        if (!createdPairs.has(pairKey)) {
          missingPairs.push({
            identityName: pair.identityName,
            siteName: pair.siteName,
            mid: pair.mid,
            groupKey: pair.groupKey
          });
        }
      });
      
      log('[자동어제불러오기] 행 생성 완료:');
      log('  - 예상 조합 개수:', pairsWithDistance.length, '개');
      log('  - 생성된 행 개수:', newRecords.length, '개');
      log('  - 생성된 조합 개수:', createdPairs.size, '개');
      log('  - 누락된 조합 개수:', missingPairs.length, '개');
      log('  - 누락된 조합 목록:', missingPairs);
      log('  - 생성된 조합 목록:', Array.from(createdPairs).sort());
      log('  - 각 행 상세:');
      newRecords.forEach((row, idx) => {
        log(`    행${idx + 1} (${row.sites.length}개):`, row.sites.map(s => `${s.identityName}||${s.siteName}`));
      });
      
      if (newRecords.length === 0) {
        toast.error('생성할 데이터가 없습니다');
        return;
      }
      
      // DB에 저장
      const maxOrder = records.length > 0 ? Math.max(...records.map(r => r.display_order || 0)) : -1;
      
      // 저장된 레코드들의 출석일 정보를 수집 (loadRecords 후에 다시 적용하기 위해)
      const savedAttendanceDaysMap = {}; // { "유저||사이트": 출석일 }
      const savedRecords = []; // 저장된 레코드들
      
      for (let i = 0; i < newRecords.length; i++) {
        const row = newRecords[i];
        const newRecord = {
          id: null,
          tmpId: `tmp-${Date.now()}-${Math.random().toString(36).slice(2,8)}-${i}`,
          record_date: selectedDate,
          display_order: maxOrder + 1 + i,
          drbet_amount: 0,
          private_amount: 0,
          total_charge: 0,
          total_amount: 0,
          margin: 0,
          rate_amount: 0,
          site1: '',
          site2: '',
          site3: '',
          site4: '',
          notes: '',
          identity1: '',
          identity2: '',
          identity3: '',
          identity4: '',
          site_name1: '',
          site_name2: '',
          site_name3: '',
          site_name4: '',
          charge_withdraw1: '',
          charge_withdraw2: '',
          charge_withdraw3: '',
          charge_withdraw4: '',
          cumulative_charge1: 0,
          cumulative_withdraw1: 0,
          cumulative_charge2: 0,
          cumulative_withdraw2: 0,
          isNew: true
        };
        
        // 사이트 정보 채우기
        row.sites.forEach((site, idx) => {
          const slot = idx + 1;
          newRecord[`identity${slot}`] = site.identityName;
          newRecord[`site_name${slot}`] = site.siteName;
          newRecord[`charge_withdraw${slot}`] = `${site.charge}`; // 충전만 (환전은 0)
        });
        
        try {
          // 서버 응답에서 출석일 정보 받아서 캐시 업데이트
          const response = await axiosInstance.post('/drbet', newRecord);
          const saved = response.data;
          
          // 출석일 정보 수집
          if (saved._attendanceDays) {
            Object.assign(savedAttendanceDaysMap, saved._attendanceDays);
          }
          savedRecords.push(saved);
          
          // 즉시 출석일 캐시 업데이트
          refreshAttendanceDaysForRecord(saved);
        } catch (error) {
          console.error('자동어제 데이터 저장 실패:', error);
        }
      }
      
      // 저장된 레코드들의 출석일 통계 캐시 무효화 (최신 데이터를 가져오기 위해)
      const attendanceCombos = new Set(); // 중복 제거용
      savedRecords.forEach(saved => {
        for (let i = 1; i <= 4; i++) {
          const identityName = saved[`identity${i}`];
          const siteName = saved[`site_name${i}`];
          if (identityName && siteName) {
            invalidateAttendanceCache(siteName, identityName);
            attendanceCombos.add(`${identityName}||${siteName}`);
          }
        }
      });
      
      // 서버에서 반환한 _attendanceDays를 즉시 적용 (UI에 바로 반영)
      if (Object.keys(savedAttendanceDaysMap).length > 0) {
        const attendanceDaysUpdates = {};
        Object.keys(savedAttendanceDaysMap).forEach(mapKey => {
          const [identityName, siteName] = mapKey.split('||');
          const attendanceCacheKey = getAttendanceCacheKey(siteName, identityName);
          attendanceDaysUpdates[attendanceCacheKey] = savedAttendanceDaysMap[mapKey];
        });
        
        // state 업데이트
        setSiteAttendanceDays(prev => ({
          ...prev,
          ...attendanceDaysUpdates
        }));
      }
      
      // 새 레코드 추가 후 화면 새로고침
      await loadRecords();
      
      // loadRecords 후에 저장된 레코드들의 출석일 통계를 서버에서 다시 조회
      // 배치 API를 사용하여 한 번에 조회 (더 빠르고 확실함)
      if (attendanceCombos.size > 0) {
        const sitesToLoad = Array.from(attendanceCombos).map(combo => {
          const [identityName, siteName] = combo.split('||');
          return { siteName, identityName };
        });
        
        try {
          const response = await axiosInstance.post('/attendance/stats/batch', {
            sites: sitesToLoad
          });
          
          if (response.data?.success && Array.isArray(response.data.results)) {
            const attendanceDaysUpdates = {};
            
            response.data.results.forEach(result => {
              const { siteName, identityName, consecutiveDays, error } = result;
              if (!error) {
                const cacheKey = getAttendanceCacheKey(siteName, identityName);
                attendanceDaysUpdates[cacheKey] = consecutiveDays || 0;
                
                // 캐시에도 저장
                attendanceStatsCacheRef.current[cacheKey] = {
                  consecutiveDays: consecutiveDays || 0,
                  timestamp: Date.now()
                };
              }
            });
            
            // state 업데이트
            setSiteAttendanceDays(prev => ({
              ...prev,
              ...attendanceDaysUpdates
            }));
          }
        } catch (error) {
          console.error('출석일 통계 배치 조회 실패:', error);
        }
      }
      
      // 강제 리렌더링 (UI 업데이트 보장)
      setRefreshTick((t) => t + 1);
      
      toast.success(`자동어제 데이터 ${newRecords.length}개 행이 추가되었습니다`);
    } catch (error) {
      console.error('자동어제 데이터 불러오기 실패:', error);
      toast.error('자동어제 데이터를 불러오는데 실패했습니다');
    }
  };

  // 어제 데이터 불러오기
  const loadYesterdayData = async () => {
    try {
      const today = new Date(selectedDate);
      const yesterday = new Date(today);
      yesterday.setDate(yesterday.getDate() - 1);
      const yesterdayStr = getKSTDateString(yesterday);
      
      // 어제 데이터 가져오기
      const response = await axiosInstance.get('/drbet');
      const allRecords = response.data;
      const yesterdayRecords = allRecords.filter(r => r.record_date === yesterdayStr);
      


      
      if (yesterdayRecords.length === 0) {
        toast.error('어제 데이터가 없습니다');
        return;
      }
      
      // 어제 데이터 상세 출력
      yesterdayRecords.forEach((record, index) => {
        log(`어제 레코드 ${index + 1}:`, {
          id: record.id,
          date: record.record_date,
          identity1: record.identity1,
          site_name1: record.site_name1,
          identity2: record.identity2,
          site_name2: record.site_name2,
          identity3: record.identity3,
          site_name3: record.site_name3,
          identity4: record.identity4,
          site_name4: record.site_name4,
          site1: record.site1,
          site2: record.site2,
          site3: record.site3,
          site4: record.site4
        });
      });
      
      // 현재 날짜로 복사하여 새 레코드 생성
      const maxOrder = records.length > 0 ? Math.max(...records.map(r => r.display_order || 0)) : -1;
      
      // 어제 레코드들을 오늘로 복사 (charge_withdraw와 notes는 빈 상태로)
      const newRecords = yesterdayRecords.map((record, index) => {
        // 기존 site1~4 필드에서 사이트 정보 파싱 (하위 호환성)
        const parseOldSiteData = (siteData) => {
          if (!siteData || !siteData.trim()) return { identity: '', site_name: '' };
          const parts = siteData.trim().split(/\s+/);
          // "5454 루카" 형식이면 identity와 site_name 추출
          if (parts.length >= 2) {
            return { 
              identity: parts[0], 
              site_name: parts[1] 
            };
          }
          // 단일 값이면 둘 다 같은 값으로 설정
          if (parts.length === 1 && parts[0]) {
            return { 
              identity: parts[0], 
              site_name: parts[0] 
            };
          }
          return { identity: '', site_name: '' };
        };
        
        const site1Data = parseOldSiteData(record.site1);
        const site2Data = parseOldSiteData(record.site2);
        const site3Data = parseOldSiteData(record.site3);
        const site4Data = parseOldSiteData(record.site4);
        
        const copiedRecord = {
          id: null,
          tmpId: `tmp-${Date.now()}-${Math.random().toString(36).slice(2,8)}-${index}`,
          record_date: selectedDate,
          display_order: maxOrder + 1 + index,
          drbet_amount: record.drbet_amount || 0,
          private_amount: record.private_amount || 0,
          total_charge: 0,
          total_amount: 0,
          margin: 0,
          rate_amount: 0,
          site1: record.site1 || '',
          site2: record.site2 || '',
          site3: record.site3 || '',
          site4: record.site4 || '',
          notes: '', // 특이사항은 빈 상태로
          
          // 새로운 구조 필드들 복사 (기존 site1~4에서 추출)
          identity1: record.identity1 || site1Data.identity || '',
          identity2: record.identity2 || site2Data.identity || '',
          identity3: record.identity3 || site3Data.identity || '',
          identity4: record.identity4 || site4Data.identity || '',
          site_name1: record.site_name1 || site1Data.site_name || '',
          site_name2: record.site_name2 || site2Data.site_name || '',
          site_name3: record.site_name3 || site3Data.site_name || '',
          site_name4: record.site_name4 || site4Data.site_name || '',
          charge_withdraw1: '', // 충환전은 빈 상태로
          charge_withdraw2: '',
          charge_withdraw3: '',
          charge_withdraw4: '',
          
          cumulative_charge1: 0,
          cumulative_withdraw1: 0,
          cumulative_charge2: 0,
          cumulative_withdraw2: 0,
          isNew: true
        };
        
        return copiedRecord;
      });
      

      
      // DB에 저장
      for (const newRecord of newRecords) {
        log('저장할 레코드:', {
          identity1: newRecord.identity1,
          site_name1: newRecord.site_name1,
          identity2: newRecord.identity2,
          site_name2: newRecord.site_name2,
          identity3: newRecord.identity3,
          site_name3: newRecord.site_name3,
          identity4: newRecord.identity4,
          site_name4: newRecord.site_name4
        });
        try {
          await axiosInstance.post('/drbet', newRecord);
        } catch (error) {
          console.error('어제 데이터 저장 실패:', error);
        }
      }
      
      // 새 레코드 추가 후 화면 새로고침
      await loadRecords();
      
      toast.success(`어제 데이터 ${yesterdayRecords.length}개 행이 추가되었습니다`);
    } catch (error) {
      console.error('어제 데이터 불러오기 실패:', error);
      toast.error('어제 데이터를 불러오는데 실패했습니다');
    }
  };

  // 셀 클릭 핸들러
  const handleCellDoubleClick = (recordId, field, currentValue) => {
    setEditingCell({ recordId, field });
    
    // 숫자 필드인 경우 포맷된 값에서 숫자만 추출
    if (field === 'drbet_amount' || field === 'total_amount' || field === 'rate_amount') {
      // 토탈금액은 "입력값(원)"만 보이도록: total_amount - 환전합계(원)
      if (field === 'total_amount') {
        const targetRecord = records.find(
          (r) => (r.id || 'new') === recordId
        );
        if (targetRecord) {
          const withdrawTotalMan = getWithdrawTotalInManwon(targetRecord);
          const withdrawTotalWon = withdrawTotalMan * 10000;
          const totalWon = targetRecord.total_amount || 0;
          const inputWon = Math.max(totalWon - withdrawTotalWon, 0);
          const inputStr = inputWon.toString();
          setEditingValue(inputStr === '0' ? '' : inputStr);
          return;
        }
      }

      // drbet_amount, rate_amount 또는 fallback
      if (typeof currentValue === 'string') {
        // "원" 제거하고 쉼표 제거 후 숫자만 추출
        const numStr = currentValue.replace(/원/g, '').replace(/,/g, '').trim();
        setEditingValue(numStr === '0' ? '' : (numStr || ''));
      } else {
        const numValue = currentValue?.toString() || '';
        setEditingValue(numValue === '0' ? '' : numValue);
      }
    } else {
      setEditingValue(currentValue || '');
    }
  };

  // 특이사항 문자열을 구조화된 데이터로 파싱
  const parseNotesToStructured = (notes, recordSites) => {
    // recordSites: [{ id: 1, name: '샷벳' }, { id: 2, name: '원탑벳' }]
    const structured = {
      sites: {}, // { siteName: { points: [{ type: '출석', amount: 10 }, ...], chips: [{ type: 'chip', amount: 30, loss: 'won' }, ...] } }
      bategis: [], // [{ amount: 100, type: '충' }]
      manuals: [] // ['메모1', '메모2']
    };
    
    if (!notes || !notes.trim()) return structured;
    
    const parts = notes.split('/').filter(p => p.trim());
    
    parts.forEach(part => {
      const trimmed = part.trim();
      
      // 바때기 패턴
      const bategiMatch = trimmed.match(/^바때기([\d.]+)(충|환)$/);
      if (bategiMatch) {
        structured.bategis.push({
          amount: parseFloat(bategiMatch[1]) || 0,
          type: bategiMatch[2]
        });
        return;
      }
      
      // 수동 입력 패턴
      const manualMatch = trimmed.match(/^\[수동\](.+)$/);
      if (manualMatch) {
        structured.manuals.push(manualMatch[1].replace(/／/g, '/').trim());
        return;
      }
      
      // 칩실수 패턴 - 포인트처럼 사이트이름+종류+금액 순서
      // 새 형식(사이트이름+종류+금액)과 기존 형식(종류+사이트이름+금액) 모두 지원
      let matchedSite = null;
      let chipPrefix = '';
      let amount = '';
      let loss = '';
      
      // 새 형식: 사이트이름+종류+금액+먹/못먹
      for (const site of recordSites) {
        const fullName = site.name;
        const shortName = fullName.length >= 2 ? fullName.substring(0, 2) : fullName;
        
        // 전체 이름으로 매칭 시도
        const fullNamePattern = new RegExp(`^${fullName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(배거|칩팅|칩실수)(\\d+)(먹|못먹)`);
        const fullNameMatch = trimmed.match(fullNamePattern);
        if (fullNameMatch) {
          matchedSite = site;
          chipPrefix = fullNameMatch[1];
          amount = fullNameMatch[2];
          loss = fullNameMatch[3];
          break;
        }
        
        // 앞 2글자로 매칭 시도
        const shortNamePattern = new RegExp(`^${shortName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(배거|칩팅|칩실수)(\\d+)(먹|못먹)`);
        const shortNameMatch = trimmed.match(shortNamePattern);
        if (shortNameMatch) {
          matchedSite = site;
          chipPrefix = shortNameMatch[1];
          amount = shortNameMatch[2];
          loss = shortNameMatch[3];
          break;
        }
      }
      
      // 새 형식 매칭 실패 시 기존 형식 시도: 종류+사이트이름+금액+먹/못먹
      if (!matchedSite) {
        const chipPrefixMatch = trimmed.match(/^(배거|칩팅|칩실수)/);
        if (chipPrefixMatch) {
          chipPrefix = chipPrefixMatch[1];
          const remaining = trimmed.substring(chipPrefix.length);
          
          // 사이트 이름을 먼저 찾기 (전체 이름 우선, 그 다음 앞 2글자)
          for (const site of recordSites) {
            const fullName = site.name;
            if (remaining.startsWith(fullName)) {
              const remainingAfterSite = remaining.substring(fullName.length);
              const amountMatch = remainingAfterSite.match(/^(\d+)(먹|못먹)/);
              if (amountMatch) {
                matchedSite = site;
                amount = amountMatch[1];
                loss = amountMatch[2];
                break;
              }
            }
          }
          
          if (!matchedSite) {
            for (const site of recordSites) {
              const fullName = site.name;
              const shortName = fullName.length >= 2 ? fullName.substring(0, 2) : fullName;
              if (remaining.startsWith(shortName)) {
                const remainingAfterSite = remaining.substring(shortName.length);
                const amountMatch = remainingAfterSite.match(/^(\d+)(먹|못먹)/);
                if (amountMatch) {
                  matchedSite = site;
                  amount = amountMatch[1];
                  loss = amountMatch[2];
                  break;
                }
              }
            }
          }
        }
      }
      
      if (matchedSite) {
        if (!structured.sites[matchedSite.name]) {
          structured.sites[matchedSite.name] = { points: [], chips: [] };
        }
        structured.sites[matchedSite.name].chips.push({
          type: chipPrefix === '배거' ? 'bager' : chipPrefix === '칩팅' ? 'chipting' : 'chip',
          amount: parseFloat(amount) || 0,
          loss: loss === '못먹' ? 'lost' : 'won'
        });
        return;
      }
      
      // 포인트 패턴 (포인트 종류 포함) - 사이트 이름에 숫자 포함 가능
      const pointTypeMatch = trimmed.match(/^([가-힣a-zA-Z0-9]+?)(출석|페이백|정착|요율|지추|첫충|매충|입플)([\d.]+)$/);
      if (pointTypeMatch) {
        const [, siteNameFromText, pointType, amount] = pointTypeMatch;
        // 사이트 이름 매칭 (전체 이름 또는 앞 2글자, 숫자 포함)
        const site = recordSites.find(s => {
          const fullName = s.name;
          const shortName = fullName.length >= 2 ? fullName.substring(0, 2) : fullName;
          return fullName === siteNameFromText || shortName === siteNameFromText;
        });
        
        if (site) {
          if (!structured.sites[site.name]) {
            structured.sites[site.name] = { points: [], chips: [] };
          }
          structured.sites[site.name].points.push({
            type: pointType,
            amount: parseFloat(amount) || 0
          });
        }
        return;
      }
      
      // 일반 포인트 패턴 (포인트 종류 없음) - 사이트 이름에 숫자 포함 가능
      // 주의: 숫자로 끝나는 사이트명과 금액을 구분하기 위해 최소 매칭 사용
      const simplePointMatch = trimmed.match(/^([가-힣a-zA-Z0-9]+?)([\d.]+)$/);
      if (simplePointMatch) {
        const [, siteNameFromText, amount] = simplePointMatch;
        // 사이트 이름 매칭 (전체 이름 또는 앞 2글자, 숫자 포함)
        const site = recordSites.find(s => {
          const fullName = s.name;
          const shortName = fullName.length >= 2 ? fullName.substring(0, 2) : fullName;
          return fullName === siteNameFromText || shortName === siteNameFromText;
        });
        
        if (site) {
          if (!structured.sites[site.name]) {
            structured.sites[site.name] = { points: [], chips: [] };
          }
          structured.sites[site.name].points.push({
            type: '', // 포인트 종류 없음
            amount: parseFloat(amount) || 0
          });
        }
      }
    });
    
    return structured;
  };
  
  // 구조화된 데이터를 문자열로 변환
  const structuredToNotesString = (structured) => {
    const parts = [];
    
    // 사이트별 포인트와 칩실수
    Object.entries(structured.sites || {}).forEach(([siteName, data]) => {
      // 포인트들 (amount가 빈 값이거나 0이면 제외)
      (data.points || []).forEach(point => {
        const amount = point.amount === '' || point.amount === 0 ? 0 : (parseFloat(point.amount) || 0);
        if (amount > 0) {
          if (point.type) {
            parts.push(`${siteName}${point.type}${amount}`);
          } else {
            parts.push(`${siteName}${amount}`);
          }
        }
      });
      
      // 칩실수들 (amount가 빈 값이거나 0이면 제외)
      // 포인트처럼 사이트이름+종류+금액 순서로 표시
      (data.chips || []).forEach(chip => {
        const amount = chip.amount === '' || chip.amount === 0 ? 0 : (parseFloat(chip.amount) || 0);
        if (amount > 0) {
          const chipPrefix = chip.type === 'bager' ? '배거' : chip.type === 'chipting' ? '칩팅' : '칩실수';
          const lossText = chip.loss === 'lost' ? '못먹' : '먹';
          parts.push(`${siteName}${chipPrefix}${amount}${lossText}`);
        }
      });
    });
    
    // 바때기들 (amount가 빈 값이거나 0이면 제외)
    (structured.bategis || []).forEach(bategi => {
      const amount = bategi.amount === '' || bategi.amount === 0 ? 0 : (parseFloat(bategi.amount) || 0);
      if (amount > 0) {
        parts.push(`바때기${amount}${bategi.type}`);
      }
    });
    
    // 수동 입력들 - [수동] 접두사 추가
    (structured.manuals || []).forEach(manual => {
      const sanitized = manual.replace(/\//g, '／').replace(/\r?\n/g, ' ').trim();
      if (sanitized) {
        // [수동] 접두사가 이미 있으면 그대로, 없으면 추가
        if (sanitized.startsWith('[수동]')) {
          parts.push(sanitized);
        } else {
          parts.push(`[수동]${sanitized}`);
        }
      }
    });
    
    return parts.join('/');
  };
  
  // 특이사항 인라인 편집 시작
  const startNotesInlineEdit = (record) => {
    const recordId = String(record.id ?? record.tmpId ?? 'new');
    
    // 레코드의 사이트 목록 추출
    const recordSites = [];
    for (let i = 1; i <= 4; i++) {
      const siteName = record[`site_name${i}`];
      if (siteName && siteName.trim()) {
        const fullSiteName = siteName.trim();
        if (!recordSites.find(s => s.name === fullSiteName)) {
          recordSites.push({ id: i, name: fullSiteName });
        }
      }
    }
    
    // 기존 notes를 구조화된 데이터로 파싱
    const structured = parseNotesToStructured(record.notes || '', recordSites);
    
    // 편집 데이터 설정
    setNotesEditData(prev => ({
      ...prev,
      [recordId]: structured
    }));
    
    // 편집 모드 활성화
    setEditingNotesRecordId(recordId);
    setEditingNotesRecordMeta({
      id: record.id ?? null,
      tmpId: record.tmpId ?? null
    });
    
    // 모든 사이트 펼치기
    setExpandedSites(prev => ({
      ...prev,
      [recordId]: recordSites.reduce((acc, site) => {
        acc[site.name] = true;
        return acc;
      }, {})
    }));
  };
  
  // 특이사항 인라인 편집 저장
  const saveNotesInlineEdit = async (record) => {
    // 중복 실행 방지
    if (savingNotesInlineRef.current) {
      log('특이사항 저장 중... 중복 요청 무시');
      return;
    }
    
    const recordId = String(record.id ?? record.tmpId ?? 'new');
    const structured = notesEditData[recordId];
    
    if (!structured) return;
    
    try {
      savingNotesInlineRef.current = true;
    
    // 구조화된 데이터를 문자열로 변환
    const notesString = structuredToNotesString(structured);
    
    // 레코드 업데이트
    const updatedRecord = { ...record, notes: notesString };
      // 낙관적 업데이트
      setRecords(prev => prev.map(r => {
        const match = (r.id || 'new') === (record.id || 'new') && (r.tmpId ? r.tmpId === record.tmpId : true);
        return match ? { ...r, notes: notesString, _v: (r._v || 0) + 1 } : r;
      }));
      setAllRecords(prev => prev.map(r => {
        const match = (r.id || 'new') === (record.id || 'new') && (r.tmpId ? r.tmpId === record.tmpId : true);
        return match ? { ...r, notes: notesString, _v: (r._v || 0) + 1 } : r;
      }));
      setRefreshTick(t => t + 1);
      
      // 서버 저장
      if (record.isNew || !record.id) {
        const response = await axiosInstance.post('/drbet', updatedRecord);
        const saved = response.data;
        setRecords(prev => prev.map(r => (r.tmpId && r.tmpId === record.tmpId ? { ...saved, tmpId: undefined, isNew: false } : r)));
        setAllRecords(prev => prev.map(r => (r.tmpId && r.tmpId === record.tmpId ? { ...saved, tmpId: undefined, isNew: false } : r)));
        setRefreshTick(t => t + 1);
      } else {
        await axiosInstance.put(`/drbet/${record.id}`, updatedRecord);
      }
      
      toast.success('특이사항이 저장되었습니다');
      
      // drbet_amount 재계산 필요 (특이사항 변경 시)
      const currentIndex = records.findIndex(r => (r.id || 'new') === (record.id || 'new') && (r.tmpId ? r.tmpId === record.tmpId : true));
      const previousRecord = currentIndex > 0 ? records[currentIndex - 1] : null;
      
      // 현재 행의 drbet_amount 재계산
      const recalculatedDrbetAmount = calculateDRBet(updatedRecord, previousRecord);
      const recalculatedPrivateAmount = calculatePrivateAmount(updatedRecord);
      const recalculatedTotalCharge = calculateTotalCharge(updatedRecord, recalculatedDrbetAmount);
      const recalculatedMargin = calculateMargin(updatedRecord, recalculatedTotalCharge);
      
      const finalRecord = {
        ...updatedRecord,
        drbet_amount: recalculatedDrbetAmount,
        private_amount: recalculatedPrivateAmount,
        total_charge: recalculatedTotalCharge,
        margin: recalculatedMargin
      };
      
      // 재계산된 값으로 상태 업데이트
      setRecords(prev => prev.map(r => {
        const match = (r.id || 'new') === (record.id || 'new') && (r.tmpId ? r.tmpId === record.tmpId : true);
        return match ? { ...r, ...finalRecord, _v: (r._v || 0) + 1 } : r;
      }));
      setAllRecords(prev => prev.map(r => {
        const match = (r.id || 'new') === (record.id || 'new') && (r.tmpId ? r.tmpId === record.tmpId : true);
        return match ? { ...r, ...finalRecord, _v: (r._v || 0) + 1 } : r;
      }));
      
      // 서버에도 재계산된 값 저장
      if (record.isNew || !record.id) {
        const response = await axiosInstance.post('/drbet', finalRecord);
        const saved = response.data;
        setRecords(prev => prev.map(r => (r.tmpId && r.tmpId === record.tmpId ? { ...saved, tmpId: undefined, isNew: false } : r)));
        setAllRecords(prev => prev.map(r => (r.tmpId && r.tmpId === record.tmpId ? { ...saved, tmpId: undefined, isNew: false } : r)));
      } else {
        await axiosInstance.put(`/drbet/${record.id}`, finalRecord);
      }
      
      // 다음 행들도 재계산 필요
      setTimeout(async () => {
        setAllRecords((currentAllRecords) => {
          const allRecordsCopy = [...currentAllRecords];
          const sameDateRecords = allRecordsCopy
            .filter(r => r.record_date === selectedDate)
            .sort((a, b) => (a.display_order || 0) - (b.display_order || 0));
          
          const savedIndex = sameDateRecords.findIndex(r => (r.id || 'new') === (record.id || 'new'));
          
          if (savedIndex >= 0) {
            sameDateRecords[savedIndex] = { ...sameDateRecords[savedIndex], ...finalRecord };
            
            (async () => {
              for (let i = savedIndex + 1; i < sameDateRecords.length; i++) {
                const nextRecord = sameDateRecords[i];
                const prevRecord = sameDateRecords[i - 1];
                
                const recalculatedDrbetAmount = calculateDRBet(nextRecord, prevRecord);
                const recalculatedPrivateAmount = calculatePrivateAmount(nextRecord);
                const recalculatedTotalCharge = calculateTotalCharge(nextRecord, recalculatedDrbetAmount);
                const recalculatedMargin = calculateMargin(nextRecord, recalculatedTotalCharge);
                
                const nextUpdatedRecord = {
                  ...nextRecord,
                  drbet_amount: recalculatedDrbetAmount,
                  private_amount: recalculatedPrivateAmount,
                  total_charge: recalculatedTotalCharge,
                  margin: recalculatedMargin
                };
                
                sameDateRecords[i] = nextUpdatedRecord;
                
                if (nextRecord.id) {
                  try {
                    const nextResponse = await axiosInstance.put(`/drbet/${nextRecord.id}`, nextUpdatedRecord);
                    const nextSaved = nextResponse.data || nextUpdatedRecord;
                    
                    setRecords((prev) => prev.map((r) => 
                      (r.id || 'new') === (nextRecord.id || 'new') ? nextSaved : r
                    ));
                    setAllRecords((prev) => prev.map((r) => 
                      (r.id || 'new') === (nextRecord.id || 'new') ? nextSaved : r
                    ));
                    setRefreshTick((t) => t + 1);
                  } catch (error) {
                    console.error(`다음 행 ${i + 1} 재계산 실패:`, error);
                  }
                }
              }
            })();
          }
          
          return currentAllRecords;
        });
      }, 50);
      
      // 편집 모드 종료
      setEditingNotesRecordId(null);
      setEditingNotesRecordMeta(null);
    } catch (error) {
      console.error('특이사항 저장 실패:', error);
      toast.error('특이사항 저장에 실패했습니다');
    } finally {
      savingNotesInlineRef.current = false;
    }
  };
  
  useEffect(() => {
    if (!editingNotesRecordId) return;
    const handleKeyDown = (e) => {
      // 저장 중이면 무시
      if (savingNotesInlineRef.current) {
        e.preventDefault();
        return;
      }
      
      if (e.key !== 'Enter' || e.shiftKey || e.altKey || e.ctrlKey || e.metaKey) {
        return;
      }
      
      // input, textarea, select 요소에 포커스가 있으면 무시 (해당 요소에서 처리)
      const activeElement = document.activeElement;
      if (activeElement && (
        activeElement.tagName === 'INPUT' || 
        activeElement.tagName === 'TEXTAREA' || 
        activeElement.tagName === 'SELECT' ||
        activeElement.isContentEditable
      )) {
        // textarea가 아닌 input이나 select에서만 저장 실행
        if (activeElement.tagName === 'INPUT' || activeElement.tagName === 'SELECT') {
          e.preventDefault();
          e.stopPropagation();
        } else {
          // textarea에서는 무시
          return;
        }
      }
      
      const meta = editingNotesRecordMeta;
      if (!meta) return;
      const targetRecord = records.find((r) => {
        if (meta.id && r.id === meta.id) return true;
        if (!meta.id && meta.tmpId && r.tmpId === meta.tmpId) return true;
        return false;
      });
      if (!targetRecord) return;
      
      e.preventDefault();
      e.stopPropagation();
      saveNotesInlineEdit(targetRecord);
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [editingNotesRecordId, editingNotesRecordMeta, records]);

  // 특이사항 모달 열기 (기존 호환성 유지)
  const openSiteNotesModal = (record) => {
    setSelectedRecord(record);
    
    // 현재 레코드의 사이트1~4에서 사이트 이름 추출 (전체 이름 사용)
    const extractedSites = [];

    log('=== record.site_name1~4 ===', {
      site_name1: record.site_name1,
      site_name2: record.site_name2,
      site_name3: record.site_name3,
      site_name4: record.site_name4
    });
    
    for (let i = 1; i <= 4; i++) {
      // 새로운 구조에서 site_name 필드 먼저 확인
      const siteName = record[`site_name${i}`];
      
      if (siteName && siteName.trim()) {
        // site_name 필드에서 전체 이름 사용
        const fullSiteName = siteName.trim();

        
        if (!extractedSites.find(s => s.name === fullSiteName)) {
          extractedSites.push({ id: i, name: fullSiteName });

        }
      }
    }
    
    // 사이트가 없어도 모달을 열 수 있도록 함 (바때기, 수동 입력 등은 사이트 없이도 가능)
    
    // 기존 특이사항에서 설정된 값 추출
    const existingInputs = {};
    const extraInputs = getInitialExtraNoteInputs();
    const notes = record.notes || '';
    
    log('🔍 [특이사항 모달] notes 파싱 시작:', notes);
    log('🔍 [특이사항 모달] record 전체:', record);
    
    // 전체 특이사항에서 각 사이트 정보 파싱
    const allParts = notes.split('/').filter(p => p.trim());
    
    log('🔍 [특이사항 모달] allParts:', allParts);
    




    
    allParts.forEach((part, index) => {
      part = part.trim();
      
      // 수동 입력 패턴을 가장 먼저 체크 (다른 패턴과 충돌 방지)
      const manualMatch = part.match(/^\[수동\](.+)$/);
      if (manualMatch) {
        log('✅ [특이사항 모달] 수동입력 매칭 성공:', part, '→', manualMatch[1]);
        // 여러 개의 수동입력이 있으면 마지막 것을 사용 (덮어쓰기)
        extraInputs.manualText = manualMatch[1].replace(/／/g, '/').trim();
        log('✅ [특이사항 모달] extraInputs.manualText 설정:', extraInputs.manualText);
        return; // 수동입력이면 다른 패턴 체크하지 않고 다음 파트로
      }
      
      // 바때기 패턴 체크
      const bategiMatch = part.match(/^바때기([\d.]+)(충|환)$/);
      if (bategiMatch) {
        const [, amount, type] = bategiMatch;
        extraInputs.bategiAmount = amount;
        extraInputs.bategiType = type;
        return; // 바때기면 다른 패턴 체크하지 않고 다음 파트로
      }
      
      // 파트에서 사이트이름+숫자+먹/못먹 패턴 찾기
      // 새 형식(사이트이름+종류+금액)과 기존 형식(종류+사이트이름+금액) 모두 지원
      let matchedSite = null;
      let chipPrefix = '';
      let chipAmount = '';
      let chipLoss = '';
      
      // 새 형식: 사이트이름+종류+금액+먹/못먹
      for (const site of extractedSites) {
        const fullName = site.name;
        const shortName = fullName.length >= 2 ? fullName.substring(0, 2) : fullName;
        
        // 전체 이름으로 매칭 시도
        const fullNamePattern = new RegExp(`^${fullName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(배거|칩팅|칩실수)(\\d+)(먹|못먹)`);
        const fullNameMatch = part.match(fullNamePattern);
        if (fullNameMatch) {
          matchedSite = site;
          chipPrefix = fullNameMatch[1];
          chipAmount = fullNameMatch[2];
          chipLoss = fullNameMatch[3];
          break;
        }
        
        // 앞 2글자로 매칭 시도
        const shortNamePattern = new RegExp(`^${shortName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(배거|칩팅|칩실수)(\\d+)(먹|못먹)`);
        const shortNameMatch = part.match(shortNamePattern);
        if (shortNameMatch) {
          matchedSite = site;
          chipPrefix = shortNameMatch[1];
          chipAmount = shortNameMatch[2];
          chipLoss = shortNameMatch[3];
          break;
        }
      }
      
      // 새 형식 매칭 실패 시 기존 형식 시도: 종류+사이트이름+금액+먹/못먹
      if (!matchedSite) {
        const chipPrefixMatch = part.match(/^(배거|칩팅|칩실수)/);
        if (chipPrefixMatch) {
          chipPrefix = chipPrefixMatch[1];
          const remaining = part.substring(chipPrefix.length);
          
          // 사이트 이름을 먼저 찾기 (전체 이름 우선, 그 다음 앞 2글자)
          for (const site of extractedSites) {
            const fullName = site.name;
            if (remaining.startsWith(fullName)) {
              const remainingAfterSite = remaining.substring(fullName.length);
              const amountMatch = remainingAfterSite.match(/^(\d+)(먹|못먹)/);
              if (amountMatch) {
                matchedSite = site;
                chipAmount = amountMatch[1];
                chipLoss = amountMatch[2];
                break;
              }
            }
          }
          
          if (!matchedSite) {
            for (const site of extractedSites) {
              const fullName = site.name;
              const shortName = fullName.length >= 2 ? fullName.substring(0, 2) : fullName;
              if (remaining.startsWith(shortName)) {
                const remainingAfterSite = remaining.substring(shortName.length);
                const amountMatch = remainingAfterSite.match(/^(\d+)(먹|못먹)/);
                if (amountMatch) {
                  matchedSite = site;
                  chipAmount = amountMatch[1];
                  chipLoss = amountMatch[2];
                  break;
                }
              }
            }
          }
        } else {
          // 접두사 없는 경우 (기존 로직)
          // 사이트 이름을 먼저 찾기 (전체 이름 우선, 그 다음 앞 2글자)
          for (const site of extractedSites) {
            const fullName = site.name;
            if (part.startsWith(fullName)) {
              const remainingAfterSite = part.substring(fullName.length);
              const amountMatch = remainingAfterSite.match(/^(\d+)(먹|못먹)/);
              if (amountMatch) {
                matchedSite = site;
                chipPrefix = '칩실수'; // 기본값
                chipAmount = amountMatch[1];
                chipLoss = amountMatch[2];
                break;
              }
            }
          }
          
          if (!matchedSite) {
            for (const site of extractedSites) {
              const fullName = site.name;
              const shortName = fullName.length >= 2 ? fullName.substring(0, 2) : fullName;
              if (part.startsWith(shortName)) {
                const remainingAfterSite = part.substring(shortName.length);
                const amountMatch = remainingAfterSite.match(/^(\d+)(먹|못먹)/);
                if (amountMatch) {
                  matchedSite = site;
                  chipPrefix = '칩실수'; // 기본값
                  chipAmount = amountMatch[1];
                  chipLoss = amountMatch[2];
                  break;
                }
              }
            }
          }
        }
      }
      
      if (matchedSite) {
        // 접두사를 chipType으로 변환
        let chipType = 'chip'; // 기본값
        if (chipPrefix === '배거') {
          chipType = 'bager';
        } else if (chipPrefix === '칩팅') {
          chipType = 'chipting';
        }
        
        existingInputs[matchedSite.id] = {
          ...existingInputs[matchedSite.id],
          chipAmount: chipAmount,
          chipType: chipType,
          chipLoss: chipLoss === '못먹' ? 'lost' : 'won'
        };
      }
      
      // 포인트 종류 포함 패턴 체크 (예: "샷벳출석10", "샷벳페이백20", "애국페이백0.5", "omg출석3", "850벳출석10")
      // 소수점 포함 숫자도 파싱할 수 있도록 정규식 수정
      // 사이트 이름은 2글자 이상일 수 있고 숫자 포함 가능하므로 +? 사용 (최소 매칭)
      const pointTypePatternMatch = part.match(/^([가-힣a-zA-Z0-9]+?)(출석|페이백|정착|요율|지추|첫충|매충|입플)([\d.]+)$/);
      if (pointTypePatternMatch) {
        const [, siteNameFromText, pointType, numbers] = pointTypePatternMatch;
        // 전체 이름 또는 앞 2글자로 매칭 (기존 데이터 호환성, 숫자 포함)
        const site = extractedSites.find(s => {
          const fullName = s.name;
          const shortName = fullName.length >= 2 ? fullName.substring(0, 2) : fullName;
          return fullName === siteNameFromText || shortName === siteNameFromText;
        });
        
        if (site) {
          // 기존 값이 있으면 병합
          existingInputs[site.id] = {
            ...existingInputs[site.id],
            point: numbers,
            pointType: pointType
          };
        }
      } else {
        // 사이트+숫자만 있는 경우 (포인트만, 포인트 종류 없음)
        // 소수점 포함 숫자도 파싱할 수 있도록 정규식 수정
        // 사이트 이름은 2글자 이상일 수 있고 숫자 포함 가능하므로 +? 사용 (최소 매칭)
        const simplePatternMatch = part.match(/^([가-힣a-zA-Z0-9]+?)([\d.]+)$/);
        if (simplePatternMatch) {
          const [, siteNameFromText, numbers] = simplePatternMatch;
          // 전체 이름 또는 앞 2글자로 매칭 (기존 데이터 호환성, 숫자 포함)
          const site = extractedSites.find(s => {
            const fullName = s.name;
            const shortName = fullName.length >= 2 ? fullName.substring(0, 2) : fullName;
            return fullName === siteNameFromText || shortName === siteNameFromText;
          });
          
          if (site) {
            // 기존 값이 있으면 병합
            existingInputs[site.id] = {
              ...existingInputs[site.id],
              point: numbers
            };
          }
        }
      }

    });
    
    log('🔍 [특이사항 모달] 최종 extraInputs:', extraInputs);
    log('🔍 [특이사항 모달] 최종 manualText 값:', extraInputs.manualText);
    
    setSites(extractedSites);
    setSiteInputs(existingInputs);
    setExtraNoteInputs(extraInputs);
    setShowSiteModal(true);
  };

  // 사이트 입력값 변경 핸들러
  const handleSiteInputChange = (siteId, field, value) => {
    setSiteInputs(prev => ({
      ...prev,
      [siteId]: {
        ...prev[siteId],
        [field]: value
      }
    }));
  };

  const resetSitePointInputs = (siteId) => {
    setSiteInputs(prev => ({
      ...prev,
      [siteId]: {
        ...(prev[siteId] || {}),
        point: '',
        pointType: ''
      }
    }));
  };

  const resetSiteChipInputs = (siteId) => {
    setSiteInputs(prev => ({
      ...prev,
      [siteId]: {
        ...(prev[siteId] || {}),
        chipAmount: '',
        chipType: '',
        chipLoss: ''
      }
    }));
  };

  const handleExtraNoteInputChange = (field, value) => {
    setExtraNoteInputs(prev => ({
      ...prev,
      [field]: value
    }));
  };

  const resetBategiInputs = () => {
    setExtraNoteInputs(prev => ({
      ...prev,
      bategiAmount: '',
      bategiType: ''
    }));
  };

  // 사이트 정보를 특이사항에 추가
  const addSiteInfoToNotes = async () => {
    log('🚀🚀🚀 [addSiteInfoToNotes] 함수 시작 - 2025 버전', { 
      selectedRecord: !!selectedRecord,
      extraNoteInputs
    });
    if (!selectedRecord) {
      logWarn('⚠️ [addSiteInfoToNotes] selectedRecord가 없음');
      return;
    }
    
    // selectedRecord에서 현재 레코드의 사이트 목록 다시 추출 (전체 이름 사용)
    const currentRecordSites = [];
    for (let i = 1; i <= 4; i++) {
      const siteName = selectedRecord[`site_name${i}`];
      if (siteName && siteName.trim()) {
        const fullSiteName = siteName.trim();
        if (!currentRecordSites.find(s => s.name === fullSiteName)) {
          currentRecordSites.push({ id: i, name: fullSiteName });
        }
      }
    }

    // 사이트가 없어도 바때기나 수동 입력은 가능하도록 함
    const siteEntries = [];
    let hasValidationError = false;
    const trimmedBategiAmount = (extraNoteInputs.bategiAmount ?? '').toString().trim();
    const hasBategiAmount = trimmedBategiAmount !== '';
    const manualTextRaw = extraNoteInputs.manualText ? extraNoteInputs.manualText.trim() : '';
    const hasManualText = manualTextRaw !== '';
    const extraEntries = [];
    
    // 사이트가 없고 사이트별 입력도 없고 바때기/수동 입력도 없으면 에러
    const hasSiteInputs = Object.keys(siteInputs).length > 0 && Object.values(siteInputs).some(input => {
      if (!input) return false;
      const hasPoint = input.point && input.point.trim() !== '';
      const hasChipAmount = input.chipAmount && input.chipAmount.trim() !== '';
      return hasPoint || hasChipAmount;
    });
    
    if (currentRecordSites.length === 0 && !hasSiteInputs && !hasBategiAmount && !hasManualText) {
      toast.error('입력할 내용이 없습니다.');
      return;
    }
    
    // 사이트가 없는데 사이트별 입력이 있으면 에러
    if (currentRecordSites.length === 0 && hasSiteInputs) {
      toast.error('사이트 정보가 없으면 사이트별 입력을 할 수 없습니다. 바때기나 수동 입력을 사용해주세요.');
      return;
    }

    if (hasBategiAmount) {
      if (!extraNoteInputs.bategiType) {
        toast.error('바때기 금액을 입력했으니 충/환을 선택해주세요.');
        hasValidationError = true;
      } else if (Number.isNaN(parseFloat(trimmedBategiAmount))) {
        toast.error('바때기 금액은 숫자로 입력해주세요.');
        hasValidationError = true;
      }
    }
    
    Object.entries(siteInputs).forEach(([siteId, data]) => {
      if (!data) return;
      
      const site = currentRecordSites.find(s => s.id === parseInt(siteId));
      if (!site) return;
      
      // 포인트 입력 검증
      const hasPoint = data.point && data.point.trim() !== '';
      const hasPointType = data.pointType && data.pointType.trim() !== '';
      
      // 포인트 금액은 입력했는데 포인트 종류를 선택하지 않은 경우
      if (hasPoint && !hasPointType) {
        toast.error(`${site.name}: 포인트 금액을 입력했으니 포인트 종류를 선택해주세요.`);
        hasValidationError = true;
        return;
      }
      
      // 칩실수 입력 검증: 금액은 입력했는데 종류나 먹/못먹을 선택하지 않은 경우
      const hasChipAmount = data.chipAmount && data.chipAmount.trim() !== '';
      const hasChipType = data.chipType && data.chipType.trim() !== '';
      const hasChipLoss = data.chipLoss && data.chipLoss.trim() !== '';
      
      if (hasChipAmount) {
        // 금액은 입력했는데 종류나 먹/못먹을 선택하지 않은 경우
        if (!hasChipType) {
          toast.error(`${site.name}: 칩실수 금액을 입력했으니 칩 종류를 선택해주세요.`);
          hasValidationError = true;
          return;
        }
        if (!hasChipLoss) {
          toast.error(`${site.name}: 칩실수 금액을 입력했으니 먹/못먹을 선택해주세요.`);
          hasValidationError = true;
          return;
        }
      }
      
      // 검증 통과 후 엔트리 생성
      let entry = '';
      
      // 포인트 정보 추가
      if (hasPoint) {
        const numericPoint = parseFloat(data.point);
        if (Number.isNaN(numericPoint)) {
          toast.error(`${site.name}: 포인트는 숫자로 입력해주세요.`);
          hasValidationError = true;
          return;
        }
        // 포인트 종류가 있으면 포함 (예: "샤벳출석10", "샤벳페이백20", "샤벳정착30", "샤벳요율5", "샤벳지추15", "샤벳첫충10", "샤벳매충10")
        const validPointTypes = ['출석', '페이백', '정착', '요율', '지추', '첫충', '매충', '입플'];
        if (data.pointType && validPointTypes.includes(data.pointType)) {
          entry = `${site.name}${data.pointType}${data.point}`;
        } else {
          entry = `${site.name}${data.point}`;
        }
      }
      
      // 칩실수 정보 추가
      if (hasChipAmount && hasChipType && hasChipLoss) {
        // 칩 종류에 따라 접두사 추가
        let chipPrefix = '';
        if (data.chipType === 'bager') {
          chipPrefix = '배거';
        } else if (data.chipType === 'chipting') {
          chipPrefix = '칩팅';
        } else {
          chipPrefix = '칩실수';
        }
        
        // 포인트처럼 사이트이름+종류+금액 순서로 표시
        const chipEntry = `${site.name}${chipPrefix}${data.chipAmount}${data.chipLoss === 'lost' ? '못먹' : '먹'}`;
        
        if (entry) {
          entry += `/${chipEntry}`;
        } else {
          entry = chipEntry;
        }
      }
      
      if (entry) {
        siteEntries.push(entry);
      }
    });
    
    // 검증 오류가 있으면 추가 안 함
    if (hasValidationError) {
      return;
    }

    if (hasBategiAmount && extraNoteInputs.bategiType) {
      extraEntries.push(`바때기${trimmedBategiAmount}${extraNoteInputs.bategiType}`);
    }

    // 수동입력 처리 - extraNoteInputs.manualText를 직접 확인
    const manualTextValue = extraNoteInputs.manualText || '';
    const trimmedManualText = manualTextValue.trim();
    log('🔍🔍🔍 [수동입력 체크] - 2025 버전', {
      manualTextValue,
      trimmedManualText,
      'extraNoteInputs.manualText': extraNoteInputs.manualText,
      'typeof': typeof extraNoteInputs.manualText
    });
    
    if (trimmedManualText) {
      const sanitizedManual = trimmedManualText
        .replace(/\//g, '／')
        .replace(/\r?\n/g, ' ')
        .trim();
      if (sanitizedManual) {
        const manualEntry = `[수동]${sanitizedManual}`;
        log('✅✅✅ [수동입력 추가] - 2025 버전', manualEntry);
        extraEntries.push(manualEntry);
      } else {
        logWarn('⚠️ [수동입력] sanitizedManual이 비어있음:', trimmedManualText);
      }
    } else {
      logWarn('⚠️⚠️⚠️ [수동입력] trimmedManualText가 비어있음 - 2025 버전', {
        manualTextValue,
        'extraNoteInputs': extraNoteInputs
      });
    }

    log('🔍 [addSiteInfoToNotes] 조건 체크:', {
      siteEntriesLength: siteEntries.length,
      extraEntriesLength: extraEntries.length,
      siteEntries,
      extraEntries
    });
    
    if (siteEntries.length > 0 || extraEntries.length > 0) {
      log('✅ [addSiteInfoToNotes] 저장 진행');
      const currentNotes = selectedRecord.notes || '';
      
      // 입력된 사이트 목록 추출 (수정할 사이트들)
      // 새 형식(사이트이름+종류+금액)과 기존 형식(종류+사이트이름+금액) 모두 지원
      const modifiedSiteNames = siteEntries.map(e => {
        // 새 형식: 사이트이름+칩종류+금액+먹/못먹 (예: "샷벳칩실수10먹", "인투88칩실수100못먹")
        const newChipMatch = e.match(/^([가-힣a-zA-Z0-9]+?)(칩실수|칩팅|배거)(\d+)(먹|못먹)/);
        if (newChipMatch) {
          return newChipMatch[1]; // 실제 사이트명 반환
        }
        // 기존 형식: 칩종류+사이트이름+금액+먹/못먹 (예: "배거샷벳10먹", "칩팅샷벳10못먹")
        const oldChipMatch = e.match(/^(칩실수|칩팅|배거)([가-힣a-zA-Z0-9]+?)(\d+)(먹|못먹)/);
        if (oldChipMatch) {
          return oldChipMatch[2]; // 실제 사이트명 반환
        }
        // 포인트 종류가 있는 경우 (예: "샷벳출석10", "omg출석3")
        const pointMatch = e.match(/^([가-힣a-zA-Z0-9]+?)(출석|페이백|정착|요율|지추)/);
        if (pointMatch) {
          return pointMatch[1]; // 실제 사이트명 반환
        }
        // 일반 사이트+숫자 패턴 (예: "샷벳10", "샷벳0.5", "omg3")
        const simpleMatch = e.match(/^([가-힣a-zA-Z0-9]+?)[\d.]/);
        if (simpleMatch) {
          return simpleMatch[1]; // 실제 사이트명 반환
        }
        return null;
      }).filter(Boolean);
      
      // 해당 사이트의 기존 모든 항목 제거
      const allParts = currentNotes.split('/').filter(p => p.trim());
      
      // 각 파트를 체크하여 수정할 사이트 관련 항목만 제거 (안녕하세요 같은 텍스트는 유지)
      const cleanedParts = allParts.map(part => {
        const trimmed = part.trim();
        
        // [수동]으로 시작하는 파트는 그대로 유지 (단어 단위로 분리하지 않음)
        if (trimmed.startsWith('[수동]')) {
          return trimmed;
        }
        
        // 바때기로 시작하는 파트도 그대로 유지
        if (trimmed.match(/^바때기[\d.]+(충|환)$/)) {
          return trimmed;
        }
        
        // 공백을 기준으로 단어 분리 (예: "칩실수루카20못먹 안녕하세요" -> ["칩실수루카20못먹", "안녕하세요"])
        const words = trimmed.split(/\s+/);
        
        // 사이트 관련 단어만 필터링 (사이트 패턴이면 제거, 아니면 유지)
        const filteredWords = words.filter(word => {
          // 새 형식: 사이트이름+칩종류+금액+먹/못먹 (예: "샷벳칩실수10먹", "인투88칩실수100못먹")
          const newChipMatch = word.match(/^([가-힣a-zA-Z0-9]+?)(칩실수|칩팅|배거)(\d+)(먹|못먹)/);
          if (newChipMatch) {
            const siteNameFromText = newChipMatch[1];
            // 전체 이름 또는 앞 2글자로 매칭 (기존 데이터 호환성)
            const shouldRemove = modifiedSiteNames.some(modifiedName => {
              const fullName = modifiedName;
              const shortName = fullName.length >= 2 ? fullName.substring(0, 2) : fullName;
              return fullName === siteNameFromText || shortName === siteNameFromText;
            });
            // 수정할 사이트인 경우 제거
            return !shouldRemove;
          }
          
          // 기존 형식: 칩종류+사이트명+금액+먹/못먹 (예: "배거omg10먹", "칩팅샷벳10못먹")
          const oldChipMatch = word.match(/^(칩실수|칩팅|배거)([가-힣a-zA-Z0-9]+?)(\d+)(먹|못먹)/);
          if (oldChipMatch) {
            const siteNameFromText = oldChipMatch[2];
            // 전체 이름 또는 앞 2글자로 매칭 (기존 데이터 호환성)
            const shouldRemove = modifiedSiteNames.some(modifiedName => {
              const fullName = modifiedName;
              const shortName = fullName.length >= 2 ? fullName.substring(0, 2) : fullName;
              return fullName === siteNameFromText || shortName === siteNameFromText;
            });
            // 수정할 사이트인 경우 제거
            return !shouldRemove;
          }
          
          // 포인트종류 포함 패턴 체크 (예: "샷벳출석10", "샷벳페이백20", "애국페이백0.5", "omg출석3")
        const pointTypeMatch = word.match(/^([가-힣a-zA-Z]+)(출석|페이백|정착|요율|지추|첫충|매충|입플)[\d.]/);
          if (pointTypeMatch) {
            const siteNameFromText = pointTypeMatch[1];
            // 전체 이름 또는 앞 2글자로 매칭 (기존 데이터 호환성)
            const shouldRemove = modifiedSiteNames.some(modifiedName => {
              const fullName = modifiedName;
              const shortName = fullName.length >= 2 ? fullName.substring(0, 2) : fullName;
              return fullName === siteNameFromText || shortName === siteNameFromText;
            });
            // 수정할 사이트인 경우 제거
            return !shouldRemove;
          }
          
          // 일반 사이트+숫자 패턴 체크 (소수점 포함) (예: "샷벳10", "omg3")
          const simpleMatch = word.match(/^([가-힣a-zA-Z]+)[\d.]/);
          if (simpleMatch) {
            const siteNameFromText = simpleMatch[1];
            // 전체 이름 또는 앞 2글자로 매칭 (기존 데이터 호환성)
            const shouldRemove = modifiedSiteNames.some(modifiedName => {
              const fullName = modifiedName;
              const shortName = fullName.length >= 2 ? fullName.substring(0, 2) : fullName;
              return fullName === siteNameFromText || shortName === siteNameFromText;
            });
            // 수정할 사이트인 경우 제거
            return !shouldRemove;
          }
          
          // 사이트 패턴이 아닌 단어는 유지 (예: "안녕하세요")
          return true;
        });
        
        return filteredWords.join(' ');
      }).filter(part => part.trim()); // 빈 파트 제거
      
      // 바때기와 수동입력 제거 로직
      const hasNewBategi = hasBategiAmount && extraNoteInputs.bategiType;
      const hasNewManualText = (extraNoteInputs.manualText || '').trim() !== '';
      
      const cleanedWithoutExtras = cleanedParts.filter(part => {
        const trimmedPart = part.trim();
        
        // 바때기를 새로 입력했으면 기존 바때기 모두 제거
        if (hasNewBategi && trimmedPart.match(/^바때기[\d.]+(충|환)$/)) {
          return false;
        }
        
        // 수동입력을 새로 입력했으면 기존 [수동] 파트 모두 제거 (새로운 것으로 대체)
        if (hasNewManualText && trimmedPart.startsWith('[수동]')) {
          return false;
        }
        
        return true;
      });
      
      let cleanedNotes = cleanedWithoutExtras.join('/');
      
      // 연속된 슬래시 정리
      cleanedNotes = cleanedNotes.replace(/\/+/g, '/');
      
      // 앞뒤 슬래시와 공백 제거
      cleanedNotes = cleanedNotes.replace(/^\/+|\/+$/g, '').trim();
      
      // 새로운 사이트 엔트리와 조합
      const combinedEntries = [...siteEntries];
      if (extraEntries.length > 0) {
        combinedEntries.push(...extraEntries);
      }
      const newSitesString = combinedEntries.join('/');
      
      log('💾 [특이사항 저장] 조합 전:', {
        siteEntries: siteEntries.length,
        extraEntries,
        combinedEntries: combinedEntries.length,
        newSitesString,
        cleanedNotes,
        hasManualText,
        manualTextRaw,
        'extraNoteInputs.manualText': extraNoteInputs.manualText
      });
      
      // 새로운 사이트 정보와 기존 정보 조합
      let updatedNotes = '';
      if (cleanedNotes && newSitesString) {
        // 모달에서 생성한 값이 앞에, 기존에 있던 값들이 뒤에
        updatedNotes = `${newSitesString}/${cleanedNotes}`;
      } else if (cleanedNotes) {
        updatedNotes = cleanedNotes;
      } else {
        updatedNotes = newSitesString;
      }
      
      // 앞뒤 슬래시와 공백 정리
      updatedNotes = updatedNotes.replace(/^\/+|\/+$/g, '').trim();
      
      log('💾💾💾 [특이사항 저장] 최종 updatedNotes - 2025 버전:', updatedNotes);
      log('💾💾💾 [특이사항 저장] [수동] 포함 여부 - 2025 버전:', updatedNotes.includes('[수동]'));
      log('💾💾💾 [특이사항 저장] extraEntries - 2025 버전:', extraEntries);
      log('💾💾💾 [특이사항 저장] newSitesString - 2025 버전:', newSitesString);
      log('💾💾💾 [특이사항 저장] cleanedNotes - 2025 버전:', cleanedNotes);
      
      // 특이사항 업데이트 - 직접 저장
      const record = selectedRecord;
      const updatedRecord = { ...record, notes: updatedNotes };
      
      log('💾💾💾 [특이사항 저장] DB에 저장할 값 - 2025 버전:', updatedRecord.notes);
      log('💾💾💾 [특이사항 저장] 수동입력 최종 확인 - 2025 버전:', {
        manualTextValue: extraNoteInputs.manualText,
        hasManualInNotes: updatedRecord.notes.includes('[수동]'),
        notes: updatedRecord.notes
      });
      
      // 자동 계산
      const currentIndex = records.findIndex(r => (r.id || 'new') === (record.id || 'new'));
      const previousRecord = currentIndex > 0 ? records[currentIndex - 1] : null;
      updatedRecord.drbet_amount = calculateDRBet(updatedRecord, previousRecord);
      updatedRecord.private_amount = calculatePrivateAmount(updatedRecord);
      updatedRecord.total_charge = calculateTotalCharge(updatedRecord, updatedRecord.drbet_amount);
      updatedRecord.margin = calculateMargin(updatedRecord, updatedRecord.total_charge);
      
      try {
        // 화면 즉시 반영
        setRecords((prev) => prev.map((r) => {
          const match = (r.id || 'new') === (record.id || 'new') && (r.tmpId ? r.tmpId === record.tmpId : true);
          return match ? { ...r, ...updatedRecord, _v: (r._v || 0) + 1 } : r;
        }));
        setAllRecords((prev) => prev.map((r) => {
          const match = (r.id || 'new') === (record.id || 'new') && (r.tmpId ? r.tmpId === record.tmpId : true);
          return match ? { ...r, ...updatedRecord, _v: (r._v || 0) + 1 } : r;
        }));
        setRefreshTick((t) => t + 1);
        
        if (record.isNew || !record.id) {
          const response = await axiosInstance.post('/drbet', updatedRecord);
          const saved = response.data;
          
          // 저장 후 출석일을 별도로 조회하여 확실하게 반영
          const savedWithDays = { ...saved };
          for (let i = 1; i <= 4; i++) {
            const identityName = saved[`identity${i}`];
            const siteName = saved[`site_name${i}`];
            if (!identityName || !siteName) continue;
            try {
              const stats = await getAttendanceStats(siteName, identityName);
              const days = stats?.consecutiveDays || 0;
              savedWithDays[`_attendanceDays_${i}`] = days;
              const attendanceCacheKey = getAttendanceCacheKey(siteName, identityName);
              attendanceStatsCacheRef.current[attendanceCacheKey] = {
                consecutiveDays: days,
                timestamp: Date.now()
              };
            } catch (err) {
              console.error('출석일 조회 실패:', err);
            }
          }
          
          flushSync(() => {
            setRecords((prev) => prev.map((r) => (r.tmpId && r.tmpId === record.tmpId ? { ...savedWithDays, tmpId: undefined, isNew: false } : r)));
            setAllRecords((prev) => prev.map((r) => (r.tmpId && r.tmpId === record.tmpId ? { ...savedWithDays, tmpId: undefined, isNew: false } : r)));
            setRefreshTick((t) => t + 1);
          });
          
          // 확실하게 최신 출석일 반영을 위해 레코드 다시 로드
          await loadRecords(true);
        } else {
          const response = await axiosInstance.put(`/drbet/${record.id}`, updatedRecord);
          const saved = response.data || updatedRecord;
          
          // 저장 후 출석일을 별도로 조회하여 확실하게 반영
          const savedWithDays = { ...saved };
          for (let i = 1; i <= 4; i++) {
            const identityName = saved[`identity${i}`];
            const siteName = saved[`site_name${i}`];
            if (!identityName || !siteName) continue;
            try {
              const stats = await getAttendanceStats(siteName, identityName);
              const days = stats?.consecutiveDays || 0;
              savedWithDays[`_attendanceDays_${i}`] = days;
              const attendanceCacheKey = getAttendanceCacheKey(siteName, identityName);
              attendanceStatsCacheRef.current[attendanceCacheKey] = {
                consecutiveDays: days,
                timestamp: Date.now()
              };
            } catch (err) {
              console.error('출석일 조회 실패:', err);
            }
          }
          
          flushSync(() => {
            setRecords((prev) => prev.map((r) => {
              const match = (r.id || 'new') === (record.id || 'new');
              return match ? { ...r, ...savedWithDays, _v: (r._v || 0) + 1 } : r;
            }));
            setAllRecords((prev) => prev.map((r) => {
              const match = (r.id || 'new') === (record.id || 'new');
              return match ? { ...r, ...savedWithDays, _v: (r._v || 0) + 1 } : r;
            }));
            setRefreshTick((t) => t + 1);
          });
          
          // 확실하게 최신 출석일 반영을 위해 레코드 다시 로드
          await loadRecords(true);
        }
        
        toast.success('특이사항이 저장되었습니다');
      } catch (error) {
        console.error('특이사항 저장 실패:', error);
        toast.error('특이사항 저장에 실패했습니다');
      }
      
      // 모달 닫고 입력값 초기화
      closeSiteModal();
    } else {
      // 포인트와 칩실수가 모두 비어있으면 해당 사이트 정보만 제거
      const currentNotes = selectedRecord.notes || '';
      
      // 모달로 생성한 모든 문자열 제거 (사이트명+숫자로 시작하는 패턴, 소수점 포함)
      let cleanedNotes = currentNotes.split('/').filter(part => {
        const trimmed = part.trim();
        if (trimmed.match(/^바때기[\d.]+(충|환)$/)) {
          return false;
        }
        if (trimmed.startsWith('[수동]')) {
          return false;
        }
        return !trimmed.match(/^[가-힣]{2}[\d.]/);
      }).join('/');
      
      // 연속된 슬래시 정리
      cleanedNotes = cleanedNotes.replace(/\/+/g, '/').replace(/^\/|\/$/g, '').trim();
      
      // 특이사항 업데이트
      handleCellDoubleClick(selectedRecord.id || 'new', 'notes', cleanedNotes);
      
      // 모달 닫고 입력값 초기화
      closeSiteModal();
    }
  };

  // 셀 편집 저장
  const handleCellBlur = async (record) => {
    if (!editingCell) return;

    // 중복 저장 방지
    const recordKey = record.id || record.tmpId || 'new';
    if (savingRecordRef.current[recordKey]) {
      log('⏭️ 중복 저장 요청 무시:', recordKey);
      return;
    }
    savingRecordRef.current[recordKey] = true;

    const { field } = editingCell;
    let updatedRecord = { ...record };
    
    // 토탈금액 필드인 경우: 입력값(원 단위)에 환전 합계(만원 단위)를 더해서 최종 토탈금액으로 저장
    if (field === 'total_amount') {
      const raw = (editingValue || '').toString().replace(/,/g, '').trim();
      const inputValue = raw === '' ? 0 : (parseInt(raw, 10) || 0);
      const withdrawTotalMan = getWithdrawTotalInManwon(record);
      const withdrawTotalWon = withdrawTotalMan * 10000;
      updatedRecord.total_amount = inputValue + withdrawTotalWon;
    }
    // 유저 필드인 경우 유효성 검증 및 출석일 감소 처리
    else if (field.startsWith('identity')) {
      const index = field.replace('identity', '');
      const siteField = `site_name${index}`;
      const chargeWithdrawField = `charge_withdraw${index}`;
      const oldIdentityName = record[field] || '';
      const oldSiteName = record[siteField] || '';
      const oldChargeWithdraw = record[chargeWithdrawField] || '';
      
      const identitiesList = editingValue ? identities.filter(id => id.name.toLowerCase().includes(editingValue.toLowerCase())) : [];
      if (editingValue && !identities.find(id => id.name === editingValue)) {
        toast.error(`등록되지 않은 유저입니다: ${editingValue}`);
        setEditingCell(null);
        setEditingValue('');
        return;
      }
      
      // 유저가 변경되거나 삭제될 때 이전 값에 충전금액이 있었으면 출석일 감소
      if (oldIdentityName && oldSiteName && oldChargeWithdraw) {
        const parseCharge = (str) => {
          if (!str || str.trim() === '') return 0;
          const parts = str.split(' ');
          return parseFloat(parts[0]) || 0;
        };
        const oldCharge = parseCharge(oldChargeWithdraw);
        if (oldCharge > 0 && (!editingValue || editingValue !== oldIdentityName)) {
          // 유저가 삭제되거나 변경된 경우 출석일 감소 (재충전 체크를 위해 record와 siteIndex 전달)
          const siteIndex = parseInt(index);
          await handleAutoAttendance(oldSiteName, oldIdentityName, oldChargeWithdraw, '', record, siteIndex);
        }
      }
      
      updatedRecord[field] = editingValue;
      // 유저가 삭제되면 사이트도 함께 삭제
      if (!editingValue || editingValue.trim() === '') {
        updatedRecord[siteField] = '';
      } else {
        // 유저가 변경된 경우, 새로운 유저의 출석일 증가 처리
        const newIdentityName = editingValue;
        const newSiteName = updatedRecord[siteField] || oldSiteName;
        const newChargeWithdraw = updatedRecord[chargeWithdrawField] || oldChargeWithdraw;
        
        if (newIdentityName && newSiteName && newChargeWithdraw && newIdentityName !== oldIdentityName) {
          const parseCharge = (str) => {
            if (!str || str.trim() === '') return 0;
            const parts = str.split(' ');
            return parseFloat(parts[0]) || 0;
          };
          const newCharge = parseCharge(newChargeWithdraw);
          if (newCharge > 0) {
            // 새로운 유저의 출석일 증가 처리 (재충전 체크를 위해 record와 siteIndex 전달)
            const siteIndex = parseInt(index);
            await handleAutoAttendance(newSiteName, newIdentityName, '', newChargeWithdraw, record, siteIndex);
          }
        }
      }
    }
    // 사이트 필드인 경우 유효성 검증 및 출석일 감소 처리
    else if (field.startsWith('site_name')) {
      // site_name1 -> identity1, site_name2 -> identity2 등으로 매핑
      const index = field.replace('site_name', '');
      const identityField = `identity${index}`;
      const chargeWithdrawField = `charge_withdraw${index}`;
      const oldSiteName = record[field] || '';
      const oldIdentityName = record[identityField] || '';
      const oldChargeWithdraw = record[chargeWithdrawField] || '';
      
      const currentIdentity = identities.find(id => id.name === record[identityField]);
      if (currentIdentity) {
        const availableSites = identitySitesMap[currentIdentity.id] || [];
        if (editingValue && editingValue.trim()) {
          const trimmedValue = editingValue.trim();
          const isValidSite = availableSites.find(s => s.site_name === trimmedValue);
          if (!isValidSite) {
            log('사이트 검증 실패 (handleCellBlur):', {
              입력값: trimmedValue,
              입력값_길이: trimmedValue.length,
              입력값_문자코드: Array.from(trimmedValue).map(c => c.charCodeAt(0)),
              사용가능한_사이트목록: availableSites.map(s => s.site_name)
            });
            toast.error(`등록되지 않은 사이트입니다: "${trimmedValue}". 사이트 관리에서 먼저 등록해주세요.`);
            setEditingCell(null);
            setEditingValue('');
            return;
          }
        }
      }
      
      // 사이트가 변경되거나 삭제될 때 이전 값에 충전금액이 있었으면 출석일 감소
      if (oldSiteName && oldIdentityName && oldChargeWithdraw) {
        const parseCharge = (str) => {
          if (!str || str.trim() === '') return 0;
          const parts = str.split(' ');
          return parseFloat(parts[0]) || 0;
        };
        const oldCharge = parseCharge(oldChargeWithdraw);
        if (oldCharge > 0 && (!editingValue || editingValue !== oldSiteName)) {
          // 사이트가 삭제되거나 변경된 경우 출석일 감소 (재충전 체크를 위해 record와 siteIndex 전달)
          const siteIndex = parseInt(index);
          await handleAutoAttendance(oldSiteName, oldIdentityName, oldChargeWithdraw, '', record, siteIndex);
        }
      }
      
      updatedRecord[field] = editingValue;
      
      // 사이트가 변경된 경우, 새로운 사이트의 출석일 증가 처리
      if (editingValue && editingValue.trim() && editingValue !== oldSiteName) {
        const newSiteName = editingValue;
        const newIdentityName = updatedRecord[identityField] || oldIdentityName;
        const newChargeWithdraw = updatedRecord[chargeWithdrawField] || oldChargeWithdraw;
        
        if (newSiteName && newIdentityName && newChargeWithdraw) {
          const parseCharge = (str) => {
            if (!str || str.trim() === '') return 0;
            const parts = str.split(' ');
            return parseFloat(parts[0]) || 0;
          };
          const newCharge = parseCharge(newChargeWithdraw);
          if (newCharge > 0) {
            // 새로운 사이트의 출석일 증가 처리 (재충전 체크를 위해 record와 siteIndex 전달)
            const siteIndex = parseInt(index);
            await handleAutoAttendance(newSiteName, newIdentityName, '', newChargeWithdraw, record, siteIndex);
          }
        }
      }
    }
    // 충환전 필드인 경우 처리
    else if (field.startsWith('charge_withdraw')) {
      const index = field.replace('charge_withdraw', '');
      const identityField = `identity${index}`;
      const siteField = `site_name${index}`;
      const oldChargeWithdraw = record[field] || '';
      const identityName = record[identityField] || '';
      const siteName = record[siteField] || '';
      
      // 충환전 필드 변경 시 출석일 처리 (서버 저장 전에 미리 처리)
      // 주의: 서버 저장 후에도 출석일을 다시 조회하므로 여기서는 출석일 감소/증가만 처리
      if (identityName && siteName) {
        await handleAutoAttendance(siteName, identityName, oldChargeWithdraw, editingValue || '', record, parseInt(index));
      }
      
      updatedRecord[field] = editingValue;
    } else if (field === 'notes') {
      // 특이사항의 경우 그냥 사용자가 입력한 값을 그대로 저장
      updatedRecord[field] = editingValue;
    } else if (field === 'drbet_amount' || field === 'total_amount' || field === 'rate_amount') {
      // 숫자 필드는 숫자로 변환하여 저장
      if (field !== 'total_amount') {
        const numValue = editingValue === '' || editingValue === null || editingValue === undefined 
          ? 0 
          : parseFloat(editingValue) || 0;
        updatedRecord[field] = numValue;
      }
    } else {
      updatedRecord[field] = editingValue;
    }

    // 자동 계산
    // drbet_amount에 영향을 주는 필드들: notes, total_amount, rate_amount, charge_withdraw1~4, site1~4, drbet_amount
    const currentIndex = records.findIndex(r => (r.id || 'new') === (record.id || 'new'));
    const previousRecord = currentIndex > 0 ? records[currentIndex - 1] : null;
    
    // 현재 행의 drbet_amount 재계산이 필요한 경우
    // 이전 행의 값(total_amount, rate_amount, charge_withdraw, site, notes)이 변경되면 다음 행의 drbet_amount도 재계산 필요
    const needsRecalculation = 
      field === 'notes' || 
      field === 'drbet_amount' || 
      field === 'total_amount' || 
      field === 'rate_amount' ||
      field.startsWith('charge_withdraw') ||
      field.startsWith('site');
    
    if (needsRecalculation) {
      // 현재 행의 drbet_amount 재계산
      // 첫 번째 행이고 특이사항이 변경된 경우, drbet_amount를 원래 입력값으로 복원 후 재계산
      if (!previousRecord && field === 'notes') {
        // 특이사항 변경 시 drbet_amount를 원래 입력값(특이사항 충전/환전을 제외한 값)으로 복원
        const currentNotesData = parseNotes(editingValue || '');
        const previousNotesData = parseNotes(record.notes || '');
        // 이전 특이사항 충전/환전 금액을 drbet_amount에서 차감하여 원래 입력값 복원
        const baseDrbetAmount = (record.drbet_amount || 0) - previousNotesData.charge + previousNotesData.withdraw;
        // 복원된 원래 입력값을 사용하여 재계산
        updatedRecord.drbet_amount = baseDrbetAmount;
      }
      updatedRecord.drbet_amount = calculateDRBet(updatedRecord, previousRecord);
    }
    
    updatedRecord.private_amount = calculatePrivateAmount(updatedRecord);
    updatedRecord.total_charge = calculateTotalCharge(updatedRecord, updatedRecord.drbet_amount);
    updatedRecord.margin = calculateMargin(updatedRecord, updatedRecord.total_charge);

    try {
      // 1) 화면 즉시 반영 (낙관적 업데이트)
      setRecords((prev) => prev.map((r) => {
        const match = (r.id || 'new') === (record.id || 'new') && (r.tmpId ? r.tmpId === record.tmpId : true);
        return match ? { ...r, ...updatedRecord, _v: (r._v || 0) + 1 } : r;
      }));
      // allRecords에도 동일 반영 (필터/정렬 효과로 덮어쓰는 상황 방지)
      setAllRecords((prev) => prev.map((r) => {
        const match = (r.id || 'new') === (record.id || 'new') && (r.tmpId ? r.tmpId === record.tmpId : true);
        return match ? { ...r, ...updatedRecord, _v: (r._v || 0) + 1 } : r;
      }));
      setRefreshTick((t) => t + 1);

      if (record.isNew || !record.id) {
        // 새 기록 생성 (tmpId 유지해 매칭)
        const response = await axiosInstance.post('/drbet', updatedRecord);
        toast.success('DR벳 기록이 추가되었습니다');
        const saved = response.data;
        
        // 성능 최적화: 배치 API로 출석일 한 번에 조회
        const savedWithDays = { ...saved };
        
        // 새 레코드 생성 시에는 항상 출석일 조회 (조건 없이)
        // 기존 레코드 수정 시에는 충전금액/유저/사이트 필드 변경 시에만 조회
        
        // 조회할 사이트/유저 목록 수집
        const sitesToLoad = [];
        for (let i = 1; i <= 4; i++) {
          const identityName = saved[`identity${i}`];
          const siteName = saved[`site_name${i}`];
          if (identityName && siteName) {
            sitesToLoad.push({ siteName, identityName, index: i });
          }
        }
        
        // 배치 API로 한 번에 조회 (N+1 문제 해결)
        // 새 레코드 생성 시에는 항상 출석일 조회하여 즉시 반영
        const daysUpdates = {}; // state 업데이트를 모아서 한 번에 처리 (스코프 확장)
        
        // 서버 응답에 출석일 정보가 포함되어 있으면 우선 사용
        if (saved._attendanceDays && typeof saved._attendanceDays === 'object') {
          Object.entries(saved._attendanceDays).forEach(([key, days]) => {
            const [identityName, siteName] = key.split('||');
            if (identityName && siteName && days !== undefined) {
              // 사이트 인덱스 찾기
              for (let i = 1; i <= 4; i++) {
                const savedIdentity = saved[`identity${i}`];
                const savedSite = saved[`site_name${i}`];
                if (normalizeName(savedIdentity) === normalizeName(identityName) && 
                    normalizeName(savedSite) === normalizeName(siteName)) {
                  savedWithDays[`_attendanceDays_${i}`] = days || 0;
                  if (!savedWithDays._attendanceDays) {
                    savedWithDays._attendanceDays = {};
                  }
                  savedWithDays._attendanceDays[key] = days || 0;
                  
                  const attendanceCacheKey = getAttendanceCacheKey(siteName, identityName);
                  attendanceStatsCacheRef.current[attendanceCacheKey] = {
                    consecutiveDays: days || 0,
                    timestamp: Date.now()
                  };
                  daysUpdates[attendanceCacheKey] = days || 0;
                  break;
                }
              }
            }
          });
        }
        
        // 서버 응답에 출석일이 없거나 불완전한 경우 API로 조회 (재시도 로직 포함)
        // 모든 사이트에 대한 출석일이 서버 응답에 포함되어 있는지 확인
        const allSitesHaveDays = sitesToLoad.every(({ siteName, identityName }) => {
          const normalizedIdentity = normalizeName(identityName);
          const normalizedSite = normalizeName(siteName);
          const mapKey = `${normalizedIdentity}||${normalizedSite}`;
          return saved._attendanceDays && saved._attendanceDays[mapKey] !== undefined;
        });
        
        // 새 레코드 생성 시에는 항상 출석일 조회 (서버 응답에 모든 사이트의 출석일이 없으면)
        if (sitesToLoad.length > 0 && !allSitesHaveDays) {
          // 서버에서 출석일 업데이트가 완료될 때까지 대기 (재시도 로직)
          const fetchAttendanceWithRetry = async (retries = 8, initialDelay = 300) => {
            for (let i = 0; i < retries; i++) {
              try {
                // 첫 번째 시도는 약간의 지연 후, 이후는 더 긴 지연 후 재시도
                // 지연 시간: 300ms, 600ms, 900ms, 1200ms, 1500ms, 1800ms, 2100ms, 2400ms
                await new Promise(resolve => setTimeout(resolve, initialDelay * (i + 1)));
                
                const attendanceResponse = await axiosInstance.post('/attendance/stats/batch', {
                  sites: sitesToLoad.map(({ siteName, identityName }) => ({ siteName, identityName }))
                });
                
                if (attendanceResponse.data?.success && Array.isArray(attendanceResponse.data.results)) {
                  return attendanceResponse.data.results;
                }
              } catch (err) {
                if (i === retries - 1) {
                  console.error('배치 출석일 조회 실패 (최종 시도):', err);
                  throw err;
                }
              }
            }
            return [];
          };
          
          try {
            const results = await fetchAttendanceWithRetry();
            
            results.forEach((result, idx) => {
              const { siteName, identityName, consecutiveDays, error } = result;
              const { index } = sitesToLoad[idx];
              
              if (!error && consecutiveDays !== undefined) {
                // 레코드에 직접 출석일 저장 (UI 즉시 반영)
                savedWithDays[`_attendanceDays_${index}`] = consecutiveDays || 0;
                
                // 레코드 맵에도 저장 (우선순위 2번 경로)
                if (!savedWithDays._attendanceDays) {
                  savedWithDays._attendanceDays = {};
                }
                const normalizedIdentity = normalizeName(identityName);
                const normalizedSite = normalizeName(siteName);
                const mapKey = `${normalizedIdentity}||${normalizedSite}`;
                savedWithDays._attendanceDays[mapKey] = consecutiveDays || 0;
                
                // ref 캐시에도 저장 (이전 값 덮어쓰기)
                const attendanceCacheKey = getAttendanceCacheKey(siteName, identityName);
                attendanceStatsCacheRef.current[attendanceCacheKey] = {
                  consecutiveDays: consecutiveDays || 0,
                  timestamp: Date.now()
                };
                
                // state 업데이트를 모아서 처리
                daysUpdates[attendanceCacheKey] = consecutiveDays || 0;
                
              }
            });
          } catch (err) {
            console.error('배치 출석일 조회 실패:', err);
          }
        }
        
        // 모든 state 업데이트를 flushSync로 동기적으로 처리하여 즉시 렌더링
        // 출석일 조회 완료 후 레코드 업데이트 (출석일이 포함된 savedWithDays 사용)
        flushSync(() => {
          // tmp 레코드를 서버 레코드로 교체 (출석일 포함)
          // 출석일 필드들을 명시적으로 포함하여 업데이트
          setRecords((prev) => prev.map((r) => {
            if (r.tmpId && r.tmpId === record.tmpId) {
              const updated = { ...savedWithDays, tmpId: undefined, isNew: false };
              // 출석일 필드들이 제대로 포함되었는지 확인
              for (let i = 1; i <= 4; i++) {
                if (savedWithDays[`_attendanceDays_${i}`] !== undefined) {
                  updated[`_attendanceDays_${i}`] = savedWithDays[`_attendanceDays_${i}`];
                }
              }
              if (savedWithDays._attendanceDays) {
                // 기존 _attendanceDays 맵을 완전히 교체 (이전 값이 남아있지 않도록)
                updated._attendanceDays = { ...savedWithDays._attendanceDays };
              }
              return updated;
            }
            return r;
          }));
          setAllRecords((prev) => prev.map((r) => {
            if (r.tmpId && r.tmpId === record.tmpId) {
              const updated = { ...savedWithDays, tmpId: undefined, isNew: false };
              // 출석일 필드들이 제대로 포함되었는지 확인
              for (let i = 1; i <= 4; i++) {
                if (savedWithDays[`_attendanceDays_${i}`] !== undefined) {
                  updated[`_attendanceDays_${i}`] = savedWithDays[`_attendanceDays_${i}`];
                }
              }
              if (savedWithDays._attendanceDays) {
                // 기존 _attendanceDays 맵을 완전히 교체 (이전 값이 남아있지 않도록)
                updated._attendanceDays = { ...savedWithDays._attendanceDays };
              }
              return updated;
            }
            return r;
          }));
          
          // 출석일 state도 함께 업데이트 (다른 곳에서 참조할 수 있음)
          if (Object.keys(daysUpdates).length > 0) {
            setSiteAttendanceDays(prev => ({
              ...prev,
              ...daysUpdates
            }));
          }
          
          // 리렌더링 트리거
          setRefreshTick((t) => t + 1);
        });
        
        // 성능 최적화: 전체 목록 재로드 제거 (로컬 상태만 업데이트)
      } else {
        // 기존 기록 수정 → 서버 응답 받아서 상태 업데이트
        const response = await axiosInstance.put(`/drbet/${record.id}`, updatedRecord);
        const saved = response.data || updatedRecord; // 서버 응답이 있으면 사용, 없으면 업데이트된 레코드 사용
        
        toast.success('DR벳 기록이 수정되었습니다');
        
        // 성능 최적화: 배치 API로 출석일 한 번에 조회
        const savedWithDays = { ...saved };
        // 출석일 필드와 맵 초기화 (이전 값이 남아있지 않도록)
        savedWithDays._attendanceDays = savedWithDays._attendanceDays || {};
        for (let i = 1; i <= 4; i++) {
          if (savedWithDays[`_attendanceDays_${i}`] === undefined) {
            savedWithDays[`_attendanceDays_${i}`] = undefined; // 명시적으로 undefined로 설정
          }
        }
        
        // 기존 레코드 수정 시에는 충전금액/유저/사이트 필드 변경 시에만 조회
        const needsAttendanceRefresh = field.startsWith('charge_withdraw') || 
                                       field.startsWith('identity') || 
                                       field.startsWith('site_name');
        
        // 조회할 사이트/유저 목록 수집
        const sitesToLoad = [];
        for (let i = 1; i <= 4; i++) {
          const identityName = saved[`identity${i}`];
          const siteName = saved[`site_name${i}`];
          if (identityName && siteName) {
            sitesToLoad.push({ siteName, identityName, index: i });
          }
        }
        
        // 배치 API로 한 번에 조회 (N+1 문제 해결)
        // 기존 레코드 수정 시에는 충전금액/유저/사이트 필드 변경 시에만 조회
        const daysUpdates = {}; // state 업데이트를 모아서 한 번에 처리 (스코프 확장)
        
        // 서버 응답에 출석일 정보가 포함되어 있으면 우선 사용
        if (saved._attendanceDays && typeof saved._attendanceDays === 'object') {
          Object.entries(saved._attendanceDays).forEach(([key, days]) => {
            const [identityName, siteName] = key.split('||');
            
            if (identityName && siteName && days !== undefined && days !== null) {
              // 사이트 인덱스 찾기
              for (let i = 1; i <= 4; i++) {
                const savedIdentity = saved[`identity${i}`];
                const savedSite = saved[`site_name${i}`];
                const normalizedSavedIdentity = normalizeName(savedIdentity || '');
                const normalizedSavedSite = normalizeName(savedSite || '');
                const normalizedKeyIdentity = normalizeName(identityName);
                const normalizedKeySite = normalizeName(siteName);
                
                if (normalizedSavedIdentity === normalizedKeyIdentity && 
                    normalizedSavedSite === normalizedKeySite) {
                  // 레코드 필드에 직접 저장
                  savedWithDays[`_attendanceDays_${i}`] = days || 0;
                  
                  // 레코드 맵에도 저장
                  if (!savedWithDays._attendanceDays) {
                    savedWithDays._attendanceDays = {};
                  }
                  savedWithDays._attendanceDays[key] = days || 0;
                  
                  // ref 캐시에도 저장 (이전 값 덮어쓰기)
                  const attendanceCacheKey = getAttendanceCacheKey(siteName, identityName);
                  attendanceStatsCacheRef.current[attendanceCacheKey] = {
                    consecutiveDays: days || 0,
                    timestamp: Date.now()
                  };
                  
                  // state 업데이트를 모아서 처리
                  daysUpdates[attendanceCacheKey] = days || 0;
                  break;
                }
              }
            }
          });
        }
        
        // 서버 응답에 출석일이 없거나 불완전한 경우 API로 조회 (재시도 로직 포함)
        // 모든 사이트에 대한 출석일이 서버 응답에 포함되어 있는지 확인
        const allSitesHaveDays = sitesToLoad.every(({ siteName, identityName }) => {
          const normalizedIdentity = normalizeName(identityName);
          const normalizedSite = normalizeName(siteName);
          const mapKey = `${normalizedIdentity}||${normalizedSite}`;
          return saved._attendanceDays && saved._attendanceDays[mapKey] !== undefined;
        });
        
        if (sitesToLoad.length > 0 && needsAttendanceRefresh && !allSitesHaveDays) {
          // 서버에서 출석일 업데이트가 완료될 때까지 대기 (재시도 로직)
          const fetchAttendanceWithRetry = async (retries = 8, initialDelay = 300) => {
            for (let i = 0; i < retries; i++) {
              try {
                // 첫 번째 시도는 약간의 지연 후, 이후는 더 긴 지연 후 재시도
                // 지연 시간: 300ms, 600ms, 900ms, 1200ms, 1500ms, 1800ms, 2100ms, 2400ms
                await new Promise(resolve => setTimeout(resolve, initialDelay * (i + 1)));
                
                const attendanceResponse = await axiosInstance.post('/attendance/stats/batch', {
                  sites: sitesToLoad.map(({ siteName, identityName }) => ({ siteName, identityName }))
                });
                
                if (attendanceResponse.data?.success && Array.isArray(attendanceResponse.data.results)) {
                  return attendanceResponse.data.results;
                }
              } catch (err) {
                if (i === retries - 1) {
                  console.error('배치 출석일 조회 실패 (최종 시도):', err);
                  throw err;
                }
              }
            }
            return [];
          };
          
          try {
            const results = await fetchAttendanceWithRetry();
            
            results.forEach((result, idx) => {
              const { siteName, identityName, consecutiveDays, error } = result;
              const { index } = sitesToLoad[idx];
              
              if (!error && consecutiveDays !== undefined) {
                // 레코드에 직접 출석일 저장 (UI 즉시 반영)
                savedWithDays[`_attendanceDays_${index}`] = consecutiveDays || 0;
                
                // 레코드 맵에도 저장 (우선순위 2번 경로)
                if (!savedWithDays._attendanceDays) {
                  savedWithDays._attendanceDays = {};
                }
                const normalizedIdentity = normalizeName(identityName);
                const normalizedSite = normalizeName(siteName);
                const mapKey = `${normalizedIdentity}||${normalizedSite}`;
                savedWithDays._attendanceDays[mapKey] = consecutiveDays || 0;
                
                // ref 캐시에도 저장 (이전 값 덮어쓰기)
                const attendanceCacheKey = getAttendanceCacheKey(siteName, identityName);
                attendanceStatsCacheRef.current[attendanceCacheKey] = {
                  consecutiveDays: consecutiveDays || 0,
                  timestamp: Date.now()
                };
                
                // state 업데이트를 모아서 처리
                daysUpdates[attendanceCacheKey] = consecutiveDays || 0;
                
              }
            });
          } catch (err) {
            console.error('배치 출석일 조회 실패:', err);
          }
        }
        
        // 모든 state 업데이트를 flushSync로 동기적으로 처리하여 즉시 렌더링
        // 출석일 조회 완료 후 레코드 업데이트 (출석일이 포함된 savedWithDays 사용)
        flushSync(() => {
          // 서버 응답으로 레코드 상태 업데이트 (출석일 포함)
          // 출석일이 증가한 값이 화면에 즉시 반영되도록 savedWithDays의 모든 필드를 포함
          setRecords((prev) => prev.map((r) => {
            const match = (r.id || 'new') === (record.id || 'new');
            if (match) {
              // 출석일 필드들을 명시적으로 포함하여 업데이트
              // savedWithDays의 모든 필드를 먼저 복사한 후, 출석일 필드를 명시적으로 덮어쓰기
              const updated = { ...r, ...savedWithDays, _v: (r._v || 0) + 1 };
              
              // 출석일 필드들이 제대로 포함되었는지 확인 및 강제 설정
              for (let i = 1; i <= 4; i++) {
                // savedWithDays에 출석일이 있으면 무조건 설정 (undefined가 아닌 경우)
                if (savedWithDays[`_attendanceDays_${i}`] !== undefined && savedWithDays[`_attendanceDays_${i}`] !== null) {
                  updated[`_attendanceDays_${i}`] = savedWithDays[`_attendanceDays_${i}`];
                }
              }
              
              // _attendanceDays 맵을 완전히 교체 (이전 값이 남아있지 않도록)
              if (savedWithDays._attendanceDays && typeof savedWithDays._attendanceDays === 'object' && Object.keys(savedWithDays._attendanceDays).length > 0) {
                updated._attendanceDays = { ...savedWithDays._attendanceDays };
              } else {
                // 서버 응답에 출석일이 없으면 빈 객체로 설정
                updated._attendanceDays = {};
              }
              
              return updated;
            }
            return r;
          }));
          setAllRecords((prev) => prev.map((r) => {
            const match = (r.id || 'new') === (record.id || 'new');
            if (match) {
              // 출석일 필드들을 명시적으로 포함하여 업데이트
              // savedWithDays의 모든 필드를 먼저 복사한 후, 출석일 필드를 명시적으로 덮어쓰기
              const updated = { ...r, ...savedWithDays, _v: (r._v || 0) + 1 };
              
              // 출석일 필드들이 제대로 포함되었는지 확인 및 강제 설정
              for (let i = 1; i <= 4; i++) {
                // savedWithDays에 출석일이 있으면 무조건 설정 (undefined가 아닌 경우)
                if (savedWithDays[`_attendanceDays_${i}`] !== undefined && savedWithDays[`_attendanceDays_${i}`] !== null) {
                  updated[`_attendanceDays_${i}`] = savedWithDays[`_attendanceDays_${i}`];
                }
              }
              
              // _attendanceDays 맵을 완전히 교체 (이전 값이 남아있지 않도록)
              if (savedWithDays._attendanceDays && typeof savedWithDays._attendanceDays === 'object' && Object.keys(savedWithDays._attendanceDays).length > 0) {
                updated._attendanceDays = { ...savedWithDays._attendanceDays };
              } else {
                // 서버 응답에 출석일이 없으면 빈 객체로 설정
                updated._attendanceDays = {};
              }
              return updated;
            }
            return r;
          }));
          
          // 출석일 state도 함께 업데이트 (다른 곳에서 참조할 수 있음)
          if (Object.keys(daysUpdates).length > 0) {
            setSiteAttendanceDays(prev => ({
              ...prev,
              ...daysUpdates
            }));
          }
          
          // 리렌더링 트리거
          setRefreshTick((t) => t + 1);
        });
        
        // 성능 최적화: 전체 목록 재로드 제거 (로컬 상태만 업데이트)
        
        // 이전 행의 값이 변경되면 다음 행들도 재계산 필요
        // 이전 행의 값(total_amount, rate_amount, charge_withdraw, site, notes)이 변경되면 다음 행들의 drbet_amount도 재계산
        if (needsRecalculation && (field === 'total_amount' || field === 'rate_amount' || field.startsWith('charge_withdraw') || field.startsWith('site') || field === 'notes')) {
          // 다음 행들 재계산 (최신 상태를 참조하도록 함수로 감싸서 처리)
          const recalculateNextRows = async () => {
            // 최신 allRecords 상태를 가져오기 위해 함수형 업데이트 사용
            setAllRecords((currentAllRecords) => {
              const allRecordsCopy = [...currentAllRecords];
              const sameDateRecords = allRecordsCopy
                .filter(r => r.record_date === selectedDate)
                .sort((a, b) => (a.display_order || 0) - (b.display_order || 0));
              
              const savedIndex = sameDateRecords.findIndex(r => (r.id || 'new') === (record.id || 'new'));
              
              if (savedIndex >= 0) {
                // 현재 행을 업데이트된 값으로 교체
                sameDateRecords[savedIndex] = { ...sameDateRecords[savedIndex], ...saved };
                
                // 다음 행들 재계산 (비동기로 처리)
                (async () => {
                  for (let i = savedIndex + 1; i < sameDateRecords.length; i++) {
                    const nextRecord = sameDateRecords[i];
                    const prevRecord = sameDateRecords[i - 1];
                    
                    const recalculatedDrbetAmount = calculateDRBet(nextRecord, prevRecord);
                    const recalculatedPrivateAmount = calculatePrivateAmount(nextRecord);
                    const recalculatedTotalCharge = calculateTotalCharge(nextRecord, recalculatedDrbetAmount);
                    const recalculatedMargin = calculateMargin(nextRecord, recalculatedTotalCharge);
                    
                    // 다음 행 업데이트
                    const nextUpdatedRecord = {
                      ...nextRecord,
                      drbet_amount: recalculatedDrbetAmount,
                      private_amount: recalculatedPrivateAmount,
                      total_charge: recalculatedTotalCharge,
                      margin: recalculatedMargin
                    };
                    
                    // sameDateRecords 업데이트 (다음 반복에서 사용)
                    sameDateRecords[i] = nextUpdatedRecord;
                    
                    // 서버에 저장
                    if (nextRecord.id) {
                      try {
                        const nextResponse = await axiosInstance.put(`/drbet/${nextRecord.id}`, nextUpdatedRecord);
                        const nextSaved = nextResponse.data || nextUpdatedRecord;
                        
                        // 화면 업데이트 (최신 상태로)
                        setRecords((prev) => prev.map((r) => 
                          (r.id || 'new') === (nextRecord.id || 'new') ? nextSaved : r
                        ));
                        setAllRecords((prev) => prev.map((r) => 
                          (r.id || 'new') === (nextRecord.id || 'new') ? nextSaved : r
                        ));
                        setRefreshTick((t) => t + 1);
                      } catch (error) {
                        console.error(`다음 행 ${i + 1} 재계산 실패:`, error);
                      }
                    }
                  }
                })();
              }
              
              return currentAllRecords; // 상태는 즉시 반환 (비동기 작업은 별도로 처리)
            });
          };
          
          // 약간의 지연 후 재계산 (상태 업데이트가 완료된 후)
          setTimeout(recalculateNextRows, 50);
        }
      }
    } catch (error) {
      console.error('DR벳 기록 저장 실패:', error);
      toast.error('DR벳 기록 저장에 실패했습니다');
    } finally {
      // 중복 저장 방지 락 해제
      const recordKey = record.id || record.tmpId || 'new';
      delete savingRecordRef.current[recordKey];
      
      // 편집 종료 처리
      editingLockRef.current = false;
      setEditingCell(null);
      setEditingValue('');
    }
  };

  // 엔터키 처리
  const handleKeyPress = (e, record) => {
    if (e.key === 'Enter') {
      handleCellBlur(record);
    } else if (e.key === 'Escape') {
      setEditingCell(null);
      setEditingValue('');
    }
  };

  // 모든 행 삭제
  const deleteAllRecords = async () => {
    if (records.length === 0) {
      toast.error('삭제할 행이 없습니다');
      return;
    }
    
    const confirmMessage = `정말 현재 날짜(${selectedDate})의 모든 행(${records.length}개)을 삭제하시겠습니까?\n\n이 작업은 되돌릴 수 없습니다.`;
    if (!window.confirm(confirmMessage)) return;
    
    try {
      // 각 레코드별로 출석일 감소 처리
      for (const record of records) {
        if (record.id) {
          // 저장된 레코드만 출석일 감소 처리
          for (let i = 1; i <= 4; i++) {
            const identityField = `identity${i}`;
            const siteField = `site_name${i}`;
            const chargeWithdrawField = `charge_withdraw${i}`;
            
            const identityName = record[identityField] || '';
            const siteName = record[siteField] || '';
            const chargeWithdraw = record[chargeWithdrawField] || '';
            
            if (identityName && siteName && chargeWithdraw) {
              const parseCharge = (str) => {
                if (!str || str.trim() === '') return 0;
                const parts = str.split(' ');
                return parseFloat(parts[0]) || 0;
              };
              const charge = parseCharge(chargeWithdraw);
              if (charge > 0) {
                // 출석일 감소 (재충전 체크를 위해 record와 siteIndex 전달)
                await handleAutoAttendance(siteName, identityName, chargeWithdraw, '', record, i);
              }
            }
          }
        }
      }
      
      // 서버에서 삭제 (저장된 레코드만)
      const recordsToDelete = records.filter(r => r.id);
      if (recordsToDelete.length > 0) {
        await Promise.all(recordsToDelete.map(record => 
          axiosInstance.delete(`/drbet/${record.id}`)
        ));
      }
      
      // 로컬 상태에서 모든 레코드 제거
      setRecords([]);
      
      toast.success(`모든 행(${records.length}개)이 삭제되었습니다`);
    } catch (error) {
      console.error('모든 행 삭제 실패:', error);
      toast.error('모든 행 삭제에 실패했습니다');
    }
  };

  // 기록 삭제
  const deleteRecord = async (id) => {
    if (!window.confirm('정말 이 기록을 삭제하시겠습니까?')) return;
    
    try {
      // 삭제 전 레코드 정보 가져오기 (출석일 감소 처리를 위해)
      const recordToDelete = records.find(r => r.id === id);
      if (recordToDelete) {
        // 각 사이트별로 출석일 감소 처리
        for (let i = 1; i <= 4; i++) {
          const identityField = `identity${i}`;
          const siteField = `site_name${i}`;
          const chargeWithdrawField = `charge_withdraw${i}`;
          
          const identityName = recordToDelete[identityField] || '';
          const siteName = recordToDelete[siteField] || '';
          const chargeWithdraw = recordToDelete[chargeWithdrawField] || '';
          
          if (identityName && siteName && chargeWithdraw) {
            const parseCharge = (str) => {
              if (!str || str.trim() === '') return 0;
              const parts = str.split(' ');
              return parseFloat(parts[0]) || 0;
            };
            const charge = parseCharge(chargeWithdraw);
            if (charge > 0) {
              // 출석일 감소 (재충전 체크를 위해 record와 siteIndex 전달)
              await handleAutoAttendance(siteName, identityName, chargeWithdraw, '', recordToDelete, i);
            }
          }
        }
      }
      
      await axiosInstance.delete(`/drbet/${id}`);
      toast.success('DR벳 기록이 삭제되었습니다');
      loadRecords();
    } catch (error) {
      console.error('DR벳 기록 삭제 실패:', error);
      toast.error('DR벳 기록 삭제에 실패했습니다');
    }
  };

  // 환전 금액이 있는지 확인하는 함수
  const hasWithdrawAmount = (input) => {
    if (!input) return false;
    const match = input.match(/(\d+)\s+(\d+)/);
    return match && match[2]; // 두 번째 숫자(환전)가 있으면 true
  };

  // 한 행에서 환전 금액 합계를 만원 단위로 계산하는 함수
  const getWithdrawTotalInManwon = (record) => {
    if (!record) return 0;
    let total = 0;
    for (let i = 1; i <= 4; i++) {
      const field = `charge_withdraw${i}`;
      const value = record[field];
      if (!value || !value.trim) continue;
      const trimmed = value.trim();
      if (!trimmed) continue;
      const parts = trimmed.split(/\s+/);
      if (parts.length >= 2) {
        const withdraw = parseFloat(parts[1]) || 0;
        total += withdraw;
      }
    }
    return total; // 만원 단위 합계
  };

  // 'ㄷ'이 포함되어 있는지 확인하는 함수
  const hasSpecialChar = (input) => {
    if (!input) return false;
    return input.includes('ㄷ');
  };

  // 특정 사이트 셀의 재충 여부 확인
  const isSiteDuplicate = (record, siteIndex) => {
    const identityField = `identity${siteIndex}`;
    const siteField = `site_name${siteIndex}`;
    const chargeWithdrawField = `charge_withdraw${siteIndex}`;
    
    const identityValue = record[identityField] || '';
    const siteValue = record[siteField] || '';
    
    if (!identityValue || !siteValue) return false;
    
    // 현재 레코드의 인덱스 찾기
    const currentIndex = records.findIndex(r => r.id === record.id);
    if (currentIndex === -1) return false;
    
    // 동일한 유저/사이트를 가진 레코드 찾기
    const duplicateRecords = [];
    for (let i = 0; i < records.length; i++) {
      const r = records[i];
      const otherIdentity = r[`identity${siteIndex}`];
      const otherSite = r[`site_name${siteIndex}`];
      if (otherIdentity === identityValue && otherSite === siteValue) {
        duplicateRecords.push({ record: r, index: i, order: r.display_order || 0 });
      }
    }
    
    if (duplicateRecords.length === 0) return false;
    
    // 기준 레코드 찾기 (display_order가 가장 작은 것)
    duplicateRecords.sort((a, b) => a.order - b.order || a.index - b.index);
    const baseRecord = duplicateRecords[0].record;
    
    // 기준 레코드의 충전금액 확인
    const baseChargeRaw = baseRecord[chargeWithdrawField] || '';
    const baseChargeParts = baseChargeRaw.trim().split(/\s+/);
    const baseDeposit = baseChargeParts.length > 0 ? (parseFloat(baseChargeParts[0]) || 0) : 0;
    
    if (baseDeposit <= 0) return false;
    
    // 현재 레코드보다 앞에 있는 중복 레코드 확인
    return duplicateRecords.some(d => d.index < currentIndex);
  };

  // 특정 사이트 셀에 'ㄷ' 문자가 있는지 확인 (환전 대기)
  const hasSiteD = (record, siteIndex) => {
    const chargeWithdrawField = `charge_withdraw${siteIndex}`;
    const chargeWithdrawValue = record[chargeWithdrawField] || '';
    return chargeWithdrawValue.includes('ㄷ');
  };


  // 사이트 입력 렌더링 (유저/사이트/충환전 3개 input)
  const renderSiteInputs = (record, siteIndex, layoutVariant = 'default') => {
    const identityField = `identity${siteIndex}`;
    const siteField = `site_name${siteIndex}`;
    const chargeWithdrawField = `charge_withdraw${siteIndex}`;
    
    const identityValue = record[identityField] || '';
    const siteValue = record[siteField] || '';
    const chargeWithdrawValue = record[chargeWithdrawField] || '';
    
    // 환전 여부 확인
    const chargeWithdrawData = parseChargeWithdraw(chargeWithdrawValue);
    const hasWithdraw = chargeWithdrawData.withdraw > 0;
    
    // 'ㄷ' 문자가 있는지 확인 (charge_withdraw 필드에서 확인)
    const hasD = chargeWithdrawValue.includes('ㄷ');
    



    
    // 편집 중인지 확인
    const isEditingIdentity = editingCell?.recordId === (record.id || 'new') && 
                               editingCell?.field === identityField;
    const isEditingSite = editingCell?.recordId === (record.id || 'new') && 
                          editingCell?.field === siteField;
    const isEditingChargeWithdraw = editingCell?.recordId === (record.id || 'new') && 
                                     editingCell?.field === chargeWithdrawField;
    
  // 현재 선택된 유저의 사이트 목록
  const getCurrentIdentity = () => {
    // 저장된 유저 값을 우선 확인
    if (identityValue) {
      return identities.find(id => id.name === identityValue);
    }
    // 편집 중일 때는 편집 중인 값을 기준으로 (한글자라도 입력하면)
    if (isEditingIdentity && editingValue) {
      const foundIdentity = identities.find(id => id.name === editingValue);
      // 정확히 일치하는 유저를 찾으면 반환
      if (foundIdentity) {
        return foundIdentity;
      }
    }
    return null;
  };
    
    const currentIdentity = getCurrentIdentity();
    const availableSites = currentIdentity ? (identitySitesMap[currentIdentity.id] || []) : [];
    
    // 컨테이너 배경색 설정
    let containerBgColor = '';
    
    // 충전금액 확인 (charge_withdraw 필드의 첫 번째 숫자)
    const hasCharge = (() => {
      if (!chargeWithdrawValue || !chargeWithdrawValue.trim()) return false;
      const parts = chargeWithdrawValue.trim().split(/\s+/);
      const deposit = parts.length > 0 ? (parseFloat(parts[0]) || 0) : 0;
      return deposit > 0;
    })();
    
    // 중복 유저/사이트 확인 (최적화: 편집 중이 아니고 값이 있을 때만 계산)
    const isDuplicate = (() => {
      // 편집 중이면 계산 스킵 (입력 중 렉 방지)
      if (isEditingIdentity || isEditingSite || isEditingChargeWithdraw) return false;
      if (!identityValue || !siteValue) return false;
      
      // 한 번의 순회로 모든 정보 수집 (최적화: O(n))
      let currentIndex = -1;
      let baseRecord = null;
      let baseDeposit = 0;
      let hasEarlierDuplicate = false;
      const duplicateRecords = [];
      
      // records를 한 번만 순회하여 모든 정보 수집
      for (let i = 0; i < records.length; i++) {
        const r = records[i];
        
        // 현재 레코드의 인덱스 찾기
        if (r.id === record.id) {
          currentIndex = i;
        }
        
        // 동일한 유저/사이트를 가진 레코드 찾기
        const otherIdentity = r[`identity${siteIndex}`];
        const otherSite = r[`site_name${siteIndex}`];
        if (otherIdentity === identityValue && otherSite === siteValue) {
          duplicateRecords.push({ record: r, index: i, order: r.display_order || 0 });
        }
      }
      
      if (duplicateRecords.length === 0 || currentIndex === -1) return false;
      
      // 기준 레코드 찾기 (display_order가 가장 작은 것)
      duplicateRecords.sort((a, b) => a.order - b.order || a.index - b.index);
      baseRecord = duplicateRecords[0].record;
      
      // 기준 레코드의 충전금액 확인
      const baseChargeField = `charge_withdraw${siteIndex}`;
      const baseChargeRaw = baseRecord[baseChargeField] || '';
      const baseChargeParts = baseChargeRaw.trim().split(/\s+/);
      baseDeposit = baseChargeParts.length > 0 ? (parseFloat(baseChargeParts[0]) || 0) : 0;
      
      if (baseDeposit <= 0) return false;
      
      // 현재 레코드보다 앞에 있는 중복 레코드 확인
      hasEarlierDuplicate = duplicateRecords.some(d => d.index < currentIndex);
      
      return hasEarlierDuplicate;
    })();
    
    // 배경색 우선순위: 재충(중복) > ㄷ > 환전
    // 재충일 때는 셀 배경색만 변경하고, 유저/사이트/충환전 영역 배경색은 제거
    // 환전 대기(ㄷ)일 때는 일반 환전일 때처럼 유저/사이트/충환전 영역 스타일 변경
    if (isDuplicate) {
      containerBgColor = ''; // 재충일 때는 유저/사이트/충환전 영역 배경색 제거
    } else if (hasD) {
      containerBgColor = ''; // 환전 대기(ㄷ)일 때는 일반 환전처럼 (hasRedStyle로 배경색 변경됨)
    } else if (hasWithdraw) {
      containerBgColor = ''; // 환전만 있으면 배경색 없음
    }
    
    // 텍스트 색상 및 테두리 색상 설정
    // 재충이면서 환전이 있을 때도 일반 환전처럼 빨간색 스타일 적용
    // 충전금액이 없고 유저/사이트가 있으면 보라색 텍스트 (배경은 없음)
    const hasPurpleStyle = !isDuplicate && !hasD && !hasCharge && identityValue && siteValue && !hasWithdraw;
    // 환전 대기(ㄷ) 또는 환전이 있으면 빨간색 (재충이면서 환전이 있을 때도 포함)
    const hasRedStyle = hasD || hasWithdraw;
    
    const recordId = record.id ? String(record.id) : (record.tmpId ? String(record.tmpId) : 'new');
    const draggableId = `site-${recordId}-${siteIndex}`;
    const droppableId = `site-drop-${recordId}-${siteIndex}`;
    const isCompactVariant = layoutVariant === 'compact';
    const baseInputSizeClass = isCompactVariant ? 'text-sm' : 'text-lg';
    const baseInputPaddingClass = isCompactVariant ? 'px-1 py-0.5' : 'px-5 py-4';
    const displayPaddingClass = isCompactVariant ? 'px-1 py-0.5' : 'px-5 py-4';
    
    const identityInputClass = `${baseInputSizeClass} ${baseInputPaddingClass} w-full dark:bg-transparent font-extrabold ${hasRedStyle ? 'text-red-700 dark:text-red-300' : hasPurpleStyle ? 'text-purple-700 dark:text-purple-300' : 'text-gray-900 dark:text-gray-100'} text-center border-0 focus:outline-none focus:ring-0`;
    const siteInputClass = `${baseInputSizeClass} ${baseInputPaddingClass} w-full dark:bg-transparent font-extrabold ${hasRedStyle ? 'text-red-700 dark:text-red-300' : hasPurpleStyle ? 'text-purple-700 dark:text-purple-300' : 'text-gray-900 dark:text-gray-100'} text-center border-0 focus:outline-none focus:ring-0`;
    const chargeInputClass = `${baseInputSizeClass} ${baseInputPaddingClass} w-full dark:bg-transparent font-extrabold ${hasRedStyle ? 'text-red-700 dark:text-red-300' : hasPurpleStyle ? 'text-purple-700 dark:text-purple-300' : 'text-gray-900 dark:text-gray-100'} text-center border-0 focus:outline-none focus:ring-0`;
    const identityDisplayClass = `${baseInputSizeClass} ${displayPaddingClass} cursor-pointer hover:opacity-80 transition-opacity font-extrabold ${hasRedStyle ? 'text-red-700 dark:text-red-300' : hasPurpleStyle ? 'text-purple-700 dark:text-purple-300' : 'text-gray-900 dark:text-gray-100'} text-center`;
    const siteDisplayClass = `${baseInputSizeClass} ${displayPaddingClass} cursor-pointer hover:opacity-80 transition-opacity font-extrabold ${hasRedStyle ? 'text-red-700 dark:text-red-300' : hasPurpleStyle ? 'text-purple-700 dark:text-purple-300' : 'text-gray-900 dark:text-gray-100'} text-center overflow-hidden text-ellipsis whitespace-nowrap`;
    const chargeDisplayClass = `${baseInputSizeClass} ${displayPaddingClass} cursor-pointer hover:opacity-80 transition-opacity font-extrabold ${hasRedStyle ? 'text-red-700 dark:text-red-300' : hasPurpleStyle ? 'text-purple-700 dark:text-purple-300' : 'text-gray-900 dark:text-gray-100'} text-center`;
    const deleteButtonElement = (identityValue || siteValue || chargeWithdrawValue) ? (
      <button
        onClick={(e) => {
          e.stopPropagation();
          handleDeleteSite(record, siteIndex);
        }}
        className={`${isCompactVariant ? 'text-[11px] px-1 py-0.5 rounded text-red-500 hover:bg-red-50 dark:text-red-300 dark:hover:bg-red-900/30' : 'text-red-500 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300 p-0.5 rounded hover:bg-red-50 dark:hover:bg-red-900/20'}`}
        title="사이트 정보 삭제"
      >
        <span className={`${isCompactVariant ? 'text-[8px]' : 'text-[10px]'} inline-block`}>🗑️</span>
      </button>
    ) : null;
    const attendanceSection = renderAttendanceButton(record, siteIndex, siteValue, { 
      variant: isCompactVariant ? 'compact' : 'default',
      layout: isCompactVariant ? 'row' : 'column'
    });
    const identityFieldContent = isEditingIdentity ? (
      <div className="relative">
        <input
          type="text"
          value={editingValue}
          lang="ko"
          inputMode="text"
          style={{ letterSpacing: '0', fontVariantLigatures: 'normal' }}
          onFocus={() => {
            // 포커스 시 조합 상태 초기화
            isComposingRef.current = false;
            setIsComposingUI(false);
          }}
          onCompositionStart={() => {
            isComposingRef.current = true;
            setIsComposingUI(true);
          }}
          onCompositionEnd={(e) => {
            // 조합 종료 → 한글 정규화(NFC)로 확정
            isComposingRef.current = false;
            setIsComposingUI(false);
            const finalized = (e.currentTarget.value || '').normalize('NFC');
            setEditingValue(finalized);
          }}
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          onChange={(e) => {
            const newValue = e.target.value;
            setEditingValue(newValue);
          }}
          onKeyDown={async (e) => {
            // IME 조합 중일 때는 특정 로직 실행하지 않음
            if (e.nativeEvent.isComposing || isComposingRef.current) {
              return;
            }
            // TAB 이동만 처리 (Enter는 onKeyPress에서 처리)
            if (e.key === 'Tab') {
              e.preventDefault();
              // Shift+Tab: 이전 열의 충환전으로 이동 (사이트2/3/4에서만 유효)
              if (e.shiftKey && siteIndex > 1) {
                // 현재 입력 저장
                const currentVal = e.currentTarget.value || '';
                setEditingValue(currentVal);
                const updatedRecord = { ...record, [identityField]: currentVal };
                if (!currentVal || currentVal.trim() === '') {
                  updatedRecord[siteField] = '';
                }
                try {
                  await handleCellBlur(updatedRecord);
                  // 저장 성공 후 이전 열의 충환전으로 이동
                  const prevChargeField = `charge_withdraw${siteIndex - 1}`;
                  setTimeout(() => {
                    setEditingCell({ recordId: record.id || 'new', field: prevChargeField });
                    setEditingValue(record[prevChargeField] || '');
                  }, 0);
                } catch (error) {
                  console.error('유저 저장 실패:', error);
                  toast.error('유저 저장에 실패했습니다');
                }
                return;
              }
              // 일반 Tab: 현재 입력을 저장하고 사이트 입력으로 이동
              const currentVal = e.currentTarget.value || '';
              setEditingValue(currentVal);
              const updatedRecord = { ...record, [identityField]: currentVal };
              if (!currentVal || currentVal.trim() === '') {
                updatedRecord[siteField] = '';
              }
              try {
                await handleCellBlur(updatedRecord);
                // 저장 성공 후 사이트 입력으로 이동
                setTimeout(() => {
                  setEditingCell({ recordId: record.id || 'new', field: siteField });
                  setEditingValue(record[siteField] || '');
                }, 0);
              } catch (error) {
                console.error('유저 저장 실패:', error);
                toast.error('유저 저장에 실패했습니다');
              }
              return;
            } else if (e.key === 'Escape') {
              setEditingCell(null);
            }
          }}
          onKeyPress={async (e) => {
            // Enter 키로 저장
            if (e.key === 'Enter') {
              e.preventDefault();
              if (isComposingRef.current) return;
              
              const currentVal = editingValue || '';
              const updatedRecord = { ...record, [identityField]: currentVal };
              if (!currentVal || currentVal.trim() === '') {
                updatedRecord[siteField] = '';
              }
              
              try {
                await handleCellBlur(updatedRecord);
                setEditingCell(null);
                setEditingValue('');
              } catch (error) {
                console.error('유저 저장 실패:', error);
                toast.error('유저 저장에 실패했습니다');
              }
            }
          }}
          onBlur={async () => {
            // 조합 중에는 onBlur 저장을 무시 (포커스 이동으로 조합이 끊기는 이슈 방지)
            if (isComposingRef.current) { setIsComposingUI(false); return; }
            setIsComposingUI(false);
            const updatedRecord = { ...record, [identityField]: editingValue };
            if (!editingValue || editingValue.trim() === '') {
              updatedRecord[siteField] = '';
            }
            handleCellBlur(updatedRecord);
          }}
          autoFocus
          className={identityInputClass}
        />
      </div>
    ) : (
      <div
        key={`identity-display-${record.id || record.tmpId}-${record._v || 0}`}
        onClick={() => {
          editingLockRef.current = true;
          setEditingCell({ recordId: record.id || 'new', field: identityField });
          setEditingValue(identityValue);
        }}
        className={`${identityDisplayClass} ${!identityValue ? 'opacity-50' : ''}`}
      >
        {identityValue || '유저'}
      </div>
    );
    const siteFieldContent = isEditingSite ? (
      <div className="relative">
        <input
          type="text"
          value={editingValue}
          lang="ko"
          inputMode="text"
          style={{ letterSpacing: '0', fontVariantLigatures: 'normal' }}
          onFocus={() => {
            // 포커스 시 조합 상태 초기화
            isComposingRef.current = false;
            setIsComposingUI(false);
          }}
          onCompositionStart={() => {
            isComposingRef.current = true;
            setIsComposingUI(true);
          }}
          onCompositionEnd={(e) => {
            // 조합 종료 → 한글 정규화(NFC)로 확정
            isComposingRef.current = false;
            setIsComposingUI(false);
            const finalized = (e.currentTarget.value || '').normalize('NFC');
            setEditingValue(finalized);
          }}
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          onChange={(e) => {
            const newValue = e.target.value;
            setEditingValue(newValue);
          }}
          onKeyDown={async (e) => {
            // IME 조합 중일 때는 특정 로직 실행하지 않음
            if (e.nativeEvent.isComposing || isComposingRef.current) {
              return;
            }
            // TAB 이동만 처리 (Enter는 onKeyPress에서 처리)
            if (e.key === 'Tab') {
              e.preventDefault();
              if (e.shiftKey) {
                // 현재 입력 저장 후 이전 필드(유저)로 이동
                const currentVal = e.currentTarget.value || '';
                setEditingValue(currentVal);
                
                // 사이트 검증: 등록된 사이트만 허용 (빈 값이 아닐 때만)
                if (currentVal && currentVal.trim() && currentIdentity) {
                  const trimmedValue = currentVal.trim();
                  const isValidSite = availableSites.find(s => s.site_name === trimmedValue);
                  if (!isValidSite) {
                    log('사이트 검증 실패 (Shift+Tab):', {
                      입력값: trimmedValue,
                      입력값_길이: trimmedValue.length,
                      입력값_문자코드: Array.from(trimmedValue).map(c => c.charCodeAt(0)),
                      사용가능한_사이트목록: availableSites.map(s => s.site_name)
                    });
                    toast.error(`등록되지 않은 사이트입니다: "${trimmedValue}". 사이트 관리에서 먼저 등록해주세요.`);
                    return;
                  }
                }
                
                try {
                  await handleCellBlur({ ...record, [siteField]: currentVal });
                  // 저장 성공 후 유저 입력으로 이동
                  setEditingCell({ recordId: record.id || 'new', field: identityField });
                  setEditingValue(identityValue);
                } catch (error) {
                  console.error('사이트 저장 실패:', error);
                  toast.error('사이트 저장에 실패했습니다');
                }
                return;
              } else if (!currentIdentity) {
                toast.error('먼저 유저를 선택해주세요');
                return;
              }
              // 현재 입력 저장 후 충환전 입력으로 이동
              const currentVal = e.currentTarget.value || '';
              setEditingValue(currentVal);
              
              // 사이트 검증: 등록된 사이트만 허용 (빈 값이 아닐 때만)
              if (currentVal && currentVal.trim() && currentIdentity) {
                const trimmedValue = currentVal.trim();
                const isValidSite = availableSites.find(s => s.site_name === trimmedValue);
                if (!isValidSite) {
                  log('사이트 검증 실패 (Tab):', {
                    입력값: trimmedValue,
                    입력값_길이: trimmedValue.length,
                    입력값_문자코드: Array.from(trimmedValue).map(c => c.charCodeAt(0)),
                    사용가능한_사이트목록: availableSites.map(s => s.site_name)
                  });
                  toast.error(`등록되지 않은 사이트입니다: "${trimmedValue}". 사이트 관리에서 먼저 등록해주세요.`);
                  return;
                }
              }
              
              try {
                await handleCellBlur({ ...record, [siteField]: currentVal });
                setTimeout(() => {
                  setEditingCell({ recordId: record.id || 'new', field: chargeWithdrawField });
                  setEditingValue(record[chargeWithdrawField] || '');
                }, 0);
              } catch (error) {
                console.error('사이트 저장 실패:', error);
                toast.error('사이트 저장에 실패했습니다');
              }
              return;
            } else if (e.key === 'Escape') {
              setEditingCell(null);
            }
          }}
          onKeyPress={async (e) => {
            // Enter 키로 저장
            if (e.key === 'Enter') {
              e.preventDefault();
              if (isComposingRef.current) return;
              
              const currentVal = editingValue || '';
              // 사이트 검증: 등록된 사이트만 허용 (빈 값이 아닐 때만)
              if (currentVal && currentVal.trim() && currentIdentity) {
                const trimmedValue = currentVal.trim();
                const isValidSite = availableSites.find(s => s.site_name === trimmedValue);
                if (!isValidSite) {
                  toast.error(`등록되지 않은 사이트입니다: "${trimmedValue}". 사이트 관리에서 먼저 등록해주세요.`);
                  return;
                }
              }
              
              try {
                await handleCellBlur({ ...record, [siteField]: currentVal });
                setEditingCell(null);
                setEditingValue('');
              } catch (error) {
                console.error('사이트 저장 실패:', error);
                toast.error('사이트 저장에 실패했습니다');
              }
            }
          }}
          onBlur={() => {
            if (isComposingRef.current) { setIsComposingUI(false); return; }
            setIsComposingUI(false);
            
            // 사이트 검증: 등록된 사이트만 허용 (빈 값이 아닐 때만)
            if (editingValue && editingValue.trim() && currentIdentity) {
              const trimmedValue = editingValue.trim();
              const isValidSite = availableSites.find(s => s.site_name === trimmedValue);
              if (!isValidSite) {
                log('사이트 검증 실패:', {
                  입력값: trimmedValue,
                  입력값_길이: trimmedValue.length,
                  입력값_문자코드: Array.from(trimmedValue).map(c => c.charCodeAt(0)),
                  사용가능한_사이트목록: availableSites.map(s => s.site_name)
                });
                toast.error(`등록되지 않은 사이트입니다: "${trimmedValue}". 사이트 관리에서 먼저 등록해주세요.`);
                // 잘못된 값으로 저장되지 않도록 이전 값으로 복원
                setEditingValue(record[siteField] || '');
                setEditingCell(null);
                return;
              }
            }
            
            handleCellBlur({ ...record, [siteField]: editingValue });
          }}
          autoFocus
          className={`${siteInputClass}`}
          disabled={!currentIdentity}
          placeholder={currentIdentity ? '사이트' : '유저 먼저'}
        />
      </div>
    ) : (
      <div
        key={`site-display-${record.id || record.tmpId}-${record._v || 0}`}
        onClick={() => {
          if (!currentIdentity) {
            toast.error('먼저 유저를 선택해주세요');
            return;
          }
          editingLockRef.current = true;
          setEditingCell({ recordId: record.id || 'new', field: siteField });
          setEditingValue(siteValue);
        }}
        onContextMenu={async (e) => {
          e.preventDefault();
          e.stopPropagation();
          if (siteValue && currentIdentity) {
            // 우클릭 시 컨텍스트 메뉴 표시
            handleSiteContextMenu(e, record, siteIndex, currentIdentity, siteValue);
          }
        }}
        className={`${siteDisplayClass} ${!siteValue ? 'opacity-50' : ''} overflow-hidden text-ellipsis whitespace-nowrap`}
        title={siteValue || (currentIdentity ? '사이트' : '유저 먼저')}
      >
        {siteValue || (currentIdentity ? '사이트' : '유저 먼저')}
      </div>
    );
    const chargeFieldContent = isEditingChargeWithdraw ? (
      <input
        type="text"
        value={editingValue}
        onKeyDown={async (e) => {
          if (e.nativeEvent.isComposing || isComposingRef.current) return;
          if (e.key === 'Tab') {
            e.preventDefault();
            if (e.shiftKey) {
              // 현재 입력 저장 후 이전 필드: 사이트 입력으로 이동
              const currentVal = editingValue;
              try {
                const oldChargeWithdraw = editingCell?.originalValue !== undefined 
                  ? editingCell.originalValue 
                  : (record[chargeWithdrawField] || '');
                const updatedRecord = { ...record, [chargeWithdrawField]: currentVal };
                
                // handleCellBlur와 동일하게 서버 저장 전에 handleAutoAttendance 호출
                const identityValue = record[`identity${siteIndex}`] || '';
                if (siteValue && identityValue) {
                  await handleAutoAttendance(siteValue, identityValue, oldChargeWithdraw, currentVal, record, siteIndex);
                }
                
                if (record.isNew || !record.id) {
                  await axiosInstance.post('/drbet', updatedRecord);
                  await loadRecords();
                } else {
                  const response = await axiosInstance.put(`/drbet/${record.id}`, updatedRecord);
                  const saved = response.data || updatedRecord;
                  
                  // 성능 최적화: 배치 API로 출석일 한 번에 조회
                  const savedWithDays = { ...saved };
                  // 출석일 필드와 맵 초기화 (이전 값이 남아있지 않도록)
                  savedWithDays._attendanceDays = savedWithDays._attendanceDays || {};
                  for (let i = 1; i <= 4; i++) {
                    if (savedWithDays[`_attendanceDays_${i}`] === undefined) {
                      savedWithDays[`_attendanceDays_${i}`] = undefined;
                    }
                  }
                  
                  // 기존 레코드 수정 시에는 충전금액/유저/사이트 필드 변경 시에만 조회
                  const needsAttendanceRefresh = true; // charge_withdraw 필드이므로 항상 true
                  
                  // 조회할 사이트/유저 목록 수집
                  const sitesToLoad = [];
                  for (let i = 1; i <= 4; i++) {
                    const identityName = saved[`identity${i}`];
                    const siteName = saved[`site_name${i}`];
                    if (identityName && siteName) {
                      sitesToLoad.push({ siteName, identityName, index: i });
                    }
                  }
                  
                  // 배치 API로 한 번에 조회 (N+1 문제 해결)
                  const daysUpdates = {};
                  
                  // 서버 응답에 출석일 정보가 포함되어 있으면 우선 사용
                  if (saved._attendanceDays && typeof saved._attendanceDays === 'object') {
                    Object.entries(saved._attendanceDays).forEach(([key, days]) => {
                      const [identityName, siteName] = key.split('||');
                      
                      if (identityName && siteName && days !== undefined && days !== null) {
                        // 사이트 인덱스 찾기
                        for (let i = 1; i <= 4; i++) {
                          const savedIdentity = saved[`identity${i}`];
                          const savedSite = saved[`site_name${i}`];
                          const normalizedSavedIdentity = normalizeName(savedIdentity || '');
                          const normalizedSavedSite = normalizeName(savedSite || '');
                          const normalizedKeyIdentity = normalizeName(identityName);
                          const normalizedKeySite = normalizeName(siteName);
                          
                          if (normalizedSavedIdentity === normalizedKeyIdentity && 
                              normalizedSavedSite === normalizedKeySite) {
                            // 레코드 필드에 직접 저장
                            savedWithDays[`_attendanceDays_${i}`] = days || 0;
                            
                            // 레코드 맵에도 저장
                            if (!savedWithDays._attendanceDays) {
                              savedWithDays._attendanceDays = {};
                            }
                            savedWithDays._attendanceDays[key] = days || 0;
                            
                            // ref 캐시에도 저장 (이전 값 덮어쓰기)
                            const attendanceCacheKey = getAttendanceCacheKey(siteName, identityName);
                            attendanceStatsCacheRef.current[attendanceCacheKey] = {
                              consecutiveDays: days || 0,
                              timestamp: Date.now()
                            };
                            
                            // state 업데이트를 모아서 처리
                            daysUpdates[attendanceCacheKey] = days || 0;
                            break;
                          }
                        }
                      }
                    });
                  }
                  
                  // 서버 응답에 출석일이 없거나 불완전한 경우 API로 조회 (재시도 로직 포함)
                  const allSitesHaveDays = sitesToLoad.every(({ siteName, identityName }) => {
                    const normalizedIdentity = normalizeName(identityName);
                    const normalizedSite = normalizeName(siteName);
                    const mapKey = `${normalizedIdentity}||${normalizedSite}`;
                    return saved._attendanceDays && saved._attendanceDays[mapKey] !== undefined;
                  });
                  
                  if (sitesToLoad.length > 0 && needsAttendanceRefresh && !allSitesHaveDays) {
                    // 서버에서 출석일 업데이트가 완료될 때까지 대기 (재시도 로직)
                    const fetchAttendanceWithRetry = async (retries = 8, initialDelay = 300) => {
                      for (let i = 0; i < retries; i++) {
                        try {
                          await new Promise(resolve => setTimeout(resolve, initialDelay * (i + 1)));
                          
                          const attendanceResponse = await axiosInstance.post('/attendance/stats/batch', {
                            sites: sitesToLoad.map(({ siteName, identityName }) => ({ siteName, identityName }))
                          });
                          
                          if (attendanceResponse.data?.success && Array.isArray(attendanceResponse.data.results)) {
                            return attendanceResponse.data.results;
                          }
                        } catch (err) {
                          if (i === retries - 1) {
                            console.error('배치 출석일 조회 실패 (최종 시도):', err);
                            throw err;
                          }
                        }
                      }
                      return [];
                    };
                    
                    try {
                      const results = await fetchAttendanceWithRetry();
                      
                      results.forEach((result, idx) => {
                        const { siteName, identityName, consecutiveDays, error } = result;
                        const { index } = sitesToLoad[idx];
                        
                        if (!error && consecutiveDays !== undefined) {
                          // 레코드에 직접 출석일 저장 (UI 즉시 반영)
                          savedWithDays[`_attendanceDays_${index}`] = consecutiveDays || 0;
                          
                          // 레코드 맵에도 저장
                          if (!savedWithDays._attendanceDays) {
                            savedWithDays._attendanceDays = {};
                          }
                          const normalizedIdentity = normalizeName(identityName);
                          const normalizedSite = normalizeName(siteName);
                          const mapKey = `${normalizedIdentity}||${normalizedSite}`;
                          savedWithDays._attendanceDays[mapKey] = consecutiveDays || 0;
                          
                          // ref 캐시에도 저장 (이전 값 덮어쓰기)
                          const attendanceCacheKey = getAttendanceCacheKey(siteName, identityName);
                          attendanceStatsCacheRef.current[attendanceCacheKey] = {
                            consecutiveDays: consecutiveDays || 0,
                            timestamp: Date.now()
                          };
                          
                          // state 업데이트를 모아서 처리
                          daysUpdates[attendanceCacheKey] = consecutiveDays || 0;
                        }
                      });
                    } catch (err) {
                      console.error('배치 출석일 조회 실패:', err);
                    }
                  }
                  
                  // 모든 state 업데이트를 flushSync로 동기적으로 처리하여 즉시 렌더링
                  flushSync(() => {
                    setRecords((prev) => prev.map((r) => {
                      const match = (r.id || 'new') === (record.id || 'new');
                      if (match) {
                        const updated = { ...r, ...savedWithDays, _v: (r._v || 0) + 1 };
                        
                        // 출석일 필드들이 제대로 포함되었는지 확인 및 강제 설정
                        for (let i = 1; i <= 4; i++) {
                          if (savedWithDays[`_attendanceDays_${i}`] !== undefined && savedWithDays[`_attendanceDays_${i}`] !== null) {
                            updated[`_attendanceDays_${i}`] = savedWithDays[`_attendanceDays_${i}`];
                          }
                        }
                        
                        // _attendanceDays 맵을 완전히 교체 (이전 값이 남아있지 않도록)
                        if (savedWithDays._attendanceDays && typeof savedWithDays._attendanceDays === 'object' && Object.keys(savedWithDays._attendanceDays).length > 0) {
                          updated._attendanceDays = { ...savedWithDays._attendanceDays };
                        } else {
                          updated._attendanceDays = {};
                        }
                        return updated;
                      }
                      return r;
                    }));
                    setAllRecords((prev) => prev.map((r) => {
                      const match = (r.id || 'new') === (record.id || 'new');
                      if (match) {
                        const updated = { ...r, ...savedWithDays, _v: (r._v || 0) + 1 };
                        
                        // 출석일 필드들이 제대로 포함되었는지 확인 및 강제 설정
                        for (let i = 1; i <= 4; i++) {
                          if (savedWithDays[`_attendanceDays_${i}`] !== undefined && savedWithDays[`_attendanceDays_${i}`] !== null) {
                            updated[`_attendanceDays_${i}`] = savedWithDays[`_attendanceDays_${i}`];
                          }
                        }
                        
                        // _attendanceDays 맵을 완전히 교체 (이전 값이 남아있지 않도록)
                        if (savedWithDays._attendanceDays && typeof savedWithDays._attendanceDays === 'object' && Object.keys(savedWithDays._attendanceDays).length > 0) {
                          updated._attendanceDays = { ...savedWithDays._attendanceDays };
                        } else {
                          updated._attendanceDays = {};
                        }
                        return updated;
                      }
                      return r;
                    }));
                    
                    // 출석일 state도 함께 업데이트 (다른 곳에서 참조할 수 있음)
                    if (Object.keys(daysUpdates).length > 0) {
                      setSiteAttendanceDays(prev => ({
                        ...prev,
                        ...daysUpdates
                      }));
                    }
                    
                    // 리렌더링 트리거
                    setRefreshTick((t) => t + 1);
                  });
                }
                
                toast.success('충환전이 저장되었습니다');
                
                // 저장 성공 후 사이트 입력으로 이동
                setEditingCell({ recordId: record.id || 'new', field: siteField });
                setEditingValue(record[siteField] || '');
              } catch (error) {
                console.error('충환전 저장 실패:', error);
                toast.error('충환전 저장에 실패했습니다');
              }
            } else {
              // 현재 입력 저장 후 다음 필드: 다음 유저로 이동
              const currentVal = editingValue;
              try {
                const oldChargeWithdraw = editingCell?.originalValue !== undefined 
                  ? editingCell.originalValue 
                  : (record[chargeWithdrawField] || '');
                const updatedRecord = { ...record, [chargeWithdrawField]: currentVal };
                
                // handleCellBlur와 동일하게 서버 저장 전에 handleAutoAttendance 호출
                const identityValue = record[`identity${siteIndex}`] || '';
                if (siteValue && identityValue) {
                  await handleAutoAttendance(siteValue, identityValue, oldChargeWithdraw, currentVal, record, siteIndex);
                }
                
                if (record.isNew || !record.id) {
                  await axiosInstance.post('/drbet', updatedRecord);
                  await loadRecords();
                } else {
                  const response = await axiosInstance.put(`/drbet/${record.id}`, updatedRecord);
                  const saved = response.data || updatedRecord;
                  
                  // 성능 최적화: 배치 API로 출석일 한 번에 조회
                  const savedWithDays = { ...saved };
                  // 출석일 필드와 맵 초기화 (이전 값이 남아있지 않도록)
                  savedWithDays._attendanceDays = savedWithDays._attendanceDays || {};
                  for (let i = 1; i <= 4; i++) {
                    if (savedWithDays[`_attendanceDays_${i}`] === undefined) {
                      savedWithDays[`_attendanceDays_${i}`] = undefined;
                    }
                  }
                  
                  // 기존 레코드 수정 시에는 충전금액/유저/사이트 필드 변경 시에만 조회
                  const needsAttendanceRefresh = true; // charge_withdraw 필드이므로 항상 true
                  
                  // 조회할 사이트/유저 목록 수집
                  const sitesToLoad = [];
                  for (let i = 1; i <= 4; i++) {
                    const identityName = saved[`identity${i}`];
                    const siteName = saved[`site_name${i}`];
                    if (identityName && siteName) {
                      sitesToLoad.push({ siteName, identityName, index: i });
                    }
                  }
                  
                  // 배치 API로 한 번에 조회 (N+1 문제 해결)
                  const daysUpdates = {};
                  
                  // 서버 응답에 출석일 정보가 포함되어 있으면 우선 사용
                  if (saved._attendanceDays && typeof saved._attendanceDays === 'object') {
                    Object.entries(saved._attendanceDays).forEach(([key, days]) => {
                      const [identityName, siteName] = key.split('||');
                      
                      if (identityName && siteName && days !== undefined && days !== null) {
                        // 사이트 인덱스 찾기
                        for (let i = 1; i <= 4; i++) {
                          const savedIdentity = saved[`identity${i}`];
                          const savedSite = saved[`site_name${i}`];
                          const normalizedSavedIdentity = normalizeName(savedIdentity || '');
                          const normalizedSavedSite = normalizeName(savedSite || '');
                          const normalizedKeyIdentity = normalizeName(identityName);
                          const normalizedKeySite = normalizeName(siteName);
                          
                          if (normalizedSavedIdentity === normalizedKeyIdentity && 
                              normalizedSavedSite === normalizedKeySite) {
                            // 레코드 필드에 직접 저장
                            savedWithDays[`_attendanceDays_${i}`] = days || 0;
                            
                            // 레코드 맵에도 저장
                            if (!savedWithDays._attendanceDays) {
                              savedWithDays._attendanceDays = {};
                            }
                            savedWithDays._attendanceDays[key] = days || 0;
                            
                            // ref 캐시에도 저장 (이전 값 덮어쓰기)
                            const attendanceCacheKey = getAttendanceCacheKey(siteName, identityName);
                            attendanceStatsCacheRef.current[attendanceCacheKey] = {
                              consecutiveDays: days || 0,
                              timestamp: Date.now()
                            };
                            
                            // state 업데이트를 모아서 처리
                            daysUpdates[attendanceCacheKey] = days || 0;
                            break;
                          }
                        }
                      }
                    });
                  }
                  
                  // 서버 응답에 출석일이 없거나 불완전한 경우 API로 조회 (재시도 로직 포함)
                  const allSitesHaveDays = sitesToLoad.every(({ siteName, identityName }) => {
                    const normalizedIdentity = normalizeName(identityName);
                    const normalizedSite = normalizeName(siteName);
                    const mapKey = `${normalizedIdentity}||${normalizedSite}`;
                    return saved._attendanceDays && saved._attendanceDays[mapKey] !== undefined;
                  });
                  
                  if (sitesToLoad.length > 0 && needsAttendanceRefresh && !allSitesHaveDays) {
                    // 서버에서 출석일 업데이트가 완료될 때까지 대기 (재시도 로직)
                    const fetchAttendanceWithRetry = async (retries = 8, initialDelay = 300) => {
                      for (let i = 0; i < retries; i++) {
                        try {
                          await new Promise(resolve => setTimeout(resolve, initialDelay * (i + 1)));
                          
                          const attendanceResponse = await axiosInstance.post('/attendance/stats/batch', {
                            sites: sitesToLoad.map(({ siteName, identityName }) => ({ siteName, identityName }))
                          });
                          
                          if (attendanceResponse.data?.success && Array.isArray(attendanceResponse.data.results)) {
                            return attendanceResponse.data.results;
                          }
                        } catch (err) {
                          if (i === retries - 1) {
                            console.error('배치 출석일 조회 실패 (최종 시도):', err);
                            throw err;
                          }
                        }
                      }
                      return [];
                    };
                    
                    try {
                      const results = await fetchAttendanceWithRetry();
                      
                      results.forEach((result, idx) => {
                        const { siteName, identityName, consecutiveDays, error } = result;
                        const { index } = sitesToLoad[idx];
                        
                        if (!error && consecutiveDays !== undefined) {
                          // 레코드에 직접 출석일 저장 (UI 즉시 반영)
                          savedWithDays[`_attendanceDays_${index}`] = consecutiveDays || 0;
                          
                          // 레코드 맵에도 저장
                          if (!savedWithDays._attendanceDays) {
                            savedWithDays._attendanceDays = {};
                          }
                          const normalizedIdentity = normalizeName(identityName);
                          const normalizedSite = normalizeName(siteName);
                          const mapKey = `${normalizedIdentity}||${normalizedSite}`;
                          savedWithDays._attendanceDays[mapKey] = consecutiveDays || 0;
                          
                          // ref 캐시에도 저장 (이전 값 덮어쓰기)
                          const attendanceCacheKey = getAttendanceCacheKey(siteName, identityName);
                          attendanceStatsCacheRef.current[attendanceCacheKey] = {
                            consecutiveDays: consecutiveDays || 0,
                            timestamp: Date.now()
                          };
                          
                          // state 업데이트를 모아서 처리
                          daysUpdates[attendanceCacheKey] = consecutiveDays || 0;
                        }
                      });
                    } catch (err) {
                      console.error('배치 출석일 조회 실패:', err);
                    }
                  }
                  
                  // 모든 state 업데이트를 flushSync로 동기적으로 처리하여 즉시 렌더링
                  flushSync(() => {
                    setRecords((prev) => prev.map((r) => {
                      const match = (r.id || 'new') === (record.id || 'new');
                      if (match) {
                        const updated = { ...r, ...savedWithDays, _v: (r._v || 0) + 1 };
                        
                        // 출석일 필드들이 제대로 포함되었는지 확인 및 강제 설정
                        for (let i = 1; i <= 4; i++) {
                          if (savedWithDays[`_attendanceDays_${i}`] !== undefined && savedWithDays[`_attendanceDays_${i}`] !== null) {
                            updated[`_attendanceDays_${i}`] = savedWithDays[`_attendanceDays_${i}`];
                          }
                        }
                        
                        // _attendanceDays 맵을 완전히 교체 (이전 값이 남아있지 않도록)
                        if (savedWithDays._attendanceDays && typeof savedWithDays._attendanceDays === 'object' && Object.keys(savedWithDays._attendanceDays).length > 0) {
                          updated._attendanceDays = { ...savedWithDays._attendanceDays };
                        } else {
                          updated._attendanceDays = {};
                        }
                        return updated;
                      }
                      return r;
                    }));
                    setAllRecords((prev) => prev.map((r) => {
                      const match = (r.id || 'new') === (record.id || 'new');
                      if (match) {
                        const updated = { ...r, ...savedWithDays, _v: (r._v || 0) + 1 };
                        
                        // 출석일 필드들이 제대로 포함되었는지 확인 및 강제 설정
                        for (let i = 1; i <= 4; i++) {
                          if (savedWithDays[`_attendanceDays_${i}`] !== undefined && savedWithDays[`_attendanceDays_${i}`] !== null) {
                            updated[`_attendanceDays_${i}`] = savedWithDays[`_attendanceDays_${i}`];
                          }
                        }
                        
                        // _attendanceDays 맵을 완전히 교체 (이전 값이 남아있지 않도록)
                        if (savedWithDays._attendanceDays && typeof savedWithDays._attendanceDays === 'object' && Object.keys(savedWithDays._attendanceDays).length > 0) {
                          updated._attendanceDays = { ...savedWithDays._attendanceDays };
                        } else {
                          updated._attendanceDays = {};
                        }
                        return updated;
                      }
                      return r;
                    }));
                    
                    // 출석일 state도 함께 업데이트 (다른 곳에서 참조할 수 있음)
                    if (Object.keys(daysUpdates).length > 0) {
                      setSiteAttendanceDays(prev => ({
                        ...prev,
                        ...daysUpdates
                      }));
                    }
                    
                    // 리렌더링 트리거
                    setRefreshTick((t) => t + 1);
                  });
                }
                
                toast.success('충환전이 저장되었습니다');
                
                const currentIdx = records.findIndex(r => (r.id || 'new') === (record.id || 'new') && (r.tmpId ? r.tmpId === record.tmpId : true));
                const nextSiteIndex = siteIndex < 4 ? siteIndex + 1 : 1;
                const nextRecord = siteIndex < 4 ? record : records[currentIdx + 1];
                if (nextRecord) {
                  const nextIdentityField = `identity${nextSiteIndex}`;
                  setTimeout(() => {
                    setEditingCell({ recordId: nextRecord.id || 'new', field: nextIdentityField });
                    setEditingValue(nextRecord[nextIdentityField] || '');
                  }, 0);
                }
              } catch (error) {
                console.error('충환전 저장 실패:', error);
                toast.error('충환전 저장에 실패했습니다');
              }
            }
          }
        }}
        onChange={(e) => {
          const newValue = e.target.value;
          setEditingValue(newValue);
        }}
        onBlur={async () => {
          try {
            const oldChargeWithdraw = editingCell?.originalValue !== undefined 
              ? editingCell.originalValue 
              : (record[chargeWithdrawField] || '');
            const newChargeWithdraw = editingValue || '';
            const updatedRecord = { ...record, [chargeWithdrawField]: editingValue };
            
            // handleCellBlur와 동일하게 서버 저장 전에 handleAutoAttendance 호출
            const identityValue = record[`identity${siteIndex}`] || '';
            if (siteValue && identityValue) {
              await handleAutoAttendance(siteValue, identityValue, oldChargeWithdraw, newChargeWithdraw, record, siteIndex);
            }
            
            if (record.isNew || !record.id) {
              await axiosInstance.post('/drbet', updatedRecord);
              await loadRecords();
            } else {
              const response = await axiosInstance.put(`/drbet/${record.id}`, updatedRecord);
              const saved = response.data || updatedRecord;
              
              // 성능 최적화: 배치 API로 출석일 한 번에 조회
              const savedWithDays = { ...saved };
              // 출석일 필드와 맵 초기화 (이전 값이 남아있지 않도록)
              savedWithDays._attendanceDays = savedWithDays._attendanceDays || {};
              for (let i = 1; i <= 4; i++) {
                if (savedWithDays[`_attendanceDays_${i}`] === undefined) {
                  savedWithDays[`_attendanceDays_${i}`] = undefined;
                }
              }
              
              // 기존 레코드 수정 시에는 충전금액/유저/사이트 필드 변경 시에만 조회
              const needsAttendanceRefresh = true; // charge_withdraw 필드이므로 항상 true
              
              // 조회할 사이트/유저 목록 수집
              const sitesToLoad = [];
              for (let i = 1; i <= 4; i++) {
                const identityName = saved[`identity${i}`];
                const siteName = saved[`site_name${i}`];
                if (identityName && siteName) {
                  sitesToLoad.push({ siteName, identityName, index: i });
                }
              }
              
              // 배치 API로 한 번에 조회 (N+1 문제 해결)
              const daysUpdates = {};
              
              // 서버 응답에 출석일 정보가 포함되어 있으면 우선 사용
              if (saved._attendanceDays && typeof saved._attendanceDays === 'object') {
                Object.entries(saved._attendanceDays).forEach(([key, days]) => {
                  const [identityName, siteName] = key.split('||');
                  
                  if (identityName && siteName && days !== undefined && days !== null) {
                    // 사이트 인덱스 찾기
                    for (let i = 1; i <= 4; i++) {
                      const savedIdentity = saved[`identity${i}`];
                      const savedSite = saved[`site_name${i}`];
                      const normalizedSavedIdentity = normalizeName(savedIdentity || '');
                      const normalizedSavedSite = normalizeName(savedSite || '');
                      const normalizedKeyIdentity = normalizeName(identityName);
                      const normalizedKeySite = normalizeName(siteName);
                      
                      if (normalizedSavedIdentity === normalizedKeyIdentity && 
                          normalizedSavedSite === normalizedKeySite) {
                        // 레코드 필드에 직접 저장
                        savedWithDays[`_attendanceDays_${i}`] = days || 0;
                        
                        // 레코드 맵에도 저장
                        if (!savedWithDays._attendanceDays) {
                          savedWithDays._attendanceDays = {};
                        }
                        savedWithDays._attendanceDays[key] = days || 0;
                        
                        // ref 캐시에도 저장 (이전 값 덮어쓰기)
                        const attendanceCacheKey = getAttendanceCacheKey(siteName, identityName);
                        attendanceStatsCacheRef.current[attendanceCacheKey] = {
                          consecutiveDays: days || 0,
                          timestamp: Date.now()
                        };
                        
                        // state 업데이트를 모아서 처리
                        daysUpdates[attendanceCacheKey] = days || 0;
                        break;
                      }
                    }
                  }
                });
              }
              
              // 서버 응답에 출석일이 없거나 불완전한 경우 API로 조회 (재시도 로직 포함)
              const allSitesHaveDays = sitesToLoad.every(({ siteName, identityName }) => {
                const normalizedIdentity = normalizeName(identityName);
                const normalizedSite = normalizeName(siteName);
                const mapKey = `${normalizedIdentity}||${normalizedSite}`;
                return saved._attendanceDays && saved._attendanceDays[mapKey] !== undefined;
              });
              
              if (sitesToLoad.length > 0 && needsAttendanceRefresh && !allSitesHaveDays) {
                // 서버에서 출석일 업데이트가 완료될 때까지 대기 (재시도 로직)
                const fetchAttendanceWithRetry = async (retries = 8, initialDelay = 300) => {
                  for (let i = 0; i < retries; i++) {
                    try {
                      await new Promise(resolve => setTimeout(resolve, initialDelay * (i + 1)));
                      
                      const attendanceResponse = await axiosInstance.post('/attendance/stats/batch', {
                        sites: sitesToLoad.map(({ siteName, identityName }) => ({ siteName, identityName }))
                      });
                      
                      if (attendanceResponse.data?.success && Array.isArray(attendanceResponse.data.results)) {
                        return attendanceResponse.data.results;
                      }
                    } catch (err) {
                      if (i === retries - 1) {
                        console.error('배치 출석일 조회 실패 (최종 시도):', err);
                        throw err;
                      }
                    }
                  }
                  return [];
                };
                
                try {
                  const results = await fetchAttendanceWithRetry();
                  
                  results.forEach((result, idx) => {
                    const { siteName, identityName, consecutiveDays, error } = result;
                    const { index } = sitesToLoad[idx];
                    
                    if (!error && consecutiveDays !== undefined) {
                      // 레코드에 직접 출석일 저장 (UI 즉시 반영)
                      savedWithDays[`_attendanceDays_${index}`] = consecutiveDays || 0;
                      
                      // 레코드 맵에도 저장
                      if (!savedWithDays._attendanceDays) {
                        savedWithDays._attendanceDays = {};
                      }
                      const normalizedIdentity = normalizeName(identityName);
                      const normalizedSite = normalizeName(siteName);
                      const mapKey = `${normalizedIdentity}||${normalizedSite}`;
                      savedWithDays._attendanceDays[mapKey] = consecutiveDays || 0;
                      
                      // ref 캐시에도 저장 (이전 값 덮어쓰기)
                      const attendanceCacheKey = getAttendanceCacheKey(siteName, identityName);
                      attendanceStatsCacheRef.current[attendanceCacheKey] = {
                        consecutiveDays: consecutiveDays || 0,
                        timestamp: Date.now()
                      };
                      
                      // state 업데이트를 모아서 처리
                      daysUpdates[attendanceCacheKey] = consecutiveDays || 0;
                    }
                  });
                } catch (err) {
                  console.error('배치 출석일 조회 실패:', err);
                }
              }
              
              // 모든 state 업데이트를 flushSync로 동기적으로 처리하여 즉시 렌더링
              flushSync(() => {
                setRecords((prev) => prev.map((r) => {
                  const match = (r.id || 'new') === (record.id || 'new');
                  if (match) {
                    const updated = { ...r, ...savedWithDays, _v: (r._v || 0) + 1 };
                    
                    // 출석일 필드들이 제대로 포함되었는지 확인 및 강제 설정
                    for (let i = 1; i <= 4; i++) {
                      if (savedWithDays[`_attendanceDays_${i}`] !== undefined && savedWithDays[`_attendanceDays_${i}`] !== null) {
                        updated[`_attendanceDays_${i}`] = savedWithDays[`_attendanceDays_${i}`];
                      }
                    }
                    
                    // _attendanceDays 맵을 완전히 교체 (이전 값이 남아있지 않도록)
                    if (savedWithDays._attendanceDays && typeof savedWithDays._attendanceDays === 'object' && Object.keys(savedWithDays._attendanceDays).length > 0) {
                      updated._attendanceDays = { ...savedWithDays._attendanceDays };
                    } else {
                      updated._attendanceDays = {};
                    }
                    return updated;
                  }
                  return r;
                }));
                setAllRecords((prev) => prev.map((r) => {
                  const match = (r.id || 'new') === (record.id || 'new');
                  if (match) {
                    const updated = { ...r, ...savedWithDays, _v: (r._v || 0) + 1 };
                    
                    // 출석일 필드들이 제대로 포함되었는지 확인 및 강제 설정
                    for (let i = 1; i <= 4; i++) {
                      if (savedWithDays[`_attendanceDays_${i}`] !== undefined && savedWithDays[`_attendanceDays_${i}`] !== null) {
                        updated[`_attendanceDays_${i}`] = savedWithDays[`_attendanceDays_${i}`];
                      }
                    }
                    
                    // _attendanceDays 맵을 완전히 교체 (이전 값이 남아있지 않도록)
                    if (savedWithDays._attendanceDays && typeof savedWithDays._attendanceDays === 'object' && Object.keys(savedWithDays._attendanceDays).length > 0) {
                      updated._attendanceDays = { ...savedWithDays._attendanceDays };
                    } else {
                      updated._attendanceDays = {};
                    }
                    return updated;
                  }
                  return r;
                }));
                
                // 출석일 state도 함께 업데이트 (다른 곳에서 참조할 수 있음)
                if (Object.keys(daysUpdates).length > 0) {
                  setSiteAttendanceDays(prev => ({
                    ...prev,
                    ...daysUpdates
                  }));
                }
                
                // 리렌더링 트리거
                setRefreshTick((t) => t + 1);
              });
            }
            
            toast.success('충환전이 저장되었습니다');
            setEditingCell(null);
            setEditingValue('');
          } catch (error) {
            console.error('충환전 저장 실패:', error);
            toast.error('충환전 저장에 실패했습니다');
          }
        }}
        onKeyPress={async (e) => {
          if (e.key === 'Enter') {
            try {
              const oldChargeWithdraw = editingCell?.originalValue !== undefined 
                ? editingCell.originalValue 
                : (record[chargeWithdrawField] || '');
              const newChargeWithdraw = editingValue || '';
              const updatedRecord = { ...record, [chargeWithdrawField]: editingValue };
              
              // handleCellBlur와 동일하게 서버 저장 전에 handleAutoAttendance 호출
              const identityValue = record[`identity${siteIndex}`] || '';
              if (siteValue && identityValue) {
                await handleAutoAttendance(siteValue, identityValue, oldChargeWithdraw, newChargeWithdraw, record, siteIndex);
              }
              
              if (record.isNew || !record.id) {
                await axiosInstance.post('/drbet', updatedRecord);
                await loadRecords();
              } else {
                const response = await axiosInstance.put(`/drbet/${record.id}`, updatedRecord);
                const saved = response.data || updatedRecord;
                
                // 성능 최적화: 배치 API로 출석일 한 번에 조회
                const savedWithDays = { ...saved };
                // 출석일 필드와 맵 초기화 (이전 값이 남아있지 않도록)
                savedWithDays._attendanceDays = savedWithDays._attendanceDays || {};
                for (let i = 1; i <= 4; i++) {
                  if (savedWithDays[`_attendanceDays_${i}`] === undefined) {
                    savedWithDays[`_attendanceDays_${i}`] = undefined;
                  }
                }
                
                // 기존 레코드 수정 시에는 충전금액/유저/사이트 필드 변경 시에만 조회
                const needsAttendanceRefresh = true; // charge_withdraw 필드이므로 항상 true
                
                // 조회할 사이트/유저 목록 수집
                const sitesToLoad = [];
                for (let i = 1; i <= 4; i++) {
                  const identityName = saved[`identity${i}`];
                  const siteName = saved[`site_name${i}`];
                  if (identityName && siteName) {
                    sitesToLoad.push({ siteName, identityName, index: i });
                  }
                }
                
                // 배치 API로 한 번에 조회 (N+1 문제 해결)
                const daysUpdates = {};
                
                // 서버 응답에 출석일 정보가 포함되어 있으면 우선 사용
                if (saved._attendanceDays && typeof saved._attendanceDays === 'object') {
                  Object.entries(saved._attendanceDays).forEach(([key, days]) => {
                    const [identityName, siteName] = key.split('||');
                    
                    if (identityName && siteName && days !== undefined && days !== null) {
                      // 사이트 인덱스 찾기
                      for (let i = 1; i <= 4; i++) {
                        const savedIdentity = saved[`identity${i}`];
                        const savedSite = saved[`site_name${i}`];
                        const normalizedSavedIdentity = normalizeName(savedIdentity || '');
                        const normalizedSavedSite = normalizeName(savedSite || '');
                        const normalizedKeyIdentity = normalizeName(identityName);
                        const normalizedKeySite = normalizeName(siteName);
                        
                        if (normalizedSavedIdentity === normalizedKeyIdentity && 
                            normalizedSavedSite === normalizedKeySite) {
                          // 레코드 필드에 직접 저장
                          savedWithDays[`_attendanceDays_${i}`] = days || 0;
                          
                          // 레코드 맵에도 저장
                          if (!savedWithDays._attendanceDays) {
                            savedWithDays._attendanceDays = {};
                          }
                          savedWithDays._attendanceDays[key] = days || 0;
                          
                          // ref 캐시에도 저장 (이전 값 덮어쓰기)
                          const attendanceCacheKey = getAttendanceCacheKey(siteName, identityName);
                          attendanceStatsCacheRef.current[attendanceCacheKey] = {
                            consecutiveDays: days || 0,
                            timestamp: Date.now()
                          };
                          
                          // state 업데이트를 모아서 처리
                          daysUpdates[attendanceCacheKey] = days || 0;
                          break;
                        }
                      }
                    }
                  });
                }
                
                // 서버 응답에 출석일이 없거나 불완전한 경우 API로 조회 (재시도 로직 포함)
                const allSitesHaveDays = sitesToLoad.every(({ siteName, identityName }) => {
                  const normalizedIdentity = normalizeName(identityName);
                  const normalizedSite = normalizeName(siteName);
                  const mapKey = `${normalizedIdentity}||${normalizedSite}`;
                  return saved._attendanceDays && saved._attendanceDays[mapKey] !== undefined;
                });
                
                if (sitesToLoad.length > 0 && needsAttendanceRefresh && !allSitesHaveDays) {
                  // 서버에서 출석일 업데이트가 완료될 때까지 대기 (재시도 로직)
                  const fetchAttendanceWithRetry = async (retries = 8, initialDelay = 300) => {
                    for (let i = 0; i < retries; i++) {
                      try {
                        await new Promise(resolve => setTimeout(resolve, initialDelay * (i + 1)));
                        
                        const attendanceResponse = await axiosInstance.post('/attendance/stats/batch', {
                          sites: sitesToLoad.map(({ siteName, identityName }) => ({ siteName, identityName }))
                        });
                        
                        if (attendanceResponse.data?.success && Array.isArray(attendanceResponse.data.results)) {
                          return attendanceResponse.data.results;
                        }
                      } catch (err) {
                        if (i === retries - 1) {
                          console.error('배치 출석일 조회 실패 (최종 시도):', err);
                          throw err;
                        }
                      }
                    }
                    return [];
                  };
                  
                  try {
                    const results = await fetchAttendanceWithRetry();
                    
                    results.forEach((result, idx) => {
                      const { siteName, identityName, consecutiveDays, error } = result;
                      const { index } = sitesToLoad[idx];
                      
                      if (!error && consecutiveDays !== undefined) {
                        // 레코드에 직접 출석일 저장 (UI 즉시 반영)
                        savedWithDays[`_attendanceDays_${index}`] = consecutiveDays || 0;
                        
                        // 레코드 맵에도 저장
                        if (!savedWithDays._attendanceDays) {
                          savedWithDays._attendanceDays = {};
                        }
                        const normalizedIdentity = normalizeName(identityName);
                        const normalizedSite = normalizeName(siteName);
                        const mapKey = `${normalizedIdentity}||${normalizedSite}`;
                        savedWithDays._attendanceDays[mapKey] = consecutiveDays || 0;
                        
                        // ref 캐시에도 저장 (이전 값 덮어쓰기)
                        const attendanceCacheKey = getAttendanceCacheKey(siteName, identityName);
                        attendanceStatsCacheRef.current[attendanceCacheKey] = {
                          consecutiveDays: consecutiveDays || 0,
                          timestamp: Date.now()
                        };
                        
                        // state 업데이트를 모아서 처리
                        daysUpdates[attendanceCacheKey] = consecutiveDays || 0;
                      }
                    });
                  } catch (err) {
                    console.error('배치 출석일 조회 실패:', err);
                  }
                }
                
                // 모든 state 업데이트를 flushSync로 동기적으로 처리하여 즉시 렌더링
                flushSync(() => {
                  setRecords((prev) => prev.map((r) => {
                    const match = (r.id || 'new') === (record.id || 'new');
                    if (match) {
                      const updated = { ...r, ...savedWithDays, _v: (r._v || 0) + 1 };
                      
                      // 출석일 필드들이 제대로 포함되었는지 확인 및 강제 설정
                      for (let i = 1; i <= 4; i++) {
                        if (savedWithDays[`_attendanceDays_${i}`] !== undefined && savedWithDays[`_attendanceDays_${i}`] !== null) {
                          updated[`_attendanceDays_${i}`] = savedWithDays[`_attendanceDays_${i}`];
                        }
                      }
                      
                      // _attendanceDays 맵을 완전히 교체 (이전 값이 남아있지 않도록)
                      if (savedWithDays._attendanceDays && typeof savedWithDays._attendanceDays === 'object' && Object.keys(savedWithDays._attendanceDays).length > 0) {
                        updated._attendanceDays = { ...savedWithDays._attendanceDays };
                      } else {
                        updated._attendanceDays = {};
                      }
                      return updated;
                    }
                    return r;
                  }));
                  setAllRecords((prev) => prev.map((r) => {
                    const match = (r.id || 'new') === (record.id || 'new');
                    if (match) {
                      const updated = { ...r, ...savedWithDays, _v: (r._v || 0) + 1 };
                      
                      // 출석일 필드들이 제대로 포함되었는지 확인 및 강제 설정
                      for (let i = 1; i <= 4; i++) {
                        if (savedWithDays[`_attendanceDays_${i}`] !== undefined && savedWithDays[`_attendanceDays_${i}`] !== null) {
                          updated[`_attendanceDays_${i}`] = savedWithDays[`_attendanceDays_${i}`];
                        }
                      }
                      
                      // _attendanceDays 맵을 완전히 교체 (이전 값이 남아있지 않도록)
                      if (savedWithDays._attendanceDays && typeof savedWithDays._attendanceDays === 'object' && Object.keys(savedWithDays._attendanceDays).length > 0) {
                        updated._attendanceDays = { ...savedWithDays._attendanceDays };
                      } else {
                        updated._attendanceDays = {};
                      }
                      return updated;
                    }
                    return r;
                  }));
                  
                  // 출석일 state도 함께 업데이트 (다른 곳에서 참조할 수 있음)
                  if (Object.keys(daysUpdates).length > 0) {
                    setSiteAttendanceDays(prev => ({
                      ...prev,
                      ...daysUpdates
                    }));
                  }
                  
                  // 리렌더링 트리거
                  setRefreshTick((t) => t + 1);
                });
              }
              
              toast.success('충환전이 저장되었습니다');
              setEditingCell(null);
              setEditingValue('');
            } catch (error) {
              console.error('충환전 저장 실패:', error);
              toast.error('충환전 저장에 실패했습니다');
            }
          }
        }}
        autoFocus
        className={chargeInputClass}
        placeholder="10 20"
      />
    ) : (
      <div
        onClick={() => {
          const originalValue = record[chargeWithdrawField] || '';
          setEditingCell({ 
            recordId: record.id || 'new', 
            field: chargeWithdrawField,
            originalValue
          });
          setEditingValue(originalValue);
        }}
        className={`${chargeDisplayClass} cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700 ${!chargeWithdrawValue ? 'opacity-50' : ''}`}
      >
        {chargeWithdrawValue || '충환전'}
      </div>
    );

    if (isCompactVariant) {
      return (
        <Droppable droppableId={droppableId} isDropDisabled={false}>
          {(provided, snapshot) => (
            <div
              ref={provided.innerRef}
              {...provided.droppableProps}
              className={`flex flex-col gap-1 ${containerBgColor} ${snapshot.isDraggingOver ? 'bg-blue-100 dark:bg-blue-900/50 border-2 border-blue-500 rounded' : ''} p-1 rounded`}
            >
              <Draggable draggableId={draggableId} index={0} isDragDisabled={false}>
                {(provided, snapshot) => (
                  <div
                    ref={provided.innerRef}
                    {...provided.draggableProps}
                    {...provided.dragHandleProps}
                    className={`${snapshot.isDragging ? 'opacity-50 rotate-2' : 'cursor-move'} ${snapshot.isDraggingOver ? 'bg-blue-50 dark:bg-blue-900/30' : ''}`}
                    style={{
                      ...provided.draggableProps.style,
                      ...(snapshot.isDragging && {
                        transform: provided.draggableProps.style?.transform,
                      })
                    }}
                  >
                    <div className={`flex flex-col gap-1 ${containerBgColor}`}>
                      {/* 삭제 버튼 */}
                      {deleteButtonElement && (
                        <div className="flex justify-end">
                          {deleteButtonElement}
                        </div>
                      )}
                      {/* 통합 버튼 형태: 유저/사이트/충전금액 */}
                      <div className={`inline-flex items-center ${containerBgColor || 'bg-gray-50 dark:bg-gray-800'} overflow-hidden`}>
                        <div className={`flex-1 min-w-0 ${hasRedStyle ? 'bg-red-50 dark:bg-red-900/20' : hasPurpleStyle ? 'bg-purple-50 dark:bg-purple-900/20' : 'bg-gray-50 dark:bg-gray-800'}`}>
                          {identityFieldContent}
                        </div>
                        <div className={`flex-1 min-w-0 ${hasRedStyle ? 'bg-red-50 dark:bg-red-900/20' : hasPurpleStyle ? 'bg-purple-50 dark:bg-purple-900/20' : 'bg-gray-50 dark:bg-gray-800'}`}>
                          {siteFieldContent}
                        </div>
                        <div className={`flex-1 min-w-0 ${hasRedStyle ? 'bg-red-50 dark:bg-red-900/20' : hasPurpleStyle ? 'bg-purple-50 dark:bg-purple-900/20' : 'bg-gray-50 dark:bg-gray-800'}`}>
                          {chargeFieldContent}
                        </div>
                      </div>
                      <div className="flex items-center gap-1">
                        <div className="flex-1">
                          {attendanceSection}
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </Draggable>
              {provided.placeholder}
            </div>
          )}
        </Droppable>
      );
    }

    return (
      <Droppable droppableId={droppableId} isDropDisabled={false}>
        {(provided, snapshot) => (
          <div
            ref={provided.innerRef}
            {...provided.droppableProps}
            className={`flex flex-col gap-1 ${containerBgColor} ${snapshot.isDraggingOver ? 'bg-blue-100 dark:bg-blue-900/50 border-2 border-blue-500 rounded' : ''} p-1 rounded`}
          >
            <Draggable draggableId={draggableId} index={0} isDragDisabled={false}>
              {(provided, snapshot) => (
                <div
                  ref={provided.innerRef}
                  {...provided.draggableProps}
                  {...provided.dragHandleProps}
                  onClick={(e) => e.stopPropagation()}
                  onMouseDown={(e) => e.stopPropagation()}
                  className={`${snapshot.isDragging ? 'opacity-50 rotate-2' : 'cursor-move'} ${snapshot.isDraggingOver ? 'bg-blue-50 dark:bg-blue-900/30' : ''}`}
                  style={{
                    ...provided.draggableProps.style,
                    ...(snapshot.isDragging && {
                      transform: provided.draggableProps.style?.transform,
                    })
                  }}
                >
                  <div className={`flex flex-col gap-1 ${containerBgColor}`}>
        {/* 쓰레기통 아이콘 (삭제 버튼) */}
        {(identityValue || siteValue || chargeWithdrawValue) && (
          <div className="flex justify-end">
            <button
              onClick={(e) => {
                e.stopPropagation();
                handleDeleteSite(record, siteIndex);
              }}
              className="text-red-500 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300 p-0.5 rounded hover:bg-red-50 dark:hover:bg-red-900/20"
              title="사이트 정보 삭제"
            >
              <span className="text-[10px] inline-block">🗑️</span>
            </button>
          </div>
        )}
        {/* 통합 버튼 형태: 유저/사이트/충전금액 */}
        <div className={`inline-flex items-center ${containerBgColor || 'bg-white dark:bg-gray-800'} overflow-hidden`}>
          <div className={`flex-1 min-w-0 ${hasRedStyle ? 'bg-red-50 dark:bg-red-900/20' : hasPurpleStyle ? 'bg-purple-50 dark:bg-purple-900/20' : 'bg-gray-50 dark:bg-gray-800'}`}>
            {identityFieldContent}
          </div>
          <div className={`flex-1 min-w-0 ${hasRedStyle ? 'bg-red-50 dark:bg-red-900/20' : hasPurpleStyle ? 'bg-purple-50 dark:bg-purple-900/20' : 'bg-gray-50 dark:bg-gray-800'}`}>
            {siteFieldContent}
          </div>
          <div className={`flex-1 min-w-0 ${hasRedStyle ? 'bg-red-50 dark:bg-red-900/20' : hasPurpleStyle ? 'bg-purple-50 dark:bg-purple-900/20' : 'bg-gray-50 dark:bg-gray-800'}`}>
            {chargeFieldContent}
          </div>
        </div>
        <div className="flex items-center gap-1.5 justify-center mt-1">
          {attendanceSection}
        </div>
                  </div>
                </div>
              )}
            </Draggable>
            {provided.placeholder}
          </div>
        )}
      </Droppable>
      );
    }

  // 셀 렌더링
  const renderCell = (record, field, displayValue) => {
    const isEditing = editingCell?.recordId === (record.id || 'new') && editingCell?.field === field;
    
    if (isEditing) {
      return (
        <input
          type={field.includes('amount') || field.includes('charge') || field.includes('withdraw') ? 'number' : 'text'}
          value={editingValue}
          onFocus={(e) => {
            // 포커스 시 조합 상태 초기화
            isComposingRef.current = false;
            // 받치기 금액, 토탈금액, 요율 필드에서 0인 경우 빈 문자열로 변경하여 바로 입력할 수 있도록 함
            if ((field === 'drbet_amount' || field === 'total_amount' || field === 'rate_amount') && editingValue === '0') {
              setEditingValue('');
              e.target.value = '';
            }
          }}
          onCompositionStart={() => {
            isComposingRef.current = true;
          }}
          onCompositionEnd={(e) => {
            isComposingRef.current = false;
            // 조합 종료 시 값 업데이트
            setEditingValue(e.target.value);
          }}
          onChange={(e) => {
            // 항상 값을 업데이트 (controlled component 유지)
            setEditingValue(e.target.value);
          }}
          onBlur={() => handleCellBlur(record)}
          onKeyDown={(e) => {
            // IME 조합 중일 때는 특정 로직 실행하지 않음
            if (e.nativeEvent.isComposing || isComposingRef.current) {
              return;
            }
            handleKeyPress(e, record);
          }}
          autoFocus
          className="w-full px-2 py-1 border border-blue-500 rounded focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-[#282C34] dark:text-white dark:border-blue-400"
        />
      );
    }

    // 사이트 필드에서 환전 금액이 있으면 빨간색으로 표시
    const isSiteField = field.startsWith('site');
    const hasWithdraw = isSiteField && hasWithdrawAmount(record[field]);
    const hasD = isSiteField && hasSpecialChar(record[field]);

    // 특이사항 필드에서 충전/환전 정보 추출
    const isNotesField = field === 'notes';
    const notesData = isNotesField ? parseNotes(record[field]) : null;
    const hasNotesCharge = notesData && notesData.charge > 0;
    const hasNotesWithdraw = notesData && notesData.withdraw > 0;
    
    // 특이사항에서 색상 처리
    // 포인트 종류(출석, 페이백, 정착, 요율, 지추, 첫충, 매충)가 포함된 경우 → 기본 색상
    // 그 외 "/"로 구분된 part 단위로 색상 처리:
    //   - 숫자+환 패턴 포함 → part 전체 빨간색
    //   - 숫자+충 패턴 포함 → part 전체 초록색
    //   - "못먹" 포함 → part 전체 빨간색
    //   - "먹" 포함 (단, "못먹"이 아닌 경우) → part 전체 파란색
    let notesDisplay = displayValue;
    if (isNotesField && displayValue) {
      notesDisplay = displayValue.split('/').map(part => {
        const trimmed = part.trim();
        
        if (trimmed.startsWith('[수동]')) {
          const manualContent = trimmed.replace(/^\[수동\]/, '').replace(/／/g, '/').trim();
          const escapedManual = manualContent
            ? manualContent.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            : '수동';
          return `<span class="text-gray-900 dark:text-white">${escapedManual}</span>`;
        }
        
        // 포인트 종류가 포함된 경우 기본 색상 유지 (먼저 체크)
        // 정규식을 더 명확하게 수정: 단어 경계를 고려하지 않고 포함 여부만 체크
        const pointTypePattern = /출석|페이백|정착|요율|지추|첫충|매충|입플/;
        const hasPointType = pointTypePattern.test(trimmed);
        
        if (hasPointType) {
          // 포인트 종류가 있으면 색상 처리 안 함 (HTML 이스케이프 처리)
          // 명시적으로 기본 색상 클래스를 추가하여 다른 스타일 상속 방지
          const escaped = trimmed.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
          return `<span class="text-gray-900 dark:text-white">${escaped}</span>`;
        }
        
        // 포인트 종류가 없는 경우에만 색상 처리
        // 숫자+충/환 패턴만 체크 (단순히 "충"이나 "환"이 포함된 것이 아님)
        const hasWithdraw = /(\d+)(환)/.test(trimmed);
        const hasCharge = /(\d+)(충)/.test(trimmed);
        const hasLost = trimmed.includes('못먹');
        const hasWon = trimmed.includes('먹') && !trimmed.includes('못먹');
        
        const escaped = trimmed.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        
        if (hasWithdraw) {
          // 환전이 있으면 part 전체 빨간색
          return `<span class="text-red-600">${escaped}</span>`;
        } else if (hasCharge) {
          // 충전이 있으면 part 전체 초록색
          return `<span class="text-green-600">${escaped}</span>`;
        } else if (hasLost) {
          // 못먹이 있으면 part 전체 빨간색
          return `<span class="text-red-600">${escaped}</span>`;
        } else if (hasWon) {
          // 먹이 있으면 part 전체 파란색
          return `<span class="text-blue-600">${escaped}</span>`;
        }
        
        // 해당 패턴이 없으면 기본 색상 (HTML 이스케이프 처리)
        return `<span class="text-gray-900 dark:text-white">${escaped}</span>`;
      }).join('/');
    }

    // 'ㄷ'이 있으면 배경색을 빨강, 환전이 있으면 글씨만 빨강
    // 재충(중복) 여부를 이 셀의 컨텍스트에서 재계산 (스코프 이슈 방지)
    const isDuplicateHere = (() => {
      try {
        if (!isSiteField) return false;
        const idxStr = field.replace('site', '');
        const idx = parseInt(idxStr, 10);
        if (!idx || Number.isNaN(idx)) return false;
        const idVal = record[`identity${idx}`];
        const siteVal = record[`site_name${idx}`];
        if (!idVal || !siteVal) return false;
        const currentIndex = records.findIndex(r => r.id === record.id);
        return records.slice(0, currentIndex).some(r => (
          r[`identity${idx}`] === idVal && r[`site_name${idx}`] === siteVal
        ));
      } catch {
        return false;
      }
    })();
    // 받치기, 사설, 토탈충전, 토탈금액, 마진, 요율 필드는 bold와 큰 글씨 적용
    const isAmountField = field === 'drbet_amount' || field === 'private_amount' || field === 'total_charge' || field === 'total_amount' || field === 'margin' || field === 'rate_amount';
    const amountFieldSize = isCompactLayout ? 'text-sm' : 'text-base';
    
    let className = 'cursor-pointer hover:bg-blue-50 dark:hover:bg-gray-700 px-2 py-0 flex items-center justify-center dark:text-white';
    if (isAmountField) {
      className = `cursor-pointer hover:bg-blue-50 dark:hover:bg-gray-700 px-2 py-0 flex items-center justify-center dark:text-white font-bold ${amountFieldSize}`;
    } else if (hasD) {
      // 재충 상태라면 색상 변경 없음 (셀 배경색만 변경)
      if (isDuplicateHere) {
        className = 'cursor-pointer px-2 py-0 flex items-center justify-center dark:text-white';
      } else {
        // 환전 대기(ㄷ)일 때도 색상 변경 없음 (셀 배경색만 변경)
        className = 'cursor-pointer px-2 py-0 flex items-center justify-center dark:text-white';
      }
    } else if (hasWithdraw) {
      className = 'cursor-pointer hover:bg-blue-50 dark:hover:bg-gray-700 px-2 py-0 flex items-center justify-center text-red-600 dark:text-red-400 font-bold';
    } else if (hasNotesCharge || hasNotesWithdraw) {
      className = 'cursor-pointer hover:bg-green-50 dark:hover:bg-gray-700 px-2 py-0 flex items-center justify-center text-green-700 dark:text-green-400 font-semibold';
    }

    // 특이사항 인라인 편집 모드
    const recordId = String(record.id ?? record.tmpId ?? 'new');
    const isNotesEditing = isNotesField && editingNotesRecordId === recordId;
    
    if (isNotesEditing) {
      // 레코드의 사이트 목록 추출
      const recordSites = [];
      for (let i = 1; i <= 4; i++) {
        const siteName = record[`site_name${i}`];
        if (siteName && siteName.trim()) {
          const fullSiteName = siteName.trim();
          if (!recordSites.find(s => s.name === fullSiteName)) {
            recordSites.push({ id: i, name: fullSiteName });
          }
        }
      }
      
      const structured = notesEditData[recordId] || { sites: {}, bategis: [], manuals: [] };
      const expanded = expandedSites[recordId] || {};
      
      return (
        <div
          className="border-2 border-blue-500 rounded p-2 bg-white dark:bg-gray-800 min-w-[400px] max-w-[600px]"
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.ctrlKey && !e.altKey) {
              e.preventDefault();
              saveNotesInlineEdit(record);
            }
          }}
        >
          <div className="flex justify-between items-center mb-2">
            <span className="text-xs font-bold text-gray-700 dark:text-white">특이사항 편집</span>
            <div className="flex gap-1">
              <button
                onClick={() => saveNotesInlineEdit(record)}
                className="px-2 py-1 text-xs bg-blue-500 text-white rounded hover:bg-blue-600"
              >
                저장
              </button>
              <button
                onClick={() => {
                  setEditingNotesRecordId(null);
                  setEditingNotesRecordMeta(null);
                  // 편집 데이터 초기화
                  setNotesEditData(prev => {
                    const newData = { ...prev };
                    delete newData[recordId];
                    return newData;
                  });
                }}
                className="px-2 py-1 text-xs bg-gray-500 text-white rounded hover:bg-gray-600"
              >
                취소
              </button>
            </div>
          </div>
          
          <div className="space-y-2 max-h-[300px] overflow-y-auto">
            {/* 사이트별 섹션 */}
            {recordSites.map(site => {
              const siteData = structured.sites[site.name] || { points: [], chips: [] };
              const isExpanded = expanded[site.name] !== false;
              
              return (
                <div key={site.id} className="border border-gray-300 dark:border-gray-600 rounded p-2">
                  <div
                    className="flex justify-between items-center cursor-pointer"
                    onClick={() => {
                      setExpandedSites(prev => ({
                        ...prev,
                        [recordId]: {
                          ...(prev[recordId] || {}),
                          [site.name]: !isExpanded
                        }
                      }));
                    }}
                  >
                    <span className="font-semibold text-sm text-gray-700 dark:text-white">{site.name}</span>
                    <span className="text-xs text-gray-500">{isExpanded ? '▼' : '▶'}</span>
                  </div>
                  
                  {isExpanded && (
                    <div className="mt-2 space-y-2">
                      {/* 포인트 목록 */}
                      <div>
                        <div className="flex justify-between items-center mb-1">
                          <span className="text-xs text-gray-600 dark:text-gray-300">포인트</span>
                          <button
                            onClick={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              e.nativeEvent.stopImmediatePropagation();
                              if (addingItemRef.current) {
                                log('중복 클릭 방지: 포인트 추가');
                                return;
                              }
                              addingItemRef.current = true;
                              setNotesEditData(prev => {
                                const newData = { ...prev };
                                if (!newData[recordId]) newData[recordId] = { sites: {}, bategis: [], manuals: [] };
                                if (!newData[recordId].sites[site.name]) newData[recordId].sites[site.name] = { points: [], chips: [] };
                                
                                // 중복 추가 방지: 이미 처리 중이면 스킵
                                const currentLength = newData[recordId].sites[site.name].points.length;
                                const lastPoint = currentLength > 0 ? newData[recordId].sites[site.name].points[currentLength - 1] : null;
                                
                                // 마지막 항목이 방금 추가된 빈 항목이면 추가하지 않음
                                if (lastPoint && lastPoint.type === '' && lastPoint.amount === '') {
                                  addingItemRef.current = false;
                                  return newData;
                                }
                                
                                newData[recordId].sites[site.name].points.push({ type: '', amount: '' });
                                setTimeout(() => { addingItemRef.current = false; }, 50);
                                return newData;
                              });
                            }}
                            className="text-xs text-blue-500 hover:text-blue-600"
                          >
                            + 추가
                          </button>
                        </div>
                        <div className="space-y-1">
                          {(siteData.points || []).map((point, idx) => (
                            <div key={idx} className="flex gap-1 items-center">
                              <select
                                value={point.type}
                                onChange={(e) => {
                                  setNotesEditData(prev => {
                                    const newData = { ...prev };
                                    newData[recordId].sites[site.name].points[idx].type = e.target.value;
                                    return newData;
                                  });
                                }}
                                className="text-xs border rounded px-1 py-1 dark:bg-gray-700 dark:text-white"
                              >
                                <option value="">없음</option>
                                <option value="출석">출석</option>
                                <option value="페이백">페이백</option>
                                <option value="정착">정착</option>
                                <option value="요율">요율</option>
                                <option value="지추">지추</option>
                                <option value="첫충">첫충</option>
                                <option value="매충">매충</option>
                                <option value="입플">입플</option>
                              </select>
                              <input
                                type="number"
                                step="0.1"
                                value={point.amount === '' ? '' : point.amount}
                                onChange={(e) => {
                                  setNotesEditData(prev => {
                                    const newData = { ...prev };
                                    const val = e.target.value;
                                    newData[recordId].sites[site.name].points[idx].amount = val === '' ? '' : Number(val);
                                    return newData;
                                  });
                                }}
                                className="flex-1 text-xs border rounded px-1 py-1 dark:bg-gray-700 dark:text-white"
                                placeholder="금액"
                              />
                              <button
                                onClick={() => {
                                  setNotesEditData(prev => {
                                    const newData = { ...prev };
                                    newData[recordId].sites[site.name].points.splice(idx, 1);
                                    return newData;
                                  });
                                }}
                                className="text-xs text-red-500 hover:text-red-600 px-1"
                              >
                                ✕
                              </button>
                            </div>
                          ))}
                        </div>
                      </div>
                      
                      {/* 칩실수 목록 */}
                      <div>
                        <div className="flex justify-between items-center mb-1">
                          <span className="text-xs text-gray-600 dark:text-gray-300">칩실수</span>
                          <button
                            onClick={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              e.nativeEvent.stopImmediatePropagation();
                              if (addingItemRef.current) {
                                log('중복 클릭 방지: 칩실수 추가');
                                return;
                              }
                              addingItemRef.current = true;
                              setNotesEditData(prev => {
                                const newData = { ...prev };
                                if (!newData[recordId]) newData[recordId] = { sites: {}, bategis: [], manuals: [] };
                                if (!newData[recordId].sites[site.name]) newData[recordId].sites[site.name] = { points: [], chips: [] };
                                
                                // 중복 추가 방지: 이미 처리 중이면 스킵
                                const currentLength = newData[recordId].sites[site.name].chips.length;
                                const lastChip = currentLength > 0 ? newData[recordId].sites[site.name].chips[currentLength - 1] : null;
                                
                                // 마지막 항목이 방금 추가된 빈 항목이면 추가하지 않음
                                if (lastChip && lastChip.type === 'chip' && lastChip.amount === '' && lastChip.loss === 'won') {
                                  addingItemRef.current = false;
                                  return newData;
                                }
                                
                                newData[recordId].sites[site.name].chips.push({ type: 'chip', amount: '', loss: 'won' });
                                setTimeout(() => { addingItemRef.current = false; }, 50);
                                return newData;
                              });
                            }}
                            className="text-xs text-blue-500 hover:text-blue-600"
                          >
                            + 추가
                          </button>
                        </div>
                        <div className="space-y-1">
                          {(siteData.chips || []).map((chip, idx) => (
                            <div key={idx} className="flex gap-1 items-center">
                              <select
                                value={chip.type}
                                onChange={(e) => {
                                  setNotesEditData(prev => {
                                    const newData = { ...prev };
                                    newData[recordId].sites[site.name].chips[idx].type = e.target.value;
                                    return newData;
                                  });
                                }}
                                className="text-xs border rounded px-1 py-1 dark:bg-gray-700 dark:text-white"
                              >
                                <option value="chip">칩실수</option>
                                <option value="bager">배거</option>
                                <option value="chipting">칩팅</option>
                              </select>
                              <input
                                type="number"
                                step="0.1"
                                value={chip.amount === '' ? '' : chip.amount}
                                onChange={(e) => {
                                  setNotesEditData(prev => {
                                    const newData = { ...prev };
                                    const val = e.target.value;
                                    newData[recordId].sites[site.name].chips[idx].amount = val === '' ? '' : Number(val);
                                    return newData;
                                  });
                                }}
                                className="flex-1 text-xs border rounded px-1 py-1 dark:bg-gray-700 dark:text-white"
                                placeholder="금액"
                              />
                              <select
                                value={chip.loss}
                                onChange={(e) => {
                                  setNotesEditData(prev => {
                                    const newData = { ...prev };
                                    newData[recordId].sites[site.name].chips[idx].loss = e.target.value;
                                    return newData;
                                  });
                                }}
                                className="text-xs border rounded px-1 py-1 dark:bg-gray-700 dark:text-white"
                              >
                                <option value="won">먹</option>
                                <option value="lost">못먹</option>
                              </select>
                              <button
                                onClick={() => {
                                  setNotesEditData(prev => {
                                    const newData = { ...prev };
                                    newData[recordId].sites[site.name].chips.splice(idx, 1);
                                    return newData;
                                  });
                                }}
                                className="text-xs text-red-500 hover:text-red-600 px-1"
                              >
                                ✕
                              </button>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
            
            {/* 바때기 섹션 */}
            <div className="border border-gray-300 dark:border-gray-600 rounded p-2">
              <div className="flex justify-between items-center mb-1">
                <span className="text-xs font-semibold text-gray-700 dark:text-white">바때기</span>
                <button
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    e.nativeEvent.stopImmediatePropagation();
                    if (addingItemRef.current) {
                      log('중복 클릭 방지: 바때기 추가');
                      return;
                    }
                    addingItemRef.current = true;
                    setNotesEditData(prev => {
                      const newData = { ...prev };
                      if (!newData[recordId]) newData[recordId] = { sites: {}, bategis: [], manuals: [] };
                      
                      // 중복 추가 방지: 이미 처리 중이면 스킵
                      const currentLength = newData[recordId].bategis.length;
                      const lastBategi = currentLength > 0 ? newData[recordId].bategis[currentLength - 1] : null;
                      
                      // 마지막 항목이 방금 추가된 빈 항목이면 추가하지 않음
                      if (lastBategi && lastBategi.amount === '' && lastBategi.type === '충') {
                        addingItemRef.current = false;
                        return newData;
                      }
                      
                      newData[recordId].bategis.push({ amount: '', type: '충' });
                      setTimeout(() => { addingItemRef.current = false; }, 50);
                      return newData;
                    });
                  }}
                  className="text-xs text-blue-500 hover:text-blue-600"
                >
                  + 추가
                </button>
              </div>
              <div className="space-y-1">
                {(structured.bategis || []).map((bategi, idx) => (
                  <div key={idx} className="flex gap-1 items-center">
                    <input
                      type="number"
                      step="0.1"
                      value={bategi.amount === '' ? '' : bategi.amount}
                      onChange={(e) => {
                        setNotesEditData(prev => {
                          const newData = { ...prev };
                          const val = e.target.value;
                          newData[recordId].bategis[idx].amount = val === '' ? '' : Number(val);
                          return newData;
                        });
                      }}
                      className="flex-1 text-xs border rounded px-1 py-1 dark:bg-gray-700 dark:text-white"
                      placeholder="금액"
                    />
                    <select
                      value={bategi.type}
                      onChange={(e) => {
                        setNotesEditData(prev => {
                          const newData = { ...prev };
                          newData[recordId].bategis[idx].type = e.target.value;
                          return newData;
                        });
                      }}
                      className="text-xs border rounded px-1 py-1 dark:bg-gray-700 dark:text-white"
                    >
                      <option value="충">충</option>
                      <option value="환">환</option>
                    </select>
                    <button
                      onClick={() => {
                        setNotesEditData(prev => {
                          const newData = { ...prev };
                          newData[recordId].bategis.splice(idx, 1);
                          return newData;
                        });
                      }}
                      className="text-xs text-red-500 hover:text-red-600 px-1"
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </div>
            </div>
            
            {/* 수동 입력 섹션 */}
            <div className="border border-gray-300 dark:border-gray-600 rounded p-2">
              <div className="flex justify-between items-center mb-1">
                <span className="text-xs font-semibold text-gray-700 dark:text-white">수동 입력</span>
                <button
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    e.nativeEvent.stopImmediatePropagation();
                    if (addingItemRef.current) {
                      log('중복 클릭 방지: 수동 입력 추가');
                      return;
                    }
                    addingItemRef.current = true;
                    setNotesEditData(prev => {
                      const newData = { ...prev };
                      if (!newData[recordId]) newData[recordId] = { sites: {}, bategis: [], manuals: [] };
                      
                      // 중복 추가 방지: 이미 처리 중이면 스킵
                      const currentLength = newData[recordId].manuals.length;
                      const lastManual = currentLength > 0 ? newData[recordId].manuals[currentLength - 1] : null;
                      
                      // 마지막 항목이 방금 추가된 빈 항목이면 추가하지 않음
                      if (lastManual === '') {
                        addingItemRef.current = false;
                        return newData;
                      }
                      
                      newData[recordId].manuals.push('');
                      setTimeout(() => { addingItemRef.current = false; }, 50);
                      return newData;
                    });
                  }}
                  className="text-xs text-blue-500 hover:text-blue-600"
                >
                  + 추가
                </button>
              </div>
              <div className="space-y-1">
                {(structured.manuals || []).map((manual, idx) => (
                  <div key={idx} className="flex gap-1 items-center">
                    <input
                      type="text"
                      value={manual}
                      onChange={(e) => {
                        setNotesEditData(prev => {
                          const newData = { ...prev };
                          newData[recordId].manuals[idx] = e.target.value;
                          return newData;
                        });
                      }}
                      className="flex-1 text-xs border rounded px-1 py-1 dark:bg-gray-700 dark:text-white"
                      placeholder="메모 입력"
                    />
                    <button
                      onClick={() => {
                        setNotesEditData(prev => {
                          const newData = { ...prev };
                          newData[recordId].manuals.splice(idx, 1);
                          return newData;
                        });
                      }}
                      className="text-xs text-red-500 hover:text-red-600 px-1"
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      );
    }
    
    const withdrawTotalMan = field === 'total_amount' ? getWithdrawTotalInManwon(record) : 0;
    const withdrawTotalWon = withdrawTotalMan * 10000;
    const totalWon = field === 'total_amount' ? (record.total_amount || 0) : 0;
    const inputWon = field === 'total_amount' ? Math.max(totalWon - withdrawTotalWon, 0) : 0;
    
    return (
      <div
        onClick={() => {
          if (field === 'notes') {
            startNotesInlineEdit(record);
            return;
          }
          handleCellDoubleClick(record.id || 'new', field, record[field]);
        }}
        className={className}
        title={
          isNotesField && notesData && (hasNotesCharge || hasNotesWithdraw)
            ? `충전: ${formatCurrency(notesData.charge)}, 환전: ${formatCurrency(notesData.withdraw)}`
            : field === 'notes' 
              ? "클릭하여 수정"
              : "클릭하여 수정"
        }
      >
        {isNotesField ? (
          <div className="flex flex-wrap gap-1 items-center">
            {(() => {
              // 구조화된 데이터로 파싱하여 태그 형태로 표시
              const recordSites = [];
              for (let i = 1; i <= 4; i++) {
                const siteName = record[`site_name${i}`];
                if (siteName && siteName.trim()) {
                  const fullSiteName = siteName.trim();
                  if (!recordSites.find(s => s.name === fullSiteName)) {
                    recordSites.push({ id: i, name: fullSiteName });
                  }
                }
              }
              
              const structured = parseNotesToStructured(record.notes || '', recordSites);
              const tags = [];
              
              // 사이트별 포인트 태그
              Object.entries(structured.sites || {}).forEach(([siteName, data]) => {
                (data.points || []).forEach(point => {
                  const tagText = point.type 
                    ? `${siteName}${point.type}${point.amount}`
                    : `${siteName}${point.amount}`;
                  tags.push(
                    <span
                      key={`point-${siteName}-${point.type}-${point.amount}`}
                      className="inline-block px-2 py-0.5 text-xs bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300 rounded"
                    >
                      {tagText}
                    </span>
                  );
                });
                
                // 사이트별 칩실수 태그
                (data.chips || []).forEach(chip => {
                  const chipPrefix = chip.type === 'bager' ? '배거' : chip.type === 'chipting' ? '칩팅' : '칩실수';
                  const lossText = chip.loss === 'lost' ? '못먹' : '먹';
                  // 포인트처럼 사이트이름+종류+금액 순서로 표시
                  const tagText = `${siteName}${chipPrefix}${chip.amount}${lossText}`;
                  const chipColor = chip.loss === 'lost' ? 'bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300' : 'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300';
                  tags.push(
                    <span
                      key={`chip-${siteName}-${chip.type}-${chip.amount}-${chip.loss}`}
                      className={`inline-block px-2 py-0.5 text-xs ${chipColor} rounded`}
                    >
                      {tagText}
                    </span>
                  );
                });
              });
              
              // 바때기 태그 (돈 모양 아이콘 포함)
              (structured.bategis || []).forEach((bategi, idx) => {
                const tagText = `바때기${bategi.amount}${bategi.type}`;
                const bategiColor = bategi.type === '환' ? 'bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300' : 'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300';
                tags.push(
                  <span
                    key={`bategi-${idx}`}
                    className={`inline-flex items-center gap-1 px-2 py-0.5 text-xs ${bategiColor} rounded`}
                  >
                    {tagText}
                    <span className="text-yellow-500">💰</span>
                  </span>
                );
              });
              
              // 수동 입력 태그
              (structured.manuals || []).forEach((manual, idx) => {
                tags.push(
                  <span
                    key={`manual-${idx}`}
                    className="inline-block px-2 py-0.5 text-xs bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300 rounded"
                  >
                    {manual}
                  </span>
                );
              });
              
              // 태그가 있으면 태그로 표시, 없으면 기존 방식으로 표시
              if (tags.length > 0) {
                return tags;
              }
              // 특이사항이 비어있 때도 클릭 가능하도록 최소 높이 유지
              if (!record.notes || !record.notes.trim()) {
                return <span className="text-gray-400 dark:text-gray-500 text-xs">클릭하여 입력</span>;
              }
              return <div dangerouslySetInnerHTML={{ __html: notesDisplay }} />;
            })()}
          </div>
        ) : field === 'total_amount' && withdrawTotalMan > 0 ? (
          <div className="flex flex-col items-center gap-0.5">
            <div className="text-[11px] text-gray-500 dark:text-gray-400">
              {formatCurrency(withdrawTotalWon)} + {formatCurrency(inputWon)} ={' '}
              <span className="font-bold">{formatCurrency(totalWon)}</span>
            </div>
            <div>
              {displayValue}
            </div>
          </div>
        ) : (
          displayValue
        )}
        {/* 돈 모양 아이콘은 바때기 태그에 포함되므로 여기서는 제거 */}
      </div>
    );
  };

  // 사용 가능한 날짜 목록 생성 (useMemo로 성능 개선)
  const availableDates = useMemo(() => {
    return [...new Set(allRecords.map(r => r.record_date))].sort((a, b) => b.localeCompare(a));
  }, [allRecords]);

  // 사이트 개수 계산 (site_name1~site_name4 중 값이 있는 것만 카운트) - useMemo로 최적화
  const countSites = useMemo(() => {
    let siteCount = 0;
    records.forEach(record => {
      if (record.site_name1) siteCount++;
      if (record.site_name2) siteCount++;
      if (record.site_name3) siteCount++;
      if (record.site_name4) siteCount++;
    });
    return siteCount;
  }, [records]);

  // 마진 합계 계산 (화면에 표시되는 마진 + 요율 합계) - useMemo로 최적화
  const calculateTotalMargin = useMemo(() => {
    return records.reduce((sum, record, index) => {
      // 화면에 표시되는 마진과 동일하게 실시간 계산
      const previousRecord = index > 0 ? records[index - 1] : null;
      const calculatedDRBet = index === 0 ? (record.drbet_amount || 0) : calculateDRBet(record, previousRecord);
      const privateAmount = calculatePrivateAmount(record);
      const totalCharge = calculatedDRBet + privateAmount;
      // 토탈금액이 없거나 0이면 마진을 0으로 계산
      const margin = (!record.total_amount || record.total_amount === 0) ? 0 : (record.total_amount - totalCharge);
      const rateAmount = record.rate_amount || 0;
      // 마진 + 요율 합계
      return sum + (isNaN(margin) ? 0 : margin) + (isNaN(rateAmount) ? 0 : rateAmount);
    }, 0);
  }, [records, calculateDRBet, calculatePrivateAmount]);

  const summaryTotals = useMemo(() => {
    let drbetSum = 0;
    let totalAmountSum = 0;
    let rateSum = 0;
    let marginSum = 0;
    let actualSiteCount = 0; // 실제 사이트 수: 재충이 아니고 충전 금액이 있는 사이트만 카운트

    records.forEach((record, index) => {
      const previousRecord = index > 0 ? records[index - 1] : null;
      const drbet = calculateDRBet(record, previousRecord) || 0;
      const totalCharge = calculateTotalCharge(record, drbet);
      const margin = calculateMargin(record, totalCharge) || 0;

      drbetSum += drbet;
      totalAmountSum += record.total_amount || 0;
      rateSum += record.rate_amount || 0;
      marginSum += margin;
      
      // 실제 사이트 수 계산: 각 사이트(1~4)에서 재충이 아니고 충전 금액이 있는 경우만 카운트
      for (let siteIndex = 1; siteIndex <= 4; siteIndex++) {
        const siteName = record[`site_name${siteIndex}`];
        const chargeWithdraw = record[`charge_withdraw${siteIndex}`];
        
        // 사이트명이 없으면 건너뛰기
        if (!siteName) continue;
        
        // 충전 금액 파싱 (숫자만 추출)
        const chargeValue = parseFloat(String(chargeWithdraw || '').replace(/[^0-9.-]/g, '')) || 0;
        
        // 충전 금액이 0 이하면 건너뛰기
        if (chargeValue <= 0) continue;
        
        // 재충인지 확인
        const isRecharge = isRechargeRecord(record, siteIndex, records);
        
        // 재충이 아니면 카운트
        if (!isRecharge) {
          actualSiteCount++;
        }
      }
    });

    return {
      drbetSum,
      totalAmountSum,
      rateSum,
      marginSum,
      recordCount: records.length,
      siteCount: countSites,
      actualCount: actualSiteCount
    };
  }, [records, countSites, calculateDRBet, calculateTotalCharge, calculateMargin, isRechargeRecord]);
  const tableHeaderBaseClass = isCompactLayout ? 'px-2 py-1 text-[11px] border-b border-r border-gray-200 dark:border-gray-700' : 'px-4 py-2 text-xs border-b border-r border-gray-200 dark:border-gray-700';
  const tableCellBaseClass = isCompactLayout ? 'px-2 text-[11px] font-semibold border-b border-r border-gray-200 dark:border-gray-700' : 'px-4 text-sm font-semibold border-b border-r border-gray-200 dark:border-gray-700';


  // 달력 이벤트 관련 함수들
  const formatCalendarDate = (date) => {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  };

  const loadCalendarEvents = async () => {
    try {
      const response = await axiosInstance.get('/calendar');
      if (response.data?.success) {
        // 서버의 event_date를 클라이언트의 date로 변환
        const events = (response.data.data || []).map(event => ({
          ...event,
          date: event.event_date
        }));
        setCalendarEvents(events);
      }
    } catch (error) {
      console.error('달력 이벤트 로드 실패:', error);
    }
  };

  const saveCalendarEvent = async (eventData) => {
    try {
      let response;
      if (editingEvent) {
        response = await axiosInstance.put(`/calendar/${editingEvent.id}`, {
          event_date: eventData.date,
          title: eventData.title,
          description: eventData.description,
          type: eventData.type
        });
      } else {
        response = await axiosInstance.post('/calendar', {
          event_date: eventData.date,
          title: eventData.title,
          description: eventData.description,
          type: eventData.type
        });
      }

      if (response.data?.success) {
        await loadCalendarEvents();
        toast.success('이벤트가 저장되었습니다');
        setShowEventModal(false);
        setEditingEvent(null);
        setEventFormData({ title: '', description: '', type: 'normal', date: '' });
      } else {
        throw new Error(response.data?.error || '이벤트 저장 실패');
      }
    } catch (error) {
      console.error('이벤트 저장 실패:', error);
      toast.error(error.response?.data?.error || '이벤트 저장에 실패했습니다');
    }
  };

  const deleteCalendarEvent = async (eventId) => {
    try {
      const response = await axiosInstance.delete(`/calendar/${eventId}`);
      
      if (response.data?.success) {
        await loadCalendarEvents();
        toast.success('이벤트가 삭제되었습니다');
        setShowEventModal(false);
        setEditingEvent(null);
      } else {
        throw new Error(response.data?.error || '이벤트 삭제 실패');
      }
    } catch (error) {
      console.error('이벤트 삭제 실패:', error);
      toast.error(error.response?.data?.error || '이벤트 삭제에 실패했습니다');
    }
  };

  const openEventModal = (date = null, event = null) => {
    if (event) {
      setEditingEvent(event);
      setEventFormData({
        title: event.title || '',
        description: event.description || '',
        type: event.type || 'normal',
        date: event.date || event.event_date || ''
      });
    } else {
      setEditingEvent(null);
      setEventFormData({
        title: '',
        description: '',
        type: 'normal',
        date: date || selectedDate
      });
    }
    setShowEventModal(true);
  };

  const closeEventModal = () => {
    setShowEventModal(false);
    setEditingEvent(null);
    setEventFormData({ title: '', description: '', type: 'normal', date: '' });
  };

  const handleEventSubmit = (e) => {
    e.preventDefault();
    if (!eventFormData.title.trim()) {
      toast.error('제목을 입력해주세요');
      return;
    }
    saveCalendarEvent(eventFormData);
  };

  // 달력 렌더링 함수
  const renderCalendar = () => {
    const year = calendarMonth.getFullYear();
    const month = calendarMonth.getMonth();
    const firstDay = new Date(year, month, 1);
    const firstDayOfWeek = firstDay.getDay();
    const startDay = 1 - firstDayOfWeek;
    
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    const days = [];
    for (let i = 0; i < 42; i++) {
      const date = new Date(year, month, startDay + i);
      const dateStr = formatCalendarDate(date);
      const dayEvents = calendarEvents.filter(e => e.date === dateStr);
      const isToday = date.getTime() === today.getTime();
      const isCurrentMonth = date.getMonth() === month;
      const isSelected = selectedDate === dateStr;
      
      days.push({
        date,
        dateStr,
        dayEvents,
        isToday,
        isCurrentMonth,
        isSelected
      });
    }
    
    return days;
  };

  useEffect(() => {
    loadCalendarEvents();
  }, []);

  // selectedDate가 변경될 때 selectedCalendarDate도 업데이트
  useEffect(() => {
    if (selectedDate) {
      setSelectedCalendarDate(selectedDate);
    }
  }, [selectedDate]);

  // 미래 날짜 체크 (오늘 이후)
  const checkIfFutureDate = () => {
    const kstNow = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Seoul' }));
    kstNow.setHours(0, 0, 0, 0);
    
    const selectedDateObj = new Date(selectedDate);
    selectedDateObj.setHours(0, 0, 0, 0);
    
    return selectedDateObj.getTime() > kstNow.getTime();
  };
  
  // 미래 날짜 체크 (오늘 이후 날짜는 이벤트 추가만 가능)
  const isFutureDate = checkIfFutureDate();

  return (
    <DragDropContext onDragEnd={handleDragEnd}>
      <div className="p-0 w-full">
        <div className="mb-4">
        <div className="flex justify-between items-center mb-4">
          <div>
            <h1 className="text-4xl font-extrabold bg-gradient-to-r from-gray-900 to-gray-700 dark:from-white dark:to-gray-300 bg-clip-text text-transparent">📊 메인</h1>
            <p className="text-gray-700 dark:text-gray-200 mt-2 font-medium">메인 데이터 관리</p>
            <p className="text-sm text-blue-700 dark:text-blue-300 mt-1 font-medium">💡 셀을 클릭하여 수정하세요 (형식: "10 20" = 충전10만, 환전20만)</p>
          </div>
          <div className="flex gap-3">
            <button
              onClick={loadYesterdayData}
              className="px-6 py-3 bg-gradient-to-r from-green-600 to-green-500 text-white rounded-xl hover:from-green-700 hover:to-green-600 font-bold shadow-lg hover:shadow-xl transition-all duration-200 transform hover:scale-105"
            >
              📅 어제 불러오기
            </button>
            <button
              onClick={loadAutoYesterdayData}
              className="px-6 py-3 bg-gradient-to-r from-purple-600 to-purple-500 text-white rounded-xl hover:from-purple-700 hover:to-purple-600 font-bold shadow-lg hover:shadow-xl transition-all duration-200 transform hover:scale-105"
            >
              🤖 자동어제불러오기
            </button>
            <button
              onClick={() => addNewRow()}
              className="px-6 py-3 bg-gradient-to-r from-blue-600 to-blue-500 text-white rounded-xl hover:from-blue-700 hover:to-blue-600 font-bold shadow-lg hover:shadow-xl transition-all duration-200 transform hover:scale-105"
            >
              ➕ 행 추가
            </button>
            <button
              onClick={deleteAllRecords}
              className="px-6 py-3 bg-gradient-to-r from-red-600 to-red-500 text-white rounded-xl hover:from-red-700 hover:to-red-600 font-bold shadow-lg hover:shadow-xl transition-all duration-200 transform hover:scale-105"
            >
              🗑️ 모든 행 삭제
            </button>
          </div>
        </div>

        {/* 달력 이벤트 */}
        <div className="mt-4 bg-gradient-to-br from-white to-gray-50 dark:from-gray-800 dark:to-gray-900 rounded-xl shadow-lg dark:shadow-2xl border border-gray-100 dark:border-gray-700 p-5">
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-2xl font-bold bg-gradient-to-r from-gray-800 to-gray-600 dark:from-white dark:to-gray-300 bg-clip-text text-transparent">📅 달력 이벤트</h2>
            <div className="flex gap-2">
              <button
                onClick={() => {
                  const newMonth = new Date(calendarMonth);
                  newMonth.setMonth(newMonth.getMonth() - 1);
                  setCalendarMonth(newMonth);
                }}
                className="px-3 py-1.5 bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-600 text-sm font-medium transition-all duration-200 shadow-sm hover:shadow"
              >
                ◀ 이전
              </button>
              <span className="px-4 py-1.5 text-gray-800 dark:text-gray-100 font-bold text-sm">
                {calendarMonth.getFullYear()}년 {calendarMonth.getMonth() + 1}월
              </span>
              <button
                onClick={() => {
                  const newMonth = new Date(calendarMonth);
                  newMonth.setMonth(newMonth.getMonth() + 1);
                  setCalendarMonth(newMonth);
                }}
                className="px-3 py-1.5 bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-600 text-sm font-medium transition-all duration-200 shadow-sm hover:shadow"
              >
                다음 ▶
              </button>
              <button
                onClick={() => setCalendarMonth(new Date())}
                className="px-3 py-1.5 bg-gradient-to-r from-blue-500 to-blue-600 text-white rounded-lg hover:from-blue-600 hover:to-blue-700 text-sm font-medium transition-all duration-200 shadow-sm hover:shadow"
              >
                오늘
              </button>
            </div>
          </div>
          
          <div className="grid grid-cols-7 gap-2 mb-2">
            {['일', '월', '화', '수', '목', '금', '토'].map(day => (
              <div key={day} className="text-center font-semibold text-gray-700 dark:text-gray-300 text-sm py-2">
                {day}
              </div>
            ))}
          </div>
          
          <div className="grid grid-cols-7 gap-2">
            {renderCalendar().map((day, idx) => {
              const { date, dateStr, dayEvents, isToday, isCurrentMonth, isSelected } = day;
              
              return (
                <div
                  key={idx}
                  onClick={() => {
                    setSelectedDate(dateStr);
                    localStorage.setItem('drbet_selected_date', dateStr);
                    setSelectedCalendarDate(dateStr);
                  }}
                  className={`
                    min-h-[80px] border-2 rounded-lg p-2 cursor-pointer transition-all
                    ${!isCurrentMonth ? 'border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 text-gray-400' : 'border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800'}
                    ${isToday ? 'border-blue-500 dark:border-blue-400 bg-blue-50 dark:bg-blue-900/20' : ''}
                    ${isSelected ? 'border-green-500 dark:border-green-400 bg-green-50 dark:bg-green-900/20' : ''}
                    hover:border-purple-400 dark:hover:border-purple-500
                  `}
                >
                  <div className="text-sm font-semibold mb-1">{date.getDate()}</div>
                  <div className="flex flex-wrap gap-1">
                    {dayEvents.slice(0, 3).map(event => (
                      <div
                        key={event.id}
                        onClick={(e) => {
                          e.stopPropagation();
                          openEventModal(null, event);
                        }}
                        className={`
                          w-1.5 h-1.5 rounded-full
                          ${event.type === 'important' ? 'bg-red-500' : ''}
                          ${event.type === 'holiday' ? 'bg-green-500' : ''}
                          ${event.type === 'event' ? 'bg-yellow-500' : ''}
                          ${event.type === 'normal' ? 'bg-purple-500' : ''}
                        `}
                        title={event.title}
                      />
                    ))}
                  </div>
                  {dayEvents.length > 3 && (
                    <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                      +{dayEvents.length - 3}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          
          {/* 선택된 날짜의 이벤트 목록 */}
          {selectedCalendarDate && (
            <div className="mt-4 p-4 bg-gray-50 dark:bg-gray-900 rounded-lg">
              <div className="flex justify-between items-center mb-3">
                <h3 className="font-semibold text-gray-900 dark:text-white">
                  {new Date(selectedCalendarDate + 'T00:00:00').getFullYear()}년{' '}
                  {new Date(selectedCalendarDate + 'T00:00:00').getMonth() + 1}월{' '}
                  {new Date(selectedCalendarDate + 'T00:00:00').getDate()}일
                </h3>
                <button
                  onClick={() => openEventModal(selectedCalendarDate)}
                  className="px-3 py-1 bg-purple-500 text-white rounded hover:bg-purple-600 text-sm"
                >
                  + 이벤트 추가
                </button>
              </div>
              <div className="flex flex-wrap gap-2">
                {calendarEvents.filter(e => e.date === selectedCalendarDate).length === 0 ? (
                  <p className="text-gray-500 dark:text-gray-400 text-sm text-center py-4 w-full">이벤트가 없습니다</p>
                ) : (
                  calendarEvents.filter(e => e.date === selectedCalendarDate).map(event => (
                    <div
                      key={event.id}
                      className={`
                        p-3 rounded-lg border-t-4 cursor-pointer hover:bg-white dark:hover:bg-gray-800 flex-shrink-0
                        ${event.type === 'important' ? 'border-red-500 bg-red-50 dark:bg-red-900/20' : ''}
                        ${event.type === 'holiday' ? 'border-green-500 bg-green-50 dark:bg-green-900/20' : ''}
                        ${event.type === 'event' ? 'border-yellow-500 bg-yellow-50 dark:bg-yellow-900/20' : ''}
                        ${event.type === 'normal' ? 'border-purple-500 bg-purple-50 dark:bg-purple-900/20' : ''}
                      `}
                      onClick={() => openEventModal(null, event)}
                    >
                      <div className="font-semibold text-gray-900 dark:text-white">{event.title}</div>
                      {event.description && (
                        <div className="text-sm text-gray-600 dark:text-gray-400 mt-1">{event.description}</div>
                      )}
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          if (window.confirm('이벤트를 삭제하시겠습니까?')) {
                            deleteCalendarEvent(event.id);
                          }
                        }}
                        className="mt-2 px-2 py-1 bg-red-500 text-white rounded text-xs hover:bg-red-600"
                      >
                        삭제
                      </button>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}
        </div>

        {/* 이벤트 추가/수정 모달 */}
        {showEventModal && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
            <div className="bg-white dark:bg-gray-800 rounded-lg p-6 w-full max-w-md">
              <div className="flex justify-between items-center mb-4">
                <h2 className="text-xl font-bold text-gray-900 dark:text-white">
                  {editingEvent ? '이벤트 수정' : '이벤트 추가'}
                </h2>
                <button
                  onClick={closeEventModal}
                  className="text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
                >
                  ×
                </button>
              </div>
              
              <form onSubmit={handleEventSubmit}>
                <div className="mb-4">
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    제목 *
                  </label>
                  <input
                    type="text"
                    value={eventFormData.title}
                    onChange={(e) => setEventFormData({ ...eventFormData, title: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-md focus:outline-none focus:ring-2 focus:ring-purple-500"
                    required
                  />
                </div>
                
                <div className="mb-4">
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    설명
                  </label>
                  <textarea
                    value={eventFormData.description}
                    onChange={(e) => setEventFormData({ ...eventFormData, description: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-md focus:outline-none focus:ring-2 focus:ring-purple-500"
                    rows={3}
                  />
                </div>
                
                <div className="mb-4">
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    타입
                  </label>
                  <select
                    value={eventFormData.type}
                    onChange={(e) => setEventFormData({ ...eventFormData, type: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-md focus:outline-none focus:ring-2 focus:ring-purple-500"
                  >
                    <option value="normal">일반</option>
                    <option value="important">중요</option>
                    <option value="holiday">휴일</option>
                    <option value="event">이벤트</option>
                  </select>
                </div>
                
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={closeEventModal}
                    className="flex-1 px-4 py-2 bg-gray-200 dark:bg-gray-700 dark:text-white rounded hover:bg-gray-300 dark:hover:bg-gray-600"
                  >
                    취소
                  </button>
                  <button
                    type="submit"
                    className="flex-1 px-4 py-2 bg-purple-500 text-white rounded hover:bg-purple-600"
                  >
                    저장
                  </button>
                  {editingEvent && (
                    <button
                      type="button"
                      onClick={() => {
                        if (window.confirm('이벤트를 삭제하시겠습니까?')) {
                          deleteCalendarEvent(editingEvent.id);
                        }
                      }}
                      className="px-4 py-2 bg-red-500 text-white rounded hover:bg-red-600"
                    >
                      삭제
                    </button>
                  )}
                </div>
              </form>
            </div>
          </div>
        )}

        {!isFutureDate && isCompactLayout && (
          <div className="mt-2 bg-gradient-to-br from-white to-gray-50 dark:from-gray-800 dark:to-gray-900 rounded-xl shadow-lg dark:shadow-2xl border border-gray-100 dark:border-gray-700 p-4">
            <div className="grid grid-cols-2 md:grid-cols-7 gap-3 text-[11px]">
              <div className="text-center p-2 bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700">
                <div className="text-gray-600 dark:text-gray-400 font-medium mb-1">총 사이트</div>
                <div className="font-bold text-green-700 dark:text-green-300 text-sm">{summaryTotals.siteCount.toLocaleString()}</div>
              </div>
              <div className="text-center p-2 bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700">
                <div className="text-gray-600 dark:text-gray-400 font-medium mb-1">실제 수</div>
                <div className="font-bold text-teal-700 dark:text-teal-300 text-sm">{summaryTotals.actualCount.toLocaleString()}</div>
              </div>
              <div className="text-center p-2 bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700">
                <div className="text-gray-600 dark:text-gray-400 font-medium mb-1">총 레코드</div>
                <div className="font-bold text-blue-700 dark:text-blue-300 text-sm">{summaryTotals.recordCount.toLocaleString()}</div>
              </div>
              <div className="text-center p-2 bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700">
                <div className="text-gray-600 dark:text-gray-400 font-medium mb-1">받치기 합계</div>
                <div className="font-bold text-purple-700 dark:text-purple-300 text-sm">{formatCurrency(summaryTotals.drbetSum)}원</div>
              </div>
              <div className="text-center p-2 bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700">
                <div className="text-gray-600 dark:text-gray-400 font-medium mb-1">토탈금액 합계</div>
                <div className="font-bold text-orange-700 dark:text-orange-300 text-sm">{formatCurrency(summaryTotals.totalAmountSum)}원</div>
              </div>
              <div className="text-center p-2 bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700">
                <div className="text-gray-600 dark:text-gray-400 font-medium mb-1">요율 합계</div>
                <div className="font-bold text-indigo-700 dark:text-indigo-300 text-sm">{formatCurrency(summaryTotals.rateSum)}원</div>
              </div>
              <div className="text-center p-2 bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700">
                <div className="text-gray-600 dark:text-gray-400 font-medium mb-1">마진 합계</div>
                <div className="font-bold text-red-700 dark:text-red-300 text-sm">{formatCurrency(summaryTotals.marginSum)}원</div>
              </div>
            </div>
          </div>
        )}

        {/* 정착 금액 배너 - 페이백 섹션과 동일한 UI */}
        {!isFutureDate && settlementBanners.length > 0 && (() => {
          // ✅ 사이트+유저별로 그룹화 (하나의 카드만 표시)
          const groupedBanners = {};
          settlementBanners.forEach(b => {
            const key = `${b.identity}||${b.site}`;
            if (!groupedBanners[key]) {
              groupedBanners[key] = b;
            }
          });
          const uniqueBanners = Object.values(groupedBanners);
          
          return (
            <div className="mt-4 bg-gradient-to-r from-green-50 via-emerald-50 to-blue-50 dark:from-gray-800 dark:via-gray-800 dark:to-gray-900 p-5 rounded-xl shadow-xl border-2 border-green-200 dark:border-gray-700">
              <h3 className="text-xl font-bold bg-gradient-to-r from-gray-800 to-gray-600 dark:from-white dark:to-gray-300 bg-clip-text text-transparent mb-3 flex items-center">
                <span className="text-2xl mr-2">🏆</span>
                정착 달성 알림
                <span className="ml-2 text-sm font-medium text-gray-700 dark:text-gray-300">(기간 {uniqueBanners[0]?.days || 0}일 적용)</span>
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {uniqueBanners.map((b, idx) => (
                <div key={`${b.identity}-${b.site}-${idx}`} className="bg-white dark:bg-gray-800 rounded-xl p-4 shadow-md hover:shadow-lg border border-gray-200 dark:border-gray-700 transition-all duration-200">
                  <div className="font-bold text-purple-800 dark:text-purple-300 mb-2 text-sm flex items-center justify-between">
                    <span>{b.identity} - {b.site}</span>
                    {b.totalCharge >= b.totalTarget && (
                      <span className="text-xs px-2 py-0.5 rounded bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300">
                        ✅ 달성
                      </span>
                    )}
                  </div>
                  <div className="space-y-1 text-xs">
                    <div className="flex justify-between">
                      <span className="text-gray-600 dark:text-gray-300">시작일</span>
                      <span className="font-semibold text-gray-800 dark:text-white">{b.startDate} (기간 {b.days}일)</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-600 dark:text-gray-300">
                        {b.totalCharge >= b.totalTarget ? '달성 금액' : '현재 / 목표'}
                      </span>
                      <span className={`font-semibold ${b.totalCharge >= b.totalTarget ? 'text-green-700 dark:text-green-300' : 'text-gray-800 dark:text-white'}`}>
                        {b.totalCharge}만 / {b.totalTarget}만
                      </span>
                    </div>
                    {b.totalCharge < b.totalTarget && (
                      <div className="flex justify-between text-orange-700 dark:text-orange-300">
                        <span>부족 금액</span>
                        <span className="font-semibold">{(b.totalTarget - b.totalCharge).toFixed(1)}만</span>
                      </div>
                    )}
                    <div className="flex justify-between">
                      <span className="text-gray-600 dark:text-gray-300">포인트</span>
                      <span className="font-semibold text-purple-700 dark:text-purple-300">{b.pointDisplay}</span>
                    </div>
                  </div>
                  <div className="mt-3 pt-3 border-t border-gray-200 dark:border-gray-700">
                    <button
                      className="w-full px-3 py-2 text-sm bg-gradient-to-r from-purple-600 to-purple-500 dark:from-purple-700 dark:to-purple-600 text-white rounded-lg hover:from-purple-700 hover:to-purple-600 dark:hover:from-purple-600 dark:hover:to-purple-500 font-semibold shadow-sm hover:shadow transition-all duration-200 transform hover:scale-105"
                      onClick={() => markSettlementPaidFromBanner(b.identity, b.site)}
                    >
                      💰 지급 완료
                    </button>
                    <div className="mt-2 text-center text-[10px] text-gray-500 dark:text-gray-400">
                      ⚠️ 지급 완료 시 모든 조건 영구 숨김
                    </div>
                  </div>
                </div>
              ))}
              </div>
            </div>
          );
        })()}

        {/* 페이백 예상 금액 - 테이블 형태 */}
        {!isFutureDate && paybackData.length > 0 && (() => {
          // 총 합계 계산
          const totalPayback = paybackData.reduce((sum, data) => {
            const amounts = Object.values(data.paybackAmounts || {});
            return sum + amounts.reduce((s, a) => s + (a * 10000), 0);
          }, 0);
          
          // 당일/주간 페이백 분리
          const sameDayPaybacks = paybackData.filter(d => 
            Object.keys(d.paybackAmounts || {}).some(k => k.startsWith('당일'))
          );
          const weeklyPaybacks = paybackData.filter(d => 
            Object.keys(d.paybackAmounts || {}).some(k => !k.startsWith('당일'))
          );
          
          return (
          <div className="mt-4 bg-gradient-to-r from-green-50 via-emerald-50 to-blue-50 dark:from-gray-800 dark:via-gray-800 dark:to-gray-900 p-5 rounded-xl shadow-xl border-2 border-green-200 dark:border-gray-700">
            {/* 헤더 */}
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-xl font-bold bg-gradient-to-r from-gray-800 to-gray-600 dark:from-white dark:to-gray-300 bg-clip-text text-transparent flex items-center">
                <span className="text-2xl mr-2">💰</span>
                오늘 지급할 페이백
                <span className="ml-2 text-sm font-medium text-gray-700 dark:text-gray-300">
                  ({(() => {
                    const weekRange = getWeekRange(selectedDate);
                    return `${weekRange.start} ~ ${weekRange.end}`;
                  })()})
                </span>
              </h3>
              <div className="flex items-center gap-4">
                <span className="text-sm text-gray-600 dark:text-gray-400">
                  총 <span className="font-bold text-lg text-green-600 dark:text-green-400">{paybackData.length}</span>건
                </span>
                <span className="text-lg font-bold text-green-700 dark:text-green-300 bg-green-100 dark:bg-green-900/50 px-4 py-1 rounded-full">
                  합계: {totalPayback.toLocaleString()}원
                </span>
              </div>
            </div>
            
            {/* 당일 페이백 테이블 */}
            {sameDayPaybacks.length > 0 && (
              <div className="mb-4">
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-orange-600 dark:text-orange-400 font-bold">🔥 당일 페이백</span>
                  <span className="text-xs text-gray-500 dark:text-gray-400">
                    ({sameDayPaybacks.length}건 / {sameDayPaybacks.reduce((sum, d) => {
                      const sameDayAmounts = Object.entries(d.paybackAmounts || {})
                        .filter(([k]) => k.startsWith('당일'))
                        .reduce((s, [, v]) => s + (v * 10000), 0);
                      return sum + sameDayAmounts;
                    }, 0).toLocaleString()}원)
                  </span>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm border-collapse">
                    <thead>
                      <tr className="bg-orange-100 dark:bg-orange-900/30">
                        <th className="px-3 py-2 text-left font-bold text-orange-800 dark:text-orange-300 border-b border-orange-200 dark:border-orange-800">유저</th>
                        <th className="px-3 py-2 text-left font-bold text-orange-800 dark:text-orange-300 border-b border-orange-200 dark:border-orange-800">사이트</th>
                        <th className="px-3 py-2 text-center font-bold text-orange-800 dark:text-orange-300 border-b border-orange-200 dark:border-orange-800">타입</th>
                        <th className="px-3 py-2 text-right font-bold text-orange-800 dark:text-orange-300 border-b border-orange-200 dark:border-orange-800">당일충전</th>
                        <th className="px-3 py-2 text-right font-bold text-orange-800 dark:text-orange-300 border-b border-orange-200 dark:border-orange-800">당일환전</th>
                        <th className="px-3 py-2 text-right font-bold text-orange-800 dark:text-orange-300 border-b border-orange-200 dark:border-orange-800">손실금액</th>
                        <th className="px-3 py-2 text-center font-bold text-orange-800 dark:text-orange-300 border-b border-orange-200 dark:border-orange-800">%</th>
                        <th className="px-3 py-2 text-right font-bold text-orange-800 dark:text-orange-300 border-b border-orange-200 dark:border-orange-800">예상금액</th>
                        <th className="px-3 py-2 text-center font-bold text-orange-800 dark:text-orange-300 border-b border-orange-200 dark:border-orange-800">지급</th>
                      </tr>
                    </thead>
                    <tbody>
                      {sameDayPaybacks.map((data, idx) => {
                        const paybackType = data.paybackType || '수동';
                        const sameDayAmount = Object.entries(data.paybackAmounts || {})
                          .filter(([k]) => k.startsWith('당일'))
                          .reduce((s, [, v]) => s + v, 0);
                        const isCleared = data.cleared;
                        
                        return (
                          <tr key={`sameday-${idx}`} className={`border-b border-gray-100 dark:border-gray-700 hover:bg-orange-50 dark:hover:bg-orange-900/20 transition-colors ${isCleared ? 'opacity-50 bg-gray-100 dark:bg-gray-800' : ''}`}>
                            <td className={`px-3 py-2 font-medium text-gray-800 dark:text-gray-200 ${isCleared ? 'line-through' : ''}`}>{data.identityName}</td>
                            <td className={`px-3 py-2 text-gray-700 dark:text-gray-300 ${isCleared ? 'line-through' : ''}`}>{data.siteName}</td>
                            <td className="px-3 py-2 text-center">
                              <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                                paybackType === '수동' 
                                  ? 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900 dark:text-yellow-300' 
                                  : 'bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300'
                              }`}>
                                {paybackType}
                              </span>
                            </td>
                            <td className={`px-3 py-2 text-right font-medium ${isCleared ? 'line-through text-gray-400' : 'text-gray-700 dark:text-gray-300'}`}>
                              {((data.todayDeposit || 0) * 10000).toLocaleString()}원
                            </td>
                            <td className={`px-3 py-2 text-right font-medium ${isCleared ? 'line-through text-gray-400' : 'text-gray-700 dark:text-gray-300'}`}>
                              {((data.todayWithdraw || 0) * 10000).toLocaleString()}원
                            </td>
                            <td className={`px-3 py-2 text-right font-bold ${isCleared ? 'line-through text-gray-400' : (data.todayNet || 0) > 0 ? 'text-red-600 dark:text-red-400' : 'text-blue-600 dark:text-blue-400'}`}>
                              {((data.todayNet || 0) * 10000).toLocaleString()}원
                            </td>
                            <td className="px-3 py-2 text-center font-bold text-orange-600 dark:text-orange-400">{data.sameDayPercent}%</td>
                            <td className={`px-3 py-2 text-right font-bold ${isCleared ? 'line-through text-gray-400' : 'text-green-700 dark:text-green-300'}`}>
                              {(sameDayAmount * 10000).toLocaleString()}원
                            </td>
                            <td className="px-3 py-2 text-center">
                              <button
                                onClick={async () => {
                                  try {
                                    const weekRange = getWeekRange(selectedDate);
                                    await axiosInstance.post('/site-notes/payback-clear', {
                                      siteName: data.siteName,
                                      identityName: data.identityName,
                                      weekStartDate: weekRange.start,
                                      cleared: !isCleared
                                    });
                                    // 데이터 새로고침
                                    fetchDailySummary();
                                  } catch (error) {
                                    console.error('페이백 지급 상태 변경 실패:', error);
                                  }
                                }}
                                className={`w-6 h-6 rounded border-2 flex items-center justify-center transition-all ${
                                  isCleared 
                                    ? 'bg-green-500 border-green-500 text-white' 
                                    : 'bg-white dark:bg-gray-700 border-gray-300 dark:border-gray-600 hover:border-green-400'
                                }`}
                                title={isCleared ? '지급 완료 취소' : '지급 완료'}
                              >
                                {isCleared && <span className="text-sm">✓</span>}
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
            
            {/* 주간 페이백 테이블 */}
            {weeklyPaybacks.length > 0 && (
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-green-600 dark:text-green-400 font-bold">📅 주간 페이백</span>
                  <span className="text-xs text-gray-500 dark:text-gray-400">
                    ({weeklyPaybacks.length}건 / {weeklyPaybacks.reduce((sum, d) => {
                      const weeklyAmounts = Object.entries(d.paybackAmounts || {})
                        .filter(([k]) => !k.startsWith('당일'))
                        .reduce((s, [, v]) => s + (v * 10000), 0);
                      return sum + weeklyAmounts;
                    }, 0).toLocaleString()}원)
                  </span>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm border-collapse">
                    <thead>
                      <tr className="bg-green-100 dark:bg-green-900/30">
                        <th className="px-3 py-2 text-left font-bold text-green-800 dark:text-green-300 border-b border-green-200 dark:border-green-800">유저</th>
                        <th className="px-3 py-2 text-left font-bold text-green-800 dark:text-green-300 border-b border-green-200 dark:border-green-800">사이트</th>
                        <th className="px-3 py-2 text-center font-bold text-green-800 dark:text-green-300 border-b border-green-200 dark:border-green-800">타입</th>
                        <th className="px-3 py-2 text-right font-bold text-green-800 dark:text-green-300 border-b border-green-200 dark:border-green-800">주간손실</th>
                        <th className="px-3 py-2 text-center font-bold text-green-800 dark:text-green-300 border-b border-green-200 dark:border-green-800">%</th>
                        <th className="px-3 py-2 text-center font-bold text-green-800 dark:text-green-300 border-b border-green-200 dark:border-green-800">지급요일</th>
                        <th className="px-3 py-2 text-right font-bold text-green-800 dark:text-green-300 border-b border-green-200 dark:border-green-800">예상금액</th>
                        <th className="px-3 py-2 text-center font-bold text-green-800 dark:text-green-300 border-b border-green-200 dark:border-green-800">지급</th>
                      </tr>
                    </thead>
                    <tbody>
                      {weeklyPaybacks.map((data, idx) => {
                        const paybackType = data.paybackType || '수동';
                        const weeklyEntries = Object.entries(data.paybackAmounts || {}).filter(([k]) => !k.startsWith('당일'));
                        const weeklyAmount = weeklyEntries.reduce((s, [, v]) => s + v, 0);
                        const payDays = weeklyEntries.map(([k]) => k).join(', ');
                        const isCleared = data.cleared;
                        
                        return (
                          <tr key={`weekly-${idx}`} className={`border-b border-gray-100 dark:border-gray-700 hover:bg-green-50 dark:hover:bg-green-900/20 transition-colors ${isCleared ? 'opacity-50 bg-gray-100 dark:bg-gray-800' : ''}`}>
                            <td className={`px-3 py-2 font-medium text-gray-800 dark:text-gray-200 ${isCleared ? 'line-through' : ''}`}>{data.identityName}</td>
                            <td className={`px-3 py-2 text-gray-700 dark:text-gray-300 ${isCleared ? 'line-through' : ''}`}>{data.siteName}</td>
                            <td className="px-3 py-2 text-center">
                              <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                                paybackType === '수동' 
                                  ? 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900 dark:text-yellow-300' 
                                  : 'bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300'
                              }`}>
                                {paybackType}
                              </span>
                            </td>
                            <td className={`px-3 py-2 text-right font-medium ${isCleared ? 'line-through text-gray-400' : data.weeklyNet > 0 ? 'text-red-600 dark:text-red-400' : 'text-gray-700 dark:text-gray-300'}`}>
                              {data.weeklyNet > 0 ? `${(data.weeklyNet * 10000).toLocaleString()}원` : '0원'}
                            </td>
                            <td className="px-3 py-2 text-center font-bold text-green-600 dark:text-green-400">{data.percent}%</td>
                            <td className="px-3 py-2 text-center">
                              <span className="text-xs bg-gray-200 dark:bg-gray-700 px-2 py-0.5 rounded font-medium">{payDays}</span>
                            </td>
                            <td className={`px-3 py-2 text-right font-bold ${isCleared ? 'line-through text-gray-400' : 'text-green-700 dark:text-green-300'}`}>
                              {(weeklyAmount * 10000).toLocaleString()}원
                            </td>
                            <td className="px-3 py-2 text-center">
                              <button
                                onClick={async () => {
                                  try {
                                    const weekRange = getWeekRange(selectedDate);
                                    await axiosInstance.post('/site-notes/payback-clear', {
                                      siteName: data.siteName,
                                      identityName: data.identityName,
                                      weekStartDate: weekRange.start,
                                      cleared: !isCleared
                                    });
                                    // 데이터 새로고침
                                    fetchDailySummary();
                                  } catch (error) {
                                    console.error('페이백 지급 상태 변경 실패:', error);
                                  }
                                }}
                                className={`w-6 h-6 rounded border-2 flex items-center justify-center transition-all ${
                                  isCleared 
                                    ? 'bg-green-500 border-green-500 text-white' 
                                    : 'bg-white dark:bg-gray-700 border-gray-300 dark:border-gray-600 hover:border-green-400'
                                }`}
                                title={isCleared ? '지급 완료 취소' : '지급 완료'}
                              >
                                {isCleared && <span className="text-sm">✓</span>}
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
          );
        })()}
      </div>

      {/* 기록 테이블 */}
      {!isFutureDate && (
      <div className={`bg-white dark:bg-[#1a1d24] rounded-xl shadow-xl dark:shadow-2xl overflow-hidden border border-gray-100 dark:border-gray-800 ${isCompactLayout ? 'text-[11px]' : ''}`}>
        <div className={isCompactLayout ? '' : 'overflow-x-auto'}>
          <table className={`${isCompactLayout ? 'text-[11px]' : 'text-xs'} w-full border-collapse border border-gray-200 dark:border-gray-800`} style={{ borderSpacing: 0, borderCollapse: 'collapse' }}>
            <thead className="bg-gradient-to-r from-gray-50 to-gray-100 dark:from-gray-800 dark:to-gray-900 border-b-2 border-gray-200 dark:border-gray-700">
              <tr>
                <th className={`${tableHeaderBaseClass} text-center font-bold text-gray-800 dark:text-gray-100 uppercase tracking-wide`}>받치기</th>
                <th className={`${tableHeaderBaseClass} text-center font-bold text-gray-800 dark:text-gray-100 uppercase tracking-wide`}>사설</th>
                <th className={`${tableHeaderBaseClass} text-center font-bold text-gray-800 dark:text-gray-100 uppercase tracking-wide`}>토탈충전</th>
                <th className={`${tableHeaderBaseClass} text-center font-bold text-gray-800 dark:text-gray-100 uppercase tracking-wide`}>토탈금액</th>
                <th className={`${tableHeaderBaseClass} text-center font-bold text-gray-800 dark:text-gray-100 uppercase tracking-wide`}>마진</th>
                <th className={`${tableHeaderBaseClass} text-center font-bold text-gray-800 dark:text-gray-100 uppercase tracking-wide`}>요율</th>
                <th className={`${tableHeaderBaseClass} text-center font-bold text-gray-800 dark:text-gray-100 uppercase tracking-wide`} style={{ minWidth: '200px' }}>사이트1</th>
                <th className={`${tableHeaderBaseClass} text-center font-bold text-gray-800 dark:text-gray-100 uppercase tracking-wide`} style={{ minWidth: '200px' }}>사이트2</th>
                <th className={`${tableHeaderBaseClass} text-center font-bold text-gray-800 dark:text-gray-100 uppercase tracking-wide`} style={{ minWidth: '200px' }}>사이트3</th>
                <th className={`${tableHeaderBaseClass} text-center font-bold text-gray-800 dark:text-gray-100 uppercase tracking-wide`} style={{ minWidth: '200px' }}>사이트4</th>
                <th className={`${tableHeaderBaseClass} text-center font-bold text-gray-800 dark:text-gray-100 uppercase tracking-wide`}>특이사항</th>
                <th className={`${tableHeaderBaseClass} text-center font-bold text-gray-800 dark:text-gray-100 uppercase tracking-wide`}>추가</th>
                <th className={`${tableHeaderBaseClass} text-center font-bold text-gray-800 dark:text-gray-100 uppercase tracking-wide border-r-0`}>관리</th>
              </tr>
            </thead>
            <Droppable droppableId="drbet-table" type="ROW">
                {(provided) => (
                  <tbody
                    className="bg-white dark:bg-[#1a1d24]"
                    {...provided.droppableProps}
                    ref={provided.innerRef}
                    style={{ borderCollapse: 'collapse' }}
                  >
                    {records.length === 0 ? (
                      <tr>
                        <td colSpan="13" className="px-6 py-8 text-center text-gray-500 dark:text-white">
                          "➕ 행 추가" 버튼을 눌러 새 기록을 추가하세요
                        </td>
                      </tr>
                    ) : (
                      <>
                        {records.map((record, index) => {
                          const previousRecord = index > 0 ? records[index - 1] : null;
                          const calculatedDRBet = calculateDRBet(record, previousRecord);
                          const privateAmount = calculatePrivateAmount(record);
                          const totalCharge = calculateTotalCharge(record, calculatedDRBet);
                          const margin = calculateMargin(record, totalCharge);
                          // _v와 refreshTick을 포함하여 출석일 변경 시 강제 리렌더링
                          const recordKey = record.id ? `record-${record.id}-${record._v || 0}-${refreshTick}` : `tmp-${record.tmpId || index}-${refreshTick}`;
                          const draggableId = record.id ? `record-${record.id}` : `tmp-${record.tmpId || index}`;

                          return (
                            <Draggable
                              key={recordKey}
                              draggableId={draggableId}
                              index={index}
                              type="ROW"
                              isDragDisabled={record.isNew || !record.id}
                            >
                                {(provided, snapshot) => (
                                  <tr
                                    ref={provided.innerRef}
                                    {...provided.draggableProps}
                                    className={`transition-all duration-200 hover:bg-gray-50 dark:hover:bg-gray-800/50 ${record.isNew ? 'bg-blue-50 dark:bg-blue-900/20' : ''} ${
                                      snapshot.isDragging ? 'bg-blue-100 dark:bg-blue-900/30 shadow-xl ring-2 ring-blue-300 dark:ring-blue-600' : ''
                                    }`}
                                    style={{ 
                                      ...provided.draggableProps.style,
                                      margin: 0, 
                                      padding: 0, 
                                      borderSpacing: 0, 
                                      borderBottom: '1px solid rgb(229 231 235)' 
                                    }}
                                  >
                                  {/* DR벳 금액 (첫 행: 수정 가능, 나머지: 자동계산) - 드래그 핸들 */}
                                  <td 
                                    {...provided.dragHandleProps}
                                    className={`${tableCellBaseClass} text-center dark:text-white font-bold ${isCompactLayout ? 'text-sm' : 'text-base'} cursor-move`} 
                                    style={{ paddingTop: 0, paddingBottom: 0, margin: 0 }}
                                    title="드래그하여 순서 변경"
                                  >
                                    {index === 0 ? (
                                      renderCell(record, 'drbet_amount', formatCurrency(record.drbet_amount || 0) + '원')
                                    ) : (
                                      <div className="px-2 py-1 dark:text-white font-bold">
                                        {formatCurrency(calculatedDRBet)}원
                                      </div>
                                    )}
                                  </td>

                      {/* 사설 (자동계산) */}
                      <td className={`${tableCellBaseClass} text-center dark:text-white font-bold ${isCompactLayout ? 'text-sm' : 'text-base'}`}>
                        {formatCurrency(privateAmount)}원
                      </td>

                      {/* 토탈충전 (자동계산) */}
                      <td className={`${tableCellBaseClass} text-center dark:text-white font-bold ${isCompactLayout ? 'text-sm' : 'text-base'}`}>
                        {formatCurrency(totalCharge)}원
                      </td>

                      {/* 토탈금액 */}
                      <td className={`${tableCellBaseClass} text-center dark:text-white font-bold ${isCompactLayout ? 'text-sm' : 'text-base'}`}>
                        {renderCell(record, 'total_amount', formatCurrency(record.total_amount) + '원')}
                      </td>

                      {/* 마진 (자동계산) */}
                      <td className={`${tableCellBaseClass} text-center font-bold ${isCompactLayout ? 'text-sm' : 'text-base'} ${
                        margin === 0 ? 'text-black dark:text-white' : margin > 0 ? 'text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/30' : 'text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/30'
                      }`}>
                        {formatCurrency(margin)}원
                      </td>

                      {/* 요율 */}
                      <td className={`${tableCellBaseClass} text-center dark:text-white font-bold ${isCompactLayout ? 'text-sm' : 'text-base'}`}>
                        {renderCell(record, 'rate_amount', formatCurrency(record.rate_amount) + '원')}
                      </td>

                      {/* 사이트 1-4 (각 셀에 유저/사이트/충환전 input 3개) */}
                      <td className={`${tableCellBaseClass} ${isSiteDuplicate(record, 1) ? 'bg-green-100 dark:bg-green-800/40' : hasSiteD(record, 1) ? 'bg-red-50 dark:bg-red-900/30' : ''} text-center dark:text-white`} style={{ minWidth: '200px' }}>
                        {renderSiteInputs(record, 1, isCompactLayout ? 'compact' : 'default')}
                      </td>
                      <td className={`${tableCellBaseClass} ${isSiteDuplicate(record, 2) ? 'bg-green-100 dark:bg-green-800/40' : hasSiteD(record, 2) ? 'bg-red-50 dark:bg-red-900/30' : ''} text-center dark:text-white`} style={{ minWidth: '200px' }}>
                        {renderSiteInputs(record, 2, isCompactLayout ? 'compact' : 'default')}
                      </td>
                      <td className={`${tableCellBaseClass} ${isSiteDuplicate(record, 3) ? 'bg-green-100 dark:bg-green-800/40' : hasSiteD(record, 3) ? 'bg-red-50 dark:bg-red-900/30' : ''} text-center dark:text-white`} style={{ minWidth: '200px' }}>
                        {renderSiteInputs(record, 3, isCompactLayout ? 'compact' : 'default')}
                      </td>
                      <td className={`${tableCellBaseClass} ${isSiteDuplicate(record, 4) ? 'bg-green-100 dark:bg-green-800/40' : hasSiteD(record, 4) ? 'bg-red-50 dark:bg-red-900/30' : ''} text-center dark:text-white`} style={{ minWidth: '200px' }}>
                        {renderSiteInputs(record, 4, isCompactLayout ? 'compact' : 'default')}
                      </td>

                      {/* 특이사항 */}
                      <td 
                        className={`${tableCellBaseClass} text-center dark:text-white`}
                      >
                        {renderCell(record, 'notes', record.notes)}
                      </td>

                      {/* 추가 / 복사 버튼 */}
                      <td className={`${tableCellBaseClass} text-center text-sm`} style={{ paddingTop: 0, paddingBottom: 0, margin: 0 }}>
                        <div className="flex items-center justify-center gap-2">
                          <button
                            onClick={async () => {
                              await addNewRow(index + 1);
                            }}
                            className="text-blue-600 hover:text-blue-900 dark:text-blue-400 dark:hover:text-blue-300 font-bold text-lg"
                            title="이 행 아래에 새 행 추가"
                          >
                            +
                          </button>
                          <button
                            onClick={async () => {
                              await copyRow(index);
                            }}
                            className="text-gray-600 hover:text-gray-900 dark:text-gray-300 dark:hover:text-gray-100 text-base"
                            title="이 행을 복사해서 아래에 추가"
                          >
                            ⧉
                          </button>
                        </div>
                      </td>

                                  {/* 관리 */}
                                  <td className={`${isCompactLayout ? 'px-2 text-[11px] font-semibold border-b border-r-0 border-gray-300 dark:border-gray-600' : 'px-4 text-sm font-semibold border-b border-r-0 border-gray-300 dark:border-gray-600'} text-center`} style={{ paddingTop: 0, paddingBottom: 0, margin: 0 }}>
                                    {!record.isNew && record.id && (
                                      <button
                                        onClick={() => deleteRecord(record.id)}
                                        className="text-red-600 hover:text-red-900 font-medium"
                                      >
                                        🗑️
                                      </button>
                                    )}
                                  </td>
                                </tr>
                              )}
                            </Draggable>
                          );
                        })}
                        {provided.placeholder}
                      </>
                    )}
                  </tbody>
                )}
              </Droppable>
          </table>
        </div>
        
        {/* 마진 합계 */}
        <div className="p-5 bg-gradient-to-r from-gray-50 to-gray-100 dark:from-gray-800 dark:to-gray-900 border-t-2 border-gray-200 dark:border-gray-700">
          <div className="flex justify-end items-center gap-4">
            <span className="text-lg font-bold text-gray-800 dark:text-gray-100">마진 합계:</span>
            <span className={`text-2xl font-bold px-5 py-3 rounded-xl shadow-md transition-all duration-200 ${
              calculateTotalMargin > 0 ? 'text-blue-700 dark:text-blue-300 bg-gradient-to-r from-blue-50 to-blue-100 dark:from-blue-900/40 dark:to-blue-800/40 ring-2 ring-blue-200 dark:ring-blue-700' : 
              calculateTotalMargin < 0 ? 'text-red-700 dark:text-red-300 bg-gradient-to-r from-red-50 to-red-100 dark:from-red-900/40 dark:to-red-800/40 ring-2 ring-red-200 dark:ring-red-700' : 
              'text-gray-700 dark:text-gray-200 bg-gradient-to-r from-gray-100 to-gray-200 dark:from-gray-700 dark:to-gray-800 ring-2 ring-gray-200 dark:ring-gray-700'
            }`}>
              {calculateTotalMargin.toLocaleString()}원
            </span>
          </div>
        </div>
      </div>
      )}

      {/* 승인된 사이트 중 미등록 사이트 목록 */}
      {!isFutureDate && unregisteredApprovedSites.length > 0 && (
        <div className="mt-6 bg-gradient-to-br from-orange-50 to-red-50 dark:from-orange-900/30 dark:to-red-900/30 border-2 border-orange-200 dark:border-orange-800 rounded-xl p-5 shadow-lg">
          <h3 className="font-bold text-xl text-orange-900 dark:text-orange-200 mb-3">
            ⚠️ 승인된 사이트 중 미등록 ({unregisteredApprovedSites.length}개)
          </h3>
          <Droppable droppableId="unregistered-sites-list" direction="horizontal">
            {(provided) => (
              <div
                ref={provided.innerRef}
                {...provided.droppableProps}
                className="flex flex-wrap gap-2"
              >
                {unregisteredSitesWithMemo.map((site, index) => (
                  <Draggable
                    key={`unregistered-site-${index}`}
                    draggableId={`unregistered-site-${index}`}
                    index={index}
                  >
                    {(provided, snapshot) => (
                      <div
                        ref={provided.innerRef}
                        {...provided.draggableProps}
                        {...provided.dragHandleProps}
                        onContextMenu={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          handleUnregisteredSiteContextMenu(e, site);
                        }}
                        className={`px-3 py-2 bg-white dark:bg-gray-800 border-2 border-orange-300 dark:border-orange-700 rounded-xl cursor-move hover:bg-orange-100 dark:hover:bg-orange-900/30 transition-all duration-200 shadow-sm hover:shadow-md ${
                          snapshot.isDragging ? 'opacity-50 shadow-xl ring-2 ring-orange-400' : ''
                        }`}
                      >
                        <div className="text-sm font-semibold text-gray-900 dark:text-white">
                          {site.identityName} - {site.siteName}
                        </div>
                        <div className="text-xs text-gray-600 dark:text-gray-400 mt-1">
                          {site.status}
                        </div>
                        {site.notes && (
                          <div className="text-sm font-medium text-gray-700 dark:text-gray-300 mt-2 px-2 py-1 bg-gray-50 dark:bg-gray-700/50 rounded">
                            {site.notes}
                          </div>
                        )}
                      </div>
                    )}
                  </Draggable>
                ))}
                {provided.placeholder}
              </div>
            )}
          </Droppable>
          <p className="text-xs text-orange-800 dark:text-orange-300 mt-3">
            💡 위 사이트를 드래그하여 테이블의 사이트 컬럼으로 옮기면 자동으로 입력됩니다. 우클릭으로 사이트 수정이 가능합니다.
          </p>
        </div>
      )}

      {/* 장점검/수동입력 사이트 목록 */}
      {!isFutureDate && pendingSites.length > 0 && (
        <div className="mt-6 bg-gradient-to-br from-yellow-50 to-amber-50 dark:from-yellow-900/30 dark:to-amber-900/30 border-2 border-yellow-200 dark:border-yellow-800 rounded-xl p-5 shadow-lg">
          <h3 className="font-bold text-xl text-yellow-900 dark:text-yellow-200 mb-3">⚠️ 장점검/수동입력 사이트 목록</h3>
          <Droppable droppableId="pending-sites-list" direction="horizontal">
              {(provided) => (
                <div
                  ref={provided.innerRef}
                  {...provided.droppableProps}
                  className="flex flex-wrap gap-2"
                >
                  {pendingSites.map((site, index) => (
                    <Draggable
                      key={`pending-site-${index}`}
                      draggableId={`pending-site-${index}`}
                      index={index}
                    >
                      {(provided, snapshot) => (
                        <div
                          ref={provided.innerRef}
                          {...provided.draggableProps}
                          {...provided.dragHandleProps}
                          onContextMenu={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            handlePendingSiteContextMenu(e, site);
                          }}
                          className={`px-3 py-2 bg-white dark:bg-gray-800 border-2 border-yellow-300 dark:border-yellow-700 rounded-xl cursor-move hover:bg-yellow-100 dark:hover:bg-yellow-900/30 transition-all duration-200 shadow-sm hover:shadow-md ${
                            snapshot.isDragging ? 'opacity-50 shadow-xl ring-2 ring-yellow-400' : ''
                          }`}
                        >
                          <div className="text-sm font-semibold text-gray-900 dark:text-white">
                            {site.identityName} - {site.siteName}
                          </div>
                          <div className="text-xs text-gray-600 dark:text-gray-400 mt-1">
                            {site.status}
                          </div>
                          {site.notes && (
                            <div className="text-sm font-medium text-gray-700 dark:text-gray-300 mt-2 px-2 py-1 bg-gray-50 dark:bg-gray-700/50 rounded">
                              {site.notes}
                            </div>
                          )}
                        </div>
                      )}
                    </Draggable>
                  ))}
                  {provided.placeholder}
                </div>
              )}
            </Droppable>
            <p className="text-xs text-yellow-800 dark:text-yellow-300 mt-2">
              💡 위 목록의 사이트를 드래그하여 테이블의 사이트 컬럼으로 옮기면 자동으로 입력되고 승인 상태로 변경됩니다. 우클릭으로 사이트 수정이 가능합니다.
            </p>
          </div>
      )}


      {/* 도움말 */}
      <div className="mt-6 bg-gradient-to-br from-blue-50 to-indigo-50 dark:from-gray-800 dark:to-gray-900 border-2 border-blue-200 dark:border-gray-700 rounded-xl p-5 shadow-lg">
        <h3 className="font-bold text-xl bg-gradient-to-r from-blue-900 to-indigo-900 dark:from-blue-200 dark:to-indigo-200 bg-clip-text text-transparent mb-3">📖 사용법</h3>
        <ul className="text-sm text-gray-800 dark:text-gray-200 space-y-2 font-medium">
          <li>• <strong>"➕ 행 추가"</strong>를 클릭하여 새 기록을 추가하세요</li>
          <li>• 셀을 <strong>클릭</strong>하여 수정할 수 있습니다</li>
          <li>• <strong>특이사항을 오른쪽 클릭</strong>하여 사이트 정보를 추가할 수 있습니다</li>
          <li>• <strong>행을 드래그</strong>하여 순서를 변경할 수 있습니다</li>
          <li>• <strong>사이트 입력 형식:</strong> "10 20" (첫 번째 숫자=충전10만원, 두 번째 숫자=환전20만원)</li>
          <li>• <strong>특이사항 형식:</strong> "DR벳50충" 또는 "DR벳130환" 또는 "케이5/원탑10"</li>
          <li>• <strong>사설, 토탈충전, 마진</strong>은 자동으로 계산됩니다</li>
          <li>• <strong>엔터</strong> = 저장, <strong>ESC</strong> = 취소</li>
        </ul>
      </div>

      {/* 사이트 메타데이터(이벤트/요율 등) 모달 */}
      <SiteNotesModal
        isOpen={siteNotesModal.open}
        onClose={() => setSiteNotesModal(prev => ({ ...prev, open: false }))}
        siteName={siteNotesModal.siteName}
        identityName={siteNotesModal.identityName}
        recordedBy={siteNotesModal.recordedBy}
        monthlyStats={siteNotesModal.monthlyStats}
        weeklyStats={siteNotesModal.weeklyStats}
        recharges={siteNotesModal.recharges}
        data={siteNotesModal.data}
        readonly={siteNotesModal.readonly}
        startDate={siteNotesModal.startDate}
        selectedDate={selectedDate}
        onSave={saveSiteNotes}
        onDataChange={(newData) => setSiteNotesModal(prev => ({ ...prev, data: newData }))}
      />

      {/* 사이트 계정 정보 모달 */}
      {showSiteAccountModal && siteAccountInfo && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow dark:shadow-gray-900/50 p-6 w-full max-w-md">
            <h3 className="text-xl font-bold mb-4 dark:text-white">
              📋 사이트 계정 정보
            </h3>
            
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-bold text-gray-700 dark:text-white mb-1">유저</label>
                <div className="w-full border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-md px-3 py-2 bg-gray-50 dark:bg-gray-700">
                  {siteAccountInfo.identityName}
                </div>
              </div>
              
              <div>
                <label className="block text-sm font-bold text-gray-700 dark:text-white mb-1">사이트</label>
                <div className="w-full border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-md px-3 py-2 bg-gray-50 dark:bg-gray-700">
                  {siteAccountInfo.siteName}
                </div>
              </div>
              
              <div>
                <label className="block text-sm font-bold text-gray-700 dark:text-white mb-1">아이디</label>
                <div className="w-full border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-md px-3 py-2 bg-gray-50 dark:bg-gray-700 break-all">
                  {siteAccountInfo.account_id || '(없음)'}
                </div>
              </div>
              
              <div>
                <label className="block text-sm font-bold text-gray-700 dark:text-white mb-1">비밀번호</label>
                <div className="w-full border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-md px-3 py-2 bg-gray-50 dark:bg-gray-700 break-all">
                  {siteAccountInfo.password || '(없음)'}
                </div>
              </div>
              
              <div>
                <label className="block text-sm font-bold text-gray-700 dark:text-white mb-1">환전 비밀번호</label>
                <div className="w-full border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-md px-3 py-2 bg-gray-50 dark:bg-gray-700 break-all">
                  {siteAccountInfo.exchange_password || '(없음)'}
                </div>
              </div>
              
              <div>
                <label className="block text-sm font-bold text-gray-700 dark:text-white mb-1">닉네임</label>
                <div className="w-full border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-md px-3 py-2 bg-gray-50 dark:bg-gray-700">
                  {siteAccountInfo.nickname || '(없음)'}
                </div>
              </div>
            </div>
            
            <div className="mt-6 flex justify-end">
              <button
                onClick={() => {
                  setShowSiteAccountModal(false);
                  setSiteAccountInfo(null);
                }}
                className="px-4 py-2 bg-gray-500 text-white rounded hover:bg-gray-600"
              >
                닫기
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 사이트 수정 모달 (사이트 관리와 동일) */}
      {showSiteEditModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow dark:shadow-gray-900/50 p-6 w-full max-w-3xl max-h-[90vh] overflow-y-auto">
            <h3 className="text-xl font-bold mb-4 dark:text-white">
              🔧 사이트 수정
            </h3>
            
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-bold text-gray-700 dark:text-white mb-1">출석 (사이트명) *</label>
                <input
                  type="text"
                  value={siteForm.site_name}
                  onChange={(e) => setSiteForm({...siteForm, site_name: e.target.value})}
                  className="w-full border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-md px-3 py-2"
                  placeholder="원탑"
                  required
                />
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
                {(() => {
                  // 전체 이력 목록 (삭제용)
                  const statusHistory = editingSite?.status ? editingSite.status.split('/').map(s => s.trim()).filter(s => s) : [];
                  
                  // 마지막 상태 추출
                  const statusParts = editingSite?.status?.split('/') || [];
                  const lastStatusPart = statusParts[statusParts.length - 1]?.trim() || '';
                  const lastStatusValue = lastStatusPart.replace(/^\d{1,2}\.\d{1,2}\s*/, '').trim();
                  const lastStatusPure = lastStatusPart?.includes('수동입력')
                    ? lastStatusPart?.match(/^\d{1,2}\.\d{1,2}\s*수동입력\s+(.+)$/)?.[1] || lastStatusValue
                    : lastStatusValue;
                  
                  // 유효한 옵션 목록
                  const validOptions = ['가입전', '대기', '승인', '장점검', '팅', '졸업'];
                  let optionsList = [...validOptions];
                  
                  // 기존 상태에서 모든 순수 상태값 추출하여 옵션에 추가
                  if (editingSite?.status) {
                    const allStatusParts = editingSite.status.split('/').map(s => s.trim());
                    allStatusParts.forEach(part => {
                      let partPure = part.replace(/\d{1,2}\.\d{1,2}\s*/g, '').trim();
                      partPure = partPure.replace(/^수동입력\s+/, '').trim();
                      if (partPure && !optionsList.includes(partPure)) {
                        optionsList.push(partPure);
                      }
                    });
                  }
                  
                  return (
                    <div className="space-y-2">
                      {/* 전체 이력 표시 (삭제 가능) */}
                      {statusHistory.length > 0 && (
                        <div className="mb-2 p-2 bg-gray-50 dark:bg-gray-700 rounded text-xs">
                          <div className="font-bold mb-1 text-gray-600 dark:text-gray-300">📋 전체 이력 (삭제하려면 X 클릭):</div>
                          <div className="flex flex-wrap gap-1">
                            {statusHistory.map((historyItem, idx) => (
                              <span
                                key={idx}
                                className="inline-flex items-center gap-1 bg-white dark:bg-gray-600 px-2 py-1 rounded border border-gray-300 dark:border-gray-500"
                              >
                                <span className="text-gray-700 dark:text-gray-200">{historyItem}</span>
                                <button
                                  type="button"
                                  onClick={async (e) => {
                                    e.stopPropagation();
                                    e.preventDefault();
                                    
                                    const newHistory = statusHistory.filter((_, i) => i !== idx);
                                    const newStatus = newHistory.join(' / ');
                                    
                                    try {
                                      await axiosInstance.put(`/sites/${editingSite.id}`, {
                                        ...editingSite,
                                        status: newStatus || ''
                                      });
                                      toast.success('이력이 삭제되었습니다');
                                      
                                      // 데이터 새로고침
                                      loadIdentities();
                                      setShowSiteEditModal(false);
                                    } catch (error) {
                                      console.error('[이력 삭제] 삭제 실패:', error);
                                      toast.error(`삭제 실패: ${error.response?.data?.message || error.message}`);
                                    }
                                  }}
                                  className="text-red-500 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-900/30 rounded px-1 font-bold cursor-pointer"
                                  title="이력 삭제"
                                >
                                  ✕
                                </button>
                              </span>
                            ))}
                          </div>
                        </div>
                      )}
                      
                      {/* 수동입력 모드 */}
                      {isManualInputMode ? (
                        <div className="flex gap-2 items-center">
                          <input
                            type="text"
                            value={manualInputValue}
                            onChange={(e) => setManualInputValue(e.target.value)}
                            onBlur={async () => {
                              const inputText = manualInputValue || '';
                              
                              // 기존 값을 추출하여 비교
                              const existingMatch = editingSite?.status?.match(/^\d{1,2}\.\d{1,2}\s*수동입력\s+(.+)$/);
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
                                if (editingSite?.status && editingSite.status.trim()) {
                                  // 기존 상태의 슬래시 앞뒤 공백 정규화
                                  let normalizedStatus = editingSite.status.trim();
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
                                  
                                  if (!isAlreadyExists) {
                                    finalValue = `${normalizedStatus} / ${newValue}`;
                                  } else {
                                    finalValue = normalizedStatus;
                                  }
                                }
                                
                                try {
                                  await axiosInstance.put(`/sites/${editingSite.id}`, {
                                    ...editingSite,
                                    status: finalValue
                                  });
                                  toast.success('수정되었습니다');
                                  
                                  // 데이터 새로고침
                                  loadIdentities();
                                  setShowSiteEditModal(false);
                                } catch (error) {
                                  toast.error('수정 실패');
                                }
                              }
                              
                              setIsManualInputMode(false);
                              setManualInputValue('');
                            }}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') {
                                e.target.blur();
                              } else if (e.key === 'Escape') {
                                setIsManualInputMode(false);
                                setManualInputValue('');
                              }
                            }}
                            autoFocus
                            placeholder="자유롭게 입력하세요"
                            className="w-full px-2 py-1 border border-blue-500 rounded focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-[#282C34] dark:text-white dark:border-blue-400"
                          />
                        </div>
                      ) : (
                        /* 셀렉트박스 */
                        <select
                          value={optionsList.includes(lastStatusPure) ? lastStatusPure : ''}
                          onContextMenu={(e) => {
                            e.preventDefault();
                            setIsManualInputMode(true);
                            // 기존 수동입력 값 추출
                            const manualMatch = editingSite?.status?.match(/^\d{1,2}\.\d{1,2}\s*수동입력\s+(.+)$/);
                            const initialValue = manualMatch ? manualMatch[1] : '';
                            setManualInputValue(initialValue);
                          }}
                          onChange={(e) => {
                            const newValue = e.target.value;
                            if (!newValue) return;
                            
                            const now = new Date();
                            const month = String(now.getMonth() + 1).padStart(2, '0');
                            const day = String(now.getDate()).padStart(2, '0');
                            const datePrefix = `${month}.${day}`;
                            
                            // 편집 중인 값에서 날짜 제거 후 순수 상태값 추출
                            let newStatusValue = `${datePrefix} ${newValue}`;
                            
                            // 기존 상태가 있으면 슬래시로 구분하여 추가
                            let finalValue = newStatusValue;
                            if (editingSite?.status && editingSite.status.trim()) {
                              // 기존 상태의 슬래시 앞뒤 공백 정규화
                              let normalizedStatus = editingSite.status.trim();
                              normalizedStatus = normalizedStatus.replace(/\s*\/\s*/g, ' / ');
                              
                              // 기존 상태가 이미 새 상태값을 포함하고 있는지 확인
                              const existingStatusParts = normalizedStatus.split('/').map(s => s.trim());
                              const isAlreadyExists = existingStatusParts.some(part => {
                                const partWithoutDate = part.replace(/^\d{1,2}\.\d{1,2}\s*/, '').trim();
                                const purePart = partWithoutDate.replace(/^수동입력\s+/, '').trim();
                                return purePart === newValue;
                              });
                              
                              // "가입전"에서 "대기"로 변경하는 경우 "가입전" 이력 자동 삭제
                              if (newValue === '대기') {
                                const filteredParts = existingStatusParts.filter(part => {
                                  const partWithoutDate = part.replace(/^\d{1,2}\.\d{1,2}\s*/, '').trim();
                                  const purePart = partWithoutDate.replace(/^수동입력\s+/, '').trim();
                                  return purePart !== '가입전';
                                });
                                
                                if (filteredParts.length > 0) {
                                  normalizedStatus = filteredParts.join(' / ');
                                  if (!isAlreadyExists) {
                                    finalValue = `${normalizedStatus} / ${newStatusValue}`;
                                  } else {
                                    finalValue = normalizedStatus;
                                  }
                                } else {
                                  finalValue = newStatusValue;
                                }
                              } else if (!isAlreadyExists) {
                                finalValue = `${normalizedStatus} / ${newStatusValue}`;
                              } else {
                                finalValue = normalizedStatus;
                              }
                            }
                            
                            setSiteForm({...siteForm, status: finalValue});
                          }}
                          className="w-full border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-md px-3 py-2"
                          title="우클릭하여 수동입력 모드로 전환"
                        >
                          <option value="">선택하세요</option>
                          {optionsList.map(option => (
                            <option key={option} value={option}>{option}</option>
                          ))}
                        </select>
                      )}
                    </div>
                  );
                })()}
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
                onClick={() => setShowSiteEditModal(false)}
                className="px-4 py-2 bg-gray-200 dark:bg-gray-700 text-gray-800 dark:text-white rounded-md hover:bg-gray-300 dark:hover:bg-gray-600"
              >
                취소
              </button>
              <button
                onClick={saveSite}
                className="px-4 py-2 bg-blue-500 text-white rounded-md hover:bg-blue-600"
              >
                저장
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 사이트 정보 입력 모달 */}
      {showSiteModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div 
            className="bg-white dark:bg-gray-800 rounded-lg shadow dark:shadow-gray-900/50 p-6 w-full max-h-[90vh] overflow-y-auto"
            style={{ maxWidth: sites && sites.length > 0 ? `${sites.length * 350}px` : '350px' }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                addSiteInfoToNotes();
              } else if (e.key === 'Escape') {
                closeSiteModal();
              }
            }}
            tabIndex={0}
          >
            <h3 className="text-xl font-bold mb-4 dark:text-white">📝 특이사항</h3>
            
            <div 
              className="grid gap-4"
              style={{ gridTemplateColumns: `repeat(${sites && sites.length > 0 ? sites.length : 1}, 1fr)` }}
            >
              {sites && Array.isArray(sites) && sites.length > 0 ? sites.map(site => (
                <div key={site.id} className="border border-gray-200 dark:border-gray-700 rounded-lg p-3">
                  <h4 className="font-semibold text-gray-800 dark:text-white mb-2">{site.name}</h4>
                  
                  <div className="space-y-2">
                    <div>
                      <div className="flex items-center justify-between">
                        <label className="block text-sm text-gray-600 dark:text-white mb-1">포인트</label>
                        <button
                          type="button"
                          onClick={() => resetSitePointInputs(site.id)}
                          className="text-xs text-red-500 hover:text-red-600"
                        >
                          초기화
                        </button>
                      </div>
                      <input
                        type="number"
                        step="0.1"
                        value={siteInputs[site.id]?.point ?? ''}
                        onChange={(e) => handleSiteInputChange(site.id, 'point', e.target.value)}
                        className="w-full px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-[#282C34] dark:text-white"
                        placeholder="포인트 입력"
                      />
                      
                      <div className="mt-2">
                        <label className="block text-sm text-gray-600 dark:text-white mb-1">포인트 종류</label>
                        <div className="grid grid-cols-2 gap-2">
                          <label className="flex items-center">
                            <input
                              type="radio"
                              name={`pointType_${site.id}`}
                              value="출석"
                              checked={siteInputs[site.id]?.pointType === '출석'}
                              onChange={(e) => handleSiteInputChange(site.id, 'pointType', e.target.value)}
                              className="mr-2"
                            />
                            <span className="text-sm text-blue-600">출석</span>
                          </label>
                          <label className="flex items-center">
                            <input
                              type="radio"
                              name={`pointType_${site.id}`}
                              value="페이백"
                              checked={siteInputs[site.id]?.pointType === '페이백'}
                              onChange={(e) => handleSiteInputChange(site.id, 'pointType', e.target.value)}
                              className="mr-2"
                            />
                            <span className="text-sm text-purple-600">페이백</span>
                          </label>
                          <label className="flex items-center">
                            <input
                              type="radio"
                              name={`pointType_${site.id}`}
                              value="정착"
                              checked={siteInputs[site.id]?.pointType === '정착'}
                              onChange={(e) => handleSiteInputChange(site.id, 'pointType', e.target.value)}
                              className="mr-2"
                            />
                            <span className="text-sm text-orange-600">정착</span>
                          </label>
                          <label className="flex items-center">
                            <input
                              type="radio"
                              name={`pointType_${site.id}`}
                              value="요율"
                              checked={siteInputs[site.id]?.pointType === '요율'}
                              onChange={(e) => handleSiteInputChange(site.id, 'pointType', e.target.value)}
                              className="mr-2"
                            />
                            <span className="text-sm text-yellow-600">요율</span>
                          </label>
                          <label className="flex items-center">
                            <input
                              type="radio"
                              name={`pointType_${site.id}`}
                              value="지추"
                              checked={siteInputs[site.id]?.pointType === '지추'}
                              onChange={(e) => handleSiteInputChange(site.id, 'pointType', e.target.value)}
                              className="mr-2"
                            />
                            <span className="text-sm text-pink-600">지추</span>
                          </label>
                          <label className="flex items-center">
                            <input
                              type="radio"
                              name={`pointType_${site.id}`}
                              value="첫충"
                              checked={siteInputs[site.id]?.pointType === '첫충'}
                              onChange={(e) => handleSiteInputChange(site.id, 'pointType', e.target.value)}
                              className="mr-2"
                            />
                            <span className="text-sm text-green-600">첫충</span>
                          </label>
                          <label className="flex items-center">
                            <input
                              type="radio"
                              name={`pointType_${site.id}`}
                              value="매충"
                              checked={siteInputs[site.id]?.pointType === '매충'}
                              onChange={(e) => handleSiteInputChange(site.id, 'pointType', e.target.value)}
                              className="mr-2"
                            />
                            <span className="text-sm text-cyan-600">매충</span>
                          </label>
                          <label className="flex items-center">
                            <input
                              type="radio"
                              name={`pointType_${site.id}`}
                              value="입플"
                              checked={siteInputs[site.id]?.pointType === '입플'}
                              onChange={(e) => handleSiteInputChange(site.id, 'pointType', e.target.value)}
                              className="mr-2"
                            />
                            <span className="text-sm text-indigo-600">입플</span>
                          </label>
                        </div>
                      </div>
                    </div>
                    
                    <div>
                      <div className="flex items-center justify-between">
                        <label className="block text-sm text-gray-600 dark:text-white mb-1">칩실수 금액</label>
                        <button
                          type="button"
                          onClick={() => resetSiteChipInputs(site.id)}
                          className="text-xs text-red-500 hover:text-red-600"
                        >
                          초기화
                        </button>
                      </div>
                      <input
                        type="number"
                        step="0.1"
                        value={siteInputs[site.id]?.chipAmount ?? ''}
                        onChange={(e) => handleSiteInputChange(site.id, 'chipAmount', e.target.value)}
                        className="w-full px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-[#282C34] dark:text-white"
                        placeholder="칩실수 금액 입력"
                      />
                      
                      <div className="mt-2">
                        <label className="block text-sm text-gray-600 dark:text-white mb-1">칩 종류</label>
                        <div className="flex space-x-4">
                          <label className="flex items-center">
                            <input
                              type="radio"
                              name={`chipType_${site.id}`}
                              value="bager"
                              checked={siteInputs[site.id]?.chipType === 'bager'}
                              onChange={(e) => handleSiteInputChange(site.id, 'chipType', e.target.value)}
                              className="mr-2"
                            />
                            <span className="text-sm text-purple-600">배거</span>
                          </label>
                          <label className="flex items-center">
                            <input
                              type="radio"
                              name={`chipType_${site.id}`}
                              value="chipting"
                              checked={siteInputs[site.id]?.chipType === 'chipting'}
                              onChange={(e) => handleSiteInputChange(site.id, 'chipType', e.target.value)}
                              className="mr-2"
                            />
                            <span className="text-sm text-orange-600">칩팅</span>
                          </label>
                          <label className="flex items-center">
                            <input
                              type="radio"
                              name={`chipType_${site.id}`}
                              value="chip"
                              checked={siteInputs[site.id]?.chipType === 'chip'}
                              onChange={(e) => handleSiteInputChange(site.id, 'chipType', e.target.value)}
                              className="mr-2"
                            />
                            <span className="text-sm text-blue-600">칩실수</span>
                          </label>
                        </div>
                      </div>
                      
                      <div className="mt-2">
                        <label className="block text-sm text-gray-600 dark:text-white mb-1">먹/못먹</label>
                        <div className="flex space-x-4">
                          <label className="flex items-center">
                            <input
                              type="radio"
                              name={`chipLoss_${site.id}`}
                              value="won"
                              checked={siteInputs[site.id]?.chipLoss === 'won'}
                              onChange={(e) => handleSiteInputChange(site.id, 'chipLoss', e.target.value)}
                              className="mr-2"
                            />
                            <span className="text-sm text-green-600">먹</span>
                          </label>
                          <label className="flex items-center">
                            <input
                              type="radio"
                              name={`chipLoss_${site.id}`}
                              value="lost"
                              checked={siteInputs[site.id]?.chipLoss === 'lost'}
                              onChange={(e) => handleSiteInputChange(site.id, 'chipLoss', e.target.value)}
                              className="mr-2"
                            />
                            <span className="text-sm text-red-600">못먹</span>
                          </label>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              )) : (
                <div className="text-center text-gray-500 dark:text-gray-400 py-4 text-sm">
                  등록된 사이트가 없습니다. 바때기나 수동 입력을 사용할 수 있습니다.
                </div>
              )}
            </div>
            
            <div className="mt-6 grid gap-4 md:grid-cols-2">
              <div className="border border-gray-200 dark:border-gray-700 rounded-lg p-3">
                <div className="flex items-center justify-between mb-2">
                  <h4 className="font-semibold text-gray-800 dark:text-white">바때기</h4>
                  <button
                    type="button"
                    onClick={resetBategiInputs}
                    className="text-xs text-red-500 hover:text-red-600"
                  >
                    초기화
                  </button>
                </div>
                <label className="block text-sm text-gray-600 dark:text-white mb-1">금액</label>
                <input
                  type="number"
                  step="0.1"
                  value={extraNoteInputs.bategiAmount ?? ''}
                  onChange={(e) => handleExtraNoteInputChange('bategiAmount', e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-[#282C34] dark:text-white"
                  placeholder="예: 100"
                />
                <div className="flex space-x-4 mt-3">
                  <label className="flex items-center text-sm text-gray-700 dark:text-white">
                    <input
                      type="radio"
                      name="bategiType"
                      value="충"
                      checked={extraNoteInputs.bategiType === '충'}
                      onChange={(e) => handleExtraNoteInputChange('bategiType', e.target.value)}
                      className="mr-2"
                    />
                    충
                  </label>
                  <label className="flex items-center text-sm text-gray-700 dark:text-white">
                    <input
                      type="radio"
                      name="bategiType"
                      value="환"
                      checked={extraNoteInputs.bategiType === '환'}
                      onChange={(e) => handleExtraNoteInputChange('bategiType', e.target.value)}
                      className="mr-2"
                    />
                    환
                  </label>
                </div>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-2">금액을 입력하면 반드시 충/환을 선택해야 합니다.</p>
              </div>

              <div className="border border-gray-200 dark:border-gray-700 rounded-lg p-3">
                <h4 className="font-semibold text-gray-800 dark:text-white mb-2">수동 입력</h4>
                <textarea
                  rows={4}
                  value={extraNoteInputs.manualText || ''}
                  onChange={(e) => {
                    // 항상 값을 업데이트 (controlled component 유지)
                    const newValue = e.target.value;
                    handleExtraNoteInputChange('manualText', newValue);
                  }}
                  onCompositionStart={() => {
                    isComposingRef.current = true;
                  }}
                  onCompositionEnd={(e) => {
                    // 조합 종료 → 한글 정규화(NFC)로 확정
                    isComposingRef.current = false;
                    const finalized = (e.currentTarget.value || '').normalize('NFC');
                    handleExtraNoteInputChange('manualText', finalized);
                  }}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-[#282C34] dark:text-white resize-none"
                  placeholder="자유롭게 메모를 입력하세요"
                />
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-2">저장 시 다른 항목과 '/'로 자동 구분됩니다.</p>
              </div>
            </div>
            
            <div className="flex justify-end space-x-3 mt-6">
              <button
                onClick={closeSiteModal}
                className="px-4 py-2 text-gray-600 dark:text-white border border-gray-300 dark:border-gray-700 rounded-md hover:bg-gray-50 dark:hover:bg-gray-700 dark:bg-[#282C34]"
              >
                취소
              </button>
              <button
                onClick={addSiteInfoToNotes}
                className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700"
              >
                추가
              </button>
            </div>
          </div>
        </div>
      )}
      </div>
    </DragDropContext>
  );
}

export default DRBet;
