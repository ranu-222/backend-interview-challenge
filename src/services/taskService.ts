import { v4 as uuidv4 } from 'uuid';
import { Task } from '../types';
import { Database } from '../db/database';

export class TaskService {
  constructor(private db: Database) {}

  async createTask(taskData: Partial<Task>): Promise<Task> {
    const id = uuidv4();
    const timestamp = Date.now();

    const task: Task = {
      id,
      title: taskData.title!,
      description: taskData.description || "",
      completed: false,
      is_deleted: false,
      created_at: new Date(),
      updated_at: new Date(),
      sync_status: "pending",
    };

    await this.db.insertTask(task);

    // Simple sync placeholder (for now)
    await this.db.addToSyncQueue({
      id,
      action: "create",
      updated_at: timestamp
    });

    return task;
  }

  async updateTask(id: string, updates: Partial<Task>): Promise<Task | null> {
    const existing = await this.db.getTask(id);
    if (!existing || existing.is_deleted) return null;

    const updatedTask: Task = {
      ...existing,
      ...updates,
      updated_at: new Date(),
      sync_status: "pending",
    };

    await this.db.updateTask(updatedTask);

    await this.db.addToSyncQueue({
      id,
      action: "update",
      updated_at: Date.now()
    });

    return updatedTask;
  }

  async deleteTask(id: string): Promise<boolean> {
    const existing = await this.db.getTask(id);
    if (!existing) return false;

    const updatedTask: Task = {
      ...existing,
      is_deleted: true,
      updated_at: new Date(),
      sync_status: "pending",
    };

    await this.db.updateTask(updatedTask);

    await this.db.addToSyncQueue({
      id,
      action: "delete",
      updated_at: Date.now()
    });

    return true;
  }

  async getTask(id: string): Promise<Task | null> {
    const task = await this.db.getTask(id);
    if (!task || task.is_deleted) return null;
    return task;
  }

  async getAllTasks(): Promise<Task[]> {
    const tasks = await this.db.getAllTasks();
    return tasks.filter(t => !t.is_deleted);
  }

  async getTasksNeedingSync(): Promise<Task[]> {
    return this.db.getTasksBySyncStatus(["pending", "error"]);
  }
}
