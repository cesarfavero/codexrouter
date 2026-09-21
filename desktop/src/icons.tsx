import {
  Activity,
  ArrowLeft,
  ArrowRight,
  Brain,
  Check,
  Download,
  ExternalLink,
  Folder,
  LayoutGrid,
  Pause,
  Play,
  Plus,
  Power,
  RefreshCw,
  Settings2,
  ShieldCheck,
  Square,
  Trash2,
  Users,
  Wrench,
  X,
  type LucideProps,
} from 'lucide-react';
import type { ComponentType } from 'react';

export type IconName = 'accounts' | 'setup' | 'activity' | 'settings' | 'plus' | 'refresh' | 'play' | 'stop' | 'external' | 'trash' | 'check' | 'shield' | 'codex' | 'brain' | 'menu' | 'folder' | 'power' | 'pause' | 'arrow-left' | 'arrow-right' | 'download' | 'close';

const icons: Record<IconName, ComponentType<LucideProps>> = {
  accounts: Users,
  setup: Wrench,
  activity: Activity,
  settings: Settings2,
  plus: Plus,
  refresh: RefreshCw,
  play: Play,
  stop: Square,
  external: ExternalLink,
  trash: Trash2,
  check: Check,
  shield: ShieldCheck,
  codex: LayoutGrid,
  brain: Brain,
  menu: LayoutGrid,
  folder: Folder,
  power: Power,
  pause: Pause,
  'arrow-left': ArrowLeft,
  'arrow-right': ArrowRight,
  download: Download,
  close: X,
};

export function Icon({ name, ...props }: LucideProps & { name: IconName }) {
  const Component = icons[name];
  return <Component aria-hidden="true" focusable="false" {...props} />;
}
