import React, { Component } from "react";
import { format } from "date-fns";
import axios from "axios";
import "../board.css";

class Page extends Component {
  state = { data: [] };

  getResponse = async () => {
    try {
      const response = await axios.get("http://localhost:3002/board/getBoards");
      const result = response.data.map((board) => ({
        ...board,
        formattedRegDate: board.b_regDate
          ? format(new Date(board.b_regDate), "yyyy-MM-dd HH:mm:ss")
          : null,
        formattedModiDate: board.b_modiDate
          ? format(new Date(board.b_modiDate), "yyyy-MM-dd HH:mm:ss")
          : null,
      }));
      this.setState({ data: result });
    } catch (error) {
      console.error("Error fetching data:", error);
    }
  };

  componentDidMount() {
    this.getResponse();
  }

  render() {
    console.log(this.state.data);
    return (
      <div>
        <div>
          <h1 className="board_name">게시판</h1>
        </div>
        <table className="table">
          <thead>
            <tr>
              <th className="Board">No.</th>
              <th className="Board">Member No.</th>
              <th className="Board">제목</th>
              <th className="Board">내용</th>
              <th className="Board">등록일</th>
              <th className="Board">수정일</th>
              <th className="Board">조회수</th>
            </tr>
          </thead>
          <tbody>
            {this.state.data.map((board, i) => (
              <tr key={i}>
                <td className="Board">{board.b_idx}</td>
                <td className="Board">{board.m_idx}</td>
                <td className="Board">{board.b_title}</td>
                <td className="Board">{board.b_content}</td>
                <td className="Board">{board.formattedRegDate}</td>
                <td className="Board">{board.formattedModiDate}</td>
                <td className="Board">{board.b_readCount}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }
}

export default Page;
