import type { SVGProps } from 'react';

export type IconName = 'accounts' | 'setup' | 'activity' | 'settings' | 'plus' | 'refresh' | 'play' | 'stop' | 'external' | 'trash' | 'check' | 'shield' | 'codex' | 'brain' | 'menu' | 'folder' | 'power';

export function Icon({ name, ...props }: SVGProps<SVGSVGElement> & { name: IconName }) {
  const common = { fill: 'none', stroke: 'currentColor', strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, strokeWidth: 1.8 };
  const paths: Record<IconName, React.ReactNode> = {
    accounts: <><circle cx="8" cy="8" r="3"/><path d="M2.5 19c.6-4 2.5-6 5.5-6s4.9 2 5.5 6"/><circle cx="17" cy="9" r="2.3"/><path d="M15.2 14.1c3.6-.5 5.5 1.1 6.1 4.4"/></>,
    setup: <><path d="M12 3v3M12 18v3M3 12h3M18 12h3"/><circle cx="12" cy="12" r="4"/><path d="M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M18.4 5.6l-2.1 2.1M7.7 16.3l-2.1 2.1"/></>,
    activity: <><path d="M3 12h4l2-5 4 10 2-5h6"/></>,
    settings: <><circle cx="12" cy="12" r="3.2"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6v.2h-4V21a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1L4.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.9A1.7 1.7 0 0 0 3 14H2.8v-4H3a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9L4.2 7 7 4.2l.1.1a1.7 1.7 0 0 0 1.9.3A1.7 1.7 0 0 0 10 3V2.8h4V3a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1L19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1h.2v4H21a1.7 1.7 0 0 0-1.6 1Z"/></>,
    plus: <><path d="M12 5v14M5 12h14"/></>,
    refresh: <><path d="M20 7v5h-5"/><path d="M18.2 16a7 7 0 1 1 .7-7.1L20 12"/></>,
    play: <path d="m9 6 9 6-9 6Z"/>,
    stop: <rect x="7" y="7" width="10" height="10" rx="1.5"/>,
    external: <><path d="M14 5h5v5"/><path d="m12 12 7-7"/><path d="M19 13v5a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h5"/></>,
    trash: <><path d="M5 7h14M9 7V4h6v3M8 10v8M12 10v8M16 10v8M6 7l1 14h10l1-14"/></>,
    check: <path d="m5 12 4 4L19 6"/>,
    shield: <><path d="M12 3 5 6v5c0 4.8 2.8 8 7 10 4.2-2 7-5.2 7-10V6Z"/><path d="m9 12 2 2 4-4"/></>,
    codex: <><path d="M9.5 4.2A3.2 3.2 0 0 0 6 7.3a3.2 3.2 0 0 0-1.2 5.8A3.2 3.2 0 0 0 8 18.8a3.2 3.2 0 0 0 4 1.2 3.2 3.2 0 0 0 4-1.2 3.2 3.2 0 0 0 3.2-5.7A3.2 3.2 0 0 0 18 7.3a3.2 3.2 0 0 0-3.5-3.1 3.2 3.2 0 0 0-5 0Z"/><path d="M12 4v16M7 9h2M15 9h2M7.5 14H10M14 14h2.5"/></>,
    brain: <><path d="M9.5 4.2A3.2 3.2 0 0 0 6 7.3a3.2 3.2 0 0 0-1.2 5.8A3.2 3.2 0 0 0 8 18.8a3.2 3.2 0 0 0 4 1.2 3.2 3.2 0 0 0 4-1.2 3.2 3.2 0 0 0 3.2-5.7A3.2 3.2 0 0 0 18 7.3a3.2 3.2 0 0 0-3.5-3.1 3.2 3.2 0 0 0-5 0Z"/><path d="M12 4v16M7 9h2M15 9h2M7.5 14H10M14 14h2.5"/></>,
    menu: <><path d="M5 8h14M5 12h14M5 16h14"/></>,
    folder: <path d="M3 7h7l2 2h9v10H3Z"/>,
    power: <><path d="M12 3v9"/><path d="M7 5.8a8 8 0 1 0 10 0"/></>,
  };
  return <svg aria-hidden="true" viewBox="0 0 24 24" {...common} {...props}>{paths[name]}</svg>;
}
