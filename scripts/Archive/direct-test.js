const { ethers } = require("ethers");
const fs = require("fs");
const path = require("path");
require("dotenv").config();

// ABI fragment for the deployToken function
const deployTokenAbi = [
  "function deployToken(string _name, string _symbol, uint256 _supply, int24 _initialTick, uint24 _fee, bytes32 _salt, address _deployer) payable returns (address, uint256)"
];

// ABI fragment for generateSalt function
const generateSaltAbi = [
  "function generateSalt(address deployer, string name, string symbol, uint256 supply) view returns (bytes32, address)"
];

// ABI for basic state reading
const basicAbi = [
  "function weth() view returns (address)",
  "function taxCollector() view returns (address)",
  "function protocolCut() view returns (uint8)"
];

async function main() {
  console.log("Starting simplified test...");

  // Load private key from .env file
  const privateKey = process.env.PRIVATE_KEY;
  if (!privateKey) {
    console.error("No private key found in .env file");
    process.exit(1);
  }

  // Connect to Base Sepolia
  const provider = new ethers.JsonRpcProvider("https://sepolia.base.org");
  console.log("Connected to provider");

  // Create wallet
  const wallet = new ethers.Wallet(privateKey, provider);
  const signerAddress = await wallet.getAddress();
  console.log(`Using signer: ${signerAddress}`);

  // Load the KOA contract address from deployment
  const network = "base-sepolia";
  const deploymentPath = path.join(__dirname, "..", "deployments", `${network}.json`);
  
  if (!fs.existsSync(deploymentPath)) {
    console.error(`No deployment found for network: ${network}`);
    process.exit(1);
  }

  const deploymentData = JSON.parse(fs.readFileSync(deploymentPath, "utf8"));
  const koaAddress = deploymentData.KOA;
  console.log(`KOA contract address: ${koaAddress}`);

  // Create contract instances with minimal ABIs
  const koaBasic = new ethers.Contract(koaAddress, basicAbi, wallet);
  const koaGenerateSalt = new ethers.Contract(koaAddress, generateSaltAbi, wallet);
  const koaDeploy = new ethers.Contract(koaAddress, deployTokenAbi, wallet);

  // Test reading basic state variables
  try {
    const wethAddress = await koaBasic.weth();
    console.log("WETH address from contract:", wethAddress);
    
    const taxCollector = await koaBasic.taxCollector();
    console.log("Tax collector address:", taxCollector);
    
    const protocolCut = await koaBasic.protocolCut();
    console.log("Protocol cut:", protocolCut.toString());
  } catch (error) {
    console.error("Error reading contract state:", error);
    console.error("This indicates a fundamental problem with the contract interface");
    process.exit(1);
  }

  // Parameters for token deployment
  const tokenName = "TestToken";
  const tokenSymbol = "TEST";
  const tokenSupply = ethers.parseUnits("10000", 18); // 10k tokens
  const initialTick = -6000; // Multiple of 60 for 0.3% fee tier
  const feeTier = 3000; // 0.3% fee tier

  // Generate salt
  console.log("\nGenerating salt...");
  let saltValue, predictedAddress;
  try {
    const saltResult = await koaGenerateSalt.generateSalt(
      signerAddress,
      tokenName,
      tokenSymbol,
      tokenSupply
    );
    
    saltValue = saltResult[0];
    predictedAddress = saltResult[1];
    console.log(`Generated Salt: ${saltValue}`);
    console.log(`Predicted Token Address: ${predictedAddress}`);
  } catch (error) {
    console.error("Error generating salt:", error);
    console.error("This indicates a problem with the generateSalt function interface");
    process.exit(1);
  }

  // Prepare transaction parameters
  const deploymentFee = ethers.parseEther("0.001");
    
  console.log("\nAttempting token deployment with parameters:");
  console.log({
    tokenName,
    tokenSymbol,
    tokenSupply: tokenSupply.toString(),
    initialTick,
    feeTier,
    salt: saltValue,
    deployer: signerAddress,
    value: deploymentFee.toString()
  });

  // Try to estimate gas first
  try {
    console.log("\nEstimating gas...");
    const gasEstimate = await koaDeploy.deployToken.estimateGas(
      tokenName,
      tokenSymbol,
      tokenSupply,
      initialTick,
      feeTier,
      saltValue,
      signerAddress,
      { value: deploymentFee }
    );
    console.log(`Estimated gas: ${gasEstimate.toString()}`);
  } catch (error) {
    console.error("Gas estimation failed:", error);
    console.log("Will attempt transaction anyway");
  }
  
  // Deploy token
  try {
    console.log("\nSending transaction...");
    const tx = await koaDeploy.deployToken(
      tokenName,
      tokenSymbol,
      tokenSupply,
      initialTick,
      feeTier,
      saltValue,
      signerAddress,
      { 
        value: deploymentFee,
        gasLimit: 6500000 
      }
    );
    
    console.log(`Transaction hash: ${tx.hash}`);
    console.log("Waiting for confirmation...");
    
    const receipt = await tx.wait();
    console.log(`Transaction status: ${receipt.status === 1 ? "Success" : "Failed"}`);
    
    if (receipt.status === 1) {
      console.log("\nToken deployment successful!");
    } else {
      console.error("Transaction failed!");
    }
  } catch (error) {
    console.error("\nError deploying token:", error);
    
    // Check for empty data in transaction
    if (error.transaction && error.transaction.data === "") {
      console.error("\n!!! CRITICAL ERROR: Empty transaction data !!!");
      console.error("This indicates a fundamental problem with the contract interface");
      
      // Try a more direct approach for debugging
      console.log("\nAttempting direct contract method call for better error information...");
      try {
        // Manually create the transaction object
        const data = koaDeploy.interface.encodeFunctionData("deployToken", [
          tokenName,
          tokenSymbol,
          tokenSupply,
          initialTick,
          feeTier,
          saltValue,
          signerAddress
        ]);
        
        console.log(`Encoded function data: ${data.slice(0, 66)}...`);
        
        // Send a call (not a transaction) to get error information
        await provider.call({
          to: koaAddress,
          data: data,
          from: signerAddress,
          value: deploymentFee
        });
      } catch (callError) {
        console.error("Call error details:", callError);
      }
    }
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("Unhandled error:", error);
    process.exit(1);
  });