# VERSIONS - User Flow Guide

## 🎫 How to Unlock Premium Versions

### Step 1: Browse Versions
- Visit http://localhost:3003 (or production URL)
- See all available song versions
- Premium versions show 🎫 "Ticket Required" badge
- Free versions show 🆓 "Free Version" badge

### Step 2: Identify Locked Content
- Look for the golden border on premium cards
- Check the artist coin ticker (e.g., $ARTIST)
- See the coin address displayed

### Step 3: Get the Artist Coin

**Option A: Copy Address & Buy Manually**
1. Click the 📋 copy button next to the coin address
2. Address is copied to clipboard (you'll see a ✓ confirmation)
3. Go to your preferred DEX (Jupiter, Raydium, etc.)
4. Paste the address and swap SOL for the artist coin

**Option B: Direct Buy on Jupiter (Recommended)**
1. Click the "🛒 Buy on Jupiter" button
2. Opens Jupiter DEX with the coin pre-selected
3. Connect your wallet if not already connected
4. Swap SOL for the artist coin
5. Confirm the transaction

### Step 4: Connect Wallet
1. Return to VERSIONS
2. Click "Connect Wallet" button
3. Approve connection in Phantom (or your Solana wallet)
4. VERSIONS automatically verifies your coin holdings

### Step 5: Enjoy Unlocked Content
- Premium versions you own automatically unlock
- Click "▶ Play" to stream
- Build your collection of rare versions!

---

## 🔄 User Journey Example

```
1. User sees "Bohemian Rhapsody - Demo Version" (Premium)
   ↓
2. Card shows: "🎫 Ticket Required: $QUEEN"
   ↓
3. User clicks "🛒 Buy on Jupiter"
   ↓
4. Jupiter opens: SOL → $QUEEN swap ready
   ↓
5. User swaps 0.1 SOL for 100 $QUEEN tokens
   ↓
6. User returns to VERSIONS, clicks "Connect Wallet"
   ↓
7. VERSIONS verifies: ✅ User owns $QUEEN
   ↓
8. Demo version unlocks automatically
   ↓
9. User clicks "▶ Play" and enjoys exclusive content
```

---

## 💡 Pro Tips

**For Collectors:**
- Own multiple artist coins to unlock entire catalogs
- Premium versions are like rare vinyl - limited access
- Your wallet = your collection (portable across devices)

**For Artists:**
- Release exclusive versions to coin holders
- Create scarcity with limited edition versions
- Build direct relationships with fans through token ownership

**For Developers:**
- All ownership verification happens on-chain
- No centralized database needed
- Real-time verification via Solana RPC

---

## 🛠️ Technical Details

**Coin Address Format:**
- Solana SPL Token mint address (base58 encoded)
- Example: `HjDJQui7SLj64QtBn4fyCzf5HfTSX6JtWe7BUmwxMP3`
- 32-44 characters long

**Jupiter Integration:**
- Direct deep link: `https://jup.ag/swap/SOL-{COIN_ADDRESS}`
- Pre-fills the swap interface
- User just needs to set amount and confirm

**Ownership Verification:**
- Uses `getTokenAccountsByOwner` RPC method
- Checks for token account with balance > 0
- Instant verification (no waiting)

---

## 🎯 Key Features

✅ One-click copy of coin addresses  
✅ Direct buy links to Jupiter DEX  
✅ Real-time ownership verification  
✅ Automatic unlock when coins are acquired  
✅ Toast notifications for user feedback  
✅ Hover tooltips showing full addresses  

---

## 🚀 Future Enhancements

- [ ] Show current coin price from Jupiter API
- [ ] Display user's coin balance for each artist
- [ ] "Buy exact amount needed" button
- [ ] Multi-coin bundle purchases
- [ ] Wishlist for locked versions
- [ ] Notifications when owned artists release new versions
- [ ] Secondary market for version NFTs
- [ ] Fractional ownership for expensive coins

---

Built for Solana Graveyard Hackathon 🎵✨
