const hre = require("hardhat");
const fs = require("fs");
const path = require("path");
const { ethers } = require("hardhat");

async function main() {
  console.log("Starting MultiPositionLiquidityLocker deployment on Sepolia...");
  const network = hre.network.name;
  console.log(`Deploying to network: ${network}`);

  // Get the necessary parameters
  const [deployer] = await ethers.getSigners();
  
  // Sepolia Uniswap V3 addresses
  // Note: These are the addresses for Sepolia network - update if necessary
  const positionManager = "0x03a520b32C04BF3bEEf7BEb72E919cf822Ed34f1"; // Sepolia Uniswap V3 Position Manager
  const feeCollector = await deployer.getAddress(); // Using deployer as fee collector for testing
  
  console.log(`Using position manager: ${positionManager}`);
  console.log(`Using fee collector: ${feeCollector}`);

  // Deploy the MultiPositionLiquidityLocker contract
  console.log("Deploying MultiPositionLiquidityLocker...");
  const MultiPositionLiquidityLocker = await ethers.getContractFactory("MultiPositionLiquidityLocker");
  const locker = await MultiPositionLiquidityLocker.deploy(positionManager, feeCollector);

  console.log("Waiting for deployment transaction to be mined...");
  await locker.waitForDeployment();
  const lockerAddress = await locker.getAddress();
  
  console.log(`MultiPositionLiquidityLocker deployed to: ${lockerAddress}`);

  // Save deployment info
  const deployData = {
    MultiPositionLiquidityLocker: lockerAddress,
    network: hre.network.name,
    timestamp: new Date().toISOString(),
  };

  const deployDirectory = path.join(__dirname, "..", "deployments");
  if (!fs.existsSync(deployDirectory)) {
    fs.mkdirSync(deployDirectory);
  }

  fs.writeFileSync(
    path.join(deployDirectory, `locker-${network}.json`),
    JSON.stringify(deployData, null, 2)
  );

  console.log("Deployment information saved to:", path.join(deployDirectory, `locker-${network}.json`));
  
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
