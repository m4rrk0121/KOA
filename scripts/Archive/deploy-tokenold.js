const hre = require("hardhat");
const fs = require("fs");
const path = require("path");
const { ethers } = require("hardhat");
const readline = require("readline");
const https = require("https");
const { execSync } = require("child_process");

// Create readline interface for user input
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

// Promisify readline.question for easier async/await usage
function promptQuestion(query) {
  return new Promise(resolve => rl.question(query, resolve));
}

// Function to fetch ETH price from CoinGecko API
async function fetchEthPrice() {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'api.coingecko.com',
      path: '/api/v3/simple/price?ids=ethereum&vs_currencies=usd',
      method: 'GET',
      headers: {
        'Accept': 'application/json'
      }
    };

    const req = https.request(options, (res) => {
      let data = '';

      res.on('data', (chunk) => {
        data += chunk;
      });

      res.on('end', () => {
        try {
          const parsedData = JSON.parse(data);
          if (parsedData.ethereum && parsedData.ethereum.usd) {
            resolve(parsedData.ethereum.usd);
          } else {
            reject(new Error("Could not parse ETH price from API response"));
          }
        } catch (e) {
          reject(new Error(`Error parsing API response: ${e.message}`));
        }
      });
    });

    req.on('error', (e) => {
      reject(new Error(`Error fetching ETH price: ${e.message}`));
    });

    req.end();
  });
}

