
const hre = require("hardhat");

async function main() {
  console.log("Verifying token contract...");
  
  try {
    await hre.run("verify:verify", {
      address: "0x0C2E2306Bf04F7421D863c4D6Eb0D4ca05d50ea1",
      constructorArguments: [
        "Base Big Dick",
        "BBD",
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
      