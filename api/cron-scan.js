// api/cron-scan.js
// Runs automatically on the 1st of every month at 9am (see vercel.json)
// Finds Jennifer's latest calendar email → fetches events → imports to DB → sends notification

const Anthropic = require('@anthropic-ai/sdk')
const { createClient } = require('@supabase/supabase-js')

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
)

const SENDER          = 'jenniferspeakersclubrep@gmail.com'
const SUBJECT_KEYWORD = 'Accept your invitation to join shared calendar'
const ICAL_BASE       = 'https://calendar.google.com/calendar/ical/'
const ICAL_SUFFIX     = '/public/basic.ics'
const ALL_GENRES      = ['Leadership','Business','Healthcare','Technology','Education','Finance','Entrepreneurship','Sales','Mental Health','Nonprofit','Government','Real Estate','HR & Talent','Marketing','Wellness','Legal']

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
  if (o.genre)                            s += 70
  if (o.contactEmail || o.contact_email)  s += 15
  if (o.location)                         s += 10
  if (o.fee)                              s += 5
  return s
}

// Email notifications removed — status visible in Syncer dashboard

// ── Email templates ────────────────────────────────────────────────────────
const successEmail = ({ calendarName, count, highMatch, month, appUrl }) => ({
  subject: `✅ SpeakIQ: ${count} speaking opportunities loaded for ${month}`,
  html: `
    <div style="font-family:Georgia,serif;max-width:560px;margin:0 auto;background:#0d0f14;color:#e8e4dc;padding:32px;border-radius:12px">
      <div style="margin-bottom:24px">
        <span style="background:linear-gradient(135deg,#c9a84c,#e8c96a);color:#0d0f14;font-weight:bold;font-size:18px;padding:6px 14px;border-radius:6px">SpeakIQ</span>
      </div>
      <h2 style="color:#00c896;font-weight:normal;margin:0 0 8px">✅ Monthly calendar imported successfully</h2>
      <p style="color:#9ca3af;font-size:14px;line-height:1.7;margin:0 0 24px">
        The <strong style="color:#e8e4dc">${calendarName}</strong> speaking calendar has been automatically imported and is now live for your whole team.
      </p>
      <div style="display:flex;gap:16px;margin-bottom:24px">
        <div style="background:#13151c;border:1px solid #1e2130;border-radius:8px;padding:14px 20px;flex:1;text-align:center">
          <div style="font-size:28px;font-weight:bold;color:#e8e4dc">${count}</div>
          <div style="font-size:11px;color:#6b7280;text-transform:uppercase;letter-spacing:0.08em">Total Events</div>
        </div>
        <div style="background:#13151c;border:1px solid #1e2130;border-radius:8px;padding:14px 20px;flex:1;text-align:center">
          <div style="font-size:28px;font-weight:bold;color:#e8c96a">${highMatch}</div>
          <div style="font-size:11px;color:#6b7280;text-transform:uppercase;letter-spacing:0.08em">High ICP Match</div>
        </div>
      </div>
      <a href="${appUrl}" style="display:block;background:linear-gradient(135deg,#c9a84c,#e8c96a);color:#0d0f14;text-decoration:none;text-align:center;padding:14px;border-radius:8px;font-weight:bold;font-size:15px">
        View Opportunities →
      </a>
      <p style="color:#4b5563;font-size:11px;margin-top:20px;text-align:center">
        Auto-imported on the 1st of ${month} · SpeakIQ
      </p>
    </div>
  `
})

