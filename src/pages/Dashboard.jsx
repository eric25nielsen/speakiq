import React, { useEffect, useState, useCallback, useMemo } from 'react'
import { supabase } from '../lib/supabase.js'
import Nav from '../components/Nav.jsx'
import OpportunityCard from '../components/OpportunityCard.jsx'
import DetailModal from '../components/DetailModal.jsx'

const C = {
  bg:'#0d0f14', surface:'#13151c', surface2:'#0f1118', border:'#1e2130',
  gold:'#e8c96a', goldFaint:'rgba(232,201,106,0.12)', goldBorder:'rgba(232,201,106,0.25)',
  text:'#e8e4dc', muted:'#9ca3af', dim:'#6b7280', dimmer:'#4b5563',
  green:'#00c896', orange:'#f5a623', red:'#e05555',
}

const sel = {
  background:'#1a1d28', color:C.text, border:`1px solid #2a2d3a`,
  borderRadius:6, padding:'8px 12px', fontSize:13, fontFamily:'inherit', outline:'none',
}

// ── Timeline View ──────────────────────────────────────────────────────────
function TimelineView({ opportunities, bookmarks, onToggleBookmark, onSelect }) {
  const grouped = useMemo(() => {
    const map = {}
    opportunities.forEach(o => {
      const d = o.date ? new Date(o.date) : null
      const key = d && !isNaN(d)
        ? d.toLocaleString('default', { month:'long', year:'numeric' })
        : 'Date Unknown'
      if (!map[key]) map[key] = []
      map[key].push(o)
    })
    // Sort keys chronologically
    return Object.entries(map).sort(([a],[b]) => {
      if (a === 'Date Unknown') return 1
      if (b === 'Date Unknown') return -1
      return new Date(a) - new Date(b)
    })
  }, [opportunities])

  return (
    <div>
      {grouped.map(([month, opps]) => (
        <div key={month} style={{ marginBottom:32 }}>
          <div style={{ display:'flex', alignItems:'center', gap:12, marginBottom:16 }}>
            <div style={{ fontSize:13, fontWeight:'bold', color:C.gold, letterSpacing:'0.06em', textTransform:'uppercase' }}>{month}</div>
            <div style={{ flex:1, height:1, background:C.border }} />
            <div style={{ fontSize:11, color:C.dimmer }}>{opps.length} engagement{opps.length!==1?'s':''}</div>
          </div>
          <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill,minmax(290px,1fr))', gap:14 }}>
            {opps.map(opp => (
              <OpportunityCard key={opp.id} opp={opp}
                isBookmarked={bookmarks.has(opp.id)}
                onToggleBookmark={onToggleBookmark}
                onClick={()=>onSelect(opp)} />
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

// ── Main Dashboard ─────────────────────────────────────────────────────────
export default function Dashboard({ session, profile }) {
  const [opportunities, setOpps]       = useState([])
  const [loading,       setLoading]    = useState(true)
  const [selectedOpp,   setSelected]   = useState(null)
  const [bookmarks,     setBookmarks]  = useState(new Set())
  const [view,          setView]       = useState('grid')   // 'grid' | 'timeline'

  // Filters
  const [search,        setSearch]     = useState('')
  const [filterGenre,   setGenre]      = useState('All')
  const [filterFormat,  setFormat]     = useState('All')
  const [filterState,   setFilterState]= useState('')
  const [filterMonth,   setMonth]      = useState('All')
  const [filterBookmark,setFilterBM]  = useState(false)
  const [sortBy,        setSortBy]     = useState('score')

  // Load opportunities
  const fetchOpps = useCallback(async () => {
    setLoading(true)
    const { data } = await supabase.from('opportunities').select('*').order('icp_score', { ascending:false })
    setOpps(data || [])
    setLoading(false)
  }, [])

  useEffect(() => { fetchOpps() }, [fetchOpps])

  // Load bookmarks from localStorage
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(`speakiq_bookmarks_${session.user.id}`) || '[]')
      setBookmarks(new Set(saved))
    } catch {}
  }, [session.user.id])

  const toggleBookmark = (id) => {
    setBookmarks(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      localStorage.setItem(`speakiq_bookmarks_${session.user.id}`, JSON.stringify([...next]))
      return next
    })
  }

  // Derived data
  const allGenres  = useMemo(() => ['All', ...new Set(opportunities.map(o=>o.genre).filter(Boolean))], [opportunities])
  const allFormats = useMemo(() => ['All', ...new Set(opportunities.map(o=>o.format).filter(Boolean))], [opportunities])
  const allMonths  = useMemo(() => ['All', ...new Set(opportunities.map(o=>o.calendar_month).filter(Boolean))], [opportunities])

  const filtered = useMemo(() => {
    let list = [...opportunities]
    if (search)          list = list.filter(o => JSON.stringify(o).toLowerCase().includes(search.toLowerCase()))
    if (filterGenre !== 'All') list = list.filter(o => o.genre === filterGenre)
    if (filterFormat !== 'All') list = list.filter(o => o.format === filterFormat)
    if (filterState)     list = list.filter(o => (o.location||'').toLowerCase().includes(filterState.toLowerCase()))
    if (filterMonth !== 'All') list = list.filter(o => o.calendar_month === filterMonth)
    if (filterBookmark)  list = list.filter(o => bookmarks.has(o.id))

    list.sort((a,b) =>
      sortBy === 'score' ? b.icp_score - a.icp_score :
      sortBy === 'date'  ? new Date(a.date||0) - new Date(b.date||0) :
      sortBy === 'title' ? (a.title||'').localeCompare(b.title||'') :
      (a.genre||'').localeCompare(b.genre||'')
    )
    return list
  }, [opportunities, search, filterGenre, filterFormat, filterState, filterMonth, filterBookmark, sortBy, bookmarks])

  const exportCSV = () => {
    const headers = ['Title','Date','Location','Organization','Genre','Format','Contact','Email','Phone','Audience','Fee','ICP Score','Details','Month']
    const rows = filtered.map(o=>[o.title,o.date,o.location,o.organization,o.genre,o.format,o.contact_name,o.contact_email,o.contact_phone,o.audience,o.fee,o.icp_score,o.details,o.calendar_month])
    const csv = [headers,...rows].map(r=>r.map(c=>`"${(c??'').toString().replace(/"/g,'""')}"`).join(',')).join('\n')
    const a = Object.assign(document.createElement('a'),{ href:URL.createObjectURL(new Blob([csv],{type:'text/csv'})), download:`speakiq-${new Date().toISOString().slice(0,10)}.csv` })
    a.click()
  }

  const clearFilters = () => {
    setSearch(''); setGenre('All'); setFormat('All')
    setFilterState(''); setMonth('All'); setFilterBM(false)
  }
  const hasFilters = search || filterGenre!=='All' || filterFormat!=='All' || filterState || filterMonth!=='All' || filterBookmark

  const highCount = opportunities.filter(o=>o.icp_score>=75).length
  const bookmarkCount = bookmarks.size

  return (
    <div style={{ minHeight:'100vh', background:C.bg, display:'flex', flexDirection:'column' }}>
      <Nav profile={profile} />

      {/* Stats strip */}
      {opportunities.length > 0 && (
        <div style={{ background:C.surface, borderBottom:`1px solid ${C.border}`, padding:'10px 28px', display:'flex', gap:24, flexWrap:'wrap', alignItems:'center' }}>
          {[
            { l:'Total',         v:opportunities.length },
            { l:'Top Match 75%+',v:highCount,      gold:true },
            { l:'Bookmarked',    v:bookmarkCount },
            { l:'Showing',       v:filtered.length },
          ].map(s=>(
            <div key={s.l} style={{ display:'flex', flexDirection:'column' }}>
              <span style={{ fontSize:20, fontWeight:'bold', color:s.gold?C.gold:C.text }}>{s.v}</span>
              <span style={{ fontSize:10, color:C.dim, letterSpacing:'0.09em', textTransform:'uppercase' }}>{s.l}</span>
            </div>
          ))}
        </div>
      )}

      <main style={{ flex:1, padding:'20px 28px', maxWidth:1300, width:'100%', margin:'0 auto', boxSizing:'border-box' }}>
        {loading ? (
          <div style={{ textAlign:'center', padding:'80px 0', color:C.dim }}>Loading opportunities…</div>
        ) : opportunities.length === 0 ? (
          <div style={{ textAlign:'center', padding:'80px 20px' }}>
            <div style={{ fontSize:42, opacity:0.15, marginBottom:16 }}>📅</div>
            <h2 style={{ fontWeight:'normal', color:C.text, marginBottom:8 }}>No opportunities loaded yet</h2>
            <p style={{ color:C.dim, fontSize:14, lineHeight:1.7 }}>
              {profile?.role==='admin' ? 'Go to Admin → Load Calendar to add this month\'s speaking opportunities.' : 'Your admin hasn\'t loaded this month\'s calendar yet. Check back soon.'}
            </p>
          </div>
        ) : (
          <>
            {/* ── Search + Controls ── */}
            <div style={{ display:'flex', flexDirection:'column', gap:10, marginBottom:20 }}>

              {/* Search bar */}
              <div style={{ position:'relative' }}>
                <span style={{ position:'absolute', left:12, top:'50%', transform:'translateY(-50%)', color:C.dim, fontSize:14 }}>🔍</span>
                <input value={search} onChange={e=>setSearch(e.target.value)}
                  placeholder="Search by title, organization, location, keyword…"
                  style={{ ...sel, width:'100%', paddingLeft:36, boxSizing:'border-box', fontSize:14, padding:'11px 14px 11px 36px' }} />
                {search && <button onClick={()=>setSearch('')} style={{ position:'absolute', right:12, top:'50%', transform:'translateY(-50%)', background:'none', border:'none', color:C.dim, cursor:'pointer', fontSize:16 }}>×</button>}
              </div>

              {/* Filter row */}
              <div style={{ display:'flex', gap:8, flexWrap:'wrap', alignItems:'center' }}>
                <select value={filterGenre} onChange={e=>setGenre(e.target.value)} style={sel}>
                  {allGenres.map(g=><option key={g}>{g}</option>)}
                </select>
                <select value={filterFormat} onChange={e=>setFormat(e.target.value)} style={sel}>
                  {allFormats.map(f=><option key={f}>{f}</option>)}
                </select>
                <select value={filterMonth} onChange={e=>setMonth(e.target.value)} style={sel}>
                  {allMonths.map(m=><option key={m}>{m}</option>)}
                </select>
                <input value={filterState} onChange={e=>setFilterState(e.target.value)}
                  placeholder="Filter by state/city…"
                  style={{ ...sel, minWidth:160 }} />
                <button onClick={()=>setFilterBM(p=>!p)}
                  style={{ ...sel, background: filterBookmark ? C.goldFaint : '#1a1d28', color: filterBookmark ? C.gold : C.dim, border:`1px solid ${filterBookmark ? C.gold : '#2a2d3a'}`, cursor:'pointer' }}>
                  {filterBookmark ? '★' : '☆'} Bookmarked
                </button>

                {/* Sort + View on right */}
                <div style={{ marginLeft:'auto', display:'flex', gap:8 }}>
                  <select value={sortBy} onChange={e=>setSortBy(e.target.value)} style={sel}>
                    <option value="score">Sort: Best Match</option>
                    <option value="date">Sort: Date</option>
                    <option value="title">Sort: A–Z</option>
                    <option value="genre">Sort: Genre</option>
                  </select>

                  {/* View toggle */}
                  <div style={{ display:'flex', background:'#1a1d28', border:`1px solid #2a2d3a`, borderRadius:6, overflow:'hidden' }}>
                    {[['grid','⊞'],['timeline','≡']].map(([v,icon])=>(
                      <button key={v} onClick={()=>setView(v)}
                        style={{ background: view===v ? C.goldFaint : 'none', color: view===v ? C.gold : C.dim, border:'none', padding:'8px 13px', cursor:'pointer', fontSize:15, transition:'all 0.15s' }}
                        title={v==='grid'?'Grid view':'Timeline view'}>
                        {icon}
                      </button>
                    ))}
                  </div>

                  <button onClick={exportCSV}
                    style={{ ...sel, cursor:'pointer', whiteSpace:'nowrap' }}>
                    ↓ Export
                  </button>
                </div>
              </div>

              {/* Active filters + result count */}
              <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', flexWrap:'wrap', gap:8 }}>
                <span style={{ fontSize:13, color:C.dim }}>
                  Showing <strong style={{ color:C.text }}>{filtered.length}</strong> of {opportunities.length} opportunities
                </span>
                {hasFilters && (
                  <button onClick={clearFilters}
                    style={{ background:'none', border:'none', color:C.orange, fontSize:12, cursor:'pointer', fontFamily:'inherit', textDecoration:'underline' }}>
                    Clear all filters
                  </button>
                )}
              </div>
            </div>

            {/* ── Results ── */}
            {filtered.length === 0 ? (
              <div style={{ textAlign:'center', padding:'60px 20px', color:C.dim }}>
                <div style={{ fontSize:32, marginBottom:12, opacity:0.3 }}>🔍</div>
                <div style={{ fontSize:15, marginBottom:8, color:C.muted }}>No results match your filters</div>
                <button onClick={clearFilters} style={{ background:'none', border:'none', color:C.gold, cursor:'pointer', fontSize:13, fontFamily:'inherit', textDecoration:'underline' }}>Clear filters</button>
              </div>
            ) : view === 'timeline' ? (
              <TimelineView opportunities={filtered} bookmarks={bookmarks} onToggleBookmark={toggleBookmark} onSelect={setSelected} />
            ) : (
              <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill,minmax(290px,1fr))', gap:14 }}>
                {filtered.map(opp=>(
                  <OpportunityCard key={opp.id} opp={opp}
                    isBookmarked={bookmarks.has(opp.id)}
                    onToggleBookmark={toggleBookmark}
                    onClick={()=>setSelected(opp)} />
                ))}
              </div>
            )}
          </>
        )}
      </main>

      {/* Detail modal */}
      {selectedOpp && (
        <DetailModal
          opp={selectedOpp}
          onClose={()=>setSelected(null)}
          isBookmarked={bookmarks.has(selectedOpp.id)}
          onToggleBookmark={()=>toggleBookmark(selectedOpp.id)}
        />
      )}
    </div>
  )
}
