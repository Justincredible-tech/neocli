// src/utils/progress.ts
/**
 * Matrix-themed progress bar utilities.
 * Green-on-black aesthetic with customizable styling.
 */

import chalk from 'chalk';

export interface ProgressOptions {
  /** Total width of the progress bar (default: 40) */
  width?: number;
  /** Character for filled portion (default: '█') */
  fillChar?: string;
  /** Character for empty portion (default: '░') */
  emptyChar?: string;
  /** Show percentage (default: true) */
  showPercent?: boolean;
  /** Show count (default: true) */
  showCount?: boolean;
  /** Label prefix (default: 'Progress') */
  label?: string;
}

/**
 * Generates a Matrix-themed progress bar string.
 * @param current - Current progress value
 * @param total - Total value
 * @param options - Display options
 * @returns Formatted progress bar string
 */
export function progressBar(current: number, total: number, options: ProgressOptions = {}): string {
  const {
    width = 40,
    fillChar = '█',
    emptyChar = '░',
    showPercent = true,
    showCount = true,
    label = 'Progress'
  } = options;

  const percent = total > 0 ? Math.min(100, Math.round((current / total) * 100)) : 0;
  const filled = Math.round((percent / 100) * width);
  const empty = width - filled;

  const bar = chalk.green(fillChar.repeat(filled)) + chalk.gray(emptyChar.repeat(empty));

  const parts: string[] = [chalk.green(label), `[${bar}]`];

  if (showPercent) {
    parts.push(chalk.green(`${percent}%`));
  }

  if (showCount) {
    parts.push(chalk.gray(`(${current}/${total})`));
  }

  return parts.join(' ');
}

/**
 * Creates a spinner-style progress indicator for indeterminate operations.
 * @param message - Message to display
 * @param frame - Current animation frame (0-9)
 * @returns Formatted spinner string
 */
export function spinner(message: string, frame: number): string {
  const frames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
  const idx = Math.abs(frame) % frames.length;
  return `${chalk.green(frames[idx])} ${chalk.green(message)}`;
}

/**
 * Creates a multi-step progress display.
 * @param steps - Array of step names
 * @param currentStep - Index of current step (0-based)
 * @param status - Status of current step ('pending' | 'in_progress' | 'completed' | 'failed')
 * @returns Formatted multi-step progress string
 */
export function multiStepProgress(
  steps: string[],
  currentStep: number,
  status: 'pending' | 'in_progress' | 'completed' | 'failed' = 'in_progress'
): string {
  const lines: string[] = [];

  for (let i = 0; i < steps.length; i++) {
    let icon: string;
    let stepText: string;

    if (i < currentStep) {
      icon = chalk.green('✓');
      stepText = chalk.gray(steps[i]);
    } else if (i === currentStep) {
      switch (status) {
        case 'completed':
          icon = chalk.green('✓');
          stepText = chalk.green(steps[i]);
          break;
        case 'failed':
          icon = chalk.red('✗');
          stepText = chalk.red(steps[i]);
          break;
        case 'in_progress':
          icon = chalk.green('▶');
          stepText = chalk.green(steps[i]);
          break;
        default:
          icon = chalk.gray('○');
          stepText = chalk.white(steps[i]);
      }
    } else {
      icon = chalk.gray('○');
      stepText = chalk.gray(steps[i]);
    }

    lines.push(`  ${icon} ${stepText}`);
  }

  return lines.join('\n');
}

/**
 * Creates a download/transfer progress display.
 * @param downloaded - Bytes downloaded
 * @param total - Total bytes
 * @param speed - Transfer speed in bytes/second (optional)
 * @returns Formatted download progress string
 */
export function downloadProgress(downloaded: number, total: number, speed?: number): string {
  const formatBytes = (bytes: number): string => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
  };

  const bar = progressBar(downloaded, total, {
    width: 30,
    label: 'Download',
    showPercent: true,
    showCount: false
  });

  const sizeInfo = chalk.gray(`${formatBytes(downloaded)} / ${formatBytes(total)}`);
  const speedInfo = speed ? chalk.gray(` @ ${formatBytes(speed)}/s`) : '';

  return `${bar} ${sizeInfo}${speedInfo}`;
}
