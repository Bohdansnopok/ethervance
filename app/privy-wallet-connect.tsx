"use client";

import { useConnectWallet } from "@privy-io/react-auth";
import { useWallet } from "./wallet-provider";

export default function PrivyWalletConnect({
  onStart,
  onConnected,
}: {
  onStart: () => void;
  onConnected: () => void;
}) {
  const appId = process.env.NEXT_PUBLIC_PRIVY_APP_ID;
  const wallet = useWallet();
  const { connectWallet } = useConnectWallet({
    onSuccess: async ({ wallet: connectedWallet }) => {
      if (connectedWallet.type !== "ethereum") return;
      try {
        const provider = await connectedWallet.getEthereumProvider();
        await wallet.connect({
          id: `privy.${connectedWallet.walletClientType}`,
          name: connectedWallet.meta.name || "Privy Wallet",
          icon:
            typeof connectedWallet.meta.icon === "string"
              ? connectedWallet.meta.icon
              : "",
          provider:
            provider as unknown as Parameters<typeof wallet.connect>[0]["provider"],
        });
        onConnected();
      } catch {
        // WalletProvider exposes connection errors in the shared wallet status.
      }
    },
  });

  if (!appId) return null;

  return (
    <button
      className="button button-primary full-width privy-connect"
      disabled={wallet.busy}
      onClick={() => {
        onStart();
        window.requestAnimationFrame(() => connectWallet());
      }}
    >
      <span className="privy-mark" aria-hidden="true">
        P
      </span>
      Подключить через Privy
    </button>
  );
}
