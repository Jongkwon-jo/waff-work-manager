export type TaskStatus = "완료" | "진행" | "대기" | "보류" | "미정"
export type TaskCategory = "일반" | "중요" | "정기"

export interface Task {
  id: string
  projectId: string
  task: string
  category: TaskCategory
  department: string
  person: string
  startDate: string
  endDate: string
  status: TaskStatus
  manDays: number
  isSubTask?: boolean
}

export type ProjectType = "SI" | "R&D" | "S/F" | "Etc"

export interface Project {
  id: string
  name: string
  type: ProjectType
  period?: string
  tasks: Task[]
}

export const projects: Project[] = [
  {
    id: "p1",
    name: "석산관제솔루션2.0",
    type: "SI",
    period: "2025.04 ~ 2025.12",
    tasks: [
      { id: "t1", projectId: "p1", task: "안드로이드 계정 생성(회사계정 생성)", category: "일반", department: "전략", person: "진종헌", startDate: "02월 09일", endDate: "02월 09일", status: "완료", manDays: 1 },
      { id: "t2", projectId: "p1", task: "태양광 AP 배터리 확인 및 교체", category: "일반", department: "전략", person: "신기루, 진종헌", startDate: "3월", endDate: "3월", status: "미정", manDays: 0 },
      { id: "t3", projectId: "p1", task: "현장 완료보고(상무님 참석)", category: "중요", department: "전략", person: "신기루, 진종헌", startDate: "3월", endDate: "3월", status: "미정", manDays: 0 },
      { id: "t4", projectId: "p1", task: "석산관제솔루션 시연회(석산주 참석)", category: "중요", department: "전략", person: "신기루, 진종헌", startDate: "4월", endDate: "4월", status: "미정", manDays: 0 },
    ],
  },
  {
    id: "p2",
    name: "석산관제솔루션2.5",
    type: "SI",
    period: "2026.03 ~ 2026.11",
    tasks: [
      { id: "t5", projectId: "p2", task: "상/하행 표시 로직 개발", category: "일반", department: "ICT", person: "최강일", startDate: "03월 09일", endDate: "03월 13일", status: "보류", manDays: 5, isSubTask: true },
      { id: "t6", projectId: "p2", task: "공통사항 범례 관련 UI 개발", category: "일반", department: "ICT", person: "최강일", startDate: "03월 09일", endDate: "03월 13일", status: "보류", manDays: 5, isSubTask: true },
      { id: "t7", projectId: "p2", task: "모바일 지도 MBtiles 적용 검토", category: "일반", department: "ICT", person: "최강일, 신기루", startDate: "03월 03일", endDate: "03월 12일", status: "대기", manDays: 10, isSubTask: true },
      { id: "t8", projectId: "p2", task: "전표출력 로직 수정개발", category: "일반", department: "ICT", person: "최강일, 신기루", startDate: "02월 26일", endDate: "02월 27일", status: "진행", manDays: 2, isSubTask: true },
      { id: "t9", projectId: "p2", task: "착수보고", category: "중요", department: "전략", person: "신기루", startDate: "03월 12일", endDate: "03월 12일", status: "미정", manDays: 1 },
      { id: "t10", projectId: "p2", task: "계약서 날인 후 회신", category: "중요", department: "전략", person: "신기루", startDate: "03월 06일", endDate: "03월 06일", status: "대기", manDays: 1 },
    ],
  },
  {
    id: "p3",
    name: "LG전자",
    type: "SI",
    period: "2025.07 ~ 2025.09",
    tasks: [
      { id: "t11", projectId: "p3", task: "GMES 연동 항목에 파트넘버 추가", category: "일반", department: "ICT", person: "배승우", startDate: "02월 20일", endDate: "02월 20일", status: "완료", manDays: 1 },
      { id: "t12", projectId: "p3", task: "api 요청 및 데이터 수신 현장 테스트", category: "일반", department: "전략, ICT", person: "배승우, 신기루", startDate: "03월 06일", endDate: "03월 06일", status: "대기", manDays: 1 },
      { id: "t13", projectId: "p3", task: "시스템 UI변경 개발 진행", category: "일반", department: "ICT", person: "배승우", startDate: "01월 26일", endDate: "01월 30일", status: "보류", manDays: 5 },
      { id: "t14", projectId: "p3", task: "최종 완료보고", category: "일반", department: "전략", person: "신기루", startDate: "12월 23일", endDate: "12월 23일", status: "보류", manDays: 1 },
    ],
  },
  {
    id: "p4",
    name: "LG전자 인도 스리시티 모니터링 구축",
    type: "SI",
    tasks: [
      { id: "t15", projectId: "p4", task: "인도스리시티 관제시스템 구축 관련 업무 회의", category: "일반", department: "전략", person: "신기루", startDate: "02월 10일", endDate: "02월 10일", status: "완료", manDays: 1 },
      { id: "t16", projectId: "p4", task: "인도스리시티 관제시스템 구축 견적 초안 작성", category: "일반", department: "전략", person: "신기루", startDate: "02월 19일", endDate: "02월 19일", status: "완료", manDays: 1 },
      { id: "t17", projectId: "p4", task: "견적 대표님 검토", category: "일반", department: "전략", person: "대표님", startDate: "02월 24일", endDate: "02월 24일", status: "보류", manDays: 1 },
    ],
  },
  {
    id: "p5",
    name: "AI실증(유명메카)",
    type: "R&D",
    period: "2025.01 ~ 2025.12",
    tasks: [
      { id: "t18", projectId: "p5", task: "제조데이터 수집", category: "일반", department: "전략", person: "진종헌", startDate: "02월 02일", endDate: "02월 02일", status: "완료", manDays: 1 },
      { id: "t19", projectId: "p5", task: "제조데이터 수집", category: "일반", department: "전략", person: "진종헌", startDate: "02월 09일", endDate: "02월 09일", status: "완료", manDays: 1 },
    ],
  },
  {
    id: "p6",
    name: "AI 가치사슬형 1차_공통",
    type: "R&D",
    period: "2026.01 ~ 2026.04",
    tasks: [
      { id: "t20", projectId: "p6", task: "사업계획서 작성 및 제출", category: "중요", department: "전략", person: "홍장표, 신기루", startDate: "11월 25일", endDate: "11월 28일", status: "완료", manDays: 4 },
      { id: "t21", projectId: "p6", task: "발표평가", category: "중요", department: "전략", person: "대표님", startDate: "12월 10일", endDate: "12월 10일", status: "완료", manDays: 1 },
      { id: "t22", projectId: "p6", task: "2021~2023년 전산화 작업", category: "일반", department: "전략", person: "홍장표, 외주", startDate: "02월 19일", endDate: "02월 25일", status: "진행", manDays: 7, isSubTask: true },
      { id: "t23", projectId: "p6", task: "2023~2025년 전산화 작업", category: "일반", department: "전략", person: "홍장표, 외주", startDate: "02월 25일", endDate: "02월 27일", status: "대기", manDays: 3, isSubTask: true },
      { id: "t24", projectId: "p6", task: "스캔본 PDF 레이아웃 추출 테스트", category: "일반", department: "ICT", person: "조종권, 배승우", startDate: "02월 27일", endDate: "03월 06일", status: "진행", manDays: 6 },
      { id: "t25", projectId: "p6", task: "벡터 DB 구축 진행", category: "일반", department: "ICT", person: "조종권, 배승우", startDate: "03월 09일", endDate: "03월 13일", status: "대기", manDays: 6 },
      { id: "t26", projectId: "p6", task: "엔티티 추출(spaCy)", category: "일반", department: "ICT", person: "조종권, 김성민", startDate: "02월 26일", endDate: "03월 06일", status: "진행", manDays: 6 },
      { id: "t27", projectId: "p6", task: "Naive RAG 구축 테스트", category: "일반", department: "ICT", person: "조종권, 배승우", startDate: "03월 02일", endDate: "03월 11일", status: "진행", manDays: 8 },
      { id: "t28", projectId: "p6", task: "AI모델선정", category: "일반", department: "ICT", person: "배승우", startDate: "03월 09일", endDate: "03월 13일", status: "대기", manDays: 5 },
      { id: "t29", projectId: "p6", task: "UI화면설계", category: "일반", department: "전략", person: "홍장표", startDate: "03월 16일", endDate: "03월 27일", status: "대기", manDays: 12 },
    ],
  },
  {
    id: "p7",
    name: "AI 가치사슬형 1차_율곡(창원)",
    type: "R&D",
    tasks: [
      { id: "t30", projectId: "p7", task: "도입 H/W 발주(입고기간 확인필요)", category: "일반", department: "전략", person: "홍장표", startDate: "02월 24일", endDate: "02월 24일", status: "대기", manDays: 1 },
      { id: "t31", projectId: "p7", task: "도입 H/W 현장 설치", category: "일반", department: "전략", person: "홍장표, 외주", startDate: "03월 11일", endDate: "03월 13일", status: "대기", manDays: 3 },
      { id: "t32", projectId: "p7", task: "네트워크 미연결 장비 설치 공사", category: "일반", department: "전략", person: "홍장표, 외주", startDate: "03월 11일", endDate: "03월 13일", status: "미정", manDays: 3 },
      { id: "t33", projectId: "p7", task: "와프 Agent 설치", category: "일반", department: "ICT", person: "최강일", startDate: "02월 27일", endDate: "02월 27일", status: "대기", manDays: 1, isSubTask: true },
    ],
  },
  {
    id: "p8",
    name: "AI 가치사슬형 1차_풍산홀딩스",
    type: "R&D",
    tasks: [
      { id: "t34", projectId: "p8", task: "3차 업무미팅(H/W설치 및 위치)", category: "일반", department: "전략", person: "홍장표", startDate: "02월 24일", endDate: "02월 24일", status: "대기", manDays: 1 },
      { id: "t35", projectId: "p8", task: "네트워크 미연결 장비 설치 공사", category: "일반", department: "전략", person: "홍장표, 외주", startDate: "03월 04일", endDate: "03월 07일", status: "대기", manDays: 4 },
      { id: "t36", projectId: "p8", task: "공사 일정 협의", category: "일반", department: "전략", person: "홍장표, 외주", startDate: "02월 27일", endDate: "02월 27일", status: "대기", manDays: 1, isSubTask: true },
    ],
  },
  {
    id: "p9",
    name: "AI 가치사슬형 1차_연암테크",
    type: "R&D",
    tasks: [
      { id: "t37", projectId: "p9", task: "네트워크 미연결 장비 설치 공사", category: "일반", department: "전략", person: "홍장표, 외주", startDate: "02월 26일", endDate: "02월 27일", status: "미정", manDays: 2 },
      { id: "t38", projectId: "p9", task: "접점장비 설치 공사", category: "일반", department: "전략", person: "홍장표", startDate: "03월 02일", endDate: "03월 06일", status: "대기", manDays: 5 },
      { id: "t39", projectId: "p9", task: "통신 테스트", category: "일반", department: "전략", person: "홍장표", startDate: "02월 23일", endDate: "02월 27일", status: "대기", manDays: 5 },
    ],
  },
  {
    id: "p10",
    name: "풍산홀딩스_스마트공장(고도화)",
    type: "S/F",
    period: "2026년도",
    tasks: [
      { id: "t40", projectId: "p10", task: "사업계획서 수정 보완", category: "일반", department: "전략", person: "신기루", startDate: "02월 20일", endDate: "02월 24일", status: "완료", manDays: 5, isSubTask: true },
      { id: "t41", projectId: "p10", task: "현장평가(2/26 오전 10시)", category: "중요", department: "전략", person: "신기루, 대표님, 홍장표", startDate: "02월 26일", endDate: "02월 26일", status: "완료", manDays: 1, isSubTask: true },
      { id: "t42", projectId: "p10", task: "사업계획서 보완 회신", category: "일반", department: "전략", person: "신기루, 홍장표", startDate: "02월 27일", endDate: "02월 28일", status: "진행", manDays: 2, isSubTask: true },
      { id: "t43", projectId: "p10", task: "원가계산", category: "일반", department: "전략", person: "신기루", startDate: "3월 중", endDate: "3월 중", status: "미정", manDays: 0 },
      { id: "t44", projectId: "p10", task: "최종협약", category: "일반", department: "전략", person: "신기루", startDate: "3월 중", endDate: "3월 중", status: "미정", manDays: 0 },
    ],
  },
  {
    id: "p11",
    name: "세원기계_스마트공장(고도화)",
    type: "S/F",
    period: "2026년도",
    tasks: [
      { id: "t45", projectId: "p11", task: "사업계획서 수정 보완(2차)", category: "일반", department: "전략", person: "진종헌", startDate: "02월 27일", endDate: "02월 28일", status: "진행", manDays: 2, isSubTask: true },
      { id: "t46", projectId: "p11", task: "현장평가(3/3 오전 10시)", category: "중요", department: "전략", person: "신기루, 대표님, 진종헌", startDate: "03월 03일", endDate: "03월 03일", status: "미정", manDays: 1, isSubTask: true },
      { id: "t47", projectId: "p11", task: "원가계산", category: "일반", department: "전략", person: "신기루", startDate: "3월 중", endDate: "3월 중", status: "미정", manDays: 0 },
    ],
  },
  {
    id: "p12",
    name: "상림엠에스피",
    type: "R&D",
    period: "2023.10 ~ 2025.09",
    tasks: [
      { id: "t48", projectId: "p12", task: "발표자료 보완 작성", category: "일반", department: "전략", person: "홍장표", startDate: "02월 24일", endDate: "02월 24일", status: "완료", manDays: 1, isSubTask: true },
      { id: "t49", projectId: "p12", task: "수정/보완 및 자료 전달", category: "일반", department: "전략", person: "홍장표", startDate: "02월 25일", endDate: "02월 25일", status: "완료", manDays: 1, isSubTask: true },
      { id: "t50", projectId: "p12", task: "최종발표평가(6월 예정)", category: "중요", department: "전략", person: "홍장표, 대표님", startDate: "06월", endDate: "06월", status: "미정", manDays: 0 },
    ],
  },
  {
    id: "p13",
    name: "지역혁신선도기업육성_창원대",
    type: "R&D",
    tasks: [
      { id: "t51", projectId: "p13", task: "사업계획서 방향설정", category: "일반", department: "전략", person: "신기루", startDate: "02월 24일", endDate: "02월 24일", status: "완료", manDays: 1 },
      { id: "t52", projectId: "p13", task: "사업계획서 초안작성", category: "일반", department: "전략", person: "신기루, 홍장표, 진종헌", startDate: "02월 24일", endDate: "02월 26일", status: "진행", manDays: 3 },
      { id: "t53", projectId: "p13", task: "제출서류 및 인건비 작성", category: "일반", department: "전략", person: "김보미", startDate: "02월 26일", endDate: "02월 26일", status: "진행", manDays: 1 },
      { id: "t54", projectId: "p13", task: "사업계획서 1차 회신", category: "일반", department: "전략", person: "신기루", startDate: "02월 26일", endDate: "02월 26일", status: "대기", manDays: 1 },
    ],
  },
  {
    id: "p14",
    name: "제조DX전환(연암테크)",
    type: "S/F",
    period: "2025.04 ~ 2025.10",
    tasks: [
      { id: "t55", projectId: "p14", task: "회계정산 보완제출", category: "일반", department: "전략", person: "홍장표, 김보미", startDate: "02월 12일", endDate: "02월 12일", status: "완료", manDays: 1 },
      { id: "t56", projectId: "p14", task: "연암 서버 공인IP 및 웹서버 설치 확인", category: "일반", department: "전략", person: "신기루, 최강일", startDate: "02월 20일", endDate: "02월 23일", status: "진행", manDays: 4 },
      { id: "t57", projectId: "p14", task: "화면 UI개발", category: "일반", department: "ICT", person: "최강일", startDate: "02월 26일", endDate: "03월 06일", status: "대기", manDays: 9 },
      { id: "t58", projectId: "p14", task: "웹서버 등록 및 테스트", category: "일반", department: "ICT", person: "최강일", startDate: "03월 09일", endDate: "03월 12일", status: "대기", manDays: 4 },
    ],
  },
  {
    id: "p15",
    name: "하이록코리아(녹산)",
    type: "Etc",
    tasks: [
      { id: "t59", projectId: "p15", task: "견적 검토", category: "일반", department: "전략", person: "신기루", startDate: "03월 02일", endDate: "03월 06일", status: "미정", manDays: 5 },
      { id: "t60", projectId: "p15", task: "제안서 초안 작성", category: "일반", department: "전략", person: "신기루", startDate: "03월 09일", endDate: "03월 12일", status: "미정", manDays: 4 },
      { id: "t61", projectId: "p15", task: "제안 발표", category: "일반", department: "전략", person: "신기루", startDate: "03월 17일", endDate: "03월 17일", status: "미정", manDays: 1 },
    ],
  },
  {
    id: "p16",
    name: "소공인 스마트 제조지원사업",
    type: "Etc",
    period: "2026년",
    tasks: [
      { id: "t62", projectId: "p16", task: "장비별 원가산정내역", category: "일반", department: "전략", person: "신기루", startDate: "02월 26일", endDate: "02월 27일", status: "진행", manDays: 2 },
      { id: "t63", projectId: "p16", task: "사업제출", category: "일반", department: "전략", person: "신기루", startDate: "02월 27일", endDate: "02월 27일", status: "대기", manDays: 1 },
    ],
  },
  {
    id: "p17",
    name: "한국브로치",
    type: "Etc",
    period: "2025.08",
    tasks: [
      { id: "t64", projectId: "p17", task: "현장테스트 일정 수립", category: "일반", department: "ICT", person: "박지완, 배승우", startDate: "03월 12일", endDate: "03월 13일", status: "미정", manDays: 2 },
      { id: "t65", projectId: "p17", task: "시험성적서 제출", category: "일반", department: "ICT", person: "배승우", startDate: "03월 27일", endDate: "03월 27일", status: "대기", manDays: 1 },
    ],
  },
]

export function getAllTasks(): Task[] {
  return projects.flatMap((p) => p.tasks)
}

export function getStatusCounts() {
  const tasks = getAllTasks()
  return {
    total: tasks.length,
    "완료": tasks.filter((t) => t.status === "완료").length,
    "진행": tasks.filter((t) => t.status === "진행").length,
    "대기": tasks.filter((t) => t.status === "대기").length,
    "보류": tasks.filter((t) => t.status === "보류").length,
    "미정": tasks.filter((t) => t.status === "미정").length,
  }
}

export function getPersonList(): string[] {
  const tasks = getAllTasks()
  const personSet = new Set<string>()
  tasks.forEach((t) => {
    t.person.split(",").forEach((p) => {
      const trimmed = p.trim()
      if (trimmed) personSet.add(trimmed)
    })
  })
  return Array.from(personSet).sort()
}

export function getDepartmentList(): string[] {
  return ["전략", "ICT", "FA", "기술고문"]
}
