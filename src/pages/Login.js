import React, { useState } from "react";

const Login = () => {
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
      <div className="login_form">
        <div className="dd">
          <img
            className="m_logo"
            src={process.env.PUBLIC_URL + "/images/nm_logo.png"}
            alt=""
          />
          <form>
            <div className="login-left">
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
            </div>
            <div className="login-right">
              <button type="button" onClick={handleLogin}>
                로그인
              </button>
            </div>
          </form>
          <div>
            <p>@copy Park</p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Login;
