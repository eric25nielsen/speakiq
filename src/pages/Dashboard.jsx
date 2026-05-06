import React, { useEffect, useState, useCallback } from 'react'
import { supabase } from '../lib/supabase.js'
import Nav from '../components/Nav.jsx'
import OpportunityCard from '../components/OpportunityCard.jsx'

const C = { surface:'#13151c', border:'#1e2130', gold:'#e8c96a', text:'#e8e4dc', muted:'#9ca3af', dim:'#6b7280', bg:'#0d0f14' }

export default function Dashboard({ session, profile }) {
  const [opportunities, setOpportunities] = useState([])
  const [interactions,  setInteractions]  = useState({})
  const [sortBy,  setSortBy]  = useState('score')
  const [filterGenre, setFilter] = useState('All')
  const [filterStatus, setFilterStatus] = useState('All')
  const [months,  setMonths]  = useState([])
  const [month,   setMonth]   = useState('All')
  const [loading, setLoading] = useState(true)

  const fetchOpps = useCallback(async () => {
    setLoading(true)
    let q = supabase.from('opportunities').select('*')
    if (month !== 'All') q = q.eq('calendar_month', month)
    const { data } = await q.order('icp_score', { ascending: false })
    setOpportunities(data || [])

    // fetch distinct months
    const { data: mdata } = await supabase.from('opportunities').select('calendar_month').order('calendar_month', { ascending: false })
    const unique = [...new Set((mdata||[]).map(r=>r.calendar_month).filter(Boolean))]
    setMonths(unique)

    setLoading(false)
  }, [month])

  const fetchInteractions = useCallback(async () => {
    const { data } = await supabase.from('user_interactions')
      .select('*').eq('user_id', session.user.id)
    const map = {}
    ;(data||[]).forEach(i => { map[i.opportunity_id] = i })
    setInteractions(map)
  }, [session.user.id])

  useEffect(() => { fetchOpps() }, [fetchOpps])
  useEffect(() => { fetchInteractions() }, [fetchInteractions])

  const handleInteract = async (oppId, status) => {
    const existing = interactions[oppId]
    const newStatus = existing?.status === status ? 'pending' : status

    await supabase.from('user_interactions').upsert({
      user_id: session.user.id,
      opportunity_id: oppId,
      status: newStatus,
      ...(existing ? { id: existing.id } : {})
    }, { onConflict: 'user_id,opportunity_id' })

    setInteractions(prev => ({ ...prev, [oppId]: { ...prev[oppId], status: newStatus } }))
  }

  const exportCSV = () => {
    const headers = ['Title','Date','Location','Organization','Genre','Format','Contact','Email','Phone','Audience','Fee','ICP Score','Your Status','Details','Month']
    const rows = filtered.map(o => [
      o.title, o.date, o.location, o.organization, o.genre, o.format,
      o.contact_name, o.contact_email, o.contact_phone,
      o.audience, o.fee, o.icp_score,
      interactions[o.id]?.status || 'pending',
      o.details, o.calendar_month
    ])
    const csv = [headers,...rows].map(r=>r.map(c=>`"${(c??'').toString().replace(/"/g,'""')}"`).join(',')).join('\n')
    const a = Object.assign(document.createElement('a'), {
      href: URL.createObjectURL(new Blob([csv],{type:'text/csv'})),
      download: `speakiq-${month}-${new Date().toISOString().slice(0,10)}.csv`
    })
    a.click()
  }

  const allGenres = ['All', ...new Set(opportunities.map(o=>o.genre).filter(Boolean))]
  const filtered = opportunities
    .filter(o => filterGenre === 'All' || o.genre === filterGenre)
    .filter(o => {
      if (filterStatus === 'All') return true
      const s = interactions[o.id]?.status || 'pending'
      return s === filterStatus
    })
    .sort((a,b) =>
      sortBy === 'score' ? b.icp_score - a.icp_score :
      sortBy === 'date'  ? new Date(a.date) - new Date(b.date) :
      (a.genre||'').localeCompare(b.genre||'')
    )

  const highCount = opportunities.filter(o=>o.icp_score>=75).length
  const interestedCount = Object.values(interactions).filter(i=>i.status==='interested').length

  const sel = { background:'#1a1d28', color:C.text, border:`1px solid #2a2d3a`, borderRadius:6, padding:'7px 12px', fontSize:13, fontFamily:'inherit' }

  return (
    <div style={{ minHeight:'100vh', background:C.bg, display:'flex', flexDirection:'column' }}>
      <Nav profile={profile} />

      {/* Stats */}
      {opportunities.length > 0 && (
        <div style={{ background:C.surface, borderBottom:`1px solid ${C.border}`, padding:'10px 28px', display:'flex', gap:28, flexWrap:'wrap' }}>
          {[
            { l:'Total Engagements', v:opportunities.length },
            { l:'High ICP Match 75%+', v:highCount, gold:true },
            { l:'You Marked Interested', v:interestedCount },
            { l:'Showing', v:filtered.length },
          ].map(s=>(
            <div key={s.l} style={{ display:'flex', flexDirection:'column' }}>
              <span style={{ fontSize:21, fontWeight:'bold', color:s.gold?C.gold:C.text }}>{s.v}</span>
              <span style={{ fontSize:10, color:C.dim, letterSpacing:'0.09em', textTransform:'uppercase' }}>{s.l}</span>
            </div>
          ))}
        </div>
      )}

      <main style={{ flex:1, padding:'24px 28px', maxWidth:1200, width:'100%', margin:'0 auto', boxSizing:'border-box' }}>
        {loading ? (
          <div style={{ textAlign:'center', padding:'80px 0', color:C.dim }}>Loading opportunities…</div>
        ) : opportunities.length === 0 ? (
          <div style={{ textAlign:'center', padding:'80px 20px' }}>
            <div style={{ fontSize:40, opacity:0.15, marginBottom:16 }}>📅</div>
            <h2 style={{ fontWeight:'normal', color:C.text, marginBottom:10 }}>No opportunities loaded yet</h2>
            <p style={{ color:C.dim, fontSize:14, lineHeight:1.7 }}>
              {profile?.role === 'admin'
                ? 'Go to the Admin panel to load this month\'s speaking calendar.'
                : 'Your admin hasn\'t loaded this month\'s calendar yet. Check back soon.'}
            </p>
          </div>
        ) : (
          <>
            {/* Controls */}
            <div style={{ display:'flex', gap:10, marginBottom:20, flexWrap:'wrap', alignItems:'center' }}>
              <select value={month} onChange={e=>setMonth(e.target.value)} style={sel}>
                <option value="All">All Months</option>
                {months.map(m=><option key={m}>{m}</option>)}
              </select>
              <select value={sortBy} onChange={e=>setSortBy(e.target.value)} style={sel}>
                <option value="score">Sort: ICP Match ↓</option>
                <option value="date">Sort: Date ↑</option>
                <option value="genre">Sort: Genre A–Z</option>
              </select>
              <select value={filterGenre} onChange={e=>setFilter(e.target.value)} style={sel}>
                {allGenres.map(g=><option key={g}>{g}</option>)}
              </select>
              <select value={filterStatus} onChange={e=>setFilterStatus(e.target.value)} style={sel}>
                <option value="All">All Statuses</option>
                <option value="interested">Interested</option>
                <option value="pass">Pass</option>
                <option value="pending">Undecided</option>
              </select>
              <button onClick={exportCSV} style={{ background:'none', border:`1px solid #2a2d3a`, color:C.dim, borderRadius:6, padding:'7px 14px', cursor:'pointer', fontSize:13, fontFamily:'inherit', marginLeft:'auto' }}>
                ↓ Export CSV
              </button>
            </div>

            <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill,minmax(310px,1fr))', gap:16 }}>
              {filtered.map(opp=>(
                <OpportunityCard key={opp.id} opp={opp} interaction={interactions[opp.id]} onInteract={handleInteract} />
              ))}
            </div>
            {filtered.length === 0 && (
              <div style={{ textAlign:'center', padding:'40px', color:C.dim, fontSize:14 }}>No results match your filters.</div>
            )}
          </>
        )}
      </main>
    </div>
  )
}
