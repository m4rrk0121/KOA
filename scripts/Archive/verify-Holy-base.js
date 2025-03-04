
const hre = require("hardhat");

async function main() {
  console.log("Verifying token contract...");
  
  try {
    await hre.run("verify:verify", {
      address: "0x11E4C9FC25D4CA373bA332b701b74f0beb6F7d62",
      constructorArguments: [
        "Holy Grail",
        "Holy",
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
      