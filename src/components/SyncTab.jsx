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
  const [phase,      setPhase]   = useState('idle')
  const [icalUrl,    setIcalUrl] = useState('')
  const [monthLabel, setMonth]   = useState('')
  const [result,     setResult]  = useState(null)
  const [errorMsg,   setError]   = useState('')
  const [step,       setStep]    = useState('')
  const [history,    setHistory] = useState([])

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

  const runSync = async () => {
    if (!icalUrl.trim() || !monthLabel.trim()) return
    setPhase('syncing')
    setStep('Fetching calendar events…')
    setResult(null)
    setError('')

    try {
      const url = extractIcalUrl(icalUrl.trim())
      if (!url) throw new Error('Could not parse that URL — make sure it starts with webcal:// or https://')

      const res = await fetch('/api/scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url, icpGenres, calendarMonth: monthLabel.trim() })
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Scan failed')

      const opps = data.opportunities || []
      if (opps.length === 0) throw new Error('Calendar fetched but no events found. Check the URL is correct.')

      setPhase('saving')
      setStep(`Saving ${opps.length} opportunities…`)

      const month = monthLabel.trim()
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
        email_from:    'Admin',
        email_date:    new Date().toISOString(),
        calendar_name: month,
        ical_url:      icalUrl.trim(),
        imported_at:   new Date().toISOString(),
        imported_by:   session.user.id,
        event_count:   rows.length,
        created_at:    new Date().toISOString()
      }, { onConflict: 'month_label' })

      setResult({
        count:       rows.length,
        highMatch:   rows.filter(r => r.icp_score >= 75).length,
        hasContact:  rows.filter(r => r.contact_email).length,
        hasLocation: rows.filter(r => r.location).length,
        genres:      [...new Set(rows.map(r => r.genre).filter(Boolean))],
        month,
      })
      setPhase('success')
      setStep('')
      loadHistory()

    } catch(e) {
      setError(e.message)
      setPhase('error')
    }
  }

  const reset = () => { setPhase('idle'); setError(''); setResult(null); setStep(''); setIcalUrl('') }

  const busy = phase === 'syncing' || phase === 'saving'

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
      <p style={{ color:C.dim, fontSize:14, lineHeight:1.7, marginBottom:6 }}>
        Paste the calendar URL below and hit Sync. Events save automatically and go live on the dashboard for all users instantly.
      </p>

      {/* How to get the URL tip */}
      <div style={{ background:C.goldFaint, border:`1px solid rgba(232,201,106,0.2)`, borderRadius:8, padding:'12px 16px', marginBottom:24, fontSize:13, color:C.muted, lineHeight:1.7 }}>
        <strong style={{ color:C.gold }}>How to get the URL each month:</strong> Ask Claude (claude.ai) — type <em>"find Jennifer's calendar email and give me the iCal URL"</em>. Claude will search your Gmail and return the URL in seconds. Then paste it here.
      </div>

      {/* ── BUSY ── */}
      {busy && (
        <div style={{ background:C.surface, border:`1px solid ${C.border}`, borderRadius:12, padding:'40px', textAlign:'center', marginBottom:24 }}>
          <div style={{ fontSize:36, marginBottom:12, display:'inline-block', animation:'spin 1.2s linear infinite' }}>⟳</div>
          <div style={{ color:C.text, fontSize:15, marginBottom:6 }}>
            {phase === 'saving' ? 'Saving to database…' : 'Fetching calendar…'}
          </div>
          <div style={{ color:C.dim, fontSize:13 }}>{step}</div>
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

      {/* ── IDLE ── */}
      {!busy && phase !== 'success' && (
        <div style={{ background:C.surface, border:`1px solid ${C.border}`, borderRadius:12, padding:'24px', marginBottom:24 }}>
          <div style={{ display:'flex', flexDirection:'column', gap:14 }}>
            <div>
              <label style={{ fontSize:11, color:C.muted, display:'block', marginBottom:6, textTransform:'uppercase', letterSpacing:'0.07em' }}>
                Calendar URL
              </label>
              <textarea
                value={icalUrl}
                onChange={e => setIcalUrl(e.target.value)}
                rows={3}
                placeholder="Paste the iCal URL here — starts with https://calendar.google.com/calendar/ical/..."
                style={{ ...inp, fontFamily:'monospace', resize:'vertical', lineHeight:1.6, border:`1px solid ${icalUrl ? C.gold : C.border}` }}
              />
            </div>
            <div style={{ display:'flex', gap:10, alignItems:'flex-end' }}>
              <div style={{ flex:1 }}>
                <label style={{ fontSize:11, color:C.muted, display:'block', marginBottom:6, textTransform:'uppercase', letterSpacing:'0.07em' }}>
                  Month Label
                </label>
                <input value={monthLabel} onChange={e => setMonth(e.target.value)} placeholder="e.g. May2026" style={inp} />
              </div>
              <button
                onClick={runSync}
                disabled={!icalUrl.trim() || !monthLabel.trim()}
                style={{
                  background: (icalUrl.trim() && monthLabel.trim()) ? `linear-gradient(135deg,#c9a84c,${C.gold})` : '#1e2130',
                  color: (icalUrl.trim() && monthLabel.trim()) ? C.bg : C.dimmer,
                  border:'none', borderRadius:8, padding:'10px 28px', fontSize:14,
                  fontWeight:'bold', cursor:(icalUrl.trim()&&monthLabel.trim())?'pointer':'not-allowed',
                  letterSpacing:'0.04em', fontFamily:'inherit', whiteSpace:'nowrap'
                }}>
                Sync Now →
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── HISTORY ── */}
      {history.length > 0 && (
        <div>
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
