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
const ALL_GENRES = ['Leadership','Business','Healthcare','Technology','Education','Finance','Entrepreneurship','Sales','Mental Health','Nonprofit','Government','Real Estate','HR & Talent','Marketing','Wellness','Legal']

const extractIcalUrl = (raw) => {
  if (!raw) return null
  raw = raw.trim()
  if (raw.includes('.ics')) return raw.replace(/^webcal:\/\//i, 'https://')
  const srcMatch = raw.match(/[?&]src=([^&]+)/)
  if (srcMatch) return `${ICAL_BASE}${encodeURIComponent(decodeURIComponent(srcMatch[1]))}${ICAL_SUFFIX}`
  if (raw.includes('@group.calendar.google.com') || raw.includes('@gmail.com'))
    return `${ICAL_BASE}${encodeURIComponent(raw)}${ICAL_SUFFIX}`
  return raw
}

const scoreOpp = (o) => {
  let s = 0
  if (o.genre) s += 70
  if (o.contactEmail || o.contact_email) s += 15
  if (o.location) s += 10
  if (o.fee) s += 5
  return s
}

const inp = {
  width:'100%', background:'#0d0f14', border:`1px solid #1e2130`,
  borderRadius:8, padding:'9px 14px', color:'#e8e4dc', fontSize:13,
  fontFamily:'inherit', outline:'none', boxSizing:'border-box',
}

export default function Syncer({ session }) {
  const [screen,     setScreen]    = useState('home')   // home | email-results | url | settings | syncing | done | error
  const [monthLabel, setMonth]     = useState('')
  const [url,        setUrl]       = useState('')
  const [progress,   setProgress]  = useState('')
  const [errorMsg,   setError]     = useState('')
  const [lastSync,   setLastSync]  = useState(null)
  const [lastCount,  setCount]     = useState(null)

  // Email scan results
  const [emailResults, setEmailResults] = useState([])
  const [scanning,     setScanning]     = useState(false)

  // Extra sender addresses
  const [extraSenders, setExtraSenders] = useState([])
  const [newSender,    setNewSender]    = useState('')

  useEffect(() => {
    const now = new Date()
    setMonth(now.toLocaleString('default',{month:'long'}) + now.getFullYear())
    supabase.from('opportunities').select('created_at').order('created_at',{ascending:false}).limit(1)
      .then(({ data }) => { if (data?.[0]) setLastSync(data[0].created_at) })

    // Load saved extra senders
    try {
      const saved = JSON.parse(localStorage.getItem(`speakiq_senders_${session.user.id}`) || '[]')
      setExtraSenders(saved)
    } catch {}
  }, [session.user.id])

  const saveExtraSenders = (list) => {
    setExtraSenders(list)
    localStorage.setItem(`speakiq_senders_${session.user.id}`, JSON.stringify(list))
  }

  const addSender = () => {
    if (!newSender.trim() || extraSenders.includes(newSender.trim())) return
    saveExtraSenders([...extraSenders, newSender.trim()])
    setNewSender('')
  }

  const signOut = () => supabase.auth.signOut()

  // ── Scan email inbox ──────────────────────────────────────────────────────
  const scanEmail = async (searchAll = false) => {
    setScanning(true)
    setEmailResults([])
    try {
      const res = await fetch('/api/scan-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ senderEmails: extraSenders, searchAll })
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      setEmailResults(data.emails || [])
      setScreen('email-results')
    } catch(e) {
      setError(e.message)
      setScreen('error')
    }
    setScanning(false)
  }

  // ── Save opportunities to DB ──────────────────────────────────────────────
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

  // ── Main sync from URL ────────────────────────────────────────────────────
  const syncFromUrl = async (rawUrl, month) => {
    setScreen('syncing')
    setError('')
    setProgress('Fetching calendar…')
    try {
      const icalUrl = extractIcalUrl(rawUrl)
      if (!icalUrl) throw new Error('Could not parse calendar URL. Please check the link and try again.')

      const res = await fetch('/api/scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: icalUrl, icpGenres: ALL_GENRES, calendarMonth: month })
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Scan failed')

      setProgress('Saving opportunities…')
      const count = await saveOpps(data.opportunities || [], month)
      setCount(count)
      setLastSync(new Date().toISOString())
      setScreen('done')
    } catch(e) {
      setError(e.message)
      setScreen('error')
    }
  }

  // ── Use selected email result ─────────────────────────────────────────────
  const useEmailResult = (email) => {
    const rawUrl = email.icalUrl || email.embedUrl || email.calendarId
    if (email.calendarName) setMonth(email.calendarName)
    syncFromUrl(rawUrl, email.calendarName || monthLabel)
  }

  // ── UI helpers ────────────────────────────────────────────────────────────
  const BigBtn = ({ onClick, disabled, icon, title, subtitle, variant='gold' }) => (
    <button onClick={onClick} disabled={disabled}
      style={{ width:'100%', background: disabled ? '#1e2130' : variant==='gold' ? `linear-gradient(135deg,#c9a84c,${C.gold})` : C.bg, color: disabled ? C.dimmer : variant==='gold' ? C.bg : C.text, border: variant==='outline' ? `1px solid ${C.border}` : 'none', borderRadius:12, padding:'18px 20px', cursor: disabled ? 'not-allowed' : 'pointer', fontFamily:'inherit', textAlign:'left', display:'flex', alignItems:'center', gap:16, transition:'all 0.15s' }}
      onMouseEnter={e=>{ if(!disabled && variant==='outline') e.currentTarget.style.borderColor=C.gold }}
      onMouseLeave={e=>{ if(!disabled && variant==='outline') e.currentTarget.style.borderColor=C.border }}>
      <span style={{ fontSize:28, flexShrink:0 }}>{icon}</span>
      <div>
        <div style={{ fontSize:15, fontWeight:'bold', marginBottom:3 }}>{title}</div>
        <div style={{ fontSize:12, opacity: variant==='gold' ? 0.75 : undefined, color: variant==='outline' ? C.dim : undefined, lineHeight:1.4 }}>{subtitle}</div>
      </div>
    </button>
  )

  return (
    <div style={{ minHeight:'100vh', background:C.bg, display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', padding:20 }}>

      {/* Top bar */}
      <div style={{ position:'fixed', top:0, left:0, right:0, padding:'14px 24px', display:'flex', alignItems:'center', justifyContent:'space-between', background:C.bg, borderBottom:`1px solid ${C.border}`, zIndex:10 }}>
        <div style={{ display:'flex', alignItems:'center', gap:10 }}>
          <div style={{ width:28, height:28, background:`linear-gradient(135deg,#c9a84c,${C.gold})`, borderRadius:6, display:'flex', alignItems:'center', justifyContent:'center', fontWeight:'bold', color:C.bg, fontSize:13 }}>S</div>
          <span style={{ color:C.gold, fontWeight:'bold', fontSize:14 }}>SpeakIQ</span>
        </div>
        <div style={{ display:'flex', gap:8 }}>
          <button onClick={()=>setScreen('settings')} style={{ background:'none', border:`1px solid ${C.border}`, color:C.dim, borderRadius:6, padding:'5px 12px', cursor:'pointer', fontSize:12, fontFamily:'inherit' }}>⚙ Settings</button>
          <button onClick={signOut} style={{ background:'none', border:`1px solid ${C.border}`, color:C.dim, borderRadius:6, padding:'5px 12px', cursor:'pointer', fontSize:12, fontFamily:'inherit' }}>Sign out</button>
        </div>
      </div>

      <div style={{ width:'100%', maxWidth:500, marginTop:60 }}>

        {/* Last sync badge */}
        {lastSync && !['syncing','done','error'].includes(screen) && (
          <div style={{ background:C.greenFaint, border:`1px solid rgba(0,200,150,0.25)`, borderRadius:10, padding:'10px 16px', display:'flex', alignItems:'center', gap:10, marginBottom:16 }}>
            <span style={{ color:C.green, fontSize:15 }}>✓</span>
            <div style={{ fontSize:12 }}>
              <span style={{ color:C.green, fontWeight:'bold' }}>Last synced: </span>
              <span style={{ color:C.dim }}>{new Date(lastSync).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric',hour:'numeric',minute:'2-digit'})}</span>
            </div>
          </div>
        )}

        <div style={{ background:C.surface, border:`1px solid ${C.border}`, borderRadius:16, padding:28 }}>

          {/* ── HOME ── */}
          {screen === 'home' && (
            <div>
              <div style={{ textAlign:'center', marginBottom:24 }}>
                <div style={{ fontSize:40, marginBottom:10 }}>📅</div>
                <h1 style={{ color:C.text, fontWeight:'normal', fontSize:20, marginBottom:6 }}>Load This Month's Calendar</h1>
                <p style={{ color:C.dim, fontSize:13, lineHeight:1.6 }}>Choose how to get Jennifer's speaking calendar.</p>
              </div>
              <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
                <BigBtn
                  onClick={()=>scanEmail(false)}
                  disabled={scanning}
                  icon={scanning ? '⟳' : '✉️'}
                  title={scanning ? 'Scanning inbox…' : 'Scan My Email'}
                  subtitle="Automatically searches your inbox for calendar invite emails — no copy/paste needed"
                  variant="gold"
                />
                <BigBtn
                  onClick={()=>scanEmail(true)}
                  disabled={scanning}
                  icon="🔍"
                  title="Deep Email Search"
                  subtitle="Searches all past emails for any calendar invites, not just from known senders"
                  variant="outline"
                />
                <BigBtn
                  onClick={()=>setScreen('url')}
                  icon="🔗"
                  title="Paste Calendar Link"
                  subtitle="Copy the link from Jennifer's email and paste it manually"
                  variant="outline"
                />
              </div>
            </div>
          )}

          {/* ── EMAIL RESULTS ── */}
          {screen === 'email-results' && (
            <div>
              <div style={{ display:'flex', alignItems:'center', gap:10, marginBottom:20 }}>
                <button onClick={()=>setScreen('home')} style={{ background:'none', border:'none', color:C.dim, cursor:'pointer', fontSize:18, padding:0, lineHeight:1 }}>←</button>
                <h2 style={{ color:C.text, fontWeight:'normal', fontSize:18, margin:0 }}>
                  {emailResults.length > 0 ? `Found ${emailResults.length} calendar invite${emailResults.length!==1?'s':''}` : 'No calendar emails found'}
                </h2>
              </div>

              {emailResults.length === 0 ? (
                <div style={{ textAlign:'center', padding:'20px 0' }}>
                  <div style={{ fontSize:36, marginBottom:12, opacity:0.3 }}>📭</div>
                  <p style={{ color:C.dim, fontSize:13, lineHeight:1.7, marginBottom:20 }}>
                    No calendar invite emails found in your inbox. You can add more sender addresses in Settings, try a Deep Search, or paste the URL manually.
                  </p>
                  <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
                    <button onClick={()=>scanEmail(true)} style={{ background:`linear-gradient(135deg,#c9a84c,${C.gold})`, color:C.bg, border:'none', borderRadius:8, padding:'10px', cursor:'pointer', fontSize:13, fontWeight:'bold', fontFamily:'inherit' }}>Try Deep Search</button>
                    <button onClick={()=>setScreen('url')} style={{ background:'none', border:`1px solid ${C.border}`, color:C.muted, borderRadius:8, padding:'10px', cursor:'pointer', fontSize:13, fontFamily:'inherit' }}>Paste URL Instead</button>
                    <button onClick={()=>setScreen('settings')} style={{ background:'none', border:'none', color:C.dim, cursor:'pointer', fontSize:12, fontFamily:'inherit', textDecoration:'underline' }}>Add More Senders in Settings</button>
                  </div>
                </div>
              ) : (
                <div>
                  <p style={{ color:C.dim, fontSize:12, marginBottom:14, lineHeight:1.6 }}>Select which calendar to load:</p>
                  <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
                    {emailResults.map((email, i) => (
                      <button key={i} onClick={()=>useEmailResult(email)}
                        style={{ background:C.bg, border:`1px solid ${C.border}`, borderRadius:10, padding:'14px 16px', cursor:'pointer', fontFamily:'inherit', textAlign:'left', transition:'border-color 0.15s' }}
                        onMouseEnter={e=>e.currentTarget.style.borderColor=C.gold}
                        onMouseLeave={e=>e.currentTarget.style.borderColor=C.border}>
                        <div style={{ fontSize:13, color:C.text, fontWeight:'bold', marginBottom:4 }}>{email.calendarName || email.subject || 'Calendar Invite'}</div>
                        <div style={{ fontSize:11, color:C.dim }}>From: {email.from}</div>
                        <div style={{ fontSize:11, color:C.dimmer }}>{email.date}</div>
                        {(email.icalUrl || email.embedUrl) && <div style={{ fontSize:11, color:C.green, marginTop:4 }}>✓ Calendar link found</div>}
                      </button>
                    ))}
                  </div>
                  <div style={{ marginTop:14, display:'flex', justifyContent:'center' }}>
                    <button onClick={()=>setScreen('url')} style={{ background:'none', border:'none', color:C.dim, cursor:'pointer', fontSize:12, fontFamily:'inherit', textDecoration:'underline' }}>Or paste a URL manually instead</button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ── PASTE URL ── */}
          {screen === 'url' && (
            <div>
              <div style={{ display:'flex', alignItems:'center', gap:10, marginBottom:20 }}>
                <button onClick={()=>setScreen('home')} style={{ background:'none', border:'none', color:C.dim, cursor:'pointer', fontSize:18, padding:0, lineHeight:1 }}>←</button>
                <h2 style={{ color:C.text, fontWeight:'normal', fontSize:18, margin:0 }}>Paste Calendar Link</h2>
              </div>
              <div style={{ display:'flex', flexDirection:'column', gap:12, marginBottom:20 }}>
                <div>
                  <label style={{ fontSize:11, color:C.muted, display:'block', marginBottom:6, textTransform:'uppercase', letterSpacing:'0.07em' }}>Calendar link from Jennifer's email</label>
                  <textarea value={url} onChange={e=>setUrl(e.target.value)} rows={3}
                    placeholder="Paste any Google Calendar link here…"
                    style={{ ...inp, fontFamily:'monospace', resize:'vertical', lineHeight:1.5, border:`1px solid ${url ? C.gold : C.border}` }} />
                </div>
                <div>
                  <label style={{ fontSize:11, color:C.muted, display:'block', marginBottom:6, textTransform:'uppercase', letterSpacing:'0.07em' }}>Month label</label>
                  <input value={monthLabel} onChange={e=>setMonth(e.target.value)} style={inp} />
                </div>
              </div>
              <button onClick={()=>syncFromUrl(url, monthLabel)} disabled={!url.trim()}
                style={{ width:'100%', background: url.trim() ? `linear-gradient(135deg,#c9a84c,${C.gold})` : '#1e2130', color: url.trim() ? C.bg : C.dimmer, border:'none', borderRadius:10, padding:'14px', fontSize:15, fontWeight:'bold', cursor: url.trim() ? 'pointer' : 'not-allowed', letterSpacing:'0.04em', fontFamily:'inherit' }}>
                Sync Calendar →
              </button>
            </div>
          )}

          {/* ── SETTINGS ── */}
          {screen === 'settings' && (
            <div>
              <div style={{ display:'flex', alignItems:'center', gap:10, marginBottom:20 }}>
                <button onClick={()=>setScreen('home')} style={{ background:'none', border:'none', color:C.dim, cursor:'pointer', fontSize:18, padding:0, lineHeight:1 }}>←</button>
                <h2 style={{ color:C.text, fontWeight:'normal', fontSize:18, margin:0 }}>Settings</h2>
              </div>

              <div style={{ marginBottom:24 }}>
                <div style={{ fontSize:13, color:C.text, fontWeight:'bold', marginBottom:4 }}>Email Senders to Search</div>
                <p style={{ fontSize:12, color:C.dim, lineHeight:1.6, marginBottom:12 }}>
                  Add any email addresses you receive speaking calendar invites from. The default sender (Jennifer) is always included.
                </p>

                {/* Default sender */}
                <div style={{ background:C.bg, borderRadius:8, padding:'10px 14px', marginBottom:8, display:'flex', alignItems:'center', justifyContent:'space-between' }}>
                  <div>
                    <div style={{ fontSize:12, color:C.muted }}>jenniferspeakersclubrep@gmail.com</div>
                    <div style={{ fontSize:10, color:C.dimmer }}>Default — always searched</div>
                  </div>
                  <span style={{ fontSize:11, color:C.green, background:'rgba(0,200,150,0.1)', padding:'2px 8px', borderRadius:4 }}>Default</span>
                </div>

                {/* Extra senders */}
                {extraSenders.map((s, i) => (
                  <div key={i} style={{ background:C.bg, borderRadius:8, padding:'10px 14px', marginBottom:8, display:'flex', alignItems:'center', justifyContent:'space-between' }}>
                    <div style={{ fontSize:12, color:C.muted }}>{s}</div>
                    <button onClick={()=>saveExtraSenders(extraSenders.filter((_,j)=>j!==i))}
                      style={{ background:'none', border:'none', color:C.red, cursor:'pointer', fontSize:16, padding:'0 4px' }}>×</button>
                  </div>
                ))}

                {/* Add sender */}
                <div style={{ display:'flex', gap:8, marginTop:10 }}>
                  <input value={newSender} onChange={e=>setNewSender(e.target.value)} onKeyDown={e=>e.key==='Enter'&&addSender()}
                    placeholder="Add email address…" style={{ ...inp, flex:1 }} />
                  <button onClick={addSender} disabled={!newSender.trim()}
                    style={{ background: newSender.trim() ? `linear-gradient(135deg,#c9a84c,${C.gold})` : '#1e2130', color: newSender.trim() ? C.bg : C.dimmer, border:'none', borderRadius:8, padding:'9px 16px', cursor: newSender.trim() ? 'pointer' : 'not-allowed', fontSize:13, fontWeight:'bold', fontFamily:'inherit', whiteSpace:'nowrap' }}>
                    Add
                  </button>
                </div>
              </div>

              <div>
                <div style={{ fontSize:13, color:C.text, fontWeight:'bold', marginBottom:4 }}>Month Label</div>
                <p style={{ fontSize:12, color:C.dim, marginBottom:8 }}>Auto-fills to current month. Update if syncing a different month.</p>
                <input value={monthLabel} onChange={e=>setMonth(e.target.value)} style={inp} />
              </div>
            </div>
          )}

          {/* ── SYNCING ── */}
          {screen === 'syncing' && (
            <div style={{ textAlign:'center', padding:'28px 0' }}>
              <div style={{ fontSize:44, marginBottom:14, display:'inline-block', animation:'spin 1.2s linear infinite' }}>⟳</div>
              <h2 style={{ color:C.text, fontWeight:'normal', fontSize:20, marginBottom:8 }}>Syncing…</h2>
              <p style={{ color:C.dim, fontSize:13 }}>{progress}</p>
            </div>
          )}

          {/* ── DONE ── */}
          {screen === 'done' && (
            <div style={{ textAlign:'center', padding:'16px 0' }}>
              <div style={{ fontSize:52, marginBottom:12 }}>🎉</div>
              <h2 style={{ color:C.green, fontWeight:'normal', fontSize:22, marginBottom:8 }}>All done!</h2>
              <p style={{ color:C.muted, fontSize:14, lineHeight:1.7, marginBottom:24 }}>
                <strong style={{ color:C.text }}>{lastCount} speaking opportunities</strong> for <strong style={{ color:C.text }}>{monthLabel}</strong> are now live for everyone.
              </p>
              <button onClick={()=>{ setScreen('home'); setUrl('') }}
                style={{ background:'none', border:`1px solid ${C.border}`, color:C.dim, borderRadius:8, padding:'10px 22px', cursor:'pointer', fontSize:13, fontFamily:'inherit' }}>
                ← Back to Home
              </button>
            </div>
          )}

          {/* ── ERROR ── */}
          {screen === 'error' && (
            <div style={{ textAlign:'center', padding:'16px 0' }}>
              <div style={{ fontSize:44, marginBottom:12 }}>⚠️</div>
              <h2 style={{ color:C.orange, fontWeight:'normal', fontSize:20, marginBottom:10 }}>Couldn't sync</h2>
              <div style={{ color:C.dim, fontSize:13, lineHeight:1.7, marginBottom:20, background:'rgba(224,85,85,0.08)', border:`1px solid rgba(224,85,85,0.2)`, borderRadius:8, padding:'12px 14px', textAlign:'left' }}>{errorMsg}</div>
              <div style={{ display:'flex', gap:10, justifyContent:'center', flexWrap:'wrap' }}>
                <button onClick={()=>setScreen('home')} style={{ background:`linear-gradient(135deg,#c9a84c,${C.gold})`, color:C.bg, border:'none', borderRadius:8, padding:'10px 22px', cursor:'pointer', fontSize:13, fontWeight:'bold', fontFamily:'inherit' }}>Try Again</button>
                <button onClick={()=>setScreen('url')} style={{ background:'none', border:`1px solid ${C.border}`, color:C.muted, borderRadius:8, padding:'10px 22px', cursor:'pointer', fontSize:13, fontFamily:'inherit' }}>Paste URL Instead</button>
              </div>
            </div>
          )}

        </div>
      </div>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  )
}
