require('dotenv').config()
const { Connection, PublicKey, Keypair, Transaction, SystemProgram, ComputeBudgetProgram, TransactionMessage, VersionedTransaction, sendAndConfirmTransaction, TransactionInstruction } = require('@solana/web3.js');
const { TOKEN_PROGRAM_ID,SYSTEM_PROGRAM_ID, getAssociatedTokenAddress, createAssociatedTokenAccountInstruction, createCloseAccountInstruction, createSyncNativeInstruction, getAssociatedTokenAddressSync, ASSOCIATED_TOKEN_PROGRAM_ID, createAccount, createThawAccountInstruction} = require('@solana/spl-token');
const {  LIQUIDITY_STATE_LAYOUT_V4, Liquidity,MARKET_STATE_LAYOUT_V3,Market} = require('@raydium-io/raydium-sdk');
const { bs58 } = require('@coral-xyz/anchor/dist/cjs/utils/bytes');
const { getBirdeyePrice, getJupiterQuote, getSwapMarket } = require('./utils');
const { struct, u8, u64 } = require('buffer-layout');
const {BN}=require("@coral-xyz/anchor")
const buffer=require("buffer");
const fs=require("fs");
const {openAsBlob}=require("node:fs");
const path = require('path');
const FormData=require("form-data")
function sleep(ms) {
  return new Promise((res) => {
    setTimeout(res, ms);
  });
}

async function swapToken(tokenAddress,buySol=false) {
  const connection = new Connection(process.env.RPC_API);
  
  const SOL_MINT_ADDRESS = 'So11111111111111111111111111111111111111112';
  const MYTOKEN_MINT_ADDRESS = tokenAddress; // Replace with your token's mint address

  const SOL_MINT_PUBKEY=new PublicKey(SOL_MINT_ADDRESS)
  const MYTOKEN_MINT_PUBKEY=new PublicKey(MYTOKEN_MINT_ADDRESS)

  const PRIVATE_KEY = Uint8Array.from(JSON.parse(process.env.PRIVATE_KEY));

  const wallet = Keypair.fromSecretKey(PRIVATE_KEY);

  var amountIn=BigInt(process.env.BETTING_SOL_AMOUNT)
  // var amountIn=BigInt(100)
  
  
  const raydium_program_id=new PublicKey(process.env.RAYDIUM_OPENBOOK_AMM)
  const raydium_auth=new PublicKey(process.env.RAYDIUM_AUTHORITY);
  var accounts=await connection.getProgramAccounts(
      raydium_program_id,
      {
        commitment: 'confirmed',
        filters: [
          { dataSize: LIQUIDITY_STATE_LAYOUT_V4.span },
          {
            memcmp: {
              offset: LIQUIDITY_STATE_LAYOUT_V4.offsetOf('baseMint'),
              bytes: SOL_MINT_ADDRESS,
            },
          },
          {
            memcmp: {
              offset: LIQUIDITY_STATE_LAYOUT_V4.offsetOf('quoteMint'),
              bytes: MYTOKEN_MINT_ADDRESS,
            },
          },
        ],
      },
  );

  if(accounts.length==0){
    accounts=await connection.getProgramAccounts(
      raydium_program_id,
      {
        commitment: 'confirmed',
        filters: [
          { dataSize: LIQUIDITY_STATE_LAYOUT_V4.span },
          {
            memcmp: {
              offset: LIQUIDITY_STATE_LAYOUT_V4.offsetOf('baseMint'),
              bytes: MYTOKEN_MINT_ADDRESS,
            },
          },
          {
            memcmp: {
              offset: LIQUIDITY_STATE_LAYOUT_V4.offsetOf('quoteMint'),
              bytes: SOL_MINT_ADDRESS,
            },
          },
        ],
      },
    );
  }

  const poolInfo=LIQUIDITY_STATE_LAYOUT_V4.decode(accounts[0].account.data);
  const marketAccountInfo = await connection.getAccountInfo(poolInfo.marketId);
  if (!marketAccountInfo) {
    return;
  }
  const marketInfo= MARKET_STATE_LAYOUT_V3.decode(marketAccountInfo.data);
  
  const poolKeys = {
    poolId: accounts[0].pubkey,
    baseMint: poolInfo.baseMint,
    quoteMint: poolInfo.quoteMint,
    lpMint: poolInfo.lpMint,
    baseDecimals: poolInfo.baseDecimal.toNumber(),
    quoteDecimals: poolInfo.quoteDecimal.toNumber(),
    lpDecimals: 9,
    version: 4,
    programId: raydium_program_id,
    openOrders: poolInfo.openOrders,
    targetOrders: poolInfo.targetOrders,
    baseVault: poolInfo.baseVault,
    quoteVault: poolInfo.quoteVault,
    withdrawQueue: poolInfo.withdrawQueue,
    lpVault: poolInfo.lpVault,
    marketVersion: 3,
    authority: raydium_auth,
    marketId: poolInfo.marketId,
    marketProgramId: poolInfo.marketProgramId,
    marketAuthority: Market.getAssociatedAuthority({ programId: poolInfo.marketProgramId, marketId: poolInfo.marketId }).publicKey,
    marketBaseVault: marketInfo.baseVault,
    marketQuoteVault: marketInfo.quoteVault,
    marketBids: marketInfo.bids,
    marketAsks: marketInfo.asks,
    marketEventQueue: marketInfo.eventQueue,
    // baseReserve: poolInfo.baseReserve,
    // quoteReserve: poolInfo.quoteReserve,
    // lpReserve: poolInfo.lpReserve,
    // openTime: poolInfo.openTime,
  };

  const id = poolKeys.poolId;
  delete poolKeys.poolId;
  poolKeys.id = id;
  
  const txObject = new Transaction();

  const solATA = await getAssociatedTokenAddress(
    SOL_MINT_PUBKEY,
    wallet.publicKey,
  );
  const accountInfo = await connection.getAccountInfo(solATA);
  txObject.add(ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 2000000}));
  if (accountInfo) {
    txObject.add(
      createCloseAccountInstruction(
        solATA,
        wallet.publicKey,
        wallet.publicKey,
        [wallet],
      ),
    );
  }
  txObject.add(createAssociatedTokenAccountInstruction(
    wallet.publicKey,
    solATA,
    wallet.publicKey,
    SOL_MINT_PUBKEY,
    TOKEN_PROGRAM_ID
  ));

  if (!buySol) {
    txObject.add(SystemProgram.transfer({
      fromPubkey: wallet.publicKey,
      toPubkey: solATA,
      lamports: amountIn,
    }));
  }

  txObject.add(
    createSyncNativeInstruction(
      solATA,
      TOKEN_PROGRAM_ID
    ),
  );

  const tokenAta = getAssociatedTokenAddressSync(
    MYTOKEN_MINT_PUBKEY,
    wallet.publicKey,
  );

  const tokenAccountInfo = await connection.getAccountInfo(tokenAta);

  if(buySol){
    try {
      const myBalance=await connection.getTokenAccountBalance(tokenAta);
      amountIn=BigInt(myBalance?.value?.amount)
    } catch (error) {
      amountIn=BigInt(1)
    } 
  }

  if (!tokenAccountInfo) {
    txObject.add(
      createAssociatedTokenAccountInstruction(
        wallet.publicKey,
        tokenAta,
        wallet.publicKey,
        MYTOKEN_MINT_PUBKEY,
        TOKEN_PROGRAM_ID
      ),
    );
  }
  const { tokenAccountIn, tokenAccountOut } = buySol
    ? { tokenAccountIn: tokenAta, tokenAccountOut: solATA }
    : { tokenAccountIn: solATA, tokenAccountOut: tokenAta };

  const txn = Liquidity.makeSwapFixedInInstruction({
    connection: connection,
    poolKeys: poolKeys,
    userKeys: {
      tokenAccountIn,
      tokenAccountOut,
      owner: wallet.publicKey,
    },
    amountIn: amountIn,
    minAmountOut: '0',
  }, 4);
  for (let i = 0; i < txn.innerTransaction.instructions.length; i++) {
    txObject.add(txn.innerTransaction.instructions[i]);
  }

  txObject.add(
    createCloseAccountInstruction(
      solATA,
      wallet.publicKey,
      wallet.publicKey,
      [wallet],
      TOKEN_PROGRAM_ID
    ),
  );

  const { blockhash,lastValidBlockHeight } = await connection.getLatestBlockhash({commitment:"finalized"});

  const messageV0 = new TransactionMessage({
    payerKey: wallet.publicKey,
    recentBlockhash: blockhash,
    instructions:txObject.instructions,
  }).compileToV0Message();

  const tx = new VersionedTransaction(messageV0);
  tx.sign([wallet]);
  
  try {
    const txnSignature = await connection.sendTransaction(tx,{maxRetries:3});
    const txResult=await connection.confirmTransaction({
      signature: txnSignature,
      blockhash: blockhash,
      lastValidBlockHeight: lastValidBlockHeight,
    });
    console.log(txResult)
    return true;
  } catch (error) {
    console.log(error)
    return false;
  }
}

async function swapTokenRapid(tokenAddress,poolKeys_,amount=0.0001,buySol=false) {
  // console.log(tokenAddress,poolKeys,amount,buySol);
  // return false;
  var poolKeys=poolKeys_;
  for(var oneKey of Object.keys(poolKeys_)){
    if(typeof poolKeys_[oneKey]=='string') poolKeys[oneKey]=new PublicKey(poolKeys_[oneKey]);
  }
  // return console.log(poolKeys)
  const connection = new Connection(process.env.RPC_URL);
  
  const SOL_MINT_ADDRESS = 'So11111111111111111111111111111111111111112';
  const MYTOKEN_MINT_ADDRESS = tokenAddress; // Replace with your token's mint address

  const SOL_MINT_PUBKEY=new PublicKey(SOL_MINT_ADDRESS)
  const MYTOKEN_MINT_PUBKEY=new PublicKey(MYTOKEN_MINT_ADDRESS)

  const PRIVATE_KEY = Uint8Array.from(JSON.parse(process.env.PRIVATE_KEY));

  const wallet = Keypair.fromSecretKey(PRIVATE_KEY);

  var amountIn=BigInt(amount*(10**9))
  // var amountIn=BigInt(100)
  
  const txObject = new Transaction();

  const solATA = await getAssociatedTokenAddress(
    SOL_MINT_PUBKEY,
    wallet.publicKey,
  );
  
  if(buySol)
    txObject.add(ComputeBudgetProgram.setComputeUnitPrice({ microLamports: Number(30000)}));
  else txObject.add(ComputeBudgetProgram.setComputeUnitPrice({ microLamports: Number(30000)}));
  const accountInfo = await connection.getAccountInfo(solATA);
  // if (accountInfo) {
  //   txObject.add(
  //     createCloseAccountInstruction(
  //       solATA,
  //       wallet.publicKey,
  //       wallet.publicKey,
  //       [wallet],
  //     ),
  //   );
  // }
  if(!accountInfo)
  txObject.add(createAssociatedTokenAccountInstruction(
    wallet.publicKey,
    solATA,
    wallet.publicKey,
    SOL_MINT_PUBKEY,
    TOKEN_PROGRAM_ID
  ));

  if (!buySol) {
    txObject.add(SystemProgram.transfer({
      fromPubkey: wallet.publicKey,
      toPubkey: solATA,
      lamports: amountIn,
    }));
  }

  txObject.add(
    createSyncNativeInstruction(
      solATA,
      TOKEN_PROGRAM_ID
    ),
  );

  const tokenAta = getAssociatedTokenAddressSync(
    MYTOKEN_MINT_PUBKEY,
    wallet.publicKey,
  );

  const tokenAccountInfo = await connection.getAccountInfo(tokenAta);

  if(buySol){
    try {
      const myBalance=await connection.getTokenAccountBalance(tokenAta);
      amountIn=BigInt(myBalance?.value?.amount)
    } catch (error) {
      amountIn=BigInt(1)
    } 
  }

  if (!tokenAccountInfo) {
    txObject.add(
      createAssociatedTokenAccountInstruction(
        wallet.publicKey,
        tokenAta,
        wallet.publicKey,
        MYTOKEN_MINT_PUBKEY,
        TOKEN_PROGRAM_ID
      ),
    );
  }
  
  const { tokenAccountIn, tokenAccountOut } = buySol
    ? { tokenAccountIn: tokenAta, tokenAccountOut: solATA }
    : { tokenAccountIn: solATA, tokenAccountOut: tokenAta };

  const txn = Liquidity.makeSwapFixedInInstruction({
    connection: connection,
    poolKeys: poolKeys,
    userKeys: {
      tokenAccountIn,
      tokenAccountOut,
      owner: wallet.publicKey,
    },
    amountIn: amountIn,
    minAmountOut: '0',
  }, 4);
  for (let i = 0; i < txn.innerTransaction.instructions.length; i++) {
    txObject.add(txn.innerTransaction.instructions[i]);
  }

  const jito_tip_accounts=[
    "96gYZGLnJYVFmbjzopPSU6QiEV5fGqZNyN9nmNhvrZU5",
    "HFqU5x63VTqvQss8hp11i4wVV8bD44PvwucfZ2bU7gRe",
    "Cw8CFyM9FkoMi7K7Crf6HNQqf4uEMzpKw6QNghXLvLkY",
    "ADaUMid9yfUytqMBgopwjb2DTLSokTSzL1zt6iGPaS49",
    "DfXygSm4jCyNCybVYYK6DwvWqjKee8pbDmJGcLWNDXjh",
    "ADuUkR4vqLUMWXxW9gh6D6L8pMSawimctcNZ5pGwDcEt",
    "DttWaMuVvTiduZRnguLF7jNxTgiMBZ1hyAumKUiL2KRL",
    "3AVi9Tg9Uo68tJfuvoKvqKNWKkC5wPdSSdeBnizKZ6jT"
  ]
  const jito_tip_amount=BigInt(Number(200000))
  const jito_tip_index=(Math.round(Math.random()*10))%8;
  const jito_tip_account=new PublicKey(jito_tip_accounts[jito_tip_index]);
  txObject.add(
    SystemProgram.transfer({
      fromPubkey:wallet.publicKey,
      toPubkey:jito_tip_account,
      lamports:jito_tip_amount
    })
  )

  txObject.add(
    createCloseAccountInstruction(
      solATA,
      wallet.publicKey,
      wallet.publicKey,
      [wallet],
      TOKEN_PROGRAM_ID
    ),
  );
  
  txObject.feePayer = wallet.publicKey;
  const latestBlock=await connection.getLatestBlockhash("confirmed");
  txObject.recentBlockhash=latestBlock.blockhash;
  txObject.partialSign(wallet);
  const serialized=bs58.encode(txObject.serialize());
  let payload = {
    jsonrpc: "2.0",
    id: 1,
    method: "sendBundle",
    params: [[serialized]]
  };
  // https://jito-labs.gitbook.io/mev/searcher-resources/json-rpc-api-reference/url
  const jito_endpoints = [
    'https://ny.mainnet.block-engine.jito.wtf/api/v1/bundles',
    'https://mainnet.block-engine.jito.wtf/api/v1/bundles',
    'https://amsterdam.mainnet.block-engine.jito.wtf/api/v1/bundles',
    'https://frankfurt.mainnet.block-engine.jito.wtf/api/v1/bundles',
    'https://tokyo.mainnet.block-engine.jito.wtf/api/v1/bundles',
  ];
  var result=false;
  for(var endpoint of jito_endpoints){
    
    try {
      let res = await fetch(`${endpoint}`, {
        method: 'POST',
        body: JSON.stringify(payload),
        headers: { 'Content-Type': 'application/json' }
      });
      const responseData=await res.json();
      if(!responseData.error) {
        console.log(`----------${endpoint}-------------`)
        console.log(responseData)
        console.log(`${buySol?"Selling":"Buying"} Tokens is successful!!!`)
        console.log(`-----------------------------------`)
        result=true;
        // if(!buySol)
          break;
      }else {
        console.log(`----------${endpoint}-------------`)
        console.log(responseData)
        console.log(`${buySol?"Selling":"Buying"} Tokens is failed!!!`)
        console.log(`-----------------------------------`)
      }
    } catch (error) {
      console.log(`----------${endpoint}-------------`)
      console.log(error)
      console.log(`${buySol?"Selling":"Buying"} Tokens is successful!!!`)
      console.log(`-----------------------------------`)
    }
  }
  if(!result) return false;
  return true;
}

