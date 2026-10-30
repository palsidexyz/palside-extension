// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @notice Local Anvil token only. Fixed supply, standard approvals, no permit or mint authority.
contract MockPALS is ERC20 {
    uint256 public constant INITIAL_SUPPLY = 1_000_000_000 ether;

    constructor(address recipient) ERC20("Mock PALS", "PALS") {
        _mint(recipient, INITIAL_SUPPLY);
    }
}
