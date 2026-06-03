import { Routes, Route } from "react-router-dom";
import Layout from "./components/Layout";
import Dashboard from "./pages/Dashboard";
import InvoicePage from "./pages/InvoicePage";
import PropertyPage from "./pages/PropertyPage";
import CarbonPage from "./pages/CarbonPage";
import KycPage from "./pages/KycPage";
import AdminPage from "./pages/AdminPage";

export default function App() {
  return (
    <Layout>
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/invoices" element={<InvoicePage />} />
        <Route path="/property" element={<PropertyPage />} />
        <Route path="/carbon" element={<CarbonPage />} />
        <Route path="/kyc" element={<KycPage />} />
        <Route path="/admin" element={<AdminPage />} />
      </Routes>
    </Layout>
  );
}
