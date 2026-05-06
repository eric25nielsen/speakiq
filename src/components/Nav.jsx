import React from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { supabase } from '../lib/supabase.js'

const C = { surface:'#13151c', border:'#1e2130', gold:'#e8c96a', dim:'#6b7280', bg:'#0d0f14' }

export default function Nav({ profile }) {
  const navigate = useNavigate()
  const loc = useLocation()

  const signOut = async () => {
    await supabase.auth.signOut()
    navigate('/')
  }

  return (
    <header style={{ background:C.surface, borderBottom:`1px solid ${C.border}`, padding:'14px 28px', display:'flex', alignItems:'center', justifyContent:'space-between', gap:12, flexWrap:'wrap' }}>
      <div style={{ display:'flex', alignItems:'center', gap:12 }}>
        <div style={{ width:34, height:34, background:`linear-gradient(135deg,#c9a84c,${C.gold})`, borderRadius:8, display:'flex', alignItems:'center', justifyContent:'center', fontWeight:'bold', color:C.bg, fontSize:16 }}>S</div>
        <div>
          <div style={{ fontSize:18, fontWeight:'bold', letterSpacing:'0.04em', color:C.gold }}>SpeakIQ</div>
          <div style={{ fontSize:10, color:C.dim, letterSpacing:'0.1em', textTransform:'uppercase' }}>Speaking Opportunity Intelligence</div>
        </div>
      </div>

      <div style={{ display:'flex', alignItems:'center', gap:10, flexWrap:'wrap' }}>
        {profile?.role === 'admin' && (
          <>
            <button onClick={()=>navigate('/')} style={{ background: loc.pathname==='/' ? 'rgba(232,201,106,0.12)' : 'none', color: loc.pathname==='/' ? C.gold : C.dim, border:`1px solid ${loc.pathname==='/' ? C.gold : 'transparent'}`, borderRadius:6, padding:'6px 14px', cursor:'pointer', fontSize:13, fontFamily:'inherit' }}>
              Dashboard
            </button>
            <button onClick={()=>navigate('/admin')} style={{ background: loc.pathname==='/admin' ? 'rgba(232,201,106,0.12)' : 'none', color: loc.pathname==='/admin' ? C.gold : C.dim, border:`1px solid ${loc.pathname==='/admin' ? C.gold : 'transparent'}`, borderRadius:6, padding:'6px 14px', cursor:'pointer', fontSize:13, fontFamily:'inherit' }}>
              Admin
            </button>
          </>
        )}
        <div style={{ fontSize:12, color:C.dim, background:'#0d0f14', padding:'5px 12px', borderRadius:20, border:`1px solid ${C.border}` }}>
          {profile?.email} · <span style={{ color: profile?.role==='admin' ? C.gold : '#9ca3af' }}>{profile?.role}</span>
        </div>
        <button onClick={signOut} style={{ background:'none', border:`1px solid ${C.border}`, color:C.dim, borderRadius:6, padding:'6px 14px', cursor:'pointer', fontSize:13, fontFamily:'inherit' }}>
          Sign out
        </button>
      </div>
    </header>
  )
}
