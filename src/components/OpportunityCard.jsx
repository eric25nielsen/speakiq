import React from 'react'

const C = {
  surface:'#13151c', border:'#1e2130', gold:'#e8c96a',
  goldFaint:'rgba(232,201,106,0.12)', text:'#e8e4dc',
  muted:'#9ca3af', dim:'#6b7280', dimmer:'#4b5563', bg:'#0d0f14',
}

const scoreColor = (s) => {
  if (s >= 75) return { bg:'#00c896', text:'#003d2e' }
  if (s >= 45) return { bg:'#f5a623', text:'#3d2800' }
  return { bg:'#e05555', text:'#fff' }
}

export default function OpportunityCard({ opp, interaction, onInteract }) {
  const sc = scoreColor(opp.icp_score)

  const statusColors = {
    interested: { bg:'rgba(0,200,150,0.12)', border:'#00c896', color:'#00c896' },
    pass:       { bg:'rgba(224,85,85,0.12)',  border:'#e05555', color:'#e05555' },
    pending:    { bg:'transparent',           border:C.border,  color:C.dim    },
  }
  const status = interaction?.status || 'pending'
  const st = statusColors[status]

  return (
    <div style={{ background:C.surface, border:`1px solid ${st.border}`, borderRadius:12, padding:20, display:'flex', flexDirection:'column', gap:10, transition:'border-color 0.2s' }}>
      {/* Score + genre */}
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', flexWrap:'wrap', gap:6 }}>
        <div style={{ background:sc.bg, color:sc.text, borderRadius:20, padding:'3px 12px', fontSize:12, fontWeight:'bold' }}>
          {opp.icp_score}% ICP match
        </div>
        {opp.genre && (
          <span style={{ fontSize:11, color:C.gold, background:C.goldFaint, border:`1px solid rgba(232,201,106,0.2)`, borderRadius:4, padding:'2px 8px' }}>
            {opp.genre}
          </span>
        )}
      </div>

      {/* Title + org */}
      <h3 style={{ margin:0, fontSize:15, color:C.text, lineHeight:1.4 }}>{opp.title || 'Untitled Engagement'}</h3>
      {opp.organization && <div style={{ fontSize:13, color:C.muted, fontStyle:'italic' }}>{opp.organization}</div>}

      {/* Meta */}
      <div style={{ display:'flex', flexDirection:'column', gap:4 }}>
        {opp.date     && <span style={{ fontSize:13, color:C.muted }}>📅 {opp.date}</span>}
        {opp.location && <span style={{ fontSize:13, color:C.muted }}>📍 {opp.location}</span>}
        {opp.format   && <span style={{ fontSize:13, color:C.muted }}>🎤 {opp.format}</span>}
        {opp.audience && <span style={{ fontSize:13, color:C.muted }}>👥 {opp.audience}</span>}
        {opp.fee      && <span style={{ fontSize:13, color:C.gold  }}>💰 {opp.fee}</span>}
      </div>

      {/* Contact */}
      {(opp.contact_name || opp.contact_email || opp.contact_phone) && (
        <div style={{ background:C.bg, borderRadius:6, padding:'8px 12px', fontSize:12, color:C.muted, lineHeight:1.6 }}>
          <div style={{ fontSize:10, textTransform:'uppercase', letterSpacing:'0.08em', color:C.dimmer, marginBottom:4 }}>Contact</div>
          {opp.contact_name  && <div style={{ color:C.text, fontWeight:'bold' }}>{opp.contact_name}</div>}
          {opp.contact_email && <div>{opp.contact_email}</div>}
          {opp.contact_phone && <div>{opp.contact_phone}</div>}
        </div>
      )}

      {/* Details */}
      {opp.details && (
        <p style={{ margin:0, fontSize:12, color:C.dim, lineHeight:1.6, borderTop:`1px solid ${C.border}`, paddingTop:10 }}>
          {opp.details.slice(0,220)}{opp.details.length>220?'…':''}
        </p>
      )}

      {/* Interaction buttons */}
      {onInteract && (
        <div style={{ display:'flex', gap:8, paddingTop:4 }}>
          <button onClick={()=>onInteract(opp.id,'interested')}
            style={{ flex:1, background: status==='interested' ? 'rgba(0,200,150,0.18)' : '#0d0f14', color: status==='interested' ? '#00c896' : C.dim, border:`1px solid ${status==='interested'?'#00c896':C.border}`, borderRadius:6, padding:'7px 0', cursor:'pointer', fontSize:12, fontFamily:'inherit', fontWeight: status==='interested'?'bold':'normal', transition:'all 0.15s' }}>
            ✓ Interested
          </button>
          <button onClick={()=>onInteract(opp.id,'pass')}
            style={{ flex:1, background: status==='pass' ? 'rgba(224,85,85,0.18)' : '#0d0f14', color: status==='pass' ? '#e05555' : C.dim, border:`1px solid ${status==='pass'?'#e05555':C.border}`, borderRadius:6, padding:'7px 0', cursor:'pointer', fontSize:12, fontFamily:'inherit', fontWeight: status==='pass'?'bold':'normal', transition:'all 0.15s' }}>
            ✕ Pass
          </button>
        </div>
      )}
    </div>
  )
}
