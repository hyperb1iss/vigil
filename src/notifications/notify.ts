import type { Notification } from '../types/store.js';

/**
 * Send a desktop notification via osascript (macOS) or notify-send (Linux).
 */
export async function sendDesktopNotification(
  title: string,
  body: string,
  subtitle?: string,
  sound?: boolean,
): Promise<void> {
  if (process.platform === 'darwin') {
    await sendMacNotification(title, body, subtitle, sound);
  } else if (process.platform === 'linux') {
    await sendLinuxNotification(title, body);
  }
}

async function sendMacNotification(
  title: string,
  body: string,
  subtitle?: string,
  sound?: boolean,
): Promise<void> {
  const parts = [`display notification ${escapeAppleScript(body)}`];
  parts.push(`with title ${escapeAppleScript(title)}`);
  if (subtitle) {
    parts.push(`subtitle ${escapeAppleScript(subtitle)}`);
  }
  if (sound) {
    parts.push('sound name "Glass"');
  }

  const script = parts.join(' ');
  const proc = Bun.spawn(['osascript', '-e', script], {
    stdout: 'ignore',
    stderr: 'ignore',
  });
  await proc.exited;
}

async function sendLinuxNotification(title: string, body: string): Promise<void> {
  const proc = Bun.spawn(['notify-send', title, body], {
    stdout: 'ignore',
    stderr: 'ignore',
  });
  await proc.exited;
}

function escapeAppleScript(str: string): string {
  return `"${str.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

/**
 * Determine if a notification should trigger a desktop alert based on priority.
 */
export function shouldNotifyDesktop(notification: Notification): boolean {
  return notification.priority === 'critical' || notification.priority === 'high';
}

/**
 * Determine if a notification should play a sound.
 */
export function shouldPlaySound(notification: Notification): boolean {
  return notification.priority === 'critical';
}
