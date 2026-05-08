const { createClient } = require('@supabase/supabase-js')

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const { userId } = req.body || {}
  if (!userId) return res.status(400).json({ error: 'userId required' })

  const supabase = createClient(
    process.env.VITE_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY
  )

  // Delete from auth (cascades to profiles via foreign key)
  const { error } = await supabase.auth.admin.deleteUser(userId)
  if (error) return res.status(500).json({ error: error.message })

  return res.status(200).json({ success: true })
}