// Function to calculate the tick for a target market cap
function calculateTickForMarketCap(targetMarketCapUSD, tokenSupply, ethPriceUSD, tickSpacing) {
  // Ensure all inputs are regular numbers, not BigInt
  const targetMarketCap = Number(targetMarketCapUSD);
  const supply = Number(tokenSupply);
  const ethPrice = Number(ethPriceUSD);
  const spacing = Number(tickSpacing);
  
  // Calculate required token price in USD
  const tokenPriceUSD = targetMarketCap / supply;
  
  // Convert to ETH price
  const tokenPriceETH = tokenPriceUSD / ethPrice;
  
  // Calculate exact tick using the Uniswap V3 formula
  // price = 1.0001^tick
  // so tick = log(price) / log(1.0001)
  const exactTick = Math.log(tokenPriceETH) / Math.log(1.0001);
  
  // Round to the nearest valid tick (multiple of tick spacing)
  const validTick = Math.round(exactTick / spacing) * spacing;
  
  // Calculate the actual price and market cap with this tick
  const actualPriceETH = Math.pow(1.0001, validTick);
  const actualPriceUSD = actualPriceETH * ethPrice;
  const actualMarketCapUSD = actualPriceUSD * supply;
  
  return {
    validTick,
    exactTick,
    actualPriceETH,
    actualPriceUSD,
    actualMarketCapUSD
  };
}

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

  // Get token deployment parameters from user
  console.log("\n=== Token Deployment Parameters ===");
  const tokenName = await promptQuestion("Enter token name: ");
  const tokenSymbol = await promptQuestion("Enter token symbol: ");
  
  let tokenSupply;
  try {
    const rawSupply = await promptQuestion("Enter token supply (default: 100000): ");
    tokenSupply = rawSupply.trim() === "" ? 
      ethers.parseEther("100000") : 
      ethers.parseEther(rawSupply);
    
    // Get the numeric value for calculations
    const tokenSupplyNumber = parseFloat(ethers.formatEther(tokenSupply));
    console.log(`Token supply: ${tokenSupplyNumber.toLocaleString()} tokens`);
  } catch (error) {
    console.error("Invalid token supply. Using default 100000.");
    tokenSupply = ethers.parseEther("100000");
  }
  
  // Get fee tier - restricted to 1% (10000) only
  let feeTier = 10000; // Force 1% fee tier
  console.log(`Using fee tier: ${feeTier} (1%)`);
  
  // Verify tick spacing for 1% fee tier
  let tickSpacing;
  try {
    const uniswapFactoryAddress = await koa.uniswapV3Factory();
    const uniswapFactory = await ethers.getContractAt("IUniswapV3Factory", uniswapFactoryAddress);
    tickSpacing = await uniswapFactory.feeAmountTickSpacing(feeTier);
    console.log(`Tick spacing for fee tier ${feeTier}: ${tickSpacing}`);
  } catch (error) {
    console.error("Error getting tick spacing:", error.message);
    // Set default tick spacing for 1% fee tier
    tickSpacing = 200; // Default for 1% fee tier
    console.log(`Using default tick spacing: ${tickSpacing} for fee tier ${feeTier}`);
  }

  // Fetch current ETH price
  let ethPriceUSD;
  try {
    console.log("\nFetching current ETH price...");
    ethPriceUSD = await fetchEthPrice();
    console.log(`Current ETH price: $${ethPriceUSD.toLocaleString()}`);
  } catch (error) {
    console.error("Error fetching ETH price:", error.message);
    const manualPrice = await promptQuestion("Enter ETH price in USD manually: ");
    ethPriceUSD = parseFloat(manualPrice);
    if (isNaN(ethPriceUSD) || ethPriceUSD <= 0) {
      console.error("Invalid ETH price. Using $3000 as fallback.");
      ethPriceUSD = 3000;
    }
  }
  
  // Get target market cap from user
  let targetMarketCapUSD;
  try {
    const rawMarketCap = await promptQuestion("Enter target market cap in USD (default: 14000): ");
    targetMarketCapUSD = rawMarketCap.trim() === "" ? 14000 : parseFloat(rawMarketCap);
    
    if (isNaN(targetMarketCapUSD) || targetMarketCapUSD <= 0) {
      throw new Error("Invalid market cap");
    }
    
    console.log(`Target market cap: $${targetMarketCapUSD.toLocaleString()}`);
  } catch (error) {
    console.error("Invalid market cap. Using default $14,000.");
    targetMarketCapUSD = 14000;
  }
  
  // Calculate the initial tick based on the target market cap
  // Convert tokenSupply from BigInt to regular number
  const tokenSupplyNumber = parseFloat(ethers.formatEther(tokenSupply));
  const tickResult = calculateTickForMarketCap(targetMarketCapUSD, tokenSupplyNumber, ethPriceUSD, tickSpacing);
  
  console.log(`\n=== Market Cap and Tick Calculations ===`);
  console.log(`Target market cap: $${targetMarketCapUSD.toLocaleString()}`);
  console.log(`Current ETH price: $${ethPriceUSD.toLocaleString()}`);
  console.log(`Token supply: ${tokenSupplyNumber.toLocaleString()} tokens`);
  console.log(`Calculated exact tick: ${tickResult.exactTick.toFixed(2)}`);
  console.log(`Adjusted tick (multiple of ${tickSpacing}): ${tickResult.validTick}`);
  console.log(`This sets token price to: ${tickResult.actualPriceETH.toFixed(10)} ETH ($${tickResult.actualPriceUSD.toFixed(6)})`);
  console.log(`Resulting market cap: $${tickResult.actualMarketCapUSD.toFixed(2)}`);
  
  // Offer to use the calculated tick or let user enter a custom one
  const useCalculatedTick = await promptQuestion(`\nUse calculated tick ${tickResult.validTick} for deployment? (y/n): `);
  
  let initialTick;
  if (useCalculatedTick.toLowerCase() === 'y') {
    initialTick = tickResult.validTick;
  } else {
    // Get initial tick from user
    const rawTick = await promptQuestion("Enter custom initial tick value: ");
    initialTick = parseInt(rawTick);
    
    // Validate the tick is a multiple of tick spacing
    if (initialTick % tickSpacing !== 0) {
      const adjustedTick = Math.round(initialTick / tickSpacing) * tickSpacing;
      console.warn(`Warning: ${initialTick} is not a multiple of ${tickSpacing}.`);
      
      const useAdjusted = await promptQuestion(`Use adjusted tick ${adjustedTick} instead? (y/n): `);
      if (useAdjusted.toLowerCase() === 'y') {
        initialTick = adjustedTick;
      } else {
        console.warn("Continuing with original tick. This may cause errors.");
      }
    }
    
    // Calculate and display the resulting price for this tick
    const tokenPriceETH = Math.pow(1.0001, initialTick);
    const tokenPriceUSD = tokenPriceETH * ethPriceUSD;
    const marketCapUSD = tokenPriceUSD * tokenSupplyNumber;
    
    console.log(`\nCustom tick ${initialTick} sets token price to: ${tokenPriceETH.toFixed(10)} ETH ($${tokenPriceUSD.toFixed(6)})`);
    console.log(`Resulting market cap: $${marketCapUSD.toFixed(2)}`);
  }
  
  console.log(`\nUsing initial tick: ${initialTick} (should be multiple of ${tickSpacing})`);
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
    rl.close();
    process.exit(1);
  }

  // Step 2: Deploy the token
  console.log("\nDeploying token...");
  
  // Get deployment fee from user
  let deploymentFee;
  try {
    const rawFee = await promptQuestion("Enter deployment fee in ETH (default: 0.0005): ");
    deploymentFee = rawFee.trim() === "" ? 
      ethers.parseEther("0.0005") : 
      ethers.parseEther(rawFee);
  } catch (error) {
    console.error("Invalid deployment fee. Using default 0.0005 ETH.");
    deploymentFee = ethers.parseEther("0.0005");
  }
  
  console.log(`Using deployment fee: ${ethers.formatEther(deploymentFee)} ETH`);
  
  // Final confirmation
  const proceed = await promptQuestion("\nReady to deploy token with these parameters? (y/n): ");
  if (proceed.toLowerCase() !== 'y') {
    console.log("Aborting deployment");
    rl.close();
    process.exit(0);
  }
  
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
      
      const continueAnyway = await promptQuestion("\nDo you want to continue with deployment despite gas estimation failure? (y/n): ");
      if (continueAnyway.toLowerCase() !== 'y') {
        console.log("Aborting deployment due to gas estimation failure");
        rl.close();
        process.exit(0);
      }
      
      await deployTokenAnyway(koa, params, deploymentFee);
      rl.close();
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
        initialTick: initialTick,
        targetMarketCap: targetMarketCapUSD,
        ethPriceAtDeployment: ethPriceUSD,
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
      
      // Get verification instructions for the token
      console.log("\n=== Token Verification Instructions ===");
      console.log(`To verify your token on Basescan (${network} network):`);
      
      // Get Token contract ABI and bytecode for verification
      const tokenFactory = await ethers.getContractFactory("Token");
      const tokenAbi = tokenFactory.interface.formatJson();
      
      // Save verification info
      const verificationInfo = {
        network,
        tokenAddress: event.args.tokenAddress,
        constructorArgs: [
          event.args.name,
          event.args.symbol,
          event.args.supply.toString()
        ],
        compilerVersion: "v0.8.19+commit.7dd6d404", // Update this with your actual Solidity version
        optimization: true,
        runs: 200 // Standard optimization runs
      };
      
      const verificationPath = path.join(tokensDir, `${tokenSymbol}-${network}-verification.json`);
      fs.writeFileSync(verificationPath, JSON.stringify(verificationInfo, null, 2));
      
      // For Base network
      let verifyCommand;
      let explorerUrl;
      if (network === 'base' || network === 'baseSepolia') {
        verifyCommand = `npx hardhat verify --network ${network} ${event.args.tokenAddress} "${event.args.name}" "${event.args.symbol}" ${event.args.supply.toString()}`;
        explorerUrl = network === 'base' 
          ? `https://basescan.org/address/${event.args.tokenAddress}` 
          : `https://sepolia.basescan.org/address/${event.args.tokenAddress}`;
      } else if (network === 'ethereum') {
        verifyCommand = `npx hardhat verify --network ${network} ${event.args.tokenAddress} "${event.args.name}" "${event.args.symbol}" ${event.args.supply.toString()}`;
        explorerUrl = `https://etherscan.io/address/${event.args.tokenAddress}`;
      } else {
        verifyCommand = `npx hardhat verify --network ${network} ${event.args.tokenAddress} "${event.args.name}" "${event.args.symbol}" ${event.args.supply.toString()}`;
        explorerUrl = `https://explorer.${network}.network/address/${event.args.tokenAddress}`;
      }
      
      console.log("\nAutomatic verification command:");
      console.log(verifyCommand);
      
      console.log("\nToken Explorer URL:");
      console.log(explorerUrl);
      
      // Add verification script
      const verifyScript = `
const hre = require("hardhat");

async function main() {
  console.log("Verifying token contract...");
  
  try {
    await hre.run("verify:verify", {
      address: "${event.args.tokenAddress}",
      constructorArguments: [
        "${event.args.name}",
        "${event.args.symbol}",
        "${event.args.supply.toString()}"
      ],
    });
    
    console.log("Verification successful!");
  } catch (error) {
    console.error("Verification failed:", error);
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
      `;
      
      const verifyScriptPath = path.join(__dirname, `verify-${tokenSymbol}-${network}.js`);
      fs.writeFileSync(verifyScriptPath, verifyScript);
      console.log(`\nVerification script created at: ${verifyScriptPath}`);
      console.log(`Run with: npx hardhat run ${verifyScriptPath} --network ${network}`);
      
      // Ask if user wants to verify now
      const verifyNow = await promptQuestion("\nWould you like to verify the token contract now? (y/n): ");
      if (verifyNow.toLowerCase() === 'y') {
        console.log("\nAttempting to verify token contract on Basescan...");
        try {
          // Wait a few seconds for the blockchain to settle
          console.log("Waiting 10 seconds for the blockchain to index the contract...");
          await new Promise(resolve => setTimeout(resolve, 10000));
          
          // Execute verification command
          execSync(verifyCommand, { stdio: 'inherit' });
          console.log("\nVerification command completed!");
          console.log(`View your verified contract at: ${explorerUrl}`);
        } catch (verifyError) {
          console.error("\nVerification failed:", verifyError.message);
          console.log("You can try manual verification later using the command above.");
        }
      }
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
  rl.close();
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
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("Unhandled error in main:", error);
    process.exit(1);
  });