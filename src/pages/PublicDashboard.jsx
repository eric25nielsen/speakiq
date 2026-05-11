import React, { useEffect, useState, useMemo } from 'react'
import { supabase } from '../lib/supabase.js'
import DetailModal from '../components/DetailModal.jsx'

const C = {
  bg:'#0d0f14', surface:'#13151c', border:'#1e2130',
  gold:'#e8c96a', goldFaint:'rgba(232,201,106,0.12)',
  text:'#e8e4dc', muted:'#9ca3af', dim:'#6b7280', dimmer:'#4b5563',
  green:'#00c896', orange:'#f5a623', red:'#e05555',
}

const scoreColor = (s) => s >= 75 ? C.green : s >= 45 ? C.orange : C.red

const sel = {
  background:'#1a1d28', color:C.text, border:`1px solid #2a2d3a`,
  borderRadius:6, padding:'8px 12px', fontSize:13, fontFamily:'inherit', outline:'none',
}

export default function PublicDashboard() {
  const [opps,        setOpps]    = useState([])
  const [loading,     setLoading] = useState(true)
  const [selected,    setSelected]= useState(null)
  const [search,      setSearch]  = useState('')
  const [filterGenre, setGenre]   = useState('All')
  const [filterMonth, setMonth]   = useState('All')
  const [filterState, setState_]  = useState('')
  const [sortBy,      setSortBy]  = useState('score')

  useEffect(() => {
    supabase.from('opportunities').select('*').order('icp_score', { ascending:false })
      .then(({ data }) => { setOpps(data || []); setLoading(false) })
  }, [])

  const allGenres = useMemo(() => ['All', ...new Set(opps.map(o=>o.genre).filter(Boolean))], [opps])
  const allMonths = useMemo(() => ['All', ...new Set(opps.map(o=>o.calendar_month).filter(Boolean))], [opps])

  const filtered = useMemo(() => {
    let list = [...opps]
    if (search)          list = list.filter(o => JSON.stringify(o).toLowerCase().includes(search.toLowerCase()))
    if (filterGenre !== 'All') list = list.filter(o => o.genre === filterGenre)
    if (filterMonth !== 'All') list = list.filter(o => o.calendar_month === filterMonth)
    if (filterState)     list = list.filter(o => (o.location||'').toLowerCase().includes(filterState.toLowerCase()))
    list.sort((a,b) =>
      sortBy === 'score' ? b.icp_score - a.icp_score :
      sortBy === 'date'  ? new Date(a.date||0) - new Date(b.date||0) :
      (a.title||'').localeCompare(b.title||'')
    )
    return list
  }, [opps, search, filterGenre, filterMonth, filterState, sortBy])

  const exportCSV = () => {
    const h = ['#','Title','Date','Location','Organization','Genre','Format','Contact','Email','Phone','Fee','ICP Score','Details']
    const rows = filtered.map((o,i) => [i+1, o.title, o.date, o.location, o.organization, o.genre, o.format, o.contact_name, o.contact_email, o.contact_phone, o.fee, o.icp_score, o.details])
    const csv = [h,...rows].map(r=>r.map(c=>`"${(c??'').toString().replace(/"/g,'""')}"`).join(',')).join('\n')
    const a = Object.assign(document.createElement('a'), { href:URL.createObjectURL(new Blob([csv],{type:'text/csv'})), download:`speakiq-${new Date().toISOString().slice(0,10)}.csv` })
    a.click()
  }

  return (
    <div style={{ minHeight:'100vh', background:C.bg, color:C.text, fontFamily:'Georgia,serif' }}>

      {/* Header */}
      <header style={{ background:C.surface, borderBottom:`1px solid ${C.border}`, padding:'14px 24px', display:'flex', alignItems:'center', justifyContent:'space-between', flexWrap:'wrap', gap:10 }}>
        <div style={{ display:'flex', alignItems:'center', gap:12 }}>
          <div style={{ width:32, height:32, background:`linear-gradient(135deg,#c9a84c,${C.gold})`, borderRadius:7, display:'flex', alignItems:'center', justifyContent:'center', fontWeight:'bold', color:C.bg, fontSize:15 }}>S</div>
          <div>
            <div style={{ fontSize:17, fontWeight:'bold', color:C.gold, letterSpacing:'0.04em' }}>SpeakIQ</div>
            <div style={{ fontSize:10, color:C.dim, letterSpacing:'0.1em', textTransform:'uppercase' }}>Speaking Opportunities</div>
          </div>
        </div>
        <div style={{ display:'flex', gap:10, alignItems:'center', flexWrap:'wrap' }}>
          {opps.length > 0 && (
            <>
              <span style={{ fontSize:13, color:C.dim }}>{filtered.length} of {opps.length} opportunities</span>
              <button onClick={exportCSV} style={{ ...sel, cursor:'pointer', border:`1px solid ${C.border}` }}>↓ Export CSV</button>
            </>
          )}
          <a href="/login" style={{ background:'none', border:`1px solid ${C.border}`, color:C.dim, borderRadius:6, padding:'7px 14px', cursor:'pointer', fontSize:12, fontFamily:'inherit', textDecoration:'none' }}>Sign In</a>
        </div>
      </header>

      {/* Stats */}
      {opps.length > 0 && (
        <div style={{ background:C.surface, borderBottom:`1px solid ${C.border}`, padding:'10px 24px', display:'flex', gap:24, flexWrap:'wrap' }}>
          {[
            { l:'Total',          v:opps.length },
            { l:'High Match 75%+',v:opps.filter(o=>o.icp_score>=75).length, gold:true },
            { l:'Have Contact',   v:opps.filter(o=>o.contact_email).length },
            { l:'Showing',        v:filtered.length },
          ].map(s => (
            <div key={s.l} style={{ display:'flex', flexDirection:'column' }}>
              <span style={{ fontSize:20, fontWeight:'bold', color:s.gold?C.gold:C.text }}>{s.v}</span>
              <span style={{ fontSize:10, color:C.dim, letterSpacing:'0.08em', textTransform:'uppercase' }}>{s.l}</span>
            </div>
          ))}
        </div>
      )}

      <main style={{ padding:'20px 24px', maxWidth:1200, margin:'0 auto', boxSizing:'border-box' }}>
        {loading ? (
          <div style={{ textAlign:'center', padding:'80px', color:C.dim }}>Loading opportunities…</div>
        ) : opps.length === 0 ? (
          <div style={{ textAlign:'center', padding:'80px' }}>
            <div style={{ fontSize:40, opacity:0.15, marginBottom:16 }}>📅</div>
            <div style={{ color:C.muted, fontSize:15 }}>No opportunities loaded yet.</div>
          </div>
        ) : (
          <>
            {/* Filters */}
            <div style={{ display:'flex', gap:8, marginBottom:16, flexWrap:'wrap', alignItems:'center' }}>
              <div style={{ position:'relative', flex:1, minWidth:200 }}>
                <span style={{ position:'absolute', left:10, top:'50%', transform:'translateY(-50%)', color:C.dim, fontSize:13 }}>🔍</span>
                <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search by title, org, location…"
                  style={{ ...sel, width:'100%', paddingLeft:32, boxSizing:'border-box' }} />
              </div>
              <select value={filterGenre} onChange={e=>setGenre(e.target.value)} style={sel}>
                {allGenres.map(g=><option key={g}>{g}</option>)}
              </select>
              <select value={filterMonth} onChange={e=>setMonth(e.target.value)} style={sel}>
                {allMonths.map(m=><option key={m}>{m}</option>)}
              </select>
              <input value={filterState} onChange={e=>setState_(e.target.value)} placeholder="State / city…" style={{ ...sel, width:140 }} />
              <select value={sortBy} onChange={e=>setSortBy(e.target.value)} style={sel}>
                <option value="score">Best Match</option>
                <option value="date">Date</option>
                <option value="title">A–Z</option>
              </select>
            </div>

            {/* List */}
            <div style={{ display:'flex', flexDirection:'column', gap:1 }}>
              {/* Header row */}
              <div style={{ display:'grid', gridTemplateColumns:'48px 1fr 140px 160px 100px 80px', gap:12, padding:'8px 16px', fontSize:10, color:C.dimmer, textTransform:'uppercase', letterSpacing:'0.08em', borderBottom:`1px solid ${C.border}` }}>
                <span>Rank</span>
                <span>Opportunity</span>
                <span>Date</span>
                <span>Location</span>
                <span>Genre</span>
                <span style={{ textAlign:'right' }}>Score</span>
              </div>

              {filtered.map((opp, i) => (
                <div key={opp.id} onClick={() => setSelected(opp)}
                  style={{ display:'grid', gridTemplateColumns:'48px 1fr 140px 160px 100px 80px', gap:12, padding:'12px 16px', background: i%2===0 ? C.surface : 'transparent', borderBottom:`1px solid ${C.border}`, cursor:'pointer', transition:'background 0.1s', alignItems:'center' }}
                  onMouseEnter={e=>e.currentTarget.style.background='rgba(232,201,106,0.06)'}
                  onMouseLeave={e=>e.currentTarget.style.background=i%2===0?C.surface:'transparent'}>

                  <span style={{ fontSize:13, color:C.dimmer, fontFamily:'monospace' }}>#{i+1}</span>

                  <div>
                    <div style={{ fontSize:14, color:C.text, fontWeight:'bold', marginBottom:2, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{opp.title || 'Untitled'}</div>
                    <div style={{ fontSize:11, color:C.dim }}>{opp.organization || ''}</div>
                  </div>

                  <span style={{ fontSize:12, color:C.muted, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{opp.date || '—'}</span>

                  <span style={{ fontSize:12, color:C.muted, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{opp.location || '—'}</span>

                  <span style={{ fontSize:11, color:C.gold, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{opp.genre || '—'}</span>

                  <div style={{ textAlign:'right' }}>
                    <span style={{ background:scoreColor(opp.icp_score), color: opp.icp_score>=75?'#003d2e':'#fff', borderRadius:20, padding:'2px 9px', fontSize:11, fontWeight:'bold', whiteSpace:'nowrap' }}>
                      {opp.icp_score}%
                    </span>
                  </div>
                </div>
              ))}
            </div>

            {filtered.length === 0 && (
              <div style={{ textAlign:'center', padding:'40px', color:C.dim, fontSize:14 }}>No results match your filters.</div>
            )}
          </>
        )}
      </main>

      {selected && (
        <DetailModal opp={selected} onClose={()=>setSelected(null)}
          isBookmarked={false} onToggleBookmark={()=>{}} />
      )}
    </div>
  )
}
