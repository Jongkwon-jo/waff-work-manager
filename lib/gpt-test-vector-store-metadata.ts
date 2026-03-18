import { collection, deleteDoc, doc, getDocs, serverTimestamp, setDoc } from "firebase/firestore"

import { db } from "./firebase"

const GPT_TEST_VECTOR_STORES_COLLECTION = "gpt_test_vector_stores"

export type GptTestVectorStoreMetadata = {
  vectorStoreId: string
  name: string
  filenames: string[]
  savedAt?: Date
}

export async function fetchGptTestVectorStoreMetadata(): Promise<Record<string, GptTestVectorStoreMetadata>> {
  const snapshot = await getDocs(collection(db, GPT_TEST_VECTOR_STORES_COLLECTION))

  return Object.fromEntries(
    snapshot.docs.map((docSnap) => {
      const raw = docSnap.data() as {
        vectorStoreId?: unknown
        name?: unknown
        filenames?: unknown
        savedAt?: { toDate?: () => Date }
      }

      const vectorStoreId =
        typeof raw.vectorStoreId === "string" && raw.vectorStoreId.trim().length > 0 ? raw.vectorStoreId.trim() : docSnap.id
      const filenames = Array.isArray(raw.filenames)
        ? raw.filenames.filter((value): value is string => typeof value === "string" && value.trim().length > 0)
        : []
      const name = typeof raw.name === "string" && raw.name.trim().length > 0 ? raw.name.trim() : "이름 없는 벡터 스토어"

      return [
        vectorStoreId,
        {
          vectorStoreId,
          name,
          filenames,
          savedAt: raw.savedAt?.toDate?.(),
        } satisfies GptTestVectorStoreMetadata,
      ]
    }),
  )
}

export async function saveGptTestVectorStoreMetadata(input: {
  vectorStoreId: string
  name: string
  filenames: string[]
}): Promise<void> {
  const vectorStoreId = input.vectorStoreId.trim()
  if (!vectorStoreId) return

  const filenames = input.filenames.map((filename) => filename.trim()).filter(Boolean)

  await setDoc(
    doc(db, GPT_TEST_VECTOR_STORES_COLLECTION, vectorStoreId),
    {
      vectorStoreId,
      name: input.name.trim() || "이름 없는 벡터 스토어",
      filenames,
      savedAt: serverTimestamp(),
    },
    { merge: true },
  )
}

export async function deleteGptTestVectorStoreMetadata(vectorStoreId: string): Promise<void> {
  const normalizedId = vectorStoreId.trim()
  if (!normalizedId) return

  await deleteDoc(doc(db, GPT_TEST_VECTOR_STORES_COLLECTION, normalizedId))
}
