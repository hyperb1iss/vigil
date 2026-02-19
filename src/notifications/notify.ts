import type { Notification } from '../types/store.js';

/**
 * Send a desktop notification via terminal-notifier / osascript (macOS)
 * or notify-send (Linux). When a URL is provided, clicking the notification
 * opens it in the default browser (requires terminal-notifier on macOS).
 */
export async function sendDesktopNotification(
  title: string,
  body: string,
  subtitle?: string,
  sound?: boolean,
  url?: string
): Promise<void> {
  if (process.platform === 'darwin') {
    await sendMacNotification(title, body, subtitle, sound, url);
  } else if (process.platform === 'linux') {
    await sendLinuxNotification(title, body, url);
  }
}

// Cache terminal-notifier availability so we only check once
let terminalNotifierAvailable: boolean | null = null;

async function hasTerminalNotifier(): Promise<boolean> {
  if (terminalNotifierAvailable !== null) return terminalNotifierAvailable;
  try {
    const proc = Bun.spawn(['which', 'terminal-notifier'], {
      stdout: 'ignore',
      stderr: 'ignore',
    });
    const code = await proc.exited;
    terminalNotifierAvailable = code === 0;
  } catch {
    terminalNotifierAvailable = false;
  }
  return terminalNotifierAvailable;
}

async function sendMacNotification(
  title: string,
  body: string,
  subtitle?: string,
  sound?: boolean,
  url?: string
): Promise<void> {
  // Prefer terminal-notifier — supports click-to-open URLs
  if (await hasTerminalNotifier()) {
    const args = [
      '-title',
      title,
      '-message',
      body,
      '-group',
      'vigil',
      '-appIcon',
      '', // Use default
    ];
    if (subtitle) args.push('-subtitle', subtitle);
    if (sound) args.push('-sound', 'Glass');
    if (url) args.push('-open', url);

    const proc = Bun.spawn(['terminal-notifier', ...args], {
      stdout: 'ignore',
      stderr: 'ignore',
    });
    await proc.exited;
    return;
  }

  // Fallback: osascript (no click-to-open)
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

async function sendLinuxNotification(title: string, body: string, url?: string): Promise<void> {
  const args = [title, body];
  if (url) {
    // -u low = non-intrusive, --action opens in browser on click
    args.push('--action', `open=Open in browser`);
  }

  const proc = Bun.spawn(['notify-send', ...args], {
    stdout: 'pipe',
    stderr: 'ignore',
  });

  // If action was clicked, open the URL
  if (url) {
    const output = await new Response(proc.stdout).text();
    if (output.trim() === 'open') {
      Bun.spawn(['xdg-open', url], { stdout: 'ignore', stderr: 'ignore' });
    }
  }

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
