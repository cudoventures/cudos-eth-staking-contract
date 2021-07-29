const {BN, time, expectEvent, expectRevert, constants, ether, send, balance} = require('@openzeppelin/test-helpers');
const {latest} = time;

const {fromWei} = require('web3-utils');

require('chai').should();

const ServiceProvider = artifacts.require('ServiceProviderMock');
const StakingRewardsMock = artifacts.require('StakingRewardsWithFixedBlockNumber');
const StakingRewardsGuild = artifacts.require('StakingRewardsGuild');
const StakingRewards = artifacts.require('StakingRewards');
const CudosToken = artifacts.require('CudosToken');
const CudosAccessControls = artifacts.require('CudosAccessControls');
const MockERC20 = artifacts.require('MockERC20');

contract('StakingRewardsGuild contract', function ([_, cudos, serviceProviderAlice, fred, whitelisted]) {
  const TEN_BILLION = new BN(10000000000);
  const INITIAL_SUPPLY = ether(TEN_BILLION);

  const REWARD_VALUE = ether('1000');
  const STAKE_VALUE = ether('100000');
  const STAKE_VALUE_BIG = ether('5000000');
  const _10days = new BN('10');

  const rewardPerBlock = ether('100'); // 100 cudo per block

  const REWARDS_PROGRAMME_ONE_ID = new BN('0');
  const REWARDS_PROGRAMME_TWO_ID = new BN('1');

  const ZERO = new BN('0');

  const TWO_MILLION = new BN('2000000');
  const REQUIRED_SERVICE_PROVIDER_BOND = ether(TWO_MILLION);

  const PERIOD_ONE_DAY_IN_SECONDS = new BN('86400');

  // 5% to 2 DP
  const SERVICE_PROVIDER_ALICE_SERVICE_FEE_PERCENTAGE = new BN('500');

  beforeEach(async () => {
    // cudos is added as a admin doing construction
    this.accessControls = await CudosAccessControls.new({from: cudos});

    this.token = await CudosToken.new(this.accessControls.address, cudos, {from: cudos});

    // Ensure transfer are enabled for all for this test
    await this.token.toggleTransfers({from: cudos});

    // Assert the token is constructed correctly
    const creatorBalance = await this.token.balanceOf(cudos);
    creatorBalance.should.be.bignumber.equal(INITIAL_SUPPLY);

    // setup the guild
    this.stakingRewardsGuild = await StakingRewardsGuild.new(
      this.token.address,
      this.accessControls.address
    );

    // Set up the cloneable service provider contract
    this.serviceProviderCloneable = await ServiceProvider.new({from: cudos});

    // Construct new staking contract and give it smart contract
    this.stakingRewards = await StakingRewardsMock.new(
      this.token.address,
      this.accessControls.address,
      this.stakingRewardsGuild.address,
      rewardPerBlock,
      '5', // start block
      this.serviceProviderCloneable.address,
      {from: cudos}
    );

    await this.accessControls.addSmartContractRole(
      this.stakingRewards.address,
      {from: cudos}
    );

    await this.accessControls.addWhitelistRole(
      whitelisted,
      {from: cudos}
    );

    // fix block number to #1
    await this.stakingRewards.fixBlockNumber('1', {from: cudos});

    // Send the staking rewards contract 10 blocks worth of rewards
    await this.token.transfer(this.stakingRewardsGuild.address, REWARD_VALUE, {from: cudos});

    // add the rewards programme with zero min staking blocks
    // this will be rewards programme #0
    this.rewardProgramme1AllocPoint = new BN('100');
    await this.stakingRewards.addRewardsProgramme(this.rewardProgramme1AllocPoint, '0', true, {from: cudos});

    // Whitelist service provider Alice and stake required bond
    await this.stakingRewards.whitelistServiceProvider(serviceProviderAlice, {from: cudos});
    this.serviceProviderAliceProxyAddress = await this.stakingRewards.serviceProviderToWhitelistedProxyContracts(
      serviceProviderAlice
    );

    // Stake bond from service provider alice
    await this.token.transfer(serviceProviderAlice, REQUIRED_SERVICE_PROVIDER_BOND, {from: cudos});
    await this.token.approve(this.stakingRewards.address, REQUIRED_SERVICE_PROVIDER_BOND, {from: serviceProviderAlice});
    this.serviceProviderAliceContract = await ServiceProvider.at(this.serviceProviderAliceProxyAddress);
    await this.serviceProviderAliceContract.stakeServiceProviderBond(
      REWARDS_PROGRAMME_ONE_ID,
      SERVICE_PROVIDER_ALICE_SERVICE_FEE_PERCENTAGE,
      {from: serviceProviderAlice}
    );

    (await this.stakingRewards.amountStakedByUserInRewardProgramme(
      REWARDS_PROGRAMME_ONE_ID,
      this.serviceProviderAliceProxyAddress
    )).should.be.bignumber.equal(REQUIRED_SERVICE_PROVIDER_BOND);

    (await this.stakingRewards.numberOfRewardProgrammes()).should.be.bignumber.equal('1');
  });

  it('should return rewards token address', async () => {
    const rewardsToken = await this.stakingRewards.token();
    rewardsToken.should.be.equal(this.token.address);
  });

  describe('deploying the rewards contract', () => {
    it('Correctly adds a rewards programme', async () => {
      const stakingRewards = await StakingRewards.new(
        this.token.address,
        this.accessControls.address,
        this.stakingRewardsGuild.address,
        rewardPerBlock,
        '5', // start block
        this.serviceProviderCloneable.address,
        {from: cudos}
      );

      await stakingRewards.addRewardsProgramme('100', '50', true, {from: cudos});

      const {
        minStakingLengthInBlocks,
        allocPoint,
        accTokensPerShare,
        totalStaked
      } = await stakingRewards.getRewardProgrammeInfo(REWARDS_PROGRAMME_ONE_ID);

      minStakingLengthInBlocks.should.be.bignumber.equal('50');
      allocPoint.should.be.bignumber.equal('100');
      accTokensPerShare.should.be.bignumber.equal('0');
      totalStaked.should.be.bignumber.equal('0');
    });

    it('reverts when token is address zero', async () => {
      await expectRevert(
        StakingRewards.new(
          constants.ZERO_ADDRESS,
          this.accessControls.address,
          this.stakingRewardsGuild.address,
          rewardPerBlock,
          '5', // start block
          this.serviceProviderCloneable.address,
          {from: cudos}
        ),
        "Invalid token address"
      );
    });

    it('reverts when access controls is address zero', async () => {
      await expectRevert(
        StakingRewards.new(
          this.token.address,
          constants.ZERO_ADDRESS,
          this.stakingRewardsGuild.address,
          rewardPerBlock,
          '5', // start block
          this.serviceProviderCloneable.address,
          {from: cudos}
        ),
        "Invalid access controls"
      );
    });

    it('reverts when cloneable service provider is address zero', async () => {
      await expectRevert(
        StakingRewards.new(
          this.token.address,
          this.accessControls.address,
          this.stakingRewardsGuild.address,
          rewardPerBlock,
          '5', // start block
          constants.ZERO_ADDRESS,
          {from: cudos}
        ),
        "Invalid cloneable service provider"
      );
    });
  });

  describe('Recovery', () => {
    describe('ERC20', () => {
      beforeEach(async () => {
        this.mockToken = await MockERC20.new({from: fred});
      })

      it('Can recover an ERC20 as admin', async () => {
        this.mockToken = await MockERC20.new({from: fred});

        (await this.mockToken.balanceOf(this.stakingRewardsGuild.address)).should.be.bignumber.equal('0');

        let cudoMockBalance = await this.mockToken.balanceOf(cudos)
        cudoMockBalance.should.be.bignumber.equal('0')

        const xferAmount = new BN('5')
        await this.mockToken.transfer(this.stakingRewardsGuild.address, xferAmount, { from: fred });

        (await this.mockToken.balanceOf(this.stakingRewardsGuild.address)).should.be.bignumber.equal(xferAmount)

        cudoMockBalance = await this.mockToken.balanceOf(cudos)
        cudoMockBalance.should.be.bignumber.equal('0')

        await this.stakingRewardsGuild.recoverERC20(this.mockToken.address, cudos, xferAmount, {from: cudos});

        cudoMockBalance = await this.mockToken.balanceOf(cudos)
        cudoMockBalance.should.be.bignumber.equal(xferAmount)
      })

      it('Reverts if not admin', async () => {
        await expectRevert(
          this.stakingRewardsGuild.recoverERC20(this.mockToken.address, fred, new BN('1'), {from: fred}),
          "OA"
        )
      })
    })
  })
});
