# Cudos Staking contract

### Cudos Staking Platform

* Users of our staking platform stake CUDOS tokens and earn staking rewards proportional to their stake size
* There are two types of users: validators and delegators
    * A validator is a pre-approved user who stakes tokens above a threshold
    * A delegator is any user who stakes any amount of tokens through a validator
    * A validator additionally receives a percentage of their delegators’ rewards as commission
    * We will refer to the group users consisting of a validator and their delegators as a validator pool

### Getting Tokens Ready to Stake

* In order to stake tokens – either as a validator (denoted by “service provider” in the contract, which we shall abbreviate as SP) or a delegator – each user first needs to get their tokens approved via the `increaseAllowance` function in the Cudos Token (CT) contract.
    * Users can choose the amount of tokens they want approved, which determines their allowance.
    * Everytime a user stakes some tokens, their allowance decreases by that amount.
    * If a user depletes their allowance and wants to stake more, then they need to increase their allowance again via the `increaseAllowance` function on the CT contract
    * Withdrawing previously staked tokens does not increase this allowance.

### Becoming a Validator

* To become a validator, a user first needs to get whitelisted via the `whitelistServiceProvider` function in the Staking Rewards (SR) contract by an admin.
* This creates a proxy contract (SPClone) such that every transaction related to this validator will need to be submitted to this contract.
* The user must gather at least 2,000,000 CUDOS in their whitelisted wallet in order to successfully complete the process and become a validator
    * The 2,000,000 CUDOS is the minimum required stake for a validator
    * An admin can change this minimum amount via the `updateMinRequiredStakingAmountForServiceProviders` function in the SR contract
    * This minimum must be less than the maximum amount a user can stake
        * This maximum amount is initially set to 1,000,000,000 CUDOS
        * An admin of the contract can change this maximum amount via the `updateMaxStakingAmountForServiceProviders` function in the SR contract
        * That maximum amount needs to be a number greater than the minimum amount
* Then the user must stake the 2,000,000 CUDOS by calling the `stakeServiceProviderBond` function in the SPClone contract and entering their choice of reward programme (RP) and fee
    * A RP determines a staker’s reward earning power based on their commitment.
        * Initially there is only one RP which is denoted by 0 (zero).
        * An admin of the contract can add more reward programmes via the `addRewardsProgramme` function in the SR contract
        * The reward earning power of a RP is denoted by `allocPoint` in the SR contract, which can be changed by an admin via the `updateAllocPointForRewardProgramme` function
    * The fee is the percentage of staking rewards that the validator is going to collect from its delegators as commission
        * That fee cannot be less than a minimum value given by a variable in the (SR) contract
        * That minimum value
            * is initially set to 2%,
            * always needs to be smaller than 100%,
            * can be changed by an admin by calling the `updateMinServiceProviderFee` function in the SR contract
        * A validator cannot change their fee once it is set
* Once the transaction approved, the minimum required amount is staked and the validator 
    * is fully set up
    * begins earning staking rewards
    * is ready to receive delegated stake

### Becoming a Delegator

* Anybody, including a validator, in possession of some CUDOS tokens can become a delegator by staking tokens through a validator
    * A user does not need to get whitelisted to become a delegator
    * A validator cannot delegate stake to themselves but to another validator
    * One user can delegate stake to more than one validator

### Staking Tokens

* If a validator wants to add excess validator stake on top of the 2,000,000 CUDOS, they need to do so via the `increaseServiceProviderStake` function in their SPClone contract.
* If a user wants to delegate stake to a validator, they need to call the `delegateStake` function in the validator’s SPClone contract.
* A user immediately begins earning staking rewards after successfully staking their tokens.

### Claiming Rewards

* In order to claim rewards, a user simply calls the `getReward` function in the SPClone contract of the validator pool they are in
* Users need to claim their rewards from each validator separately
* The amount of rewards per block is controlled by the admin function `updateTokenRewardPerBlock` in the SR contract.

### Withdrawing Staked Tokens

