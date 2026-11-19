import { describe, expect, test } from 'vitest'
import { centered, clampCrop, cropRect, MAX_ZOOM, pan, zoomBy } from '../src/lib/crop'

// a landscape phone photo
const photo = { width: 4000, height: 3000 }

describe('photo crop', () => {
  test('starts in the middle with the biggest square that fits', () => {
    expect(cropRect(photo, centered(photo))).toEqual({ x: 500, y: 0, side: 3000 })
  })

  test('zooming in makes the square smaller around the same center', () => {
    const rect = cropRect(photo, zoomBy(photo, centered(photo), 2))
    expect(rect).toEqual({ x: 1250, y: 750, side: 1500 })
  })

  test('zoom stays between 1x and the max', () => {
    expect(zoomBy(photo, centered(photo), 0.1).zoom).toBe(1)
    expect(zoomBy(photo, centered(photo), 100).zoom).toBe(MAX_ZOOM)
  })

  test('dragging right shows more of the left side', () => {
    // box 300px wide, square 3000 photo px: 1 screen px = 10 photo px
    const moved = pan(photo, centered(photo), 30, 0, 300)
    expect(moved.cx).toBe(2000 - 300)
  })

  test('the square never leaves the photo, so there is no empty edge', () => {
    const far = pan(photo, centered(photo), 99999, -99999, 300)
    const rect = cropRect(photo, far)
    expect(rect.x).toBe(0)
    expect(rect.y + rect.side).toBe(photo.height)

    // zooming out near an edge pulls the square back inside
    const zoomed = clampCrop(photo, { zoom: 2, cx: 750, cy: 750 })
    const back = cropRect(photo, zoomBy(photo, zoomed, 0.5))
    expect(back.x).toBeGreaterThanOrEqual(0)
    expect(back.y).toBeGreaterThanOrEqual(0)
    expect(back.x + back.side).toBeLessThanOrEqual(photo.width)
  })

  test('works for tall photos too', () => {
    const tall = { width: 1080, height: 1920 }
    expect(cropRect(tall, centered(tall))).toEqual({ x: 0, y: 420, side: 1080 })
  })
})
