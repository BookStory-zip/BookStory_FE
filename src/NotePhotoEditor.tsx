import { useEffect, useId, useRef, useState } from 'react'
import type { CSSProperties, KeyboardEvent, PointerEvent } from 'react'
import { croppedPhoto, drawPhoto, drawStrokes, editCrop, rotateCrop, rotateStrokes, FULL_CROP } from './lib/photo'
import type { Crop, CropAction, Point, Stroke } from './lib/photo'

type Props = { file: File; onConfirm: (file: File) => void; onCancel: () => void }
type Drag = { crop: Crop; start: Point; action: CropAction | 'ink'; pointerId: number; changed: boolean }
type Edit = { crop: Crop; turns: number; strokes: Stroke[] }
const corners = [['nw', '왼쪽 위'], ['ne', '오른쪽 위'], ['sw', '왼쪽 아래'], ['se', '오른쪽 아래']] as const

export default function NotePhotoEditor({ file, onConfirm, onCancel }: Props) {
  const id = useId()
  const dialog = useRef<HTMLDialogElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const ink = useRef<HTMLCanvasElement>(null)
  const image = useRef<HTMLImageElement | null>(null)
  const active = useRef(false)
  const busy = useRef(false)
  const drag = useRef<Drag | null>(null)
  const [crop, setCrop] = useState<Crop>(FULL_CROP)
  const [turns, setTurns] = useState(0)
  const [ratio, setRatio] = useState(1)
  const [ready, setReady] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [tool, setTool] = useState<'crop' | 'pen' | 'highlighter'>('crop')
  const [strokes, setStrokes] = useState<Stroke[]>([])
  const [history, setHistory] = useState<Edit[]>([])
  const [color, setColor] = useState('#222222')
  const [width, setWidth] = useState(5)

  useEffect(() => {
    if (!ready || !canvas.current || !ink.current) return
    ink.current.width = canvas.current.width
    ink.current.height = canvas.current.height
    const context = ink.current.getContext('2d')
    if (context) drawStrokes(context, ink.current.width, ink.current.height, strokes)
  }, [ready, strokes, turns])

  const remember = () => setHistory((previous) => [...previous, { crop, turns, strokes }])

  useEffect(() => {
    active.current = true
    const element = dialog.current!
    if (typeof element.showModal === 'function') element.showModal()
    else element.setAttribute('open', '')
    const photo = new Image()
    const url = URL.createObjectURL(file)
    photo.onload = () => {
      if (!active.current || !canvas.current) return
      if (photo.naturalWidth * photo.naturalHeight > 40_000_000) {
        setError('4천만 화소 이하의 사진을 선택해주세요.')
        return
      }
      try {
        drawPhoto(canvas.current, photo, 0)
        image.current = photo
        setRatio(canvas.current.width / canvas.current.height)
        setReady(true)
      } catch (failure) { setError((failure as Error).message) }
    }
    photo.onerror = () => { if (active.current) setError('사진을 읽을 수 없어요. JPEG, PNG 또는 WebP 사진을 다시 선택해주세요.') }
    photo.src = url
    return () => {
      active.current = false
      photo.onload = null
      photo.onerror = null
      photo.src = ''
      image.current = null
      URL.revokeObjectURL(url)
    }
  }, [file])

  function rotate() {
    if (!image.current || !canvas.current || busy.current) return
    const next = (turns + 1) % 4
    remember()
    drawPhoto(canvas.current, image.current, next)
    setTurns(next)
    setRatio(canvas.current.width / canvas.current.height)
    setCrop(rotateCrop(crop))
    setStrokes(rotateStrokes(strokes))
  }

  function undo() {
    const previous = history.at(-1)
    if (!previous || !image.current || !canvas.current || busy.current) return
    drawPhoto(canvas.current, image.current, previous.turns)
    setRatio(canvas.current.width / canvas.current.height)
    setCrop(previous.crop)
    setTurns(previous.turns)
    setStrokes(previous.strokes)
    setHistory(history.slice(0, -1))
  }

  function point(event: PointerEvent<HTMLDivElement>): Point {
    const rect = event.currentTarget.getBoundingClientRect()
    return { x: Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)), y: Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height)) }
  }

  function begin(event: PointerEvent<HTMLDivElement>) {
    if (!ready || busy.current || event.button !== 0 || !event.isPrimary) return
    let action = (event.target as HTMLElement).closest<HTMLElement>('[data-crop-action]')?.dataset.cropAction as CropAction | undefined
    if (action === 'move' && crop.width === 1 && crop.height === 1) action = 'draw'
    const start = point(event)
    drag.current = { crop, start, action: tool === 'crop' ? action ?? 'draw' : 'ink', pointerId: event.pointerId, changed: tool !== 'crop' }
    if (tool !== 'crop') {
      remember()
      setStrokes([...strokes, { kind: tool, color, width: width / 1000, points: [start] }])
    }
    event.currentTarget.setPointerCapture(event.pointerId)
    event.preventDefault()
  }

  function move(event: PointerEvent<HTMLDivElement>) {
    const current = drag.current
    if (!current || current.pointerId !== event.pointerId) return
    const end = point(event)
    if (current.action === 'ink') {
      setStrokes((previous) => previous.map((stroke, index) => index === previous.length - 1 ? { ...stroke, points: [...stroke.points, end] } : stroke))
      return
    }
    if (!current.changed) {
      if (Math.hypot(end.x - current.start.x, end.y - current.start.y) < .005) return
      current.changed = true
      remember()
    }
    setCrop(editCrop(current.crop, current.start, end, current.action))
  }

  function finish(event: PointerEvent<HTMLDivElement>) {
    if (drag.current?.pointerId !== event.pointerId) return
    move(event)
    drag.current = null
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
  }

  function keyboard(event: KeyboardEvent<HTMLDivElement>) {
    if (!ready || busy.current || !event.key.startsWith('Arrow')) return
    event.preventDefault()
    remember()
    const end = { x: event.key === 'ArrowLeft' ? -.01 : event.key === 'ArrowRight' ? .01 : 0, y: event.key === 'ArrowUp' ? -.01 : event.key === 'ArrowDown' ? .01 : 0 }
    setCrop(editCrop(crop, { x: 0, y: 0 }, end, event.shiftKey ? 'se' : 'move'))
  }

  async function confirm() {
    if (!ready || !image.current || busy.current) return
    busy.current = true
    setSaving(true)
    setError('')
    try {
      const result = await croppedPhoto(image.current, turns, crop, file.name, strokes)
      if (active.current) onConfirm(result)
    } catch { if (active.current) setError('사진을 편집하지 못했어요. 다시 시도해주세요.') }
    finally { busy.current = false; if (active.current) setSaving(false) }
  }

  return <dialog ref={dialog} className="photo-editor-dialog" aria-labelledby={`${id}-title`} aria-describedby={`${id}-hint`}
    onCancel={(event) => { event.preventDefault(); if (!busy.current) onCancel() }}>
    <h2 id={`${id}-title`}>사진 편집</h2>
    <p id={`${id}-hint`} className="result-note">{tool === 'crop' ? '문구가 담긴 영역을 드래그해 선택하세요. 모서리로 크기를 조절할 수 있어요.' : '사진 위에 직접 그려보세요. 강조 표시도 사진에 함께 저장돼요.'}</p>
    <div className="photo-editor-tools" role="group" aria-label="사진 편집 도구">
      {([['crop', '자르기'], ['pen', '펜'], ['highlighter', '형광펜']] as const).map(([value, label]) => <button type="button" key={value} className="secondary" aria-pressed={tool === value} disabled={!ready || saving}
        onClick={() => { setTool(value); if (value !== 'crop') { setColor(value === 'pen' ? '#222222' : '#ffdf00'); setWidth(value === 'pen' ? 5 : 25) } }}>{label}</button>)}
      <button type="button" className="link-button" disabled={!history.length || saving} onClick={undo}>되돌리기</button>
    </div>
    {!ready && !error && <p role="status">사진을 여는 중…</p>}
    <div className="photo-editor-stage" style={{ aspectRatio: ratio, width: `min(100%, ${ratio * 52}vh)` }}
      onPointerDown={begin} onPointerMove={move} onPointerUp={finish} onPointerCancel={() => { drag.current = null }} onLostPointerCapture={() => { drag.current = null }}>
      <canvas ref={canvas} aria-label="편집할 사진" />
      <canvas ref={ink} className="photo-editor-ink" aria-hidden="true" />
      {ready && tool === 'crop' && <div className="photo-crop" role="button" tabIndex={0} aria-label="자를 영역" aria-describedby={`${id}-keyboard`} data-crop-action="move" onKeyDown={keyboard}
        style={{ left: `${crop.x * 100}%`, top: `${crop.y * 100}%`, width: `${crop.width * 100}%`, height: `${crop.height * 100}%` }}>
        {corners.map(([corner, label]) => <span key={corner} className={`photo-crop-handle ${corner}`} data-crop-action={corner} aria-hidden="true" title={`${label} 조절`} />)}
      </div>}
    </div>
    <span id={`${id}-keyboard`} className="visually-hidden">방향키로 이동하고 Shift와 방향키로 크기를 조절합니다.</span>
    {tool === 'crop' ? <div className="photo-editor-tools">
      <button type="button" className="secondary" disabled={!ready || saving} onClick={rotate}>90도 회전</button>
      <button type="button" className="secondary" disabled={!ready || saving} onClick={() => { remember(); setCrop(FULL_CROP) }}>전체 선택</button>
    </div> : <div className="photo-editor-brush">
      <div role="group" aria-label="펜 색상">{[['#222222', '검정'], ['#e02a36', '빨강'], ['#1968d1', '파랑'], ['#ffdf00', '노랑']].map(([value, label]) => <button type="button" key={value} className="photo-ink-color" aria-label={label} aria-pressed={color === value} disabled={saving} style={{ '--ink-color': value } as CSSProperties} onClick={() => setColor(value)} />)}</div>
      <label>선 굵기<input type="range" min="2" max="60" value={width} disabled={saving} onChange={(event) => setWidth(Number(event.target.value))} /></label>
    </div>}
    {error && <p role="alert">{error}</p>}
    <div className="confirm-actions">
      <button type="button" className="secondary" disabled={saving} onClick={onCancel}>취소</button>
      <button type="button" disabled={!ready || saving} onClick={() => void confirm()}>{saving ? '사진 처리 중…' : '이 사진 사용'}</button>
    </div>
  </dialog>
}
