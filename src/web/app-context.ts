import { createContext, useContext } from 'react';
import type { HealthStatus, SystemModel } from '../shared/model';
import type { BackRef, ModelIndex } from './lib/model-index';
import type { Location } from './lib/router';

export interface AppContextValue {
  model: SystemModel;
  index: ModelIndex;
  backRefs: Map<string, BackRef[]>;
  location: Location;
  navigate: (loc: Location) => void;
  /** Hash that opens an entity on top of the current view. */
  hrefFor: (id: string) => string;
  healthOf: (id: string) => HealthStatus | undefined;
}

export const AppContext = createContext<AppContextValue | null>(null);

export function useApp(): AppContextValue {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp outside AppContext');
  return ctx;
}
