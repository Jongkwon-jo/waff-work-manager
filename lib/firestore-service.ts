import { db } from "./firebase";
import { 
  collection, 
  getDocs, 
  addDoc, 
  updateDoc, 
  deleteDoc, 
  doc, 
  query, 
  where, 
  writeBatch,
  getDoc,
  serverTimestamp,
  onSnapshot
} from "firebase/firestore";
import { Project, Task } from "./data";

const PROJECTS_COLLECTION = "projects";
const TASKS_COLLECTION = "tasks";

// 트리 구조를 만드는 헬퍼 함수
function buildProjectTree(projectsData: any[], allTasksData: any[]): Project[] {
  const projectsList: Project[] = [];

  const orderedProjects = [...projectsData].sort((a, b) => {
    const orderA = typeof a.displayOrder === "number" ? a.displayOrder : Number.MAX_SAFE_INTEGER;
    const orderB = typeof b.displayOrder === "number" ? b.displayOrder : Number.MAX_SAFE_INTEGER;
    if (orderA !== orderB) return orderA - orderB;
    return (a.name || "").localeCompare(b.name || "");
  });

  for (const projectData of orderedProjects) {
    const projectId = projectData.id;
    const projectTasks = allTasksData.filter(t => t.projectId === projectId);

    const taskMap: { [key: string]: Task } = {};
    const tasksList: Task[] = [];

    projectTasks.forEach(task => {
      taskMap[task.id] = { ...task, subTasks: [] };
    });

    const orderedTasks = [...projectTasks].sort((a, b) => {
      const orderA = typeof a.displayOrder === "number" ? a.displayOrder : Number.MAX_SAFE_INTEGER;
      const orderB = typeof b.displayOrder === "number" ? b.displayOrder : Number.MAX_SAFE_INTEGER;
      if (orderA !== orderB) return orderA - orderB;
      return (a.task || "").localeCompare(b.task || "");
    });

    orderedTasks.forEach(task => {
      const taskWithSub = taskMap[task.id];
      if (task.parentId && taskMap[task.parentId]) {
        taskMap[task.parentId].subTasks?.push(taskWithSub);
      } else {
        tasksList.push(taskWithSub);
      }
    });

    projectsList.push({
      ...projectData,
      id: projectId,
      tasks: tasksList,
      // createdAt이 없는 기존 데이터를 위해 기본값 처리
      createdAt: projectData.createdAt?.toDate?.() || new Date(0), 
    } as Project);
  }

  return projectsList;
}

// 실시간 구독 함수 (orderBy 제거)
export function subscribeToData(callback: (projects: Project[]) => void) {
  // orderBy를 제거하여 모든 문서를 가져오도록 수정
  const projectsQuery = collection(db, PROJECTS_COLLECTION);
  const tasksQuery = collection(db, TASKS_COLLECTION);

  let projects: any[] = [];
  let tasks: any[] = [];

  const updateAndNotify = () => {
    const tree = buildProjectTree(projects, tasks);
    callback(tree);
  };

  const unsubscribeProjects = onSnapshot(projectsQuery, (snapshot) => {
    projects = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    updateAndNotify();
  }, (error) => {
    console.error("Projects snapshot error:", error);
  });

  const unsubscribeTasks = onSnapshot(tasksQuery, (snapshot) => {
    tasks = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    updateAndNotify();
  }, (error) => {
    console.error("Tasks snapshot error:", error);
  });

  return () => {
    unsubscribeProjects();
    unsubscribeTasks();
  };
}

// 기존 fetch 함수에서도 orderBy 제거
export async function fetchProjectsWithTasks(): Promise<Project[]> {
  const projectsSnapshot = await getDocs(collection(db, PROJECTS_COLLECTION));
  const tasksSnapshot = await getDocs(collection(db, TASKS_COLLECTION));
  
  const projectsData = projectsSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
  const tasksData = tasksSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
  
  return buildProjectTree(projectsData, tasksData);
}

export async function addProjectToDB(project: Omit<Project, "id" | "tasks">): Promise<string> {
  const docRef = await addDoc(collection(db, PROJECTS_COLLECTION), {
    ...project,
    displayOrder: Date.now(),
    createdAt: serverTimestamp()
  });
  return docRef.id;
}

export async function updateProjectInDB(projectId: string, updates: Partial<Project>): Promise<void> {
  const projectRef = doc(db, PROJECTS_COLLECTION, projectId);
  await updateDoc(projectRef, updates);
}

export async function deleteProjectFromDB(projectId: string): Promise<void> {
  const tasksQuery = query(collection(db, TASKS_COLLECTION), where("projectId", "==", projectId));
  const tasksSnapshot = await getDocs(tasksQuery);
  const batch = writeBatch(db);
  tasksSnapshot.docs.forEach((taskDoc) => {
    batch.delete(taskDoc.ref);
  });
  const projectRef = doc(db, PROJECTS_COLLECTION, projectId);
  batch.delete(projectRef);
  await batch.commit();
}

export async function addTaskToDB(task: Omit<Task, "id">): Promise<string> {
  const docRef = await addDoc(collection(db, TASKS_COLLECTION), {
    ...task,
    displayOrder: typeof task.displayOrder === "number" ? task.displayOrder : Date.now(),
  });
  return docRef.id;
}

export async function updateTaskInDB(taskId: string, updates: Partial<Task>): Promise<void> {
  const taskRef = doc(db, TASKS_COLLECTION, taskId);
  await updateDoc(taskRef, updates);
}

export async function deleteTaskFromDB(taskId: string): Promise<void> {
  const taskRef = doc(db, TASKS_COLLECTION, taskId);
  await deleteDoc(taskRef);
}

export async function updateProjectOrdersInDB(projectIds: string[]): Promise<void> {
  const batch = writeBatch(db);
  projectIds.forEach((id, index) => {
    batch.update(doc(db, PROJECTS_COLLECTION, id), { displayOrder: index });
  });
  await batch.commit();
}

export async function updateTaskOrdersInDB(taskIds: string[]): Promise<void> {
  const batch = writeBatch(db);
  taskIds.forEach((id, index) => {
    batch.update(doc(db, TASKS_COLLECTION, id), { displayOrder: index });
  });
  await batch.commit();
}
