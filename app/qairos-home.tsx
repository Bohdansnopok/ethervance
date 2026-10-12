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
import { useWallet, type DiscoveredWallet } from "./wallet-provider";
import PrivyWalletConnect from "./privy-wallet-connect";
import { EnglishContent, translateText } from "./i18n";

type Post = { title: string; text: string };
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

const posts: Post[] = [
  {
    title: "Готовность начинается до сигнала.",
    text: "План реагирования полезен только тогда, когда он подготовлен заранее. Qairos объединяет публичный сигнал и понятные шаги для владельцев активов и протоколов.",
  },
  {
    title: "Один сигнал. Следующий шаг понятен.",
    text: "Уровень угрозы имеет смысл, когда за ним следует действие. Проверяйте источник данных, допущения и свою политику реагирования.",
  },
  {
    title: "Двенадцать ступеней. Публичный сигнал.",
    text: "Лестница Qairos Canary помогает наблюдать за прогрессом криптографических испытаний. Любое заявление о результате должно быть проверяемым.",
  },
  {
    title: "Подготовьте восстановление заранее.",
    text: "Не откладывайте проверку адресов и процедур до кризиса. Пройдите путь восстановления вместе с доверенным проверяющим.",
  },
  {
    title: "Продумайте паузу до необходимости.",
    text: "Протоколы могут заранее определить реакцию чувствительных операций на изменение сигнала. Политику нужно документировать и тестировать.",
  },
  {
    title: "Seed-фраза остаётся только у вас.",
    text: "Сайт не должен просить вас вводить seed-фразу или приватный ключ. Храните секреты офлайн и независимо проверяйте каждое действие.",
  },
  {
    title: "Проверяйте источник сигнала.",
    text: "Оракул помогает принять решение, но не заменяет его. Изучите происхождение данных, ограничения и условия использования.",
  },
  {
    title: "План восстановления нужно проверять.",
    text: "Непроверенный план остаётся предположением. Сверьте адрес назначения и порядок действий до того, как они понадобятся.",
  },
  {
    title: "Доказательства готовят заранее.",
    text: "Понимайте, что именно фиксирует commitment, и берегите данные восстановления. Не публикуйте материалы, дающие доступ к активам.",
  },
  {
    title: "Открытый код требует проверки.",
    text: "Читайте исходники, воспроизводите тесты и запрашивайте независимый аудит. Маркетинговое обещание не является доказательством безопасности.",
  },
  {
    title: "Тестируйте до Mainnet.",
    text: "Тестовая сеть помогает найти ошибки интеграции, но не доказывает безопасность контракта. Нужны аудит и моделирование угроз.",
  },
  {
    title: "Подготовка — это практика.",
    text: "Отметьте открытые ключи, проверьте восстановление и договоритесь о ролях. Маленькие проверяемые шаги лучше обещаний под давлением.",
  },
];

const toolList = [
  ["oracle", "Монитор угроз", "Живой сигнал Mainnet и ступени Canary"],
  ["ark", "Qairos Ark", "ML-DSA-44, commitment и recovery kit"],
  ["recover", "Восстановление", "Проверка набора и два шага транзакции"],
  ["signer", "PQ-подпись", "Создание и проверка ML-DSA-44 подписи"],
  ["canary", "Лестница Canary", "Статус публичных криптографических задач"],
  ["markets", "Рынки", "Позиции на Mainnet с явным подтверждением"],
  ["guard", "Генератор Guard", "Исходный код защитного контракта"],
] as const;

