// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC1271} from "@openzeppelin/contracts/interfaces/IERC1271.sol";
import {PalsideRedPacket} from "../src/PalsideRedPacket.sol";

contract SignatureFixture is IERC1271 {
    bool public enabled = true;

    function disable() external {
        enabled = false;
    }

    function isValidSignature(bytes32, bytes memory) external view returns (bytes4) {
        return enabled ? IERC1271.isValidSignature.selector : bytes4(0xffffffff);
    }
}

contract AdversarialToken is ERC20 {
    bool public taxed;
    bool public failOutbound;
    address public callbackTarget;
    bytes public callbackData;
    bool public attempted;
    bool public callbackSucceeded;

    constructor() ERC20("Fixture", "FX") {
        _mint(msg.sender, 1_000 ether);
    }

    function configure(bool taxed_, bool failOutbound_, address target_, bytes calldata data_) external {
        taxed = taxed_;
        failOutbound = failOutbound_;
        callbackTarget = target_;
        callbackData = data_;
        attempted = false;
        callbackSucceeded = false;
    }

    function transfer(address to, uint256 amount) public override returns (bool) {
        if (failOutbound) return false;
        _callback();
        return super.transfer(to, amount);
    }

    function transferFrom(address from, address to, uint256 amount) public override returns (bool) {
        _callback();
        bool result = super.transferFrom(from, to, amount);
        if (taxed && amount > 0) _burn(to, 1);
        return result;
    }

    function _callback() private {
        if (callbackTarget != address(0) && !attempted) {
            attempted = true;
            (callbackSucceeded,) = callbackTarget.call(callbackData);
        }
    }
}

contract AdversarialTest is Test {
    AdversarialToken token;
    SignatureFixture signer;
    PalsideRedPacket packets;
    address bob = address(0xB0B);

    function setUp() public {
        vm.warp(1000);
        token = new AdversarialToken();
        signer = new SignatureFixture();
        packets = new PalsideRedPacket(address(signer));
        token.approve(address(packets), 1000 ether);
    }

    function claim(bytes32 id) internal view returns (PalsideRedPacket.Claim memory) {
        return PalsideRedPacket.Claim(id, bob, 1, block.timestamp + 300);
    }

    function testRejectFeeOnTransferEscrowAtomically() public {
        AdversarialToken other = new AdversarialToken();
        other.approve(address(packets), 3 ether);
        bytes32 otherId = packets.createPacket(other, "other", PalsideRedPacket.Kind.Invitation, 3 ether, 1, 3 ether, 0);
        token.configure(true, false, address(0), "");
        vm.expectRevert(PalsideRedPacket.UnsupportedToken.selector);
        packets.createPacket(token, "tax", PalsideRedPacket.Kind.Team, 2 ether, 2, 1 ether, 0);
        (address sender,,,,,,,,,,) = packets.packets(packets.packetIdFor(address(this), "tax"));
        assertEq(sender, address(0));
        assertEq(token.balanceOf(address(packets)), 0);
        assertEq(token.allowance(address(this), address(packets)), 1000 ether);
        assertEq(other.balanceOf(address(packets)), 3 ether);
        packets.claim(claim(otherId), 3 ether, 0, 0, "");
        assertEq(other.balanceOf(bob), 3 ether);
        assertEq(token.balanceOf(bob), 0);
        assertEq(token.balanceOf(address(this)), 1000 ether);
    }

    function testOutboundFailureRollsBackClaimNonceAndRefund() public {
        bytes32 id = packets.createPacket(token, "failure", PalsideRedPacket.Kind.Team, 2 ether, 2, 1 ether, 0);
        token.configure(false, true, address(0), "");
        PalsideRedPacket.Claim memory c = claim(id);
        vm.expectRevert();
        packets.claim(c, 1 ether, 0, 0, "");
        assertFalse(packets.usedNonces(bob, 1));
        assertFalse(packets.hasClaimed(id, bob));
        vm.warp(block.timestamp + 1 days + packets.SETTLEMENT_WINDOW());
        vm.expectRevert();
        packets.refundExpired(id);
        (,,,,,, uint256 remaining,,,, bool refunded) = packets.packets(id);
        assertEq(remaining, 2 ether);
        assertFalse(refunded);
        token.configure(false, false, address(0), "");
        packets.refundExpired(id);
        assertEq(token.balanceOf(address(this)), 1000 ether);
    }

    function testReentryOnDepositCannotCreateSecondPacket() public {
        bytes memory data = abi.encodeCall(
            packets.createPacket,
            (token, bytes32("reentered"), PalsideRedPacket.Kind.Team, 1 ether, uint32(1), 1 ether, bytes32(0))
        );
        token.configure(false, false, address(packets), data);
        packets.createPacket(token, "outer", PalsideRedPacket.Kind.Team, 1 ether, 1, 1 ether, 0);
        assertTrue(token.attempted());
        assertFalse(token.callbackSucceeded());
        assertEq(token.balanceOf(address(packets)), 1 ether);
    }

    function testReentryOnClaimCannotConsumeSecondVoucher() public {
        bytes32 id = packets.createPacket(token, "outer", PalsideRedPacket.Kind.Team, 2 ether, 2, 1 ether, 0);
        PalsideRedPacket.Claim memory nested = PalsideRedPacket.Claim(id, address(0xCA401), 2, block.timestamp + 300);
        token.configure(
            false,
            false,
            address(packets),
            abi.encodeCall(packets.claim, (nested, 1 ether, bytes32(0), bytes32(0), bytes("")))
        );
        packets.claim(claim(id), 1 ether, 0, 0, "");
        assertTrue(token.attempted());
        assertFalse(token.callbackSucceeded());
        assertFalse(packets.usedNonces(nested.recipient, 2));
        assertEq(token.balanceOf(address(packets)), 1 ether);
    }

    function testContractSignerCanRevokeUnspentVouchers() public {
        bytes32 id = packets.createPacket(token, "1271", PalsideRedPacket.Kind.Team, 1 ether, 1, 1 ether, 0);
        signer.disable();
        vm.expectRevert(PalsideRedPacket.Unauthorized.selector);
        packets.claim(claim(id), 1 ether, 0, 0, "");
        vm.warp(block.timestamp + 1 days + packets.SETTLEMENT_WINDOW());
        packets.refundExpired(id);
        assertEq(token.balanceOf(address(this)), 1000 ether);
    }

    function testInvalidPacketTokens() public {
        vm.expectRevert(PalsideRedPacket.UnsupportedToken.selector);
        packets.createPacket(IERC20(address(0)), "zero", PalsideRedPacket.Kind.Team, 1 ether, 1, 1 ether, 0);
        vm.expectRevert(PalsideRedPacket.UnsupportedToken.selector);
        packets.createPacket(IERC20(bob), "eoa", PalsideRedPacket.Kind.Team, 1 ether, 1, 1 ether, 0);
    }

    function testInvalidDeploymentConfigurations() public {
        vm.expectRevert(PalsideRedPacket.InvalidConfiguration.selector);
        new PalsideRedPacket(address(0));
    }
}
