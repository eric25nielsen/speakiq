import React, { useEffect, useState } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import { supabase } from './lib/supabase.js'
import Login from './pages/Login.jsx'
import Dashboard from './pages/Dashboard.jsx'
import Admin from './pages/Admin.jsx'
import SetPassword from './pages/SetPassword.jsx'

export default function App() {
  const [session,     setSession]     = useState(undefined)
  const [profile,     setProfile]     = useState(null)
  const [needsPassword, setNeedsPassword] = useState(false)

  useEffect(() => {
    // Check URL hash for invite or password recovery tokens
    const hash = window.location.hash
    if (hash.includes('type=invite') || hash.includes('type=recovery')) {
      setNeedsPassword(true)
    }

    supabase.auth.getSession().then(({ data }) => setSession(data.session))

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, s) => {
      setSession(s)
      // Also catch these events from Supabase auth flow
      if (event === 'PASSWORD_RECOVERY' || event === 'USER_UPDATED') {
        setNeedsPassword(false)
      }
    })
    return () => subscription.unsubscribe()
  }, [])

  useEffect(() => {
    if (!session?.user) { setProfile(null); return }
    supabase.from('profiles').select('*').eq('id', session.user.id).single()
      .then(({ data }) => setProfile(data))
  }, [session])

  if (session === undefined) return (
    <div style={{ display:'flex', alignItems:'center', justifyContent:'center', minHeight:'100vh', color:'#6b7280', fontSize:14 }}>
      Loading…
    </div>
  )

  // Show set-password screen for invite and reset links
  if (needsPassword && session) {
    return <SetPassword onDone={() => { setNeedsPassword(false); window.location.hash = '' }} />
  }

  if (!session) return <Login />

  return (
    <Routes>
      <Route path="/" element={<Dashboard session={session} profile={profile} />} />
      <Route path="/admin" element={
        profile?.role === 'admin'
          ? <Admin session={session} profile={profile} />
          : <Navigate to="/" replace />
      } />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
