# SeedPay - User Stories & On-Chain Requirements

**Capstone Project - Week 2 Assignment**

_Payment Protocol for BitTorrent Networks_  
_Seeders earn crypto for sharing files. Leechers pay for faster downloads._

---

# Part A: User Stories & On-Chain Requirements

## 1. Core User Personas

Based on the value proposition analysis from Week 1 and Berg's feedback to focus on core MVP functions, the following user personas have been prioritized for the Proof-of-Concept.

SeedPay is a **two-sided marketplace**:

- **Producers (Seeders)** - People offering bandwidth/files
- **Consumers (Leechers)** - People downloading files

### 1.1 Seeder (Producer)

**Definition:** A user who shares files on the BitTorrent network and wants to earn cryptocurrency (USDC) for their bandwidth contribution.

- **Motivation:** Convert idle bandwidth into income; currently seeds for free with no direct benefit
- **Technical Profile:** Crypto-native, familiar with wallets and Solana
- **Pain Point:** "I share terabytes of data but get nothing in return"
- **Example Segments:** AI model hosts, chain snapshot providers, open source maintainers

### 1.2 Leecher (Consumer)

**Definition:** A user who downloads files and is willing to pay for guaranteed speed and availability.

- **Motivation:** Faster downloads, access to rare/long-tail content that would otherwise have no seeders
- **Technical Profile:** Crypto-native, holds USDC, comfortable with basic wallet operations
- **Pain Point:** "This torrent has 0 seeders and I really need this file"
- **Example Segments:** AI/ML researchers, blockchain node operators, indie game studios

### 1.3 Prioritization Rationale

For the MVP/POC, we focus exclusively on **Seeder** and **Leecher** because:

1. They form the two-sided marketplace essential to proving the core value proposition
2. They are the only actors who interact with the payment system
3. Without both parties, the payment flow cannot be demonstrated

Other personas identified in Week 1 (AI/ML Engineers, Node Operators, etc.) are **market segments** within the Leecher/Seeder categories—they have the same behavior but different motivations and content types.

---

## 2. Function Maps

### 2.1 Seeder Functions

| Function        | Description                                    | Where It Happens                     |
| --------------- | ---------------------------------------------- | ------------------------------------ |
| Set Pricing     | Choose how much to charge per megabyte of data | In the BitTorrent client (off-chain) |
| Verify Payment  | Confirm the downloader has locked up funds     | Read from blockchain                 |
| Serve Data      | Send file pieces to the downloader             | BitTorrent network                   |
| Collect Payment | Claim the money earned after serving data      | Write to blockchain                  |

### 2.2 Leecher Functions

| Function           | Description                                          | Where It Happens               |
| ------------------ | ---------------------------------------------------- | ------------------------------ |
| Add Funds          | Make sure wallet has enough USDC                     | External wallet operation      |
| Lock Funds         | Put USDC into a holding account to start downloading | Write to blockchain            |
| Download Data      | Receive file pieces from the seeder                  | BitTorrent network             |
| Authorize Payments | Approve payment amounts as download progresses       | Signed locally, sent to seeder |
| Recover Funds      | Get back unused funds if something goes wrong        | Write to blockchain            |

---

## 3. User Stories

The following user stories describe what each user will do with SeedPay. Written from the user's perspective, avoiding technical jargon.

### 3.1 Seeder User Stories

| ID   | User Story                                                                                                        |
| ---- | ----------------------------------------------------------------------------------------------------------------- |
| S-01 | As a Seeder, I set my price so that downloaders know how much I charge before they start.                         |
| S-02 | As a Seeder, I verify that a downloader has locked up funds so I know I'll get paid before sending any data.      |
| S-03 | As a Seeder, I check payment authorizations as I send data so I only continue serving when payment is guaranteed. |
| S-04 | As a Seeder, I collect my earnings after the download completes so the funds transfer to my wallet.               |