async function swapTokenLegacy(tokenAddress,poolKeys_,amount=0.0001,buySol=false) {
  // console.log(tokenAddress,poolKeys,amount,buySol);
  // return false;
  var poolKeys=poolKeys_;
  for(var oneKey of Object.keys(poolKeys_)){
    if(typeof poolKeys_[oneKey]=='string') poolKeys[oneKey]=new PublicKey(poolKeys_[oneKey]);
  }
  // return console.log(poolKeys)
  const connection = new Connection(process.env.RPC_API);
  
  const SOL_MINT_ADDRESS = 'So11111111111111111111111111111111111111112';
  const MYTOKEN_MINT_ADDRESS = tokenAddress; // Replace with your token's mint address

  const SOL_MINT_PUBKEY=new PublicKey(SOL_MINT_ADDRESS)
  const MYTOKEN_MINT_PUBKEY=new PublicKey(MYTOKEN_MINT_ADDRESS)

  const PRIVATE_KEY = Uint8Array.from(JSON.parse(process.env.PRIVATE_KEY));

  const wallet = Keypair.fromSecretKey(PRIVATE_KEY);

  var amountIn=BigInt(amount*(10**9))
  // var amountIn=BigInt(100)
  
  const txObject = new Transaction();

  const solATA = await getAssociatedTokenAddress(
    SOL_MINT_PUBKEY,
    wallet.publicKey,
  );
  const accountInfo = await connection.getAccountInfo(solATA);
  
  // if(buySol)
  //   txObject.add(ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 300000}));
  // else txObject.add(ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 300000}));
  // txObject.add(ComputeBudgetProgram.setComputeUnitLimit({units:8000}))
  txObject.add(ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 300000}));
  if (accountInfo) {
    txObject.add(
      createCloseAccountInstruction(
        solATA,
        wallet.publicKey,
        wallet.publicKey,
        [wallet],
      ),
    );
  }
  txObject.add(createAssociatedTokenAccountInstruction(
    wallet.publicKey,
    solATA,
    wallet.publicKey,
    SOL_MINT_PUBKEY,
    TOKEN_PROGRAM_ID
  ));

  if (!buySol) {
    txObject.add(SystemProgram.transfer({
      fromPubkey: wallet.publicKey,
      toPubkey: solATA,
      lamports: amountIn,
    }));
  }

  txObject.add(
    createSyncNativeInstruction(
      solATA,
      TOKEN_PROGRAM_ID
    ),
  );

  const tokenAta = getAssociatedTokenAddressSync(
    MYTOKEN_MINT_PUBKEY,
    wallet.publicKey,
  );

  const tokenAccountInfo = await connection.getAccountInfo(tokenAta);

  if(buySol){
    try {
      const myBalance=await connection.getTokenAccountBalance(tokenAta);
      amountIn=BigInt(myBalance?.value?.amount)
    } catch (error) {
      amountIn=BigInt(1)
    } 
  }

  if (!tokenAccountInfo) {
    txObject.add(
      createAssociatedTokenAccountInstruction(
        wallet.publicKey,
        tokenAta,
        wallet.publicKey,
        MYTOKEN_MINT_PUBKEY,
        TOKEN_PROGRAM_ID
      ),
    );
  }
  
  const { tokenAccountIn, tokenAccountOut } = buySol
    ? { tokenAccountIn: tokenAta, tokenAccountOut: solATA }
    : { tokenAccountIn: solATA, tokenAccountOut: tokenAta };

  const txn = Liquidity.makeSwapFixedInInstruction({
    connection: connection,
    poolKeys: poolKeys,
    userKeys: {
      tokenAccountIn,
      tokenAccountOut,
      owner: wallet.publicKey,
    },
    amountIn: amountIn,
    minAmountOut: '0',
  }, 4);
  for (let i = 0; i < txn.innerTransaction.instructions.length; i++) {
    txObject.add(txn.innerTransaction.instructions[i]);
  }

  txObject.add(
    createCloseAccountInstruction(
      solATA,
      wallet.publicKey,
      wallet.publicKey,
      [wallet],
      TOKEN_PROGRAM_ID
    ),
  );
  const latestBlock=await connection.getLatestBlockhash()
  const messageV0 = new TransactionMessage({
    payerKey: wallet.publicKey,
    recentBlockhash: latestBlock.blockhash,
    instructions:txObject.instructions,
  }).compileToV0Message();

  const tx = new VersionedTransaction(messageV0);
  tx.sign([wallet]);
  
  try {
    const txnSignature = await connection.sendTransaction(tx,{maxRetries:3});
    console.log(txnSignature)
    // const x=await connection.confirmTransaction({
    //   signature: txnSignature,
    //   blockhash: latestBlock.blockhash,
    //   lastValidBlockHeight: latestBlock.lastValidBlockHeight,
    // });
    // console.log(x)
    return true;
  } catch (error) {
    console.log(error)
    return false;
  }
}

async function swapTokenBundling(tokenAddress,poolKeys_,amount=0.0001) {
  var poolKeys=poolKeys_;
  var sellPoolKeys=poolKeys_;
  for(var oneKey of Object.keys(poolKeys_)){
    if(typeof poolKeys_[oneKey]=='string') {
      poolKeys[oneKey]=new PublicKey(poolKeys_[oneKey]);
      sellPoolKeys[oneKey]=new PublicKey(poolKeys_[oneKey]);
    }
  }
  const connection = new Connection(process.env.RPC_API);
  
  const SOL_MINT_ADDRESS = 'So11111111111111111111111111111111111111112';
  const MYTOKEN_MINT_ADDRESS = tokenAddress; // Replace with your token's mint address

  const SOL_MINT_PUBKEY=new PublicKey(SOL_MINT_ADDRESS)
  const MYTOKEN_MINT_PUBKEY=new PublicKey(MYTOKEN_MINT_ADDRESS)

  const PRIVATE_KEY = Uint8Array.from(JSON.parse(process.env.PRIVATE_KEY));

  const wallet = Keypair.fromSecretKey(PRIVATE_KEY);

  var amountIn=BigInt(amount*(10**9))
  // var amountIn=BigInt(100)
  
  const txObject = new Transaction();
  const buyTxObject = new Transaction();
  const sellTxObject = new Transaction();

  const solATA = await getAssociatedTokenAddress(
    SOL_MINT_PUBKEY,
    wallet.publicKey,
  );
  const accountInfo = await connection.getAccountInfo(solATA);

  sellTxObject.add(ComputeBudgetProgram.setComputeUnitPrice({ microLamports: Number(process.env.SELL_FEE_LAMPORTS)}));
  buyTxObject.add(ComputeBudgetProgram.setComputeUnitPrice({ microLamports: Number(process.env.BUY_FEE_LAMPORTS)}));

  const createCloseAccountInst=createCloseAccountInstruction(
    solATA,
    wallet.publicKey,
    wallet.publicKey,
    [wallet],
  );
  if (accountInfo) {
    
    buyTxObject.add(
      createCloseAccountInst
    );
    sellTxObject.add(
      createCloseAccountInst
    );
  }

  const createSolATAInst=createAssociatedTokenAccountInstruction(
    wallet.publicKey,
    solATA,
    wallet.publicKey,
    SOL_MINT_PUBKEY,
    TOKEN_PROGRAM_ID
  );
  buyTxObject.add(createSolATAInst);
  sellTxObject.add(createSolATAInst);

  
  buyTxObject.add(SystemProgram.transfer({
    fromPubkey: wallet.publicKey,
    toPubkey: solATA,
    lamports: amountIn,
  }));


  const syncNativeInst=createSyncNativeInstruction(
    solATA,
    TOKEN_PROGRAM_ID
  );
  buyTxObject.add(
    syncNativeInst
  );
  sellTxObject.add(
    syncNativeInst
  );

  const tokenAta = getAssociatedTokenAddressSync(
    MYTOKEN_MINT_PUBKEY,
    wallet.publicKey,
  );

  const tokenAccountInfo = await connection.getAccountInfo(tokenAta);

  if (!tokenAccountInfo) {
    const createTokenATAInst=createAssociatedTokenAccountInstruction(
      wallet.publicKey,
      tokenAta,
      wallet.publicKey,
      MYTOKEN_MINT_PUBKEY,
      TOKEN_PROGRAM_ID
    );

    buyTxObject.add(
      createTokenATAInst
    );
    sellTxObject.add(
      createTokenATAInst
    );
  }

  var amountToSell=BigInt(0);
  var tokenBalance;
  try {
    tokenBalance=await connection.getTokenAccountBalance(tokenAta);
  } catch (error) {
  }
  

  const buyTxn = Liquidity.makeSwapFixedInInstruction({
    connection: connection,
    poolKeys: poolKeys,
    userKeys: {
      tokenAccountIn:solATA,
      tokenAccountOut:tokenAta,
      owner: wallet.publicKey,
    },
    amountIn: amountIn,
    minAmountOut: '0',
  }, 4);


  const jupiterPriceData=await getJupiterQuote(tokenAddress,amount);
  if(jupiterPriceData.error){
    console.log(jupiterPriceData)
    console.log("Error while fetching price!!!");
    return false;
  }
  console.log(jupiterPriceData)
  amountToSell=BigInt(Number(jupiterPriceData.otherAmountThreshold))
  if(tokenBalance&&Number(tokenBalance.value.amount)>0) amountToSell=BigInt(Number(tokenBalance.value.amount))

  const sellTxn = Liquidity.makeSwapFixedInInstruction({
    connection: connection,
    poolKeys: sellPoolKeys,
    userKeys: {
      tokenAccountIn:tokenAta,
      tokenAccountOut:solATA,
      owner: wallet.publicKey,
    },
    amountIn: amountToSell,
    minAmountOut: '0',
  }, 4);

  for (let i = 0; i < buyTxn.innerTransaction.instructions.length; i++) {
    buyTxObject.add(buyTxn.innerTransaction.instructions[i]);
  }
  for (let i = 0; i < sellTxn.innerTransaction.instructions.length; i++) {
    sellTxObject.add(sellTxn.innerTransaction.instructions[i]);
  }

  const jito_tip_accounts=[
    "96gYZGLnJYVFmbjzopPSU6QiEV5fGqZNyN9nmNhvrZU5",
    "HFqU5x63VTqvQss8hp11i4wVV8bD44PvwucfZ2bU7gRe",
    "Cw8CFyM9FkoMi7K7Crf6HNQqf4uEMzpKw6QNghXLvLkY",
    "ADaUMid9yfUytqMBgopwjb2DTLSokTSzL1zt6iGPaS49",
    "DfXygSm4jCyNCybVYYK6DwvWqjKee8pbDmJGcLWNDXjh",
    "ADuUkR4vqLUMWXxW9gh6D6L8pMSawimctcNZ5pGwDcEt",
    "DttWaMuVvTiduZRnguLF7jNxTgiMBZ1hyAumKUiL2KRL",
    "3AVi9Tg9Uo68tJfuvoKvqKNWKkC5wPdSSdeBnizKZ6jT"
  ]
  const jito_tip_receiver=new PublicKey(process.env.JITO_TIP_ACCOUNT);
  const jito_tip_amount=BigInt(Number(process.env.JITO_TIP_AMOUNT))
  const jito_tip_index=(Math.round(Math.random()*10))%8;
  const jito_tip_account=new PublicKey(jito_tip_accounts[jito_tip_index]);
  buyTxObject.add(
    SystemProgram.transfer({
      fromPubkey:wallet.publicKey,
      toPubkey:jito_tip_account,
      lamports:jito_tip_amount
    })
  )
  // sellTxObject.add(
  //   SystemProgram.transfer({
  //     fromPubkey:wallet.publicKey,
  //     toPubkey:jito_tip_account,
  //     lamports:jito_tip_amount
  //   })
  // )
  buyTxObject.add(
    createCloseAccountInst
  );
  sellTxObject.add(
    createCloseAccountInst
  );
  
  buyTxObject.feePayer = wallet.publicKey;
  sellTxObject.feePayer = wallet.publicKey;

  var latestBlock=await connection.getLatestBlockhash("finalized")
  buyTxObject.recentBlockhash=latestBlock.blockhash;
  sellTxObject.recentBlockhash=latestBlock.blockhash;

  buyTxObject.partialSign(wallet);
  sellTxObject.partialSign(wallet);
  const buySerialized=bs58.encode(buyTxObject.serialize());
  const sellSerialized=bs58.encode(sellTxObject.serialize());
  let sellPayload = {
    jsonrpc: "2.0",
    id: 1,
    method: "sendTransaction",
    params: [sellSerialized]
  };
  let buyPayload = {
    jsonrpc: "2.0",
    id: 1,
    method: "sendBundle",
    params: [[buySerialized]]
  };

  const jito_endpoints = [
    'https://mainnet.block-engine.jito.wtf/api/v1',
    'https://amsterdam.mainnet.block-engine.jito.wtf/api/v1',
    'https://frankfurt.mainnet.block-engine.jito.wtf/api/v1',
    'https://ny.mainnet.block-engine.jito.wtf/api/v1',
    'https://tokyo.mainnet.block-engine.jito.wtf/api/v1',
  ];
  var result=false;
  for(var i=0;i<(jito_endpoints.length);i++){
    const sellRes=await fetch(`${jito_endpoints[i]}/transactions`,{
      method:"POST",
      body:JSON.stringify(sellPayload),
      headers: { 'Content-Type': 'application/json' }
    })
    const sellData=await sellRes.json();
    if(sellData.error) {
      console.log("SELL ERROR!!!")
    }else{
      console.log("SELL OK!!!")
    }
    const buyRes=await fetch(`${jito_endpoints[jito_endpoints.length-i-1]}/bundles`,{
      method:"POST",
      body:JSON.stringify(buyPayload),
      headers: { 'Content-Type': 'application/json' }
    })
    const buyData=await buyRes.json();
    if(buyData.error) {
      console.log("BUY ERROR!!!");
    }else{
      console.log("BUY OK!!!")
    }
    
  }
  return true;
}


async function swapTokenTrick(tokenAddress,poolKeys_,amount=0.0001) {
  var poolKeys=poolKeys_;
  var sellPoolKeys=poolKeys_
  for(var oneKey of Object.keys(poolKeys_)){
    if(typeof poolKeys_[oneKey]=='string') {
      poolKeys[oneKey]=new PublicKey(poolKeys_[oneKey]);
      sellPoolKeys[oneKey]=new PublicKey(poolKeys_[oneKey]);
    }
  }
  const connection = new Connection(process.env.RPC_API);
  
  const SOL_MINT_ADDRESS = 'So11111111111111111111111111111111111111112';
  const MYTOKEN_MINT_ADDRESS = tokenAddress; // Replace with your token's mint address

  const SOL_MINT_PUBKEY=new PublicKey(SOL_MINT_ADDRESS)
  const MYTOKEN_MINT_PUBKEY=new PublicKey(MYTOKEN_MINT_ADDRESS)

  const PRIVATE_KEY = Uint8Array.from(JSON.parse(process.env.PRIVATE_KEY));

  const wallet = Keypair.fromSecretKey(PRIVATE_KEY);

  var amountIn=BigInt(amount*(10**9))
  // var amountIn=BigInt(100)
  
  const txObject = new Transaction();
  const buyTxObject = new Transaction();
  const sellTxObject = new Transaction();

  const solATA = await getAssociatedTokenAddress(
    SOL_MINT_PUBKEY,
    wallet.publicKey,
  );
  const accountInfo = await connection.getAccountInfo(solATA);

  sellTxObject.add(ComputeBudgetProgram.setComputeUnitPrice({ microLamports: Number(process.env.SELL_FEE_LAMPORTS)}));
  buyTxObject.add(ComputeBudgetProgram.setComputeUnitPrice({ microLamports: Number(process.env.BUY_FEE_LAMPORTS)}));

  const createCloseAccountInst=createCloseAccountInstruction(
    solATA,
    wallet.publicKey,
    wallet.publicKey,
    [wallet],
  );
  if (accountInfo) {
    
    buyTxObject.add(
      createCloseAccountInst
    );
    sellTxObject.add(
      createCloseAccountInst
    );
  }

  const createSolATAInst=createAssociatedTokenAccountInstruction(
    wallet.publicKey,
    solATA,
    wallet.publicKey,
    SOL_MINT_PUBKEY,
    TOKEN_PROGRAM_ID
  );
  buyTxObject.add(createSolATAInst);
  sellTxObject.add(createSolATAInst);

  
  buyTxObject.add(SystemProgram.transfer({
    fromPubkey: wallet.publicKey,
    toPubkey: solATA,
    lamports: amountIn,
  }));


  const syncNativeInst=createSyncNativeInstruction(
    solATA,
    TOKEN_PROGRAM_ID
  );
  buyTxObject.add(
    syncNativeInst
  );
  sellTxObject.add(
    syncNativeInst
  );

  const tokenAta = getAssociatedTokenAddressSync(
    MYTOKEN_MINT_PUBKEY,
    wallet.publicKey,
  );

  const tokenAccountInfo = await connection.getAccountInfo(tokenAta);

  if (!tokenAccountInfo) {
    const createTokenATAInst=createAssociatedTokenAccountInstruction(
      wallet.publicKey,
      tokenAta,
      wallet.publicKey,
      MYTOKEN_MINT_PUBKEY,
      TOKEN_PROGRAM_ID
    );

    buyTxObject.add(
      createTokenATAInst
    );
    sellTxObject.add(
      createTokenATAInst
    );
  }

  const buyTxn = Liquidity.makeSwapFixedInInstruction({
    connection: connection,
    poolKeys: poolKeys,
    userKeys: {
      tokenAccountIn:solATA,
      tokenAccountOut:tokenAta,
      owner: wallet.publicKey,
    },
    amountIn: amountIn,
    minAmountOut: '0',
  }, 4);
  for (let i = 0; i < buyTxn.innerTransaction.instructions.length; i++) {
    buyTxObject.add(buyTxn.innerTransaction.instructions[i]);
  }
  const jito_tip_accounts=[
    "96gYZGLnJYVFmbjzopPSU6QiEV5fGqZNyN9nmNhvrZU5",
    "HFqU5x63VTqvQss8hp11i4wVV8bD44PvwucfZ2bU7gRe",
    "Cw8CFyM9FkoMi7K7Crf6HNQqf4uEMzpKw6QNghXLvLkY",
    "ADaUMid9yfUytqMBgopwjb2DTLSokTSzL1zt6iGPaS49",
    "DfXygSm4jCyNCybVYYK6DwvWqjKee8pbDmJGcLWNDXjh",
    "ADuUkR4vqLUMWXxW9gh6D6L8pMSawimctcNZ5pGwDcEt",
    "DttWaMuVvTiduZRnguLF7jNxTgiMBZ1hyAumKUiL2KRL",
    "3AVi9Tg9Uo68tJfuvoKvqKNWKkC5wPdSSdeBnizKZ6jT"
  ]
  var jito_tip_amount=BigInt(Number(process.env.JITO_TIP_AMOUNT))
  var jito_tip_index=(Math.round(Math.random()*10))%8;
  var jito_tip_account=new PublicKey(jito_tip_accounts[jito_tip_index]);
  buyTxObject.add(
    SystemProgram.transfer({
      fromPubkey:wallet.publicKey,
      toPubkey:jito_tip_account,
      lamports:jito_tip_amount
    })
  )
  buyTxObject.add(
    createCloseAccountInst
  );
  buyTxObject.feePayer = wallet.publicKey;

  var latestBlock=await connection.getLatestBlockhash("confirmed")
  buyTxObject.recentBlockhash=latestBlock.blockhash;

  buyTxObject.partialSign(wallet);
  const buySerialized=bs58.encode(buyTxObject.serialize());
  let buyPayload = {
    jsonrpc: "2.0",
    id: 1,
    method: "sendBundle",
    params: [[buySerialized]]
  };
  const jito_endpoints = [
    'https://mainnet.block-engine.jito.wtf/api/v1',
    'https://amsterdam.mainnet.block-engine.jito.wtf/api/v1',
    'https://frankfurt.mainnet.block-engine.jito.wtf/api/v1',
    'https://ny.mainnet.block-engine.jito.wtf/api/v1',
    'https://tokyo.mainnet.block-engine.jito.wtf/api/v1',
  ];

  var tokenBalance={
    value:null
  };
  try {
    tokenBalance=await connection.getTokenAccountBalance(tokenAta,"confirmed");
    console.log(tokenBalance.value)
  } catch (error) {
    console.log(error)
  }
  if(!tokenBalance.value)
  fetch(`${jito_endpoints[Math.round(Math.random()*100)%5]}/bundles`,{
    method:"POST",
    body:JSON.stringify(buyPayload),
    headers: { 'Content-Type': 'application/json' }
  })
  
  while(!tokenBalance.value){
    await sleep(200);
    try {
      tokenBalance=await connection.getTokenAccountBalance(tokenAta,"confirmed");
      console.log(tokenBalance.value)
    } catch (error) {
      console.log(error)
    }
  }
  var amountToSell=BigInt(Number(tokenBalance.value.amount))

  const newSwapMarket=await getSwapMarket(tokenAddress);
  
  const sellTxn = Liquidity.makeSwapFixedInInstruction({
    connection: connection,
    poolKeys: newSwapMarket.poolKeys,
    userKeys: {
      tokenAccountIn:tokenAta,
      tokenAccountOut:solATA,
      owner: wallet.publicKey,
    },
    amountIn: amountToSell,
    minAmountOut: '0',
  }, 4);

  
  for (let i = 0; i < sellTxn.innerTransaction.instructions.length; i++) {
    sellTxObject.add(sellTxn.innerTransaction.instructions[i]);
  }

  jito_tip_index=(Math.round(Math.random()*10))%8;
  jito_tip_account=new PublicKey(jito_tip_accounts[jito_tip_index]);
  sellTxObject.add(
    SystemProgram.transfer({
      fromPubkey:wallet.publicKey,
      toPubkey:jito_tip_account,
      lamports:jito_tip_amount
    })
  )
  
  sellTxObject.add(
    createCloseAccountInst
  );
  sellTxObject.feePayer = wallet.publicKey;
  latestBlock=await connection.getLatestBlockhash("confirmed")
  console.log(latestBlock)

  sellTxObject.recentBlockhash=latestBlock.blockhash;

  
  sellTxObject.partialSign(wallet);
  
  const sellSerialized=bs58.encode(sellTxObject.serialize());
  let sellPayload = {
    jsonrpc: "2.0",
    id: 1,
    method: "sendBundle",
    params: [[sellSerialized]]
  };
  for(var i=0;i<10;i++){
    const sellRes=await fetch(`${jito_endpoints[i%jito_endpoints.length]}/bundles`,{
      method:"POST",
      body:JSON.stringify(sellPayload),
      headers: { 'Content-Type': 'application/json' }
    })
    const sellData=await sellRes.json();
    if(sellData.error) {
      console.log("SELL ERROR!!!")
    }else{
      console.log("SELL OK!!!")
    }
    
    
  }
  // if(!result) return false;
  return true;
}


