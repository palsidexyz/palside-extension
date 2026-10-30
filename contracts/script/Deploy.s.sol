// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Script} from "forge-std/Script.sol";
import {MockPALS} from "../src/MockPALS.sol";
import {PalsideRedPacket} from "../src/PalsideRedPacket.sol";

contract DeployLocal is Script {
    function run() external {
        require(block.chainid == 31337, "local chain only");
        address deployer = vm.envAddress("PALSIDE_DEPLOYER");
        address signer = vm.envAddress("PALSIDE_VOUCHER_SIGNER");
        vm.startBroadcast(deployer);
        MockPALS token = new MockPALS(deployer);
        PalsideRedPacket redPacket = new PalsideRedPacket(signer);
        vm.stopBroadcast();
        string memory key = "deployment";
        vm.serializeUint(key, "chainId", block.chainid);
        vm.serializeAddress(key, "deployer", deployer);
        vm.serializeAddress(key, "token", address(token));
        vm.serializeAddress(key, "redPacket", address(redPacket));
        string memory json = vm.serializeAddress(key, "signer", signer);
        vm.writeJson(json, "deployments/local.json");
    }
}

/// @notice Deployment entry point for an explicitly authorized mainnet exercise.
/// Uses an external wallet configured in forge; no private key is read by this script.
contract DeployMainnet is Script {
    function run() external {
        require(block.chainid == 4663, "Robinhood mainnet only");
        address deployer = vm.envAddress("PALSIDE_DEPLOYER");
        address signer = vm.envAddress("PALSIDE_VOUCHER_SIGNER");
        vm.startBroadcast(deployer);
        PalsideRedPacket redPacket = new PalsideRedPacket(signer);
        vm.stopBroadcast();
        string memory key = "deployment";
        vm.serializeUint(key, "chainId", block.chainid);
        vm.serializeAddress(key, "deployer", deployer);
        vm.serializeAddress(key, "redPacket", address(redPacket));
        string memory json = vm.serializeAddress(key, "signer", signer);
        vm.writeJson(json, "deployments/4663.json");
    }
}
