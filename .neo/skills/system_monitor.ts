/* NEO_SKILL_META
{
  "name": "system_monitor",
  "description": "Checks system health including CPU load, Free RAM, and GPU VRAM (via nvidia-smi).",
  "argsSchema": {
    "type": "object",
    "properties": {},
    "required": []
  }
}
NEO_SKILL_META */

import os from 'os';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export async function run() {
  const totalMem = os.totalmem() / (1024 * 1024 * 1024);
  const freeMem = os.freemem() / (1024 * 1024 * 1024);
  const cpuLoad = os.loadavg(); // [1min, 5min, 15min]

  let gpuInfo = "N/A (nvidia-smi not found)";
  
  try {
    // Attempt to get NVIDIA VRAM
    const { stdout } = await execAsync('nvidia-smi --query-gpu=memory.used,memory.total --format=csv,noheader,nounits');
    const [used, total] = stdout.trim().split(', ');
    gpuInfo = `${used}MB / ${total}MB`;
  } catch (e) {
    // GPU check failed or not present
  }

  return JSON.stringify({
    cpu_load_1min: cpuLoad[0].toFixed(2),
    ram_free_gb: freeMem.toFixed(2),
    ram_total_gb: totalMem.toFixed(2),
    gpu_vram_usage: gpuInfo,
    platform: os.platform()
  }, null, 2);
}