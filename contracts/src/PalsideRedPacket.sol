// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {SignatureChecker} from "@openzeppelin/contracts/utils/cryptography/SignatureChecker.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @notice Token escrow: the signer authorizes recipients, never amounts or refund destinations.
contract PalsideRedPacket is EIP712, ReentrancyGuard {
    using SafeERC20 for IERC20;

    enum Kind {
        Team,
        Invitation,
        Room
    }

    struct Packet {
        address sender;
        IERC20 token;
        Kind kind;
        uint32 count;
        uint32 claimedCount;
        uint256 total;
        uint256 remaining;
        uint256 equalAmount;
        uint256 expiresAt;
        bytes32 allocationHash;
        bool refunded;
    }

    struct Claim {
        bytes32 packetId;
        address recipient;
        uint256 nonce;
        uint256 deadline;
    }

    bytes32 public constant CLAIM_TYPEHASH =
        keccak256("Claim(bytes32 packetId,address recipient,uint256 nonce,uint256 deadline)");
    uint256 public constant MIN_SHARE = 1 ether;
    uint32 public constant MAX_COUNT = 100;
    /// @dev Grabs close at the product lifetime; the escrow stays open this long after it so queued claims still settle.
    uint256 public constant SETTLEMENT_WINDOW = 2 hours;
    address public immutable claimSigner;
    mapping(bytes32 => Packet) public packets;
    mapping(bytes32 => mapping(address => bool)) public hasClaimed;
    mapping(address => mapping(uint256 => bool)) public usedNonces;

    event PacketCreated(
        bytes32 indexed packetId,
        address indexed sender,
        address indexed token,
        uint8 kind,
        uint256 total,
        uint32 count,
        uint256 equalAmount,
        bytes32 allocationHash,
        uint256 expiresAt
    );
    event PacketClaimed(
        bytes32 indexed packetId, address indexed recipient, uint32 index, uint256 amount, uint256 nonce
    );
    event PacketRefunded(bytes32 indexed packetId, address indexed sender, uint256 amount);

    error InvalidConfiguration();
    error InvalidPacket();
    error PacketUnavailable();
    error InvalidClaim();
    error InvalidAllocation();
    error Unauthorized();
    error UnsupportedToken();

    constructor(address signer_) EIP712("PalsideRedPacket", "1") {
        if (signer_ == address(0)) revert InvalidConfiguration();
        claimSigner = signer_;
    }

    /// @dev Namespacing the id by the sender prevents another address from occupying it first.
    function packetIdFor(address sender, bytes32 salt) public pure returns (bytes32) {
        return keccak256(abi.encode(sender, salt));
    }

    /// @dev For random shares commit H(id,uint32(0),amount0,salt0,H(id,uint32(1),amount1,salt1,...,0)).
    /// The sender keeps future preimages private. Equal allocations use a zero commitment.
    function createPacket(
        IERC20 token,
        bytes32 salt,
        Kind kind,
        uint256 total,
        uint32 count,
        uint256 equalAmount,
        bytes32 allocationHash
    ) external nonReentrant returns (bytes32 packetId) {
        if (address(token).code.length == 0) revert UnsupportedToken();
        packetId = packetIdFor(msg.sender, salt);
        if (
            packets[packetId].sender != address(0) || count == 0 || count > MAX_COUNT
                || total < uint256(count) * MIN_SHARE
        ) revert InvalidPacket();
        if (equalAmount != 0) {
            if (
                kind == Kind.Room || equalAmount < MIN_SHARE || equalAmount > total / count
                    || equalAmount * count != total || allocationHash != bytes32(0)
            ) revert InvalidPacket();
        } else if (kind == Kind.Invitation || allocationHash == bytes32(0)) {
            revert InvalidPacket();
        }
        uint256 duration = kind == Kind.Team ? 1 days : kind == Kind.Invitation ? 7 days : 1 hours;
        uint256 expiresAt = block.timestamp + duration + SETTLEMENT_WINDOW;
        packets[packetId] =
            Packet(msg.sender, token, kind, count, 0, total, total, equalAmount, expiresAt, allocationHash, false);
        uint256 beforeBalance = token.balanceOf(address(this));
        token.safeTransferFrom(msg.sender, address(this), total);
        if (token.balanceOf(address(this)) - beforeBalance != total) revert UnsupportedToken();
        emit PacketCreated(packetId, msg.sender, address(token), uint8(kind), total, count, equalAmount, allocationHash, expiresAt);
    }

    function claimDigest(Claim calldata voucher) public view returns (bytes32) {
        return _hashTypedDataV4(
            keccak256(abi.encode(CLAIM_TYPEHASH, voucher.packetId, voucher.recipient, voucher.nonce, voucher.deadline))
        );
    }

    /// @notice Any relayer may submit, but funds only go to the signed recipient.
    /// A stale concurrent allocation reverts without consuming the voucher or its nonce.
    function claim(
        Claim calldata voucher,
        uint256 amount,
        bytes32 allocationSalt,
        bytes32 nextAllocationHash,
        bytes calldata signature
    ) external nonReentrant {
        _claim(voucher, amount, allocationSalt, nextAllocationHash, signature);
    }

    /// @notice Settles shares already assigned off-chain, in allocation order, in one transaction.
    function claimBatch(
        Claim[] calldata vouchers,
        uint256[] calldata amounts,
        bytes32[] calldata allocationSalts,
        bytes32[] calldata nextAllocationHashes,
        bytes[] calldata signatures
    ) external nonReentrant {
        uint256 length = vouchers.length;
        if (
            length == 0 || amounts.length != length || allocationSalts.length != length
                || nextAllocationHashes.length != length || signatures.length != length
        ) revert InvalidClaim();
        for (uint256 i; i < length; ++i) {
            _claim(vouchers[i], amounts[i], allocationSalts[i], nextAllocationHashes[i], signatures[i]);
        }
    }

    function _claim(
        Claim calldata voucher,
        uint256 amount,
        bytes32 allocationSalt,
        bytes32 nextAllocationHash,
        bytes calldata signature
    ) private {
        Packet storage packet = packets[voucher.packetId];
        if (
            packet.sender == address(0) || packet.refunded || block.timestamp >= packet.expiresAt
                || packet.claimedCount == packet.count
        ) revert PacketUnavailable();
        if (
            voucher.recipient == address(0) || voucher.recipient == address(this)
                || block.timestamp >= voucher.deadline || hasClaimed[voucher.packetId][voucher.recipient]
                || usedNonces[voucher.recipient][voucher.nonce]
        ) revert InvalidClaim();
        if (!SignatureChecker.isValidSignatureNow(claimSigner, claimDigest(voucher), signature)) revert Unauthorized();
        uint32 index = packet.claimedCount;
        uint256 remainingCount = uint256(packet.count) - index - 1;
        if (amount < MIN_SHARE || amount > packet.remaining || packet.remaining - amount < remainingCount * MIN_SHARE) {
            revert InvalidAllocation();
        }
        if (packet.equalAmount != 0) {
            if (amount != packet.equalAmount || allocationSalt != bytes32(0) || nextAllocationHash != bytes32(0)) {
                revert InvalidAllocation();
            }
        } else {
            if (
                keccak256(abi.encode(voucher.packetId, index, amount, allocationSalt, nextAllocationHash))
                    != packet.allocationHash
            ) revert InvalidAllocation();
            if ((remainingCount == 0) != (nextAllocationHash == bytes32(0))) revert InvalidAllocation();
            packet.allocationHash = nextAllocationHash;
        }
        if (remainingCount == 0 && amount != packet.remaining) revert InvalidAllocation();
        packet.claimedCount = index + 1;
        packet.remaining -= amount;
        hasClaimed[voucher.packetId][voucher.recipient] = true;
        usedNonces[voucher.recipient][voucher.nonce] = true;
        packet.token.safeTransfer(voucher.recipient, amount);
        emit PacketClaimed(voucher.packetId, voucher.recipient, index, amount, voucher.nonce);
    }

    function refundExpired(bytes32 packetId) external nonReentrant {
        Packet storage packet = packets[packetId];
        if (packet.sender == address(0) || block.timestamp < packet.expiresAt) revert PacketUnavailable();
        if (packet.refunded || packet.remaining == 0) revert PacketUnavailable();
        uint256 amount = packet.remaining;
        packet.remaining = 0;
        packet.refunded = true;
        packet.token.safeTransfer(packet.sender, amount);
        emit PacketRefunded(packetId, packet.sender, amount);
    }
}
