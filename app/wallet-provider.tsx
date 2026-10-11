"use client";

import { getAddress } from "ethers";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

type RequestArguments = {
  method: string;
  params?: readonly unknown[] | object;
};
export type InjectedProvider = {
  request: (args: RequestArguments) => Promise<unknown>;
  on?: (event: string, listener: (...args: unknown[]) => void) => void;
  removeListener?: (
    event: string,
    listener: (...args: unknown[]) => void,
  ) => void;
  providers?: InjectedProvider[];
  isMetaMask?: boolean;
  isRabby?: boolean;
  isCoinbaseWallet?: boolean;
  isBraveWallet?: boolean;
  isTrust?: boolean;
  isTrustWallet?: boolean;
  isOkxWallet?: boolean;
  isOKExWallet?: boolean;
  isFrame?: boolean;
};

export type DiscoveredWallet = {
  id: string;
  name: string;
  icon: string;
  provider: InjectedProvider;
};

type WalletContextValue = {
  wallets: DiscoveredWallet[];
  walletName: string;
  account: string;
  chainId: number | null;
  provider: InjectedProvider | null;
  busy: boolean;
  status: string;
  connected: boolean;
  connect: (wallet: DiscoveredWallet) => Promise<void>;
  disconnect: () => void;
  switchToMainnet: () => Promise<void>;
};

const WalletContext = createContext<WalletContextValue | null>(null);
const MAINNET_ID = 1;

function legacyName(provider: InjectedProvider) {
  if (provider.isRabby) return "Rabby";
  if (provider.isCoinbaseWallet) return "Coinbase Wallet";
  if (provider.isBraveWallet) return "Brave Wallet";
  if (provider.isTrust || provider.isTrustWallet) return "Trust Wallet";
  if (provider.isOkxWallet || provider.isOKExWallet) return "OKX Wallet";
  if (provider.isFrame) return "Frame";
  if (provider.isMetaMask) return "MetaMask";
  return "Browser wallet";
}

function explainWalletError(error: unknown) {
  const walletError = error as { code?: number; message?: string };
  if (walletError?.code === 4001) return "Запрос отклонен в кошельке.";
  if (walletError?.code === -32002)
    return "В кошельке уже есть ожидающий запрос. Откройте его.";
  if (walletError?.code === 4902)
    return "Кошелек не знает сеть Ethereum Mainnet.";
  return (
    walletError?.message?.slice(0, 180) ||
    "Не удалось выполнить запрос кошелька."
  );
}