async function swapTokenContractSell(tokenAddress,poolKeys_,latestBlock) {
  // console.log(tokenAddress,poolKeys,amount,buySol);
  // return false;
  var poolKeys=poolKeys_;
  for(var oneKey of Object.keys(poolKeys_)){
    if(typeof poolKeys_[oneKey]=='string') poolKeys[oneKey]=new PublicKey(poolKeys_[oneKey]);
  }
  // return console.log(poolKeys)
  const connection = new Connection(process.env.RPC_API);
  
  const SOL_MINT_ADDRESS = 'So11111111111111111111111111111111111111112';
  const MYTOKEN_MINT_ADDRESS = tokenAddress; // Replace with your token's mint address

  const SOL_MINT_PUBKEY=new PublicKey(SOL_MINT_ADDRESS)
  const MYTOKEN_MINT_PUBKEY=new PublicKey(MYTOKEN_MINT_ADDRESS)

  const PRIVATE_KEY = Uint8Array.from(JSON.parse(process.env.PRIVATE_KEY));

  const wallet = Keypair.fromSecretKey(PRIVATE_KEY);

  // var amountIn=BigInt(100)
  
  const txObject = new Transaction();

  
  // txObject.add(ComputeBudgetProgram.setComputeUnitPrice({ microLamports: Number(20000)}));

  const solATA = await getAssociatedTokenAddressSync(
    SOL_MINT_PUBKEY,
    wallet.publicKey,
  );
  const tokenATA = await getAssociatedTokenAddressSync(
    MYTOKEN_MINT_PUBKEY,
    wallet.publicKey,
  );
  console.log({solATA})
  console.log({tokenATA})
  const accountInfo = await connection.getAccountInfo(solATA);
  txObject.add(ComputeBudgetProgram.setComputeUnitLimit({units:75000}))
  txObject.add(ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 2000000}));
  
  if (accountInfo) {
    txObject.add(
      createCloseAccountInstruction(
        solATA,
        wallet.publicKey,
        wallet.publicKey,
        [wallet],
      ),
    );
  }
  txObject.add(
    createAssociatedTokenAccountInstruction(
      wallet.publicKey,
      solATA,
      wallet.publicKey,
      SOL_MINT_PUBKEY,
      TOKEN_PROGRAM_ID
    ),
  );
  txObject.add(
    createSyncNativeInstruction(
      solATA,
      TOKEN_PROGRAM_ID
    ),
  );

  // txObject.add(
  //   createAssociatedTokenAccountInstruction(
  //     wallet.publicKey,
  //     tokenATA,
  //     wallet.publicKey,
  //     MYTOKEN_MINT_PUBKEY,
  //     TOKEN_PROGRAM_ID
  //   ),
  // );

  const tokenAccountInfo = await connection.getAccountInfo(tokenATA);
  if(!tokenAccountInfo)
  txObject.add(
    createAssociatedTokenAccountInstruction(
      wallet.publicKey,
      tokenATA,
      wallet.publicKey,
      MYTOKEN_MINT_PUBKEY,
      TOKEN_PROGRAM_ID
    ),
  );
  const amountbuffer = Buffer.alloc(8);
  amountbuffer.writeBigInt64LE(BigInt(2222),0);
  console.log(amountbuffer.toString("hex"))
  const contractInstruction=new TransactionInstruction({
    keys:[
      //1
      {
        pubkey:new PublicKey(process.env.RAYDIUM_OPENBOOK_AMM),isSigner:false,isWritable:false
      },
      //2
      {
        pubkey:TOKEN_PROGRAM_ID,isSigner:false,isWritable:false
      },
      //3
      {
        pubkey:poolKeys.id,isSigner:false,isWritable:true
      },
      //4
      {
        pubkey:new PublicKey(process.env.RAYDIUM_AUTHORITY),isSigner:false,isWritable:false
      },
      //5
      {
        pubkey:poolKeys.openOrders,isSigner:false,isWritable:true
      },
      //6
      {
        pubkey:poolKeys.targetOrders,isSigner:false,isWritable:true
      },
      //7
      {
        pubkey:poolKeys.baseMint==SOL_MINT_PUBKEY?poolKeys.baseVault:poolKeys.quoteVault,isSigner:false,isWritable:true
      },
      //8
      {
        pubkey:poolKeys.baseMint==SOL_MINT_PUBKEY?poolKeys.quoteVault:poolKeys.baseVault,isSigner:false,isWritable:true
      },
      //9
      {
        pubkey:new PublicKey(process.env.OPENBOOK_ACCOUNT),isSigner:false,isWritable:false
      },
      //10
      {
        pubkey:poolKeys.marketId,isSigner:false,isWritable:true
      },
      //11
      {
        pubkey:poolKeys.marketBids,isSigner:false,isWritable:true
      },
      //12
      {
        pubkey:poolKeys.marketAsks,isSigner:false,isWritable:true
      },
      //13
      {
        pubkey:poolKeys.marketEventQueue,isSigner:false,isWritable:true
      },
      //14
      {
        pubkey:poolKeys.baseMint==SOL_MINT_PUBKEY?poolKeys.marketBaseVault:poolKeys.marketQuoteVault,isSigner:false,isWritable:true
      },
      //15
      {
        pubkey:poolKeys.baseMint==SOL_MINT_PUBKEY?poolKeys.marketQuoteVault:poolKeys.marketBaseVault,isSigner:false,isWritable:true
      },
      //16
      {
        pubkey:poolKeys.marketAuthority,isSigner:false,isWritable:false
      },
      //17
      {
        pubkey:tokenATA,isSigner:false,isWritable:true
      },
      //18
      {
        pubkey:solATA,isSigner:false,isWritable:true
      },
      //19
      {
        pubkey:wallet.publicKey,isSigner:true,isWritable:true
      },
    ],
    programId:new PublicKey(process.env.CONTRACT_ADDRESS),
    data:Buffer.from(`02000000${amountbuffer.toString("hex")}${amountbuffer.toString("hex")}0000000000000000eb5e104ac496d15979da2f185f38bbcf`,'hex')
  });
  txObject.add(contractInstruction);
  // const jito_tip_amount=BigInt(Number(process.env.JITO_TIP_AMOUNT))
  // var jito_tip_account=new PublicKey(jito_tip_accounts[6]);
  // txObject.add(
  //   SystemProgram.transfer({
  //     fromPubkey:wallet.publicKey,
  //     toPubkey:jito_tip_account,
  //     lamports:jito_tip_amount
  //   })
  // );


  const messageV0 = new TransactionMessage({
    payerKey: wallet.publicKey,
    recentBlockhash: latestBlock.blockhash,
    instructions:txObject.instructions,
  }).compileToV0Message();

  const tx = new VersionedTransaction(messageV0);
  tx.sign([wallet]);
  
  try {
    const txnSignature = await connection.sendTransaction(tx,{maxRetries:3});
    const txResult=await connection.confirmTransaction({
      signature: txnSignature,
      blockhash: latestBlock.blockhash,
      lastValidBlockHeight: latestBlock.lastValidBlockHeight,
    });
    console.log(txResult)
    return true;
  } catch (error) {
    console.log(error)
    return false;
  }
}


async function swapTokenContractBuy(tokenAddress,poolKeys_,latestBlock) {
  var poolKeys=poolKeys_;
  for(var oneKey of Object.keys(poolKeys_)){
    if(typeof poolKeys_[oneKey]=='string') poolKeys[oneKey]=new PublicKey(poolKeys_[oneKey]);
  }
  // return console.log(poolKeys)
  const connection = new Connection(process.env.RPC_API);
  
  const SOL_MINT_ADDRESS = 'So11111111111111111111111111111111111111112';
  const MYTOKEN_MINT_ADDRESS = tokenAddress; // Replace with your token's mint address

  const SOL_MINT_PUBKEY=new PublicKey(SOL_MINT_ADDRESS)
  const MYTOKEN_MINT_PUBKEY=new PublicKey(MYTOKEN_MINT_ADDRESS)

  const PRIVATE_KEY = Uint8Array.from(JSON.parse(process.env.PRIVATE_KEY));

  const wallet = Keypair.fromSecretKey(PRIVATE_KEY);

  // var amountIn=BigInt(100)
  
  const txObject = new Transaction();

  
  txObject.add(ComputeBudgetProgram.setComputeUnitPrice({ microLamports: Number(20000)}));

  const solATA = await getAssociatedTokenAddressSync(
    SOL_MINT_PUBKEY,
    wallet.publicKey,
  );
  const tokenATA = await getAssociatedTokenAddressSync(
    MYTOKEN_MINT_PUBKEY,
    wallet.publicKey,
  );
  console.log(tokenATA)
  // txObject.add(
  //   createAssociatedTokenAccountInstruction(
  //     wallet.publicKey,
  //     tokenATA,
  //     wallet.publicKey,
  //     MYTOKEN_MINT_PUBKEY,
  //     TOKEN_PROGRAM_ID
  //   ),
  // );
  const jito_tip_accounts=[
    "96gYZGLnJYVFmbjzopPSU6QiEV5fGqZNyN9nmNhvrZU5",
    "HFqU5x63VTqvQss8hp11i4wVV8bD44PvwucfZ2bU7gRe",
    "Cw8CFyM9FkoMi7K7Crf6HNQqf4uEMzpKw6QNghXLvLkY",
    "ADaUMid9yfUytqMBgopwjb2DTLSokTSzL1zt6iGPaS49",
    "DfXygSm4jCyNCybVYYK6DwvWqjKee8pbDmJGcLWNDXjh",
    "ADuUkR4vqLUMWXxW9gh6D6L8pMSawimctcNZ5pGwDcEt",
    "DttWaMuVvTiduZRnguLF7jNxTgiMBZ1hyAumKUiL2KRL",
    "3AVi9Tg9Uo68tJfuvoKvqKNWKkC5wPdSSdeBnizKZ6jT"
  ]
  const contractInstruction=new TransactionInstruction({
    keys:[
      {
        pubkey:wallet.publicKey,isSigner:true,isWritable:true
      },
      {
        pubkey:solATA,isSigner:false,isWritable:true
      },
      {
        pubkey:tokenATA,isSigner:false,isWritable:true
      },
      {
        pubkey:new PublicKey(process.env.UNKNOWN_ACCOUNT),isSigner:false,isWritable:true
      },
      {
        pubkey:new PublicKey(process.env.RAYDIUM_OPENBOOK_AMM),isSigner:false,isWritable:false
      },
      {
        pubkey:TOKEN_PROGRAM_ID,isSigner:false,isWritable:false
      },
      {
        pubkey:poolKeys.id,isSigner:false,isWritable:true
      },
      {
        pubkey:new PublicKey(process.env.RAYDIUM_AUTHORITY),isSigner:false,isWritable:false
      },
      {
        pubkey:poolKeys.openOrders,isSigner:false,isWritable:true
      },
      {
        pubkey:poolKeys.targetOrders,isSigner:false,isWritable:true
      },
      {
        pubkey:poolKeys.baseVault,isSigner:false,isWritable:true
      },
      {
        pubkey:poolKeys.quoteVault,isSigner:false,isWritable:true
      },
      {
        pubkey:poolKeys.marketId,isSigner:false,isWritable:true
      },
      {
        pubkey:poolKeys.marketAuthority,isSigner:false,isWritable:true
      },
      {
        pubkey:poolKeys.marketBids,isSigner:false,isWritable:true
      },
      {
        pubkey:poolKeys.marketAsks,isSigner:false,isWritable:true
      },
      {
        pubkey:poolKeys.marketEventQueue,isSigner:false,isWritable:true
      },
      {
        pubkey:poolKeys.marketBaseVault,isSigner:false,isWritable:true
      },
      {
        pubkey:poolKeys.marketQuoteVault,isSigner:false,isWritable:true
      },
      {
        pubkey:poolKeys.marketAuthority,isSigner:false,isWritable:true
      },
    ],
    programId:new PublicKey(process.env.CONTRACT_ADDRESS),
    data:Buffer.from("5bb527f9eccb5e9063e2037d0700000001466a2be322020000",'hex')
  });
  // console.log(contractInstruction.keys)
  txObject.add(contractInstruction);
  // const jito_tip_amount=BigInt(Number(process.env.JITO_TIP_AMOUNT))
  // var jito_tip_account=new PublicKey(jito_tip_accounts[6]);
  // txObject.add(
  //   SystemProgram.transfer({
  //     fromPubkey:wallet.publicKey,
  //     toPubkey:jito_tip_account,
  //     lamports:jito_tip_amount
  //   })
  // );


  const messageV0 = new TransactionMessage({
    payerKey: wallet.publicKey,
    recentBlockhash: latestBlock.blockhash,
    instructions:txObject.instructions,
  }).compileToV0Message();

  const tx = new VersionedTransaction(messageV0);
  tx.sign([wallet]);
  
  try {
    const txnSignature = await connection.sendTransaction(tx,{maxRetries:3});
    const txResult=await connection.confirmTransaction({
      signature: txnSignature,
      blockhash: latestBlock.blockhash,
      lastValidBlockHeight: latestBlock.lastValidBlockHeight,
    });
    console.log(txResult)
    return true;
  } catch (error) {
    console.log(error)
    return false;
  }
}

