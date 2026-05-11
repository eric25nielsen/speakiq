import React, { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase.js'
import Nav from '../components/Nav.jsx'
import SyncTab from '../components/SyncTab.jsx'

const C = {
  bg:'#0d0f14', surface:'#13151c', border:'#1e2130',
  gold:'#e8c96a', goldFaint:'rgba(232,201,106,0.12)',
  text:'#e8e4dc', muted:'#9ca3af', dim:'#6b7280', dimmer:'#4b5563',
  green:'#00c896', orange:'#f5a623', red:'#e05555',
}

const GENRES = ['Leadership','Healthcare','Business','Technology','Education','Finance','Entrepreneurship','Sales','Mental Health','Nonprofit','Government','Real Estate','HR & Talent','Marketing','Wellness','Legal']
const ALL_GENRES = GENRES
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
  if (o.genre)                           s += 70
  if (o.contactEmail || o.contact_email) s += 15
  if (o.location)                        s += 10
  if (o.fee)                             s += 5
  return s
}

const parseJSON = (t) => { try { const m=t.match(/\[[\s\S]*\]/); return m?JSON.parse(m[0]):[] } catch { return [] } }
const parseSingle = (t) => { try { const m=t.match(/\{[\s\S]*\}/); return m?JSON.parse(m[0]):null } catch { return null } }

const timeAgo = (d) => {
  if (!d) return ''
  const days = Math.floor((Date.now()-new Date(d).getTime())/86400000)
  if (days===0) return 'Today'
  if (days===1) return 'Yesterday'
  if (days<30)  return `${days}d ago`
  return new Date(d).toLocaleDateString('en-US',{month:'short',day:'numeric'})
}

