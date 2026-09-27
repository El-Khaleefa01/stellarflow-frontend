"use client";

import React, { useCallback, useMemo, useState } from "react";
import {
  Address,
  Networks,
  Operation,
  TransactionBuilder,
  xdr,
  SorobanRpc,
  scValToNative,
} from "@stellar/stellar-sdk";
import {
  Check,
  Clipboard,
  Code2,
  Copy,
  Loader2,
  Play,
  RefreshCw,
  Terminal,
  X,
} from "lucide-react";

const DEFAULT_RPC_URL = "https://soroban-testnet.stellar.org";
const DEFAULT_NETWORK_PASSPHRASE = Networks.TESTNET;
export interface ExecutionBytecodeInspectorProps {
  /** Raw proposal XDR. Supports base64 or 0x-prefixed hex. */
  xdr: string;
  /** Optional source account used when rebuilding an InvokeContractArgs payload for simulation. */
  sourceAddress?: string;
  /** Soroban RPC endpoint used for dry-run simulation. */
  rpcUrl?: string;
  /** Network passphrase used when decoding/building transactions. */
  networkPassphrase?: string;
  className?: string;
}

export interface DecodedExecutionCall {
  contractAddress: string;
  functionName: string;
  args: unknown[];
  argsXdr: string[];
  source: "transaction" | "invokeContractArgs" | "hostFunction";
  xdrFormat: "base64" | "hex";
}

interface SimulationTrace {
  status: "success" | "error";
  durationMs: number;
  latestLedger?: number;
  result?: unknown;
  returnValue?: unknown;
  cost?: unknown;
  minResourceFee?: string;
  events: unknown[];
  auth: unknown[];
  transactionData?: string;
  error?: string;
}

function getXdrDecoder(typeName: string) {
  const decoder = (xdr as unknown as Record<string, { fromXDR?: (value: string, format: string) => unknown }>)[typeName];
  if (!decoder?.fromXDR) throw new Error(`Unsupported XDR type: ${typeName}`);
  return decoder.fromXDR;
}

function detectEncoding(value: string): "base64" | "hex" {
  const trimmed = value.trim();
  if (/^(0x)?[0-9a-f]+$/i.test(trimmed) && trimmed.replace(/^0x/i, "").length % 2 === 0) {
    return "hex";
  }
  return "base64";
}

function decodeXdrObject<T>(typeName: string, raw: string): T {
  const trimmed = raw.trim().replace(/^0x/i, "");
  const format = detectEncoding(raw);
  return getXdrDecoder(typeName)(trimmed, format) as T;
}

function scValToJson(value: unknown): unknown {
  try {
    return scValToNative(value as never);
  } catch {
    const candidate = value as { toJson?: () => unknown };
    return candidate?.toJson ? candidate.toJson() : String(value);
  }
}

function jsonReplacer(_key: string, value: unknown): unknown {
  if (typeof value === "bigint") return `${value}n`;
  if (value instanceof Uint8Array) {
    return `0x${Array.from(value).map((byte) => byte.toString(16).padStart(2, "0")).join("")}`;
  }
  if (value instanceof Map) return Object.fromEntries(value);
  return value;
}

function safeJson(value: unknown): string {
  return JSON.stringify(value, jsonReplacer, 2);
}

function addressFromScAddress(scAddress: xdr.ScAddress): string {
  return Address.fromScAddress(scAddress).toString();
}

function decodeInvokeContractArgs(args: xdr.InvokeContractArgs, source: DecodedExecutionCall["source"], xdrFormat: DecodedExecutionCall["xdrFormat"]): DecodedExecutionCall {
  const scArgs = args.args();
  return {
    contractAddress: addressFromScAddress(args.contractAddress()),
    functionName: String(args.functionName()),
    args: scArgs.map(scValToJson),
    argsXdr: scArgs.map((arg) => arg.toXdr("base64")),
    source,
    xdrFormat,
  };
}

function extractInvokeFromTransaction(transaction: unknown, xdrFormat: DecodedExecutionCall["xdrFormat"]): DecodedExecutionCall | null {
  const tx = transaction as { operations?: unknown[] };
  const operations = tx.operations ?? [];

  for (const operation of operations as Array<{ body?: () => unknown }>) {
    const body = operation.body?.() as {
      switch?: () => { name?: string };
      invokeHostFunction?: () => { hostFunction?: () => unknown };
    } | undefined;

    if (body?.switch?.().name !== "invokeHostFunction") continue;

    const hostFunction = body.invokeHostFunction?.()?.hostFunction?.() as {
      switch?: () => { name?: string };
      invokeContract?: () => xdr.InvokeContractArgs;
    } | undefined;

    if (hostFunction?.switch?.().name !== "hostFunctionTypeInvokeContract") continue;

    const invokeArgs = hostFunction.invokeContract?.();
    if (!invokeArgs) continue;
    return decodeInvokeContractArgs(invokeArgs, "transaction", xdrFormat);
  }

  return null;
}