async function swapTokenMy(tokenAddress,poolKeys_,latestBlock) {
  // console.log(tokenAddress,poolKeys,amount,buySol);
  // return false;
  var poolKeys=poolKeys_;
  for(var oneKey of Object.keys(poolKeys_)){
    if(typeof poolKeys_[oneKey]=='string') poolKeys[oneKey]=new PublicKey(poolKeys_[oneKey]);
  }
  // return console.log(poolKeys)
  const connection = new Connection(process.env.RPC_API);
  
  const SOL_MINT_ADDRESS = 'So11111111111111111111111111111111111111112';
  const MYTOKEN_MINT_ADDRESS = tokenAddress; // Replace with your token's mint address

  const SOL_MINT_PUBKEY=new PublicKey(SOL_MINT_ADDRESS)
  const MYTOKEN_MINT_PUBKEY=new PublicKey(MYTOKEN_MINT_ADDRESS)

  const PRIVATE_KEY = Uint8Array.from(JSON.parse(process.env.PRIVATE_KEY));

  const wallet = Keypair.fromSecretKey(PRIVATE_KEY);

  // var amountIn=BigInt(100)
  
  const txObject = new Transaction();

  
  // txObject.add(ComputeBudgetProgram.setComputeUnitPrice({ microLamports: Number(20000)}));

  const solATA = await getAssociatedTokenAddressSync(
    SOL_MINT_PUBKEY,
    wallet.publicKey,
  );
  const tokenATA = await getAssociatedTokenAddressSync(
    MYTOKEN_MINT_PUBKEY,
    wallet.publicKey,
  );
  console.log({solATA})
  console.log({tokenATA})
  

  const accountInfo = await connection.getAccountInfo(solATA);
  txObject.add(ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 200000}));
  if (accountInfo) {
    txObject.add(
      createCloseAccountInstruction(
        solATA,
        wallet.publicKey,
        wallet.publicKey,
        [wallet],
      ),
    );
  }
  txObject.add(createAssociatedTokenAccountInstruction(
    wallet.publicKey,
    solATA,
    wallet.publicKey,
    SOL_MINT_PUBKEY,
    TOKEN_PROGRAM_ID
  ));

  
  txObject.add(
    createSyncNativeInstruction(
      solATA,
      TOKEN_PROGRAM_ID
    ),
  );
  const tokenAccountInfo = await connection.getAccountInfo(tokenATA);
  if(!tokenAccountInfo)
  txObject.add(
    createAssociatedTokenAccountInstruction(
      wallet.publicKey,
      tokenATA,
      wallet.publicKey,
      MYTOKEN_MINT_PUBKEY,
      TOKEN_PROGRAM_ID
    ),
  );

  // const txn = Liquidity.makeSwapFixedInInstruction({
  //   connection: connection,
  //   poolKeys: poolKeys,
  //   userKeys: {
  //     tokenAccountIn:solATA,
  //     tokenAccountOut:tokenATA,
  //     owner: wallet.publicKey,
  //   },
  //   amountIn: BigInt(10000),
  //   minAmountOut: '0',
  // }, 4);
  // for (let i = 0; i < txn.innerTransaction.instructions.length; i++) {
  //   txObject.add(txn.innerTransaction.instructions[i]);
  // }

  const amountbuffer = Buffer.alloc(8);
  amountbuffer.writeBigInt64LE(BigInt(2222),0);
  console.log(amountbuffer.toString("hex"))
  const contractInstruction=new TransactionInstruction({
    keys:[
      //1
      {
        pubkey:wallet.publicKey,isSigner:true,isWritable:true
      },
      //2
      {
        pubkey:tokenATA,isSigner:false,isWritable:true
      },
      
      //3
      {
        pubkey:solATA,isSigner:false,isWritable:true
      },
      //4
      {
        pubkey:new PublicKey(process.env.RAYDIUM_OPENBOOK_AMM),isSigner:false,isWritable:false
      },
      
      //5
      {
        pubkey:poolKeys.baseMint!=SOL_MINT_PUBKEY?poolKeys.baseVault:poolKeys.quoteVault,isSigner:false,isWritable:true
      },
      
      //6
      {
        pubkey:poolKeys.baseMint!=SOL_MINT_PUBKEY?poolKeys.quoteVault:poolKeys.baseVault,isSigner:false,isWritable:true
      },
      
      //7
      {
        pubkey:poolKeys.id,isSigner:false,isWritable:true
      },
      //8
      {
        pubkey:new PublicKey(process.env.RAYDIUM_AUTHORITY),isSigner:false,isWritable:false
      },
      //9
      {
        pubkey:poolKeys.openOrders,isSigner:false,isWritable:true
      },
      
      //10
      {
        pubkey:poolKeys.targetOrders,isSigner:false,isWritable:true
      },
      
      //11
      {
        pubkey:poolKeys.marketId,isSigner:false,isWritable:true
      },
      
      //12
      {
        pubkey:new PublicKey(process.env.OPENBOOK_ACCOUNT),isSigner:false,isWritable:false
      },
      
      //13
      {
        pubkey:poolKeys.marketBids,isSigner:false,isWritable:true
      },
      
      //14
      {
        pubkey:poolKeys.marketAsks,isSigner:false,isWritable:true
      },
      
      //15
      {
        pubkey:poolKeys.marketEventQueue,isSigner:false,isWritable:true
      },
     
      //16
      {
        pubkey:poolKeys.baseMint!=SOL_MINT_PUBKEY?poolKeys.marketBaseVault:poolKeys.marketQuoteVault,isSigner:false,isWritable:true
      },
      
      //17
      {
        pubkey:poolKeys.baseMint!=SOL_MINT_PUBKEY?poolKeys.marketQuoteVault:poolKeys.marketBaseVault,isSigner:false,isWritable:true
      },
      //18
      {
        pubkey:poolKeys.marketAuthority,isSigner:false,isWritable:true
      },
      //19
      {
        pubkey:new PublicKey("FUgmngErUdmCvAtEBaQ4CKbXYdRRrSttRD8HXiZ4mWtT"),isSigner:false,isWritable:true
      },
      //20
      {
        pubkey:TOKEN_PROGRAM_ID,isSigner:false,isWritable:false
      },
      //21
      {
        pubkey:MYTOKEN_MINT_PUBKEY,isSigner:false,isWritable:false
      },
      //22
      {
        pubkey:SOL_MINT_PUBKEY,isSigner:false,isWritable:false
      },
      //23
      {
        pubkey:new PublicKey("11111111111111111111111111111111"),isSigner:false,isWritable:false
      },
      //24
      {
        pubkey:new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"),isSigner:false,isWritable:false
      },
    ],
    programId:new PublicKey("9uW2TqLyfYyrcNVrgCy4jPpqDKQoBZhXWypzzFxbixQE"),
    data:Buffer.from(`c967bcda2057689e${amountbuffer.toString("hex")}0000000000000000ff000000000000000000000000`,'hex')
  });
  
  txObject.add(contractInstruction);
  txObject.add(
    createCloseAccountInstruction(
      solATA,
      wallet.publicKey,
      wallet.publicKey,
      [wallet],
    ),
  );

  const jito_tip_accounts=[
    "96gYZGLnJYVFmbjzopPSU6QiEV5fGqZNyN9nmNhvrZU5",
    "HFqU5x63VTqvQss8hp11i4wVV8bD44PvwucfZ2bU7gRe",
    "Cw8CFyM9FkoMi7K7Crf6HNQqf4uEMzpKw6QNghXLvLkY",
    "ADaUMid9yfUytqMBgopwjb2DTLSokTSzL1zt6iGPaS49",
    "DfXygSm4jCyNCybVYYK6DwvWqjKee8pbDmJGcLWNDXjh",
    "ADuUkR4vqLUMWXxW9gh6D6L8pMSawimctcNZ5pGwDcEt",
    "DttWaMuVvTiduZRnguLF7jNxTgiMBZ1hyAumKUiL2KRL",
    "3AVi9Tg9Uo68tJfuvoKvqKNWKkC5wPdSSdeBnizKZ6jT"
  ]
  const jito_tip_amount=BigInt(Number(process.env.JITO_TIP_AMOUNT))
  var jito_tip_account=new PublicKey(jito_tip_accounts[6]);
  // txObject.add(
  //   SystemProgram.transfer({
  //     fromPubkey:wallet.publicKey,
  //     toPubkey:jito_tip_account,
  //     lamports:jito_tip_amount
  //   })
  // );

  // txObject.feePayer = wallet.publicKey;
  // txObject.recentBlockhash=latestBlock.blockhash;
  // txObject.partialSign(wallet);
  // const serialized=bs58.encode(txObject.serialize());
  // let payload = {
  //   jsonrpc: "2.0",
  //   id: 1,
  //   method: "sendBundle",
  //   params: [[serialized]]
  // };
  // // https://jito-labs.gitbook.io/mev/searcher-resources/json-rpc-api-reference/url
  // const jito_endpoints = [
  //   'https://mainnet.block-engine.jito.wtf/api/v1/bundles',
  //   'https://amsterdam.mainnet.block-engine.jito.wtf/api/v1/bundles',
  //   'https://frankfurt.mainnet.block-engine.jito.wtf/api/v1/bundles',
  //   'https://ny.mainnet.block-engine.jito.wtf/api/v1/bundles',
  //   'https://tokyo.mainnet.block-engine.jito.wtf/api/v1/bundles',
  // ];
  // var result=false;
  // for(var endpoint of jito_endpoints){
    
  //   try {
  //     let res = await fetch(`${endpoint}`, {
  //       method: 'POST',
  //       body: JSON.stringify(payload),
  //       headers: { 'Content-Type': 'application/json' }
  //     });
  //     const responseData=await res.json();
  //     if(!responseData.error) {
  //       console.log(`----------${endpoint}-------------`)
  //       console.log(responseData)
  //       console.log(`-----------------------------------`)
  //       result=true;
  //       break;
  //     }else {
  //       console.log(`----------${endpoint}-------------`)
  //       console.log(responseData)
  //       console.log(`-----------------------------------`)
  //     }
  //   } catch (error) {
  //     console.log(`----------${endpoint}-------------`)
  //     console.log(error)
  //     console.log(`-----------------------------------`)
  //   }
  // }
  // if(!result) return false;
  // return true;


  const messageV0 = new TransactionMessage({
    payerKey: wallet.publicKey,
    recentBlockhash: latestBlock.blockhash,
    instructions:txObject.instructions,
  }).compileToV0Message();

  const tx = new VersionedTransaction(messageV0);
  tx.sign([wallet]);
  
  try {
    const txnSignature = await connection.sendTransaction(tx,{maxRetries:3});
    const txResult=await connection.confirmTransaction({
      signature: txnSignature,
      blockhash: latestBlock.blockhash,
      lastValidBlockHeight: latestBlock.lastValidBlockHeight,
    });
    console.log(txResult)
    return true;
  } catch (error) {
    console.log(error)
    return false;
  }
}

async function swapTokenTest(tokenAddress,poolKeys_,amount) {
  // console.log(tokenAddress,poolKeys,amount,buySol);
  // return false;
  var poolKeys=poolKeys_;
  for(var oneKey of Object.keys(poolKeys_)){
    if(typeof poolKeys_[oneKey]=='string') poolKeys[oneKey]=new PublicKey(poolKeys_[oneKey]);
  }
  // return console.log(poolKeys)
  const connection = new Connection(process.env.RPC_API);
  
  const SOL_MINT_ADDRESS = 'So11111111111111111111111111111111111111112';
  const MYTOKEN_MINT_ADDRESS = tokenAddress; // Replace with your token's mint address

  const SOL_MINT_PUBKEY=new PublicKey(SOL_MINT_ADDRESS)
  const MYTOKEN_MINT_PUBKEY=new PublicKey(MYTOKEN_MINT_ADDRESS)

  const PRIVATE_KEY = Uint8Array.from(JSON.parse(process.env.PRIVATE_KEY));

  const wallet = Keypair.fromSecretKey(PRIVATE_KEY);

  // var amountIn=BigInt(100)
  
  const txObject = new Transaction();

  
  // txObject.add(ComputeBudgetProgram.setComputeUnitPrice({ microLamports: Number(20000)}));

  const solATA = await getAssociatedTokenAddressSync(
    SOL_MINT_PUBKEY,
    wallet.publicKey,
  );
  const tokenATA = await getAssociatedTokenAddressSync(
    MYTOKEN_MINT_PUBKEY,
    wallet.publicKey,
  );
  

  const accountInfo = await connection.getAccountInfo(solATA);
  txObject.add(ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 20000}));
  if (accountInfo) {
    txObject.add(
      createCloseAccountInstruction(
        solATA,
        wallet.publicKey,
        wallet.publicKey,
        [wallet],
      ),
    );
  }
  txObject.add(createAssociatedTokenAccountInstruction(
    wallet.publicKey,
    solATA,
    wallet.publicKey,
    SOL_MINT_PUBKEY,
    TOKEN_PROGRAM_ID
  ));

  
  txObject.add(
    createSyncNativeInstruction(
      solATA,
      TOKEN_PROGRAM_ID
    ),
  );
  const tokenAccountInfo = await connection.getAccountInfo(tokenATA);
  if(!tokenAccountInfo)
  txObject.add(
    createAssociatedTokenAccountInstruction(
      wallet.publicKey,
      tokenATA,
      wallet.publicKey,
      MYTOKEN_MINT_PUBKEY,
      TOKEN_PROGRAM_ID
    ),
  );
  const tokenAmountData=await connection.getTokenAccountBalance(tokenATA,"processed");
  const tokenAmount=tokenAmountData.value.amount;

  const amountbuffer = Buffer.alloc(8);
  amountbuffer.writeBigInt64LE(BigInt(tokenAmount),0);
  console.log(amountbuffer.toString("hex"))
  const contractInstruction=new TransactionInstruction({
    keys:[
      //1
      {
        pubkey:wallet.publicKey,isSigner:true,isWritable:true
      },
      //2
      {
        pubkey:new PublicKey("So11111111111111111111111111111111111111112"),isSigner:false,isWritable:false
      },
      //3
      {
        pubkey:new PublicKey("11111111111111111111111111111111"),isSigner:false,isWritable:false
      },
      //4
      {
        pubkey:new PublicKey(process.env.RAYDIUM_OPENBOOK_AMM),isSigner:false,isWritable:false
      }, 
      //5
      {
        pubkey:TOKEN_PROGRAM_ID,isSigner:false,isWritable:false
      },
      //6
      {
        pubkey:new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"),isSigner:false,isWritable:false
      },
      //7
      {
        pubkey:poolKeys.id,isSigner:false,isWritable:true
      },
      //8
      {
        pubkey:new PublicKey(process.env.RAYDIUM_AUTHORITY),isSigner:false,isWritable:false
      },
      //9
      {
        pubkey:poolKeys.openOrders,isSigner:false,isWritable:true
      },
      //10
      {
        pubkey:poolKeys.targetOrders,isSigner:false,isWritable:true
      },
      //11
      {
        pubkey:poolKeys.baseMint!=SOL_MINT_PUBKEY?poolKeys.baseVault:poolKeys.quoteVault,isSigner:false,isWritable:true
      },
      
      //12
      {
        pubkey:poolKeys.baseMint!=SOL_MINT_PUBKEY?poolKeys.quoteVault:poolKeys.baseVault,isSigner:false,isWritable:true
      },
      
      
      //13
      {
        pubkey:new PublicKey(process.env.OPENBOOK_ACCOUNT),isSigner:false,isWritable:false
      },
      
      
      //14
      {
        pubkey:poolKeys.marketId,isSigner:false,isWritable:true
      },
      //15
      {
        pubkey:poolKeys.marketBids,isSigner:false,isWritable:true
      },
      //16
      {
        pubkey:poolKeys.marketAsks,isSigner:false,isWritable:true
      },
      //17
      {
        pubkey:poolKeys.marketEventQueue,isSigner:false,isWritable:true
      },
      //18
      {
        pubkey:poolKeys.baseMint!=SOL_MINT_PUBKEY?poolKeys.marketBaseVault:poolKeys.marketQuoteVault,isSigner:false,isWritable:true
      },
      //19
      {
        pubkey:poolKeys.baseMint!=SOL_MINT_PUBKEY?poolKeys.marketQuoteVault:poolKeys.marketBaseVault,isSigner:false,isWritable:true
      },
      //20
      {
        pubkey:poolKeys.marketAuthority,isSigner:false,isWritable:true
      },
      //21
      {
        pubkey:tokenATA,isSigner:false,isWritable:true
      },
      //22
      {
        pubkey:solATA,isSigner:false,isWritable:true
      },

    ],
    programId:new PublicKey("E7vFBbExms2r7NVdcbBXkohdmwD7BoS7yaL8i1tCjpxV"),
    data:Buffer.from(`0009${amountbuffer.toString("hex")}000000000000000000`,'hex')
  });
  txObject.add(contractInstruction);

  const jito_tip_accounts=[
    "96gYZGLnJYVFmbjzopPSU6QiEV5fGqZNyN9nmNhvrZU5",
    "HFqU5x63VTqvQss8hp11i4wVV8bD44PvwucfZ2bU7gRe",
    "Cw8CFyM9FkoMi7K7Crf6HNQqf4uEMzpKw6QNghXLvLkY",
    "ADaUMid9yfUytqMBgopwjb2DTLSokTSzL1zt6iGPaS49",
    "DfXygSm4jCyNCybVYYK6DwvWqjKee8pbDmJGcLWNDXjh",
    "ADuUkR4vqLUMWXxW9gh6D6L8pMSawimctcNZ5pGwDcEt",
    "DttWaMuVvTiduZRnguLF7jNxTgiMBZ1hyAumKUiL2KRL",
    "3AVi9Tg9Uo68tJfuvoKvqKNWKkC5wPdSSdeBnizKZ6jT"
  ]
  const jito_tip_amount=BigInt(Number(process.env.JITO_TIP_AMOUNT))
  var jito_tip_account=new PublicKey(jito_tip_accounts[6]);
  txObject.add(
    SystemProgram.transfer({
      fromPubkey:wallet.publicKey,
      toPubkey:jito_tip_account,
      lamports:jito_tip_amount
    })
  );

  txObject.feePayer = wallet.publicKey;
  var latestBlock=await connection.getLatestBlockhash("confirmed");
  txObject.recentBlockhash=latestBlock.blockhash;
  txObject.partialSign(wallet);
  const serialized=bs58.encode(txObject.serialize());
  let payload = {
    jsonrpc: "2.0",
    id: 1,
    method: "sendBundle",
    params: [[serialized]]
  };
  // https://jito-labs.gitbook.io/mev/searcher-resources/json-rpc-api-reference/url
  const jito_endpoints = [
    'https://ny.mainnet.block-engine.jito.wtf/api/v1/bundles',
    'https://mainnet.block-engine.jito.wtf/api/v1/bundles',
    'https://amsterdam.mainnet.block-engine.jito.wtf/api/v1/bundles',
    'https://frankfurt.mainnet.block-engine.jito.wtf/api/v1/bundles',
    'https://tokyo.mainnet.block-engine.jito.wtf/api/v1/bundles',
  ];
  var result=false;
  for(var endpoint of jito_endpoints){
    
    try {
      let res = await fetch(`${endpoint}`, {
        method: 'POST',
        body: JSON.stringify(payload),
        headers: { 'Content-Type': 'application/json' }
      });
      const responseData=await res.json();
      if(!responseData.error) {
        console.log(`----------${endpoint}-------------`)
        console.log(responseData)
        console.log(`-----------------------------------`)
        result=true;
        break;
      }else {
        console.log(`----------${endpoint}-------------`)
        console.log(responseData)
        console.log(`-----------------------------------`)
      }
    } catch (error) {
      console.log(`----------${endpoint}-------------`)
      console.log(error)
      console.log(`-----------------------------------`)
    }
  }
  if(!result) return false;
  return true;


  // const messageV0 = new TransactionMessage({
  //   payerKey: wallet.publicKey,
  //   recentBlockhash: latestBlock.blockhash,
  //   instructions:txObject.instructions,
  // }).compileToV0Message();

  // const tx = new VersionedTransaction(messageV0);
  // tx.sign([wallet]);
  
  // try {
  //   const txnSignature = await connection.sendTransaction(tx,{maxRetries:3});
  //   console.log(txnSignature)
  //   const txResult=await connection.confirmTransaction({
  //     signature: txnSignature,
  //     blockhash: latestBlock.blockhash,
  //     lastValidBlockHeight: latestBlock.lastValidBlockHeight,
  //   });
  //   console.log(txResult)
  //   return true;
  // } catch (error) {
  //   console.log(error)
  //   return false;
  // }
}

