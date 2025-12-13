/* NEO_SKILL_META
{
  "name": "cron_job",
  "description": "Adds a task to the system Crontab. (Unix/WSL/MacOS only).",
  "argsSchema": {
    "type": "object",
    "properties": {
      "schedule": { "type": "string", "description": "Cron expression (e.g. '0 8 * * *')" },
      "command": { "type": "string", "description": "Command to run" }
    },
    "required": ["schedule", "command"]
  }
}
NEO_SKILL_META */

import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export async function run(args: { schedule: string; command: string }) {
  try {
    // 1. Get current crontab
    let currentCron = "";
    try {
      const { stdout } = await execAsync('crontab -l');
      currentCron = stdout;
    } catch (e) {
      // crontab might be empty
    }

    // 2. Append new job
    const newJob = `${args.schedule} ${args.command}`;
    if (currentCron.includes(newJob)) return "Job already exists in crontab.";

    const newCron = currentCron + '\n' + newJob + '\n';

    // 3. Save
    // We use echo piped to crontab
    await execAsync(`echo "${newCron}" | crontab -`);

    return `Success. Job added:\n${newJob}`;
  } catch (e: any) {
    return `Cron Error (Are you on Windows?): ${e.message}`;
  }
}