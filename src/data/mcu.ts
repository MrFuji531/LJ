/**
 * The MCU in release order.
 *
 * Only films confirmed released are listed. The 2026+ slate (Doomsday, Brand
 * New Day, Secret Wars) keeps being reshuffled, so rather than bake in dates
 * that go stale, append them here once they're actually out. Adding a row is
 * enough — order, phase grouping and progress all derive from this list.
 *
 * `tmdb_id` is deliberately absent: posters are resolved by title + year
 * search, which survives TMDb re-indexing better than IDs typed from memory.
 */

export type McuFilm = {
  slug: string
  title: string
  year: number
  phase: number
  /** Release order. Also the watch order. */
  order: number
}

const RAW: [title: string, year: number, phase: number][] = [
  ['Iron Man', 2008, 1],
  ['The Incredible Hulk', 2008, 1],
  ['Iron Man 2', 2010, 1],
  ['Thor', 2011, 1],
  ['Captain America: The First Avenger', 2011, 1],
  ['The Avengers', 2012, 1],

  ['Iron Man 3', 2013, 2],
  ['Thor: The Dark World', 2013, 2],
  ['Captain America: The Winter Soldier', 2014, 2],
  ['Guardians of the Galaxy', 2014, 2],
  ['Avengers: Age of Ultron', 2015, 2],
  ['Ant-Man', 2015, 2],

  ['Captain America: Civil War', 2016, 3],
  ['Doctor Strange', 2016, 3],
  ['Guardians of the Galaxy Vol. 2', 2017, 3],
  ['Spider-Man: Homecoming', 2017, 3],
  ['Thor: Ragnarok', 2017, 3],
  ['Black Panther', 2018, 3],
  ['Avengers: Infinity War', 2018, 3],
  ['Ant-Man and the Wasp', 2018, 3],
  ['Captain Marvel', 2019, 3],
  ['Avengers: Endgame', 2019, 3],
  ['Spider-Man: Far From Home', 2019, 3],

  ['Black Widow', 2021, 4],
  ['Shang-Chi and the Legend of the Ten Rings', 2021, 4],
  ['Eternals', 2021, 4],
  ['Spider-Man: No Way Home', 2021, 4],
  ['Doctor Strange in the Multiverse of Madness', 2022, 4],
  ['Thor: Love and Thunder', 2022, 4],
  ['Black Panther: Wakanda Forever', 2022, 4],

  ['Ant-Man and the Wasp: Quantumania', 2023, 5],
  ['Guardians of the Galaxy Vol. 3', 2023, 5],
  ['The Marvels', 2023, 5],
  ['Deadpool & Wolverine', 2024, 5],
  ['Captain America: Brave New World', 2025, 5],
  ['Thunderbolts*', 2025, 5],

  ['The Fantastic Four: First Steps', 2025, 6],
]

const slugify = (s: string) =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')

export const MCU_FILMS: McuFilm[] = RAW.map(([title, year, phase], i) => ({
  slug: slugify(`${title}-${year}`),
  title,
  year,
  phase,
  order: i + 1,
}))

export const MCU_BY_SLUG = new Map(MCU_FILMS.map((f) => [f.slug, f]))

export const PHASES = [...new Set(MCU_FILMS.map((f) => f.phase))].sort((a, b) => a - b)

export type CharacterKind = 'hero' | 'villain' | 'love'

export const CHARACTER_KINDS: {
  key: CharacterKind
  label: string
  plural: string
  color: string
}[] = [
  { key: 'hero', label: 'Hero', plural: 'Heroes', color: 'var(--gold)' },
  { key: 'villain', label: 'Villain', plural: 'Villains', color: 'var(--violet)' },
  { key: 'love', label: 'Love interest', plural: 'Love interests', color: 'var(--rose)' },
]
