import React, { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase.js'

const C = {
  bg:'#0d0f14', surface:'#13151c', border:'#1e2130',
  gold:'#e8c96a', text:'#e8e4dc', muted:'#9ca3af', dim:'#6b7280',
}

export default function SetPassword({ onDone }) {
  const [password,  setPassword]  = useState('')
  const [confirm,   setConfirm]   = useState('')
  const [error,     setError]     = useState('')
  const [loading,   setLoading]   = useState(false)
  const [success,   setSuccess]   = useState(false)

  const handleSet = async () => {
    if (password.length < 8) { setError('Password must be at least 8 characters.'); return }
    if (password !== confirm) { setError('Passwords do not match.'); return }
    setLoading(true); setError('')
    const { error } = await supabase.auth.updateUser({ password })
    if (error) setError(error.message)
    else { setSuccess(true); setTimeout(onDone, 2000) }
    setLoading(false)
  }

  const inp = {
    width:'100%', background:'#0d0f14', border:`1px solid ${C.border}`,
    borderRadius:6, padding:'11px 14px', color:C.text, fontSize:14,
    fontFamily:'inherit', outline:'none',
  }
  const btn = (disabled) => ({
    width:'100%', background: disabled ? '#1e2130' : `linear-gradient(135deg,#c9a84c,${C.gold})`,
    color: disabled ? C.dim : C.bg, border:'none', borderRadius:8,
    padding:'12px', fontSize:14, fontWeight:'bold',
    cursor: disabled ? 'not-allowed' : 'pointer', letterSpacing:'0.04em', marginTop:8,
  })

  return (
    <div style={{ minHeight:'100vh', background:C.bg, display:'flex', alignItems:'center', justifyContent:'center', padding:20 }}>
      <div style={{ width:'100%', maxWidth:380 }}>
        <div style={{ textAlign:'center', marginBottom:32 }}>
          <div style={{ width:52, height:52, background:`linear-gradient(135deg,#c9a84c,${C.gold})`, borderRadius:12, display:'inline-flex', alignItems:'center', justifyContent:'center', fontSize:24, fontWeight:'bold', color:C.bg, marginBottom:14 }}>S</div>
          <div style={{ fontSize:24, fontWeight:'bold', color:C.gold, letterSpacing:'0.04em' }}>SpeakIQ</div>
        </div>

        <div style={{ background:C.surface, border:`1px solid ${C.border}`, borderRadius:14, padding:'28px 26px' }}>
          {success ? (
            <div style={{ textAlign:'center' }}>
              <div style={{ fontSize:32, marginBottom:12 }}>✓</div>
              <div style={{ color:'#00c896', fontSize:15, fontWeight:'bold' }}>Password set!</div>
              <div style={{ color:C.dim, fontSize:13, marginTop:6 }}>Taking you to the app…</div>
            </div>
          ) : (
            <>
              <h2 style={{ color:C.text, fontWeight:'normal', fontSize:18, marginBottom:6 }}>Set your password</h2>
              <p style={{ color:C.dim, fontSize:13, marginBottom:20, lineHeight:1.6 }}>Choose a password to complete your account setup.</p>
              <div style={{ display:'flex', flexDirection:'column', gap:12 }}>
                <input style={inp} type="password" placeholder="New password (min 8 characters)"
                  value={password} onChange={e=>setPassword(e.target.value)} />
                <input style={inp} type="password" placeholder="Confirm password"
                  value={confirm} onChange={e=>setConfirm(e.target.value)}
                  onKeyDown={e=>e.key==='Enter'&&handleSet()} />
              </div>
              {error && <div style={{ color:'#e05555', fontSize:13, marginTop:10 }}>{error}</div>}
              <button style={btn(loading||!password||!confirm)} disabled={loading||!password||!confirm} onClick={handleSet}>
                {loading ? 'Setting password…' : 'Set Password & Sign In'}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
