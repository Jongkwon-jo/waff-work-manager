"use client"

import Link from "next/link"
import { useEffect, useRef, useState } from "react"
import {
  ArrowLeft,
  Bot,
  Database,
  FileText,
  History,
  KeyRound,
  LoaderCircle,
  Plus,
  RefreshCcw,
  Save,
  SendHorizonal,
  Settings2,
  Sparkles,
  Trash2,
  Upload,
  User,
  X,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import {
  deleteGptTestVectorStoreMetadata,
  fetchGptTestVectorStoreMetadata,
  saveGptTestVectorStoreMetadata,
} from "@/lib/gpt-test-vector-store-metadata"

type ChatMessage = {
  id: string
  role: "user" | "assistant"
  content: string
}

type Citation = {
  fileId: string
  filename: string
}

type Snippet = {
  vectorStoreId?: string
  fileId: string
  filename: string
  score?: number
  pageLabel?: string
  text: string
}

type ChatResponse = {
  text?: string
  usage?: {
    input_tokens?: number
    output_tokens?: number
    total_tokens?: number
  }
  citations?: Citation[]
  snippets?: Snippet[]
  error?: string
}

type VectorStoreSummary = {
  id: string
  name: string
  status: string
  fileCounts?: {
    completed?: number
    failed?: number
    in_progress?: number
    total?: number
  }
  createdAt?: number | null
  usageBytes?: number
  filename?: string
  filenames?: string[]
}

type VectorStoreListResponse = {
  stores?: VectorStoreSummary[]
  error?: string
}

type VectorStoreCreateResponse = {
  store?: VectorStoreSummary
  fileCount?: number
  filenames?: string[]
  error?: string
}

type VectorStoreDeleteResponse = {
  id?: string
  deleted?: boolean
  error?: string
}

type SavedChatSession = {
  id: string
  title: string
  createdAt: string
  updatedAt: string
  messages: ChatMessage[]
  citations: Citation[]
  snippets: Snippet[]
  selectedVectorStoreIds: string[]
  usageText: string
  responseTimeText: string
  systemPrompt: string
}

type StoredVectorStoreFiles = Record<
  string,
  {
    filenames: string[]
    savedAt: string
  }
>

type PanelType = "history" | "settings" | "sources" | null

const SNIPPET_PREVIEW_LIMIT = 140
const SNIPPET_LIST_LIMIT = 5

const starterMessages: ChatMessage[] = [
  {
    id: "welcome",
    role: "assistant",
    content:
      "API 키를 입력하고 PDF를 벡터 스토어로 만든 뒤 질문하면, 선택한 문서를 참고해서 답변할 수 있습니다.",
  },
]

const VECTOR_STORE_STORAGE_KEY = "gpt-test-selected-vector-stores"
const CHAT_HISTORY_STORAGE_KEY = "gpt-test-chat-sessions"
const CURRENT_SESSION_STORAGE_KEY = "gpt-test-current-session-id"
const VECTOR_STORE_FILE_HISTORY_KEY = "gpt-test-vector-store-files"
const FALLBACK_SYSTEM_PROMPT =
  "친절하고 정확한 사내 AI 비서로 답변해 주세요. 벡터 스토어 검색 결과가 있으면 그 내용을 우선 참고하고, 불확실하면 모른다고 명확히 말해 주세요."

function normalizeSystemPrompt(value?: string) {
  const trimmed = value?.trim()
  if (!trimmed) return FALLBACK_SYSTEM_PROMPT

  if (trimmed.includes("燁살뮇") || trimmed.includes("?곸궡裕") || trimmed.includes("移쒖젅")) {
    return FALLBACK_SYSTEM_PROMPT
  }

  return trimmed
}

function formatResponseTime(elapsedMs: number) {
  if (elapsedMs < 1000) {
    return `응답 시간 ${elapsedMs}ms`
  }

  return `응답 시간 ${(elapsedMs / 1000).toFixed(2)}초`
}

const createSession = (): SavedChatSession => {
  const timestamp = new Date().toISOString()
  return {
    id: `session-${Date.now()}`,
    title: "새 대화",
    createdAt: timestamp,
    updatedAt: timestamp,
    messages: starterMessages,
    citations: [],
    snippets: [],
    selectedVectorStoreIds: [],
    usageText: "",
    responseTimeText: "",
    systemPrompt: FALLBACK_SYSTEM_PROMPT,
  }
}

const formatTimestamp = (value: string) =>
  new Date(value).toLocaleString("ko-KR", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  })

const getSnippetPreview = (text: string) => {
  const normalized = text.replace(/\s+/g, " ").trim()
  if (normalized.length <= SNIPPET_PREVIEW_LIMIT) return normalized
  return `${normalized.slice(0, SNIPPET_PREVIEW_LIMIT)}...`
}

const parseStoredVectorStoreFiles = (rawValue: string | null): StoredVectorStoreFiles => {
  if (!rawValue) return {}

  const parsed = JSON.parse(rawValue)
  if (!parsed || typeof parsed !== "object") return {}

  return Object.fromEntries(
    Object.entries(parsed).map(([storeId, value]) => {
      const record = value as { filenames?: unknown; savedAt?: unknown }
      const filenames = Array.isArray(record.filenames)
        ? record.filenames.filter((filename): filename is string => typeof filename === "string" && filename.length > 0)
        : []

      return [
        storeId,
        {
          filenames,
          savedAt: typeof record.savedAt === "string" ? record.savedAt : new Date().toISOString(),
        },
      ]
    }),
  ) as StoredVectorStoreFiles
}

