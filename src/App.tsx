import { useState } from 'react'
import { HashRouter, Navigate, Route, Routes } from 'react-router-dom'
import type { ReactNode } from 'react'
import { AuthProvider, useAuth } from './lib/auth'
import { homeFor, mayOpen } from './lib/access'
import Activity from './pages/Activity'
import ChoosePin from './pages/ChoosePin'
import Home from './pages/Home'
import Layout from './pages/Layout'
import Login from './pages/Login'
import Team from './pages/Team'

/** A page the person's role may not open sends them to their own start page. */
function Only({ path, children }: { path: string; children: ReactNode }) {
  const { me } = useAuth()
  return mayOpen(path, me?.role) ? <>{children}</> : <Navigate to={homeFor()} replace />
}

function Gate() {
  const { loading, session, me } = useAuth()
  // The first PIN typed at login, kept in memory only, so they don't have to type it twice.
  const [firstPin, setFirstPin] = useState('')

  if (loading) return <div className="p-8 text-center text-stone-500">Loading…</div>
  if (!session || !me) return <Login onFirstPin={setFirstPin} />
  if (me.must_change_pin) return <ChoosePin first firstPin={firstPin || undefined} />

  return (
    <HashRouter>
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<Only path="/"><Home /></Only>} />
          <Route path="team" element={<Only path="/team"><Team /></Only>} />
          <Route path="activity" element={<Only path="/activity"><Activity /></Only>} />
          <Route path="my-pin" element={<Only path="/my-pin"><ChoosePin first={false} /></Only>} />
          <Route path="*" element={<Navigate to={homeFor()} replace />} />
        </Route>
      </Routes>
    </HashRouter>
  )
}

export default function App() {
  return (
    <AuthProvider>
      <Gate />
    </AuthProvider>
  )
}
