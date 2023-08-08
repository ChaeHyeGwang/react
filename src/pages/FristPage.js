import React, {useState} from 'react';
import axios from 'axios';
import'../common.css';

export default class Page extends React.Component {
    state = { data:"" }
    getResponse = async() => {
        await axios.get('http://localhost:3002/test/db').then(reponse => {
            const result = [];
            for (let i = 0; i < reponse.data.length; i++) {
                result.push(
                    <tr>
                        <td className='h'>{reponse.data[i].seq}</td>
                        <td className='h'>{reponse.data[i].mb_id}</td>
                        <td className='h'>{reponse.data[i].mb_pw}</td>
                        <td className='h'>{reponse.data[i].mb_tell}</td>
                    </tr>
                );
            }
            this.setState({ data : result });
        });
    }
    
    componentDidMount(){
      this.getResponse();     
    }

    render(){
        return (
            <div>
              <div>
                <h1 className='hh'>게시판</h1>
              </div>
              <table className='table'>
                    <tr>
                        <td className='h'>글번호</td>
                        <td className='h'>글이름</td>
                        <td className='h'>내용</td>
                        <td className='h'>전화번호</td>
                    </tr>    
                    {this.state.data}
              </table>
            </div>
            );   
    }

    
}