"use client";

import { ml_dsa44 } from "@noble/post-quantum/ml-dsa.js";
import {
  BrowserProvider,
  Contract,
  concat,
  formatEther,
  getAddress,
  getBytes,
  hexlify,
  isAddress,
  keccak256,
  parseEther,
  solidityPackedKeccak256,
  toUtf8Bytes,
  type Eip1193Provider,
} from "ethers";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  QAIROS_ADDRESSES,
  QAIROS_INTERFACES,
  MAINNET_CHAIN_ID,
} from "./qairos";
import { useTheme } from "./theme-provider";
import { useWallet } from "./wallet-provider";
import PrivyWalletConnect from "./privy-wallet-connect";

type MainnetMarket = {
  id: number;
  bits: number;
  deadline: number;
  settled: boolean;
  yesWon: boolean;
  yesPoolWei: string;
  noPoolWei: string;
};
type MainnetRung = {
  id: number;
  bits: number;
  armed: boolean;
  broken: boolean;
  solver: string;
  brokenAt: number;
  bountyWei: string;
};
type MainnetSnapshot = {
  chainId: 1;
  blockNumber: number;
  observedAtUtc: string;
  threatLevel: number;
  firstBreakTime: number;
  rungCount: number;
  marketCount: number;
  vaultBreakerTripped: boolean;
  insuranceFreeCapitalWei: string;
  contracts: Array<{ name: string; address: string; deployed: boolean }>;
  rungs: MainnetRung[];
  markets: MainnetMarket[];
};
type LiveState =
  | { phase: "loading" }
  | { phase: "live"; snapshot: MainnetSnapshot }
  | { phase: "offline"; message: string };
type WalletSession = { address: string; csrfToken: string; expiresAt: string };
type RecoveryKit = {
  protocol: "Qairos";
  contract: "QairosArk";
  chainId: 1;
  scheme: "ML-DSA-44";
  account: string;
  commitment: string;
  salt: string;
  pqPublicKey: string;
  createdUtc?: string;
};
type PQKeys = {
  publicKey: Uint8Array;
  secretKey: Uint8Array;
  salt: string;
  entropy: string;
};
type Review = {
  title: string;
  functionName: string;
  to: string;
  data: string;
  value: bigint;
  from: string;
  gasLimit: bigint;
  gasPrice: bigint;
  afterConfirm?: (blockNumber: number) => void;
};

const toolList = [
  ["oracle", "Threat monitor", "Live Mainnet signal and Canary rungs"],
  ["ark", "Ethervance Ark", "ML-DSA-44, commitment, and recovery kit"],
  ["recover", "Recovery", "Kit validation and a two-step transaction"],
  ["signer", "Post-quantum signature", "Create and verify an ML-DSA-44 signature"],
  ["canary", "Canary ladder", "Public cryptographic challenge status"],
  ["markets", "Markets", "Mainnet positions with explicit confirmation"],
  ["guard", "Guard generator", "Protective contract source code"],
] as const;

const faq = [
  [
    "Can Ethervance stop a quantum computer?",
    "No. Ethervance tracks public signals and helps you prepare a response. It does not stop computation or guarantee that funds are safe.",
  ],
  [
    "Are the contracts live on Mainnet?",
    "The official status API publishes Ethereum Mainnet state and deployment addresses. The contracts are experimental and unaudited; do not deposit real funds without your own review.",
  ],
  [
    "Where are my keys sent?",
    "ML-DSA keys are generated locally in your browser. The private key is never sent to a server or included in the recovery kit.",
  ],
  [
    "Which wallets are supported?",
    "Connect an Ethereum wallet such as MetaMask through Privy's connection window. Your wallet will ask you to approve the connection.",
  ],
  [
    "Do I need to switch to Ethereum Mainnet?",
    "Yes. Contract writes are allowed only on chain ID 1. Before sending, the site checks the network, simulates the call, and displays transaction details for explicit confirmation in your wallet.",
  ],
];

