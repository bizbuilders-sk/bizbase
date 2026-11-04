import {createContext, useContext} from 'react';
import type {ReactNode} from 'react';
import type {EntityColor} from './entity-presentation.ts';

const ColorContext = createContext<EntityColor>('deals');
export const useEntityColor = () => useContext(ColorContext);
export function EntityTheme({entity, children}: {entity: EntityColor; children: ReactNode}) {
  return <ColorContext.Provider value={entity}>{children}</ColorContext.Provider>;
}
