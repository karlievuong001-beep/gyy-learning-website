// Lõi dùng chung cho hàm máy chủ chấm câu / gợi ý. Có thể kiểm thử với fetch giả.
export interface IdiomInput { hanzi: string; pinyin?: string; meaning?: string; literal?: string; figurative?: string; example?: { zh: string; pinyin?: string; translation?: string } }
export type Lang = 'vi' | 'zh' | 'en'
export interface Req { action: 'grade' | 'hint'; idiom: IdiomInput; sentence?: string; lang: Lang; step?: 1 | 2 | 3 }

const LANG_NAME: Record<Lang, string> = { vi: 'Vietnamese', zh: 'Simplified Chinese', en: 'English' }
const clip = (s: unknown, n: number) => String(s ?? '').slice(0, n)

export function validate(b: unknown): { ok: true; req: Req } | { ok: false; error: string } {
  const r = b as Partial<Req> | null
  if (!r || typeof r !== 'object') return { ok: false, error: 'bad_request' }
  if (r.action !== 'grade' && r.action !== 'hint') return { ok: false, error: 'bad_action' }
  if (!r.idiom || typeof r.idiom.hanzi !== 'string' || !/[\u4e00-\u9fff]/.test(r.idiom.hanzi) || r.idiom.hanzi.length > 30) return { ok: false, error: 'bad_idiom' }
  const lang: Lang = r.lang === 'zh' || r.lang === 'en' ? r.lang : 'vi'
  if (r.action === 'grade') {
    const s = clip(r.sentence, 400).trim()
    if (s.length < 2) return { ok: false, error: 'empty_sentence' }
    return { ok: true, req: { action: 'grade', idiom: r.idiom, sentence: s, lang } }
  }
  const step = r.step === 2 || r.step === 3 ? r.step : 1
  return { ok: true, req: { action: 'hint', idiom: r.idiom, lang, step } }
}

const idiomBlock = (i: IdiomInput) => [
  `Idiom (惯用语): ${clip(i.hanzi, 30)}`,
  i.pinyin ? `Pinyin: ${clip(i.pinyin, 80)}` : '',
  i.meaning ? `Meaning in the GYY data: ${clip(i.meaning, 300)}` : '',
  i.literal ? `Literal meaning: ${clip(i.literal, 200)}` : '',
  i.figurative ? `Figurative meaning: ${clip(i.figurative, 300)}` : '',
  i.example ? `Verified example: ${clip(i.example.zh, 200)}${i.example.translation ? ` (${clip(i.example.translation, 200)})` : ''}` : '',
].filter(Boolean).join('\n')

const RULES = `Rules: use ONLY the meaning and usage given in the GYY data above; never contradict it and never invent a different definition. If you are unsure about a nuance, say so cautiously or rely on the verified example. Respond with a single JSON object and nothing else (no markdown fences).`

export function buildPrompt(req: Req): { system: string; user: string } {
  const L = LANG_NAME[req.lang]
  if (req.action === 'grade') {
    return {
      system: `You are a patient Chinese teacher helping a learner practice the Chinese idiom (惯用语) given below. Judge the learner's own sentence on: usage (the idiom appears and is used with the right meaning), grammar, meaning/context, naturalness in modern Chinese, and completeness. Accept ANY correct and natural sentence; never penalize it merely for differing from a model sentence. If the sentence is already correct and natural, say so and do not invent errors; if only a stylistic alternative exists, label it as a suggestion, not an error. Write all explanations in ${L}; keep Chinese text in Chinese. ${RULES}`,
      user: `${idiomBlock(req.idiom)}\n\nLearner's sentence: ${req.sentence}\n\nReturn JSON with this exact shape:\n{"score": number 0-10, "isCorrect": boolean, "overall": string, "criteria": {"usage": {"score": number 0-10, "comment": string}, "grammar": {...}, "context": {...}, "naturalness": {...}, "completeness": {...}}, "good": string[], "issues": [{"text": string (the exact problematic part), "why": string}], "corrected": string (corrected/more natural Chinese sentence, or the same sentence if already good), "alternative": {"zh": string (another sentence that uses the idiom correctly), "pinyin": string, "translation": string (in ${L})}}`,
    }
  }
  const step = req.step ?? 1
  const what = step === 1 ? 'Suggest ONE everyday situation where this idiom fits (1-2 sentences). Do not write a full Chinese sentence.' : step === 2 ? 'Give a sentence frame with blanks and 3-5 keywords the learner can use to write their own sentence. Do not give the complete sentence.' : 'Give one complete model sentence using the idiom correctly, with pinyin and a translation.'
  return {
    system: `You are a Chinese teacher giving a step-by-step hint to a learner who cannot think of a sentence. Write explanations in ${L}; keep Chinese text in Chinese. ${RULES}`,
    user: `${idiomBlock(req.idiom)}\n\nTask (hint step ${step} of 3): ${what}\n\nReturn JSON: {"step": ${step}, "situation": string (step 1, else ""), "frame": string (step 2: Chinese frame with ＿＿ blanks, else ""), "keywords": string[] (step 2, else []), "sample": {"zh": string, "pinyin": string, "translation": string} (step 3, else empty strings)}`,
  }
}

