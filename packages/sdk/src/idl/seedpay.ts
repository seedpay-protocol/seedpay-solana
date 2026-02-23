/**
 * Program IDL in camelCase format in order to be used in JS/TS.
 *
 * Note that this is only a type helper and is not the actual IDL. The original
 * IDL can be found at `target/idl/seedpay.json`.
 */
export type Seedpay = {
  "address": "7DwPMoGzTjRUroE47VPEEJn4FBSypAA5dbeMn3ocVdsS",
  "metadata": {
    "name": "seedpay",
    "version": "0.1.0",
    "spec": "0.1.0",
    "description": "Created with Anchor"
  },
  "instructions": [
    {
      "name": "closeChannel",
      "discriminator": [
        0,
        104,
        36,
        1,
        66,
        0,
        103,
        157
      ],
      "accounts": [
        {
          "name": "seeder",
          "docs": [
            "seeder claiming payment - must match channel_state.seeder."
          ],
          "writable": true,
          "signer": true,
          "relations": [
            "channelState"
          ]
        },
        {
          "name": "leecher",
          "docs": [
            "leecher's wallet — receives escrow rent and channel state rent."
          ],
          "writable": true,
          "relations": [
            "channelState"
          ]
        },
        {
          "name": "channelState",
          "docs": [
            "channel state PDA — closed after settlement (rent returned to leecher)."
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  104,
                  97,
                  110,
                  110,
                  101,
                  108
                ]
              },
              {
                "kind": "account",
                "path": "channel_state.leecher",
                "account": "channelState"
              },
              {
                "kind": "account",
                "path": "channel_state.seeder",
                "account": "channelState"
              },
              {
                "kind": "account",
                "path": "channel_state.channel_id",
                "account": "channelState"
              }
            ]
          }
        },
        {
          "name": "escrow",
          "docs": [
            "escrow token account holding the deposited USDC."
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  101,
                  115,
                  99,
                  114,
                  111,
                  119
                ]
              },
              {
                "kind": "account",
                "path": "channelState"
              }
            ]
          }
        },
        {
          "name": "seederTokenAccount",
          "docs": [
            "seeder's USDC token account — receives earned amount."
          ],
          "writable": true
        },
        {
          "name": "leecherTokenAccount",
          "docs": [
            "leecher's USDC token account — receives refund of unspent deposit."
          ],
          "writable": true
        },
        {
          "name": "authority",
          "docs": [
            "global authority PDA — signs escrow transfers."
          ],
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  105,
                  116,
                  121
                ]
              }
            ]
          }
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        },
        {
          "name": "instructionsSysvar",
          "docs": [
            "instructions sysvar — used to introspect the Ed25519 SigVerify instruction."
          ],
          "address": "Sysvar1nstructions1111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "amount",
          "type": "u64"
        },
        {
          "name": "nonce",
          "type": "u64"
        }
      ]
    },
    {
      "name": "openChannel",
      "discriminator": [
        91,
        45,
        253,
        71,
        140,
        166,
        107,
        109
      ],
      "accounts": [
        {
          "name": "leecher",
          "writable": true,
          "signer": true
        },
        {
          "name": "seeder"
        },
        {
          "name": "channelState",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  104,
                  97,
                  110,
                  110,
                  101,
                  108
                ]
              },
              {
                "kind": "account",
                "path": "leecher"
              },
              {
                "kind": "account",
                "path": "seeder"
              },
              {
                "kind": "arg",
                "path": "channelId"
              }
            ]
          }
        },
        {
          "name": "escrow",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  101,
                  115,
                  99,
                  114,
                  111,
                  119
                ]
              },
              {
                "kind": "account",
                "path": "channelState"
              }
            ]
          }
        },
        {
          "name": "leecherTokenAccount",
          "writable": true
        },
        {
          "name": "mint"
        },
        {
          "name": "authority",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  105,
                  116,
                  121
                ]
              }
            ]
          }
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "channelId",
          "type": {
            "array": [
              "u8",
              32
            ]
          }
        },
        {
          "name": "amount",
          "type": "u64"
        },
        {
          "name": "timeoutSeconds",
          "type": "i64"
        }
      ]
    },
    {
      "name": "timeoutClose",
      "discriminator": [
        206,
        89,
        219,
        11,
        58,
        60,
        95,
        62
      ],
      "accounts": [
        {
          "name": "leecher",
          "docs": [
            "leecher requesting the refund - must be the original depositor"
          ],
          "writable": true,
          "signer": true,
          "relations": [
            "channelState"
          ]
        },
        {
          "name": "channelState",
          "docs": [
            "channel state - will be closed (rent returned to leecher)"
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  104,
                  97,
                  110,
                  110,
                  101,
                  108
                ]
              },
              {
                "kind": "account",
                "path": "channel_state.leecher",
                "account": "channelState"
              },
              {
                "kind": "account",
                "path": "channel_state.seeder",
                "account": "channelState"
              },
              {
                "kind": "account",
                "path": "channel_state.channel_id",
                "account": "channelState"
              }
            ]
          }
        },
        {
          "name": "escrow",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  101,
                  115,
                  99,
                  114,
                  111,
                  119
                ]
              },
              {
                "kind": "account",
                "path": "channelState"
              }
            ]
          }
        },
        {
          "name": "leecherTokenAccount",
          "docs": [
            "leecher's USDC account - where refund goes"
          ],
          "writable": true
        },
        {
          "name": "authority",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  105,
                  116,
                  121
                ]
              }
            ]
          }
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": []
    }
  ],
  "accounts": [
    {
      "name": "channelState",
      "discriminator": [
        74,
        132,
        141,
        196,
        64,
        52,
        83,
        136
      ]
    }
  ],
  "errors": [
    {
      "code": 6000,
      "name": "zeroDeposit",
      "msg": "Deposite amount must be greater than zero"
    },
    {
      "code": 6001,
      "name": "timeoutTooShort",
      "msg": "Timeout duration too short (minimum 3600 seconds)"
    },
    {
      "code": 6002,
      "name": "timeoutTooLong",
      "msg": "Timeout duration too long (maximum 604800 seconds"
    },
    {
      "code": 6003,
      "name": "unauthorizedLeecher",
      "msg": "Unauthorized: caller is not the channel leecher"
    },
    {
      "code": 6004,
      "name": "channelNotOpen",
      "msg": "Channel is not in Open status"
    },
    {
      "code": 6005,
      "name": "timeoutNotReached",
      "msg": "Timeout has not passed"
    },
    {
      "code": 6006,
      "name": "unauthorizedSeeder",
      "msg": "Unauthorized: caller is not the channel seeder"
    },
    {
      "code": 6007,
      "name": "amountExceedsDeposit",
      "msg": "Claimed amount exceeds channel deposit"
    },
    {
      "code": 6008,
      "name": "staleNonce",
      "msg": "Nonce must be greater than last accepted nonce"
    },
    {
      "code": 6009,
      "name": "missingEd25519Instruction",
      "msg": "Missing Ed25519 SigVerify instruction before close_channel"
    },
    {
      "code": 6010,
      "name": "invalidEd25519Program",
      "msg": "Instruction does not target the Ed25519 native program"
    },
    {
      "code": 6011,
      "name": "invalidEd25519Instruction",
      "msg": "Malformed Ed25519 SigVerify instruction data"
    },
    {
      "code": 6012,
      "name": "signerMismatch",
      "msg": "Ed25519 signer does not match the channel leecher"
    },
    {
      "code": 6013,
      "name": "messageMismatch",
      "msg": "Ed25519 message does not match expected payment check"
    }
  ],
  "types": [
    {
      "name": "channelState",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "leecher",
            "type": "pubkey"
          },
          {
            "name": "seeder",
            "type": "pubkey"
          },
          {
            "name": "deposited",
            "type": "u64"
          },
          {
            "name": "channelId",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "createdAt",
            "type": "i64"
          },
          {
            "name": "timeout",
            "type": "i64"
          },
          {
            "name": "lastNonce",
            "type": "u64"
          },
          {
            "name": "status",
            "type": {
              "defined": {
                "name": "channelStatus"
              }
            }
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "channelStatus",
      "type": {
        "kind": "enum",
        "variants": [
          {
            "name": "open"
          },
          {
            "name": "closed"
          },
          {
            "name": "timedOut"
          }
        ]
      }
    }
  ]
};