### 3.2 Leecher User Stories

| ID   | User Story                                                                                                    |
| ---- | ------------------------------------------------------------------------------------------------------------- |
| L-01 | As a Leecher, I lock up funds to start a paid download session with a seeder.                                 |
| L-02 | As a Leecher, I authorize payments as I download so the seeder knows they'll get paid for each piece of data. |
| L-03 | As a Leecher, I recover my unused funds if the seeder disappears or stops sending data.                       |

### 3.3 Critical Path for MVP

The simplest complete flow to demonstrate value:

```
1. Leecher locks funds (L-01)
2. Seeder verifies funds are locked (S-02)
3. Seeder sends data, Leecher authorizes payments (S-03, L-02)
4. Seeder collects payment (S-04)
```

**Fallback path** (if something goes wrong):

```
1. Leecher locks funds (L-01)
2. Seeder disappears
3. Leecher recovers funds after timeout (L-03)
```

---

## 4. On-Chain Requirements

Now translating the user stories into technical requirements for the smart contract. This is where we get specific about what the blockchain program needs to do.

### 4.1 L-01: Lock Funds

**User Story:** _As a Leecher, I lock up funds to start a paid download session._

**On-Chain Requirements:**

- Create a new account to track the payment session (channel state)
- Store who is paying (Leecher's wallet address)
- Store who will receive payment (Seeder's wallet address)
- Create a holding account for the locked USDC
- Transfer USDC from Leecher's wallet to the holding account
- Record how much was deposited
- Record when the session started
- Calculate and store when the Leecher can recover funds (timeout)
- Mark the session as "active"

### 4.2 S-02: Verify Funds Locked

**User Story:** _As a Seeder, I verify that a downloader has locked up funds._

**On-Chain Requirements:**

- Session account must be readable from the blockchain
- Must expose: who locked funds, who will receive them, amount locked, timeout, status
- Holding account balance must be verifiable
- Session account address must be predictable so Seeder can look it up

### 4.3 S-03 & L-02: Authorize Payments (Off-Chain)

**User Story:** _Leecher authorizes payments as download progresses; Seeder checks authorizations._

**Off-Chain Requirements (no blockchain writes during download):**

- Leecher signs payment authorizations locally
- Each authorization includes: session ID, cumulative amount, sequence number
- Seeder verifies the signature matches the Leecher's wallet
- Sequence numbers must increase (prevents replay)
- Amounts must increase (can't reduce what's owed)
- Amount can't exceed what was locked

**Note:** This happens entirely between the two parties during download. Only the final authorization goes on-chain.

### 4.4 S-04: Collect Payment

**User Story:** _As a Seeder, I collect my earnings after the download completes._

**On-Chain Requirements:**

- Accept the final payment authorization (amount, sequence number, signature)
- Verify the signature was created by the Leecher's wallet
- Verify sequence number is valid (prevents using old authorizations)
- Verify amount doesn't exceed locked amount
- Verify session is still active
- Transfer the authorized amount from holding account to Seeder's wallet
- Return any remaining funds to Leecher's wallet
- Mark session as "completed"
- Close the holding account

### 4.5 L-03: Recover Funds

**User Story:** _As a Leecher, I recover my unused funds if the seeder disappears._

**On-Chain Requirements:**

- Accept only the session ID
- Verify enough time has passed (current time > timeout)
- Verify the caller is the original Leecher
- Verify session is still active
- Transfer entire holding account balance back to Leecher
- Mark session as "timed out"
- Close the holding account

---

## 5. Smart Contract Summary

Based on the on-chain requirements, here's what the SeedPay program needs:

### 5.1 Session State (Data Stored On-Chain)

| Field           | What It Stores                                        |
| --------------- | ----------------------------------------------------- |
| `leecher`       | Wallet address of the person paying                   |
| `seeder`        | Wallet address of the person receiving payment        |
| `escrow`        | Address of the holding account with locked USDC       |
| `deposited`     | How much USDC was locked                              |
| `created_at`    | When the session started                              |
| `timeout`       | When the Leecher can recover funds                    |
| `last_sequence` | Highest sequence number from submitted authorizations |
| `status`        | Active, Completed, or TimedOut                        |

### 5.2 Program Instructions

| Instruction     | Who Calls It | What It Does                             |
| --------------- | ------------ | ---------------------------------------- |
| `open_channel`  | Leecher      | Lock funds to start a session            |
| `close_channel` | Seeder       | Collect payment with final authorization |
| `timeout_close` | Leecher      | Recover funds after timeout              |

### 5.3 Key Design Decisions

1. **Predictable Addresses:** Session accounts can be found without searching, using a formula based on Leecher + Seeder addresses.

2. **Signature Verification:** Payment authorizations are verified on-chain when Seeder collects payment.

3. **Standard Tokens:** Uses standard Solana token accounts, compatible with USDC.

4. **Simple Timeout:** Stored as a specific time (not a duration), making verification straightforward.

---

# Part B: Process Appendix

## A. Initial User & Function Mapping Process

### A-1. Manual User Brainstorming

**Initial brainstormed list of all potential user types:**

**Direct Users (Producers):**

- Seeder (content sharer who wants to earn)
- AI model host (shares ML models)
- Chain snapshot provider (shares blockchain data)
- Open source maintainer (distributes releases)

**Direct Users (Consumers):**

- Leecher (downloader willing to pay for speed)
- AI/ML Researcher (downloads large models)
- Blockchain Node Operator (needs chain snapshots)
- Indie Game Developer (distributes/downloads game files)

**Indirect Users/Beneficiaries:**

- Content Consumer (benefits from content availability)
- DAO Treasury (benefits from reduced hosting costs)

**Administrators/Developers:**

- BitTorrent Client Developer (integrates SeedPay extension)

### A-2. AI-Assisted User Prioritization

**Prompt:**

> "My project's value proposition is: SeedPay turns bandwidth contribution into revenue. Seeders get paid for value they already provide, while leechers get guaranteed speed and availability they currently can't buy. Here is a brainstormed list of all potential user types: [full list above]. Based on the value proposition, which 2-5 of these user types are the most critical to focus on for an initial Proof-of-Concept?"

**AI Response Summary:**

The AI recommended focusing on the two sides of the marketplace:

1. **Seeder** - The producer side, essential for proving the "earn" value
2. **Leecher** - The consumer side, essential for proving the "pay-for-speed" value

The AI noted that the various segments (AI researcher, node operator, etc.) are just different types of Leechers/Seeders with the same on-chain behavior.

**Decision & Rationale:**

Agreed with AI's recommendation. Following the lecture's guidance on two-sided marketplaces, I focused on writing separate user stories for each side:

- Seeder = Producer (offers bandwidth)
- Leecher = Consumer (pays for downloads)

### A-3. Core Function Mapping

**Prompt:**

> "For a payment channel protocol in BitTorrent, what functions would a Seeder need vs a Leecher?"

**AI Response Summary:**

The AI mapped functions into three categories:

1. **Off-chain only:** Pricing configuration, BitTorrent handshake, data transfer
2. **On-chain writes:** Lock funds, collect payment, recover funds
3. **On-chain reads:** Verify funds locked

This helped identify what actually needs to be in the smart contract vs what happens in the BitTorrent client.

### A-4. Deriving Core POC Requirements

Following the **"Make it work, then make it better"** philosophy from the lecture:

**Lowest hanging fruit identified:**

1. Lock funds → Verify → Collect payment (happy path)
2. Lock funds → Timeout → Recover (fallback path)

These two paths prove the core value proposition with minimal complexity.

---

## B. Adversarial Analysis & Granularity Check

### B-1. AI Critique of User Stories

**Prompt:**

> "Review my user stories. Are they written from the user's perspective? Do they avoid technical jargon? Could a non-technical person understand them?"

**AI Critique Summary:**

1. **Too technical:** Original stories mentioned "escrow accounts", "Ed25519 signatures", "nonces"
2. **Passive voice:** Some stories used "the channel will be opened" instead of "I open"
3. **Missing the "why":** Some stories didn't explain why the user cares

**Refinements Made:**

Following lecture guidance ("Use active voice", "Don't get technical", "Speak like you're talking to general public"):

| Before (Technical)                                                            | After (User-Friendly)                                |
| ----------------------------------------------------------------------------- | ---------------------------------------------------- |
| "I want to open a payment channel by depositing USDC into an escrow account"  | "I lock up funds to start a paid download session"   |
| "I want to validate payment check signatures and nonces"                      | "I check payment authorizations as I send data"      |
| "I want to force-close a channel after the timeout period"                    | "I recover my unused funds if the seeder disappears" |
| "I want to close the payment channel by submitting the highest payment check" | "I collect my earnings after the download completes" |

---

## C. Granularity & Clarity Refinement Log

| Original                                 | Revised                                                  | Rationale                              |
| ---------------------------------------- | -------------------------------------------------------- | -------------------------------------- |
| "User opens channel and deposits funds"  | "I lock up funds to start a paid download session"       | Active voice, removed jargon "channel" |
| "Seeder verifies payment and sends data" | Split into S-02 (verify) and S-03 (check authorizations) | One action per story                   |
| "escrow account"                         | "holding account"                                        | Less jargon                            |
| "payment check"                          | "payment authorization"                                  | Clearer meaning                        |
| "nonce"                                  | "sequence number"                                        | Non-technical term                     |
| "force-close"                            | "recover funds"                                          | Describes outcome, not mechanism       |

---

## D. On-Chain Requirements Derivation

For each user story, I asked:

- What state needs to exist on-chain?
- What needs to be verified?
- What transfers occur?
- Who can call this?

**Key insight from lecture:** "It should do exactly what you want it to do and cannot possibly do anything else."

This drove the security-focused requirements like:

- Verify caller is the original Leecher before allowing timeout recovery
- Verify sequence numbers to prevent replay attacks
- Verify amounts don't exceed deposits

---

## E. Alignment with Instructor Feedback

**Berg noted:**

> "Focus on some of the core functions first for the MVP for the demo day. This project can grow exponentially, and you can't possibly implement and test everything in 4 weeks."

**How this assignment addresses the feedback:**

1. Focused on **3 instructions only**: `open_channel`, `close_channel`, `timeout_close`
2. Identified the **lowest hanging fruit** (happy path + fallback path)
3. Deferred complex features (ratio credits, reputation) to post-MVP
4. Kept on-chain scope minimal—most logic is off-chain

**Instructor also noted:**

> "You should also make a good architecture diagram."

This will be addressed in Week 3 assignment.

---

## F. What's Deferred to Post-MVP

Following "Make it work, then make it better":

| Feature             | Why Deferred                                                 |
| ------------------- | ------------------------------------------------------------ |
| Ratio Credits       | Adds complexity; direct USDC payments prove the concept      |
| Reputation System   | Requires historical data; not needed for basic demo          |
| Multi-chain Support | Solana-only for MVP; can extend later                        |
| Dispute Resolution  | MVP assumes honest actors; timeout provides basic protection |
| Partial Top-ups     | Leecher can open new session if funds run out                |

---

## G. How User Stories Drive Next Steps

As the lecture noted: `User Stories → Architectural Diagram → Project/Code`

These user stories will become:

1. **Architectural diagram content** (Week 3) - showing the flow between users and blockchain
2. **Test cases** - each story becomes a test: "Can Seeder collect payment after serving data?"
3. **Pitch deck content** - explaining what users do in simple terms
4. **V1 vs V2 prioritization** - MVP stories first, deferred features later
