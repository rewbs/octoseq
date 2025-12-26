"use client";

import { ThemeProvider as NextThemesProvider } from "next-themes";
import { HotkeysProvider } from "react-hotkeys-hook";
import { HOTKEY_SCOPE_APP, HOTKEY_SCOPE_EDITOR } from "@/lib/hotkeys";

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  return (
    <NextThemesProvider attribute="class" defaultTheme="system" enableSystem>
      <HotkeysProvider initiallyActiveScopes={[HOTKEY_SCOPE_APP, HOTKEY_SCOPE_EDITOR]}>
        {children}
      </HotkeysProvider>
    </NextThemesProvider>
  );
}
