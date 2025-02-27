const hre = require("hardhat");
const fs = require("fs");
const path = require("path");

async function main() {
  console.log("Starting deployment...");
  const network = hre.network.name;
  console.log(`Deploying to network: ${network}`);

  // Get environment variables based on network
  let taxCollector, weth, uniswapV3Factory, positionManager, swapRouter;
  
  if (network === 'base' || network === 'base-sepolia') {
    console.log("Using Base network configuration...");
    taxCollector = process.env.TAX_COLLECTOR_ADDRESS;
    weth = process.env.BASE_WETH_ADDRESS;
    uniswapV3Factory = process.env.BASE_UNISWAP_V3_FACTORY;
    positionManager = process.env.BASE_UNISWAP_V3_POSITION_MANAGER;
    swapRouter = process.env.BASE_UNISWAP_V3_SWAP_ROUTER;
  } else {
    console.log("Using Ethereum network configuration...");
    taxCollector = process.env.TAX_COLLECTOR_ADDRESS;
    weth = process.env.WETH_ADDRESS;
    uniswapV3Factory = process.env.UNISWAP_V3_FACTORY;
    positionManager = process.env.UNISWAP_V3_POSITION_MANAGER;
    swapRouter = process.env.UNISWAP_V3_SWAP_ROUTER;
  }

  if (!taxCollector || !weth || !uniswapV3Factory || !positionManager || !swapRouter) {
    console.error("Missing required environment variables. Check your .env file.");
    console.log("Required variables:", {
      taxCollector,
      weth,
      uniswapV3Factory,
      positionManager,
      swapRouter
    });
    process.exit(1);
  }

  console.log("Deploying SocialDexDeployer with parameters:");
  console.log({
    taxCollector,
    weth,
    uniswapV3Factory,
    positionManager,
    swapRouter
  });

  // Deploy the contract
  const SocialDexDeployer = await hre.ethers.getContractFactory("SocialDexDeployer");
  const deployer = await SocialDexDeployer.deploy(
    taxCollector,
    weth,
    uniswapV3Factory,
    positionManager,
    swapRouter
  );

  console.log("Waiting for deployment transaction to be mined...");
  await deployer.waitForDeployment();
  
  const deployerAddress = await deployer.getAddress();
  console.log(`SocialDexDeployer deployed to: ${deployerAddress}`);

  // Save deployment info
  const deployData = {
    SocialDexDeployer: deployerAddress,
    network: hre.network.name,
    timestamp: new Date().toISOString(),
  };

  const deployDirectory = path.join(__dirname, "..", "deployments");
  if (!fs.existsSync(deployDirectory)) {
    fs.mkdirSync(deployDirectory);
  }

  fs.writeFileSync(
    path.join(deployDirectory, `${hre.network.name}.json`),
    JSON.stringify(deployData, null, 2)
  );

  console.log("Deployment information saved to:", path.join(deployDirectory, `${hre.network.name}.json`));

  // Verify contract on Etherscan if not on localhost or hardhat network
  if (hre.network.name !== "localhost" && hre.network.name !== "hardhat") {
    console.log("Waiting for block confirmations...");
    // Wait for 6 blocks for Etherscan verification
    const deployTx = deployer.deploymentTransaction();
    await deployTx.wait(6);
    
    console.log("Verifying contract on Etherscan...");
    try {
      await hre.run("verify:verify", {
        address: deployerAddress,
        constructorArguments: [
          taxCollector,
          weth,
          uniswapV3Factory,
          positionManager,
          swapRouter
        ],
      });
      console.log("Contract verified successfully!");
    } catch (error) {
      console.log("Verification error:", error.message);
    }
  }

  console.log("Deployment complete!");
}

// Execute the main function and handle errors
main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });