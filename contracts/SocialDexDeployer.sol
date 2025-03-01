// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {TickMath} from "./libraries/TickMath.sol";

import {INonfungiblePositionManager, IUniswapV3Factory, ExactInputSingleParams, ISwapRouter} from "./Interface.sol";
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
    uint8 public taxRate = 25; // 25 / 1000 -> 2.5 %
    uint8 public protocolCut = 30; // 3 / 100 -> 3%

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
        uint256 supply
    );

    constructor(
        address taxCollector_,
        address weth_,
        address uniswapV3Factory_,
        address positionManager_,
        address swapRouter_
    ) Ownable(msg.sender) {
        taxCollector = taxCollector_;
        weth = weth_;
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
        address /* _deployer */ // Commented out to remove warning
    ) external payable returns (Token token, uint256 tokenId) {
        int24 tickSpacing = uniswapV3Factory.feeAmountTickSpacing(_fee);

        require(
            tickSpacing != 0 && _initialTick % tickSpacing == 0,
            "Invalid tick"
        );

        token = new Token{salt: keccak256(abi.encode(msg.sender, _salt))}(
            _name,
            _symbol,
            _supply
        );

        require(address(token) < weth, "Invalid salt");
        require(_supply >= _supply, "Invalid supply amount");

        uint160 sqrtPriceX96 = _initialTick.getSqrtRatioAtTick();
        address pool = uniswapV3Factory.createPool(address(token), weth, _fee);
        IUniswapV3Factory(pool).initialize(sqrtPriceX96);

        INonfungiblePositionManager.MintParams
            memory params = INonfungiblePositionManager.MintParams(
                address(token),
                weth,
                _fee,
                _initialTick,
                maxUsableTick(tickSpacing),
                _supply,
                0,
                0,
                0,
                msg.sender, // LP NFT goes directly to the deployer
                block.timestamp
            );

        token.approve(address(positionManager), _supply);
        (tokenId, , , ) = positionManager.mint(params);

        uint256 protocolFees = (msg.value * protocolCut) / 1000;
        uint256 remainingFundsToBuyTokens = msg.value - protocolFees;

        if (msg.value > 0) {
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
            ISwapRouter(swapRouter).exactInputSingle{
                value: remainingFundsToBuyTokens
            }(swapParams);
        }

        (bool success, ) = payable(taxCollector).call{value: protocolFees}("");

        if (!success) {
            revert("Failed to send protocol fees");
        }

        emit TokenCreated(
            address(token),
            tokenId,
            msg.sender,
            _name,
            _symbol,
            _supply
        );
    }

    function initialSwapTokens(address token, uint24 _fee) public payable {
        ExactInputSingleParams memory swapParams = ExactInputSingleParams({
            tokenIn: weth, // The token we are exchanging from (ETH wrapped as WETH)
            tokenOut: address(token), // The token we are exchanging to
            fee: _fee, // The pool fee
            recipient: msg.sender, // The recipient address
            amountIn: msg.value, // The amount of ETH (WETH) to be swapped
            amountOutMinimum: 0, // Minimum amount of DAI to receive
            sqrtPriceLimitX96: 0 // No price limit
        });

        // The call to `exactInputSingle` executes the swap.
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

    function updateTaxRate(uint8 newRate) external onlyOwner {
        taxRate = newRate;
    }
    
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