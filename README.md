# 출석 관리 시스템 웹 버전

Python tkinter 기반 출석 관리 시스템을 React + Node.js로 완전히 재구현한 웹 애플리케이션입니다.

## 🚀 주요 기능

### 🔐 인증 시스템
- JWT 기반 로그인/로그아웃
- 세션 관리 (8시간 타임아웃)
- 슈퍼관리자 및 일반 사용자 권한 관리
- 접근 로그 및 보안 기능

### 📊 데이터 관리
- **사이트 관리**: 3단계 계층 구조 (유저 → 명의 → 사이트)
- **출석 관리**: 실시간 출석 추적 및 이벤트 관리
- **정산 관리**: 일일 정산 및 자금 관리
- **루이카지노 시트**: CSV 파일과 동일한 테이블 형태 관리

### 🎰 루이카지노 관리 시트
- 원본 CSV 파일과 완전히 동일한 11개 컬럼 구조
- 실시간 셀 편집 (클릭하여 수정)
- CSV 파일 가져오기/내보내기
- 행 추가/삭제 기능

## 🛠️ 기술 스택

### 백엔드 (Node.js)
- **Express.js**: RESTful API 서버
- **SQLite3**: 데이터베이스 (기존 구조 유지)
- **JWT**: 인증 토큰
- **bcryptjs**: 비밀번호 암호화
- **multer**: 파일 업로드
- **csv-parser**: CSV 파일 처리

### 프론트엔드 (React)
- **React 18**: 사용자 인터페이스
- **React Router**: 라우팅
- **React Query**: 서버 상태 관리
- **Tailwind CSS**: 스타일링
- **React Hook Form**: 폼 관리
- **React Hot Toast**: 알림

## 📦 설치 및 실행

### 1. 의존성 설치
```bash
# 루트 디렉토리에서
npm run install-all
```

### 2. 환경 변수 설정
```bash
# 서버용 .env 파일 생성
echo "JWT_SECRET=your-super-secret-jwt-key-change-this-in-production" > .env
echo "NODE_ENV=development" >> .env
echo "PORT=5000" >> .env

# 클라이언트용 .env 파일 생성
echo "REACT_APP_API_URL=http://localhost:5000/api" > client/.env
```

### 3. 개발 서버 실행
```bash
# 백엔드와 프론트엔드 동시 실행
npm run dev

# 또는 개별 실행
npm run server  # 백엔드만 (포트 5000)
npm run client  # 프론트엔드만 (포트 3000)
```

### 4. 프로덕션 빌드
```bash
npm run build
npm start
```

## 🔑 기본 계정

시스템에는 다음 기본 계정들이 자동으로 생성됩니다:

| 사용자명 | 비밀번호 | 권한 | 설명 |
|---------|---------|------|------|
| admin | admin123 | 슈퍼관리자 | 모든 기능 접근 가능 |
| maenggu | pass123 | 일반 사용자 | 맹구 데이터만 접근 |
| jjanggu | pass123 | 일반 사용자 | 짱구 데이터만 접근 |

## 📁 프로젝트 구조

```
web-version/
├── package.json              # 루트 패키지 설정
├── server/                   # Node.js 백엔드
│   ├── index.js             # 서버 진입점
│   ├── database/
│   │   └── db.js            # 데이터베이스 관리
│   ├── routes/              # API 라우트
│   │   ├── auth.js          # 인증 API
│   │   ├── casino.js        # 루이카지노 API
│   │   ├── users.js         # 사용자 API
│   │   ├── identities.js    # 명의 API
│   │   ├── sites.js         # 사이트 API
│   │   ├── attendance.js    # 출석 API
│   │   └── settlements.js   # 정산 API
│   └── middleware/
│       └── auth.js          # 인증 미들웨어
├── client/                  # React 프론트엔드
│   ├── package.json         # 클라이언트 패키지 설정
│   ├── src/
│   │   ├── App.js           # 메인 앱 컴포넌트
│   │   ├── contexts/
│   │   │   └── AuthContext.js # 인증 컨텍스트
│   │   └── components/
│   │       ├── Login.js     # 로그인 페이지
│   │       ├── Layout.js    # 레이아웃 컴포넌트
│   │       ├── Dashboard.js # 대시보드
│   │       ├── CasinoExcel.js # 루이카지노 시트
│   │       └── ...          # 기타 컴포넌트들
│   └── public/
└── README.md
```

## 🎯 API 엔드포인트

### 인증
- `POST /api/auth/login` - 로그인
- `POST /api/auth/logout` - 로그아웃
- `GET /api/auth/me` - 현재 사용자 정보
- `GET /api/auth/verify` - 토큰 검증

### 루이카지노 관리
- `GET /api/casino` - 모든 데이터 조회
- `POST /api/casino` - 새 행 추가
- `PUT /api/casino/:id` - 데이터 수정
- `DELETE /api/casino/:id` - 행 삭제
- `POST /api/casino/import-csv` - CSV 파일 가져오기
- `GET /api/casino/export-csv` - CSV 파일 내보내기

### 기타 API
- `GET /api/health` - 서버 상태 확인
- `/api/users/*` - 사용자 관리
- `/api/identities/*` - 명의 관리
- `/api/sites/*` - 사이트 관리
- `/api/attendance/*` - 출석 관리
- `/api/settlements/*` - 정산 관리

## 🔄 데이터 마이그레이션

기존 Python 애플리케이션의 SQLite 데이터베이스를 그대로 사용할 수 있습니다:

1. 기존 `management_system.db` 파일을 웹 버전 루트 디렉토리에 복사
2. 서버 실행 시 자동으로 필요한 테이블들이 추가됩니다
3. 기존 데이터는 그대로 유지되며 웹에서 접근 가능합니다

## 🌟 주요 개선사항

### 사용자 경험
- **반응형 디자인**: 모든 디바이스에서 최적화된 UI
- **실시간 업데이트**: React Query를 통한 자동 데이터 동기화
- **직관적인 인터페이스**: 모던한 웹 UI/UX
- **빠른 성능**: SPA 기반 빠른 페이지 전환

### 개발자 경험
- **RESTful API**: 표준화된 API 구조
- **타입 안전성**: 명확한 데이터 구조
- **에러 처리**: 포괄적인 에러 핸들링
- **보안**: JWT, CORS, Rate Limiting 등

### 운영 및 배포
- **확장성**: 마이크로서비스 아키텍처 준비
- **모니터링**: 접근 로그 및 에러 추적
- **배포 용이성**: Docker, PM2 등 다양한 배포 옵션
- **백업**: 자동 데이터 백업 및 복구

## 🔧 개발 가이드

### 새로운 기능 추가
1. 백엔드: `server/routes/`에 새 라우트 파일 생성
2. 프론트엔드: `client/src/components/`에 새 컴포넌트 생성
3. API 연동: React Query 훅 사용

### 데이터베이스 스키마 변경
1. `server/database/db.js`에서 테이블 스키마 수정
2. 마이그레이션 스크립트 작성 (필요시)

### 인증 권한 추가
1. `server/middleware/auth.js`에 새 권한 미들웨어 추가
2. 라우트에 미들웨어 적용

## 📞 지원

문제가 발생하거나 기능 요청이 있으시면 이슈를 등록해주세요.

---

**🎉 Python tkinter에서 React + Node.js로의 완전한 웹 전환이 완료되었습니다!**
