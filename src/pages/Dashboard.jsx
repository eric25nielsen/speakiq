import React, { useEffect, useState, useCallback, useMemo } from 'react'
import { supabase } from '../lib/supabase.js'
import Nav from '../components/Nav.jsx'
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

export default function Dashboard({ session, profile }) {
  const [opps,        setOpps]      = useState([])
  const [loading,     setLoading]   = useState(true)
  const [selected,    setSelected]  = useState(null)
  const [bookmarks,   setBookmarks] = useState(new Set())
  const [search,      setSearch]    = useState('')
  const [filterGenre, setGenre]     = useState('All')
  const [filterMonth, setMonth]     = useState('All')
  const [filterState, setState_]    = useState('')
  const [filterBM,    setFilterBM]  = useState(false)
  const [sortBy,      setSortBy]    = useState('score')
  const [icpGenres,   setIcpGenres] = useState(['Leadership','Business','Healthcare'])
  const [showICP,     setShowICP]   = useState(false)

  const ALL_GENRES = ['Leadership','Healthcare','Business','Technology','Education','Finance','Entrepreneurship','Sales','Mental Health','Nonprofit','Government','Real Estate','HR & Talent','Marketing','Wellness','Legal']

  const fetchOpps = useCallback(async () => {
    setLoading(true)
    const { data } = await supabase.from('opportunities').select('*').order('icp_score', { ascending:false })
    setOpps(data || [])
    setLoading(false)
  }, [])

  useEffect(() => { fetchOpps() }, [fetchOpps])

  // Load saved ICP genres
  useEffect(() => {
    supabase.from('app_settings').select('value').eq('key','icp_genres').single()
      .then(({ data }) => { if (data?.value) { try { setIcpGenres(JSON.parse(data.value)) } catch {} } })
  }, [])

  // Dynamic ICP score calculation
  const calcScore = useCallback((opp) => {
    let s = 0
    const g = (opp.genre || '').toLowerCase()
    if (icpGenres.some(ig => g.includes(ig.toLowerCase()) || ig.toLowerCase().includes(g))) s += 70
    if (opp.contact_email || opp.contact_phone) s += 15
    if (opp.location) s += 10
    if (opp.fee) s += 5
    return s
  }, [icpGenres])

  const saveIcpGenres = async (genres) => {
    setIcpGenres(genres)
    await supabase.from('app_settings').upsert({ key:'icp_genres', value:JSON.stringify(genres), updated_at:new Date().toISOString() })
  }

  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(`speakiq_bm_${session.user.id}`) || '[]')
      setBookmarks(new Set(saved))
    } catch {}
  }, [session.user.id])

  const toggleBookmark = (id) => {
    setBookmarks(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      localStorage.setItem(`speakiq_bm_${session.user.id}`, JSON.stringify([...next]))
      return next
    })
  }

  const allGenres = useMemo(() => ['All', ...new Set(opps.map(o=>o.genre).filter(Boolean))], [opps])
  // Parse event month from actual date field e.g. "November 5-7, 2026" -> "November 2026"
  const parseEventMonth = (dateStr) => {
    if (!dateStr) return null
    const months = ['January','February','March','April','May','June','July','August','September','October','November','December']
    const abbr   = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
    // Match "Month YYYY" or "Month Day, YYYY"
    for (let i = 0; i < months.length; i++) {
      const re = new RegExp(`(${months[i]}|${abbr[i]})\.?[^\d]*(202[5-9]|203\d)`, 'i')
      const m = dateStr.match(re)
      if (m) return `${months[i]} ${m[2]}`
    }
    // Just a year
    const yearMatch = dateStr.match(/\b(202[5-9]|203\d)\b/)
    if (yearMatch) return yearMatch[1]
    return null
  }

  const allMonths = useMemo(() => {
    const months = [...new Set(opps.map(o => parseEventMonth(o.date)).filter(Boolean))]
    // Sort chronologically
    months.sort((a, b) => {
      const monthOrder = ['January','February','March','April','May','June','July','August','September','October','November','December']
      const [aMonth, aYear] = a.split(' ')
      const [bMonth, bYear] = b.split(' ')
      if (aYear !== bYear) return parseInt(aYear) - parseInt(bYear)
      return monthOrder.indexOf(aMonth) - monthOrder.indexOf(bMonth)
    })
    return months.length > 0 ? ['All', ...months] : ['All']
  }, [opps])

  // Apply dynamic ICP scoring based on current genres
  const scoredOpps = useMemo(() => opps.map(o => ({ ...o, dynamicScore: calcScore(o) })), [opps, calcScore])

  const filtered = useMemo(() => {
    let list = [...scoredOpps]
    if (search)          list = list.filter(o => JSON.stringify(o).toLowerCase().includes(search.toLowerCase()))
    if (filterGenre !== 'All') list = list.filter(o => o.genre === filterGenre)
    if (filterMonth !== 'All') list = list.filter(o => parseEventMonth(o.date) === filterMonth)
    if (filterState)     list = list.filter(o => (o.location||'').toLowerCase().includes(filterState.toLowerCase()))
    if (filterBM)        list = list.filter(o => bookmarks.has(o.id))
    list.sort((a,b) =>
      sortBy === 'score' ? b.dynamicScore - a.dynamicScore :
      sortBy === 'date'  ? new Date(a.date||0) - new Date(b.date||0) :
      (a.title||'').localeCompare(b.title||'')
    )
    return list
  }, [scoredOpps, search, filterGenre, filterMonth, filterState, filterBM, sortBy, bookmarks, parseEventMonth])

  const exportCSV = () => {
    const h = ['#','Title','Date','Location','Organization','Genre','Format','Contact','Email','Phone','Fee','ICP Score','Details','Month']
    const rows = filtered.map((o,i) => [i+1,o.title,o.date,o.location,o.organization,o.genre,o.format,o.contact_name,o.contact_email,o.contact_phone,o.fee,o.icp_score,o.details,o.calendar_month])
    const csv = [h,...rows].map(r=>r.map(c=>`"${(c??'').toString().replace(/"/g,'""')}"`).join(',')).join('\n')
    const a = Object.assign(document.createElement('a'), { href:URL.createObjectURL(new Blob([csv],{type:'text/csv'})), download:`speakiq-${new Date().toISOString().slice(0,10)}.csv` })
    a.click()
  }

  const shareUrl = `${window.location.origin}/public`
  const copyShare = () => { navigator.clipboard.writeText(shareUrl) }

  return (
    <div style={{ minHeight:'100vh', background:C.bg, display:'flex', flexDirection:'column' }}>
      <Nav profile={profile} />

      {/* Stats */}
      {opps.length > 0 && (
        <div style={{ background:C.surface, borderBottom:`1px solid ${C.border}`, padding:'10px 24px', display:'flex', gap:24, flexWrap:'wrap', alignItems:'center' }}>
          {[
            { l:'Total',          v:opps.length },
            { l:'High Match 75%+',v:scoredOpps.filter(o=>o.dynamicScore>=75).length, gold:true },
            { l:'Bookmarked',     v:bookmarks.size },
            { l:'Showing',        v:filtered.length },
          ].map(s => (
            <div key={s.l} style={{ display:'flex', flexDirection:'column' }}>
              <span style={{ fontSize:20, fontWeight:'bold', color:s.gold?C.gold:C.text }}>{s.v}</span>
              <span style={{ fontSize:10, color:C.dim, letterSpacing:'0.08em', textTransform:'uppercase' }}>{s.l}</span>
            </div>
          ))}
          {/* Share button */}
          <div style={{ marginLeft:'auto', display:'flex', alignItems:'center', gap:8 }}>
            <span style={{ fontSize:11, color:C.dim }}>Public link:</span>
            <button onClick={copyShare}
              style={{ background:C.goldFaint, border:`1px solid rgba(232,201,106,0.3)`, color:C.gold, borderRadius:6, padding:'5px 12px', cursor:'pointer', fontSize:11, fontFamily:'inherit' }}>
              📋 Copy Share Link
            </button>
          </div>
        </div>
      )}

      <main style={{ flex:1, padding:'20px 24px', maxWidth:1300, width:'100%', margin:'0 auto', boxSizing:'border-box' }}>
        {loading ? (
          <div style={{ textAlign:'center', padding:'80px', color:C.dim }}>Loading…</div>
        ) : opps.length === 0 ? (
          <div style={{ textAlign:'center', padding:'80px' }}>
            <div style={{ fontSize:40, opacity:0.15, marginBottom:16 }}>📅</div>
            <h2 style={{ fontWeight:'normal', color:C.text, marginBottom:8 }}>No opportunities loaded yet</h2>
            <p style={{ color:C.dim, fontSize:14 }}>
              {profile?.role === 'admin' ? 'Go to Admin → Sync Calendar to load this month\'s opportunities.' : 'Check back soon — your admin hasn\'t loaded this month\'s calendar yet.'}
            </p>
          </div>
        ) : (
          <>
            {/* Filters */}
            <div style={{ display:'flex', gap:8, marginBottom:16, flexWrap:'wrap', alignItems:'center' }}>
              <div style={{ position:'relative', flex:1, minWidth:200 }}>
                <span style={{ position:'absolute', left:10, top:'50%', transform:'translateY(-50%)', color:C.dim, fontSize:13 }}>🔍</span>
                <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search by title, org, location, keyword…"
                  style={{ ...sel, width:'100%', paddingLeft:32, boxSizing:'border-box' }} />
              </div>
              <select value={filterGenre} onChange={e=>setGenre(e.target.value)} style={sel}>
                {allGenres.map(g=><option key={g}>{g}</option>)}
              </select>
              <select value={filterMonth} onChange={e=>setMonth(e.target.value)} style={sel}>
                {allMonths.map(m=><option key={m}>{m}</option>)}
              </select>
              <input value={filterState} onChange={e=>setState_(e.target.value)} placeholder="State / city…" style={{ ...sel, width:130 }} />
              <button onClick={()=>setFilterBM(p=>!p)}
                style={{ ...sel, background:filterBM?C.goldFaint:'#1a1d28', color:filterBM?C.gold:C.dim, border:`1px solid ${filterBM?C.gold:'#2a2d3a'}`, cursor:'pointer' }}>
                {filterBM?'★':'☆'} Saved
              </button>
              <select value={sortBy} onChange={e=>setSortBy(e.target.value)} style={sel}>
                <option value="score">Best Match</option>
                <option value="date">Date</option>
                <option value="title">A–Z</option>
              </select>
              <button onClick={exportCSV} style={{ ...sel, cursor:'pointer' }}>↓ Export</button>
              <button onClick={()=>setShowICP(p=>!p)}
                style={{ ...sel, cursor:'pointer', background:showICP?C.goldFaint:'#1a1d28', color:showICP?C.gold:C.dim, border:`1px solid ${showICP?C.gold:'#2a2d3a'}` }}>
                ⚙ ICP
              </button>
            </div>

            {/* ICP Genre Panel */}
            {showICP && (
              <div style={{ background:C.surface, border:`1px solid ${C.border}`, borderRadius:10, padding:'16px 18px', marginBottom:12 }}>
                <div style={{ fontSize:13, color:C.text, fontWeight:'bold', marginBottom:4 }}>ICP Genre Priorities</div>
                <p style={{ fontSize:12, color:C.dim, marginBottom:12, lineHeight:1.6 }}>Select the genres that match your ideal audience. The list re-ranks instantly.</p>
                <div style={{ display:'flex', flexWrap:'wrap', gap:8 }}>
                  {ALL_GENRES.map(g => {
                    const active = icpGenres.includes(g)
                    return (
                      <button key={g} onClick={()=>saveIcpGenres(active?icpGenres.filter(x=>x!==g):[...icpGenres,g])}
                        style={{ background:active?C.goldFaint:'#0d0f14', color:active?C.gold:C.dim, border:`1px solid ${active?C.gold:'#2a2d3a'}`, borderRadius:20, padding:'5px 14px', cursor:'pointer', fontSize:12, fontFamily:'inherit' }}>
                        {active?'✓ ':''}{g}
                      </button>
                    )
                  })}
                </div>
              </div>
            )}

            <div style={{ fontSize:12, color:C.dim, marginBottom:12 }}>
              Showing <strong style={{ color:C.text }}>{filtered.length}</strong> of {opps.length} opportunities
              {(search||filterGenre!=='All'||filterMonth!=='All'||filterState||filterBM) && (
                <button onClick={()=>{ setSearch('');setGenre('All');setMonth('All');setState_('');setFilterBM(false) }}
                  style={{ background:'none', border:'none', color:C.orange, cursor:'pointer', fontSize:12, fontFamily:'inherit', marginLeft:12, textDecoration:'underline' }}>
                  Clear filters
                </button>
              )}
            </div>

            {/* List table */}
            <div style={{ border:`1px solid ${C.border}`, borderRadius:10, overflow:'hidden' }}>
              {/* Header */}
              <div style={{ display:'grid', gridTemplateColumns:'48px 1fr 150px 170px 110px 70px 36px', gap:12, padding:'9px 16px', background:'#0f1118', fontSize:10, color:C.dimmer, textTransform:'uppercase', letterSpacing:'0.08em', borderBottom:`1px solid ${C.border}` }}>
                <span>#</span>
                <span>Opportunity</span>
                <span>Date</span>
                <span>Location</span>
                <span>Genre</span>
                <span style={{ textAlign:'right' }}>Score</span>
                <span></span>
              </div>

              {filtered.length === 0 ? (
                <div style={{ padding:'40px', textAlign:'center', color:C.dim, fontSize:13 }}>No results match your filters.</div>
              ) : filtered.map((opp, i) => (
                <div key={opp.id}
                  onClick={() => setSelected(opp)}
                  style={{ display:'grid', gridTemplateColumns:'48px 1fr 150px 170px 110px 70px 36px', gap:12, padding:'11px 16px', background: i%2===0 ? C.surface : 'transparent', borderBottom:`1px solid ${C.border}`, cursor:'pointer', alignItems:'center', transition:'background 0.1s' }}
                  onMouseEnter={e=>e.currentTarget.style.background='rgba(232,201,106,0.06)'}
                  onMouseLeave={e=>e.currentTarget.style.background=i%2===0?C.surface:'transparent'}>

                  <span style={{ fontSize:12, color:C.dimmer, fontFamily:'monospace' }}>#{i+1}</span>

                  <div style={{ overflow:'hidden' }}>
                    <div style={{ fontSize:14, color:C.text, fontWeight:'bold', whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>
                      {opp.title || 'Untitled'}
                    </div>
                    <div style={{ fontSize:11, color:C.dim, marginTop:1, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>
                      {opp.organization || ''}
                      {opp.contact_email && <span style={{ color:C.green, marginLeft:8 }}>✓ contact</span>}
                      {opp.fee && <span style={{ color:C.gold, marginLeft:8 }}>💰 {opp.fee}</span>}
                    </div>
                  </div>

                  <span style={{ fontSize:12, color:C.muted, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{opp.date || '—'}</span>
                  <span style={{ fontSize:12, color:C.muted, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{opp.location || '—'}</span>
                  <span style={{ fontSize:11, color:C.gold, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{opp.genre || '—'}</span>

                  <div style={{ textAlign:'right' }}>
                    <span style={{ background:scoreColor(opp.icp_score), color:opp.icp_score>=75?'#003d2e':'#fff', borderRadius:20, padding:'2px 9px', fontSize:11, fontWeight:'bold' }}>
                      {opp.icp_score}%
                    </span>
                  </div>

                  <button onClick={e=>{ e.stopPropagation(); toggleBookmark(opp.id) }}
                    style={{ background:'none', border:'none', cursor:'pointer', fontSize:15, color:bookmarks.has(opp.id)?C.gold:C.dimmer, padding:0 }}>
                    {bookmarks.has(opp.id)?'★':'☆'}
                  </button>
                </div>
              ))}
            </div>
          </>
        )}
      </main>

      {selected && (
        <DetailModal opp={selected} onClose={()=>setSelected(null)}
          isBookmarked={bookmarks.has(selected.id)}
          onToggleBookmark={()=>toggleBookmark(selected.id)} />
      )}
    </div>
  )
}