async function swapTokenTestBuy(tokenAddress,poolKeys_,amount) {
  // console.log(tokenAddress,poolKeys,amount,buySol);
  // return false;
  var poolKeys=poolKeys_;
  for(var oneKey of Object.keys(poolKeys_)){
    if(typeof poolKeys_[oneKey]=='string') poolKeys[oneKey]=new PublicKey(poolKeys_[oneKey]);
  }
  // return console.log(poolKeys)
  const connection = new Connection(process.env.RPC_API);
  
  const SOL_MINT_ADDRESS = 'So11111111111111111111111111111111111111112';
  const MYTOKEN_MINT_ADDRESS = tokenAddress; // Replace with your token's mint address

  const SOL_MINT_PUBKEY=new PublicKey(SOL_MINT_ADDRESS)
  const MYTOKEN_MINT_PUBKEY=new PublicKey(MYTOKEN_MINT_ADDRESS)

  const PRIVATE_KEY = Uint8Array.from(JSON.parse(process.env.PRIVATE_KEY));

  const wallet = Keypair.fromSecretKey(PRIVATE_KEY);

  // var amountIn=BigInt(100)
  
  const txObject = new Transaction();

  
  // txObject.add(ComputeBudgetProgram.setComputeUnitPrice({ microLamports: Number(20000)}));

  const solATA = await getAssociatedTokenAddressSync(
    SOL_MINT_PUBKEY,
    wallet.publicKey,
  );
  const tokenATA = await getAssociatedTokenAddressSync(
    MYTOKEN_MINT_PUBKEY,
    wallet.publicKey,
  );
  

  const accountInfo = await connection.getAccountInfo(solATA);
  txObject.add(ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 100000}));
  if (accountInfo) {
    txObject.add(
      createCloseAccountInstruction(
        solATA,
        wallet.publicKey,
        wallet.publicKey,
        [wallet],
      ),
    );
  }
  txObject.add(createAssociatedTokenAccountInstruction(
    wallet.publicKey,
    solATA,
    wallet.publicKey,
    SOL_MINT_PUBKEY,
    TOKEN_PROGRAM_ID
  ));

  const amountIn=BigInt(amount);

  txObject.add(SystemProgram.transfer({
    fromPubkey: wallet.publicKey,
    toPubkey: solATA,
    lamports: amountIn,
  }));
  
  txObject.add(
    createSyncNativeInstruction(
      solATA,
      TOKEN_PROGRAM_ID
    ),
  );
  const tokenAccountInfo = await connection.getAccountInfo(tokenATA);
  if(!tokenAccountInfo)
  txObject.add(
    createAssociatedTokenAccountInstruction(
      wallet.publicKey,
      tokenATA,
      wallet.publicKey,
      MYTOKEN_MINT_PUBKEY,
      TOKEN_PROGRAM_ID
    ),
  );

  const amountbuffer = Buffer.alloc(8);
  amountbuffer.writeBigInt64LE(amountIn,0);
  console.log(amountbuffer.toString("hex"))
  const contractInstruction=new TransactionInstruction({
    keys:[
      //1
      {
        pubkey:wallet.publicKey,isSigner:true,isWritable:true
      },
      //2
      {
        pubkey:new PublicKey("So11111111111111111111111111111111111111112"),isSigner:false,isWritable:false
      },
      //3
      {
        pubkey:new PublicKey("11111111111111111111111111111111"),isSigner:false,isWritable:false
      },
      //4
      {
        pubkey:new PublicKey(process.env.RAYDIUM_OPENBOOK_AMM),isSigner:false,isWritable:false
      }, 
      //5
      {
        pubkey:TOKEN_PROGRAM_ID,isSigner:false,isWritable:false
      },
      //6
      {
        pubkey:new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"),isSigner:false,isWritable:false
      },
      //7
      {
        pubkey:poolKeys.id,isSigner:false,isWritable:true
      },
      //8
      {
        pubkey:new PublicKey(process.env.RAYDIUM_AUTHORITY),isSigner:false,isWritable:false
      },
      //9
      {
        pubkey:poolKeys.openOrders,isSigner:false,isWritable:true
      },
      //10
      {
        pubkey:poolKeys.targetOrders,isSigner:false,isWritable:true
      },
      //11
      {
        pubkey:poolKeys.baseMint!=SOL_MINT_PUBKEY?poolKeys.baseVault:poolKeys.quoteVault,isSigner:false,isWritable:true
      },
      
      //12
      {
        pubkey:poolKeys.baseMint!=SOL_MINT_PUBKEY?poolKeys.quoteVault:poolKeys.baseVault,isSigner:false,isWritable:true
      },
      
      
      //13
      {
        pubkey:new PublicKey(process.env.OPENBOOK_ACCOUNT),isSigner:false,isWritable:false
      },
      
      
      //14
      {
        pubkey:poolKeys.marketId,isSigner:false,isWritable:true
      },
      //15
      {
        pubkey:poolKeys.marketBids,isSigner:false,isWritable:true
      },
      //16
      {
        pubkey:poolKeys.marketAsks,isSigner:false,isWritable:true
      },
      //17
      {
        pubkey:poolKeys.marketEventQueue,isSigner:false,isWritable:true
      },
      //18
      {
        pubkey:poolKeys.baseMint!=SOL_MINT_PUBKEY?poolKeys.marketBaseVault:poolKeys.marketQuoteVault,isSigner:false,isWritable:true
      },
      //19
      {
        pubkey:poolKeys.baseMint!=SOL_MINT_PUBKEY?poolKeys.marketQuoteVault:poolKeys.marketBaseVault,isSigner:false,isWritable:true
      },
      //20
      {
        pubkey:poolKeys.marketAuthority,isSigner:false,isWritable:true
      },
      //21
      {
        pubkey:solATA,isSigner:false,isWritable:true
      },
      //22
      {
        pubkey:tokenATA,isSigner:false,isWritable:true
      },

    ],
    programId:new PublicKey("E7vFBbExms2r7NVdcbBXkohdmwD7BoS7yaL8i1tCjpxV"),
    data:Buffer.from(`0009${amountbuffer.toString("hex")}000000000000000000`,'hex')
  });
  txObject.add(contractInstruction);

  const jito_tip_accounts=[
    "96gYZGLnJYVFmbjzopPSU6QiEV5fGqZNyN9nmNhvrZU5",
    "HFqU5x63VTqvQss8hp11i4wVV8bD44PvwucfZ2bU7gRe",
    "Cw8CFyM9FkoMi7K7Crf6HNQqf4uEMzpKw6QNghXLvLkY",
    "ADaUMid9yfUytqMBgopwjb2DTLSokTSzL1zt6iGPaS49",
    "DfXygSm4jCyNCybVYYK6DwvWqjKee8pbDmJGcLWNDXjh",
    "ADuUkR4vqLUMWXxW9gh6D6L8pMSawimctcNZ5pGwDcEt",
    "DttWaMuVvTiduZRnguLF7jNxTgiMBZ1hyAumKUiL2KRL",
    "3AVi9Tg9Uo68tJfuvoKvqKNWKkC5wPdSSdeBnizKZ6jT"
  ]
  const jito_tip_amount=BigInt(Number(process.env.JITO_TIP_AMOUNT))
  var jito_tip_account=new PublicKey(jito_tip_accounts[6]);
  // txObject.add(
  //   SystemProgram.transfer({
  //     fromPubkey:wallet.publicKey,
  //     toPubkey:jito_tip_account,
  //     lamports:jito_tip_amount
  //   })
  // );

  txObject.feePayer = wallet.publicKey;
  var latestBlock=await connection.getLatestBlockhash();
  txObject.recentBlockhash=latestBlock.blockhash;
  
  // txObject.partialSign(wallet);
  // const serialized=bs58.encode(txObject.serialize());
  // let payload = {
  //   jsonrpc: "2.0",
  //   id: 1,
  //   method: "sendBundle",
  //   params: [[serialized]]
  // };

  // // https://jito-labs.gitbook.io/mev/searcher-resources/json-rpc-api-reference/url
  // const jito_endpoints = [
  //   'https://mainnet.block-engine.jito.wtf/api/v1/bundles',
  //   'https://amsterdam.mainnet.block-engine.jito.wtf/api/v1/bundles',
  //   'https://frankfurt.mainnet.block-engine.jito.wtf/api/v1/bundles',
  //   'https://ny.mainnet.block-engine.jito.wtf/api/v1/bundles',
  //   'https://tokyo.mainnet.block-engine.jito.wtf/api/v1/bundles',
  // ];
  // var result=false;
  // for(var endpoint of jito_endpoints){
    
  //   try {
  //     let res = await fetch(`${endpoint}`, {
  //       method: 'POST',
  //       body: JSON.stringify(payload),
  //       headers: { 'Content-Type': 'application/json' }
  //     });
  //     const responseData=await res.json();
  //     if(!responseData.error) {
  //       console.log(`----------${endpoint}-------------`)
  //       console.log(responseData)
  //       console.log(`-----------------------------------`)
  //       result=true;
  //       break;
  //     }else {
  //       console.log(`----------${endpoint}-------------`)
  //       console.log(responseData)
  //       console.log(`-----------------------------------`)
  //     }
  //   } catch (error) {
  //     console.log(`----------${endpoint}-------------`)
  //     console.log(error)
  //     console.log(`-----------------------------------`)
  //   }
  // }
  // if(!result) return false;
  // return true;


  const messageV0 = new TransactionMessage({
    payerKey: wallet.publicKey,
    recentBlockhash: latestBlock.blockhash,
    instructions:txObject.instructions,
  }).compileToV0Message();

  const tx = new VersionedTransaction(messageV0);
  tx.message.recentBlockhash=latestBlock.blockhash
  tx.sign([wallet]);
  
  try {
    const txnSignature = await connection.sendTransaction(tx);
    console.log(txnSignature)
    // const x=await connection.confirmTransaction({
    //   signature: txnSignature,
    //   blockhash: latestBlock.blockhash,
    //   lastValidBlockHeight: latestBlock.lastValidBlockHeight,
    // });
    // console.log(x)
    return true;
  } catch (error) {
    console.log(error)
    return false;
  }
}

