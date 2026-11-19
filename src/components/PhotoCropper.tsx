import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import { centered, MAX_ZOOM, MIN_ZOOM, pan, sideAt, zoomBy, type Crop } from '../lib/crop'
import type { LoadedPhoto } from '../lib/image'
import { ZoomIn, ZoomOut } from './icons'
import { Button } from './ui'

type Point = { x: number; y: number }

/**
 * A square box with a round guide. Drag to move the photo, pinch / scroll /
 * use the slider to zoom. What's inside the circle becomes the profile photo.
 */
export function PhotoCropper({
  photo,
  busy,
  onCancel,
  onDone,
}: {
  photo: LoadedPhoto
  busy: boolean
  onCancel: () => void
  onDone: (crop: Crop) => void
}) {
  const boxRef = useRef<HTMLDivElement>(null)
  const [box, setBox] = useState(0) // the box's width on screen, in px
  const [crop, setCrop] = useState<Crop>(() => centered(photo))
  // fingers (or the mouse) currently pressed on the box, by pointer id
  const pointers = useRef(new Map<number, Point>())

  // the box is as wide as the dialog, so measure it, and again if the phone rotates
  useEffect(() => {
    const element = boxRef.current
    if (!element) return
    const observer = new ResizeObserver(([entry]) => setBox(entry!.contentRect.width))
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  // mouse wheel / trackpad zoom. Added by hand because React's wheel listener
  // can't stop the page from scrolling at the same time.
  useEffect(() => {
    const element = boxRef.current
    if (!element) return
    const onWheel = (event: WheelEvent) => {
      event.preventDefault()
      setCrop((c) => zoomBy(photo, c, Math.exp(-event.deltaY * 0.002)))
    }
    element.addEventListener('wheel', onWheel, { passive: false })
    return () => element.removeEventListener('wheel', onWheel)
  }, [photo])

  function down(event: PointerEvent<HTMLDivElement>) {
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY })
    // keep getting moves even if the finger slides off the box
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  function move(event: PointerEvent<HTMLDivElement>) {
    const map = pointers.current
    const before = map.get(event.pointerId)
    if (!before || box === 0) return
    const others = [...map.entries()].filter(([id]) => id !== event.pointerId).map(([, p]) => p)
    const now = { x: event.clientX, y: event.clientY }
    map.set(event.pointerId, now)

    if (others.length === 0) {
      // one finger: drag
      setCrop((c) => pan(photo, c, now.x - before.x, now.y - before.y, box))
    } else {
      // two fingers: pinch. Zoom by how much the gap changed, move by half this finger's step.
      const other = others[0]!
      const gapBefore = Math.hypot(before.x - other.x, before.y - other.y)
      const gapNow = Math.hypot(now.x - other.x, now.y - other.y)
      if (gapBefore < 1) return
      setCrop((c) => pan(photo, zoomBy(photo, c, gapNow / gapBefore), (now.x - before.x) / 2, (now.y - before.y) / 2, box))
    }
  }

  function up(event: PointerEvent<HTMLDivElement>) {
    pointers.current.delete(event.pointerId)
  }

  // keyboard: arrows move, + and - zoom
  function key(event: KeyboardEvent<HTMLDivElement>) {
    const step = event.shiftKey ? 40 : 10
    const moves: Record<string, [number, number]> = {
      ArrowLeft: [step, 0],
      ArrowRight: [-step, 0],
      ArrowUp: [0, step],
      ArrowDown: [0, -step],
    }
    if (moves[event.key]) {
      event.preventDefault()
      const [dx, dy] = moves[event.key]!
      setCrop((c) => pan(photo, c, dx, dy, box || 1))
    } else if (event.key === '+' || event.key === '=') {
      setCrop((c) => zoomBy(photo, c, 1.1))
    } else if (event.key === '-') {
      setCrop((c) => zoomBy(photo, c, 1 / 1.1))
    }
  }

  // photo pixels -> screen pixels, then place the photo so the crop center is the box center
  const scale = box / sideAt(photo, crop.zoom)
  const left = box / 2 - crop.cx * scale
  const top = box / 2 - crop.cy * scale

  return (
    <div>
      <div
        ref={boxRef}
        tabIndex={0}
        role="group"
        aria-label="Photo position. Drag to move, pinch to zoom. With a keyboard: arrow keys move, plus and minus zoom."
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={up}
        onKeyDown={key}
        className="relative aspect-square w-full cursor-grab touch-none overflow-hidden rounded-2xl bg-black select-none active:cursor-grabbing"
      >
        {box > 0 && (
          <img
            src={photo.url}
            alt=""
            draggable={false}
            className="pointer-events-none absolute top-0 left-0 max-w-none origin-top-left"
            style={{
              width: photo.width,
              height: photo.height,
              transform: `translate3d(${left}px, ${top}px, 0) scale(${scale})`,
            }}
          />
        )}
        {/* dim everything outside the circle; the huge shadow is cut off by the box */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 rounded-full shadow-[0_0_0_9999px_rgb(0_0_0/0.55)] ring-2 ring-white/80 ring-inset"
        />
      </div>

      <p className="mt-3 text-center text-[13px] text-ink-2">Drag to move. Pinch or use the slider to zoom.</p>

      <div className="mt-2 flex items-center gap-2">
        <button
          type="button"
          aria-label="Zoom out"
          onClick={() => setCrop((c) => zoomBy(photo, c, 1 / 1.2))}
          className="flex size-11 shrink-0 items-center justify-center rounded-full text-ink-2 hover:text-ink"
        >
          <ZoomOut size={20} />
        </button>
        <input
          type="range"
          aria-label="Zoom"
          min={MIN_ZOOM}
          max={MAX_ZOOM}
          step={0.01}
          value={crop.zoom}
          onChange={(event) => setCrop((c) => zoomBy(photo, c, Number(event.target.value) / c.zoom))}
          className="h-11 min-w-0 flex-1 accent-[var(--ink)]"
        />
        <button
          type="button"
          aria-label="Zoom in"
          onClick={() => setCrop((c) => zoomBy(photo, c, 1.2))}
          className="flex size-11 shrink-0 items-center justify-center rounded-full text-ink-2 hover:text-ink"
        >
          <ZoomIn size={20} />
        </button>
      </div>

      <div className="mt-4 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button variant="ghost" onClick={onCancel} disabled={busy}>
          Cancel
        </Button>
        <Button onClick={() => onDone(crop)} loading={busy}>
          Use this photo
        </Button>
      </div>
    </div>
  )
}
