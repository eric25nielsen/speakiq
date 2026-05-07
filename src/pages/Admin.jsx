import React, { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase.js'
import Nav from '../components/Nav.jsx'

const C = {
  bg:'#0d0f14', surface:'#13151c', border:'#1e2130',
  gold:'#e8c96a', goldFaint:'rgba(232,201,106,0.12)',
  text:'#e8e4dc', muted:'#9ca3af', dim:'#6b7280', dimmer:'#4b5563',
  green:'#00c896', orange:'#f5a623', red:'#e05555',
}

const GENRES = ['Leadership','Healthcare','Business','Technology','Education','Finance','Entrepreneurship','Sales','Mental Health','Nonprofit','Government','Real Estate','HR & Talent','Marketing','Wellness','Legal']

const parseJSON = (t) => { try { const m=t.match(/\[[\s\S]*\]/); return m?JSON.parse(m[0]):[] } catch { return [] } }

export default function Admin({ session, profile }) {
  const [tab, setTab] = useState('scan')

  // Scan state
  const [icalUrl,    setIcalUrl]    = useState('')
  const [monthName,  setMonthName]  = useState('')
  const [icpGenres,  setIcpGenres]  = useState(['Leadership','Business','Healthcare'])
  const [loading,    setLoading]    = useState(false)
  const [statusLog,  setStatusLog]  = useState([])
  const [preview,    setPreview]    = useState([])
  const [saving,     setSaving]     = useState(false)
  const [saved,      setSaved]      = useState(false)

  // Users state
  const [users,      setUsers]      = useState([])
  const [inviteEmail,setInviteEmail]= useState('')
  const [inviteRole, setInviteRole] = useState('viewer')
  const [inviting,   setInviting]   = useState(false)
  const [inviteMsg,  setInviteMsg]  = useState('')

  // Interactions overview
  const [interactionData, setInteractionData] = useState([])

  const log = (msg) => setStatusLog(p=>[`${new Date().toLocaleTimeString()} — ${msg}`,...p.slice(0,19)])

  const calcScore = (opp) => {
    let s = 0
    const g = (opp.genre||'').toLowerCase()
    if (icpGenres.some(ig=>g.includes(ig.toLowerCase())||ig.toLowerCase().includes(g))) s+=70
    if (opp.contactEmail||opp.contactPhone||opp.contact_email||opp.contact_phone) s+=15
    if (opp.location) s+=10
    if (opp.fee) s+=5
    return s
  }

  // ── Scan ────────────────────────────────────────────────────────────────────
  const runScan = async () => {
    if (!icalUrl.trim()) { log('⚠ Please paste a calendar URL.'); return }
    if (!monthName.trim()) { log('⚠ Please enter a month name (e.g. May2026).'); return }

    setLoading(true); setPreview([]); setSaved(false); setStatusLog([])
    log('Fetching calendar via server…')

    try {
      const res = await fetch('/api/scan', {
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ url: icalUrl.trim(), icpGenres, calendarMonth: monthName.trim() })
      })
      const data = await res.json()

      if (!res.ok) { log(`✗ Server error: ${data.error}`); setLoading(false); return }

      const opps = (data.opportunities||[]).map(o=>({ ...o, icp_score: calcScore(o), calendar_month: monthName.trim() }))
      log(`✓ Extracted ${opps.length} opportunities`)
      opps.sort((a,b)=>b.icp_score-a.icp_score)
      setPreview(opps)
      log(`✓ Ranked — ${opps.filter(o=>o.icp_score>=75).length} high ICP match (75%+)`)
      log('Review below, then click Save to publish to all users.')
    } catch(e) {
      log(`✗ Scan failed: ${e.message}`)
    }
    setLoading(false)
  }

  // ── Save to Supabase ─────────────────────────────────────────────────────────
  const saveToDb = async () => {
    setSaving(true)
    log('Saving to database…')

    const rows = preview.map(o=>({
      title:         o.title        || null,
      date:          o.date         || null,
      location:      o.location     || null,
      contact_name:  o.contactName  || o.contact_name  || null,
      contact_email: o.contactEmail || o.contact_email || null,
      contact_phone: o.contactPhone || o.contact_phone || null,
      genre:         o.genre        || null,
      audience:      o.audience     || null,
      fee:           o.fee          || null,
      format:        o.format       || null,
      organization:  o.organization || null,
      details:       o.details      || null,
      icp_score:     o.icp_score    || 0,
      calendar_month: o.calendar_month,
    }))

    // Delete old entries for this month first
    await supabase.from('opportunities').delete().eq('calendar_month', monthName.trim())

    const { error } = await supabase.from('opportunities').insert(rows)
    if (error) { log(`✗ Save failed: ${error.message}`) }
    else {
      log(`✓ Saved ${rows.length} opportunities — visible to all users now.`)
      setSaved(true)
    }
    setSaving(false)
  }

  // ── Users ────────────────────────────────────────────────────────────────────
  useEffect(()=>{ if(tab==='users') fetchUsers() },[tab])

  const fetchUsers = async () => {
    const { data } = await supabase.from('profiles').select('*').order('created_at',{ascending:false})
    setUsers(data||[])
  }

  const inviteUser = async () => {
    setInviting(true); setInviteMsg('')
    const { error } = await supabase.auth.admin.inviteUserByEmail(inviteEmail, {
      data: { role: inviteRole }
    })
    if (error) {
      // Fallback: use signUp with email (they'll get a confirmation email)
      const { error: e2 } = await supabase.auth.signUp({
        email: inviteEmail,
        password: Math.random().toString(36).slice(2)+Math.random().toString(36).slice(2).toUpperCase()+'!1',
        options: { data: { role: inviteRole } }
      })
      if (e2) setInviteMsg(`Error: ${e2.message}`)
      else {
        await supabase.from('profiles').upsert({ email: inviteEmail, role: inviteRole })
        setInviteMsg(`✓ Invite sent to ${inviteEmail}`)
        setInviteEmail('')
        fetchUsers()
      }
    } else {
      setInviteMsg(`✓ Invite sent to ${inviteEmail}`)
      setInviteEmail('')
      fetchUsers()
    }
    setInviting(false)
  }

  const updateRole = async (userId, newRole) => {
    await supabase.from('profiles').update({ role: newRole }).eq('id', userId)
    fetchUsers()
  }

  // ── Interactions overview ────────────────────────────────────────────────────
  useEffect(()=>{ if(tab==='interactions') fetchInteractions() },[tab])

  const fetchInteractions = async () => {
    const { data } = await supabase.from('user_interactions')
      .select('*, opportunities(title,genre,icp_score), profiles(email)')
      .order('created_at',{ascending:false})
    setInteractionData(data||[])
  }

  // ── Styles ───────────────────────────────────────────────────────────────────
  const inp = { width:'100%', background:'#0d0f14', border:`1px solid ${C.border}`, borderRadius:6, padding:'10px 14px', color:C.text, fontSize:13, fontFamily:'inherit', outline:'none', boxSizing:'border-box' }
  const btn = (disabled, variant='primary') => ({
    background: disabled ? '#1e2130' : variant==='primary' ? `linear-gradient(135deg,#c9a84c,${C.gold})` : C.surface,
    color: disabled ? C.dimmer : variant==='primary' ? C.bg : C.muted,
    border: variant==='secondary' ? `1px solid ${C.border}` : 'none',
    borderRadius:8, padding:'10px 22px', fontSize:13, fontWeight:'bold',
    cursor: disabled ? 'not-allowed' : 'pointer', letterSpacing:'0.04em', fontFamily:'inherit'
  })
  const pill = (active) => ({
    background: active ? C.goldFaint : '#1a1d28',
    color: active ? C.gold : C.muted,
    border: `1px solid ${active ? C.gold : '#2a2d3a'}`,
    borderRadius:20, padding:'7px 16px', cursor:'pointer', fontSize:13, fontFamily:'inherit'
  })

  return (
    <div style={{ minHeight:'100vh', background:C.bg, display:'flex', flexDirection:'column' }}>
      <Nav profile={profile} />

      {/* Admin tabs */}
      <nav style={{ background:C.surface, borderBottom:`1px solid ${C.border}`, padding:'0 28px', display:'flex', gap:2 }}>
        {[['scan','Load Calendar'],['users','Manage Users'],['interactions','Team Activity'],['icp','ICP Setup']].map(([id,label])=>(
          <button key={id} onClick={()=>setTab(id)} style={{ background:'none', border:'none', borderBottom:tab===id?`2px solid ${C.gold}`:'2px solid transparent', color:tab===id?C.gold:C.dim, padding:'11px 16px', cursor:'pointer', fontSize:13, letterSpacing:'0.05em', fontFamily:'inherit' }}>
            {label}
          </button>
        ))}
      </nav>

      <main style={{ flex:1, padding:'24px 28px', maxWidth:1000, width:'100%', margin:'0 auto', boxSizing:'border-box' }}>

        {/* ── SCAN ── */}
        {tab==='scan' && (
          <div>
            <h2 style={{ color:C.gold, fontWeight:'normal', fontSize:21, marginBottom:6 }}>Load Speaking Calendar</h2>
            <p style={{ color:C.dim, fontSize:14, lineHeight:1.7, marginBottom:24 }}>
              Paste Jennifer's public calendar URL. The app fetches and parses it server-side, then saves it to the database so all users see it instantly.
            </p>

            <div style={{ display:'flex', flexDirection:'column', gap:14, marginBottom:20 }}>
              <div>
                <label style={{ fontSize:12, color:C.muted, display:'block', marginBottom:6, textTransform:'uppercase', letterSpacing:'0.07em' }}>Calendar URL (webcal:// or https://)</label>
                <input style={inp} value={icalUrl} onChange={e=>setIcalUrl(e.target.value)}
                  placeholder="webcal://calendar.google.com/calendar/ical/..." />
              </div>
              <div>
                <label style={{ fontSize:12, color:C.muted, display:'block', marginBottom:6, textTransform:'uppercase', letterSpacing:'0.07em' }}>Month Label (for filtering)</label>
                <input style={{ ...inp, maxWidth:220 }} value={monthName} onChange={e=>setMonthName(e.target.value)} placeholder="e.g. May2026" />
              </div>
            </div>

            <div style={{ display:'flex', gap:10, marginBottom:24 }}>
              <button style={btn(loading||!icalUrl||!monthName)} disabled={loading||!icalUrl||!monthName} onClick={runScan}>
                <span style={{ display:'inline-block', animation:loading?'spin 1.2s linear infinite':'none', marginRight:8 }}>⟳</span>
                {loading?'Scanning…':'Scan Calendar'}
              </button>
              {preview.length>0&&!saved&&(
                <button style={btn(saving,'secondary')} disabled={saving} onClick={saveToDb}>
                  {saving?'Saving…':`Save ${preview.length} Opportunities →`}
                </button>
              )}
            </div>

            {/* Log */}
            {statusLog.length>0&&(
              <div style={{ marginBottom:20 }}>
                {statusLog.map((msg,i)=>(
                  <div key={i} style={{ background:C.surface, border:`1px solid ${C.border}`, borderRadius:5, padding:'8px 14px', marginBottom:6, fontSize:12, fontFamily:'monospace', color:msg.includes('✓')?C.green:msg.includes('✗')||msg.includes('⚠')?C.red:C.muted }}>
                    {msg}
                  </div>
                ))}
              </div>
            )}

            {/* Preview */}
            {preview.length>0&&(
              <div>
                <div style={{ fontSize:13, color:C.dim, marginBottom:12 }}>
                  Preview — {preview.length} engagements found {saved&&<span style={{ color:C.green }}>· ✓ Saved to database</span>}
                </div>
                <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill,minmax(280px,1fr))', gap:12 }}>
                  {preview.slice(0,6).map((opp,i)=>(
                    <div key={i} style={{ background:C.surface, border:`1px solid ${C.border}`, borderRadius:10, padding:16 }}>
                      <div style={{ fontSize:12, fontWeight:'bold', color: opp.icp_score>=75?C.green:opp.icp_score>=45?C.orange:C.red, marginBottom:6 }}>{opp.icp_score}% ICP</div>
                      <div style={{ fontSize:14, color:C.text, marginBottom:4 }}>{opp.title||'Untitled'}</div>
                      <div style={{ fontSize:12, color:C.dim }}>{opp.genre} · {opp.date}</div>
                    </div>
                  ))}
                  {preview.length>6&&<div style={{ padding:16, color:C.dim, fontSize:13, display:'flex', alignItems:'center' }}>+{preview.length-6} more…</div>}
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── USERS ── */}
        {tab==='users' && (
          <div>
            <h2 style={{ color:C.gold, fontWeight:'normal', fontSize:21, marginBottom:6 }}>Manage Users</h2>
            <p style={{ color:C.dim, fontSize:14, lineHeight:1.7, marginBottom:24 }}>Invite team members by email. They'll receive a login link. Set their role to viewer (read-only) or admin (can also load calendars and manage users).</p>

            {/* Invite */}
            <div style={{ background:C.surface, border:`1px solid ${C.border}`, borderRadius:10, padding:'20px 22px', marginBottom:24 }}>
              <div style={{ fontSize:14, color:C.text, fontWeight:'bold', marginBottom:14 }}>Invite New User</div>
              <div style={{ display:'flex', gap:10, flexWrap:'wrap', alignItems:'flex-end' }}>
                <div style={{ flex:1, minWidth:220 }}>
                  <label style={{ fontSize:11, color:C.muted, display:'block', marginBottom:6 }}>EMAIL</label>
                  <input style={inp} type="email" value={inviteEmail} onChange={e=>setInviteEmail(e.target.value)} placeholder="colleague@example.com" />
                </div>
                <div>
                  <label style={{ fontSize:11, color:C.muted, display:'block', marginBottom:6 }}>ROLE</label>
                  <select value={inviteRole} onChange={e=>setInviteRole(e.target.value)} style={{ ...inp, width:'auto', paddingRight:24 }}>
                    <option value="viewer">Viewer — sees dashboard only</option>
                    <option value="syncer">Syncer — loads calendar from email</option>
                    <option value="admin">Admin — full access</option>
                  </select>
                </div>
                <button style={btn(inviting||!inviteEmail)} disabled={inviting||!inviteEmail} onClick={inviteUser}>
                  {inviting?'Sending…':'Send Invite'}
                </button>
              </div>
              {inviteMsg&&<div style={{ marginTop:10, fontSize:13, color:inviteMsg.startsWith('✓')?C.green:C.red }}>{inviteMsg}</div>}
            </div>

            {/* User list */}
            <div>
              <div style={{ fontSize:12, color:C.dim, marginBottom:12, textTransform:'uppercase', letterSpacing:'0.07em' }}>{users.length} Users</div>
              {users.map(u=>(
                <div key={u.id} style={{ background:C.surface, border:`1px solid ${C.border}`, borderRadius:8, padding:'14px 18px', marginBottom:8, display:'flex', alignItems:'center', justifyContent:'space-between', gap:12, flexWrap:'wrap' }}>
                  <div>
                    <div style={{ fontSize:14, color:C.text }}>{u.email}</div>
                    <div style={{ fontSize:12, color:C.dim, marginTop:2 }}>Joined {u.created_at?.slice(0,10)}</div>
                  </div>
                  {u.id !== session.user.id ? (
                    <select value={u.role||'viewer'} onChange={e=>updateRole(u.id,e.target.value)}
                      style={{ background:'#0d0f14', color: u.role==='admin'?C.gold:C.muted, border:`1px solid ${C.border}`, borderRadius:6, padding:'6px 12px', fontSize:12, fontFamily:'inherit', cursor:'pointer' }}>
                      <option value="viewer">Viewer — sees dashboard only</option>
                      <option value="syncer">Syncer — loads calendar from email</option>
                      <option value="admin">Admin — full access</option>
                    </select>
                  ) : (
                    <span style={{ fontSize:12, color:C.gold, background:C.goldFaint, border:`1px solid rgba(232,201,106,0.2)`, borderRadius:6, padding:'6px 12px' }}>You · admin</span>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── INTERACTIONS ── */}
        {tab==='interactions' && (
          <div>
            <h2 style={{ color:C.gold, fontWeight:'normal', fontSize:21, marginBottom:6 }}>Team Activity</h2>
            <p style={{ color:C.dim, fontSize:14, lineHeight:1.7, marginBottom:24 }}>See which opportunities your team has marked as Interested or Pass.</p>
            {interactionData.length===0
              ? <p style={{ color:C.dimmer, fontSize:14 }}>No interactions yet.</p>
              : interactionData.filter(i=>i.status!=='pending').map(i=>(
                <div key={i.id} style={{ background:C.surface, border:`1px solid ${C.border}`, borderRadius:8, padding:'12px 16px', marginBottom:8, display:'flex', gap:12, alignItems:'center', flexWrap:'wrap' }}>
                  <span style={{ fontSize:13, color: i.status==='interested'?C.green:C.red, fontWeight:'bold', minWidth:80 }}>
                    {i.status==='interested'?'✓ Interested':'✕ Pass'}
                  </span>
                  <div style={{ flex:1 }}>
                    <div style={{ fontSize:13, color:C.text }}>{i.opportunities?.title||'Unknown'}</div>
                    <div style={{ fontSize:12, color:C.dim }}>{i.opportunities?.genre} · ICP {i.opportunities?.icp_score}%</div>
                  </div>
                  <span style={{ fontSize:12, color:C.dimmer }}>{i.profiles?.email}</span>
                </div>
              ))
            }
          </div>
        )}

        {/* ── ICP SETUP ── */}
        {tab==='icp' && (
          <div>
            <h2 style={{ color:C.gold, fontWeight:'normal', fontSize:21, marginBottom:6 }}>ICP Genre Priorities</h2>
            <p style={{ color:C.dim, fontSize:14, lineHeight:1.7, marginBottom:24 }}>
              Select the genres that match your ideal speaking audience. Genre match = <strong style={{ color:C.text }}>70 of 100 points</strong>.
            </p>
            <div style={{ display:'flex', flexWrap:'wrap', gap:10, marginBottom:24 }}>
              {GENRES.map(g=>{
                const active=icpGenres.includes(g)
                return <button key={g} style={pill(active)} onClick={()=>setIcpGenres(p=>active?p.filter(x=>x!==g):[...p,g])}>{active?'✓ ':''}{g}</button>
              })}
            </div>
            <div style={{ background:C.surface, border:`1px solid ${C.border}`, borderRadius:10, padding:20 }}>
              {[['70 pts','Genre/Industry Match','Selected genres above'],['15 pts','Contact Info Present','Email or phone in event'],['10 pts','Location Specified','City or venue included'],['5 pts','Fee Mentioned','Honorarium noted']].map(([pts,l,d])=>(
                <div key={l} style={{ display:'flex', gap:14, marginBottom:10 }}>
                  <span style={{ color:C.gold, fontWeight:'bold', minWidth:50, fontSize:13, fontFamily:'monospace' }}>{pts}</span>
                  <div><div style={{ color:C.text, fontSize:13 }}>{l}</div><div style={{ color:C.dim, fontSize:12 }}>{d}</div></div>
                </div>
              ))}
            </div>
            <p style={{ marginTop:14, fontSize:13, color:C.dimmer }}>Selected: <span style={{ color:C.gold }}>{icpGenres.join(', ')||'None'}</span></p>
          </div>
        )}

      </main>
    </div>
  )
}
