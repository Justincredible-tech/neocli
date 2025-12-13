// src/tools/todo.ts
/**
 * Todo/Task Tracking Tool
 * Tracks tasks and displays progress during agent execution.
 * Similar to Claude Code and Codex task tracking.
 */
import { Tool, ToolArgs } from '../types/index.js';
import { logger } from '../utils/logger.js';
import chalk from 'chalk';

/** Task status */
type TaskStatus = 'pending' | 'in_progress' | 'completed' | 'failed' | 'blocked';

/** Single task item */
interface Task {
  id: number;
  content: string;
  status: TaskStatus;
  createdAt: Date;
  completedAt?: Date;
}

/** Todo action arguments */
interface TodoArgs extends ToolArgs {
  action: 'add' | 'complete' | 'fail' | 'list' | 'clear' | 'update' | 'start';
  task?: string;
  tasks?: string[];
  id?: number;
  status?: TaskStatus;
}

/** In-memory task store (persists for session) */
let taskList: Task[] = [];
let nextId = 1;

/**
 * Formats a task for display.
 */
function formatTask(task: Task): string {
  const statusIcons: Record<TaskStatus, string> = {
    pending: '○',
    in_progress: '◐',
    completed: '●',
    failed: '✗',
    blocked: '◌'
  };

  const statusColors: Record<TaskStatus, (text: string) => string> = {
    pending: chalk.gray,
    in_progress: chalk.yellow,
    completed: chalk.green,
    failed: chalk.red,
    blocked: chalk.magenta
  };

  const icon = statusIcons[task.status];
  const colorFn = statusColors[task.status];

  return colorFn(`  ${icon} [${task.id}] ${task.content}`);
}

/**
 * Renders the full task list.
 */
function renderTaskList(): string {
  if (taskList.length === 0) {
    return chalk.gray('No tasks in list.');
  }

  const lines: string[] = [];
  lines.push(chalk.green.bold('Task Progress'));
  lines.push(chalk.green('─'.repeat(40)));

  // Group by status
  const inProgress = taskList.filter(t => t.status === 'in_progress');
  const pending = taskList.filter(t => t.status === 'pending');
  const completed = taskList.filter(t => t.status === 'completed');
  const failed = taskList.filter(t => t.status === 'failed');
  const blocked = taskList.filter(t => t.status === 'blocked');

  if (inProgress.length > 0) {
    lines.push(chalk.yellow.bold('\n⏳ In Progress:'));
    inProgress.forEach(t => lines.push(formatTask(t)));
  }

  if (pending.length > 0) {
    lines.push(chalk.gray.bold('\n📋 Pending:'));
    pending.forEach(t => lines.push(formatTask(t)));
  }

  if (blocked.length > 0) {
    lines.push(chalk.magenta.bold('\n⛔ Blocked:'));
    blocked.forEach(t => lines.push(formatTask(t)));
  }

  if (completed.length > 0) {
    lines.push(chalk.green.bold('\n✓ Completed:'));
    completed.forEach(t => lines.push(formatTask(t)));
  }

  if (failed.length > 0) {
    lines.push(chalk.red.bold('\n✗ Failed:'));
    failed.forEach(t => lines.push(formatTask(t)));
  }

  // Summary
  lines.push(chalk.green('\n─'.repeat(40)));
  const total = taskList.length;
  const done = completed.length;
  const progress = total > 0 ? Math.round((done / total) * 100) : 0;

  // Progress bar
  const barWidth = 20;
  const filled = Math.round((progress / 100) * barWidth);
  const progressBar = chalk.green('█'.repeat(filled)) + chalk.gray('░'.repeat(barWidth - filled));

  lines.push(`${progressBar} ${progress}% (${done}/${total} tasks)`);

  return lines.join('\n');
}

