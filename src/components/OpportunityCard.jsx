import React from 'react'

const C = {
  surface:'#13151c', border:'#1e2130', gold:'#e8c96a',
  goldFaint:'rgba(232,201,106,0.12)', goldBorder:'rgba(232,201,106,0.25)',
  text:'#e8e4dc', muted:'#9ca3af', dim:'#6b7280', dimmer:'#4b5563', bg:'#0d0f14',
  green:'#00c896', orange:'#f5a623', red:'#e05555',
}

const scoreColor = (s) => {
  if (s >= 75) return { bg:'#00c896', text:'#003d2e', bar:'#00c896' }
  if (s >= 45) return { bg:'#f5a623', text:'#3d2800', bar:'#f5a623' }
  return { bg:'#e05555', text:'#fff', bar:'#e05555' }
}

export default function OpportunityCard({ opp, isBookmarked, onToggleBookmark, onClick }) {
  const sc = scoreColor(opp.icp_score)

  const eventDate = opp.date ? new Date(opp.date) : null
  const daysUntil = eventDate ? Math.ceil((eventDate - new Date()) / (1000*60*60*24)) : null
  const statusTag = daysUntil !== null
    ? daysUntil < 0   ? null
    : daysUntil < 60  ? { label:'Coming Soon', color:C.orange }
    : daysUntil < 180 ? { label:'This Year',   color:C.green  }
    : null
    : null

  const hasContact = !!(opp.contact_email || opp.contact_phone)

  return (
    <div onClick={onClick}
      style={{ background:C.surface, border:`1px solid ${C.border}`, borderRadius:12, padding:18, display:'flex', flexDirection:'column', gap:10, cursor:'pointer', transition:'border-color 0.15s, transform 0.15s', position:'relative', overflow:'hidden' }}
      onMouseEnter={e=>{ e.currentTarget.style.borderColor=C.gold; e.currentTarget.style.transform='translateY(-2px)' }}
      onMouseLeave={e=>{ e.currentTarget.style.borderColor=C.border; e.currentTarget.style.transform='translateY(0)' }}>

      {/* Score bar at top */}
      <div style={{ position:'absolute', top:0, left:0, right:0, height:3, background:'#1e2130' }}>
        <div style={{ height:'100%', width:`${opp.icp_score}%`, background:sc.bar }} />
      </div>

      {/* Score + bookmark */}
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginTop:6 }}>
        <div style={{ background:sc.bg, color:sc.text, borderRadius:20, padding:'3px 11px', fontSize:11, fontWeight:'bold' }}>
          {opp.icp_score}% match
        </div>
        <button onClick={e=>{ e.stopPropagation(); onToggleBookmark(opp.id) }}
          style={{ background:'none', border:'none', cursor:'pointer', fontSize:17, color: isBookmarked ? C.gold : C.dimmer, padding:'2px 4px', lineHeight:1 }}>
          {isBookmarked ? '★' : '☆'}
        </button>
      </div>

      {/* Tags */}
      <div style={{ display:'flex', gap:6, flexWrap:'wrap' }}>
        {opp.genre   && <span style={{ fontSize:10, color:C.gold, background:C.goldFaint, border:`1px solid ${C.goldBorder}`, borderRadius:4, padding:'2px 8px' }}>{opp.genre}</span>}
        {statusTag   && <span style={{ fontSize:10, color:statusTag.color, background:'rgba(255,255,255,0.04)', border:`1px solid ${statusTag.color}40`, borderRadius:4, padding:'2px 8px' }}>{statusTag.label}</span>}
        {hasContact  && <span style={{ fontSize:10, color:C.green, background:'rgba(0,200,150,0.08)', border:'1px solid rgba(0,200,150,0.2)', borderRadius:4, padding:'2px 8px' }}>Has Contact</span>}
        {opp.fee     && <span style={{ fontSize:10, color:C.orange, background:'rgba(245,166,35,0.08)', border:'1px solid rgba(245,166,35,0.2)', borderRadius:4, padding:'2px 8px' }}>Fee Listed</span>}
      </div>

      {/* Title + org */}
      <div>
        <h3 style={{ margin:'0 0 3px', fontSize:14, color:C.text, lineHeight:1.4 }}>{opp.title || 'Untitled Engagement'}</h3>
        {opp.organization && <div style={{ fontSize:12, color:C.muted, fontStyle:'italic' }}>{opp.organization}</div>}
      </div>

      {/* Meta */}
      <div style={{ display:'flex', flexDirection:'column', gap:3 }}>
        {opp.date     && <span style={{ fontSize:12, color:C.muted }}>📅 {opp.date}</span>}
        {opp.location && <span style={{ fontSize:12, color:C.muted }}>📍 {opp.location}</span>}
        {opp.format   && <span style={{ fontSize:12, color:C.muted }}>🎤 {opp.format}</span>}
        {opp.fee      && <span style={{ fontSize:12, color:C.gold  }}>💰 {opp.fee}</span>}
      </div>

      <div style={{ fontSize:11, color:C.dimmer, marginTop:'auto', paddingTop:8, borderTop:`1px solid ${C.border}` }}>
        Click to view full details →
      </div>
    </div>
  )
}
