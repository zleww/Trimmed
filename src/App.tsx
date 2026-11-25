import { BrowserRouter, Route, Routes } from 'react-router'
import { SiteLayout } from './components/SiteLayout'
import { AuthProvider } from './lib/auth'
import { AccountLayout } from './pages/account/AccountLayout'
import { BookingsPage } from './pages/account/BookingsPage'
import { ProfilePage } from './pages/account/ProfilePage'
import { SettingsPage } from './pages/account/SettingsPage'
import { AuthPage } from './pages/AuthPage'
import { BookPage } from './pages/BookPage'
import { HomePage } from './pages/HomePage'
import { BarberPage } from './pages/BarberPage'
import { NewPasswordPage } from './pages/NewPasswordPage'
import { NotFoundPage } from './pages/NotFoundPage'
import { PrivacyPage } from './pages/PrivacyPage'
import { WelcomePage } from './pages/WelcomePage'
import { ScrollToTop } from './components/ScrollToTop'

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <ScrollToTop />
        <Routes>
          <Route element={<SiteLayout />}>
            <Route index element={<HomePage />} />
            <Route path="book" element={<BookPage />} />
            <Route path="signin" element={<AuthPage mode="signin" />} />
            <Route path="signup" element={<AuthPage mode="signup" />} />
            <Route path="welcome" element={<WelcomePage />} />
            <Route path="new-password" element={<NewPasswordPage />} />
            <Route path="barbers/:id" element={<BarberPage />} />
            <Route path="privacy" element={<PrivacyPage />} />
            {/* everything under /account needs a signed-in customer with a profile */}
            <Route path="account" element={<AccountLayout />}>
              <Route index element={<BookingsPage />} />
              <Route path="profile" element={<ProfilePage />} />
              <Route path="settings" element={<SettingsPage />} />
            </Route>
            <Route path="*" element={<NotFoundPage />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  )
}
