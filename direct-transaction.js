const { ethers } = require("ethers");
const fs = require("fs");
require("dotenv").config();

// Function signature for deployToken
const DEPLOY_TOKEN_SIGNATURE = "deployToken(string,string,uint256,int24,uint24,bytes32,address)";

async function main() {
  console.log("Starting direct transaction attempt...");

  // Load private key from .env
  const privateKey = process.env.PRIVATE_KEY;
  if (!privateKey) {
    console.error("Please set PRIVATE_KEY in your .env file");
    process.exit(1);
  }

  // Connect to Base Sepolia
  const provider = new ethers.JsonRpcProvider("https://sepolia.base.org");
  console.log("Connected to provider");

  // Create wallet
  const wallet = new ethers.Wallet(privateKey, provider);
  const signerAddress = await wallet.getAddress();
  console.log(`Using signer: ${signerAddress}`);

  // Contract address
  const koaAddress = "0xC974A321F87337826F9731cD108bd77810f5483e";
  console.log(`Target contract: ${koaAddress}`);

  // Simple parameters for testing
  const tokenName = "ManualToken";
  const tokenSymbol = "MAN";
  const tokenSupply = ethers.parseUnits("10000", 18); // 10k tokens
  const initialTick = -6000;
  const feeTier = 3000; // 0.3% fee tier
  const salt = "0x0000000000000000000000000000000000000000000000000000000000000001";
  const deploymentFee = ethers.parseEther("0.001");

  // Get current nonce
  const nonce = await provider.getTransactionCount(signerAddress);
  console.log(`Current nonce: ${nonce}`);

  // Calculate function selector
  const functionSelector = ethers.id(DEPLOY_TOKEN_SIGNATURE).slice(0, 10);
  console.log(`Function selector: ${functionSelector}`);

  // Encode the function parameters
  const abiCoder = ethers.AbiCoder.defaultAbiCoder();
  const encodedParams = abiCoder.encode(
    ["string", "string", "uint256", "int24", "uint24", "bytes32", "address"],
    [tokenName, tokenSymbol, tokenSupply, initialTick, feeTier, salt, signerAddress]
  );

  // Remove the 0x prefix
  const encodedParamsHex = encodedParams.slice(2);

  // Combine selector and parameters
  const data = functionSelector + encodedParamsHex;
  console.log(`Transaction data: ${data.slice(0, 100)}...`);

  try {
    // First try to estimate gas
    console.log("Estimating gas...");
    const gasEstimate = await provider.estimateGas({
      from: signerAddress,
      to: koaAddress,
      data,
      value: deploymentFee
    });
    console.log(`Gas estimate: ${gasEstimate.toString()}`);
  } catch (error) {
    console.error("Gas estimation failed:", error.message);
    // Continue anyway
  }

  // Create transaction object
  const tx = {
    to: koaAddress,
    data,
    value: deploymentFee,
    gasLimit: 6500000,
    nonce,
    type: 2, // EIP-1559 transaction
    chainId: 84532 // Base Sepolia chain ID
  };

  // Get fee data
  console.log("Getting fee data...");
  const feeData = await provider.getFeeData();
  tx.maxFeePerGas = feeData.maxFeePerGas;
  tx.maxPriorityFeePerGas = feeData.maxPriorityFeePerGas;
  console.log(`Max fee per gas: ${feeData.maxFeePerGas}`);
  console.log(`Max priority fee per gas: ${feeData.maxPriorityFeePerGas}`);

  // Sign and send transaction
  console.log("Signing and sending transaction...");
  try {
    const signedTx = await wallet.signTransaction(tx);
    console.log("Transaction signed, sending...");
    
    const txResponse = await provider.broadcastTransaction(signedTx);
    console.log(`Transaction sent: ${txResponse.hash}`);
    
    console.log("Waiting for confirmation...");
    const receipt = await txResponse.wait();
    console.log(`Transaction confirmed in block ${receipt.blockNumber}`);
    console.log(`Status: ${receipt.status ? "Success" : "Failed"}`);
    console.log(`Gas used: ${receipt.gasUsed.toString()}`);
  } catch (error) {
    console.error("Error sending transaction:", error);
    
    // Try to decode error
    if (error.transaction && error.transaction.data === "") {
      console.error("CRITICAL: Transaction data is empty!");
    }
    
    if (error.error && error.error.message) {
      console.error("Error message:", error.error.message);
    }
    
    // Check if we can get the transaction hash
    if (error.transaction && error.transaction.hash) {
      console.log(`Transaction hash (despite error): ${error.transaction.hash}`);
      
      try {
        // Try to get the receipt
        console.log("Attempting to get transaction receipt...");
        const receipt = await provider.getTransactionReceipt(error.transaction.hash);
        if (receipt) {
          console.log(`Receipt found! Status: ${receipt.status ? "Success" : "Failed"}`);
          console.log(`Gas used: ${receipt.gasUsed.toString()}`);
        }
      } catch (receiptError) {
        console.error("Failed to get receipt:", receiptError.message);
      }
    }
  }
}

main().catch(console.error);
