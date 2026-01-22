# SeedPay - Capstone Proposal

## A. Final Proposal

### A-1. Overview

SeedPay is an open payment protocol that allows BitTorrent seeders to earn cryptocurrency (i.e. USDC) for sharing files, while leechers pay for faster downloads and guaranteed availability. By extending the BitTorrent Wire Protocol with payment channels on Solana, SeedPay solves free-rider problem that causes long-tail content to die when seeders lose interest. The protocol uses ECDH-based ephemeral session keys for privacy and unidirectional payment channels for streaming micropayments as low as $0.0001/MB.

### A-2 Value Proposition & PMF

SeedPay creates turns bandwidth contribution into revenue stream. The core value proposition is simple: **Seeders get paid for value they already provide, while leechers get guaranteed speed and availability they currently can't buy**.

The protocol demonstrates strong PMF by sitting at the intersection of 3 validated markets: BitTorrent (which still handles significant upstream traffic for large file distribution), stablecoins (USDC has proven product-market fit, with Visa settling payments on chain [1]), and Solana (where sub-cent transaction fees make streaming micropayments economically viable). Similar micropayment protocols like x402 [2] validate the model for HTTP. SeedPay brings this to BitTorrent.

#### Key Value Areas:

1. **Seeder Monetization**: transforms idle bandwidth into income. Users who already seed can now earn USDC, converting volunteer activity into a micro-business opportunity.
2. **Guaranteed Availability**: leechers can pay to ensure content stays alive, solving the "dead torrent" problem where 38% of the torrents become unavailable within first month.[3]
3. **Unlocks New Use Cases**: Beyond basic file sharing, the payment layer enables decentralized CDN, AI model distribution, scientific dataset sharing, and censorship-resistent publishing. I believe even more use cases could we explored and supported as we progress further in development.

### A-3 Target Markets

1. **AI/ML Engineers & Research Labs**:

- Models like Llama, Mistral, and Stable Diffusion are 10-100GB+. Researchers pay for faster downloads. Labs incentivize community seeding to reduce bandhwidth costs. High willingness to pay, growing crypto familiarity.

2. **Crypto-Native Content Creators & DAOs**:

- Podcasters, video creators, and DAOs distributing large files who want censorship-resistant distribution without platform dependency. Already hold crypto and understand value prop immediately.

3. **Blockchain Node Operators**:

- Chain snapshots (Solana: 50-100GB+, Ethereum archive: TBs) are essential for syncing nodes quickly. Currently distributed via ad-hoc discord links and unreliable mirrors. Node operators are crypto-native by definition and would pay for faster, reliable snapshot downloads.

4. **Opern Source Software Distributors**:

- Linux distros (Ubuntu, Fedora), game engines (Godot), and dev tools already use BitTorrent. SeedPay lets them allocate budget to incentivize seeding during release spikes when volunteer seeders are insufficient.

5. **Indie & Mid-size Game Studios**:

- Day-1 patches are 50-150GB. Unlike AAA studios with propeietary CDNs, smaller studios face brutal bandwidth costs at launch. Players who download early could earn by seeding to latecomers.

6. **Scientific & Academic Data Publishers**:

- Genomics, climate data, astronomical surveys (100GB-10TB). Researchers with local copies earn by seeding. Institutions reduce hosting costs. Lower crypto adoption currently, but high value use case.

#### Emerginc Opportunities

- **Decentralized Data Archival**: pay-per-retrieval model as cheaper alternative to Filecoin/Arweave.
- **Pay-per-consume Streaming**: micropayments for content as its downloaded/watched.

## References

1. Visa. "Visa Expands Stablecoin Settlement Capabilities."https://usa.visa.com/about-visa/newsroom/press-releases.releaseId.21951.html
2. Coinbase, "A payments protocol for the internet. Built on HTTP." https://github.com/coinbase/x402
3. Wikipedia. "BitTorrent." https://en.wikipedia.org/wiki/BitTorrent (citing Menasche et al. research)

## B. Process Appendix

### 1. Overview

Seedpay is payments protocol for bittorrent p2p networks where seeders get paid crypto for seeding content. Leechers pay for downloading the content from the Seeders. It works alongside the existing bittorrent protocol usinng its extension protocol.

### B-2. Value Proposition & PMF

**Prompt**: "based on my idea: Seedpay is payments protocol for bittorrent p2p networks where seeders get paid crypto for seeding content. Leechers pay for downloading the content from the Seeders. It works alongside the existing bittorrent protocol usinng its extension protocol. help outline core value proposition and initial thoughts on product-market fit."

