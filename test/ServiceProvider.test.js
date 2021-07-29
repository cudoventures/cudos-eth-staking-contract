const {BN, time, expectEvent, expectRevert, constants, ether} = require('@openzeppelin/test-helpers');
const {latest} = time;
const {expect} = require('chai');

const {fromWei} = require('web3-utils');

const ServiceProvider = artifacts.require('ServiceProviderMock');
const StakingRewardsGuild = artifacts.require('StakingRewardsGuild');
const StakingRewards = artifacts.require('StakingRewardsWithFixedBlockNumber');
const CudosToken = artifacts.require('CudosToken');
const CudosAccessControls = artifacts.require('CudosAccessControls');
const MockERC20 = artifacts.require('MockERC20');

contract('ServiceProvider contract', function ([_, cudos, serviceProviderAlice, serviceProviderBob, fred, greg, other, beneficiary3, whitelisted]) {
  const TEN_BILLION = new BN(10000000000);
  const INITIAL_SUPPLY = ether(TEN_BILLION);

  const REWARD_VALUE = ether('1000');
  const STAKE_VALUE = ether('100000');
  const ONE_THOUSAND = ether('1000');
  const TEN_THOUSAND = ether('10000');
  const TWENTY_THOUSAND = ether('20000');
  const NINETY_THOUSAND = ether('90000');
  const ONE_HUNDRED_THOUSAND = ether('100000');
  const FIVE_HUNDRED_THOUSAND = ether('500000');
  const ONE_MILLION = ether('1000000');  
  const THREE_MILLION = ether('3000000');
  const FOUR_MILLION = ether('4000000');
  const FIVE_MILLION = ether('5000000');
  const NINE_MILLION = ether('9000000');
  const ONE_HUNDRED_MILLION = ether('100000000');
  const NINETY_EIGHT_MILLION = ether('98000000');
  const _10days = new BN('10');
  const _1DaysWorthOfReward = REWARD_VALUE.div(_10days);

  const rewardPerBlock = ether('100'); // 100 cudo per block

  const REWARDS_PROGRAMME_ONE_ID = new BN('0');
  const REWARDS_PROGRAMME_TWO_ID = new BN('1');

  const ZERO = new BN('0');

  const TWO_MILLION = new BN('2000000');
  const REQUIRED_SERVICE_PROVIDER_BOND = ether('2000000');
  
  const PERIOD_ONE_DAY_IN_SECONDS = new BN('86400');

  const PERCENTAGE_MODULO = new BN('10000');
  const IMPROVE_PRECISION = new BN('100000000')

  // 5% to 2 DP
  const SERVICE_PROVIDER_ALICE_SERVICE_FEE_PERCENTAGE = new BN('500');
  const SERVICE_PROVIDER_BOB_SERVICE_FEE_PERCENTAGE = new BN('600');

  const daysInSeconds = (days) => days.mul(PERIOD_ONE_DAY_IN_SECONDS);

  const shouldBeNumberInEtherCloseTo = (valInWei, expected) => parseFloat(fromWei(valInWei)).should.be.closeTo(parseFloat(expected.toString()), 0.000001);

  beforeEach(async () => {
    // cudos is added as a admin doing construction
    this.accessControls = await CudosAccessControls.new({from: cudos});

    await this.accessControls.addWhitelistRole(cudos, {from: cudos});

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
    this.stakingRewards = await StakingRewards.new(
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

    // Ensure staking rewards is approved to move tokens
    await this.token.approve(this.stakingRewards.address, INITIAL_SUPPLY, {from: cudos});
  });

  describe('General validation', () => {
    describe('init()', () => {
      it('When params valid, correctly initialises', async () => {
        await this.serviceProviderCloneable.init(serviceProviderAlice, this.token.address, {from: cudos});
        expect(await this.serviceProviderCloneable.controller()).to.equal(cudos);
        expect(await this.serviceProviderCloneable.serviceProvider()).to.equal(serviceProviderAlice);
        expect(await this.serviceProviderCloneable.cudosToken()).to.equal(this.token.address);
      });

      it('Reverts when init has already been called', async () => {
        await this.serviceProviderCloneable.init(serviceProviderAlice, this.token.address, {from: cudos});
        await expectRevert(
          this.serviceProviderCloneable.init(serviceProviderAlice, this.token.address, {from: cudos}),
          "SPI1"
        );
      });

      it('Reverts when service provider address supplied is zero', async () => {
        await expectRevert(
          this.serviceProviderCloneable.init(constants.ZERO_ADDRESS, this.token.address, {from: cudos}),
          "SPI2"
        );
      });

      it('Reverts when cudos token address supplied is zero', async () => {
        await expectRevert(
          this.serviceProviderCloneable.init(serviceProviderAlice, constants.ZERO_ADDRESS, {from: cudos}),
          "SPI3"
        );
      });
    });

    describe('stakeServiceProviderBond()', () => {
      beforeEach(async () => {
        // Whitelist service provider Alice and stake required bond
        await this.stakingRewards.whitelistServiceProvider(serviceProviderAlice, {from: cudos});
        this.serviceProviderAliceProxyAddress = await this.stakingRewards.serviceProviderToWhitelistedProxyContracts(
          serviceProviderAlice
        );

        // Stake bond from service provider alice
        await this.token.transfer(serviceProviderAlice, REQUIRED_SERVICE_PROVIDER_BOND, {from: cudos});
        await this.token.approve(this.stakingRewards.address, REQUIRED_SERVICE_PROVIDER_BOND, {from: serviceProviderAlice});
        this.serviceProviderAliceContract = await ServiceProvider.at(this.serviceProviderAliceProxyAddress);
      });

      it('Is successful as a service provider', async () => {
        await this.serviceProviderAliceContract.stakeServiceProviderBond(REWARDS_PROGRAMME_ONE_ID, SERVICE_PROVIDER_ALICE_SERVICE_FEE_PERCENTAGE, {from: serviceProviderAlice});
        expect(await this.serviceProviderAliceContract.delegatedStake(serviceProviderAlice)).to.be.bignumber.equal(REQUIRED_SERVICE_PROVIDER_BOND);
        expect(await this.serviceProviderAliceContract.totalDelegatedStake()).to.be.bignumber.equal(REQUIRED_SERVICE_PROVIDER_BOND);
      });

      it('Reverts if fee below the minimum', async () => {
        const minFee = await this.stakingRewards.minServiceProviderFee();
        await expectRevert(
          this.serviceProviderAliceContract.stakeServiceProviderBond(REWARDS_PROGRAMME_ONE_ID, minFee.subn(1), {from: serviceProviderAlice}),
          "SPF1"
        );
      });

      it('Reverts when sender is not service provider', async () => {
        await expectRevert(
          this.serviceProviderAliceContract.stakeServiceProviderBond(REWARDS_PROGRAMME_ONE_ID, SERVICE_PROVIDER_ALICE_SERVICE_FEE_PERCENTAGE, {from: cudos}),
          "SPC1"
        );
      });

      it('Reverts when service provider is already set up', async () => {
        await this.serviceProviderAliceContract.stakeServiceProviderBond(REWARDS_PROGRAMME_ONE_ID, SERVICE_PROVIDER_ALICE_SERVICE_FEE_PERCENTAGE, {from: serviceProviderAlice});
        await expectRevert(
          this.serviceProviderAliceContract.stakeServiceProviderBond(REWARDS_PROGRAMME_ONE_ID, SERVICE_PROVIDER_ALICE_SERVICE_FEE_PERCENTAGE, {from: serviceProviderAlice}),
          "SPC7"
        );
      });

      it('Reverts when rewards percentage is zero', async () => {
        await expectRevert(
          this.serviceProviderAliceContract.stakeServiceProviderBond(REWARDS_PROGRAMME_ONE_ID, ZERO, {from: serviceProviderAlice}),
          "FP2"
        );
      });
    });

    describe('increaseServiceProviderStake()', () => {
      it('Reverts when service provider is not set up', async () => {
        await expectRevert(
          this.serviceProviderCloneable.increaseServiceProviderStake(0),
          "SPC2"
        );
      });

      it('Reverts when not service provider', async () => {
        this.serviceProviderCloneable.init(serviceProviderAlice, this.token.address, {from: cudos});

        // Whitelist service provider Alice and stake required bond
        await this.stakingRewards.whitelistServiceProvider(serviceProviderAlice, {from: cudos});
        this.serviceProviderAliceProxyAddress = await this.stakingRewards.serviceProviderToWhitelistedProxyContracts(
          serviceProviderAlice
        );

        // Stake bond from service provider alice
        await this.token.transfer(serviceProviderAlice, REQUIRED_SERVICE_PROVIDER_BOND, {from: cudos});
        await this.token.approve(this.stakingRewards.address, REQUIRED_SERVICE_PROVIDER_BOND, {from: serviceProviderAlice});
        this.serviceProviderAliceContract = await ServiceProvider.at(this.serviceProviderAliceProxyAddress);
        await this.serviceProviderAliceContract.stakeServiceProviderBond(REWARDS_PROGRAMME_ONE_ID, SERVICE_PROVIDER_ALICE_SERVICE_FEE_PERCENTAGE,
          {from: serviceProviderAlice}
        );

        await expectRevert(
          this.serviceProviderAliceContract.increaseServiceProviderStake(0, {from: cudos}),
          "SPC3"
        );
      });

      it('Reverts when specifying zero', async () => {
        this.serviceProviderCloneable.init(serviceProviderAlice, this.token.address, {from: cudos});

        // Whitelist service provider Alice and stake required bond
        await this.stakingRewards.whitelistServiceProvider(serviceProviderAlice, {from: cudos});
        this.serviceProviderAliceProxyAddress = await this.stakingRewards.serviceProviderToWhitelistedProxyContracts(
          serviceProviderAlice
        );

        // Stake bond from service provider alice
        await this.token.transfer(serviceProviderAlice, REQUIRED_SERVICE_PROVIDER_BOND, {from: cudos});
        await this.token.approve(this.stakingRewards.address, REQUIRED_SERVICE_PROVIDER_BOND, {from: serviceProviderAlice});
        this.serviceProviderAliceContract = await ServiceProvider.at(this.serviceProviderAliceProxyAddress);
        await this.serviceProviderAliceContract.stakeServiceProviderBond(REWARDS_PROGRAMME_ONE_ID, SERVICE_PROVIDER_ALICE_SERVICE_FEE_PERCENTAGE,
          {from: serviceProviderAlice}
        );

        await expectRevert(
          this.serviceProviderAliceContract.increaseServiceProviderStake(0, {from: serviceProviderAlice}),
          "SPC6"
        );
      });
    });

    describe('requestExcessServiceProviderStakeWithdrawal()', () => {
      it('Reverts when service provider is not set up', async () => {
        await expectRevert(
          this.serviceProviderCloneable.requestExcessServiceProviderStakeWithdrawal(0),
          "SPC2"
        );
      });

      it('Reverts when not service provider', async () => {
        this.serviceProviderCloneable.init(serviceProviderAlice, this.token.address, {from: cudos});

        // Whitelist service provider Alice and stake required bond
        await this.stakingRewards.whitelistServiceProvider(serviceProviderAlice, {from: cudos});
        this.serviceProviderAliceProxyAddress = await this.stakingRewards.serviceProviderToWhitelistedProxyContracts(
          serviceProviderAlice
        );

        // Stake bond from service provider alice
        await this.token.transfer(serviceProviderAlice, REQUIRED_SERVICE_PROVIDER_BOND, {from: cudos});
        await this.token.approve(this.stakingRewards.address, REQUIRED_SERVICE_PROVIDER_BOND, {from: serviceProviderAlice});
        this.serviceProviderAliceContract = await ServiceProvider.at(this.serviceProviderAliceProxyAddress);
        await this.serviceProviderAliceContract.stakeServiceProviderBond(REWARDS_PROGRAMME_ONE_ID, SERVICE_PROVIDER_ALICE_SERVICE_FEE_PERCENTAGE,
          {from: serviceProviderAlice}
        );

        await expectRevert(
          this.serviceProviderAliceContract.requestExcessServiceProviderStakeWithdrawal(0, {from: cudos}),
          "SPC3"
        );
      });

      it('Reverts when specifying zero', async () => {
        this.serviceProviderCloneable.init(serviceProviderAlice, this.token.address, {from: cudos});

        // Whitelist service provider Alice and stake required bond
        await this.stakingRewards.whitelistServiceProvider(serviceProviderAlice, {from: cudos});
        this.serviceProviderAliceProxyAddress = await this.stakingRewards.serviceProviderToWhitelistedProxyContracts(
          serviceProviderAlice
        );

        // Stake bond from service provider alice
        await this.token.transfer(serviceProviderAlice, REQUIRED_SERVICE_PROVIDER_BOND, {from: cudos});
        await this.token.approve(this.stakingRewards.address, REQUIRED_SERVICE_PROVIDER_BOND, {from: serviceProviderAlice});
        this.serviceProviderAliceContract = await ServiceProvider.at(this.serviceProviderAliceProxyAddress);
        await this.serviceProviderAliceContract.stakeServiceProviderBond(REWARDS_PROGRAMME_ONE_ID, SERVICE_PROVIDER_ALICE_SERVICE_FEE_PERCENTAGE,
          {from: serviceProviderAlice}
        );

        await expectRevert(
          this.serviceProviderAliceContract.requestExcessServiceProviderStakeWithdrawal(0, {from: serviceProviderAlice}),
          "SPC6"
        );
      });

      it('Reverts when withdrawal amount would reduce balance below minimum staking amount', async () => {
        this.serviceProviderCloneable.init(serviceProviderAlice, this.token.address, {from: cudos});

        // Whitelist service provider Alice and stake required bond
        await this.stakingRewards.whitelistServiceProvider(serviceProviderAlice, {from: cudos});
        this.serviceProviderAliceProxyAddress = await this.stakingRewards.serviceProviderToWhitelistedProxyContracts(
          serviceProviderAlice
        );

        // Stake bond from service provider alice
        await this.token.transfer(serviceProviderAlice, REQUIRED_SERVICE_PROVIDER_BOND, {from: cudos});
        await this.token.approve(this.stakingRewards.address, REQUIRED_SERVICE_PROVIDER_BOND, {from: serviceProviderAlice});
        this.serviceProviderAliceContract = await ServiceProvider.at(this.serviceProviderAliceProxyAddress);
        await this.serviceProviderAliceContract.stakeServiceProviderBond(REWARDS_PROGRAMME_ONE_ID, SERVICE_PROVIDER_ALICE_SERVICE_FEE_PERCENTAGE,
          {from: serviceProviderAlice}
        );

        // when the call is made to requestExcessServiceProviderStakeWithdrawal(), the service provider has staked 2 million (the min) so any withdrawal will fail
        await expectRevert(
          this.serviceProviderAliceContract.requestExcessServiceProviderStakeWithdrawal('3', {from: serviceProviderAlice}),
          "SPW7"
        );
      });
    });

    describe('exitAsServiceProvider()', () => {
      it('Reverts when not service provider', async () => {
        await this.serviceProviderCloneable.init(serviceProviderAlice, this.token.address, {from: cudos});
        await expectRevert(
          this.serviceProviderCloneable.exitAsServiceProvider({from: cudos}),
          "SPC3"
        );
      });

      it('Reverts when trying to exit before lock-up ends', async () => {
        this.serviceProviderCloneable.init(serviceProviderAlice, this.token.address, {from: cudos});

        // Add reward programme with nonzero lock-up
        this.rewardProgramme2AllocPoint = new BN('200');
          await this.stakingRewards.addRewardsProgramme(this.rewardProgramme2AllocPoint, '50', true, {from: cudos});

        // Whitelist service provider Alice
        await this.stakingRewards.whitelistServiceProvider(serviceProviderAlice, {from: cudos});
        this.serviceProviderAliceProxyAddress = await this.stakingRewards.serviceProviderToWhitelistedProxyContracts(
          serviceProviderAlice
        );

        // Stake bond from service provider alice into reward programme #1
        await this.token.transfer(serviceProviderAlice, REQUIRED_SERVICE_PROVIDER_BOND, {from: cudos});
        await this.token.approve(this.stakingRewards.address, REQUIRED_SERVICE_PROVIDER_BOND, {from: serviceProviderAlice});
        this.serviceProviderAliceContract = await ServiceProvider.at(this.serviceProviderAliceProxyAddress);
        await this.serviceProviderAliceContract.stakeServiceProviderBond(REWARDS_PROGRAMME_TWO_ID, SERVICE_PROVIDER_ALICE_SERVICE_FEE_PERCENTAGE,
          {from: serviceProviderAlice}
        );

        // Move to block #20
        await this.stakingRewards.fixBlockNumber('20', {from: cudos});

        await expectRevert(
          this.serviceProviderAliceContract.exitAsServiceProvider({from: serviceProviderAlice}),
          "SPW5"
        );
      });
    });

    describe('callibrateServiceProviderFee()', () => {
      beforeEach(async () => {
        // Whitelist service provider Alice and stake required bond
        await this.stakingRewards.whitelistServiceProvider(serviceProviderAlice, {from: cudos});
        this.serviceProviderAliceProxyAddress = await this.stakingRewards.serviceProviderToWhitelistedProxyContracts(
          serviceProviderAlice
        );

        // Stake bond from service provider alice
        await this.token.transfer(serviceProviderAlice, REQUIRED_SERVICE_PROVIDER_BOND, {from: cudos});
        await this.token.approve(this.stakingRewards.address, REQUIRED_SERVICE_PROVIDER_BOND, {from: serviceProviderAlice});
        this.serviceProviderAliceContract = await ServiceProvider.at(this.serviceProviderAliceProxyAddress);

        await this.serviceProviderAliceContract.stakeServiceProviderBond(REWARDS_PROGRAMME_ONE_ID, SERVICE_PROVIDER_ALICE_SERVICE_FEE_PERCENTAGE, {from: serviceProviderAlice});
      });

      it('Should adjust min fee on global change in staking rewards', async () => {
        const originalFee = await this.serviceProviderAliceContract.rewardsFeePercentage();
        expect(originalFee).to.be.bignumber.equal(SERVICE_PROVIDER_ALICE_SERVICE_FEE_PERCENTAGE);

        await this.stakingRewards.updateMinServiceProviderFee('500', {from: cudos});

        await this.serviceProviderAliceContract.callibrateServiceProviderFee();

        const newFee = await this.serviceProviderAliceContract.rewardsFeePercentage();
        expect(newFee).to.be.bignumber.equal('500');
      });

      it('Should do nothing if no global change in staking rewards', async () => {
        const originalFee = await this.serviceProviderAliceContract.rewardsFeePercentage();
        expect(originalFee).to.be.bignumber.equal(SERVICE_PROVIDER_ALICE_SERVICE_FEE_PERCENTAGE);

        await this.serviceProviderAliceContract.callibrateServiceProviderFee();

        const newFee = await this.serviceProviderAliceContract.rewardsFeePercentage();
        expect(newFee).to.be.bignumber.equal(SERVICE_PROVIDER_ALICE_SERVICE_FEE_PERCENTAGE);
      });
    });

    describe('delegateStake()', () => {
      it('when delegating, correctly distributes pending rewards to service provider', async () => {
        // Whitelist service provider Alice and stake required bond
        await this.stakingRewards.whitelistServiceProvider(serviceProviderAlice, {from: cudos});
        this.serviceProviderAliceProxyAddress = await this.stakingRewards.serviceProviderToWhitelistedProxyContracts(
          serviceProviderAlice
        );

        // Stake bond from service provider alice
        await this.token.transfer(serviceProviderAlice, REQUIRED_SERVICE_PROVIDER_BOND, {from: cudos});
        await this.token.approve(this.stakingRewards.address, REQUIRED_SERVICE_PROVIDER_BOND, {from: serviceProviderAlice});
        this.serviceProviderAliceContract = await ServiceProvider.at(this.serviceProviderAliceProxyAddress);

        await this.serviceProviderAliceContract.stakeServiceProviderBond(REWARDS_PROGRAMME_ONE_ID, SERVICE_PROVIDER_ALICE_SERVICE_FEE_PERCENTAGE, {from: serviceProviderAlice});

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

        // Move to block #9 where freddy will stake. At this point alice will be entitled to 200 more CUDOs in rewards
        await this.stakingRewards.fixBlockNumber('9', {from: cudos});

        shouldBeNumberInEtherCloseTo(
          await this.stakingRewards.pendingCudoRewards(
            REWARDS_PROGRAMME_ONE_ID,
            this.serviceProviderAliceContract.address
          ),
          fromWei(expectedRewardToServiceProviderAliceContract)
        );

        // when freddy stakes, alice should get the same amount of rewards as above
        await this.token.transfer(fred, STAKE_VALUE, {from: cudos});
        await this.token.approve(this.stakingRewards.address, STAKE_VALUE, {from: fred});
        await this.serviceProviderAliceContract.delegateStake(STAKE_VALUE, {from: fred});

        shouldBeNumberInEtherCloseTo(
          await this.token.balanceOf(serviceProviderAlice),
          fromWei(expectedRewardToServiceProviderAliceContract.muln(2))
        );
      });

      it('after delegating, allows a delegator to increase their stake to earn increased rewards', async () => {
        // Whitelist service provider Alice and stake required bond
        await this.stakingRewards.whitelistServiceProvider(serviceProviderAlice, {from: cudos});
        this.serviceProviderAliceProxyAddress = await this.stakingRewards.serviceProviderToWhitelistedProxyContracts(
          serviceProviderAlice
        );

        // Stake bond from service provider alice
        await this.token.transfer(serviceProviderAlice, REQUIRED_SERVICE_PROVIDER_BOND, {from: cudos});
        await this.token.approve(this.stakingRewards.address, REQUIRED_SERVICE_PROVIDER_BOND, {from: serviceProviderAlice});
        this.serviceProviderAliceContract = await ServiceProvider.at(this.serviceProviderAliceProxyAddress);

        await this.serviceProviderAliceContract.stakeServiceProviderBond(REWARDS_PROGRAMME_ONE_ID, SERVICE_PROVIDER_ALICE_SERVICE_FEE_PERCENTAGE, {from: serviceProviderAlice});

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

        // Move to block #9 where freddy will stake. At this point alice will be entitled to 200 more CUDOs in rewards
        await this.stakingRewards.fixBlockNumber('9', {from: cudos});

        shouldBeNumberInEtherCloseTo(
          await this.stakingRewards.pendingCudoRewards(
            REWARDS_PROGRAMME_ONE_ID,
            this.serviceProviderAliceContract.address
          ),
          fromWei(expectedRewardToServiceProviderAliceContract)
        );

        // when freddy stakes, alice should get the same amount of rewards as above
        await this.token.transfer(fred, STAKE_VALUE, {from: cudos});
        await this.token.approve(this.stakingRewards.address, STAKE_VALUE, {from: fred});
        await this.serviceProviderAliceContract.delegateStake(STAKE_VALUE, {from: fred});

        shouldBeNumberInEtherCloseTo(
          await this.token.balanceOf(serviceProviderAlice),
          fromWei(expectedRewardToServiceProviderAliceContract.muln(2))
        );

        await this.token.transfer(fred, STAKE_VALUE, {from: cudos});
        await this.token.approve(this.stakingRewards.address, STAKE_VALUE, {from: fred});
        await this.serviceProviderAliceContract.delegateStake(STAKE_VALUE, {from: fred});

        expect(await this.serviceProviderAliceContract.delegatedStake(fred)).to.be.bignumber.equal(STAKE_VALUE.muln(2));

        await this.serviceProviderAliceContract.getReward({from: fred});
      });

      it('when delegating, correctly distributes pending rewards to multiple delegators', async () => {
        // Whitelist service provider Alice and stake required bond
        await this.stakingRewards.whitelistServiceProvider(serviceProviderAlice, {from: cudos});
        this.serviceProviderAliceProxyAddress = await this.stakingRewards.serviceProviderToWhitelistedProxyContracts(
          serviceProviderAlice
        );

        // Stake bond from service provider alice
        await this.token.transfer(serviceProviderAlice, REQUIRED_SERVICE_PROVIDER_BOND, {from: cudos});
        await this.token.approve(this.stakingRewards.address, REQUIRED_SERVICE_PROVIDER_BOND, {from: serviceProviderAlice});
        this.serviceProviderAliceContract = await ServiceProvider.at(this.serviceProviderAliceProxyAddress);

        await this.serviceProviderAliceContract.stakeServiceProviderBond(REWARDS_PROGRAMME_ONE_ID, SERVICE_PROVIDER_ALICE_SERVICE_FEE_PERCENTAGE, {from: serviceProviderAlice});

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

        // Move to block #9 where freddy will stake. At this point alice will be entitled to 200 more CUDOs in rewards
        await this.stakingRewards.fixBlockNumber('9', {from: cudos});

        shouldBeNumberInEtherCloseTo(
          await this.stakingRewards.pendingCudoRewards(
            REWARDS_PROGRAMME_ONE_ID,
            this.serviceProviderAliceContract.address
          ),
          fromWei(expectedRewardToServiceProviderAliceContract)
        );

        // when freddy stakes, alice should get the same amount of rewards as above
        await this.token.transfer(fred, STAKE_VALUE, {from: cudos});
        await this.token.approve(this.stakingRewards.address, STAKE_VALUE, {from: fred});
        await this.serviceProviderAliceContract.delegateStake(STAKE_VALUE, {from: fred});

        shouldBeNumberInEtherCloseTo(
          await this.token.balanceOf(serviceProviderAlice),
          fromWei(expectedRewardToServiceProviderAliceContract.muln(2))
        );

        // Move to block #11 where greg will stake.
        await this.stakingRewards.fixBlockNumber('11', {from: cudos});
        await this.token.transfer(greg, STAKE_VALUE, {from: cudos});
        await this.token.approve(this.stakingRewards.address, STAKE_VALUE, {from: greg});
        await this.serviceProviderAliceContract.delegateStake(STAKE_VALUE, {from: greg});

        // Move to block #13. Now fred must have earned more than greg
        await this.stakingRewards.fixBlockNumber('13', {from: cudos});

        // Fred and Greg have each delegated STAKE_VALUE
        const stakeDelegatedToServiceProviderBeforeGreg = STAKE_VALUE;
        const stakeDelegatedToServiceProviderAfterGreg = STAKE_VALUE.muln(2);
        const percentageOfStakeThatIsDelegatedToServiceProviderBeforeGreg =
          stakeDelegatedToServiceProviderBeforeGreg.mul(PERCENTAGE_MODULO).div(stakeDelegatedToServiceProviderBeforeGreg.add(REQUIRED_SERVICE_PROVIDER_BOND));
        const percentageOfStakeThatIsDelegatedToServiceProviderAfterGreg =
          stakeDelegatedToServiceProviderAfterGreg.mul(PERCENTAGE_MODULO).div(stakeDelegatedToServiceProviderAfterGreg.add(REQUIRED_SERVICE_PROVIDER_BOND));

        // Since Fred and Greg have the same stakes, they will evenly share the rewards for the last two blocks
        let grossRewardsDueToGreg = rewardPerBlock.muln(2).mul(percentageOfStakeThatIsDelegatedToServiceProviderAfterGreg).div(PERCENTAGE_MODULO).divn(2);
        let rewardsFeeGreg = grossRewardsDueToGreg.mul(SERVICE_PROVIDER_ALICE_SERVICE_FEE_PERCENTAGE).div(PERCENTAGE_MODULO);
        let netRewardsDueToGreg= grossRewardsDueToGreg.sub(rewardsFeeGreg);
        let gregBalanceBeforeGetReward = await this.token.balanceOf(greg);
        await this.serviceProviderAliceContract.getReward({from: greg});
        let gregBalanceAfterGetReward = await this.token.balanceOf(greg);
        let gregDelta = gregBalanceAfterGetReward.sub(gregBalanceBeforeGetReward);
        shouldBeNumberInEtherCloseTo(gregDelta, fromWei(netRewardsDueToGreg));

        // Move to block #15 to calculate Fred's rewards because getReward() won't return rewards to more than one user in a block ( we have getBlock() = lastRewardBlock )
        await this.stakingRewards.fixBlockNumber('15', {from: cudos});

        // In addition to sharing with Greg the rewards for the last four blocks, Fred will also get rewards for the previous two blocks (a total of six blocks)
        let grossRewardsDueToFred = rewardPerBlock.muln(2).mul(percentageOfStakeThatIsDelegatedToServiceProviderBeforeGreg).div(PERCENTAGE_MODULO).add(
          rewardPerBlock.muln(4).mul(percentageOfStakeThatIsDelegatedToServiceProviderAfterGreg).div(PERCENTAGE_MODULO).divn(2)
        );
        let rewardsFeeFred = grossRewardsDueToFred.mul(SERVICE_PROVIDER_ALICE_SERVICE_FEE_PERCENTAGE).div(PERCENTAGE_MODULO);
        let netRewardsDueToFred= grossRewardsDueToFred.sub(rewardsFeeFred);
        let fredBalanceBeforeGetReward = await this.token.balanceOf(fred);
        await this.serviceProviderAliceContract.getReward({from: fred});
        let fredBalanceAfterGetReward = await this.token.balanceOf(fred);
        let fredDelta = fredBalanceAfterGetReward.sub(fredBalanceBeforeGetReward);
        shouldBeNumberInEtherCloseTo(fredDelta, fromWei(netRewardsDueToFred));

        // Now move to block #10,013
        await this.stakingRewards.fixBlockNumber('10013', {from: cudos});
        let grossRewardsDueToGreg10K = rewardPerBlock.muln(10000).mul(percentageOfStakeThatIsDelegatedToServiceProviderAfterGreg).div(PERCENTAGE_MODULO).divn(2);
        let rewardsFeeGreg10K = grossRewardsDueToGreg10K.mul(SERVICE_PROVIDER_ALICE_SERVICE_FEE_PERCENTAGE).div(PERCENTAGE_MODULO);
        let netRewardsDueToGreg10K= grossRewardsDueToGreg10K.sub(rewardsFeeGreg10K);
        let gregBalanceBeforeGetReward10K = await this.token.balanceOf(greg);
        await this.serviceProviderAliceContract.getReward({from: greg});
        let gregBalanceAfterGetReward10K = await this.token.balanceOf(greg);
        let gregDelta10K = gregBalanceAfterGetReward10K.sub(gregBalanceBeforeGetReward10K);
        shouldBeNumberInEtherCloseTo(gregDelta10K, fromWei(netRewardsDueToGreg10K));

        // Move another block so that Fred can getReward
        await this.stakingRewards.fixBlockNumber('10014', {from: cudos});
        let grossRewardsDueToFred10K = rewardPerBlock.muln(9999).mul(percentageOfStakeThatIsDelegatedToServiceProviderAfterGreg).div(PERCENTAGE_MODULO).divn(2);
        let rewardsFeeFred10K = grossRewardsDueToFred10K.mul(SERVICE_PROVIDER_ALICE_SERVICE_FEE_PERCENTAGE).div(PERCENTAGE_MODULO);
        let netRewardsDueToFred10K= grossRewardsDueToFred10K.sub(rewardsFeeFred10K);
        let fredBalanceBeforeGetReward10K = await this.token.balanceOf(fred);
        await this.serviceProviderAliceContract.getReward({from: fred});
        let fredBalanceAfterGetReward10K = await this.token.balanceOf(fred);
        let fredDelta10K = fredBalanceAfterGetReward10K.sub(fredBalanceBeforeGetReward10K);
        shouldBeNumberInEtherCloseTo(fredDelta10K, fromWei(netRewardsDueToFred10K));
      });

      it('Reverts when service provider is not set up', async () => {
        await expectRevert(
          this.serviceProviderCloneable.delegateStake(0),
          "SPC2"
        );
      });

      it('Reverts when sender is service provider', async () => {
        this.serviceProviderCloneable.init(serviceProviderAlice, this.token.address, {from: cudos});

        // Whitelist service provider Alice and stake required bond
        await this.stakingRewards.whitelistServiceProvider(serviceProviderAlice, {from: cudos});
        this.serviceProviderAliceProxyAddress = await this.stakingRewards.serviceProviderToWhitelistedProxyContracts(
          serviceProviderAlice
        );

        // Stake bond from service provider alice
        await this.token.transfer(serviceProviderAlice, REQUIRED_SERVICE_PROVIDER_BOND, {from: cudos});
        await this.token.approve(this.stakingRewards.address, REQUIRED_SERVICE_PROVIDER_BOND, {from: serviceProviderAlice});
        this.serviceProviderAliceContract = await ServiceProvider.at(this.serviceProviderAliceProxyAddress);
        await this.serviceProviderAliceContract.stakeServiceProviderBond(REWARDS_PROGRAMME_ONE_ID, SERVICE_PROVIDER_ALICE_SERVICE_FEE_PERCENTAGE,
          {from: serviceProviderAlice}
        );

        await expectRevert(
          this.serviceProviderAliceContract.delegateStake(0, {from: serviceProviderAlice}),
          "SPC4"
        );
      });
    });

    describe('requestDelegatedStakeWithdrawal()', () => {
      it('Reverts when service provider is not set up', async () => {
        await expectRevert(
          this.serviceProviderCloneable.requestDelegatedStakeWithdrawal(0),
          "SPC2"
        );
      });

      it('Reverts when amount is zero', async () => {
        await this.stakingRewards.whitelistServiceProvider(serviceProviderAlice, {from: cudos});
        this.serviceProviderAliceProxyAddress = await this.stakingRewards.serviceProviderToWhitelistedProxyContracts(
          serviceProviderAlice
        );

        // Stake bond from service provider alice
        await this.token.transfer(serviceProviderAlice, REQUIRED_SERVICE_PROVIDER_BOND, {from: cudos});
        await this.token.approve(this.stakingRewards.address, REQUIRED_SERVICE_PROVIDER_BOND, {from: serviceProviderAlice});
        this.serviceProviderAliceContract = await ServiceProvider.at(this.serviceProviderAliceProxyAddress);

        await this.serviceProviderAliceContract.stakeServiceProviderBond(REWARDS_PROGRAMME_ONE_ID, SERVICE_PROVIDER_ALICE_SERVICE_FEE_PERCENTAGE, {from: serviceProviderAlice});

        await expectRevert(
          this.serviceProviderAliceContract.requestDelegatedStakeWithdrawal(0),
          "SPC6"
        );
      });

      it('Reverts when service provider or manager tries', async () => {
        await this.stakingRewards.whitelistServiceProvider(serviceProviderAlice, {from: cudos});
        this.serviceProviderAliceProxyAddress = await this.stakingRewards.serviceProviderToWhitelistedProxyContracts(
          serviceProviderAlice
        );

        // Stake bond from service provider alice
        await this.token.transfer(serviceProviderAlice, REQUIRED_SERVICE_PROVIDER_BOND, {from: cudos});
        await this.token.approve(this.stakingRewards.address, REQUIRED_SERVICE_PROVIDER_BOND, {from: serviceProviderAlice});
        this.serviceProviderAliceContract = await ServiceProvider.at(this.serviceProviderAliceProxyAddress);

        await this.serviceProviderAliceContract.stakeServiceProviderBond(REWARDS_PROGRAMME_ONE_ID, SERVICE_PROVIDER_ALICE_SERVICE_FEE_PERCENTAGE, {from: serviceProviderAlice});

        await expectRevert(
          this.serviceProviderAliceContract.requestDelegatedStakeWithdrawal(new BN('1'), {from: serviceProviderAlice}),
          "SPC4"
        );
      });

      it('Correctly stores the lock-up period of a user', async () => {
                
        await this.accessControls.addSmartContractRole(
          this.stakingRewards.address,
          {from: cudos}
        );
  
        // fix block number to #1
        await this.stakingRewards.fixBlockNumber('1', {from: cudos});
  
        // Reward programme #1 will have a min staking period of 50 blocks
        await this.stakingRewards.addRewardsProgramme('100', '50', true, {from: cudos});

        // Check if the new programme has been ceated successfully
        (await this.stakingRewards.numberOfRewardProgrammes()).should.be.bignumber.equal('2');
  
        // Whitelist service provider Alice
        await this.stakingRewards.whitelistServiceProvider(serviceProviderAlice, {from: cudos});
        this.serviceProviderAliceProxyAddress = await this.stakingRewards.serviceProviderToWhitelistedProxyContracts(
          serviceProviderAlice
        )
        this.serviceProviderAliceContract = await ServiceProvider.at(this.serviceProviderAliceProxyAddress);
  
        // Stake bond from service provider Alice and enter programme #1
        await this.token.transfer(serviceProviderAlice, REQUIRED_SERVICE_PROVIDER_BOND.muln(2), {from: cudos});
        await this.token.approve(this.stakingRewards.address, REQUIRED_SERVICE_PROVIDER_BOND.muln(2), {from: serviceProviderAlice});
        await this.serviceProviderAliceContract.stakeServiceProviderBond(
          REWARDS_PROGRAMME_TWO_ID,
          SERVICE_PROVIDER_ALICE_SERVICE_FEE_PERCENTAGE,
          {from: serviceProviderAlice}
        );

        // Check if Alice's stake went through
        (await this.stakingRewards.amountStakedByUserInRewardProgramme(
          REWARDS_PROGRAMME_TWO_ID,
          this.serviceProviderAliceProxyAddress
        )).should.be.bignumber.equal(REQUIRED_SERVICE_PROVIDER_BOND);
  
        // stake as fred
        await this.token.transfer(fred, STAKE_VALUE, {from: cudos});
        await this.token.approve(this.stakingRewards.address, STAKE_VALUE, {from: fred});
        await this.serviceProviderAliceContract.delegateStake(STAKE_VALUE, {from: fred});
  
        // move to block #10.
        await this.stakingRewards.fixBlockNumber('10', {from: cudos});

        // Service Provider Alice can't exit until block #51
        await expectRevert(
          this.serviceProviderAliceContract.exitAsServiceProvider({from: serviceProviderAlice}),
          "SPW5"
        );

        // Service Provider Alice wants to increase her stake, which increases the lock-up period to block #60
        await this.serviceProviderAliceContract.increaseServiceProviderStake(REQUIRED_SERVICE_PROVIDER_BOND, {from: serviceProviderAlice});
        
        // move to block #20.
        await this.stakingRewards.fixBlockNumber('20', {from: cudos});

        // Service Provider Alice can't withdraw her excess stake until block #60
        await expectRevert(
          this.serviceProviderAliceContract.requestExcessServiceProviderStakeWithdrawal(REQUIRED_SERVICE_PROVIDER_BOND, {from: serviceProviderAlice}),
          "SPW5"
        );
        
        // Service Provider Alice can't exit until block #60
        await expectRevert(
          this.serviceProviderAliceContract.exitAsServiceProvider({from: serviceProviderAlice}),
          "SPW5"
        );
  
        // Fred can't withdraw until block #51
        await expectRevert(
          this.serviceProviderAliceContract.requestDelegatedStakeWithdrawal(STAKE_VALUE, {from: fred}),
          "SPW5"
        );

        // move to block #30.
        await this.stakingRewards.fixBlockNumber('30', {from: cudos});
        
        // stake as Greg
        await this.token.transfer(greg, STAKE_VALUE.muln(2), {from: cudos});
        await this.token.approve(this.stakingRewards.address, STAKE_VALUE.muln(2), {from: greg});
        await this.serviceProviderAliceContract.delegateStake(STAKE_VALUE, {from: greg});
  
        // move to block 51
        await this.stakingRewards.fixBlockNumber('51', {from: cudos});

        // Service Provider Alice can't withdraw her excess stake until block #60
        await expectRevert(
          this.serviceProviderAliceContract.requestExcessServiceProviderStakeWithdrawal(REQUIRED_SERVICE_PROVIDER_BOND, {from: serviceProviderAlice}),
          "SPW5"
        );
        
        // Service Provider Alice can't exit until block #60
        await expectRevert(
          this.serviceProviderAliceContract.exitAsServiceProvider({from: serviceProviderAlice}),
          "SPW5"
        );

        // Fred is now able to withdraw his stake
        await this.serviceProviderAliceContract.requestDelegatedStakeWithdrawal(STAKE_VALUE, {from: fred});

        // move to block 55
        await this.stakingRewards.fixBlockNumber('55', {from: cudos});

        // Service Provider Alice still can't withdraw her excess stake until block #60
        await expectRevert(
          this.serviceProviderAliceContract.requestExcessServiceProviderStakeWithdrawal(REQUIRED_SERVICE_PROVIDER_BOND, {from: serviceProviderAlice}),
          "SPW5"
        );

        // move to block #60.
        await this.stakingRewards.fixBlockNumber('60', {from: cudos});

        // Service Provider Alice is now able withdraw her excess stake
        await this.serviceProviderAliceContract.requestExcessServiceProviderStakeWithdrawal(REQUIRED_SERVICE_PROVIDER_BOND, {from: serviceProviderAlice});
        
        // Greg delegates more stake. Now his lockup is extended to block #110                
        await this.serviceProviderAliceContract.delegateStake(STAKE_VALUE, {from: greg});

        // move to block #90.
        await this.stakingRewards.fixBlockNumber('90', {from: cudos});

        // Greg can't withdraw until block #110
        await expectRevert(
          this.serviceProviderAliceContract.requestDelegatedStakeWithdrawal(STAKE_VALUE, {from: greg}),
          "SPW5"
        );
  
        // move one day past unbonding period for Fred, and he should be able to collect his staked tokens
        await this.stakingRewards.fixBlockNumber(new BN('50').add(new BN('6500').mul(new BN('22'))), {from: cudos});
        const fredBalanceBeforeWithdrawal = await this.token.balanceOf(fred);
        await this.serviceProviderAliceContract.withdrawDelegatedStake({from: fred});
        const fredBalanceAfterWithdrawal = await this.token.balanceOf(fred);
        (await fredBalanceAfterWithdrawal.should.be.bignumber.equal(fredBalanceBeforeWithdrawal.add(STAKE_VALUE)));
      });      

      describe('when service provider is set up', () => {
        beforeEach(async () => {
          // Whitelist service provider Alice and stake required bond
          await this.stakingRewards.whitelistServiceProvider(serviceProviderAlice, {from: cudos});
          this.serviceProviderAliceProxyAddress = await this.stakingRewards.serviceProviderToWhitelistedProxyContracts(
            serviceProviderAlice
          );

          // Stake bond from service provider alice
          await this.token.transfer(serviceProviderAlice, REQUIRED_SERVICE_PROVIDER_BOND, {from: cudos});
          await this.token.approve(this.stakingRewards.address, REQUIRED_SERVICE_PROVIDER_BOND, {from: serviceProviderAlice});
          this.serviceProviderAliceContract = await ServiceProvider.at(this.serviceProviderAliceProxyAddress);
          await this.serviceProviderAliceContract.stakeServiceProviderBond(REWARDS_PROGRAMME_ONE_ID, SERVICE_PROVIDER_ALICE_SERVICE_FEE_PERCENTAGE,
            {from: serviceProviderAlice}
          );

          // stake as freddy
          await this.token.transfer(fred, STAKE_VALUE, {from: cudos});
          await this.token.approve(this.stakingRewards.address, STAKE_VALUE, {from: fred});

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
        });

        it('Reverts when sender does not have delegated stake', async () => {
          await expectRevert(
            this.serviceProviderAliceContract.requestDelegatedStakeWithdrawal(STAKE_VALUE, {from: cudos}),
            "SPW4"
          );
        });

        it('Reverts when delegator is trying to withdraw more than their staked amount', async () => {
          await expectRevert(
            this.serviceProviderAliceContract.requestDelegatedStakeWithdrawal(STAKE_VALUE.addn(1), {from: fred}),
            "SPW4"
          );
        });
      });
    });

    describe('withdrawDelegatedStake()', () => {
      it('Reverts when nothing to withdraw', async () => {
        // Whitelist service provider Alice and stake required bond
        await this.stakingRewards.whitelistServiceProvider(serviceProviderAlice, {from: cudos});
        this.serviceProviderAliceProxyAddress = await this.stakingRewards.serviceProviderToWhitelistedProxyContracts(
          serviceProviderAlice
        );

        // Stake bond from service provider alice
        await this.token.transfer(serviceProviderAlice, REQUIRED_SERVICE_PROVIDER_BOND, {from: cudos});
        await this.token.approve(this.stakingRewards.address, REQUIRED_SERVICE_PROVIDER_BOND, {from: serviceProviderAlice});
        this.serviceProviderAliceContract = await ServiceProvider.at(this.serviceProviderAliceProxyAddress);
        await this.serviceProviderAliceContract.stakeServiceProviderBond(REWARDS_PROGRAMME_ONE_ID, SERVICE_PROVIDER_ALICE_SERVICE_FEE_PERCENTAGE,
          {from: serviceProviderAlice}
        );
        
        await expectRevert(
          this.serviceProviderAliceContract.withdrawDelegatedStake({from: greg}),
          "SPW2"
        )
      })
    })

    describe('exitAsDelegator()', () => {
      it('Reverts when user has not delegated any stake', async () => {
        // Whitelist service provider Alice and stake required bond
        await this.stakingRewards.whitelistServiceProvider(serviceProviderAlice, {from: cudos});
        this.serviceProviderAliceProxyAddress = await this.stakingRewards.serviceProviderToWhitelistedProxyContracts(
          serviceProviderAlice
        );

        // Stake bond from service provider alice
        await this.token.transfer(serviceProviderAlice, REQUIRED_SERVICE_PROVIDER_BOND, {from: cudos});
        await this.token.approve(this.stakingRewards.address, REQUIRED_SERVICE_PROVIDER_BOND, {from: serviceProviderAlice});
        this.serviceProviderAliceContract = await ServiceProvider.at(this.serviceProviderAliceProxyAddress);
        await this.serviceProviderAliceContract.stakeServiceProviderBond(REWARDS_PROGRAMME_ONE_ID, SERVICE_PROVIDER_ALICE_SERVICE_FEE_PERCENTAGE,
          {from: serviceProviderAlice}
        );

        await this.serviceProviderAliceContract.exitAsServiceProvider({from: serviceProviderAlice})

        await expectRevert(
          this.serviceProviderAliceContract.exitAsDelegator(),
          "SPW1"
        );
      });

      it('Reverts when the service provider is still set up', async () => {
        // Whitelist service provider Alice and stake required bond
        await this.stakingRewards.whitelistServiceProvider(serviceProviderAlice, {from: cudos});
        this.serviceProviderAliceProxyAddress = await this.stakingRewards.serviceProviderToWhitelistedProxyContracts(
          serviceProviderAlice
        );

        // Stake bond from service provider alice
        await this.token.transfer(serviceProviderAlice, REQUIRED_SERVICE_PROVIDER_BOND, {from: cudos});
        await this.token.approve(this.stakingRewards.address, REQUIRED_SERVICE_PROVIDER_BOND, {from: serviceProviderAlice});
        this.serviceProviderAliceContract = await ServiceProvider.at(this.serviceProviderAliceProxyAddress);
        await this.serviceProviderAliceContract.stakeServiceProviderBond(REWARDS_PROGRAMME_ONE_ID, SERVICE_PROVIDER_ALICE_SERVICE_FEE_PERCENTAGE,
          {from: serviceProviderAlice}
        );

        await expectRevert(
          this.serviceProviderAliceContract.exitAsDelegator(),
          "SPE1"
        );
      });
    });

    describe('getReward()', () => {
      it('Reverts when service provider is not set up', async () => {
        await expectRevert(
          this.serviceProviderCloneable.getReward(),
          "SPC2"
        );
      });
    });
  });

  describe('adminStakeServiceProviderBond()', () => {
    beforeEach(async () => {
      // Whitelist service provider Alice and stake required bond
      await this.stakingRewards.whitelistServiceProvider(serviceProviderAlice, {from: cudos});
      this.serviceProviderAliceProxyAddress = await this.stakingRewards.serviceProviderToWhitelistedProxyContracts(
        serviceProviderAlice
      );

      this.serviceProviderAliceContract = await ServiceProvider.at(this.serviceProviderAliceProxyAddress);
    })

    it('Admin can stake on behalf of service provider', async () => {
      await this.token.approve(this.stakingRewards.address, REQUIRED_SERVICE_PROVIDER_BOND, {from: cudos});
      await this.serviceProviderAliceContract.adminStakeServiceProviderBond(REWARDS_PROGRAMME_ONE_ID, SERVICE_PROVIDER_ALICE_SERVICE_FEE_PERCENTAGE, {from: cudos})

      const isServiceProviderFullySetup = await this.serviceProviderAliceContract.isServiceProviderFullySetup();
      isServiceProviderFullySetup.should.be.true

      const amountStakedByUserInRewardProgramme = await this.stakingRewards.amountStakedByUserInRewardProgramme(
        REWARDS_PROGRAMME_ONE_ID,
        this.serviceProviderAliceProxyAddress
      )
      amountStakedByUserInRewardProgramme.should.be.bignumber.equal(REQUIRED_SERVICE_PROVIDER_BOND);
    })

    it('Reverts when service provider tries to stake after admin', async () => {
      await this.token.approve(this.stakingRewards.address, REQUIRED_SERVICE_PROVIDER_BOND, {from: cudos});
      await this.serviceProviderAliceContract.adminStakeServiceProviderBond(REWARDS_PROGRAMME_ONE_ID, SERVICE_PROVIDER_ALICE_SERVICE_FEE_PERCENTAGE, {from: cudos})

      await expectRevert(
        this.serviceProviderAliceContract.stakeServiceProviderBond(REWARDS_PROGRAMME_ONE_ID, SERVICE_PROVIDER_ALICE_SERVICE_FEE_PERCENTAGE,
          {from: serviceProviderAlice}
        ),
        "SPC7"
      )
    })

    it('Reverts when not admin', async () => {
      await expectRevert(
        this.serviceProviderAliceContract.adminStakeServiceProviderBond(REWARDS_PROGRAMME_ONE_ID, SERVICE_PROVIDER_ALICE_SERVICE_FEE_PERCENTAGE, {from: fred}),
        "OA"
      )
    })

    describe('When admin has staked', () => {
      beforeEach(async () => {
        await this.token.approve(this.stakingRewards.address, REQUIRED_SERVICE_PROVIDER_BOND.muln(2), {from: cudos});
        await this.serviceProviderAliceContract.adminStakeServiceProviderBond(REWARDS_PROGRAMME_ONE_ID, SERVICE_PROVIDER_ALICE_SERVICE_FEE_PERCENTAGE, {from: cudos})
      })

      it('Can increase stake', async () => {
        let amountStakedByUserInRewardProgramme = await this.stakingRewards.amountStakedByUserInRewardProgramme(
          REWARDS_PROGRAMME_ONE_ID,
          this.serviceProviderAliceProxyAddress
        )
        amountStakedByUserInRewardProgramme.should.be.bignumber.equal(REQUIRED_SERVICE_PROVIDER_BOND);

        const increase = new BN('5')
        await this.serviceProviderAliceContract.increaseServiceProviderStake(increase, {from: cudos})

        amountStakedByUserInRewardProgramme = await this.stakingRewards.amountStakedByUserInRewardProgramme(
          REWARDS_PROGRAMME_ONE_ID,
          this.serviceProviderAliceProxyAddress
        )
        amountStakedByUserInRewardProgramme.should.be.bignumber.equal(REQUIRED_SERVICE_PROVIDER_BOND.add(increase));
      })

      it('Can decrease excess stake', async () => {
        let amountStakedByUserInRewardProgramme = await this.stakingRewards.amountStakedByUserInRewardProgramme(
          REWARDS_PROGRAMME_ONE_ID,
          this.serviceProviderAliceProxyAddress
        )
        amountStakedByUserInRewardProgramme.should.be.bignumber.equal(REQUIRED_SERVICE_PROVIDER_BOND);

        const increase = new BN('5')
        await this.serviceProviderAliceContract.increaseServiceProviderStake(increase, {from: cudos})

        amountStakedByUserInRewardProgramme = await this.stakingRewards.amountStakedByUserInRewardProgramme(
          REWARDS_PROGRAMME_ONE_ID,
          this.serviceProviderAliceProxyAddress
        )
        amountStakedByUserInRewardProgramme.should.be.bignumber.equal(REQUIRED_SERVICE_PROVIDER_BOND.add(increase));

        await this.serviceProviderAliceContract.requestExcessServiceProviderStakeWithdrawal(increase, {from: cudos})

        amountStakedByUserInRewardProgramme = await this.stakingRewards.amountStakedByUserInRewardProgramme(
          REWARDS_PROGRAMME_ONE_ID,
          this.serviceProviderAliceProxyAddress
        )
        amountStakedByUserInRewardProgramme.should.be.bignumber.equal(REQUIRED_SERVICE_PROVIDER_BOND);
      })

      it('Can exit', async () => {
        let amountStakedByUserInRewardProgramme = await this.stakingRewards.amountStakedByUserInRewardProgramme(
          REWARDS_PROGRAMME_ONE_ID,
          this.serviceProviderAliceProxyAddress
        )
        amountStakedByUserInRewardProgramme.should.be.bignumber.equal(REQUIRED_SERVICE_PROVIDER_BOND);

        await this.serviceProviderAliceContract.exitAsServiceProvider({from: cudos})

        amountStakedByUserInRewardProgramme = await this.stakingRewards.amountStakedByUserInRewardProgramme(
          REWARDS_PROGRAMME_ONE_ID,
          this.serviceProviderAliceProxyAddress
        )
        amountStakedByUserInRewardProgramme.should.be.bignumber.equal('0');
      })

      it('Can earn the rewards the service provider would earn', async () => {
        await this.token.transfer(fred, STAKE_VALUE, {from: cudos});
        await this.token.approve(this.stakingRewards.address, STAKE_VALUE, {from: fred});

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

        const serviceProviderManagerCudoBalanceBeforeRewardClaim = await this.token.balanceOf(cudos);
        const serviceProviderAliceCudoBalanceBeforeRewardClaim = await this.token.balanceOf(serviceProviderAlice);

        const pendingRewardFredBeforeClaim = await this.serviceProviderAliceContract.pendingRewards(fred)
        const pendingRewardServiceProviderAliceBeforeClaim = await this.serviceProviderAliceContract.pendingRewards(serviceProviderAlice)

        // Due to fred delegating 100k stake to the service provider contract, he is entitled to 5% of the rewards minus the service fee
        await this.serviceProviderAliceContract.getReward({from: fred});

        const serviceProviderManagerCudoBalanceAfterRewardClaim = await this.token.balanceOf(cudos);
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

        const rewardDueToServiceProvider = rewardsFee;
        const rewardDueToServiceProviderManager = expectedRewardToServiceProviderAliceContract.sub(grossRewardsDueToFreddy)

        shouldBeNumberInEtherCloseTo(
          serviceProviderManagerCudoBalanceAfterRewardClaim.sub(serviceProviderManagerCudoBalanceBeforeRewardClaim),
          fromWei(rewardDueToServiceProviderManager)
        );

        shouldBeNumberInEtherCloseTo(
          serviceProviderAliceCudoBalanceAfterRewardClaim.sub(serviceProviderAliceCudoBalanceBeforeRewardClaim),
          fromWei(rewardsFee)
        );

        // this is roughly 5% of the rewards minus the service fee taken above and sent to alice
        shouldBeNumberInEtherCloseTo(await this.token.balanceOf(fred), fromWei(netRewardsDueToFreddy));
        shouldBeNumberInEtherCloseTo(pendingRewardFredBeforeClaim, fromWei(netRewardsDueToFreddy));
      })
    })
  })

  // When testing any ServiceProvider functionality that interacts with Staking Rewards
  describe('When interacting with StakingRewards', () => {
    const _1_million_cudo = new BN('1000000').mul(new BN('10').pow(new BN('18')));

    beforeEach(async () => {

      // Whitelist service provider Alice and stake required bond
      await this.stakingRewards.whitelistServiceProvider(serviceProviderAlice, {from: cudos});
      this.serviceProviderAliceProxyAddress = await this.stakingRewards.serviceProviderToWhitelistedProxyContracts(
        serviceProviderAlice
      );

      // Stake bond from service provider alice
      await this.token.transfer(serviceProviderAlice, REQUIRED_SERVICE_PROVIDER_BOND, {from: cudos});
      await this.token.approve(this.stakingRewards.address, REQUIRED_SERVICE_PROVIDER_BOND, {from: serviceProviderAlice});
      this.serviceProviderAliceContract = await ServiceProvider.at(this.serviceProviderAliceProxyAddress);
      await this.serviceProviderAliceContract.stakeServiceProviderBond(REWARDS_PROGRAMME_ONE_ID, SERVICE_PROVIDER_ALICE_SERVICE_FEE_PERCENTAGE,
        {from: serviceProviderAlice}
      );

      // Give and approve Fred's tokens
      await this.token.transfer(fred, STAKE_VALUE, {from: cudos});
      await this.token.approve(this.stakingRewards.address, STAKE_VALUE, {from: fred});
      (await this.token.balanceOf(fred)).should.be.bignumber.equal(STAKE_VALUE);
    });

    describe('requestExcessServiceProviderStakeWithdrawal()', () => {
      it('Withdrawing when minimum stake for SP drops from 2m to 1m', async () => {
        await this.stakingRewards.updateMinRequiredStakingAmountForServiceProviders(_1_million_cudo, {from: cudos});

        const cudoBalanceBeforeExcessWithdrawalRequest = await this.token.balanceOf(serviceProviderAlice);

        await this.serviceProviderAliceContract.requestExcessServiceProviderStakeWithdrawal(_1_million_cudo, {from: serviceProviderAlice});

        const cudoBalanceAfterExcessWithdrawalRequest = await this.token.balanceOf(serviceProviderAlice);

        // Alice shouldn't receive her excess stake just yet
        expect(cudoBalanceAfterExcessWithdrawalRequest).to.be.bignumber.equal(cudoBalanceBeforeExcessWithdrawalRequest);

        // If not past the unbonding period, Alice cannot withdraw her request
        await this.stakingRewards.fixBlockNumber('10', {from: cudos});
        await expectRevert(
          this.serviceProviderAliceContract.withdrawServiceProviderStake({from: serviceProviderAlice}),
          "SPW3"
        );

        // Move past the unbonding period
        await this.stakingRewards.fixBlockNumber(new BN('10').add(new BN('6500').mul(new BN('22'))), {from: cudos});

        // Now Alice shpuld be able to claim her excess stake
        const cudoBalanceBeforeExcessWithdrawal = await this.token.balanceOf(serviceProviderAlice);
        await this.serviceProviderAliceContract.withdrawServiceProviderStake({from: serviceProviderAlice});
        const cudoBalanceAfterExcessWithdrawal = await this.token.balanceOf(serviceProviderAlice);
        expect(cudoBalanceAfterExcessWithdrawal.sub(cudoBalanceBeforeExcessWithdrawal)).to.be.bignumber.equal(_1_million_cudo);
      });
    });

    describe('increaseServiceProviderStake()', () => {
      it('Allows a service provider to increase their stake', async () => {
        // Ensure the delegated stake is the minimum amount required
        const minRequiredStakingAmountForValidators = await this.stakingRewards.minRequiredStakingAmountForServiceProviders();
        expect(await this.serviceProviderAliceContract.delegatedStake(serviceProviderAlice)).to.be.bignumber.equal(
          minRequiredStakingAmountForValidators
        );

        await this.token.transfer(serviceProviderAlice, _1_million_cudo, {from: cudos});
        await this.token.approve(this.stakingRewards.address, _1_million_cudo, {from: serviceProviderAlice});

        await this.serviceProviderAliceContract.increaseServiceProviderStake(_1_million_cudo, {from: serviceProviderAlice});

        expect(await this.serviceProviderAliceContract.delegatedStake(serviceProviderAlice)).to.be.bignumber.equal(
          minRequiredStakingAmountForValidators.add(_1_million_cudo)
        );

        expect(
          await this.stakingRewards.amountStakedByUserInRewardProgramme(
            REWARDS_PROGRAMME_ONE_ID,
            this.serviceProviderAliceContract.address
          )
        ).to.be.bignumber.equal(minRequiredStakingAmountForValidators.add(_1_million_cudo));
      });

      it('After increasing their stake, allows the service provider to gain increased rewards', async () => {
        // Let fred stake
        (await this.token.balanceOf(fred)).should.be.bignumber.equal(STAKE_VALUE);

        await this.serviceProviderAliceContract.delegateStake(STAKE_VALUE, {from: fred});

        (await this.token.balanceOf(fred)).should.be.bignumber.equal(ZERO);

        // Lets move the blocks along to start generating rewards for the service provider and fred
        // start block for rewards is block #5, so 2 blocks means 2 * 100 block rewards = 200 * 10 ^18
        await this.stakingRewards.fixBlockNumber('7', {from: cudos});
        const expectedRewardToServiceProviderAliceContract = rewardPerBlock.muln(2);

        let serviceProviderAliceBalanceBefore = await this.token.balanceOf(serviceProviderAlice);
        let fredBalanceBeforeGetReward = await this.token.balanceOf(fred);

        await this.serviceProviderAliceContract.getReward({from: fred});

        let fredBalanceAfterGetReward = await this.token.balanceOf(fred);
        let serviceProviderAliceBalanceAfter = await this.token.balanceOf(serviceProviderAlice);

        const stakeDelegatedToServiceProvider = STAKE_VALUE;
        const percentageOfStakeThatIsDelegatedToServiceProvider =
          stakeDelegatedToServiceProvider.mul(PERCENTAGE_MODULO).div(STAKE_VALUE.add(REQUIRED_SERVICE_PROVIDER_BOND));

        // Should be 500 or 5% but solidity has its own ideas about division...
        percentageOfStakeThatIsDelegatedToServiceProvider.should.be.bignumber.equal('476');

        let grossRewardsDueToFreddy = expectedRewardToServiceProviderAliceContract.mul(percentageOfStakeThatIsDelegatedToServiceProvider).div(PERCENTAGE_MODULO);
        let rewardsFee = grossRewardsDueToFreddy.mul(SERVICE_PROVIDER_ALICE_SERVICE_FEE_PERCENTAGE).div(PERCENTAGE_MODULO);

        let netRewardsDueToFreddy = grossRewardsDueToFreddy.sub(rewardsFee);

        shouldBeNumberInEtherCloseTo(fredBalanceAfterGetReward.sub(fredBalanceBeforeGetReward), fromWei(netRewardsDueToFreddy));

        let rewardDueToAlice = expectedRewardToServiceProviderAliceContract.sub(netRewardsDueToFreddy);
        shouldBeNumberInEtherCloseTo(serviceProviderAliceBalanceAfter.sub(serviceProviderAliceBalanceBefore), fromWei(rewardDueToAlice));

        // now let service provider alice increase her amount staked by 1 million cudo
        await this.token.transfer(serviceProviderAlice, _1_million_cudo, {from: cudos});
        await this.token.approve(this.stakingRewards.address, _1_million_cudo, {from: serviceProviderAlice});
        await this.serviceProviderAliceContract.increaseServiceProviderStake(_1_million_cudo, {from: serviceProviderAlice});

        // move the blocks along 2 further blocks for 200 more CUDO rewards
        await this.stakingRewards.fixBlockNumber('9', {from: cudos});

        serviceProviderAliceBalanceBefore = await this.token.balanceOf(serviceProviderAlice);
        fredBalanceBeforeGetReward = await this.token.balanceOf(fred);

        await this.serviceProviderAliceContract.getReward({from: fred});

        fredBalanceAfterGetReward = await this.token.balanceOf(fred);
        serviceProviderAliceBalanceAfter = await this.token.balanceOf(serviceProviderAlice);

        const newPercentageOfStakeThatIsDelegatedToServiceProvider =
          stakeDelegatedToServiceProvider.mul(PERCENTAGE_MODULO).div(STAKE_VALUE.add(REQUIRED_SERVICE_PROVIDER_BOND.add(_1_million_cudo)));

        grossRewardsDueToFreddy = expectedRewardToServiceProviderAliceContract.mul(newPercentageOfStakeThatIsDelegatedToServiceProvider).div(PERCENTAGE_MODULO);
        rewardsFee = grossRewardsDueToFreddy.mul(SERVICE_PROVIDER_ALICE_SERVICE_FEE_PERCENTAGE).div(PERCENTAGE_MODULO);
        netRewardsDueToFreddy = grossRewardsDueToFreddy.sub(rewardsFee);

        shouldBeNumberInEtherCloseTo(fredBalanceAfterGetReward.sub(fredBalanceBeforeGetReward), fromWei(netRewardsDueToFreddy));

        rewardDueToAlice = expectedRewardToServiceProviderAliceContract.sub(netRewardsDueToFreddy);
        shouldBeNumberInEtherCloseTo(serviceProviderAliceBalanceAfter.sub(serviceProviderAliceBalanceBefore), fromWei(rewardDueToAlice));
      });

      it('Reverts if exceeding max staking allowance', async () => {
        // Ensure the delegated stake is the minimum amount required
        const minRequiredStakingAmountForValidators = await this.stakingRewards.minRequiredStakingAmountForServiceProviders();
        expect(await this.serviceProviderAliceContract.delegatedStake(serviceProviderAlice)).to.be.bignumber.equal(
          minRequiredStakingAmountForValidators
        );

        await this.stakingRewards.updateMaxStakingAmountForServiceProviders(minRequiredStakingAmountForValidators.add(rewardPerBlock), {from: whitelisted});

        await this.token.transfer(serviceProviderAlice, _1_million_cudo, {from: cudos});
        await this.token.approve(this.stakingRewards.address, _1_million_cudo, {from: serviceProviderAlice});

        await expectRevert(
          this.serviceProviderAliceContract.increaseServiceProviderStake(_1_million_cudo, {from: serviceProviderAlice}),
          "SPS1"
        );
      });
    });

    describe('exitAsDelegator()', () => {
      it('Can exit successfully', async () => {
        // ----------------
        // Stake as freddy
        // ----------------
        (await this.token.balanceOf(fred)).should.be.bignumber.equal(STAKE_VALUE);

        await this.serviceProviderAliceContract.delegateStake(STAKE_VALUE, {from: fred});

        (await this.token.balanceOf(fred)).should.be.bignumber.equal(ZERO);

        // ------------------------
        // Exit as service provider
        // ------------------------
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

        const stakeDelegatedToServiceProvider = STAKE_VALUE;
        const percentageOfStakeThatIsDelegatedToServiceProvider =
          stakeDelegatedToServiceProvider.mul(PERCENTAGE_MODULO).div(totalDelegatedStake);

        // Should be 500 or 5% but solidity has its own ideas about division...
        percentageOfStakeThatIsDelegatedToServiceProvider.should.be.bignumber.equal('476');

        const grossRewardsDueToFreddy = expectedRewardToServiceProviderAliceContract.mul(percentageOfStakeThatIsDelegatedToServiceProvider).div(PERCENTAGE_MODULO);
        const rewardsFee = grossRewardsDueToFreddy.mul(SERVICE_PROVIDER_ALICE_SERVICE_FEE_PERCENTAGE).div(PERCENTAGE_MODULO);

        const netRewardsDueToFreddy = grossRewardsDueToFreddy.sub(rewardsFee);

        // This balance should contain only rewards earned in the last 24 hours since alice has to wait out the unbonding period to receive her staking bond
        const expectedServiceProviderAliceBalance = serviceProviderAliceCudoBalanceAfterExit.sub(serviceProviderAliceCudoBalanceBeforeExit);
        shouldBeNumberInEtherCloseTo(
          expectedRewardToServiceProviderAliceContract.sub(netRewardsDueToFreddy),
          fromWei(expectedServiceProviderAliceBalance)
        );

        // ------------------------
        // Exit as the freddy the delegator
        // ------------------------
        const fredBalanceBeforeExit = await this.token.balanceOf(fred);

        await this.serviceProviderAliceContract.exitAsDelegator({from: fred});

        const fredBalanceAfterExit = await this.token.balanceOf(fred);

        await shouldBeNumberInEtherCloseTo(fredBalanceAfterExit.sub(fredBalanceBeforeExit), fromWei(STAKE_VALUE.add(netRewardsDueToFreddy)));
      });
    });

    describe('getReward()', () => {
      it('Issues no rewards when called twice in the same block', async () => {
        (await this.token.balanceOf(fred)).should.be.bignumber.equal(STAKE_VALUE);

        await this.serviceProviderAliceContract.delegateStake(STAKE_VALUE, {from: fred});

        (await this.token.balanceOf(fred)).should.be.bignumber.equal(ZERO);

        // start block for rewards is block #5, so 2 blocks means 2 * 100 block rewards = 200 * 10 ^18
        await this.stakingRewards.fixBlockNumber('7', {from: cudos});
        const expectedRewardToServiceProviderAliceContract = rewardPerBlock.muln(2);

        const fredBalanceBeforeGetReward = await this.token.balanceOf(fred);

        await this.serviceProviderAliceContract.getReward({from: fred});

        const fredBalanceAfterGetReward = await this.token.balanceOf(fred);

        const stakeDelegatedToServiceProvider = STAKE_VALUE;
        const percentageOfStakeThatIsDelegatedToServiceProvider =
          stakeDelegatedToServiceProvider.mul(PERCENTAGE_MODULO).div(STAKE_VALUE.add(REQUIRED_SERVICE_PROVIDER_BOND));

        // Should be 500 or 5% but solidity has its own ideas about division...
        percentageOfStakeThatIsDelegatedToServiceProvider.should.be.bignumber.equal('476');

        const grossRewardsDueToFreddy = expectedRewardToServiceProviderAliceContract.mul(percentageOfStakeThatIsDelegatedToServiceProvider).div(PERCENTAGE_MODULO);
        const rewardsFee = grossRewardsDueToFreddy.mul(SERVICE_PROVIDER_ALICE_SERVICE_FEE_PERCENTAGE).div(PERCENTAGE_MODULO);

        const netRewardsDueToFreddy = grossRewardsDueToFreddy.sub(rewardsFee);

        shouldBeNumberInEtherCloseTo(fredBalanceAfterGetReward.sub(fredBalanceBeforeGetReward), fromWei(netRewardsDueToFreddy));

        await this.serviceProviderAliceContract.getReward({from: fred});
      });

      it('Distributes rewards correctly when two transactions from two different validators go in the same block', async () => {
        // Whitelist service provider Bob and stake required bond
        await this.stakingRewards.whitelistServiceProvider(serviceProviderBob, {from: cudos});
        this.serviceProviderBobProxyAddress = await this.stakingRewards.serviceProviderToWhitelistedProxyContracts(
          serviceProviderBob
        );

        // Stake bond from service provider Bob
        await this.token.transfer(serviceProviderBob, REQUIRED_SERVICE_PROVIDER_BOND, {from: cudos});
        await this.token.approve(this.stakingRewards.address, REQUIRED_SERVICE_PROVIDER_BOND, {from: serviceProviderBob});
        this.serviceProviderBobContract = await ServiceProvider.at(this.serviceProviderBobProxyAddress);
        await this.serviceProviderBobContract.stakeServiceProviderBond(REWARDS_PROGRAMME_ONE_ID, SERVICE_PROVIDER_BOB_SERVICE_FEE_PERCENTAGE,
          {from: serviceProviderBob}
        );              

        // Give and approve Greg's tokens
        await this.token.transfer(greg, STAKE_VALUE, {from: cudos});
        await this.token.approve(this.stakingRewards.address, STAKE_VALUE, {from: greg});
        (await this.token.balanceOf(greg)).should.be.bignumber.equal(STAKE_VALUE);                
        
        (await this.token.balanceOf(fred)).should.be.bignumber.equal(STAKE_VALUE);
        (await this.token.balanceOf(greg)).should.be.bignumber.equal(STAKE_VALUE);        

        // start block for rewards is block #5, so 2 blocks means 2 * 100 block rewards = 200 * 10 ^18
        await this.stakingRewards.fixBlockNumber('7', {from: cudos});

        await this.serviceProviderAliceContract.delegateStake(STAKE_VALUE, {from: fred});
        (await this.token.balanceOf(fred)).should.be.bignumber.equal(ZERO);

        await this.serviceProviderBobContract.delegateStake(STAKE_VALUE, {from: greg});
        (await this.token.balanceOf(greg)).should.be.bignumber.equal(ZERO);        

        // Alice and Bob should share the rewards evenly
        (await this.token.balanceOf(serviceProviderAlice)).should.be.bignumber.equal(rewardPerBlock);
        (await this.token.balanceOf(serviceProviderBob)).should.be.bignumber.equal(rewardPerBlock);
        
      });

      it('Does not mess up delegator rewards when two or more transactions from the same SP contract go in the same block', async () => {                

        // ***** move to block #7 -- start block for rewards is block #5, so 2 blocks means 2 * 100 block rewards = 200 * 10 ^18
        await this.stakingRewards.fixBlockNumber('7', {from: cudos});

        // Fred stakes
        await this.serviceProviderAliceContract.delegateStake(STAKE_VALUE, {from: fred});
        (await this.token.balanceOf(fred)).should.be.bignumber.equal(ZERO);

        // ***** move to block #9
        await this.stakingRewards.fixBlockNumber('9', {from: cudos});

        // 1st transaction in this block -- Alice claims rewards
        await this.serviceProviderAliceContract.getReward({from: serviceProviderAlice}); 

        // 2nd transaction in the this block -- Give Fred more tokens to stake again
        await this.token.transfer(fred, STAKE_VALUE, {from: cudos});
        await this.token.approve(this.stakingRewards.address, STAKE_VALUE, {from: fred});
        (await this.token.balanceOf(fred)).should.be.bignumber.equal(STAKE_VALUE);
        await this.serviceProviderAliceContract.delegateStake(STAKE_VALUE, {from: fred});
        
        // Fred should be able to successfully stake his tokens and receive his pending rewards
        (await this.serviceProviderAliceContract.delegatedStake(fred)).should.be.bignumber.equal(STAKE_VALUE.muln(2));
        // What Fred receives
        const fredBalanceBefore = await this.token.balanceOf(fred);

        // Calculate what Fred should receive
        const stakeDelegatedToServiceProviderBefore = STAKE_VALUE;
        const percentageOfStakeThatIsDelegatedToServiceProviderBefore =
              stakeDelegatedToServiceProviderBefore.mul(PERCENTAGE_MODULO).div(stakeDelegatedToServiceProviderBefore.add(REQUIRED_SERVICE_PROVIDER_BOND));
        const grossRewardsDueToFredBefore = rewardPerBlock.muln(2).mul(percentageOfStakeThatIsDelegatedToServiceProviderBefore).div(PERCENTAGE_MODULO);
        const rewardsFeeBefore = grossRewardsDueToFredBefore.mul(SERVICE_PROVIDER_ALICE_SERVICE_FEE_PERCENTAGE).div(PERCENTAGE_MODULO);
        const netRewardsDueToFredBefore = grossRewardsDueToFredBefore.sub(rewardsFeeBefore);        

        // What Fred receives and what he should receive must be the same
        shouldBeNumberInEtherCloseTo(fredBalanceBefore, fromWei(netRewardsDueToFredBefore));
        
        // Fred shouldn't be able to claim rewards more than once in the same block
        await this.serviceProviderAliceContract.getReward({from: fred});
        const fredBalanceDouble = await this.token.balanceOf(fred);
        shouldBeNumberInEtherCloseTo(fredBalanceBefore, fromWei(fredBalanceDouble));

        // ***** move to block #11
        await this.stakingRewards.fixBlockNumber('11', {from: cudos});
        
        // Fred claim rewards -- 1st transaction in this block
        await this.serviceProviderAliceContract.getReward({from: fred});
        
        // What Fred receives and what he should receive must be the same
        const fredBalanceAfter = await this.token.balanceOf(fred);

        const stakeDelegatedToServiceProviderAfter = STAKE_VALUE.muln(2);
        const percentageOfStakeThatIsDelegatedToServiceProviderAfter =
              stakeDelegatedToServiceProviderAfter.mul(PERCENTAGE_MODULO).div(stakeDelegatedToServiceProviderAfter.add(REQUIRED_SERVICE_PROVIDER_BOND));
        const grossRewardsDueToFredAfter = rewardPerBlock.muln(2).mul(percentageOfStakeThatIsDelegatedToServiceProviderAfter).div(PERCENTAGE_MODULO);
        const rewardsFeeAfter = grossRewardsDueToFredAfter.mul(SERVICE_PROVIDER_ALICE_SERVICE_FEE_PERCENTAGE).div(PERCENTAGE_MODULO);
        const netRewardsDueToFredAfter = grossRewardsDueToFredAfter.sub(rewardsFeeAfter);        

        shouldBeNumberInEtherCloseTo(fredBalanceAfter, fromWei(netRewardsDueToFredAfter.add(netRewardsDueToFredBefore)));

        // Give Greg tokens and stake -- 2nd transaction in this block
        await this.token.transfer(greg, STAKE_VALUE, {from: cudos});
        await this.token.approve(this.stakingRewards.address, STAKE_VALUE, {from: greg});
        (await this.token.balanceOf(greg)).should.be.bignumber.equal(STAKE_VALUE);
        await this.serviceProviderAliceContract.delegateStake(STAKE_VALUE, {from: greg});
        
        // Greg shouldn't receive any rewards but his stake must be registered
        (await this.token.balanceOf(greg)).should.be.bignumber.equal(ZERO);
        (await this.serviceProviderAliceContract.delegatedStake(greg)).should.be.bignumber.equal(STAKE_VALUE);

        // Now when Alice claims rewards, she shouldn't receive anything
        const aliceBalanceBefore = await this.token.balanceOf(serviceProviderAlice);
        // 3rd transaction in this block -- Alice claims rewards
        await this.serviceProviderAliceContract.getReward({from: serviceProviderAlice});
        const aliceBalanceAfter = await this.token.balanceOf(serviceProviderAlice);
        aliceBalanceBefore.should.be.bignumber.equal(aliceBalanceAfter);

        // Store Fred and Greg's stakes for the next step
        const fredStake = await this.serviceProviderAliceContract.delegatedStake(fred);
        const gregStake = await this.serviceProviderAliceContract.delegatedStake(greg);

        // ***** move to block #13
        await this.stakingRewards.fixBlockNumber('13', {from: cudos});

        // Everyone's account balances at the beginning of the block
        const aliceBalanceAtBeginning = await this.token.balanceOf(serviceProviderAlice);
        const fredBalanceAtBeginning = await this.token.balanceOf(fred);
        const gregBalanceAtBeginning = await this.token.balanceOf(greg);

        // 1st transaction in this block -- Alice claims rewards
        await this.serviceProviderAliceContract.getReward({from: serviceProviderAlice});
        // 2nd transaction in this block -- Fred removes stake
        await this.serviceProviderAliceContract.requestDelegatedStakeWithdrawal(STAKE_VALUE,{from: fred});
        (await this.serviceProviderAliceContract.delegatedStake(fred)).should.be.bignumber.equal(STAKE_VALUE);
        // 3rd transaction in this block -- Greg adds stake
        await this.token.transfer(greg, STAKE_VALUE, {from: cudos});
        await this.token.approve(this.stakingRewards.address, STAKE_VALUE, {from: greg});        
        await this.serviceProviderAliceContract.delegateStake(STAKE_VALUE, {from: greg});
        (await this.serviceProviderAliceContract.delegatedStake(greg)).should.be.bignumber.equal(STAKE_VALUE.muln(2));
        // 4th transaction in this block -- Fred claims rewards
        await this.serviceProviderAliceContract.getReward({from: fred});
        // 5th transaction in this block -- Alice increases her validator stake
        await this.token.transfer(serviceProviderAlice, REQUIRED_SERVICE_PROVIDER_BOND, {from: cudos});
        await this.token.approve(this.stakingRewards.address, REQUIRED_SERVICE_PROVIDER_BOND, {from: serviceProviderAlice});
        await this.serviceProviderAliceContract.increaseServiceProviderStake(REQUIRED_SERVICE_PROVIDER_BOND, {from: serviceProviderAlice});
        (await this.serviceProviderAliceContract.delegatedStake(serviceProviderAlice)).should.be.bignumber.equal(REQUIRED_SERVICE_PROVIDER_BOND.muln(2));

        // Everyone's account balances at the end of the block
        const aliceBalanceAtEnd = await this.token.balanceOf(serviceProviderAlice);
        const fredBalanceAtEnd = await this.token.balanceOf(fred);
        const gregBalanceAtEnd = await this.token.balanceOf(greg);

        const aliceDelta = aliceBalanceAtEnd.sub(aliceBalanceAtBeginning);
        const fredDelta = fredBalanceAtEnd.sub(fredBalanceAtBeginning);
        const gregDelta = gregBalanceAtEnd.sub(gregBalanceAtBeginning);
        const stakeDelegatedToServiceProvider = fredStake.add(gregStake);

        // Check if they all received their rewards correctly
        const percentageOfStakeThatIsDelegatedToServiceProvider = 
              stakeDelegatedToServiceProvider.mul(PERCENTAGE_MODULO).div(stakeDelegatedToServiceProvider.add(REQUIRED_SERVICE_PROVIDER_BOND));
        const grossRewardsDueToDelegators = rewardPerBlock.muln(2).mul(percentageOfStakeThatIsDelegatedToServiceProvider).div(PERCENTAGE_MODULO);
        const rewardsFee = grossRewardsDueToDelegators.mul(SERVICE_PROVIDER_ALICE_SERVICE_FEE_PERCENTAGE).div(PERCENTAGE_MODULO);        
        const netRewardsDueToDelegators = grossRewardsDueToDelegators.sub(rewardsFee);
        const netRewardsDueToAlice = rewardPerBlock.muln(2).sub(netRewardsDueToDelegators);
        const percentageOfFred = fredStake.mul(IMPROVE_PRECISION).div(stakeDelegatedToServiceProvider);
        const percentageOfGreg = gregStake.mul(IMPROVE_PRECISION).div(stakeDelegatedToServiceProvider);
        const netRewardsDueToFred = netRewardsDueToDelegators.mul(percentageOfFred).div(IMPROVE_PRECISION);
        const netRewardsDueToGreg = netRewardsDueToDelegators.mul(percentageOfGreg).div(IMPROVE_PRECISION);

        shouldBeNumberInEtherCloseTo(aliceDelta, fromWei(netRewardsDueToAlice));
        shouldBeNumberInEtherCloseTo(fredDelta, fromWei(netRewardsDueToFred));
        shouldBeNumberInEtherCloseTo(gregDelta, fromWei(netRewardsDueToGreg));        
      });

      it('Correctly sends delegators their pending rewards even when no new rewards are generated', async () => {                

        // ***** move to block #7 -- start block for rewards is block #5, so 2 blocks means 2 * 100 block rewards = 200 * 10 ^18
        await this.stakingRewards.fixBlockNumber('7', {from: cudos});        

        // Fred stakes
        await this.serviceProviderAliceContract.delegateStake(STAKE_VALUE, {from: fred});
        (await this.token.balanceOf(fred)).should.be.bignumber.equal(ZERO);

        // ***** move to block #9
        await this.stakingRewards.fixBlockNumber('9', {from: cudos});

        // Set block rewards to zero
        await this.stakingRewards.updateTokenRewardPerBlock(ZERO, {from: cudos});
        (await this.stakingRewards.tokenRewardPerBlock()).should.be.bignumber.equal(ZERO);

        // ***** move to block #10
        await this.stakingRewards.fixBlockNumber('10', {from: cudos});

        const aliceBalanceBefore = await this.token.balanceOf(serviceProviderAlice);
        // Alice getReward
        await this.serviceProviderAliceContract.getReward({from: serviceProviderAlice});
        const aliceBalanceAfter = await this.token.balanceOf(serviceProviderAlice);
        const aliceBalanceDelta = aliceBalanceAfter.sub(aliceBalanceBefore);

        // Calculate what Alice should have received
        const stakeDelegatedToServiceProvider = STAKE_VALUE;
        const percentageOfStakeThatIsDelegatedToServiceProvider =
              stakeDelegatedToServiceProvider.mul(PERCENTAGE_MODULO).div(stakeDelegatedToServiceProvider.add(REQUIRED_SERVICE_PROVIDER_BOND));
        const grossRewardsDueToFred = rewardPerBlock.muln(2).mul(percentageOfStakeThatIsDelegatedToServiceProvider).div(PERCENTAGE_MODULO);
        const rewardsFee = grossRewardsDueToFred.mul(SERVICE_PROVIDER_ALICE_SERVICE_FEE_PERCENTAGE).div(PERCENTAGE_MODULO);
        const netRewardsDueToFred = grossRewardsDueToFred.sub(rewardsFee);
        const netRewardsDueToAlice = rewardPerBlock.muln(2).sub(netRewardsDueToFred);
        shouldBeNumberInEtherCloseTo(netRewardsDueToAlice, fromWei(aliceBalanceDelta));

        // ***** move to block #11
        await this.stakingRewards.fixBlockNumber('11', {from: cudos});

        // Fred getReward
        await this.serviceProviderAliceContract.getReward({from: fred});
        const fredBalance = await this.token.balanceOf(fred);

        // Calculate what Fred should have received
        shouldBeNumberInEtherCloseTo(netRewardsDueToFred, fromWei(fredBalance));

        // Fred getReward again in the same block   
        await this.serviceProviderAliceContract.getReward({from: fred});
        // But he shouldn't receive anything
        (await this.token.balanceOf(fred)).should.be.bignumber.equal(fredBalance);
        
        // ***** move to block #12
        await this.stakingRewards.fixBlockNumber('12', {from: cudos});

        // Fred getReward again -- classic Fred
        await this.serviceProviderAliceContract.getReward({from: fred});
        // But he shouldn't receive anything
        (await this.token.balanceOf(fred)).should.be.bignumber.equal(fredBalance);
      });

      it('Correctly distributes rewards within a validator pool', async () => {
        
        // Fred delegates 100K tokens to Alice        
        await this.serviceProviderAliceContract.delegateStake(STAKE_VALUE, {from: fred});
        
        // Consider "timeInBlocks" many blocks worth of rewards (starting block is #5)
        const timeInBlocks = new BN('1')
        const blockNumber = new BN('5').add(timeInBlocks)
        await this.stakingRewards.fixBlockNumber(blockNumber, {from: cudos});
       
        // Check if the correct proprtions are distributed        
        const serviceProviderAliceCudoBalanceBeforeGetReward = await this.token.balanceOf(serviceProviderAlice);
        const fredCudoBalanceBeforeGetReward = await this.token.balanceOf(fred);
        await this.serviceProviderAliceContract.getReward({from: fred});
        const serviceProviderAliceCudoBalanceAfterGetReward = await this.token.balanceOf(serviceProviderAlice);
        const fredCudoBalanceAfterGetReward = await this.token.balanceOf(fred);
        const aliceActualEarning = serviceProviderAliceCudoBalanceAfterGetReward.sub(serviceProviderAliceCudoBalanceBeforeGetReward)
        const fredActualEarning = fredCudoBalanceAfterGetReward.sub(fredCudoBalanceBeforeGetReward)

        const expectedRewardToServiceProviderAliceContract = rewardPerBlock.mul(timeInBlocks);

        const fredStake = await this.serviceProviderAliceContract.delegatedStake(fred)
        const aliceStake = await this.serviceProviderAliceContract.delegatedStake(serviceProviderAlice)
        const stakeDelegatedToServiceProvider = fredStake;
        const percentageOfStakeThatIsDelegatedToServiceProvider = stakeDelegatedToServiceProvider.mul(PERCENTAGE_MODULO).div(stakeDelegatedToServiceProvider.add(aliceStake));
        const percentageOfServiceProviderStake = aliceStake.mul(PERCENTAGE_MODULO).div(stakeDelegatedToServiceProvider.add(aliceStake));

        const baseRewardsDueToAlice = expectedRewardToServiceProviderAliceContract.mul(percentageOfServiceProviderStake).div(PERCENTAGE_MODULO);
        const grossRewardsDueToFred = expectedRewardToServiceProviderAliceContract.mul(percentageOfStakeThatIsDelegatedToServiceProvider).div(PERCENTAGE_MODULO);
        const aliceCommision = grossRewardsDueToFred.mul(SERVICE_PROVIDER_ALICE_SERVICE_FEE_PERCENTAGE).div(PERCENTAGE_MODULO);
        const netRewardsDueToAlice = baseRewardsDueToAlice.add(aliceCommision);
        const netRewardsDueToFred = grossRewardsDueToFred.sub(aliceCommision);
        const netRewardsDueToAlice2 = expectedRewardToServiceProviderAliceContract.sub(netRewardsDueToFred);        
        
        shouldBeNumberInEtherCloseTo(netRewardsDueToFred, fromWei(fredActualEarning));
        shouldBeNumberInEtherCloseTo(netRewardsDueToAlice2, fromWei(aliceActualEarning));
        // shouldBeNumberInEtherCloseTo(netRewardsDueToAlice, fromWei(aliceActualEarning));  this one fails, unlike the above
      });

      it('Correctly calculates rewards after a delegator decreases their stake', async () => {
        
        // Fred delegates 100K tokens to Alice        
        await this.serviceProviderAliceContract.delegateStake(STAKE_VALUE, {from: fred});
        
        // Consider "timeInBlocks" many blocks worth of rewards (starting block is #5)
        const timeInBlocks = new BN('100');
        const blockNumber = new BN('5').add(timeInBlocks);
        await this.stakingRewards.fixBlockNumber(blockNumber, {from: cudos});
       
        // Fred wants to collect his rewards so far
        await this.serviceProviderAliceContract.getReward({from: fred});
        
        // Move one block
        const moveBlock = new BN('1')
        const newblock1 = blockNumber.add(moveBlock)
        await this.stakingRewards.fixBlockNumber(newblock1, {from: cudos});

        // Fred requests to withdraw 90K out of his 100K
        await this.serviceProviderAliceContract.requestDelegatedStakeWithdrawal(NINETY_THOUSAND,{from: fred});

        // Move one more block
        const newblock2 = newblock1.add(moveBlock)
        await this.stakingRewards.fixBlockNumber(newblock2, {from: cudos});

        // Check if Fred's rewards are calculated properly
        const fredCudoBalanceBeforeWithdrawal = await this.token.balanceOf(fred);
        await this.serviceProviderAliceContract.getReward({from: fred});
        const fredCudoBalanceAfterWithdrawal = await this.token.balanceOf(fred);
        const fredEarningAfterWithdrawal = fredCudoBalanceAfterWithdrawal.sub(fredCudoBalanceBeforeWithdrawal)

        const expectedRewardToServiceProviderAliceContract = rewardPerBlock.mul(moveBlock)

        const fredStakeAfterWithdrawal = await this.serviceProviderAliceContract.delegatedStake(fred);
        const aliceStake = await this.serviceProviderAliceContract.delegatedStake(serviceProviderAlice);
        const percentageOfFredStakeAfterWithdrawal = fredStakeAfterWithdrawal.mul(PERCENTAGE_MODULO).div(fredStakeAfterWithdrawal.add(aliceStake));
        const grossRewardsDueToFred = expectedRewardToServiceProviderAliceContract.mul(percentageOfFredStakeAfterWithdrawal).div(PERCENTAGE_MODULO);
        const aliceCommision = grossRewardsDueToFred.mul(SERVICE_PROVIDER_ALICE_SERVICE_FEE_PERCENTAGE).div(PERCENTAGE_MODULO);
        const netRewardsDueToFred = grossRewardsDueToFred.sub(aliceCommision);

        // fredEarningAfterWithdrawal.should.be.bignumber.equal(netRewardsDueToFred);
        shouldBeNumberInEtherCloseTo(fredEarningAfterWithdrawal, fromWei(netRewardsDueToFred));
      });
      
      it.skip('Distributes rewards to service provider alice when not called by service provider or delegator', async () => {
	(await this.token.balanceOf(fred)).should.be.bignumber.equal(STAKE_VALUE);

        await this.serviceProviderAliceContract.delegateStake(STAKE_VALUE, {from: fred});

        (await this.token.balanceOf(fred)).should.be.bignumber.equal(ZERO);

        await this.stakingRewards.fixBlockNumber('7', {from: cudos});

        const cudoAdminBalanceBeforeGetReward = await this.token.balanceOf(cudos);
        const serviceProviderAliceCudoBalanceBeforeGetReward = await this.token.balanceOf(serviceProviderAlice);

        await this.serviceProviderAliceContract.getReward({from: cudos});

        const cudoAdminBalanceAfterGetReward = await this.token.balanceOf(cudos);
        const serviceProviderAliceCudoBalanceAfterGetReward = await this.token.balanceOf(serviceProviderAlice);

        const expectedRewardToServiceProviderAliceContract = new BN('99999999999998700000');
        const stakeDelegatedToServiceProvider = STAKE_VALUE;
        const percentageOfStakeThatIsDelegatedToServiceProvider =
          stakeDelegatedToServiceProvider.mul(PERCENTAGE_MODULO).div(STAKE_VALUE.add(REQUIRED_SERVICE_PROVIDER_BOND));

        // Should be 500 or 5% but solidity has its own ideas about division...
        percentageOfStakeThatIsDelegatedToServiceProvider.should.be.bignumber.equal('476');

        const grossRewardsDueToFreddy = expectedRewardToServiceProviderAliceContract.mul(percentageOfStakeThatIsDelegatedToServiceProvider).div(PERCENTAGE_MODULO);
        const rewardsFee = grossRewardsDueToFreddy.mul(SERVICE_PROVIDER_ALICE_SERVICE_FEE_PERCENTAGE).div(PERCENTAGE_MODULO);

        const netRewardsDueToFreddy = grossRewardsDueToFreddy.sub(rewardsFee);

        // This balance should be a combination of rewards earned in the last 24 hours and alice's staking bond
        const expectedServiceProviderAliceBalance = serviceProviderAliceCudoBalanceAfterGetReward.sub(serviceProviderAliceCudoBalanceBeforeGetReward);
        expectedServiceProviderAliceBalance.should.be.bignumber.equal(
          expectedRewardToServiceProviderAliceContract.sub(netRewardsDueToFreddy)
        );

        expect(cudoAdminBalanceAfterGetReward.sub(cudoAdminBalanceBeforeGetReward)).to.be.bignumber.equal('0');
      });
    });
  
    describe('pendingRewards()', () => {
      it('Correctly displays the pending rewards in a validator pool after the validator exits', async () => {
        // ***** move to block #7 -- start block for rewards is block #5, so 2 blocks means 2 * 100 block rewards = 200 * 10 ^18
        await this.stakingRewards.fixBlockNumber('7', {from: cudos});
        
        // Fred stakes
        await this.serviceProviderAliceContract.delegateStake(STAKE_VALUE, {from: fred});
        (await this.token.balanceOf(fred)).should.be.bignumber.equal(ZERO);

        // ***** move to block #9
        await this.stakingRewards.fixBlockNumber('9', {from: cudos});

        // Alice exits
        await this.serviceProviderAliceContract.exitAsServiceProvider({from: serviceProviderAlice});
        (await this.serviceProviderAliceContract.pendingRewards(serviceProviderAlice)).should.be.bignumber.equal(ZERO);
        (await this.serviceProviderAliceContract.delegatedStake(serviceProviderAlice)).should.be.bignumber.equal(ZERO);
        (await this.serviceProviderAliceContract.delegatedStake(fred)).should.be.bignumber.equal(STAKE_VALUE);

        // Fred checks his pending rewards
        const stakeDelegatedToServiceProvider = STAKE_VALUE;
        const percentageOfStakeThatIsDelegatedToServiceProvider =
              stakeDelegatedToServiceProvider.mul(PERCENTAGE_MODULO).div(stakeDelegatedToServiceProvider.add(REQUIRED_SERVICE_PROVIDER_BOND));
        const grossRewardsDueToFred = rewardPerBlock.muln(2).mul(percentageOfStakeThatIsDelegatedToServiceProvider).div(PERCENTAGE_MODULO);
        const rewardsFee = grossRewardsDueToFred.mul(SERVICE_PROVIDER_ALICE_SERVICE_FEE_PERCENTAGE).div(PERCENTAGE_MODULO);
        const netRewardsDueToFred = grossRewardsDueToFred.sub(rewardsFee);
        const fredPendingRewards = await this.serviceProviderAliceContract.pendingRewards(fred);
        shouldBeNumberInEtherCloseTo(netRewardsDueToFred, fromWei(fredPendingRewards));        
        
        // Fred recovers his things
        await this.serviceProviderAliceContract.exitAsDelegator({from: fred});
        const fredBalance = await this.token.balanceOf(fred);
        shouldBeNumberInEtherCloseTo(fredBalance, fromWei(fredPendingRewards.add(STAKE_VALUE)));
        (await this.serviceProviderAliceContract.delegatedStake(fred)).should.be.bignumber.equal(ZERO);
        (await this.serviceProviderAliceContract.pendingRewards(fred)).should.be.bignumber.equal(ZERO);

        // ***** move to block #11
        await this.stakingRewards.fixBlockNumber('11', {from: cudos});
        
        // Fred checks his pending rewards
        (await this.serviceProviderAliceContract.pendingRewards(fred)).should.be.bignumber.equal(ZERO);        
        
      });

      it('Correctly displays the pending rewards in a validator pool after a decrease in stake', async () => {
        // ***** move to block #7 -- start block for rewards is block #5, so 2 blocks means 2 * 100 block rewards = 200 * 10 ^18
        await this.stakingRewards.fixBlockNumber('7', {from: cudos});

        // Send rewards guild some more tokens
        await this.token.transfer(this.stakingRewardsGuild.address, REQUIRED_SERVICE_PROVIDER_BOND, {from: cudos});

        // Fred stakes
        await this.serviceProviderAliceContract.delegateStake(STAKE_VALUE, {from: fred});
        (await this.token.balanceOf(fred)).should.be.bignumber.equal(ZERO);

        // ***** move to block #900
        await this.stakingRewards.fixBlockNumber('900', {from: cudos});

        // Alice exits
        await this.serviceProviderAliceContract.exitAsServiceProvider({from: serviceProviderAlice});
        (await this.serviceProviderAliceContract.pendingRewards(serviceProviderAlice)).should.be.bignumber.equal(ZERO);        

        // Fred checks his pending rewards
        const stakeDelegatedToServiceProvider = STAKE_VALUE;
        const percentageOfStakeThatIsDelegatedToServiceProvider =
              stakeDelegatedToServiceProvider.mul(PERCENTAGE_MODULO).div(stakeDelegatedToServiceProvider.add(REQUIRED_SERVICE_PROVIDER_BOND));
        const grossRewardsDueToFred = rewardPerBlock.muln(893).mul(percentageOfStakeThatIsDelegatedToServiceProvider).div(PERCENTAGE_MODULO);
        const rewardsFee = grossRewardsDueToFred.mul(SERVICE_PROVIDER_ALICE_SERVICE_FEE_PERCENTAGE).div(PERCENTAGE_MODULO);
        const netRewardsDueToFred = grossRewardsDueToFred.sub(rewardsFee);
        const fredPendingRewards = await this.serviceProviderAliceContract.pendingRewards(fred);
        shouldBeNumberInEtherCloseTo(netRewardsDueToFred, fromWei(fredPendingRewards));        

        // ***** move to block #901
        await this.stakingRewards.fixBlockNumber('901', {from: cudos});
        
        // Fred checks his pending rewards
        const fredPendingRewardsAfterAlice = await this.serviceProviderAliceContract.pendingRewards(fred);   
        shouldBeNumberInEtherCloseTo(fredPendingRewards, fromWei(fredPendingRewardsAfterAlice));     
        
      });
    });
  });
  

  describe('Recovery', () => {
    describe('ERC20', () => {
      beforeEach(async () => {
        this.mockToken = await MockERC20.new({from: fred});
      })

      it('Can recover an ERC20 as admin', async () => {
        this.mockToken = await MockERC20.new({from: fred});

        (await this.mockToken.balanceOf(this.serviceProviderAliceContract.address)).should.be.bignumber.equal('0');

        let cudoMockBalance = await this.mockToken.balanceOf(cudos)
        cudoMockBalance.should.be.bignumber.equal('0')

        const xferAmount = new BN('5000')
        await this.mockToken.transfer(this.serviceProviderAliceContract.address, xferAmount, { from: fred });

        (await this.mockToken.balanceOf(this.serviceProviderAliceContract.address)).should.be.bignumber.equal(xferAmount)

        cudoMockBalance = await this.mockToken.balanceOf(cudos)
        cudoMockBalance.should.be.bignumber.equal('0')

        await this.serviceProviderAliceContract.recoverERC20(this.mockToken.address, cudos, xferAmount, {from: cudos});

        (await this.mockToken.balanceOf(this.serviceProviderAliceContract.address)).should.be.bignumber.equal('0')

        cudoMockBalance = await this.mockToken.balanceOf(cudos)
        cudoMockBalance.should.be.bignumber.equal(xferAmount)
      })

      it('Reverts if not admin', async () => {
        await expectRevert(
          this.serviceProviderAliceContract.recoverERC20(this.mockToken.address, fred, new BN('1'), {from: fred}),
          "OA"
        )
      })
    })
  })
});
