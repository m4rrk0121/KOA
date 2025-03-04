const hre = require("hardhat");
const fs = require("fs");
const path = require("path");
const { ethers } = require("hardhat");

async function main() {
  console.log("Starting MultiPositionLiquidityLocker deployment on Base Mainnet...");
  const network = hre.network.name;
  console.log(`Deploying to network: ${network}`);

  // Get the necessary parameters
  const [deployer] = await ethers.getSigners();
  const deployerAddress = await deployer.getAddress();
  const deployerBalance = await ethers.provider.getBalance(deployerAddress);
  
  console.log(`Deployer address: ${deployerAddress}`);
  console.log(`Deployer balance: ${ethers.formatEther(deployerBalance)} ETH`);
  
  // Base Mainnet Uniswap V3 addresses
  const positionManager = "0x03a520b32C04BF3bEEf7BEb72E919cf822Ed34f1"; // Base Mainnet Uniswap V3 Position Manager
  const feeCollector = deployerAddress; // Using deployer as fee collector initially
  
  console.log(`Using position manager: ${positionManager}`);
  console.log(`Using fee collector: ${feeCollector}`);

  // Deploy the MultiPositionLiquidityLocker contract
  console.log("Deploying MultiPositionLiquidityLocker...");
  const MultiPositionLiquidityLocker = await ethers.getContractFactory("MultiPositionLiquidityLocker");
  
  // For gas estimate, we'll use a fixed gas limit that's reasonable
  const gasLimit = 3000000; // 3 million gas units as a safe estimate
  
  // Simpler approach without gas price check
  console.log(`Using gas limit: ${gasLimit}`);
  console.log(`Make sure you have enough ETH to cover the deployment cost`);
  
  // Simple confirmation
  const readline = require('readline').createInterface({
    input: process.stdin,
    output: process.stdout
  });
  
  const proceed = await new Promise(resolve => {
    readline.question(`Proceed with deployment? (y/n): `, answer => {
      resolve(answer.toLowerCase() === 'y');
      readline.close();
    });
  });
  
  if (!proceed) {
    console.log("Deployment cancelled by user");
    process.exit(0);
  }

  console.log("Deploying contract...");
  const locker = await MultiPositionLiquidityLocker.deploy(
    positionManager, 
    feeCollector, 
    { gasLimit }
  );

  console.log("Waiting for deployment transaction to be mined...");
  await locker.waitForDeployment();
  const lockerAddress = await locker.getAddress();
  
  console.log(`MultiPositionLiquidityLocker deployed to: ${lockerAddress}`);

  // Save deployment info
  const deployData = {
    MultiPositionLiquidityLocker: lockerAddress,
    network: hre.network.name,
    timestamp: new Date().toISOString(),
    deployer: deployerAddress,
    positionManager: positionManager,
    feeCollector: feeCollector
  };

  const deployDirectory = path.join(__dirname, "..", "deployments");
  if (!fs.existsSync(deployDirectory)) {
    fs.mkdirSync(deployDirectory);
  }
  
  const deployFilename = `locker-${network}.json`;
  fs.writeFileSync(
    path.join(deployDirectory, deployFilename),
    JSON.stringify(deployData, null, 2)
  );

  console.log("Deployment information saved to:", path.join(deployDirectory, deployFilename));
  
  // Verify contract on Etherscan if not on localhost or hardhat network
  if (network !== "localhost" && network !== "hardhat") {
    console.log("Waiting for block confirmations before verification...");
    // Wait for a few blocks to ensure the deployment is confirmed
    await locker.deploymentTransaction().wait(5);
    
    console.log("Verifying contract on block explorer...");
    try {
      await hre.run("verify:verify", {
        address: lockerAddress,
        constructorArguments: [
          positionManager,
          feeCollector
        ],
      });
      console.log("Contract verified successfully!");
    } catch (error) {
      console.log("Error during verification:", error.message);
    }
  }

  console.log("MultiPositionLiquidityLocker deployment complete!");
  return lockerAddress;
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });











