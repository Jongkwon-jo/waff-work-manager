import type { Project } from "./data"

export function compareProjectDisplayOrder(a: Project, b: Project): number {
  const orderA = typeof a.displayOrder === "number" ? a.displayOrder : Number.MAX_SAFE_INTEGER
  const orderB = typeof b.displayOrder === "number" ? b.displayOrder : Number.MAX_SAFE_INTEGER
  if (orderA !== orderB) return orderA - orderB
  const timeA = a.createdAt ? new Date(a.createdAt).getTime() : 0
  const timeB = b.createdAt ? new Date(b.createdAt).getTime() : 0
  return (timeA - timeB) || a.id.localeCompare(b.id)
}

/** Preserve the base order and place new projects after their saved anchor. Manual order wins. */
export function applyProjectInsertions(
  sortedProjects: Project[],
  personallyOrderedIds?: ReadonlyMap<string, number>,
): Project[] {
  const projectIds = new Set(sortedProjects.map(({ id }) => id))
  const roots: Project[] = []
  const childrenByAnchor = new Map<string | null, Project[]>()

  for (const project of sortedProjects) {
    const anchor = project.insertAfterProjectId
    if (anchor === undefined || project.displayOrder !== undefined || personallyOrderedIds?.has(project.id)) {
      roots.push(project)
      continue
    }

    const anchorId = anchor && anchor !== project.id && projectIds.has(anchor) ? anchor : null
    const children = childrenByAnchor.get(anchorId) ?? []
    children.push(project)
    childrenByAnchor.set(anchorId, children)
  }

  if (roots.length === sortedProjects.length) return sortedProjects

  // Later insertions are closest to a shared anchor. End-of-list insertions append in creation order.
  for (const [anchor, children] of childrenByAnchor) {
    children.sort(anchor === null ? compareProjectDisplayOrder : (a, b) => compareProjectDisplayOrder(b, a))
  }

  const ordered: Project[] = []
  const seen = new Set<string>()
  const appendBranch = (root: Project) => {
    const pending = [root]
    while (pending.length > 0) {
      const project = pending.pop()!
      if (seen.has(project.id)) continue
      seen.add(project.id)
      ordered.push(project)
      const children = childrenByAnchor.get(project.id) ?? []
      for (let index = children.length - 1; index >= 0; index--) pending.push(children[index])
    }
  }

  roots.forEach(appendBranch)
  childrenByAnchor.get(null)?.forEach(appendBranch)
  // Keep every project visible even if stored anchors form a cycle.
  if (ordered.length < sortedProjects.length) sortedProjects.forEach(appendBranch)
  return ordered
}

/** Replace the order of the supplied IDs without moving IDs outside that scope. */
export function mergeProjectOrder(projectIds: readonly string[], orderedIds: readonly string[]): string[] {
  const knownIds = new Set(projectIds)
  const orderedIdSet = new Set(orderedIds)
  const allIds = [...projectIds, ...orderedIds.filter((id) => !knownIds.has(id))]
  let nextIndex = 0
  return allIds.map((id) => (orderedIdSet.has(id) ? orderedIds[nextIndex++] : id))
}

export type ProjectMove = "up" | "down" | { targetProjectId: string; position: "before" | "after" }

export function moveProjectInOrder(
  projectIds: readonly string[],
  projectId: string,
  move: ProjectMove,
  visibleProjectIds: readonly string[] = projectIds,
): string[] | null {
  const availableIds = new Set(projectIds)
  const visibleIds = visibleProjectIds.filter((id) => availableIds.has(id))
  const currentIndex = visibleIds.indexOf(projectId)
  if (currentIndex === -1) return null

  let destinationIndex: number
  if (typeof move === "string") {
    destinationIndex = currentIndex + (move === "up" ? -1 : 1)
  } else {
    const targetIndex = visibleIds.indexOf(move.targetProjectId)
    if (targetIndex === -1 || targetIndex === currentIndex) return null

    const insertionIndex = targetIndex + (move.position === "after" ? 1 : 0)
    destinationIndex = insertionIndex - (currentIndex < insertionIndex ? 1 : 0)
  }
  if (destinationIndex < 0 || destinationIndex >= visibleIds.length || destinationIndex === currentIndex) return null

  visibleIds.splice(currentIndex, 1)
  visibleIds.splice(destinationIndex, 0, projectId)
  return mergeProjectOrder(projectIds, visibleIds)
}

export function applyProjectDisplayOrder(projects: Project[], orderById: ReadonlyMap<string, number>): Project[] {
  let changed = false
  const next = projects.map((project) => {
    const displayOrder = orderById.get(project.id)
    if (displayOrder === undefined || displayOrder === project.displayOrder) return project
    changed = true
    return { ...project, displayOrder }
  })
  return changed ? next : projects
}
