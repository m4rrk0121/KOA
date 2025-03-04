// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import {IERC721Receiver} from "@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol";

interface INonfungiblePositionManager {
    struct CollectParams {
        uint256 tokenId;
        address recipient;
        uint128 amount0Max;
        uint128 amount1Max;
    }
    
    function collect(CollectParams calldata params)
        external
        returns (uint256 amount0, uint256 amount1);
        
    function positions(uint256 tokenId)
        external
        view
        returns (
            uint96 nonce,
            address operator,
            address token0,
            address token1,
            uint24 fee,
            int24 tickLower,
            int24 tickUpper,
            uint128 liquidity,
            uint256 feeGrowthInside0LastX128,
            uint256 feeGrowthInside1LastX128,
            uint128 tokensOwed0,
            uint128 tokensOwed1
        );

    function safeTransferFrom(
        address from,
        address to,
        uint256 tokenId
    ) external;
}

/**
 * @title MultiPositionLiquidityLocker
 * @notice A gas-efficient implementation that manages multiple LP positions
 */
contract MultiPositionLiquidityLocker is Ownable, IERC721Receiver {
    // Position information
    struct PositionInfo {
        address owner;
        uint64 unlockTime;
        uint8 lpFeesCut;
        bool initialized;
    }

    // Address of the Uniswap V3 position manager
    address public positionManager;
    
    // Default settings
    uint8 public defaultLpFeesCut = 50; // 50 / 1000 -> 5%
    uint64 public defaultLockingPeriod = 1; // Default unlock period
    
    // Protocol fee recipient
    address public feeCollector;
    
    // Mapping from tokenId to position info
    mapping(uint256 => PositionInfo) public positions;
    
    // Mapping from user address to their token IDs
    mapping(address => uint256[]) public userTokenIds;
    
    // Events
    event PositionLocked(address indexed owner, uint256 indexed tokenId, uint64 unlockTime);
    event FeesCollected(uint256 indexed tokenId, address token0, address token1, uint256 amount0, uint256 amount1);
    event BatchFeesCollected(address indexed owner, uint256 count, uint256 totalAmount0, uint256 totalAmount1);
    event PositionWithdrawn(address indexed owner, uint256 indexed tokenId);
    event Received(address indexed from, uint256 tokenId);
    
    constructor(address _positionManager, address _feeCollector) Ownable(msg.sender) {
        positionManager = _positionManager;
        feeCollector = _feeCollector;
    }
    
    /**
     * @notice Initialize a new position in the locker
     * @param tokenId The NFT token ID to lock
     * @param owner The owner of the position
     * @param unlockTime The timestamp when the position can be withdrawn
     * @param lpFeesCut The percentage of fees to take (in thousandths)
     */
    function initializePosition(
        uint256 tokenId,
        address owner,
        uint64 unlockTime,
        uint8 lpFeesCut
    ) external {
        require(!positions[tokenId].initialized, "Already initialized");
        
        positions[tokenId] = PositionInfo({
            owner: owner,
            unlockTime: unlockTime,
            lpFeesCut: lpFeesCut,
            initialized: true
        });
        
        userTokenIds[owner].push(tokenId);
        
        emit PositionLocked(owner, tokenId, unlockTime);
    }
    
    /**
     * @notice Collect fees for a given position
     * @param tokenId The NFT token ID
     */
    function collectFees(uint256 tokenId) public returns (uint256 amount0, uint256 amount1) {
        PositionInfo memory position = positions[tokenId];
        require(position.initialized, "Position not initialized");
        require(msg.sender == position.owner, "Not position owner");
        
        INonfungiblePositionManager manager = INonfungiblePositionManager(positionManager);
        
        // Collect all available fees
        (amount0, amount1) = manager.collect(
            INonfungiblePositionManager.CollectParams({
                tokenId: tokenId,
                recipient: address(this),
                amount0Max: type(uint128).max,
                amount1Max: type(uint128).max
            })
        );
        
        if (amount0 == 0 && amount1 == 0) {
            return (0, 0);
        }
        
        // Get token addresses from the position
        (
            ,
            ,
            address token0,
            address token1,
            ,
            ,
            ,
            ,
            ,
            ,
            ,
        ) = manager.positions(tokenId);
        
        // Calculate owner's share
        uint256 ownerAmount0 = amount0 * (1000 - position.lpFeesCut) / 1000;
        uint256 ownerAmount1 = amount1 * (1000 - position.lpFeesCut) / 1000;
        
        // Calculate protocol fee
        uint256 protocolAmount0 = amount0 - ownerAmount0;
        uint256 protocolAmount1 = amount1 - ownerAmount1;
        
        // Transfer owner's share
        if (ownerAmount0 > 0) {
            IERC20(token0).transfer(position.owner, ownerAmount0);
        }
        
        if (ownerAmount1 > 0) {
            IERC20(token1).transfer(position.owner, ownerAmount1);
        }
        
        // Transfer protocol fees
        if (protocolAmount0 > 0) {
            IERC20(token0).transfer(feeCollector, protocolAmount0);
        }
        
        if (protocolAmount1 > 0) {
            IERC20(token1).transfer(feeCollector, protocolAmount1);
        }
        
        emit FeesCollected(tokenId, token0, token1, amount0, amount1);
        
        return (amount0, amount1);
    }
    
    /**
     * @notice Collect fees for all positions owned by the caller
     * @return positionsCount Number of positions processed
     * @return totalAmount0 Total amount of token0 collected
     * @return totalAmount1 Total amount of token1 collected
     */
    function collectAllFees() external returns (uint256 positionsCount, uint256 totalAmount0, uint256 totalAmount1) {
        uint256[] memory tokenIds = userTokenIds[msg.sender];
        positionsCount = tokenIds.length;
        
        for (uint256 i = 0; i < positionsCount; i++) {
            // Check if caller is still the owner (safeguard)
            if (positions[tokenIds[i]].owner == msg.sender && positions[tokenIds[i]].initialized) {
                (uint256 amount0, uint256 amount1) = collectFees(tokenIds[i]);
                totalAmount0 += amount0;
                totalAmount1 += amount1;
            }
        }
        
        emit BatchFeesCollected(msg.sender, positionsCount, totalAmount0, totalAmount1);
        
        return (positionsCount, totalAmount0, totalAmount1);
    }
    
    /**
     * @notice Collect fees for specific positions owned by the caller
     * @param tokenIds Array of token IDs to collect fees from
     * @return processedCount Number of positions processed
     * @return totalAmount0 Total amount of token0 collected
     * @return totalAmount1 Total amount of token1 collected  
     */
    function collectSelectedFees(uint256[] calldata tokenIds) external returns (uint256 processedCount, uint256 totalAmount0, uint256 totalAmount1) {
        processedCount = tokenIds.length;
        
        for (uint256 i = 0; i < processedCount; i++) {
            // Check if caller is the owner
            if (positions[tokenIds[i]].owner == msg.sender && positions[tokenIds[i]].initialized) {
                (uint256 amount0, uint256 amount1) = collectFees(tokenIds[i]);
                totalAmount0 += amount0;
                totalAmount1 += amount1;
            }
        }
        
        emit BatchFeesCollected(msg.sender, processedCount, totalAmount0, totalAmount1);
        
        return (processedCount, totalAmount0, totalAmount1);
    }
    
    /**
     * @notice Withdraw a position after the unlock time
     * @param tokenId The NFT token ID to withdraw
     */
    function withdraw(uint256 tokenId) external {
        PositionInfo memory position = positions[tokenId];
        require(position.initialized, "Position not initialized");
        require(msg.sender == position.owner, "Not position owner");
        require(block.timestamp >= position.unlockTime, "Still locked");
        
        // Remove from initialized positions
        delete positions[tokenId];
        
        // Transfer the NFT back to the owner
        INonfungiblePositionManager(positionManager).safeTransferFrom(
            address(this),
            position.owner,
            tokenId
        );
        
        emit PositionWithdrawn(position.owner, tokenId);
    }
    
    /**
     * @notice Get all token IDs for a user
     * @param user The user address
     */
    function getPositionsForUser(address user) external view returns (uint256[] memory) {
        return userTokenIds[user];
    }
    
    /**
     * @notice Check if a user owns a specific position
     * @param user The user address
     * @param tokenId The NFT token ID
     */
    function isPositionOwner(address user, uint256 tokenId) external view returns (bool) {
        return positions[tokenId].owner == user;
    }
    
    /**
     * @notice Update protocol fee collector
     * @param _feeCollector New fee collector address
     */
    function updateFeeCollector(address _feeCollector) external onlyOwner {
        feeCollector = _feeCollector;
    }
    
    /**
     * @notice Update default locking period
     * @param _defaultLockingPeriod New default locking period
     */
    function updateDefaultLockingPeriod(uint64 _defaultLockingPeriod) external onlyOwner {
        defaultLockingPeriod = _defaultLockingPeriod;
    }
    
    /**
     * @notice Update default LP fees cut
     * @param _defaultLpFeesCut New default LP fees cut
     */
    function updateDefaultLpFeesCut(uint8 _defaultLpFeesCut) external onlyOwner {
        defaultLpFeesCut = _defaultLpFeesCut;
    }
    
    /**
     * @notice Allows for receiving NFTs
     */
    function onERC721Received(
        address,
        address from,
        uint256 id,
        bytes calldata
    ) external override returns (bytes4) {
        emit Received(from, id);
        return IERC721Receiver.onERC721Received.selector;
    }
}