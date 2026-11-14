import { useCallback, useEffect, useRef, useState } from 'react'
import { loadRouteRatings, readRating, type RouteRating } from './exploreRoutes'

export function useRouteRatings(base: string, ids: string[], enabled: boolean) {
  const [ratings, setRatings] = useState(() => new Map<string, RouteRating>())
  const cache = useRef(ratings)
  const [loading, setLoading] = useState(false)
  const [failed, setFailed] = useState(0)
  const [attempt, setAttempt] = useState(0)
  const key = JSON.stringify(ids)
  useEffect(() => {
    if (!enabled) { setLoading(false); return }
    const controller = new AbortController()
    const missing = (JSON.parse(key) as string[]).filter(id => !cache.current.has(id))
    setLoading(missing.length > 0); setFailed(0)
    void loadRouteRatings(base, missing, controller.signal).then(result => {
      if (controller.signal.aborted) return
      const next = new Map([...result.ratings, ...cache.current])
      cache.current = next; setRatings(next)
      setFailed(result.failed); setLoading(false)
    })
    return () => controller.abort()
  }, [base, key, enabled, attempt])
  const update = useCallback((id: string, value: RouteRating) => {
    const rating = readRating(value)
    if (!rating) return
    const current = cache.current.get(id)
    if (current?.ratingAverage === rating.ratingAverage && current?.ratingCount === rating.ratingCount) return
    const next = new Map(cache.current); next.set(id, rating); cache.current = next; setRatings(next)
  }, [])
  const retry = () => setAttempt(value => value + 1)
  const refresh = () => { cache.current = new Map(); setRatings(cache.current); setFailed(0); retry() }
  return {ratings, loading, failed, update, retry, refresh}
}