function shortAddress(address: string) {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

function formatEtherSafe(value: string | bigint) {
  try {
    return Number(formatEther(BigInt(value))).toLocaleString("en-US", {
      maximumFractionDigits: 5,
    });
  } catch {
    return "0";
  }
}

function formatDate(value: number | string) {
  const date = new Date(
    typeof value === "number" && value < 10_000_000_000 ? value * 1000 : value,
  );
  return Number.isNaN(date.getTime())
    ? "—"
    : new Intl.DateTimeFormat("en-US", {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(date);
}

function validateSnapshot(value: unknown): MainnetSnapshot {
  if (!value || typeof value !== "object")
    throw new Error("The server returned invalid data.");
  const snapshot = value as Partial<MainnetSnapshot>;
  if (
    snapshot.chainId !== 1 ||
    !Number.isInteger(snapshot.threatLevel) ||
    snapshot.threatLevel! < 0 ||
    snapshot.threatLevel! > 5
  ) {
    throw new Error("The response failed network or threat-level validation.");
  }
  const observedAt = Date.parse(snapshot.observedAtUtc || "");
  if (
    !Number.isFinite(observedAt) ||
    observedAt > Date.now() + 60_000 ||
    Date.now() - observedAt > 90_000
  ) {
    throw new Error(
      "The Mainnet snapshot is stale. No safe level is assumed.",
    );
  }
  if (
    !Array.isArray(snapshot.contracts) ||
    !Array.isArray(snapshot.rungs) ||
    !Array.isArray(snapshot.markets)
  ) {
    throw new Error(
      "The response is missing contract, rung, or market data.",
    );
  }
  const officialAddresses: Record<string, string> = {
    QairosOracle: QAIROS_ADDRESSES.oracle,
    QairosCanary: QAIROS_ADDRESSES.canary,
    QairosArk: QAIROS_ADDRESSES.ark,
    QairosVault: QAIROS_ADDRESSES.vault,
    QairosMarket: QAIROS_ADDRESSES.market,
    QairosInsurance: QAIROS_ADDRESSES.insurance,
  };
  if (
    snapshot.contracts.length !== Object.keys(officialAddresses).length ||
    snapshot.contracts.some(
      (contract) =>
        !contract.deployed ||
        officialAddresses[contract.name]?.toLowerCase() !==
          contract.address.toLowerCase(),
    )
  ) {
    throw new Error(
      "Addresses or deployment status did not match the official registry.",
    );
  }
  return snapshot as MainnetSnapshot;
}

export default function QairosHome() {
  const { theme, toggleTheme } = useTheme();
  const wallet = useWallet();
  const [live, setLive] = useState<LiveState>({ phase: "loading" });
  const [statusRefreshing, setStatusRefreshing] = useState(false);
  const [statusRefreshVersion, setStatusRefreshVersion] = useState(0);
  const [walletOpen, setWalletOpen] = useState(false);
  const [notice, setNotice] = useState("");
  const [activeTool, setActiveTool] = useState<string>("oracle");
  const [walletSession, setWalletSession] = useState<WalletSession | null>(
    null,
  );
  const [authBusy, setAuthBusy] = useState(false);
  const [keys, setKeys] = useState<PQKeys | null>(null);
  const [keyAccount, setKeyAccount] = useState("");
  const [commitment, setCommitment] = useState("");
  const [keyBusy, setKeyBusy] = useState(false);
  const [message, setMessage] = useState(
    "I am checking this wallet's readiness for a post-quantum migration.",
  );
  const [signature, setSignature] = useState<Uint8Array | null>(null);
  const [signatureResult, setSignatureResult] = useState("");
  const [vaultBalance, setVaultBalance] = useState("—");
  const [depositAmount, setDepositAmount] = useState("0.01");
  const [withdrawAmount, setWithdrawAmount] = useState("0.01");
  const [marketStake, setMarketStake] = useState("0.001");
  const [insuranceCoverage, setInsuranceCoverage] = useState("0.01");
  const [insuranceYears, setInsuranceYears] = useState("1");
  const [insuranceQuote, setInsuranceQuote] = useState("");
  const [guardName, setGuardName] = useState("QuantumSafeVault");
  const [guardLevel, setGuardLevel] = useState(1);
  const [recoveryKit, setRecoveryKit] = useState<RecoveryKit | null>(null);
  const [recoveryDestination, setRecoveryDestination] = useState("");
  const [recoveryCommitBlock, setRecoveryCommitBlock] = useState<number | null>(
    null,
  );
  const [currentBlock, setCurrentBlock] = useState<number | null>(null);
  const [review, setReview] = useState<Review | null>(null);
  const [reviewChecked, setReviewChecked] = useState(false);
  const [sending, setSending] = useState(false);
  const walletDialog = useRef<HTMLDialogElement>(null);
  const reviewDialog = useRef<HTMLDialogElement>(null);

  const sessionReady = Boolean(
    walletSession &&
    wallet.account &&
    wallet.chainId === MAINNET_CHAIN_ID &&
    walletSession.address.toLowerCase() === wallet.account.toLowerCase() &&
    Date.parse(walletSession.expiresAt) > Date.now(),
  );
  const statusData = live.phase === "live" ? live.snapshot : null;
  const threatClass =
    !statusData || statusData.threatLevel === 0
      ? "nominal"
      : statusData.threatLevel < 3
        ? "watch"
        : "critical";

  useEffect(() => {
    let active = true;
    let inFlight = false;
    let controller: AbortController | null = null;
    const statusUrl =
      process.env.NEXT_PUBLIC_QAIROS_STATUS_URL ||
      (window.location.hostname === "qairos.tech"
        ? "/api/mainnet/status"
        : "https://qairos.tech/api/mainnet/status");

    const refresh = async () => {
      if (inFlight) return;
      inFlight = true;
      if (active) setStatusRefreshing(true);
      controller = new AbortController();
      const timeout = window.setTimeout(() => controller?.abort(), 12_000);
      try {
        const response = await fetch(statusUrl, {
          cache: "no-store",
          headers: { Accept: "application/json" },
          signal: controller.signal,
        });
        if (!response.ok)
          throw new Error(`Mainnet service returned HTTP ${response.status}.`);
        const snapshot = validateSnapshot(await response.json());
        if (active) setLive({ phase: "live", snapshot });
      } catch (error) {
        if (active)
          setLive({
            phase: "offline",
            message:
              error instanceof Error
                ? error.message
                : "Mainnet monitoring is unavailable.",
          });
      } finally {
        window.clearTimeout(timeout);
        inFlight = false;
        if (active) setStatusRefreshing(false);
      }
    };
    const onVisibility = () => {
      if (!document.hidden) void refresh();
    };
    void refresh();
    const interval = window.setInterval(() => {
      if (!document.hidden) void refresh();
    }, 30_000);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      active = false;
      controller?.abort();
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [statusRefreshVersion]);

  useEffect(() => {
    const dialog = walletDialog.current;
    if (!dialog) return;
    if (walletOpen && !dialog.open) dialog.showModal();
    if (!walletOpen && dialog.open) dialog.close();
  }, [walletOpen]);

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/wallet/session", {
      credentials: "same-origin",
      cache: "no-store",
      headers: { Accept: "application/json" },
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) return;
        const session = await response.json();
        if (
          typeof session.address === "string" &&
          typeof session.csrfToken === "string" &&
          typeof session.expiresAt === "string" &&
          Date.parse(session.expiresAt) > Date.now()
        ) {
          setWalletSession({
            address: getAddress(session.address),
            csrfToken: session.csrfToken,
            expiresAt: session.expiresAt,
          });
        }
      })
      .catch(() => {
        // Session restoration is optional while the same-origin API is offline.
      });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    const dialog = reviewDialog.current;
    if (!dialog) return;
    if (review && !dialog.open) dialog.showModal();
    if (!review && dialog.open) dialog.close();
  }, [review]);

  useEffect(() => {
    if (!wallet.provider || !wallet.account || !recoveryCommitBlock) return;
    let cancelled = false;
    const readBlock = async () => {
      try {
        const blockHex = await wallet.provider!.request({
          method: "eth_blockNumber",
        });
        if (!cancelled && typeof blockHex === "string")
          setCurrentBlock(Number.parseInt(blockHex, 16));
      } catch {
        /* The next interval may succeed. */
      }
    };
    void readBlock();
    const timer = window.setInterval(() => {
      void readBlock();
    }, 4_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [wallet.provider, wallet.account, recoveryCommitBlock]);

  useEffect(() => {
    if (!wallet.account || wallet.chainId !== MAINNET_CHAIN_ID) {
      setVaultBalance("—");
      return;
    }
    let cancelled = false;
    const readBalance = async () => {
      try {
        const provider = new BrowserProvider(
          wallet.provider as unknown as Eip1193Provider,
          "any",
        );
        const vault = new Contract(
          QAIROS_ADDRESSES.vault,
          QAIROS_INTERFACES.vault,
          provider,
        );
        const [balance, blockNumber] = await Promise.all([
          vault.balanceOf(wallet.account),
          provider.getBlockNumber(),
        ]);
        if (!cancelled) {
          setVaultBalance(formatEtherSafe(balance));
          setCurrentBlock(blockNumber);
        }
      } catch {
        if (!cancelled) setVaultBalance("Unavailable");
      }
    };
    void readBalance();
    return () => {
      cancelled = true;
    };
  }, [wallet.account, wallet.chainId, wallet.provider, live]);

  useEffect(() => {
    if (
      !walletSession ||
      !wallet.account ||
      walletSession.address.toLowerCase() === wallet.account.toLowerCase()
    )
      return;
    setNotice(
      "The wallet account changed. Sign in again before continuing.",
    );
    setWalletSession(null);
  }, [wallet.account, walletSession]);

  const markets = useMemo(() => statusData?.markets || [], [statusData]);
  const armedRungs = useMemo(
    () => statusData?.rungs.filter((rung) => rung.armed) || [],
    [statusData],
  );

  const signIn = async () => {
    if (!wallet.provider || !wallet.account) {
      setNotice("Connect a wallet first.");
      return;
    }
    if (wallet.chainId !== MAINNET_CHAIN_ID) {
      setNotice("Switch your wallet to Ethereum Mainnet to sign in.");
      return;
    }
    setAuthBusy(true);
    try {
      const nonceResponse = await fetch("/api/wallet/nonce", {
        method: "POST",
        credentials: "same-origin",
        cache: "no-store",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ address: wallet.account }),
        signal: AbortSignal.timeout(12_000),
      });
      const challenge = await nonceResponse.json().catch(() => ({}));
      if (!nonceResponse.ok || typeof challenge.message !== "string") {
        throw new Error(
          challenge.error ||
            "Wallet service unavailable. Check the same-origin API connection.",
        );
      }
      const accountBeforeSign = wallet.account;
      const signer = await new BrowserProvider(
        wallet.provider as unknown as Eip1193Provider,
        "any",
      ).getSigner(accountBeforeSign);
      const signedMessage = await signer.signMessage(challenge.message);
      const liveAccounts = await wallet.provider.request({
        method: "eth_accounts",
      });
      const liveChain = await wallet.provider.request({
        method: "eth_chainId",
      });
      if (
        !Array.isArray(liveAccounts) ||
        typeof liveAccounts[0] !== "string" ||
        getAddress(liveAccounts[0]) !== accountBeforeSign ||
        liveChain !== "0x1"
      ) {
        throw new Error(
          "The account or network changed while signing. Sign in again.",
        );
      }
      const verifyResponse = await fetch("/api/wallet/verify", {
        method: "POST",
        credentials: "same-origin",
        cache: "no-store",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ signature: signedMessage }),
        signal: AbortSignal.timeout(12_000),
      });
      const session = await verifyResponse.json().catch(() => ({}));
      if (
        !verifyResponse.ok ||
        typeof session.address !== "string" ||
        typeof session.csrfToken !== "string" ||
        getAddress(session.address) !== accountBeforeSign
      ) {
        throw new Error(
          session.error || "The server did not verify this account's signature.",
        );
      }
      setWalletSession({
        address: getAddress(session.address),
        csrfToken: session.csrfToken,
        expiresAt: session.expiresAt,
      });
      setNotice(
        "Sign-in was verified with a gas-free signature. No funds or permissions were requested.",
      );
    } catch (error) {
      setNotice(
        error instanceof Error
          ? error.message
          : "Could not sign in with the wallet.",
      );
    } finally {
      setAuthBusy(false);
    }
  };

  const signOut = async () => {
    if (!walletSession) {
      return true;
    }
    try {
      const response = await fetch("/api/wallet/session", {
        method: "DELETE",
        credentials: "same-origin",
        cache: "no-store",
        headers: {
          Accept: "application/json",
          "X-CSRF-Token": walletSession.csrfToken,
        },
        signal: AbortSignal.timeout(12_000),
      });
      if (!response.ok)
        throw new Error("The server could not revoke the session. Try signing out again later.");
      setWalletSession(null);
      setNotice("Wallet session ended.");
      return true;
    } catch (error) {
      setNotice(
        error instanceof Error ? error.message : "Could not complete the session.",
      );
      return false;
    }
  };

  const copyContractAddress = async () => {
    try {
      await navigator.clipboard.writeText(QAIROS_ADDRESSES.oracle);
      setNotice("Oracle contract address copied.");
    } catch {
      setNotice("Clipboard unavailable in this browser.");
    }
  };

  const prepareTransaction = async ({
    title,
    functionName,
    contract,
    data,
    value = 0n,
    afterConfirm,
  }: {
    title: string;
    functionName: string;
    contract: keyof typeof QAIROS_ADDRESSES;
    data: string;
    value?: bigint;
    afterConfirm?: (blockNumber: number) => void;
  }) => {
    if (!wallet.provider || !wallet.account) {
      setNotice("Connect a wallet to prepare the transaction.");
      setWalletOpen(true);
      return;
    }
    if (wallet.chainId !== MAINNET_CHAIN_ID) {
      setNotice("Transactions are allowed only on Ethereum Mainnet.");
      return;
    }
    if (!sessionReady || !walletSession) {
      setNotice(
        "Sign in first by signing a one-time Ethervance message (no gas).",
      );
      setWalletOpen(true);
      return;
    }
    setSending(true);
    try {
      const currentAccounts = await wallet.provider.request({
        method: "eth_accounts",
      });
      const currentChain = await wallet.provider.request({
        method: "eth_chainId",
      });
      if (
        !Array.isArray(currentAccounts) ||
        currentAccounts[0] !== wallet.account ||
        currentChain !== "0x1"
      )
        throw new Error("The wallet or network changed. Nothing was sent.");
      const browserProvider = new BrowserProvider(
        wallet.provider as unknown as Eip1193Provider,
        "any",
      );
      const signer = await browserProvider.getSigner(wallet.account);
      const to = QAIROS_ADDRESSES[contract];
      await signer.call({ to, data, value });
      const [gasLimit, fees] = await Promise.all([
        signer.estimateGas({ to, data, value }),
        browserProvider.getFeeData(),
      ]);
      const gasPrice = fees.maxFeePerGas ?? fees.gasPrice ?? 0n;
      const freshAccounts = await wallet.provider.request({
        method: "eth_accounts",
      });
      const freshChain = await wallet.provider.request({
        method: "eth_chainId",
      });
      if (
        !Array.isArray(freshAccounts) ||
        freshAccounts[0] !== wallet.account ||
        freshChain !== "0x1" ||
        walletSession.address.toLowerCase() !== wallet.account.toLowerCase()
      )
        throw new Error(
          "The session, account, or network changed during verification. Nothing was sent.",
        );
      setReview({
        title,
        functionName,
        to,
        data,
        value,
        from: wallet.account,
        gasLimit,
        gasPrice,
        afterConfirm,
      });
      setReviewChecked(false);
    } catch (error) {
      setNotice(
        error instanceof Error
          ? error.message
          : "Transaction simulation failed. Nothing was sent.",
      );
    } finally {
      setSending(false);
    }
  };

  const confirmTransaction = async () => {
    if (
      !review ||
      !reviewChecked ||
      !wallet.provider ||
      !wallet.account ||
      !walletSession
    )
      return;
    setSending(true);
    try {
      if (
        !sessionReady ||
        wallet.account.toLowerCase() !== review.from.toLowerCase()
      )
        throw new Error("The session no longer matches the wallet.");
      const accounts = await wallet.provider.request({
        method: "eth_accounts",
      });
      const chain = await wallet.provider.request({ method: "eth_chainId" });
      if (
        !Array.isArray(accounts) ||
        accounts[0] !== review.from ||
        chain !== "0x1"
      )
        throw new Error("The wallet or network changed. Nothing was sent.");
      const browserProvider = new BrowserProvider(
        wallet.provider as unknown as Eip1193Provider,
        "any",
      );
      const signer = await browserProvider.getSigner(review.from);
      await signer.call({
        to: review.to,
        data: review.data,
        value: review.value,
      });
      const freshGas = await signer.estimateGas({
        to: review.to,
        data: review.data,
        value: review.value,
      });
      const liveAccounts = await wallet.provider.request({
        method: "eth_accounts",
      });
      const liveChain = await wallet.provider.request({
        method: "eth_chainId",
      });
      if (
        !Array.isArray(liveAccounts) ||
        liveAccounts[0] !== review.from ||
        liveChain !== "0x1"
      )
        throw new Error("The wallet re-check failed.");
      setNotice("Waiting for transaction confirmation in your wallet…");
      const transaction = await signer.sendTransaction({
        to: review.to,
        data: review.data,
        value: review.value,
        gasLimit: (freshGas * 120n) / 100n + 1_000n,
      });
      setNotice(
        `Transaction sent: ${transaction.hash.slice(0, 12)}… Waiting for block confirmation.`,
      );
      const receipt = await transaction.wait(1, 240_000);
      if (!receipt || receipt.status !== 1)
        throw new Error(
          `Transaction was cancelled or failed: ${transaction.hash}`,
        );
      review.afterConfirm?.(receipt.blockNumber);
      setNotice(
        `Confirmed in block ${receipt.blockNumber}. Hash: ${transaction.hash}`,
      );
      setReview(null);
      setReviewChecked(false);
      setStatusRefreshVersion((current) => current + 1);
    } catch (error) {
      setNotice(
        error instanceof Error ? error.message : "Transaction was not confirmed.",
      );
    } finally {
      setSending(false);
    }
  };

  const generateKey = async () => {
    setKeyBusy(true);
    try {
      if (!window.isSecureContext)
        throw new Error(
          "Key generation requires HTTPS or localhost.",
        );
      const browserEntropy = window.crypto.getRandomValues(new Uint8Array(64));
      let seed: Uint8Array<ArrayBufferLike> = browserEntropy.slice(0, 32);
      let salt: Uint8Array<ArrayBufferLike> = browserEntropy.slice(32);
      let entropyLabel = "Browser CSPRNG";
      const qrngOrigin =
        window.location.hostname === "qairos.tech"
          ? window.location.origin
          : "https://qairos.tech";
      try {
        const response = await fetch(`${qrngOrigin}/api/qrng?length=64`, {
          headers: { Accept: "application/json" },
          cache: "no-store",
          signal: AbortSignal.timeout(8_000),
        });
        if (!response.ok) throw new Error("QRNG unavailable");
        const result = await response.json();
        if (
          !Array.isArray(result.data) ||
          result.data.length < 64 ||
          result.data.some(
            (byte: unknown) =>
              !Number.isInteger(byte) || Number(byte) < 0 || Number(byte) > 255,
          )
        )
          throw new Error("Invalid QRNG response");
        const quantumEntropy = Uint8Array.from(
          result.data.slice(0, 64) as number[],
        );
        seed = getBytes(
          keccak256(
            concat([
              toUtf8Bytes("qairos.seed"),
              quantumEntropy.slice(0, 32),
              browserEntropy.slice(0, 32),
            ]),
          ),
        );
        salt = getBytes(
          keccak256(
            concat([
              toUtf8Bytes("qairos.salt"),
              quantumEntropy.slice(32),
              browserEntropy.slice(32),
            ]),
          ),
        );
        entropyLabel = "QRNG + browser CSPRNG";
      } catch {
        entropyLabel = "Browser CSPRNG; QRNG unavailable";
      }
      const generated = ml_dsa44.keygen(seed);
      setKeys({ ...generated, salt: hexlify(salt), entropy: entropyLabel });
      setCommitment("");
      setSignature(null);
      setSignatureResult("");
      setNotice(
        `ML-DSA-44 key generated locally. Entropy source: ${entropyLabel}. The secret key will stay in this tab's memory.`,
      );
    } catch (error) {
      setNotice(
        error instanceof Error ? error.message : "Could not create key.",
      );
    } finally {
      setKeyBusy(false);
    }
  };

  const bindArkCommitment = () => {
    if (!keys) {
      setNotice("Generate an ML-DSA-44 key first.");
      return;
    }
    if (!wallet.account) {
      setWalletOpen(true);
      setNotice("Connect the wallet that will own the commitment.");
      return;
    }
    const nextCommitment = solidityPackedKeccak256(
      ["bytes", "bytes32", "address"],
      [keys.publicKey, keys.salt, wallet.account],
    );
    setKeyAccount(wallet.account);
    setCommitment(nextCommitment);
    setNotice(
      "The commitment was calculated locally and is bound to the current wallet address.",
    );
  };

  const saveRecoveryKit = () => {
    if (!keys || !commitment || !keyAccount) {
      setNotice("Create a key and commitment first.");
      return;
    }
    const kit: RecoveryKit & {
      entropy: string;
      warning: string;
      createdUtc: string;
    } = {
      protocol: "Qairos",
      contract: "QairosArk",
      chainId: 1,
      scheme: "ML-DSA-44",
      account: keyAccount,
      commitment,
      salt: keys.salt,
      pqPublicKey: hexlify(keys.publicKey),
      entropy: keys.entropy,
      createdUtc: new Date().toISOString(),
      warning:
        "The recovery kit lets you present proof of ownership. Store it offline and never share it.",
    };
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(kit, null, 2)], { type: "application/json" }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = `qairos-recovery-${keyAccount.slice(2, 8).toLowerCase()}.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
  };

  const loadRecoveryKit = async (file?: File) => {
    if (!file) return;
    if (file.size > 64_000) {
      setNotice("The recovery kit file is too large.");
      return;
    }
    try {
      const raw = JSON.parse(await file.text()) as Partial<RecoveryKit>;
      if (
        raw.protocol !== "Qairos" ||
        raw.contract !== "QairosArk" ||
        raw.chainId !== 1 ||
        raw.scheme !== "ML-DSA-44" ||
        !raw.account ||
        !isAddress(raw.account) ||
        !raw.commitment ||
        !/^0x[0-9a-f]{64}$/i.test(raw.commitment) ||
        !raw.salt ||
        !/^0x[0-9a-f]{64}$/i.test(raw.salt) ||
        !raw.pqPublicKey ||
        !/^0x(?:[0-9a-f]{2})+$/i.test(raw.pqPublicKey)
      )
        throw new Error("The file does not match the Qairos recovery kit format.");
      const expected = solidityPackedKeccak256(
        ["bytes", "bytes32", "address"],
        [raw.pqPublicKey, raw.salt, raw.account],
      );
      if (expected.toLowerCase() !== raw.commitment.toLowerCase())
        throw new Error(
          "The key, salt, and account do not match the commitment in the file.",
        );
      setRecoveryKit(raw as RecoveryKit);
      setNotice(
        "Recovery kit verified locally. No secrets were sent over the network.",
      );
    } catch (error) {
      setRecoveryKit(null);
      setNotice(
        error instanceof Error
          ? error.message
          : "Could not read recovery kit.",
      );
    }
  };

  const downloadGuard = () => {
    const safeName =
      guardName.replace(/[^a-zA-Z0-9_]/g, "") || "QuantumSafeVault";
    const source = `// SPDX-License-Identifier: MIT\npragma solidity ^0.8.24;\n\nimport {QairosGuard} from "./QairosGuard.sol";\n\ncontract ${safeName} is QairosGuard {\n    constructor(IQairosOracle oracle_) QairosGuard(oracle_, ${guardLevel}) {}\n\n    function withdraw(uint256 amount) external quantumSafe {\n        // Add reviewed vault logic here.\n    }\n}\n`;
    const url = URL.createObjectURL(new Blob([source], { type: "text/plain" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `${safeName}.sol`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
  };

  const prepareArkCommit = () => {
    if (!keys || !commitment || !keyAccount) {
      setNotice("Create a key and commitment first.");
      return;
    }
    if (wallet.account?.toLowerCase() !== keyAccount.toLowerCase()) {
      setNotice("A different account is connected. Switch accounts first.");
      return;
    }
    void prepareTransaction({
        title: "Register Ethervance Ark commitment",
      functionName: "QairosArk.commit(bytes32)",
      contract: "ark",
      data: QAIROS_INTERFACES.ark.encodeFunctionData("commit", [commitment]),
    });
  };

  const prepareVaultDeposit = () => {
    try {
      const amount = parseEther(depositAmount);
      if (amount <= 0n) throw new Error("Amount must be greater than zero.");
      void prepareTransaction({
        title: "Deposit ETH into Ethervance Vault",
        functionName: "QairosVault.deposit()",
        contract: "vault",
        data: QAIROS_INTERFACES.vault.encodeFunctionData("deposit"),
        value: amount,
      });
    } catch (error) {
      setNotice(
        error instanceof Error
          ? error.message
          : "Enter a valid ETH amount.",
      );
    }
  };

  const prepareVaultWithdraw = () => {
    try {
      const amount = parseEther(withdrawAmount);
      if (amount <= 0n) throw new Error("Amount must be greater than zero.");
      void prepareTransaction({
        title: "Withdraw ETH from Ethervance Vault",
        functionName: "QairosVault.withdraw(uint256)",
        contract: "vault",
        data: QAIROS_INTERFACES.vault.encodeFunctionData("withdraw", [amount]),
      });
    } catch (error) {
      setNotice(
        error instanceof Error
          ? error.message
          : "Enter a valid ETH amount.",
      );
    }
  };

  const prepareMarketBuy = (marketId: number, yes: boolean) => {
    if (live.phase !== "live") {
      setNotice("No fresh Mainnet snapshot. The transaction was not prepared.");
      return;
    }
    const market = live.snapshot.markets.find((item) => item.id === marketId);
    if (!market || market.settled || market.deadline * 1000 <= Date.now()) {
      setNotice("This market is closed or its data is stale.");
      return;
    }
    try {
      const amount = parseEther(marketStake);
      if (amount <= 0n) throw new Error("Position size must be greater than zero.");
      void prepareTransaction({
        title: `${yes ? "YES" : "NO"} position · market ${marketId}`,
        functionName: "QairosMarket.buy(uint256,bool)",
        contract: "market",
        data: QAIROS_INTERFACES.market.encodeFunctionData("buy", [
          marketId,
          yes,
        ]),
        value: amount,
      });
    } catch (error) {
      setNotice(
        error instanceof Error
          ? error.message
          : "Enter a valid ETH amount.",
      );
    }
  };

  const prepareInsurance = async () => {
    if (!wallet.provider || wallet.chainId !== MAINNET_CHAIN_ID) {
      setNotice("Connect your wallet to Ethereum Mainnet.");
      return;
    }
    try {
      const coverage = parseEther(insuranceCoverage);
      const years = Number(insuranceYears);
      if (coverage <= 0n || !Number.isInteger(years) || years < 1 || years > 5)
        throw new Error("Enter coverage greater than zero and a term from 1 to 5 years.");
      const browserProvider = new BrowserProvider(
        wallet.provider as unknown as Eip1193Provider,
        "any",
      );
      const insurance = new Contract(
        QAIROS_ADDRESSES.insurance,
        QAIROS_INTERFACES.insurance,
        browserProvider,
      );
      const premium = (await insurance.quote(coverage, years)) as bigint;
      setInsuranceQuote(formatEtherSafe(premium));
      void prepareTransaction({
        title: "Purchase Ethervance Insurance policy",
        functionName: "QairosInsurance.buyPolicy(uint256,uint256)",
        contract: "insurance",
        data: QAIROS_INTERFACES.insurance.encodeFunctionData("buyPolicy", [
          coverage,
          years,
        ]),
        value: premium,
      });
    } catch (error) {
      setNotice(
        error instanceof Error
          ? error.message
          : "Could not calculate premium.",
      );
    }
  };

  const prepareRecoveryCommit = async () => {
    if (!recoveryKit || !isAddress(recoveryDestination)) {
      setNotice(
        "Upload a valid recovery kit and enter the destination address.",
      );
      return;
    }
    if (wallet.account?.toLowerCase() !== recoveryKit.account.toLowerCase()) {
      setNotice("Connect the account listed in the recovery kit.");
      return;
    }
    try {
      const provider = new BrowserProvider(
        wallet.provider as unknown as Eip1193Provider,
        "any",
      );
      const vault = new Contract(
        QAIROS_ADDRESSES.vault,
        QAIROS_INTERFACES.vault,
        provider,
      );
      const recoveryCommitment = (await vault.recoveryCommitment(
        recoveryKit.account,
        recoveryDestination,
        recoveryKit.pqPublicKey,
        recoveryKit.salt,
      )) as string;
      void prepareTransaction({
        title: "Step 1 of 2 · commit recovery",
        functionName: "QairosVault.commitRecovery(bytes32)",
        contract: "vault",
        data: QAIROS_INTERFACES.vault.encodeFunctionData("commitRecovery", [
          recoveryCommitment,
        ]),
        afterConfirm: (blockNumber) => {
          setRecoveryCommitBlock(blockNumber);
          setCurrentBlock(blockNumber);
        },
      });
    } catch (error) {
      setNotice(
        error instanceof Error
          ? error.message
          : "Could not prepare recovery.",
      );
    }
  };

  const prepareRecovery = () => {
    if (
      !recoveryKit ||
      !isAddress(recoveryDestination) ||
      !recoveryCommitBlock ||
      !currentBlock ||
      currentBlock <= recoveryCommitBlock
    ) {
      setNotice(
        "For step two, wait until a block after the commitment has been confirmed.",
      );
      return;
    }
    void prepareTransaction({
      title: "Step 2 of 2 · recover funds",
      functionName: "QairosVault.recover(address,address,bytes,bytes32)",
      contract: "vault",
      data: QAIROS_INTERFACES.vault.encodeFunctionData("recover", [
        recoveryKit.account,
        recoveryDestination,
        recoveryKit.pqPublicKey,
        recoveryKit.salt,
      ]),
    });
  };

  const renderTool = () => {
    if (activeTool === "ark")
      return (
        <div className="tool-body">
          <div className="tool-heading">
            <p className="eyebrow">PROTECTION · ETHERVANCE ARK</p>
            <h3>Prepare proof of ownership</h3>
            <p>
              ML-DSA-44 is generated locally. The private key stays in this tab's memory and is never sent over the network.
            </p>
          </div>
          <div className="tool-actions">
            <button
              className="button button-primary"
              disabled={keyBusy}
              onClick={() => void generateKey()}
            >
              {keyBusy
                ? "Generating key…"
                : keys
                  ? "Generate a new key"
                  : "Generate ML-DSA-44 key"}
            </button>
            <button
              className="button"
              disabled={!keys}
              onClick={bindArkCommitment}
            >
              Calculate commitment</button>
            <button
              className="button"
              disabled={!commitment}
              onClick={saveRecoveryKit}
            >
              Download recovery kit</button>
          </div>
          {keys && (
            <div className="data-grid">
              <div>
                <span>Parameter</span>
                <b>ML-DSA-44 · FIPS 204</b>
              </div>
              <div>
                <span>Public key</span>
                <b>{keys.publicKey.length.toLocaleString("en-US")} bytes</b>
              </div>
              <div>
                <span>Secret key</span>
                <b>In memory only</b>
              </div>
              <div>
                <span>Entropy</span>
                <b>{keys.entropy}</b>
              </div>
              <div className="wide">
                <span>Commitment</span>
                <code>
                  {commitment || "Calculate this for the active address first"}
                </code>
              </div>
              <div className="wide">
                <span>Account</span>
                <code>
                  {keyAccount || wallet.account || "Connect a wallet"}
                </code>
              </div>
            </div>
          )}
          {commitment && (
            <div className="warning-line">
              The recovery kit lets you present a pre-Moment commitment. Keep the file offline and never share it with anyone else.
            </div>
          )}
          <button
            className="button button-primary"
            disabled={
              !commitment ||
              keyAccount.toLowerCase() !== wallet.account.toLowerCase() ||
              sending
            }
            onClick={prepareArkCommit}
          >
            Verify and prepare registration</button>
        </div>
      );

    if (activeTool === "recover")
      return (
        <div className="tool-body">
          <div className="tool-heading">
            <p className="eyebrow">PROTECTION · RECOVERY</p>
            <h3>Two-step recovery</h3>
            <p>
              Choose a local recovery kit. The file is validated in your browser and is not uploaded to a server.
            </p>
          </div>
          <label className="field-label" htmlFor="kit-file">
            Recovery kit file (.json)</label>
          <inpu
            id="kit-file"
            className="file-input"
            type="file"
            accept="application/json,.json"
            onChange={(event) => void loadRecoveryKit(event.target.files?.[0])}
          />
          {recoveryKit && (
            <div className="data-grid">
              <div>
                <span>Account</span>
                <b>{shortAddress(recoveryKit.account)}</b>
              </div>
              <div>
                <span>Scheme</span>
                <b>{recoveryKit.scheme}</b>
              </div>
              <div className="wide">
                <span>Commitment</span>
                <code>{recoveryKit.commitment}</code>
              </div>
            </div>
          )}
          <label className="field-label" htmlFor="recovery-destination">
            New destination address</label>
          <inpu
            id="recovery-destination"
            className="text-input"
            autoComplete="off"
            spellCheck={false}
            placeholder="0x…"
            value={recoveryDestination}
            onChange={(event) =>
              setRecoveryDestination(event.target.value.trim())
            }
          />
          <div className="tool-actions">
            <button
              className="button button-primary"
              disabled={!recoveryKit || sending}
              onClick={() => void prepareRecoveryCommit()}
            >
              Verify and prepare step 1</button>
            <button
              className="button"
              disabled={
                !recoveryKit ||
                sending ||
                !recoveryCommitBlock ||
                !currentBlock ||
                currentBlock <= recoveryCommitBlock
              }
              onClick={prepareRecovery}
            >
              Prepare step 2</button>
          </div>
          {recoveryCommitBlock && (
            <p className="mono small-note">
              Commitment: block{recoveryCommitBlock} · current block{" "}
              {currentBlock ?? "—"}. Step 2 is available after the next block and only if contract conditions are met.
            </p>
          )}
        </div>
      );

    if (activeTool === "signer")
      return (
        <div className="tool-body">
          <div className="tool-heading">
            <p className="eyebrow">PROTECTION · PQ SIGNER</p>
            <h3>Sign a message with a post-quantum key</h3>
            <p>
              This uses the same key as Ark. The signature is computed locally and is not an Ethereum wallet signature.
            </p>
          </div>
          <label className="field-label" htmlFor="pq-message">
            Message</label>
          <textarea
            id="pq-message"
            className="text-input message-input"
            value={message}
            onChange={(event) => {
              setMessage(event.target.value);
              setSignature(null);
              setSignatureResult("");
            }}
          />
          <div className="tool-actions">
            <button
              className="button button-primary"
              disabled={!keys || keyBusy}
              onClick={() => {
                if (!keys) return;
                const nextSignature = ml_dsa44.sign(
                  new TextEncoder().encode(message),
                  keys.secretKey,
                );
                setSignature(nextSignature);
                setSignatureResult("Signature created in this tab.");
              }}
            >
              Create signature</button>
            <button
              className="button"
              disabled={!keys || !signature}
              onClick={() => {
                const valid = Boolean(
                  keys &&
                  signature &&
                  ml_dsa44.verify(
                    signature,
                    new TextEncoder().encode(message),
                    keys.publicKey,
                  ),
                );
                setSignatureResult(
                  valid
                    ? "The signature is valid for this message."
                    : "The signature does not match the message or key.",
                );
              }}
            >
              Verify signature</button>
          </div>
          {signature && (
            <div className="data-grid">
              <div>
                <span>Signature size</span>
                <b>{signature.length.toLocaleString("en-US")} bytes</b>
              </div>
              <div>
                <span>Verification result</span>
                <b>{signatureResult || "Awaiting verification"}</b>
              </div>
              <div className="wide">
                <span>Signature · hex</span>
                <code className="signature-preview">{hexlify(signature)}</code>
              </div>
            </div>
          )}
        </div>
      );

    if (activeTool === "vault")
      return (
        <div className="tool-body">
          <div className="tool-heading">
            <p className="eyebrow">PROTECTION · ETHERVANCE VAULT</p>
            <h3>Vault balance and operations</h3>
            <p>
              The balance is read through the connected Mainnet provider. Writes are simulated and gas-estimated before a separate wallet confirmation.
            </p>
          </div>
          <div className="vault-balance">
            <span>Your Vault balance</span>
            <b>{vaultBalance} ETH</b>
          </div>
          <div className="form-grid">
            <label>
              <span>Deposit ETH</span>
              <inpu
                className="text-input"
                inputMode="decimal"
                value={depositAmount}
                onChange={(event) => setDepositAmount(event.target.value)}
              />
            </label>
            <button
              className="button button-primary"
              disabled={sending}
              onClick={prepareVaultDeposit}
            >
              Prepare deposit</button>
            <label>
              <span>Withdraw ETH</span>
              <inpu
                className="text-input"
                inputMode="decimal"
                value={withdrawAmount}
                onChange={(event) => setWithdrawAmount(event.target.value)}
              />
            </label>
            <button
              className="button"
              disabled={sending}
              onClick={prepareVaultWithdraw}
            >
              Prepare withdrawal</button>
          </div>
          {statusData?.vaultBreakerTripped && (
            <div className="warning-line">
              The breaker is active. The contract may reject withdrawals; simulation checks this before sending.
            </div>
          )}
        </div>
      );

    if (activeTool === "markets")
      return (
        <div className="tool-body">
          <div className="tool-heading">
            <p className="eyebrow">MARKETS · ETHEREUM MAINNET</p>
            <h3>Public forecasts</h3>
            <p>
              Pools are read from the verified live status API. These are real Mainnet positions, not a paper-trading simulation.
            </p>
          </div>
          <label className="field-label" htmlFor="market-stake">
            Position size in ETH</label>
          <inpu
            id="market-stake"
            className="text-input amount-input"
            inputMode="decimal"
            value={marketStake}
            onChange={(event) => setMarketStake(event.target.value)}
          />
          {live.phase !== "live" ? (
            <p className="warning-line">
              No fresh market snapshot. Trading actions are disabled.</p>
          ) : (
            <div className="market-list">
              {markets.map((market) => (
                <article className="market-row" key={market.id}>
                  <div>
                    <b>
                      Market{market.id} · {market.bits} bits</b>
                    <span>
                      Until{formatDate(market.deadline)} · YES pool{" "}
                      {formatEtherSafe(market.yesPoolWei)} ETH / NO{" "}
                      {formatEtherSafe(market.noPoolWei)} ETH
                    </span>
                  </div>
                  <div className="market-actions">
                    <button
                      className="button button-primary"
                      disabled={market.settled || sending}
                      onClick={() => prepareMarketBuy(market.id, true)}
                    >
                      Yes</button>
                    <button
                      className="button"
                      disabled={market.settled || sending}
                      onClick={() => prepareMarketBuy(market.id, false)}
                    >
                      No</button>
                  </div>
                </article>
              ))}
            </div>
          )}
        </div>
      );

    if (activeTool === "insurance")
      return (
        <div className="tool-body">
          <div className="tool-heading">
            <p className="eyebrow">MARKETS · ETHERVANCE INSURANCE</p>
            <h3>Calculate coverage</h3>
            <p>
              The quote is read from the contract. Buying a policy requires an explicit review and wallet confirmation.
            </p>
          </div>
          <div className="form-grid">
            <label>
              <span>Coverage in ETH</span>
              <inpu
                className="text-input"
                inputMode="decimal"
                value={insuranceCoverage}
                onChange={(event) => setInsuranceCoverage(event.target.value)}
              />
            </label>
            <label>
              <span>Term, years</span>
              <selec
                className="text-input"
                value={insuranceYears}
                onChange={(event) => setInsuranceYears(event.target.value)}
              >
                <option value="1">1</option>
                <option value="2">2</option>
                <option value="3">3</option>
                <option value="4">4</option>
                <option value="5">5</option>
              </select>
            </label>
          </div>
          <div className="tool-actions">
            <button
              className="button button-primary"
              disabled={sending}
              onClick={() => void prepareInsurance()}
            >
              Calculate and review policy</button>
            {insuranceQuote && (
              <span className="quote-value">Premium:{insuranceQuote} ETH</span>
            )}
          </div>
          <p className="small-note">
            Free capital via API:{" "}
            {statusData
              ? formatEtherSafe(statusData.insuranceFreeCapitalWei)
              : "—"}{" "}

            ETH. If the pool has insufficient funds, the contract will reject the operation during simulation.
          </p>
        </div>
      );

    if (activeTool === "guard")
      return (
        <div className="tool-body">
          <div className="tool-heading">
            <p className="eyebrow">FOR DEVELOPERS · ETHERVANCE GUARD</p>
            <h3>Generate a source template</h3>
            <p>
              The file is generated locally. Review it, add tests, and obtain an independent audit before deployment.
            </p>
          </div>
          <div className="form-grid">
            <label>
              <span>Contract name</span>
              <inpu
                className="text-input"
                value={guardName}
                maxLength={48}
                onChange={(event) =>
                  setGuardName(event.target.value.replace(/[^a-zA-Z0-9_]/g, ""))
                }
              />
            </label>
            <label>
              <span>Trigger level</span>
              <inpu
                className="text-input"
                type="number"
                min="1"
                max="5"
                value={guardLevel}
                onChange={(event) =>
                  setGuardLevel(
                    Math.max(1, Math.min(5, Number(event.target.value) || 1)),
                  )
                }
              />
            </label>
          </div>
          <pre className="solidity-preview">
            <code>{`pragma solidity ^0.8.28;\n\nimport {QairosGuard} from "./QairosGuard.sol";\n\ncontract ${guardName || "QuantumSafeVault"} is QairosGuard {\n    constructor(IQairosOracle oracle_)\n        QairosGuard(oracle_, ${guardLevel}) {}\n\n    function withdraw(uint256 amount) external quantumSafe {\n        // Implement reviewed vault logic.\n    }\n}`}</code>
          </pre>
          <button className="button button-primary" onClick={downloadGuard}>
            Download Solidity</button>
        </div>
      );

    if (activeTool === "canary")
      return (
        <div className="tool-body">
          <div className="tool-heading">
            <p className="eyebrow">MONITOR · ETHERVANCE CANARY</p>
            <h3>Cryptographic ladder</h3>
            <p>
              Each rung's status comes from the latest verified Mainnet snapshot.
            </p>
          </div>
          {live.phase !== "live" ? (
            <p className="warning-line">
              No current snapshot. Rung status is unknown.</p>
          ) : (
            <div className="rung-list">
              {live.snapshot.rungs.map((rung) => (
                <div className="rung-row" key={rung.id}>
                  <b>{String(rung.bits).padStart(3, "0")} bits</b>
                  <span>{rung.armed ? "Armed" : "Practice"}</span>
                  <span>{rung.broken ? "Solved" : "Intact"}</span>
                  <span>{formatEtherSafe(rung.bountyWei)} ETH</span>
                </div>
              ))}
            </div>
          )}
          <p className="small-note">
            The demo solver does not stand in for proof of a cryptographic break. A Canary claim can be submitted only after preparing a verifiable solution.
          </p>
        </div>
      );

    return (
      <div className="tool-body">
        <div className="tool-heading">
          <p className="eyebrow">ETHEREUM MAINNET · READ-ONLY</p>
          <h3>Signal and recommended action</h3>
          <p>
            The dashboard refreshes the snapshot every 30 seconds. Missing or stale data is never replaced with a safe-looking value.
          </p>
        </div>
        <div className="threat-scale" aria-label="Threat levels">
          {[0, 1, 2, 3, 4, 5].map((value) => (
            <span
              className={
                statusData && value <= statusData.threatLevel
                  ? `scale-step ${threatClass}`
                  : "scale-step"
              }
              key={value}
            >
              {value}
            </span>
          ))}
        </div>
        <div className="response-box">
          <span>RECOMMENDED RESPONSE</span>
          <p>
            {!statusData
              ? "No verified signal. Do not make assumptions about safety."
              : statusData.threatLevel === 0
                ? "Keep monitoring. Verify recovery access and protect your recovery kit in advance."
                : statusData.threatLevel < 3
                  ? "Check public keys, addresses, and recovery readiness. Do not rely on a single data source."
                  : "Critical signal. Pause sensitive operations and coordinate with your security team."}
          </p>
        </div>
      </div>
    );
  };

  const currentTool = toolList.find(([id]) => id === activeTool) || toolList[0];

  return (
    <main>
      <header className="site-header">
        <nav className="nav-shell" aria-label="Main navigation">
          <a className="brand" href="#overview">
            <span className="orbit-mark" aria-hidden="true" />
            ETHERVANCE
          </a>
          <div className="nav-links">
            <a href="#how">How it works</a>
            <a href="#tools">Tools</a>
            <a href="#technology">Technology</a>
            <a href="#faq">FAQ</a>
          </div>
          <div className="header-actions">
            <button
              className="icon-button theme-button"
              title={
                theme === "light"
                  ? "Switch to dark theme"
                  : "Switch to light theme"
              }
              aria-label={
                theme === "light"
                  ? "Switch to dark theme"
                  : "Switch to light theme"
              }
              onClick={toggleTheme}
            >
              {theme === "light" ? "◐" : "☼"}
            </button>
            <button
              className="button wallet-button"
              onClick={() => setWalletOpen(true)}
            >
              {wallet.connected
                ? shortAddress(wallet.account)
                : "Connect wallet"}
            </button>
          </div>
        </nav>
        <div className="mobile-nav">
          <a href="#how">Overview</a>
          <a href="#tools">Tools</a>
          <a href="#faq">FAQ</a>
        </div>
      </header>

      <div className="page-shell">
        {notice && (
          <div className="notice" role="status">
            <span>{notice}</span>
            <button
              className="notice-close"
              aria-label="Dismiss notification"
              onClick={() => setNotice("")}
            >
              ×
            </button>
          </div>
        )}

        <section className="hero-grid" id="overview">
          <div className="hero-copy">
            <p className="eyebrow">QRS-01 // QUANTUM EARLY WARNING</p>
            <h1>
              Prepare for the<span>quantum shift.</span>
            </h1>
            <p className="hero-lead">
              An early-warning and protection layer for Ethereum. Monitor the signal, prepare a response, and keep control of your keys.
            </p>
            <div className="hero-actions">
              <a className="button button-primary" href="#console">
                Open dashboard</a>
              <a className="button" href="#how">
                How it works<span aria-hidden="true">↘</span>
              </a>
            </div>
            <div className="contract-line">
              <div>
                <span className="eyebrow">$QRS · CONTRACT ADDRESS</span>
                <code>{QAIROS_ADDRESSES.oracle}</code>
              </div>
              <button
                className="button button-small"
                onClick={() =>
                  void navigator.clipboard
                    .writeText(QAIROS_ADDRESSES.oracle)
                    .then(
                      () => setNotice("Oracle contract address copied."),
                      () => setNotice("Clipboard unavailable."),
                    )
                }
              >
                Copy</button>
            </div>
            <div className="community-links">
              <a
                href="https://x.com/Qairos_app"
                target="_blank"
                rel="noreferrer"
              >
                X · @Qairos_app ↗
              </a>
              <a
                href="https://github.com/Qairos-app"
                target="_blank"
                rel="noreferrer"
              >
                GitHub ↗
              </a>
            </div>
          </div>
          <div className="hero-status">
            <div className="metadata-grid">
              <div>
                <span>LICENSE</span>
                <b>OPEN SOURCE / MIT</b>
              </div>
              <div>
                <span>DOCUMENTATION</span>
                <b>QRS-01-2026-10-C</b>
              </div>
              <div>
                <span>NETWORK</span>
                <b>Ethereum Mainnet · chain 1</b>
              </div>
              <div>
                <span>LATEST SNAPSHOT</span>
                <b>{statusData ? formatDate(statusData.observedAtUtc) : "—"}</b>
              </div>
            </div>
            <div className={`live-panel ${threatClass}`}>
              <div>
                <span className="eyebrow">
                  {live.phase === "live"
                    ? `MAINNET · BLOCK ${statusData!.blockNumber.toLocaleString("en-US")}`
                    : live.phase === "loading"
                      ? "CONNECTING TO MAINNET"
                      : "SIGNAL UNKNOWN"}
                </span>
                <div className="live-level">
                  {statusData
                    ? `${String(statusData.threatLevel).padStart(2, "0")} / 05`
                    : "— / 05"}
                </div>
                <b>
                  {statusData
                    ? [
                        "NOMINAL",
                        "MONITORING",
                        "MONITORING",
                        "CRITICAL",
                        "CRITICAL",
                        "CRITICAL",
                      ][statusData.threatLevel]
                    : "NO DATA"}
                </b>
                <p>
                  {live.phase === "live"
                    ? `${statusData!.rungCount} rungs · ${statusData!.marketCount} markets · ${statusData!.contracts.filter((item) => item.deployed).length}/6 contracts`
                    : live.phase === "loading"
                      ? "Fetching a verified snapshot"
                      : live.message}
                </p>
              </div>
              <div className="live-radar" aria-hidden="true">
                <i />
                <i />
                <i />
                <b />
              </div>
            </div>
            <div className="status-foot">
              <span>
                <i
                  className={
                    live.phase === "live" ? "status-dot is-live" : "status-dot"
                  }
                />
                {live.phase === "live"
                  ? "Data is current"
                  : live.phase === "loading"
                    ? "Loading"
                    : "Data unavailable"}
              </span>
              <span>Auto-refresh · 30 sec.</span>
              <button
                className="status-refresh"
                disabled={statusRefreshing}
                onClick={() =>
                  setStatusRefreshVersion((current) => current + 1)
                }
              >
                <span
                  className={
                    statusRefreshing ? "loading-dot is-loading" : "loading-dot"
                  }
                  aria-hidden="true"
                />
                {statusRefreshing ? "Checking Mainnet…" : "Refresh now"}
              </button>
            </div>
          </div>
        </section>

        <section className="metrics-strip" aria-label="Mainnet metrics">
          <div>
            <b>
              {statusData
                ? `${statusData.rungs.filter((rung) => rung.armed && !rung.broken).length}/${armedRungs.length || 5}`
                : "—"}
            </b>
            <span>armed rungs intact</span>
          </div>
          <div>
            <b>{statusData ? statusData.markets.length : "—"}</b>
            <span>prediction markets</span>
          </div>
          <div>
            <b>
              {statusData
                ? statusData.contracts.filter((item) => item.deployed).length
                : "—"}
              /6
            </b>
            <span>contracts deployed</span>
          </div>
          <div>
            <b>
              {wallet.connected
                ? wallet.chainId === 1
                  ? "L1"
                  : `#${wallet.chainId}`
                : "—"}
            </b>
            <span>
              {wallet.connected ? wallet.walletName : "wallet not connected"}
            </span>
          </div>
        </section>

        <section className="console-section" id="console">
          <div className="section-heading">
            <div>
              <p className="eyebrow">LIVE DASHBOARD · ETHEREUM</p>
              <h2>One signal. A clear next step.</h2>
            </div>
            <p>
              Read-only status is available without a wallet. Mainnet writes require an authenticated session and wallet confirmation.
            </p>
          </div>
          <div className="console-frame">
            <aside className="tool-nav" aria-label="Ethervance tools">
              {toolList.map(([id, label, description], index) => (
                <button
                  className={
                    activeTool === id
                      ? "tool-nav-item selected"
                      : "tool-nav-item"
                  }
                  key={id}
                  onClick={() => setActiveTool(id)}
                >
                  <span className="tool-nav-number">0{index + 1}</span>
                  <span className="tool-nav-label">
                    <b>{label}</b>
                    <small>{description}</small>
                  </span>
                  <span aria-hidden="true">↗</span>
                </button>
              ))}
            </aside>
            <section className="tool-panel" aria-live="polite">
              <div className="tool-panel-top">
                <span className="eyebrow">{currentTool[1]}</span>
                <span
                  className={`network-chip ${wallet.chainId === 1 ? "network-ok" : wallet.connected ? "network-warn" : ""}`}
                >
                  {wallet.connected
                    ? wallet.chainId === 1
                      ? "ETHEREUM MAINNET"
                      : `NETWORK ${wallet.chainId}`
                    : "NO WALLET"}
                </span>
              </div>
              {renderTool()}
            </section>
          </div>
          <div className="compliance-note">
            <b>Transaction safety</b>
            <span>
              Every write requires a matching session and active account, Mainnet, a successful simulation, a gas estimate, and separate wallet confirmation. The contracts are experimental and unaudited.
            </span>
          </div>
        </section>

        <section id="how" className="steps-section">
          <div className="section-heading">
            <div>
              <p className="eyebrow">HOW IT WORKS</p>
              <h2>Detect first. Protect next.</h2>
            </div>
            <p>
              Public cryptographic challenges provide an observable signal. Owners and protocols decide in advance how they will respond.
            </p>
          </div>
          <div className="steps-grid">
            {[
              [
                "01",
                "Canary",
                "Cryptographic challenges provide a public signal about an attacker's capabilities.",
              ],
              [
                "02",
                "Oracle",
                "A verified solution to an armed rung raises the threat level in the contract.",
              ],
              [
                "03",
                "Guard",
                "Protected contracts restrict sensitive actions at a defined threshold.",
              ],
              [
                "04",
                "Ark",
                "A proof saved in advance helps prepare a recovery path.",
              ],
              [
                "05",
                "Markets",
                "Predictions and insurance use the same Oracle signal.",
              ],
            ].map(([number, title, description]) => (
              <article className="step-item" key={number}>
                <span>{number}</span>
                <h3>{title}</h3>
                <p>{description}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="modules-section" id="tools">
          <div className="section-heading">
            <div>
              <p className="eyebrow">TOOLS</p>
              <h2>Seven modules. One system.</h2>
            </div>
            <p>
              Open a dashboard module to read live data, prepare keys, and review operations before signing.
            </p>
          </div>
          <div className="module-grid">
            {toolList.map(([id, name, description], index) => (
              <button
                className="module-card"
                key={id}
                onClick={() => {
                  setActiveTool(id);
                  documen
                    .getElementById("console")
                    ?.scrollIntoView({ behavior: "smooth" });
                }}
              >
                <span className="eyebrow">
                  {String(index + 1).padStart(2, "0")} /{" "}
                  {index < 3 ? "PROTECTION" : "MONITORING"}
                </span>
                <b>{name}</b>
                <p>{description}</p>
                <span className="module-link">OPEN MODULE ↗</span>
              </button>
            ))}
          </div>
        </section>

        <section className="usecase-section">
          <p className="eyebrow">FOR THOSE WHO CONTROL THE KEYS</p>
          <h2>From personal wallets to protocol treasuries.</h2>
          <div className="usecase-grid">
            {[
              [
                "LONG-TERM HOLDERS",
                "Prepare an independent recovery path for accounts with a published key.",
              ],
              [
                "DAO TREASURIES",
                "Define how sensitive operations respond as risk increases.",
              ],
              [
                "DEFI PROTOCOLS",
                "Plan to pause risky routes based on a public signal.",
              ],
              [
                "CUSTODIANS",
                "Track public keys and document recovery readiness.",
              ],
              [
                "RESEARCHERS",
                "Study public challenges and publish reproducible results.",
              ],
            ].map(([title, text]) => (
              <article key={title}>
                <b>{title}</b>
                <p>{text}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="technology-section" id="technology">
          <div className="section-heading">
            <div>
              <p className="eyebrow">TECHNOLOGY</p>
              <h2>Standards over promises.</h2>
            </div>
            <p>Open specifications and source code can be independently verified.</p>
          </div>
          <div className="tech-table-wrap">
            <table className="tech-table">
              <thead>
                <tr>
                  <th>Component</th>
                  <th>Purpose</th>
                  <th>Source</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>ML-DSA-44</td>
                  <td>Post-quantum keys and signatures</td>
                  <td>
                    <a
                      href="https://csrc.nist.gov/pubs/fips/204/final"
                      target="_blank"
                      rel="noreferrer"
                    >
                      NIST FIPS 204 ↗
                    </a>
                  </td>
                </tr>
                <tr>
                  <td>SEC 2</td>
                  <td>Canary ladder curves</td>
                  <td>
                    <a
                      href="https://www.secg.org/sec2-v2.pdf"
                      target="_blank"
                      rel="noreferrer"
                    >
                      SECG SEC 2 ↗
                    </a>
                  </td>
                </tr>
                <tr>
                  <td>keccak256</td>
                  <td>Commitments and events</td>
                  <td>
                    <a
                      href="https://ethereum.org/developers/docs/smart-contracts/"
                      target="_blank"
                      rel="noreferrer"
                    >
                      Ethereum Docs ↗
                    </a>
                  </td>
                </tr>
                <tr>
                  <td>Qairos EVM</td>
                  <td>Official Mainnet addresses and Solidity contracts</td>
                  <td>
                    <a
                      href="https://github.com/Qairos-app/qairos-ethereum-contracts"
                      target="_blank"
                      rel="noreferrer"
                    >
                      GitHub ↗
                    </a>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          <p className="security-disclaimer">
            The code and contracts have not undergone an independent audit. Monitoring does not make standard EVM signatures post-quantum.
          </p>
        </section>

        <section className="roadmap-section">
          <p className="eyebrow">ROADMAP</p>
          <h2>From prototype to L1.</h2>
          <div className="roadmap-grid">
            {[
              [
                "PHASE 1 · COMPLETE",
                "Prototype",
                "Contracts, tests, and local deployment.",
              ],
              [
                "PHASE 2",
                "Sepolia",
                "Public testnet, practice bounties, and wallet.",
              ],
              [
                "PHASE 3",
                "Independent audit",
                "Review of contracts and curve mathematics.",
              ],
              ["PHASE 4", "Ethereum Mainnet", "Deployment and market launch."],
              [
                "PHASE 5",
                "PQ wallets",
                "Post-quantum verification via account abstraction.",
              ],
            ].map(([phase, title, description], index) => (
              <article
                className={index === 0 ? "roadmap-current" : ""}
                key={phase}
              >
                <span>{phase}</span>
                <b>{title}</b>
                <p>{description}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="faq-section" id="faq">
          <div>
            <p className="eyebrow">FAQ</p>
            <h2>The essentials, briefly.</h2>
          </div>
          <div>
            {faq.map(([question, answer]) => (
              <details key={question}>
                <summary>
                  {question}
                  <span aria-hidden="true">+</span>
                </summary>
                <p>{answer}</p>
              </details>
            ))}
          </div>
        </section>

        <section className="final-cta">
          <div>
            <p className="eyebrow">QRS-01 / ETHEREUM MAINNET</p>
            <h2>Be ready before the quantum shift.</h2>
            <p>
              Prepare a recovery kit and review your response before the signal becomes critical.
            </p>
          </div>
          <a href="#console" className="button button-primary">
            Open dashboard ↗</a>
        </section>
      </div>

      <footer className="site-footer">
        <div className="footer-main">
          <a className="brand" href="#overview">
            <span className="orbit-mark" aria-hidden="true" />
            ETHERVANCE
          </a>
          <p>
            Early warning and post-quantum readiness tools for Ethereum.
          </p>
          <span className="eyebrow">QRS-01 · MIT · 2026</span>
        </div>
        <div className="footer-links">
          <a href="#console">Dashboard</a>
          <a href="#tools">Tools</a>
          <a href="#technology">Technology</a>
          <a
            href="https://github.com/Qairos-app"
            target="_blank"
            rel="noreferrer"
          >
            Source code ↗</a>
        </div>
      </footer>

      <dialog
        ref={walletDialog}
        className="app-dialog"
        aria-labelledby="wallet-dialog-title"
        onCancel={() => setWalletOpen(false)}
        onClick={(event) => {
          if (event.target === walletDialog.current) setWalletOpen(false);
        }}
      >
        <header className="dialog-header">
          <div>
            <p className="eyebrow">EIP-6963 / EIP-1193</p>
            <h2 id="wallet-dialog-title">
              {wallet.connected ? "Your wallet" : "Connect wallet"}
            </h2>
          </div>
          <button
            className="icon-button"
            aria-label="Close"
            onClick={() => setWalletOpen(false)}
          >
            ×
          </button>
        </header>
        <div className="dialog-content">
          {wallet.connected ? (
            <>
              <div className="wallet-details">
                <span>Provider</span>
                <b>{wallet.walletName}</b>
                <span>Account</span>
                <code>{wallet.account}</code>
                <span>Network</span>
                <b
                  className={wallet.chainId === 1 ? "state-good" : "state-warn"}
                >
                  {wallet.chainId === 1
                    ? "Ethereum Mainnet · 1"
                    : `Chain ${wallet.chainId}`}
                </b>
              </div>
              {wallet.chainId !== 1 && (
                <button
                  className="button button-primary full-width"
                  disabled={wallet.busy}
                  onClick={() => void wallet.switchToMainnet().catch(() => {})}
                >
                  Switch to Ethereum Mainnet</button>
              )}
              <div className="session-box">
                <span>Ethervance session</span>
                <b>
                  {sessionReady
                    ? `Signed in · expires ${formatDate(walletSession!.expiresAt)}`
                    : "Not signed in"}
                </b>
                {sessionReady ? (
                  <button
                    className="button button-small"
                    onClick={() => void signOut()}
                  >
                    Sign out</button>
                ) : (
                  <button
                    className="button button-primary button-small"
                    disabled={authBusy || wallet.chainId !== 1}
                    onClick={() => void signIn()}
                  >
                    {authBusy ? "Signing…" : "Sign in (no gas)"}
                  </button>
                )}
              </div>
              <button
                className="button full-width"
                onClick={() => {
                  if (walletSession) {
                    void signOut().then((signedOut) => {
                      if (signedOut) wallet.disconnect();
                    });
                  } else wallet.disconnect();
                }}
              >
                Forget this wallet on this site</button>
            </>
          ) : (
            <>
              <p className="dialog-intro">
                Connect an Ethereum wallet through Privy. Your wallet will ask
                you to approve the connection.
              </p>
              {process.env.NEXT_PUBLIC_PRIVY_APP_ID ? (
                <div className="privy-connect-wrap">
                  <PrivyWalletConnec
                    onStart={() => setWalletOpen(false)}
                    onConnected={() => setWalletOpen(false)}
                  />
                </div>
              ) : (
                <div className="empty-wallets">
                  <b>Privy connection is not configured</b>
                  <p>
                    Set NEXT_PUBLIC_PRIVY_APP_ID from your Privy dashboard and
                    redeploy to enable wallet connection.
                  </p>
                </div>
              )}
            </>
          )}
          {wallet.status && (
            <p className="wallet-status" role="status">
              {wallet.status}
            </p>
          )}
        </div>
      </dialog>

      <dialog
        ref={reviewDialog}
        className="app-dialog review-dialog"
        aria-labelledby="review-title"
        onCancel={() => {
          if (!sending) setReview(null);
        }}
        onClick={(event) => {
          if (event.target === reviewDialog.current && !sending)
            setReview(null);
        }}
      >
        {review && (
          <>
            <header className="dialog-header">
              <div>
                <p className="eyebrow">REVIEW BEFORE SENDING</p>
                <h2 id="review-title">{review.title}</h2>
              </div>
              <button
                className="icon-button"
                disabled={sending}
                aria-label="Close"
                onClick={() => setReview(null)}
              >
                ×
              </button>
            </header>
            <div className="dialog-content">
              <div className="wallet-details">
                <span>Network</span>
                <b>Ethereum Mainnet · chain 1</b>
                <span>Contract</span>
                <code>{review.to}</code>
                <span>Method</span>
                <b>{review.functionName}</b>
                <span>Sender</span>
                <code>{review.from}</code>
                <span>Value</span>
                <b>{formatEtherSafe(review.value)} ETH</b>
                <span>Gas limit</span>
                <b>{review.gasLimit.toLocaleString("en-US")}</b>
                <span>Estimated fee</span>
                <b>
                  up to{formatEtherSafe(review.gasLimit * review.gasPrice)} ETH
                </b>
              </div>
              <details className="calldata-details">
                <summary>Show calldata</summary>
                <code>{review.data}</code>
              </details>
              <label className="review-ack">
                <inpu
                  type="checkbox"
                  checked={reviewChecked}
                  onChange={(event) => setReviewChecked(event.target.checked)}
                />
                <span>
                  I have checked the network, contract address, function, amount, and sender address.
                </span>
              </label>
              <div className="dialog-actions">
                <button
                  className="button"
                  disabled={sending}
                  onClick={() => setReview(null)}
                >
                  Cancel</button>
                <button
                  className="button button-primary"
                  disabled={!reviewChecked || sending}
                  onClick={() => void confirmTransaction()}
                >
                  {sending
                    ? "Waiting for confirmation…"
                    : "Confirm in wallet"}
                </button>
              </div>
              <p className="small-note">
                The transaction will be simulated and gas-estimated again before sending. Only your wallet gives final confirmation.
              </p>
            </div>
          </>
        )}
      </dialog>
    </main>
  );
}
