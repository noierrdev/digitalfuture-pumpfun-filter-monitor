require('dotenv').config()
const { Connection, PublicKey, Keypair, Transaction, SystemProgram, ComputeBudgetProgram, TransactionMessage, VersionedTransaction, sendAndConfirmTransaction } = require('@solana/web3.js');
const { TOKEN_PROGRAM_ID, getAssociatedTokenAddress, createAssociatedTokenAccountInstruction, createCloseAccountInstruction, createSyncNativeInstruction, getAssociatedTokenAddressSync} = require('@solana/spl-token');
const {  LIQUIDITY_STATE_LAYOUT_V4, Liquidity,MARKET_STATE_LAYOUT_V3,Market,poolKeys2JsonInfo} = require('@raydium-io/raydium-sdk');

const getJupiterPrice=async (tokenAddress)=>{
    const response=await fetch(`${process.env.JUPITER_URL}/quote?inputMint=${tokenAddress}&outputMint=So11111111111111111111111111111111111111112&amount=1000000000`,{
        method:"GET"
    })
    const responseData=await response.json();
    return responseData;
}

const getJupiterQuote=async (tokenAddress,solAmount_=1)=>{
  const solAmount=Number(solAmount_)*(10**9);
  console.log({solAmount})
  const response=await fetch(`${process.env.JUPITER_URL}/quote?inputMint=So11111111111111111111111111111111111111112&outputMint=${tokenAddress}&amount=${solAmount.toString()}&slippageBps=1000`,{
      method:"GET"
  })
  const responseData=await response.json();
  return responseData;
}


const getBirdeyePrice=async (tokenAddress)=>{
  const response=await fetch(`${process.env.BIRDEYE_API_URL}?address=${tokenAddress}`,{
    headers:{
        'X-API-KEY':process.env.BIRDEYE_API_KEY
    },
    method:"GET"
  })
  try {
    const responseData=await response.json();
    return responseData;
  } catch (error) {
    return null;
  }
  
}

const getTokenAsset=async (tokenAddress)=>{
  try {
    const response = await fetch(`${process.env.HELIUS_RPC}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 'my-id',
        method: 'getAsset',
        params: {
          id: tokenAddress
        },
      }),
    });
    const asset = await response.json();
    return asset;
  } catch (error) {
    return null;
  }
  
}
const getSwapMarket=async (tokenAddress)=>{
    const connection = new Connection(process.env.RPC_API);
  
    const SOL_MINT_ADDRESS = 'So11111111111111111111111111111111111111112';
    const TOKEN_MINT_ADDRESS = tokenAddress; // Replace with your token's mint address
    const raydium_program_id=new PublicKey(process.env.RAYDIUM_OPENBOOK_AMM);
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
                bytes: TOKEN_MINT_ADDRESS,
              },
            },
          ],
        },
    );
    if(accounts.length==0)
        accounts=await connection.getProgramAccounts(
            raydium_program_id,
            {
              commitment: 'confirmed',
              filters: [
                { dataSize: LIQUIDITY_STATE_LAYOUT_V4.span },
                {
                  memcmp: {
                    offset: LIQUIDITY_STATE_LAYOUT_V4.offsetOf('baseMint'),
                    bytes: TOKEN_MINT_ADDRESS,
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
    const poolInfo=LIQUIDITY_STATE_LAYOUT_V4.decode(accounts[0].account.data);
    const marketAccountInfo = await connection.getAccountInfo(poolInfo.marketId);
    if (!marketAccountInfo) {
        return false;
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
    // const poolInfoJson=poolKeys2JsonInfo(poolInfo)
    // console.log(poolKeys)
    return {poolInfo,marketInfo,poolKeys};
}
const getSwapMarketRapid=async (tokenAddress,quoted)=>{
  const connection = new Connection(process.env.RPC_API);

  const SOL_MINT_ADDRESS = 'So11111111111111111111111111111111111111112';
  const TOKEN_MINT_ADDRESS = tokenAddress; // Replace with your token's mint address
  const raydium_program_id=new PublicKey(process.env.RAYDIUM_OPENBOOK_AMM);
  const raydium_auth=new PublicKey(process.env.RAYDIUM_AUTHORITY);
  var accounts=await connection.getProgramAccounts(
      raydium_program_id,
      {
        commitment: "processed",
        filters: [
          { dataSize: LIQUIDITY_STATE_LAYOUT_V4.span },
          {
            memcmp: {
              offset: LIQUIDITY_STATE_LAYOUT_V4.offsetOf('baseMint'),
              bytes: quoted?SOL_MINT_ADDRESS:TOKEN_MINT_ADDRESS,
            },
          },
          {
            memcmp: {
              offset: LIQUIDITY_STATE_LAYOUT_V4.offsetOf('quoteMint'),
              bytes: quoted?TOKEN_MINT_ADDRESS:SOL_MINT_ADDRESS,
            },
          },
        ],
      },
  );
  if(!accounts[0]) {
    console.log("NO ACCOUNTS!!!");
    return null;
  }
  const poolInfo=LIQUIDITY_STATE_LAYOUT_V4.decode(accounts[0].account.data);
  const marketAccountInfo = await connection.getAccountInfo(poolInfo.marketId);
  if (!marketAccountInfo) {
      return false;
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
  };

  const id = poolKeys.poolId;
  delete poolKeys.poolId;
  poolKeys.id = id;
  return {poolInfo,marketInfo,poolKeys};
}

const pumpfunSwapTransaction=async (tokenAddress,amount,buy=true)=>{
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
          "priorityFee": 0.001, 
          "pool": "pump"
      })
  });
  if(response.status === 200){
    const data = await response.arrayBuffer();
    const tx = VersionedTransaction.deserialize(new Uint8Array(data));
    const latestBlock=await connection.getLatestBlockhash();
    tx.message.recentBlockhash=latestBlock.blockhash;
    tx.sign([wallet]);
    try {
      const signature = await connection.sendTransaction(tx)
      console.log("Transaction: https://solscan.io/tx/" + signature);
    } catch (error) {
      console.log(error)
    }
    
  } else {
      console.log(response.statusText);
  }
}
const getSwapMarketFromLP=async (lpMint)=>{
  const connection = new Connection(process.env.RPC_API);

  const raydium_program_id=new PublicKey(process.env.RAYDIUM_OPENBOOK_AMM);
  const raydium_auth=new PublicKey(process.env.RAYDIUM_AUTHORITY);
  var accounts=await connection.getProgramAccounts(
      raydium_program_id,
      {
        commitment: "processed",
        filters: [
          { dataSize: LIQUIDITY_STATE_LAYOUT_V4.span },
          {
            memcmp: {
              offset: LIQUIDITY_STATE_LAYOUT_V4.offsetOf('lpMint'),
              bytes: lpMint,
            },
          }
        ],
      },
  );
  if(!accounts[0]) {
    console.log("NO ACCOUNTS!!!");
    return null;
  }
  const poolInfo=LIQUIDITY_STATE_LAYOUT_V4.decode(accounts[0].account.data);
  const marketAccountInfo = await connection.getAccountInfo(poolInfo.marketId);
  if (!marketAccountInfo) {
      return false;
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
  };

  const id = poolKeys.poolId;
  delete poolKeys.poolId;
  poolKeys.id = id;
  return {poolInfo,marketInfo,poolKeys};
}
module.exports={
    getJupiterPrice,
    getJupiterQuote,
    getSwapMarket,
    getSwapMarketRapid,
    getSwapMarketFromLP,
    getBirdeyePrice,
    getTokenAsset,
    pumpfunSwapTransaction
}