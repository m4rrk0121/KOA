const hre = require("hardhat");
const fs = require("fs");
const path = require("path");
const { ethers } = require("hardhat");
const crypto = require("crypto");

async function main() {
  console.log("Starting token deployment process with enhanced debugging...");

  // Load deployment information
  const network = hre.network.name;
  const deploymentPath = path.join(__dirname, "..", "deployments", `${network}.json`);
  
  if (!fs.existsSync(deploymentPath)) {
    console.error(`No deployment found for network: ${network}`);
    process.exit(1);
  }

  const deploymentData = JSON.parse(fs.readFileSync(deploymentPath, "utf8"));
  const koaAddress = deploymentData.KOA;

  if (!koaAddress) {
    console.error("No KOA contract address found in deployment data");
    process.exit(1);
  }

  console.log(`Loading KOA at: ${koaAddress}`);
  
  // Get KOA contract instance
  const KOA = await ethers.getContractFactory("KOA");
  const koa = await ethers.getContractAt("KOA", koaAddress);
  
  // Get signer information
  const [signer] = await ethers.getSigners();
  const signerAddress = await signer.getAddress();
  const signerBalance = await ethers.provider.getBalance(signerAddress);
  
  console.log(`Using signer: ${signerAddress}`);
  console.log(`Signer balance: ${ethers.formatEther(signerBalance)} ETH`);

  // Extensive contract connectivity and setup checks
  console.log("\n=== Detailed Contract State Check ===");
  try {
    // Check contract ownership and permissions
    const owner = await koa.owner();
    console.log(`Contract owner: ${owner}`);
    console.log(`Is signer the owner? ${owner.toLowerCase() === signerAddress.toLowerCase()}`);
    
    // Check basic state variables
    const wethAddress = await koa.weth();
    console.log(`WETH address: ${wethAddress}`);
    
    const taxCollector = await koa.taxCollector();
    console.log(`Tax collector: ${taxCollector}`);
    
    const protocolCut = await koa.protocolCut();
    console.log(`Protocol cut: ${protocolCut.toString()}`);

    // Check locker setup
    console.log("\n=== Checking MultiPositionLiquidityLocker setup ===");
    const lockerAddress = await koa.liquidityLocker();
    console.log(`Locker address: ${lockerAddress}`);
    
    // Check if locker exists by calling a view function
    try {
      const locker = await ethers.getContractAt("MultiPositionLiquidityLocker", lockerAddress);
      const lockerFeeCollector = await locker.feeCollector();
      console.log(`Locker fee collector: ${lockerFeeCollector}`);
    } catch (error) {
      console.error(`!!! Error accessing locker at ${lockerAddress}:`, error.message);
    }
    
    // Check UniswapV3 infrastructure
    const uniswapFactoryAddress = await koa.uniswapV3Factory();
    console.log(`Uniswap V3 Factory: ${uniswapFactoryAddress}`);
    
    // Use getContractAt instead of getContractFactory for interfaces
    const uniswapFactory = await ethers.getContractAt("IUniswapV3Factory", uniswapFactoryAddress);
    
    // Check if we can call the factory
    try {
      const feeAmount = 3000; // 0.3%
      const tickSpacing = await uniswapFactory.feeAmountTickSpacing(feeAmount);
      console.log(`Tick spacing for ${feeAmount} fee: ${tickSpacing}`);
    } catch (error) {
      console.error("!!! Error accessing Uniswap V3 Factory:", error.message);
    }
    
    // Check position manager
    const positionManagerAddress = await koa.positionManager();
    console.log(`Position Manager: ${positionManagerAddress}`);
    
    // Check swap router
    const swapRouterAddress = await koa.swapRouter();
    console.log(`Swap Router: ${swapRouterAddress}`);
    
    console.log("=== Contract state check complete ===\n");
  } catch (error) {
    console.error("!!! Critical error during contract checks:", error);
    console.error("This may indicate a problem with contract initialization!");
    // Continue anyway to see specific deployment errors
  }

  // Example parameters for token deployment
  const tokenName = "TestToken";
  const tokenSymbol = "TEST";
  // Use a smaller supply for testing
  const tokenSupply = ethers.parseEther("100000"); // 100k tokens with 18 decimals
  
  // Try with a different tick value
  const feeTier = 3000; // 0.3% fee tier
  
  // Verify tick spacing first
  let tickSpacing;
  try {
    const uniswapFactoryAddress = await koa.uniswapV3Factory();
    const uniswapFactory = await ethers.getContractAt("IUniswapV3Factory", uniswapFactoryAddress);
    tickSpacing = await uniswapFactory.feeAmountTickSpacing(feeTier);
    console.log(`Tick spacing for fee tier ${feeTier}: ${tickSpacing}`);
  } catch (error) {
    console.error("Error getting tick spacing:", error.message);
    tickSpacing = 60; // Default for 0.3% fee tier
    console.log(`Using default tick spacing: ${tickSpacing}`);
  }
  
  // Set initialTick to a valid value based on tick spacing
  const initialTick = -60 * 100; // -6000, a multiple of 60 for 0.3% fee tier
  console.log(`Using initial tick: ${initialTick} (should be multiple of ${tickSpacing})`);
  // Fix for BigInt issue - explicitly convert to Number
  console.log(`Initial tick mod tick spacing: ${initialTick % Number(tickSpacing)}`);
  
  // Step 1: Generate salt using the contract's generateSalt function
  console.log("\nGenerating salt using contract's generateSalt function...");
  console.log(`Using signer address: ${signerAddress}`);
  
  let saltResult;
  let generatedSalt;
  let predictedAddress;
  
  try {
    // Call the contract's generateSalt function to get a salt that produces a token address < WETH
    saltResult = await koa.generateSalt(
      signerAddress,
      tokenName,
      tokenSymbol,
      tokenSupply
    );
    
    generatedSalt = saltResult[0];
    predictedAddress = saltResult[1];
    
    console.log(`Generated Salt: ${generatedSalt}`);
    console.log(`Predicted Token Address: ${predictedAddress}`);
    
    // Verify that the predicted token address is less than WETH address
    const wethAddress = await koa.weth();
    console.log(`WETH Address: ${wethAddress}`);
    console.log(`Is token address < WETH? ${predictedAddress.toLowerCase() < wethAddress.toLowerCase()}`);
    
    // Check if token already exists
    const codeSize = await ethers.provider.getCode(predictedAddress);
    console.log(`Token already deployed? ${codeSize !== '0x'}`);
  } catch (error) {
    console.error("Error generating salt:", error.message);
    process.exit(1);
  }

  // Step 2: Deploy the token
  console.log("\nDeploying token...");
  // Use a more generous deployment fee
  const deploymentFee = ethers.parseEther("0.0005"); // 0.01 ETH for testing
  console.log(`Using deployment fee: ${ethers.formatEther(deploymentFee)} ETH`);
  
  try {
    // Prepare parameters for better clarity
    const params = [
      tokenName,
      tokenSymbol,
      tokenSupply,
      initialTick,
      feeTier,
      generatedSalt, // Use the generated salt from the contract
      signerAddress
    ];
    
    console.log("Function parameters:", {
      tokenName,
      tokenSymbol,
      tokenSupply: tokenSupply.toString(),
      initialTick,
      feeTier,
      salt: generatedSalt,
      deployer: signerAddress,
      value: deploymentFee.toString()
    });

    // Try to estimate gas first
    try {
      console.log("Estimating gas for deployment...");
      const estimatedGas = await koa.deployToken.estimateGas(
        ...params,
        { value: deploymentFee }
      );
      console.log(`Estimated gas: ${estimatedGas.toString()}`);
    } catch (estimateError) {
      console.error("Gas estimation failed with error:", estimateError.message);
      
      // Try to get more details about the error
      try {
        console.log("\nSimulating call to debug the error...");
        const calldata = KOA.interface.encodeFunctionData("deployToken", params);
        
        // Create transaction object
        const tx = {
          to: koaAddress,
          from: signerAddress,
          data: calldata,
          value: deploymentFee
        };
        
        try {
          // Try simulating call
          console.log("\nSimulating call...");
          await ethers.provider.call(tx);
          console.log("Simulation succeeded unexpectedly");
        } catch (callError) {
          console.error("Simulation error:", callError.message);
          
          // Try to extract reason from error message
          if (callError.message) {
            // Try to find revert reason
            const revertReasonMatch = callError.message.match(/reverted with reason string '([^']+)'/);
            if (revertReasonMatch) {
              console.error("Revert reason:", revertReasonMatch[1]);
            }
            
            // Try to find custom error
            const customErrorMatch = callError.message.match(/reverted with custom error '([^']+)'/);
            if (customErrorMatch) {
              console.error("Custom error:", customErrorMatch[1]);
            }
            
            // Try to find selector
            const selectorMatch = callError.message.match(/reverted with an unrecognized custom error \(code=0x([0-9a-f]+)/);
            if (selectorMatch) {
              console.error("Error selector:", "0x" + selectorMatch[1]);
            }
          }
          
          // Try to decode any revert reason
          if (callError.data) {
            try {
              const decodedError = KOA.interface.parseError(callError.data);
              console.error("Decoded error:", decodedError);
            } catch (e) {
              console.log("Could not decode error data");
            }
          }
        }
      } catch (debugError) {
        console.error("Error during debugging:", debugError.message);
      }
      
      // Try alternative approaches
      console.log("\n=== Trying alternative approaches ===");
      
      // 1. Check if we can just create the token
      try {
        console.log("Checking if token creation is the issue...");
        const mockToken = await ethers.getContractFactory("Token");
        const mockTokenDeployment = await mockToken.deploy(tokenName, tokenSymbol, tokenSupply);
        await mockTokenDeployment.waitForDeployment();
        console.log(`Mock token deployed at: ${await mockTokenDeployment.getAddress()}`);
        console.log("Token creation works fine!");
      } catch (tokenError) {
        console.error("Token creation failed:", tokenError.message);
      }
      
      console.log("\nDo you want to continue with deployment despite gas estimation failure? (y/n)");
      // Prompt for user input
      const readline = require('readline').createInterface({
        input: process.stdin,
        output: process.stdout
      });
      
      readline.question('', (answer) => {
        readline.close();
        if (answer.toLowerCase() === 'y') {
          deployTokenAnyway(koa, params, deploymentFee);
        } else {
          console.log("Aborting deployment due to gas estimation failure");
          process.exit(0);
        }
      });
      
      // Don't continue automatically
      return;
    }
    
    console.log("\nExecuting deployment transaction...");
    const tx = await koa.deployToken(
      ...params,
      { 
        value: deploymentFee,
        gasLimit: 8000000 // High gas limit for testing
      }
    );

    console.log(`Transaction hash: ${tx.hash}`);
    console.log("Waiting for transaction confirmation...");
    
    const receipt = await tx.wait();
    console.log("Transaction confirmed!");

    // Interpret the transaction receipt
    console.log("\nTransaction Receipt:");
    console.log(`Status: ${receipt.status === 1 ? 'Success' : 'Failed'}`);
    console.log(`Gas Used: ${receipt.gasUsed.toString()}`);
    console.log(`Block Number: ${receipt.blockNumber}`);
    
    // Parse the TokenCreated event
    const tokenCreatedEvents = receipt.logs
      .filter(log => {
        try {
          const parsed = koa.interface.parseLog(log);
          return parsed && parsed.name === "TokenCreated";
        } catch (e) {
          return false;
        }
      })
      .map(log => koa.interface.parseLog(log));

    if (tokenCreatedEvents.length > 0) {
      const event = tokenCreatedEvents[0];
      console.log("\nToken Deployment Success!");
      console.log(`Token Address: ${event.args.tokenAddress}`);
      console.log(`LP NFT ID: ${event.args.lpNftId}`);
      console.log(`Deployer: ${event.args.deployer}`);
      
      // Check all event args
      console.log("\nAll event arguments:");
      Object.entries(event.args).forEach(([key, value]) => {
        if (!isNaN(key)) return; // Skip numeric keys
        console.log(`${key}: ${value}`);
      });
      
      // Save the token info
      const tokenData = {
        tokenAddress: event.args.tokenAddress,
        lpNftId: event.args.lpNftId.toString(),
        name: event.args.name,
        symbol: event.args.symbol,
        supply: event.args.supply.toString(),
        deployer: event.args.deployer,
        timestamp: new Date().toISOString()
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
    } else {
      console.log("Could not find TokenCreated event in logs. Check the transaction on the block explorer.");
    }
  } catch (error) {
    console.error("\nError deploying token:", error.message);
    
    if (error.error) {
      console.error("Underlying error:", error.error.message || error.error);
    }
    
    if (error.transaction) {
      console.error("\nTransaction details:");
      console.error(`To: ${error.transaction.to}`);
      console.error(`Value: ${error.transaction.value}`);
      console.error(`Data: ${error.transaction.data?.substring(0, 66)}...`);
    }
    
    if (error.receipt) {
      console.error("\nTransaction receipt:");
      console.error(`Status: ${error.receipt.status}`);
      console.error(`Gas Used: ${error.receipt.gasUsed.toString()}`);
      
      if (error.receipt.gasUsed < 100000) {
        console.error("\n!!! WARNING: Very low gas used, transaction likely failed early !!!");
        console.error("This often indicates a basic permission or input validation issue.");
      }
    }
  }

  console.log("\nToken deployment process complete!");
}

// Function to deploy token anyway despite gas estimation failure
async function deployTokenAnyway(koa, params, deploymentFee) {
  try {
    console.log("\nExecuting deployment transaction anyway...");
    const tx = await koa.deployToken(
      ...params,
      { 
        value: deploymentFee,
        gasLimit: 8000000 // High gas limit for testing
      }
    );

    console.log(`Transaction hash: ${tx.hash}`);
    console.log("Waiting for transaction confirmation...");
    
    const receipt = await tx.wait();
    console.log("Transaction confirmed!");
    
    // Process receipt...
    console.log(`Status: ${receipt.status === 1 ? 'Success' : 'Failed'}`);
    console.log(`Gas Used: ${receipt.gasUsed.toString()}`);
    
  } catch (error) {
    console.error("Error during forced deployment:", error.message);
  }
  
  process.exit(0);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("Unhandled error in main:", error);
    process.exit(1);
  });