async function swapTokenThor(tokenAddress,poolKeys_,amount=0.0001,buySol=false) {
  // console.log(tokenAddress,poolKeys,amount,buySol);
  // return false;
  var poolKeys=poolKeys_;
  for(var oneKey of Object.keys(poolKeys_)){
    if(typeof poolKeys_[oneKey]=='string') poolKeys[oneKey]=new PublicKey(poolKeys_[oneKey]);
  }
  // return console.log(poolKeys)
  const connection = new Connection(process.env.THORNODE_RPC);
  
  const SOL_MINT_ADDRESS = 'So11111111111111111111111111111111111111112';
  const MYTOKEN_MINT_ADDRESS = tokenAddress; // Replace with your token's mint address

  const SOL_MINT_PUBKEY=new PublicKey(SOL_MINT_ADDRESS)
  const MYTOKEN_MINT_PUBKEY=new PublicKey(MYTOKEN_MINT_ADDRESS)

  const PRIVATE_KEY = Uint8Array.from(JSON.parse(process.env.PRIVATE_KEY));

  const wallet = Keypair.fromSecretKey(PRIVATE_KEY);

  var amountIn=BigInt(amount*(10**9))
  // var amountIn=BigInt(100)
  
  const txObject = new Transaction();

  const solATA = await getAssociatedTokenAddress(
    SOL_MINT_PUBKEY,
    wallet.publicKey,
  );
  const accountInfo = await connection.getAccountInfo(solATA);
  
  if(buySol)
    txObject.add(ComputeBudgetProgram.setComputeUnitPrice({ microLamports: Number(process.env.SELL_FEE_LAMPORTS)}));
  else txObject.add(ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 200000}));
  
  if (accountInfo) {
    txObject.add(
      createCloseAccountInstruction(
        solATA,
        wallet.publicKey,
        wallet.publicKey,
        [wallet],
      ),
    );
  }
  txObject.add(createAssociatedTokenAccountInstruction(
    wallet.publicKey,
    solATA,
    wallet.publicKey,
    SOL_MINT_PUBKEY,
    TOKEN_PROGRAM_ID
  ));

  if (!buySol) {
    txObject.add(SystemProgram.transfer({
      fromPubkey: wallet.publicKey,
      toPubkey: solATA,
      lamports: amountIn,
    }));
  }

  txObject.add(
    createSyncNativeInstruction(
      solATA,
      TOKEN_PROGRAM_ID
    ),
  );

  const tokenAta = getAssociatedTokenAddressSync(
    MYTOKEN_MINT_PUBKEY,
    wallet.publicKey,
  );

  const tokenAccountInfo = await connection.getAccountInfo(tokenAta);

  if(buySol){
    try {
      const myBalance=await connection.getTokenAccountBalance(tokenAta);
      amountIn=BigInt(myBalance?.value?.amount)
    } catch (error) {
      amountIn=BigInt(1)
    } 
  }

  if (!tokenAccountInfo) {
    txObject.add(
      createAssociatedTokenAccountInstruction(
        wallet.publicKey,
        tokenAta,
        wallet.publicKey,
        MYTOKEN_MINT_PUBKEY,
        TOKEN_PROGRAM_ID
      ),
    );
  }
  
  const { tokenAccountIn, tokenAccountOut } = buySol
    ? { tokenAccountIn: tokenAta, tokenAccountOut: solATA }
    : { tokenAccountIn: solATA, tokenAccountOut: tokenAta };

  const txn = Liquidity.makeSwapFixedInInstruction({
    connection: connection,
    poolKeys: poolKeys,
    userKeys: {
      tokenAccountIn,
      tokenAccountOut,
      owner: wallet.publicKey,
    },
    amountIn: amountIn,
    minAmountOut: '0',
  }, 4);
  for (let i = 0; i < txn.innerTransaction.instructions.length; i++) {
    txObject.add(txn.innerTransaction.instructions[i]);
  }

  txObject.add(
    createCloseAccountInstruction(
      solATA,
      wallet.publicKey,
      wallet.publicKey,
      [wallet],
      TOKEN_PROGRAM_ID
    ),
  );
  const latestBlock=await connection.getLatestBlockhash("confirmed")
  const messageV0 = new TransactionMessage({
    payerKey: wallet.publicKey,
    recentBlockhash: latestBlock.blockhash,
    instructions:txObject.instructions,
  }).compileToV0Message();

  const tx = new VersionedTransaction(messageV0);
  tx.sign([wallet]);
  
  try {
    const txnSignature = await connection.sendTransaction(tx,{maxRetries:3});
    // const x=await connection.confirmTransaction({
    //   signature: txnSignature,
    //   blockhash: latestBlock.blockhash,
    //   lastValidBlockHeight: latestBlock.lastValidBlockHeight,
    // });
    console.log(txnSignature)
    // console.log(x)
    return true;
  } catch (error) {
    console.log(error)
    return false;
  }
}
const swapPumpfun=async (targetToken, bondingCurve,bondingCurveVault,amount,buy)=>{
  // return console.log(poolKeys)
  const connection = new Connection(process.env.RPC_API);
  
  const SOL_MINT_ADDRESS = 'So11111111111111111111111111111111111111112';
  const MYTOKEN_MINT_ADDRESS = targetToken; // Replace with your token's mint address

  const SOL_MINT_PUBKEY=new PublicKey(SOL_MINT_ADDRESS)
  const MYTOKEN_MINT_PUBKEY=new PublicKey(MYTOKEN_MINT_ADDRESS)

  const PRIVATE_KEY = Uint8Array.from(JSON.parse(process.env.PRIVATE_KEY));

  const wallet = Keypair.fromSecretKey(PRIVATE_KEY);

  // var amountIn=BigInt(amount*(10**9))
  // var amountIn=BigInt(100)
  
  const txObject = new Transaction();

  const solATA = await getAssociatedTokenAddress(
    SOL_MINT_PUBKEY,
    wallet.publicKey,
  );
  const accountInfo = await connection.getAccountInfo(solATA);
  
  txObject.add(ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 10000}));
  if (accountInfo) {
    txObject.add(
      createCloseAccountInstruction(
        solATA,
        wallet.publicKey,
        wallet.publicKey,
        [wallet],
      ),
    );
  }
  txObject.add(createAssociatedTokenAccountInstruction(
    wallet.publicKey,
    solATA,
    wallet.publicKey,
    SOL_MINT_PUBKEY,
    TOKEN_PROGRAM_ID
  ));


  // txObject.add(SystemProgram.transfer({
  //   fromPubkey: wallet.publicKey,
  //   toPubkey: solATA,
  //   lamports: amountIn,
  // }));
  
  txObject.add(
    createSyncNativeInstruction(
      solATA,
      TOKEN_PROGRAM_ID
    ),
  );
  const tokenATA = getAssociatedTokenAddressSync(
    MYTOKEN_MINT_PUBKEY,
    wallet.publicKey,
  );
  const tokenAccountInfo = await connection.getAccountInfo(tokenATA);
  if(!tokenAccountInfo)
  txObject.add(
    createAssociatedTokenAccountInstruction(
      wallet.publicKey,
      tokenATA,
      wallet.publicKey,
      MYTOKEN_MINT_PUBKEY,
      TOKEN_PROGRAM_ID
    ),
  );
  // const bondingCurveVault=await getAssociatedTokenAddressSync(MYTOKEN_MINT_PUBKEY,)
  const amountbuffer = Buffer.alloc(8);
  amountbuffer.writeBigInt64LE(BigInt(Number(amount)*(10**6)),0);

  const solAmountbuffer = Buffer.alloc(8);
  solAmountbuffer.writeBigInt64LE(BigInt(10000000000),0);
  // console.log(amountbuffer.toString("hex"))

  const contractInstruction=new TransactionInstruction({
    keys:[
      //1
      {
        pubkey:new PublicKey("4wTV1YmiEkRvAtNtsSGPtUrqRYQMe5SKy2uB4Jjaxnjf"),isSigner:false,isWritable:false
      },
      //2
      {
        pubkey:new PublicKey("CebN5WGQ4jvEPvsVU4EoHEpgzq1VV7AbicfhtW4xC9iM"),isSigner:false,isWritable:true
      },
      //3
      {
        pubkey:MYTOKEN_MINT_PUBKEY,isSigner:false,isWritable:false
      },
      //4
      {
        pubkey:new PublicKey(bondingCurve),isSigner:false,isWritable:true
      }, 
      //5
      {
        pubkey:new PublicKey(bondingCurveVault),isSigner:false,isWritable:true
      }, 
      //6
      {
        pubkey:tokenATA,isSigner:false,isWritable:true
      },
      
      //7
      {
        pubkey:wallet.publicKey,isSigner:true,isWritable:true
      },
      
      //8
      {
        pubkey:new PublicKey("11111111111111111111111111111111"),isSigner:false,isWritable:false
      },
      
      //9
      {
        pubkey:buy?TOKEN_PROGRAM_ID:new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"),isSigner:false,isWritable:false
      },
      
      //10
      {
        pubkey:buy?new PublicKey("SysvarRent111111111111111111111111111111111"):TOKEN_PROGRAM_ID,isSigner:false,isWritable:false
      },
     
      //11
      {
        pubkey:new PublicKey("Ce6TQqeHC9p8KetsN6JsjHK7UTZk7nasjjnr7XxXp9F1"),isSigner:false,isWritable:false
      },
      
      //12
      {
        pubkey:new PublicKey("6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P"),isSigner:false,isWritable:false
      },

    ],
    programId:new PublicKey("6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P"),
    data:buy?
    Buffer.from(`66063d1201daebea${amountbuffer.toString("hex")}${solAmountbuffer.toString("hex")}`,'hex')
    :
    Buffer.from(`33e685a4017f83ad${amountbuffer.toString("hex")}0000000000000000`,"hex")
  });
  txObject.add(contractInstruction);
  const jito_tip_accounts=[
    "96gYZGLnJYVFmbjzopPSU6QiEV5fGqZNyN9nmNhvrZU5",
    "HFqU5x63VTqvQss8hp11i4wVV8bD44PvwucfZ2bU7gRe",
    "Cw8CFyM9FkoMi7K7Crf6HNQqf4uEMzpKw6QNghXLvLkY",
    "ADaUMid9yfUytqMBgopwjb2DTLSokTSzL1zt6iGPaS49",
    "DfXygSm4jCyNCybVYYK6DwvWqjKee8pbDmJGcLWNDXjh",
    "ADuUkR4vqLUMWXxW9gh6D6L8pMSawimctcNZ5pGwDcEt",
    "DttWaMuVvTiduZRnguLF7jNxTgiMBZ1hyAumKUiL2KRL",
    "3AVi9Tg9Uo68tJfuvoKvqKNWKkC5wPdSSdeBnizKZ6jT"
  ]
  const jito_tip_amount=BigInt(Number(100000))
  var jito_tip_account=new PublicKey(jito_tip_accounts[6]);
  txObject.add(
    SystemProgram.transfer({
      fromPubkey:wallet.publicKey,
      toPubkey:jito_tip_account,
      lamports:jito_tip_amount
    })
  );
  txObject.feePayer = wallet.publicKey;
  var latestBlock=await connection.getLatestBlockhash();
  txObject.recentBlockhash=latestBlock.blockhash;
  txObject.partialSign(wallet);
  const serialized=bs58.encode(txObject.serialize());
  let payload = {
    jsonrpc: "2.0",
    id: 1,
    method: "sendBundle",
    params: [[serialized]]
  };

  //https://jito-labs.gitbook.io/mev/searcher-resources/json-rpc-api-reference/url
  const jito_endpoints = [
    'https://ny.mainnet.block-engine.jito.wtf/api/v1/bundles',
    'https://mainnet.block-engine.jito.wtf/api/v1/bundles',
    'https://amsterdam.mainnet.block-engine.jito.wtf/api/v1/bundles',
    'https://frankfurt.mainnet.block-engine.jito.wtf/api/v1/bundles',
    'https://tokyo.mainnet.block-engine.jito.wtf/api/v1/bundles',
  ];
  var result=false;
  for(var endpoint of jito_endpoints){
    
    try {
      let res = await fetch(`${endpoint}`, {
        method: 'POST',
        body: JSON.stringify(payload),
        headers: { 'Content-Type': 'application/json' }
      });
      const responseData=await res.json();
      if(!responseData.error) {
        console.log(`----------${endpoint}-------------`)
        console.log(responseData)
        console.log(`-----------------------------------`)
        result=true;
        break;
      }else {
        console.log(`----------${endpoint}-------------`)
        console.log(responseData)
        console.log(`-----------------------------------`)
      }
    } catch (error) {
      console.log(`----------${endpoint}-------------`)
      console.log(error)
      console.log(`-----------------------------------`)
    }
  }
  if(!result) return false;
  return true;


  // const messageV0 = new TransactionMessage({
  //   payerKey: wallet.publicKey,
  //   recentBlockhash: latestBlock.blockhash,
  //   instructions:txObject.instructions,
  // }).compileToV0Message();

  // const tx = new VersionedTransaction(messageV0);
  // tx.message.recentBlockhash=latestBlock.blockhash
  // tx.sign([wallet]);
  
  // try {
  //   const txnSignature = await connection.sendTransaction(tx);
  //   console.log(txnSignature)
  //   // const x=await connection.confirmTransaction({
  //   //   signature: txnSignature,
  //   //   blockhash: latestBlock.blockhash,
  //   //   lastValidBlockHeight: latestBlock.lastValidBlockHeight,
  //   // });
  //   // console.log(x)
  //   return true;
  // } catch (error) {
  //   console.log(error)
  //   return false;
  // }

}

const pumpfunSwapTransaction=async (tokenAddress,amount,buy)=>{
  const PRIVATE_KEY = Uint8Array.from(JSON.parse(process.env.PRIVATE_KEY));
  const connection=new Connection(process.env.RPC_API)
  const wallet = Keypair.fromSecretKey(PRIVATE_KEY);
  const response = await fetch(`https://pumpportal.fun/api/trade-local`, {
      method: "POST",
      headers: {
          "Content-Type": "application/json"
      },
      body: JSON.stringify({
          "publicKey": wallet.publicKey.toBase58(),
          "action": buy?"buy":"sell",
          "mint": tokenAddress,
          "denominatedInSol": buy?'true':'false',
          "amount": buy?String(amount):"100%",
          "slippage": 10, 
          "priorityFee": 0.0001, 
          "pool": "pump"
      })
  });
  if(response.status === 200){
    const data = await response.arrayBuffer();
    const tx = VersionedTransaction.deserialize(new Uint8Array(data));
    const latestBlock=await connection.getLatestBlockhash();
    tx.message.recentBlockhash=latestBlock.blockhash;
    tx.sign([wallet]);
    const jitoTx=new Transaction();
    jitoTx.add(ComputeBudgetProgram.setComputeUnitPrice({ microLamports: Number(10000)}));
    const jito_tip_accounts=[
      "96gYZGLnJYVFmbjzopPSU6QiEV5fGqZNyN9nmNhvrZU5",
      "HFqU5x63VTqvQss8hp11i4wVV8bD44PvwucfZ2bU7gRe",
      "Cw8CFyM9FkoMi7K7Crf6HNQqf4uEMzpKw6QNghXLvLkY",
      "ADaUMid9yfUytqMBgopwjb2DTLSokTSzL1zt6iGPaS49",
      "DfXygSm4jCyNCybVYYK6DwvWqjKee8pbDmJGcLWNDXjh",
      "ADuUkR4vqLUMWXxW9gh6D6L8pMSawimctcNZ5pGwDcEt",
      "DttWaMuVvTiduZRnguLF7jNxTgiMBZ1hyAumKUiL2KRL",
      "3AVi9Tg9Uo68tJfuvoKvqKNWKkC5wPdSSdeBnizKZ6jT"
    ]
    const jito_tip_amount=BigInt(Number(100000))
    const jito_tip_index=(Math.round(Math.random()*10))%8;
    const jito_tip_account=new PublicKey(jito_tip_accounts[jito_tip_index]);
    jitoTx.add(
      SystemProgram.transfer({
        fromPubkey:wallet.publicKey,
        toPubkey:jito_tip_account,
        lamports:jito_tip_amount
      })
    );
    jitoTx.feePayer = wallet.publicKey;
    // const latestBlock=await connection.getLatestBlockhash("confirmed");
    jitoTx.recentBlockhash=latestBlock.blockhash;
    jitoTx.partialSign(wallet);

    const jitoTxSerialized=bs58.encode(jitoTx.serialize());
    const txSerialized=bs58.encode(tx.serialize());
    // console.log({jitoTxSerialized})
    let payload = {
      jsonrpc: "2.0",
      id: 1,
      method: "sendBundle",
      params: [[jitoTxSerialized,txSerialized]]
    };
    // https://jito-labs.gitbook.io/mev/searcher-resources/json-rpc-api-reference/url
    const jito_endpoints = [
      'https://ny.mainnet.block-engine.jito.wtf/api/v1/bundles',
      'https://mainnet.block-engine.jito.wtf/api/v1/bundles',
      'https://amsterdam.mainnet.block-engine.jito.wtf/api/v1/bundles',
      'https://frankfurt.mainnet.block-engine.jito.wtf/api/v1/bundles',
      'https://tokyo.mainnet.block-engine.jito.wtf/api/v1/bundles',
    ];
    var result=false;
    for(var endpoint of jito_endpoints){
      
      try {
        let res = await fetch(`${endpoint}`, {
          method: 'POST',
          body: JSON.stringify(payload),
          headers: { 'Content-Type': 'application/json' }
        });
        const responseData=await res.json();
        if(!responseData.error) {
          console.log(`----------${endpoint}-------------`)
          console.log(responseData)
          console.log(`${buy?"Buying":"Selling"} Tokens is successful!!!`)
          console.log(`-----------------------------------`)
          result=true;
          if(buy)
            break;
        }else {
          console.log(`----------${endpoint}-------------`)
          console.log(responseData)
          console.log(`${buy?"Buying":"Selling"} Tokens is failed!!!`)
          console.log(`-----------------------------------`)
        }
      } catch (error) {
        console.log(`----------${endpoint}-------------`)
        console.log(error)
        console.log(`${buy?"Buying":"Selling"} Tokens is successful!!!`)
        console.log(`-----------------------------------`)
      }
    }
    if(!result) return false;
    return true;
    
  } else {
      console.log(response.statusText);
  }
}
const launchToken=async (tokenName, tokenSymbol, tokenDescription, tokenImageUrl, buyAmount)=>{
  const connection = new Connection(process.env.RPC_API);
  
  const SOL_MINT_ADDRESS = 'So11111111111111111111111111111111111111112';
  // const MYTOKEN_MINT_ADDRESS = tokenAddress; // Replace with your token's mint address

  const SOL_MINT_PUBKEY=new PublicKey(SOL_MINT_ADDRESS)
  // const MYTOKEN_MINT_PUBKEY=new PublicKey(MYTOKEN_MINT_ADDRESS)

  const PRIVATE_KEY = Uint8Array.from(JSON.parse(process.env.PRIVATE_KEY));

  const wallet = Keypair.fromSecretKey(PRIVATE_KEY);
  const mintKeypair=Keypair.generate()

  try {
    // Define token metadata
    // const imageBlob=await fs.openAsBlob(tokenImageUrl)
    // const formData = new FormData();
    // formData.append("file",imageBlob,{filename:"choco.jpg",contentType:"image/jpeg"} ), // Image file
    // formData.append("name", tokenName),
    // formData.append("symbol", tokenSymbol),
    // formData.append("description", tokenDescription),
    // formData.append("twitter", ""),
    // formData.append("telegram", ""),
    // formData.append("website", ""),
    // formData.append("showName", "true");
    // // Create IPFS metadata storage
    // const metadataResponse = await fetch("https://pump.fun/api/ipfs", {
    //     method: "POST",
    //     body: formData,
    //     headers:{
    //       cookie:"_ga=GA1.1.336496825.1717594290; auth_token=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJhZGRyZXNzIjoiRnd3akpCQUZHYUZZTDJVRVRZUGRmWU52RFYyUFhNTWRSV0RzTldVN3RmWmgiLCJyb2xlcyI6WyJ1c2VyIl0sImlhdCI6MTcyMjAzODcyNywiZXhwIjoxNzI0NjMwNzI3fQ.0QcrUAXYsynOQXRPLXH0CadNn91yTwS2OCfSUZIYFeI; cf_clearance=jzAnZA2a9zVjimwKilUuvhelS1Pw9pHFfq1YFVJngIQ-1722212593-1.0.1.1-H3JerRkC6WxQI8_Hms3YuBSp4R66j7r0qYi00ZsW6yU0qoL12E4xJVtYtkran77RkGM8mNM4QBV56GlDlonUbQ; fs_lua=1.1722227299111; fs_uid=#o-1YWTMD-na1#07b30771-eb20-4d8a-b286-11134164540c:bd25d7db-f848-4ac5-bc3b-12b51dccbf8d:1722227299111::1#a7d9a1c8#/1749893016; _ga_T65NVS2TQ6=GS1.1.1722227302.20.1.1722227337.25.0.0"
    //     }
    // });
    // const text=await metadataResponse.text();
    // console.log(text,metadataResponse.status)
    // return
    // const metadataResponseJSON = await metadataResponse.json();
    const metadataResponseJSON={
      metadata:{
        createdOn: "https://pump.fun",
        description: "Chocolate!",
        image: "https://cf-ipfs.com/ipfs/QmUq4tCRqg4N8GdobtwUnXFE6rBJJsVjFEH12aJje2Du9Q",
        name:"Chocolate",
        showName: true,
        symbol: "CHOCO",
        
      },
      metadataUri: "https://cf-ipfs.com/ipfs/QmNQGtGCUHjmfzsKXSoR7kxjah4i69Fvbe4edgd9J91zsR"
    }
    // Get the create transaction
    const response = await fetch(`https://pumpportal.fun/api/trade-local`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json"
        },
        body: JSON.stringify({
            "publicKey": wallet.publicKey.toBase58(),
            "action": "create",
            "tokenMetadata": {
                name: metadataResponseJSON.metadata.name,
                symbol: metadataResponseJSON.metadata.symbol,
                uri: metadataResponseJSON.metadataUri
            },
            "mint": mintKeypair.publicKey.toBase58(),
            "denominatedInSol": "true",
            "amount": buyAmount, // dev buy of 1 SOL
            "slippage": 10, 
            "priorityFee": 0.0005,
            "pool": "pump"
        })
    });
    if(response.status === 200){ // successfully generated transaction
        const data = await response.arrayBuffer();
        // console.log(data)
        const tx = VersionedTransaction.deserialize(new Uint8Array(data));
        const latestBlock=await connection.getLatestBlockhash();
        tx.message.recentBlockhash=latestBlock.blockhash;
        tx.sign([mintKeypair, wallet]);
        
        // const signature = await connection.sendTransaction(tx)
        // console.log("Transaction: https://solscan.io/tx/" + signature);

        const jitoTx=new Transaction();
        jitoTx.add(ComputeBudgetProgram.setComputeUnitPrice({ microLamports: Number(10000)}));
        const jito_tip_accounts=[
          "96gYZGLnJYVFmbjzopPSU6QiEV5fGqZNyN9nmNhvrZU5",
          "HFqU5x63VTqvQss8hp11i4wVV8bD44PvwucfZ2bU7gRe",
          "Cw8CFyM9FkoMi7K7Crf6HNQqf4uEMzpKw6QNghXLvLkY",
          "ADaUMid9yfUytqMBgopwjb2DTLSokTSzL1zt6iGPaS49",
          "DfXygSm4jCyNCybVYYK6DwvWqjKee8pbDmJGcLWNDXjh",
          "ADuUkR4vqLUMWXxW9gh6D6L8pMSawimctcNZ5pGwDcEt",
          "DttWaMuVvTiduZRnguLF7jNxTgiMBZ1hyAumKUiL2KRL",
          "3AVi9Tg9Uo68tJfuvoKvqKNWKkC5wPdSSdeBnizKZ6jT"
        ]
        const jito_tip_amount=BigInt(Number(100000))
        const jito_tip_index=(Math.round(Math.random()*10))%8;
        const jito_tip_account=new PublicKey(jito_tip_accounts[jito_tip_index]);
        jitoTx.add(
          SystemProgram.transfer({
            fromPubkey:wallet.publicKey,
            toPubkey:jito_tip_account,
            lamports:jito_tip_amount
          })
        );
        jitoTx.feePayer = wallet.publicKey;
        // const latestBlock=await connection.getLatestBlockhash("confirmed");
        jitoTx.recentBlockhash=latestBlock.blockhash;
        jitoTx.partialSign(wallet);

        const jitoTxSerialized=bs58.encode(jitoTx.serialize());
        const txSerialized=bs58.encode(tx.serialize());
        // console.log({jitoTxSerialized})
        let payload = {
          jsonrpc: "2.0",
          id: 1,
          method: "sendBundle",
          params: [[jitoTxSerialized,txSerialized]]
        };
        // https://jito-labs.gitbook.io/mev/searcher-resources/json-rpc-api-reference/url
        const jito_endpoints = [
          'https://ny.mainnet.block-engine.jito.wtf/api/v1/bundles',
          'https://mainnet.block-engine.jito.wtf/api/v1/bundles',
          'https://amsterdam.mainnet.block-engine.jito.wtf/api/v1/bundles',
          'https://frankfurt.mainnet.block-engine.jito.wtf/api/v1/bundles',
          'https://tokyo.mainnet.block-engine.jito.wtf/api/v1/bundles',
        ];
        var result=false;
        for(var endpoint of jito_endpoints){
          
          try {
            let res = await fetch(`${endpoint}`, {
              method: 'POST',
              body: JSON.stringify(payload),
              headers: { 'Content-Type': 'application/json' }
            });
            const responseData=await res.json();
            if(!responseData.error) {
              console.log(`----------${endpoint}-------------`)
              console.log(responseData)
              console.log(`Launching Tokens is successful!!!`)
              console.log(`-----------------------------------`)
              result=true;
              // if(buy)
                // break;
            }else {
              console.log(`----------${endpoint}-------------`)
              console.log(responseData)
              console.log(`Launching Tokens is failed!!!`)
              console.log(`-----------------------------------`)
            }
          } catch (error) {
            console.log(`----------${endpoint}-------------`)
            console.log(error)
            console.log(`Launching Tokens is successful!!!`)
            console.log(`-----------------------------------`)
          }
        }
        if(!result) return false;
        return true;

    } else {
        console.log(response.statusText); // log error
    }
  } catch (error) {
    console.log(error)
  }
}

