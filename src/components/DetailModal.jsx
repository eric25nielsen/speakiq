import React, { useEffect } from 'react'

const C = {
  bg:'#0d0f14', surface:'#13151c', surface2:'#181b24', border:'#1e2130',
  gold:'#e8c96a', goldFaint:'rgba(232,201,106,0.12)', goldBorder:'rgba(232,201,106,0.25)',
  text:'#e8e4dc', muted:'#9ca3af', dim:'#6b7280', dimmer:'#4b5563',
  green:'#00c896', greenFaint:'rgba(0,200,150,0.12)',
  orange:'#f5a623', red:'#e05555',
}

const scoreColor = (s) => {
  if (s >= 75) return { bg:'#00c896', text:'#003d2e' }
  if (s >= 45) return { bg:'#f5a623', text:'#3d2800' }
  return { bg:'#e05555', text:'#fff' }
}

const ScoreBar = ({ label, points, max, earned }) => (
  <div style={{ marginBottom:10 }}>
    <div style={{ display:'flex', justifyContent:'space-between', marginBottom:4 }}>
      <span style={{ fontSize:12, color: earned ? C.text : C.dimmer }}>{label}</span>
      <span style={{ fontSize:12, color: earned ? C.gold : C.dimmer, fontFamily:'monospace' }}>
        {earned ? `+${points}` : `+0`} / {max}pts
      </span>
    </div>
    <div style={{ height:4, background:'#1e2130', borderRadius:2, overflow:'hidden' }}>
      <div style={{ height:'100%', width: earned ? '100%' : '0%', background: earned ? C.gold : C.dimmer, borderRadius:2, transition:'width 0.4s' }} />
    </div>
  </div>
)

const copyToClipboard = (text, setCopied) => {
  navigator.clipboard.writeText(text).then(() => {
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  })
}

