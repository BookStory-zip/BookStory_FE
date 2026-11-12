import { expect, test } from 'vitest'
import { editCrop, photoDimensions, rotateCrop, rotateStrokes, drawStrokes } from './photo'

const full = { x: 0, y: 0, width: 1, height: 1 }

test('영역은 양 방향으로 선택할 수 있고 사진 밖으로 벗어나지 않는다', () => {
  expect(editCrop(full, { x: .8, y: .7 }, { x: .2, y: .3 }, 'draw')).toEqual({ x: .2, y: .3, width: expect.closeTo(.6), height: expect.closeTo(.4) })
  expect(editCrop(full, { x: 0, y: 0 }, { x: 2, y: 2 }, 'draw')).toEqual(full)
})

test('영역 이동과 모서리 크기 조절은 최소 영역과 사진 경계를 지킨다', () => {
  const crop = { x: .2, y: .2, width: .4, height: .3 }
  expect(editCrop(crop, { x: .2, y: .2 }, { x: 2, y: 2 }, 'move')).toEqual({ x: .6, y: .7, width: .4, height: .3 })
  const resized = editCrop(crop, { x: .2, y: .2 }, { x: 1, y: 1 }, 'nw')
  expect(resized.width).toBeGreaterThanOrEqual(.02)
  expect(resized.height).toBeGreaterThanOrEqual(.02)
  expect(resized.x + resized.width).toBeCloseTo(.6)
})

test('출력은 긴 변 2048 이하이며 회전 시 가로·세로를 바꾼다', () => {
  expect(photoDimensions(4000, 2000, 0)).toEqual({ width: 2048, height: 1024 })
  expect(photoDimensions(4000, 2000, 1)).toEqual({ width: 1024, height: 2048 })
  expect(photoDimensions(100, 60, 2)).toEqual({ width: 100, height: 60 })
  expect(photoDimensions(4000, 2000, 0, { x: .25, y: .25, width: .25, height: .5 })).toEqual({ width: 1000, height: 1000 })
})

test('필기와 형광펜 좌표도 사진과 함께 회전하고 네 번 회전하면 복원된다', () => {
  const strokes = [{ kind: 'pen' as const, color: '#222', width: .01, points: [{ x: .2, y: .4 }, { x: .7, y: .8 }] }]
  expect(rotateStrokes(strokes)[0].points[0]).toEqual({ x: .6, y: .2 })
  const result = rotateStrokes(rotateStrokes(rotateStrokes(rotateStrokes(strokes))))
  expect(result[0].points[0].x).toBeCloseTo(.2)
  expect(result[0].points[1].y).toBeCloseTo(.8)
})

test('사진 회전은 이미 고른 영역도 함께 회전해 선택을 보존한다', () => {
  expect(rotateCrop({ x: .1, y: .2, width: .3, height: .4 })).toEqual({ x: expect.closeTo(.4), y: .1, width: .4, height: .3 })
})

test('형광펜은 반투명하고 펜은 불투명하며 사진 크기에 맞춰 그린다', () => {
  const calls: number[] = []
  const context = { save() {}, restore() {}, beginPath() {}, moveTo() {}, lineTo() {}, stroke() { calls.push(context.globalAlpha) }, globalAlpha: 1 } as unknown as CanvasRenderingContext2D
  drawStrokes(context, 800, 600, [
    { kind: 'highlighter', color: '#ff0', width: .02, points: [{ x: .1, y: .2 }, { x: .5, y: .2 }] },
    { kind: 'pen', color: '#111', width: .01, points: [{ x: .1, y: .4 }] },
  ])
  expect(calls).toEqual([.35, 1])
  expect(context.lineWidth).toBe(6)
})
