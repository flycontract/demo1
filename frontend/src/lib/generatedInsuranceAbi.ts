// Generated from Hardhat artifacts by scripts/sync-abi.mjs. Do not hand edit.
export const FLIGHT_DELAY_INSURANCE_ABI = [
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "tokenAddress",
        "type": "address"
      },
      {
        "internalType": "address",
        "name": "oracleAddress",
        "type": "address"
      }
    ],
    "stateMutability": "nonpayable",
    "type": "constructor"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "uint256",
        "name": "flightId",
        "type": "uint256"
      },
      {
        "indexed": false,
        "internalType": "string",
        "name": "flightNo",
        "type": "string"
      },
      {
        "indexed": false,
        "internalType": "string",
        "name": "origin",
        "type": "string"
      },
      {
        "indexed": false,
        "internalType": "uint256",
        "name": "scheduledDeparture",
        "type": "uint256"
      },
      {
        "indexed": false,
        "internalType": "uint256",
        "name": "scheduledArrival",
        "type": "uint256"
      },
      {
        "indexed": false,
        "internalType": "bytes32",
        "name": "planEvidenceHash",
        "type": "bytes32"
      }
    ],
    "name": "FlightRegistered",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "uint256",
        "name": "flightId",
        "type": "uint256"
      },
      {
        "indexed": false,
        "internalType": "bool",
        "name": "cancelled",
        "type": "bool"
      },
      {
        "indexed": false,
        "internalType": "uint256",
        "name": "actualArrival",
        "type": "uint256"
      },
      {
        "indexed": false,
        "internalType": "uint256",
        "name": "delayMinutes",
        "type": "uint256"
      },
      {
        "indexed": false,
        "internalType": "string",
        "name": "dataDate",
        "type": "string"
      },
      {
        "indexed": false,
        "internalType": "bytes32",
        "name": "evidenceHash",
        "type": "bytes32"
      }
    ],
    "name": "FlightResultRecorded",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "uint256",
        "name": "flightId",
        "type": "uint256"
      },
      {
        "indexed": false,
        "internalType": "bool",
        "name": "sellable",
        "type": "bool"
      }
    ],
    "name": "FlightSellableChanged",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "uint256",
        "name": "policyId",
        "type": "uint256"
      },
      {
        "indexed": true,
        "internalType": "address",
        "name": "holder",
        "type": "address"
      },
      {
        "indexed": true,
        "internalType": "uint256",
        "name": "flightId",
        "type": "uint256"
      }
    ],
    "name": "PolicyBought",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "uint256",
        "name": "policyId",
        "type": "uint256"
      },
      {
        "indexed": true,
        "internalType": "address",
        "name": "holder",
        "type": "address"
      },
      {
        "indexed": false,
        "internalType": "uint256",
        "name": "amount",
        "type": "uint256"
      }
    ],
    "name": "PolicyRefunded",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "uint256",
        "name": "policyId",
        "type": "uint256"
      },
      {
        "indexed": true,
        "internalType": "address",
        "name": "holder",
        "type": "address"
      },
      {
        "indexed": false,
        "internalType": "uint256",
        "name": "amountPaid",
        "type": "uint256"
      },
      {
        "indexed": false,
        "internalType": "string",
        "name": "reason",
        "type": "string"
      }
    ],
    "name": "PolicySettled",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "address",
        "name": "from",
        "type": "address"
      },
      {
        "indexed": false,
        "internalType": "uint256",
        "name": "amount",
        "type": "uint256"
      }
    ],
    "name": "PoolFunded",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "address",
        "name": "to",
        "type": "address"
      },
      {
        "indexed": false,
        "internalType": "uint256",
        "name": "amount",
        "type": "uint256"
      }
    ],
    "name": "SurplusWithdrawn",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "uint256",
        "name": "requestId",
        "type": "uint256"
      },
      {
        "indexed": true,
        "internalType": "uint256",
        "name": "flightId",
        "type": "uint256"
      },
      {
        "indexed": true,
        "internalType": "uint256",
        "name": "policyId",
        "type": "uint256"
      },
      {
        "indexed": false,
        "internalType": "uint256",
        "name": "scheduledArrival",
        "type": "uint256"
      }
    ],
    "name": "VerificationRequested",
    "type": "event"
  },
  {
    "inputs": [],
    "name": "DELAY_THRESHOLD_SEC",
    "outputs": [
      {
        "internalType": "uint256",
        "name": "",
        "type": "uint256"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "PAYOUT",
    "outputs": [
      {
        "internalType": "uint256",
        "name": "",
        "type": "uint256"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "PREMIUM",
    "outputs": [
      {
        "internalType": "uint256",
        "name": "",
        "type": "uint256"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "REPORT_TIMEOUT",
    "outputs": [
      {
        "internalType": "uint256",
        "name": "",
        "type": "uint256"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "SALE_CUTOFF",
    "outputs": [
      {
        "internalType": "uint256",
        "name": "",
        "type": "uint256"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "WARNING_LINE",
    "outputs": [
      {
        "internalType": "uint256",
        "name": "",
        "type": "uint256"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "uint256",
        "name": "flightId",
        "type": "uint256"
      }
    ],
    "name": "buyPolicy",
    "outputs": [
      {
        "internalType": "uint256",
        "name": "policyId",
        "type": "uint256"
      }
    ],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "flightCount",
    "outputs": [
      {
        "internalType": "uint256",
        "name": "",
        "type": "uint256"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "bytes32",
        "name": "",
        "type": "bytes32"
      }
    ],
    "name": "flightIdByAliasKey",
    "outputs": [
      {
        "internalType": "uint256",
        "name": "",
        "type": "uint256"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "uint256",
        "name": "",
        "type": "uint256"
      }
    ],
    "name": "flightResults",
    "outputs": [
      {
        "internalType": "bool",
        "name": "isFinal",
        "type": "bool"
      },
      {
        "internalType": "bool",
        "name": "cancelled",
        "type": "bool"
      },
      {
        "internalType": "uint256",
        "name": "actualArrival",
        "type": "uint256"
      },
      {
        "internalType": "uint256",
        "name": "delayMinutes",
        "type": "uint256"
      },
      {
        "internalType": "string",
        "name": "dataDate",
        "type": "string"
      },
      {
        "internalType": "bytes32",
        "name": "evidenceHash",
        "type": "bytes32"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "uint256",
        "name": "",
        "type": "uint256"
      }
    ],
    "name": "flights",
    "outputs": [
      {
        "internalType": "string",
        "name": "flightNo",
        "type": "string"
      },
      {
        "internalType": "string",
        "name": "origin",
        "type": "string"
      },
      {
        "internalType": "string",
        "name": "departureDate",
        "type": "string"
      },
      {
        "internalType": "uint256",
        "name": "scheduledDeparture",
        "type": "uint256"
      },
      {
        "internalType": "uint256",
        "name": "scheduledArrival",
        "type": "uint256"
      },
      {
        "internalType": "uint256",
        "name": "earliestVerification",
        "type": "uint256"
      },
      {
        "internalType": "bytes32",
        "name": "planEvidenceHash",
        "type": "bytes32"
      },
      {
        "internalType": "string",
        "name": "planSourceUrl",
        "type": "string"
      },
      {
        "internalType": "uint256",
        "name": "planFetchedAt",
        "type": "uint256"
      },
      {
        "internalType": "bool",
        "name": "sellable",
        "type": "bool"
      },
      {
        "internalType": "bool",
        "name": "exists",
        "type": "bool"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "uint256",
        "name": "requestId",
        "type": "uint256"
      },
      {
        "internalType": "bool",
        "name": "cancelled",
        "type": "bool"
      },
      {
        "internalType": "uint256",
        "name": "actualArrival",
        "type": "uint256"
      },
      {
        "internalType": "string",
        "name": "dataDate",
        "type": "string"
      },
      {
        "internalType": "bytes32",
        "name": "evidenceHash",
        "type": "bytes32"
      }
    ],
    "name": "fulfillVerification",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "uint256",
        "name": "amount",
        "type": "uint256"
      }
    ],
    "name": "fundPool",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "uint256",
        "name": "",
        "type": "uint256"
      },
      {
        "internalType": "address",
        "name": "",
        "type": "address"
      }
    ],
    "name": "hasPolicyForFlight",
    "outputs": [
      {
        "internalType": "bool",
        "name": "",
        "type": "bool"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "insurer",
    "outputs": [
      {
        "internalType": "address",
        "name": "",
        "type": "address"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "oracle",
    "outputs": [
      {
        "internalType": "address",
        "name": "",
        "type": "address"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "pause",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "paused",
    "outputs": [
      {
        "internalType": "bool",
        "name": "",
        "type": "bool"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "uint256",
        "name": "",
        "type": "uint256"
      }
    ],
    "name": "policies",
    "outputs": [
      {
        "internalType": "address",
        "name": "holder",
        "type": "address"
      },
      {
        "internalType": "uint256",
        "name": "flightId",
        "type": "uint256"
      },
      {
        "internalType": "uint256",
        "name": "requestId",
        "type": "uint256"
      },
      {
        "internalType": "enum FlightDelayInsurance.PolicyStatus",
        "name": "status",
        "type": "uint8"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "policyCount",
    "outputs": [
      {
        "internalType": "uint256",
        "name": "",
        "type": "uint256"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "poolBalance",
    "outputs": [
      {
        "internalType": "uint256",
        "name": "",
        "type": "uint256"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "uint256",
        "name": "policyId",
        "type": "uint256"
      }
    ],
    "name": "refundUnresolved",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "components": [
          {
            "internalType": "string",
            "name": "flightNo",
            "type": "string"
          },
          {
            "internalType": "string",
            "name": "origin",
            "type": "string"
          },
          {
            "internalType": "string",
            "name": "departureDate",
            "type": "string"
          },
          {
            "internalType": "uint256",
            "name": "scheduledDeparture",
            "type": "uint256"
          },
          {
            "internalType": "uint256",
            "name": "scheduledArrival",
            "type": "uint256"
          },
          {
            "internalType": "bytes32",
            "name": "planEvidenceHash",
            "type": "bytes32"
          },
          {
            "internalType": "string",
            "name": "planSourceUrl",
            "type": "string"
          },
          {
            "internalType": "uint256",
            "name": "planFetchedAt",
            "type": "uint256"
          },
          {
            "internalType": "string[]",
            "name": "aliases",
            "type": "string[]"
          },
          {
            "internalType": "bool",
            "name": "sellable",
            "type": "bool"
          }
        ],
        "internalType": "struct FlightDelayInsurance.FlightRegistration",
        "name": "registration",
        "type": "tuple"
      }
    ],
    "name": "registerFlight",
    "outputs": [
      {
        "internalType": "uint256",
        "name": "flightId",
        "type": "uint256"
      }
    ],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "requestCount",
    "outputs": [
      {
        "internalType": "uint256",
        "name": "",
        "type": "uint256"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "uint256",
        "name": "policyId",
        "type": "uint256"
      }
    ],
    "name": "requestVerification",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "reservedPayouts",
    "outputs": [
      {
        "internalType": "uint256",
        "name": "",
        "type": "uint256"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "uint256",
        "name": "flightId",
        "type": "uint256"
      },
      {
        "internalType": "bool",
        "name": "sellable",
        "type": "bool"
      }
    ],
    "name": "setFlightSellable",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "newOracle",
        "type": "address"
      }
    ],
    "name": "setOracle",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "uint256",
        "name": "policyId",
        "type": "uint256"
      }
    ],
    "name": "settlePolicy",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "token",
    "outputs": [
      {
        "internalType": "contract IERC20",
        "name": "",
        "type": "address"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "unpause",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "uint256",
        "name": "",
        "type": "uint256"
      }
    ],
    "name": "verificationRequests",
    "outputs": [
      {
        "internalType": "uint256",
        "name": "flightId",
        "type": "uint256"
      },
      {
        "internalType": "uint256",
        "name": "policyId",
        "type": "uint256"
      },
      {
        "internalType": "bool",
        "name": "exists",
        "type": "bool"
      },
      {
        "internalType": "bool",
        "name": "fulfilled",
        "type": "bool"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "uint256",
        "name": "amount",
        "type": "uint256"
      }
    ],
    "name": "withdrawSurplus",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  }
] as const;
