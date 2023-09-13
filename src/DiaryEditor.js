import React, { useState } from "react";

function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const handleEmailChange = (e) => {
    setEmail(e.target.value);
  };

  const handlePasswordChange = (e) => {
    setPassword(e.target.value);
  };

  const handleLogin = () => {
    // 여기에서 로그인 로직을 추가하세요.
    // 이메일과 비밀번호를 사용하여 백엔드 서버와 통신하여 로그인을 처리합니다.
  };

  return (
    <div className="login-page">
      <h1>커뮤니티 로그인</h1>
      <form>
        <div className="form-group">
          <label htmlFor="email">이메일</label>
          <input
            type="email"
            id="email"
            value={email}
            onChange={handleEmailChange}
          />
        </div>
        <div className="form-group">
          <label htmlFor="password">비밀번호</label>
          <input
            type="password"
            id="password"
            value={password}
            onChange={handlePasswordChange}
          />
        </div>
        <button type="button" onClick={handleLogin}>
          로그인
        </button>
      </form>
    </div>
  );
}

export default LoginPage;
