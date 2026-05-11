const Anthropic = require('@anthropic-ai/sdk')

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

  try {
    const msg = await client.messages.create({
      model: 'claude-sonnet-4-5',
      max_tokens: 2000,
      system: `You are a Gmail search assistant. Search the inbox for any emails containing Google Calendar links related to speaking opportunities or calendar invitations from Jennifer Urwin (jenniferspeakersclubrep@gmail.com) or forwarded from judy@judygaman.com.

For EVERY email found containing a calendar link, return a JSON array (no markdown, raw JSON only) where each object has:
- subject: email subject line
- from: sender email
- date: date received
- calendarName: name of the calendar if mentioned
- icalUrl: any https://calendar.google.com/calendar/ical/... or webcal:// URL found
- embedUrl: any https://calendar.google.com/calendar/embed?src=... URL found
- calendarId: any Google Calendar ID (ending in @group.calendar.google.com)

Return [] if nothing found.`,
      messages: [{ 
        role: 'user', 
        content: 'Search my Gmail inbox for emails from jenniferspeakersclubrep@gmail.com OR judy@judygaman.com that contain Google Calendar links or speaking calendar invitations. Also search for any forwarded emails with subject containing "shared calendar" or "speaking". Extract all calendar URLs found.'
      }],
      mcp_servers: [{ 
        type: 'url', 
        url: 'https://gmailmcp.googleapis.com/mcp/v1',
        name: 'gmail'
      }]
    })

    const text = msg.content.filter(b => b.type === 'text').map(b => b.text).join('')
    let emails = []
    try { 
      const m = text.match(/\[[\s\S]*\]/)
      if (m) emails = JSON.parse(m[0]) 
    } catch {}

    // Also extract any iCal URLs directly from the text
    const icalMatches = text.match(/https:\/\/calendar\.google\.com\/calendar\/ical\/[^\s"<>]+/g) || []
    const embedMatches = text.match(/https:\/\/calendar\.google\.com\/calendar\/embed\?[^\s"<>]+/g) || []
    
    // If no structured results but we found URLs, add them
    if (emails.length === 0 && (icalMatches.length > 0 || embedMatches.length > 0)) {
      emails = [{
        subject: 'Found in email',
        from: 'unknown',
        date: new Date().toISOString(),
        calendarName: null,
        icalUrl: icalMatches[0] || null,
        embedUrl: embedMatches[0] || null,
      }]
    }

    return res.status(200).json({ emails, count: emails.length })
  } catch(e) {
    return res.status(500).json({ error: `Email scan failed: ${e.message}` })
  }
}
