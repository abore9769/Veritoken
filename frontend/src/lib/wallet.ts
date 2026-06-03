import {
  isConnected,
  getAddress,
  signTransaction,
  setAllowed,
} from "@stellar/freighter-api";
import { create } from "zustand";
import type { WalletState } from "../types";

interface WalletStore extends WalletState {
  connect: () => Promise<void>;
  disconnect: () => void;
  signTx: (xdr: string) => Promise<string>;
}

export const useWallet = create<WalletStore>((set, get) => ({
  address: null,
  network: "TESTNET",
  connected: false,

  connect: async () => {
    const connected = await isConnected();
    if (!connected) {
      await setAllowed();
    }
    const { address } = await getAddress();
    set({ address, connected: true });
  },

  disconnect: () => {
    set({ address: null, connected: false });
  },

  signTx: async (xdr: string) => {
    const { address } = get();
    if (!address) throw new Error("Wallet not connected");
    const result = await signTransaction(xdr, {
      networkPassphrase:
        import.meta.env.VITE_STELLAR_NETWORK === "mainnet"
          ? "Public Global Stellar Network ; September 2015"
          : "Test SDF Network ; September 2015",
    });
    if ("error" in result) throw new Error(result.error);
    return result.signedTxXdr;
  },
}));
