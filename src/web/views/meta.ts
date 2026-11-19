import {
  AlertTriangle,
  BookOpen,
  CalendarClock,
  HelpCircle,
  History,
  Network,
  Shield,
  Signpost,
  Table2,
  type LucideIcon,
} from 'lucide-react';
import type { View } from '@/lib/router';

export const VIEW_META: Record<View, { label: string; icon: LucideIcon }> = {
  graph: { label: 'Topology', icon: Network },
  entities: { label: 'Entities', icon: Table2 },
  routes: { label: 'Routes', icon: Signpost },
  firewall: { label: 'Firewall', icon: Shield },
  jobs: { label: 'Jobs & backups', icon: CalendarClock },
  policies: { label: 'Policies', icon: BookOpen },
  history: { label: 'History', icon: History },
  questions: { label: 'Questions', icon: HelpCircle },
  problems: { label: 'Problems', icon: AlertTriangle },
};