**Response**:

"
Core Value Proposition

SeedPay creates economic alignment in peer-to-peer file sharing by turning bandwidth contribution into a revenue stream. The core proposition is: seeders get paid for value they already provide, leechers get guaranteed speed and availability they currently can't buy.

Product-Market Fit Assessment

SeedPay sits at the intersection of three validated markets: BitTorrent (still handles ~25% of global internet traffic), stablecoins (USDC has proven product-market fit for payments), and Solana (sub-cent transaction fees make micropayments viable).
The timing is favorable because:

Crypto-native users already understand wallets and stablecoins
Solana's speed enables real-time payment streaming
No credible solution exists today (BTT failed, private trackers don't scale)
"

**Reflection**:
I agree. I think this solves multiple problems and Solana having fast and cheap transactions is a perfect fit for micro-payments. x402 is a very close example to that. Additionally, this unlocks even more use cases around content distribution and availability.

**Manual Research Note**:
I found that BitTorrent traffic has declines from ~35% in mid-2000s to ~1-3% in 2024-26 of global internet traffic. SeedPay should not target the declining piracy market. Instead focus on:

- Legit large-file distribution (AI models, datasets etc)
- Emerging decentralized infrastructure needs
- Use cases where economic incentives create new markets

**Synthesized Paragraph:** Please check [Part A - Value Proposition & PMF](#a-2-value-proposition--pmf)

### B-3 Target Markets

**Prompt**: "For this value proposition: SeedPay turns bandwidth contribution into a revenue stream. Seeders get paid for value they already provide, while leechers get guaranteed speed and availability they currently can't buy. Key value areas include seeder monetization, guaranteed availability, and unlocking new use cases like decentralized CDN, AI model distribution, and scientific dataset sharing. Suggest 2-5 key target demographics or market segments."

**Response**:
Key Target Market Segments

1. AI/ML Engineers & Research Labs
   Large language models and diffusion models (Llama, Mistral, Stable Diffusion) are 10-100GB+. Hugging Face and universities pay massive bandwidth costs to distribute these. Researchers downloading models would pay for faster speeds; labs distributing models could incentivize community seeding to reduce CDN costs.

Pain point: Slow downloads from centralized sources, high bandwidth costs for distributors
Willingness to pay: High - time is money for researchers, infrastructure costs are real for labs
Crypto-native: Increasingly yes - AI/crypto overlap is growing

2. Open Source Software Distributors
   Linux distributions (Ubuntu, Fedora, Arch), game engines (Godot), and development tools already use BitTorrent. They rely on volunteer seeders and mirror donations. SeedPay lets them allocate budget to incentivize seeding during release spikes.

Pain point: Mirror costs spike during releases, volunteer seeders disappear after initial interest
Willingness to pay: Moderate - they have infrastructure budgets but are cost-conscious
Crypto-native: Mixed - but technically sophisticated, can integrate

3. Game Studios & Platforms (Indie to Mid-size)
   Day-one patches are 50-150GB. AAA studios use proprietary CDNs, but indie/mid-size studios face brutal bandwidth costs at launch. Players who download early could earn by seeding to latecomers.

Pain point: Launch day bandwidth spikes, CDN costs eat into margins
Willingness to pay: High during launches - they already pay for CDN
Crypto-native: Growing - gaming and crypto have significant overlap

4. Scientific & Academic Data Publishers
   Genomics datasets (100GB-10TB), climate data, astronomical surveys, medical imaging. Universities and research institutions pay significant hosting costs. Researchers who already have datasets locally could earn by seeding.

Pain point: Expensive hosting, slow FTP servers, datasets becoming unavailable when grants end
Willingness to pay: Moderate to high - grant funding often includes data distribution budgets
Crypto-native: Low currently - but institutions are exploring blockchain for data provenance

5. Crypto-Native Content Creators & DAOs
   Podcasters, video creators, and DAOs distributing large files (video content, archives, datasets) who want censorship-resistant distribution without platform dependency. Already hold crypto, understand the value prop immediately.

Pain point: Platform risk, hosting costs, censorship concerns
Willingness to pay: High - they already pay for hosting and value decentralization
Crypto-native: By definition yes

**Reflection**:
I truely resonate with distribution and monetization of AI models, datasets and game patches. Indie game studios could use cheaper distribution networks. Also this could be used for cheaper data archival and pay for what you watch/cosume type of content via streaming too. This could be huge for chain snapshots as well. Node operators need to rely on adhoc shared snapshots for syncing currently.
