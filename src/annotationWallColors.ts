import type { PolygonHoldCandidate } from './types'

/** Deterministic coverage visualization: estimate nearby neutral, unmasked wall color. */
export function annotationWallColors(holds: PolygonHoldCandidate[], pixels: ImageData): Record<string, string> {
  const { width, height, data } = pixels
  const mask = document.createElement('canvas')
  mask.width = width; mask.height = height
  const context = mask.getContext('2d', { willReadFrequently: true })
  if (!context) throw new Error('Canvas is unavailable')
  context.fillStyle = 'white'
  for (const hold of holds) {
    context.beginPath()
    hold.polygon.forEach(([x, y], i) => { if (i === 0) context.moveTo(x * width, y * height); else context.lineTo(x * width, y * height) })
    context.closePath(); context.fill()
  }
  const coverage = context.getImageData(0, 0, width, height).data
  const colors: Record<string, string> = {}
  const margin = Math.max(3, Math.round(55 * width / 7292))
  for (const hold of holds) {
    const xs = hold.polygon.map(([x]) => x * width), ys = hold.polygon.map(([, y]) => y * height)
    const left = Math.max(0, Math.floor(Math.min(...xs)) - margin), right = Math.min(width, Math.ceil(Math.max(...xs)) + margin)
    const top = Math.max(0, Math.floor(Math.min(...ys)) - margin), bottom = Math.min(height, Math.ceil(Math.max(...ys)) + margin)
    const channels: number[][] = [[], [], []]
    for (let y = top; y < bottom; y += 2) for (let x = left; x < right; x += 2) {
      const index = (y * width + x) * 4
      if (coverage[index + 3] > 0) continue
      const r = data[index], g = data[index + 1], b = data[index + 2]
      const mean = (r + g + b) / 3
      if (Math.max(r, g, b) - Math.min(r, g, b) >= 35 || mean <= 100 || mean >= 235) continue
      channels[0].push(r); channels[1].push(g); channels[2].push(b)
    }
    const rgb = channels[0].length >= 10 ? channels.map(channel => { channel.sort((a, b) => a - b); return channel[Math.floor(channel.length / 2)] }) : [170, 168, 162]
    colors[hold.id] = `rgb(${rgb.join(', ')})`
  }
  return colors
}
