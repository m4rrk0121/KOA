const hre = require("hardhat");
const fs = require("fs");
const path = require("path");
const { ethers } = require("hardhat");

async function main() {
  console.log("Starting token deployment process...");

  // Load deployment information
  const network = hre.network.name;
  let deploymentPath;
  
  try {
    deploymentPath = path.join(__dirname, "..", "deployments", `${network}.json`);
    if (!fs.existsSync(deploymentPath)) {
      console.error(`No deployment found for network: ${network}`);
      console.log("Deploying SocialDexDeployer contract first...");
      
      // Run the deploy.js script to deploy the SocialDexDeployer
      require("./deploy.js");
      return;
    }
  } catch (error) {
    console.error("Error loading deployment data:", error);
    process.exit(1);
  }

  const deploymentData = JSON.parse(fs.readFileSync(deploymentPath, "utf8"));
  const deployerAddress = deploymentData.SocialDexDeployer;

  console.log(`Loading SocialDexDeployer at: ${deployerAddress}`);
  const socialDexDeployer = await ethers.getContractAt("SocialDexDeployer", deployerAddress);

  // Example parameters for token deployment
  const tokenName = "MyToken";
  const tokenSymbol = "MTK";
  const tokenSupply = ethers.parseEther("1000000"); // 1 million tokens with 18 decimals
  
  // Tick value for price of 1 ETH = ~210,000 tokens
  const initialTick = -104280; // Multiple of 60 for 0.3% fee tier
  const feeTier = 3000; // 0.3% fee tier
  
  // Step 1: Generate salt
  console.log("Generating salt for token deployment...");
  const [signer] = await ethers.getSigners();
  const signerAddress = await signer.getAddress();
  
  let saltResult;
  try {
    saltResult = await socialDexDeployer.generateSalt(
      signerAddress,
      tokenName,
      tokenSymbol,
      tokenSupply
    );
    
    console.log(`Generated Salt: ${saltResult[0]}`);
    console.log(`Predicted Token Address: ${saltResult[1]}`);
  } catch (error) {
    console.error("Error generating salt:", error);
    process.exit(1);
  }

  // Step 2: Deploy the token
  console.log("\nDeploying token...");
  const deploymentFee = ethers.parseEther("0.01"); // Example fee for initial liquidity
  
  try {
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
      "event TokenCreated(address tokenAddress, uint256 lpNftId, address deployer, string name, string symbol, uint256 supply)"
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
      console.log(`Deployer: ${tokenEvent.args.deployer}`);
      
      // Save the token info
      const tokenData = {
        tokenAddress: tokenEvent.args.tokenAddress,
        lpNftId: tokenEvent.args.lpNftId.toString(),
        name: tokenEvent.args.name,
        symbol: tokenEvent.args.symbol,
        supply: tokenEvent.args.supply.toString(),
        deployer: tokenEvent.args.deployer,
        deploymentTime: new Date().toISOString()
      };
      
      const tokensDir = path.join(__dirname, "..", "deployments", "tokens");
      if (!fs.existsSync(tokensDir)) {
        fs.mkdirSync(tokensDir, { recursive: true });
      }
      
      fs.writeFileSync(
        path.join(tokensDir, `${tokenSymbol}-${network}.json`),
        JSON.stringify(tokenData, null, 2)
      );
      
      console.log(`Token information saved to: ${path.join(tokensDir, `${tokenSymbol}-${network}.json`)}`);
      
      // Verify token contract on Basescan
      console.log("\nVerifying token contract on Basescan...");
      try {
        // Wait for a few blocks before verifying
        console.log("Waiting for block confirmations...");
        await new Promise(resolve => setTimeout(resolve, 30000)); // Wait 30 seconds
        
        await hre.run("verify:verify", {
          address: tokenEvent.args.tokenAddress,
          constructorArguments: [
            tokenName,
            tokenSymbol,
            tokenSupply
          ],
          contract: "contracts/SocialDexDeployer.sol:Token"
        });
        console.log("Token contract verified successfully!");
      } catch (error) {
        console.error("Error verifying token contract:", error.message);
      }
    } else {
      console.log("Could not find TokenCreated event in logs. Check the transaction on the block explorer.");
    }
  } catch (error) {
    console.error("Error deploying token:", error);
    console.error(error.message);
    
    // Check if this is a revert with a reason
    if (error.data) {
      try {
        const decodedError = socialDexDeployer.interface.parseError(error.data);
        console.error(`Decoded error: ${decodedError.name}(${decodedError.args.join(', ')})`);
      } catch (e) {
        // Could not decode the error
      }
    }
  }

  console.log("\nToken deployment process complete!");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });