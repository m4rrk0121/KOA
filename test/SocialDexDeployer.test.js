const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("SocialDexDeployer", function () {
  let socialDexDeployer;
  let owner, deployer, taxCollector;
  let dummyWeth, dummyUniswapFactory, dummyPositionManager, dummySwapRouter;

  beforeEach(async function () {
    // Get signers
    [owner, deployer, taxCollector, dummyWeth, dummyUniswapFactory, dummyPositionManager, dummySwapRouter] = await ethers.getSigners();
    
    // Deploy SocialDexDeployer
    const SocialDexDeployer = await ethers.getContractFactory("SocialDexDeployer");
    socialDexDeployer = await SocialDexDeployer.deploy(
      taxCollector.address,
      dummyWeth.address,
      dummyUniswapFactory.address,
      dummyPositionManager.address,
      dummySwapRouter.address
    );
  });

  it("Should initialize with correct parameters", async function () {
    expect(await socialDexDeployer.taxCollector()).to.equal(taxCollector.address);
    expect(await socialDexDeployer.weth()).to.equal(dummyWeth.address);
    expect(await socialDexDeployer.uniswapV3Factory()).to.equal(dummyUniswapFactory.address);
    expect(await socialDexDeployer.positionManager()).to.equal(dummyPositionManager.address);
    expect(await socialDexDeployer.swapRouter()).to.equal(dummySwapRouter.address);
  });
  
  it("Should allow owner to update tax collector", async function () {
    await socialDexDeployer.updateTaxCollector(deployer.address);
    expect(await socialDexDeployer.taxCollector()).to.equal(deployer.address);
  });
  
  it("Should allow owner to update tax rate", async function () {
    const newRate = 30; // 3%
    await socialDexDeployer.updateTaxRate(newRate);
    expect(await socialDexDeployer.taxRate()).to.equal(newRate);
  });
  
  it("Should allow owner to update protocol cut", async function () {
    const newCut = 35; // 3.5%
    await socialDexDeployer.updateProtocolCut(newCut);
    expect(await socialDexDeployer.protocolCut()).to.equal(newCut);
  });
});