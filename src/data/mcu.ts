/**
 * The MCU in release order — films AND the Disney+ series/specials, plus the
 * Deadpool films (all three: pre-MCU Fox era, but canon-adjacent and, per the
 * house rules, relevant).
 *
 * Only entries confirmed released are listed (latest: Spider-Man: Brand New
 * Day, July 2026). Avengers: Doomsday lands December 2026 — append it here
 * once it's actually out. Adding a row is enough: order, phase grouping and
 * progress all derive from this list. A show appears once and covers all its
 * seasons.
 *
 * `tmdb_id` is deliberately absent: posters are resolved by title + year
 * search, which survives TMDb re-indexing better than IDs typed from memory.
 */

export type McuKind = 'film' | 'show'

export type McuEntry = {
  slug: string
  title: string
  year: number
  phase: number
  kind: McuKind
  /** Release order. Also the watch order. */
  order: number
}

const RAW: [title: string, year: number, phase: number, kind: McuKind][] = [
  ['Iron Man', 2008, 1, 'film'],
  ['The Incredible Hulk', 2008, 1, 'film'],
  ['Iron Man 2', 2010, 1, 'film'],
  ['Thor', 2011, 1, 'film'],
  ['Captain America: The First Avenger', 2011, 1, 'film'],
  ['The Avengers', 2012, 1, 'film'],

  ['Iron Man 3', 2013, 2, 'film'],
  ['Agents of S.H.I.E.L.D.', 2013, 2, 'show'],
  ['Thor: The Dark World', 2013, 2, 'film'],
  ['Captain America: The Winter Soldier', 2014, 2, 'film'],
  ['Guardians of the Galaxy', 2014, 2, 'film'],
  ['Agent Carter', 2015, 2, 'show'],
  ['Daredevil', 2015, 2, 'show'],
  ['Avengers: Age of Ultron', 2015, 2, 'film'],
  ['Ant-Man', 2015, 2, 'film'],
  ['Jessica Jones', 2015, 2, 'show'],

  ['Deadpool', 2016, 3, 'film'],
  ['Captain America: Civil War', 2016, 3, 'film'],
  ['Luke Cage', 2016, 3, 'show'],
  ['Doctor Strange', 2016, 3, 'film'],
  ['Iron Fist', 2017, 3, 'show'],
  ['Guardians of the Galaxy Vol. 2', 2017, 3, 'film'],
  ['Spider-Man: Homecoming', 2017, 3, 'film'],
  ['The Defenders', 2017, 3, 'show'],
  ['Inhumans', 2017, 3, 'show'],
  ['Thor: Ragnarok', 2017, 3, 'film'],
  ['The Punisher', 2017, 3, 'show'],
  ['Runaways', 2017, 3, 'show'],
  ['Black Panther', 2018, 3, 'film'],
  ['Avengers: Infinity War', 2018, 3, 'film'],
  ['Deadpool 2', 2018, 3, 'film'],
  ['Cloak & Dagger', 2018, 3, 'show'],
  ['Ant-Man and the Wasp', 2018, 3, 'film'],
  ['Captain Marvel', 2019, 3, 'film'],
  ['Avengers: Endgame', 2019, 3, 'film'],
  ['Spider-Man: Far From Home', 2019, 3, 'film'],
  ['Helstrom', 2020, 3, 'show'],

  ['WandaVision', 2021, 4, 'show'],
  ['The Falcon and the Winter Soldier', 2021, 4, 'show'],
  ['Loki', 2021, 4, 'show'],
  ['Black Widow', 2021, 4, 'film'],
  ['What If…?', 2021, 4, 'show'],
  ['Shang-Chi and the Legend of the Ten Rings', 2021, 4, 'film'],
  ['Eternals', 2021, 4, 'film'],
  ['Hawkeye', 2021, 4, 'show'],
  ['Spider-Man: No Way Home', 2021, 4, 'film'],
  ['Moon Knight', 2022, 4, 'show'],
  ['Doctor Strange in the Multiverse of Madness', 2022, 4, 'film'],
  ['Ms. Marvel', 2022, 4, 'show'],
  ['Thor: Love and Thunder', 2022, 4, 'film'],
  ['She-Hulk: Attorney at Law', 2022, 4, 'show'],
  ['Werewolf by Night', 2022, 4, 'show'],
  ['Black Panther: Wakanda Forever', 2022, 4, 'film'],
  ['The Guardians of the Galaxy Holiday Special', 2022, 4, 'show'],

  ['Ant-Man and the Wasp: Quantumania', 2023, 5, 'film'],
  ['Guardians of the Galaxy Vol. 3', 2023, 5, 'film'],
  ['Secret Invasion', 2023, 5, 'show'],
  ['The Marvels', 2023, 5, 'film'],
  ['Echo', 2024, 5, 'show'],
  ['Deadpool & Wolverine', 2024, 5, 'film'],
  ['Agatha All Along', 2024, 5, 'show'],
  ['Captain America: Brave New World', 2025, 5, 'film'],
  ['Daredevil: Born Again', 2025, 5, 'show'],
  ['Thunderbolts*', 2025, 5, 'film'],
  ['Ironheart', 2025, 5, 'show'],

  ['The Fantastic Four: First Steps', 2025, 6, 'film'],
  ['Eyes of Wakanda', 2025, 6, 'show'],
  ['Wonder Man', 2026, 6, 'show'],
  ['Spider-Man: Brand New Day', 2026, 6, 'film'],
]

const slugify = (s: string) =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')

export const MCU_FILMS: McuEntry[] = RAW.map(([title, year, phase, kind], i) => ({
  slug: slugify(`${title}-${year}`),
  title,
  year,
  phase,
  kind,
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