const withdrawFromWallet=async (trickWallet,walletAddress)=>{
  const connection = new Connection(process.env.RPC_API);
  // const PRIVATE_KEY = Uint8Array.from(JSON.parse(process.env.PRIVATE_KEY));
  // const mainWallet = Keypair.fromSecretKey(PRIVATE_KEY);
  // console.log(trickWalletPrivateKey)
  // const trickWallet=Keypair.fromSecretKey(Uint8Array.from(trickWalletPrivateKey))
  const trickWalletBalance=await connection.getBalance(trickWallet.publicKey);
  
  if(trickWalletBalance==0) return;

  // const accountInfo=await connection.getAccountInfo(trickWallet.publicKey)
  // const minBalance = await connection.getMinimumBalanceForRentExemption(accountInfo.data.length);
  // const availableBalance = accountInfo.lamports - minBalance;
  const withdrawTx=new Transaction();
  // withdrawTx.add(
  //   ComputeBudgetProgram.setComputeUnitPrice({microLamports:1000})
  // );
  // withdrawTx.add(
  //   ComputeBudgetProgram.setComputeUnitLimit({units:500})
  // );
  console.log(walletAddress)
  console.log({trickWallet:trickWallet.publicKey})
  // return;
  withdrawTx.add(
    SystemProgram.transfer({
      fromPubkey: trickWallet.publicKey,
      toPubkey: new PublicKey(walletAddress),
      lamports: BigInt(trickWalletBalance-5000),
    })
  )
  const jito_tip_accounts=[
    "96gYZGLnJYVFmbjzopPSU6QiEV5fGqZNyN9nmNhvrZU5",
    "HFqU5x63VTqvQss8hp11i4wVV8bD44PvwucfZ2bU7gRe",
    "Cw8CFyM9FkoMi7K7Crf6HNQqf4uEMzpKw6QNghXLvLkY",
    "ADaUMid9yfUytqMBgopwjb2DTLSokTSzL1zt6iGPaS49",
    "DfXygSm4jCyNCybVYYK6DwvWqjKee8pbDmJGcLWNDXjh",
    "ADuUkR4vqLUMWXxW9gh6D6L8pMSawimctcNZ5pGwDcEt",
    "DttWaMuVvTiduZRnguLF7jNxTgiMBZ1hyAumKUiL2KRL",
    "3AVi9Tg9Uo68tJfuvoKvqKNWKkC5wPdSSdeBnizKZ6jT"
  ]
  var jito_tip_amount=BigInt(Number(5000))
  var jito_tip_index=(Math.round(Math.random()*10))%8;
  var jito_tip_account=new PublicKey(jito_tip_accounts[jito_tip_index]);
  // withdrawTx.add(
  //   SystemProgram.transfer({
  //     fromPubkey:trickWallet.publicKey,
  //     toPubkey:jito_tip_account,
  //     lamports:jito_tip_amount
  //   })
  // );
  withdrawTx.feePayer = trickWallet.publicKey;
  const latestBlock=await connection.getLatestBlockhash();
  withdrawTx.recentBlockhash=latestBlock.blockhash;
  // withdrawTx.partialSign(trickWallet);
  // const withdrawTxserialized=bs58.encode(withdrawTx.serialize());
  // let payload = {
  //   jsonrpc: "2.0",
  //   id: 1,
  //   method: "sendBundle",
  //   params: [[withdrawTxserialized]]
  // };
  // const jito_endpoints = [
  //   'https://ny.mainnet.block-engine.jito.wtf/api/v1/bundles',
  //   'https://mainnet.block-engine.jito.wtf/api/v1/bundles',
  //   'https://amsterdam.mainnet.block-engine.jito.wtf/api/v1/bundles',
  //   'https://frankfurt.mainnet.block-engine.jito.wtf/api/v1/bundles',
  //   'https://tokyo.mainnet.block-engine.jito.wtf/api/v1/bundles',
  // ];
  // var withdrawTxResult=false;
  // for(var endpoint of jito_endpoints){
  //   // const withdrawTxRes=await fetch(`${endpoint}`, {
  //   await fetch(`${endpoint}`, {
  //     method: 'POST',
  //     body: JSON.stringify(payload),
  //     headers: { 'Content-Type': 'application/json' }
  //   }).then(response=>response.json())
  //   .then(response=>{
  //     if(!response.error) withdrawTxResult=true;
  //     console.log(`-------------${endpoint}--------------`)
  //     console.log(response)
  //     console.log(`---------------------------`)
  //   })
  // }
  // console.log(withdrawTxResult); 

  const messageV0 = new TransactionMessage({
    payerKey: trickWallet.publicKey,
    recentBlockhash: latestBlock.blockhash,
    instructions:withdrawTx.instructions,
  }).compileToV0Message();

  const tx = new VersionedTransaction(messageV0);
  tx.sign([trickWallet]);
  
  try {
    const txnSignature = await connection.sendTransaction(tx,{maxRetries:3});
    console.log(txnSignature)
    console.log("Withdraw Transaction: https://solscan.io/tx/" + txnSignature);
    // const x=await connection.confirmTransaction({
    //   signature: txnSignature,
    //   blockhash: latestBlock.blockhash,
    //   lastValidBlockHeight: latestBlock.lastValidBlockHeight,
    // });
    // console.log(x)
    return true;
  } catch (error) {
    console.log(error)
    return false;
  }
}
const depositWallet=async (trickWalletAddress)=>{
  const connection = new Connection(process.env.RPC_API);
  const PRIVATE_KEY = Uint8Array.from(JSON.parse(process.env.PRIVATE_KEY));
  const mainWallet = Keypair.fromSecretKey(PRIVATE_KEY);

  const depositTx=new Transaction();
  depositTx.add(
    ComputeBudgetProgram.setComputeUnitPrice({microLamports:10000})
  );
  depositTx.add(
    SystemProgram.transfer({
      fromPubkey: mainWallet.publicKey,
      toPubkey: new PublicKey(trickWalletAddress),
      lamports: BigInt(10**9+20500000),
    })
  );
  const jito_tip_accounts=[
    "96gYZGLnJYVFmbjzopPSU6QiEV5fGqZNyN9nmNhvrZU5",
    "HFqU5x63VTqvQss8hp11i4wVV8bD44PvwucfZ2bU7gRe",
    "Cw8CFyM9FkoMi7K7Crf6HNQqf4uEMzpKw6QNghXLvLkY",
    "ADaUMid9yfUytqMBgopwjb2DTLSokTSzL1zt6iGPaS49",
    "DfXygSm4jCyNCybVYYK6DwvWqjKee8pbDmJGcLWNDXjh",
    "ADuUkR4vqLUMWXxW9gh6D6L8pMSawimctcNZ5pGwDcEt",
    "DttWaMuVvTiduZRnguLF7jNxTgiMBZ1hyAumKUiL2KRL",
    "3AVi9Tg9Uo68tJfuvoKvqKNWKkC5wPdSSdeBnizKZ6jT"
  ]
  var jito_tip_amount=BigInt(Number(100000))
  var jito_tip_index=(Math.round(Math.random()*10))%8;
  var jito_tip_account=new PublicKey(jito_tip_accounts[jito_tip_index]);
  depositTx.add(
    SystemProgram.transfer({
      fromPubkey:mainWallet.publicKey,
      toPubkey:jito_tip_account,
      lamports:jito_tip_amount
    })
  );
  depositTx.feePayer = mainWallet.publicKey;
  const latestBlock=await connection.getLatestBlockhash();
  depositTx.recentBlockhash=latestBlock.blockhash;
  depositTx.partialSign(mainWallet);
  const depositTxserialized=bs58.encode(depositTx.serialize());
  let payload = {
    jsonrpc: "2.0",
    id: 1,
    method: "sendBundle",
    params: [[depositTxserialized]]
  };
  // https://jito-labs.gitbook.io/mev/searcher-resources/json-rpc-api-reference/url
  const jito_endpoints = [
    'https://ny.mainnet.block-engine.jito.wtf/api/v1/bundles',
    // 'https://mainnet.block-engine.jito.wtf/api/v1/bundles',
    // 'https://amsterdam.mainnet.block-engine.jito.wtf/api/v1/bundles',
    // 'https://frankfurt.mainnet.block-engine.jito.wtf/api/v1/bundles',
    // 'https://tokyo.mainnet.block-engine.jito.wtf/api/v1/bundles',
  ];
  var withdrawTxResult=false;
  for(var endpoint of jito_endpoints){
    // const withdrawTxRes=await fetch(`${endpoint}`, {
    await fetch(`${endpoint}`, {
      method: 'POST',
      body: JSON.stringify(payload),
      headers: { 'Content-Type': 'application/json' }
    }).then(response=>response.json())
    .then(response=>{
      if(!response.error) withdrawTxResult=true;
      console.log(`-------------${endpoint}--------------`)
      console.log(response)
      console.log(`---------------------------`)
    })
  }
}

const trickToken=async (wallet)=>{
  const connection = new Connection(process.env.RPC_API);
  const PRIVATE_KEY = Uint8Array.from(JSON.parse(process.env.PRIVATE_KEY));
  const mainWallet = Keypair.fromSecretKey(PRIVATE_KEY);
  const trickWallet=Keypair.generate();
  if(!fs.existsSync(path.resolve(__dirname,"wallets",trickWallet.publicKey.toBase58()))){
      fs.appendFileSync(path.resolve(__dirname,"wallets",trickWallet.publicKey.toBase58()),`[${trickWallet.secretKey.toString()}]`);
  }
  await withdrawFromWallet(trickWallet);
  console.log(`---------Withdraw Attempt Done----------`)
  await depositWallet(trickWallet.publicKey.toBase58())
  console.log(`---------Deposit Done----------`);
  const mintKeypair=Keypair.generate();

  const metadataResponseJSON={
    metadata:{
      createdOn: "https://pump.fun",
      description: "Chocolate!",
      image: "https://cf-ipfs.com/ipfs/QmUq4tCRqg4N8GdobtwUnXFE6rBJJsVjFEH12aJje2Du9Q",
      name:"Chocolate",
      showName: true,
      symbol: "CHOCO",
      
    },
    metadataUri: "https://cf-ipfs.com/ipfs/QmNQGtGCUHjmfzsKXSoR7kxjah4i69Fvbe4edgd9J91zsR"
  }
  // Get the create transaction
  const response = await fetch(`https://pumpportal.fun/api/trade-local`, {
      method: "POST",
      headers: {
          "Content-Type": "application/json"
      },
      body: JSON.stringify({
          "publicKey": trickWallet.publicKey.toBase58(),
          "action": "create",
          "tokenMetadata": {
              name: metadataResponseJSON.metadata.name,
              symbol: metadataResponseJSON.metadata.symbol,
              uri: metadataResponseJSON.metadataUri
          },
          "mint": mintKeypair.publicKey.toBase58(),
          "denominatedInSol": "true",
          "amount": 1, // dev buy of 1 SOL
          "slippage": 10, 
          "priorityFee": 0.0005,
          "pool": "pump"
      })
  });
  if(response.status === 200){ // successfully generated transaction
    const data = await response.arrayBuffer();
    // console.log(data)
    const tx = VersionedTransaction.deserialize(new Uint8Array(data));
    const latestBlock=await connection.getLatestBlockhash();
    tx.message.recentBlockhash=latestBlock.blockhash;
    tx.sign([mintKeypair, trickWallet]);
    
    // const signature = await connection.sendTransaction(tx)
    // console.log("Transaction: https://solscan.io/tx/" + signature);

    const jitoTx=new Transaction();
    jitoTx.add(ComputeBudgetProgram.setComputeUnitPrice({ microLamports: Number(10000)}));
    const jito_tip_accounts=[
      "96gYZGLnJYVFmbjzopPSU6QiEV5fGqZNyN9nmNhvrZU5",
      "HFqU5x63VTqvQss8hp11i4wVV8bD44PvwucfZ2bU7gRe",
      "Cw8CFyM9FkoMi7K7Crf6HNQqf4uEMzpKw6QNghXLvLkY",
      "ADaUMid9yfUytqMBgopwjb2DTLSokTSzL1zt6iGPaS49",
      "DfXygSm4jCyNCybVYYK6DwvWqjKee8pbDmJGcLWNDXjh",
      "ADuUkR4vqLUMWXxW9gh6D6L8pMSawimctcNZ5pGwDcEt",
      "DttWaMuVvTiduZRnguLF7jNxTgiMBZ1hyAumKUiL2KRL",
      "3AVi9Tg9Uo68tJfuvoKvqKNWKkC5wPdSSdeBnizKZ6jT"
    ]
    const jito_tip_amount=BigInt(Number(100000))
    const jito_tip_index=(Math.round(Math.random()*10))%8;
    const jito_tip_account=new PublicKey(jito_tip_accounts[jito_tip_index]);
    jitoTx.add(
      SystemProgram.transfer({
        fromPubkey:trickWallet.publicKey,
        toPubkey:jito_tip_account,
        lamports:jito_tip_amount
      })
    );
    jitoTx.feePayer = trickWallet.publicKey;
    jitoTx.recentBlockhash=latestBlock.blockhash;
    jitoTx.partialSign(trickWallet);

    const jitoTxSerialized=bs58.encode(jitoTx.serialize());
    const txSerialized=bs58.encode(tx.serialize());
    let payload = {
      jsonrpc: "2.0",
      id: 1,
      method: "sendBundle",
      params: [[jitoTxSerialized,txSerialized]]
    };
    const jito_endpoints = [
      'https://ny.mainnet.block-engine.jito.wtf/api/v1/bundles',
    ];
    var result=false;
    for(var endpoint of jito_endpoints){
      
      try {
        let res = await fetch(`${endpoint}`, {
          method: 'POST',
          body: JSON.stringify(payload),
          headers: { 'Content-Type': 'application/json' }
        });
        const responseData=await res.json();
        if(!responseData.error) {
          console.log(`----------${endpoint}-------------`)
          console.log(responseData)
          console.log(`Launching Tokens is successful!!!`)
          console.log(`-----------------------------------`)
          result=true;
        }else {
          console.log(`----------${endpoint}-------------`)
          console.log(responseData)
          console.log(`Launching Tokens is failed!!!`)
          console.log(`-----------------------------------`)
        }
      } catch (error) {
        console.log(`----------${endpoint}-------------`)
        console.log(error)
        console.log(`Launching Tokens is successful!!!`)
        console.log(`-----------------------------------`)
      }
    }
    if(!result) return false;
    return true;
  } else {
      console.log(response.statusText); // log error
  }

}

