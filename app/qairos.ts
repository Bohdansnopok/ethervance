import { Interface } from "ethers";

export const MAINNET_CHAIN_ID = 1;

export const QAIROS_ADDRESSES = {
  oracle: "0x3039E2c775d37225f6DaAcaaD858A88d6ABBD9D2",
  canary: "0xd16f9099888AA56b328c91B90ca5FeA0531c4B9f",
  ark: "0x41D5FF38ca6a8d185D05306d836D5BE986Ee47d7",
  vault: "0xd207cF263bF288aDd199ca6777b413A68494961a",
  market: "0xeD77cA63F7eCB92F6569d4b6c6F9A8a9CEe139E5",
  insurance: "0x2D90C8ADB951f3f9286ac239ff7e3d641d057902",
} as const;

export const QAIROS_INTERFACES = {
  oracle: new Interface([
    "function threatLevel() view returns (uint8)",
    "function firstBreakTime() view returns (uint64)",
    "function lastBreak() view returns (uint16 bits, uint64 timestamp)",
    "function rungBroken(uint16 bits) view returns (bool)",
  ]),
  canary: new Interface([
    "function rungCount() view returns (uint256)",
    "function rung(uint256 id) view returns (uint16 bits, bool armed, bool broken, address solver, uint64 brokenAt, uint256 bounty, (uint256 p, uint256 a, uint256 b) curve, uint256 gx, uint256 gy, uint256 qx, uint256 qy, string label)",
  ]),
  ark: new Interface([
    "function commit(bytes32 commitment)",
    "function entries(address account) view returns (bytes32 commitment, uint64 committedAt, uint64 blockNumber)",
    "function totalEntries() view returns (uint256)",
  ]),
  vault: new Interface([
    "function deposit() payable",
    "function withdraw(uint256 amount)",
    "function balanceOf(address account) view returns (uint256)",
    "function breakerTripped() view returns (bool)",
    "function recoveryCommitment(address account, address to, bytes pqPublicKey, bytes32 salt) pure returns (bytes32)",
    "function commitRecovery(bytes32 commitment)",
    "function recover(address account, address to, bytes pqPublicKey, bytes32 salt)",
  ]),
  market: new Interface([
    "function buy(uint256 id, bool yes) payable",
    "function marketCount() view returns (uint256)",
  ]),
  insurance: new Interface([
    "function quote(uint256 coverage, uint256 years_) view returns (uint256 premium)",
    "function buyPolicy(uint256 coverage, uint256 years_) payable returns (uint256 id)",
  ]),
} as const;

export type QairosContract = keyof typeof QAIROS_ADDRESSES;
