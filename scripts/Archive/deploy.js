const hre = require("hardhat");
const fs = require("fs");
const path = require("path");
const { ethers } = require("hardhat");

async function main() {
  console.log("Starting KOA deployment...");
  const network = hre.network.name;
  console.log(`Deploying to network: ${network}`);

  // Load locker address from deployment file
  const lockerFilename = `locker-${network}.json`;
  const lockerPath = path.join(__dirname, "..", "deployments", lockerFilename);
  
  let lockerAddress;
  if (fs.existsSync(lockerPath)) {
    const lockerData = JSON.parse(fs.readFileSync(lockerPath, "utf8"));
    lockerAddress = lockerData.MultiPositionLiquidityLocker;
    console.log(`Using previously deployed MultiPositionLiquidityLocker at: ${lockerAddress}`);
  } else {
    console.error(`No locker deployment found for network: ${network}`);
    console.error("Please run deploy-locker.js first");
    process.exit(1);
  }

  // Use your existing values for the deployment
  const taxCollector = process.env.TAX_COLLECTOR_ADDRESS || "0x86e8d2532D531ECEBa1316f5E545C8AF7B650146";
  const weth = process.env.BASE_WETH_ADDRESS || "0x4200000000000000000000000000000000000006";
  const uniswapV3Factory = process.env.BASE_UNISWAP_V3_FACTORY || "0x33128a8fC17869897dcE68Ed026d694621f6FDfD";
  const positionManager = process.env.BASE_UNISWAP_V3_POSITION_MANAGER || "0x03a520b32C04BF3bEEf7BEb72E919cf822Ed34f1";
  const swapRouter = process.env.BASE_UNISWAP_V3_SWAP_ROUTER || "0x2626664c2603336E57B271c5C0b26F421741e481";
  
  console.log("Deploying KOA with parameters:");
  console.log({
    taxCollector,
    weth,
    locker: lockerAddress,
    uniswapV3Factory,
    positionManager,
    swapRouter
  });

  const KOA = await ethers.getContractFactory("KOA");
  const koaDeployTx = await KOA.deploy(
    taxCollector,
    weth,
    lockerAddress,
    uniswapV3Factory,
    positionManager,
    swapRouter
  );

  console.log("Waiting for KOA deployment transaction to be mined...");
  await koaDeployTx.waitForDeployment();
  const koaAddress = await koaDeployTx.getAddress();
  
  console.log(`KOA deployed to: ${koaAddress}`);

  // Save deployment info
  const deployData = {
    KOA: koaAddress,
    MultiPositionLiquidityLocker: lockerAddress,
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
  
  // Verify contract on block explorer if not on localhost or hardhat network
  if (network !== "localhost" && network !== "hardhat") {
    console.log("Waiting for block confirmations before verification...");
    // Wait for a few blocks to ensure the deployment is confirmed
    await koaDeployTx.deploymentTransaction().wait(5);
    
    console.log("Verifying contract on block explorer...");
    try {
      await hre.run("verify:verify", {
        address: koaAddress,
        constructorArguments: [
          taxCollector,
          weth,
          lockerAddress,
          uniswapV3Factory,
          positionManager,
          swapRouter
        ],
      });
      console.log("Contract verified successfully!");
    } catch (error) {
      console.log("Error during verification:", error.message);
    }
  }

  console.log("KOA deployment complete!");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });