// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Test} from "forge-std/Test.sol";
import {MockPALS} from "../src/MockPALS.sol";
import {PalsideRedPacket} from "../src/PalsideRedPacket.sol";


contract PalsideTest is Test {
    MockPALS token;
    PalsideRedPacket packets;
    address alice = address(0xA11CE);
    address bob = address(0xB0B);
    address carol = address(0xCA401);
    address signer;
    uint256 constant SIGNER_KEY = 0x712;

    function setUp() public {
        vm.warp(1_000_000);
        signer = vm.addr(SIGNER_KEY);
        token = new MockPALS(alice);
        packets = new PalsideRedPacket(signer);
        vm.startPrank(alice);
        token.approve(address(packets), type(uint256).max);
        vm.stopPrank();
    }

    function sign(bytes32 digest) internal pure returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(SIGNER_KEY, digest);
        return abi.encodePacked(r, s, v);
    }

    function voucher(bytes32 id, address recipient, uint256 nonce)
        internal
        view
        returns (PalsideRedPacket.Claim memory)
    {
        return PalsideRedPacket.Claim(id, recipient, nonce, block.timestamp + 300);
    }

    function createEqual(bytes32 salt, PalsideRedPacket.Kind kind, uint32 count, uint256 share)
        internal
        returns (bytes32)
    {
        vm.prank(alice);
        return packets.createPacket(token, salt, kind, uint256(count) * share, count, share, bytes32(0));
    }

    function claimEqual(bytes32 id, address recipient, uint256 nonce, uint256 share) internal {
        PalsideRedPacket.Claim memory c = voucher(id, recipient, nonce);
        bytes memory signature = sign(packets.claimDigest(c));
        packets.claim(c, share, bytes32(0), bytes32(0), signature);
    }

    function testMockFixedSupplyAndNoPermitOrMint() public {
        assertEq(token.totalSupply(), 1_000_000_000 ether);
        assertEq(token.balanceOf(alice), token.totalSupply());
        assertEq(token.decimals(), 18);
        (bool minted,) = address(token).call(abi.encodeWithSignature("mint(address,uint256)", bob, 1));
        (bool permitted,) = address(token)
            .call(
                abi.encodeWithSignature(
                    "permit(address,address,uint256,uint256,uint8,bytes32,bytes32)",
                    alice,
                    bob,
                    1,
                    type(uint256).max,
                    27,
                    bytes32(0),
                    bytes32(0)
                )
            );
        assertFalse(minted);
        assertFalse(permitted);
    }

    function testEqualClaimConservationAndRelayerCannotRedirect() public {
        bytes32 id = createEqual("equal", PalsideRedPacket.Kind.Team, 2, 3 ether);
        claimEqual(id, bob, 1, 3 ether);
        claimEqual(id, carol, 1, 3 ether);
        assertEq(token.balanceOf(bob), 3 ether);
        assertEq(token.balanceOf(carol), 3 ether);
        assertEq(token.balanceOf(address(packets)), 0);
        PalsideRedPacket.Claim memory c = voucher(id, address(44), 1);
        bytes memory sig = sign(packets.claimDigest(c));
        vm.expectRevert(PalsideRedPacket.PacketUnavailable.selector);
        packets.claim(c, 3 ether, bytes32(0), bytes32(0), sig);
    }

    function testPacketsKeepOwnTokenForClaimsAndRefund() public {
        MockPALS secondToken = new MockPALS(alice);
        bytes32 first = createEqual("first", PalsideRedPacket.Kind.Team, 2, 1 ether);
        vm.startPrank(alice);
        secondToken.approve(address(packets), 6 ether);
        bytes32 second = packets.createPacket(secondToken, "second", PalsideRedPacket.Kind.Invitation, 6 ether, 2, 3 ether, 0);
        vm.expectRevert(PalsideRedPacket.InvalidPacket.selector);
        packets.createPacket(secondToken, "first", PalsideRedPacket.Kind.Team, 1 ether, 1, 1 ether, 0);
        vm.stopPrank();
        claimEqual(second, bob, 1, 3 ether);
        assertEq(secondToken.balanceOf(bob), 3 ether);
        assertEq(token.balanceOf(bob), 0);
        assertEq(token.balanceOf(address(packets)), 2 ether);
        claimEqual(first, carol, 1, 1 ether);
        assertEq(token.balanceOf(carol), 1 ether);
        assertEq(secondToken.balanceOf(carol), 0);
        vm.warp(block.timestamp + 7 days + packets.SETTLEMENT_WINDOW());
        packets.refundExpired(second);
        assertEq(secondToken.balanceOf(alice), secondToken.INITIAL_SUPPLY() - 3 ether);
        assertEq(secondToken.balanceOf(address(packets)), 0);
        assertEq(token.balanceOf(address(packets)), 1 ether);
        packets.refundExpired(first);
        assertEq(token.balanceOf(alice), token.INITIAL_SUPPLY() - 1 ether);
        assertEq(token.balanceOf(address(packets)), 0);
        assertEq(secondToken.balanceOf(alice), secondToken.INITIAL_SUPPLY() - 3 ether);
    }

    function testRandomSequentialConcurrentRetryAndNoSkipping() public {
        bytes32 salt = "random";
        bytes32 id = packets.packetIdFor(alice, salt);
        bytes32 second = keccak256(abi.encode(id, uint32(1), 7 ether, bytes32(0), bytes32(0)));
        bytes32 first = keccak256(abi.encode(id, uint32(0), 3 ether, bytes32(0), second));
        vm.prank(alice);
        packets.createPacket(token, salt, PalsideRedPacket.Kind.Room, 10 ether, 2, 0, first);
        PalsideRedPacket.Claim memory b = voucher(id, bob, 4);
        PalsideRedPacket.Claim memory c = voucher(id, carol, 4);
        bytes memory bs = sign(packets.claimDigest(b));
        bytes memory cs = sign(packets.claimDigest(c));
        vm.expectRevert(PalsideRedPacket.InvalidAllocation.selector);
        packets.claim(b, 7 ether, bytes32(0), bytes32(0), bs);
        packets.claim(b, 3 ether, bytes32(0), second, bs);
        vm.expectRevert(PalsideRedPacket.InvalidAllocation.selector);
        packets.claim(c, 3 ether, bytes32(0), second, cs);
        assertFalse(packets.usedNonces(carol, 4));
        packets.claim(c, 7 ether, bytes32(0), bytes32(0), cs);
        assertEq(token.balanceOf(bob) + token.balanceOf(carol), 10 ether);
        assertEq(token.balanceOf(address(packets)), 0);
    }

    function testRecipientAndNonceReplayRejectedAndSenderMayClaim() public {
        bytes32 id = createEqual("replay", PalsideRedPacket.Kind.Team, 3, 1 ether);
        claimEqual(id, bob, 9, 1 ether);
        PalsideRedPacket.Claim memory c = voucher(id, bob, 10);
        bytes memory sig = sign(packets.claimDigest(c));
        vm.expectRevert(PalsideRedPacket.InvalidClaim.selector);
        packets.claim(c, 1 ether, bytes32(0), bytes32(0), sig);
        bytes32 another = createEqual("another", PalsideRedPacket.Kind.Team, 1, 1 ether);
        c = voucher(another, bob, 9);
        sig = sign(packets.claimDigest(c));
        vm.expectRevert(PalsideRedPacket.InvalidClaim.selector);
        packets.claim(c, 1 ether, bytes32(0), bytes32(0), sig);
        claimEqual(id, alice, 1, 1 ether);
        assertEq(token.balanceOf(alice), token.INITIAL_SUPPLY() - 3 ether);
    }

    function testClaimBatchSettlesInOrderAndRevertsAsOne() public {
        bytes32 salt = "batch";
        bytes32 id = packets.packetIdFor(alice, salt);
        bytes32 third = keccak256(abi.encode(id, uint32(2), 2 ether, bytes32("s2"), bytes32(0)));
        bytes32 second = keccak256(abi.encode(id, uint32(1), 5 ether, bytes32("s1"), third));
        bytes32 first = keccak256(abi.encode(id, uint32(0), 3 ether, bytes32("s0"), second));
        vm.prank(alice);
        packets.createPacket(token, salt, PalsideRedPacket.Kind.Team, 10 ether, 3, 0, first);
        PalsideRedPacket.Claim[] memory vouchers = new PalsideRedPacket.Claim[](2);
        uint256[] memory amounts = new uint256[](2);
        bytes32[] memory salts = new bytes32[](2);
        bytes32[] memory nexts = new bytes32[](2);
        bytes[] memory sigs = new bytes[](2);
        vouchers[0] = voucher(id, bob, 1);
        vouchers[1] = voucher(id, alice, 1);
        (amounts[0], salts[0], nexts[0]) = (3 ether, bytes32("s0"), second);
        (amounts[1], salts[1], nexts[1]) = (5 ether, bytes32("s1"), third);
        sigs[0] = sign(packets.claimDigest(vouchers[0]));
        sigs[1] = sign(packets.claimDigest(vouchers[1]));
        // A bad later share reverts the whole batch: the valid first share does not move either.
        amounts[1] = 4 ether;
        vm.expectRevert(PalsideRedPacket.InvalidAllocation.selector);
        packets.claimBatch(vouchers, amounts, salts, nexts, sigs);
        assertEq(token.balanceOf(bob), 0);
        amounts[1] = 5 ether;
        packets.claimBatch(vouchers, amounts, salts, nexts, sigs);
        assertEq(token.balanceOf(bob), 3 ether);
        assertEq(token.balanceOf(address(packets)), 2 ether);
        vm.expectRevert(PalsideRedPacket.InvalidClaim.selector);
        packets.claimBatch(new PalsideRedPacket.Claim[](0), new uint256[](0), new bytes32[](0), new bytes32[](0), new bytes[](0));
    }

    function testClaimSignatureRecipientPacketAndChainBinding() public {
        bytes32 id = createEqual("binding", PalsideRedPacket.Kind.Team, 2, 1 ether);
        bytes32 other = createEqual("other", PalsideRedPacket.Kind.Team, 2, 1 ether);
        PalsideRedPacket.Claim memory c = voucher(id, bob, 1);
        bytes memory sig = sign(packets.claimDigest(c));
        c.recipient = carol;
        vm.expectRevert(PalsideRedPacket.Unauthorized.selector);
        packets.claim(c, 1 ether, bytes32(0), bytes32(0), sig);
        c.recipient = bob;
        c.packetId = other;
        vm.expectRevert(PalsideRedPacket.Unauthorized.selector);
        packets.claim(c, 1 ether, bytes32(0), bytes32(0), sig);
        c.packetId = id;
        vm.chainId(block.chainid + 1);
        vm.expectRevert(PalsideRedPacket.Unauthorized.selector);
        packets.claim(c, 1 ether, bytes32(0), bytes32(0), sig);
    }

    function testClaimDomainContractBindingAndBadSignature() public {
        bytes32 id = createEqual("domain", PalsideRedPacket.Kind.Team, 1, 1 ether);
        PalsideRedPacket other = new PalsideRedPacket(signer);
        PalsideRedPacket.Claim memory c = voucher(id, bob, 1);
        bytes memory sig = sign(other.claimDigest(c));
        vm.expectRevert(PalsideRedPacket.Unauthorized.selector);
        packets.claim(c, 1 ether, bytes32(0), bytes32(0), sig);
        vm.expectRevert(PalsideRedPacket.Unauthorized.selector);
        packets.claim(c, 1 ether, bytes32(0), bytes32(0), hex"00");
    }

    function testDeadlinesAndPermissionlessRefund() public {
        bytes32 id = createEqual("expiry", PalsideRedPacket.Kind.Team, 2, 1 ether);
        PalsideRedPacket.Claim memory c = voucher(id, bob, 1);
        bytes memory sig = sign(packets.claimDigest(c));
        vm.warp(c.deadline);
        vm.expectRevert(PalsideRedPacket.InvalidClaim.selector);
        packets.claim(c, 1 ether, bytes32(0), bytes32(0), sig);
        vm.expectRevert(PalsideRedPacket.PacketUnavailable.selector);
        packets.refundExpired(id);
        claimEqual(id, bob, 2, 1 ether);
        vm.warp(1_000_000 + 1 days + packets.SETTLEMENT_WINDOW());
        c = voucher(id, carol, 3);
        sig = sign(packets.claimDigest(c));
        vm.expectRevert(PalsideRedPacket.PacketUnavailable.selector);
        packets.claim(c, 1 ether, bytes32(0), bytes32(0), sig);
        vm.prank(address(0xF00));
        packets.refundExpired(id);
        assertEq(token.balanceOf(alice), token.INITIAL_SUPPLY() - 1 ether);
        assertEq(token.balanceOf(address(packets)), 0);
        vm.expectRevert(PalsideRedPacket.PacketUnavailable.selector);
        packets.refundExpired(id);
    }

    function testKindDurations() public {
        bytes32 team = createEqual("t", PalsideRedPacket.Kind.Team, 1, 1 ether);
        bytes32 invitation = createEqual("i", PalsideRedPacket.Kind.Invitation, 1, 1 ether);
        bytes32 room = packets.packetIdFor(alice, "r");
        bytes32 hash = keccak256(abi.encode(room, uint32(0), 1 ether, bytes32(0), bytes32(0)));
        vm.prank(alice);
        packets.createPacket(token, "r", PalsideRedPacket.Kind.Room, 1 ether, 1, 0, hash);
        (,,,,,,,, uint256 te,,) = packets.packets(team);
        (,,,,,,,, uint256 ie,,) = packets.packets(invitation);
        (,,,,,,,, uint256 re,,) = packets.packets(room);
        uint256 settlement = packets.SETTLEMENT_WINDOW();
        assertEq(te, block.timestamp + 1 days + settlement);
        assertEq(ie, block.timestamp + 7 days + settlement);
        assertEq(re, block.timestamp + 1 hours + settlement);
    }

    function testCreateValidationAndSenderNamespacing() public {
        vm.startPrank(alice);
        vm.expectRevert(PalsideRedPacket.InvalidPacket.selector);
        packets.createPacket(token, "zero", PalsideRedPacket.Kind.Team, 1 ether, 0, 1 ether, 0);
        vm.expectRevert(PalsideRedPacket.InvalidPacket.selector);
        packets.createPacket(token, "max", PalsideRedPacket.Kind.Team, 101 ether, 101, 1 ether, 0);
        vm.expectRevert(PalsideRedPacket.InvalidPacket.selector);
        packets.createPacket(token, "min", PalsideRedPacket.Kind.Team, 1 ether, 2, 0, bytes32(uint256(1)));
        vm.expectRevert(PalsideRedPacket.InvalidPacket.selector);
        packets.createPacket(token, "unequal", PalsideRedPacket.Kind.Team, 3 ether, 2, 1 ether, 0);
        vm.expectRevert(PalsideRedPacket.InvalidPacket.selector);
        packets.createPacket(token, "room", PalsideRedPacket.Kind.Room, 1 ether, 1, 1 ether, 0);
        vm.expectRevert(PalsideRedPacket.InvalidPacket.selector);
        packets.createPacket(token, "invite", PalsideRedPacket.Kind.Invitation, 1 ether, 1, 0, bytes32(uint256(1)));
        vm.expectRevert(PalsideRedPacket.InvalidPacket.selector);
        packets.createPacket(token, "hash", PalsideRedPacket.Kind.Team, 1 ether, 1, 0, 0);
        vm.stopPrank();
        createEqual("duplicate", PalsideRedPacket.Kind.Team, 1, 1 ether);
        vm.prank(alice);
        vm.expectRevert(PalsideRedPacket.InvalidPacket.selector);
        packets.createPacket(token, "duplicate", PalsideRedPacket.Kind.Team, 1 ether, 1, 1 ether, 0);
        assertNotEq(packets.packetIdFor(alice, "duplicate"), packets.packetIdFor(bob, "duplicate"));
    }

    function testMalformedRandomCannotDrainOrStrandFinalDust() public {
        bytes32 id = packets.packetIdFor(alice, "malformed");
        bytes32 h = keccak256(abi.encode(id, uint32(0), 2 ether, bytes32(0), bytes32(0)));
        vm.prank(alice);
        packets.createPacket(token, "malformed", PalsideRedPacket.Kind.Room, 3 ether, 1, 0, h);
        PalsideRedPacket.Claim memory c = voucher(id, bob, 1);
        bytes memory sig = sign(packets.claimDigest(c));
        vm.expectRevert(PalsideRedPacket.InvalidAllocation.selector);
        packets.claim(c, 2 ether, bytes32(0), bytes32(0), sig);
        assertFalse(packets.hasClaimed(id, bob));
        vm.warp(block.timestamp + 1 hours + packets.SETTLEMENT_WINDOW());
        packets.refundExpired(id);
        assertEq(token.balanceOf(alice), token.INITIAL_SUPPLY());
    }

    function testRandomMustReserveMinimumForRemainingAndTerminalHash() public {
        bytes32 id = packets.packetIdFor(alice, "reserve");
        bytes32 h = keccak256(abi.encode(id, uint32(0), 3 ether, bytes32(0), bytes32(uint256(1))));
        vm.prank(alice);
        packets.createPacket(token, "reserve", PalsideRedPacket.Kind.Room, 3 ether, 2, 0, h);
        PalsideRedPacket.Claim memory c = voucher(id, bob, 1);
        bytes memory sig = sign(packets.claimDigest(c));
        vm.expectRevert(PalsideRedPacket.InvalidAllocation.selector);
        packets.claim(c, 3 ether, bytes32(0), bytes32(uint256(1)), sig);
    }

    function testSaltedPreimageCannotBeSubstituted() public {
        bytes32 id = packets.packetIdFor(alice, "salted");
        bytes32 salt = keccak256("sender-generated-random-secret");
        bytes32 h = keccak256(abi.encode(id, uint32(0), 1 ether, salt, bytes32(0)));
        vm.prank(alice);
        packets.createPacket(token, "salted", PalsideRedPacket.Kind.Room, 1 ether, 1, 0, h);
        PalsideRedPacket.Claim memory c = voucher(id, bob, 1);
        bytes memory sig = sign(packets.claimDigest(c));
        vm.expectRevert(PalsideRedPacket.InvalidAllocation.selector);
        packets.claim(c, 1 ether, bytes32(0), bytes32(0), sig);
        packets.claim(c, 1 ether, salt, bytes32(0), sig);
        assertEq(token.balanceOf(bob), 1 ether);
    }

    function testEqualAmountAndRandomTerminalValidation() public {
        bytes32 equalId = createEqual("ordinary", PalsideRedPacket.Kind.Team, 1, 2 ether);
        PalsideRedPacket.Claim memory c = voucher(equalId, bob, 1);
        bytes memory sig = sign(packets.claimDigest(c));
        vm.expectRevert(PalsideRedPacket.InvalidAllocation.selector);
        packets.claim(c, 1 ether, bytes32(0), bytes32(0), sig);
        bytes32 randomId = packets.packetIdFor(alice, "terminal");
        bytes32 h = keccak256(abi.encode(randomId, uint32(0), 1 ether, bytes32(0), bytes32(uint256(1))));
        vm.prank(alice);
        packets.createPacket(token, "terminal", PalsideRedPacket.Kind.Room, 1 ether, 1, 0, h);
        c = voucher(randomId, bob, 1);
        sig = sign(packets.claimDigest(c));
        vm.expectRevert(PalsideRedPacket.InvalidAllocation.selector);
        packets.claim(c, 1 ether, bytes32(0), bytes32(uint256(1)), sig);
    }

    function testFuzzRandomConservation(uint96 a, uint96 b, bool refund) public {
        uint256 firstAmount = bound(uint256(a), 1 ether, 1_000_000 ether);
        uint256 secondAmount = bound(uint256(b), 1 ether, 1_000_000 ether);
        bytes32 id = packets.packetIdFor(alice, "fuzz");
        bytes32 second = keccak256(abi.encode(id, uint32(1), secondAmount, bytes32(0), bytes32(0)));
        bytes32 first = keccak256(abi.encode(id, uint32(0), firstAmount, bytes32(0), second));
        vm.prank(alice);
        packets.createPacket(token, "fuzz", PalsideRedPacket.Kind.Room, firstAmount + secondAmount, 2, 0, first);
        PalsideRedPacket.Claim memory c = voucher(id, bob, 1);
        packets.claim(c, firstAmount, bytes32(0), second, sign(packets.claimDigest(c)));
        if (refund) {
            vm.warp(block.timestamp + 1 hours + packets.SETTLEMENT_WINDOW());
            packets.refundExpired(id);
        } else {
            c = voucher(id, carol, 1);
            packets.claim(c, secondAmount, bytes32(0), bytes32(0), sign(packets.claimDigest(c)));
        }
        assertEq(token.balanceOf(address(packets)), 0);
        assertEq(token.balanceOf(alice) + token.balanceOf(bob) + token.balanceOf(carol), token.INITIAL_SUPPLY());
    }
}