export function parseJson(text: string): unknown {
  const t = text.trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim()
  const a = t.indexOf('{'), b = t.lastIndexOf('}')
  if (a < 0 || b <= a) throw new Error('no_json')
  return JSON.parse(t.slice(a, b + 1))
}

const num = (v: unknown, d = 0) => { const n = Number(v); return Number.isFinite(n) ? Math.min(10, Math.max(0, n)) : d }
export function normalizeGrade(j: any) {
  const crit = (k: string) => ({ score: num(j?.criteria?.[k]?.score), comment: clip(j?.criteria?.[k]?.comment, 400) })
  const score = Math.round(num(j?.score) * 10) / 10
  return {
    score, isCorrect: typeof j?.isCorrect === 'boolean' ? j.isCorrect : score >= 7, overall: clip(j?.overall, 600),
    criteria: { usage: crit('usage'), grammar: crit('grammar'), context: crit('context'), naturalness: crit('naturalness'), completeness: crit('completeness') },
    good: Array.isArray(j?.good) ? j.good.slice(0, 6).map((x: unknown) => clip(x, 300)) : [],
    issues: Array.isArray(j?.issues) ? j.issues.slice(0, 6).map((x: any) => ({ text: clip(x?.text, 200), why: clip(x?.why, 400) })) : [],
    corrected: clip(j?.corrected, 400),
    alternative: { zh: clip(j?.alternative?.zh, 300), pinyin: clip(j?.alternative?.pinyin, 400), translation: clip(j?.alternative?.translation, 400) },
  }
}
export function normalizeHint(j: any, step: 1 | 2 | 3) {
  return { step, situation: clip(j?.situation, 500), frame: clip(j?.frame, 300), keywords: Array.isArray(j?.keywords) ? j.keywords.slice(0, 6).map((x: unknown) => clip(x, 40)) : [], sample: { zh: clip(j?.sample?.zh, 300), pinyin: clip(j?.sample?.pinyin, 400), translation: clip(j?.sample?.translation, 400) } }
}

/** Gọi mô hình AI. fetchImpl và env được truyền vào để kiểm thử. */
export async function run(req: Req, env: Record<string, string | undefined>, fetchImpl: typeof fetch = fetch) {
  const key = env.ANTHROPIC_API_KEY
  if (!key) return { status: 501, body: { error: 'not_configured' } }
  const { system, user } = buildPrompt(req)
  const r = await fetchImpl('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model: env.ANTHROPIC_MODEL || 'claude-sonnet-5-5', max_tokens: 1200, system, messages: [{ role: 'user', content: user }] }),
  })
  if (!r.ok) return { status: 502, body: { error: 'upstream_error', status: r.status } }
  const data = (await r.json()) as { content?: { type: string; text?: string }[] }
  const text = (data.content ?? []).filter((c) => c.type === 'text').map((c) => c.text ?? '').join('')
  try {
    const j = parseJson(text)
    return { status: 200, body: req.action === 'grade' ? { action: 'grade', result: normalizeGrade(j) } : { action: 'hint', result: normalizeHint(j, req.step ?? 1) } }
  } catch { return { status: 502, body: { error: 'bad_model_output' } } }
}

// Giới hạn tần suất đơn giản theo IP (tốt nhất có thể trên hàm serverless).
const hits = new Map<string, number[]>()
export function rateLimited(ip: string, now = Date.now(), max = 20, windowMs = 60_000) {
  const arr = (hits.get(ip) ?? []).filter((t) => now - t < windowMs)
  arr.push(now); hits.set(ip, arr)
  return arr.length > max
}
