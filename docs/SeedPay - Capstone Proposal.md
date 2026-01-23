# SeedPay - Capstone Proposal

## A. Final Proposal

### A-1. Overview

SeedPay is an open payment protocol that allows BitTorrent seeders to earn cryptocurrency (i.e. USDC) for sharing files, while leechers pay for faster downloads and guaranteed availability. By extending the BitTorrent Wire Protocol with payment channels on Solana, SeedPay solves free-rider problem that causes long-tail content to die when seeders lose interest. The protocol uses ECDH-based ephemeral session keys for privacy and unidirectional payment channels for streaming micropayments as low as $0.0001/MB. By extending existing protocol rather than requiring new clients, SeedPay can integrate with established P2P ecosystem - a key differentiator from failed predecessors like Upfire and Tribler that require specialized software.

### A-2 Value Proposition & PMF

SeedPay creates turns bandwidth contribution into revenue stream. The core value proposition is simple: **Seeders get paid for value they already provide, while leechers get guaranteed speed and availability they currently can't buy**.

The protocol demonstrates strong PMF by sitting at the intersection of 3 validated markets: BitTorrent (which still handles significant upstream traffic for large file distribution), stablecoins (USDC has proven product-market fit, with Visa settling payments on chain [1]), and Solana (where sub-cent transaction fees make streaming micropayments economically viable). Similar micropayment protocols like x402 [2] validate the model for HTTP. SeedPay brings this to BitTorrent.

_Critical Challenge - Bootstraping_:
Like all two sides marketplaces, SeedPay faces chicken-and-egg problem: seeders need paying leechers, leechers need seeders accepting payments. The initial go-to market strategy must solve for liquidity in single beachhead market before expanding. Failed prodecessors (BTT, Upfire) demonstrate technical feasibility alone is insufficient - distribution and initial liquidity are the primary risks.

#### Key Value Areas:

1. **Seeder Monetization**: transforms idle bandwidth into income. Users who already seed can now earn USDC, converting volunteer activity into a micro-business opportunity.
2. **Guaranteed Availability**: leechers can pay to ensure content stays alive, solving the "dead torrent" problem where 38% of the torrents become unavailable within first month.[3]
3. **Unlocks New Use Cases**: Beyond basic file sharing, the payment layer enables decentralized CDN, AI model distribution, scientific dataset sharing, and censorship-resistent publishing. I believe even more use cases could we explored and supported as we progress further in development.

### A-3 Target Markets

1. **AI/ML Engineers & Research Labs**:

- Models like Llama, Mistral, and Stable Diffusion are 10-100GB+. Researchers pay for faster downloads. Labs incentivize community seeding to reduce bandhwidth costs. High willingness to pay, growing crypto familiarity.
- Barrier: HuggingFace works good enough for most. Need to target underserved niches (fine tuned models, smaller labs, individual researchers)

2. **Crypto-Native Content Creators & DAOs**:

- Podcasters, video creators, and DAOs distributing large files who want censorship-resistant distribution without platform dependency. Already hold crypto and understand value prop immediately.
- Barrier: small average file sizes may reduce payment volume

3. **Blockchain Node Operators**:

- Chain snapshots (Solana: 50-100GB+, Ethereum archive: TBs) are essential for syncing nodes quickly. Currently distributed via ad-hoc discord links and unreliable mirrors. Node operators are crypto-native by definition and would pay for faster, reliable snapshot downloads.
- This is SeedPay's initial target market because it has lowest adoption barriers.

4. **Opern Source Software Distributors**:

- Linux distros (Ubuntu, Fedora), game engines (Godot), and dev tools already use BitTorrent. SeedPay lets them allocate budget to incentivize seeding during release spikes when volunteer seeders are insufficient.
- Barrier: Current volunteer model works adequately. Value prop is incremental improvement, not urgent pain. Low priority.

5. **Indie & Mid-size Game Studios**:

- Day-1 patches are 50-150GB. Unlike AAA studios with propeietary CDNs, smaller studios face brutal bandwidth costs at launch. Players who download early could earn by seeding to latecomers.
- Barrier: Not crypto native. Requires either ratio credi system or flat onramp integration to be viable.

