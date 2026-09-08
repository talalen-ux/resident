// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

interface IMintableERC20 {
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function mint(address to, uint256 amount) external;
}

/// @notice Test fixture standing in for a router. Pulls the input token via the
///         approval the vault granted and mints the output back to the caller,
///         which is enough to exercise the allowlist and approval paths.
contract MockVenue {
    event Swapped(address indexed caller, uint256 amountIn, uint256 amountOut);

    function swap(address tokenIn, address tokenOut, uint256 amountIn, uint256 amountOut)
        external
        returns (uint256)
    {
        IMintableERC20(tokenIn).transferFrom(msg.sender, address(this), amountIn);
        IMintableERC20(tokenOut).mint(msg.sender, amountOut);
        emit Swapped(msg.sender, amountIn, amountOut);
        return amountOut;
    }

    /// @notice Always reverts, for testing that a failed venue call bubbles up.
    function boom() external pure {
        revert("venue reverted");
    }
}
