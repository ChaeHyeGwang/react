import { useNavigate } from 'react-router-dom';

export default function Test() {
  const navigate = useNavigate();

  // 버튼 클릭시 호출
  const move = (path) => {
    navigate(path);
  };
  return (
    <div>
      <button onClick={() => move("/first")}>이동</button>
      <button onClick={() => move("/BoardList")}>게시판 이동</button>
    </div>
  );
}