const mergeStoredVectorStoreFiles = (
  base: StoredVectorStoreFiles,
  incoming: Record<
    string,
    {
      filenames: string[]
      savedAt?: string | Date
    }
  >,
): StoredVectorStoreFiles => {
  const next = { ...base }

  Object.entries(incoming).forEach(([storeId, value]) => {
    next[storeId] = {
      filenames: value.filenames,
      savedAt:
        typeof value.savedAt === "string"
          ? value.savedAt
          : value.savedAt instanceof Date
            ? value.savedAt.toISOString()
            : base[storeId]?.savedAt || new Date().toISOString(),
    }
  })

  return next
}

export default function GptTestPage() {
  const [apiKey, setApiKey] = useState("")
  const [model, setModel] = useState("gpt-5.2")
  const [systemPrompt, setSystemPrompt] = useState(
    FALLBACK_SYSTEM_PROMPT,
  )
  const [draft, setDraft] = useState("")
  const [messages, setMessages] = useState<ChatMessage[]>(starterMessages)
  const [isSending, setIsSending] = useState(false)
  const [usageText, setUsageText] = useState("")
  const [responseTimeText, setResponseTimeText] = useState("")
  const [citations, setCitations] = useState<Citation[]>([])
  const [snippets, setSnippets] = useState<Snippet[]>([])
  const [activeSnippet, setActiveSnippet] = useState<Snippet | null>(null)
  const [vectorStores, setVectorStores] = useState<VectorStoreSummary[]>([])
  const [vectorStoreFiles, setVectorStoreFiles] = useState<StoredVectorStoreFiles>({})
  const [selectedVectorStoreIds, setSelectedVectorStoreIds] = useState<string[]>([])
  const [isLoadingStores, setIsLoadingStores] = useState(false)
  const [isUploading, setIsUploading] = useState(false)
  const [deletingStoreId, setDeletingStoreId] = useState("")
  const [uploadName, setUploadName] = useState("")
  const [selectedFiles, setSelectedFiles] = useState<File[]>([])
  const [storeStatus, setStoreStatus] = useState("")
  const [uploadProgress, setUploadProgress] = useState(0)
  const [uploadStage, setUploadStage] = useState<"idle" | "uploading" | "processing">("idle")
  const [chatSessions, setChatSessions] = useState<SavedChatSession[]>([])
  const [currentSessionId, setCurrentSessionId] = useState("")
  const [openPanel, setOpenPanel] = useState<PanelType>(null)
  const viewportRef = useRef<HTMLDivElement | null>(null)
  const hasRestoredPersistenceRef = useRef(false)

  useEffect(() => {
    setSystemPrompt((prev) => normalizeSystemPrompt(prev))
  }, [])

  useEffect(() => {
    const viewport = viewportRef.current
    if (!viewport) return
    viewport.scrollTop = viewport.scrollHeight
  }, [messages, isSending])

  useEffect(() => {
    if (typeof window === "undefined") return

    const savedVectorStoreFiles = window.localStorage.getItem(VECTOR_STORE_FILE_HISTORY_KEY)
    if (savedVectorStoreFiles) {
      try {
        setVectorStoreFiles(parseStoredVectorStoreFiles(savedVectorStoreFiles))
      } catch {
        window.localStorage.removeItem(VECTOR_STORE_FILE_HISTORY_KEY)
      }
    }

    void fetchGptTestVectorStoreMetadata()
      .then((metadata) => {
        setVectorStoreFiles((prev) => mergeStoredVectorStoreFiles(prev, metadata))
      })
      .catch(() => {
        // Firestore metadata is a durability layer; keep local fallback if it is unavailable.
      })

    const savedVectorStores = window.localStorage.getItem(VECTOR_STORE_STORAGE_KEY)
    if (savedVectorStores) {
      try {
        const parsed = JSON.parse(savedVectorStores)
        if (Array.isArray(parsed)) {
          setSelectedVectorStoreIds(parsed.filter((value): value is string => typeof value === "string"))
        }
      } catch {
        window.localStorage.removeItem(VECTOR_STORE_STORAGE_KEY)
      }
    }

    const savedSessions = window.localStorage.getItem(CHAT_HISTORY_STORAGE_KEY)
    const nextSessions = (() => {
      if (!savedSessions) return [createSession()]
      try {
        const parsed = JSON.parse(savedSessions)
        if (Array.isArray(parsed) && parsed.length > 0) return parsed as SavedChatSession[]
      } catch {
        window.localStorage.removeItem(CHAT_HISTORY_STORAGE_KEY)
      }
      return [createSession()]
    })()

    const savedCurrentSessionId = window.localStorage.getItem(CURRENT_SESSION_STORAGE_KEY)
    const initialSession =
      nextSessions.find((session) => session.id === savedCurrentSessionId) || nextSessions[0]

    setChatSessions(nextSessions)
    setCurrentSessionId(initialSession.id)
    setMessages(initialSession.messages)
    setCitations(initialSession.citations)
    setSnippets(initialSession.snippets)
    setUsageText(initialSession.usageText)
    setResponseTimeText(initialSession.responseTimeText || "")
    setSystemPrompt(normalizeSystemPrompt(initialSession.systemPrompt))
    setSelectedVectorStoreIds((prev) => (prev.length > 0 ? prev : initialSession.selectedVectorStoreIds))
    hasRestoredPersistenceRef.current = true
  }, [])

  useEffect(() => {
    if (typeof window === "undefined" || !hasRestoredPersistenceRef.current) return
    window.localStorage.setItem(VECTOR_STORE_STORAGE_KEY, JSON.stringify(selectedVectorStoreIds))
  }, [selectedVectorStoreIds])

  useEffect(() => {
    if (typeof window === "undefined" || !hasRestoredPersistenceRef.current) return
    window.localStorage.setItem(VECTOR_STORE_FILE_HISTORY_KEY, JSON.stringify(vectorStoreFiles))
  }, [vectorStoreFiles])

  useEffect(() => {
    setVectorStores((prev) =>
      prev.map((store) => ({
        ...store,
        filenames: vectorStoreFiles[store.id]?.filenames || store.filenames,
      })),
    )
  }, [vectorStoreFiles])

  const visibleSnippets = snippets.slice(0, SNIPPET_LIST_LIMIT)
  const snippetListContent =
    snippets.length === 0 ? (
      <p className="text-xs text-slate-500">아직 검색된 문서 조각이 없습니다.</p>
    ) : (
      <div className="space-y-3">
        {visibleSnippets.map((snippet, index) => (
          <button
            key={`${snippet.fileId}-${index}`}
            type="button"
            onClick={() => setActiveSnippet(snippet)}
            className="block w-full rounded-xl border border-slate-200 bg-white p-3 text-left transition-colors hover:border-sky-300 hover:bg-sky-50/50"
          >
            <div className="flex flex-wrap gap-2 text-[11px] text-slate-500">
              <span className="font-semibold text-slate-900">{snippet.filename}</span>
              {snippet.pageLabel ? <span className="rounded-full bg-slate-100 px-2 py-1">페이지 {snippet.pageLabel}</span> : null}
              {typeof snippet.score === "number" ? <span className="rounded-full bg-slate-100 px-2 py-1">유사도 {snippet.score.toFixed(3)}</span> : null}
            </div>
            <p className="mt-2 text-xs leading-5 text-slate-600">{getSnippetPreview(snippet.text)}</p>
            <div className="mt-3 flex items-center justify-between gap-2 text-[11px] text-slate-400">
              <p className="min-w-0 flex-1 truncate">{snippet.fileId}</p>
              <span className="shrink-0 text-sky-700">클릭해서 전체 보기</span>
            </div>
          </button>
        ))}
        {snippets.length > visibleSnippets.length ? (
          <p className="text-[11px] text-slate-500">총 {snippets.length}개 중 상위 {visibleSnippets.length}개만 표시합니다.</p>
        ) : null}
      </div>
    )

  useEffect(() => {
    if (!currentSessionId || chatSessions.length === 0 || typeof window === "undefined" || !hasRestoredPersistenceRef.current) return
    window.localStorage.setItem(CHAT_HISTORY_STORAGE_KEY, JSON.stringify(chatSessions))
    window.localStorage.setItem(CURRENT_SESSION_STORAGE_KEY, currentSessionId)
  }, [chatSessions, currentSessionId])

  const persistCurrentSession = (
    nextMessages: ChatMessage[],
    nextCitations: Citation[],
    nextSnippets: Snippet[],
    nextUsageText: string,
    nextResponseTimeText = responseTimeText,
    nextSystemPrompt = systemPrompt,
    nextSelectedVectorStoreIds = selectedVectorStoreIds,
  ) => {
    setChatSessions((prev) => {
      const titleSource = nextMessages.find((message) => message.role === "user")?.content || "새 대화"
      const title = titleSource.length > 24 ? `${titleSource.slice(0, 24)}...` : titleSource
      const now = new Date().toISOString()

      const next = prev.map((session) =>
        session.id === currentSessionId
          ? {
              ...session,
              title,
              updatedAt: now,
              messages: nextMessages,
              citations: nextCitations,
              snippets: nextSnippets,
              selectedVectorStoreIds: nextSelectedVectorStoreIds,
              usageText: nextUsageText,
              responseTimeText: nextResponseTimeText,
              systemPrompt: nextSystemPrompt,
            }
          : session,
      )

      return next.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
    })
  }

  const applySession = (session: SavedChatSession) => {
    setCurrentSessionId(session.id)
    setMessages(session.messages)
    setCitations(session.citations)
    setSnippets(session.snippets)
    setUsageText(session.usageText)
    setResponseTimeText(session.responseTimeText || "")
    setSystemPrompt(normalizeSystemPrompt(session.systemPrompt))
    setSelectedVectorStoreIds(session.selectedVectorStoreIds)
    setDraft("")
  }

  const refreshVectorStores = async () => {
    const trimmedApiKey = apiKey.trim()
    if (!trimmedApiKey) {
      setStoreStatus("벡터 스토어 목록을 보려면 먼저 API 키를 입력해 주세요.")
      return
    }

    setIsLoadingStores(true)
    setStoreStatus("")

    try {
      const response = await fetch(`/api/gpt-test/vector-stores?apiKey=${encodeURIComponent(trimmedApiKey)}`)
      const data = (await response.json()) as VectorStoreListResponse

      if (!response.ok) {
        throw new Error(data.error || "벡터 스토어 목록을 불러오지 못했습니다.")
      }

      let firestoreVectorStoreFiles: StoredVectorStoreFiles = {}

      try {
        const firestoreMetadata = await fetchGptTestVectorStoreMetadata()
        firestoreVectorStoreFiles = mergeStoredVectorStoreFiles({}, firestoreMetadata)
        setVectorStoreFiles((prev) => mergeStoredVectorStoreFiles(prev, firestoreMetadata))
      } catch {
        firestoreVectorStoreFiles = {}
      }

      const persistedVectorStoreFiles =
        typeof window === "undefined"
          ? vectorStoreFiles
          : mergeStoredVectorStoreFiles(
              parseStoredVectorStoreFiles(window.localStorage.getItem(VECTOR_STORE_FILE_HISTORY_KEY)),
              firestoreVectorStoreFiles,
            )

      const stores = (data.stores || []).map((store) => ({
        ...store,
        filenames: persistedVectorStoreFiles[store.id]?.filenames || vectorStoreFiles[store.id]?.filenames || store.filenames,
      }))
      setVectorStores(stores)
      setSelectedVectorStoreIds((prev) => prev.filter((id) => stores.some((store) => store.id === id)))
      setStoreStatus(stores.length > 0 ? `${stores.length}개의 벡터 스토어를 불러왔습니다.` : "아직 생성된 벡터 스토어가 없습니다.")
    } catch (error) {
      setStoreStatus(error instanceof Error ? error.message : "벡터 스토어 목록 조회 중 오류가 발생했습니다.")
    } finally {
      setIsLoadingStores(false)
    }
  }

  const handleNewSession = () => {
    const nextSession = createSession()
    setChatSessions((prev) => [nextSession, ...prev])
    applySession(nextSession)
    setOpenPanel("history")
  }

  const handleLoadSession = (sessionId: string) => {
    const target = chatSessions.find((session) => session.id === sessionId)
    if (!target) return
    applySession(target)
    setOpenPanel(null)
  }

  const handleDeleteSession = (sessionId: string) => {
    const nextSessions = chatSessions.filter((session) => session.id !== sessionId)
    if (nextSessions.length === 0) {
      const fallback = createSession()
      setChatSessions([fallback])
      applySession(fallback)
      return
    }

    setChatSessions(nextSessions)
    if (currentSessionId === sessionId) {
      applySession(nextSessions[0])
    }
  }

  const handleReset = () => {
    setMessages(starterMessages)
    setUsageText("")
    setResponseTimeText("")
    setDraft("")
    setCitations([])
    setSnippets([])
    persistCurrentSession(starterMessages, [], [], "", "")
  }

  const handleSystemPromptChange = (value: string) => {
    const normalized = normalizeSystemPrompt(value)
    setSystemPrompt(normalized)
    persistCurrentSession(messages, citations, snippets, usageText, responseTimeText, normalized, selectedVectorStoreIds)
  }

  const handleUploadPdf = async () => {
    const trimmedApiKey = apiKey.trim()

    if (!trimmedApiKey || selectedFiles.length === 0 || isUploading) return

    setIsUploading(true)
    setUploadProgress(0)
    setUploadStage("uploading")
    setStoreStatus(`PDF ${selectedFiles.length}개를 업로드하는 중입니다...`)

    try {
      const formData = new FormData()
      formData.append("apiKey", trimmedApiKey)
      formData.append("name", uploadName.trim())
      selectedFiles.forEach((file) => {
        formData.append("files", file)
      })

      const data = await new Promise<VectorStoreCreateResponse>((resolve, reject) => {
        const xhr = new XMLHttpRequest()
        xhr.open("POST", "/api/gpt-test/vector-stores")
        xhr.responseType = "json"

        xhr.upload.onprogress = (event) => {
          if (!event.lengthComputable) return
          const progress = Math.min(100, Math.round((event.loaded / event.total) * 100))
          setUploadProgress(progress)
          setStoreStatus(`PDF ${selectedFiles.length}개 업로드 중... ${progress}%`)
        }

        xhr.onload = () => {
          setUploadStage("processing")
          setStoreStatus(`업로드가 완료되었습니다. PDF ${selectedFiles.length}개로 벡터 스토어를 생성하는 중입니다...`)

          if (xhr.status >= 200 && xhr.status < 300) {
            resolve((xhr.response || {}) as VectorStoreCreateResponse)
            return
          }

          const response = (xhr.response || {}) as VectorStoreCreateResponse
          reject(new Error(response.error || "벡터 스토어 생성에 실패했습니다."))
        }

        xhr.onerror = () => reject(new Error("업로드 요청 전송에 실패했습니다."))
        xhr.send(formData)
      })

      if (!data.store) {
        throw new Error(data.error || "벡터 스토어 생성에 실패했습니다.")
      }

      setStoreStatus(`"${data.store.name}" 벡터 스토어가 준비되었습니다. (${data.fileCount || selectedFiles.length}개 PDF)`)
      setUploadProgress(100)
      setSelectedFiles([])
      setUploadName("")
      const nextFilenames = (data.filenames || []).filter((filename): filename is string => typeof filename === "string" && filename.length > 0)
      setVectorStoreFiles((prev) => ({
        ...prev,
        [data.store!.id]: {
          filenames: nextFilenames,
          savedAt: new Date().toISOString(),
        },
      }))
      void saveGptTestVectorStoreMetadata({
        vectorStoreId: data.store.id,
        name: data.store.name,
        filenames: nextFilenames,
      }).catch(() => {
        setStoreStatus(`"${data.store?.name || "벡터 스토어"}"는 생성되었지만 Firestore 기록 저장에는 실패했습니다.`)
      })
      setVectorStores((prev) => [
        {
          ...data.store!,
          filenames: nextFilenames,
        },
        ...prev.filter((store) => store.id !== data.store!.id),
      ])
      const nextSelected = selectedVectorStoreIds.includes(data.store.id)
        ? selectedVectorStoreIds
        : [data.store.id, ...selectedVectorStoreIds]
      setSelectedVectorStoreIds(nextSelected)
      persistCurrentSession(messages, citations, snippets, usageText, responseTimeText, systemPrompt, nextSelected)
    } catch (error) {
      setStoreStatus(error instanceof Error ? error.message : "벡터 스토어 생성 중 오류가 발생했습니다.")
    } finally {
      setIsUploading(false)
      setUploadStage("idle")
    }
  }

  const handleDeleteVectorStore = async (storeId: string) => {
    const trimmedApiKey = apiKey.trim()

    if (!trimmedApiKey || !storeId || deletingStoreId) return

    const targetStore = vectorStores.find((store) => store.id === storeId)
    const confirmed =
      typeof window === "undefined"
        ? false
        : window.confirm(`"${targetStore?.name || storeId}" 벡터 스토어를 삭제할까요? 이 작업은 되돌릴 수 없습니다.`)

    if (!confirmed) return

    setDeletingStoreId(storeId)

    try {
      const response = await fetch("/api/gpt-test/vector-stores", {
        method: "DELETE",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          apiKey: trimmedApiKey,
          vectorStoreId: storeId,
        }),
      })

      const data = (await response.json()) as VectorStoreDeleteResponse

      if (!response.ok || !data.deleted) {
        throw new Error(data.error || "벡터 스토어 삭제에 실패했습니다.")
      }

      void deleteGptTestVectorStoreMetadata(storeId).catch(() => {
        // Keep UI responsive even if metadata cleanup fails.
      })
      setVectorStores((prev) => prev.filter((store) => store.id !== storeId))
      setSelectedVectorStoreIds((prev) => prev.filter((id) => id !== storeId))
      setVectorStoreFiles((prev) => {
        const next = { ...prev }
        delete next[storeId]
        return next
      })
      setStoreStatus(`벡터 스토어를 삭제했습니다.`)
    } catch (error) {
      setStoreStatus(error instanceof Error ? error.message : "벡터 스토어 삭제 중 오류가 발생했습니다.")
    } finally {
      setDeletingStoreId("")
    }
  }

  const handleSubmit = async () => {
    const trimmedDraft = draft.trim()
    const trimmedApiKey = apiKey.trim()

    if (!trimmedApiKey || !trimmedDraft || isSending) return

    const userMessage: ChatMessage = {
      id: `user-${Date.now()}`,
      role: "user",
      content: trimmedDraft,
    }

    const nextMessages = [...messages, userMessage]
    setMessages(nextMessages)
    setDraft("")
    setIsSending(true)
    setUsageText("")
    setResponseTimeText("")
    setCitations([])
    setSnippets([])
    persistCurrentSession(nextMessages, [], [], "", "", systemPrompt, selectedVectorStoreIds)

    try {
      const requestStartedAt = performance.now()
      const response = await fetch("/api/gpt-test", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          apiKey: trimmedApiKey,
          model: model.trim() || "gpt-5.2",
          systemPrompt: systemPrompt.trim(),
          vectorStoreIds: selectedVectorStoreIds,
          messages: nextMessages,
        }),
      })

      const data = (await response.json()) as ChatResponse

      if (!response.ok) {
        throw new Error(data.error || "GPT 응답을 받아오지 못했습니다.")
      }

      const assistantMessage: ChatMessage = {
        id: `assistant-${Date.now()}`,
        role: "assistant",
        content: data.text?.trim() || "응답이 비어 있습니다.",
      }

      const finalMessages = [...nextMessages, assistantMessage]
      const finalCitations = data.citations || []
      const finalSnippets = data.snippets || []
      const elapsedMs = Math.round(performance.now() - requestStartedAt)
      const nextResponseTimeText = formatResponseTime(elapsedMs)
      const nextUsageText = (() => {
        if (!data.usage) return ""
        const usageParts = [
          typeof data.usage.input_tokens === "number" ? `입력 ${data.usage.input_tokens}` : null,
          typeof data.usage.output_tokens === "number" ? `출력 ${data.usage.output_tokens}` : null,
          typeof data.usage.total_tokens === "number" ? `총 ${data.usage.total_tokens}` : null,
        ].filter(Boolean)

        return usageParts.length > 0 ? `토큰 사용량 ${usageParts.join(" / ")}` : ""
      })()

      setMessages(finalMessages)
      setCitations(finalCitations)
      setSnippets(finalSnippets)
      setUsageText(nextUsageText)
      setResponseTimeText(nextResponseTimeText)
      persistCurrentSession(
        finalMessages,
        finalCitations,
        finalSnippets,
        nextUsageText,
        nextResponseTimeText,
        systemPrompt,
        selectedVectorStoreIds,
      )
    } catch (error) {
      const message = error instanceof Error ? error.message : "알 수 없는 오류가 발생했습니다."
      const errorMessage = {
        id: `assistant-error-${Date.now()}`,
        role: "assistant" as const,
        content: `오류가 발생했습니다: ${message}`,
      }
      const finalMessages = [...nextMessages, errorMessage]
      setMessages(finalMessages)
      persistCurrentSession(finalMessages, [], [], "", "", systemPrompt, selectedVectorStoreIds)
    } finally {
      setIsSending(false)
    }
  }

  const toggleVectorStore = (storeId: string) => {
    const nextSelected = selectedVectorStoreIds.includes(storeId)
      ? selectedVectorStoreIds.filter((id) => id !== storeId)
      : [...selectedVectorStoreIds, storeId]

    setSelectedVectorStoreIds(nextSelected)
    persistCurrentSession(messages, citations, snippets, usageText, responseTimeText, systemPrompt, nextSelected)
  }

  const togglePanel = (panel: Exclude<PanelType, null>) => {
    setOpenPanel((prev) => (prev === panel ? null : panel))
  }

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top,_rgba(14,165,233,0.18),_transparent_32%),linear-gradient(180deg,#f8fbff_0%,#eef6ff_52%,#f8fafc_100%)] px-4 py-8 text-slate-900 lg:px-10">
      <div className="mx-auto max-w-6xl space-y-6">
        <div className="rounded-[28px] border border-white/70 bg-white/75 p-6 shadow-[0_20px_80px_rgba(15,23,42,0.08)] backdrop-blur">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <p className="text-sm font-semibold uppercase tracking-[0.22em] text-sky-700">OpenAI File Search</p>
              <h1 className="mt-2 text-3xl font-bold tracking-tight lg:text-4xl">GPT 테스트 채팅</h1>
              <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-600">
                메인 채팅을 중심으로 두고, 기록과 설정, 벡터 스토어 관리는 버튼으로 열어보는 구조로 정리했습니다.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant={openPanel === "history" ? "default" : "outline"} onClick={() => togglePanel("history")}>
                <History className="h-4 w-4" />
                채팅 기록
              </Button>
              <Button type="button" variant={openPanel === "settings" ? "default" : "outline"} onClick={() => togglePanel("settings")}>
                <Settings2 className="h-4 w-4" />
                설정
              </Button>
              <Button type="button" variant={openPanel === "sources" ? "default" : "outline"} onClick={() => togglePanel("sources")}>
                <Database className="h-4 w-4" />
                벡터 스토어              </Button>
              <Button type="button" variant="outline" onClick={handleNewSession}>
                <Plus className="h-4 w-4" />
                새 대화              </Button>
              <Button type="button" variant="outline" onClick={handleReset}>
                <Trash2 className="h-4 w-4" />
                초기화              </Button>
              <Button asChild variant="outline">
                <Link href="/">
                  <ArrowLeft className="h-4 w-4" />
                  대시보드로 돌아가기                </Link>
              </Button>
            </div>
          </div>

          {openPanel && (
            <div className="mt-5 rounded-3xl border border-slate-200 bg-white/90 p-5 shadow-sm">
              <div className="mb-4 flex items-center justify-between">
                <p className="text-sm font-semibold text-slate-900">
                  {openPanel === "history" ? "저장된 채팅" : openPanel === "settings" ? "채팅 설정" : "벡터 스토어 관리"}
                </p>
                <Button type="button" variant="ghost" size="sm" onClick={() => setOpenPanel(null)}>
                  <X className="h-4 w-4" />
                  닫기
                </Button>
              </div>

              {openPanel === "history" && (
                <div className="max-h-[360px] space-y-3 overflow-y-auto pr-1">
                  {chatSessions.map((session) => {
                    const isActive = session.id === currentSessionId
                    return (
                      <div
                        key={session.id}
                        className={`rounded-2xl border p-4 ${isActive ? "border-sky-300 bg-sky-50" : "border-slate-200 bg-white"}`}
                      >
                        <div className="flex items-start justify-between gap-4">
                          <button type="button" className="min-w-0 flex-1 text-left" onClick={() => handleLoadSession(session.id)}>
                            <p className="text-sm font-semibold text-slate-900">{session.title || "새 대화"}</p>
                            <p className="mt-1 text-xs text-slate-500">{formatTimestamp(session.updatedAt)}</p>
                            <p className="mt-2 line-clamp-2 text-xs leading-5 text-slate-600">
                              {session.messages[session.messages.length - 1]?.content || "대화 내용이 없습니다."}
                            </p>
                          </button>
                          <Button type="button" variant="outline" size="sm" onClick={() => handleDeleteSession(session.id)}>
                            <Trash2 className="h-3.5 w-3.5" />
                            삭제
                          </Button>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}

              {openPanel === "settings" && (
                <div className="grid gap-4 lg:grid-cols-2">
                  <div className="space-y-2">
                    <label className="flex items-center gap-2 text-sm font-semibold text-slate-800">
                      <KeyRound className="h-4 w-4 text-sky-600" />
                      OpenAI API 키                    </label>
                    <Input type="password" value={apiKey} onChange={(event) => setApiKey(event.target.value)} placeholder="sk-..." autoComplete="off" />
                    <p className="text-xs leading-5 text-slate-500">API 키는 저장하지 않고 현재 브라우저 메모리에서만 사용합니다.</p>
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-semibold text-slate-800">모델</label>
                    <Input value={model} onChange={(event) => setModel(event.target.value)} placeholder="gpt-5.2" />
                  </div>
                  <div className="space-y-2 lg:col-span-2">
                    <label className="text-sm font-semibold text-slate-800">시스템 프롬프트</label>
                    <Textarea value={systemPrompt} onChange={(event) => handleSystemPromptChange(event.target.value)} placeholder="모델의 기본 동작 방식을 입력해 주세요." className="min-h-32 resize-none" />
                  </div>
                  <div className="rounded-2xl border border-sky-100 bg-sky-50/80 p-4 text-sm text-slate-700 lg:col-span-2">
                    <p className="flex items-center gap-2 font-semibold text-sky-900">
                      <Save className="h-4 w-4" />
                      채팅 기록 안내                    </p>
                    <p className="mt-2 leading-6">채팅 기록은 브라우저 로컬 스토리지에 자동 저장됩니다. 새로고침 후에도 다시 확인할 수 있습니다.</p>
                  </div>
                </div>
              )}

              {openPanel === "sources" && (
                <div className="space-y-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-sm text-slate-600">PDF 업로드, 벡터 스토어 선택, 목록 새로고침을 여기서 관리합니다.</p>
                    <Button type="button" variant="outline" size="sm" onClick={() => void refreshVectorStores()} disabled={isLoadingStores}>
                      {isLoadingStores ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <RefreshCcw className="h-4 w-4" />}
                      새로고침
                    </Button>
                  </div>
                  <div className="grid gap-4 lg:grid-cols-[320px_minmax(0,1fr)]">
                    <div className="space-y-3 rounded-2xl border border-dashed border-slate-200 bg-slate-50 p-4">
                      <div className="space-y-2">
                        <label className="text-sm font-semibold text-slate-800">벡터 스토어 이름</label>
                        <Input value={uploadName} onChange={(event) => setUploadName(event.target.value)} placeholder="예: 사내 규정집" />
                      </div>
                      <div className="space-y-2">
                        <label className="text-sm font-semibold text-slate-800">PDF 파일</label>
                        <Input
                          type="file"
                          accept="application/pdf"
                          multiple
                          onChange={(event) => setSelectedFiles(Array.from(event.target.files || []))}
                        />
                        {selectedFiles.length > 0 ? (
                          <div className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs text-slate-600">
                            <p className="font-semibold text-slate-900">{selectedFiles.length}개의 PDF가 선택되었습니다.</p>
                            <p className="mt-1 line-clamp-3">{selectedFiles.map((file) => file.name).join(", ")}</p>
                          </div>
                        ) : null}
                      </div>
                      <Button type="button" onClick={() => void handleUploadPdf()} disabled={!apiKey.trim() || selectedFiles.length === 0 || isUploading}>
                        {isUploading ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                        PDF 업로드 후 생성
                      </Button>
                      {(isUploading || uploadProgress > 0) && (
                        <div className="space-y-2">
                          <div className="h-2 overflow-hidden rounded-full bg-slate-200">
                            <div className="h-full rounded-full bg-sky-500 transition-all" style={{ width: `${uploadStage === "processing" ? 100 : uploadProgress}%` }} />
                          </div>
                          <p className="text-xs text-slate-500">
                            {uploadStage === "uploading"
                              ? `업로드 진행률 ${uploadProgress}%`
                              : uploadStage === "processing"
                                ? "파일 업로드 완료, 벡터 인덱싱 진행 중"
                                : uploadProgress === 100
                                  ? "업로드가 완료되었습니다."
                                  : ""}
                          </p>
                        </div>
                      )}
                      <p className="text-xs leading-5 text-slate-500">{storeStatus || "생성한 벡터 스토어를 선택하면 답변에 참고됩니다."}</p>
                    </div>
                    <div className="max-h-[360px] space-y-3 overflow-y-auto pr-1">
                      {vectorStores.length === 0 ? (
                        <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-500">불러온 벡터 스토어가 없습니다.</div>
                      ) : (
                        vectorStores.map((store) => {
                          const isSelected = selectedVectorStoreIds.includes(store.id)
                          return (
                            <label
                              key={store.id}
                              className={`block cursor-pointer rounded-2xl border p-4 transition-colors ${
                                isSelected ? "border-sky-300 bg-sky-50" : "border-slate-200 bg-white hover:bg-slate-50"
                              }`}
                            >
                              <div className="flex items-start gap-3">
                                <input type="checkbox" checked={isSelected} onChange={() => toggleVectorStore(store.id)} className="mt-1 h-4 w-4 rounded border-slate-300" />
                                <div className="min-w-0 flex-1">
                                  <div className="flex items-start justify-between gap-3">
                                    <p className="text-sm font-semibold text-slate-900">{store.name}</p>
                                    <Button
                                      type="button"
                                      variant="ghost"
                                      size="sm"
                                      className="h-auto px-2 py-1 text-rose-600 hover:bg-rose-50 hover:text-rose-700"
                                      disabled={deletingStoreId === store.id || !apiKey.trim()}
                                      onClick={(event) => {
                                        event.preventDefault()
                                        event.stopPropagation()
                                        void handleDeleteVectorStore(store.id)
                                      }}
                                    >
                                      {deletingStoreId === store.id ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                                      삭제
                                    </Button>
                                  </div>
                                  <p className="mt-1 break-all text-[11px] text-slate-500">{store.id}</p>
                                  <div className="mt-2 flex flex-wrap gap-2 text-[11px] text-slate-600">
                                    <span className="rounded-full bg-slate-100 px-2 py-1">상태 {store.status}</span>
                                    <span className="rounded-full bg-slate-100 px-2 py-1">파일 {store.fileCounts?.completed ?? 0}/{store.fileCounts?.total ?? 0}</span>
                                  </div>
                                  {store.filenames && store.filenames.length > 0 ? (
                                    <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
                                      <p className="text-[11px] font-semibold text-slate-700">저장된 PDF 목록</p>
                                      <p className="mt-1 text-[11px] leading-5 text-slate-600">{store.filenames.join(", ")}</p>
                                    </div>
                                  ) : null}
                                </div>
                              </div>
                            </label>
                          )
                        })
                      )}
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        <section className="overflow-hidden rounded-[30px] border border-slate-200 bg-white/88 shadow-[0_24px_80px_rgba(15,23,42,0.08)] backdrop-blur">
          <div className="border-b border-slate-100 bg-slate-950 px-6 py-4 text-slate-50">
            <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <p className="text-sm font-semibold">채팅 창</p>
                <p className="mt-1 text-xs text-slate-300">Enter로 전송, Shift+Enter로 줄바꿈</p>
              </div>
              <div className="flex flex-wrap gap-2 text-xs text-slate-300">
                <span className="rounded-full border border-slate-700 px-3 py-1">선택 문서 {selectedVectorStoreIds.length}개</span>
                <span className="rounded-full border border-slate-700 px-3 py-1">{usageText || "토큰 사용량 대기 중"}</span>
                <span className="rounded-full border border-slate-700 px-3 py-1">{responseTimeText || "응답 시간 대기 중"}</span>
              </div>
            </div>
          </div>

          <div ref={viewportRef} className="h-[520px] space-y-4 overflow-y-auto bg-[linear-gradient(180deg,#f8fbff_0%,#ffffff_18%,#ffffff_100%)] px-5 py-5">
            {messages.map((message) => {
              const isUser = message.role === "user"
              return (
                <div key={message.id} className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
                  <div className={`max-w-[88%] rounded-3xl px-4 py-3 shadow-sm ${isUser ? "bg-sky-600 text-white" : "border border-slate-200 bg-white text-slate-800"}`}>
                    <div className="mb-2 flex items-center gap-2 text-xs font-semibold">
                      {isUser ? <User className="h-3.5 w-3.5" /> : <Bot className="h-3.5 w-3.5" />}
                      {isUser ? "나" : "GPT"}
                    </div>
                    <p className="whitespace-pre-wrap text-sm leading-6">{message.content}</p>
                  </div>
                </div>
              )
            })}

            {isSending && (
              <div className="flex justify-start">
                <div className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-4 py-2 text-sm text-slate-600 shadow-sm">
                  <LoaderCircle className="h-4 w-4 animate-spin" />
                  답변 생성 중...
                </div>
              </div>
            )}
          </div>

          <div className="space-y-4 border-t border-slate-100 bg-white px-5 py-4">
            <Textarea
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault()
                  void handleSubmit()
                }
              }}
              placeholder="문서 기반 질문을 입력해 주세요."
              className="min-h-28 resize-none border-slate-200 bg-slate-50"
            />

            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <div className="text-xs text-slate-500">
                {selectedVectorStoreIds.length > 0 ? "선택한 벡터 스토어를 참고해서 답변합니다." : "벡터 스토어를 선택하지 않으면 일반 답변으로 동작합니다."}
              </div>
              <Button type="button" onClick={() => void handleSubmit()} disabled={isSending || !apiKey.trim() || !draft.trim()}>
                {isSending ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <SendHorizonal className="h-4 w-4" />}
                보내기              </Button>
            </div>

            <div className="grid gap-4 xl:grid-cols-2">
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <p className="flex items-center gap-2 text-sm font-semibold text-slate-800">
                  <FileText className="h-4 w-4 text-sky-600" />
                  참고 문서
                </p>
                <div className="mt-3 space-y-2">
                  {citations.length === 0 ? (
                    <p className="text-xs text-slate-500">아직 참고 문서가 없습니다.</p>
                  ) : (
                    citations.map((citation, index) => (
                      <div key={`${citation.fileId}-${index}`} className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs text-slate-700">
                        <div className="font-semibold text-slate-900">{citation.filename}</div>
                        <div className="mt-1 break-all text-[11px] text-slate-500">{citation.fileId}</div>
                      </div>
                    ))
                  )}
                </div>
              </div>

              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <p className="flex items-center gap-2 text-sm font-semibold text-slate-800">
                  <Sparkles className="h-4 w-4 text-sky-600" />
                  검색된 문서 조각
                </p>
                <div className="mt-3 max-h-52 space-y-3 overflow-y-auto pr-1">
                  {snippetListContent}
                </div>
              </div>
            </div>
          </div>
        </section>
      </div>
      <Dialog open={Boolean(activeSnippet)} onOpenChange={(open) => setActiveSnippet(open ? activeSnippet : null)}>
        <DialogContent className="max-h-[85vh] max-w-3xl overflow-hidden p-0">
          {activeSnippet ? (
            <div className="flex max-h-[85vh] flex-col">
              <DialogHeader className="border-b border-slate-200 px-6 py-5">
                <DialogTitle>{activeSnippet.filename}</DialogTitle>
                <DialogDescription className="flex flex-wrap gap-2 text-[11px]">
                  {activeSnippet.pageLabel ? <span>페이지 {activeSnippet.pageLabel}</span> : null}
                  {typeof activeSnippet.score === "number" ? <span>유사도 {activeSnippet.score.toFixed(3)}</span> : null}
                  <span className="break-all">{activeSnippet.fileId}</span>
                </DialogDescription>
              </DialogHeader>
              <div className="overflow-y-auto px-6 py-5">
                <p className="whitespace-pre-wrap text-sm leading-7 text-slate-700">{activeSnippet.text}</p>
              </div>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </main>
  )
}

