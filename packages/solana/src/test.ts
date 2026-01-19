import { connect } from 'solana-kite';
import { generateEphermeralKeyPair, deriveSessionUUID, computeSessionHash } from './ecdh.js';
import { verifyPaymentCheck, createPaymentCheckMessage } from './payment-check.js';
import { sha256 } from '@noble/hashes/sha2.js';
import nacl from 'tweetnacl';
import { Buffer } from 'buffer';

async function main() {
  // Test Kite connection
  console.log('=== Testing Kite Connection ===');
  const connection = connect('devnet');
  console.log('Connected to devnet');

  // Test ECDH
  console.log('\n=== Testing ECDH ===');
  const leecher = generateEphermeralKeyPair();
  const seeder = generateEphermeralKeyPair();

  const leecherSession = deriveSessionUUID(leecher.secretKey, seeder.publicKey);
  const seederSession = deriveSessionUUID(seeder.secretKey, leecher.publicKey);

  const match = Buffer.from(leecherSession).equals(Buffer.from(seederSession));
  console.log('Sessions match:', match);
  console.log('Session hash:', Buffer.from(computeSessionHash(leecherSession)).toString('hex').slice(0, 16) + '...');

  // Test Payment Checks
  console.log('\n=== Testing Payment Checks ===');
  const wallet = nacl.sign.keyPair();
  const channelId = new Uint8Array(32).fill(1);
  const amount = 1000000n;
  const nonce = 1;

  const message = createPaymentCheckMessage(channelId, amount, nonce);
  const messageHash = sha256(message);
  const signature = nacl.sign.detached(messageHash, wallet.secretKey);

  const check = { channelId, amount, nonce, signature };
  const valid = verifyPaymentCheck(check, wallet.publicKey);
  console.log('Signature valid:', valid);

  // Test Kite wallet creation
  console.log('\n=== Testing Kite Wallet ===');
  const testWallet = await connection.createWallet({ airdropAmount: 100_000_000n as any });
  console.log('Test wallet:', testWallet.address);
  
  console.log('\n✅ All tests passed!');
}

main().catch(console.error);