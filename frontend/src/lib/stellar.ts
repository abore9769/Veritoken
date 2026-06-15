import { Networks, TransactionBuilder, rpc } from "@stellar/stellar-sdk";

export const NETWORK = (import.meta.env.VITE_STELLAR_NETWORK as string) ?? "testnet";

export const RPC_URL =
  NETWORK === "mainnet"
    ? "https://mainnet.sorobanrpc.com"
    : "https://soroban-testnet.stellar.org";

export const NETWORK_PASSPHRASE =
  NETWORK === "mainnet" ? Networks.PUBLIC : Networks.TESTNET;

export const server = new rpc.Server(RPC_URL, { allowHttp: false });

export const CONTRACT_IDS = {
  kycRegistry: import.meta.env.VITE_KYC_REGISTRY_ID ?? "",
  complianceEngine: import.meta.env.VITE_COMPLIANCE_ENGINE_ID ?? "",
  invoiceToken: import.meta.env.VITE_INVOICE_TOKEN_ID ?? "",
  propertyToken: import.meta.env.VITE_PROPERTY_TOKEN_ID ?? "",
  carbonToken: import.meta.env.VITE_CARBON_TOKEN_ID ?? "",
};

export async function simulateAndSend(
  xdr: string,
  signTx: (xdr: string) => Promise<string>
): Promise<rpc.Api.GetSuccessfulTransactionResponse> {
  const simResult = await server.simulateTransaction(
    TransactionBuilder.fromXDR(xdr, NETWORK_PASSPHRASE)
  );

  if (rpc.Api.isSimulationError(simResult)) {
    throw new Error(`Simulation failed: ${simResult.error}`);
  }

  const prepared = rpc
    .assembleTransaction(
      TransactionBuilder.fromXDR(xdr, NETWORK_PASSPHRASE),
      simResult
    )
    .build()
    .toXDR();

  const signed = await signTx(prepared);
  const result = await server.sendTransaction(
    TransactionBuilder.fromXDR(signed, NETWORK_PASSPHRASE)
  );

  if (result.status === "ERROR") {
    throw new Error(`Transaction failed: ${JSON.stringify(result.errorResult)}`);
  }

  // Poll for confirmation
  let getResult = await server.getTransaction(result.hash);
  while (getResult.status === "NOT_FOUND") {
    await new Promise((r) => setTimeout(r, 1500));
    getResult = await server.getTransaction(result.hash);
  }

  if (getResult.status !== "SUCCESS") {
    throw new Error(`Transaction not successful: ${getResult.status}`);
  }

  return getResult as rpc.Api.GetSuccessfulTransactionResponse;
}
