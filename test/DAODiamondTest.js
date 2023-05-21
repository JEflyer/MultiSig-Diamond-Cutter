const { expect } = require("chai");
const { ethers } = require("hardhat");
const { getSelectors, FacetCutAction } = require('../scripts/libraries/diamond.js')
const { deployDiamond } = require('../scripts/deploy.js')

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

describe("DAODiamond", function() {
    let DAODiamond;
    let daoDiamond;
    let owner;
    let signers;
    let other;

    beforeEach(async function() {
        [owner, ...signers] = await ethers.getSigners();
        other = signers.pop();

        DAODiamond = await ethers.getContractFactory("DAODiamond");
        daoDiamond = await DAODiamond.deploy([owner.address, signers[0].address, signers[1].address], 2, owner.address);
        await daoDiamond.deployed();
    });

    describe("Constructor", function() {
        it("Test successful deployment with a valid list of signers and vote threshold", async function() {
            const instance = await DAODiamond.deploy([owner.address, signers[0].address], 1, owner.address);
            expect(instance).to.be.ok;
        });

        it("Test deployment failure with an empty list of signers", async function() {
            await expect(DAODiamond.deploy([], 1, owner.address)).to.be.revertedWith("ERR:NL");
        });

        it("Test deployment failure with a zero vote threshold", async function() {
            await expect(DAODiamond.deploy([owner.address, signers[0].address], 0, owner.address)).to.be.revertedWith("InvalidVoteThreshold");
        });

        it("Test deployment failure with duplicate signers", async function() {
            await expect(DAODiamond.deploy([owner.address, owner.address], 1, owner.address)).to.be.revertedWith("DuplicateSigner");
        });

        it("Test deployment failure with a signer address equal to the zero address", async function() {
            await expect(DAODiamond.deploy([owner.address, ZERO_ADDRESS], 1, owner.address)).to.be.revertedWith("NullAddress");
        });
    });

    describe("proposeCut", function() {
        let proposalId;
        let cut;

        let diamondAddress
        let diamondCutFacet
        let diamondLoupeFacet
        let ownershipFacet

        let testFacet

        beforeEach(async function() {
            diamondAddress = await deployDiamond()
            diamondCutFacet = await ethers.getContractAt('DiamondCutFacet', diamondAddress)
            diamondLoupeFacet = await ethers.getContractAt('DiamondLoupeFacet', diamondAddress)
            ownershipFacet = await ethers.getContractAt('OwnershipFacet', diamondAddress)

            testFacet = await (await ethers.getContractFactory("Test1Facet", owner)).deploy()

            cut = []
                // function proposeCut(
                //     IDiamondCut.FacetCut[] calldata _diamondCut,
                //     address _init,
                //     bytes calldata _calldata
                //     ) external {
                // struct FacetCut {
                //     address facetAddress;
                //     FacetCutAction action;
                //     bytes4[] functionSelectors;
                // }

            cut.push({
                facetAddress: testFacet.address,
                action: FacetCutAction.Add,
                functionSelectors: getSelectors(testFacet)
            })

            console.log("I got here")
            proposalId = (await daoDiamond.connect(owner).proposeCut(cut, ZERO_ADDRESS, Buffer.alloc(0).toString('hex'))).value;
            console.log("Is here the problem")
        });

        it("Test that only the proposer can call this function", async function() {
            await expect(daoDiamond.connect(other).proposeCut(cut)).to.be.revertedWith("Not a signer");
        });

        it("Test successful proposal creation with valid input parameters", async function() {
            const proposal = await daoDiamond.getProposal(proposalId);
            expect(proposal).to.exist;
        });

        it("Test that the proposal is created with the correct values", async function() {
            const proposal = await daoDiamond.getProposal(proposalId);
            expect(proposal.target).to.equal(cut.target);
            expect(proposal.percentage).to.equal(cut.percentage);
        });

        it("Test that the proposer's vote is registered", async function() {
            const voteStatus = await daoDiamond.getVoteStatus(proposalId, owner.address);
            expect(voteStatus).to.be.true;
        });

        it("Test that the correct event is emitted", async function() {
            await expect(daoDiamond.connect(owner).proposeCut(cut))
                .to.emit(daoDiamond, "NewProposal")
                .withArgs(proposalId, cut.target, cut.percentage);
        });
    });


    describe("voteOnCut", function() {
        let proposalId;
        let cut;

        beforeEach(async function() {
            cut = {
                target: signers[2].address,
                percentage: 10
            };
            proposalId = (await daoDiamond.connect(owner).proposeCut(cut)).value;
        });

        it("Test that only signers can vote", async function() {
            await expect(daoDiamond.connect(other).voteOnCut(proposalId)).to.be.revertedWith("Not a signer");
        });

        it("Test successful voting on a proposal", async function() {
            await daoDiamond.connect(signers[1]).voteOnCut(proposalId);
            const voteStatus = await daoDiamond.getVoteStatus(proposalId, signers[1].address);
            expect(voteStatus).to.be.true;
        });

        it("Test voting failure on an invalid proposal ID", async function() {
            await expect(daoDiamond.connect(signers[1]).voteOnCut("invalidProposalId")).to.be.revertedWith("Invalid proposal ID");
        });

        it("Test voting failure on an expired proposal", async function() {
            const expirationTime = await daoDiamond.proposalExpiration();
            await network.provider.send("evm_increaseTime", [expirationTime.toNumber() + 1]);
            await expect(daoDiamond.connect(signers[1]).voteOnCut(proposalId)).to.be.revertedWith("Proposal expired");
        });

        it("Test voting failure when a signer tries to vote twice", async function() {
            await daoDiamond.connect(signers[1]).voteOnCut(proposalId);
            await expect(daoDiamond.connect(signers[1]).voteOnCut(proposalId)).to.be.revertedWith("Already voted");
        });

        it("Test that the correct event is emitted for each vote", async function() {
            await expect(daoDiamond.connect(signers[1]).voteOnCut(proposalId)).to.emit(daoDiamond, "VoteRegistered");
        });

        it("Test that the proposal is executed when the vote threshold is met", async function() {
            const voteThreshold = await daoDiamond.voteThreshold();
            for (let i = 0; i < voteThreshold - 1; i++) {
                await daoDiamond.connect(signers[i]).voteOnCut(proposalId);
            }
            await expect(daoDiamond.connect(signers[voteThreshold - 1]).voteOnCut(proposalId)).to.emit(daoDiamond, "ProposalExecuted");
        });

        it("Test that the proposal is marked as failed when expired and not executed", async function() {
            const expirationTime = await daoDiamond.proposalExpiration();
            await network.provider.send("evm_increaseTime", [expirationTime.toNumber() + 1]);
            await expect(daoDiamond.connect(signers[1]).voteOnCut(proposalId)).to.be.revertedWith("Proposal expired");
            const proposal = await daoDiamond.getProposal(proposalId);
            expect(proposal.status).to.equal("failed");
        });

        it("Test that the correct events are emitted for executed or failed proposals", async function() {
            const voteThreshold = await daoDiamond.voteThreshold();
            for (let i = 0; i < voteThreshold - 1; i++) {
                await daoDiamond.connect(signers[i]).voteOnCut(proposalId);
            }
            await expect(daoDiamond.connect(signers[voteThreshold - 1]).voteOnCut(proposalId)).to.emit(daoDiamond, "ProposalExecuted");

            const newCut = {
                target: signers[3].address,
                percentage: 15
            };
            const newProposalId = (await daoDiamond.connect(owner).proposeCut(newCut)).value;
            const expirationTime = await daoDiamond.proposalExpiration();
            await network.provider.send("evm_increaseTime", [expirationTime.toNumber() + 1]);

            await expect(daoDiamond.connect(signers[1]).voteOnCut(newProposalId)).to.be.revertedWith("Proposal expired");
            const newProposal = await daoDiamond.getProposal(newProposalId);
            expect(newProposal.status).to.equal("failed");
            await expect(daoDiamond.connect(owner).proposeCut(newCut)).to.emit(daoDiamond, "ProposalFailed");
        });




        describe("voteToRelinquishCutControl", function() {
            it("Test that only signers can vote to relinquish control", async function() {
                await expect(daoDiamond.connect(other).voteToRelinquishCutControl()).to.be.revertedWith("Not a signer");
            });

            it("Test successful voting to relinquish control", async function() {
                await daoDiamond.connect(signers[1]).voteToRelinquishCutControl();
                const voteStatus = await daoDiamond.getRelinquishVoteStatus(signers[1].address);
                expect(voteStatus).to.be.true;
            });

            it("Test voting failure when a signer tries to vote twice", async function() {
                await daoDiamond.connect(signers[1]).voteToRelinquishCutControl();
                await expect(daoDiamond.connect(signers[1]).voteToRelinquishCutControl()).to.be.revertedWith("Already voted");
            });

            it("Test that control is relinquished when the vote threshold is met", async function() {
                const voteThreshold = await daoDiamond.voteThreshold();
                for (let i = 0; i < voteThreshold - 1; i++) {
                    await daoDiamond.connect(signers[i]).voteToRelinquishCutControl();
                }
                await expect(daoDiamond.connect(signers[voteThreshold - 1]).voteToRelinquishCutControl()).to.emit(daoDiamond, "ControlRelinquished");
            });

            it("Test that the correct event is emitted when control is relinquished", async function() {
                const voteThreshold = await daoDiamond.voteThreshold();
                for (let i = 0; i < voteThreshold - 1; i++) {
                    await daoDiamond.connect(signers[i]).voteToRelinquishCutControl();
                }
                await expect(daoDiamond.connect(signers[voteThreshold - 1]).voteToRelinquishCutControl()).to.emit(daoDiamond, "ControlRelinquished");
            });
        });
    })
})