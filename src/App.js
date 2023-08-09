import React from 'react';
import Home from "./pages/Home";
import FirstPage from "./pages/FristPage";
import ListPage from './pages/ListPage';
import { Routes, Route, BrowserRouter } from "react-router-dom";

const App = ()=>{
  return (
	<BrowserRouter>
		<Routes>
		  <Route path="/" element={<Home />} />
		  <Route path="/first" element={<FirstPage />} />
      <Route path="/BoardList" element={<ListPage />} />
		</Routes>
  	</BrowserRouter> 
    );
}

export default App;