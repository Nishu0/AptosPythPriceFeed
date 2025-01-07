module qiro::btc_pegged_coin {
    use std::signer;
    use aptos_framework::coin::{Self, MintCapability, BurnCapability};
    use aptos_framework::account;
    use aptos_framework::string;

    use pyth::pyth;
    use pyth::price;
    use pyth::price_identifier;
    use pyth::i64;

    use aptos_std::math64::pow;

    
    /// Custom coin type
    struct BTCPeggedCoin {}
    
    /// Stores mint and burn capabilities for the coin
    struct CapabilityStore has key {
        mint_cap: MintCapability<BTCPeggedCoin>,
        burn_cap: BurnCapability<BTCPeggedCoin>
    }

    /// Error codes
    const ENOT_INITIALIZED: u64 = 1;
    const ENOT_ADMIN: u64 = 2;
    
    /// Initialize the BTCPeggedCoin
    public entry fun initialize(admin: &signer) {
        let admin_addr = signer::address_of(admin);
        
        // Initialize the coin with 8 decimals (same as BTC)
        let (burn_cap, freeze_cap, mint_cap) = coin::initialize<BTCPeggedCoin>(
            admin,
            string::utf8(b"BTCPeggedCoin"),
            string::utf8(b"BTCP"),
            8,
            true
        );
        
        // Store the capabilities
        move_to(admin, CapabilityStore {
            mint_cap,
            burn_cap
        });
        
        // Destroy the freeze capability as we won't use it
        coin::destroy_freeze_cap(freeze_cap);
    }

    public fun get_btc_usd_price(user: &signer, pyth_price_update: vector<vector<u8>>): price::Price {
        
        // First update the Pyth price feeds
        let coins = coin::withdraw(user, pyth::get_update_fee(&pyth_price_update));
        pyth::update_price_feeds(pyth_price_update, coins);
 
        // Read the current price from a price feed.
        // Each price feed (e.g., BTC/USD) is identified by a price feed ID.
        // The complete list of feed IDs is available at https://pyth.network/developers/price-feed-ids
        // Note: Aptos uses the Pyth price feed ID without the `0x` prefix.
        let btc_price_identifier = x"f9c0172ba10dfa4d19088d94f5bf61d3b54d5bd7483a322a982e1373ee8ea31b";
        let btc_usd_price_id = price_identifier::from_byte_vec(btc_price_identifier);
        pyth::get_price(btc_usd_price_id)
    }
    
    /// Mint coins based on BTC/USD price
    /// Amount parameter is in USD (e.g., if amount = 100, it will mint coins worth $100)
    public entry fun mint_coins(
        user: &signer,
        amount_usd: u64,
        pyth_price_update: vector<vector<u8>>
    ) acquires CapabilityStore {
        // Verify admin 
        let user_addr = signer::address_of(user);
        assert!(exists<CapabilityStore>(user_addr), ENOT_INITIALIZED);
        
        // Get current BTC/USD price from Pyth
        let btc_price = get_btc_usd_price(user, pyth_price_update);
        
        // Get price as a number (price * 10^expo)
        let price_positive = i64::get_magnitude_if_positive(&price::get_price(&btc_price));
        let expo_magnitude = i64::get_magnitude_if_negative(&price::get_expo(&btc_price)); // This will fail if the exponent is positive
        
        // Calculate amount of BTCPeggedCoin to mint
        // Formula: (USD amount * 10^8) / (BTC price in USD)
        let btc_amount = (amount_usd as u128) * 100000000 / ((price_positive as u128) * (pow(10, expo_magnitude) as u128));
        
        // Get mint capability
        let cap_store = borrow_global<CapabilityStore>(user_addr);
        
        // Register recipient for the coin if needed
        if (!coin::is_account_registered<BTCPeggedCoin>(user_addr)) {
            coin::register<BTCPeggedCoin>(user);
        };
        
        // Mint and deposit coins
        let coins = coin::mint(btc_amount as u64, &cap_store.mint_cap);
        coin::deposit(user_addr, coins);
    }
}