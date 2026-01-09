# ngrok을 사용한 외부 접근 설정 가이드

## 1. ngrok 설치

### Windows
1. [ngrok 공식 사이트](https://ngrok.com/download)에서 다운로드
2. 압축 해제 후 `ngrok.exe`를 PATH에 추가하거나 현재 폴더에서 실행

### 또는 Chocolatey 사용
```bash
choco install ngrok
```

### 또는 npm 사용
```bash
npm install -g ngrok
```

## 2. ngrok 계정 생성 (무료)

1. [ngrok.com](https://ngrok.com)에서 회원가입
2. 대시보드에서 인증 토큰(Authtoken) 복사
3. 명령어로 인증:
```bash
ngrok config add-authtoken YOUR_AUTH_TOKEN
```

## 3. 프론트엔드 빌드

```bash
cd web-version/client
npm run build
```

빌드가 완료되면 `web-version/client/build` 폴더가 생성됩니다.

## 4. 백엔드 서버 실행

```bash
cd web-version/server
npm start
```

서버가 포트 5000에서 실행됩니다.

## 5. ngrok 터널 시작

새 터미널 창에서:

```bash
ngrok http 5000
```

또는 더 안전하게 (비밀번호 보호):

```bash
ngrok http 5000 --basic-auth="username:password"
```

## 6. ngrok URL 확인

ngrok이 실행되면 다음과 같은 정보가 표시됩니다:

```
Forwarding  https://xxxx-xxxx-xxxx.ngrok-free.app -> http://localhost:5000
```

이 `https://xxxx-xxxx-xxxx.ngrok-free.app` URL을 복사하세요.

## 7. 외부에서 접속

브라우저에서 ngrok URL로 접속하면 됩니다:
```
https://xxxx-xxxx-xxxx.ngrok-free.app
```

## 주의사항

### ⚠️ 보안
- ngrok 무료 버전은 **임시용**입니다
- URL이 매번 변경됩니다 (재시작 시)
- 무료 버전은 트래픽 제한이 있습니다
- 프로덕션 환경에는 사용하지 마세요

### 🔒 보안 강화 옵션
```bash
# 비밀번호 보호
ngrok http 5000 --basic-auth="admin:your-password"

# 특정 IP만 허용 (유료 플랜)
ngrok http 5000 --ip-whitelist="1.2.3.4"
```

### 📝 ngrok URL 고정 (유료 플랜)
유료 플랜을 사용하면 고정 도메인을 사용할 수 있습니다:
```bash
ngrok http 5000 --domain=your-fixed-domain.ngrok.app
```

## 문제 해결

### CORS 오류
- 서버가 재시작되었는지 확인
- ngrok URL이 CORS 설정에 포함되어 있는지 확인

### 404 오류
- 프론트엔드가 빌드되었는지 확인 (`npm run build`)
- `web-version/client/build` 폴더가 존재하는지 확인

### 연결 오류
- 백엔드 서버가 실행 중인지 확인
- ngrok이 올바른 포트(5000)를 포워딩하는지 확인

## ngrok 중지

터미널에서 `Ctrl + C`를 누르면 ngrok 터널이 종료됩니다.

