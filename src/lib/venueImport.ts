export type VenueImportEntry = {
  name: string
  suburb: string | null
  address?: string | null
  url?: string | null
  price?: number | null
  notes?: string | null
}

const optionalText = (value: unknown): string | null =>
  typeof value === 'string' ? value.trim() || null : null

export function parseVenueImport(text: string): VenueImportEntry[] {
  const input = text.trim()
  if (!input) return []
  if (input.startsWith('[') || input.startsWith('{')) {
    const data: unknown = JSON.parse(input)
    if (!Array.isArray(data)) throw new Error('Choose a JSON file containing a list of venues.')
    return data.map((value, i) => {
      if (!value || typeof value !== 'object') {
        throw new Error(`Venue ${i + 1} needs a name.`)
      }
      const row = value as Record<string, unknown>
      if (!optionalText(row.name)) throw new Error(`Venue ${i + 1} needs a name.`)
      const url = optionalText(row.url)
      if (url && !/^https?:\/\//i.test(url)) throw new Error(`Venue ${i + 1} needs an http or https link.`)
      if (row.price != null && (typeof row.price !== 'number' || !Number.isFinite(row.price) || row.price < 0 || row.price > 99999.99)) {
        throw new Error(`Venue ${i + 1} needs a numeric price or no price.`)
      }
      return {
        name: optionalText(row.name)!, suburb: optionalText(row.suburb),
        address: optionalText(row.address), url, price: row.price as number | null ?? null,
        notes: optionalText(row.notes),
      }
    })
  }
  return input.split('\n')
    .map((line) => line.trim().replace(/^(?:[-•*]\s+|\d+[.)]\s+)/, ''))
    .filter(Boolean)
    .map((line) => {
      const parts = line.split(/\s+[—–|]\s+|,\s+/)
      return { name: parts[0].trim(), suburb: parts[1]?.trim() || null }
    })
    .filter((entry) => entry.name)
}

export const venueImportKey = (entry: VenueImportEntry) =>
  `${entry.name.trim().toLocaleLowerCase()}\u0000${(entry.suburb ?? '').trim().toLocaleLowerCase()}`
