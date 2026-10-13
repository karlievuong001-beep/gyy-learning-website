// Hàm máy chủ (Vercel) cho giọng đọc Quan thoại nam/nữ qua Google Cloud Text-to-Speech.
// Khóa chỉ nằm ở biến môi trường GOOGLE_TTS_API_KEY, không bao giờ ở frontend. Bật bằng cách đặt VITE_TTS_ENDPOINT=/api/tts.
const VOICES = { female: 'cmn-CN-Wavenet-A', male: 'cmn-CN-Wavenet-B' } as const
const hits = new Map<string, number[]>()
function limited(ip: string) {
  const now = Date.now(); const arr = (hits.get(ip) ?? []).filter((t) => now - t < 60_000)
  arr.push(now); hits.set(ip, arr); return arr.length > 40
}

export default async function handler(req: any, res: any) {
  res.setHeader('Cache-Control', 'no-store')
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' })
  const key = process.env.GOOGLE_TTS_API_KEY
  if (!key) return res.status(501).json({ error: 'not_configured' })
  const ip = String(req.headers?.['x-forwarded-for'] ?? req.socket?.remoteAddress ?? 'unknown').split(',')[0].trim()
  if (limited(ip)) return res.status(429).json({ error: 'rate_limited' })
  const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body ?? {}
  const text = typeof body.text === 'string' ? body.text.trim() : ''
  const gender = body.gender === 'male' ? 'male' : 'female'
  const rate = Math.min(1.5, Math.max(0.5, Number(body.rate) || 0.9))
  if (!text || text.length > 200 || !/[\u4e00-\u9fff]/.test(text)) return res.status(400).json({ error: 'bad_text' })
  try {
    const r = await fetch(`https://texttospeech.googleapis.com/v1/text:synthesize?key=${encodeURIComponent(key)}`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ input: { text }, voice: { languageCode: 'cmn-CN', name: VOICES[gender] }, audioConfig: { audioEncoding: 'MP3', speakingRate: rate } }),
    })
    if (!r.ok) return res.status(502).json({ error: 'upstream_error' })
    const j = (await r.json()) as { audioContent?: string }
    if (!j.audioContent) return res.status(502).json({ error: 'upstream_error' })
    res.setHeader('Content-Type', 'audio/mpeg')
    return res.status(200).send(Buffer.from(j.audioContent, 'base64'))
  } catch { return res.status(502).json({ error: 'upstream_error' }) }
}
