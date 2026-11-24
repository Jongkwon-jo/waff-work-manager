import { useEffect, useRef, useState, type PointerEvent } from "react"
import type { ProjectMove } from "@/lib/project-order"

type ProjectDrop = Exclude<ProjectMove, string>

type ProjectDrag = {
  projectId: string
  pointerId: number
  container: HTMLDivElement
  topInset: number
  startY: number
  hasMoved: boolean
  x: number
  y: number
}

function getDropTarget(drag: ProjectDrag): ProjectDrop | null {
  const row = document.elementFromPoint(drag.x, drag.y)?.closest<HTMLElement>("[data-gantt-project-id]")
  const targetProjectId = row?.dataset.ganttProjectId
  if (!row || !targetProjectId || targetProjectId === drag.projectId || !drag.container.contains(row)) return null

  const rect = row.getBoundingClientRect()
  return { targetProjectId, position: drag.y < rect.top + rect.height / 2 ? "before" : "after" }
}

export function useProjectDrag(onDrop: (projectId: string, target: ProjectDrop) => void, disabled: boolean) {
  const dragRef = useRef<ProjectDrag | null>(null)
  const frameRef = useRef<number | null>(null)
  const [sourceId, setSourceId] = useState<string | null>(null)
  const [target, setTarget] = useState<ProjectDrop | null>(null)

  useEffect(() => () => {
    if (frameRef.current !== null) cancelAnimationFrame(frameRef.current)
  }, [])

  const clearDrag = () => {
    const drag = dragRef.current
    dragRef.current = null
    if (frameRef.current !== null) cancelAnimationFrame(frameRef.current)
    frameRef.current = null
    if (drag?.container.hasPointerCapture(drag.pointerId)) drag.container.releasePointerCapture(drag.pointerId)
    setSourceId(null)
    setTarget(null)
  }

  const updateDrag = () => {
    const drag = dragRef.current
    if (!drag) return
    if (!drag.container.isConnected) {
      clearDrag()
      return
    }

    const bounds = drag.container.getBoundingClientRect()
    const top = bounds.top + drag.topInset
    if (drag.hasMoved && drag.x >= bounds.left && drag.x <= bounds.right) {
      const edgeSize = 32
      if (drag.y >= bounds.top && drag.y < top + edgeSize) {
        drag.container.scrollTop -= 10
      } else if (drag.y <= bounds.bottom && drag.y > bounds.bottom - edgeSize) {
        drag.container.scrollTop += 10
      }
    }

    const next = drag.hasMoved ? getDropTarget(drag) : null
    setTarget((prev) => prev?.targetProjectId === next?.targetProjectId && prev?.position === next?.position ? prev : next)
    frameRef.current = requestAnimationFrame(updateDrag)
  }

  const start = (event: PointerEvent<HTMLButtonElement>, projectId: string, container: HTMLDivElement | null, topInset = 0) => {
    if (disabled || !container || dragRef.current || !event.isPrimary || event.button !== 0) return
    event.preventDefault()
    container.setPointerCapture(event.pointerId)
    dragRef.current = {
      projectId, container, topInset, pointerId: event.pointerId,
      x: event.clientX, y: event.clientY, startY: event.clientY, hasMoved: false,
    }
    setSourceId(projectId)
    frameRef.current = requestAnimationFrame(updateDrag)
  }

  const track = (event: PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current
    if (!drag || event.pointerId !== drag.pointerId) return
    drag.x = event.clientX
    drag.y = event.clientY
    drag.hasMoved ||= Math.abs(drag.y - drag.startY) >= 4
    return drag
  }

  const cancel = (event: PointerEvent<HTMLDivElement>) => {
    if (dragRef.current?.pointerId === event.pointerId) clearDrag()
  }

  return {
    sourceId,
    target,
    disabled,
    start,
    containerHandlers: {
      onPointerMove: track,
      onPointerUp: (event: PointerEvent<HTMLDivElement>) => {
        const drag = track(event)
        if (!drag) return
        const destination = drag.hasMoved ? getDropTarget(drag) : null
        clearDrag()
        if (destination && !disabled) onDrop(drag.projectId, destination)
      },
      onPointerCancel: cancel,
      onLostPointerCapture: (event: PointerEvent<HTMLDivElement>) => {
        if (event.target === event.currentTarget) cancel(event)
      },
    },
  }
}
