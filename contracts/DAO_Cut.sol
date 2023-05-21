// SPDX-License-Identifier: MIT
pragma solidity 0.8.15;

import "./interfaces/IDiamondCut.sol";

contract DAODiamond {

    error NullAddress();
    error NotProposer();
    error NotSigner();
    error InvalidVoteThreshold();
    error DuplicateSigner();

    address private diamondAddress;

    address public proposer;
    address[] public signers;
    mapping(address => bool) private isSigner;
    mapping(uint256 => mapping(address => bool)) private hasVoted;
    mapping(address => bool) private hasVotedToRelinquish;
    uint256 private constant PROPOSAL_EXPIRATION = 7 days;

    uint256 public proposalCount;
    uint256 public voteThreshold;

    // struct ProposedVars {
    //     IDiamondCut.FacetCut[] _diamondCut;
    //     address _init;
    //     bytes _calldata;
    //     uint256 _votes;
    //     uint256 _expiration;
    // }

    struct ProposedVars {
        bytes[] _diamondCut;
        address _init;
        bytes _calldata;
        uint256 _votes;
        uint256 _expiration;
    }

    mapping(uint256 => ProposedVars) public proposals;

    event ProposalCreated(uint256 indexed proposalId);
    event Voted(uint256 indexed proposalId, address indexed voter, bool vote);
    event ProposalExecuted(uint256 indexed proposalId);
    event ProposalFailed(uint256 indexed proposalId);
    event CutControlRelinquished();

    constructor(address[] memory _signers, uint256 _voteThreshold, address diamond){
        if (_voteThreshold == 0) revert("InvalidVoteThreshold");
        proposer = msg.sender;
        voteThreshold = _voteThreshold;

        require(_signers.length > 0,"ERR:NL");//NL => Null Length

        for (uint256 i = 0; i < _signers.length; i++) {
            if (_signers[i] == address(0)) revert("NullAddress");
            if (isSigner[_signers[i]]) revert("DuplicateSigner");

            isSigner[_signers[i]] = true;
        }
        signers = _signers;

        diamondAddress = diamond;
    }

    modifier onlySigner() {
        if (!isSigner[msg.sender]) revert NotSigner();
        _;
    }

    // function proposeCut(
    //     IDiamondCut.FacetCut[] calldata _diamondCut,
    //     address _init,
    //     bytes calldata _calldata
    // ) external {

    //     //Only allow the proposer to propose new cuts
    //     if(msg.sender != proposer) revert NotProposer();
        
    //     // Increment proposal count
    //     proposalCount++;

    //     // Set proposed vars
    //     proposals[proposalCount] = ProposedVars({
    //         _diamondCut: new IDiamondCut.FacetCut[](_diamondCut.length),
    //         _init: _init,
    //         _calldata: _calldata,
    //         _votes: 1,
    //         _expiration: block.timestamp + PROPOSAL_EXPIRATION
    //     });

    //     for(uint256 i = 0 ; i < _diamondCut.length;){

    //         proposals[proposalCount]._diamondCut[i] = IDiamondCut.FacetCut(
    //             _diamondCut[i].facetAddress,
    //             _diamondCut[i].action,
    //             _diamondCut[i].functionSelectors
    //         );

    //         unchecked{
    //             i++;
    //         }
    //     }

    //     // Set the vote of the proposer
    //     hasVoted[proposalCount][msg.sender] = true;

    //     // Emit event
    //     emit ProposalCreated(proposalCount);
    // }

    function proposeCut(
    IDiamondCut.FacetCut[] calldata _diamondCut,
    address _init,
    bytes calldata _calldata
    ) external {

    // Only allow the proposer to propose new cuts
    if(msg.sender != proposer) revert NotProposer();

    // Increment proposal count
    proposalCount++;

    // Set proposed vars
    ProposedVars storage proposal = proposals[proposalCount];
    proposal._diamondCut = new bytes[](_diamondCut.length);
    proposal._init = _init;
    proposal._calldata = _calldata;
    proposal._votes = 1;
    proposal._expiration = block.timestamp + PROPOSAL_EXPIRATION;

    for (uint256 i = 0; i < _diamondCut.length; i++) {
        proposal._diamondCut[i] = abi.encode(_diamondCut[i]);
    }

    // Set the vote of the proposer
    hasVoted[proposalCount][msg.sender] = true;

    // Emit event
    emit ProposalCreated(proposalCount);
}

    function voteOnCut(uint256 proposalId, bool vote) external onlySigner {
        // Check if vote is underway and not expired
        require(proposalId <= proposalCount, "Invalid proposal ID");
        require(proposals[proposalId]._expiration > block.timestamp, "Proposal expired");
        require(!hasVoted[proposalId][msg.sender], "Already voted");

        // Count vote
        if (vote) {
            proposals[proposalId]._votes++;
        }

        // Register the vote
        hasVoted[proposalId][msg.sender] = true;

        // Action vote if vote threshold has been met
        if (proposals[proposalId]._votes >= voteThreshold) {
            IDiamondCut.FacetCut[] memory diamondCut = new IDiamondCut.FacetCut[](proposals[proposalId]._diamondCut.length);
            for (uint256 i = 0; i < diamondCut.length; i++) {
                diamondCut[i] = abi.decode(proposals[proposalId]._diamondCut[i], (IDiamondCut.FacetCut));
            }
            IDiamondCut(diamondAddress).diamondCut(
                diamondCut,
                proposals[proposalId]._init,
                proposals[proposalId]._calldata
            );

            // Emit event
            emit ProposalExecuted(proposalId);
        } else if (proposals[proposalId]._expiration <= block.timestamp) {
        // Emit event for failed proposal if it has expired
        emit ProposalFailed(proposalId);
    } else {
        // Emit event for vote
        emit Voted(proposalId, msg.sender, vote);
    }
}

function voteToRelinquishCutControl() external onlySigner {
    require(!hasVotedToRelinquish[msg.sender], "Already voted to relinquish");

    // Register vote
    hasVotedToRelinquish[msg.sender] = true;

    uint256 votesToRelinquish = 0;
    for (uint256 i = 0; i < signers.length; i++) {
        if (hasVotedToRelinquish[signers[i]]) {
            votesToRelinquish++;
        }
    }

    // Relinquish control if enough votes have been counted
    if (votesToRelinquish >= voteThreshold) {
        proposer = address(0);

        // Emit event
        emit CutControlRelinquished();
    }
}
}