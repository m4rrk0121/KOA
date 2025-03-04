
const hre = require("hardhat");

async function main() {
  console.log("Verifying token contract...");
  
  try {
    await hre.run("verify:verify", {
      address: "0x3b3E374628FA7593dD6BbC7E463B3Ba224a44623",
      constructorArguments: [
        "Crypto Summit",
        "Summit",
        "1000000000000000000000000000"
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
      