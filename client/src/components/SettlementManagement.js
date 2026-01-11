import React, { useState, useEffect, useRef } from 'react';
import axiosInstance from '../api/axios';
import toast from 'react-hot-toast';
 
function SettlementManagement() {
  const [records, setRecords] = useState([]);
  const [identities, setIdentities] = useState([]);
  const [editingCell, setEditingCell] = useState(null);
  const [editingValue, setEditingValue] = useState('');
  // 년월 형식: YYYY-MM
  const getCurrentYearMonth = () => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  };
  const [selectedYearMonth, setSelectedYearMonth] = useState(getCurrentYearMonth());
  
  // StrictMode 및 중복 호출 방지용
  const didInitialLoadRef = useRef(false);
  const initMonthInflightRef = useRef(new Map()); // yearMonth -> Promise
  const loadInflightRef = useRef(new Map()); // yearMonth -> Promise
  
  // selectedYearMonth에서 년도와 월 추출
  const selectedYear = parseInt(selectedYearMonth.split('-')[0]);
  const selectedMonth = parseInt(selectedYearMonth.split('-')[1]);

  useEffect(() => {
    initializeData();
  }, []);

  // 년월이 변경될 때마다 데이터 다시 로드 (최초 마운트에서는 initializeData가 수행하므로 스킵)
  useEffect(() => {
    if (!selectedYearMonth) return;
    if (!didInitialLoadRef.current) {
      didInitialLoadRef.current = true; // 첫 렌더 이후 변경 트리거는 무시
      return;
    }
    initializeMonthData();
  }, [selectedYearMonth]);

  // 해당 월의 실제 일수 계산
  const getDaysInMonth = (year, month) => {
    return new Date(year, month, 0).getDate();
  };

  const initializeMonthData = async () => {
    try {
      const ym = selectedYearMonth;
      if (!ym) return;
      // 동시 중복 방지
      if (initMonthInflightRef.current.get(ym)) {
        await initMonthInflightRef.current.get(ym);
        await loadRecords();
        return;
      }
      const p = (async () => {
        // 해당 월의 실제 일수만큼 데이터 초기화
        const initRes = await axiosInstance.post('/settlements/init', { year_month: ym });
      })();
      initMonthInflightRef.current.set(ym, p);
      await p;
      initMonthInflightRef.current.delete(ym);
      // 해당 월의 정산 기록 가져오기
      await loadRecords();
    } catch (error) {
      console.error('❌ 월별 초기화 실패:', error);
      console.error('에러 상세:', error.response?.data || error.message);
      toast.error(`월별 데이터 초기화 실패: ${error.response?.data?.error || error.message}`);
    }
  };

  const initializeData = async () => {
    try {
      // 초기 진입 시 선택 월 기준으로만 초기화 (중복 방지 로직은 initializeMonthData 내부)
      await initializeMonthData();

      // 명의 목록 가져오기
      const identitiesRes = await axiosInstance.get('/settlements/identities');
      setIdentities(identitiesRes.data);
      
    } catch (error) {
      console.error('❌ 초기화 실패:', error);
      console.error('에러 상세:', error.response?.data || error.message);
      toast.error(`데이터 초기화 실패: ${error.response?.data?.error || error.message}`);
    }
  };

  const loadRecords = async () => {
    try {
      const ym = selectedYearMonth;
      if (!ym) return;
      if (loadInflightRef.current.get(ym)) {
        await loadInflightRef.current.get(ym);
        return;
      }
      const p = axiosInstance.get(`/settlements?year_month=${ym}`);
      loadInflightRef.current.set(ym, p);
      const response = await p;
      loadInflightRef.current.delete(ym);
      
      // 서버에서 받은 데이터를 day_number를 키로 하는 맵으로 변환
      const dataMap = {};
      response.data.forEach(record => {
        dataMap[record.day_number] = record;
      });
      
      // 해당 월의 실제 일수 계산
      const daysInMonth = getDaysInMonth(selectedYear, selectedMonth);
      
      // 1일부터 실제일수까지 모든 행 생성 (데이터가 있으면 매핑, 없으면 빈 데이터)
      const allRecords = [];
      for (let day = 1; day <= daysInMonth; day++) {
        if (dataMap[day]) {
          // 데이터가 있으면 실제 데이터 사용
          allRecords.push(dataMap[day]);
        } else {
          // 데이터가 없으면 빈 행 생성 (id는 임시로 음수 사용)
          allRecords.push({
            id: -day, // 임시 ID
            year_month: selectedYearMonth,
            day_number: day,
            ka_amount: 0,
            seup: 'X',
            site_content: '',
            user_data: {}
          });
        }
      }
      
      setRecords(allRecords);
    } catch (error) {
      console.error('❌ 정산 기록 로드 실패:', error);
      console.error('에러 상세:', error.response?.data || error.message);
      toast.error(`정산 기록 로드 실패: ${error.response?.data?.error || error.message}`);
    }
  };

  const formatCurrency = (amount) => {
    if (!amount && amount !== 0) return '0';
    // 문자열인 경우 그대로 반환
    if (typeof amount === 'string') {
      const numValue = Number(amount);
      if (isNaN(numValue) || String(amount).trim() !== String(numValue)) {
        return amount; // 문자열 그대로 반환
      }
      // 숫자로 변환 가능한 경우 숫자로 포맷팅
      return numValue.toLocaleString('ko-KR');
    }
    return amount.toLocaleString('ko-KR');
  };

  const formatDate = (dateString) => {
    if (!dateString) return '';
    const date = new Date(dateString);
    const month = (date.getMonth() + 1).toString().padStart(2, '0');
    const day = date.getDate().toString().padStart(2, '0');
    return `${month}.${day}`;
  };

  // 셀 더블클릭 처리
  const handleCellDoubleClick = (record, field, identityId = null) => {
    let currentValue = '';
    
    if (identityId !== null) {
      // 명의별 데이터
      const userData = record.user_data || {};
      const userInfo = userData[identityId] || {};
      currentValue = userInfo[field] || '';
      
      // 날짜 필드인 경우: yyyy-mm-dd에서 일자만 추출
      if (field === 'date' || field === 'gift_date') {
        if (currentValue) {
          // yyyy-mm-dd 형식에서 일자만 추출
          const dateMatch = currentValue.match(/\d{4}-\d{2}-(\d{2})/);
          if (dateMatch) {
            currentValue = dateMatch[1]; // 일자만 (예: "25")
          } else {
            // 이미 일자만 있는 경우 그대로 사용
            currentValue = currentValue;
          }
        }
      }
    } else {
      // 공통 필드
      currentValue = record[field] || '';
    }
    
    setEditingCell({ recordId: record.id, field, identityId });
    setEditingValue(currentValue);
  };

  // 셀 편집 저장
  const handleCellBlur = async (record) => {
    if (!editingCell) return;

    const { field, identityId } = editingCell;
    const updatedRecord = { ...record };
    let valueToSave = editingValue;

    // 날짜 필드인 경우: 일자를 yyyy-mm-dd 형식으로 변환
    if ((field === 'date' || field === 'gift_date') && identityId !== null) {
      if (valueToSave && valueToSave.trim() !== '') {
        // 일자만 입력된 경우 (예: "25")
        const day = parseInt(valueToSave.trim());
        if (!isNaN(day) && day >= 1 && day <= 31) {
          // 선택된 년월과 일자를 조합하여 yyyy-mm-dd 형식으로 변환
          const dayStr = String(day).padStart(2, '0');
          valueToSave = `${selectedYearMonth}-${dayStr}`;
        } else {
          // 유효하지 않은 일자
          toast.error('유효한 일자(1-31)를 입력해주세요');
          return;
        }
      }
    }

    if (identityId !== null) {
      // 명의별 데이터 업데이트
      const userData = { ...(record.user_data || {}) };
      if (!userData[identityId]) {
        userData[identityId] = {};
      }
      userData[identityId][field] = valueToSave;
      updatedRecord.user_data = userData;
    } else {
      // 공통 필드 업데이트
      updatedRecord[field] = valueToSave;
    }

    try {
      // 선택된 월 정보 추가
      updatedRecord.year_month = selectedYearMonth;
      
      // 임시 ID (음수)인 경우 PUT 요청 시 day_number와 year_month로 저장
      if (record.id < 0) {
        // 새 데이터이므로 day_number와 year_month를 포함하여 저장
        await axiosInstance.put(`/settlements/${record.id}`, updatedRecord);
      } else {
        // 기존 데이터 업데이트
        await axiosInstance.put(`/settlements/${record.id}`, updatedRecord);
      }
      toast.success('정산 기록이 수정되었습니다');
      await loadRecords();
    } catch (error) {
      console.error('정산 기록 저장 실패:', error);
      toast.error('정산 기록 저장에 실패했습니다');
    }

    setEditingCell(null);
    setEditingValue('');
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

  // 합계 계산
  const calculateTotal = () => {
    const totalRevenue = records.reduce((sum, record) => sum + (record.ka_amount || 0), 0);
    
    const totalAmountsByIdentity = identities.map(identity => {
      const total = records.reduce((sum, record) => {
        const userData = record.user_data || {};
        const identityData = userData[identity.id] || {};
        const amount = identityData.amount;
        // 문자열인 경우 합계에서 제외
        if (amount !== null && amount !== undefined && amount !== '') {
          const numValue = Number(amount);
          if (!isNaN(numValue) && String(amount).trim() === String(numValue)) {
            return sum + numValue;
          }
        }
        return sum;
      }, 0);
      return { identity, total };
    });
    
    // 총합계: 수익 + 모든 명의별 금액 합계
    const totalAmountSum = totalAmountsByIdentity.reduce((sum, item) => sum + (item.total || 0), 0);
    const grandTotal = totalRevenue + totalAmountSum;
    
    return { totalRevenue, totalAmountsByIdentity, grandTotal };
  };

  const { totalRevenue, totalAmountsByIdentity, grandTotal } = calculateTotal();

  // 특정 명의의 금액이 문자열인지 확인
  const hasStringAmountForIdentity = (record, identityId) => {
    const userData = record.user_data || {};
    const userInfo = userData[identityId] || {};
    const amount = userInfo.amount;
    if (amount !== null && amount !== undefined && amount !== '') {
      // 숫자로 변환 가능한지 확인
      const numValue = Number(amount);
      if (isNaN(numValue) || String(amount).trim() !== String(numValue)) {
        return true; // 문자열이 포함되어 있음
      }
    }
    return false;
  };

  // 셀 렌더링
  const renderCell = (record, field, displayValue, identityId = null) => {
    // 수익(ka_amount)과 사이트/내용(site_content)은 수정 불가
    const isReadOnly = field === 'ka_amount' || field === 'site_content';
    
    const isEditing = !isReadOnly && editingCell?.recordId === record.id && 
                      editingCell?.field === field && 
                      editingCell?.identityId === identityId;
    
    if (isEditing) {
      // 날짜 필드는 일자만 입력받도록 number 타입 사용
      const inputType = field === 'date' || field === 'gift_date' ? 'number' : 
                       field.includes('amount') ? 'text' : 
                       field.includes('number') ? 'number' : 'text';
      
      return (
        <input
          type={inputType}
          value={editingValue}
          onChange={(e) => setEditingValue(e.target.value)}
          onBlur={() => handleCellBlur(record)}
          onKeyDown={(e) => handleKeyPress(e, record)}
          autoFocus
          min={field === 'date' || field === 'gift_date' ? 1 : undefined}
          max={field === 'date' || field === 'gift_date' ? 31 : undefined}
          placeholder={field === 'date' || field === 'gift_date' ? '일자' : ''}
          className="w-full px-2 py-1 border border-blue-500 dark:border-blue-400 bg-white dark:bg-gray-700 text-gray-900 dark:text-white rounded focus:outline-none focus:ring-2 focus:ring-blue-500 hover:bg-gray-50 dark:hover:bg-gray-800"
        />
      );
    }
    
    if (isReadOnly) {
      // 읽기 전용 필드 (수익, 사이트/내용)
      return (
        <div
          className="px-2 py-1 min-h-[2rem] flex items-center justify-center text-gray-700 dark:text-white"
          title="수정 불가"
        >
          {displayValue}
        </div>
      );
    }

    return (
      <div
        onDoubleClick={() => handleCellDoubleClick(record, field, identityId)}
        className="cursor-pointer hover:bg-blue-50 dark:hover:bg-gray-700 px-2 py-1 min-h-[2rem] flex items-center justify-center dark:text-white"
        title="더블클릭하여 수정"
      >
        {displayValue}
      </div>
    );
  };

  // 명의별 데이터 가져오기
  const getUserData = (record, identityId, field) => {
    const userData = record.user_data || {};
    const userInfo = userData[identityId] || {};
    return userInfo[field] || '';
  };

  const colors = [
    'bg-blue-50 dark:bg-gray-700',
    'bg-green-50 dark:bg-gray-700', 
    'bg-yellow-50 dark:bg-gray-700',
    'bg-purple-50 dark:bg-gray-700',
    'bg-pink-50 dark:bg-gray-700',
    'bg-indigo-50 dark:bg-gray-700',
    'bg-red-50 dark:bg-gray-700',
    'bg-orange-50 dark:bg-gray-700'
  ];

  return (
    <div className="min-h-screen bg-gray-100 dark:bg-gray-900 p-4 sm:p-6">
      <div className="w-full mx-auto">
        {/* 페이지 제목 */}
        <div className="mb-4">
          <h1 className="text-3xl font-bold text-gray-900 dark:text-white">💰 정산 관리</h1>
          <p className="text-gray-600 dark:text-gray-300 mt-1">월별 정산 입력 및 기록 관리</p>
        </div>
        <div className="bg-white dark:bg-[#282C34] rounded-lg shadow p-4 mb-4">
          {/* 모바일 레이아웃 (세로 스택) */}
          <div className="sm:hidden space-y-3">
            {/* 1행: 레이블 + 년월 입력 */}
            <div className="flex items-center gap-3">
              <label className="font-bold text-gray-700 dark:text-white whitespace-nowrap">📅 년월 선택:</label>
              <input
                type="month"
                value={selectedYearMonth}
                onChange={(e) => setSelectedYearMonth(e.target.value)}
                className="w-full sm:w-auto min-w-[200px] border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-md px-4 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            {/* 2행: 이전/이번달/다음 버튼 */}
            <div className="flex gap-2">
              <button
                onClick={() => {
                  const date = new Date(selectedYearMonth + '-01');
                  date.setMonth(date.getMonth() - 1);
                  const prevYear = date.getFullYear();
                  const prevMonth = String(date.getMonth() + 1).padStart(2, '0');
                  setSelectedYearMonth(`${prevYear}-${prevMonth}`);
                }}
                className="px-4 py-2 bg-gray-200 dark:bg-gray-700 dark:text-white rounded hover:bg-gray-300 dark:hover:bg-gray-600"
              >
                ◀ 이전
              </button>
              <button
                onClick={() => {
                  const now = new Date();
                  setSelectedYearMonth(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`);
                }}
                className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 font-medium"
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
                className="px-4 py-2 bg-gray-200 dark:bg-gray-700 dark:text-white rounded hover:bg-gray-300 dark:hover:bg-gray-600"
              >
                다음 ▶
              </button>
            </div>

            {/* 우측 작업 버튼 */}
            <div className="flex gap-2 justify-start sm:justify-end">
              <button onClick={initializeData} className="px-4 py-2 bg-gray-200 dark:bg-gray-700 dark:text-white rounded hover:bg-gray-300 dark:hover:bg-gray-600">새로고침</button>
            </div>
          </div>

          {/* 데스크톱 레이아웃 (한 줄) */}
          <div className="hidden sm:flex items-center justify-between gap-4">
            <div className="flex items-center gap-4">
              <label className="font-bold text-gray-700 dark:text-white whitespace-nowrap">📅 년월 선택:</label>
              <input
                type="month"
                value={selectedYearMonth}
                onChange={(e) => setSelectedYearMonth(e.target.value)}
                className="min-w-[180px] border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-md px-4 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
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
                  className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 font-medium"
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
            </div>
            <div className="flex gap-2">
              <button onClick={initializeData} className="px-4 py-2 bg-gray-200 dark:bg-gray-700 dark:text-white rounded hover:bg-gray-300 dark:hover:bg-gray-600">새로고침</button>
            </div>
          </div>
        </div>

        {/* 기록 테이블 */}
        <div className="bg-white dark:bg-[#282C34] rounded-lg shadow overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full divide-y divide-gray-200 border-collapse">
              <thead className="bg-gray-50 dark:bg-[#282C34]">
                <tr>
                  <th className="px-4 py-3 text-center text-xs font-bold text-gray-700 dark:text-white uppercase whitespace-nowrap w-24 border-r border-gray-300 dark:border-gray-600">{selectedYear}년 {selectedMonth}월</th>
                  <th className="px-4 py-3 text-center text-xs font-bold text-gray-700 dark:text-white uppercase whitespace-nowrap w-20 border-r border-gray-300 dark:border-gray-600">수익</th>
                  <th className="px-4 py-3 text-center text-xs font-bold text-gray-700 dark:text-white uppercase whitespace-nowrap w-40 border-r-2 border-green-500 dark:border-green-400">사이트/내용</th>
                  
                  {/* 동적으로 명의별 컬럼 생성 */}
                  {identities.map((identity, idx) => (
                    <th key={identity.id} colSpan="4" className={`px-4 py-3 text-center text-xs font-bold text-gray-700 dark:text-white uppercase ${colors[idx % colors.length]} border-r-2 border-green-500 dark:border-green-400`}>
                      {identity.name}
                    </th>
                  ))}
                  <th className="px-4 py-3 text-center text-xs font-bold text-gray-700 dark:text-white uppercase whitespace-nowrap bg-yellow-50 dark:bg-yellow-900/20">총합계</th>
                </tr>
                <tr>
                  <th className="border-r border-gray-300 dark:border-gray-600"></th>
                  <th className="border-r border-gray-300 dark:border-gray-600"></th>
                  <th className="border-r-2 border-green-500 dark:border-green-400"></th>
                  
                  {/* 각 명의별 서브 헤더 */}
                  {identities.map((identity) => (
                    <React.Fragment key={`sub-${identity.id}`}>
                      <th className={`px-2 py-2 text-center text-xs font-bold text-gray-600 dark:text-white whitespace-nowrap border-r border-gray-300 dark:border-gray-600`}>날짜</th>
                      <th className={`px-2 py-2 text-center text-xs font-bold text-gray-600 dark:text-white whitespace-nowrap border-r border-gray-300 dark:border-gray-600`}>사이트</th>
                      <th className={`px-2 py-2 text-center text-xs font-bold text-gray-600 dark:text-white whitespace-nowrap border-r border-gray-300 dark:border-gray-600`}>깊티/날짜</th>
                      <th className={`px-2 py-2 text-center text-xs font-bold text-gray-600 dark:text-white whitespace-nowrap border-r-2 border-green-500 dark:border-green-400`}>금액</th>
                    </React.Fragment>
                  ))}
                  <th className="px-4 py-2 text-center text-xs font-bold text-gray-600 dark:text-white whitespace-nowrap bg-yellow-50 dark:bg-yellow-900/20">수익+금액</th>
                </tr>
              </thead>
              <tbody className="bg-white dark:bg-[#282C34] divide-y divide-gray-200 dark:divide-gray-700">
                {records.length === 0 ? (
                  <tr>
                    <td colSpan={3 + (identities.length * 4) + 1} className="px-6 py-8 text-center text-gray-500 dark:text-white">
                      데이터를 불러오는 중...
                    </td>
                  </tr>
                ) : (
                  records.map((record) => (
                    <tr key={record.id} className="hover:bg-gray-50 dark:hover:bg-gray-700 border-b border-gray-200 dark:border-gray-700">
                      {/* {selectedMonth}월 */}
                      <td className="px-4 py-2 text-center text-sm font-semibold dark:text-white whitespace-nowrap w-24 border-r border-gray-300 dark:border-gray-600">
                        {record.day_number}
                      </td>
                      
                      {/* 수익 */}
                      <td className="px-4 py-2 text-center text-sm dark:text-white whitespace-nowrap w-20 border-r border-gray-300 dark:border-gray-600">
                        {renderCell(record, 'ka_amount', formatCurrency(record.ka_amount))}
                      </td>
                      
                      {/* 사이트/내용 */}
                      <td className="px-4 py-2 text-center text-sm dark:text-white whitespace-nowrap w-40 border-r-2 border-green-500 dark:border-green-400">
                        {renderCell(record, 'site_content', record.site_content)}
                      </td>
                      
                      {/* 동적으로 명의별 데이터 렌더링 */}
                      {identities.map((identity) => {
                        const hasString = hasStringAmountForIdentity(record, identity.id);
                        const redBgClass = hasString ? 'bg-red-100 dark:bg-red-900/30' : '';
                        return (
                        <React.Fragment key={`data-${record.id}-${identity.id}`}>
                          <td className={`px-2 py-2 text-center text-xs dark:text-white border-r border-gray-300 dark:border-gray-600 ${redBgClass}`}>
                            {renderCell(record, 'date', formatDate(getUserData(record, identity.id, 'date')), identity.id)}
                          </td>
                          <td className={`px-2 py-2 text-center text-xs dark:text-white border-r border-gray-300 dark:border-gray-600 ${redBgClass}`}>
                            {renderCell(record, 'site', getUserData(record, identity.id, 'site'), identity.id)}
                          </td>
                          <td className={`px-2 py-2 text-center text-xs dark:text-white border-r border-gray-300 dark:border-gray-600 ${redBgClass}`}>
                            <div className="flex items-center justify-center gap-2">
                              <div className="min-w-[80px]">
                                {renderCell(record, 'gift', getUserData(record, identity.id, 'gift'), identity.id)}
                              </div>
                              <div className="min-w-[110px]">
                                {renderCell(record, 'gift_date', getUserData(record, identity.id, 'gift_date'), identity.id)}
                              </div>
                            </div>
                          </td>
                          <td className={`px-2 py-2 text-center text-xs dark:text-white border-r-2 border-green-500 dark:border-green-400 ${redBgClass}`}>
                            {renderCell(record, 'amount', formatCurrency(getUserData(record, identity.id, 'amount') || 0), identity.id)}
                          </td>
                        </React.Fragment>
                        );
                      })}
                      {/* 행별 총합계: 일반 행은 "-"로 표시 */}
                      <td className="px-4 py-2 text-center text-sm font-semibold dark:text-white bg-yellow-50 dark:bg-yellow-900/20 border-l-2 border-yellow-400 dark:border-yellow-600">
                        -
                      </td>
                    </tr>
                  ))
                )}
                
                {/* 합계 행 */}
                <tr className="bg-blue-50 dark:bg-gray-700 font-bold border-t-4 border-blue-500 dark:border-gray-600">
                  <td className="px-4 py-3 text-center font-bold text-blue-800 dark:text-white border-r border-gray-300 dark:border-gray-600">합계</td>
                  <td className="px-4 py-3 text-right font-bold text-blue-800 dark:text-white border-r border-gray-300 dark:border-gray-600">
                    {formatCurrency(totalRevenue)}
                  </td>
                  <td className="px-4 py-3 text-center font-bold text-blue-800 dark:text-white border-r-2 border-green-500 dark:border-green-400">-</td>
                  
                  {identities.map((identity) => (
                    <React.Fragment key={`total-${identity.id}`}>
                      <td className="px-2 py-3 text-center text-xs font-bold text-blue-800 dark:text-white border-r border-gray-300 dark:border-gray-600">-</td>
                      <td className="px-2 py-3 text-center text-xs font-bold text-blue-800 dark:text-white border-r border-gray-300 dark:border-gray-600">-</td>
                      <td className="px-2 py-3 text-center text-xs font-bold text-blue-800 dark:text-white border-r border-gray-300 dark:border-gray-600">-</td>
                      <td className="px-2 py-3 text-right text-xs font-bold text-blue-800 dark:text-white border-r-2 border-green-500 dark:border-green-400">
                        {formatCurrency(totalAmountsByIdentity.find(t => t.identity.id === identity.id)?.total || 0)}
                      </td>
                    </React.Fragment>
                  ))}
                  {/* 총합계: 수익 + 모든 명의별 금액 합계 */}
                  <td className="px-4 py-3 text-right text-sm font-bold text-yellow-700 dark:text-yellow-300 bg-yellow-100 dark:bg-yellow-900/30 border-l-2 border-yellow-400 dark:border-yellow-600">
                    {formatCurrency(grandTotal)}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}

export default SettlementManagement;
