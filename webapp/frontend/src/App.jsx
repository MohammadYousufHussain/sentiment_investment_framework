import { Navigate, Route, Routes } from 'react-router-dom'
import Layout from './components/Layout'
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

export default function App() {
  return (
    <Layout>
      <Routes>
        <Route path="/" element={<SearchPage />} />
        <Route path="/companies" element={<CompaniesPage />} />
        <Route path="/companies/:ticker" element={<CompanyLayout />}>
          <Route index element={<Navigate to="sentiment" replace />} />
          <Route path="sentiment" element={<SentimentTab />} />
          <Route path="valuation" element={<ValuationTab />} />
          <Route path="scoring" element={<ScoringTab />} />
          <Route path="comparables" element={<ComparablesTab />} />
          <Route path="bull-bear-case" element={<BullBearCaseTab />} />
          <Route path="thesis" element={<InvestmentThesisTab />} />
        </Route>
        <Route path="/browse" element={<BrowsePage />} />
      </Routes>
    </Layout>
  )
}