export function WalletProvider({ children }: { children: ReactNode }) {
  const [wallets, setWallets] = useState<DiscoveredWallet[]>([]);
  const [activeWallet, setActiveWallet] = useState<DiscoveredWallet | null>(
    null,
  );
  const [account, setAccount] = useState("");
  const [chainId, setChainId] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");

  const addWallet = useCallback((wallet: DiscoveredWallet) => {
    setWallets((current) => {
      if (current.some((item) => item.provider === wallet.provider))
        return current;
      const id = current.some((item) => item.id === wallet.id)
        ? `${wallet.id}-${current.length}`
        : wallet.id;
      return [...current, { ...wallet, id }];
    });
  }, []);

  useEffect(() => {
    const announce = (event: Event) => {
      const detail = (
        event as CustomEvent<{
          info?: { uuid?: string; name?: string; icon?: string; rdns?: string };
          provider?: InjectedProvider;
        }>
      ).detail;
      if (!detail?.provider || typeof detail.provider.request !== "function")
        return;
      const info = detail.info ?? {};
      const icon =
        typeof info.icon === "string" &&
        /^data:image\/(png|svg\+xml|webp|jpeg);/i.test(info.icon)
          ? info.icon
          : "";
      addWallet({
        id: info.rdns || info.uuid || `eip6963.${info.name || "wallet"}`,
        name: (info.name || "Injected wallet").slice(0, 40),
        icon,
        provider: detail.provider,
      });
    };

    const discoverLegacy = () => {
      const injected = window.ethereum;
      if (!injected) return;
      const providers = injected.providers?.length
        ? injected.providers
        : [injected];
      providers.forEach((provider) =>
        addWallet({
          id: `injected.${legacyName(provider).toLowerCase().replace(/\W+/g, "-")}`,
          name: legacyName(provider),
          icon: "",
          provider,
        }),
      );
    };

    window.addEventListener("eip6963:announceProvider", announce);
    window.dispatchEvent(new Event("eip6963:requestProvider"));
    const fallbackTimer = window.setTimeout(discoverLegacy, 500);
    return () => {
      window.removeEventListener("eip6963:announceProvider", announce);
      window.clearTimeout(fallbackTimer);
    };
  }, [addWallet]);

  useEffect(() => {
    if (!activeWallet?.provider.on) return;
    const provider = activeWallet.provider;
    const onAccountsChanged = (accounts: unknown) => {
      const first = Array.isArray(accounts) ? accounts[0] : "";
      try {
        setAccount(typeof first === "string" ? getAddress(first) : "");
        setStatus(
          typeof first === "string"
            ? "Аккаунт кошелька изменен."
            : "Кошелек отключен для этого сайта.",
        );
      } catch {
        setAccount("");
        setStatus("Кошелек вернул некорректный адрес.");
      }
    };
    const onChainChanged = (value: unknown) => {
      const parsed =
        typeof value === "string" ? Number.parseInt(value, 16) : Number(value);
      setChainId(Number.isSafeInteger(parsed) ? parsed : null);
      setStatus(
        parsed === MAINNET_ID
          ? "Кошелек подключен к Ethereum Mainnet."
          : `Выбрана сеть ${parsed}. Для действий Qairos нужна Ethereum Mainnet.`,
      );
    };
    const onDisconnect = () => {
      setAccount("");
      setChainId(null);
      setStatus("Кошелек отключен.");
    };

    provider.on?.("accountsChanged", onAccountsChanged);
    provider.on?.("chainChanged", onChainChanged);
    provider.on?.("disconnect", onDisconnect);
    return () => {
      provider.removeListener?.("accountsChanged", onAccountsChanged);
      provider.removeListener?.("chainChanged", onChainChanged);
      provider.removeListener?.("disconnect", onDisconnect);
    };
  }, [activeWallet]);

  useEffect(() => {
    let canceled = false;
    const restore = async () => {
      let savedId = "";
      try {
        savedId = window.localStorage.getItem("qairos.wallet.last") || "";
      } catch {
        return;
      }
      if (!savedId) return;
      const providerInfo = wallets.find((wallet) => wallet.id === savedId);
      if (!providerInfo) return;
      try {
        const accounts = await providerInfo.provider.request({
          method: "eth_accounts",
        });
        if (
          canceled ||
          !Array.isArray(accounts) ||
          typeof accounts[0] !== "string"
        )
          return;
        const chain = await providerInfo.provider.request({
          method: "eth_chainId",
        });
        if (canceled) return;
        setActiveWallet(providerInfo);
        setAccount(getAddress(accounts[0]));
        setChainId(
          typeof chain === "string" ? Number.parseInt(chain, 16) : null,
        );
      } catch {
        try {
          window.localStorage.removeItem("qairos.wallet.last");
        } catch {
          /* Storage can be unavailable. */
        }
      }
    };
    void restore();
    return () => {
      canceled = true;
    };
  }, [wallets]);

  const connect = useCallback(async (wallet: DiscoveredWallet) => {
    setBusy(true);
    setStatus(`Ожидаем подтверждение в ${wallet.name}…`);
    try {
      const accounts = await wallet.provider.request({
        method: "eth_requestAccounts",
      });
      if (!Array.isArray(accounts) || typeof accounts[0] !== "string")
        throw new Error("Кошелек не вернул аккаунт.");
      const network = await wallet.provider.request({ method: "eth_chainId" });
      setActiveWallet(wallet);
      setAccount(getAddress(accounts[0]));
      setChainId(
        typeof network === "string" ? Number.parseInt(network, 16) : null,
      );
      try {
        window.localStorage.setItem("qairos.wallet.last", wallet.id);
      } catch {
        /* Connection remains in memory. */
      }
      setStatus("Кошелек подключен. Проверьте сеть перед любыми действиями.");
    } catch (error) {
      setStatus(explainWalletError(error));
      throw error;
    } finally {
      setBusy(false);
    }
  }, []);

  const disconnect = useCallback(() => {
    setActiveWallet(null);
    setAccount("");
    setChainId(null);
    try {
      window.localStorage.removeItem("qairos.wallet.last");
    } catch {
      /* Storage can be unavailable. */
    }
    setStatus(
      "Кошелек забыт этим сайтом. Разрешение можно отозвать в настройках кошелька.",
    );
  }, []);

  const switchToMainnet = useCallback(async () => {
    if (!activeWallet) throw new Error("Сначала подключите кошелек.");
    setBusy(true);
    try {
      await activeWallet.provider.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: "0x1" }],
      });
      const chain = await activeWallet.provider.request({
        method: "eth_chainId",
      });
      const nextChainId =
        typeof chain === "string" ? Number.parseInt(chain, 16) : null;
      setChainId(nextChainId);
      setStatus(
        nextChainId === MAINNET_ID
          ? "Переключено на Ethereum Mainnet."
          : "Кошелек не переключил сеть.",
      );
    } catch (error) {
      setStatus(explainWalletError(error));
      throw error;
    } finally {
      setBusy(false);
    }
  }, [activeWallet]);

  const value = useMemo<WalletContextValue>(
    () => ({
      wallets,
      walletName: activeWallet?.name || "",
      account,
      chainId,
      provider: activeWallet?.provider || null,
      busy,
      status,
      connected: Boolean(activeWallet && account),
      connect,
      disconnect,
      switchToMainnet,
    }),
    [
      wallets,
      activeWallet,
      account,
      chainId,
      busy,
      status,
      connect,
      disconnect,
      switchToMainnet,
    ],
  );

  return (
    <WalletContext.Provider value={value}>{children}</WalletContext.Provider>
  );
}

export function useWallet() {
  const value = useContext(WalletContext);
  if (!value) throw new Error("useWallet must be used inside WalletProvider");
  return value;
}

declare global {
  interface Window {
    ethereum?: InjectedProvider;
  }
}
