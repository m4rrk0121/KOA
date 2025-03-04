const hre = require("hardhat");
const fs = require("fs");
const path = require("path");
const { ethers } = require("hardhat");

async function main() {
  console.log("Starting KOA deployment on Base Mainnet...");
  const network = hre.network.name;
  console.log(`Deploying to network: ${network}`);

  // Get signer information
  const [deployer] = await ethers.getSigners();
  const deployerAddress = await deployer.getAddress();
  const deployerBalance = await ethers.provider.getBalance(deployerAddress);
  
  console.log(`Deployer address: ${deployerAddress}`);
  console.log(`Deployer balance: ${ethers.formatEther(deployerBalance)} ETH`);

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

  // Base Mainnet Uniswap V3 addresses
  const taxCollector = deployerAddress; // Using deployer as tax collector initially
  const weth = "0x4200000000000000000000000000000000000006"; // Base WETH
  const uniswapV3Factory = "0x33128a8fC17869897dcE68Ed026d694621f6FDfD"; // Base Uniswap V3 Factory
  const positionManager = "0x03a520b32C04BF3bEEf7BEb72E919cf822Ed34f1"; // Base Position Manager
  const swapRouter = "0x2626664c2603336E57B271c5C0b26F421741e481"; // Base Swap Router
  
  console.log("Preparing to deploy KOA with parameters:");
  console.log({
    taxCollector,
    weth,
    locker: lockerAddress,
    uniswapV3Factory,
    positionManager,
    swapRouter
  });

  // Set a reasonable gas limit
  const gasLimit = 6000000; // 6 million gas units should be enough for KOA deployment
  
  console.log(`Using gas limit: ${gasLimit}`);
  console.log(`Make sure you have enough ETH to cover the deployment cost`);
  
  // Ask for confirmation
  const readline = require('readline').createInterface({
    input: process.stdin,
    output: process.stdout
  });
  
  const proceed = await new Promise(resolve => {
    readline.question(`Proceed with deployment to Base mainnet? This will cost real ETH (y/n): `, answer => {
      resolve(answer.toLowerCase() === 'y');
      readline.close();
    });
  });
  
  if (!proceed) {
    console.log("Deployment cancelled by user");
    process.exit(0);
  }

  console.log("Deploying KOA contract...");
  const KOA = await ethers.getContractFactory("KOA");
  const koaDeployTx = await KOA.deploy(
    taxCollector,
    weth,
    lockerAddress,
    uniswapV3Factory,
    positionManager,
    swapRouter,
    { gasLimit }
  );

  console.log("Waiting for KOA deployment transaction to be mined...");
  console.log(`Transaction hash: ${koaDeployTx.deploymentTransaction().hash}`);
  await koaDeployTx.waitForDeployment();
  const koaAddress = await koaDeployTx.getAddress();
  
  console.log(`KOA deployed to: ${koaAddress}`);

  // Save deployment info
  const deployData = {
    KOA: koaAddress,
    MultiPositionLiquidityLocker: lockerAddress,
    weth: weth,
    uniswapV3Factory: uniswapV3Factory,
    positionManager: positionManager,
    swapRouter: swapRouter,
    network: hre.network.name,
    timestamp: new Date().toISOString(),
    deployer: deployerAddress
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
  
  // Verify contract on block explorer
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

  console.log("KOA deployment complete!");
  console.log("\nTo create tokens, use the deploy-token script with this KOA address.");
  console.log(`KOA Address: ${koaAddress}`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("Deployment error:", error);
    process.exit(1);
  });