const faq = [
  [
    "Может ли Qairos остановить квантовый компьютер?",
    "Нет. Qairos отслеживает публичные сигналы и помогает подготовить действия. Система не останавливает вычисления и не гарантирует сохранность средств.",
  ],
  [
    "Работают ли контракты в Mainnet?",
    "Официальный status API публикует состояние Ethereum Mainnet и deployment addresses. Контракты экспериментальные и не проходили независимый аудит; не вносите реальные средства без собственной проверки.",
  ],
  [
    "Куда отправляются мои ключи?",
    "ML-DSA ключи создаются локально в браузере. Приватная часть не отправляется на сервер и не включается в recovery kit.",
  ],
  [
    "Какие кошельки поддерживаются?",
    "Сайт обнаруживает EIP-6963 и совместимые EIP-1193 кошельки, включая MetaMask, Rabby, Coinbase Wallet, Brave, Trust и OKX. QR/WalletConnect отключён в официальном примере и здесь не заявляется как доступный.",
  ],
  [
    "Нужно ли переключаться на Ethereum Mainnet?",
    "Да. Записи в контракт выполняются только в chain ID 1. Перед отправкой сайт проверяет сеть, симулирует вызов и показывает параметры для явного подтверждения в кошельке.",
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
    throw new Error("Сервер вернул некорректные данные.");
  const snapshot = value as Partial<MainnetSnapshot>;
  if (
    snapshot.chainId !== 1 ||
    !Number.isInteger(snapshot.threatLevel) ||
    snapshot.threatLevel! < 0 ||
    snapshot.threatLevel! > 5
  ) {
    throw new Error("Ответ не прошёл проверку сети или уровня угрозы.");
  }
  const observedAt = Date.parse(snapshot.observedAtUtc || "");
  if (
    !Number.isFinite(observedAt) ||
    observedAt > Date.now() + 60_000 ||
    Date.now() - observedAt > 90_000
  ) {
    throw new Error(
      "Снимок Mainnet устарел. Безопасный уровень не предполагается.",
    );
  }
  if (
    !Array.isArray(snapshot.contracts) ||
    !Array.isArray(snapshot.rungs) ||
    !Array.isArray(snapshot.markets)
  ) {
    throw new Error(
      "В ответе отсутствуют данные контрактов, ступеней или рынков.",
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
      "Адреса или состояние deployment не совпали с официальным реестром.",
    );
  }
  return snapshot as MainnetSnapshot;
}

function BannerArtwork({ post, index }: { post: Post; index: number }) {
  return (
    <EnglishContent>
    <div className={`post-art art-${String(index + 1).padStart(2, "0")}`}>
      <span className="post-art-label">
        QAIROS / {String(index + 1).padStart(2, "0")}
      </span>
      <div aria-hidden="true" className="post-art-mark">
        <i />
        <i />
        <i />
      </div>
      <h3>{post.title}</h3>
      <span className="post-art-footer">ETHEREUM · 2026</span>
    </div>
    </EnglishContent>
  );
}

function drawBanner(post: Post, index: number) {
  const canvas = document.createElement("canvas");
  canvas.width = 1200;
  canvas.height = 675;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Браузер не поддерживает экспорт баннера.");
  const seed = index + 1;
  const lime = "#d8ff5a";
  const paper = "#f2f0e8";
  const centerX = 770 + ((seed * 37) % 300);
  const centerY = 140 + ((seed * 43) % 380);

  context.fillStyle = "#10110f";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.strokeStyle = "rgba(242,240,232,.08)";
  context.lineWidth = 1;
  for (let x = 32; x < canvas.width; x += 32) {
    context.beginPath();
    context.moveTo(x, 0);
    context.lineTo(x, canvas.height);
    context.stroke();
  }
  for (let y = 32; y < canvas.height; y += 32) {
    context.beginPath();
    context.moveTo(0, y);
    context.lineTo(canvas.width, y);
    context.stroke();
  }

  context.strokeStyle = "rgba(216,255,90,.78)";
  context.fillStyle = "rgba(216,255,90,.78)";
  context.lineWidth = 2;
  switch (index) {
    case 0:
      for (let ring = 1; ring < 7; ring += 1) {
        context.beginPath();
        context.arc(centerX, centerY, ring * 32, 0.18 * seed, Math.PI * 1.82);
        context.stroke();
      }
      context.beginPath();
      context.moveTo(centerX - 210, centerY + 130);
      context.lineTo(centerX + 200, centerY - 140);
      context.stroke();
      break;
    case 1:
      for (let bar = 0; bar < 18; bar += 1) {
        const height = 30 + ((bar * seed * 23) % 270);
        context.fillRect(710 + bar * 25, centerY - height / 2, 5, height);
      }
      break;
    case 2:
      for (let row = 0; row < 13; row += 1)
        for (let column = 0; column < 14; column += 1) {
          if ((row * 3 + column * seed) % 5 !== 0) {
            context.beginPath();
            context.arc(
              700 + column * 27,
              170 + row * 25,
              2 + ((row + column) % 3),
              0,
              Math.PI * 2,
            );
            context.fill();
          }
        }
      break;
    case 3:
      for (let block = 0; block < 8; block += 1) {
        const size = 18 + (block % 3) * 12;
        context.globalAlpha = 0.25 + (block % 4) * 0.18;
        context.fillRect(
          735 + (block % 3) * 105,
          125 + Math.floor(block / 3) * 130,
          size,
          size,
        );
      }
      context.globalAlpha = 1;
      break;
    case 4:
      for (let stripe = 0; stripe < 12; stripe += 1) {
        context.beginPath();
        context.moveTo(720 + stripe * 31, 90);
        context.lineTo(560 + stripe * 55, 590);
        context.stroke();
      }
      break;
    case 5:
      context.strokeStyle = "rgba(216,255,90,.65)";
      for (let radius = 45; radius <= 240; radius += 32) {
        context.beginPath();
        context.arc(centerX, centerY, radius, 0, Math.PI * 2);
        context.stroke();
      }
      context.beginPath();
      context.moveTo(centerX - 250, centerY);
      context.lineTo(centerX + 250, centerY);
      context.moveTo(centerX, centerY - 250);
      context.lineTo(centerX, centerY + 250);
      context.stroke();
      break;
    case 6:
      context.fillStyle = "rgba(216,255,90,.13)";
      context.fillRect(710, 135, 420, 6);
      context.fillRect(760, 165, 320, 6);
      context.fillRect(735, 195, 375, 6);
      context.fillStyle = lime;
      context.font = "700 180px monospace";
      context.fillText("Q", 830, 465);
      break;
    case 7:
      context.strokeStyle = "rgba(216,255,90,.58)";
      for (let step = 0; step < 8; step += 1) {
        const offset = step * 28;
        context.strokeRect(
          820 - offset / 2,
          175 - offset / 2,
          170 + offset,
          170 + offset,
        );
      }
      break;
    case 8:
      context.lineWidth = 8;
      for (let wave = 0; wave < 9; wave += 1) {
        context.beginPath();
        context.ellipse(
          centerX,
          centerY,
          80 + wave * 24,
          35 + wave * 17,
          -0.42,
          0.2,
          Math.PI * 1.68,
        );
        context.stroke();
      }
      context.lineWidth = 2;
      break;
    case 9:
      for (let tick = 0; tick < 64; tick += 1) {
        const height = 24 + Math.abs(Math.sin(tick * 0.61 + seed) * 180);
        context.fillRect(690 + tick * 7, centerY - height / 2, 3, height);
      }
      break;
    case 10:
      context.fillStyle = lime;
      for (let tile = 0; tile < 10; tile += 1) {
        const x = 735 + (tile % 3) * 120;
        const y = 150 + Math.floor(tile / 3) * 90;
        context.globalAlpha = 0.18 + (tile % 4) * 0.18;
        context.beginPath();
        context.roundRect(x, y, 72 + (tile % 2) * 34, 18, 9);
        context.fill();
      }
      context.globalAlpha = 1;
      break;
    default:
      context.font = "700 330px monospace";
      context.fillStyle = "rgba(216,255,90,.13)";
      context.fillText("12", 720, 430);
      context.strokeStyle = "rgba(216,255,90,.9)";
      for (let ray = 0; ray < 12; ray += 1) {
        const angle = (Math.PI * 2 * ray) / 12;
        context.beginPath();
        context.moveTo(centerX, centerY);
        context.lineTo(
          centerX + Math.cos(angle) * 220,
          centerY + Math.sin(angle) * 220,
        );
        context.stroke();
      }
      break;
  }

  context.fillStyle = lime;
  context.beginPath();
  context.arc(centerX, centerY, 7, 0, Math.PI * 2);
  context.fill();
  context.fillStyle = lime;
  context.font = "700 18px monospace";
  context.fillText(`QAIROS / ${String(index + 1).padStart(2, "0")}`, 64, 72);
  context.fillStyle = paper;
  context.font = "700 54px sans-serif";
  const titleWords = post.title.split(" ");
  const titleLines: string[] = [];
  let currentLine = "";
  for (const word of titleWords) {
    const candidate = currentLine ? `${currentLine} ${word}` : word;
    if (context.measureText(candidate).width > 630 && currentLine) {
      titleLines.push(currentLine);
      currentLine = word;
    } else currentLine = candidate;
  }
  if (currentLine) titleLines.push(currentLine);
  titleLines
    .slice(0, 3)
    .forEach((line, lineIndex) =>
      context.fillText(line, 64, 210 + lineIndex * 68),
    );
  context.fillStyle = "#a9ada1";
  context.font = "18px monospace";
  context.fillText("POST-QUANTUM READINESS", 64, 600);
  return canvas;
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
    "Я проверяю готовность кошелька к постквантовой миграции.",
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
          throw new Error(`Сервис Mainnet вернул HTTP ${response.status}.`);
        const snapshot = validateSnapshot(await response.json());
        if (active) setLive({ phase: "live", snapshot });
      } catch (error) {
        if (active)
          setLive({
            phase: "offline",
            message:
              error instanceof Error
                ? error.message
                : "Мониторинг Mainnet недоступен.",
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
        if (!cancelled) setVaultBalance("Недоступно");
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
      "Аккаунт кошелька изменился. Войдите заново перед любым действием.",
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
      setNotice("Сначала подключите кошелек.");
      return;
    }
    if (wallet.chainId !== MAINNET_CHAIN_ID) {
      setNotice("Для входа переключите кошелек на Ethereum Mainnet.");
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
            "Сервис кошелька недоступен. Проверьте подключение same-origin API.",
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
          "Аккаунт или сеть изменились во время подписи. Повторите вход.",
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
          session.error || "Сервер не подтвердил подпись этого аккаунта.",
        );
      }
      setWalletSession({
        address: getAddress(session.address),
        csrfToken: session.csrfToken,
        expiresAt: session.expiresAt,
      });
      setNotice(
        "Вход подтвержден подписью без газа. Средства и разрешения не запрашивались.",
      );
    } catch (error) {
      setNotice(
        error instanceof Error
          ? error.message
          : "Не удалось войти через кошелек.",
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
        throw new Error("Сервер не отозвал сессию. Повторите выход позже.");
      setWalletSession(null);
      setNotice("Сессия кошелька завершена.");
      return true;
    } catch (error) {
      setNotice(
        error instanceof Error ? error.message : "Не удалось завершить сессию.",
      );
      return false;
    }
  };

  const copyContractAddress = async () => {
    try {
      await navigator.clipboard.writeText(QAIROS_ADDRESSES.oracle);
      setNotice("Адрес QairosOracle скопирован.");
    } catch {
      setNotice("Буфер обмена недоступен в этом браузере.");
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
      setNotice("Подключите кошелек, чтобы подготовить транзакцию.");
      setWalletOpen(true);
      return;
    }
    if (wallet.chainId !== MAINNET_CHAIN_ID) {
      setNotice("Транзакции разрешены только в Ethereum Mainnet.");
      return;
    }
    if (!sessionReady || !walletSession) {
      setNotice(
        "Сначала войдите, подписав одноразовое сообщение Qairos без газа.",
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
        throw new Error("Кошелек или сеть изменились. Ничего не отправлено.");
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
          "Сессия, аккаунт или сеть изменились во время проверки. Ничего не отправлено.",
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
          : "Симуляция транзакции не прошла. Ничего не отправлено.",
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
        throw new Error("Сессия больше не соответствует кошельку.");
      const accounts = await wallet.provider.request({
        method: "eth_accounts",
      });
      const chain = await wallet.provider.request({ method: "eth_chainId" });
      if (
        !Array.isArray(accounts) ||
        accounts[0] !== review.from ||
        chain !== "0x1"
      )
        throw new Error("Кошелек или сеть изменились. Ничего не отправлено.");
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
        throw new Error("Повторная проверка кошелька не прошла.");
      setNotice("Ожидаем подтверждение транзакции в кошельке…");
      const transaction = await signer.sendTransaction({
        to: review.to,
        data: review.data,
        value: review.value,
        gasLimit: (freshGas * 120n) / 100n + 1_000n,
      });
      setNotice(
        `Транзакция отправлена: ${transaction.hash.slice(0, 12)}… Ожидаем подтверждение блока.`,
      );
      const receipt = await transaction.wait(1, 240_000);
      if (!receipt || receipt.status !== 1)
        throw new Error(
          `Транзакция отменена или завершилась ошибкой: ${transaction.hash}`,
        );
      review.afterConfirm?.(receipt.blockNumber);
      setNotice(
        `Подтверждено в блоке ${receipt.blockNumber}. Хэш: ${transaction.hash}`,
      );
      setReview(null);
      setReviewChecked(false);
      setStatusRefreshVersion((current) => current + 1);
    } catch (error) {
      setNotice(
        error instanceof Error ? error.message : "Транзакция не подтверждена.",
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
          "Для безопасной генерации ключей нужен HTTPS или localhost.",
        );
      const browserEntropy = window.crypto.getRandomValues(new Uint8Array(64));
      let seed: Uint8Array<ArrayBufferLike> = browserEntropy.slice(0, 32);
      let salt: Uint8Array<ArrayBufferLike> = browserEntropy.slice(32);
      let entropyLabel = "Браузерный CSPRNG";
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
        if (!response.ok) throw new Error("QRNG недоступен");
        const result = await response.json();
        if (
          !Array.isArray(result.data) ||
          result.data.length < 64 ||
          result.data.some(
            (byte: unknown) =>
              !Number.isInteger(byte) || Number(byte) < 0 || Number(byte) > 255,
          )
        )
          throw new Error("Некорректный ответ QRNG");
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
        entropyLabel = "QRNG + браузерный CSPRNG";
      } catch {
        entropyLabel = "Браузерный CSPRNG; QRNG недоступен";
      }
      const generated = ml_dsa44.keygen(seed);
      setKeys({ ...generated, salt: hexlify(salt), entropy: entropyLabel });
      setCommitment("");
      setSignature(null);
      setSignatureResult("");
      setNotice(
        `Ключ ML-DSA-44 создан локально. Источник энтропии: ${entropyLabel}. Секретная часть останется в памяти этой вкладки.`,
      );
    } catch (error) {
      setNotice(
        error instanceof Error ? error.message : "Не удалось создать ключ.",
      );
    } finally {
      setKeyBusy(false);
    }
  };

  const bindArkCommitment = () => {
    if (!keys) {
      setNotice("Сначала создайте ML-DSA-44 ключ.");
      return;
    }
    if (!wallet.account) {
      setWalletOpen(true);
      setNotice("Подключите кошелек, который будет владеть commitment.");
      return;
    }
    const nextCommitment = solidityPackedKeccak256(
      ["bytes", "bytes32", "address"],
      [keys.publicKey, keys.salt, wallet.account],
    );
    setKeyAccount(wallet.account);
    setCommitment(nextCommitment);
    setNotice(
      "Commitment рассчитан локально и связан с текущим адресом кошелька.",
    );
  };

  const saveRecoveryKit = () => {
    if (!keys || !commitment || !keyAccount) {
      setNotice("Сначала создайте ключ и commitment.");
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
        "Recovery kit позволяет предъявить доказательство владения. Храните офлайн и не передавайте посторонним.",
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
      setNotice("Файл recovery kit слишком большой.");
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
        throw new Error("Файл не соответствует формату Qairos recovery kit.");
      const expected = solidityPackedKeccak256(
        ["bytes", "bytes32", "address"],
        [raw.pqPublicKey, raw.salt, raw.account],
      );
      if (expected.toLowerCase() !== raw.commitment.toLowerCase())
        throw new Error(
          "Ключ, salt и аккаунт не совпадают с commitment из файла.",
        );
      setRecoveryKit(raw as RecoveryKit);
      setNotice(
        "Recovery kit проверен локально. Секретов в сеть не отправлено.",
      );
    } catch (error) {
      setRecoveryKit(null);
      setNotice(
        error instanceof Error
          ? error.message
          : "Не удалось прочитать recovery kit.",
      );
    }
  };

  const exportPost = (index: number) => {
    try {
      const post = posts[index];
      const canvas = drawBanner(
        { title: translateText(post.title), text: translateText(post.text) },
        index,
      );
      const link = document.createElement("a");
      link.href = canvas.toDataURL("image/png");
      link.download = `qairos-post-${String(index + 1).padStart(2, "0")}.png`;
      document.body.appendChild(link);
      link.click();
      link.remove();
    } catch (error) {
      setNotice(
        error instanceof Error ? error.message : "Не удалось создать баннер.",
      );
    }
  };

  const copyPost = async (post: Post) => {
    try {
      await navigator.clipboard.writeText(translateText(post.text));
      setNotice("Текст публикации скопирован.");
    } catch {
      setNotice("Буфер обмена недоступен в этом браузере.");
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
      setNotice("Сначала создайте ключ и commitment.");
      return;
    }
    if (wallet.account?.toLowerCase() !== keyAccount.toLowerCase()) {
      setNotice("Подключен другой аккаунт. Сначала переключите кошелек.");
      return;
    }
    void prepareTransaction({
      title: "Зарегистрировать commitment Qairos Ark",
      functionName: "QairosArk.commit(bytes32)",
      contract: "ark",
      data: QAIROS_INTERFACES.ark.encodeFunctionData("commit", [commitment]),
    });
  };

  const prepareVaultDeposit = () => {
    try {
      const amount = parseEther(depositAmount);
      if (amount <= 0n) throw new Error("Сумма должна быть больше нуля.");
      void prepareTransaction({
        title: "Внести ETH в Qairos Vault",
        functionName: "QairosVault.deposit()",
        contract: "vault",
        data: QAIROS_INTERFACES.vault.encodeFunctionData("deposit"),
        value: amount,
      });
    } catch (error) {
      setNotice(
        error instanceof Error
          ? error.message
          : "Введите корректную сумму ETH.",
      );
    }
  };

  const prepareVaultWithdraw = () => {
    try {
      const amount = parseEther(withdrawAmount);
      if (amount <= 0n) throw new Error("Сумма должна быть больше нуля.");
      void prepareTransaction({
        title: "Вывести ETH из Qairos Vault",
        functionName: "QairosVault.withdraw(uint256)",
        contract: "vault",
        data: QAIROS_INTERFACES.vault.encodeFunctionData("withdraw", [amount]),
      });
    } catch (error) {
      setNotice(
        error instanceof Error
          ? error.message
          : "Введите корректную сумму ETH.",
      );
    }
  };

  const prepareMarketBuy = (marketId: number, yes: boolean) => {
    if (live.phase !== "live") {
      setNotice("Нет свежего снимка Mainnet. Транзакция не подготовлена.");
      return;
    }
    const market = live.snapshot.markets.find((item) => item.id === marketId);
    if (!market || market.settled || market.deadline * 1000 <= Date.now()) {
      setNotice("Этот рынок закрыт или данные устарели.");
      return;
    }
    try {
      const amount = parseEther(marketStake);
      if (amount <= 0n) throw new Error("Ставка должна быть больше нуля.");
      void prepareTransaction({
        title: `Позиция ${yes ? "ДА" : "НЕТ"} · рынок ${marketId}`,
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
          : "Введите корректную сумму ETH.",
      );
    }
  };

  const prepareInsurance = async () => {
    if (!wallet.provider || wallet.chainId !== MAINNET_CHAIN_ID) {
      setNotice("Подключите кошелек к Ethereum Mainnet.");
      return;
    }
    try {
      const coverage = parseEther(insuranceCoverage);
      const years = Number(insuranceYears);
      if (coverage <= 0n || !Number.isInteger(years) || years < 1 || years > 5)
        throw new Error("Укажите покрытие больше нуля и срок от 1 до 5 лет.");
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
        title: "Оформить полис Qairos Insurance",
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
          : "Не удалось рассчитать премию.",
      );
    }
  };

  const prepareRecoveryCommit = async () => {
    if (!recoveryKit || !isAddress(recoveryDestination)) {
      setNotice(
        "Загрузите корректный recovery kit и укажите адрес назначения.",
      );
      return;
    }
    if (wallet.account?.toLowerCase() !== recoveryKit.account.toLowerCase()) {
      setNotice("Подключите аккаунт, указанный в recovery kit.");
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
        title: "Шаг 1 из 2 · зафиксировать восстановление",
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
          : "Не удалось подготовить восстановление.",
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
        "Для второго шага дождитесь следующего подтвержденного блока после commitment.",
      );
      return;
    }
    void prepareTransaction({
      title: "Шаг 2 из 2 · восстановить средства",
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

  const connectWallet = async (provider: DiscoveredWallet) => {
    try {
      await wallet.connect(provider);
      setWalletOpen(false);
    } catch {
      /* WalletProvider exposes a localized status. */
    }
  };

  const renderTool = () => {
    if (activeTool === "ark")
      return (
        <div className="tool-body">
          <div className="tool-heading">
            <p className="eyebrow">ЗАЩИТА · QAIROS ARK</p>
            <h3>Подготовьте доказательство владения</h3>
            <p>
              ML-DSA-44 генерируется локально. Приватный ключ остаётся в памяти
              вкладки и не отправляется в сеть.
            </p>
          </div>
          <div className="tool-actions">
            <button
              className="button button-primary"
              disabled={keyBusy}
              onClick={() => void generateKey()}
            >
              {keyBusy
                ? "Создаём ключ…"
                : keys
                  ? "Создать новый ключ"
                  : "Создать ML-DSA-44 ключ"}
            </button>
            <button
              className="button"
              disabled={!keys}
              onClick={bindArkCommitment}
            >
              Рассчитать commitment
            </button>
            <button
              className="button"
              disabled={!commitment}
              onClick={saveRecoveryKit}
            >
              Скачать recovery kit
            </button>
          </div>
          {keys && (
            <div className="data-grid">
              <div>
                <span>Параметр</span>
                <b>ML-DSA-44 · FIPS 204</b>
              </div>
              <div>
                <span>Публичный ключ</span>
                <b>{keys.publicKey.length.toLocaleString("en-US")} bytes</b>
              </div>
              <div>
                <span>Секретный ключ</span>
                <b>Только в памяти</b>
              </div>
              <div>
                <span>Энтропия</span>
                <b>{keys.entropy}</b>
              </div>
              <div className="wide">
                <span>Commitment</span>
                <code>
                  {commitment || "Сначала рассчитайте для активного адреса"}
                </code>
              </div>
              <div className="wide">
                <span>Аккаунт</span>
                <code>
                  {keyAccount || wallet.account || "Подключите кошелек"}
                </code>
              </div>
            </div>
          )}
          {commitment && (
            <div className="warning-line">
              Recovery kit даёт возможность предъявить pre-Moment commitment.
              Храните файл офлайн и не передавайте его посторонним.
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
            Проверить и подготовить регистрацию
          </button>
        </div>
      );

    if (activeTool === "recover")
      return (
        <div className="tool-body">
          <div className="tool-heading">
            <p className="eyebrow">ЗАЩИТА · ВОССТАНОВЛЕНИЕ</p>
            <h3>Восстановление в два шага</h3>
            <p>
              Выберите локальный recovery kit. Файл проверяется в браузере; он
              не загружается на сервер.
            </p>
          </div>
          <label className="field-label" htmlFor="kit-file">
            Файл recovery kit (.json)
          </label>
          <input
            id="kit-file"
            className="file-input"
            type="file"
            accept="application/json,.json"
            onChange={(event) => void loadRecoveryKit(event.target.files?.[0])}
          />
          {recoveryKit && (
            <div className="data-grid">
              <div>
                <span>Аккаунт</span>
                <b>{shortAddress(recoveryKit.account)}</b>
              </div>
              <div>
                <span>Схема</span>
                <b>{recoveryKit.scheme}</b>
              </div>
              <div className="wide">
                <span>Commitment</span>
                <code>{recoveryKit.commitment}</code>
              </div>
            </div>
          )}
          <label className="field-label" htmlFor="recovery-destination">
            Новый адрес назначения
          </label>
          <input
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
              Проверить и подготовить шаг 1
            </button>
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
              Подготовить шаг 2
            </button>
          </div>
          {recoveryCommitBlock && (
            <p className="mono small-note">
              Commitment: блок {recoveryCommitBlock} · текущий блок{" "}
              {currentBlock ?? "—"}. Шаг 2 доступен после следующего блока и
              только при выполнении условий контракта.
            </p>
          )}
        </div>
      );

    if (activeTool === "signer")
      return (
        <div className="tool-body">
          <div className="tool-heading">
            <p className="eyebrow">ЗАЩИТА · PQ SIGNER</p>
            <h3>Подпишите сообщение постквантовым ключом</h3>
            <p>
              Используется тот же ключ из Ark. Подпись считается локально и не
              равна подписи Ethereum-кошелька.
            </p>
          </div>
          <label className="field-label" htmlFor="pq-message">
            Сообщение
          </label>
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
                setSignatureResult("Подпись создана в этой вкладке.");
              }}
            >
              Создать подпись
            </button>
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
                    ? "Подпись действительна для этого сообщения."
                    : "Подпись не совпадает с сообщением или ключом.",
                );
              }}
            >
              Проверить подпись
            </button>
          </div>
          {signature && (
            <div className="data-grid">
              <div>
                <span>Размер подписи</span>
                <b>{signature.length.toLocaleString("en-US")} bytes</b>
              </div>
              <div>
                <span>Результат проверки</span>
                <b>{signatureResult || "Ожидает проверки"}</b>
              </div>
              <div className="wide">
                <span>Подпись · hex</span>
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
            <p className="eyebrow">ЗАЩИТА · QAIROS VAULT</p>
            <h3>Баланс и операции хранилища</h3>
            <p>
              Баланс читается через подключенный Mainnet provider. Перед записью
              будет симуляция, оценка газа и отдельное подтверждение в кошельке.
            </p>
          </div>
          <div className="vault-balance">
            <span>Ваш баланс в Vault</span>
            <b>{vaultBalance} ETH</b>
          </div>
          <div className="form-grid">
            <label>
              <span>Внести ETH</span>
              <input
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
              Подготовить депозит
            </button>
            <label>
              <span>Вывести ETH</span>
              <input
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
              Подготовить вывод
            </button>
          </div>
          {statusData?.vaultBreakerTripped && (
            <div className="warning-line">
              Breaker активен. Контракт может отклонить вывод; симуляция
              проверит это до отправки.
            </div>
          )}
        </div>
      );

    if (activeTool === "markets")
      return (
        <div className="tool-body">
          <div className="tool-heading">
            <p className="eyebrow">РЫНКИ · ETHEREUM MAINNET</p>
            <h3>Публичные прогнозы</h3>
            <p>
              Пулы считываются из проверенного live status API. Это реальные
              Mainnet позиции, а не бумажная симуляция.
            </p>
          </div>
          <label className="field-label" htmlFor="market-stake">
            Размер позиции в ETH
          </label>
          <input
            id="market-stake"
            className="text-input amount-input"
            inputMode="decimal"
            value={marketStake}
            onChange={(event) => setMarketStake(event.target.value)}
          />
          {live.phase !== "live" ? (
            <p className="warning-line">
              Нет свежего снимка рынка. Торговые действия отключены.
            </p>
          ) : (
            <div className="market-list">
              {markets.map((market) => (
                <article className="market-row" key={market.id}>
                  <div>
                    <b>
                      Рынок {market.id} · {market.bits} бит
                    </b>
                    <span>
                      До {formatDate(market.deadline)} · пул ДА{" "}
                      {formatEtherSafe(market.yesPoolWei)} ETH / НЕТ{" "}
                      {formatEtherSafe(market.noPoolWei)} ETH
                    </span>
                  </div>
                  <div className="market-actions">
                    <button
                      className="button button-primary"
                      disabled={market.settled || sending}
                      onClick={() => prepareMarketBuy(market.id, true)}
                    >
                      Да
                    </button>
                    <button
                      className="button"
                      disabled={market.settled || sending}
                      onClick={() => prepareMarketBuy(market.id, false)}
                    >
                      Нет
                    </button>
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
            <p className="eyebrow">РЫНКИ · QAIROS INSURANCE</p>
            <h3>Рассчитайте покрытие</h3>
            <p>
              Котировка читается из контракта; покупка полиса потребует явного
              review и подтверждения в кошельке.
            </p>
          </div>
          <div className="form-grid">
            <label>
              <span>Покрытие в ETH</span>
              <input
                className="text-input"
                inputMode="decimal"
                value={insuranceCoverage}
                onChange={(event) => setInsuranceCoverage(event.target.value)}
              />
            </label>
            <label>
              <span>Срок, лет</span>
              <select
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
              Рассчитать и проверить полис
            </button>
            {insuranceQuote && (
              <span className="quote-value">Премия: {insuranceQuote} ETH</span>
            )}
          </div>
          <p className="small-note">
            Свободный капитал по API:{" "}
            {statusData
              ? formatEtherSafe(statusData.insuranceFreeCapitalWei)
              : "—"}{" "}
            ETH. Если средств в пуле недостаточно, контракт отклонит операцию на
            симуляции.
          </p>
        </div>
      );

    if (activeTool === "guard")
      return (
        <div className="tool-body">
          <div className="tool-heading">
            <p className="eyebrow">РАЗРАБОТЧИКАМ · QAIROSGUARD</p>
            <h3>Соберите исходный шаблон</h3>
            <p>
              Файл генерируется локально. Его необходимо проверить, покрыть
              тестами и независимо аудитировать до deployment.
            </p>
          </div>
          <div className="form-grid">
            <label>
              <span>Имя контракта</span>
              <input
                className="text-input"
                value={guardName}
                maxLength={48}
                onChange={(event) =>
                  setGuardName(event.target.value.replace(/[^a-zA-Z0-9_]/g, ""))
                }
              />
            </label>
            <label>
              <span>Уровень срабатывания</span>
              <input
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
            Скачать Solidity
          </button>
        </div>
      );

    if (activeTool === "canary")
      return (
        <div className="tool-body">
          <div className="tool-heading">
            <p className="eyebrow">МОНИТОР · QAIROS CANARY</p>
            <h3>Криптографическая лестница</h3>
            <p>
              Статус каждой ступени взят из последнего проверенного Mainnet
              snapshot.
            </p>
          </div>
          {live.phase !== "live" ? (
            <p className="warning-line">
              Нет актуального снимка. Статус ступеней неизвестен.
            </p>
          ) : (
            <div className="rung-list">
              {live.snapshot.rungs.map((rung) => (
                <div className="rung-row" key={rung.id}>
                  <b>{String(rung.bits).padStart(3, "0")} бит</b>
                  <span>{rung.armed ? "Вооружена" : "Учебная"}</span>
                  <span>{rung.broken ? "Решена" : "Цела"}</span>
                  <span>{formatEtherSafe(rung.bountyWei)} ETH</span>
                </div>
              ))}
            </div>
          )}
          <p className="small-note">
            Учебный решатель в этой сборке не подменяет доказательство
            криптографического взлома. Отправка canary claim доступна только
            после подготовки проверяемого решения.
          </p>
        </div>
      );

    return (
      <div className="tool-body">
        <div className="tool-heading">
          <p className="eyebrow">ETHEREUM MAINNET · READ-ONLY</p>
          <h3>Сигнал и рекомендуемое действие</h3>
          <p>
            Панель обновляет snapshot каждые 30 секунд. При отсутствии или
            устаревании данных уровень не подменяется безопасным значением.
          </p>
        </div>
        <div className="threat-scale" aria-label="Уровни угрозы">
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
          <span>РЕКОМЕНДУЕМЫЙ ПУТЬ</span>
          <p>
            {!statusData
              ? "Нет проверенного сигнала. Не делайте предположений о безопасности."
              : statusData.threatLevel === 0
                ? "Продолжайте мониторинг. Заранее проверьте доступ к восстановлению и сохранность recovery kit."
                : statusData.threatLevel < 3
                  ? "Проверьте открытые ключи, адреса и готовность восстановления. Не полагайтесь на один источник данных."
                  : "Критический сигнал. Приостановите чувствительные операции и согласуйте действия с командой безопасности."}
          </p>
        </div>
      </div>
    );
  };

  const currentTool = toolList.find(([id]) => id === activeTool) || toolList[0];

  return (
    <EnglishContent>
    <main>
      <header className="site-header">
        <nav className="nav-shell" aria-label="Главная навигация">
          <a className="brand" href="#overview">
            <span className="orbit-mark" aria-hidden="true" />
            QAIROS
          </a>
          <div className="nav-links">
            <a href="#how">Принцип работы</a>
            <a href="#tools">Инструменты</a>
            <a href="#content">Публикации</a>
            <a href="#technology">Технологии</a>
            <a href="#faq">FAQ</a>
          </div>
          <div className="header-actions">
            <button
              className="icon-button theme-button"
              title={
                theme === "light"
                  ? "Включить тёмную тему"
                  : "Включить светлую тему"
              }
              aria-label={
                theme === "light"
                  ? "Включить тёмную тему"
                  : "Включить светлую тему"
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
                : "Подключить кошелек"}
            </button>
          </div>
        </nav>
        <div className="mobile-nav">
          <a href="#how">Принцип</a>
          <a href="#tools">Инструменты</a>
          <a href="#content">Посты</a>
          <a href="#faq">FAQ</a>
        </div>
      </header>

      <div className="page-shell">
        {notice && (
          <div className="notice" role="status">
            <span>{notice}</span>
            <button
              className="notice-close"
              aria-label="Закрыть уведомление"
              onClick={() => setNotice("")}
            >
              ×
            </button>
          </div>
        )}

        <section className="hero-grid" id="overview">
          <div className="hero-copy">
            <p className="eyebrow">QRS-01 // КВАНТОВОЕ РАННЕЕ ПРЕДУПРЕЖДЕНИЕ</p>
            <h1>
              Подготовьтесь к <span>моменту Qairos.</span>
            </h1>
            <p className="hero-lead">
              Слой раннего предупреждения и защиты для Ethereum. Следите за
              сигналом, подготовьте действия и сохраните контроль над ключами.
            </p>
            <div className="hero-actions">
              <a className="button button-primary" href="#console">
                Открыть панель
              </a>
              <a className="button" href="#how">
                Как это работает <span aria-hidden="true">↘</span>
              </a>
            </div>
            <div className="contract-line">
              <div>
                <span className="eyebrow">$QRS · АДРЕС КОНТРАКТА</span>
                <code>{QAIROS_ADDRESSES.oracle}</code>
              </div>
              <button
                className="button button-small"
                onClick={() =>
                  void navigator.clipboard
                    .writeText(QAIROS_ADDRESSES.oracle)
                    .then(
                      () => setNotice("Адрес QairosOracle скопирован."),
                      () => setNotice("Буфер обмена недоступен."),
                    )
                }
              >
                Копировать
              </button>
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
                <span>КЛАССИФИКАЦИЯ</span>
                <b>ОТКРЫТЫЙ КОД / MIT</b>
              </div>
              <div>
                <span>ДОКУМЕНТ</span>
                <b>QRS-01-2026-10-C</b>
              </div>
              <div>
                <span>СЕТЬ</span>
                <b>Ethereum Mainnet · chain 1</b>
              </div>
              <div>
                <span>ПОСЛЕДНИЙ СНИМОК</span>
                <b>{statusData ? formatDate(statusData.observedAtUtc) : "—"}</b>
              </div>
            </div>
            <div className={`live-panel ${threatClass}`}>
              <div>
                <span className="eyebrow">
                  {live.phase === "live"
                    ? `MAINNET · BLOCK ${statusData!.blockNumber.toLocaleString("en-US")}`
                    : live.phase === "loading"
                      ? "ПОДКЛЮЧАЕМСЯ К MAINNET"
                      : "СИГНАЛ НЕИЗВЕСТЕН"}
                </span>
                <div className="live-level">
                  {statusData
                    ? `${String(statusData.threatLevel).padStart(2, "0")} / 05`
                    : "— / 05"}
                </div>
                <b>
                  {statusData
                    ? [
                        "НОМИНАЛЬНО",
                        "НАБЛЮДЕНИЕ",
                        "НАБЛЮДЕНИЕ",
                        "КРИТИЧЕСКИЙ",
                        "КРИТИЧЕСКИЙ",
                        "КРИТИЧЕСКИЙ",
                      ][statusData.threatLevel]
                    : "НЕТ ДАННЫХ"}
                </b>
                <p>
                  {live.phase === "live"
                    ? `${statusData!.rungCount} ступеней · ${statusData!.marketCount} рынка · ${statusData!.contracts.filter((item) => item.deployed).length}/6 контрактов`
                    : live.phase === "loading"
                      ? "Получаем подтвержденный снимок"
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
                  ? "Данные актуальны"
                  : live.phase === "loading"
                    ? "Загрузка"
                    : "Данные недоступны"}
              </span>
              <span>Автообновление · 30 сек.</span>
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
                {statusRefreshing ? "Проверяем Mainnet…" : "Обновить сейчас"}
              </button>
            </div>
          </div>
        </section>

        <section className="metrics-strip" aria-label="Показатели Mainnet">
          <div>
            <b>
              {statusData
                ? `${statusData.rungs.filter((rung) => rung.armed && !rung.broken).length}/${armedRungs.length || 5}`
                : "—"}
            </b>
            <span>вооружённых ступеней целы</span>
          </div>
          <div>
            <b>{statusData ? statusData.markets.length : "—"}</b>
            <span>рынка прогнозов</span>
          </div>
          <div>
            <b>
              {statusData
                ? statusData.contracts.filter((item) => item.deployed).length
                : "—"}
              /6
            </b>
            <span>контрактов развернуто</span>
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
              {wallet.connected ? wallet.walletName : "кошелек не подключен"}
            </span>
          </div>
        </section>

        <section className="console-section" id="console">
          <div className="section-heading">
            <div>
              <p className="eyebrow">РАБОЧАЯ ПАНЕЛЬ · ЭФИРИУМ</p>
              <h2>Один сигнал. Понятный следующий шаг.</h2>
            </div>
            <p>
              Чтение состояния доступно без кошелька. Записи в Mainnet требуют
              аутентифицированной сессии и подтверждения в кошельке.
            </p>
          </div>
          <div className="console-frame">
            <aside className="tool-nav" aria-label="Инструменты Qairos">
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
                      : `СЕТЬ ${wallet.chainId}`
                    : "БЕЗ КОШЕЛЬКА"}
                </span>
              </div>
              {renderTool()}
            </section>
          </div>
          <div className="compliance-note">
            <b>Безопасность операций</b>
            <span>
              Все записи требуют совпадения сессии и активного аккаунта,
              Mainnet, успешной симуляции, оценки газа и отдельного
              подтверждения в кошельке. Исходные контракты экспериментальные и
              не проходили независимый аудит.
            </span>
          </div>
        </section>

        <section id="how" className="steps-section">
          <div className="section-heading">
            <div>
              <p className="eyebrow">ПРИНЦИП РАБОТЫ</p>
              <h2>Сначала датчик. Затем защита.</h2>
            </div>
            <p>
              Публичные криптографические испытания формируют наблюдаемый
              сигнал. Владельцы и протоколы заранее выбирают свои действия.
            </p>
          </div>
          <div className="steps-grid">
            {[
              [
                "01",
                "Canary",
                "Криптографические испытания дают публичный сигнал о возможностях атакующего.",
              ],
              [
                "02",
                "Oracle",
                "Подтвержденное решение вооруженной ступени повышает уровень угрозы в контракте.",
              ],
              [
                "03",
                "Guard",
                "Защищенные контракты ограничивают чувствительные действия при заданном пороге.",
              ],
              [
                "04",
                "Ark",
                "Заранее сохраненное доказательство позволяет подготовить путь восстановления.",
              ],
              [
                "05",
                "Рынки",
                "Прогнозы и страхование используют общий сигнал Oracle.",
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
              <p className="eyebrow">ИНСТРУМЕНТЫ</p>
              <h2>Семь модулей. Одна система.</h2>
            </div>
            <p>
              Откройте модуль в панели: читайте живые данные, готовьте ключи и
              проверяйте операции до подписи.
            </p>
          </div>
          <div className="module-grid">
            {toolList.map(([id, name, description], index) => (
              <button
                className="module-card"
                key={id}
                onClick={() => {
                  setActiveTool(id);
                  document
                    .getElementById("console")
                    ?.scrollIntoView({ behavior: "smooth" });
                }}
              >
                <span className="eyebrow">
                  {String(index + 1).padStart(2, "0")} /{" "}
                  {index < 3 ? "ЗАЩИТА" : "МОНИТОРИНГ"}
                </span>
                <b>{name}</b>
                <p>{description}</p>
                <span className="module-link">ОТКРЫТЬ МОДУЛЬ ↗</span>
              </button>
            ))}
          </div>
        </section>

        <section className="social-section" id="content">
          <div className="section-heading">
            <div>
              <p className="eyebrow">КОНТЕНТ-ПАКЕТ · 12 ПУБЛИКАЦИЙ</p>
              <h2>Двенадцать идей. Двенадцать разных баннеров.</h2>
            </div>
            <p>
              Текст копируется отдельно. PNG размером 1200 × 675 создаётся в
              браузере и скачивается по запросу.
            </p>
          </div>
          <div className="post-grid">
            {posts.map((post, index) => (
              <article className="post-card" key={post.title}>
                <BannerArtwork post={post} index={index} />
                <p>{post.text}</p>
                <div className="post-actions">
                  <button
                    className="button button-small"
                    onClick={() => void copyPost(post)}
                  >
                    Копировать текст
                  </button>
                  <button
                    className="button button-small"
                    onClick={() => exportPost(index)}
                  >
                    Скачать PNG
                  </button>
                </div>
              </article>
            ))}
          </div>
        </section>

        <section className="usecase-section">
          <p className="eyebrow">ДЛЯ ТЕХ, КТО КОНТРОЛИРУЕТ КЛЮЧИ</p>
          <h2>От личного кошелька до казначейства протокола.</h2>
          <div className="usecase-grid">
            {[
              [
                "ДОЛГОСРОЧНЫЕ ВЛАДЕЛЬЦЫ",
                "Подготовьте независимый путь восстановления для аккаунтов с опубликованным ключом.",
              ],
              [
                "DAO-КАЗНАЧЕЙСТВА",
                "Определите, как чувствительные операции реагируют на рост риска.",
              ],
              [
                "DEFI-ПРОТОКОЛЫ",
                "Планируйте остановку опасных маршрутов по публичному сигналу.",
              ],
              [
                "КАСТОДИАНЫ",
                "Отслеживайте открытые ключи и документируйте готовность восстановления.",
              ],
              [
                "ИССЛЕДОВАТЕЛИ",
                "Изучайте публичные задачи и публикуйте воспроизводимые результаты.",
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
              <p className="eyebrow">ТЕХНОЛОГИИ</p>
              <h2>Стандарты вместо обещаний.</h2>
            </div>
            <p>Открытые спецификации и исходники можно проверять независимо.</p>
          </div>
          <div className="tech-table-wrap">
            <table className="tech-table">
              <thead>
                <tr>
                  <th>Компонент</th>
                  <th>Назначение</th>
                  <th>Источник</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>ML-DSA-44</td>
                  <td>Постквантовые ключи и подписи</td>
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
                  <td>Кривые лестницы Canary</td>
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
                  <td>Commitments и события</td>
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
                  <td>Официальные адреса Mainnet и Solidity-контракты</td>
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
            Код и контракты не прошли независимый аудит. Мониторинг не делает
            обычные EVM-подписи постквантовыми.
          </p>
        </section>

        <section className="roadmap-section">
          <p className="eyebrow">ДОРОЖНАЯ КАРТА</p>
          <h2>От прототипа к L1.</h2>
          <div className="roadmap-grid">
            {[
              [
                "ЭТАП 1 · ГОТОВО",
                "Прототип",
                "Контракты, тесты и локальный запуск.",
              ],
              [
                "ЭТАП 2",
                "Sepolia",
                "Публичный тестнет, учебные bounty и кошелек.",
              ],
              [
                "ЭТАП 3",
                "Независимый аудит",
                "Проверка контрактов и математики кривых.",
              ],
              ["ЭТАП 4", "Ethereum Mainnet", "Развертывание и запуск рынков."],
              [
                "ЭТАП 5",
                "PQ-кошельки",
                "Постквантовая проверка через account abstraction.",
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
            <p className="eyebrow">ВОПРОСЫ И ОТВЕТЫ</p>
            <h2>Коротко о важном.</h2>
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
            <h2>Будьте готовы до момента Qairos.</h2>
            <p>
              Подготовьте recovery kit и проверьте действия до того, как сигнал
              станет критическим.
            </p>
          </div>
          <a href="#console" className="button button-primary">
            Открыть панель ↗
          </a>
        </section>
      </div>

      <footer className="site-footer">
        <div className="footer-main">
          <a className="brand" href="#overview">
            <span className="orbit-mark" aria-hidden="true" />
            QAIROS
          </a>
          <p>
            Раннее предупреждение и инструменты постквантовой готовности для
            Ethereum.
          </p>
          <span className="eyebrow">QRS-01 · MIT · 2026</span>
        </div>
        <div className="footer-links">
          <a href="#console">Панель</a>
          <a href="#tools">Инструменты</a>
          <a href="#content">Публикации</a>
          <a href="#technology">Технологии</a>
          <a
            href="https://github.com/Qairos-app"
            target="_blank"
            rel="noreferrer"
          >
            Исходный код ↗
          </a>
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
              {wallet.connected ? "Ваш кошелек" : "Подключить кошелек"}
            </h2>
          </div>
          <button
            className="icon-button"
            aria-label="Закрыть"
            onClick={() => setWalletOpen(false)}
          >
            ×
          </button>
        </header>
        <div className="dialog-content">
          {wallet.connected ? (
            <>
              <div className="wallet-details">
                <span>Провайдер</span>
                <b>{wallet.walletName}</b>
                <span>Аккаунт</span>
                <code>{wallet.account}</code>
                <span>Сеть</span>
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
                  Переключить на Ethereum Mainnet
                </button>
              )}
              <div className="session-box">
                <span>Сессия Qairos</span>
                <b>
                  {sessionReady
                    ? `Выполнен вход · до ${formatDate(walletSession!.expiresAt)}`
                    : "Не выполнен вход"}
                </b>
                {sessionReady ? (
                  <button
                    className="button button-small"
                    onClick={() => void signOut()}
                  >
                    Выйти
                  </button>
                ) : (
                  <button
                    className="button button-primary button-small"
                    disabled={authBusy || wallet.chainId !== 1}
                    onClick={() => void signIn()}
                  >
                    {authBusy ? "Подписываем…" : "Войти без газа"}
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
                Забыть кошелек на этом сайте
              </button>
            </>
          ) : (
            <>
              <p className="dialog-intro">
                Выберите обнаруженный браузерный кошелек. Запрос аккаунта будет
                показан только после вашего клика.
              </p>
              {process.env.NEXT_PUBLIC_PRIVY_APP_ID && (
                <div className="privy-connect-wrap">
                  <PrivyWalletConnect
                    onStart={() => setWalletOpen(false)}
                    onConnected={() => setWalletOpen(false)}
                  />
                  <p className="small-note">
                    Privy откроет собственное окно подключения. Разрешение на
                    доступ к адресу запрашивается в кошельке.
                  </p>
                </div>
              )}
              {wallet.wallets.length ? (
                <div className="wallet-options">
                  {wallet.wallets.map((provider) => (
                    <button
                      key={provider.id}
                      disabled={wallet.busy}
                      onClick={() => void connectWallet(provider)}
                    >
                      {provider.icon ? (
                        <img src={provider.icon} alt="" />
                      ) : (
                        <span className="wallet-glyph">◈</span>
                      )}
                      <span>
                        <b>{provider.name}</b>
                        <small>EIP-1193 · встроенный кошелек</small>
                      </span>
                      <span aria-hidden="true">↗</span>
                    </button>
                  ))}
                </div>
              ) : (
                <div className="empty-wallets">
                  <b>Браузерные кошельки не обнаружены</b>
                  <p>
                    На компьютере установите MetaMask, Rabby, Coinbase Wallet,
                    Brave, Trust или OKX. На телефоне откройте сайт во
                    встроенном браузере wallet-приложения.
                  </p>
                  <div className="install-links">
                    <a
                      href="https://metamask.io/download/"
                      target="_blank"
                      rel="noreferrer"
                    >
                      MetaMask ↗
                    </a>
                    <a
                      href="https://rabby.io/"
                      target="_blank"
                      rel="noreferrer"
                    >
                      Rabby ↗
                    </a>
                    <a
                      href="https://www.coinbase.com/wallet"
                      target="_blank"
                      rel="noreferrer"
                    >
                      Coinbase ↗
                    </a>
                  </div>
                </div>
              )}
              <p className="small-note">
                QR / WalletConnect не активирован в официальной конфигурации
                Qairos. Сайт не предлагает фиктивное QR-подключение.
              </p>
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
                <p className="eyebrow">ПРОВЕРКА ПЕРЕД ОТПРАВКОЙ</p>
                <h2 id="review-title">{review.title}</h2>
              </div>
              <button
                className="icon-button"
                disabled={sending}
                aria-label="Закрыть"
                onClick={() => setReview(null)}
              >
                ×
              </button>
            </header>
            <div className="dialog-content">
              <div className="wallet-details">
                <span>Сеть</span>
                <b>Ethereum Mainnet · chain 1</b>
                <span>Контракт</span>
                <code>{review.to}</code>
                <span>Метод</span>
                <b>{review.functionName}</b>
                <span>Отправитель</span>
                <code>{review.from}</code>
                <span>Значение</span>
                <b>{formatEtherSafe(review.value)} ETH</b>
                <span>Лимит газа</span>
                <b>{review.gasLimit.toLocaleString("en-US")}</b>
                <span>Оценка комиссии</span>
                <b>
                  до {formatEtherSafe(review.gasLimit * review.gasPrice)} ETH
                </b>
              </div>
              <details className="calldata-details">
                <summary>Показать calldata</summary>
                <code>{review.data}</code>
              </details>
              <label className="review-ack">
                <input
                  type="checkbox"
                  checked={reviewChecked}
                  onChange={(event) => setReviewChecked(event.target.checked)}
                />
                <span>
                  Я проверил сеть, адрес контракта, функцию, сумму и адрес
                  отправителя.
                </span>
              </label>
              <div className="dialog-actions">
                <button
                  className="button"
                  disabled={sending}
                  onClick={() => setReview(null)}
                >
                  Отмена
                </button>
                <button
                  className="button button-primary"
                  disabled={!reviewChecked || sending}
                  onClick={() => void confirmTransaction()}
                >
                  {sending
                    ? "Ожидаем подтверждение…"
                    : "Подтвердить в кошельке"}
                </button>
              </div>
              <p className="small-note">
                Перед отправкой симуляция и оценка газа будут выполнены
                повторно. Транзакцию окончательно подтверждает только ваш
                кошелек.
              </p>
            </div>
          </>
        )}
      </dialog>
    </main>
    </EnglishContent>
  );
}
