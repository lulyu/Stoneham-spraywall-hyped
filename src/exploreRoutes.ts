import type { Problem } from './types'

export type ExploreSort = 'newest' | 'grade-asc' | 'grade-desc' | 'stars-desc' | 'stars-asc'
export type ExploreQuery = { grade: string; validOnly: boolean; sort: ExploreSort }
export type RouteRating = { ratingAverage: number | null; ratingCount: number }
export const defaultExploreQuery: ExploreQuery = {grade: '', validOnly: false, sort: 'newest'}
export const isStarSort = (sort: ExploreSort) => sort === 'stars-desc' || sort === 'stars-asc'
export const needsAllRoutes = (query: ExploreQuery) => Boolean(query.grade || query.validOnly || query.sort !== 'newest')

export function gradeValue(grade: string): number {
  if (grade === 'VB') return -1
  const match = /^V(\d+)(\+)?$/.exec(grade)
  return match ? Number(match[1]) + (match[2] ? 0.5 : 0) : Infinity
}
export function readRating(value: unknown): RouteRating | undefined {
  if (!value || typeof value !== 'object') return
  const {ratingAverage, ratingCount} = value as RouteRating
  if (!Number.isSafeInteger(ratingCount) || ratingCount < 0) return
  if (ratingCount === 0 && ratingAverage === null) return {ratingAverage, ratingCount}
  if (ratingCount > 0 && typeof ratingAverage === 'number' && Number.isFinite(ratingAverage) && ratingAverage >= 1 && ratingAverage <= 5) return {ratingAverage, ratingCount}
}
const newest = (a: Problem, b: Problem) => b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id)
export function exploreRoutes(items: Problem[], query: ExploreQuery, ratings: ReadonlyMap<string, RouteRating>): Problem[] {
  return items.filter(item => (!query.grade || item.grade === query.grade) && (!query.validOnly || !item.outdated)).sort((a, b) => {
    if (query.sort === 'grade-asc' || query.sort === 'grade-desc') {
      const av = gradeValue(a.grade), bv = gradeValue(b.grade)
      if (av !== bv) {
        if (!Number.isFinite(av)) return 1
        if (!Number.isFinite(bv)) return -1
        return (av - bv) * (query.sort === 'grade-asc' ? 1 : -1)
      }
    } else if (isStarSort(query.sort)) {
      const ar = ratings.get(a.id), br = ratings.get(b.id)
      const av = ar?.ratingAverage ?? null, bv = br?.ratingAverage ?? null
      // Unrated or unavailable routes stay last in either direction.
      if (av === null && bv !== null) return 1
      if (bv === null && av !== null) return -1
      if (av !== null && bv !== null) return (av - bv) * (query.sort === 'stars-asc' ? 1 : -1) || (br!.ratingCount - ar!.ratingCount) || newest(a, b)
    }
    return newest(a, b)
  })
}

/** Public summaries; a failed rating never removes a route from Explore. */
export async function loadRouteRatings(base: string, ids: string[], signal: AbortSignal, fetcher: typeof fetch = fetch) {
  const ratings = new Map<string, RouteRating>()
  let next = 0, failed = 0
  await Promise.all(Array.from({length: Math.min(4, ids.length)}, async () => {
    while (next < ids.length && !signal.aborted) {
      const id = ids[next++]
      try {
        const response = await fetcher(base.replace(/\/+$/, '') + '/v1/problems/' + encodeURIComponent(id) + '/community',
          {signal: AbortSignal.any([signal, AbortSignal.timeout(15000)])})
        if (!response.ok) throw new Error('Could not load rating.')
        const rating = readRating(await response.json())
        if (!rating) throw new Error('Invalid rating.')
        ratings.set(id, rating)
      } catch { if (!signal.aborted) failed++ }
    }
  }))
  return {ratings, failed}
}
