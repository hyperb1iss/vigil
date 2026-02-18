import { useStdout } from 'ink';
import { useCallback, useEffect, useRef } from 'react';

export interface MouseEvent {
  /** 0=left, 1=middle, 2=right, 64=scrollUp, 65=scrollDown */
  button: number;
  /** 1-based column */
  x: number;
  /** 1-based row */
  y: number;
  /** true if this is a button release */
  isRelease: boolean;
}

export type MouseHandler = (event: MouseEvent) => void;

/**
 * Enable terminal mouse tracking and dispatch parsed events.
 *
 * Uses SGR extended mouse mode for coordinates >223.
 * Only activates in interactive TTY environments.
 */
export function useMouse(handler: MouseHandler): void {
  const { stdout } = useStdout();
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  const onData = useCallback((data: Buffer) => {
    const str = data.toString();
    // SGR extended mouse: ESC[<Btn;X;YM (press) or ESC[<Btn;X;Ym (release)
    // biome-ignore lint/suspicious/noControlCharactersInRegex: mouse escape sequences require ESC char
    const regex = /\x1b\[<(\d+);(\d+);(\d+)([Mm])/g;
    let match: RegExpExecArray | null = regex.exec(str);
    while (match !== null) {
      const button = Number.parseInt(match[1] as string, 10);
      const x = Number.parseInt(match[2] as string, 10);
      const y = Number.parseInt(match[3] as string, 10);
      const isRelease = match[4] === 'm';
      handlerRef.current({ button, x, y, isRelease });
      match = regex.exec(str);
    }
  }, []);

  useEffect(() => {
    // Guard: only enable mouse in interactive TTY terminals
    if (!process.stdin.isTTY || !process.stdout.isTTY) return;

    // Enable mouse tracking
    stdout.write('\x1b[?1000h'); // Basic mouse mode
    stdout.write('\x1b[?1006h'); // SGR extended mouse mode

    process.stdin.on('data', onData);

    return () => {
      // Disable mouse tracking
      stdout.write('\x1b[?1000l');
      stdout.write('\x1b[?1006l');
      process.stdin.off('data', onData);
    };
  }, [stdout, onData]);
}
