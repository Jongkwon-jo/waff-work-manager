import { collection, getDocs, query, where } from "firebase/firestore"
import { db } from "./firebase"

export type TaskChildPresence = "has-children" | "leaf" | "unknown"

const PARENT_ID_FIELDS = ["parentId", "parent_id", "parentTaskId", "parent_task_id"] as const
const QUERY_CHUNK_SIZE = 30

const presenceCache = new Map<string, TaskChildPresence>()
const pendingByKey = new Map<string, Promise<void>>()

function cacheKey(collectionName: string, taskId: string) {
  return `${collectionName}:${taskId}`
}

function uniqueTaskIds(taskIds: string[]) {
  return Array.from(new Set(taskIds.map((taskId) => taskId.trim()).filter(Boolean)))
}

function chunkValues<T>(values: T[], size: number): T[][] {
  const chunks: T[][] = []
  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size))
  }
  return chunks
}

async function loadChildPresenceChunk(collectionName: string, taskIds: string[]) {
  const childParentIds = new Set<string>()
  const candidateParentIds = new Set(taskIds)

  try {
    const snapshots = await Promise.all(
      PARENT_ID_FIELDS.map((field) =>
        getDocs(query(collection(db, collectionName), where(field, "in", taskIds))),
      ),
    )

    snapshots.forEach((snapshot) => {
      snapshot.docs.forEach((docSnap) => {
        const raw = docSnap.data()
        PARENT_ID_FIELDS.forEach((field) => {
          const parentId = typeof raw[field] === "string" ? raw[field].trim() : ""
          if (parentId && candidateParentIds.has(parentId)) childParentIds.add(parentId)
        })
      })
    })

    taskIds.forEach((taskId) => {
      presenceCache.set(cacheKey(collectionName, taskId), childParentIds.has(taskId) ? "has-children" : "leaf")
    })
  } catch (error) {
    console.error(`Task child presence lookup failed for ${collectionName}:`, error)
    taskIds.forEach((taskId) => {
      presenceCache.set(cacheKey(collectionName, taskId), "unknown")
    })
  }
}

/**
 * Resolves whether task documents have children once per browser module session.
 * Unknown results are cached as well so a failing lookup cannot create a retry loop.
 */
export async function resolveTaskChildPresenceOnce(
  collectionName: string,
  taskIds: string[],
): Promise<Map<string, TaskChildPresence>> {
  const uniqueIds = uniqueTaskIds(taskIds)
  const missingIds = uniqueIds.filter((taskId) => {
    const key = cacheKey(collectionName, taskId)
    return !presenceCache.has(key) && !pendingByKey.has(key)
  })

  chunkValues(missingIds, QUERY_CHUNK_SIZE).forEach((chunk) => {
    const pending = loadChildPresenceChunk(collectionName, chunk).finally(() => {
      chunk.forEach((taskId) => pendingByKey.delete(cacheKey(collectionName, taskId)))
    })
    chunk.forEach((taskId) => pendingByKey.set(cacheKey(collectionName, taskId), pending))
  })

  await Promise.all(
    uniqueIds.map((taskId) => pendingByKey.get(cacheKey(collectionName, taskId)) || Promise.resolve()),
  )

  return new Map(
    uniqueIds.map((taskId) => [
      taskId,
      presenceCache.get(cacheKey(collectionName, taskId)) || "unknown",
    ]),
  )
}
