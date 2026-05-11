// api/scan.js — parses ALL iCal events using node-ical
// Targets Jennifer's specific HTML description format

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
    if (!response.ok) return res.status(400).json({ error: `Calendar URL returned ${response.status}.` })
    icalText = await response.text()
  } catch (e) {
    return res.status(400).json({ error: `Failed to fetch calendar: ${e.message}` })
  }

  if (!icalText.includes('BEGIN:VCALENDAR')) {
    return res.status(400).json({ error: 'URL did not return valid iCal data.' })
  }

  // ── 2. Parse all events ───────────────────────────────────────────────────
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

  // ── 3. Helper: extract value after a bold label in Jennifer's HTML format ──
  // Handles: <b>Label</b>- value  or  <b>Label</b>: value  or  <b>Label-</b> value
  const getField = (html, labels) => {
    for (const label of labels) {
      // Match <b>Label</b>[-: ] value until next <br>, <b>, or end
      const patterns = [
        new RegExp(`<b>${label}[\\s-:]*<\\/b>[\\s-:]*([^<\\n]+)`, 'i'),
        new RegExp(`<b>${label}[\\s-:]+<\\/b>[\\s-:]*([^<\\n]+)`, 'i'),
        new RegExp(`${label}[\\s]*[:-][\\s]*([^<\\n]{3,80})`, 'i'),
      ]
      for (const re of patterns) {
        const m = html.match(re)
        if (m?.[1]) {
          const val = m[1].replace(/<[^>]+>/g, '').replace(/&amp;/g,'&').replace(/&nbsp;/g,' ').trim()
          if (val.length > 0) return val
        }
      }
    }
    return null
  }

  // Extract email from mailto links
  const getEmail = (html) => {
    // Planner email preferred over general email
    const plannerMatch = html.match(/Planner\s*E[Mm]ail[^>]*>.*?href="mailto:([^"]+)"/i) ||
                         html.match(/href="mailto:([^"]+)"[^>]*>[^<]*(?:planner|coordinator|contact)/i)
    if (plannerMatch) return plannerMatch[1]
    const m = html.match(/href="mailto:([^"]+)"/)
    return m ? m[1] : null
  }

  // Extract phone — prefer planner phone
  const getPhone = (html) => {
    const plannerMatch = html.match(/(?:Planner\s*Phone|Contact\s*Phone)[^>]*>?\s*[-:]\s*([0-9(). +-]{7,20})/i)
    if (plannerMatch) return plannerMatch[1].trim()
    const m = html.match(/(?:Phone|Tel)[^>]*[-:]\s*([0-9(). +-]{7,20})/i)
    return m ? m[1].trim() : null
  }

  // Extract event date from description text (not DTSTART which is listing date)
  const getDate = (html, plainText) => {
    // Remove HTML
    const plain = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ')

    const patterns = [
      // "Month Day-Day, Year" e.g. "May 5-8, 2027" or "November 4-6, 2026"
      /\b((?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2}(?:[-–]\d{1,2})?,?\s*202[5-9])\b/i,
      // Abbreviated: "Jun 25-26, 2026"
      /\b((?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\.?\s+\d{1,2}(?:[-–]\d{1,2})?,?\s*202[5-9])\b/i,
      // Just year range in title like "2027"
      /\b(202[5-9])\b/,
    ]
    for (const re of patterns) {
      const m = plain.match(re)
      if (m) return m[1].trim()
    }
    return null
  }

  // Extract location — prefer city/state from address block
  const getLocation = (html, icalLocation) => {
    if (icalLocation && icalLocation.length > 3) return icalLocation

    // Try to find city, state from address block
    const stateZip = html.match(/([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*),?\s+([A-Z]{2})\s+(\d{5})/i)
    if (stateZip) return `${stateZip[1]}, ${stateZip[2]}`

    // Just state + zip
    const stateOnly = html.match(/\b([A-Z]{2})\s+(\d{5})\b/)
    if (stateOnly) return stateOnly[0]

    return null
  }

  // Strip all HTML and decode entities for plain text details
  const toPlain = (html) => html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<p[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&#39;/g,"'").replace(/&nbsp;/g,' ').replace(/&quot;/g,'"')
    .replace(/\n{3,}/g, '\n\n')
    .trim()

  // ── 4. Extract structured fields from each event ──────────────────────────
  const extractedEvents = rawEvents.map(event => {
    const summary = event.summary?.val || event.summary || ''
    const html    = event.description?.val || event.description || ''
    const loc     = event.location?.val || event.location || ''

    return {
      title:        summary.replace(/\\n/g,'').trim(),
      date:         getDate(html, summary),
      location:     getLocation(html, loc),
      contactName:  getField(html, ['Event contact', 'Planner Name', 'Speaker contact', 'Contact']),
      contactEmail: getEmail(html),
      contactPhone: getPhone(html),
      organization: getField(html, ['Company', 'Organization', 'Association', 'Host']),
      audience:     getField(html, ['Audience', 'Attendees', 'Who attends', 'Members']),
      fee:          getField(html, ['Fee', 'Honorarium', 'Stipend', 'Compensation', 'Speaker fee']),
      format:       getField(html, ['Format', 'Session type', 'Type']),
      details:      toPlain(html),
      rawText:      `${summary}\n${toPlain(html)}`.slice(0, 600),
    }
  })

  // ── 5. Batch genre classification in chunks of 50 ────────────────────────
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  const genres = icpGenres.length > 0 ? icpGenres : ['Leadership','Business','Healthcare','Technology','Education','Finance','Entrepreneurship','Sales','Mental Health','Nonprofit','Government','Real Estate','Marketing','Wellness']

  let genreMap = {}
  const CHUNK = 50
  try {
    for (let start = 0; start < extractedEvents.length; start += CHUNK) {
      const chunk = extractedEvents.slice(start, start + CHUNK)
      const summaries = chunk.map((e, i) => `${start+i}: ${e.title} | ${e.organization || ''} | ${e.rawText.slice(0,200)}`).join('\n')
      const msg = await client.messages.create({
        model: 'claude-sonnet-4-5',
        max_tokens: 1000,
        system: `Classify each speaking event by genre. Pick ONE from: ${genres.join(', ')}.
Return ONLY a raw JSON object mapping the number index to genre string. Example: {"0":"Leadership","1":"Healthcare"}.
Every index must have a value. Never return null.`,
        messages: [{ role:'user', content: `Classify these events by genre:\n\n${summaries}` }]
      })
      const text = msg.content.filter(b=>b.type==='text').map(b=>b.text).join('')
      const m = text.match(/\{[\s\S]*\}/)
      if (m) Object.assign(genreMap, JSON.parse(m[0]))
    }
  } catch(e) {
    console.error('Genre classification failed:', e.message)
  }

  // ── 6. Final output ────────────────────────────────────────────────────────
  const opportunities = extractedEvents.map((e, i) => ({
    ...e,
    genre:    genreMap[i] || null,
    rawText:  undefined,
  }))

  return res.status(200).json({ opportunities, calendarMonth, count: opportunities.length })
}
