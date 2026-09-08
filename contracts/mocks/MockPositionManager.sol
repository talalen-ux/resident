// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

interface IERC721Receiver {
    function onERC721Received(address operator, address from, uint256 tokenId, bytes calldata data)
        external
        returns (bytes4);
}

/// @notice Test fixture standing in for a Uniswap v3 NonfungiblePositionManager:
///         mints a position NFT to the caller, which must accept it.
contract MockPositionManager {
    uint256 public nextId = 1;
    mapping(uint256 => address) public ownerOf;

    event Minted(address indexed to, uint256 indexed tokenId);

    function mint(address to) external returns (uint256 tokenId) {
        tokenId = nextId++;
        ownerOf[tokenId] = to;

        bytes4 received =
            IERC721Receiver(to).onERC721Received(msg.sender, address(this), tokenId, "");
        require(received == IERC721Receiver.onERC721Received.selector, "receiver rejected");

        emit Minted(to, tokenId);
    }
}
