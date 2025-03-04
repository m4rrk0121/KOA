// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {TickMath} from "./libraries/TickMath.sol";

import {INonfungiblePositionManager, IUniswapV3Factory, IMultiPositionLiquidityLocker, ExactInputSingleParams, ISwapRouter, IUniswapV3Pool} from "./Interface.sol";
import {Bytes32AddressLib} from "./Bytes32AddressLib.sol";

contract Token is ERC20 {
    constructor(
        string memory name_,
        string memory symbol_,
        uint256 maxSupply_
    ) ERC20(name_, symbol_) {
        _mint(msg.sender, maxSupply_);
    }

    function decimals() public view virtual override returns (uint8) {
        return 18;
    }
}

contract KOA is Ownable {
    using TickMath for int24;
    using Bytes32AddressLib for bytes32;

    address public taxCollector;
    uint64 public defaultLockingPeriod = 86400; // 1 day in seconds
    uint8 public lpFeesCut = 0; // 0% - No LP fees cut
    uint8 public protocolCut = 0; // 0% - No protocol cut on deployment
    IMultiPositionLiquidityLocker public liquidityLocker;

    address public weth;
    IUniswapV3Factory public uniswapV3Factory;
    INonfungiblePositionManager public positionManager;
    address public swapRouter;

    event TokenCreated(
        address tokenAddress,
        uint256 lpNftId,
        address deployer,
        string name,
        string symbol,
        uint256 supply,
        address recipient,
        uint256 recipientAmount
    );

    // Debug events
    event DebugStep(string step);
    event DebugValues(string name, uint256 value);
    event DebugAddress(string name, address addr);
    event DebugIntValues(string name, int256 value);

    constructor(
        address taxCollector_,
        address weth_,
        address locker_,
        address uniswapV3Factory_,
        address positionManager_,
        address swapRouter_
    ) Ownable(msg.sender) {
        taxCollector = taxCollector_;
        weth = weth_;
        liquidityLocker = IMultiPositionLiquidityLocker(locker_);
        uniswapV3Factory = IUniswapV3Factory(uniswapV3Factory_);
        positionManager = INonfungiblePositionManager(positionManager_);
        swapRouter = swapRouter_;
    }

    function deployToken(
        string calldata _name,
        string calldata _symbol,
        uint256 _supply,
        int24 _initialTick,
        uint24 _fee,
        bytes32 _salt,
        address _deployer,
        address _recipient,
        uint256 _recipientAmount
    ) external payable returns (Token token, uint256 tokenId) {
        emit DebugStep("Starting deployToken");
        
        int24 tickSpacing = uniswapV3Factory.feeAmountTickSpacing(_fee);
        emit DebugIntValues("tickSpacing", int256(tickSpacing));
        emit DebugIntValues("initialTick", int256(_initialTick));

        require(
            tickSpacing != 0 && _initialTick % tickSpacing == 0,
            "Invalid tick or tick spacing"
        );
        emit DebugStep("Tick validation passed");

        // Validate recipient amount
        require(_recipientAmount <= _supply, "Recipient amount exceeds supply");
        uint256 lpAmount = _supply - _recipientAmount;
        emit DebugValues("Recipient amount", _recipientAmount);
        emit DebugValues("LP amount", lpAmount);

        token = new Token{salt: keccak256(abi.encode(msg.sender, _salt))}(
            _name,
            _symbol,
            _supply
        );
        emit DebugAddress("Token deployed at", address(token));

        require(address(token) < weth, "Token address must be less than WETH address");
        require(_supply > 0, "Supply must be greater than zero");
        emit DebugStep("Token checks passed");

        // Transfer the recipient allocation if specified
        if (_recipientAmount > 0 && _recipient != address(0)) {
            emit DebugStep("Transferring recipient allocation");
            token.transfer(_recipient, _recipientAmount);
            emit DebugAddress("Recipient", _recipient);
            emit DebugValues("Amount transferred", _recipientAmount);
        }

        uint160 sqrtPriceX96 = _initialTick.getSqrtRatioAtTick();
        emit DebugValues("sqrtPriceX96", sqrtPriceX96);
        
        // Create pool
        emit DebugStep("Creating pool");
        address pool;
        try uniswapV3Factory.createPool(address(token), weth, _fee) returns (address _pool) {
            pool = _pool;
            emit DebugAddress("Pool created at", pool);
        } catch Error(string memory reason) {
            emit DebugStep(string(abi.encodePacked("Pool creation failed: ", reason)));
            revert(string(abi.encodePacked("Pool creation failed: ", reason)));
        } catch {
            emit DebugStep("Pool creation failed with unknown error");
            revert("Pool creation failed with unknown error");
        }
        
        // Initialize pool - FIXED: Now using IUniswapV3Pool interface
        emit DebugStep("Initializing pool");
        try IUniswapV3Pool(pool).initialize(sqrtPriceX96) {
            emit DebugStep("Pool initialized");
        } catch Error(string memory reason) {
            emit DebugStep(string(abi.encodePacked("Pool initialization failed: ", reason)));
            revert(string(abi.encodePacked("Pool initialization failed: ", reason)));
        } catch {
            emit DebugStep("Pool initialization failed with unknown error");
            revert("Pool initialization failed with unknown error");
        }

        // Only use LP amount for creating the position
        INonfungiblePositionManager.MintParams
            memory params = INonfungiblePositionManager.MintParams(
                address(token),
                weth,
                _fee,
                _initialTick,
                maxUsableTick(tickSpacing),
                lpAmount, // Use LP amount instead of total supply
                0,
                0,
                0,
                address(this), // LP NFT goes to this contract first
                block.timestamp
            );

        token.approve(address(positionManager), lpAmount);
        emit DebugStep("Token approved for position manager");
        
        try positionManager.mint(params) returns (uint256 _tokenId, uint128 liquidity, uint256 amount0, uint256 amount1) {
            tokenId = _tokenId;
            emit DebugStep("Position minted");
            emit DebugValues("Liquidity", uint256(liquidity));
            emit DebugValues("Amount0", amount0);
            emit DebugValues("Amount1", amount1);
        } catch Error(string memory reason) {
            emit DebugStep(string(abi.encodePacked("Position minting failed: ", reason)));
            revert(string(abi.encodePacked("Position minting failed: ", reason)));
        } catch {
            emit DebugStep("Position minting failed with unknown error");
            revert("Position minting failed with unknown error");
        }

        // Transfer the LP NFT to the locker
        emit DebugStep("Transferring NFT to locker");
        positionManager.safeTransferFrom(address(this), address(liquidityLocker), tokenId);
        
        // Initialize the position in the locker - with explicit type conversion
        // lpFeesCut is now 0 so deployer gets 100% of fees
        emit DebugStep("Initializing position in locker");
        liquidityLocker.initializePosition(
            tokenId,
            _deployer,
            uint64(block.timestamp) + defaultLockingPeriod, // Explicit type conversion here
            lpFeesCut
        );

        // No protocol fees now, use all ETH for token swap
        uint256 remainingFundsToBuyTokens = msg.value;
        emit DebugValues("Remaining funds for tokens", remainingFundsToBuyTokens);

        if (remainingFundsToBuyTokens > 0) {
            emit DebugStep("Executing token swap");
            ExactInputSingleParams memory swapParams = ExactInputSingleParams({
                tokenIn: weth, // The token we are exchanging from (ETH wrapped as WETH)
                tokenOut: address(token), // The token we are exchanging to
                fee: _fee, // The pool fee
                recipient: msg.sender, // The recipient address
                amountIn: remainingFundsToBuyTokens, // The amount of ETH (WETH) to be swapped
                amountOutMinimum: 0, // Minimum amount of DAI to receive
                sqrtPriceLimitX96: 0 // No price limit
            });

            // The call to `exactInputSingle` executes the swap.
            try ISwapRouter(swapRouter).exactInputSingle{
                value: remainingFundsToBuyTokens
            }(swapParams) returns (uint256 amountOut) {
                emit DebugValues("Swap amount out", amountOut);
            } catch Error(string memory reason) {
                emit DebugStep(string(abi.encodePacked("Swap failed: ", reason)));
                // Continue execution even if swap fails
            } catch {
                emit DebugStep("Swap failed with unknown error");
                // Continue execution even if swap fails
            }
        }

        emit TokenCreated(
            address(token),
            tokenId,
            msg.sender,
            _name,
            _symbol,
            _supply,
            _recipient,
            _recipientAmount
        );
    }

    function initialSwapTokens(address token, uint24 _fee) public payable {
        require(msg.value > 0, "Must send ETH");
        
        ExactInputSingleParams memory swapParams = ExactInputSingleParams({
            tokenIn: weth,
            tokenOut: token,
            fee: _fee,
            recipient: msg.sender,
            amountIn: msg.value,
            amountOutMinimum: 0,
            sqrtPriceLimitX96: 0
        });

        ISwapRouter(swapRouter).exactInputSingle{value: msg.value}(swapParams);
    }

    function predictToken(
        address deployer,
        string calldata name,
        string calldata symbol,
        uint256 supply,
        bytes32 salt
    ) public view returns (address) {
        bytes32 create2Salt = keccak256(abi.encode(deployer, salt));
        return
            keccak256(
                abi.encodePacked(
                    bytes1(0xFF),
                    address(this),
                    create2Salt,
                    keccak256(
                        abi.encodePacked(
                            type(Token).creationCode,
                            abi.encode(name, symbol, supply)
                        )
                    )
                )
            ).fromLast20Bytes();
    }

    function generateSalt(
        address deployer,
        string calldata name,
        string calldata symbol,
        uint256 supply
    ) external view returns (bytes32 salt, address token) {
        for (uint256 i; ; i++) {
            salt = bytes32(i);
            token = predictToken(deployer, name, symbol, supply, salt);
            if (token < weth && token.code.length == 0) {
                break;
            }
        }
    }

    function updateTaxCollector(address newCollector) external onlyOwner {
        taxCollector = newCollector;
    }

    function updateLiquidityLocker(address newLocker) external onlyOwner {
        liquidityLocker = IMultiPositionLiquidityLocker(newLocker);
    }

    function updateDefaultLockingPeriod(uint64 newPeriod) external onlyOwner {
        defaultLockingPeriod = newPeriod;
    }

    function updateLpFeesCut(uint8 newFee) external onlyOwner {
        lpFeesCut = newFee;
    }

    // Tax rate update function removed
    
    function updateProtocolCut(uint8 newCut) external onlyOwner {
        protocolCut = newCut;
    }
}

/// @notice Given a tickSpacing, compute the maximum usable tick
function maxUsableTick(int24 tickSpacing) pure returns (int24) {
    unchecked {
        return (TickMath.MAX_TICK / tickSpacing) * tickSpacing;
    }
}