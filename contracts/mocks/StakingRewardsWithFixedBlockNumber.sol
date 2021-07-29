// SPDX-License-Identifier: MIT

pragma solidity 0.8.0;

import "../staking/StakingRewards.sol";

contract StakingRewardsWithFixedBlockNumber is StakingRewards {
    uint256 public blockNumber;

    constructor(
        IERC20 _token,
        CudosAccessControls _accessControls,
        StakingRewardsGuild _rewardsGuildBank,
        uint256 _tokenRewardPerBlock,
        uint256 _startBlock,
        address _cloneableServiceProviderContract
    )
    StakingRewards(_token, _accessControls, _rewardsGuildBank, _tokenRewardPerBlock, _startBlock, _cloneableServiceProviderContract)
    {}

    function fixBlockNumber(uint256 _blockNumber) external {
        require(accessControls.hasAdminRole(_msgSender()), "Only admin");
        blockNumber = _blockNumber;
    }

    function _getBlock() public view override returns (uint256) {
        if (blockNumber > 0) {
            return blockNumber;
        }
        return block.number;
    }
}
