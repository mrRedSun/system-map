import {
  Activity,
  Archive,
  BookOpen,
  Box,
  Boxes,
  CalendarClock,
  Cloud,
  Cog,
  Container,
  Cpu,
  ExternalLink,
  FileText,
  Globe,
  HardDrive,
  HelpCircle,
  History,
  Layers,
  LayoutGrid,
  ListChecks,
  type LucideIcon,
  Monitor,
  Network,
  Router,
  ScrollText,
  Server,
  ShieldCheck,
  Signpost,
  Smartphone,
  Timer,
  Waypoints,
  Workflow,
} from 'lucide-react';
import type { SystemModel } from '../../shared/model';
import type { EntityRef } from './model-index';

const NODE_ICONS: Record<string, LucideIcon> = {
  internet: Globe,
  cdn: Cloud,
  router: Router,
  host: Server,
  vm: Monitor,
  lxc: Container,
  device: Smartphone,
  external: ExternalLink,
  storage: HardDrive,
  vpn: ShieldCheck,
};

const SERVICE_ICONS: Record<string, LucideIcon> = {
  container: Box,
  compose: Layers,
  systemd: Cpu,
  native: Cog,
  timer: Timer,
  cron: CalendarClock,
  worker: Workflow,
  external: ExternalLink,
  'vm-app': Monitor,
};

const SECTION_ICONS: Record<string, LucideIcon> = {
  stacks: LayoutGrid,
  routes: Signpost,
  monitors: Activity,
  backups: Archive,
  jobs: CalendarClock,
  zones: Cloud,
  networks: Network,
  policies: ListChecks,
  procedures: BookOpen,
  history: History,
  open_questions: HelpCircle,
  articles: FileText,
};

export const GROUP_ICONS: Record<string, LucideIcon> = {
  'group:routes': Waypoints,
  'group:monitors': Activity,
  'group:backups': Archive,
};

export function iconFor(ref: EntityRef | undefined): LucideIcon {
  if (!ref) return Boxes;
  if (ref.section === 'nodes') {
    return NODE_ICONS[(ref.entity as SystemModel['nodes'][number]).kind] ?? Server;
  }
  if (ref.section === 'services') {
    return SERVICE_ICONS[(ref.entity as SystemModel['services'][number]).kind] ?? Cog;
  }
  return SECTION_ICONS[ref.section] ?? ScrollText;
}

/** Short "what is this" label, e.g. `lxc 120`, `container`, `route`. */
export function kindLabel(ref: EntityRef): string {
  if (ref.section === 'nodes') {
    const n = ref.entity as SystemModel['nodes'][number];
    return n.vmid !== undefined ? `${n.kind} ${n.vmid}` : n.kind;
  }
  if (ref.section === 'services') return (ref.entity as SystemModel['services'][number]).kind;
  return ref.kind;
}