const tool: Tool = {
  name: 'todo',
  description: 'Track tasks and progress. Actions: add (single or multiple), start, complete, fail, list, clear, update',
  source: 'CORE',
  execute: async (args: ToolArgs): Promise<string> => {
    const { action, task, tasks, id, status } = args as TodoArgs;

    try {
      switch (action) {
        case 'add': {
          // Add single task or multiple tasks
          if (tasks && Array.isArray(tasks)) {
            const added: Task[] = [];
            for (const t of tasks) {
              const newTask: Task = {
                id: nextId++,
                content: t,
                status: 'pending',
                createdAt: new Date()
              };
              taskList.push(newTask);
              added.push(newTask);
            }
            logger.info("Added tasks", { count: added.length });
            return `Added ${added.length} tasks:\n${added.map(t => formatTask(t)).join('\n')}\n\n${renderTaskList()}`;
          }

          if (!task) {
            return "Error: 'task' or 'tasks' parameter required for 'add' action.";
          }

          const newTask: Task = {
            id: nextId++,
            content: task,
            status: 'pending',
            createdAt: new Date()
          };
          taskList.push(newTask);
          logger.info("Added task", { id: newTask.id, content: task });

          return `Added task:\n${formatTask(newTask)}\n\n${renderTaskList()}`;
        }

        case 'start': {
          if (id === undefined) {
            // Start the first pending task
            const pendingTask = taskList.find(t => t.status === 'pending');
            if (!pendingTask) {
              return "No pending tasks to start.";
            }
            pendingTask.status = 'in_progress';
            return `Started task:\n${formatTask(pendingTask)}\n\n${renderTaskList()}`;
          }

          const taskToStart = taskList.find(t => t.id === id);
          if (!taskToStart) {
            return `Error: Task #${id} not found.`;
          }
          taskToStart.status = 'in_progress';
          return `Started task:\n${formatTask(taskToStart)}\n\n${renderTaskList()}`;
        }

        case 'complete': {
          if (id === undefined) {
            // Complete the first in-progress task
            const inProgressTask = taskList.find(t => t.status === 'in_progress');
            if (!inProgressTask) {
              return "No in-progress tasks to complete.";
            }
            inProgressTask.status = 'completed';
            inProgressTask.completedAt = new Date();
            return `Completed task:\n${formatTask(inProgressTask)}\n\n${renderTaskList()}`;
          }

          const taskToComplete = taskList.find(t => t.id === id);
          if (!taskToComplete) {
            return `Error: Task #${id} not found.`;
          }
          taskToComplete.status = 'completed';
          taskToComplete.completedAt = new Date();
          return `Completed task:\n${formatTask(taskToComplete)}\n\n${renderTaskList()}`;
        }

        case 'fail': {
          if (id === undefined) {
            return "Error: 'id' parameter required for 'fail' action.";
          }

          const taskToFail = taskList.find(t => t.id === id);
          if (!taskToFail) {
            return `Error: Task #${id} not found.`;
          }
          taskToFail.status = 'failed';
          return `Marked task as failed:\n${formatTask(taskToFail)}\n\n${renderTaskList()}`;
        }

        case 'update': {
          if (id === undefined || !status) {
            return "Error: 'id' and 'status' parameters required for 'update' action.";
          }

          const taskToUpdate = taskList.find(t => t.id === id);
          if (!taskToUpdate) {
            return `Error: Task #${id} not found.`;
          }

          const validStatuses: TaskStatus[] = ['pending', 'in_progress', 'completed', 'failed', 'blocked'];
          if (!validStatuses.includes(status)) {
            return `Error: Invalid status. Use: ${validStatuses.join(', ')}`;
          }

          taskToUpdate.status = status;
          if (status === 'completed') {
            taskToUpdate.completedAt = new Date();
          }
          return `Updated task:\n${formatTask(taskToUpdate)}\n\n${renderTaskList()}`;
        }

        case 'list': {
          return renderTaskList();
        }

        case 'clear': {
          const count = taskList.length;
          taskList = [];
          nextId = 1;
          return `Cleared ${count} task(s). Task list is now empty.`;
        }

        default:
          return `Error: Unknown action '${action}'. Use: add, start, complete, fail, list, clear, update`;
      }
    } catch (e: unknown) {
      const error = e as Error;
      logger.error("Todo tool error", error);
      return `Error: ${error.message}`;
    }
  }
};

export default tool;
