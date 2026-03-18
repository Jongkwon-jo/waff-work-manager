import { NextResponse } from "next/server"

type RequestMessage = {
  role: "user" | "assistant"
  content: string
}

type OpenAIResponse = {
  output_text?: string
  output?: Array<{
    type?: string
    content?: Array<{
      type?: string
      text?: string
      annotations?: Array<{
        type?: string
        file_id?: string
        filename?: string
      }>
    }>
  }>
  included?: Array<{
    type?: string
    results?: Array<{
      file_id?: string
      filename?: string
      score?: number
      content?: Array<{
        type?: string
        text?: string
      }>
    }>
  }>
  usage?: {
    input_tokens?: number
    output_tokens?: number
    total_tokens?: number
  }
  error?: {
    message?: string
  }
}

type VectorStoreSearchResponse = {
  data?: Array<{
    file_id?: string
    filename?: string
    score?: number
    attributes?: Record<string, string | number | boolean | null>
    content?: Array<{
      type?: string
      text?: string
    }>
  }>
  error?: {
    message?: string
  }
}

const getOutputText = (payload: OpenAIResponse) => {
  if (typeof payload.output_text === "string" && payload.output_text.trim()) {
    return payload.output_text
  }

  return (payload.output || [])
    .flatMap((item) => item.content || [])
    .filter((content) => content.type === "output_text" && typeof content.text === "string")
    .map((content) => content.text?.trim() || "")
    .filter(Boolean)
    .join("\n\n")
}

const getCitations = (payload: OpenAIResponse) => {
  const annotations =
    payload.output
      ?.flatMap((item) => item.content || [])
      .flatMap((content) => content.annotations || [])
      .filter((annotation) => annotation.type === "file_citation")
      .map((annotation) => ({
        fileId: annotation.file_id || "",
        filename: annotation.filename || "참고 문서",
      })) || []

  const seen = new Set<string>()

  return annotations.filter((annotation) => {
    const key = `${annotation.fileId}:${annotation.filename}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

const getPageLabel = (attributes?: Record<string, string | number | boolean | null>) => {
  if (!attributes) return undefined

  const candidates = [
    attributes.page_number,
    attributes.page,
    attributes.page_label,
    attributes.pageIndex,
    attributes.page_index,
  ]

  const pageValue = candidates.find((value) => typeof value === "string" || typeof value === "number")
  if (typeof pageValue === "number") return String(pageValue)
  if (typeof pageValue === "string" && pageValue.trim()) return pageValue.trim()
  return undefined
}

const getRetrievedSnippets = (payload: OpenAIResponse) => {
  return (
    payload.included
      ?.filter((item) => item.type === "file_search_call")
      .flatMap((item) => item.results || [])
      .map((result) => ({
        fileId: result.file_id || "",
        filename: result.filename || "문서",
        score: typeof result.score === "number" ? result.score : undefined,
        pageLabel: undefined,
        text: (result.content || [])
          .filter((content) => content.type === "text" && typeof content.text === "string")
          .map((content) => content.text?.trim() || "")
          .filter(Boolean)
          .join("\n"),
      }))
      .filter((result) => result.text) || []
  )
}

async function searchVectorStore(apiKey: string, vectorStoreId: string, query: string) {
  const response = await fetch(`https://api.openai.com/v1/vector_stores/${vectorStoreId}/search`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
      "OpenAI-Beta": "assistants=v2",
    },
    body: JSON.stringify({
      query,
      max_num_results: 4,
    }),
  })

  const data = (await response.json()) as VectorStoreSearchResponse

  if (!response.ok) {
    throw new Error(data.error?.message || "벡터 스토어 검색에 실패했습니다.")
  }

  return (data.data || []).map((result) => ({
    vectorStoreId,
    fileId: result.file_id || "",
    filename: result.filename || "문서",
    score: typeof result.score === "number" ? result.score : undefined,
    pageLabel: getPageLabel(result.attributes),
    attributes: result.attributes || {},
    text: (result.content || [])
      .filter((content) => content.type === "text" && typeof content.text === "string")
      .map((content) => content.text?.trim() || "")
      .filter(Boolean)
      .join("\n"),
  }))
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      apiKey?: string
      model?: string
      systemPrompt?: string
      messages?: RequestMessage[]
      vectorStoreIds?: string[]
    }

    const apiKey = body.apiKey?.trim()
    const model = body.model?.trim() || "gpt-5.2"
    const systemPrompt = body.systemPrompt?.trim()
    const messages = Array.isArray(body.messages) ? body.messages : []
    const vectorStoreIds = Array.isArray(body.vectorStoreIds)
      ? body.vectorStoreIds.filter((id): id is string => typeof id === "string" && id.trim().length > 0)
      : []
    const latestUserMessage =
      [...messages].reverse().find((message) => message.role === "user" && typeof message.content === "string")?.content?.trim() || ""

    if (!apiKey) {
      return NextResponse.json({ error: "OpenAI API 키를 입력해 주세요." }, { status: 400 })
    }

    if (messages.length === 0) {
      return NextResponse.json({ error: "보낼 메시지가 없습니다." }, { status: 400 })
    }

    let searchedSnippets: Array<{
      vectorStoreId: string
      fileId: string
      filename: string
      score?: number
      pageLabel?: string
      attributes?: Record<string, string | number | boolean | null>
      text: string
    }> = []

    if (vectorStoreIds.length > 0 && latestUserMessage) {
      const searchResults = await Promise.all(
        vectorStoreIds.map((vectorStoreId) => searchVectorStore(apiKey, vectorStoreId, latestUserMessage)),
      )

      searchedSnippets = searchResults
        .flat()
        .filter((item) => item.text)
        .sort((a, b) => (b.score || 0) - (a.score || 0))
        .slice(0, 8)
    }

    const groundingInstruction =
      vectorStoreIds.length > 0
        ? "가능하면 파일 검색 결과를 근거로 답변하고, 답변 마지막에 '참고 문서' 섹션을 만들어 파일명과 페이지 정보가 있으면 함께 적어 주세요."
        : ""

    const input = [
      ...((systemPrompt || groundingInstruction)
        ? [{ role: "developer", content: [systemPrompt, groundingInstruction].filter(Boolean).join("\n\n") }]
        : []),
      ...messages
        .filter((message) => (message.role === "user" || message.role === "assistant") && typeof message.content === "string")
        .map((message) => ({
          role: message.role,
          content: message.content,
        })),
    ]

    const payload: Record<string, unknown> = {
      model,
      input,
      store: false,
      include: ["file_search_call.results"],
      text: {
        format: {
          type: "text",
        },
      },
      max_output_tokens: 1200,
    }

    if (model.startsWith("gpt-5")) {
      payload.reasoning = { effort: "low" }
    }

    if (vectorStoreIds.length > 0) {
      payload.tools = [
        {
          type: "file_search",
          vector_store_ids: vectorStoreIds,
          max_num_results: 5,
        },
      ]
    }

    const openAIResponse = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(payload),
    })

    const data = (await openAIResponse.json()) as OpenAIResponse

    if (!openAIResponse.ok) {
      return NextResponse.json(
        {
          error: data.error?.message || "OpenAI API 호출에 실패했습니다.",
        },
        { status: openAIResponse.status },
      )
    }

    return NextResponse.json({
      text: getOutputText(data),
      citations: getCitations(data),
      snippets: searchedSnippets.length > 0 ? searchedSnippets : getRetrievedSnippets(data),
      usage: data.usage,
    })
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "서버 처리 중 오류가 발생했습니다.",
      },
      { status: 500 },
    )
  }
}
