// api/scan.js  — Vercel Serverless Function
// Runs on the SERVER so no CORS issues fetching iCal URLs

const Anthropic = require('@anthropic-ai/sdk')

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const { url, icpGenres = [], calendarMonth = '' } = req.body || {}
  if (!url) return res.status(400).json({ error: 'url is required' })

  // ── 1. Fetch the iCal file server-side ──────────────────────────────────────
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

  // ── 2. Parse with Anthropic ──────────────────────────────────────────────────
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

  let opportunities = []
  try {
    const msg = await client.messages.create({
      model: 'claude-sonnet-4-5',
      max_tokens: 4000,
      system: `You are a speaking engagement extraction assistant. Parse the iCal (.ics) calendar data and extract EVERY VEVENT as a speaking engagement opportunity.

Return ONLY a raw JSON array (no markdown, no backticks, no explanation) where each object has:
- title: event/engagement name
- date: full date and time string
- location: city, state, venue name
- contactName: primary contact person's full name
- contactEmail: contact email address
- contactPhone: contact phone number
- genre: best single match from: ${icpGenres.join(', ')} — or infer from content
- audience: audience type or expected size  
- fee: honorarium or speaking fee if mentioned
- format: keynote / panel / workshop / breakout / webinar / emcee / etc.
- organization: hosting organization or association name
- details: full description including requirements, deadlines, or notes

Use null for unknown fields. Return [] if no events are found.`,
      messages: [{
        role: 'user',
        content: `Parse this iCal calendar data and extract all speaking engagement opportunities:\n\n${icalText.slice(0, 14000)}`
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
