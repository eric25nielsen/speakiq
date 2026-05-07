import React, { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase.js'

const C = {
  bg:'#0d0f14', surface:'#13151c', border:'#1e2130',
  gold:'#e8c96a', goldFaint:'rgba(232,201,106,0.12)',
  text:'#e8e4dc', muted:'#9ca3af', dim:'#6b7280', dimmer:'#4b5563',
  green:'#00c896', greenFaint:'rgba(0,200,150,0.1)',
  red:'#e05555', orange:'#f5a623',
}

const ICAL_BASE = 'https://calendar.google.com/calendar/ical/'
const ICAL_SUFFIX = '/public/basic.ics'

// Extract calendar ID from any Google Calendar URL format
const extractIcalUrl = (raw) => {
  if (!raw) return null
  raw = raw.trim()
  // Already a valid .ics URL
  if (raw.includes('.ics')) return raw.replace(/^webcal:\/\//i, 'https://')
  // embed URL — extract src param
  const srcMatch = raw.match(/[?&]src=([^&]+)/)
  if (srcMatch) {
    const calId = decodeURIComponent(srcMatch[1])
    return `${ICAL_BASE}${encodeURIComponent(calId)}${ICAL_SUFFIX}`
  }
  // Already looks like a calendar ID
  if (raw.includes('@group.calendar.google.com') || raw.includes('@gmail.com')) {
    return `${ICAL_BASE}${encodeURIComponent(raw)}${ICAL_SUFFIX}`
  }
  return raw
}

export default function Syncer({ session }) {
  const [step,       setStep]       = useState('idle')   // idle | pasting | syncing | done | error
  const [url,        setUrl]        = useState('')
  const [monthLabel, setMonth]      = useState('')
  const [lastSync,   setLastSync]   = useState(null)
  const [lastCount,  setLastCount]  = useState(null)
  const [errorMsg,   setError]      = useState('')
  const [progress,   setProgress]   = useState('')

  // Auto-set current month label
  useEffect(() => {
    const now = new Date()
    setMonth(now.toLocaleString('default',{month:'long'}) + now.getFullYear())
  }, [])

  // Load last sync info
  useEffect(() => {
    supabase.from('opportunities')
      .select('created_at, calendar_month')
      .order('created_at', { ascending: false })
      .limit(1)
      .then(({ data }) => {
        if (data?.[0]) {
          setLastSync(data[0].created_at)
          setLastCount(null)
        }
      })
  }, [])

  const signOut = () => supabase.auth.signOut()

  const handleSync = async () => {
    const icalUrl = extractIcalUrl(url)
    if (!icalUrl) { setError('Please paste the calendar link from Jennifer\'s email.'); return }

    setStep('syncing')
    setError('')
    setProgress('Fetching calendar…')

    try {
      const res = await fetch('/api/scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: icalUrl, icpGenres: ['Leadership','Business','Healthcare','Technology','Education','Finance','Entrepreneurship','Sales','Mental Health','Nonprofit','Government','Real Estate','HR & Talent','Marketing','Wellness','Legal'], calendarMonth: monthLabel })
      })
      const data = await res.json()
      if (!res.ok) { setError(data.error || 'Sync failed.'); setStep('error'); return }

      setProgress('Saving opportunities…')

      // Score
      const scored = (data.opportunities || []).map(o => {
        let s = 0
        if (o.genre) s += 70
        if (o.contactEmail || o.contact_email) s += 15
        if (o.location) s += 10
        if (o.fee) s += 5
        return {
          title:         o.title        || null,
          date:          o.date         || null,
          location:      o.location     || null,
          contact_name:  o.contactName  || null,
          contact_email: o.contactEmail || null,
          contact_phone: o.contactPhone || null,
          genre:         o.genre        || null,
          audience:      o.audience     || null,
          fee:           o.fee          || null,
          format:        o.format       || null,
          organization:  o.organization || null,
          details:       o.details      || null,
          icp_score:     s,
          calendar_month: monthLabel,
        }
      })

      // Replace this month's data
      await supabase.from('opportunities').delete().eq('calendar_month', monthLabel)
      if (scored.length > 0) await supabase.from('opportunities').insert(scored)

      setLastCount(scored.length)
      setLastSync(new Date().toISOString())
      setStep('done')
      setUrl('')
    } catch(e) {
      setError('Something went wrong. Try again or contact your admin.')
      setStep('error')
    }
  }

  const reset = () => { setStep('idle'); setError('') }

  return (
    <div style={{ minHeight:'100vh', background:C.bg, display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', padding:20 }}>

      {/* Logo + sign out */}
      <div style={{ position:'absolute', top:0, left:0, right:0, padding:'16px 24px', display:'flex', alignItems:'center', justifyContent:'space-between' }}>
        <div style={{ display:'flex', alignItems:'center', gap:10 }}>
          <div style={{ width:30, height:30, background:`linear-gradient(135deg,#c9a84c,${C.gold})`, borderRadius:6, display:'flex', alignItems:'center', justifyContent:'center', fontWeight:'bold', color:C.bg, fontSize:14 }}>S</div>
          <span style={{ color:C.gold, fontWeight:'bold', fontSize:15, letterSpacing:'0.04em' }}>SpeakIQ</span>
        </div>
        <button onClick={signOut} style={{ background:'none', border:`1px solid ${C.border}`, color:C.dim, borderRadius:6, padding:'6px 14px', cursor:'pointer', fontSize:12, fontFamily:'inherit' }}>Sign out</button>
      </div>

      <div style={{ width:'100%', maxWidth:480, display:'flex', flexDirection:'column', gap:20 }}>

        {/* Last sync status */}
        {lastSync && step !== 'done' && (
          <div style={{ background:C.greenFaint, border:`1px solid rgba(0,200,150,0.25)`, borderRadius:10, padding:'12px 18px', display:'flex', alignItems:'center', gap:10 }}>
            <span style={{ color:C.green, fontSize:18 }}>✓</span>
            <div>
              <div style={{ color:C.green, fontSize:13, fontWeight:'bold' }}>Last synced successfully</div>
              <div style={{ color:C.dim, fontSize:12, marginTop:2 }}>{new Date(lastSync).toLocaleDateString('en-US',{month:'long',day:'numeric',year:'numeric',hour:'numeric',minute:'2-digit'})}</div>
            </div>
          </div>
        )}

        {/* Main card */}
        <div style={{ background:C.surface, border:`1px solid ${C.border}`, borderRadius:16, padding:32, textAlign:'center' }}>

          {/* IDLE / PASTE state */}
          {(step === 'idle' || step === 'pasting') && (
            <>
              <div style={{ fontSize:48, marginBottom:16 }}>📅</div>
              <h1 style={{ color:C.text, fontWeight:'normal', fontSize:22, marginBottom:8 }}>Load This Month's Calendar</h1>
              <p style={{ color:C.dim, fontSize:14, lineHeight:1.7, marginBottom:28, maxWidth:360, margin:'0 auto 28px' }}>
                When you get Jennifer's monthly email, copy the calendar link and paste it below. That's it — everyone will see the new opportunities right away.
              </p>

              {/* URL paste */}
              <div style={{ textAlign:'left', marginBottom:16 }}>
                <label style={{ fontSize:11, color:C.muted, display:'block', marginBottom:6, textTransform:'uppercase', letterSpacing:'0.07em' }}>
                  Paste calendar link from Jennifer's email
                </label>
                <textarea
                  value={url}
                  onChange={e=>{ setUrl(e.target.value); setStep('pasting') }}
                  placeholder="Paste the link here — any Google Calendar URL format works"
                  rows={3}
                  style={{ width:'100%', background:'#0d0f14', border:`1px solid ${url ? C.gold : C.border}`, borderRadius:8, padding:'10px 14px', color:C.text, fontSize:13, fontFamily:'monospace', resize:'vertical', outline:'none', boxSizing:'border-box', lineHeight:1.5 }}
                />
              </div>

              {/* Month label */}
              <div style={{ textAlign:'left', marginBottom:24 }}>
                <label style={{ fontSize:11, color:C.muted, display:'block', marginBottom:6, textTransform:'uppercase', letterSpacing:'0.07em' }}>
                  Month (auto-filled — change if needed)
                </label>
                <input value={monthLabel} onChange={e=>setMonth(e.target.value)}
                  style={{ width:'100%', background:'#0d0f14', border:`1px solid ${C.border}`, borderRadius:8, padding:'9px 14px', color:C.text, fontSize:13, fontFamily:'inherit', outline:'none', boxSizing:'border-box' }} />
              </div>

              <button
                onClick={handleSync}
                disabled={!url.trim()}
                style={{ width:'100%', background: url.trim() ? `linear-gradient(135deg,#c9a84c,${C.gold})` : '#1e2130', color: url.trim() ? C.bg : C.dimmer, border:'none', borderRadius:10, padding:'15px', fontSize:16, fontWeight:'bold', cursor: url.trim() ? 'pointer' : 'not-allowed', letterSpacing:'0.04em', transition:'all 0.2s' }}>
                Sync Calendar →
              </button>

              {errorMsg && (
                <div style={{ marginTop:14, color:C.red, fontSize:13, background:'rgba(224,85,85,0.08)', border:`1px solid rgba(224,85,85,0.2)`, borderRadius:8, padding:'10px 14px' }}>
                  {errorMsg}
                </div>
              )}
            </>
          )}

          {/* SYNCING state */}
          {step === 'syncing' && (
            <>
              <div style={{ fontSize:48, marginBottom:16, display:'inline-block', animation:'spin 1.5s linear infinite' }}>⟳</div>
              <h2 style={{ color:C.text, fontWeight:'normal', fontSize:20, marginBottom:8 }}>Syncing…</h2>
              <p style={{ color:C.dim, fontSize:14 }}>{progress}</p>
            </>
          )}

          {/* DONE state */}
          {step === 'done' && (
            <>
              <div style={{ fontSize:56, marginBottom:16 }}>🎉</div>
              <h2 style={{ color:C.green, fontWeight:'normal', fontSize:22, marginBottom:8 }}>All done!</h2>
              <p style={{ color:C.muted, fontSize:14, lineHeight:1.7, marginBottom:24 }}>
                {lastCount !== null ? `${lastCount} speaking opportunities` : 'The calendar'} for <strong style={{ color:C.text }}>{monthLabel}</strong> is now live. Everyone can see the new opportunities.
              </p>
              <button onClick={reset}
                style={{ background:'none', border:`1px solid ${C.border}`, color:C.dim, borderRadius:8, padding:'10px 24px', cursor:'pointer', fontSize:13, fontFamily:'inherit' }}>
                Sync another month
              </button>
            </>
          )}

          {/* ERROR state */}
          {step === 'error' && (
            <>
              <div style={{ fontSize:48, marginBottom:16 }}>⚠️</div>
              <h2 style={{ color:C.orange, fontWeight:'normal', fontSize:20, marginBottom:8 }}>Something went wrong</h2>
              <p style={{ color:C.dim, fontSize:14, lineHeight:1.7, marginBottom:8 }}>{errorMsg}</p>
              <button onClick={reset}
                style={{ background:`linear-gradient(135deg,#c9a84c,${C.gold})`, color:C.bg, border:'none', borderRadius:8, padding:'11px 28px', cursor:'pointer', fontSize:14, fontWeight:'bold', fontFamily:'inherit', marginTop:8 }}>
                Try Again
              </button>
            </>
          )}
        </div>

        {/* Help text */}
        {(step === 'idle' || step === 'pasting') && (
          <p style={{ textAlign:'center', color:C.dimmer, fontSize:12, lineHeight:1.7 }}>
            Not sure where to find the link? Open Jennifer's email → look for a button that says "Open in Google Calendar" or "View Calendar" → copy that link and paste it above.
          </p>
        )}
      </div>

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  )
}
