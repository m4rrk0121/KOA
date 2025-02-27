const hre = require("hardhat");
const fs = require("fs");
const path = require("path");
const { ethers } = require("hardhat");

async function main() {
  // Load deployment information
  const deploymentsPath = path.join(__dirname, "..", "deployments", `${hre.network.name}.json`);
  if (!fs.existsSync(deploymentsPath)) {
    console.error(`No deployment found for network: ${hre.network.name}`);
    process.exit(1);
  }

  const deploymentData = JSON.parse(fs.readFileSync(deploymentsPath, "utf8"));
  const deployerAddress = deploymentData.SocialDexDeployer;

  console.log(`Loading SocialDexDeployer at: ${deployerAddress}`);
  const socialDexDeployer = await ethers.getContractAt("SocialDexDeployer", deployerAddress);

  // Example parameters for token deployment
  const tokenName = "Example Token";
  const tokenSymbol = "EXTKN";
  const tokenSupply = ethers.parseEther("1000000"); // 1 million tokens with 18 decimals
  const initialTick = -887272; // This must be a multiple of the tick spacing for the fee tier
  const feeTier = 3000; // 0.3% fee tier
  // Usually feeTiers in Uniswap V3 are:
  // 500 (0.05%), 3000 (0.3%), 10000 (1%)

  // Step 1: Generate salt
  console.log("Generating salt for token deployment...");
  const [signer] = await ethers.getSigners();
  const signerAddress = await signer.getAddress();
  
  const saltResult = await socialDexDeployer.generateSalt(
    signerAddress,
    tokenName,
    tokenSymbol,
    tokenSupply
  );

  console.log(`Generated Salt: ${saltResult[0]}`);
  console.log(`Predicted Token Address: ${saltResult[1]}`);

  // Step 2: Deploy the token
  console.log("Deploying token...");
  const deploymentFee = ethers.parseEther("0.1"); // Example fee for initial liquidity
  
  const tx = await socialDexDeployer.deployToken(
    tokenName,
    tokenSymbol,
    tokenSupply,
    initialTick,
    feeTier,
    saltResult[0], // Use the generated salt
    signerAddress,
    { value: deploymentFee }
  );

  console.log(`Transaction hash: ${tx.hash}`);
  console.log("Waiting for transaction confirmation...");
  
  const receipt = await tx.wait();
  console.log("Transaction confirmed!");

  // Parse the TokenCreated event
  const eventInterface = new ethers.Interface([
    "event TokenCreated(address tokenAddress, uint256 lpNftId, address deployer, string name, string symbol, uint256 supply, uint256 _supply, address lockerAddress)"
  ]);

  const events = receipt.logs
    .map(log => {
      try {
        return eventInterface.parseLog({
          topics: log.topics,
          data: log.data
        });
      } catch (e) {
        return null;
      }
    })
    .filter(Boolean);

  const tokenEvent = events.find(event => event.name === "TokenCreated");

  if (tokenEvent) {
    console.log("\nToken Deployment Success!");
    console.log(`Token Address: ${tokenEvent.args.tokenAddress}`);
    console.log(`LP NFT ID: ${tokenEvent.args.lpNftId}`);
    console.log(`Locker Address: ${tokenEvent.args.lockerAddress}`);
  } else {
    console.log("Could not find TokenCreated event in logs. Check the transaction on the block explorer.");
  }

  // Step 3: Example of buying more tokens
  if (tokenEvent) {
    console.log("\nBuying more tokens...");
    const buyAmount = ethers.parseEther("0.05");
    
    const buyTx = await socialDexDeployer.initialSwapTokens(
      tokenEvent.args.tokenAddress,
      feeTier,
      { value: buyAmount }
    );
    
    console.log(`Buy transaction hash: ${buyTx.hash}`);
    await buyTx.wait();
    console.log("Token purchase confirmed!");
  }

  console.log("\nInteraction complete!");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
