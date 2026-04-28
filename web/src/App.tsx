import { Navigate, Route, Routes } from "react-router-dom";
import { Login } from "./routes/Login";
import { Chat } from "./routes/Chat";

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/" element={<Chat />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
