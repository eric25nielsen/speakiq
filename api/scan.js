// api/scan.js  — Vercel Serverless Function
// Runs on the SERVER so no CORS issues fetching iCal URLs

const Anthropic = require('@anthropic-ai/sdk')

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const { url, icpGenres = [], calendarMonth = '' } = req.body || {}
  if (!url) return res.status(400).json({ error: 'url is required' })

  // 1. Fetch the iCal file server-side
  let icalText
  try {
    const fetchUrl = url.replace(/^webcal:\/\//i, 'https://')
    const response = await fetch(fetchUrl, {
      headers: { 'User-Agent': 'SpeakIQ/1.0' },
      signal: AbortSignal.timeout(15000),
    })
    if (!response.ok) return res.status(400).json({ error: `Calendar URL returned ${response.status}` })
    icalText = await response.text()
  } catch (e) {
    return res.status(400).json({ error: `Failed to fetch calendar: ${e.message}` })
  }

  if (!icalText.includes('BEGIN:VCALENDAR')) {
    return res.status(400).json({ error: 'URL did not return valid iCal data. Make sure it is a public calendar URL.' })
  }

  // 2. Parse with Anthropic
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  const genres = icpGenres.join(', ')

  let opportunities = []
  try {
    const msg = await client.messages.create({
      model: 'claude-sonnet-4-5',
      max_tokens: 4000,
      system: `You are a speaking engagement extraction assistant. Parse the iCal (.ics) calendar data carefully and extract EVERY VEVENT.

IMPORTANT: The DTSTART/DTEND fields are the calendar entry dates (often when the listing was posted), NOT the actual event date. The REAL event date, location, contact info, and all details are inside the DESCRIPTION field of each VEVENT. Read every DESCRIPTION field very carefully.

Return ONLY a raw JSON array (no markdown, no backticks, no explanation) where each object has exactly these keys:
- title: event name from SUMMARY field
- date: the REAL event date found inside DESCRIPTION (e.g. "March 2027", "October 19-20, 2026") — NOT the DTSTART value
- location: city, state, venue name extracted from DESCRIPTION
- contactName: full name of contact person from DESCRIPTION
- contactEmail: email address from DESCRIPTION
- contactPhone: phone number from DESCRIPTION
- genre: best single match from: ${genres} — infer from event content and audience
- audience: who attends, audience type, industry, or expected size from DESCRIPTION
- fee: honorarium, speaking fee, or stipend from DESCRIPTION
- format: keynote / panel / workshop / breakout / webinar / emcee / general session / etc.
- organization: hosting association, company, or group name from DESCRIPTION
- details: the COMPLETE raw text of the DESCRIPTION field — include everything verbatim, do not truncate or summarize

Use null for unknown fields. Return [] if no events found.`,
      messages: [{
        role: 'user',
        content: `Parse this iCal data. For each VEVENT, read the DESCRIPTION field carefully — it contains the real event date, location, contact, and all details:\n\n${icalText.slice(0, 16000)}`
      }]
    })

    const text = msg.content.filter(b => b.type === 'text').map(b => b.text).join('')
    const match = text.match(/\[[\s\S]*\]/)
    if (match) opportunities = JSON.parse(match[0])
  } catch (e) {
    return res.status(500).json({ error: `AI parsing failed: ${e.message}` })
  }

  return res.status(200).json({ opportunities, calendarMonth, count: opportunities.length })
}
