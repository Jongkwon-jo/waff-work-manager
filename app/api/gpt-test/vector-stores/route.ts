import { NextResponse } from "next/server"

type OpenAIFileResponse = {
  id?: string
  filename?: string
  error?: {
    message?: string
  }
}

type VectorStoreResponse = {
  id?: string
  name?: string | null
  status?: string
  file_counts?: {
    completed?: number
    failed?: number
    in_progress?: number
    total?: number
  }
  created_at?: number
  usage_bytes?: number
  error?: {
    message?: string
  }
}

type VectorStoreListResponse = {
  data?: VectorStoreResponse[]
  error?: {
    message?: string
  }
}

type VectorStoreDeleteResponse = {
  id?: string
  deleted?: boolean
  error?: {
    message?: string
  }
}

const OPENAI_BETA_HEADER = {
  "OpenAI-Beta": "assistants=v2",
}

const jsonHeaders = (apiKey: string) => ({
  Authorization: `Bearer ${apiKey}`,
  "Content-Type": "application/json",
  ...OPENAI_BETA_HEADER,
})

async function uploadOpenAIFile(apiKey: string, file: File) {
  const uploadForm = new FormData()
  uploadForm.append("purpose", "user_data")
  uploadForm.append("file", file, file.name)

  const uploadResponse = await fetch("https://api.openai.com/v1/files", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
    body: uploadForm,
  })

  const uploadedFile = (await uploadResponse.json()) as OpenAIFileResponse

  if (!uploadResponse.ok || !uploadedFile.id) {
    throw new Error(uploadedFile.error?.message || `PDF 업로드에 실패했습니다: ${file.name}`)
  }

  return uploadedFile
}

async function fetchVectorStore(apiKey: string, vectorStoreId: string) {
  const response = await fetch(`https://api.openai.com/v1/vector_stores/${vectorStoreId}`, {
    headers: jsonHeaders(apiKey),
  })

  const data = (await response.json()) as VectorStoreResponse

  if (!response.ok) {
    throw new Error(data.error?.message || "벡터 스토어 상태를 확인하지 못했습니다.")
  }

  return data
}

async function waitForVectorStore(apiKey: string, vectorStoreId: string) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const store = await fetchVectorStore(apiKey, vectorStoreId)
    const status = store.status || "unknown"

    if (status === "completed") return store
    if (status === "expired" || status === "failed" || (store.file_counts?.failed || 0) > 0) {
      throw new Error("벡터 스토어 생성에 실패했습니다.")
    }

    await new Promise((resolve) => setTimeout(resolve, 1500))
  }

  throw new Error("벡터 스토어 준비 시간이 초과되었습니다. 잠시 후 다시 시도해 주세요.")
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const apiKey = searchParams.get("apiKey")?.trim()

  if (!apiKey) {
    return NextResponse.json({ error: "OpenAI API 키가 필요합니다." }, { status: 400 })
  }

  const response = await fetch("https://api.openai.com/v1/vector_stores?limit=100&order=desc", {
    headers: jsonHeaders(apiKey),
  })

  const data = (await response.json()) as VectorStoreListResponse

  if (!response.ok) {
    return NextResponse.json(
      { error: data.error?.message || "벡터 스토어 목록을 불러오지 못했습니다." },
      { status: response.status },
    )
  }

  return NextResponse.json({
    stores: (data.data || []).map((store) => ({
      id: store.id || "",
      name: store.name || "이름 없는 벡터 스토어",
      status: store.status || "unknown",
      fileCounts: store.file_counts || {},
      createdAt: store.created_at || null,
      usageBytes: store.usage_bytes || 0,
    })),
  })
}

export async function POST(request: Request) {
  try {
    const formData = await request.formData()
    const apiKey = String(formData.get("apiKey") || "").trim()
    const name = String(formData.get("name") || "").trim()
    const files = formData.getAll("files").filter((value): value is File => value instanceof File)
    const fallbackFile = formData.get("file")
    const uploadFiles = files.length > 0 ? files : fallbackFile instanceof File ? [fallbackFile] : []

    if (!apiKey) {
      return NextResponse.json({ error: "OpenAI API 키가 필요합니다." }, { status: 400 })
    }

    if (uploadFiles.length === 0) {
      return NextResponse.json({ error: "업로드할 PDF 파일이 필요합니다." }, { status: 400 })
    }

    const uploadedFiles = await Promise.all(uploadFiles.map((file) => uploadOpenAIFile(apiKey, file)))
    const uploadedFileIds = uploadedFiles
      .map((uploadedFile) => uploadedFile.id)
      .filter((id): id is string => typeof id === "string" && id.length > 0)

    const vectorStoreResponse = await fetch("https://api.openai.com/v1/vector_stores", {
      method: "POST",
      headers: jsonHeaders(apiKey),
      body: JSON.stringify({
        name:
          name ||
          (uploadFiles.length === 1
            ? uploadFiles[0].name.replace(/\.pdf$/i, "")
            : `${uploadFiles[0].name.replace(/\.pdf$/i, "")} 외 ${uploadFiles.length - 1}건`),
        file_ids: uploadedFileIds,
      }),
    })

    const vectorStore = (await vectorStoreResponse.json()) as VectorStoreResponse

    if (!vectorStoreResponse.ok || !vectorStore.id) {
      return NextResponse.json(
        { error: vectorStore.error?.message || "벡터 스토어 생성에 실패했습니다." },
        { status: vectorStoreResponse.status || 500 },
      )
    }

    const completedStore = await waitForVectorStore(apiKey, vectorStore.id)

    return NextResponse.json({
      store: {
        id: completedStore.id || vectorStore.id,
        name: completedStore.name || name || uploadFiles[0].name,
        status: completedStore.status || "completed",
        fileCounts: completedStore.file_counts || {},
        createdAt: completedStore.created_at || null,
        usageBytes: completedStore.usage_bytes || 0,
        filename: uploadedFiles[0]?.filename || uploadFiles[0].name,
      },
      fileCount: uploadFiles.length,
      filenames: uploadedFiles
        .map((uploadedFile, index) => uploadedFile.filename || uploadFiles[index]?.name)
        .filter((filename): filename is string => typeof filename === "string" && filename.length > 0),
    })
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "벡터 스토어 생성 중 오류가 발생했습니다.",
      },
      { status: 500 },
    )
  }
}

export async function DELETE(request: Request) {
  try {
    const body = (await request.json()) as {
      apiKey?: string
      vectorStoreId?: string
    }

    const apiKey = body.apiKey?.trim()
    const vectorStoreId = body.vectorStoreId?.trim()

    if (!apiKey) {
      return NextResponse.json({ error: "OpenAI API 키가 필요합니다." }, { status: 400 })
    }

    if (!vectorStoreId) {
      return NextResponse.json({ error: "삭제할 벡터 스토어 ID가 필요합니다." }, { status: 400 })
    }

    const response = await fetch(`https://api.openai.com/v1/vector_stores/${vectorStoreId}`, {
      method: "DELETE",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        ...OPENAI_BETA_HEADER,
      },
    })

    const data = (await response.json()) as VectorStoreDeleteResponse

    if (!response.ok || !data.deleted) {
      return NextResponse.json(
        { error: data.error?.message || "벡터 스토어 삭제에 실패했습니다." },
        { status: response.status || 500 },
      )
    }

    return NextResponse.json({
      id: data.id || vectorStoreId,
      deleted: true,
    })
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "벡터 스토어 삭제 중 오류가 발생했습니다.",
      },
      { status: 500 },
    )
  }
}