function decodeExecutionXdr(raw: string, networkPassphrase: string): DecodedExecutionCall {
  const xdrFormat = detectEncoding(raw);

  // A complete transaction is the preferred format because it can also be
  // sent directly to Soroban RPC for simulation.
  try {
    const transaction = TransactionBuilder.fromXDR(
      raw.trim().replace(/^0x/i, ""),
      networkPassphrase,
    );
    const decoded = extractInvokeFromTransaction(transaction, xdrFormat);
    if (decoded) return decoded;
  } catch {
    // Continue with the smaller XDR payload formats used by governance data.
  }

  try {
    const invokeArgs = decodeXdrObject<xdr.InvokeContractArgs>("InvokeContractArgs", raw);
    return decodeInvokeContractArgs(invokeArgs, "invokeContractArgs", xdrFormat);
  } catch {
    // Continue with HostFunction.
  }

  try {
    const hostFunction = decodeXdrObject<xdr.HostFunction>("HostFunction", raw);
    if (hostFunction.switch().name !== "hostFunctionTypeInvokeContract") {
      throw new Error("The XDR is not an InvokeContract host function.");
    }
    return decodeInvokeContractArgs(
      hostFunction.invokeContract(),
      "hostFunction",
      xdrFormat,
    );
  } catch {
    throw new Error(
      "Unable to decode the supplied XDR. Expected a Stellar transaction envelope, InvokeContractArgs, or InvokeHostFunction payload.",
    );
  }
}

function highlightJson(value: string): React.ReactNode[] {
  const tokenPattern = /("(?:\\.|[^"\\])*"\s*:)|("(?:\\.|[^"\\])*")|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)|(true|false|null)/g;
  const nodes: React.ReactNode[] = [];
  let cursor = 0;
  let match: RegExpExecArray | null;
  let key = 0;

  while ((match = tokenPattern.exec(value))) {
    if (match.index > cursor) nodes.push(value.slice(cursor, match.index));
    const token = match[0];
    let className = "text-slate-300";
    if (match[1]) className = "text-sky-300";
    else if (match[2]) className = "text-emerald-300";
    else if (match[3]) className = "text-amber-300";
    else if (match[4]) className = "text-violet-300";
    nodes.push(<span key={key++} className={className}>{token}</span>);
    cursor = match.index + token.length;
  }

  if (cursor < value.length) nodes.push(value.slice(cursor));
  return nodes;
}

function formatTraceValue(value: unknown): string {
  if (value === undefined) return "—";
  try {
    return safeJson(value);
  } catch {
    return String(value);
  }
}

