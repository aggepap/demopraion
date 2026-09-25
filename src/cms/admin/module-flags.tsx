'use client';

import { createContext, useContext, type ReactNode } from 'react';

/**
 * Which modules are switched on, for any admin control that needs to know.
 *
 * Provided once by the admin shell, which already resolves the flags for the
 * sidebar. Before this the rich-text editor took them as a prop that nothing
 * passed — the field renderer is several levels of groups, repeaters and
 * language tabs deep — so every module-gated block in "+ Block" looked switched
 * off on every site. A context reaches the editor wherever it is rendered.
 *
 * The default is an empty map: outside the shell nothing is assumed on.
 */
const ModuleFlagsContext = createContext<Readonly<Record<string, boolean>>>({});

export function ModuleFlagsProvider({
  flags,
  children,
}: {
  flags: Readonly<Record<string, boolean>>;
  children: ReactNode;
}) {
  return <ModuleFlagsContext.Provider value={flags}>{children}</ModuleFlagsContext.Provider>;
}

export function useModuleFlags(): Readonly<Record<string, boolean>> {
  return useContext(ModuleFlagsContext);
}
