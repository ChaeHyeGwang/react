import React, { useState, useEffect, useRef } from 'react';
import axiosInstance from '../api/axios';
import toast from 'react-hot-toast';
import { getIdentitiesCached } from '../api/identitiesCache';
import { calculateMarginSum } from '../utils/marginCalculations';

// 한국 시간 기준 날짜 문자열 반환 (YYYY-MM-DD)
function getKSTDateString(date = null) {
  const now = date ? new Date(date) : new Date();
  const kstDate = new Date(now.toLocaleString('en-US', {timeZone: 'Asia/Seoul'}));
  const year = kstDate.getFullYear();
  const month = String(kstDate.getMonth() + 1).padStart(2, '0');
  const day = String(kstDate.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function Finish({ isStartMode = false }) {
  const [identities, setIdentities] = useState([]);
  const [balances, setBalances] = useState({});
  const [withdrawalData, setWithdrawalData] = useState([]);
  const [manualWithdrawals, setManualWithdrawals] = useState([]); // 수동 추가된 취침 데이터
  const [coinWallet, setCoinWallet] = useState(0);
  const [cashOnHand, setCashOnHand] = useState(0);
  const [yesterdayBalance, setYesterdayBalance] = useState(0);
  const [startAmountTotal, setStartAmountTotal] = useState(0);
  const [drbetMarginTotal, setDrbetMarginTotal] = useState(0);
  const [selectedDate, setSelectedDate] = useState(getKSTDateString());
  const [editingCell, setEditingCell] = useState(null);
  const [editingValue, setEditingValue] = useState('');
  const [isSendingSettlement, setIsSendingSettlement] = useState(false);
  const [editingWithdrawalCell, setEditingWithdrawalCell] = useState(null); // { index, field } 형태로 편집 중인 취침 셀 추적
  const [isDataLoaded, setIsDataLoaded] = useState(false);
  const [isSavingWithdrawal, setIsSavingWithdrawal] = useState(false); // 저장 중 상태
  const inflightByDateRef = useRef(new Map());
  const lastSavedStartRef = useRef({ date: null, value: null });
  const dataMode = isStartMode ? 'start' : 'finish';
  const lastSavedManualWithdrawalsRef = useRef(null); // 마지막으로 저장된 manualWithdrawals 추적
  const saveQueueRef = useRef([]); // 저장 대기열
  const isSavingRef = useRef(false); // 저장 중 플래그 (ref로 관리)

  // 저장 대기열 처리 함수
  const processSaveQueue = async () => {
    if (isSavingRef.current || saveQueueRef.current.length === 0) {
      return;
    }
    
    isSavingRef.current = true;
    setIsSavingWithdrawal(true);
    
    while (saveQueueRef.current.length > 0) {
      const saveTask = saveQueueRef.current.shift();
      try {
        await saveTask();
      } catch (error) {
        console.error('저장 실패:', error);
      }
    }
    
    isSavingRef.current = false;
    setIsSavingWithdrawal(false);
  };

  // 날짜 변경 전에 저장되지 않은 데이터가 있는지 확인
  const handleDateChange = async (newDate) => {
    // 편집 중인 셀이 있으면 저장
    if (editingWithdrawalCell) {
      await saveManualWithdrawals();
    }
    
    // 날짜 변경 시에는 데이터 로드만 하고 저장하지 않음
    // 실제 데이터 수정/추가 시에만 저장
    setSelectedDate(newDate);
  };

  useEffect(() => {
    loadData();
    // eslint-disable-next-line
  }, [selectedDate]);

  // 수동 추가 취침 데이터 저장 (저장 대기열 사용)
  const saveManualWithdrawals = async () => {
    if (!editingWithdrawalCell) {
      return;
    }
    
    const { id, field } = editingWithdrawalCell;
    const currentEditingValue = editingValue; // 현재 편집 값 캡처
    const currentDate = selectedDate; // 현재 날짜 캡처
    
    // 먼저 편집 상태 초기화 (다음 편집을 위해)
    setEditingWithdrawalCell(null);
    setEditingValue('');
    
    // 날짜 형식 정규화 (YYYY-MM-DD 형식으로)
    const normalizedSelectedDate = currentDate.split(' ')[0];
    
    // 최신 manualWithdrawals를 기반으로 업데이트
    let updatedValue;
    if (field === 'identity') {
      updatedValue = { identity: currentEditingValue };
    } else if (field === 'site') {
      updatedValue = { site: currentEditingValue };
    } else if (field === 'amount') {
      updatedValue = { amount: parseFloat(currentEditingValue) || 0 };
    } else {
      return;
    }
    
    // Optimistic update (즉시 UI에 반영)
    setManualWithdrawals(prev => 
      prev.map(w => 
        w.id === id ? { ...w, ...updatedValue, record_date: (w.record_date || normalizedSelectedDate).split(' ')[0] } : w
      )
    );
    
    // 저장 작업을 대기열에 추가
    const saveTask = async () => {
      // 최신 상태에서 데이터 가져오기 (setManualWithdrawals의 최신 값 사용)
      return new Promise((resolve, reject) => {
        setManualWithdrawals(currentData => {
          // 현재 날짜의 데이터만 저장
          const dataToSave = currentData
            .filter(item => {
              const itemDate = (item.record_date || currentDate).split(' ')[0];
              return itemDate === normalizedSelectedDate;
            })
            .map(item => {
              const { isManual, ...rest } = item;
              return { ...rest, record_date: normalizedSelectedDate };
            });
          
          // 비동기 저장 실행
          axiosInstance.put('/finish/summary', {
            date: currentDate,
            cash_on_hand: cashOnHand,
            yesterday_balance: yesterdayBalance,
            coin_wallet: coinWallet,
            manual_withdrawals: JSON.stringify(dataToSave),
            start_amount_total: startAmountTotal,
            mode: dataMode
          }, {
            timeout: 30000
          }).then(() => {
            lastSavedManualWithdrawalsRef.current = currentData;
            resolve();
          }).catch((error) => {
            console.error('저장 실패:', error);
            toast.error('저장에 실패했습니다');
            reject(error);
          });
          
          // 상태는 변경하지 않음
          return currentData;
        });
      });
    };
    
    saveQueueRef.current.push(saveTask);
    processSaveQueue();
  };
  
  // 취침 데이터 편집 시작
  const startEditingWithdrawal = (id, field, currentValue) => {
    setEditingWithdrawalCell({ id, field });
    setEditingValue(currentValue || '');
  };
  
  // 수동 추가 데이터 저장 함수 (데이터를 파라미터로 받음 - 삭제 시 사용)
  const saveManualWithdrawalsWithData = async (dataToSave) => {
    const currentDate = selectedDate; // 현재 날짜 캡처
    const normalizedSelectedDate = currentDate.split(' ')[0];
    
    // 저장 작업을 대기열에 추가
    const saveTask = async () => {
      try {
        // 현재 날짜의 데이터만 필터링
        const dataToSaveFinal = (dataToSave || [])
          .filter(item => {
            const itemDate = item.record_date || currentDate;
            const normalizedItemDate = itemDate.split(' ')[0];
            return normalizedItemDate === normalizedSelectedDate;
          })
          .map(item => {
            const { isManual, ...rest } = item;
            return { ...rest, record_date: normalizedSelectedDate };
          });
        
        // 서버에 저장
        await axiosInstance.put('/finish/summary', {
          date: currentDate,
          cash_on_hand: cashOnHand,
          yesterday_balance: yesterdayBalance,
          coin_wallet: coinWallet,
          manual_withdrawals: JSON.stringify(dataToSaveFinal),
          start_amount_total: startAmountTotal,
          mode: dataMode
        }, {
          timeout: 30000
        });
        
        // 저장 성공 후 상태 업데이트
        setManualWithdrawals(prev => {
          const otherDatesData = prev.filter(item => {
            const itemDate = item.record_date || currentDate;
            const normalizedItemDate = itemDate.split(' ')[0];
            return normalizedItemDate !== normalizedSelectedDate;
          });
          const updated = [...dataToSaveFinal, ...otherDatesData];
          lastSavedManualWithdrawalsRef.current = updated;
          return updated;
        });
        
        toast.success('삭제되었습니다');
      } catch (error) {
        console.error('삭제 저장 실패:', error);
        toast.error('삭제에 실패했습니다. 다시 시도해주세요.');
        // 삭제 실패 시 데이터 복구 (로드)
        loadData();
      }
    };
    
    saveQueueRef.current.push(saveTask);
    await processSaveQueue();
  };

  const saveStartAmountTotal = async (value) => {
    try {
      // 시작 금액만 저장하고 manual_withdrawals와 coin_wallet은 서버에서 기존 값 유지
      // 서버에서 기존 summary를 조회하여 기존 값들을 유지
      const existingSummary = await axiosInstance.get('/finish/summary', {
        params: { date: selectedDate, mode: 'start' }
      });
      
      // 기존 coin_wallet 값 유지 (현재 상태값 대신 서버 값 사용)
      const existingCoinWallet = existingSummary.data.coin_wallet ?? coinWallet;
      
      await axiosInstance.put('/finish/summary', {
        date: selectedDate,
        cash_on_hand: cashOnHand,
        yesterday_balance: yesterdayBalance,
        coin_wallet: existingCoinWallet,  // 서버의 기존 값 유지
        manual_withdrawals: existingSummary.data.manual_withdrawals || null,
        start_amount_total: value,
        mode: 'start'
      }, {
        timeout: 30000
      });
    } catch (error) {
      toast.error('시작 금액 저장에 실패했습니다');
    }
  };

  const loadData = async () => {
    try {
      setIsDataLoaded(false);
      // dedupe by date
      const key = selectedDate;
      const existing = inflightByDateRef.current.get(key);
      if (existing) {
        await existing;
        setIsDataLoaded(true);
        return;
      }
      const runner = (async () => {
      // 🚀 모든 API를 병렬로 호출하여 로딩 속도 개선
      const [identitiesList, finishRes, drbetRes, summaryRes] = await Promise.all([
        getIdentitiesCached(),
        axiosInstance.get('/finish', { params: { date: selectedDate, mode: dataMode } }).catch(() => null),
        axiosInstance.get('/drbet').catch(() => ({ data: [] })),
        axiosInstance.get('/finish/summary', { params: { date: selectedDate, mode: dataMode } })
      ]);
      
      // 유저 목록 설정
      setIdentities(identitiesList || []);
      
      // 마무리 데이터 처리
      const balanceData = { '받치기': 0 };
      if (finishRes && Array.isArray(finishRes.data)) {
          finishRes.data.forEach(item => {
            balanceData[item.identity_name] = item.remaining_amount || 0;
          });
      } else if (!finishRes) {
        // 초기화 필요 시
        try {
        await axiosInstance.post('/finish/init', { date: selectedDate, mode: dataMode });
          const retryRes = await axiosInstance.get('/finish', { params: { date: selectedDate, mode: dataMode } });
          if (Array.isArray(retryRes.data)) {
            retryRes.data.forEach(item => {
            balanceData[item.identity_name] = item.remaining_amount || 0;
          });
        }
        } catch (initErr) {
          // 초기화 실패 무시
        }
      }
      setBalances(balanceData);
      
      // DR벳 데이터에서 환전 대기 정보 및 마진 합계 처리
        const withdrawals = [];
        let marginSum = 0;
        
        if (Array.isArray(drbetRes.data)) {
          // 선택된 날짜의 레코드만 필터링 및 정렬 (마진 합계 계산용)
          const selectedDateRecords = drbetRes.data
            .filter(record => record.record_date === selectedDate)
            .sort((a, b) => (a.display_order || 0) - (b.display_order || 0));
          
          // 환전 대기 목록 필터링
          const withdrawalRecords = drbetRes.data
            .filter(record => isStartMode ? record.record_date < selectedDate : record.record_date <= selectedDate)
            .sort((a, b) => {
              const dateCompare = b.record_date.localeCompare(a.record_date);
              return dateCompare !== 0 ? dateCompare : (a.display_order || 0) - (b.display_order || 0);
            });
          
          // 환전 대기 목록 추출
        withdrawalRecords.forEach((record) => {
            for (let i = 1; i <= 4; i++) {
            const chargeWithdrawData = record[`charge_withdraw${i}`];
              
              if (chargeWithdrawData) {
              if (chargeWithdrawData.includes('ㄷ')) {
                  const parts = chargeWithdrawData.trim().split(/\s+/);
                  if (parts.length >= 2) {
                    const withdrawAmount = parseInt(parts[1]) || 0;
                    if (withdrawAmount > 0) {
                      withdrawals.push({
                      identity: record[`identity${i}`] || '',
                      site: record[`site_name${i}`] || `사이트${i}`,
                        amount: withdrawAmount * 10000,
                        record_date: record.record_date
                      });
                    }
                  }
                }
              } else {
              const siteData = record[`site${i}`];
              if (siteData && siteData.includes('ㄷ')) {
                  const parts = siteData.trim().split(/\s+/);
                  if (parts.length >= 2) {
                    const withdrawAmount = parseInt(parts[1]) || 0;
                  if (withdrawAmount > 0) {
                      withdrawals.push({
                      identity: record[`identity${i}`] || '',
                        site: parts[0],
                        amount: withdrawAmount * 10000,
                        record_date: record.record_date
                      });
                    }
                  }
                }
              }
            }
          });
          
        // 마진 합계 계산 (공통 유틸리티 사용)
        marginSum = calculateMarginSum(selectedDateRecords);
        }
        
        setWithdrawalData(withdrawals);
        setDrbetMarginTotal(marginSum);
      
      // 요약 정보 처리
      setCashOnHand(summaryRes.data.cash_on_hand || 0);
      setYesterdayBalance(summaryRes.data.yesterday_balance || 0);
      setCoinWallet(summaryRes.data.coin_wallet || 0);
      if (summaryRes.data.start_amount_total !== undefined && summaryRes.data.start_amount_total !== null) {
        setStartAmountTotal(summaryRes.data.start_amount_total);
      }
      
      // 수동 추가된 취침 데이터 처리
      const normalizedSelectedDate = selectedDate.split(' ')[0];
      const manualData = summaryRes.data.manual_withdrawals;
      
      if (manualData && manualData !== '' && (typeof manualData === 'string' ? manualData.trim() !== '' : true)) {
        try {
          const savedData = typeof manualData === 'string' ? JSON.parse(manualData) : manualData;
          
          if (Array.isArray(savedData) && savedData.length > 0) {
            const loadedData = savedData.map(item => {
              const { isManual, ...rest } = item;
              const itemDate = rest.record_date || selectedDate;
              return { ...rest, record_date: itemDate.split(' ')[0] };
            });
            
            setManualWithdrawals(prev => {
              const otherDatesData = prev.filter(item => {
                const normalizedItemDate = (item.record_date || selectedDate).split(' ')[0];
                return normalizedItemDate !== normalizedSelectedDate;
              });
              const updated = [...loadedData, ...otherDatesData];
              lastSavedManualWithdrawalsRef.current = updated;
              return updated;
            });
          } else {
            setManualWithdrawals(prev => {
              const filtered = prev.filter(item => {
                const normalizedItemDate = (item.record_date || selectedDate).split(' ')[0];
                return normalizedItemDate !== normalizedSelectedDate;
              });
              lastSavedManualWithdrawalsRef.current = filtered;
              return filtered;
            });
          }
        } catch (err) {
          setManualWithdrawals(prev => {
            const filtered = prev.filter(item => {
              const normalizedItemDate = (item.record_date || selectedDate).split(' ')[0];
              return normalizedItemDate !== normalizedSelectedDate;
            });
            lastSavedManualWithdrawalsRef.current = filtered;
            return filtered;
          });
        }
      } else {
        setManualWithdrawals(prev => {
          const filtered = prev.filter(item => {
            const normalizedItemDate = (item.record_date || selectedDate).split(' ')[0];
            return normalizedItemDate !== normalizedSelectedDate;
          });
          lastSavedManualWithdrawalsRef.current = filtered;
          return filtered;
        });
      }
      
    })();
    inflightByDateRef.current.set(key, runner);
    await runner;
    inflightByDateRef.current.delete(key);
    setIsDataLoaded(true);
    } catch (error) {
      toast.error('데이터를 불러오는 중 오류가 발생했습니다.');
      setIsDataLoaded(true);
    }
  };

  const formatCurrency = (amount) => {
    if (!amount && amount !== 0) return '0';
    return amount.toLocaleString('ko-KR');
  };

  const handleBalanceCellDoubleClick = (identityName) => {
    const currentValue = balances[identityName] || 0;
    setEditingCell({ type: 'balance', identityName });
    setEditingValue(currentValue);
  };

  const handleCoinWalletDoubleClick = () => {
    setEditingCell({ type: 'coin' });
    setEditingValue(coinWallet);
  };

  const handleCellBlur = async () => {
    if (!editingCell) return;

    const value = parseFloat(editingValue) || 0;

    try {
      if (editingCell.type === 'balance') {
        const { identityName } = editingCell;

        await axiosInstance.put(`/finish/${identityName}`, {
          remaining_amount: value,
          date: selectedDate,
          mode: dataMode
        });
        
        setBalances({
          ...balances,
          [identityName]: value
        });
      } else if (editingCell.type === 'cash') {
        await handleSummaryUpdate('cash', value);
        setCashOnHand(value);
      } else if (editingCell.type === 'coin') {
        // coin_wallet만 저장하고 manual_withdrawals는 서버에서 기존 값 유지
        const existingSummary = await axiosInstance.get('/finish/summary', {
          params: { date: selectedDate, mode: dataMode }
        });
        
        await axiosInstance.put('/finish/summary', {
          date: selectedDate,
          cash_on_hand: cashOnHand,
          yesterday_balance: yesterdayBalance,
          coin_wallet: value,
          manual_withdrawals: existingSummary.data.manual_withdrawals || null,
          start_amount_total: startAmountTotal,
          mode: dataMode
        });
        setCoinWallet(value);
      }
      toast.success('수정되었습니다');
    } catch (error) {
      toast.error('수정에 실패했습니다');
    }

    setEditingCell(null);
    setEditingValue('');
  };

  const handleSummaryUpdate = async (field, value) => {
    try {
      // cash_on_hand나 yesterday_balance만 저장하고 manual_withdrawals는 서버에서 기존 값 유지
      const existingSummary = await axiosInstance.get('/finish/summary', {
        params: { date: selectedDate, mode: dataMode }
      });
      
      const updateData = {
        date: selectedDate,
        cash_on_hand: field === 'cash' ? value : cashOnHand,
        yesterday_balance: field === 'yesterday' ? value : yesterdayBalance,
        coin_wallet: coinWallet,
        manual_withdrawals: existingSummary.data.manual_withdrawals || null,
        start_amount_total: startAmountTotal,
        mode: dataMode
      };
      
      await axiosInstance.put('/finish/summary', updateData);
      
      if (field === 'cash') {
        setCashOnHand(value);
      } else {
        setYesterdayBalance(value);
      }
      
      toast.success('수정되었습니다');
    } catch (error) {
      toast.error('수정에 실패했습니다');
    }
  };

  const handleKeyPress = (e) => {
    if (e.key === 'Enter') {
      handleCellBlur();
    } else if (e.key === 'Escape') {
      setEditingCell(null);
      setEditingValue('');
    }
  };

  // 취침 데이터 편집 키보드 처리
  const handleWithdrawalKeyDown = (e) => {
    if (e.key === 'Enter') {
      saveManualWithdrawals();
    } else if (e.key === 'Escape') {
      setEditingWithdrawalCell(null);
      setEditingValue('');
    }
  };

  // 정산 버튼 클릭 핸들러
  const handleSendSettlement = async (options = {}) => {
    try {
      setIsSendingSettlement(true);
      const { startOnly = false } = options;
      
      const balanceTotal = Object.values(balances).reduce((sum, val) => sum + (parseFloat(val) || 0), 0);
      const withdrawalTotal = withdrawalData.reduce((sum, item) => sum + (parseFloat(item.amount) || 0), 0);
      // 현재 선택된 날짜의 수동 취침 데이터만 합계에 포함
      const manualWithdrawalTotal = manualWithdrawals
        .filter(item => item.record_date === selectedDate)
        .reduce((sum, item) => sum + (parseFloat(item.amount) || 0), 0);
      const computedStartTotal = balanceTotal + withdrawalTotal + manualWithdrawalTotal + coinWallet;
      const startBreakdown = {
        balances: balanceTotal,
        autoWithdrawals: withdrawalTotal,
        manualWithdrawals: manualWithdrawalTotal,
        coinWallet,
        total: computedStartTotal
      };
      const totalBalance = balanceTotal + withdrawalTotal + manualWithdrawalTotal + coinWallet;
      const startTotals = startAmountTotal > 0 ? startAmountTotal : computedStartTotal;
      const startBaseAmount = isStartMode ? startTotals : (yesterdayBalance || startTotals);
      const todayProfit = totalBalance - startBaseAmount;
      const finalDifference = todayProfit - drbetMarginTotal;

      if (startOnly) {
        const payload = {
          date: selectedDate,
          summary: {
            mode: 'start',
            startAmountTotal: startTotalValue,
            startBreakdown,
            cashOnHand,
            specialNotes: []
          }
        };
        const response = await axiosInstance.post('/telegram/send-settlement', payload);
        if (response.data.success) {
          toast.success('시작 금액 합산을 텔레그램으로 발송했습니다!');
        }
        return;
      }

      // 드뱃 데이터에서 특이사항 가져오기 (오늘 날짜만)
      const drbetRes = await axiosInstance.get('/drbet');
      let notesList = [];
      const notesSet = new Set(); // 중복 제거를 위한 Set
      
      if (Array.isArray(drbetRes.data)) {
        const selectedDateRecords = drbetRes.data.filter(record => record.record_date === selectedDate);
        
        for (const record of selectedDateRecords) {
          if (record.notes) {
            const parts = record.notes.split('/');
            for (const part of parts) {
              // 빈 문자열 필터링
              const trimmedPart = part.trim();
              if (!trimmedPart) continue;
              
              const match = trimmedPart.match(/^(칩실수|칩팅|배거)(.+?)(\d+)(먹|못먹)/);
              if (match) {
                // 중복 체크 - 같은 내용이 이미 있으면 추가하지 않음
                if (!notesSet.has(trimmedPart)) {
                  notesSet.add(trimmedPart);
                  notesList.push({
                    site: match[2],
                    content: trimmedPart
                  });
                }
              }
            }
          }
        }
      }
      
      // 정산 관리에서 기존 특이사항을 가져오는 로직 제거
      // 오늘 날짜의 DR벳 데이터에서만 파싱한 특이사항을 사용하여 이전 데이터가 누적되지 않도록 함

      const settlementData = {
        date: selectedDate,
        summary: {
          cashOnHand,
          startAmountTotal: startTotals,
          totalBalance: totalBalance,
          todayProfit: todayProfit,
          drbetMargin: drbetMarginTotal,
          finalDifference: finalDifference,
          specialNotes: notesList,  // 특이사항 정보 추가
          mode: isStartMode ? 'start' : 'finish'
        }
      };

      const response = await axiosInstance.post('/telegram/send-settlement', settlementData);
      
      if (response.data.success) {
        toast.success('텔레그램으로 정산 요약이 전송되었습니다! 🎉');
        if (response.data.settlementUpdated) {
          toast.success('정산 관리에 수익이 등록되었습니다!');
        }
      }
    } catch (error) {
      if (error.response?.data?.error) {
        toast.error(error.response.data.error);
      } else {
        toast.error('정산 전송에 실패했습니다');
      }
    } finally {
      setIsSendingSettlement(false);
    }
  };

  const renderBalanceCell = (identityName) => {
    const isEditing = editingCell?.type === 'balance' && editingCell?.identityName === identityName;
    const value = balances[identityName] || 0;
    
    if (isEditing) {
      return (
        <input
          type="number"
          value={editingValue}
          onChange={(e) => setEditingValue(e.target.value)}
          onBlur={handleCellBlur}
          onKeyDown={handleKeyPress}
          onFocus={(e) => {
            if (e.target.value === '0') {
              e.target.value = '';
              setEditingValue('');
            }
          }}
          autoFocus
          className="w-full px-2 py-1 border border-blue-500 dark:border-blue-400 bg-white dark:bg-gray-700 text-gray-900 dark:text-white rounded focus:outline-none focus:ring-2 focus:ring-blue-500 hover:bg-gray-50 dark:hover:bg-gray-800"
        />
      );
    }

    return (
      <div
        onClick={() => handleBalanceCellDoubleClick(identityName)}
        className="cursor-pointer hover:bg-blue-50 dark:hover:bg-gray-700 px-2 py-1 text-right dark:text-white"
        title="클릭하여 수정"
      >
        {formatCurrency(value)}원
      </div>
    );
  };

  const renderCoinWalletCell = () => {
    const isEditing = editingCell?.type === 'coin';
    
    if (isEditing) {
      return (
        <input
          type="number"
          value={editingValue}
          onChange={(e) => setEditingValue(e.target.value)}
          onBlur={handleCellBlur}
          onKeyDown={handleKeyPress}
          onFocus={(e) => {
            if (e.target.value === '0') {
              e.target.value = '';
              setEditingValue('');
            }
          }}
          autoFocus
          className="w-full px-2 py-1 border border-blue-500 dark:border-blue-400 bg-white dark:bg-gray-700 text-gray-900 dark:text-white rounded focus:outline-none focus:ring-2 focus:ring-blue-500 hover:bg-gray-50 dark:hover:bg-gray-800"
        />
      );
    }

    return (
      <div
        onClick={handleCoinWalletDoubleClick}
        className="cursor-pointer hover:bg-blue-50 dark:hover:bg-gray-700 px-2 py-1 text-right dark:text-white"
        title="클릭하여 수정"
      >
        {formatCurrency(coinWallet)}원
      </div>
    );
  };

  // 총합 계산 (받치기 제외, 유저들만)
  const balanceTotal = Array.isArray(identities) 
    ? identities.reduce((sum, identity) => {
        const name = identity?.name;
        // 받치기는 제외
        if (name === '받치기') return sum;
        return sum + (parseFloat(balances[name]) || 0);
      }, 0)
    : 0;

  const withdrawalTotal = withdrawalData.reduce((sum, item) => sum + item.amount, 0);
  // 현재 선택된 날짜의 수동 취침 데이터만 합계에 포함
  const manualWithdrawalTotal = manualWithdrawals
    .filter(item => item.record_date === selectedDate)
    .reduce((sum, item) => sum + (item.amount || 0), 0);
  const remainWithBase = (balances['받치기'] || 0) + balanceTotal;
  const startTotalValue = remainWithBase + withdrawalTotal + manualWithdrawalTotal + coinWallet;
  useEffect(() => {
    if (!isStartMode || !isDataLoaded) return;
    setStartAmountTotal(startTotalValue);
  }, [isStartMode, isDataLoaded, startTotalValue]);

  useEffect(() => {
    if (!isStartMode || !isDataLoaded) return;
    if (!isFinite(startTotalValue)) return;

    if (
      lastSavedStartRef.current.date === selectedDate &&
      lastSavedStartRef.current.value === startTotalValue
    ) {
      return;
    }

    saveStartAmountTotal(startTotalValue);
    lastSavedStartRef.current = { date: selectedDate, value: startTotalValue };
  }, [
    isStartMode,
    isDataLoaded,
    startTotalValue,
    selectedDate
    // cashOnHand, yesterdayBalance, coinWallet은 startTotalValue에 이미 반영됨
    // 개별 필드 변경 시 불필요한 저장 방지
  ]);

  return (
    <div className="p-6 w-full">
      <div className="mb-6">
        <h1 className="text-3xl font-bold text-gray-900 dark:text-white mb-2">
          {isStartMode ? '🚀 시작' : '🏁 마무리'}
        </h1>
        <p className="text-gray-600 dark:text-white">
          {isStartMode ? '금일 시작 금액 산출 및 관리' : '유저별 잔액 및 환전 대기 현황'}
        </p>
        
        <p className="text-sm text-blue-600 mt-1">💡 셀을 클릭하여 수정하세요</p>
        
        {/* 날짜 선택 */}
        <div className="flex items-center gap-4 bg-white dark:bg-[#282C34] p-4 rounded-lg shadow mt-4">
          <label className="font-bold text-gray-700 dark:text-white">📅 날짜 선택:</label>
          <input
            type="date"
            value={selectedDate}
            onChange={(e) => handleDateChange(e.target.value)}
            className="border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-md px-4 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <div className="flex gap-2">
            <button
              onClick={() => {
                const date = new Date(selectedDate);
                date.setDate(date.getDate() - 1);
                handleDateChange(getKSTDateString(date));
              }}
              className="px-3 py-2 bg-gray-200 dark:bg-gray-700 dark:text-white rounded hover:bg-gray-300 dark:hover:bg-gray-600"
            >
              ◀ 이전
            </button>
            <button
              onClick={() => handleDateChange(getKSTDateString())}
              className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600 font-medium"
            >
              오늘
            </button>
            <button
              onClick={() => {
                const date = new Date(selectedDate);
                date.setDate(date.getDate() + 1);
                handleDateChange(getKSTDateString(date));
              }}
              className="px-3 py-2 bg-gray-200 dark:bg-gray-700 dark:text-white rounded hover:bg-gray-300 dark:hover:bg-gray-600"
            >
              다음 ▶
            </button>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-6">
        {/* 1. 남은금액 테이블 */}
        <div className="bg-white dark:bg-[#282C34] rounded-lg shadow overflow-hidden">
          <h2 className="text-xl font-bold text-gray-900 dark:text-white p-4 bg-blue-50 dark:bg-[#282C34]">💰 남은금액</h2>
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50 dark:bg-[#282C34]">
                <tr>
                  <th className="px-4 py-3 text-center text-xs font-bold text-gray-700 dark:text-white uppercase">유저</th>
                  <th className="px-4 py-3 text-center text-xs font-bold text-gray-700 dark:text-white uppercase">남은금액</th>
                </tr>
              </thead>
              <tbody className="bg-white dark:bg-[#282C34] divide-y divide-gray-200 dark:divide-gray-700">
                {/* 받치기 행 (항상 먼저 표시) */}
                <tr className="hover:bg-gray-50 dark:hover:bg-gray-700">
                  <td className="px-4 py-2 text-sm font-semibold text-gray-900 dark:text-white text-left">
                    받치기
                  </td>
                  <td className="px-4 py-2 text-sm text-right dark:text-white dark:bg-[#282C34]">
                    {renderBalanceCell('받치기')}
                  </td>
                </tr>
                
                {/* 유저별 행 */}
                {!Array.isArray(identities) || identities.length === 0 ? (
                  <tr>
                    <td colSpan={2} className="px-6 py-4 text-center text-gray-500 dark:text-white text-xs">
                      유저 정보를 불러오는 중...
                    </td>
                  </tr>
                ) : (
                  (() => {
                    const validIdentities = identities.filter(identity => {
                      const isValid = identity && typeof identity === 'object' && identity.name;
                      return isValid;
                    });
                    return validIdentities.map((identity, index) => (
                      <tr key={`balance-${identity.id || index}`} className="hover:bg-gray-50 dark:hover:bg-gray-700">
                        <td className="px-4 py-2 text-sm font-semibold text-gray-900 dark:text-white text-left">
                          {identity.name}
                        </td>
                        <td className="px-4 py-2 text-sm text-right dark:text-white dark:bg-[#282C34]">
                          {renderBalanceCell(identity.name)}
                        </td>
                      </tr>
                    ));
                  })()
                )}
                {/* 합계 행 (받치기 + 유저들) */}
                <tr className="bg-blue-100 dark:bg-gray-700 font-bold">
                  <td className="px-4 py-3 text-sm text-center dark:text-white">합계</td>
                  <td className="px-4 py-3 text-sm text-right dark:text-white">
                    {formatCurrency((balances['받치기'] || 0) + balanceTotal)}원
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        {/* 2. 사이트취침 (환전 대기) 테이블 */}
        <div className="bg-white dark:bg-[#282C34] rounded-lg shadow overflow-hidden">
          <div className="flex justify-between items-center p-4 bg-purple-50 dark:bg-[#282C34]">
            <div className="flex items-center gap-2">
              <h2 className="text-xl font-bold text-gray-900 dark:text-white">🌙 사이트취침 (환전 대기)</h2>
              {isSavingWithdrawal && (
                <span className="text-sm text-blue-600 dark:text-blue-400 animate-pulse">저장 중...</span>
              )}
            </div>
            <button
              onClick={() => {
                const tempId = `manual_${Date.now()}`;
                // 날짜 형식 정규화 (YYYY-MM-DD 형식으로)
                const normalizedSelectedDate = selectedDate.split(' ')[0];
                const newRow = {
                  id: tempId,
                  identity: '',
                  site: '',
                  amount: 0,
                  record_date: normalizedSelectedDate, // 현재 선택된 날짜 추가 (정규화)
                  isManual: true
                };
                const updated = [...manualWithdrawals, newRow];
                setManualWithdrawals(updated);
                startEditingWithdrawal(tempId, 'identity', '');
              }}
              className="bg-green-600 text-white px-4 py-2 rounded-md hover:bg-green-700 font-bold text-sm"
            >
              + 행추가
            </button>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50 dark:bg-[#282C34]">
                <tr>
                  <th className="px-4 py-3 text-center text-xs font-bold text-gray-700 dark:text-white uppercase">날짜</th>
                  <th className="px-4 py-3 text-center text-xs font-bold text-gray-700 dark:text-white uppercase">유저</th>
                  <th className="px-4 py-3 text-center text-xs font-bold text-gray-700 dark:text-white uppercase">사이트</th>
                  <th className="px-4 py-3 text-center text-xs font-bold text-gray-700 dark:text-white uppercase">금액</th>
                  <th className="px-4 py-3 text-center text-xs font-bold text-gray-700 dark:text-white uppercase w-20">삭제</th>
                </tr>
              </thead>
              <tbody className="bg-white dark:bg-[#282C34] divide-y divide-gray-200 dark:divide-gray-700">
                {/* DRBet에서 가져온 자동 데이터 */}
                {withdrawalData.map((item, index) => (
                  <tr key={`withdrawal-auto-${index}-${item.identity}-${item.site}`} className="hover:bg-gray-50 dark:hover:bg-gray-700">
                    <td className="px-4 py-2 text-sm text-gray-600 dark:text-gray-300 text-center">
                      {item.record_date || '-'}
                    </td>
                    <td className="px-4 py-2 text-sm font-semibold text-gray-900 dark:text-white text-left">
                      {item.identity || '-'}
                    </td>
                    <td className="px-4 py-2 text-sm font-semibold text-gray-900 dark:text-white text-left">
                      {item.site}
                    </td>
                    <td className="px-4 py-2 text-sm text-right dark:text-white">
                      {formatCurrency(item.amount)}원
                    </td>
                    <td className="px-4 py-2 text-center">
                      {/* 자동 데이터는 삭제 불가 */}
                    </td>
                  </tr>
                ))}
                
                {/* 수동 추가된 데이터 - 현재 선택된 날짜의 데이터만 표시 */}
                {(() => {
                  // 날짜 형식 정규화 (YYYY-MM-DD 형식으로)
                  const normalizedSelectedDate = selectedDate.split(' ')[0];
                  
                  const filteredData = manualWithdrawals.filter(item => {
                    const itemDate = item.record_date || selectedDate;
                    const normalizedItemDate = itemDate.split(' ')[0];
                    const matches = normalizedItemDate === normalizedSelectedDate;
                    return matches;
                  });
                  return filteredData;
                })().map((item) => {
                  const isEditingIdentity = editingWithdrawalCell?.id === item.id && editingWithdrawalCell?.field === 'identity';
                  const isEditingSite = editingWithdrawalCell?.id === item.id && editingWithdrawalCell?.field === 'site';
                  const isEditingAmount = editingWithdrawalCell?.id === item.id && editingWithdrawalCell?.field === 'amount';
                  
                  return (
                    <tr key={item.id} className="hover:bg-gray-50 dark:hover:bg-gray-700 bg-yellow-50 dark:bg-gray-700">
                      <td className="px-4 py-2 text-sm text-gray-600 dark:text-gray-300 text-center">
                        {item.record_date || selectedDate}
                      </td>
                      <td className="px-4 py-2 text-left">
                        {isEditingIdentity ? (
                          <input
                            type="text"
                            value={editingValue}
                            onChange={(e) => setEditingValue(e.target.value)}
                            onBlur={saveManualWithdrawals}
                            onKeyDown={handleWithdrawalKeyDown}
                            autoFocus
                            className="w-full px-2 py-1 border border-blue-500 dark:border-blue-400 dark:bg-gray-700 dark:text-white rounded focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm hover:bg-gray-50 dark:hover:bg-gray-800"
                          />
                        ) : (
                          <div
                            onClick={() => {
                              startEditingWithdrawal(item.id, 'identity', item.identity);
                            }}
                            className="px-2 py-1 text-sm font-semibold text-gray-900 dark:text-white cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-700 rounded text-left"
                          >
                            {item.identity || '클릭하여 입력'}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-2 text-left">
                        {isEditingSite ? (
                          <input
                            type="text"
                            value={editingValue}
                            onChange={(e) => setEditingValue(e.target.value)}
                            onBlur={saveManualWithdrawals}
                            onKeyDown={handleWithdrawalKeyDown}
                            autoFocus
                            className="w-full px-2 py-1 border border-blue-500 dark:border-blue-400 dark:bg-gray-700 dark:text-white rounded focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm hover:bg-gray-50 dark:hover:bg-gray-800"
                          />
                        ) : (
                          <div
                            onClick={() => {
                              startEditingWithdrawal(item.id, 'site', item.site);
                            }}
                            className="px-2 py-1 text-sm font-semibold text-gray-900 dark:text-white cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-700 rounded text-left"
                          >
                            {item.site || '클릭하여 입력'}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-2 text-right">
                        {isEditingAmount ? (
                          <input
                            type="number"
                            value={editingValue}
                            onChange={(e) => setEditingValue(e.target.value)}
                            onBlur={saveManualWithdrawals}
                            onKeyDown={handleWithdrawalKeyDown}
                            autoFocus
                            className="w-full px-2 py-1 border border-blue-500 dark:border-blue-400 dark:bg-gray-700 dark:text-white rounded focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm text-right hover:bg-gray-50 dark:hover:bg-gray-800"
                          />
                        ) : (
                          <div
                            onClick={() => {
                              startEditingWithdrawal(item.id, 'amount', item.amount ? item.amount.toString() : '');
                            }}
                            className="px-2 py-1 text-sm text-right cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-700 rounded dark:text-white"
                          >
                            {item.amount ? formatCurrency(item.amount) + '원' : '클릭하여 입력'}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-2 text-center">
                        <button
                          onClick={async () => {
                            if (isSavingWithdrawal) return; // 저장 중이면 무시
                            const updated = manualWithdrawals.filter(w => w.id !== item.id);
                            setManualWithdrawals(updated);
                            await saveManualWithdrawalsWithData(updated);
                          }}
                          disabled={isSavingWithdrawal}
                          className={`px-3 py-1 text-white rounded text-sm ${
                            isSavingWithdrawal 
                              ? 'bg-gray-400 cursor-not-allowed' 
                              : 'bg-red-500 hover:bg-red-600'
                          }`}
                        >
                          {isSavingWithdrawal ? '저장중' : '삭제'}
                        </button>
                      </td>
                    </tr>
                  );
                })}
                
                {/* 빈 상태 메시지 */}
                {(() => {
                  // 날짜 형식 정규화 (YYYY-MM-DD 형식으로)
                  const normalizedSelectedDate = selectedDate.split(' ')[0];
                  const filteredManualWithdrawals = manualWithdrawals.filter(item => {
                    const itemDate = item.record_date || selectedDate;
                    const normalizedItemDate = itemDate.split(' ')[0];
                    return normalizedItemDate === normalizedSelectedDate;
                  });
                  return withdrawalData.length === 0 && filteredManualWithdrawals.length === 0;
                })() && (
                  <tr>
                    <td colSpan={5} className="px-6 py-8 text-center text-gray-500 dark:text-white">
                      환전 대기 내역이 없습니다
                    </td>
                  </tr>
                )}
                
                {/* 합계 */}
                {(() => {
                  // 날짜 형식 정규화 (YYYY-MM-DD 형식으로)
                  const normalizedSelectedDate = selectedDate.split(' ')[0];
                  const filteredManualWithdrawals = manualWithdrawals.filter(item => {
                    const itemDate = item.record_date || selectedDate;
                    const normalizedItemDate = itemDate.split(' ')[0];
                    return normalizedItemDate === normalizedSelectedDate;
                  });
                  return withdrawalData.length > 0 || filteredManualWithdrawals.length > 0;
                })() && (
                  <tr className="bg-purple-100 dark:bg-gray-700 font-bold">
                    <td colSpan={3} className="px-4 py-3 text-sm text-center dark:text-white">합계</td>
                    <td className="px-4 py-3 text-sm text-right dark:text-white">
                      {formatCurrency(
                        withdrawalTotal + (() => {
                          // 날짜 형식 정규화 (YYYY-MM-DD 형식으로)
                          const normalizedSelectedDate = selectedDate.split(' ')[0];
                          return manualWithdrawals
                            .filter(item => {
                              const itemDate = item.record_date || selectedDate;
                              const normalizedItemDate = itemDate.split(' ')[0];
                              return normalizedItemDate === normalizedSelectedDate;
                            })
                            .reduce((sum, item) => sum + (item.amount || 0), 0);
                        })()
                      )}원
                    </td>
                    <td className="px-4 py-3"></td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* 3. 코인지갑 테이블 */}
        <div className="bg-white dark:bg-[#282C34] rounded-lg shadow overflow-hidden">
          <h2 className="text-xl font-bold text-gray-900 dark:text-white p-4 bg-indigo-50 dark:bg-[#282C34]">💎 코인지갑</h2>
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50 dark:bg-[#282C34]">
                <tr>
                  <th className="px-4 py-3 text-center text-xs font-bold text-gray-700 dark:text-white uppercase">남은금액</th>
                </tr>
              </thead>
              <tbody className="bg-white dark:bg-[#282C34]">
                <tr className="hover:bg-gray-50 dark:hover:bg-gray-700">
                  <td className="px-4 py-4 text-center text-2xl font-bold text-indigo-600 dark:text-indigo-400 dark:bg-[#282C34]">
                    {renderCoinWalletCell()}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {isStartMode && (
        <div className="bg-white dark:bg-[#282C34] rounded-lg shadow p-6 max-w-4xl mx-auto mb-8">
          <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-4">🔢 시작 금액 합산</h2>
          <div className="flex justify-between items-center p-4 rounded-lg border-2 mb-4 bg-gray-100 dark:bg-gray-700 border-gray-300 dark:border-gray-600">
            <span className="font-bold text-gray-800 dark:text-white text-lg">시제:</span>
            {editingCell?.type === 'cash' ? (
              <input
                type="number"
                value={editingValue}
                onChange={(e) => setEditingValue(e.target.value)}
                onBlur={() => {
                  const value = parseFloat(editingValue) || 0;
                  setCashOnHand(value);
                  handleSummaryUpdate('cash', value);
                  setEditingCell(null);
                  setEditingValue('');
                }}
                onKeyDown={handleKeyPress}
                onFocus={(e) => {
                  if (e.target.value === '0') {
                    e.target.value = '';
                    setEditingValue('');
                  }
                }}
                autoFocus
                className="w-40 px-3 py-2 text-right border border-blue-500 dark:border-blue-400 dark:bg-gray-700 dark:text-white rounded-lg font-bold text-lg focus:outline-none focus:ring-2 focus:ring-blue-500 hover:bg-gray-50 dark:hover:bg-gray-800"
              />
            ) : (
              <span
                onClick={() => {
                  setEditingCell({ type: 'cash' });
                  setEditingValue(cashOnHand.toString());
                }}
                className="text-2xl font-bold cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700 px-3 py-1 rounded text-gray-700 dark:text-white pr-2"
                title="클릭하여 수정"
              >
                {formatCurrency(cashOnHand)}원
              </span>
            )}
          </div>
          <div className="flex items-center justify-between bg-gray-100 dark:bg-gray-700 rounded-lg p-4 border border-gray-200 dark:border-gray-600">
            <span className="text-lg font-semibold text-gray-700 dark:text-gray-200">오늘 시작 금액 총합</span>
            <span className="text-3xl font-bold text-blue-600 dark:text-blue-400">
              {formatCurrency(startTotalValue)}원
            </span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-4 text-sm text-gray-700 dark:text-gray-200">
            <div className="p-3 rounded bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700">
              <span className="font-semibold">남은금액 합계</span>
              <div className="text-xl font-bold">{formatCurrency(remainWithBase)}원</div>
            </div>
            <div className="p-3 rounded bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700">
              <span className="font-semibold">사이트 취침</span>
              <div className="text-xl font-bold">{formatCurrency(withdrawalTotal)}원</div>
            </div>
            <div className="p-3 rounded bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700">
              <span className="font-semibold">수동 취침</span>
              <div className="text-xl font-bold">{formatCurrency(manualWithdrawalTotal)}원</div>
            </div>
            <div className="p-3 rounded bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700">
              <span className="font-semibold">코인지갑</span>
              <div className="text-xl font-bold">{formatCurrency(coinWallet)}원</div>
            </div>
          </div>
          <div className="mt-4 flex justify-center">
            <button
              onClick={() => handleSendSettlement({ startOnly: true })}
              disabled={isSendingSettlement}
              className={`px-6 py-3 rounded-lg font-bold text-lg transition-all ${
                isSendingSettlement
                  ? 'bg-gray-400 cursor-not-allowed'
                  : 'bg-indigo-600 hover:bg-indigo-700 text-white shadow-lg hover:shadow-xl'
              }`}
            >
              {isSendingSettlement ? '전송 중...' : '📤 시작 금액 발송'}
            </button>
          </div>
        </div>
      )}

      {!isStartMode && (
        <div className="bg-white dark:bg-[#282C34] rounded-lg shadow p-6 max-w-2xl mx-auto">
        <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-6 text-center">정산 요약</h2>
        
        {(() => {
          const startBaseAmount = startAmountTotal > 0 ? startAmountTotal : yesterdayBalance;
          const totalBalanceValue = (balances['받치기'] || 0) + balanceTotal + withdrawalTotal + manualWithdrawalTotal + coinWallet;
          const todayProfitValue = totalBalanceValue - startBaseAmount;
          const finalDifferenceValue = todayProfitValue - drbetMarginTotal;

          return (
            <>
              <div className="space-y-3">
                {/* 시제 */}
                {/* 시제 */}
                <div className="flex justify-between items-center p-4 rounded-lg border-2 mb-3 bg-gray-100 dark:bg-gray-700 border-gray-300 dark:border-gray-600">
                  <span className="font-bold text-gray-800 dark:text-white text-lg">시제:</span>
                  {editingCell?.type === 'cash' ? (
                    <input
                      type="number"
                      value={editingValue}
                      onChange={(e) => setEditingValue(e.target.value)}
                      onBlur={() => {
                        const value = parseFloat(editingValue) || 0;
                        setCashOnHand(value);
                        handleSummaryUpdate('cash', value);
                        setEditingCell(null);
                        setEditingValue('');
                      }}
                      onKeyDown={handleKeyPress}
                      onFocus={(e) => {
                        if (e.target.value === '0') {
                          e.target.value = '';
                          setEditingValue('');
                        }
                      }}
                      autoFocus
                      className="w-40 px-3 py-2 text-right border border-blue-500 dark:border-blue-400 dark:bg-gray-700 dark:text-white rounded-lg font-bold text-lg focus:outline-none focus:ring-2 focus:ring-blue-500 hover:bg-gray-50 dark:hover:bg-gray-800"
                    />
                  ) : (
                    <span
                      onClick={() => {
                        setEditingCell({ type: 'cash' });
                        setEditingValue(cashOnHand.toString());
                      }}
                      className="text-2xl font-bold cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700 px-3 py-1 rounded text-gray-700 dark:text-white pr-2"
                      title="클릭하여 수정"
                    >
                      {formatCurrency(cashOnHand)}원
                    </span>
                  )}
                </div>
                
                <div className="border-t-2 border-gray-300 pt-4 mt-4">
                  {/* 기준 금액 */}
                  <div className="flex justify-between items-center p-4 rounded-lg border-2 mb-3 bg-gray-100 dark:bg-gray-700 border-gray-300 dark:border-gray-600">
                    <span className="font-bold text-gray-800 dark:text-white text-lg">오늘 시작금액:</span>
                    <span className="text-2xl font-bold text-gray-700 dark:text-white pr-2">
                      {formatCurrency(startBaseAmount)}원
                    </span>
                  </div>
                  
                  {/* 전체 합계 */}
                  <div className="flex justify-between items-center p-4 rounded-lg border-2 mb-3 bg-gray-100 dark:bg-gray-700 border-gray-300 dark:border-gray-600">
                    <span className="font-bold text-gray-800 dark:text-white text-lg">마무리:</span>
                    <span className="text-2xl font-bold text-gray-700 dark:text-white pr-2">
                      {formatCurrency(totalBalanceValue)}원
                    </span>
                  </div>
                  
                  {/* 오늘의 수익 */}
                  <div className="flex justify-between items-center p-4 rounded-lg border-2 mb-3 bg-gray-100 dark:bg-gray-700 border-gray-300 dark:border-gray-600">
                    <span className="font-bold text-gray-800 dark:text-white text-lg">오늘의 수익:</span>
                    <span className="text-2xl font-bold text-gray-700 dark:text-white pr-2">
                      {formatCurrency(todayProfitValue)}원
                    </span>
                  </div>
                </div>
              </div>

              <div className="border-t-2 border-gray-300 dark:border-gray-600 pt-4 mt-4">
                {/* DR벳 마진 합계 */}
                <div className="flex justify-between items-center p-4 rounded-lg border-2 mb-3 bg-gray-100 dark:bg-gray-700 border-gray-300 dark:border-gray-600">
                  <span className="font-bold text-gray-800 dark:text-white text-lg">메인:</span>
                  <span className="text-2xl font-bold text-gray-700 dark:text-white pr-2">
                    {formatCurrency(drbetMarginTotal)}원
                  </span>
                </div>
                
                {/* 금액 차이 */}
                <div className="flex justify-between items-center p-4 rounded-lg border-2 mb-3 bg-gray-100 dark:bg-gray-700 border-gray-300 dark:border-gray-600">
                  <span className="font-bold text-gray-800 dark:text-white text-lg">금액 차이:</span>
                  <span className="text-2xl font-bold text-gray-700 dark:text-white pr-2">
                    {formatCurrency(finalDifferenceValue)}원
                  </span>
                </div>
              </div>
              
              <div className="mt-6 flex justify-center">
                <button
                  onClick={handleSendSettlement}
                  disabled={isSendingSettlement}
                  className={`px-8 py-3 rounded-lg font-bold text-lg transition-all ${
                    isSendingSettlement
                      ? 'bg-gray-400 cursor-not-allowed'
                      : 'bg-blue-600 hover:bg-blue-700 text-white shadow-lg hover:shadow-xl'
                  }`}
                >
                  {isSendingSettlement ? '전송 중...' : '📤 정산'}
                </button>
              </div>
            </>
          );
        })()}
      </div>
      )}
    </div>
  );
}

export default Finish;
