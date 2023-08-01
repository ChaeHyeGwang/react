import logo from './logo.svg';
import axios from 'axios';
import './App.css';

export default function App(){
  var response1 = "";
  var response2 = "";
  var response3 = "";

  axios.get("http://localhost:3002/test/get")
       .then(async function (response) { response1 = response.data; console.log(response1); })
       .catch(function (error) { console.log("ERROR : " + error); })
       .then(function (response) {  });

  axios.post("http://localhost:3002/test/post")
       .then(async function (response) { response2 = response.data; console.log(response2); })
       .catch(function (error) { console.log("ERROR : " + error); })
       .then(function (response) {  });

  axios.get("http://localhost:3002/test/db")
       .then(async function (response) { response3 = response.data; console.log(response3); })
       .catch(function (error) { console.log("ERROR : " + error); })
       .then(function (response) {  });
  
  return (
    <div className="App">
      <header className="App-header">
        <img src={logo} className="App-logo" alt="logo" />
        <p>
          Edit <code>src/App.js</code> and save to reload.
        </p>
        <a
          className="App-link"
          href="https://reactjs.org"
          target="_blank"
          rel="noopener noreferrer"
        >
          Learn React
        </a>
      </header>
    </div>
  );
}