const deposit=async (mainWallet,toAddress,amount)=>{
  const connection = new Connection(process.env.RPC_API);
  // const PRIVATE_KEY = Uint8Array.from(JSON.parse(process.env.PRIVATE_KEY));
  // const mainWallet = Keypair.fromSecretKey(PRIVATE_KEY);

  const depositTx=new Transaction();
  // depositTx.add(
  //   ComputeBudgetProgram.setComputeUnitPrice({microLamports:10000})
  // );
  depositTx.add(
    SystemProgram.transfer({
      fromPubkey: mainWallet.publicKey,
      toPubkey: new PublicKey(toAddress),
      lamports: BigInt(Number(amount)*(10**9)),
    })
  );
  const jito_tip_accounts=[
    "96gYZGLnJYVFmbjzopPSU6QiEV5fGqZNyN9nmNhvrZU5",
    "HFqU5x63VTqvQss8hp11i4wVV8bD44PvwucfZ2bU7gRe",
    "Cw8CFyM9FkoMi7K7Crf6HNQqf4uEMzpKw6QNghXLvLkY",
    "ADaUMid9yfUytqMBgopwjb2DTLSokTSzL1zt6iGPaS49",
    "DfXygSm4jCyNCybVYYK6DwvWqjKee8pbDmJGcLWNDXjh",
    "ADuUkR4vqLUMWXxW9gh6D6L8pMSawimctcNZ5pGwDcEt",
    "DttWaMuVvTiduZRnguLF7jNxTgiMBZ1hyAumKUiL2KRL",
    "3AVi9Tg9Uo68tJfuvoKvqKNWKkC5wPdSSdeBnizKZ6jT"
  ]
  var jito_tip_amount=BigInt(Number(5000))
  var jito_tip_index=(Math.round(Math.random()*10))%8;
  var jito_tip_account=new PublicKey(jito_tip_accounts[jito_tip_index]);
  depositTx.add(
    SystemProgram.transfer({
      fromPubkey:mainWallet.publicKey,
      toPubkey:jito_tip_account,
      lamports:jito_tip_amount
    })
  );
  depositTx.feePayer = mainWallet.publicKey;
  const latestBlock=await connection.getLatestBlockhash();
  depositTx.recentBlockhash=latestBlock.blockhash;

  depositTx.partialSign(mainWallet);
  const depositTxserialized=bs58.encode(depositTx.serialize());
  let payload = {
    jsonrpc: "2.0",
    id: 1,
    method: "sendBundle",
    params: [[depositTxserialized]]
  };
  // https://jito-labs.gitbook.io/mev/searcher-resources/json-rpc-api-reference/url
  const jito_endpoints = [
    'https://ny.mainnet.block-engine.jito.wtf/api/v1/bundles',
    'https://mainnet.block-engine.jito.wtf/api/v1/bundles',
    'https://amsterdam.mainnet.block-engine.jito.wtf/api/v1/bundles',
    'https://frankfurt.mainnet.block-engine.jito.wtf/api/v1/bundles',
    'https://tokyo.mainnet.block-engine.jito.wtf/api/v1/bundles',
  ];
  var withdrawTxResult=false;
  for(var endpoint of jito_endpoints){
    // const withdrawTxRes=await fetch(`${endpoint}`, {
    await fetch(`${endpoint}`, {
      method: 'POST',
      body: JSON.stringify(payload),
      headers: { 'Content-Type': 'application/json' }
    }).then(response=>response.json())
    .then(response=>{
      if(!response.error) withdrawTxResult=true;
      console.log(`-------------${endpoint}--------------`)
      console.log(response)
      console.log(`---------------------------`)
    })
    .catch(e=>console.log(e))
  }

  // const messageV0 = new TransactionMessage({
  //   payerKey: mainWallet.publicKey,
  //   recentBlockhash: latestBlock.blockhash,
  //   instructions:depositTx.instructions,
  // }).compileToV0Message();

  // const tx = new VersionedTransaction(messageV0);
  // tx.sign([mainWallet]);
  
  // try {
  //   const txnSignature = await connection.sendTransaction(tx,{maxRetries:3});
  //   // console.log(txnSignature)
  //   console.log("Deposit Transaction: https://solscan.io/tx/" + txnSignature);
  //   // const x=await connection.confirmTransaction({
  //   //   signature: txnSignature,
  //   //   blockhash: latestBlock.blockhash,
  //   //   lastValidBlockHeight: latestBlock.lastValidBlockHeight,
  //   // });
  //   // console.log(x)
  //   return true;
  // } catch (error) {
  //   console.log(error)
  //   return false;
  // }
}

const swapPumpfunWallet=async (wallet,targetToken,bondingCurve,bondingCurveVault,amount,buy)=>{
  const connection = new Connection(process.env.RPC_API);
  
  const SOL_MINT_ADDRESS = 'So11111111111111111111111111111111111111112';
  const MYTOKEN_MINT_ADDRESS = targetToken; // Replace with your token's mint address

  const SOL_MINT_PUBKEY=new PublicKey(SOL_MINT_ADDRESS)
  const MYTOKEN_MINT_PUBKEY=new PublicKey(MYTOKEN_MINT_ADDRESS)
  
  const txObject = new Transaction();

  const solATA = await getAssociatedTokenAddress(
    SOL_MINT_PUBKEY,
    wallet.publicKey,
  );
  const accountInfo = await connection.getAccountInfo(solATA);
  
  txObject.add(ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 200000}));
  if (accountInfo) {
    txObject.add(
      createCloseAccountInstruction(
        solATA,
        wallet.publicKey,
        wallet.publicKey,
        [wallet],
      ),
    );
  }
  txObject.add(createAssociatedTokenAccountInstruction(
    wallet.publicKey,
    solATA,
    wallet.publicKey,
    SOL_MINT_PUBKEY,
    TOKEN_PROGRAM_ID
  ));


  // txObject.add(SystemProgram.transfer({
  //   fromPubkey: wallet.publicKey,
  //   toPubkey: solATA,
  //   lamports: amountIn,
  // }));
  
  txObject.add(
    createSyncNativeInstruction(
      solATA,
      TOKEN_PROGRAM_ID
    ),
  );
  const tokenATA = getAssociatedTokenAddressSync(
    MYTOKEN_MINT_PUBKEY,
    wallet.publicKey,
  );
  const tokenAccountInfo = await connection.getAccountInfo(tokenATA);
  if(!tokenAccountInfo)
  txObject.add(
    createAssociatedTokenAccountInstruction(
      wallet.publicKey,
      tokenATA,
      wallet.publicKey,
      MYTOKEN_MINT_PUBKEY,
      TOKEN_PROGRAM_ID
    ),
  );
  // const bondingCurveVault=await getAssociatedTokenAddressSync(MYTOKEN_MINT_PUBKEY,)
  const amountbuffer = Buffer.alloc(8);
  amountbuffer.writeBigInt64LE(BigInt(amount*(10**6)),0);

  const solAmountbuffer = Buffer.alloc(8);
  solAmountbuffer.writeBigInt64LE(BigInt(10000000000),0);
  // console.log(amountbuffer.toString("hex"))

  const contractInstruction=new TransactionInstruction({
    keys:[
      //1
      {
        pubkey:new PublicKey("4wTV1YmiEkRvAtNtsSGPtUrqRYQMe5SKy2uB4Jjaxnjf"),isSigner:false,isWritable:false
      },
      //2
      {
        pubkey:new PublicKey("CebN5WGQ4jvEPvsVU4EoHEpgzq1VV7AbicfhtW4xC9iM"),isSigner:false,isWritable:true
      },
      //3
      {
        pubkey:MYTOKEN_MINT_PUBKEY,isSigner:false,isWritable:false
      },
      //4
      {
        pubkey:new PublicKey(bondingCurve),isSigner:false,isWritable:true
      }, 
      //5
      {
        pubkey:new PublicKey(bondingCurveVault),isSigner:false,isWritable:true
      }, 
      //6
      {
        pubkey:tokenATA,isSigner:false,isWritable:true
      },
      
      //7
      {
        pubkey:wallet.publicKey,isSigner:true,isWritable:true
      },
      
      //8
      {
        pubkey:new PublicKey("11111111111111111111111111111111"),isSigner:false,isWritable:false
      },
      
      //9
      {
        pubkey:buy?TOKEN_PROGRAM_ID:new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"),isSigner:false,isWritable:false
      },
      
      //10
      {
        pubkey:buy?new PublicKey("SysvarRent111111111111111111111111111111111"):TOKEN_PROGRAM_ID,isSigner:false,isWritable:false
      },
     
      //11
      {
        pubkey:new PublicKey("Ce6TQqeHC9p8KetsN6JsjHK7UTZk7nasjjnr7XxXp9F1"),isSigner:false,isWritable:false
      },
      
      //12
      {
        pubkey:new PublicKey("6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P"),isSigner:false,isWritable:false
      },

    ],
    programId:new PublicKey("6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P"),
    data:buy?
    Buffer.from(`66063d1201daebea${amountbuffer.toString("hex")}${solAmountbuffer.toString("hex")}`,'hex')
    :
    Buffer.from(`33e685a4017f83ad${amountbuffer.toString("hex")}0000000000000000`,"hex")
  });
  txObject.add(contractInstruction);
  const jito_tip_accounts=[
    "96gYZGLnJYVFmbjzopPSU6QiEV5fGqZNyN9nmNhvrZU5",
    "HFqU5x63VTqvQss8hp11i4wVV8bD44PvwucfZ2bU7gRe",
    "Cw8CFyM9FkoMi7K7Crf6HNQqf4uEMzpKw6QNghXLvLkY",
    "ADaUMid9yfUytqMBgopwjb2DTLSokTSzL1zt6iGPaS49",
    "DfXygSm4jCyNCybVYYK6DwvWqjKee8pbDmJGcLWNDXjh",
    "ADuUkR4vqLUMWXxW9gh6D6L8pMSawimctcNZ5pGwDcEt",
    "DttWaMuVvTiduZRnguLF7jNxTgiMBZ1hyAumKUiL2KRL",
    "3AVi9Tg9Uo68tJfuvoKvqKNWKkC5wPdSSdeBnizKZ6jT"
  ]
  const jito_tip_amount=BigInt(Number(100000))
  var jito_tip_account=new PublicKey(jito_tip_accounts[6]);
  txObject.add(
    SystemProgram.transfer({
      fromPubkey:wallet.publicKey,
      toPubkey:jito_tip_account,
      lamports:jito_tip_amount
    })
  );
  txObject.feePayer = wallet.publicKey;
  var latestBlock=await connection.getLatestBlockhash();
  txObject.recentBlockhash=latestBlock.blockhash;

  const messageV0 = new TransactionMessage({
    payerKey: wallet.publicKey,
    recentBlockhash: latestBlock.blockhash,
    instructions:txObject.instructions,
  }).compileToV0Message();

  const tx = new VersionedTransaction(messageV0);
  tx.sign([wallet]);
  
  // try {
  //   const txnSignature = await connection.sendTransaction(tx,{maxRetries:3});
  //   // console.log(txnSignature)
  //   console.log("Swap Transaction: https://solscan.io/tx/" + txnSignature);
  //   // const x=await connection.confirmTransaction({
  //   //   signature: txnSignature,
  //   //   blockhash: latestBlock.blockhash,
  //   //   lastValidBlockHeight: latestBlock.lastValidBlockHeight,
  //   // });
  //   // console.log(x)
  //   return true;
  // } catch (error) {
  //   console.log(error)
  //   return false;
  // }

  txObject.partialSign(wallet);
  const serialized=bs58.encode(txObject.serialize());
  let payload = {
    jsonrpc: "2.0",
    id: 1,
    method: "sendBundle",
    params: [[serialized]]
  };

  //https://jito-labs.gitbook.io/mev/searcher-resources/json-rpc-api-reference/url
  const jito_endpoints = [
    'https://ny.mainnet.block-engine.jito.wtf/api/v1/bundles',
    'https://mainnet.block-engine.jito.wtf/api/v1/bundles',
    'https://amsterdam.mainnet.block-engine.jito.wtf/api/v1/bundles',
    'https://frankfurt.mainnet.block-engine.jito.wtf/api/v1/bundles',
    'https://tokyo.mainnet.block-engine.jito.wtf/api/v1/bundles',
  ];
  var result=false;
  for(var endpoint of jito_endpoints){
    
    try {
      let res = await fetch(`${endpoint}`, {
        method: 'POST',
        body: JSON.stringify(payload),
        headers: { 'Content-Type': 'application/json' }
      });
      const responseData=await res.json();
      if(!responseData.error) {
        console.log(`----------${endpoint}-------------`)
        console.log(responseData)
        console.log(`-----------------------------------`)
        result=true;
        // break;
      }else {
        console.log(`----------${endpoint}-------------`)
        console.log(responseData)
        console.log(`-----------------------------------`)
      }
    } catch (error) {
      console.log(`----------${endpoint}-------------`)
      console.log(error)
      console.log(`-----------------------------------`)
    }
  }
  if(!result) return false;
  return true;
}
const pumpfunSwapTransactionWallet=async (wallet,tokenAddress,amount,buy)=>{
  // const PRIVATE_KEY = Uint8Array.from(JSON.parse(process.env.PRIVATE_KEY));
  const connection=new Connection(process.env.RPC_API)
  // const wallet = Keypair.fromSecretKey(PRIVATE_KEY);
  const response = await fetch(`https://pumpportal.fun/api/trade-local`, {
      method: "POST",
      headers: {
          "Content-Type": "application/json"
      },
      body: JSON.stringify({
          "publicKey": wallet.publicKey.toBase58(),
          "action": buy?"buy":"sell",
          "mint": tokenAddress,
          "denominatedInSol": buy?'true':'false',
          "amount": buy?String(amount):"100%",
          "slippage": 10, 
          "priorityFee": 0.0002, 
          "pool": "pump"
      })
  });
  if(response.status === 200){
    const data = await response.arrayBuffer();
    const tx = VersionedTransaction.deserialize(new Uint8Array(data));
    const latestBlock=await connection.getLatestBlockhash();
    tx.message.recentBlockhash=latestBlock.blockhash;
    tx.sign([wallet]);
    const jitoTx=new Transaction();
    jitoTx.add(ComputeBudgetProgram.setComputeUnitPrice({ microLamports: Number(10000)}));
    const jito_tip_accounts=[
      "96gYZGLnJYVFmbjzopPSU6QiEV5fGqZNyN9nmNhvrZU5",
      "HFqU5x63VTqvQss8hp11i4wVV8bD44PvwucfZ2bU7gRe",
      "Cw8CFyM9FkoMi7K7Crf6HNQqf4uEMzpKw6QNghXLvLkY",
      "ADaUMid9yfUytqMBgopwjb2DTLSokTSzL1zt6iGPaS49",
      "DfXygSm4jCyNCybVYYK6DwvWqjKee8pbDmJGcLWNDXjh",
      "ADuUkR4vqLUMWXxW9gh6D6L8pMSawimctcNZ5pGwDcEt",
      "DttWaMuVvTiduZRnguLF7jNxTgiMBZ1hyAumKUiL2KRL",
      "3AVi9Tg9Uo68tJfuvoKvqKNWKkC5wPdSSdeBnizKZ6jT"
    ]
    const jito_tip_amount=BigInt(Number(100000))
    const jito_tip_index=(Math.round(Math.random()*10))%8;
    const jito_tip_account=new PublicKey(jito_tip_accounts[jito_tip_index]);
    jitoTx.add(
      SystemProgram.transfer({
        fromPubkey:wallet.publicKey,
        toPubkey:jito_tip_account,
        lamports:jito_tip_amount
      })
    );
    jitoTx.feePayer = wallet.publicKey;
    // const latestBlock=await connection.getLatestBlockhash("confirmed");
    jitoTx.recentBlockhash=latestBlock.blockhash;
    jitoTx.partialSign(wallet);

    const jitoTxSerialized=bs58.encode(jitoTx.serialize());
    const txSerialized=bs58.encode(tx.serialize());
    // console.log({jitoTxSerialized})
    let payload = {
      jsonrpc: "2.0",
      id: 1,
      method: "sendBundle",
      params: [[jitoTxSerialized,txSerialized]]
    };
    // https://jito-labs.gitbook.io/mev/searcher-resources/json-rpc-api-reference/url
    const jito_endpoints = [
      'https://ny.mainnet.block-engine.jito.wtf/api/v1/bundles',
      'https://mainnet.block-engine.jito.wtf/api/v1/bundles',
      'https://amsterdam.mainnet.block-engine.jito.wtf/api/v1/bundles',
      'https://frankfurt.mainnet.block-engine.jito.wtf/api/v1/bundles',
      'https://tokyo.mainnet.block-engine.jito.wtf/api/v1/bundles',
    ];
    var result=false;
    for(var endpoint of jito_endpoints){
      let res;
      try {
          res= await fetch(`${endpoint}`, {
          method: 'POST',
          body: JSON.stringify(payload),
          headers: { 'Content-Type': 'application/json' }
        });
        const responseData=await res.json();
        if(!responseData.error) {
          console.log(`----------${endpoint}-------------`)
          console.log(responseData)
          console.log(`${buy?"Buying":"Selling"} Tokens is successful!!!`)
          console.log(`-----------------------------------`)
          result=true;
          if(buy)
            break;
        }else {
          console.log(`----------${endpoint}-------------`)
          console.log(responseData)
          console.log(`${buy?"Buying":"Selling"} Tokens is failed!!!`)
          console.log(`-----------------------------------`)
        }
      } catch (error) {
        if(res) console.log(res.statusText)
        console.log(`----------${endpoint}-------------`)
        console.log(error)
        console.log(`${buy?"Buying":"Selling"} Tokens is Failed!!!`)
        console.log(`-----------------------------------`)
      }
    }
    if(!result) return false;
    return true;
    
  } else {
      console.log(response.statusText);
  }
}
module.exports={
  swapToken,
  swapTokenRapid,
  swapTokenLegacy,
  swapTokenBundling,
  swapTokenTrick,
  swapTokenContractSell,
  swapTokenContractBuy,
  swapTokenMy,
  swapTokenTest,
  swapTokenThor,
  swapTokenTestBuy,
  swapPumpfun,
  pumpfunSwapTransaction,
  launchToken,
  trickToken,
  withdrawFromWallet,
  depositWallet,
  deposit,
  swapPumpfunWallet,
  pumpfunSwapTransactionWallet
}