import axios from "axios";
import { Task, SyncQueueItem, SyncResult, BatchSyncRequest, BatchSyncResponse } from "../types";
import { Database } from "../db/database";
import { TaskService } from "./taskService";

const SYNC_BATCH_SIZE = parseInt(process.env.SYNC_BATCH_SIZE || "10");
const MAX_RETRY = 3;

export class SyncService {
  private apiUrl: string;

  constructor(
    private db: Database,
    private taskService: TaskService,
    apiUrl: string = process.env.API_BASE_URL || "http://localhost:3000/api"
  ) {
    this.apiUrl = apiUrl;
  }

  async sync(): Promise<SyncResult> {
    const queue = await this.db.query<SyncQueueItem[]>("SELECT * FROM sync_queue ORDER BY id ASC");

    if (queue.length === 0) {
      return { success: 0, failed: 0, skipped: 0 };
    }

    const batches: SyncQueueItem[][] = [];
    for (let i = 0; i < queue.length; i += SYNC_BATCH_SIZE) {
      batches.push(queue.slice(i, i + SYNC_BATCH_SIZE));
    }

    let success = 0, failed = 0;

    for (const batch of batches) {
      try {
        const result = await this.processBatch(batch);
        success += result.success;
        failed += result.failed;
      } catch {
        // If batch fails, mark all as failed
        for (const item of batch) {
          await this.handleSyncError(item, new Error("Batch failed"));
          failed++;
        }
      }
    }

    return { success, failed, skipped: 0 };
  }

  async addToSyncQueue(
    taskId: string,
    operation: "create" | "update" | "delete",
    data: Partial<Task>
  ): Promise<void> {
    await this.db.query(
      `INSERT INTO sync_queue(task_id, operation, data, retry_count) VALUES (?, ?, ?, 0)`,
      [taskId, operation, JSON.stringify(data)]
    );
  }

  private async processBatch(items: SyncQueueItem[]): Promise<BatchSyncResponse> {
    const req: BatchSyncRequest = {
      operations: items.map((i) => ({
        taskId: i.task_id,
        operation: i.operation,
        data: JSON.parse(i.data)
      }))
    };

    const response = await axios.post(`${this.apiUrl}/tasks/batch`, req);
    const results = response.data;

    let success = 0, failed = 0;

    for (const res of results.results) {
      const item = items.find((i) => i.task_id === res.taskId);
      if (!item) continue;

      if (res.status === "success") {
        await this.updateSyncStatus(item.task_id, "synced", res.data);
        success++;
      } else if (res.status === "conflict") {
        const local = await this.taskService.getTask(item.task_id);
        const resolved = await this.resolveConflict(local!, res.serverData);
        await this.taskService.updateTask(item.task_id, resolved);
        await this.updateSyncStatus(item.task_id, "synced");
        success++;
      } else {
        await this.handleSyncError(item, new Error(res.message));
        failed++;
      }
    }

    return { success, failed };
  }

  private async resolveConflict(localTask: Task, serverTask: Task): Promise<Task> {
    return new Date(localTask.updated_at) > new Date(serverTask.updated_at)
      ? localTask
      : serverTask;
  }

  private async updateSyncStatus(
    taskId: string,
    status: "synced" | "error",
    serverData?: Partial<Task>
  ): Promise<void> {
    if (status === "synced") {
      await this.db.query(
        `UPDATE tasks SET sync_status='synced', last_synced_at=CURRENT_TIMESTAMP WHERE id=?`,
        [taskId]
      );
      await this.db.query(`DELETE FROM sync_queue WHERE task_id=?`, [taskId]);

      if (serverData) {
        await this.taskService.updateTask(taskId, serverData);
      }
    } else {
      await this.db.query(
        `UPDATE tasks SET sync_status='error' WHERE id=?`,
        [taskId]
      );
    }
  }

  private async handleSyncError(item: SyncQueueItem, error: Error): Promise<void> {
    const retry = item.retry_count + 1;
    let msg = error.message || "Unknown sync error";

    if (retry >= MAX_RETRY) {
      await this.db.query(
        `UPDATE sync_queue SET retry_count=?, error=?, permanent_fail=1 WHERE id=?`,
        [retry, msg, item.id]
      );
    } else {
      await this.db.query(
        `UPDATE sync_queue SET retry_count=?, error=? WHERE id=?`,
        [retry, msg, item.id]
      );
    }
  }

  async checkConnectivity(): Promise<boolean> {
    try {
      await axios.get(`${this.apiUrl}/health`, { timeout: 5000 });
      return true;
    } catch {
      return false;
    }
  }
}
