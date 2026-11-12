export type Point = { x: number; y: number }
export type Crop = Point & { width: number; height: number }
export type CropAction = 'draw' | 'move' | 'nw' | 'ne' | 'sw' | 'se'
export type Stroke = { kind: 'pen' | 'highlighter'; color: string; width: number; points: Point[] }
export const FULL_CROP: Crop = { x: 0, y: 0, width: 1, height: 1 }
const MIN_SIZE = .02
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value))

export function editCrop(crop: Crop, start: Point, end: Point, action: CropAction): Crop {
  const dx = end.x - start.x, dy = end.y - start.y
  if (action === 'move') return { ...crop, x: clamp(crop.x + dx, 0, 1 - crop.width), y: clamp(crop.y + dy, 0, 1 - crop.height) }
  if (action === 'draw') {
    const x = clamp(Math.min(start.x, end.x), 0, 1 - MIN_SIZE)
    const y = clamp(Math.min(start.y, end.y), 0, 1 - MIN_SIZE)
    return { x, y, width: clamp(Math.abs(dx), MIN_SIZE, 1 - x), height: clamp(Math.abs(dy), MIN_SIZE, 1 - y) }
  }
  let left = crop.x, top = crop.y, right = left + crop.width, bottom = top + crop.height
  if (action.includes('w')) left = clamp(left + dx, 0, right - MIN_SIZE)
  if (action.includes('e')) right = clamp(right + dx, left + MIN_SIZE, 1)
  if (action.includes('n')) top = clamp(top + dy, 0, bottom - MIN_SIZE)
  if (action.includes('s')) bottom = clamp(bottom + dy, top + MIN_SIZE, 1)
  return { x: left, y: top, width: right - left, height: bottom - top }
}

export function photoDimensions(width: number, height: number, turns: number, crop = FULL_CROP) {
  const w = (turns % 2 ? height : width) * crop.width, h = (turns % 2 ? width : height) * crop.height
  const scale = Math.min(1, 2048 / Math.max(w, h))
  return { width: Math.max(1, Math.round(w * scale)), height: Math.max(1, Math.round(h * scale)) }
}

export const rotateStrokes = (strokes: Stroke[]): Stroke[] => strokes.map((stroke) => ({ ...stroke, points: stroke.points.map(({ x, y }) => ({ x: 1 - y, y: x })) }))
export const rotateCrop = (crop: Crop): Crop => ({ x: Math.max(0, 1 - crop.y - crop.height), y: crop.x, width: crop.height, height: crop.width })

export function drawStrokes(context: CanvasRenderingContext2D, width: number, height: number, strokes: Stroke[]) {
  context.save()
  context.lineCap = 'round'
  context.lineJoin = 'round'
  for (const stroke of strokes) {
    if (!stroke.points.length) continue
    context.globalAlpha = stroke.kind === 'highlighter' ? .35 : 1
    context.strokeStyle = stroke.color
    context.lineWidth = Math.min(width, height) * stroke.width
    context.beginPath()
    context.moveTo(stroke.points[0].x * width, stroke.points[0].y * height)
    for (const point of stroke.points.slice(1)) context.lineTo(point.x * width, point.y * height)
    if (stroke.points.length === 1) context.lineTo(stroke.points[0].x * width + .01, stroke.points[0].y * height)
    context.stroke()
  }
  context.restore()
}

export function drawPhoto(canvas: HTMLCanvasElement, image: HTMLImageElement, turns: number) {
  const size = photoDimensions(image.naturalWidth, image.naturalHeight, turns)
  canvas.width = size.width
  canvas.height = size.height
  const context = canvas.getContext('2d')
  if (!context) throw new Error('이 브라우저에서는 사진을 편집할 수 없어요.')
  context.fillStyle = '#fff'
  context.fillRect(0, 0, size.width, size.height)
  context.translate(size.width / 2, size.height / 2)
  context.rotate(turns * Math.PI / 2)
  const width = turns % 2 ? size.height : size.width, height = turns % 2 ? size.width : size.height
  context.drawImage(image, -width / 2, -height / 2, width, height)
}

export function croppedPhoto(image: HTMLImageElement, turns: number, crop: Crop, name: string, strokes: Stroke[]): Promise<File> {
  const width = turns % 2 ? image.naturalHeight : image.naturalWidth
  const height = turns % 2 ? image.naturalWidth : image.naturalHeight
  const canvas = document.createElement('canvas')
  const size = photoDimensions(image.naturalWidth, image.naturalHeight, turns, crop)
  canvas.width = size.width
  canvas.height = size.height
  const context = canvas.getContext('2d')
  if (!context) return Promise.reject(new Error('사진을 편집하지 못했어요. 다시 시도해주세요.'))
  context.fillStyle = '#fff'
  context.fillRect(0, 0, canvas.width, canvas.height)
  context.save()
  context.scale(canvas.width / (width * crop.width), canvas.height / (height * crop.height))
  context.translate(-width * crop.x, -height * crop.y)
  context.save()
  context.translate(width / 2, height / 2)
  context.rotate(turns * Math.PI / 2)
  context.drawImage(image, -image.naturalWidth / 2, -image.naturalHeight / 2)
  context.restore()
  drawStrokes(context, width, height, strokes)
  context.restore()
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) { reject(new Error('사진을 편집하지 못했어요. 다시 시도해주세요.')); return }
      resolve(new File([blob], `${name.replace(/\.[^.]+$/, '') || 'note'}.jpg`, { type: 'image/jpeg' }))
    }, 'image/jpeg', .92)
  })
}
