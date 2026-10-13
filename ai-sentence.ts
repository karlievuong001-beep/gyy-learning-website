// Hàm máy chủ (Vercel). Khóa API chỉ nằm ở biến môi trường ANTHROPIC_API_KEY, không bao giờ ở frontend.
import { rateLimited, run, validate } from './ai-core'

export default async function handler(req: any, res: any) {
  res.setHeader('Cache-Control', 'no-store')
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' })
  const ip = String(req.headers?.['x-forwarded-for'] ?? req.socket?.remoteAddress ?? 'unknown').split(',')[0].trim()
  if (rateLimited(ip)) return res.status(429).json({ error: 'rate_limited' })
  const v = validate(typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body)
  if (!v.ok) return res.status(400).json({ error: v.error })
  try {
    const out = await run(v.req, process.env)
    return res.status(out.status).json(out.body)
  } catch {
    return res.status(502).json({ error: 'upstream_error' })
  }
}