* In order to get back some or all of their staked tokens, a user first needs to remove the desired amount of stake
    * A validator can remove some of its validator stake via the `requestExcessServiceProviderStakeWithdrawal` function in the corresponding SPClone contract once the lock-up period expires
        * The remaining stake cannot be less than the minimum amount (2,000,000 CUDOS initially).
        * The lock-up period is the amount time only after which a user can withdraw their stake
            * It is denoted by the `minStakingLengthInBlocks` variable in the SR contract which
                * depends on the RP,
                * is set when an admin creates the RP.
            * It begins when a user stakes new tokens
            * Lock-up periods of a user’s stakes with different validators are independent of each other
            * When a user adds to their stake with a validator, the lock-up period restarts for all of their stake with that validator
    * A delegator can remove some or all of their stake via the `requestDelegatedStakeWithdrawal` function in the SPClone contract of a validator once the lock-up period expires.
        * A delegator must do this separately with each validator they have staked with
    * Users do not earn staking rewards on the removed stake
* After successfully removing their stake, users need to wait for an unbonding period to be able to withdraw those tokens
    * The unbonding period is the amount of time only after which a user can withdraw their tokens
    * It is hard-coded in the SR contract and is set to 21 days
    * It begins when a user removes part or all of their stake
    * Unbonding periods of a user’s tokens with different validators are independent of each other
    * When a user removes additional stake from a validator, the unbonding period restarts for all of the tokens that the user has not yet withdrawn from that validator
    * The one exception to the unbonding rule is that if a validator leaves the platform, its delegators can withdraw their tokens immediately. (See below for more details on a validator leaving the platform)
* Once the unbonding period ends, a user can withdraw their tokens by navigating to the corresponding SPClone contract and calling the
    * `withdrawServiceProviderStake` function for a validator,
    * `withdrawDelegatedStake` function for a delegator.

### Moving Stake Between Validators

* Users must first withdraw their tokens that are staked with a validator, and then stake them with the other one.

### A Validator Leaving the Platform

* A validator can leave the platform by calling the `exitAsServiceProvider` function on the corresponding SPClone contract once the lock-up period ends
    * All of the validator’s stake except the ones delegated to other validators are removed, and can be withdrawn after the unbonding period
    * Their delegators stop earning staking rewards
        * An event needs to be emitted so that it could be picked up to inform the delegators that they need to move their stake to another validator
        * The delegators are not subject to either the lock-up or the unbonding period, and can immediately withdraw their staked tokens together with any pending withdrawals via the `exitAsDelegator` function in the corresponding SPClone contract
* The user cannot become a validator again using the same wallet
* The user can, however, (continue to) delegate to other validators.

### Additional Admin Actions

* Once a user is whitelisted to become a validator, an admin can stake the minimum required validator stake on their behalf via the `adminStakeServiceProviderBond` function in the corresponding SPClone contract
    * Admin receives the saking rewards
    * The validator receives the commission from possible delegators
    * Only the admin can submit the transactions that a validator normally can
* An admin can freeze the contract by calling the `updateUserActionsPaused` function in the SR contract
* An admin can withdraw ERC20 tokens via the `recoverERC20` function in the SR contract

### View Requirements

* A user needs to able to read from the contract 
    * the amount of staking rewards per block
    * the minimum amount of stake required of validators
    * the maximum amount a user can stake
    * the minimum fee a validator can charge their delegators
    * the fee the each validator is charging their delegators
    * how much stake in total is being delegated to each validator currently
    * how much stake they currently have with each of their validators
    * whether their validator is fully set up and still active
    * their current pending rewards
    * when their lock-up period ends
    * the amount of pending withdrawals, and when the associated unbonding period ends
    * the commitment period and reward earning power of a RP
* In addition, an admin needs to be able to read from the contract
    * the SPClone contract address associated with each validator
    * the total amount of tokens staked on the platform

### Miscellaneous

* The contract can always assume that it has enough tokens to pay out the rewards
* The whole current state of the contract and all the people interacting with it can be read from the blockchain, so that we can snapshot the contract and migrate to layer 2 in the future

## Local Installation & Testing	

Requires [Yarn](https://yarnpkg.com/en/docs/install#mac-stable) or Npm, and [NodeJs](https://nodejs.org/en/) (version 10.x upwards) globally

1. Install dependencies.	

```bash	
yarn install	
```

or

```
npm install
```

2. Run tests. 	
```bash	
npx hardhat test
```