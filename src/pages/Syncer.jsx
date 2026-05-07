import React, { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase.js'

const C = {
  bg:'#0d0f14', surface:'#13151c', border:'#1e2130',
  gold:'#e8c96a', goldFaint:'rgba(232,201,106,0.12)',
  text:'#e8e4dc', muted:'#9ca3af', dim:'#6b7280', dimmer:'#4b5563',
  green:'#00c896', greenFaint:'rgba(0,200,150,0.1)',
  red:'#e05555', orange:'#f5a623',
}

const SENDER = 'jenniferspeakersclubrep@gmail.com'
const SUBJECT_KEYWORD = 'Accept your invitation to join shared calendar'
const ICAL_BASE = 'https://calendar.google.com/calendar/ical/'
const ICAL_SUFFIX = '/public/basic.ics'

const extractIcalUrl = (raw) => {
  if (!raw) return null
  raw = raw.trim()
  if (raw.includes('.ics')) return raw.replace(/^webcal:\/\//i, 'https://')
  const srcMatch = raw.match(/[?&]src=([^&]+)/)
  if (srcMatch) {
    const calId = decodeURIComponent(srcMatch[1])
    return `${ICAL_BASE}${encodeURIComponent(calId)}${ICAL_SUFFIX}`
  }
  if (raw.includes('@group.calendar.google.com') || raw.includes('@gmail.com')) {
    return `${ICAL_BASE}${encodeURIComponent(raw)}${ICAL_SUFFIX}`
  }
  return raw
}

const ALL_GENRES = ['Leadership','Business','Healthcare','Technology','Education','Finance','Entrepreneurship','Sales','Mental Health','Nonprofit','Government','Real Estate','HR & Talent','Marketing','Wellness','Legal']

const scoreOpp = (o) => {
  let s = 0
  if (o.genre) s += 70
  if (o.contactEmail || o.contact_email) s += 15
  if (o.location) s += 10
  if (o.fee) s += 5
  return s
}

export default function Syncer({ session }) {
  const [mode,       setMode]     = useState(null)      // null | 'email' | 'url'
  const [url,        setUrl]      = useState('')
  const [monthLabel, setMonth]    = useState('')
  const [step,       setStep]     = useState('idle')    // idle | scanning | syncing | done | error
  const [progress,   setProgress] = useState('')
  const [errorMsg,   setError]    = useState('')
  const [lastSync,   setLastSync] = useState(null)
  const [lastCount,  setCount]    = useState(null)

  useEffect(() => {
    const now = new Date()
    setMonth(now.toLocaleString('default',{month:'long'}) + now.getFullYear())
    supabase.from('opportunities').select('created_at,calendar_month').order('created_at',{ascending:false}).limit(1)
      .then(({ data }) => { if (data?.[0]) setLastSync(data[0].created_at) })
  }, [])

  const signOut = () => supabase.auth.signOut()

  // ── Save to DB ─────────────────────────────────────────────────────────────
  const saveOpps = async (opportunities, month) => {
    const rows = opportunities.map(o => ({
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
      icp_score:     scoreOpp(o),
      calendar_month: month,
    }))
    await supabase.from('opportunities').delete().eq('calendar_month', month)
    if (rows.length > 0) await supabase.from('opportunities').insert(rows)
    return rows.length
  }

  // ── Scan via API ────────────────────────────────────────────────────────────
  const scanUrl = async (icalUrl, month) => {
    const res = await fetch('/api/scan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: icalUrl, icpGenres: ALL_GENRES, calendarMonth: month })
    })
    const data = await res.json()
    if (!res.ok) throw new Error(data.error || 'Scan failed')
    return data.opportunities || []
  }

  // ── Scan email via Claude API + Gmail MCP ──────────────────────────────────
  const scanEmail = async (month) => {
    setProgress('Searching your inbox for Jennifer\'s latest email…')

    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'claude-sonnet-4-5',
        max_tokens: 1000,
        system: `Search Gmail for the most recent email FROM "${SENDER}" with subject containing "${SUBJECT_KEYWORD}". Extract and return ONLY a raw JSON object (no markdown) with:
- calendarName: the calendar name in quotes from the subject (e.g. May2026)
- icalUrl: the webcal:// or https://calendar.google.com/calendar/ical/... URL found in the email body
- embedUrl: any https://calendar.google.com/calendar/embed?src=... URL found in the email body
If not found return {"found":false}`,
        messages: [{ role: 'user', content: `Find the most recent calendar invitation email from ${SENDER} and extract the calendar URL from the email body.` }],
        mcp_servers: [{ type: 'url', url: 'https://gmailmcp.googleapis.com/mcp/v1', name: 'gmail-mcp' }]
      })
    })

    const data = await res.json()
    const text = (data.content || []).filter(b => b.type === 'text').map(b => b.text).join('')

    let emailData = null
    try { const m = text.match(/\{[\s\S]*\}/); if (m) emailData = JSON.parse(m[0]) } catch {}

    if (!emailData || emailData.found === false) {
      throw new Error(`No email found from ${SENDER}. Make sure your Gmail is connected and the email is in your inbox.`)
    }

    // Build iCal URL from whatever link we found
    const rawUrl = emailData.icalUrl || emailData.embedUrl
    const icalUrl = extractIcalUrl(rawUrl)
    if (!icalUrl) throw new Error('Could not find a calendar link in the email. Try pasting the URL manually instead.')

    setProgress(`Found calendar "${emailData.calendarName || month}" — fetching events…`)
    return icalUrl
  }

  // ── Main sync handler ───────────────────────────────────────────────────────
  const handleSync = async () => {
    setStep('scanning')
    setError('')

    try {
      let icalUrl

      if (mode === 'email') {
        icalUrl = await scanEmail(monthLabel)
      } else {
        icalUrl = extractIcalUrl(url)
        if (!icalUrl) throw new Error('Please paste a valid calendar URL.')
        setProgress('Fetching calendar from URL…')
      }

      setStep('syncing')
      setProgress('Reading speaking opportunities…')
      const opps = await scanUrl(icalUrl, monthLabel)

      setProgress('Saving to database…')
      const count = await saveOpps(opps, monthLabel)

      setCount(count)
      setLastSync(new Date().toISOString())
      setStep('done')

    } catch(e) {
      setError(e.message || 'Something went wrong.')
      setStep('error')
    }
  }

  const reset = () => { setStep('idle'); setError(''); setMode(null); setUrl('') }
  const canSync = mode === 'email' || (mode === 'url' && url.trim())

  return (
    <div style={{ minHeight:'100vh', background:C.bg, display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', padding:20 }}>

      {/* Top bar */}
      <div style={{ position:'absolute', top:0, left:0, right:0, padding:'16px 24px', display:'flex', alignItems:'center', justifyContent:'space-between' }}>
        <div style={{ display:'flex', alignItems:'center', gap:10 }}>
          <div style={{ width:30, height:30, background:`linear-gradient(135deg,#c9a84c,${C.gold})`, borderRadius:6, display:'flex', alignItems:'center', justifyContent:'center', fontWeight:'bold', color:C.bg, fontSize:14 }}>S</div>
          <span style={{ color:C.gold, fontWeight:'bold', fontSize:15, letterSpacing:'0.04em' }}>SpeakIQ</span>
        </div>
        <button onClick={signOut} style={{ background:'none', border:`1px solid ${C.border}`, color:C.dim, borderRadius:6, padding:'6px 14px', cursor:'pointer', fontSize:12, fontFamily:'inherit' }}>Sign out</button>
      </div>

      <div style={{ width:'100%', maxWidth:500 }}>

        {/* Last sync badge */}
        {lastSync && step !== 'done' && (
          <div style={{ background:C.greenFaint, border:`1px solid rgba(0,200,150,0.25)`, borderRadius:10, padding:'11px 16px', display:'flex', alignItems:'center', gap:10, marginBottom:16 }}>
            <span style={{ color:C.green, fontSize:16 }}>✓</span>
            <div>
              <div style={{ color:C.green, fontSize:13, fontWeight:'bold' }}>Last synced successfully</div>
              <div style={{ color:C.dim, fontSize:12 }}>{new Date(lastSync).toLocaleDateString('en-US',{month:'long',day:'numeric',year:'numeric',hour:'numeric',minute:'2-digit'})}</div>
            </div>
          </div>
        )}

        {/* Main card */}
        <div style={{ background:C.surface, border:`1px solid ${C.border}`, borderRadius:16, padding:32 }}>

          {/* ── CHOOSE MODE ── */}
          {step === 'idle' && mode === null && (
            <div style={{ textAlign:'center' }}>
              <div style={{ fontSize:44, marginBottom:14 }}>📅</div>
              <h1 style={{ color:C.text, fontWeight:'normal', fontSize:22, marginBottom:8 }}>Load This Month's Calendar</h1>
              <p style={{ color:C.dim, fontSize:14, lineHeight:1.7, marginBottom:32 }}>
                How would you like to get Jennifer's calendar?
              </p>
              <div style={{ display:'flex', flexDirection:'column', gap:12 }}>

                {/* Email scan button */}
                <button onClick={()=>setMode('email')}
                  style={{ background:`linear-gradient(135deg,#c9a84c,${C.gold})`, color:C.bg, border:'none', borderRadius:12, padding:'18px 20px', cursor:'pointer', fontFamily:'inherit', textAlign:'left', display:'flex', alignItems:'center', gap:16 }}>
                  <span style={{ fontSize:28 }}>✉️</span>
                  <div>
                    <div style={{ fontSize:15, fontWeight:'bold', marginBottom:3 }}>Scan My Email</div>
                    <div style={{ fontSize:12, opacity:0.75 }}>Automatically finds Jennifer's latest email and pulls the calendar — no copy/paste needed</div>
                  </div>
                </button>

                {/* Paste URL button */}
                <button onClick={()=>setMode('url')}
                  style={{ background:C.bg, color:C.text, border:`1px solid ${C.border}`, borderRadius:12, padding:'18px 20px', cursor:'pointer', fontFamily:'inherit', textAlign:'left', display:'flex', alignItems:'center', gap:16 }}>
                  <span style={{ fontSize:28 }}>🔗</span>
                  <div>
                    <div style={{ fontSize:15, fontWeight:'bold', marginBottom:3 }}>Paste Calendar Link</div>
                    <div style={{ fontSize:12, color:C.dim }}>Copy the link from Jennifer's email and paste it here</div>
                  </div>
                </button>

              </div>
            </div>
          )}

          {/* ── EMAIL MODE ── */}
          {step === 'idle' && mode === 'email' && (
            <div style={{ textAlign:'center' }}>
              <div style={{ fontSize:44, marginBottom:14 }}>✉️</div>
              <h2 style={{ color:C.text, fontWeight:'normal', fontSize:20, marginBottom:8 }}>Scan My Email</h2>
              <p style={{ color:C.dim, fontSize:14, lineHeight:1.7, marginBottom:24 }}>
                We'll search your inbox for the latest email from <strong style={{ color:C.muted }}>Jennifer</strong> and pull the calendar automatically.
              </p>
              <div style={{ textAlign:'left', marginBottom:24 }}>
                <label style={{ fontSize:11, color:C.muted, display:'block', marginBottom:6, textTransform:'uppercase', letterSpacing:'0.07em' }}>Month Label</label>
                <input value={monthLabel} onChange={e=>setMonth(e.target.value)}
                  style={{ width:'100%', background:'#0d0f14', border:`1px solid ${C.border}`, borderRadius:8, padding:'9px 14px', color:C.text, fontSize:13, fontFamily:'inherit', outline:'none', boxSizing:'border-box' }} />
              </div>
              <button onClick={handleSync}
                style={{ width:'100%', background:`linear-gradient(135deg,#c9a84c,${C.gold})`, color:C.bg, border:'none', borderRadius:10, padding:'15px', fontSize:16, fontWeight:'bold', cursor:'pointer', letterSpacing:'0.04em', marginBottom:12 }}>
                Scan Email Now →
              </button>
              <button onClick={()=>setMode(null)} style={{ background:'none', border:'none', color:C.dim, cursor:'pointer', fontSize:13, fontFamily:'inherit' }}>← Back</button>
            </div>
          )}

          {/* ── URL MODE ── */}
          {step === 'idle' && mode === 'url' && (
            <div style={{ textAlign:'center' }}>
              <div style={{ fontSize:44, marginBottom:14 }}>🔗</div>
              <h2 style={{ color:C.text, fontWeight:'normal', fontSize:20, marginBottom:8 }}>Paste Calendar Link</h2>
              <p style={{ color:C.dim, fontSize:14, lineHeight:1.7, marginBottom:24 }}>
                Open Jennifer's email, copy the calendar link, and paste it below.
              </p>
              <div style={{ textAlign:'left', marginBottom:14 }}>
                <label style={{ fontSize:11, color:C.muted, display:'block', marginBottom:6, textTransform:'uppercase', letterSpacing:'0.07em' }}>Calendar Link from Jennifer's Email</label>
                <textarea value={url} onChange={e=>setUrl(e.target.value)}
                  placeholder="Paste any Google Calendar link here…"
                  rows={3}
                  style={{ width:'100%', background:'#0d0f14', border:`1px solid ${url ? C.gold : C.border}`, borderRadius:8, padding:'10px 14px', color:C.text, fontSize:13, fontFamily:'monospace', resize:'vertical', outline:'none', boxSizing:'border-box', lineHeight:1.5 }} />
              </div>
              <div style={{ textAlign:'left', marginBottom:24 }}>
                <label style={{ fontSize:11, color:C.muted, display:'block', marginBottom:6, textTransform:'uppercase', letterSpacing:'0.07em' }}>Month Label</label>
                <input value={monthLabel} onChange={e=>setMonth(e.target.value)}
                  style={{ width:'100%', background:'#0d0f14', border:`1px solid ${C.border}`, borderRadius:8, padding:'9px 14px', color:C.text, fontSize:13, fontFamily:'inherit', outline:'none', boxSizing:'border-box' }} />
              </div>
              <button onClick={handleSync} disabled={!url.trim()}
                style={{ width:'100%', background: url.trim() ? `linear-gradient(135deg,#c9a84c,${C.gold})` : '#1e2130', color: url.trim() ? C.bg : C.dimmer, border:'none', borderRadius:10, padding:'15px', fontSize:16, fontWeight:'bold', cursor: url.trim() ? 'pointer' : 'not-allowed', letterSpacing:'0.04em', marginBottom:12 }}>
                Sync Calendar →
              </button>
              <button onClick={()=>setMode(null)} style={{ background:'none', border:'none', color:C.dim, cursor:'pointer', fontSize:13, fontFamily:'inherit' }}>← Back</button>
            </div>
          )}

          {/* ── SCANNING / SYNCING ── */}
          {(step === 'scanning' || step === 'syncing') && (
            <div style={{ textAlign:'center', padding:'20px 0' }}>
              <div style={{ fontSize:48, marginBottom:16, display:'inline-block', animation:'spin 1.5s linear infinite' }}>⟳</div>
              <h2 style={{ color:C.text, fontWeight:'normal', fontSize:20, marginBottom:8 }}>
                {step === 'scanning' ? 'Searching email…' : 'Syncing calendar…'}
              </h2>
              <p style={{ color:C.dim, fontSize:14 }}>{progress}</p>
            </div>
          )}

          {/* ── DONE ── */}
          {step === 'done' && (
            <div style={{ textAlign:'center', padding:'10px 0' }}>
              <div style={{ fontSize:56, marginBottom:14 }}>🎉</div>
              <h2 style={{ color:C.green, fontWeight:'normal', fontSize:22, marginBottom:8 }}>All done!</h2>
              <p style={{ color:C.muted, fontSize:14, lineHeight:1.7, marginBottom:24 }}>
                <strong style={{ color:C.text }}>{lastCount} speaking opportunities</strong> for <strong style={{ color:C.text }}>{monthLabel}</strong> are now live for your whole team.
              </p>
              <button onClick={reset}
                style={{ background:'none', border:`1px solid ${C.border}`, color:C.dim, borderRadius:8, padding:'10px 24px', cursor:'pointer', fontSize:13, fontFamily:'inherit' }}>
                Sync Another Month
              </button>
            </div>
          )}

          {/* ── ERROR ── */}
          {step === 'error' && (
            <div style={{ textAlign:'center', padding:'10px 0' }}>
              <div style={{ fontSize:48, marginBottom:14 }}>⚠️</div>
              <h2 style={{ color:C.orange, fontWeight:'normal', fontSize:20, marginBottom:10 }}>Couldn't sync</h2>
              <p style={{ color:C.dim, fontSize:13, lineHeight:1.7, marginBottom:20, background:'rgba(224,85,85,0.08)', border:`1px solid rgba(224,85,85,0.2)`, borderRadius:8, padding:'12px 14px' }}>{errorMsg}</p>
              <div style={{ display:'flex', gap:10, justifyContent:'center' }}>
                <button onClick={reset}
                  style={{ background:`linear-gradient(135deg,#c9a84c,${C.gold})`, color:C.bg, border:'none', borderRadius:8, padding:'10px 22px', cursor:'pointer', fontSize:14, fontWeight:'bold', fontFamily:'inherit' }}>
                  Try Again
                </button>
                {mode === 'email' && (
                  <button onClick={()=>{ setStep('idle'); setError(''); setMode('url') }}
                    style={{ background:'none', border:`1px solid ${C.border}`, color:C.muted, borderRadius:8, padding:'10px 22px', cursor:'pointer', fontSize:13, fontFamily:'inherit' }}>
                    Paste URL Instead
                  </button>
                )}
              </div>
            </div>
          )}

        </div>

        {/* Help text */}
        {step === 'idle' && mode === 'url' && (
          <p style={{ textAlign:'center', color:C.dimmer, fontSize:12, lineHeight:1.7, marginTop:14 }}>
            In Jennifer's email, look for a button that says "Open in Google Calendar" or any link starting with <em>calendar.google.com</em> — copy and paste that link above.
          </p>
        )}
      </div>

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  )
}