6. **Scientific & Academic Data Publishers**:

- Genomics, climate data, astronomical surveys (100GB-10TB). Researchers with local copies earn by seeding. Institutions reduce hosting costs. Lower crypto adoption currently, but high value use case.
- Barrier: Lowest crypto adoption of all segments. Requires significant onboarding investment.

#### Emerginc Opportunities

- **Decentralized Data Archival**: pay-per-retrieval model as cheaper alternative to Filecoin/Arweave.
- **Pay-per-consume Streaming**: micropayments for content as its downloaded/watched.

### A-4 Competitor Landscape

1. **BitTorrent Token (BTT)**:

- It is widely considered a zombie product by community. Forums are full of users complaining with that they never receive payouts dispite seeding TBs of data. The integration with the TRON chain is clunky and centralized. The market wants this, but the current execution is untrustworthy.

2. **Upfire** [Found during Research]:

- A previous attempt at crypto-incentivized torrenting. Its effectively dead (token price ~$0, no GitHub activity since 2022). It failed because it required a custom client and didn't solve the chicken-and-egg problem of liquidity.

3. **Tribler** [Found during Research]:

- A privacy-focused academic project from Delft University. They have bandwidth token system, but it is research-grade, not commercial. Also it requires users running specialized clients with bandwidth overhead. It proves the tech works, but lack the go-to-market strategy.

4. **Filecoin**:

- Emphasis in retrieval from cold storage rather than real-time streaming or active swarming. Higher latency for initial bytes. More complex hardware requirements and operator incentives seen as barriers for on-demand enterprise use.

5. **Joystream/LBRY/Odysee**:

- Operate more as standalone platforms or ecosystems rather than light weight protocol-level middleware that can plug into existing BitTorrent flows.

#### Opportunities for SeedPay

- Solving real-time streaming payments
  - competitors often struggle with real-time, low latency micropayments aligned to streaming download progress. SeedPay's model of streaming micropayments over a payment channel could outperform existing approaches if latency and throughput are demonstrated.

- Integration with BitTorrent Semantics
  - Many alternatives operate at a higher abstraction (standalone platforms or storage networks) rather than integrating as a protocol extension to BitTorrent. SeedPay's approach can offer a more seamless developer experience for file-sharing workflows.

- Enterprise-ready monetization for Seeders
  - competitors lack robust incentives that reliably sustain seeding economics for long-tail or burst-only content. Seedpay's USDC-based payments could attract higher quality seeders and more predictable revenue streams for contributors.

- Diverse, High-value Target Markets
  - By targeting AI/ML model distribution, scientific datasets, blockcain node snapshots, and indie game patches, SeedPay can appeal to segments with substantial bandwidth needs and higher willingness to pay, leveraging Solana's low fees for micro-payments.

### A-5 Founder-Market Fit (FMF)

I am a self-taught blockchain developer with a unique background: 6 years designing robotic systems and 2 years in full stack development, now working in Solana infrastructure at BlockchainHQ.

