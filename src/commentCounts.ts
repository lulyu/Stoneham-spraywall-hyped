export type CommentCountPage = {
  commentCount?: number
  comments?: {id: string; deleted?: boolean}[]
  nextCursor?: string | null
}
const validCount = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0

/** Prefer server totals; older deployments can be read through all comment pages. */
export async function fetchCommentCount(base: string, problemId: string, fetcher: typeof fetch = fetch, firstPage?: CommentCountPage): Promise<number> {
  const ids = new Set<string>(), cursors = new Set<string>()
  const path = base.replace(/\/+$/, '') + '/v1/problems/' + encodeURIComponent(problemId) + '/community'
  let page: CommentCountPage | undefined = firstPage, cursor: string | undefined
  for (;;) {
    if (!page) {
      const response = await fetcher(path + (cursor ? '?cursor=' + encodeURIComponent(cursor) : ''), {signal: AbortSignal.timeout(15000)})
      if (!response.ok) throw new Error('Could not load comment totals.')
      page = await response.json() as CommentCountPage
    }
    if (!page || typeof page !== 'object') throw new Error('Invalid comment page.')
    if (validCount(page.commentCount)) return page.commentCount
    if (!Array.isArray(page.comments)) throw new Error('Invalid comment page.')
    for (const comment of page.comments) {
      if (!comment || typeof comment.id !== 'string') throw new Error('Invalid comment.')
      if (!comment.deleted) ids.add(comment.id)
    }
    const next = page.nextCursor
    if (next === undefined || next === null || next === '') return ids.size
    if (typeof next !== 'string' || next.length > 4096 || cursors.has(next)) throw new Error('Invalid comment cursor.')
    cursors.add(next); cursor = next; page = undefined
  }
}

/** Optional badges load independently of the route list; one failure does not hide routes. */
export async function withMissingCommentCounts<T extends {id: string; commentCount?: number}>(base: string, items: T[], fetcher: typeof fetch = fetch): Promise<T[]> {
  const result = [...items]
  let next = 0
  await Promise.all(Array.from({length: Math.min(4, items.length)}, async () => {
    while (next < items.length) {
      const index = next++, item = items[index]
      if (validCount(item.commentCount)) continue
      try {result[index] = {...item, commentCount: await fetchCommentCount(base, item.id, fetcher)}}
      catch { /* Leave the badge unavailable; route browsing remains usable. */ }
    }
  }))
  return result
}