export function ExecutionBytecodeInspector({
  xdr: rawXdr,
  sourceAddress,
  rpcUrl = DEFAULT_RPC_URL,
  networkPassphrase = DEFAULT_NETWORK_PASSPHRASE,
  className = "",
}: ExecutionBytecodeInspectorProps) {
  const [copied, setCopied] = useState(false);
  const [simulationOpen, setSimulationOpen] = useState(false);
  const [simulation, setSimulation] = useState<SimulationTrace | null>(null);
  const [isSimulating, setIsSimulating] = useState(false);


  const decodedResult = useMemo(() => {
    if (!rawXdr.trim()) return { decoded: null, error: null as string | null };
    try {
      return { decoded: decodeExecutionXdr(rawXdr), error: null as string | null };
    } catch (error) {
      return {
        decoded: null,
        error: error instanceof Error ? error.message : "XDR decoding failed.",
      };
    }
  }, [networkPassphrase, rawXdr]);

  const decoded = decodedResult.decoded;
  const decodeError = decodedResult.error;



  const handleCopy = useCallback(async () => {
    await navigator.clipboard.writeText(rawXdr);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  }, [rawXdr]);

  const buildSimulationTransaction = useCallback(async () => {
    if (!decoded) throw new Error("There is no decoded contract call to simulate.");

    // A complete transaction can be simulated as-is. This is the preferred
    // path because it preserves the proposal's auth entries and transaction data.
    try {
      const tx = TransactionBuilder.fromXDR(
        rawXdr.trim().replace(/^0x/i, ""),
        networkPassphrase,
      );
      return tx;
    } catch {
      // Governance records commonly store only InvokeContractArgs. In that
      // case, rebuild a minimal transaction from the decoded call when a
      // source account has been supplied.
    }

    if (!sourceAddress) {
      throw new Error(
        "This proposal contains invocation XDR rather than a complete transaction. Provide sourceAddress to build a dry-run transaction.",
      );
    }

    const rpc = new SorobanRpc.Server(rpcUrl);
    const account = await rpc.getAccount(sourceAddress);
    const operation = Operation.invokeContractFunction({
      contract: decoded.contractAddress,
      function: decoded.functionName,
      args: decoded.argsXdr.map((arg) => decodeXdrObject<xdr.ScVal>("ScVal", arg)),
      source: sourceAddress,
    });

    return new TransactionBuilder(account, {
      fee: "100",
      networkPassphrase,
    })
      .setTimeout(30)
      .addOperation(operation)
      .build();
  }, [decoded, networkPassphrase, rawXdr, rpcUrl, sourceAddress]);

  const handleSimulate = useCallback(async () => {
    setSimulationOpen(true);
    setSimulation(null);
    setIsSimulating(true);
    const started = performance.now();

    try {
      const transaction = await buildSimulationTransaction();
      const rpc = new SorobanRpc.Server(rpcUrl);
      const result = await rpc.simulateTransaction(transaction);
      const durationMs = Math.round(performance.now() - started);

      setSimulation({
        status: result.error ? "error" : "success",
        durationMs,
        latestLedger: result.latestLedger,
        result: result.result,
        returnValue: result.result?.retval
          ? scValToJson(result.result.retval)
          : undefined,
        cost: result.cost,
        minResourceFee: result.minResourceFee?.toString(),
        events: result.events ?? [],
        auth: result.result?.auth ?? [],
        transactionData: result.transactionData,
        error: result.error,
      });
    } catch (error) {
      setSimulation({
        status: "error",
        durationMs: Math.round(performance.now() - started),
        events: [],
        auth: [],
        error: error instanceof Error ? error.message : "Simulation failed.",
      });
    } finally {
      setIsSimulating(false);
    }
  }, [buildSimulationTransaction, rpcUrl]);

  const json = decoded
    ? safeJson({
        contractAddress: decoded.contractAddress,
        function: decoded.functionName,
        arguments: decoded.args,
      })
    : "";

  return (
    <>
      <section
        className={`rounded-2xl border border-gray-800 bg-[#0d1117] text-gray-100 shadow-xl ${className}`}
        aria-label="Execution bytecode inspector"
      >
        <header className="flex flex-col gap-3 border-b border-gray-800 p-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            <div className="rounded-lg border border-blue-500/30 bg-blue-500/10 p-2 text-blue-300">
              <Code2 size={18} />
            </div>
            <div>
              <h2 className="text-base font-semibold">Execution Bytecode Inspector</h2>
              <p className="mt-1 text-xs text-gray-500">
                Decode Soroban governance execution XDR without modifying the ledger.
              </p>
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={handleCopy}
              disabled={!rawXdr.trim()}
              className="inline-flex items-center gap-2 rounded-lg border border-gray-700 px-3 py-2 text-xs font-medium text-gray-300 transition-colors hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {copied ? <Check size={14} /> : <Copy size={14} />}
              {copied ? "Copied" : "Copy XDR"}
            </button>
            <button
              type="button"
              onClick={handleSimulate}
              disabled={!decoded || isSimulating}
              className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-3 py-2 text-xs font-semibold text-white transition-colors hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {isSimulating ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />}
              Simulate Execution Dry-Run
            </button>
          </div>
        </header>

        {decodeError ? (
          <div role="alert" className="m-5 rounded-xl border border-rose-500/30 bg-rose-500/10 p-4 text-sm text-rose-300">
            {decodeError}
          </div>
        ) : decoded ? (
          <div className="grid gap-5 p-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
            <div className="space-y-4">
              <Detail label="Target Contract" value={decoded.contractAddress} mono />
              <Detail label="Function Signature" value={decoded.functionName} mono />
              <Detail label="Encoding" value={decoded.xdrFormat.toUpperCase()} />
              <Detail label="Arguments" value={`${decoded.args.length} value${decoded.args.length === 1 ? "" : "s"}`} />

              <div className="rounded-xl border border-gray-800 bg-black/20">
                <div className="flex items-center justify-between border-b border-gray-800 px-4 py-3">
                  <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">Raw XDR</span>
                  <button
                    type="button"
                    onClick={handleCopy}
                    className="rounded-md p-1.5 text-gray-500 transition-colors hover:bg-gray-800 hover:text-gray-200"
                    aria-label="Copy raw XDR"
                    title="Copy raw XDR"
                  >
                    {copied ? <Check size={14} /> : <Clipboard size={14} />}
                  </button>
                </div>
                <pre className="max-h-44 overflow-auto whitespace-pre-wrap break-all p-4 font-mono text-[11px] leading-5 text-gray-400">
                  {rawXdr}
                </pre>
              </div>
            </div>

            <div className="overflow-hidden rounded-xl border border-gray-800 bg-[#090c10]">
              <div className="flex items-center justify-between border-b border-gray-800 px-4 py-3">
                <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">Decoded Call Parameters</span>
                <span className="text-[10px] text-gray-600">JSON</span>
              </div>
              <pre className="max-h-[420px] overflow-auto p-4 font-mono text-xs leading-6">
                {highlightJson(json)}
              </pre>
            </div>
          </div>
        ) : (
          <div className="p-8 text-center text-sm text-gray-500">
            Paste a proposal execution XDR to inspect its contract call.
          </div>
        )}
      </section>

      {simulationOpen ? (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="execution-simulation-title"
            className="flex max-h-[85vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl border border-gray-700 bg-[#090c10] shadow-2xl"
          >
            <header className="flex items-center justify-between border-b border-gray-800 px-5 py-4">
              <div className="flex items-center gap-3">
                <Terminal size={17} className="text-blue-300" />
                <div>
                  <h3 id="execution-simulation-title" className="text-sm font-semibold">Execution Dry-Run Console</h3>
                  <p className="text-[11px] text-gray-500">{rpcUrl}</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setSimulationOpen(false)}
                className="rounded-lg p-2 text-gray-500 hover:bg-gray-800 hover:text-gray-200"
                aria-label="Close simulation console"
              >
                <X size={17} />
              </button>
            </header>

            <div className="min-h-0 overflow-auto p-5 font-mono text-xs">
              {isSimulating ? (
                <div className="flex items-center gap-3 py-8 text-gray-400">
                  <Loader2 size={16} className="animate-spin text-blue-400" />
                  Simulating against Stellar testnet RPC…
                </div>
              ) : simulation ? (
                <div className="space-y-4">
                  <div className="flex flex-wrap items-center gap-3">
                    <span className={`rounded-full border px-2.5 py-1 text-[11px] ${simulation.status === "success" ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300" : "border-rose-500/30 bg-rose-500/10 text-rose-300"}`}>
                      {simulation.status === "success" ? "SIMULATION SUCCESS" : "SIMULATION ERROR"}
                    </span>
                    <span className="text-gray-500">{simulation.durationMs}ms</span>
                    {simulation.latestLedger ? <span className="text-gray-500">ledger #{simulation.latestLedger}</span> : null}
                  </div>

                  {simulation.error ? (
                    <TraceBlock title="Error" value={simulation.error} error />
                  ) : (
                    <>
                      <TraceBlock title="Return Value" value={formatTraceValue(simulation.returnValue)} />
                      <TraceBlock title="Execution Cost" value={formatTraceValue(simulation.cost)} />
                      <TraceBlock title="Minimum Resource Fee" value={simulation.minResourceFee ?? "—"} />
                      <TraceBlock title="Authorization Trace" value={formatTraceValue(simulation.auth)} />
                      <TraceBlock title="Events" value={formatTraceValue(simulation.events)} />
                      <TraceBlock title="Transaction Data" value={simulation.transactionData ?? "—"} />
                    </>
                  )}
                </div>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

function Detail({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="rounded-xl border border-gray-800 bg-black/20 p-4">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-600">{label}</p>
      <p className={`mt-1 break-all text-sm text-gray-200 ${mono ? "font-mono" : ""}`}>{value}</p>
    </div>
  );
}

function TraceBlock({ title, value, error = false }: { title: string; value: string; error?: boolean }) {
  return (
    <div className={`overflow-hidden rounded-xl border ${error ? "border-rose-500/30" : "border-gray-800"}`}>
      <div className="flex items-center justify-between border-b border-gray-800 bg-black/20 px-3 py-2">
        <span className={`text-[10px] font-semibold uppercase tracking-wider ${error ? "text-rose-300" : "text-gray-500"}`}>{title}</span>
        <RefreshCw size={12} className="text-gray-700" />
      </div>
      <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words p-3 text-gray-300">{value}</pre>
    </div>
  );
}

export default ExecutionBytecodeInspector;
