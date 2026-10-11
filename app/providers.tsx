"use client";

import type { ReactNode } from "react";
import { ThemeProvider } from "./theme-provider";
import { WalletProvider } from "./wallet-provider";

export default function Providers({ children }: { children: ReactNode }) {
  return (
    <ThemeProvider>
      <WalletProvider>{children}</WalletProvider>
    </ThemeProvider>
  );
}
