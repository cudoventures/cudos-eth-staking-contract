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

contract('StakingRewards contract', function ([_, cudos, serviceProviderAlice, serviceProviderBob, serviceProviderCharlie, fred, greg, heidi, beneficiary3, whitelisted]) {
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
  const STAKE_VALUE_TM = ether(TWO_MILLION);

  const PERIOD_ONE_DAY_IN_SECONDS = new BN('86400');

  const PERCENTAGE_MODULO = new BN('10000');

  // 5% to 2 DP
  const SERVICE_PROVIDER_ALICE_SERVICE_FEE_PERCENTAGE = new BN('500');

  // 15% to 2 dp
  const SERVICE_PROVIDER_BOB_SERVICE_FEE_PERCENTAGE = new BN('1500');

  const SERVICE_PROVIDER_CHARLIE_SERVICE_FEE_PERCENTAGE = new BN('1000');

  const daysInSeconds = (days) => days.mul(PERIOD_ONE_DAY_IN_SECONDS);

  const shouldBeNumberInEtherCloseTo = (valInWei, expected) => parseFloat(fromWei(valInWei)).should.be.closeTo(parseFloat(expected.toString()), 0.000001);

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

  describe('addRewardsProgramme()', () => {
    it('Reverts when not admin', async () => {
      await expectRevert(
        this.stakingRewards.addRewardsProgramme('100', '0', true, {from: serviceProviderAlice}),
        "OA"
      );
    });

    it('Reverts when rewards programme is active', async () => {
      await this.stakingRewards.addRewardsProgramme('100', '100', true, {from: cudos});
      await expectRevert(
        this.stakingRewards.addRewardsProgramme('100', '100', true, {from: cudos}),
        "PAA"
      );
    });

    it('Reverts when supplying an alloc point of zero', async () => {
      await expectRevert(
        this.stakingRewards.addRewardsProgramme('0', '100', true, {from: cudos}),
        "IAP"
      );
    });

  });

  describe('updateRewardProgramme()', () => {
    it('Does nothing when no one has staked', async () => {
      await this.stakingRewards.addRewardsProgramme('100', '250', true, {from: cudos});
      await this.stakingRewards.fixBlockNumber('10', {from: cudos});
      await this.stakingRewards.updateRewardProgramme(REWARDS_PROGRAMME_TWO_ID);
    });
  });

  describe('updateUserActionsPaused()', () => {
    it('Reverts when sender is not admin', async () => {
      await expectRevert(
        this.stakingRewards.updateUserActionsPaused(true, {from: fred}),
        "OA"
      );
    });

    it('When user actions are PSD, cannot stake', async () => {
      await this.stakingRewards.updateUserActionsPaused(true, {from: cudos});
      await expectRevert(
        this.stakingRewards.stake(REWARDS_PROGRAMME_ONE_ID, fred, '5', {from: fred}),
        "PSD"
      )
    });

    it('When user actions are PSD, cannot withdraw', async () => {
      await this.stakingRewards.updateUserActionsPaused(true, {from: cudos});
      await expectRevert(
        this.stakingRewards.withdraw(REWARDS_PROGRAMME_ONE_ID, fred, '5', {from: fred}),
        "PSD"
      )
    });
  });

  describe('staking', async () => {
    beforeEach(async () => {
      // set up fred to delegate stake
      await this.token.transfer(fred, STAKE_VALUE, {from: cudos});
      await this.token.approve(this.stakingRewards.address, STAKE_VALUE, {from: fred});

      // set up greg to delegate stake
      await this.token.transfer(greg, STAKE_VALUE, {from: cudos});
      await this.token.approve(this.stakingRewards.address, STAKE_VALUE, {from: greg});
    });

    it('reverts if staking nothing', async () => {
      await expectRevert(
        this.serviceProviderAliceContract.delegateStake(ZERO, {from: fred}),
        'SPC6'
      );
    });

    it('reverts when trying to stake nothing', async () => {
      await expectRevert(
        this.stakingRewards.stake(REWARDS_PROGRAMME_ONE_ID, fred, '0', {from: fred}),
        "SPC6"
      );
    });

    it('reverts when not a whitelisted service provider', async () => {
      await expectRevert(
        this.stakingRewards.stake(REWARDS_PROGRAMME_ONE_ID, fred, '5', {from: fred}),
        "SPU1"
      );
    });

    describe('Single service provider', () => {
      it('can delegate stake before start block and get rewards', async () => {
        (await this.token.balanceOf(fred)).should.be.bignumber.equal(STAKE_VALUE);

        await this.serviceProviderAliceContract.delegateStake(STAKE_VALUE, {from: fred});

        (await this.token.balanceOf(fred)).should.be.bignumber.equal(ZERO);

        const totalDelegatedStake = STAKE_VALUE.add(REQUIRED_SERVICE_PROVIDER_BOND);
        (await this.stakingRewards.amountStakedByUserInRewardProgramme(
          REWARDS_PROGRAMME_ONE_ID,
          this.serviceProviderAliceProxyAddress
        )).should.be.bignumber.equal(
          totalDelegatedStake
        );

        (await this.stakingRewards.totalStakedAcrossAllRewardProgrammes()).should.be.bignumber.equal(
          totalDelegatedStake
        );

        (await this.stakingRewards.totalStakedInRewardProgramme(REWARDS_PROGRAMME_ONE_ID)).should.be.bignumber.equal(
          totalDelegatedStake
        );

        (await this.serviceProviderAliceContract.delegatedStake(fred)).should.be.bignumber.equal(STAKE_VALUE);
        (await this.serviceProviderAliceContract.rewardDebt(fred)).should.be.bignumber.equal(ZERO);
        (await this.serviceProviderAliceContract.totalDelegatedStake()).should.be.bignumber.equal(STAKE_VALUE.add(REQUIRED_SERVICE_PROVIDER_BOND));
        (await this.serviceProviderAliceContract.accTokensPerShare()).should.be.bignumber.equal(ZERO);
        (await this.serviceProviderAliceContract.pendingRewards(fred)).should.be.bignumber.equal(ZERO);

        // start block for rewards is block #5, so 2 blocks means 2 * 100 block rewards = 200 * 10 ^18
        await this.stakingRewards.fixBlockNumber('7', {from: cudos});
        const expectedRewardToServiceProviderAliceContract = rewardPerBlock.muln(2);

        shouldBeNumberInEtherCloseTo(
          await this.stakingRewards.pendingCudoRewards(
            REWARDS_PROGRAMME_ONE_ID,
            this.serviceProviderAliceContract.address
          ),
          fromWei(expectedRewardToServiceProviderAliceContract)
        );

        const serviceProviderAliceCudoBalanceBeforeRewardClaim = await this.token.balanceOf(serviceProviderAlice);

        // Due to fred delegating 100k stake to the service provider contract, he is entitled to 5% of the rewards minus the service fee
        await this.serviceProviderAliceContract.getReward({from: fred});

        const serviceProviderAliceCudoBalanceAfterRewardClaim = await this.token.balanceOf(serviceProviderAlice);

        // Reward to the proxy is roughly 200 cudos - calcs lose dust!
        const stakeDelegatedToServiceProvider = STAKE_VALUE;
        const percentageOfStakeThatIsDelegatedToServiceProvider =
          stakeDelegatedToServiceProvider.mul(PERCENTAGE_MODULO).div(totalDelegatedStake);

        // Should be 500 or 5% but solidity has its own ideas about division...
        percentageOfStakeThatIsDelegatedToServiceProvider.should.be.bignumber.equal('476');

        const grossRewardsDueToFreddy = expectedRewardToServiceProviderAliceContract.mul(percentageOfStakeThatIsDelegatedToServiceProvider).div(PERCENTAGE_MODULO);
        const rewardsFee = grossRewardsDueToFreddy.mul(SERVICE_PROVIDER_ALICE_SERVICE_FEE_PERCENTAGE).div(PERCENTAGE_MODULO);

        const netRewardsDueToFreddy = grossRewardsDueToFreddy.sub(rewardsFee);

        const rewardDueToServiceProvider = expectedRewardToServiceProviderAliceContract.sub(netRewardsDueToFreddy);

        shouldBeNumberInEtherCloseTo(
          serviceProviderAliceCudoBalanceAfterRewardClaim.sub(serviceProviderAliceCudoBalanceBeforeRewardClaim),
          fromWei(rewardDueToServiceProvider)
        );

        // this is roughly 5% of the rewards minus the service fee taken above and sent to alice
        shouldBeNumberInEtherCloseTo(await this.token.balanceOf(fred), fromWei(netRewardsDueToFreddy));
      });

      it('can delegate stake after start block (before delegation service provider gets 100% of the rewards)', async () => {
        // ensure alice service provider is all set up
        (await this.stakingRewards.totalStakedAcrossAllRewardProgrammes()).should.be.bignumber.equal(
          REQUIRED_SERVICE_PROVIDER_BOND
        );

        (await this.stakingRewards.totalStakedInRewardProgramme(REWARDS_PROGRAMME_ONE_ID)).should.be.bignumber.equal(
          REQUIRED_SERVICE_PROVIDER_BOND
        );

        // move to block 7. Start reward block is 5 so 2 blocks worth of rewards should be due to service provider alice
        await this.stakingRewards.fixBlockNumber('7', {from: cudos});
        const expectedRewardToServiceProviderAliceContract = rewardPerBlock.muln(2);

        shouldBeNumberInEtherCloseTo(
          await this.stakingRewards.pendingCudoRewards(
            REWARDS_PROGRAMME_ONE_ID,
            this.serviceProviderAliceContract.address
          ),
          fromWei(expectedRewardToServiceProviderAliceContract)
        );

        // Let alice claim the 200 cudo reward (minus dust due to calcs)
        const serviceProviderAliceCudoBalanceBeforeRewardClaim = await this.token.balanceOf(serviceProviderAlice);

        await this.serviceProviderAliceContract.getReward({from: serviceProviderAlice});

        const serviceProviderAliceCudoBalanceAfterRewardClaim = await this.token.balanceOf(serviceProviderAlice);

        shouldBeNumberInEtherCloseTo(
          serviceProviderAliceCudoBalanceAfterRewardClaim.sub(serviceProviderAliceCudoBalanceBeforeRewardClaim),
          fromWei(expectedRewardToServiceProviderAliceContract)
        );

        // now stake as freddy
        (await this.token.balanceOf(fred)).should.be.bignumber.equal(STAKE_VALUE);

        await this.serviceProviderAliceContract.delegateStake(STAKE_VALUE, {from: fred});

        (await this.token.balanceOf(fred)).should.be.bignumber.equal(ZERO);

        const totalDelegatedStake = STAKE_VALUE.add(REQUIRED_SERVICE_PROVIDER_BOND);
        (await this.stakingRewards.amountStakedByUserInRewardProgramme(
          REWARDS_PROGRAMME_ONE_ID,
          this.serviceProviderAliceProxyAddress
        )).should.be.bignumber.equal(
          totalDelegatedStake
        );

        (await this.stakingRewards.totalStakedAcrossAllRewardProgrammes()).should.be.bignumber.equal(
          totalDelegatedStake
        );

        (await this.stakingRewards.totalStakedInRewardProgramme(REWARDS_PROGRAMME_ONE_ID)).should.be.bignumber.equal(
          totalDelegatedStake
        );

        (await this.serviceProviderAliceContract.delegatedStake(fred)).should.be.bignumber.equal(STAKE_VALUE);
        (await this.serviceProviderAliceContract.rewardDebt(fred)).should.be.bignumber.equal(ZERO);
        (await this.serviceProviderAliceContract.totalDelegatedStake()).should.be.bignumber.equal(STAKE_VALUE.add(REQUIRED_SERVICE_PROVIDER_BOND));
        (await this.serviceProviderAliceContract.accTokensPerShare()).should.be.bignumber.equal(ZERO);
        (await this.serviceProviderAliceContract.pendingRewards(fred)).should.be.bignumber.equal(ZERO);

        // move 2 more blocks along for another 2 blocks worth of rewards i.e. 200
        await this.stakingRewards.fixBlockNumber('9', {from: cudos});

        shouldBeNumberInEtherCloseTo(
          await this.stakingRewards.pendingCudoRewards(
            REWARDS_PROGRAMME_ONE_ID,
            this.serviceProviderAliceContract.address
          ),
          fromWei(expectedRewardToServiceProviderAliceContract)
        );

        const serviceProviderAliceCudoBalanceBeforeRewardClaim2 = await this.token.balanceOf(serviceProviderAlice);

        // Due to fred delegating 100k stake to the service provider contract, he is entitled to 5% of the rewards minus the service fee
        await this.serviceProviderAliceContract.getReward({from: fred});

        const serviceProviderAliceCudoBalanceAfterRewardClaim2 = await this.token.balanceOf(serviceProviderAlice);

        // Reward to the proxy is roughly 200 cudos - calcs lose dust!
        const stakeDelegatedToServiceProvider = STAKE_VALUE;
        const percentageOfStakeThatIsDelegatedToServiceProvider =
          stakeDelegatedToServiceProvider.mul(PERCENTAGE_MODULO).div(totalDelegatedStake);

        // Should be 500 or 5% but solidity has its own ideas about division...
        percentageOfStakeThatIsDelegatedToServiceProvider.should.be.bignumber.equal('476');

        const grossRewardsDueToFreddy = expectedRewardToServiceProviderAliceContract.mul(percentageOfStakeThatIsDelegatedToServiceProvider).div(PERCENTAGE_MODULO);
        const rewardsFee = grossRewardsDueToFreddy.mul(SERVICE_PROVIDER_ALICE_SERVICE_FEE_PERCENTAGE).div(PERCENTAGE_MODULO);

        const netRewardsDueToFreddy = grossRewardsDueToFreddy.sub(rewardsFee);

        const rewardDueToServiceProvider = expectedRewardToServiceProviderAliceContract.sub(netRewardsDueToFreddy);

        shouldBeNumberInEtherCloseTo(
          serviceProviderAliceCudoBalanceAfterRewardClaim2.sub(serviceProviderAliceCudoBalanceBeforeRewardClaim2),
          fromWei(rewardDueToServiceProvider)
        );

        // this is roughly 5% of the rewards minus the service fee taken above and sent to alice
        shouldBeNumberInEtherCloseTo(await this.token.balanceOf(fred), fromWei(netRewardsDueToFreddy));
      });

      //todo test with 2 delegators to service provider alice i.e. gregg stakes too
    });

    describe('Multiple service providers', () => {
      describe('using rewards programmes with different alloc points', () => {
        beforeEach(async () => {
          // upfront, get freddy to delegate stake to alice
          await this.serviceProviderAliceContract.delegateStake(STAKE_VALUE, {from: fred});

          (await this.stakingRewards.amountStakedByUserInRewardProgramme(
            REWARDS_PROGRAMME_ONE_ID,
            this.serviceProviderAliceContract.address
          )).should.be.bignumber.equal(STAKE_VALUE.add(REQUIRED_SERVICE_PROVIDER_BOND));

          // reward programme #1 already has an allocation point of 100, to make #2 get 2/3 of the rewards, this alloc point needs to be '200'
          // however, stakers have to stake for a min of 50 blocks
          this.rewardProgramme2AllocPoint = new BN('200');
          await this.stakingRewards.addRewardsProgramme(this.rewardProgramme2AllocPoint, '50', true, {from: cudos});

          // set up service provider bob and stake into programme #2
          await this.stakingRewards.whitelistServiceProvider(serviceProviderBob, {from: cudos});
          this.serviceProviderBobProxyAddress = await this.stakingRewards.serviceProviderToWhitelistedProxyContracts(
            serviceProviderBob
          );

          await this.token.transfer(serviceProviderBob, REQUIRED_SERVICE_PROVIDER_BOND, {from: cudos});
          await this.token.approve(this.stakingRewards.address, REQUIRED_SERVICE_PROVIDER_BOND, {from: serviceProviderBob});
          this.serviceProviderBobContract = await ServiceProvider.at(this.serviceProviderBobProxyAddress);
          await this.serviceProviderBobContract.stakeServiceProviderBond(
            REWARDS_PROGRAMME_TWO_ID,
            SERVICE_PROVIDER_BOB_SERVICE_FEE_PERCENTAGE,
            {from: serviceProviderBob}
          );

          // get greg to delegate to bob
          await this.serviceProviderBobContract.delegateStake(STAKE_VALUE, {from: greg});

          (await this.stakingRewards.amountStakedByUserInRewardProgramme(
            REWARDS_PROGRAMME_TWO_ID,
            this.serviceProviderBobContract.address
          )).should.be.bignumber.equal(STAKE_VALUE.add(REQUIRED_SERVICE_PROVIDER_BOND));
        });

        it('Correctly distributes rewards among both reward programmes, service providers and delegators', async () => {
          // move to block #15. 10 blocks of rewards means 1000 CUDOs in total to distribute to each service provider and delegator
          await this.stakingRewards.fixBlockNumber('15', {from: cudos});
          const totalRewardsAvailable = rewardPerBlock.muln(10);
          // Pending rewards for Alice should be 1/4 of totalRewardsAvailable and Bob the rest
          // first we need the staked balances in both SPs
          const serviceProviderAliceCudoStake = (await this.stakingRewards.amountStakedByUserInRewardProgramme(
            REWARDS_PROGRAMME_ONE_ID,
            this.serviceProviderAliceContract.address
          ));
          const serviceProviderBobCudoStake = (await this.stakingRewards.amountStakedByUserInRewardProgramme(
            REWARDS_PROGRAMME_TWO_ID,
            this.serviceProviderBobContract.address
          ));
          
          const expectedAlicePending = totalRewardsAvailable.mul(this.rewardProgramme1AllocPoint).mul(serviceProviderAliceCudoStake).div(this.rewardProgramme1AllocPoint.mul(serviceProviderAliceCudoStake).add(this.rewardProgramme2AllocPoint.mul(serviceProviderBobCudoStake)));
          const alicePending = await this.stakingRewards.pendingCudoRewards(REWARDS_PROGRAMME_ONE_ID, this.serviceProviderAliceContract.address);
          shouldBeNumberInEtherCloseTo(
            alicePending,
            fromWei(expectedAlicePending)
          );

          const expectedBobPending = totalRewardsAvailable.mul(this.rewardProgramme2AllocPoint).mul(serviceProviderBobCudoStake).div(this.rewardProgramme1AllocPoint.mul(serviceProviderAliceCudoStake).add(this.rewardProgramme2AllocPoint.mul(serviceProviderBobCudoStake)));
          const bobPending = await this.stakingRewards.pendingCudoRewards(REWARDS_PROGRAMME_TWO_ID, this.serviceProviderBobContract.address);
          shouldBeNumberInEtherCloseTo(
            bobPending,
            fromWei(expectedBobPending)
          );

          // Now freddy claims their rewards which pays out service provider alice's rewards
          const serviceProviderAliceCudoBalanceBeforeRewardClaim = await this.token.balanceOf(serviceProviderAlice);

          await this.serviceProviderAliceContract.getReward({from: fred});

          const serviceProviderAliceCudoBalanceAfterRewardClaim = await this.token.balanceOf(serviceProviderAlice);

          const stakeDelegatedToServiceProvider = STAKE_VALUE;
          const percentageOfStakeThatIsDelegatedToServiceProvider =
            stakeDelegatedToServiceProvider.mul(PERCENTAGE_MODULO).div(STAKE_VALUE.add(REQUIRED_SERVICE_PROVIDER_BOND));

          // Should be 500 or 5% but solidity has its own ideas about division...
          percentageOfStakeThatIsDelegatedToServiceProvider.should.be.bignumber.equal('476');

          const grossRewardsDueToFreddy = expectedAlicePending.mul(percentageOfStakeThatIsDelegatedToServiceProvider).div(PERCENTAGE_MODULO);
          const rewardsFee = grossRewardsDueToFreddy.mul(SERVICE_PROVIDER_ALICE_SERVICE_FEE_PERCENTAGE).div(PERCENTAGE_MODULO);

          const netRewardsDueToFreddy = grossRewardsDueToFreddy.sub(rewardsFee);

          const rewardDueToServiceProvider = expectedAlicePending.sub(netRewardsDueToFreddy);

          shouldBeNumberInEtherCloseTo(
            serviceProviderAliceCudoBalanceAfterRewardClaim.sub(serviceProviderAliceCudoBalanceBeforeRewardClaim),
            fromWei(rewardDueToServiceProvider)
          );

          // this is roughly 5% of the rewards minus the service fee taken above and sent to alice
          shouldBeNumberInEtherCloseTo(await this.token.balanceOf(fred), fromWei(netRewardsDueToFreddy));

          // Now greg claims their rewards which pays out service provider alice's rewards
          const serviceProviderBobCudoBalanceBeforeRewardClaim = await this.token.balanceOf(serviceProviderBob);

          await this.serviceProviderBobContract.getReward({from: greg});

          const serviceProviderBobCudoBalanceAfterRewardClaim = await this.token.balanceOf(serviceProviderBob);

          // Should be 500 or 5% but solidity has its own ideas about division...
          percentageOfStakeThatIsDelegatedToServiceProvider.should.be.bignumber.equal('476');

          const grossRewardsDueToGreg = expectedBobPending.mul(percentageOfStakeThatIsDelegatedToServiceProvider).div(PERCENTAGE_MODULO);
          const expectedRewardsFee = grossRewardsDueToGreg.mul(SERVICE_PROVIDER_BOB_SERVICE_FEE_PERCENTAGE).div(PERCENTAGE_MODULO);

          const netRewardsDueToGreg = grossRewardsDueToGreg.sub(expectedRewardsFee);

          const rewardDueToBob = expectedBobPending.sub(netRewardsDueToGreg);

          shouldBeNumberInEtherCloseTo(
            serviceProviderBobCudoBalanceAfterRewardClaim.sub(serviceProviderBobCudoBalanceBeforeRewardClaim),
            fromWei(rewardDueToBob)
          );

          // this is roughly 5% of the rewards minus the service fee taken above and sent to alice
          shouldBeNumberInEtherCloseTo(await this.token.balanceOf(greg), fromWei(netRewardsDueToGreg));
        });
      });

      describe('using rewards programmes with different alloc points', () => {
        beforeEach(async () => {
          
          // reward programme #1 already has an allocation point of 100, so create a second one with 200
          // however, stakers have to stake for a min of 50 blocks
          this.rewardProgramme2AllocPoint = new BN('200');
          await this.stakingRewards.addRewardsProgramme(this.rewardProgramme2AllocPoint, '50', true, {from: cudos});

          // set up service provider bob and stake into programme #2
          await this.stakingRewards.whitelistServiceProvider(serviceProviderBob, {from: cudos});
          this.serviceProviderBobProxyAddress = await this.stakingRewards.serviceProviderToWhitelistedProxyContracts(
            serviceProviderBob
          );

          await this.token.transfer(serviceProviderBob, REQUIRED_SERVICE_PROVIDER_BOND, {from: cudos});
          await this.token.approve(this.stakingRewards.address, REQUIRED_SERVICE_PROVIDER_BOND, {from: serviceProviderBob});
          this.serviceProviderBobContract = await ServiceProvider.at(this.serviceProviderBobProxyAddress);
          await this.serviceProviderBobContract.stakeServiceProviderBond(
            REWARDS_PROGRAMME_TWO_ID,
            SERVICE_PROVIDER_BOB_SERVICE_FEE_PERCENTAGE,
            {from: serviceProviderBob}
          );
        });

        it('Correctly distributes rewards among multiple reward programmes even after a service provider exits', async () => {
          
          // Move to block #15. 10 blocks of rewards means 1000 CUDOs in total to distribute to each service provider and delegator
          await this.stakingRewards.fixBlockNumber('15', {from: cudos});

          // Check if both Alice and Bob have 2M staked
          (await this.stakingRewards.amountStakedByUserInRewardProgramme(
            REWARDS_PROGRAMME_ONE_ID,
            this.serviceProviderAliceContract.address
          )).should.be.bignumber.equal(REQUIRED_SERVICE_PROVIDER_BOND);

          (await this.stakingRewards.amountStakedByUserInRewardProgramme(
            REWARDS_PROGRAMME_TWO_ID,
            this.serviceProviderBobContract.address
          )).should.be.bignumber.equal(REQUIRED_SERVICE_PROVIDER_BOND);

          // Name both contract's total stake
          const serviceProviderAliceCudoStake = (await this.stakingRewards.amountStakedByUserInRewardProgramme(
            REWARDS_PROGRAMME_ONE_ID,
            this.serviceProviderAliceContract.address
          ));
          const serviceProviderAliceCudoStakeWeight = this.rewardProgramme1AllocPoint.mul(serviceProviderAliceCudoStake);

          const serviceProviderBobCudoStake = (await this.stakingRewards.amountStakedByUserInRewardProgramme(
            REWARDS_PROGRAMME_TWO_ID,
            this.serviceProviderBobContract.address
          ));
          const serviceProviderBobCudoStakeWeight = this.rewardProgramme2AllocPoint.mul(serviceProviderBobCudoStake);

          //Set up and get Greg to delegate 2M to Bob
          await this.token.transfer(greg, STAKE_VALUE_TM, {from: cudos});
          await this.token.approve(this.stakingRewards.address, STAKE_VALUE_TM, {from: greg});
          await this.serviceProviderBobContract.delegateStake(STAKE_VALUE_TM, {from: greg});

          (await this.stakingRewards.amountStakedByUserInRewardProgramme(
            REWARDS_PROGRAMME_TWO_ID,
            this.serviceProviderBobContract.address
          )).should.be.bignumber.equal(STAKE_VALUE_TM.add(REQUIRED_SERVICE_PROVIDER_BOND));

          const totalRewardsPerPeriod = rewardPerBlock.muln(10);

          const serviceProviderBobCudoStakeAfterGreg = (await this.stakingRewards.amountStakedByUserInRewardProgramme(
            REWARDS_PROGRAMME_TWO_ID,
            this.serviceProviderBobContract.address
          ));
          const serviceProviderBobCudoStakeWeightAfterGreg = this.rewardProgramme2AllocPoint.mul(serviceProviderBobCudoStakeAfterGreg);

          const expectedAliceContractPending15Block = totalRewardsPerPeriod.mul(serviceProviderAliceCudoStakeWeight).div(
            serviceProviderAliceCudoStakeWeight.add(serviceProviderBobCudoStakeWeight)
          );

          // Check if Alice's contract rewards are calculated correctly at block #15
          const aliceContractPending15Block = await this.stakingRewards.pendingCudoRewards(REWARDS_PROGRAMME_ONE_ID, this.serviceProviderAliceContract.address);
          shouldBeNumberInEtherCloseTo(aliceContractPending15Block, fromWei(expectedAliceContractPending15Block));
          
          
          
          // Move to block #25. 10 more blocks of rewards means 1000 more CUDOS in total to distribute to each service provider and delegator
          await this.stakingRewards.fixBlockNumber('25', {from: cudos});
          
          // Pending rewards for Alice should be 1/3 of total rewards before Greg, plus 1/5 after Greg
          const expectedAliceContractPending25Block = totalRewardsPerPeriod.mul(serviceProviderAliceCudoStakeWeight).div(
            serviceProviderAliceCudoStakeWeight.add(serviceProviderBobCudoStakeWeight)).add(totalRewardsPerPeriod.mul(serviceProviderAliceCudoStakeWeight).div(
              serviceProviderAliceCudoStakeWeight.add(serviceProviderBobCudoStakeWeightAfterGreg)
            )
          );

          // Check if Alice's contract rewards are calculated correctly
          const aliceContractPending25Block = await this.stakingRewards.pendingCudoRewards(REWARDS_PROGRAMME_ONE_ID, this.serviceProviderAliceContract.address);
          shouldBeNumberInEtherCloseTo(aliceContractPending25Block, fromWei(expectedAliceContractPending25Block));
          
          // What about Bob's contract? It should be just the last 10 blocks worth of rewards since Bob must have received his rewards when Greg delegated to him at block #15 
          const expectedBobContractPending25Block = totalRewardsPerPeriod.mul(serviceProviderBobCudoStakeWeightAfterGreg).div(
            serviceProviderAliceCudoStakeWeight.add(serviceProviderBobCudoStakeWeightAfterGreg)
          );          
          const bobContractPending25Block = await this.stakingRewards.pendingCudoRewards(REWARDS_PROGRAMME_TWO_ID, this.serviceProviderBobContract.address);
          shouldBeNumberInEtherCloseTo(bobContractPending25Block, fromWei(expectedBobContractPending25Block));

          // Set up Charlie as a SP in programme 2
          await this.stakingRewards.whitelistServiceProvider(serviceProviderCharlie, {from: cudos});
          this.serviceProviderCharlieProxyAddress = await this.stakingRewards.serviceProviderToWhitelistedProxyContracts(
            serviceProviderCharlie
          );

          await this.token.transfer(serviceProviderCharlie, REQUIRED_SERVICE_PROVIDER_BOND, {from: cudos});
          await this.token.approve(this.stakingRewards.address, REQUIRED_SERVICE_PROVIDER_BOND, {from: serviceProviderCharlie});
          this.serviceProviderCharlieContract = await ServiceProvider.at(this.serviceProviderCharlieProxyAddress);
          await this.serviceProviderCharlieContract.stakeServiceProviderBond(
            REWARDS_PROGRAMME_TWO_ID,
            SERVICE_PROVIDER_CHARLIE_SERVICE_FEE_PERCENTAGE,
            {from: serviceProviderCharlie}
          );

          // Check Charlie's contract's stake balance
          (await this.stakingRewards.amountStakedByUserInRewardProgramme(
            REWARDS_PROGRAMME_TWO_ID,
            this.serviceProviderCharlieContract.address
          )).should.be.bignumber.equal(REQUIRED_SERVICE_PROVIDER_BOND);

          //Set up and get Fred to delegate 5M to Alice
          await this.token.transfer(fred, STAKE_VALUE_BIG, {from: cudos});
          await this.token.approve(this.stakingRewards.address, STAKE_VALUE_BIG, {from: fred});
          await this.serviceProviderAliceContract.delegateStake(STAKE_VALUE_BIG, {from: fred});

          // Check Alice's contract's stake balance
          (await this.stakingRewards.amountStakedByUserInRewardProgramme(
            REWARDS_PROGRAMME_ONE_ID,
            this.serviceProviderAliceContract.address
          )).should.be.bignumber.equal(STAKE_VALUE_BIG.add(REQUIRED_SERVICE_PROVIDER_BOND));
          
          

          // Move to block #35
          await this.stakingRewards.fixBlockNumber('35', {from: cudos});

          // First set staked balances in all three SPs
          const serviceProviderAliceCudoStakeAfterFred = (await this.stakingRewards.amountStakedByUserInRewardProgramme(
            REWARDS_PROGRAMME_ONE_ID,
            this.serviceProviderAliceContract.address
          ));
          const serviceProviderAliceCudoStakeWeightAfterFred = this.rewardProgramme1AllocPoint.mul(serviceProviderAliceCudoStakeAfterFred);
          
          const serviceProviderCharlieCudoStake = (await this.stakingRewards.amountStakedByUserInRewardProgramme(
            REWARDS_PROGRAMME_TWO_ID,
            this.serviceProviderCharlieContract.address
          ));
          const serviceProviderCharlieCudoStakeWeight = this.rewardProgramme2AllocPoint.mul(serviceProviderCharlieCudoStake);

          // Alice's contract's peding rewards must come only from the last 10-block period since Fred staked there at block #25 which sends Alice her rewards
          const expectedAliceContractPending35Block = totalRewardsPerPeriod.mul(serviceProviderAliceCudoStakeWeightAfterFred).div(
            serviceProviderAliceCudoStakeWeightAfterFred.add(serviceProviderBobCudoStakeWeightAfterGreg).add(serviceProviderCharlieCudoStakeWeight)
          );
          
          // Check if Alice's contract rewards are calculated correctly
          const aliceContractPending35Block = await this.stakingRewards.pendingCudoRewards(REWARDS_PROGRAMME_ONE_ID, this.serviceProviderAliceContract.address);
          shouldBeNumberInEtherCloseTo(aliceContractPending35Block, fromWei(expectedAliceContractPending35Block));

          // Bob's contract
          const expectedBobContractPending35Block = expectedBobContractPending25Block.add(totalRewardsPerPeriod.mul(serviceProviderBobCudoStakeWeightAfterGreg).div(
            serviceProviderAliceCudoStakeWeightAfterFred.add(serviceProviderBobCudoStakeWeightAfterGreg).add(serviceProviderCharlieCudoStakeWeight)
          ));

          // Compare with the contractual pending amount
          const bobContractPending35Block = await this.stakingRewards.pendingCudoRewards(REWARDS_PROGRAMME_TWO_ID, this.serviceProviderBobContract.address);
          shouldBeNumberInEtherCloseTo(bobContractPending35Block, fromWei(expectedBobContractPending35Block));

          // And now Charlie's contract
          const expectedCharlieContractPending35Block = totalRewardsPerPeriod.mul(serviceProviderCharlieCudoStakeWeight).div(
            serviceProviderAliceCudoStakeWeightAfterFred.add(serviceProviderBobCudoStakeWeightAfterGreg).add(serviceProviderCharlieCudoStakeWeight)
          );
          const charlieContractPending35Block = await this.stakingRewards.pendingCudoRewards(REWARDS_PROGRAMME_TWO_ID, this.serviceProviderCharlieContract.address);
          shouldBeNumberInEtherCloseTo(charlieContractPending35Block, fromWei(expectedCharlieContractPending35Block));

          // Update allocation point of programme 2 to 400
          const programme2NewAllocPoint = new BN('400');
          await this.stakingRewards.updateAllocPointForRewardProgramme(
            REWARDS_PROGRAMME_TWO_ID,
            programme2NewAllocPoint,
            true,
            {from: cudos}
          );

          // Update stake weights of Bob and Charlie contracts
          const serviceProviderBobCudoStakeWeightAfterUpdate = programme2NewAllocPoint.mul(serviceProviderBobCudoStakeAfterGreg);
          const serviceProviderCharlieCudoStakeWeightAfterUpdate = programme2NewAllocPoint.mul(serviceProviderCharlieCudoStake);



          // Move to block #45
          await this.stakingRewards.fixBlockNumber('45', {from: cudos});

          // Check each contract's pending rewards. Note that Bob and Charlie weights are doubled since block #35
          const expectedAliceContractPending45Block = expectedAliceContractPending35Block.add(totalRewardsPerPeriod.mul(serviceProviderAliceCudoStakeWeightAfterFred).div(
            serviceProviderAliceCudoStakeWeightAfterFred.add(serviceProviderBobCudoStakeWeightAfterUpdate).add(serviceProviderCharlieCudoStakeWeightAfterUpdate)
          ));
          const aliceContractPending45Block = await this.stakingRewards.pendingCudoRewards(REWARDS_PROGRAMME_ONE_ID, this.serviceProviderAliceContract.address);
          shouldBeNumberInEtherCloseTo(aliceContractPending45Block, fromWei(expectedAliceContractPending45Block));

          const expectedBobContractPending45Block = expectedBobContractPending35Block.add(totalRewardsPerPeriod.mul(serviceProviderBobCudoStakeWeightAfterUpdate).div(
            serviceProviderAliceCudoStakeWeightAfterFred.add(serviceProviderBobCudoStakeWeightAfterUpdate).add(serviceProviderCharlieCudoStakeWeightAfterUpdate)
          ));
          const bobContractPending45Block = await this.stakingRewards.pendingCudoRewards(REWARDS_PROGRAMME_TWO_ID, this.serviceProviderBobContract.address);
          shouldBeNumberInEtherCloseTo(bobContractPending45Block, fromWei(expectedBobContractPending45Block));

          const expectedCharlieContractPending45Block = expectedCharlieContractPending35Block.add(totalRewardsPerPeriod.mul(serviceProviderCharlieCudoStakeWeightAfterUpdate).div(
            serviceProviderAliceCudoStakeWeightAfterFred.add(serviceProviderBobCudoStakeWeightAfterUpdate).add(serviceProviderCharlieCudoStakeWeightAfterUpdate)
          ));        
          const charlieContractPending45Block = await this.stakingRewards.pendingCudoRewards(REWARDS_PROGRAMME_TWO_ID, this.serviceProviderCharlieContract.address);
          shouldBeNumberInEtherCloseTo(charlieContractPending45Block, fromWei(expectedCharlieContractPending45Block));

          // Alice exits as a service provider
          await this.serviceProviderAliceContract.exitAsServiceProvider({from: serviceProviderAlice});

          // Move ten more blocks, and check if Fred, who has delegated to Alice, can recover his stake and rewards correctly
          await this.stakingRewards.fixBlockNumber('55', {from: cudos});
          const fredStake = STAKE_VALUE_BIG;
          const serviceProviderAliceStake = REQUIRED_SERVICE_PROVIDER_BOND;
          const percentageOfStakeThatIsDelegatedToServiceProviderAlice = fredStake.mul(PERCENTAGE_MODULO).div(fredStake.add(serviceProviderAliceStake));
          const grossRewardsDueToFred = aliceContractPending45Block.mul(percentageOfStakeThatIsDelegatedToServiceProviderAlice).div(PERCENTAGE_MODULO);
          const rewardsFeeFred = grossRewardsDueToFred.mul(SERVICE_PROVIDER_ALICE_SERVICE_FEE_PERCENTAGE).div(PERCENTAGE_MODULO);
          const netRewardsDueToFred = grossRewardsDueToFred.sub(rewardsFeeFred); 
          const fredBalanceBeforeGetReward = await this.token.balanceOf(fred);
          await this.serviceProviderAliceContract.exitAsDelegator({from: fred});
          const fredBalanceAfterGetReward = await this.token.balanceOf(fred);
          const fredDelta = fredBalanceAfterGetReward.sub(fredBalanceBeforeGetReward);
          shouldBeNumberInEtherCloseTo(fredDelta, fromWei(fredStake.add(netRewardsDueToFred)));         
        });
      });
      
    });
    describe('Multiple service providers, different stake amounts', () => {
      describe('using rewards programmes with different alloc points', () => {
        beforeEach(async () => {
          // upfront, get freddy to delegate stake to alice
          await this.serviceProviderAliceContract.delegateStake(STAKE_VALUE, {from: fred});

          (await this.stakingRewards.amountStakedByUserInRewardProgramme(
            REWARDS_PROGRAMME_ONE_ID,
            this.serviceProviderAliceContract.address
          )).should.be.bignumber.equal(STAKE_VALUE.add(REQUIRED_SERVICE_PROVIDER_BOND));

          // reward programme #1 already has an allocation point of 100, make #2 to have allocation point of '200' and calculate rewards accordingly
          // however, stakers have to stake for a min of 50 blocks
          this.rewardProgramme2AllocPoint = new BN('200');
          await this.stakingRewards.addRewardsProgramme(this.rewardProgramme2AllocPoint, '50', true, {from: cudos});

          // set up service provider bob and stake into programme #2
          await this.stakingRewards.whitelistServiceProvider(serviceProviderBob, {from: cudos});
          this.serviceProviderBobProxyAddress = await this.stakingRewards.serviceProviderToWhitelistedProxyContracts(
            serviceProviderBob
          );

          await this.token.transfer(serviceProviderBob, REQUIRED_SERVICE_PROVIDER_BOND, {from: cudos});
          await this.token.approve(this.stakingRewards.address, REQUIRED_SERVICE_PROVIDER_BOND, {from: serviceProviderBob});
          this.serviceProviderBobContract = await ServiceProvider.at(this.serviceProviderBobProxyAddress);
          await this.serviceProviderBobContract.stakeServiceProviderBond(
            REWARDS_PROGRAMME_TWO_ID,
            SERVICE_PROVIDER_BOB_SERVICE_FEE_PERCENTAGE,
            {from: serviceProviderBob}
          );

          // set up greg to delegate bigger stake amount
          await this.token.transfer(greg, STAKE_VALUE_BIG.sub(STAKE_VALUE), {from: cudos});
          await this.token.approve(this.stakingRewards.address, STAKE_VALUE_BIG, {from: greg});

          // get greg to delegate to bob
          await this.serviceProviderBobContract.delegateStake(STAKE_VALUE_BIG, {from: greg});

          (await this.stakingRewards.amountStakedByUserInRewardProgramme(
            REWARDS_PROGRAMME_TWO_ID,
            this.serviceProviderBobContract.address
          )).should.be.bignumber.equal(STAKE_VALUE_BIG.add(REQUIRED_SERVICE_PROVIDER_BOND));
        });

        it('Correctly distributes rewards among both reward programmes, service providers and delegators', async () => {
          // move to block #15. 10 blocks of rewards means 1000 CUDOs in total to distribute to each service provider and delegator
          await this.stakingRewards.fixBlockNumber('15', {from: cudos});
          const totalRewardsAvailable = rewardPerBlock.muln(10);

          // Pending rewards for Alice should be 13.04% of totalRewardsAvailable and Bob the rest
          // that is because Alice has 2m SP stake plus 100k delegated, allocPoint 100
          // Bob has 2m SP stake plus 5m delegated, allocPoint 200
          // Alice and her delegators share is 1,000/(2,100,000 * 100 + 7,000,000 * 200) * 2,100,000 * 100 = 130.43
          // out of the 1,000 tokens that will be distributed

          // first we need the staked balances in both SPs
          const serviceProviderAliceCudoStake = (await this.stakingRewards.amountStakedByUserInRewardProgramme(
            REWARDS_PROGRAMME_ONE_ID,
            this.serviceProviderAliceContract.address
          ));
          const serviceProviderBobCudoStake = (await this.stakingRewards.amountStakedByUserInRewardProgramme(
            REWARDS_PROGRAMME_TWO_ID,
            this.serviceProviderBobContract.address
          ));

          const expectedAlicePending = totalRewardsAvailable.mul(serviceProviderAliceCudoStake.mul(this.rewardProgramme1AllocPoint)).div((this.rewardProgramme1AllocPoint.mul(serviceProviderAliceCudoStake)).add(this.rewardProgramme2AllocPoint.mul(serviceProviderBobCudoStake)));
          const alicePending = await this.stakingRewards.pendingCudoRewards(REWARDS_PROGRAMME_ONE_ID, this.serviceProviderAliceContract.address);
          shouldBeNumberInEtherCloseTo(
            alicePending,
            fromWei(expectedAlicePending)
          );
          const expectedBobPending = totalRewardsAvailable.mul(this.rewardProgramme2AllocPoint).mul(serviceProviderBobCudoStake).div(this.rewardProgramme1AllocPoint.mul(serviceProviderAliceCudoStake).add(this.rewardProgramme2AllocPoint.mul(serviceProviderBobCudoStake)));
          const bobPending = await this.stakingRewards.pendingCudoRewards(REWARDS_PROGRAMME_TWO_ID, this.serviceProviderBobContract.address);
          shouldBeNumberInEtherCloseTo(
            bobPending,
            fromWei(expectedBobPending)
          );

          // Now freddy claims their rewards which pays out service provider alice's rewards
          const serviceProviderAliceCudoBalanceBeforeRewardClaim = await this.token.balanceOf(serviceProviderAlice);

          await this.serviceProviderAliceContract.getReward({from: fred});

          const serviceProviderAliceCudoBalanceAfterRewardClaim = await this.token.balanceOf(serviceProviderAlice);

          const stakeDelegatedToServiceProvider = STAKE_VALUE;
          const percentageOfStakeThatIsDelegatedToServiceProviderAlice =
            stakeDelegatedToServiceProvider.mul(PERCENTAGE_MODULO).div(STAKE_VALUE.add(REQUIRED_SERVICE_PROVIDER_BOND));

          // It's 4.76% because 100,000/(100,000 + 2,000,000) = 0.0476 which is Fred's share
          percentageOfStakeThatIsDelegatedToServiceProviderAlice.should.be.bignumber.equal('476');

          const grossRewardsDueToFreddy = expectedAlicePending.mul(percentageOfStakeThatIsDelegatedToServiceProviderAlice).div(PERCENTAGE_MODULO);
          const rewardsFee = grossRewardsDueToFreddy.mul(SERVICE_PROVIDER_ALICE_SERVICE_FEE_PERCENTAGE).div(PERCENTAGE_MODULO);

          const netRewardsDueToFreddy = grossRewardsDueToFreddy.sub(rewardsFee);

          const rewardDueToServiceProvider = expectedAlicePending.sub(netRewardsDueToFreddy);

          shouldBeNumberInEtherCloseTo(
            serviceProviderAliceCudoBalanceAfterRewardClaim.sub(serviceProviderAliceCudoBalanceBeforeRewardClaim),
            fromWei(rewardDueToServiceProvider)
          );

          // this is roughly 4.76% of the rewards minus the service fee taken above and sent to alice
          shouldBeNumberInEtherCloseTo(await this.token.balanceOf(fred), fromWei(netRewardsDueToFreddy));

          // Now greg claims their rewards which pays out service provider alice's rewards
          const serviceProviderBobCudoBalanceBeforeRewardClaim = await this.token.balanceOf(serviceProviderBob);

          await this.serviceProviderBobContract.getReward({from: greg});

          const serviceProviderBobCudoBalanceAfterRewardClaim = await this.token.balanceOf(serviceProviderBob);
          
          const stakeDelegatedToServiceProviderBob = STAKE_VALUE_BIG;
          const percentageOfStakeThatIsDelegatedToServiceProviderBob =
          stakeDelegatedToServiceProviderBob.mul(PERCENTAGE_MODULO).div(STAKE_VALUE_BIG.add(REQUIRED_SERVICE_PROVIDER_BOND));

          // Should be 71.43% as Greg has 5m and Bob 2m (5/7 ~ 0.7142857) -- it seems to truncate rather than round?
          percentageOfStakeThatIsDelegatedToServiceProviderBob.should.be.bignumber.equal('7142');

          const grossRewardsDueToGreg = expectedBobPending.mul(percentageOfStakeThatIsDelegatedToServiceProviderBob).div(PERCENTAGE_MODULO);
          const expectedRewardsFee = grossRewardsDueToGreg.mul(SERVICE_PROVIDER_BOB_SERVICE_FEE_PERCENTAGE).div(PERCENTAGE_MODULO);

          const netRewardsDueToGreg = grossRewardsDueToGreg.sub(expectedRewardsFee);

          const rewardDueToBob = expectedBobPending.sub(netRewardsDueToGreg);

          shouldBeNumberInEtherCloseTo(
            serviceProviderBobCudoBalanceAfterRewardClaim.sub(serviceProviderBobCudoBalanceBeforeRewardClaim),
            fromWei(rewardDueToBob)
          );

          // this is roughly 71% of the rewards minus the service fee taken above and sent to alice
          shouldBeNumberInEtherCloseTo(await this.token.balanceOf(greg), fromWei(netRewardsDueToGreg));
        });
      });
    });
  });

  describe('staking and exit', async () => {
    beforeEach(async () => {
      // set up fred for delegated staking
      await this.token.transfer(fred, STAKE_VALUE, {from: cudos});
      await this.token.approve(this.stakingRewards.address, STAKE_VALUE, {from: fred});
    });

    it('Reverts when calling exit() and not a whitelisted service provider', async () => {
      await expectRevert(
        this.stakingRewards.exit(REWARDS_PROGRAMME_ONE_ID, {from: fred}),
        "SPU1"
      );
    });

    it('can stake and get rewards as a service provider', async () => {
      (await this.token.balanceOf(fred)).should.be.bignumber.equal(STAKE_VALUE);

      await this.serviceProviderAliceContract.delegateStake(STAKE_VALUE, {from: fred});

      (await this.token.balanceOf(fred)).should.be.bignumber.equal(ZERO);

      const totalDelegatedStake = STAKE_VALUE.add(REQUIRED_SERVICE_PROVIDER_BOND);
      (await this.stakingRewards.amountStakedByUserInRewardProgramme(
        REWARDS_PROGRAMME_ONE_ID,
        this.serviceProviderAliceProxyAddress
      )).should.be.bignumber.equal(
        totalDelegatedStake
      );

      (await this.stakingRewards.totalStakedAcrossAllRewardProgrammes()).should.be.bignumber.equal(
        totalDelegatedStake
      );

      (await this.stakingRewards.totalStakedInRewardProgramme(REWARDS_PROGRAMME_ONE_ID)).should.be.bignumber.equal(
        totalDelegatedStake
      );

      (await this.serviceProviderAliceContract.delegatedStake(fred)).should.be.bignumber.equal(STAKE_VALUE);
      (await this.serviceProviderAliceContract.rewardDebt(fred)).should.be.bignumber.equal(ZERO);
      (await this.serviceProviderAliceContract.totalDelegatedStake()).should.be.bignumber.equal(STAKE_VALUE.add(REQUIRED_SERVICE_PROVIDER_BOND));
      (await this.serviceProviderAliceContract.accTokensPerShare()).should.be.bignumber.equal(ZERO);
      (await this.serviceProviderAliceContract.pendingRewards(fred)).should.be.bignumber.equal(ZERO);

      // start block for rewards is block #5, so 2 blocks means 2 * 100 block rewards = 200 * 10 ^18
      await this.stakingRewards.fixBlockNumber('7', {from: cudos});
      const expectedRewardToServiceProviderAliceContract = rewardPerBlock.muln(2);

      shouldBeNumberInEtherCloseTo(
        await this.stakingRewards.pendingCudoRewards(
          REWARDS_PROGRAMME_ONE_ID,
          this.serviceProviderAliceContract.address
        ),
        fromWei(expectedRewardToServiceProviderAliceContract)
      );

      const serviceProviderAliceCudoBalanceBeforeExit = await this.token.balanceOf(serviceProviderAlice);

      await this.serviceProviderAliceContract.exitAsServiceProvider({from: serviceProviderAlice});

      const serviceProviderAliceCudoBalanceAfterExit = await this.token.balanceOf(serviceProviderAlice);

      (await this.stakingRewards.totalStakedAcrossAllRewardProgrammes()).should.be.bignumber.equal(
        ZERO
      );

      (await this.stakingRewards.amountStakedByUserInRewardProgramme(
        REWARDS_PROGRAMME_ONE_ID,
        this.serviceProviderAliceProxyAddress
      )).should.be.bignumber.equal(
        ZERO
      );

      // Although alice has exited, fred still has his stake delegated
      (await this.serviceProviderAliceContract.totalDelegatedStake()).should.be.bignumber.equal(STAKE_VALUE);
      (await this.serviceProviderAliceContract.delegatedStake(fred)).should.be.bignumber.equal(STAKE_VALUE);

      // Reward to the proxy is roughly 200 cudos - calcs lose dust!
      const stakeDelegatedToServiceProvider = STAKE_VALUE;
      const percentageOfStakeThatIsDelegatedToServiceProvider =
        stakeDelegatedToServiceProvider.mul(PERCENTAGE_MODULO).div(totalDelegatedStake);

      // Should be 500 or 5% but solidity has its own ideas about division...
      percentageOfStakeThatIsDelegatedToServiceProvider.should.be.bignumber.equal('476');

      const grossRewardsDueToFreddy = expectedRewardToServiceProviderAliceContract.mul(percentageOfStakeThatIsDelegatedToServiceProvider).div(PERCENTAGE_MODULO);
      const rewardsFee = grossRewardsDueToFreddy.mul(SERVICE_PROVIDER_ALICE_SERVICE_FEE_PERCENTAGE).div(PERCENTAGE_MODULO);

      const netRewardsDueToFreddy = grossRewardsDueToFreddy.sub(rewardsFee);

      // This balance should contain just the rewards earned in the last 24 hours since alice needs to wait for the unbonding period to end to be able to receive her staking bond
      const expectedServiceProviderAliceBalance = serviceProviderAliceCudoBalanceAfterExit.sub(serviceProviderAliceCudoBalanceBeforeExit);
      shouldBeNumberInEtherCloseTo(
        expectedRewardToServiceProviderAliceContract.sub(netRewardsDueToFreddy),
        fromWei(expectedServiceProviderAliceBalance)
      )
    });

    it('After a service provider has exited, there is no unbonding period', async () => {
      (await this.token.balanceOf(fred)).should.be.bignumber.equal(STAKE_VALUE);

      await this.serviceProviderAliceContract.delegateStake(STAKE_VALUE, {from: fred});

      (await this.token.balanceOf(fred)).should.be.bignumber.equal(ZERO);

      const totalDelegatedStake = STAKE_VALUE.add(REQUIRED_SERVICE_PROVIDER_BOND);
      (await this.stakingRewards.amountStakedByUserInRewardProgramme(
        REWARDS_PROGRAMME_ONE_ID,
        this.serviceProviderAliceProxyAddress
      )).should.be.bignumber.equal(
        totalDelegatedStake
      );

      (await this.stakingRewards.totalStakedAcrossAllRewardProgrammes()).should.be.bignumber.equal(
        totalDelegatedStake
      );

      (await this.stakingRewards.totalStakedInRewardProgramme(REWARDS_PROGRAMME_ONE_ID)).should.be.bignumber.equal(
        totalDelegatedStake
      );

      (await this.serviceProviderAliceContract.delegatedStake(fred)).should.be.bignumber.equal(STAKE_VALUE);
      (await this.serviceProviderAliceContract.rewardDebt(fred)).should.be.bignumber.equal(ZERO);
      (await this.serviceProviderAliceContract.totalDelegatedStake()).should.be.bignumber.equal(STAKE_VALUE.add(REQUIRED_SERVICE_PROVIDER_BOND));
      (await this.serviceProviderAliceContract.accTokensPerShare()).should.be.bignumber.equal(ZERO);
      (await this.serviceProviderAliceContract.pendingRewards(fred)).should.be.bignumber.equal(ZERO);

      // start block for rewards is block #5, so 2 blocks means 2 * 100 block rewards = 200 * 10 ^18
      await this.stakingRewards.fixBlockNumber('7', {from: cudos});
      const expectedRewardToServiceProviderAliceContract = rewardPerBlock.muln(2);

      shouldBeNumberInEtherCloseTo(
        await this.stakingRewards.pendingCudoRewards(
          REWARDS_PROGRAMME_ONE_ID,
          this.serviceProviderAliceContract.address
        ),
        fromWei(expectedRewardToServiceProviderAliceContract)
      );

      // request withdrawal before SP exits
      await this.serviceProviderAliceContract.requestDelegatedStakeWithdrawal(STAKE_VALUE, {from: fred})

      // check the withdrawal will fail due to unbonding
      await expectRevert(
        this.serviceProviderAliceContract.withdrawDelegatedStake({from: fred}),
        "SPW3"
      )

      const serviceProviderAliceCudoBalanceBeforeExit = await this.token.balanceOf(serviceProviderAlice);

      await this.serviceProviderAliceContract.exitAsServiceProvider({from: serviceProviderAlice});

      const serviceProviderAliceCudoBalanceAfterExit = await this.token.balanceOf(serviceProviderAlice);

      (await this.stakingRewards.totalStakedAcrossAllRewardProgrammes()).should.be.bignumber.equal(
        ZERO
      );

      (await this.stakingRewards.amountStakedByUserInRewardProgramme(
        REWARDS_PROGRAMME_ONE_ID,
        this.serviceProviderAliceProxyAddress
      )).should.be.bignumber.equal(
        ZERO
      );

      // fred has requested a withdrawal so total delegated should be zero
      (await this.serviceProviderAliceContract.totalDelegatedStake()).should.be.bignumber.equal('0');
      (await this.serviceProviderAliceContract.delegatedStake(fred)).should.be.bignumber.equal('0');

      // Reward to the proxy is roughly 200 cudos - calcs lose dust!
      // This balance should be just the rewards earned in the last 24 hours because of the unbonding effect (see below)
      const expectedServiceProviderAliceBalance = serviceProviderAliceCudoBalanceAfterExit.sub(serviceProviderAliceCudoBalanceBeforeExit);
      shouldBeNumberInEtherCloseTo(
        new BN('0'),
        fromWei(expectedServiceProviderAliceBalance)
      )

      // fred can withdraw his stake due to exiting of SP
      const balanceOfFredBefore = await this.token.balanceOf(fred)

      // However, he has to call exitAsDelegator
      await expectRevert(
        this.serviceProviderAliceContract.withdrawDelegatedStake({from: fred}),
        "SPHL"
      )

      await this.serviceProviderAliceContract.exitAsDelegator({from: fred})

      const balanceOfFredAfter = await this.token.balanceOf(fred)

      const balanceDelta = balanceOfFredAfter.sub(balanceOfFredBefore)
      balanceDelta.should.be.bignumber.equal(STAKE_VALUE)

      // Move past the unbonding period
      await this.stakingRewards.fixBlockNumber(new BN('62').add(new BN('6500').mul(new BN('22'))), {from: cudos})

      // Now Alice should be able to claim her stake
      const serviceProviderAliceCudoBalanceBeforeUnbonding = await this.token.balanceOf(serviceProviderAlice);

      await this.serviceProviderAliceContract.withdrawServiceProviderStake({from: serviceProviderAlice});

      const serviceProviderAliceCudoBalanceAfterUnbonding = await this.token.balanceOf(serviceProviderAlice);
      const expectedServiceProviderAliceDeltaAfterUnbonding = serviceProviderAliceCudoBalanceAfterUnbonding.sub(serviceProviderAliceCudoBalanceBeforeUnbonding);
      shouldBeNumberInEtherCloseTo(
        REQUIRED_SERVICE_PROVIDER_BOND,
        fromWei(expectedServiceProviderAliceDeltaAfterUnbonding)
      )
    });
  });

  describe('staking, request withdrawal, withdraw then claim rewards', async () => {
    beforeEach(async () => {
      // set up fred for delegated staking
      await this.token.transfer(fred, STAKE_VALUE.muln(2), {from: cudos});
      await this.token.approve(this.stakingRewards.address, STAKE_VALUE.muln(2), {from: fred});
    });

    it('reverts if trying to withdraw as non-whitelisted service provider', async () => {
      await expectRevert(
        this.stakingRewards.withdraw('0',fred, STAKE_VALUE, {from: fred}),
        'SPU1'
      );
    });

    it('reverts if min staking period has not yet passed', async () => {
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

      // fix block number to #1
      await this.stakingRewards.fixBlockNumber('1', {from: cudos});

      // Reward programme #1 will have a min staking period of 50 blocks
      await this.stakingRewards.addRewardsProgramme('100', '50', true, {from: cudos});

      await this.stakingRewards.whitelistServiceProvider(serviceProviderAlice, {from: cudos});
      this.serviceProviderAliceProxyAddress = await this.stakingRewards.serviceProviderToWhitelistedProxyContracts(
        serviceProviderAlice
      )
      this.serviceProviderAliceContract = await ServiceProvider.at(this.serviceProviderAliceProxyAddress);

      // enter programme #1
      await this.token.transfer(serviceProviderAlice, REQUIRED_SERVICE_PROVIDER_BOND, {from: cudos});
      await this.token.approve(this.stakingRewards.address, REQUIRED_SERVICE_PROVIDER_BOND, {from: serviceProviderAlice});
      await this.serviceProviderAliceContract.stakeServiceProviderBond(
        REWARDS_PROGRAMME_ONE_ID,
        SERVICE_PROVIDER_ALICE_SERVICE_FEE_PERCENTAGE,
        {from: serviceProviderAlice}
      );

      // stake as freddy
      await this.token.approve(this.stakingRewards.address, STAKE_VALUE.muln(2), {from: fred});
      await this.serviceProviderAliceContract.delegateStake(STAKE_VALUE, {from: fred});

      // move to block #10. Freddy can't withdraw until block 51 so should revert when withdrawing
      await this.stakingRewards.fixBlockNumber('10', {from: cudos});

      await expectRevert(
        this.serviceProviderAliceContract.requestDelegatedStakeWithdrawal(STAKE_VALUE, {from: fred}),
        "SPW5"
      );
    });

    it('reverts if min staking period has not yet passed after topping up stake', async () => {
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

      // fix block number to #1
      await this.stakingRewards.fixBlockNumber('1', {from: cudos});

      // Reward programme #1 will have a min staking period of 50 blocks
      await this.stakingRewards.addRewardsProgramme('100', '50', true, {from: cudos});

      await this.stakingRewards.whitelistServiceProvider(serviceProviderAlice, {from: cudos});
      this.serviceProviderAliceProxyAddress = await this.stakingRewards.serviceProviderToWhitelistedProxyContracts(
        serviceProviderAlice
      )
      this.serviceProviderAliceContract = await ServiceProvider.at(this.serviceProviderAliceProxyAddress);

      // enter programme #1
      await this.token.transfer(serviceProviderAlice, REQUIRED_SERVICE_PROVIDER_BOND, {from: cudos});
      await this.token.approve(this.stakingRewards.address, REQUIRED_SERVICE_PROVIDER_BOND, {from: serviceProviderAlice});
      await this.serviceProviderAliceContract.stakeServiceProviderBond(
        REWARDS_PROGRAMME_ONE_ID,
        SERVICE_PROVIDER_ALICE_SERVICE_FEE_PERCENTAGE,
        {from: serviceProviderAlice}
      );

      // stake as freddy
      await this.token.approve(this.stakingRewards.address, STAKE_VALUE.muln(2), {from: fred});
      await this.serviceProviderAliceContract.delegateStake(STAKE_VALUE, {from: fred});

      // move to block #10. Freddy can't withdraw until block 51 so should revert when withdrawing
      await this.stakingRewards.fixBlockNumber('10', {from: cudos});

      await expectRevert(
        this.serviceProviderAliceContract.requestDelegatedStakeWithdrawal(STAKE_VALUE, {from: fred}),
        "SPW5"
      );

      // however, freddy thinks instead of withdrawing, he will top up his stake
      await this.serviceProviderAliceContract.delegateStake(STAKE_VALUE, {from: fred});

      // try moving to block 55 - where freddy would have been able to withdraw before his 'top up'
      await this.stakingRewards.fixBlockNumber('55', {from: cudos});

      // his withdrawal should fail
      await expectRevert(
        this.serviceProviderAliceContract.requestDelegatedStakeWithdrawal(STAKE_VALUE, {from: fred}),
        "SPW5"
      );

      // move to block 62 where fred should be able to request withdrawal
      await this.stakingRewards.fixBlockNumber('62', {from: cudos});

      await this.serviceProviderAliceContract.requestDelegatedStakeWithdrawal(STAKE_VALUE.muln(2), {from: fred})

      // move past unbonding period
      await this.stakingRewards.fixBlockNumber(new BN('62').add(new BN('6500').mul(new BN('22'))), {from: cudos})

      await this.serviceProviderAliceContract.withdrawDelegatedStake({from: fred})
    });

    it('reverts if withdrawal amount is zero (exiting twice will do this)', async () => {
      await this.serviceProviderAliceContract.exitAsServiceProvider({from: serviceProviderAlice});
      await expectRevert(
        this.serviceProviderAliceContract.exitAsServiceProvider({from: serviceProviderAlice}),
        "SPC6"
      )
    });

    it('reverts if amount exceeds balance', async () => {
      await expectRevert(
        this.serviceProviderAliceContract.tryWithdrawLargeAmount({from: serviceProviderAlice}),
        "SRW1"
      );
    })

    it('can stake, withdraw and get rewards as a service provider', async () => {
      (await this.token.balanceOf(fred)).should.be.bignumber.equal(STAKE_VALUE.muln(2));

      await this.serviceProviderAliceContract.delegateStake(STAKE_VALUE, {from: fred});

      (await this.token.balanceOf(fred)).should.be.bignumber.equal(STAKE_VALUE);

      const totalDelegatedStake = STAKE_VALUE.add(REQUIRED_SERVICE_PROVIDER_BOND);
      (await this.stakingRewards.amountStakedByUserInRewardProgramme(
        REWARDS_PROGRAMME_ONE_ID,
        this.serviceProviderAliceProxyAddress
      )).should.be.bignumber.equal(
        totalDelegatedStake
      );

      (await this.stakingRewards.totalStakedAcrossAllRewardProgrammes()).should.be.bignumber.equal(
        totalDelegatedStake
      );

      (await this.stakingRewards.totalStakedInRewardProgramme(REWARDS_PROGRAMME_ONE_ID)).should.be.bignumber.equal(
        totalDelegatedStake
      );

      (await this.serviceProviderAliceContract.delegatedStake(fred)).should.be.bignumber.equal(STAKE_VALUE);
      (await this.serviceProviderAliceContract.rewardDebt(fred)).should.be.bignumber.equal(ZERO);
      (await this.serviceProviderAliceContract.totalDelegatedStake()).should.be.bignumber.equal(STAKE_VALUE.add(REQUIRED_SERVICE_PROVIDER_BOND));
      (await this.serviceProviderAliceContract.accTokensPerShare()).should.be.bignumber.equal(ZERO);
      (await this.serviceProviderAliceContract.pendingRewards(fred)).should.be.bignumber.equal(ZERO);

      // start block for rewards is block #5, so 2 blocks means 2 * 100 block rewards = 200 * 10 ^18
      await this.stakingRewards.fixBlockNumber('7', {from: cudos});
      const expectedRewardToServiceProviderAliceContract = rewardPerBlock.muln(2);

      shouldBeNumberInEtherCloseTo(
        await this.stakingRewards.pendingCudoRewards(
          REWARDS_PROGRAMME_ONE_ID,
          this.serviceProviderAliceContract.address
        ),
        fromWei(expectedRewardToServiceProviderAliceContract)
      );

      const serviceProviderAliceCudoBalanceBeforeRewardClaim = await this.token.balanceOf(serviceProviderAlice);

      await this.serviceProviderAliceContract.requestDelegatedStakeWithdrawal(STAKE_VALUE, {from: fred})

      const serviceProviderAliceCudoBalanceAfterRewardClaim = await this.token.balanceOf(serviceProviderAlice);

      (await this.stakingRewards.totalStakedAcrossAllRewardProgrammes()).should.be.bignumber.equal(
        REQUIRED_SERVICE_PROVIDER_BOND
      );

      (await this.stakingRewards.amountStakedByUserInRewardProgramme(
        REWARDS_PROGRAMME_ONE_ID,
        this.serviceProviderAliceProxyAddress
      )).should.be.bignumber.equal(
        REQUIRED_SERVICE_PROVIDER_BOND
      );

      (await this.serviceProviderAliceContract.delegatedStake(fred)).should.be.bignumber.equal(ZERO);
      (await this.serviceProviderAliceContract.totalDelegatedStake()).should.be.bignumber.equal(REQUIRED_SERVICE_PROVIDER_BOND);

      // Reward to the proxy is roughly 200 cudos - calcs lose dust!
      const stakeDelegatedToServiceProvider = STAKE_VALUE;
      const percentageOfStakeThatIsDelegatedToServiceProvider =
        stakeDelegatedToServiceProvider.mul(PERCENTAGE_MODULO).div(totalDelegatedStake);

      // Should be 500 or 5% but solidity has its own ideas about division...
      percentageOfStakeThatIsDelegatedToServiceProvider.should.be.bignumber.equal('476');

      const grossRewardsDueToFreddy = expectedRewardToServiceProviderAliceContract.mul(percentageOfStakeThatIsDelegatedToServiceProvider).div(PERCENTAGE_MODULO);
      const rewardsFee = grossRewardsDueToFreddy.mul(SERVICE_PROVIDER_ALICE_SERVICE_FEE_PERCENTAGE).div(PERCENTAGE_MODULO);

      const netRewardsDueToFreddy = grossRewardsDueToFreddy.sub(rewardsFee);

      const rewardDueToServiceProvider = expectedRewardToServiceProviderAliceContract.sub(netRewardsDueToFreddy);
      shouldBeNumberInEtherCloseTo(
        serviceProviderAliceCudoBalanceAfterRewardClaim.sub(serviceProviderAliceCudoBalanceBeforeRewardClaim),
        fromWei(rewardDueToServiceProvider)
      );

      // this is roughly the amount staked plus 5% of the rewards minus the service fee taken above and sent to alice
      shouldBeNumberInEtherCloseTo(await this.token.balanceOf(fred), fromWei(
        netRewardsDueToFreddy.add(STAKE_VALUE)
      ));

      // fred should not be able to withdraw before end of unbonding period
      await expectRevert(
        this.serviceProviderAliceContract.withdrawDelegatedStake({from: fred}),
        "SPW3"
      )

      // now make sure fred can get his stake back after moving past unbonding period
      await this.stakingRewards.fixBlockNumber(new BN('62').add(new BN('6500').mul(new BN('22'))), {from: cudos})

      const balanceOfFredBefore = await this.token.balanceOf(fred)

      await this.serviceProviderAliceContract.withdrawDelegatedStake({from: fred})

      const balanceOfFredAfter = await this.token.balanceOf(fred)

        const balanceDelta = balanceOfFredAfter.sub(balanceOfFredBefore)
      balanceDelta.should.be.bignumber.equal(STAKE_VALUE)
    });
  });

  describe('getReward()', () => {
    it('should do nothing if no stake', async () => {
      (await this.token.balanceOf(serviceProviderAlice)).should.be.bignumber.equal(ZERO);
      await this.stakingRewards.getReward('0',{from: serviceProviderAlice});
      (await this.token.balanceOf(serviceProviderAlice)).should.be.bignumber.equal(ZERO);
    });
  });

  describe('tokenRewardPerBlock()', () => {
    it('should return value of rewardPerBlock', async () => {
      (await this.stakingRewards.tokenRewardPerBlock()).should.be.bignumber.equal(rewardPerBlock);
    });

    it('allows admin to update tokenRewardPerBlock', async () => {
      const tokenRewardPerBlockBefore = await this.stakingRewards.tokenRewardPerBlock();
      await this.stakingRewards.updateTokenRewardPerBlock(rewardPerBlock.divn(2), {from: cudos});
      const tokenRewardPerBlockAfter = await this.stakingRewards.tokenRewardPerBlock();

      tokenRewardPerBlockAfter.should.be.bignumber.not.equal(tokenRewardPerBlockBefore);
      tokenRewardPerBlockAfter.should.be.bignumber.equal(rewardPerBlock.divn(2));
    });

    it('When reward changes for a reward programme, issued rewards and total pending updates correctly', async () => {
      // move to block #7 where Alice should be due 200 CUDO reward
      await this.stakingRewards.fixBlockNumber('7', {from: cudos});

      const pendingAlice = await this.stakingRewards.pendingCudoRewards(
        REWARDS_PROGRAMME_ONE_ID,
        this.serviceProviderAliceContract.address
      );

      shouldBeNumberInEtherCloseTo(pendingAlice, fromWei(rewardPerBlock.muln(2)));

      // halve the block reward
      await this.stakingRewards.updateTokenRewardPerBlock(rewardPerBlock.divn(2), {from: cudos});

      // check Alice's pending is still the same i.e. up to block 7's rewards are still acurate
      shouldBeNumberInEtherCloseTo(pendingAlice, fromWei(rewardPerBlock.muln(2)));

      // move to block #9 where Alice should be due an extra 100 CUDO reward - half of the previous reward
      await this.stakingRewards.fixBlockNumber('9', {from: cudos});

      // total due to alice should be 300 cudos minus what is lost to calcs
      const latestPendingAlice = await this.stakingRewards.pendingCudoRewards(
        REWARDS_PROGRAMME_ONE_ID,
        this.serviceProviderAliceContract.address
      );

      shouldBeNumberInEtherCloseTo(latestPendingAlice, fromWei(ether('300')));
    });
  });

  describe('updateAllocPointForRewardProgramme()', () => {
    it('Can update alloc point for reward programme as admin', async () => {
      (
        await this.stakingRewards.getRewardProgrammeInfo(REWARDS_PROGRAMME_ONE_ID)
      ).allocPoint.should.be.bignumber.equal(this.rewardProgramme1AllocPoint);

      const newAllocPoint = '200';
      await this.stakingRewards.updateAllocPointForRewardProgramme(
        REWARDS_PROGRAMME_ONE_ID,
        newAllocPoint,
        true,
        {from: cudos}
      );

      (
        await this.stakingRewards.getRewardProgrammeInfo(REWARDS_PROGRAMME_ONE_ID)
      ).allocPoint.should.be.bignumber.equal(newAllocPoint);
    });

    it('Reverts when sender is not admin', async () => {
      await expectRevert(
        this.stakingRewards.updateAllocPointForRewardProgramme(
          REWARDS_PROGRAMME_ONE_ID,
          '200',
          true,
          {from: serviceProviderAlice}
        ),
        "OA"
      );
    });
  });

  describe('whitelistServiceProvider()', () => {
    it('Reverts when not admin', async () => {
      await expectRevert(
        this.stakingRewards.whitelistServiceProvider(constants.ZERO_ADDRESS, {from: serviceProviderAlice}),
        "OA"
      );
    });

    it('Reverts when trying to whitelist a service provider twice', async () => {
      await expectRevert(
        this.stakingRewards.whitelistServiceProvider(serviceProviderAlice, {from: cudos}),
        "Already whitelisted service provider"
      );
    });
  });

  describe('whitelist actions', () => {
    it('Reverts when not whitelisted for updateMinRequiredStakingAmountForValidators', async () => {
      await expectRevert(
        this.stakingRewards.updateMinRequiredStakingAmountForServiceProviders('222', {from: serviceProviderAlice}),
        "OWL"
      );
    });

    it('Reverts when min greater than max', async () => {
      const max = await this.stakingRewards.maxStakingAmountForServiceProviders();
      await expectRevert(
        this.stakingRewards.updateMinRequiredStakingAmountForServiceProviders(max.add(REWARD_VALUE), {from: whitelisted}),
        "Min staking must be less than max staking amount"
      );
    });

    it('Able to update updateMinRequiredStakingAmountForValidators', async () => {
      const min = await this.stakingRewards.minRequiredStakingAmountForServiceProviders();
      await this.stakingRewards.updateMinRequiredStakingAmountForServiceProviders(min.sub(REWARD_VALUE), {from: whitelisted});
    });

    it('Reverts when not whitelisted for updateMaxStakingAmountForValidators', async () => {
      await expectRevert(
        this.stakingRewards.updateMaxStakingAmountForServiceProviders('222', {from: serviceProviderAlice}),
        "OWL"
      );
    });

    it('Reverts when max greater than min', async () => {
      const min = await this.stakingRewards.minRequiredStakingAmountForServiceProviders();
      await expectRevert(
        this.stakingRewards.updateMaxStakingAmountForServiceProviders(min.sub(REWARD_VALUE), {from: whitelisted}),
        "Max staking must be greater than min staking amount"
      );
    });

    it('Able to update updateMaxStakingAmountForValidators', async () => {
      const max = await this.stakingRewards.maxStakingAmountForServiceProviders();
      await this.stakingRewards.updateMaxStakingAmountForServiceProviders(max.add(REWARD_VALUE), {from: whitelisted});
    });

    it('Reverts when not whitelisted for updateMinServiceProviderFee', async () => {
      await expectRevert(
        this.stakingRewards.updateMinServiceProviderFee('300', {from: serviceProviderAlice}),
        "OWL"
      );
    });

    it('Able to update updateMinServiceProviderFee', async () => {
      // await this.stakingRewards.updateMinServiceProviderFee(serviceProviderAlice, {from: whitelisted}); // this fails now with the "fee \in (0,1)" condition
      await this.stakingRewards.updateMinServiceProviderFee('100', {from: whitelisted});
    });
  });

  describe('Recovery', () => {
    describe('ERC20', () => {
      beforeEach(async () => {
        this.mockToken = await MockERC20.new({from: fred});
      })

      it('Can recover an ERC20 as admin', async () => {
        this.mockToken = await MockERC20.new({from: fred});

        (await this.mockToken.balanceOf(this.stakingRewards.address)).should.be.bignumber.equal('0');

        let cudoMockBalance = await this.mockToken.balanceOf(cudos)
        cudoMockBalance.should.be.bignumber.equal('0')

        const xferAmount = new BN('5000')
        await this.mockToken.transfer(this.stakingRewards.address, xferAmount, { from: fred });

        (await this.mockToken.balanceOf(this.stakingRewards.address)).should.be.bignumber.equal(xferAmount)

        cudoMockBalance = await this.mockToken.balanceOf(cudos)
        cudoMockBalance.should.be.bignumber.equal('0')

        await this.stakingRewards.recoverERC20(this.mockToken.address, cudos, xferAmount, {from: cudos});

        (await this.mockToken.balanceOf(this.stakingRewards.address)).should.be.bignumber.equal('0')

        cudoMockBalance = await this.mockToken.balanceOf(cudos)
        cudoMockBalance.should.be.bignumber.equal(xferAmount)
      })

      it('Reverts if not admin', async () => {
        await expectRevert(
          this.stakingRewards.recoverERC20(this.mockToken.address, fred, new BN('1'), {from: fred}),
          "OA"
        )
      })
    })
  })
});
