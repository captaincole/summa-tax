import { Navigate, Route, Routes } from "react-router-dom";
import { Login } from "./routes/Login";
import { Chat } from "./routes/Chat";
import { Documents } from "./routes/Documents";
import { Activity } from "./routes/Activity";
import { Layout } from "./components/Layout";

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route element={<Layout />}>
        <Route path="/" element={<Chat />} />
        <Route path="/documents" element={<Documents />} />
        <Route path="/activity" element={<Activity />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