const failureEmail = ({ month, reason, appUrl }) => ({
  subject: `⚠️ SpeakIQ: No calendar found for ${month} — action needed`,
  html: `
    <div style="font-family:Georgia,serif;max-width:560px;margin:0 auto;background:#0d0f14;color:#e8e4dc;padding:32px;border-radius:12px">
      <div style="margin-bottom:24px">
        <span style="background:linear-gradient(135deg,#c9a84c,#e8c96a);color:#0d0f14;font-weight:bold;font-size:18px;padding:6px 14px;border-radius:6px">SpeakIQ</span>
      </div>
      <h2 style="color:#f5a623;font-weight:normal;margin:0 0 8px">⚠️ No calendar email found for ${month}</h2>
      <p style="color:#9ca3af;font-size:14px;line-height:1.7;margin:0 0 20px">
        The automatic scan ran this morning but couldn't find a new calendar invitation email from Jennifer. The previous month's opportunities are still showing for your team.
      </p>
      <div style="background:#13151c;border:1px solid #f5a62340;border-radius:8px;padding:14px 16px;margin-bottom:24px">
        <div style="font-size:11px;color:#6b7280;text-transform:uppercase;letter-spacing:0.08em;margin-bottom:6px">Reason</div>
        <div style="font-size:13px;color:#9ca3af">${reason}</div>
      </div>
      <p style="color:#9ca3af;font-size:13px;line-height:1.7;margin:0 0 20px">
        <strong style="color:#e8e4dc">What to do:</strong> Log in to SpeakIQ, go to the Syncer, and either trigger a manual scan or paste the calendar URL from Jennifer's email directly.
      </p>
      <a href="${appUrl}" style="display:block;background:linear-gradient(135deg,#c9a84c,#e8c96a);color:#0d0f14;text-decoration:none;text-align:center;padding:14px;border-radius:8px;font-weight:bold;font-size:15px">
        Open Syncer →
      </a>
      <p style="color:#4b5563;font-size:11px;margin-top:20px;text-align:center">
        Auto-scan ran on the 1st of ${month} · SpeakIQ
      </p>
    </div>
  `
})

