"use client";

import { useState } from "react";
import { HermesClient } from "@pythnetwork/hermes-client";
import {
  Aptos,
  AptosConfig,
  Network,
  Account,
  Ed25519PrivateKey,
} from "@aptos-labs/ts-sdk";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";

// Testnet BTC/USD price feed ID
const BTC_USD_PRICE_ID =
  "0xf9c0172ba10dfa4d19088d94f5bf61d3b54d5bd7483a322a982e1373ee8ea31b";

const MODULE_ADDRESS =
  "0x435c07fee9a83d1c65f667513a72d49156b001229b08db94162826e0ab02c916";

const AptosService = () => {
  const privateKey = process.env.NEXT_PUBLIC_APTOS_PRIVATE_KEY;
  const config = new AptosConfig({ network: Network.TESTNET });
  const client = new Aptos(config);

  if (!privateKey)
    throw new Error("Private key not found in environment variables");

  const cleanPrivateKey = privateKey.startsWith("0x")
    ? privateKey.slice(2)
    : privateKey;
  const privKey = new Ed25519PrivateKey(cleanPrivateKey);
  const account = Account.fromPrivateKey({ privateKey: privKey });

  return { client, account };
};

const MintingButton = () => {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const [txHash, setTxHash] = useState("");

  const mintCoins = async () => {
    setIsLoading(true);
    setError("");
    setTxHash("");

    try {
      // Initialize Hermes client
      const hermesClient = new HermesClient(
        "https://hermes-beta.pyth.network/"
      );

      // Get price update data
      const priceUpdateData = await hermesClient.getLatestPriceUpdates([
        BTC_USD_PRICE_ID,
      ]);
      console.log("Raw price update data:", priceUpdateData);

      if (!priceUpdateData?.binary?.data?.[0]) {
        throw new Error("Invalid price update data format");
      }

      // Convert the hex string to bytes and format as a vector<vector<u8>>
      const priceUpdateBytes = Buffer.from(
        priceUpdateData.binary.data[0],
        "hex"
      );

      console.log("Price update bytes:", priceUpdateBytes);

      // Format as a vector of vector<u8> - IMPORTANT: This is the key change
      const formattedPriceUpdate = [
        Array.from(new Uint8Array(priceUpdateBytes)),
      ];

      console.log("Formatted price update:", formattedPriceUpdate);

      // Initialize Aptos service
      const { client, account } = AptosService();

      // Build transaction with the properly formatted price update
      const txn = await client.transaction.build.simple({
        sender: account.accountAddress,
        data: {
          function: `${MODULE_ADDRESS}::btc_pegged_coin::mint_coins`,
          typeArguments: [],
          functionArguments: [
            100, // Amount in USD
            formattedPriceUpdate,
          ],
        },
      });

      console.log("Transaction payload:", txn);

      // Sign and submit transaction
      const committedTxn = await client.signAndSubmitTransaction({
        signer: account,
        transaction: txn,
      });

      console.log("Transaction submitted:", committedTxn.hash);

      // Wait for transaction
      await client.waitForTransaction({
        transactionHash: committedTxn.hash,
      });

      setTxHash(committedTxn.hash);
    } catch (err) {
      console.error("Error details:", err);

      // Extract meaningful error message
      let errorMessage = err instanceof Error ? err.message : String(err);

      // Look for specific error patterns in the Move abort
      if (errorMessage.includes("0x60008")) {
        errorMessage =
          "Error: Invalid price update data format or state verification failed";
      }

      setError(errorMessage);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="flex flex-col gap-4 p-4">
      <Button onClick={mintCoins} disabled={isLoading} className="w-full">
        {isLoading ? "Minting..." : "Mint BTC Pegged Coins ($100)"}
      </Button>

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {txHash && (
        <Alert>
          <AlertDescription>
            Transaction successful! Hash: {txHash}
          </AlertDescription>
        </Alert>
      )}
    </div>
  );
};

export default MintingButton;
