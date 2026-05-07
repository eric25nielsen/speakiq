// api/scan-email.js — searches Gmail for calendar invite emails
// Uses Anthropic API with Gmail MCP to find and extract calendar URLs

const Anthropic = require('@anthropic-ai/sdk')

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const { senderEmails = [], searchAll = false } = req.body || {}

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

  // Build search query — search for known sender OR broadly for calendar invites
  const knownSenders = ['jenniferspeakersclubrep@gmail.com', ...senderEmails].filter(Boolean)
  const senderList = knownSenders.join(', ')

  const searchInstructions = searchAll
    ? `Search Gmail for ALL emails that contain Google Calendar invitation links or calendar subscription URLs. Look for:
       1. Emails with subjects containing "invitation to join shared calendar", "shared calendar", "calendar invite", "speaking opportunities", "speaking calendar"
       2. Emails containing webcal:// links or calendar.google.com/calendar URLs
       3. Emails from any sender that appear to be calendar sharing invitations
       Search the last 365 days of email.`
    : `Search Gmail for recent emails from these senders: ${senderList}
       Also search for ANY emails with subjects containing "shared calendar", "calendar invite", "speaking calendar", or "speaking opportunities".
       Look for webcal:// links or calendar.google.com links in those emails.
       Search the last 180 days.`

  try {
    const msg = await client.messages.create({
      model: 'claude-sonnet-4-5',
      max_tokens: 2000,
      system: `You are a Gmail search assistant. ${searchInstructions}

For each relevant email found, return a JSON array (no markdown) where each object has:
- subject: email subject line
- from: sender email address  
- date: when the email was received
- calendarName: name of the calendar if mentioned (e.g. "May2026")
- icalUrl: any webcal:// or https://calendar.google.com/calendar/ical/... URL found in the email body
- embedUrl: any https://calendar.google.com/calendar/embed?src=... URL found in the email body
- calendarId: any Google Calendar ID (looks like xxxxx@group.calendar.google.com)

Return [] if nothing found. Return only the raw JSON array.`,
      messages: [{ role: 'user', content: 'Search my Gmail for calendar invitation emails and extract all calendar URLs.' }],
      mcp_servers: [{ type: 'url', url: 'https://gmailmcp.googleapis.com/mcp/v1', name: 'gmail-mcp' }]
    })

    const text = msg.content.filter(b => b.type === 'text').map(b => b.text).join('')
    let emails = []
    try {
      const m = text.match(/\[[\s\S]*\]/)
      if (m) emails = JSON.parse(m[0])
    } catch {}

    return res.status(200).json({ emails, count: emails.length })
  } catch(e) {
    return res.status(500).json({ error: `Email scan failed: ${e.message}` })
  }
}
