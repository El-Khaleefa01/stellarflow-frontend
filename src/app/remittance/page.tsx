"use client";

import React, { useState } from "react";
import { FxRateTicker, FxComparisonTable, FiatOnRampModal, SEP38RateChart } from "@/components/remittance";
import { CorridorStatusMap, FxRateTicker, FxComparisonTable, FiatOnRampModal, type RemittanceCorridor } from "@/components/remittance";
import { useOptionalWallet, useOptionalWalletActions } from "@/app/components/providers/WalletProvider";
import { CreditCard, Wallet } from "lucide-react";

export default function RemittancePage() {
  const walletState = useOptionalWallet();
  const walletActions = useOptionalWalletActions();
  const wallet = walletState?.wallet;
  const [isOnRampOpen, setIsOnRampOpen] = useState(false);
  const [selectedCorridor, setSelectedCorridor] = useState<RemittanceCorridor | null>(null);

  const walletAddress = wallet?.publicKey || "";

  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-100 p-6 font-sans">
      <div className="mb-8 border-b border-neutral-800 pb-6 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight bg-gradient-to-r from-white to-neutral-400 bg-clip-text text-transparent">
            Remittance & FX Corridors
          </h1>
          <p className="text-sm text-neutral-400 mt-1">
            Live fiat conversion rates and a fee comparison against traditional money transfer
            operators for StellarFlow&apos;s cross-border remittance corridors.
          </p>
        </div>

        <button
          type="button"
          onClick={() => {
            if (!walletAddress) {
              alert("Please connect your Stellar wallet first to fund your account.");
              return;
            }
            setIsOnRampOpen(true);
          }}
          className="inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl bg-gradient-to-r from-blue-600 to-violet-600 hover:from-blue-500 hover:to-violet-500 text-white font-medium text-sm shadow-lg shadow-blue-500/20 transition-all active:scale-95 shrink-0"
        >
          <CreditCard size={18} />
          <span>Fund Account / Buy Crypto</span>
        </button>
      </div>

      {selectedCorridor && (
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-blue-400/30 bg-blue-400/10 p-4">
          <p className="text-sm text-blue-100">Remittance wizard ready for <strong>{selectedCorridor.destinationCountry}</strong>. Continue to choose funding and payout details.</p>
          <button type="button" onClick={() => setIsOnRampOpen(true)} className="rounded-lg bg-blue-400 px-3 py-2 text-sm font-semibold text-neutral-950 hover:bg-blue-300">Continue transfer</button>
        </div>
      )}

      <div className="mb-6">
        <CorridorStatusMap onCorridorSelect={setSelectedCorridor} />
      </div>

      <div className="grid grid-cols-1 gap-6 xl-grid-cols-3">
        <div className="xl-col-span-1">
          <FxRateTicker />
        </div>
        <div className="xl-col-span-2">
          <FxComparisonTable />
        </div>
      </div>

      <div className="mt-6">
        <SEP38RateChart />
      </div>

      {isOnRampOpen && walletAddress && (
        <FiatOnRampModal
          isOpen={isOnRampOpen}
          onClose={() => setIsOnRampOpen(false)}
          walletAddress={walletAddress}
          assetCode="XLM"
          onRefreshBalance={async () => {
            await walletActions?.refreshWalletState();
          }}
        />
      )}
    </div>
  );
}