I built Testship (https://www.testship.xyz/), an interactive testing framework for Anchor programs that auto parses IDL structures and generates UIs. Same developer tooling skills required for SeedPay's BitTorrent extension integration and SDK development. Through hackathon projects like x402test (https://github.com/blockchain-hq/x402test), I explored HTTP based micropayments protocol inspired by Coinbase's x402, gaining direct experience with streaming payment veritification and channel management that translates to SeedPay's unidirectional payment channel architecture.

My tech stack (Typescript, Rust, Anchor, ReactJs, NextJs, Solana) aligns perfectly with SeedPay's requirements. I am embedded in crypto-native communities through content creation, speaking engagements and open source contributions, giving me direct access to SeedPay's target users.

What drives me is infra problems where existing solutions fail. I have encountered deal torrent problem while using BitTorrent network because volunteer seeders lack ecoomic incentives.

My proven ability to ship developer tools (Testship's hot-reloading, PDA derivation, session sharing), payment protocol experience (x402test), systems engineering mindset (robotics), and deep solana ecosystem knowledge positions me to execute SeedPay from protocol specs through production implementation, and SDK development.

## References

1. Visa. "Visa Expands Stablecoin Settlement Capabilities."https://usa.visa.com/about-visa/newsroom/press-releases.releaseId.21951.html
2. Coinbase, "A payments protocol for the internet. Built on HTTP." https://github.com/coinbase/x402
3. Wikipedia. "BitTorrent." https://en.wikipedia.org/wiki/BitTorrent (citing Menasche et al. research)
4. Upfire, Medium Articles & Github https://medium.com/upfire, https://github.com/UpfireHQ/upfire
5. Tribler, "Privacy enhanced BitTorrent client with P2P content discovery" https://github.com/Tribler/tribler

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

**Synthesized Paragraph**: Please refere [Part A, Section 3](#a-3-target-markets)

### B-4 Competitor Landscape

**Prompt**:"Identify key competitors for a project with this value prop targeting these markets - AI/ML model and dataset distribution, Chain snapshot availabilty, software distribution, scientific data, crypto native creators and DAOs content distribution . What are potential weaknesses in their offerings?"

**Response**:

1. BitTorrent Token (BTT):

Overview: The incumbent solution. Integrated into BitTorrent Speed and BTFS (BitTorrent File System) on the TRON network.

Weaknesses: Highly centralized (controlled by TRON/Justin Sun), poor user reputation due to "broken" earning mechanics, high inflation tokenomics, and association with piracy rather than enterprise/data use cases.

2. Filecoin Saturn / IPFS:

Overview: A decentralized Content Delivery Network (CDN) built on Filecoin.

Weaknesses: Focuses on "retrieval" from cold storage rather than real-time "streaming" or swarm optimization. Higher latency for initial byte compared to optimistic BitTorrent swarms. Complex hardware requirements for node operators compared to running a simple torrent client.

3. Meson Network:

Overview: A bandwidth marketplace (DePIN) where users sell idle bandwidth for tokens.

Weaknesses: Focuses on general bandwidth scraping (proxies) rather than content-addressed file distribution. Lacks the "tit-for-tat" immediate gratification mechanism of the BitTorrent protocol.

4. Joystream / LBRY (Odysee):

Overview: Decentralized media platforms.

Weaknesses: These are "platforms" (YouTube alternatives) rather than "protocols." They try to replace the entire viewing experience, whereas SeedPay is a middleware layer that can integrate into existing workflows.

**Reflection**:
Many solution have been tried for different problems but SeedPay has unique advantage due to plugging into existing BitTorrent protocol and utilizing p2p swarm network.

**Synthesized Paragraph**: Please refer [Part A, Section 4](#a-4-competitor-landscape)

### B-5 Adversarial AI Critique

**Prompt**: "Based on these:
Value Proposition: SeedPay turns bandwidth contribution into revenue. Seeders get paid for value they already provide, while leechers get guaranteed speed and availability they currently can't buy.
Target Markets: AI/ML Engineers, Crypto-Native Creators/DAOs, Blockchain Node Operators, Open Source Software Distributors, Indie Game Studios, Scientific/Academic Data Publishers
Competitors: BTT (zombie product), Upfire (dead), Tribler (academic/research-grade), Filecoin (cold storage focus), Joystream/LBRY/Odysee (platforms not protocols). Why might this not be a true blue ocean? What types of competitors might have been overlooked?"

**Response**:
Why This May Not Be a True Blue Ocean

1. The "Dead Competitor" Fallacy
   Your competitor analysis is suspiciously optimistic. BTT, Upfire, and Tribler aren't proof of market opportunity—they're cautionary tales. The pattern of "tried and failed" suggests structural barriers you haven't addressed:

Why did BTT fail despite having 100M+ users in the BitTorrent ecosystem? If the incumbent with the largest distribution couldn't make this work, what's different about SeedPay?
Upfire and Tribler died from chicken-and-egg liquidity problems—the same problem will face SeedPay. How do you bootstrap a two-sided marketplace where seeders need leechers paying, and leechers need seeders accepting payments?

2. Overlooked Competitor Categories
   Your analysis missed several threat vectors:

Centralized CDNs (Cloudflare, AWS CloudFront, Fastly): For your target markets (AI models, game patches, software distribution), enterprises already have working solutions. They're expensive, but they work reliably today. SeedPay isn't competing against BTT—it's competing against "just pay AWS."
Emerging Decentralized CDNs: You mentioned Filecoin but missed Akash Network (decentralized compute with CDN capabilities), Flux (decentralized infrastructure), and Arweave (permanent storage with gateway CDN). These are actively funded, have ecosystems, and target the same "decentralized infrastructure" narrative.
Protocol-level alternatives: IPFS with Filecoin retrieval markets is attempting exactly what you describe—paid retrieval for content-addressed data. They have $300M+ in ecosystem funding. Storj offers S3-compatible decentralized storage with built-in retrieval payments.
Web3 streaming platforms: Livepeer (video transcoding/delivery) and Theta Network (video CDN with token incentives) have working payment layers for bandwidth. Their tech could extend to general file distribution.

3. Market Sizing Concerns
   Your target markets sound impressive but deserve scrutiny:

AI/ML model distribution: Hugging Face serves this market adequately today. Their paid tiers and partnerships with cloud providers may be "good enough." What's the switching cost for a researcher to adopt SeedPay vs. just paying for Hugging Face Pro?
Blockchain node snapshots: This is a niche market. How many people actually need chain snapshots frequently enough to justify integrating a payment protocol? Most node operators sync once and run indefinitely.
Open source distribution: Ubuntu, Fedora, etc. have survived 20+ years on volunteer seeding and mirror donations. If their current model works, why would they add payment complexity?

4. The Crypto Requirement is a Feature AND a Bug
   Your "crypto-native users" focus is double-edged:

Pro: Clear early adopter segment, lower friction for payment rails
Con: You've eliminated 95%+ of potential users. The indie game studio with a 50GB patch almost certainly doesn't want to deal with USDC, wallets, and Solana transactions. They'll pay AWS.

5. Technical Moat Questions
   Your protocol is an extension to BitTorrent, not a replacement. This means:

Anyone can implement the same BEP-10 extension approach
If SeedPay gains traction, larger players (even BitTorrent Inc.) could copy the approach
The ECDH privacy model is clever but not patentable—it's standard cryptography

6. Unit Economics Uncertainty
   At $0.0001/MB, downloading a 10GB AI model costs $1. Is that compelling enough for leechers to bother with crypto payments? Is it enough for seeders to stay online? The pricing model needs validation against actual user willingness-to-pay research.

**Reflection**:

- I think Tribler already proves that the tech works, their problem is specialized clients but if we extend the existing protocol and make it work with the existing clients, it could be adopted widely. Regarding chicken-and-egg problem its true, boostraping the market is a problem. Initially I thought of 2 ways of content access - USDC and ratio credits but it made protocol complex for initial draft and I deferred it to V2. But this could solve that problem. But its 100% true that we need to explore further ways to bootstrap the market.
- Its true that traditional CDNs are the go to ways for distribution currently and its difficult to change the workflow and make enterprises rely on them. But I think SeedPay could target smaller labs/indie game studies etc who are actively looking for cheaper alternatives (also enterprises and AAA studios could distribute parallely on BitTorrent network and run their own benchmarks for cost, speed etc) and as more proof of work is gathered for SeedPay across industry, adoption increases. I think it could follow the same journey as Blockchain technology.
- Regarding market sizing concerns, I think a lot of providers are currently burning through funds without profitability and that might not be sustainable. Having readily accessible P2P network for distribution is huge for individual developers or trainers of the models too. And for general critique of "if existing works, why would they add payment complexity" - we could make it as frictionless as possible. You could have self-custodial wallet generated inside the client which you could fund and then that handles the complete process. Would be brainstorming more ideas of making this simpler and frictionless.
- Ratio credits system could be a solution for allowing non-crypto users to participate but in favour of simpler initial protocol, we have deferred it to next iteration.
