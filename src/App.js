import React from 'react';
import Home from "./pages/Home";
import FirstPage from "./pages/FristPage";
import { Routes, Route, BrowserRouter } from "react-router-dom";


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
          Edit <code>src/App.js</code> 팀장님 힘내십쇼
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
const App = ()=>{
  return (
	<BrowserRouter>
		<Routes>
		  <Route path="/" element={<Home />} />
		  <Route path="/first" element={<FirstPage />} />
		</Routes>
  	</BrowserRouter> 
  );
}

export default App;