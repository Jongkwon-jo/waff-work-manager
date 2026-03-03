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
  getDoc
} from "firebase/firestore";
import { Project, Task } from "./data";

const PROJECTS_COLLECTION = "projects";
const TASKS_COLLECTION = "tasks";

export async function fetchProjectsWithTasks(): Promise<Project[]> {
  try {
    console.log("Fetching projects from Firestore...");
    const projectsSnapshot = await getDocs(collection(db, PROJECTS_COLLECTION));
    const projectsList: Project[] = [];

    for (const projectDoc of projectsSnapshot.docs) {
      const projectData = projectDoc.data();
      const projectId = projectDoc.id;

      const tasksQuery = query(
        collection(db, TASKS_COLLECTION),
        where("projectId", "==", projectId)
      );
      const tasksSnapshot = await getDocs(tasksQuery);
      const tasksList: Task[] = tasksSnapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      } as Task));

      projectsList.push({
        id: projectId,
        name: projectData.name,
        type: projectData.type,
        period: projectData.period,
        tasks: tasksList,
      });
    }
    console.log(`Fetched ${projectsList.length} projects.`);
    return projectsList;
  } catch (error) {
    console.error("Error in fetchProjectsWithTasks:", error);
    throw error;
  }
}

export async function addProjectToDB(project: Omit<Project, "id" | "tasks">): Promise<string> {
  const docRef = await addDoc(collection(db, PROJECTS_COLLECTION), project);
  return docRef.id;
}

export async function addTaskToDB(task: Omit<Task, "id">): Promise<string> {
  const docRef = await addDoc(collection(db, TASKS_COLLECTION), task);
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
