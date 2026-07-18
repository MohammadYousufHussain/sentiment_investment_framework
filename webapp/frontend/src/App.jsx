import { Navigate, Route, Routes } from 'react-router-dom'
import { AuthProvider, RequireAuth } from './lib/auth'
import Layout from './components/Layout'
import LandingPage from './pages/LandingPage'
import LoginPage from './pages/LoginPage'
import SearchPage from './pages/SearchPage'
import BrowsePage from './pages/BrowsePage'
import CompaniesPage from './pages/CompaniesPage'
import CompanyLayout from './pages/company/CompanyLayout'
import SentimentTab from './pages/company/SentimentTab'
import ValuationTab from './pages/company/ValuationTab'
import ScoringTab from './pages/company/ScoringTab'
import ComparablesTab from './pages/company/ComparablesTab'
import BullBearCaseTab from './pages/company/BullBearCaseTab'
import InvestmentThesisTab from './pages/company/InvestmentThesisTab'

// Wraps an app page in the auth gate + chrome (top bar, sidebar). Landing and
// login render outside this, full-bleed.
function AppShell({ children }) {
  return (
    <RequireAuth>
      <Layout>{children}</Layout>
    </RequireAuth>
  )
}

export default function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route path="/" element={<LandingPage />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/search" element={<AppShell><SearchPage /></AppShell>} />
        <Route path="/companies" element={<AppShell><CompaniesPage /></AppShell>} />
        <Route path="/companies/:ticker" element={<AppShell><CompanyLayout /></AppShell>}>
          <Route index element={<Navigate to="sentiment" replace />} />
          <Route path="sentiment" element={<SentimentTab />} />
          <Route path="valuation" element={<ValuationTab />} />
          <Route path="scoring" element={<ScoringTab />} />
          <Route path="comparables" element={<ComparablesTab />} />
          <Route path="bull-bear-case" element={<BullBearCaseTab />} />
          <Route path="thesis" element={<InvestmentThesisTab />} />
        </Route>
        <Route path="/browse" element={<AppShell><BrowsePage /></AppShell>} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AuthProvider>
  )
}
