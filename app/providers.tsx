"use client";

import type { ReactNode } from "react";
import { PrivyProvider } from "@privy-io/react-auth";
import { ThemeProvider } from "./theme-provider";
import { WalletProvider } from "./wallet-provider";

export default function Providers({ children }: { children: ReactNode }) {
  const appId = process.env.NEXT_PUBLIC_PRIVY_APP_ID;
  const walletTree = <WalletProvider>{children}</WalletProvider>;

  return (
    <ThemeProvider>
      {appId ? (
        <PrivyProvider
          appId={appId}
          config={{
            appearance: {
              theme: "light",
              accentColor: "#d8ff5a",
              walletChainType: "ethereum-only",
            },
          }}
        >
          {walletTree}
        </PrivyProvider>
      ) : (
        walletTree
      )}
    </ThemeProvider>
  );
}
