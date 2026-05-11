// api/scan.js
// Parses ALL iCal events using node-ical (no token limit)
// Uses Claude only for genre classification on extracted text

const Anthropic = require('@anthropic-ai/sdk')
const ical      = require('node-ical')

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const { url, icpGenres = [], calendarMonth = '' } = req.body || {}
  if (!url) return res.status(400).json({ error: 'url is required' })

  // ── 1. Fetch iCal ─────────────────────────────────────────────────────────
  let icalText
  try {
    const fetchUrl = url.replace(/^webcal:\/\//i, 'https://')
    const response = await fetch(fetchUrl, {
      headers: { 'User-Agent': 'SpeakIQ/1.0' },
      signal: AbortSignal.timeout(20000),
    })
    if (!response.ok) return res.status(400).json({ error: `Calendar URL returned ${response.status}. Make sure the URL is public.` })
    icalText = await response.text()
  } catch (e) {
    return res.status(400).json({ error: `Failed to fetch calendar: ${e.message}` })
  }

  if (!icalText.includes('BEGIN:VCALENDAR')) {
    return res.status(400).json({ error: 'URL did not return valid iCal data.' })
  }

  // ── 2. Parse ALL events with node-ical (no truncation) ────────────────────
  let rawEvents = []
  try {
    const parsed = ical.sync.parseICS(icalText)
    rawEvents = Object.values(parsed).filter(e => e.type === 'VEVENT')
  } catch(e) {
    return res.status(400).json({ error: `Failed to parse iCal: ${e.message}` })
  }

  if (rawEvents.length === 0) {
    return res.status(200).json({ opportunities: [], calendarMonth, count: 0 })
  }

  // ── 3. Extract structured data from each event ────────────────────────────
  const extractField = (desc, patterns) => {
    if (!desc) return null
    for (const pattern of patterns) {
      const m = desc.match(pattern)
      if (m) return m[1]?.trim() || null
    }
    return null
  }

  const extractedEvents = rawEvents.map(event => {
    const summary = event.summary?.val || event.summary || ''
    const desc    = event.description?.val || event.description || ''
    const location= event.location?.val || event.location || ''

    // Extract real event date from description text (not DTSTART which is just listing date)
    // Strip HTML tags first for cleaner parsing
    const plainDesc = desc.replace(/<[^>]+>/g, ' ').replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&#39;/g,"'").replace(/&nbsp;/g,' ').replace(/\s+/g,' ')

    const datePatterns = [
      // Labeled date fields
      /(?:event\s+date|conference\s+date|date\s+of\s+event)[:\s]+([^\n\r<]{5,40})/i,
      // Month Day-Day, Year  e.g. "June 25-26, 2026"
      /\b((?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+\d{1,2}(?:[-–]\d{1,2})?,?\s*\d{4})\b/i,
      // Month Day, Year  e.g. "November 5-7, 2026"  
      /\b((?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2}(?:[-–]\d{1,2})?,?\s*\d{4})\b/i,
      // MM/DD/YYYY
      /(\d{1,2}\/\d{1,2}\/\d{4})/,
      // Year alone as fallback
      /\b(202[5-9]|203\d)\b/,
    ]

    let realDate = null
    for (const pattern of datePatterns) {
      const m = plainDesc.match(pattern)
      if (m) { realDate = (m[1] || m[0]).trim(); break }
    }
    // Last resort: use DTSTART year if it looks future-ish
    if (!realDate && event.start) {
      const d = new Date(event.start)
      if (d.getFullYear() >= 2025) realDate = d.toLocaleDateString('en-US', { month:'long', day:'numeric', year:'numeric' })
    }

    // Extract contact info
    const emailMatch = desc.match(/[\w.+-]+@[\w-]+\.[a-z]{2,}/i)
    const phoneMatch = desc.match(/(?:\+1[-.\s]?)?\(?\d{3}\)?[-.\s]\d{3}[-.\s]\d{4}/)
    const namePatterns = [
      /contact[:\s]+([^\n\r,]+)/i,
      /(?:call|email|contact)\s+([A-Z][a-z]+ [A-Z][a-z]+)/,
    ]

    // Extract fields from plain text version for better matching
    const extractPlain = (patterns) => extractField(plainDesc, patterns)

    return {
      title:        summary,
      date:         realDate,
      location:     location || extractPlain([/location[:\s]+([^\n<]{3,60})/i, /venue[:\s]+([^\n<]{3,60})/i, /([A-Z][a-z]+,\s*[A-Z]{2}\s+\d{5})/]),
      contactName:  extractPlain([/(?:planner|contact|coordinator)[:\s]+([A-Z][a-z]+ [A-Z][a-z]+)/i, /speaker\s+contact[:\s]+([A-Z][a-z]+ [A-Z][a-z]+)/i]),
      contactEmail: emailMatch?.[0] || null,
      contactPhone: phoneMatch?.[0] || null,
      audience:     extractPlain([/audience[:\s]+([^\n<]{3,80})/i, /attendees[:\s]+([^\n<]{3,80})/i]),
      fee:          extractPlain([/(?:fee|honorarium|stipend|compensation)[:\s]+([^\n<]{3,60})/i]),
      format:       extractPlain([/format[:\s]+([^\n<]{3,60})/i, /(keynote|panel|workshop|webinar|breakout|general session)/i]),
      organization: extractPlain([/company[:\s]+([^\n<]{3,80})/i, /organization[:\s]+([^\n<]{3,80})/i, /hosted?\s+by[:\s]+([^\n<]{3,80})/i]),
      details:      plainDesc,
      rawText:      `${summary}\n${plainDesc}`.slice(0, 600),
    }
  })

  // ── 4. Batch genre classification with Claude ─────────────────────────────
  // Send all events in one call, Claude just returns genres
  const client  = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  const genres  = icpGenres.length > 0 ? icpGenres : ['Leadership','Business','Healthcare','Technology','Education','Finance','Entrepreneurship','Sales','Mental Health','Nonprofit','Government','Real Estate','Marketing','Wellness']

  let genreMap = {}
  try {
    const eventSummaries = extractedEvents.map((e, i) =>
      `${i}: ${e.rawText}`
    ).join('\n---\n')

    const msg = await client.messages.create({
      model: 'claude-sonnet-4-5',
      max_tokens: 2000,
      system: `You are a speaking engagement classifier. For each numbered event, pick the single best genre from this list: ${genres.join(', ')}.
Return ONLY a raw JSON object (no markdown) mapping index to genre, e.g. {"0":"Leadership","1":"Healthcare"}.
If unsure, pick the closest match. Never return null.`,
      messages: [{
        role: 'user',
        content: `Classify each of these ${extractedEvents.length} speaking events by genre:\n\n${eventSummaries.slice(0, 14000)}`
      }]
    })

    const text = msg.content.filter(b => b.type === 'text').map(b => b.text).join('')
    const m = text.match(/\{[\s\S]*\}/)
    if (m) genreMap = JSON.parse(m[0])
  } catch(e) {
    // Genre classification failed — continue without it
    console.error('Genre classification failed:', e.message)
  }

  // ── 5. Assemble final opportunities ──────────────────────────────────────
  const opportunities = extractedEvents.map((e, i) => ({
    title:        e.title        || null,
    date:         e.date         || null,
    location:     e.location     || null,
    contactName:  e.contactName  || null,
    contactEmail: e.contactEmail || null,
    contactPhone: e.contactPhone || null,
    genre:        genreMap[i]    || null,
    audience:     e.audience     || null,
    fee:          e.fee          || null,
    format:       e.format       || null,
    organization: e.organization || null,
    details:      e.details      || null,
  }))

  return res.status(200).json({ opportunities, calendarMonth, count: opportunities.length })
}
