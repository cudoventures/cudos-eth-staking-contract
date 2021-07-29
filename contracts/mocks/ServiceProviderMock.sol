// SPDX-License-Identifier: MIT

pragma solidity 0.8.0;

import "../staking/ServiceProvider.sol";

contract ServiceProviderMock is ServiceProvider {
    function tryWithdrawLargeAmount() external {
        require(msg.sender == serviceProvider);
        StakingRewards(controller).withdraw(rewardsProgrammeId, _msgSender(), 190000000000000000000000000);
    }
}
