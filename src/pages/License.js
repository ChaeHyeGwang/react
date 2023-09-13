function License() {
  return (
    <div class="admin_container ">
      <div class="row">
        <div class="main_container login_section">
          <div class="membership_section">
            <div class="row">
              <strong class="title">
                <em>라이센스 키 등록</em>
                <span class="content"></span>
              </strong>
              <div class="form">
                <strong class="title">검증 방식</strong>
                <label for="aa">
                  <input type="radio" id="aa" name="" placeholder="" />{" "}
                  <em>클라우드</em>
                </label>
                <label for="bb">
                  <input type="radio" id="bb" name="" placeholder="" />{" "}
                  <em>내부 검증 서버</em>
                  <input
                    type="text"
                    id=""
                    name=""
                    placeholder=""
                    class="sub_txt"
                  />
                </label>
                <div id="nameMsg">필수영역입니다</div>
              </div>
              <div class="form">
                <strong class="title">라이센스 키</strong>
                <label for="">
                  <input type="text" id="" name="" placeholder="" />
                </label>
                <div id="nameMsg">필수영역입니다</div>
              </div>
              <div class="btn_zone">
                <div class="alert_notice">* 내용을 입력해주세요</div>
                <a href="#" class="btn active_btn full">
                  적용
                </a>
              </div>
            </div>
          </div>

          <br />
          <br />
          <br />
          <br />
          <br />
          <br />
        </div>
      </div>
    </div>
  );
}

export default License;
