// api/cron-scan.js
// Called by Vercel cron on the 1st of each month
// Scans for new calendar emails and saves as "pending" in Supabase
// Then emails the syncer user(s) to review and import

const Anthropic = require('@anthropic-ai/sdk')
const { createClient } = require('@supabase/supabase-js')

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY  // service key for server-side writes
)

const SENDER = 'jenniferspeakersclubrep@gmail.com'
const SUBJECT_KEYWORD = 'Accept your invitation to join shared calendar'

module.exports = async function handler(req, res) {
  // Vercel cron passes Authorization header — verify it
  if (req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

  const now = new Date()
  const monthLabel = now.toLocaleString('default', { month: 'long' }) + now.getFullYear()

  try {
    // 1. Search Gmail for new calendar invite
    const msg = await client.messages.create({
      model: 'claude-sonnet-4-5',
      max_tokens: 1000,
      system: `Search Gmail for the most recent email FROM "${SENDER}" with subject containing "${SUBJECT_KEYWORD}" received in the last 45 days.
Return ONLY a raw JSON object with:
- found: true/false
- subject: full subject line
- from: sender email
- date: when received
- calendarName: calendar name from subject (e.g. May2026)
- icalUrl: webcal:// or https://calendar.google.com/calendar/ical/... URL from email body
- embedUrl: any embed URL from email body
If not found return {"found": false}`,
      messages: [{ role: 'user', content: 'Find the latest speaking calendar invite email.' }],
      mcp_servers: [{ type: 'url', url: 'https://gmailmcp.googleapis.com/mcp/v1', name: 'gmail-mcp' }]
    })

    const text = msg.content.filter(b => b.type === 'text').map(b => b.text).join('')
    let emailData = null
    try { const m = text.match(/\{[\s\S]*\}/); if (m) emailData = JSON.parse(m[0]) } catch {}

    if (!emailData?.found) {
      // Save "no email found" status
      await supabase.from('pending_syncs').insert({
        month_label: monthLabel,
        status: 'no_email',
        email_subject: null,
        email_from: null,
        email_date: null,
        calendar_name: null,
        ical_url: null,
        created_at: new Date().toISOString()
      })
      return res.status(200).json({ message: 'No new email found', monthLabel })
    }

    // 2. Save as pending sync for syncer to review
    await supabase.from('pending_syncs').upsert({
      month_label: emailData.calendarName || monthLabel,
      status: 'pending',
      email_subject: emailData.subject,
      email_from: emailData.from,
      email_date: emailData.date,
      calendar_name: emailData.calendarName || monthLabel,
      ical_url: emailData.icalUrl || emailData.embedUrl,
      created_at: new Date().toISOString()
    }, { onConflict: 'month_label' })

    return res.status(200).json({ 
      message: 'Pending sync saved', 
      calendar: emailData.calendarName,
      monthLabel 
    })

  } catch(e) {
    return res.status(500).json({ error: e.message })
  }
}
