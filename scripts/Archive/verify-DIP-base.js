
const hre = require("hardhat");

async function main() {
  console.log("Verifying token contract...");
  
  try {
    await hre.run("verify:verify", {
      address: "0x1402CdD9869D6503B91A28A405688ab921112f17",
      constructorArguments: [
        "Moar Dip",
        "DIP",
        "420690000000000000000000000000"
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
      