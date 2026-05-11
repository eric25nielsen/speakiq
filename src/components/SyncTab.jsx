import React, { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase.js'

const C = {
  bg:'#0d0f14', surface:'#13151c', border:'#1e2130',
  gold:'#e8c96a', goldFaint:'rgba(232,201,106,0.12)',
  text:'#e8e4dc', muted:'#9ca3af', dim:'#6b7280', dimmer:'#4b5563',
  green:'#00c896', greenFaint:'rgba(0,200,150,0.1)',
  orange:'#f5a623', red:'#e05555',
}

const ICAL_BASE   = 'https://calendar.google.com/calendar/ical/'
const ICAL_SUFFIX = '/public/basic.ics'

const extractIcalUrl = (raw) => {
  if (!raw) return null
  raw = raw.trim()
  if (raw.includes('.ics')) return raw.replace(/^webcal:\/\//i, 'https://')
  const m = raw.match(/[?&]src=([^&]+)/)
  if (m) return `${ICAL_BASE}${encodeURIComponent(decodeURIComponent(m[1]))}${ICAL_SUFFIX}`
  if (raw.includes('@group.calendar.google.com') || raw.includes('@gmail.com'))
    return `${ICAL_BASE}${encodeURIComponent(raw)}${ICAL_SUFFIX}`
  // Handle cid= format from Google Calendar invite links
  const cidMatch = raw.match(/[?&]cid=([^&]+)/)
  if (cidMatch) {
    try {
      const decoded = atob(decodeURIComponent(cidMatch[1]))
      return `${ICAL_BASE}${encodeURIComponent(decoded)}${ICAL_SUFFIX}`
    } catch {}
  }
  return raw
}

const scoreOpp = (o) => {
  let s = 0
  if (o.genre)        s += 70
  if (o.contactEmail) s += 15
  if (o.location)     s += 10
  if (o.fee)          s += 5
  return s
}

const timeAgo = (d) => {
  if (!d) return ''
  const days = Math.floor((Date.now() - new Date(d).getTime()) / 86400000)
  if (days === 0) return 'Today'
  if (days === 1) return 'Yesterday'
  if (days < 30)  return `${days} days ago`
  return new Date(d).toLocaleDateString('en-US', { month:'short', day:'numeric', year:'numeric' })
}

export default function SyncTab({ session, icpGenres = [] }) {
  const [phase,      setPhase]    = useState('idle')  // idle | scanning-email | found-emails | syncing | saving | success | error
  const [icalUrl,    setIcalUrl]  = useState('')
  const [monthLabel, setMonth]    = useState('')
  const [result,     setResult]   = useState(null)
  const [errorMsg,   setError]    = useState('')
  const [step,       setStep]     = useState('')
  const [history,    setHistory]  = useState([])
  const [emailHits,  setEmailHits]= useState([])   // emails found in scan

  useEffect(() => {
    const now = new Date()
    setMonth(now.toLocaleString('default', { month:'long' }) + now.getFullYear())
    loadHistory()
  }, [])

  const loadHistory = async () => {
    const { data } = await supabase.from('pending_syncs')
      .select('*').order('created_at', { ascending:false }).limit(8)
    setHistory(data || [])
  }

  // ── Step 1: Scan email for calendar links ──────────────────────────────────
  const scanEmail = async () => {
    setPhase('scanning-email')
    setStep('Searching your inbox for calendar links…')
    setEmailHits([])
    setError('')

    try {
      const res = await fetch('/api/scan-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({})
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)

      const emails = (data.emails || []).filter(e => e.icalUrl || e.embedUrl || e.calendarId)

      if (emails.length === 0) {
        throw new Error('No calendar links found in your inbox. Make sure the email from Jennifer (or forwarded from Judy) is in your Gmail inbox, then try again.')
      }

      setEmailHits(emails)
      setPhase('found-emails')

    } catch(e) {
      setError(e.message)
      setPhase('error')
    }
  }

  // ── Step 2: User selects an email result → sync it ─────────────────────────
  const syncFromEmail = async (email) => {
    const rawUrl = email.icalUrl || email.embedUrl || email.calendarId
    const month  = email.calendarName || monthLabel
    setMonth(month)
    setIcalUrl(rawUrl)
    await runSync(rawUrl, month)
  }

  // ── Sync all found emails at once ──────────────────────────────────────────
  const syncAll = async () => {
    // Use the first/best hit
    if (emailHits.length > 0) await syncFromEmail(emailHits[0])
  }

  // ── Core sync: fetch iCal → save to DB ────────────────────────────────────
  const runSync = async (rawUrl, month) => {
    setPhase('syncing')
    setStep('Fetching calendar events…')
    setResult(null)
    setError('')

    try {
      const url = extractIcalUrl(rawUrl)
      if (!url) throw new Error('Could not parse the calendar URL. Try pasting it manually below.')

      const res = await fetch('/api/scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url, icpGenres, calendarMonth: month })
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Scan failed')

      const opps = data.opportunities || []
      if (opps.length === 0) throw new Error('Calendar was fetched but contained no events. The URL may be correct but the calendar is empty.')

      setPhase('saving')
      setStep(`Saving ${opps.length} opportunities to database…`)

      const rows = opps.map(o => ({
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
      const { error: insertError } = await supabase.from('opportunities').insert(rows)
      if (insertError) throw new Error(`Database error: ${insertError.message}`)

      await supabase.from('pending_syncs').upsert({
        month_label:   month,
        status:        'imported',
        email_from:    'Admin scan',
        email_date:    new Date().toISOString(),
        calendar_name: month,
        ical_url:      rawUrl,
        imported_at:   new Date().toISOString(),
        imported_by:   session.user.id,
        event_count:   rows.length,
        created_at:    new Date().toISOString()
      }, { onConflict: 'month_label' })

      const highMatch   = rows.filter(r => r.icp_score >= 75).length
      const hasContact  = rows.filter(r => r.contact_email).length
      const hasLocation = rows.filter(r => r.location).length
      const genres      = [...new Set(rows.map(r => r.genre).filter(Boolean))]

      setResult({ count:rows.length, highMatch, hasContact, hasLocation, genres, month })
      setPhase('success')
      setStep('')
      loadHistory()

    } catch(e) {
      setError(e.message)
      setPhase('error')
    }
  }

  const handleManualSync = () => {
    if (!icalUrl.trim() || !monthLabel.trim()) return
    runSync(icalUrl.trim(), monthLabel.trim())
  }

  const reset = () => { setPhase('idle'); setError(''); setResult(null); setStep(''); setEmailHits([]) }

  const busy = phase === 'scanning-email' || phase === 'syncing' || phase === 'saving'

  const inp = {
    width:'100%', background:'#0d0f14', border:`1px solid ${C.border}`,
    borderRadius:6, padding:'10px 14px', color:C.text, fontSize:13,
    fontFamily:'inherit', outline:'none', boxSizing:'border-box',
  }

  const statusBadge = (s) => ({
    imported: { color:C.green,  bg:'rgba(0,200,150,0.1)',  label:'✓ Imported' },
    no_email: { color:C.dimmer, bg:'rgba(75,85,99,0.2)',   label:'No Email'   },
    skipped:  { color:C.dimmer, bg:'rgba(75,85,99,0.2)',   label:'Skipped'    },
    pending:  { color:C.orange, bg:'rgba(245,166,35,0.1)', label:'Pending'    },
  }[s] || { color:C.dim, bg:'transparent', label:s })

  return (
    <div>
      <h2 style={{ color:C.gold, fontWeight:'normal', fontSize:21, marginBottom:4 }}>Sync Speaking Calendar</h2>
      <p style={{ color:C.dim, fontSize:14, lineHeight:1.7, marginBottom:24 }}>
        Click <strong style={{ color:C.text }}>Scan Email</strong> to automatically find Jennifer's calendar links in your inbox and load them. Or paste a URL directly below.
      </p>

      {/* ── BUSY ── */}
      {busy && (
        <div style={{ background:C.surface, border:`1px solid ${C.border}`, borderRadius:12, padding:'40px', textAlign:'center', marginBottom:24 }}>
          <div style={{ fontSize:36, marginBottom:12, display:'inline-block', animation:'spin 1.2s linear infinite' }}>⟳</div>
          <div style={{ color:C.text, fontSize:15, marginBottom:6 }}>
            {phase === 'scanning-email' ? 'Scanning email…' : phase === 'saving' ? 'Saving to database…' : 'Fetching calendar…'}
          </div>
          <div style={{ color:C.dim, fontSize:13 }}>{step}</div>
        </div>
      )}

      {/* ── FOUND EMAILS ── */}
      {phase === 'found-emails' && emailHits.length > 0 && (
        <div style={{ background:C.surface, border:`1px solid ${C.border}`, borderRadius:12, padding:'24px', marginBottom:24 }}>
          <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:16, flexWrap:'wrap', gap:10 }}>
            <div>
              <div style={{ color:C.text, fontSize:15, fontWeight:'bold' }}>
                Found {emailHits.length} calendar invite{emailHits.length !== 1 ? 's' : ''}
              </div>
              <div style={{ color:C.dim, fontSize:13, marginTop:2 }}>Select one to import, or import all</div>
            </div>
            {emailHits.length > 1 && (
              <button onClick={syncAll}
                style={{ background:`linear-gradient(135deg,#c9a84c,${C.gold})`, color:C.bg, border:'none', borderRadius:8, padding:'9px 20px', cursor:'pointer', fontSize:13, fontWeight:'bold', fontFamily:'inherit' }}>
                Import All →
              </button>
            )}
          </div>

          <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
            {emailHits.map((email, i) => (
              <div key={i} style={{ background:C.bg, border:`1px solid ${C.border}`, borderRadius:10, padding:'14px 16px', display:'flex', alignItems:'center', gap:14, flexWrap:'wrap' }}>
                <div style={{ flex:1, minWidth:200 }}>
                  <div style={{ fontSize:14, color:C.text, fontWeight:'bold', marginBottom:3 }}>
                    {email.calendarName || email.subject || 'Calendar Invite'}
                  </div>
                  <div style={{ display:'flex', gap:12, fontSize:11, color:C.dim, flexWrap:'wrap' }}>
                    <span>From: {email.from}</span>
                    {email.date && <span>{new Date(email.date).toLocaleDateString()}</span>}
                    <span style={{ color:C.green }}>✓ Calendar link found</span>
                  </div>
                </div>
                <button onClick={() => syncFromEmail(email)}
                  style={{ background:`linear-gradient(135deg,#c9a84c,${C.gold})`, color:C.bg, border:'none', borderRadius:8, padding:'8px 18px', cursor:'pointer', fontSize:12, fontWeight:'bold', fontFamily:'inherit', whiteSpace:'nowrap' }}>
                  Import →
                </button>
              </div>
            ))}
          </div>

          <button onClick={reset} style={{ background:'none', border:'none', color:C.dim, cursor:'pointer', fontSize:12, fontFamily:'inherit', marginTop:12, textDecoration:'underline' }}>
            Cancel
          </button>
        </div>
      )}

      {/* ── SUCCESS ── */}
      {phase === 'success' && result && (
        <div style={{ background:C.greenFaint, border:`1px solid rgba(0,200,150,0.3)`, borderRadius:12, padding:'24px', marginBottom:24 }}>
          <div style={{ display:'flex', alignItems:'center', gap:12, marginBottom:20 }}>
            <span style={{ fontSize:28 }}>✅</span>
            <div>
              <div style={{ color:C.green, fontSize:16, fontWeight:'bold' }}>Calendar loaded successfully</div>
              <div style={{ color:C.dim, fontSize:13, marginTop:2 }}>{result.month} · Live on the dashboard now</div>
            </div>
          </div>
          <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill, minmax(120px,1fr))', gap:10, marginBottom:16 }}>
            {[
              { label:'Total Events',   value:result.count,       gold:false },
              { label:'High ICP Match', value:result.highMatch,   gold:true  },
              { label:'Has Contact',    value:result.hasContact,  gold:false },
              { label:'Has Location',   value:result.hasLocation, gold:false },
            ].map(s => (
              <div key={s.label} style={{ background:'rgba(0,0,0,0.25)', borderRadius:8, padding:'12px 14px', textAlign:'center' }}>
                <div style={{ fontSize:24, fontWeight:'bold', color:s.gold?C.gold:C.text }}>{s.value}</div>
                <div style={{ fontSize:10, color:C.dim, textTransform:'uppercase', letterSpacing:'0.07em', marginTop:3 }}>{s.label}</div>
              </div>
            ))}
          </div>
          {result.genres.length > 0 && (
            <div style={{ marginBottom:16 }}>
              <div style={{ fontSize:11, color:C.dim, textTransform:'uppercase', letterSpacing:'0.07em', marginBottom:8 }}>Genres Found</div>
              <div style={{ display:'flex', flexWrap:'wrap', gap:6 }}>
                {result.genres.map(g => (
                  <span key={g} style={{ fontSize:11, color:C.gold, background:C.goldFaint, border:`1px solid rgba(232,201,106,0.2)`, borderRadius:4, padding:'2px 10px' }}>{g}</span>
                ))}
              </div>
            </div>
          )}
          <button onClick={reset} style={{ background:'none', border:`1px solid rgba(0,200,150,0.3)`, color:C.green, borderRadius:6, padding:'7px 16px', cursor:'pointer', fontSize:12, fontFamily:'inherit' }}>
            Load Another Month
          </button>
        </div>
      )}

      {/* ── ERROR ── */}
      {phase === 'error' && (
        <div style={{ background:'rgba(224,85,85,0.08)', border:`1px solid rgba(224,85,85,0.3)`, borderRadius:12, padding:'20px 24px', marginBottom:24 }}>
          <div style={{ display:'flex', alignItems:'center', gap:10, marginBottom:10 }}>
            <span style={{ fontSize:22 }}>⚠️</span>
            <div style={{ color:C.red, fontSize:15, fontWeight:'bold' }}>Sync failed</div>
          </div>
          <div style={{ color:C.muted, fontSize:13, lineHeight:1.7, marginBottom:14 }}>{errorMsg}</div>
          <button onClick={reset} style={{ background:`linear-gradient(135deg,#c9a84c,${C.gold})`, color:C.bg, border:'none', borderRadius:8, padding:'9px 20px', fontSize:13, fontWeight:'bold', cursor:'pointer', fontFamily:'inherit' }}>
            Try Again
          </button>
        </div>
      )}

      {/* ── IDLE: Scan button + manual URL ── */}
      {!busy && phase !== 'success' && phase !== 'found-emails' && (
        <div style={{ display:'flex', flexDirection:'column', gap:12, marginBottom:24 }}>

          {/* Big scan button */}
          <button onClick={scanEmail}
            style={{ background:`linear-gradient(135deg,#c9a84c,${C.gold})`, color:C.bg, border:'none', borderRadius:12, padding:'20px', cursor:'pointer', fontFamily:'inherit', display:'flex', alignItems:'center', gap:16, width:'100%', textAlign:'left' }}>
            <span style={{ fontSize:32, flexShrink:0 }}>✉️</span>
            <div>
              <div style={{ fontSize:16, fontWeight:'bold', marginBottom:3 }}>Scan Email for Calendar Links</div>
              <div style={{ fontSize:13, opacity:0.75 }}>Searches your inbox for Jennifer's monthly speaking calendar — finds the link and loads it automatically</div>
            </div>
          </button>

          {/* Divider */}
          <div style={{ display:'flex', alignItems:'center', gap:10 }}>
            <div style={{ flex:1, height:1, background:C.border }} />
            <span style={{ fontSize:12, color:C.dimmer }}>or paste manually</span>
            <div style={{ flex:1, height:1, background:C.border }} />
          </div>

          {/* Manual URL */}
          <div style={{ background:C.surface, border:`1px solid ${C.border}`, borderRadius:12, padding:'20px' }}>
            <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
              <div>
                <label style={{ fontSize:11, color:C.muted, display:'block', marginBottom:5, textTransform:'uppercase', letterSpacing:'0.07em' }}>Calendar URL</label>
                <textarea
                  value={icalUrl}
                  onChange={e => setIcalUrl(e.target.value)}
                  rows={2}
                  placeholder="Paste any Google Calendar link here — webcal://, embed URL, or iCal URL"
                  style={{ ...inp, fontFamily:'monospace', resize:'vertical', lineHeight:1.5, border:`1px solid ${icalUrl ? C.gold : C.border}` }}
                />
              </div>
              <div style={{ display:'flex', gap:10, alignItems:'flex-end' }}>
                <div style={{ flex:1 }}>
                  <label style={{ fontSize:11, color:C.muted, display:'block', marginBottom:5, textTransform:'uppercase', letterSpacing:'0.07em' }}>Month Label</label>
                  <input value={monthLabel} onChange={e => setMonth(e.target.value)} placeholder="e.g. May2026" style={inp} />
                </div>
                <button onClick={handleManualSync} disabled={!icalUrl.trim() || !monthLabel.trim()}
                  style={{ background:(icalUrl.trim()&&monthLabel.trim())?`linear-gradient(135deg,#c9a84c,${C.gold})`:'#1e2130', color:(icalUrl.trim()&&monthLabel.trim())?C.bg:C.dimmer, border:'none', borderRadius:8, padding:'10px 20px', fontSize:13, fontWeight:'bold', cursor:(icalUrl.trim()&&monthLabel.trim())?'pointer':'not-allowed', fontFamily:'inherit', whiteSpace:'nowrap' }}>
                  Sync Now →
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── HISTORY ── */}
      {history.length > 0 && (
        <div style={{ marginTop:8 }}>
          <div style={{ fontSize:12, color:C.dim, textTransform:'uppercase', letterSpacing:'0.07em', marginBottom:10 }}>Sync History</div>
          <div style={{ display:'flex', flexDirection:'column', gap:6 }}>
            {history.map(s => {
              const badge = statusBadge(s.status)
              return (
                <div key={s.id} style={{ background:C.surface, border:`1px solid ${C.border}`, borderRadius:8, padding:'10px 16px', display:'flex', alignItems:'center', gap:12, flexWrap:'wrap' }}>
                  <div style={{ background:badge.bg, color:badge.color, borderRadius:20, padding:'2px 10px', fontSize:11, fontWeight:'bold', whiteSpace:'nowrap' }}>{badge.label}</div>
                  <div style={{ flex:1 }}>
                    <span style={{ fontSize:13, color:C.text }}>{s.calendar_name || s.month_label}</span>
                    {s.event_count != null && <span style={{ fontSize:12, color:C.dim, marginLeft:10 }}>{s.event_count} events</span>}
                  </div>
                  <span style={{ fontSize:11, color:C.dimmer, whiteSpace:'nowrap' }}>{timeAgo(s.imported_at || s.created_at)}</span>
                </div>
              )
            })}
          </div>
        </div>
      )}

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  )
}
