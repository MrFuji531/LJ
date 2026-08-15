import { sb } from './supabase'

/**
 * Photos and videos live in one private Supabase Storage bucket. The row only
 * carries the storage path (plus, for photos, a tiny data-URL thumbnail so
 * lists render instantly and offline); the original is fetched on demand
 * through short-lived signed URLs.
 *
 * Uploads need to be online — there's no outbox for megabytes of media. The
 * callers surface that as a toast rather than pretending it queued.
 */

const BUCKET = 'lj-media'

export const canUpload = () => Boolean(sb()) && navigator.onLine

const looksHeic = (f: Blob) => {
  const name = f instanceof File ? f.name.toLowerCase() : ''
  return /hei[cf]/.test(f.type) || /\.hei[cf]$/.test(name)
}

/**
 * iPhone photos arrive as HEIC, which Android Chrome can't decode at all and
 * older iOS can't decode in canvas — so both the thumbnail and the stored
 * original must be JPEG. The converter is a ~1 MB lazy chunk, loaded only
 * when a HEIC actually shows up.
 */
export async function normalizePhoto(file: File): Promise<{ blob: Blob; ext: string }> {
  if (!looksHeic(file)) return { blob: file, ext: fileExt(file) }
  const { default: heic2any } = await import('heic2any')
  const out = await heic2any({ blob: file, toType: 'image/jpeg', quality: 0.86 })
  return { blob: Array.isArray(out) ? out[0] : out, ext: 'jpg' }
}

/** Cover-cropped square thumbnail as a webp data URL — a few KB at most. */
export async function makeThumb(file: Blob, size = 128): Promise<string> {
  const url = URL.createObjectURL(file)
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image()
      el.onload = () => resolve(el)
      el.onerror = () =>
        reject(new Error("This phone can't read that image format"))
      el.src = url
    })
    const canvas = document.createElement('canvas')
    canvas.width = size
    canvas.height = size
    const ctx = canvas.getContext('2d')!
    const s = Math.min(img.naturalWidth, img.naturalHeight)
    ctx.drawImage(
      img,
      (img.naturalWidth - s) / 2,
      (img.naturalHeight - s) / 2,
      s,
      s,
      0,
      0,
      size,
      size,
    )
    return canvas.toDataURL('image/webp', 0.72)
  } finally {
    URL.revokeObjectURL(url)
  }
}

/** Upload (or replace) one object. Throws with a human message on failure. */
export async function uploadMedia(path: string, file: Blob): Promise<void> {
  const client = sb()
  if (!client) throw new Error('Storage needs the sync connection')
  if (!navigator.onLine) throw new Error("You're offline — try again with internet")
  const { error } = await client.storage.from(BUCKET).upload(path, file, {
    upsert: true,
    contentType: file.type || undefined,
  })
  if (error) throw new Error(error.message)
}

export async function removeMedia(path: string): Promise<void> {
  await sb()?.storage.from(BUCKET).remove([path])
}

/* Signed URLs are valid for a week; cache them so a list of thumbnails doesn't
   mint one per render. */
const SIGN_TTL = 60 * 60 * 24 * 7
const signed = new Map<string, { url: string; until: number }>()

export async function mediaUrl(path: string): Promise<string | null> {
  const hit = signed.get(path)
  if (hit && hit.until > Date.now()) return hit.url
  const client = sb()
  if (!client) return null
  const { data, error } = await client.storage.from(BUCKET).createSignedUrl(path, SIGN_TTL)
  if (error || !data?.signedUrl) return null
  signed.set(path, { url: data.signedUrl, until: Date.now() + (SIGN_TTL - 3600) * 1000 })
  return data.signedUrl
}

/** Safe storage key from a free-text name. */
export const mediaKey = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')

export const fileExt = (f: File) => {
  const m = /\.([a-z0-9]+)$/i.exec(f.name)
  return m ? m[1].toLowerCase() : f.type.split('/')[1] || 'bin'
}
