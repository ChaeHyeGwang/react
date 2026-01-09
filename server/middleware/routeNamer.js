module.exports = function routeNamer(req, res, next) {
  const { method } = req;
  const url = req.originalUrl || '';

  const rules = [
    // 인증
    { m: 'POST', r: /^\/api\/auth\/login(\?|$)/, name: '[로그인]' },
    { m: 'POST', r: /^\/api\/auth\/logout(\?|$)/, name: '[로그아웃]' },
    { m: 'GET',  r: /^\/api\/auth\/me(\?|$)/, name: '[내 정보 조회]' },
    { m: 'GET',  r: /^\/api\/auth\/verify(\?|$)/, name: '[토큰 검증]' },

    // 명의
    { m: 'GET',  r: /^\/api\/identities(\?|$|\/)/, name: '[명의 목록/정보 조회]' },
    { m: 'POST', r: /^\/api\/identities(\?|$)/, name: '[명의 추가]' },
    { m: 'PUT',  r: /^\/api\/identities\//, name: '[명의 수정]' },
    { m: 'DELETE', r: /^\/api\/identities\//, name: '[명의 삭제]' },

    // 사이트 관리
    { m: 'GET',  r: /^\/api\/sites(\?|$|\/)/, name: '[사이트 목록/정보 조회]' },
    { m: 'POST', r: /^\/api\/sites(\?|$)/, name: '[사이트 추가]' },
    { m: 'PUT',  r: /^\/api\/sites\//, name: '[사이트 수정]' },
    { m: 'DELETE', r: /^\/api\/sites\//, name: '[사이트 삭제]' },

    // DRBet 기록
    { m: 'GET',  r: /^\/api\/drbet(\?|$|\/)/, name: '[DRBet 기록 조회]' },
    { m: 'POST', r: /^\/api\/drbet(\?|$)/, name: '[DRBet 기록 추가]' },
    { m: 'PUT',  r: /^\/api\/drbet\//, name: '[DRBet 기록 수정]' },
    { m: 'DELETE', r: /^\/api\/drbet\//, name: '[DRBet 기록 삭제]' },

    // 사이트 특이사항(메모)
    { m: 'GET',  r: /^\/api\/site-notes(\?|$|\/)/, name: '[특이사항 조회]' },
    { m: 'POST', r: /^\/api\/site-notes(\?|$|\/)/, name: '[특이사항 저장]' },

    // 통계
    { m: 'GET', r: /^\/api\/statistics\/summary(\?|$)/, name: '[대시보드 요약]' },
    { m: 'GET', r: /^\/api\/statistics\/by-identity(\?|$)/, name: '[명의별 포인트 분석]' },
    { m: 'GET', r: /^\/api\/statistics\/by-site(\?|$)/, name: '[사이트별 포인트 순위]' },
    { m: 'GET', r: /^\/api\/statistics\/daily-trend(\?|$)/, name: '[일별 추이]' },
    { m: 'GET', r: /^\/api\/statistics\/monthly-trend(\?|$)/, name: '[월별 추이]' },

    // 출석/정산
    { m: 'GET',  r: /^\/api\/attendance(\?|$|\/)/, name: '[출석 데이터]' },
    { m: 'GET',  r: /^\/api\/settlements(\?|$|\/)/, name: '[정산 데이터]' },

    // 백업
    { m: 'GET',  r: /^\/api\/backup\/list(\?|$)/, name: '[백업 목록]' },
    { m: 'POST', r: /^\/api\/backup\/create(\?|$)/, name: '[백업 생성]' },
    { m: 'POST', r: /^\/api\/backup\/restore(\?|$)/, name: '[백업 복원]' },
    { m: 'DELETE', r: /^\/api\/backup\//, name: '[백업 삭제]' },
  ];

  for (const rule of rules) {
    if (rule.m === method && rule.r.test(url)) {
      req.apiName = rule.name;
      break;
    }
  }

  return next();
};
