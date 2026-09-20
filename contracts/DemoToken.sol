// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title DemoToken
/// @notice Minimal self-contained ERC-20 used as the settlement asset for the
///         flight delay insurance demo. Not a real currency, no external value.
/// @dev    Decimals are set to 0 on purpose: every amount in the PRD (10, 100,
///         8,000, 10,000) is a whole token, so keeping 0 decimals lets the
///         contracts, oracle and UI all use the same integers with no scaling.
contract DemoToken {
    string public constant name = "Flight Delay Demo Token";
    string public constant symbol = "FDT";
    uint8  public constant decimals = 0;

    uint256 public totalSupply;
    address public owner;

    uint256 public constant FAUCET_AMOUNT = 200;
    uint256 public constant FAUCET_COOLDOWN = 1 hours;
    mapping(address => uint256) public lastFaucetClaim;

    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);

    modifier onlyOwner() {
        require(msg.sender == owner, "DemoToken: not owner");
        _;
    }

    constructor(uint256 initialSupply) {
        owner = msg.sender;
        _mint(msg.sender, initialSupply);
    }

    function transfer(address to, uint256 value) external returns (bool) {
        _transfer(msg.sender, to, value);
        return true;
    }

    function approve(address spender, uint256 value) external returns (bool) {
        allowance[msg.sender][spender] = value;
        emit Approval(msg.sender, spender, value);
        return true;
    }

    function transferFrom(address from, address to, uint256 value) external returns (bool) {
        uint256 allowed = allowance[from][msg.sender];
        require(allowed >= value, "DemoToken: allowance too low");
        if (allowed != type(uint256).max) {
            allowance[from][msg.sender] = allowed - value;
        }
        _transfer(from, to, value);
        return true;
    }

    /// @notice Insurer mints more demo tokens (e.g. to seed the underwriting pool).
    function mint(address to, uint256 amount) external onlyOwner {
        _mint(to, amount);
    }

    /// @notice Anyone can self-serve a small amount of test tokens to try the demo,
    ///         rate-limited so a single account can't drain gas-free minting spam.
    function faucet() external {
        require(block.timestamp >= lastFaucetClaim[msg.sender] + FAUCET_COOLDOWN, "DemoToken: faucet cooldown");
        lastFaucetClaim[msg.sender] = block.timestamp;
        _mint(msg.sender, FAUCET_AMOUNT);
    }

    function _mint(address to, uint256 amount) internal {
        totalSupply += amount;
        balanceOf[to] += amount;
        emit Transfer(address(0), to, amount);
    }

    function _transfer(address from, address to, uint256 value) internal {
        require(to != address(0), "DemoToken: transfer to zero address");
        uint256 fromBal = balanceOf[from];
        require(fromBal >= value, "DemoToken: balance too low");
        unchecked {
            balanceOf[from] = fromBal - value;
        }
        balanceOf[to] += value;
        emit Transfer(from, to, value);
    }
}