export default function DetailModal({ opp, onClose, isBookmarked, onToggleBookmark }) {
  const [copiedEmail, setCopiedEmail] = React.useState(false)
  const [copiedPhone, setCopiedPhone] = React.useState(false)
  const [copiedAll,   setCopiedAll]   = React.useState(false)

  useEffect(() => {
    const handleKey = (e) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', handleKey)
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', handleKey)
      document.body.style.overflow = ''
    }
  }, [onClose])

  const sc = scoreColor(opp.icp_score)

  const genreMatch   = opp.icp_score >= 70
  const hasContact   = !!(opp.contact_email || opp.contact_phone)
  const hasLocation  = !!opp.location
  const hasFee       = !!opp.fee

  const copyAll = () => {
    const text = [
      opp.title, opp.organization,
      opp.date, opp.location,
      opp.contact_name, opp.contact_email, opp.contact_phone,
      opp.format, opp.audience, opp.fee,
      opp.details
    ].filter(Boolean).join('\n')
    copyToClipboard(text, setCopiedAll)
  }

  // Status tag
  const eventDate = opp.date ? new Date(opp.date) : null
  const daysUntil = eventDate ? Math.ceil((eventDate - new Date()) / (1000*60*60*24)) : null
  const statusTag = daysUntil !== null
    ? daysUntil < 0    ? { label:'Past',        color:'#4b5563' }
    : daysUntil < 60   ? { label:'Coming Soon',  color:C.orange }
    : daysUntil < 180  ? { label:'This Year',    color:C.green  }
    : { label:'Future',      color:C.dim    }
    : null

  return (
    <div onClick={onClose} style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.75)', zIndex:1000, display:'flex', alignItems:'center', justifyContent:'center', padding:'20px', backdropFilter:'blur(4px)' }}>
      <div onClick={e=>e.stopPropagation()} style={{ background:C.surface, border:`1px solid ${C.border}`, borderRadius:16, width:'100%', maxWidth:680, maxHeight:'90vh', overflow:'hidden', display:'flex', flexDirection:'column' }}>

        {/* Modal header */}
        <div style={{ padding:'20px 24px', borderBottom:`1px solid ${C.border}`, display:'flex', alignItems:'flex-start', justifyContent:'space-between', gap:12 }}>
          <div style={{ flex:1 }}>
            <div style={{ display:'flex', gap:8, flexWrap:'wrap', marginBottom:10 }}>
              <div style={{ background:sc.bg, color:sc.text, borderRadius:20, padding:'3px 12px', fontSize:12, fontWeight:'bold' }}>{opp.icp_score}% ICP match</div>
              {opp.genre && <span style={{ fontSize:11, color:C.gold, background:C.goldFaint, border:`1px solid ${C.goldBorder}`, borderRadius:4, padding:'2px 10px' }}>{opp.genre}</span>}
              {statusTag && <span style={{ fontSize:11, color:statusTag.color, background:'rgba(255,255,255,0.05)', border:`1px solid ${statusTag.color}40`, borderRadius:4, padding:'2px 10px' }}>{statusTag.label}</span>}
            </div>
            <h2 style={{ margin:0, fontSize:20, color:C.text, lineHeight:1.3 }}>{opp.title || 'Untitled Engagement'}</h2>
            {opp.organization && <div style={{ fontSize:14, color:C.muted, marginTop:4, fontStyle:'italic' }}>{opp.organization}</div>}
          </div>
          <div style={{ display:'flex', gap:8, flexShrink:0 }}>
            <button onClick={onToggleBookmark} title={isBookmarked ? 'Remove bookmark' : 'Bookmark'}
              style={{ background: isBookmarked ? C.goldFaint : '#0d0f14', border:`1px solid ${isBookmarked ? C.gold : C.border}`, borderRadius:8, padding:'8px 10px', cursor:'pointer', fontSize:16, color: isBookmarked ? C.gold : C.dim }}>
              {isBookmarked ? '★' : '☆'}
            </button>
            <button onClick={copyAll} title="Copy all details"
              style={{ background:'#0d0f14', border:`1px solid ${C.border}`, borderRadius:8, padding:'8px 12px', cursor:'pointer', fontSize:12, color: copiedAll ? C.green : C.dim, fontFamily:'inherit' }}>
              {copiedAll ? '✓ Copied' : '⎘ Copy All'}
            </button>
            <button onClick={onClose} style={{ background:'#0d0f14', border:`1px solid ${C.border}`, borderRadius:8, padding:'8px 12px', cursor:'pointer', fontSize:18, color:C.dim, lineHeight:1 }}>×</button>
          </div>
        </div>

        {/* Scrollable body */}
        <div style={{ overflowY:'auto', padding:'20px 24px', display:'flex', flexDirection:'column', gap:16 }}>

          {/* Key details grid */}
          <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill,minmax(180px,1fr))', gap:10 }}>
            {[
              { icon:'📅', label:'Date',     val:opp.date },
              { icon:'📍', label:'Location', val:opp.location },
              { icon:'🎤', label:'Format',   val:opp.format },
              { icon:'👥', label:'Audience', val:opp.audience },
              { icon:'💰', label:'Fee',      val:opp.fee },
              { icon:'🏢', label:'Org',      val:opp.organization },
            ].filter(f=>f.val).map(f=>(
              <div key={f.label} style={{ background:'#0d0f14', borderRadius:8, padding:'10px 14px' }}>
                <div style={{ fontSize:11, color:C.dimmer, textTransform:'uppercase', letterSpacing:'0.07em', marginBottom:4 }}>{f.icon} {f.label}</div>
                <div style={{ fontSize:13, color:C.text }}>{f.val}</div>
              </div>
            ))}
          </div>

          {/* Contact info */}
          {(opp.contact_name || opp.contact_email || opp.contact_phone) && (
            <div style={{ background:'#0d0f14', borderRadius:10, padding:'14px 16px' }}>
              <div style={{ fontSize:11, color:C.dimmer, textTransform:'uppercase', letterSpacing:'0.07em', marginBottom:10 }}>Contact Information</div>
              {opp.contact_name && <div style={{ fontSize:15, color:C.text, fontWeight:'bold', marginBottom:8 }}>{opp.contact_name}</div>}
              <div style={{ display:'flex', flexWrap:'wrap', gap:8 }}>
                {opp.contact_email && (
                  <button onClick={()=>copyToClipboard(opp.contact_email, setCopiedEmail)}
                    style={{ background: copiedEmail ? C.greenFaint : C.surface, border:`1px solid ${copiedEmail ? C.green : C.border}`, borderRadius:6, padding:'7px 14px', cursor:'pointer', fontSize:13, color: copiedEmail ? C.green : C.muted, fontFamily:'inherit', display:'flex', gap:6, alignItems:'center' }}>
                    {copiedEmail ? '✓' : '⎘'} {opp.contact_email}
                  </button>
                )}
                {opp.contact_phone && (
                  <button onClick={()=>copyToClipboard(opp.contact_phone, setCopiedPhone)}
                    style={{ background: copiedPhone ? C.greenFaint : C.surface, border:`1px solid ${copiedPhone ? C.green : C.border}`, borderRadius:6, padding:'7px 14px', cursor:'pointer', fontSize:13, color: copiedPhone ? C.green : C.muted, fontFamily:'inherit', display:'flex', gap:6, alignItems:'center' }}>
                    {copiedPhone ? '✓' : '⎘'} {opp.contact_phone}
                  </button>
                )}
              </div>
            </div>
          )}

          {/* Full details */}
          {opp.details && (
            <div style={{ background:'#0d0f14', borderRadius:10, padding:'14px 16px' }}>
              <div style={{ fontSize:11, color:C.dimmer, textTransform:'uppercase', letterSpacing:'0.07em', marginBottom:10 }}>Full Details</div>
              <p style={{ margin:0, fontSize:13, color:C.muted, lineHeight:1.8, whiteSpace:'pre-wrap' }}>{opp.details}</p>
            </div>
          )}

          {/* ICP Score breakdown */}
          <div style={{ background:'#0d0f14', borderRadius:10, padding:'14px 16px' }}>
            <div style={{ fontSize:11, color:C.dimmer, textTransform:'uppercase', letterSpacing:'0.07em', marginBottom:12 }}>ICP Score Breakdown</div>
            <ScoreBar label="Genre / Industry Match" points={70} max={70} earned={genreMatch} />
            <ScoreBar label="Contact Info Present"   points={15} max={15} earned={hasContact} />
            <ScoreBar label="Location Specified"     points={10} max={10} earned={hasLocation} />
            <ScoreBar label="Fee / Honorarium Listed" points={5} max={5}  earned={hasFee} />
            <div style={{ marginTop:12, paddingTop:12, borderTop:`1px solid ${C.border}`, display:'flex', justifyContent:'space-between' }}>
              <span style={{ fontSize:13, color:C.muted }}>Total Score</span>
              <span style={{ fontSize:15, fontWeight:'bold', color:sc.bg }}>{opp.icp_score} / 100</span>
            </div>
          </div>

        </div>
      </div>
    </div>
  )
}
