import React from 'react';
import Home from "./pages/Home";
import FirstPage from "./pages/FristPage";
import { Routes, Route, BrowserRouter } from "react-router-dom";

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