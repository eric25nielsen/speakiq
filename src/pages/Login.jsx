import React, { useState } from 'react'
import { supabase } from '../lib/supabase.js'

const C = {
  bg:'#0d0f14', surface:'#13151c', border:'#1e2130',
  gold:'#e8c96a', text:'#e8e4dc', muted:'#9ca3af', dim:'#6b7280',
}

export default function Login() {
  const [email, setEmail]       = useState('')
  const [password, setPassword] = useState('')
  const [error, setError]       = useState('')
  const [loading, setLoading]   = useState(false)
  const [mode, setMode]         = useState('login') // 'login' | 'reset'
  const [resetSent, setResetSent] = useState(false)

  const handleLogin = async () => {
    setLoading(true); setError('')
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) setError(error.message)
    setLoading(false)
  }

  const handleReset = async () => {
    setLoading(true); setError('')
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/`
    })
    if (error) setError(error.message)
    else setResetSent(true)
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
    padding:'12px', fontSize:14, fontWeight:'bold', cursor: disabled ? 'not-allowed' : 'pointer',
    letterSpacing:'0.04em', marginTop:8,
  })

  return (
    <div style={{ minHeight:'100vh', background:C.bg, display:'flex', alignItems:'center', justifyContent:'center', padding:20 }}>
      <div style={{ width:'100%', maxWidth:380 }}>
        {/* Logo */}
        <div style={{ textAlign:'center', marginBottom:36 }}>
          <div style={{ width:52, height:52, background:`linear-gradient(135deg,#c9a84c,${C.gold})`, borderRadius:12, display:'inline-flex', alignItems:'center', justifyContent:'center', fontSize:24, fontWeight:'bold', color:C.bg, marginBottom:14 }}>S</div>
          <div style={{ fontSize:24, fontWeight:'bold', color:C.gold, letterSpacing:'0.04em' }}>SpeakIQ</div>
          <div style={{ fontSize:12, color:C.dim, letterSpacing:'0.1em', textTransform:'uppercase', marginTop:4 }}>Speaking Opportunity Intelligence</div>
        </div>

        <div style={{ background:C.surface, border:`1px solid ${C.border}`, borderRadius:14, padding:'28px 26px' }}>
          {mode === 'reset' ? (
            <>
              <h2 style={{ color:C.text, fontWeight:'normal', fontSize:18, marginBottom:6 }}>Reset password</h2>
              <p style={{ color:C.dim, fontSize:13, marginBottom:20, lineHeight:1.6 }}>Enter your email and we'll send a reset link.</p>
              {resetSent ? (
                <div style={{ background:'rgba(0,200,150,0.1)', border:'1px solid #00c896', borderRadius:8, padding:'12px 14px', color:'#00c896', fontSize:13 }}>
                  ✓ Check your email for the reset link.
                </div>
              ) : (
                <>
                  <input style={inp} type="email" placeholder="your@email.com" value={email} onChange={e=>setEmail(e.target.value)} />
                  {error && <div style={{ color:'#e05555', fontSize:13, marginTop:8 }}>{error}</div>}
                  <button style={btn(loading || !email)} disabled={loading || !email} onClick={handleReset}>
                    {loading ? 'Sending…' : 'Send Reset Link'}
                  </button>
                </>
              )}
              <button onClick={()=>{setMode('login');setError('');setResetSent(false)}} style={{ background:'none', border:'none', color:C.dim, fontSize:13, cursor:'pointer', marginTop:14, display:'block', width:'100%', textAlign:'center' }}>
                ← Back to login
              </button>
            </>
          ) : (
            <>
              <h2 style={{ color:C.text, fontWeight:'normal', fontSize:18, marginBottom:20 }}>Sign in</h2>
              <div style={{ display:'flex', flexDirection:'column', gap:12 }}>
                <input style={inp} type="email" placeholder="Email address" value={email} onChange={e=>setEmail(e.target.value)}
                  onKeyDown={e=>e.key==='Enter'&&handleLogin()} />
                <input style={inp} type="password" placeholder="Password" value={password} onChange={e=>setPassword(e.target.value)}
                  onKeyDown={e=>e.key==='Enter'&&handleLogin()} />
              </div>
              {error && <div style={{ color:'#e05555', fontSize:13, marginTop:10 }}>{error}</div>}
              <button style={btn(loading || !email || !password)} disabled={loading || !email || !password} onClick={handleLogin}>
                {loading ? 'Signing in…' : 'Sign In'}
              </button>
              <button onClick={()=>{setMode('reset');setError('')}} style={{ background:'none', border:'none', color:C.dim, fontSize:13, cursor:'pointer', marginTop:12, display:'block', width:'100%', textAlign:'center' }}>
                Forgot password?
              </button>
            </>
          )}
        </div>
        <p style={{ textAlign:'center', color:C.dim, fontSize:12, marginTop:18, lineHeight:1.6 }}>
          Don't have an account? Ask your admin to invite you.
        </p>
      </div>
    </div>
  )
}
