
const hre = require("hardhat");

async function main() {
  console.log("Verifying token contract...");
  
  try {
    await hre.run("verify:verify", {
      address: "0x03d6764063b2E78eF2501dcC7a1EfB0Ba4dd4D10",
      constructorArguments: [
        "Jesstardio",
        "Jesstardio",
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
      