// ── Main handler ───────────────────────────────────────────────────────────
module.exports = async function handler(req, res) {
  if (req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  const client   = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  const now      = new Date()
  const month    = now.toLocaleString('default', { month: 'long', year: 'numeric' })
  const monthKey = now.toLocaleString('default', { month: 'long' }) + now.getFullYear()
  const appUrl   = process.env.APP_URL || 'https://speakiq.vercel.app'

  console.log(`[SpeakIQ Cron] Starting auto-import for ${month}`)

  try {
    // ── Step 1: Find Jennifer's latest email ──────────────────────────────
    console.log('[SpeakIQ Cron] Scanning Gmail...')
    const emailMsg = await client.messages.create({
      model: 'claude-sonnet-4-5',
      max_tokens: 1000,
      system: `Search Gmail for the most recent email FROM "${SENDER}" with subject containing "${SUBJECT_KEYWORD}" received in the last 45 days.
Return ONLY a raw JSON object (no markdown) with:
- found: true/false
- subject: full subject line
- calendarName: calendar name from subject (e.g. May2026)
- icalUrl: the webcal:// or https://calendar.google.com/calendar/ical/... URL from email body
- embedUrl: any embed URL from email body
If not found, return {"found":false,"reason":"no matching email in last 45 days"}`,
      messages: [{ role:'user', content:'Find the latest speaking calendar invite from Jennifer.' }],
      mcp_servers: [{ type:'url', url:'https://gmailmcp.googleapis.com/mcp/v1', name:'gmail-mcp' }]
    })

    const emailText = emailMsg.content.filter(b=>b.type==='text').map(b=>b.text).join('')
    let emailData = null
    try { const m = emailText.match(/\{[\s\S]*\}/); if (m) emailData = JSON.parse(m[0]) } catch {}

    if (!emailData?.found) {
      const reason = emailData?.reason || `No email found from ${SENDER} in the last 45 days`
      console.log(`[SpeakIQ Cron] No email found: ${reason}`)

      // Log to pending_syncs
      await supabase.from('pending_syncs').insert({
        month_label: monthKey, status: 'no_email',
        email_from: SENDER, email_date: now.toISOString(),
        calendar_name: null, ical_url: null,
        created_at: now.toISOString()
      })

      // Send failure notification
      const tmpl = failureEmail({ month, reason, appUrl })
          return res.status(200).json({ success: false, reason, month })
    }

    console.log(`[SpeakIQ Cron] Found calendar: ${emailData.calendarName}`)

    // ── Step 2: Fetch iCal ────────────────────────────────────────────────
    const rawUrl  = emailData.icalUrl || emailData.embedUrl
    const icalUrl = extractIcalUrl(rawUrl)
    if (!icalUrl) throw new Error('Could not parse calendar URL from email')

    const fetchUrl  = icalUrl.replace(/^webcal:\/\//i, 'https://')
    const icalResp  = await fetch(fetchUrl, { headers:{ 'User-Agent':'SpeakIQ/1.0' }, signal:AbortSignal.timeout(15000) })
    if (!icalResp.ok) throw new Error(`Calendar URL returned ${icalResp.status}`)
    const icalText  = await icalResp.text()
    if (!icalText.includes('BEGIN:VCALENDAR')) throw new Error('URL did not return valid iCal data')

    console.log('[SpeakIQ Cron] iCal fetched — parsing events...')

    // ── Step 3: Parse events with Claude ─────────────────────────────────
    const parseMsg = await client.messages.create({
      model: 'claude-sonnet-4-5',
      max_tokens: 4000,
      system: `Parse iCal data and extract every VEVENT. The real event date, location, contact, and details are inside each DESCRIPTION field — NOT in DTSTART/DTEND.
Return ONLY a raw JSON array (no markdown) where each object has:
title, date (from DESCRIPTION), location, contactName, contactEmail, contactPhone, genre (from: ${ALL_GENRES.join(', ')}), audience, fee, format, organization, details (full DESCRIPTION text verbatim).
Use null for unknowns. Return [] if empty.`,
      messages: [{ role:'user', content:`Parse this iCal data:\n\n${icalText.slice(0, 16000)}` }]
    })

    const parseText = parseMsg.content.filter(b=>b.type==='text').map(b=>b.text).join('')
    let opps = []
    try { const m = parseText.match(/\[[\s\S]*\]/); if (m) opps = JSON.parse(m[0]) } catch {}

    console.log(`[SpeakIQ Cron] Parsed ${opps.length} events`)

    // ── Step 4: Save to database ──────────────────────────────────────────
    const calendarName = emailData.calendarName || monthKey
    const rows = opps.map(o => ({
      title:          o.title         || null,
      date:           o.date          || null,
      location:       o.location      || null,
      contact_name:   o.contactName   || null,
      contact_email:  o.contactEmail  || null,
      contact_phone:  o.contactPhone  || null,
      genre:          o.genre         || null,
      audience:       o.audience      || null,
      fee:            o.fee           || null,
      format:         o.format        || null,
      organization:   o.organization  || null,
      details:        o.details       || null,
      icp_score:      scoreOpp(o),
      calendar_month: calendarName,
    }))

    await supabase.from('opportunities').delete().eq('calendar_month', calendarName)
    if (rows.length > 0) await supabase.from('opportunities').insert(rows)

    // Log to pending_syncs as auto-imported
    await supabase.from('pending_syncs').upsert({
      month_label:  calendarName,
      status:       'imported',
      email_subject: emailData.subject,
      email_from:   SENDER,
      email_date:   now.toISOString(),
      calendar_name: calendarName,
      ical_url:     rawUrl,
      imported_at:  now.toISOString(),
      event_count:  rows.length,
      created_at:   now.toISOString()
    }, { onConflict: 'month_label' })

    console.log(`[SpeakIQ Cron] Saved ${rows.length} opportunities`)

    // ── Step 5: Send success notification ────────────────────────────────
    const highMatch = rows.filter(r => r.icp_score >= 75).length
    const tmpl = successEmail({ calendarName, count: rows.length, highMatch, month, appUrl })
      console.log(`[SpeakIQ Cron] Done. Notification sent to ${NOTIFY_EMAIL}`)
    return res.status(200).json({ success: true, count: rows.length, highMatch, calendarName })

  } catch(e) {
    console.error(`[SpeakIQ Cron] Error: ${e.message}`)

    const tmpl = failureEmail({ month, reason: e.message, appUrl })
      await supabase.from('pending_syncs').insert({
      month_label: monthKey, status: 'no_email',
      email_from: SENDER, email_date: now.toISOString(),
      calendar_name: null, ical_url: null,
      created_at: now.toISOString()
    }).then(() => {})

    return res.status(500).json({ error: e.message })
  }
}
