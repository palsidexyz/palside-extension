// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Test} from "forge-std/Test.sol";
import {MockPALS} from "../src/MockPALS.sol";
import {PalsideRedPacket} from "../src/PalsideRedPacket.sol";

contract ConservationHandler is Test {
    MockPALS[2] public tokens;
    PalsideRedPacket public packets;
    bytes32[2] public packetIds;
    uint256[2] public totalClaims;
    uint256[2] public totalRefunds;
    uint256 constant SIGNER_KEY = 0x123456;

    constructor() {
        address signer = vm.addr(SIGNER_KEY);
        packets = new PalsideRedPacket(signer);
        for (uint256 i = 0; i < 2; ++i) {
            tokens[i] = new MockPALS(address(this));
            uint256 share = (i + 1) * 1 ether;
            tokens[i].approve(address(packets), 100 * share);
            packetIds[i] = packets.createPacket(tokens[i], bytes32(i + 1), PalsideRedPacket.Kind.Invitation, 100 * share, 100, share, 0);
        }
    }

    function signature(bytes32 digest) private pure returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(SIGNER_KEY, digest);
        return abi.encodePacked(r, s, v);
    }

    function claim(uint8 tokenSeed, uint8 recipientSeed, uint8 nonce) external {
        uint256 i = tokenSeed % 2;
        uint256 share = (i + 1) * 1 ether;
        address recipient = address(uint160(1000 + uint256(recipientSeed % 16)));
        PalsideRedPacket.Claim memory c = PalsideRedPacket.Claim(packetIds[i], recipient, nonce, block.timestamp + 300);
        try packets.claim(c, share, 0, 0, signature(packets.claimDigest(c))) {
            totalClaims[i] += share;
        } catch {}
    }

    function advance(uint24 delta) external {
        vm.warp(block.timestamp + bound(uint256(delta), 0, 1 days));
    }

    function refund(uint8 tokenSeed) external {
        uint256 i = tokenSeed % 2;
        (,,,,,, uint256 remaining,,,,) = packets.packets(packetIds[i]);
        try packets.refundExpired(packetIds[i]) {
            totalRefunds[i] += remaining;
        } catch {}
    }

}

contract ConservationInvariantTest is Test {
    ConservationHandler handler;

    function setUp() public {
        vm.warp(1000);
        handler = new ConservationHandler();
        bytes4[] memory selectors = new bytes4[](3);
        selectors[0] = handler.claim.selector;
        selectors[1] = handler.advance.selector;
        selectors[2] = handler.refund.selector;
        targetSelector(FuzzSelector(address(handler), selectors));
        targetContract(address(handler));
    }

    function invariantEscrowAndCountConservation() public view {
        PalsideRedPacket packets = handler.packets();
        for (uint256 i = 0; i < 2; ++i) {
            (, IERC20 token,, uint32 count, uint32 claimedCount, uint256 total, uint256 remaining,,,,) =
                packets.packets(handler.packetIds(i));
            assertEq(address(token), address(handler.tokens(i)));
            assertEq(total, (i + 1) * 100 ether);
            assertLe(claimedCount, count);
            assertEq(uint256(claimedCount) * (i + 1) * 1 ether, handler.totalClaims(i));
            assertEq(remaining + handler.totalClaims(i) + handler.totalRefunds(i), total);
            assertEq(token.balanceOf(address(packets)), remaining);
        }
    }

    function invariantTokenIsolationAndSupplyConservation() public view {
        for (uint256 i = 0; i < 2; ++i) {
            MockPALS token = handler.tokens(i);
            uint256 received;
            for (uint160 recipient = 1000; recipient < 1016; ++recipient) received += token.balanceOf(address(recipient));
            assertEq(received, handler.totalClaims(i));
            assertEq(token.balanceOf(address(handler)), token.INITIAL_SUPPLY() - (i + 1) * 100 ether + handler.totalRefunds(i));
            assertEq(token.balanceOf(address(handler)) + token.balanceOf(address(handler.packets())) + received, token.totalSupply());
            assertEq(token.totalSupply(), token.INITIAL_SUPPLY());
        }
    }
}