export default function Admin({ session, profile }) {
  const [tab, setTab] = useState('sync')

  // ── Sync state ─────────────────────────────────────────────────────────────
  const [syncMode,    setSyncMode]  = useState(null)       // null | 'email' | 'url'
  const [icalUrl,     setIcalUrl]   = useState('')
  const [monthLabel,  setMonth]     = useState('')
  const [icpGenres,   setIcpGenres] = useState(['Leadership','Business','Healthcare'])
  const [loading,     setLoading]   = useState(false)
  const [scanning,    setScanning]  = useState(false)
  const [statusLog,   setStatusLog] = useState([])
  const [preview,     setPreview]   = useState([])
  const [saving,      setSaving]    = useState(false)
  const [saved,       setSaved]     = useState(false)
  const [syncHistory, setHistory]   = useState([])

  // ── Users state ────────────────────────────────────────────────────────────
  const [users,       setUsers]       = useState([])
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteRole,  setInviteRole]  = useState('viewer')
  const [inviting,    setInviting]    = useState(false)
  const [inviteMsg,   setInviteMsg]   = useState('')

  // ── Settings ──────────────────────────────────────────────────────────────
  const [senderEmail,    setSenderEmail]    = useState('jenniferspeakersclubrep@gmail.com')
  const [senderEmailInput, setSenderInput] = useState('')
  const [settingsSaved,  setSettingsSaved] = useState(false)

  useEffect(() => {
    supabase.from('app_settings').select('value').eq('key','sender_email').single()
      .then(({ data }) => { if (data?.value) { setSenderEmail(data.value); setSenderInput(data.value) } })
  }, [])

  const saveSenderEmail = async () => {
    await supabase.from('app_settings').upsert({ key:'sender_email', value:senderEmailInput.trim(), updated_at:new Date().toISOString() })
    setSenderEmail(senderEmailInput.trim())
    setSettingsSaved(true)
    setTimeout(() => setSettingsSaved(false), 3000)
  }

  // ── Interactions ───────────────────────────────────────────────────────────
  const [interactionData, setInteractionData] = useState([])

  const log = (msg) => setStatusLog(p => [`${new Date().toLocaleTimeString()} — ${msg}`, ...p.slice(0,19)])

  useEffect(() => {
    const now = new Date()
    setMonth(now.toLocaleString('default',{month:'long'}) + now.getFullYear())
    loadHistory()
  }, [])

  const loadHistory = async () => {
    const { data } = await supabase.from('pending_syncs')
      .select('*').order('created_at',{ascending:false}).limit(10)
    setHistory(data || [])
  }

  // ── Email scan ──────────────────────────────────────────────────────────────
  const scanEmail = async (searchAll = false) => {
    setScanning(true)
    setPreview([]); setSaved(false); setStatusLog([])
    log(searchAll ? 'Deep-searching all emails for calendar invites…' : 'Scanning email for Jennifer\'s latest calendar…')
    try {
      const res = await fetch('/api/scan-email', {
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ senderEmails:[], searchAll })
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      const emails = data.emails || []
      log(`✓ Found ${emails.length} calendar invite${emails.length!==1?'s':''}`)
      if (emails.length === 0) {
        log('⚠ No calendar emails found. Try Deep Search or paste the URL manually.')
        setScanning(false)
        return
      }
      // Auto-use the first result, or show options if multiple
      const best = emails[0]
      const rawUrl = best.icalUrl || best.embedUrl
      if (!rawUrl) { log('⚠ Email found but no calendar link in it. Paste the URL manually.'); setScanning(false); return }
      if (best.calendarName) setMonth(best.calendarName)
      log(`✓ Calendar: "${best.calendarName || best.subject}" from ${best.from}`)
      setIcalUrl(rawUrl)
      await fetchAndPreview(rawUrl, best.calendarName || monthLabel)
    } catch(e) {
      log(`✗ Email scan failed: ${e.message}`)
    }
    setScanning(false)
  }

  // ── Fetch + preview ─────────────────────────────────────────────────────────
  const fetchAndPreview = async (rawUrl, month) => {
    setLoading(true); setSaved(false)
    log('Fetching calendar events…')
    try {
      const url = extractIcalUrl(rawUrl) || rawUrl
      const res = await fetch('/api/scan', {
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ url, icpGenres, calendarMonth: month })
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Scan failed')
      const opps = (data.opportunities||[]).map(o=>({...o, icp_score:scoreOpp(o), calendar_month:month}))
      opps.sort((a,b)=>b.icp_score-a.icp_score)
      setPreview(opps)
      log(`✓ Found ${opps.length} opportunities — ${opps.filter(o=>o.icp_score>=75).length} high ICP match`)
      log('Review below, then click Import to publish to all users.')
    } catch(e) {
      log(`✗ ${e.message}`)
    }
    setLoading(false)
  }

  const runScan = async () => {
    if (!icalUrl.trim()) { log('⚠ Please paste a calendar URL.'); return }
    if (!monthLabel.trim()) { log('⚠ Please enter a month label.'); return }
    setStatusLog([]); setPreview([]); setSaved(false)
    await fetchAndPreview(icalUrl.trim(), monthLabel.trim())
  }

  // ── Save to DB ──────────────────────────────────────────────────────────────
  const saveToDb = async () => {
    setSaving(true)
    log('Saving to database…')
    const month = monthLabel.trim()
    const rows = preview.map(o=>({
      title:         o.title        ||null,
      date:          o.date         ||null,
      location:      o.location     ||null,
      contact_name:  o.contactName  ||o.contact_name  ||null,
      contact_email: o.contactEmail ||o.contact_email ||null,
      contact_phone: o.contactPhone ||o.contact_phone ||null,
      genre:         o.genre        ||null,
      audience:      o.audience     ||null,
      fee:           o.fee          ||null,
      format:        o.format       ||null,
      organization:  o.organization ||null,
      details:       o.details      ||null,
      icp_score:     o.icp_score    ||0,
      calendar_month: month,
    }))
    await supabase.from('opportunities').delete().eq('calendar_month', month)
    const { error } = await supabase.from('opportunities').insert(rows)
    if (error) { log(`✗ Save failed: ${error.message}`) }
    else {
      // Log to history
      await supabase.from('pending_syncs').upsert({
        month_label: month, status:'imported',
        email_from: 'Admin manual import', email_date: new Date().toISOString(),
        calendar_name: month, ical_url: icalUrl||null,
        imported_at: new Date().toISOString(), imported_by: session.user.id,
        event_count: rows.length, created_at: new Date().toISOString()
      },{ onConflict:'month_label' })
      log(`✓ ${rows.length} opportunities live for all users now.`)
      setSaved(true)
      loadHistory()
    }
    setSaving(false)
  }

  // ── Users ───────────────────────────────────────────────────────────────────
  useEffect(()=>{ if(tab==='users') fetchUsers() },[tab])
  const fetchUsers = async () => {
    const { data } = await supabase.from('profiles').select('*').order('created_at',{ascending:false})
    setUsers(data||[])
  }
  const inviteUser = async () => {
    setInviting(true); setInviteMsg('')
    const { error: e2 } = await supabase.auth.signUp({
      email: inviteEmail,
      password: Math.random().toString(36).slice(2)+Math.random().toString(36).slice(2).toUpperCase()+'!1',
      options: { data: { role: inviteRole } }
    })
    if (e2) setInviteMsg(`Error: ${e2.message}`)
    else {
      await supabase.from('profiles').upsert({ email: inviteEmail, role: inviteRole })
      setInviteMsg(`✓ User created: ${inviteEmail}`)
      setInviteEmail(''); fetchUsers()
    }
    setInviting(false)
  }
  const updateRole = async (userId, newRole) => {
    await supabase.from('profiles').update({ role: newRole }).eq('id', userId)
    fetchUsers()
  }
  const removeUser = async (userId, email) => {
    if (!window.confirm(`Remove ${email}? They will no longer be able to log in.`)) return
    const res = await fetch('/api/remove-user', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId })
    })
    const data = await res.json()
    if (!res.ok) { alert(`Failed to remove user: ${data.error}`); return }
    fetchUsers()
  }


  // ── Interactions ─────────────────────────────────────────────────────────
  useEffect(()=>{ if(tab==='interactions') fetchInteractions() },[tab])
  const fetchInteractions = async () => {
    const { data } = await supabase.from('user_interactions')
      .select('*, opportunities(title,genre,icp_score), profiles(email)')
      .order('created_at',{ascending:false})
    setInteractionData(data||[])
  }

  // ── Style helpers ─────────────────────────────────────────────────────────
  const inp = { width:'100%', background:'#0d0f14', border:`1px solid ${C.border}`, borderRadius:6, padding:'10px 14px', color:C.text, fontSize:13, fontFamily:'inherit', outline:'none', boxSizing:'border-box' }
  const btn = (disabled, variant='primary') => ({
    background: disabled ? '#1e2130' : variant==='primary' ? `linear-gradient(135deg,#c9a84c,${C.gold})` : C.surface,
    color: disabled ? C.dimmer : variant==='primary' ? C.bg : C.muted,
    border: variant==='secondary' ? `1px solid ${C.border}` : 'none',
    borderRadius:8, padding:'10px 20px', fontSize:13, fontWeight:'bold',
    cursor: disabled?'not-allowed':'pointer', letterSpacing:'0.04em', fontFamily:'inherit'
  })
  const pill = (active) => ({
    background: active ? C.goldFaint : '#1a1d28',
    color: active ? C.gold : C.muted,
    border:`1px solid ${active ? C.gold : '#2a2d3a'}`,
    borderRadius:20, padding:'7px 16px', cursor:'pointer', fontSize:13, fontFamily:'inherit'
  })

  const statusBadge = (s) => ({
    imported: { color:C.green,   bg:'rgba(0,200,150,0.1)',  label:'Imported' },
    pending:  { color:C.orange,  bg:'rgba(245,166,35,0.1)', label:'Pending' },
    no_email: { color:C.dimmer,  bg:'rgba(75,85,99,0.2)',   label:'No Email' },
    skipped:  { color:C.dimmer,  bg:'rgba(75,85,99,0.2)',   label:'Skipped' },
  }[s] || { color:C.dim, bg:'transparent', label:s })

  return (
    <div style={{ minHeight:'100vh', background:C.bg, display:'flex', flexDirection:'column' }}>
      <Nav profile={profile} />

      <nav style={{ background:C.surface, borderBottom:`1px solid ${C.border}`, padding:'0 28px', display:'flex', gap:2 }}>
        {[['sync','Sync Calendar'],['users','Manage Users'],['interactions','Team Activity'],['icp','ICP Setup'],['settings','Settings']].map(([id,label])=>(
          <button key={id} onClick={()=>setTab(id)} style={{ background:'none', border:'none', borderBottom:tab===id?`2px solid ${C.gold}`:'2px solid transparent', color:tab===id?C.gold:C.dim, padding:'11px 16px', cursor:'pointer', fontSize:13, letterSpacing:'0.05em', fontFamily:'inherit' }}>
            {label}
          </button>
        ))}
      </nav>

      <main style={{ flex:1, padding:'24px 28px', maxWidth:1000, width:'100%', margin:'0 auto', boxSizing:'border-box' }}>

        {/* ── SYNC TAB ── */}
        {tab === 'sync' && (
          <SyncTab session={session} icpGenres={icpGenres} />
        )}

        {/* ── USERS ── */}
        {tab === 'users' && (
          <div>
            <h2 style={{ color:C.gold, fontWeight:'normal', fontSize:21, marginBottom:6 }}>Manage Users</h2>
            <p style={{ color:C.dim, fontSize:14, lineHeight:1.7, marginBottom:24 }}>
              Create accounts for team members. They'll need to use "Forgot Password" on the login screen to set their password.
            </p>
            <div style={{ background:C.surface, border:`1px solid ${C.border}`, borderRadius:10, padding:'20px 22px', marginBottom:24 }}>
              <div style={{ fontSize:14, color:C.text, fontWeight:'bold', marginBottom:14 }}>Add New User</div>
              <div style={{ display:'flex', gap:10, flexWrap:'wrap', alignItems:'flex-end' }}>
                <div style={{ flex:1, minWidth:220 }}>
                  <label style={{ fontSize:11, color:C.muted, display:'block', marginBottom:6 }}>EMAIL</label>
                  <input style={inp} type="email" value={inviteEmail} onChange={e=>setInviteEmail(e.target.value)} placeholder="colleague@example.com" />
                </div>
                <div>
                  <label style={{ fontSize:11, color:C.muted, display:'block', marginBottom:6 }}>ROLE</label>
                  <select value={inviteRole} onChange={e=>setInviteRole(e.target.value)} style={{ ...inp, width:'auto' }}>
                    <option value="viewer">Viewer — sees dashboard only</option>
                    <option value="syncer">Syncer — loads calendar from email</option>
                    <option value="admin">Admin — full access</option>
                  </select>
                </div>
                <button style={btn(inviting||!inviteEmail)} disabled={inviting||!inviteEmail} onClick={inviteUser}>
                  {inviting?'Creating…':'Create User'}
                </button>
              </div>
              {inviteMsg && <div style={{ marginTop:10, fontSize:13, color:inviteMsg.startsWith('✓')?C.green:C.red }}>{inviteMsg}</div>}
            </div>
            <div>
              {users.map(u=>(
                <div key={u.id} style={{ background:C.surface, border:`1px solid ${C.border}`, borderRadius:8, padding:'13px 18px', marginBottom:8, display:'flex', alignItems:'center', justifyContent:'space-between', gap:12, flexWrap:'wrap' }}>
                  <div>
                    <div style={{ fontSize:14, color:C.text }}>{u.email}</div>
                    <div style={{ fontSize:11, color:C.dim, marginTop:2 }}>Joined {u.created_at?.slice(0,10)}</div>
                  </div>
                  {u.id !== session.user.id ? (
                    <div style={{ display:'flex', gap:8, alignItems:'center' }}>
                      <select value={u.role||'viewer'} onChange={e=>updateRole(u.id,e.target.value)}
                        style={{ background:'#0d0f14', color:u.role==='admin'?C.gold:u.role==='syncer'?C.green:C.muted, border:`1px solid ${C.border}`, borderRadius:6, padding:'6px 12px', fontSize:12, fontFamily:'inherit', cursor:'pointer' }}>
                        <option value="viewer">Viewer</option>
                        <option value="syncer">Syncer</option>
                        <option value="admin">Admin</option>
                      </select>
                      <button onClick={()=>removeUser(u.id, u.email)}
                        style={{ background:'none', border:`1px solid rgba(224,85,85,0.3)`, color:'#e05555', borderRadius:6, padding:'6px 12px', cursor:'pointer', fontSize:12, fontFamily:'inherit' }}
                        title="Remove user">
                        Remove
                      </button>
                    </div>
                  ) : (
                    <span style={{ fontSize:12, color:C.gold, background:C.goldFaint, border:`1px solid rgba(232,201,106,0.2)`, borderRadius:6, padding:'5px 12px' }}>You · admin</span>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── INTERACTIONS ── */}
        {tab === 'interactions' && (
          <div>
            <h2 style={{ color:C.gold, fontWeight:'normal', fontSize:21, marginBottom:6 }}>Team Activity</h2>
            <p style={{ color:C.dim, fontSize:14, lineHeight:1.7, marginBottom:24 }}>See which opportunities your team has bookmarked.</p>
            {interactionData.length === 0
              ? <p style={{ color:C.dimmer, fontSize:14 }}>No interactions yet.</p>
              : interactionData.filter(i=>i.status!=='pending').map(i=>(
                <div key={i.id} style={{ background:C.surface, border:`1px solid ${C.border}`, borderRadius:8, padding:'12px 16px', marginBottom:8, display:'flex', gap:12, alignItems:'center', flexWrap:'wrap' }}>
                  <span style={{ fontSize:13, color:i.status==='interested'?C.green:C.red, fontWeight:'bold', minWidth:80 }}>
                    {i.status==='interested'?'✓ Interested':'✕ Pass'}
                  </span>
                  <div style={{ flex:1 }}>
                    <div style={{ fontSize:13, color:C.text }}>{i.opportunities?.title||'Unknown'}</div>
                    <div style={{ fontSize:11, color:C.dim }}>{i.opportunities?.genre} · ICP {i.opportunities?.icp_score}%</div>
                  </div>
                  <span style={{ fontSize:12, color:C.dimmer }}>{i.profiles?.email}</span>
                </div>
              ))
            }
          </div>
        )}

        {/* ── SETTINGS ── */}
        {tab === 'settings' && (
          <div>
            <h2 style={{ color:C.gold, fontWeight:'normal', fontSize:21, marginBottom:6 }}>Settings</h2>
            <p style={{ color:C.dim, fontSize:14, lineHeight:1.7, marginBottom:24 }}>
              Configure which email address SpeakIQ looks for when scanning for calendar invites.
            </p>

            <div style={{ background:C.surface, border:`1px solid ${C.border}`, borderRadius:10, padding:'22px 24px', marginBottom:16 }}>
              <div style={{ fontSize:14, color:C.text, fontWeight:'bold', marginBottom:4 }}>Sender Email Address</div>
              <p style={{ fontSize:13, color:C.dim, lineHeight:1.6, marginBottom:16 }}>
                The email address that sends Jennifer's monthly speaking calendar invites. The monthly auto-scan looks for emails from this address.
              </p>
              <div style={{ display:'flex', gap:10, alignItems:'flex-end' }}>
                <div style={{ flex:1 }}>
                  <input
                    type="email"
                    value={senderEmailInput}
                    onChange={e => setSenderInput(e.target.value)}
                    placeholder="e.g. jenniferspeakersclubrep@gmail.com"
                    style={inp}
                  />
                </div>
                <button
                  onClick={saveSenderEmail}
                  disabled={!senderEmailInput.trim() || senderEmailInput.trim() === senderEmail}
                  style={btn(!senderEmailInput.trim() || senderEmailInput.trim() === senderEmail)}>
                  {settingsSaved ? '✓ Saved' : 'Save'}
                </button>
              </div>
              {senderEmail && (
                <div style={{ marginTop:10, fontSize:12, color:C.dim }}>
                  Currently scanning: <span style={{ color:C.green }}>{senderEmail}</span>
                </div>
              )}
            </div>

            <div style={{ background:C.surface, border:`1px solid ${C.border}`, borderRadius:10, padding:'18px 24px' }}>
              <div style={{ fontSize:13, color:C.text, fontWeight:'bold', marginBottom:8 }}>Auto-Sync Schedule</div>
              <div style={{ fontSize:13, color:C.dim, lineHeight:1.7 }}>
                SpeakIQ automatically scans for new calendars on the <strong style={{ color:C.muted }}>1st of every month at 9:00 AM</strong>. If a new calendar is found it imports automatically. If not, it logs the failure in Sync History.
              </div>
            </div>
          </div>
        )}

        {/* ── ICP SETUP ── */}
        {tab === 'icp' && (
          <div>
            <h2 style={{ color:C.gold, fontWeight:'normal', fontSize:21, marginBottom:6 }}>ICP Genre Priorities</h2>
            <p style={{ color:C.dim, fontSize:14, lineHeight:1.7, marginBottom:24 }}>Genre match = <strong style={{ color:C.text }}>70 of 100 points</strong>. Select every industry that fits your ideal audience.</p>
            <div style={{ display:'flex', flexWrap:'wrap', gap:10, marginBottom:24 }}>
              {GENRES.map(g=>{
                const active=icpGenres.includes(g)
                return <button key={g} style={pill(active)} onClick={()=>setIcpGenres(p=>active?p.filter(x=>x!==g):[...p,g])}>{active?'✓ ':''}{g}</button>
              })}
            </div>
            <div style={{ background:C.surface, border:`1px solid ${C.border}`, borderRadius:10, padding:20 }}>
              {[['70pts','Genre/Industry Match','Selected genres above'],['15pts','Contact Info Present','Email or phone in event'],['10pts','Location Specified','City or venue included'],['5pts','Fee Mentioned','Honorarium noted']].map(([pts,l,d])=>(
                <div key={l} style={{ display:'flex', gap:14, marginBottom:10 }}>
                  <span style={{ color:C.gold, fontWeight:'bold', minWidth:50, fontSize:13, fontFamily:'monospace' }}>{pts}</span>
                  <div><div style={{ color:C.text, fontSize:13 }}>{l}</div><div style={{ color:C.dim, fontSize:12 }}>{d}</div></div>
                </div>
              ))}
            </div>
          </div>
        )}

      </main>
    </div>
  )
}
