import React, { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase.js'

const C = {
  bg:'#0d0f14', surface:'#13151c', border:'#1e2130',
  gold:'#e8c96a', goldFaint:'rgba(232,201,106,0.12)',
  text:'#e8e4dc', muted:'#9ca3af', dim:'#6b7280', dimmer:'#4b5563',
  green:'#00c896', greenFaint:'rgba(0,200,150,0.1)',
  red:'#e05555', orange:'#f5a623', blue:'#60a5fa',
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
  if (o.contactEmail) s += 15
  if (o.location) s += 10
  if (o.fee) s += 5
  return s
}

const inp = { width:'100%', background:'#0d0f14', border:`1px solid #1e2130`, borderRadius:8, padding:'9px 14px', color:'#e8e4dc', fontSize:13, fontFamily:'inherit', outline:'none', boxSizing:'border-box' }

const timeAgo = (dateStr) => {
  if (!dateStr) return ''
  const d = new Date(dateStr)
  const diff = Date.now() - d.getTime()
  const days = Math.floor(diff / 86400000)
  if (days === 0) return 'Today'
  if (days === 1) return 'Yesterday'
  if (days < 7) return `${days} days ago`
  if (days < 30) return `${Math.floor(days/7)} week${Math.floor(days/7)>1?'s':''} ago`
  return d.toLocaleDateString('en-US', { month:'short', day:'numeric', year:'numeric' })
}

export default function Syncer({ session }) {
  const [screen,       setScreen]     = useState('home')
  const [monthLabel,   setMonth]      = useState('')
  const [url,          setUrl]        = useState('')
  const [progress,     setProgress]   = useState('')
  const [errorMsg,     setError]      = useState('')

  // Pending syncs (from cron or manual scans)
  const [pendingSyncs, setPending]    = useState([])
  const [loadingPending, setLoadingP] = useState(true)

  // Manual email scan results
  const [emailResults, setEmailResults] = useState([])
  const [scanning,     setScanning]   = useState(false)

  // Preview before import
  const [previewOpps,  setPreview]    = useState([])
  const [previewSync,  setPreviewSync]= useState(null)  // the pending_sync record
  const [importing,    setImporting]  = useState(false)

  // Settings
  const [extraSenders, setExtraSenders] = useState([])
  const [newSender,    setNewSender]  = useState('')

  useEffect(() => {
    const now = new Date()
    setMonth(now.toLocaleString('default',{month:'long'}) + now.getFullYear())
    loadPendingSyncs()
    try {
      const saved = JSON.parse(localStorage.getItem(`speakiq_senders_${session.user.id}`) || '[]')
      setExtraSenders(saved)
    } catch {}
  }, [session.user.id])

  const loadPendingSyncs = async () => {
    setLoadingP(true)
    const { data } = await supabase.from('pending_syncs')
      .select('*').order('created_at', { ascending: false }).limit(20)
    setPending(data || [])
    setLoadingP(false)
  }

  const saveExtraSenders = (list) => {
    setExtraSenders(list)
    localStorage.setItem(`speakiq_senders_${session.user.id}`, JSON.stringify(list))
  }

  const signOut = () => supabase.auth.signOut()

  // ── Scan email ──────────────────────────────────────────────────────────────
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

      const emails = data.emails || []
      setEmailResults(emails)

      // Save each found email as a pending sync
      for (const email of emails) {
        const rawUrl = email.icalUrl || email.embedUrl
        if (!rawUrl) continue
        await supabase.from('pending_syncs').upsert({
          month_label: email.calendarName || monthLabel,
          status: 'pending',
          email_subject: email.subject,
          email_from: email.from,
          email_date: email.date,
          calendar_name: email.calendarName || email.subject,
          ical_url: rawUrl,
          created_at: new Date().toISOString()
        }, { onConflict: 'month_label' })
      }

      await loadPendingSyncs()
      setScreen('email-results')
    } catch(e) {
      setError(e.message)
      setScreen('error')
    }
    setScanning(false)
  }

  // ── Preview a pending sync ──────────────────────────────────────────────────
  const previewSync_ = async (pendingSync) => {
    setScreen('syncing')
    setProgress('Fetching calendar events…')
    setPreviewSync(pendingSync)
    try {
      const icalUrl = extractIcalUrl(pendingSync.ical_url)
      if (!icalUrl) throw new Error('Invalid calendar URL in this record.')
      const res = await fetch('/api/scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: icalUrl, icpGenres: ALL_GENRES, calendarMonth: pendingSync.month_label })
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Scan failed')
      setPreview(data.opportunities || [])
      setProgress('')
      setScreen('preview')
    } catch(e) {
      setError(e.message)
      setScreen('error')
    }
  }

  // ── Import confirmed ────────────────────────────────────────────────────────
  const confirmImport = async () => {
    setImporting(true)
    setProgress('Saving opportunities…')
    try {
      const month = previewSync?.month_label || monthLabel
      const rows = previewOpps.map(o => ({
        title: o.title||null, date: o.date||null, location: o.location||null,
        contact_name: o.contactName||null, contact_email: o.contactEmail||null,
        contact_phone: o.contactPhone||null, genre: o.genre||null,
        audience: o.audience||null, fee: o.fee||null, format: o.format||null,
        organization: o.organization||null, details: o.details||null,
        icp_score: scoreOpp(o), calendar_month: month,
      }))
      await supabase.from('opportunities').delete().eq('calendar_month', month)
      if (rows.length > 0) await supabase.from('opportunities').insert(rows)

      // Mark pending sync as imported
      if (previewSync?.id) {
        await supabase.from('pending_syncs').update({
          status: 'imported',
          imported_at: new Date().toISOString(),
          imported_by: session.user.id,
          event_count: rows.length
        }).eq('id', previewSync.id)
      }

      await loadPendingSyncs()
      setScreen('done')
    } catch(e) {
      setError(e.message)
      setScreen('error')
    }
    setImporting(false)
  }

  // ── Skip a pending sync ─────────────────────────────────────────────────────
  const skipSync = async (id) => {
    await supabase.from('pending_syncs').update({ status: 'skipped' }).eq('id', id)
    await loadPendingSyncs()
  }

  // ── Sync from pasted URL ────────────────────────────────────────────────────
  const syncFromUrl = async () => {
    setScreen('syncing')
    setProgress('Fetching calendar…')
    setPreviewSync({ month_label: monthLabel, ical_url: url, calendar_name: monthLabel })
    try {
      const icalUrl = extractIcalUrl(url)
      if (!icalUrl) throw new Error('Could not parse that URL. Please check and try again.')
      const res = await fetch('/api/scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: icalUrl, icpGenres: ALL_GENRES, calendarMonth: monthLabel })
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Scan failed')

      // Save as pending
      await supabase.from('pending_syncs').upsert({
        month_label: monthLabel, status: 'pending',
        email_subject: null, email_from: 'Manual URL', email_date: new Date().toISOString(),
        calendar_name: monthLabel, ical_url: url, created_at: new Date().toISOString()
      }, { onConflict: 'month_label' })

      setPreview(data.opportunities || [])
      setScreen('preview')
    } catch(e) {
      setError(e.message)
      setScreen('error')
    }
  }

  const statusBadge = (s) => ({
    pending:   { color:C.orange, bg:'rgba(245,166,35,0.1)',  label:'Pending Review' },
    imported:  { color:C.green,  bg:C.greenFaint,            label:'Imported' },
    skipped:   { color:C.dimmer, bg:'rgba(75,85,99,0.2)',    label:'Skipped' },
    no_email:  { color:C.dimmer, bg:'rgba(75,85,99,0.2)',    label:'No Email Found' },
  }[s] || { color:C.dim, bg:'transparent', label:s })

  const scoreColor = (s) => s >= 75 ? '#00c896' : s >= 45 ? C.orange : C.red

  return (
    <div style={{ minHeight:'100vh', background:C.bg, display:'flex', flexDirection:'column' }}>

      {/* Top bar */}
      <div style={{ padding:'13px 24px', display:'flex', alignItems:'center', justifyContent:'space-between', background:C.surface, borderBottom:`1px solid ${C.border}` }}>
        <div style={{ display:'flex', alignItems:'center', gap:10 }}>
          <div style={{ width:28, height:28, background:`linear-gradient(135deg,#c9a84c,${C.gold})`, borderRadius:6, display:'flex', alignItems:'center', justifyContent:'center', fontWeight:'bold', color:C.bg, fontSize:13 }}>S</div>
          <span style={{ color:C.gold, fontWeight:'bold', fontSize:14 }}>SpeakIQ</span>
          <span style={{ color:C.dimmer, fontSize:12 }}>/ Calendar Syncer</span>
        </div>
        <div style={{ display:'flex', gap:8 }}>
          {screen !== 'home' && <button onClick={()=>setScreen('home')} style={{ background:'none', border:`1px solid ${C.border}`, color:C.dim, borderRadius:6, padding:'5px 12px', cursor:'pointer', fontSize:12, fontFamily:'inherit' }}>← Home</button>}
          <button onClick={()=>setScreen('settings')} style={{ background:'none', border:`1px solid ${C.border}`, color:C.dim, borderRadius:6, padding:'5px 12px', cursor:'pointer', fontSize:12, fontFamily:'inherit' }}>⚙ Settings</button>
          <button onClick={signOut} style={{ background:'none', border:`1px solid ${C.border}`, color:C.dim, borderRadius:6, padding:'5px 12px', cursor:'pointer', fontSize:12, fontFamily:'inherit' }}>Sign out</button>
        </div>
      </div>

      <div style={{ flex:1, padding:'24px 28px', maxWidth:700, width:'100%', margin:'0 auto', boxSizing:'border-box' }}>

        {/* ── HOME ── */}
        {screen === 'home' && (
          <div>
            <h1 style={{ color:C.text, fontWeight:'normal', fontSize:22, marginBottom:4 }}>Speaking Calendar Sync</h1>
            <p style={{ color:C.dim, fontSize:13, marginBottom:24, lineHeight:1.6 }}>
              New calendars are auto-scanned on the 1st of each month. You can also trigger a scan anytime below.
            </p>

            {/* Action buttons */}
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:10, marginBottom:28 }}>
              {[
                { icon:'✉️', label:'Scan Email', sub:'Find new calendar invites', onClick:()=>scanEmail(false), gold:true, loading:scanning },
                { icon:'🔍', label:'Deep Search', sub:'Search all past emails', onClick:()=>scanEmail(true), loading:scanning },
                { icon:'🔗', label:'Paste URL', sub:'Enter a calendar link manually', onClick:()=>setScreen('url') },
              ].map(b => (
                <button key={b.label} onClick={b.onClick} disabled={b.loading}
                  style={{ background: b.gold ? `linear-gradient(135deg,#c9a84c,${C.gold})` : C.surface, color: b.gold ? C.bg : C.text, border: b.gold ? 'none' : `1px solid ${C.border}`, borderRadius:10, padding:'14px 10px', cursor: b.loading ? 'not-allowed' : 'pointer', fontFamily:'inherit', textAlign:'center', opacity: b.loading ? 0.6 : 1, transition:'all 0.15s' }}>
                  <div style={{ fontSize:22, marginBottom:6 }}>{b.loading ? '⟳' : b.icon}</div>
                  <div style={{ fontSize:13, fontWeight:'bold', marginBottom:2 }}>{b.label}</div>
                  <div style={{ fontSize:11, opacity: b.gold ? 0.7 : undefined, color: !b.gold ? C.dim : undefined }}>{b.sub}</div>
                </button>
              ))}
            </div>

            {/* Sync history */}
            <div>
              <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:14 }}>
                <h2 style={{ color:C.text, fontWeight:'normal', fontSize:16, margin:0 }}>Sync History</h2>
                <button onClick={loadPendingSyncs} style={{ background:'none', border:'none', color:C.dim, cursor:'pointer', fontSize:12, fontFamily:'inherit' }}>↻ Refresh</button>
              </div>

              {loadingPending ? (
                <div style={{ color:C.dimmer, fontSize:13, padding:'20px 0', textAlign:'center' }}>Loading…</div>
              ) : pendingSyncs.length === 0 ? (
                <div style={{ background:C.surface, border:`1px solid ${C.border}`, borderRadius:10, padding:'24px', textAlign:'center' }}>
                  <div style={{ fontSize:28, opacity:0.2, marginBottom:8 }}>📭</div>
                  <div style={{ color:C.dim, fontSize:13 }}>No syncs yet. Click Scan Email to get started.</div>
                </div>
              ) : (
                <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
                  {pendingSyncs.map(sync => {
                    const badge = statusBadge(sync.status)
                    return (
                      <div key={sync.id} style={{ background:C.surface, border:`1px solid ${sync.status==='pending'?C.orange:C.border}`, borderRadius:10, padding:'14px 18px', display:'flex', alignItems:'center', gap:14, flexWrap:'wrap' }}>

                        {/* Status badge */}
                        <div style={{ background:badge.bg, color:badge.color, borderRadius:20, padding:'3px 12px', fontSize:11, fontWeight:'bold', whiteSpace:'nowrap' }}>
                          {badge.label}
                        </div>

                        {/* Info */}
                        <div style={{ flex:1, minWidth:160 }}>
                          <div style={{ fontSize:14, color:C.text, fontWeight:'bold' }}>{sync.calendar_name || sync.month_label}</div>
                          <div style={{ fontSize:11, color:C.dim, marginTop:3, display:'flex', gap:12, flexWrap:'wrap' }}>
                            {sync.email_from && <span>From: {sync.email_from}</span>}
                            {sync.email_date && <span>{timeAgo(sync.email_date)}</span>}
                            {sync.event_count != null && <span style={{ color:C.green }}>✓ {sync.event_count} events imported</span>}
                          </div>
                          {sync.email_subject && <div style={{ fontSize:11, color:C.dimmer, marginTop:2, fontStyle:'italic' }}>{sync.email_subject}</div>}
                        </div>

                        {/* Actions */}
                        {sync.status === 'pending' && sync.ical_url && (
                          <div style={{ display:'flex', gap:8 }}>
                            <button onClick={()=>previewSync_(sync)}
                              style={{ background:`linear-gradient(135deg,#c9a84c,${C.gold})`, color:C.bg, border:'none', borderRadius:6, padding:'7px 16px', cursor:'pointer', fontSize:12, fontWeight:'bold', fontFamily:'inherit', whiteSpace:'nowrap' }}>
                              Preview & Import
                            </button>
                            <button onClick={()=>skipSync(sync.id)}
                              style={{ background:'none', border:`1px solid ${C.border}`, color:C.dim, borderRadius:6, padding:'7px 12px', cursor:'pointer', fontSize:12, fontFamily:'inherit' }}>
                              Skip
                            </button>
                          </div>
                        )}
                        {sync.status === 'imported' && (
                          <button onClick={()=>previewSync_(sync)}
                            style={{ background:'none', border:`1px solid ${C.border}`, color:C.dim, borderRadius:6, padding:'6px 14px', cursor:'pointer', fontSize:11, fontFamily:'inherit' }}>
                            Re-import
                          </button>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── PASTE URL ── */}
        {screen === 'url' && (
          <div>
            <h2 style={{ color:C.text, fontWeight:'normal', fontSize:20, marginBottom:6 }}>Paste Calendar Link</h2>
            <p style={{ color:C.dim, fontSize:13, marginBottom:20, lineHeight:1.6 }}>Copy any Google Calendar link from Jennifer's email and paste it below.</p>
            <div style={{ display:'flex', flexDirection:'column', gap:12, marginBottom:20 }}>
              <div>
                <label style={{ fontSize:11, color:C.muted, display:'block', marginBottom:6, textTransform:'uppercase', letterSpacing:'0.07em' }}>Calendar link</label>
                <textarea value={url} onChange={e=>setUrl(e.target.value)} rows={3}
                  placeholder="Paste any Google Calendar URL here…"
                  style={{ ...inp, fontFamily:'monospace', resize:'vertical', lineHeight:1.5, border:`1px solid ${url?C.gold:C.border}` }} />
              </div>
              <div>
                <label style={{ fontSize:11, color:C.muted, display:'block', marginBottom:6, textTransform:'uppercase', letterSpacing:'0.07em' }}>Month label</label>
                <input value={monthLabel} onChange={e=>setMonth(e.target.value)} style={inp} />
              </div>
            </div>
            <button onClick={syncFromUrl} disabled={!url.trim()}
              style={{ width:'100%', background: url.trim()?`linear-gradient(135deg,#c9a84c,${C.gold})`:'#1e2130', color:url.trim()?C.bg:C.dimmer, border:'none', borderRadius:10, padding:'13px', fontSize:15, fontWeight:'bold', cursor:url.trim()?'pointer':'not-allowed', fontFamily:'inherit' }}>
              Fetch Calendar →
            </button>
          </div>
        )}

        {/* ── EMAIL RESULTS ── */}
        {screen === 'email-results' && (
          <div>
            <h2 style={{ color:C.text, fontWeight:'normal', fontSize:20, marginBottom:6 }}>
              {emailResults.length > 0 ? `Found ${emailResults.length} calendar invite${emailResults.length!==1?'s':''}` : 'No calendar emails found'}
            </h2>
            <p style={{ color:C.dim, fontSize:13, marginBottom:20, lineHeight:1.6 }}>
              {emailResults.length > 0 ? 'Select one to preview the events before importing.' : 'No matching calendar invite emails were found in your inbox.'}
            </p>
            {emailResults.length === 0 ? (
              <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
                <button onClick={()=>scanEmail(true)} style={{ background:`linear-gradient(135deg,#c9a84c,${C.gold})`, color:C.bg, border:'none', borderRadius:8, padding:'12px', cursor:'pointer', fontSize:14, fontWeight:'bold', fontFamily:'inherit' }}>Try Deep Search (All Emails)</button>
                <button onClick={()=>setScreen('url')} style={{ background:'none', border:`1px solid ${C.border}`, color:C.muted, borderRadius:8, padding:'12px', cursor:'pointer', fontSize:13, fontFamily:'inherit' }}>Paste URL Manually</button>
                <button onClick={()=>setScreen('settings')} style={{ background:'none', border:'none', color:C.dim, cursor:'pointer', fontSize:12, fontFamily:'inherit', textDecoration:'underline' }}>Add more senders in Settings</button>
              </div>
            ) : (
              <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
                {emailResults.map((email, i) => {
                  const hasUrl = !!(email.icalUrl || email.embedUrl)
                  return (
                    <div key={i} style={{ background:C.surface, border:`1px solid ${C.border}`, borderRadius:10, padding:'16px 18px', display:'flex', alignItems:'center', gap:14, flexWrap:'wrap' }}>
                      <div style={{ flex:1 }}>
                        <div style={{ fontSize:14, color:C.text, fontWeight:'bold', marginBottom:4 }}>{email.calendarName || email.subject || 'Calendar Invite'}</div>
                        <div style={{ display:'flex', gap:14, flexWrap:'wrap', fontSize:11, color:C.dim }}>
                          <span>📧 {email.from}</span>
                          <span>📅 {email.date}</span>
                          {hasUrl
                            ? <span style={{ color:C.green }}>✓ Calendar link found</span>
                            : <span style={{ color:C.red }}>✗ No link found</span>
                          }
                        </div>
                      </div>
                      {hasUrl && (
                        <button onClick={()=>previewSync_({ month_label: email.calendarName || monthLabel, ical_url: email.icalUrl || email.embedUrl, calendar_name: email.calendarName || email.subject, email_from: email.from, email_date: email.date })}
                          style={{ background:`linear-gradient(135deg,#c9a84c,${C.gold})`, color:C.bg, border:'none', borderRadius:6, padding:'8px 18px', cursor:'pointer', fontSize:12, fontWeight:'bold', fontFamily:'inherit', whiteSpace:'nowrap' }}>
                          Preview & Import
                        </button>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )}

        {/* ── PREVIEW ── */}
        {screen === 'preview' && (
          <div>
            <div style={{ display:'flex', alignItems:'flex-start', justifyContent:'space-between', marginBottom:20, flexWrap:'wrap', gap:12 }}>
              <div>
                <h2 style={{ color:C.text, fontWeight:'normal', fontSize:20, margin:'0 0 4px' }}>
                  Preview: {previewSync?.calendar_name || previewSync?.month_label}
                </h2>
                <p style={{ color:C.dim, fontSize:13, margin:0 }}>
                  {previewOpps.length} opportunities found — review below, then import or go back.
                </p>
              </div>
              <div style={{ display:'flex', gap:8 }}>
                <button onClick={()=>setScreen('home')} style={{ background:'none', border:`1px solid ${C.border}`, color:C.dim, borderRadius:8, padding:'9px 18px', cursor:'pointer', fontSize:13, fontFamily:'inherit' }}>
                  Cancel
                </button>
                <button onClick={confirmImport} disabled={importing || previewOpps.length === 0}
                  style={{ background: previewOpps.length > 0 ? `linear-gradient(135deg,#c9a84c,${C.gold})` : '#1e2130', color: previewOpps.length > 0 ? C.bg : C.dimmer, border:'none', borderRadius:8, padding:'9px 22px', cursor: previewOpps.length > 0 ? 'pointer' : 'not-allowed', fontSize:13, fontWeight:'bold', fontFamily:'inherit', display:'flex', alignItems:'center', gap:8 }}>
                  {importing ? '⟳ Importing…' : `✓ Import All ${previewOpps.length} →`}
                </button>
              </div>
            </div>

            {/* Stats row */}
            <div style={{ display:'flex', gap:16, marginBottom:18, flexWrap:'wrap' }}>
              {[
                { l:'Total Events', v:previewOpps.length },
                { l:'High ICP Match', v:previewOpps.filter(o=>scoreOpp(o)>=75).length, gold:true },
                { l:'Have Contact', v:previewOpps.filter(o=>o.contactEmail||o.contactPhone).length },
                { l:'Have Location', v:previewOpps.filter(o=>o.location).length },
              ].map(s=>(
                <div key={s.l} style={{ background:C.surface, border:`1px solid ${C.border}`, borderRadius:8, padding:'10px 16px' }}>
                  <div style={{ fontSize:20, fontWeight:'bold', color:s.gold?C.gold:C.text }}>{s.v}</div>
                  <div style={{ fontSize:10, color:C.dim, textTransform:'uppercase', letterSpacing:'0.07em' }}>{s.l}</div>
                </div>
              ))}
            </div>

            {/* Event list */}
            <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
              {previewOpps.map((opp, i) => {
                const score = scoreOpp(opp)
                return (
                  <div key={i} style={{ background:C.surface, border:`1px solid ${C.border}`, borderRadius:10, padding:'14px 16px', display:'flex', gap:14, alignItems:'flex-start' }}>
                    <div style={{ background: scoreColor(score), color: score>=75?'#003d2e':'#fff', borderRadius:20, padding:'3px 10px', fontSize:11, fontWeight:'bold', whiteSpace:'nowrap', flexShrink:0, marginTop:2 }}>
                      {score}%
                    </div>
                    <div style={{ flex:1, minWidth:0 }}>
                      <div style={{ fontSize:14, color:C.text, fontWeight:'bold', marginBottom:3 }}>{opp.title || 'Untitled'}</div>
                      <div style={{ display:'flex', gap:12, flexWrap:'wrap', fontSize:12, color:C.dim }}>
                        {opp.genre        && <span style={{ color:C.gold }}>◆ {opp.genre}</span>}
                        {opp.date         && <span>📅 {opp.date}</span>}
                        {opp.location     && <span>📍 {opp.location}</span>}
                        {opp.organization && <span>🏢 {opp.organization}</span>}
                        {opp.contactEmail && <span style={{ color:C.green }}>✓ Has contact</span>}
                        {opp.fee          && <span style={{ color:C.gold }}>💰 {opp.fee}</span>}
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>

            {/* Import button at bottom too */}
            {previewOpps.length > 6 && (
              <div style={{ marginTop:16, textAlign:'center' }}>
                <button onClick={confirmImport} disabled={importing}
                  style={{ background:`linear-gradient(135deg,#c9a84c,${C.gold})`, color:C.bg, border:'none', borderRadius:8, padding:'12px 32px', cursor:'pointer', fontSize:14, fontWeight:'bold', fontFamily:'inherit' }}>
                  {importing ? '⟳ Importing…' : `✓ Import All ${previewOpps.length} Opportunities →`}
                </button>
              </div>
            )}
          </div>
        )}

        {/* ── SYNCING ── */}
        {screen === 'syncing' && (
          <div style={{ textAlign:'center', padding:'60px 0' }}>
            <div style={{ fontSize:44, marginBottom:14, display:'inline-block', animation:'spin 1.2s linear infinite' }}>⟳</div>
            <h2 style={{ color:C.text, fontWeight:'normal', fontSize:20, marginBottom:8 }}>Fetching calendar…</h2>
            <p style={{ color:C.dim, fontSize:13 }}>{progress}</p>
          </div>
        )}

        {/* ── DONE ── */}
        {screen === 'done' && (
          <div style={{ textAlign:'center', padding:'40px 0' }}>
            <div style={{ fontSize:52, marginBottom:12 }}>🎉</div>
            <h2 style={{ color:C.green, fontWeight:'normal', fontSize:22, marginBottom:8 }}>Imported successfully!</h2>
            <p style={{ color:C.muted, fontSize:14, lineHeight:1.7, marginBottom:24 }}>
              <strong style={{ color:C.text }}>{previewOpps.length} speaking opportunities</strong> for <strong style={{ color:C.text }}>{previewSync?.month_label || monthLabel}</strong> are now live for your whole team.
            </p>
            <button onClick={()=>{ setScreen('home'); setUrl(''); setPreview([]); setPreviewSync(null) }}
              style={{ background:'none', border:`1px solid ${C.border}`, color:C.dim, borderRadius:8, padding:'10px 24px', cursor:'pointer', fontSize:13, fontFamily:'inherit' }}>
              ← Back to Home
            </button>
          </div>
        )}

        {/* ── ERROR ── */}
        {screen === 'error' && (
          <div style={{ textAlign:'center', padding:'40px 0' }}>
            <div style={{ fontSize:44, marginBottom:12 }}>⚠️</div>
            <h2 style={{ color:C.orange, fontWeight:'normal', fontSize:20, marginBottom:10 }}>Something went wrong</h2>
            <div style={{ color:C.dim, fontSize:13, lineHeight:1.7, background:'rgba(224,85,85,0.08)', border:`1px solid rgba(224,85,85,0.2)`, borderRadius:8, padding:'12px 14px', marginBottom:20, textAlign:'left' }}>{errorMsg}</div>
            <div style={{ display:'flex', gap:10, justifyContent:'center', flexWrap:'wrap' }}>
              <button onClick={()=>setScreen('home')} style={{ background:`linear-gradient(135deg,#c9a84c,${C.gold})`, color:C.bg, border:'none', borderRadius:8, padding:'10px 22px', cursor:'pointer', fontSize:13, fontWeight:'bold', fontFamily:'inherit' }}>← Try Again</button>
              <button onClick={()=>setScreen('url')} style={{ background:'none', border:`1px solid ${C.border}`, color:C.muted, borderRadius:8, padding:'10px 22px', cursor:'pointer', fontSize:13, fontFamily:'inherit' }}>Paste URL Instead</button>
            </div>
          </div>
        )}

        {/* ── SETTINGS ── */}
        {screen === 'settings' && (
          <div>
            <h2 style={{ color:C.text, fontWeight:'normal', fontSize:20, marginBottom:6 }}>Settings</h2>
            <p style={{ color:C.dim, fontSize:13, marginBottom:24, lineHeight:1.6 }}>Configure which email senders to watch for calendar invites.</p>

            <div style={{ background:C.surface, border:`1px solid ${C.border}`, borderRadius:10, padding:'18px 20px', marginBottom:16 }}>
              <div style={{ fontSize:13, color:C.text, fontWeight:'bold', marginBottom:12 }}>Sender Email Addresses</div>

              <div style={{ background:C.bg, borderRadius:8, padding:'10px 14px', marginBottom:8, display:'flex', alignItems:'center', justifyContent:'space-between' }}>
                <div>
                  <div style={{ fontSize:12, color:C.muted }}>jenniferspeakersclubrep@gmail.com</div>
                  <div style={{ fontSize:10, color:C.dimmer }}>Default — always searched</div>
                </div>
                <span style={{ fontSize:11, color:C.green, background:'rgba(0,200,150,0.1)', padding:'2px 8px', borderRadius:4 }}>Default</span>
              </div>

              {extraSenders.map((s, i) => (
                <div key={i} style={{ background:C.bg, borderRadius:8, padding:'10px 14px', marginBottom:8, display:'flex', alignItems:'center', justifyContent:'space-between' }}>
                  <div style={{ fontSize:12, color:C.muted }}>{s}</div>
                  <button onClick={()=>saveExtraSenders(extraSenders.filter((_,j)=>j!==i))} style={{ background:'none', border:'none', color:C.red, cursor:'pointer', fontSize:16, padding:'0 4px' }}>×</button>
                </div>
              ))}

              <div style={{ display:'flex', gap:8, marginTop:10 }}>
                <input value={newSender} onChange={e=>setNewSender(e.target.value)} onKeyDown={e=>e.key==='Enter'&&(()=>{ if(newSender.trim()&&!extraSenders.includes(newSender.trim())){saveExtraSenders([...extraSenders,newSender.trim()]);setNewSender('')}})()}
                  placeholder="Add email address…" style={{ ...inp, flex:1 }} />
                <button onClick={()=>{ if(newSender.trim()&&!extraSenders.includes(newSender.trim())){saveExtraSenders([...extraSenders,newSender.trim()]);setNewSender('')}}}
                  disabled={!newSender.trim()}
                  style={{ background:newSender.trim()?`linear-gradient(135deg,#c9a84c,${C.gold})`:'#1e2130', color:newSender.trim()?C.bg:C.dimmer, border:'none', borderRadius:8, padding:'9px 16px', cursor:newSender.trim()?'pointer':'not-allowed', fontSize:13, fontWeight:'bold', fontFamily:'inherit' }}>
                  Add
                </button>
              </div>
            </div>

            <div style={{ background:C.surface, border:`1px solid ${C.border}`, borderRadius:10, padding:'18px 20px' }}>
              <div style={{ fontSize:13, color:C.text, fontWeight:'bold', marginBottom:4 }}>Auto-Scan Schedule</div>
              <div style={{ fontSize:12, color:C.dim, lineHeight:1.7 }}>
                Automatic email scans run on the <strong style={{ color:C.muted }}>1st of every month at 9:00 AM</strong>. Found calendars appear in Sync History as "Pending Review" — you'll need to preview and import them.
              </div>
            </div>
          </div>
        )}

      </div>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  )
}
