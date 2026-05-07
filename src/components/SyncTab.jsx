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
  const [status,    setStatus]   = useState('idle')  // idle | scanning | saving | success | error
  const [icalUrl,   setIcalUrl]  = useState('')
  const [monthLabel,setMonth]    = useState('')
  const [result,    setResult]   = useState(null)    // { count, highMatch, calendarName, month }
  const [errorMsg,  setError]    = useState('')
  const [history,   setHistory]  = useState([])
  const [step,      setStep]     = useState('')      // current progress description

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

  // ── Core: scan email, fetch iCal, save to DB — all in one go ──────────────
  const runSync = async (rawUrl, month) => {
    setStatus('scanning')
    setStep('Fetching calendar events…')
    setResult(null)
    setError('')

    try {
      const icalUrl = extractIcalUrl(rawUrl)
      if (!icalUrl) throw new Error('Could not parse that calendar URL.')

      // Fetch + parse via server
      const res = await fetch('/api/scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: icalUrl, icpGenres, calendarMonth: month })
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Scan failed')

      const opps = data.opportunities || []
      if (opps.length === 0) throw new Error('Calendar was found but contained no events.')

      // Score
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

      // Save to DB — auto, no confirm needed
      setStatus('saving')
      setStep('Saving to database…')

      await supabase.from('opportunities').delete().eq('calendar_month', month)
      const { error: insertError } = await supabase.from('opportunities').insert(rows)
      if (insertError) throw new Error(`Database error: ${insertError.message}`)

      // Log to history
      await supabase.from('pending_syncs').upsert({
        month_label:   month,
        status:        'imported',
        email_from:    'Admin',
        email_date:    new Date().toISOString(),
        calendar_name: month,
        ical_url:      rawUrl,
        imported_at:   new Date().toISOString(),
        imported_by:   session.user.id,
        event_count:   rows.length,
        created_at:    new Date().toISOString()
      }, { onConflict: 'month_label' })

      const highMatch = rows.filter(r => r.icp_score >= 75).length
      const hasContact = rows.filter(r => r.contact_email).length
      const hasLocation = rows.filter(r => r.location).length
      const genres = [...new Set(rows.map(r => r.genre).filter(Boolean))]

      setResult({ count: rows.length, highMatch, hasContact, hasLocation, genres, month })
      setStatus('success')
      setStep('')
      loadHistory()

    } catch(e) {
      setError(e.message)
      setStatus('error')
      setStep('')
    }
  }

  // ── Scan email first, then sync ────────────────────────────────────────────
  const scanEmail = async (searchAll = false) => {
    setStatus('scanning')
    setStep(searchAll ? 'Deep-searching all emails…' : 'Searching inbox for Jennifer\'s calendar…')
    setResult(null); setError('')

    try {
      const res = await fetch('/api/scan-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ senderEmails: [], searchAll })
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)

      const emails = data.emails || []
      if (emails.length === 0) throw new Error('No calendar invite emails found in inbox. Try Deep Search or paste the URL manually.')

      const best    = emails[0]
      const rawUrl  = best.icalUrl || best.embedUrl
      if (!rawUrl)  throw new Error('Email found but no calendar link inside it. Paste the URL manually.')

      const month = best.calendarName || monthLabel
      setMonth(month)
      setIcalUrl(rawUrl)
      setStep(`Found "${best.calendarName || best.subject}" — fetching events…`)

      await runSync(rawUrl, month)

    } catch(e) {
      setError(e.message)
      setStatus('error')
      setStep('')
    }
  }

  const handlePasteSync = () => {
    if (!icalUrl.trim() || !monthLabel.trim()) return
    runSync(icalUrl.trim(), monthLabel.trim())
  }

  const reset = () => { setStatus('idle'); setError(''); setResult(null); setStep('') }

  const inp = { width:'100%', background:'#0d0f14', border:`1px solid ${C.border}`, borderRadius:6, padding:'10px 14px', color:C.text, fontSize:13, fontFamily:'inherit', outline:'none', boxSizing:'border-box' }
  const btn = (disabled) => ({
    background: disabled ? '#1e2130' : `linear-gradient(135deg,#c9a84c,${C.gold})`,
    color: disabled ? C.dimmer : C.bg,
    border:'none', borderRadius:8, padding:'10px 20px', fontSize:13,
    fontWeight:'bold', cursor:disabled?'not-allowed':'pointer',
    letterSpacing:'0.04em', fontFamily:'inherit'
  })

  const busy = status === 'scanning' || status === 'saving'

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
        Load this month's calendar. Events save to the database automatically and appear on the dashboard immediately.
      </p>

      {/* ── BUSY STATE ── */}
      {busy && (
        <div style={{ background:C.surface, border:`1px solid ${C.border}`, borderRadius:12, padding:'32px', textAlign:'center', marginBottom:24 }}>
          <div style={{ fontSize:36, marginBottom:12, display:'inline-block', animation:'spin 1.2s linear infinite' }}>⟳</div>
          <div style={{ color:C.text, fontSize:15, marginBottom:6 }}>{status === 'saving' ? 'Saving to database…' : 'Loading calendar…'}</div>
          <div style={{ color:C.dim, fontSize:13 }}>{step}</div>
        </div>
      )}

      {/* ── SUCCESS STATE ── */}
      {status === 'success' && result && (
        <div style={{ background:C.greenFaint, border:`1px solid rgba(0,200,150,0.3)`, borderRadius:12, padding:'24px', marginBottom:24 }}>
          <div style={{ display:'flex', alignItems:'center', gap:12, marginBottom:16 }}>
            <span style={{ fontSize:28 }}>✅</span>
            <div>
              <div style={{ color:C.green, fontSize:16, fontWeight:'bold' }}>Calendar loaded successfully</div>
              <div style={{ color:C.dim, fontSize:13, marginTop:2 }}>{result.month} · Live on the dashboard now</div>
            </div>
          </div>

          {/* Stats grid */}
          <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill, minmax(120px,1fr))', gap:10, marginBottom:16 }}>
            {[
              { label:'Total Events',   value:result.count,       gold:false },
              { label:'High ICP Match', value:result.highMatch,   gold:true  },
              { label:'Has Contact',    value:result.hasContact,  gold:false },
              { label:'Has Location',   value:result.hasLocation, gold:false },
            ].map(s => (
              <div key={s.label} style={{ background:'rgba(0,0,0,0.3)', borderRadius:8, padding:'12px 14px', textAlign:'center' }}>
                <div style={{ fontSize:22, fontWeight:'bold', color:s.gold?C.gold:C.text }}>{s.value}</div>
                <div style={{ fontSize:10, color:C.dim, textTransform:'uppercase', letterSpacing:'0.07em', marginTop:2 }}>{s.label}</div>
              </div>
            ))}
          </div>

          {/* Genres found */}
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

      {/* ── ERROR STATE ── */}
      {status === 'error' && (
        <div style={{ background:'rgba(224,85,85,0.08)', border:`1px solid rgba(224,85,85,0.3)`, borderRadius:12, padding:'20px 24px', marginBottom:24 }}>
          <div style={{ display:'flex', alignItems:'center', gap:10, marginBottom:12 }}>
            <span style={{ fontSize:22 }}>⚠️</span>
            <div style={{ color:C.red, fontSize:15, fontWeight:'bold' }}>Sync failed</div>
          </div>
          <div style={{ color:C.muted, fontSize:13, lineHeight:1.7, marginBottom:14 }}>{errorMsg}</div>
          <button onClick={reset} style={btn(false)}>Try Again</button>
        </div>
      )}

      {/* ── IDLE: action buttons + URL input ── */}
      {!busy && status !== 'success' && (
        <div>
          {/* Buttons */}
          <div style={{ display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:10, marginBottom:20 }}>
            {[
              { icon:'✉️', label:'Scan Email',  sub:'Find Jennifer\'s latest invite', onClick:()=>scanEmail(false), gold:true },
              { icon:'🔍', label:'Deep Search', sub:'Search all past emails',          onClick:()=>scanEmail(true)  },
              { icon:'🔗', label:'Paste URL',   sub:'Enter calendar link below',       onClick:()=>document.getElementById('ical-url-input')?.focus() },
            ].map(b => (
              <button key={b.label} onClick={b.onClick}
                style={{ background:b.gold?`linear-gradient(135deg,#c9a84c,${C.gold})`:C.surface, color:b.gold?C.bg:C.text, border:b.gold?'none':`1px solid ${C.border}`, borderRadius:10, padding:'14px 10px', cursor:'pointer', fontFamily:'inherit', textAlign:'center', transition:'all 0.15s' }}>
                <div style={{ fontSize:20, marginBottom:5 }}>{b.icon}</div>
                <div style={{ fontSize:13, fontWeight:'bold', marginBottom:2 }}>{b.label}</div>
                <div style={{ fontSize:11, color:b.gold?'rgba(0,0,0,0.6)':C.dim }}>{b.sub}</div>
              </button>
            ))}
          </div>

          {/* URL + month inputs */}
          <div style={{ display:'flex', flexDirection:'column', gap:10, marginBottom:8 }}>
            <div>
              <label style={{ fontSize:11, color:C.muted, display:'block', marginBottom:5, textTransform:'uppercase', letterSpacing:'0.07em' }}>Calendar URL (optional — or use Scan Email above)</label>
              <input id="ical-url-input" style={inp} value={icalUrl} onChange={e=>setIcalUrl(e.target.value)} placeholder="webcal:// or https://calendar.google.com/…" />
            </div>
            <div style={{ display:'flex', gap:10, alignItems:'flex-end' }}>
              <div style={{ flex:1 }}>
                <label style={{ fontSize:11, color:C.muted, display:'block', marginBottom:5, textTransform:'uppercase', letterSpacing:'0.07em' }}>Month Label</label>
                <input style={{ ...inp }} value={monthLabel} onChange={e=>setMonth(e.target.value)} placeholder="e.g. May2026" />
              </div>
              <button style={btn(!icalUrl.trim() || !monthLabel.trim())} disabled={!icalUrl.trim() || !monthLabel.trim()} onClick={handlePasteSync}>
                Sync Now
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── SYNC HISTORY ── */}
      {history.length > 0 && (
        <div style={{ marginTop:28 }}>
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
                    {s.email_from && s.email_from !== 'Admin' && <span style={{ fontSize:11, color:C.dimmer, marginLeft:10 }}>via {s.email_from}</span>}
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
