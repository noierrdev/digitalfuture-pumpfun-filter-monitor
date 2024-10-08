require("dotenv").config();

const websocket=require("ws");
const {Connection, Keypair, PublicKey}=require("@solana/web3.js")
// const Client=require("@triton-one/yellowstone-grpc")
const fs=require("fs");
const path=require("path");
const express=require('express');
const http=require('http')
const {Bot,Context,session}=require("grammy");
const { pumpfunSwapTransaction, swapTokenRapid, swapPumpfun } = require("./swap");
const bs58=require("bs58");
const {  LIQUIDITY_STATE_LAYOUT_V4, Liquidity,MARKET_STATE_LAYOUT_V3,Market,poolKeys2JsonInfo, ApiPoolInfoV4, SPL_MINT_LAYOUT} = require('@raydium-io/raydium-sdk');
const { getAssociatedTokenAddressSync } = require("@solana/spl-token");

const PRIVATE_KEY = Uint8Array.from(JSON.parse(process.env.PRIVATE_KEY));

const wallet = Keypair.fromSecretKey(PRIVATE_KEY);

const FULL_BONDINGCURVE_MARKET_CAP=60000;
const PUMPFUN_RAYDIUM_MIGRATION="39azUYFWPz3VHgKCf3VChUwbpURdCHRxjWVowf5jUJjg"
const RAYDIUM_OPENBOOK_AMM="675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8"
const SOL_MINT_ADDRESS = 'So11111111111111111111111111111111111111112';
const RAYDIUM_AUTHORITY="5Q544fKrFoe6tsEbD7S8EmxGTJYAKtTVhAW5Q5pge4j1";
const connection = new Connection(process.env.RPC_URL);//Web3.js Connection



if(!fs.existsSync(path.resolve(__dirname,"logs"))){
    fs.mkdirSync(path.resolve(__dirname,"logs"))
}

if(!fs.existsSync(path.resolve(__dirname,"clients"))){
    fs.mkdirSync(path.resolve(__dirname,"clients"))
}

const clients=fs.readdirSync(path.resolve(__dirname,"clients"));

const bot = new Bot(process.env.TELEGRAM_TOKEN);
const botClients=[];
for(var client of clients){
    botClients.push(Number(client));
}



bot.api.sendMessage("@pumpfun_strategy_channel",`
    <b>Monitor's alarm!</b>\n
    Bot is started!\n
`,{
    parse_mode:"HTML",
    link_preview_options:{
        is_disabled:true
    }
});

var solPrice=130;

async function getSolPrice(){
    try {
        const solPriceRes=await fetch(`https://api-v3.raydium.io/mint/price?mints=So11111111111111111111111111111111111111112`);
        const solPriceData=await solPriceRes.json();
        if(!solPriceData.success){
            return;
        }
        var solPrice=Number(solPriceData.data['So11111111111111111111111111111111111111112'])
        return solPrice;
    } catch (error) {
        
    }
}
setTimeout(async () => {
    solPrice=await getSolPrice();
    console.log(`Initial SOL Price : ${solPrice} $`)
}, 0);


setInterval(async ()=>{
    const newSolPrice=await getSolPrice();
    if(newSolPrice) solPrice=newSolPrice;
    console.log(`SOL Price Updated : ${solPrice} $`)
},60000)

const pumpfunTokens={}

function percentAlert(message,percent){
    if(!pumpfunTokens[message.mint]) return;
    if(pumpfunTokens[message.mint][`percent_${percent}`]) return;
    const currentTime=new Date();
    pumpfunTokens[message.mint][`percent_${percent}`]=currentTime.getTime();
    bot.api.sendMessage("@pumpfun_strategy_channel",`
<b>💊 Token was grown as ${percent} % 💊</b>

<b>Name : ${pumpfunTokens[message.mint].name}</b>
<b>Symbol : ${pumpfunTokens[message.mint].symbol}</b>


<b>Mint : </b>
<code>${message.mint}</code>


<b>BondingCurve : </b>
<code>${message.bondingCurveKey}</code>


<b>Market Cap in SOL : </b>${message.marketCapSol} SOL
<b>Market Cap in USD : </b>${((message.marketCapSol*solPrice)/1000).toFixed(2)} K$
<b>vSOL in bonding curve : </b>${message.vSolInBondingCurve} SOL
<b>Number of Buy Trades : </b>${pumpfunTokens[message.mint].numberOfBuyTrades}
<b>Number of Sell Trades : </b>${pumpfunTokens[message.mint].numberOfSellTrades}
<b>Total Number of Trades : </b>${pumpfunTokens[message.mint].numberOfBuyTrades+pumpfunTokens[message.mint].numberOfSellTrades}

 | <a href="https://photon-sol.tinyastro.io/en/lp/${message.bondingCurveKey}" >Photon</a>
    `,{
        parse_mode:"HTML",
        link_preview_options:{
            is_disabled:true
        }
    });
}

function filterAlert(message){
    if(!pumpfunTokens[message.mint]) return;
    // if(pumpfunTokens[message.mint][`percent_${percent}`]) return;
    const currentTime=new Date();
    // pumpfunTokens[message.mint][`percent_${percent}`]=currentTime.getTime();
    bot.api.sendMessage("@pumpfun_strategy_channel",`
<b>💊 Token was filtered! 💊</b>

<b>Name : ${pumpfunTokens[message.mint].name}</b>
<b>Symbol : ${pumpfunTokens[message.mint].symbol}</b>


<b>Mint : </b>
<code>${message.mint}</code>


<b>BondingCurve : </b>
<code>${message.bondingCurveKey}</code>


<b>Market Cap in SOL : </b>${message.marketCapSol} SOL
<b>Market Cap in USD : </b>${((message.marketCapSol*solPrice)/1000).toFixed(2)} K$
<b>vSOL in bonding curve : </b>${message.vSolInBondingCurve} SOL
<b>Number of Buy Trades : </b>${pumpfunTokens[message.mint].numberOfBuyTrades}
<b>Number of Sell Trades : </b>${pumpfunTokens[message.mint].numberOfSellTrades}
<b>Total Number of Trades : </b>${pumpfunTokens[message.mint].numberOfBuyTrades+pumpfunTokens[message.mint].numberOfSellTrades}

 | <a href="https://photon-sol.tinyastro.io/en/lp/${message.bondingCurveKey}" >Photon</a>
    `,{
        parse_mode:"HTML",
        link_preview_options:{
            is_disabled:true
        }
    });
}


function devSoldAlert(message){
    if(!pumpfunTokens[message.mint]) return;
    // if(pumpfunTokens[message.mint][`percent_${percent}`]) return;
    const currentTime=new Date();
    // pumpfunTokens[message.mint][`percent_${percent}`]=currentTime.getTime();
    bot.api.sendMessage("@pumpfun_strategy_channel",`
<b>💊 Dev sold hold tokens! 💊</b>

<b>Name : ${pumpfunTokens[message.mint].name}</b>
<b>Symbol : ${pumpfunTokens[message.mint].symbol}</b>


<b>Mint : </b>
<code>${message.mint}</code>


<b>BondingCurve : </b>
<code>${message.bondingCurveKey}</code>


<b>Market Cap in SOL : </b>${message.marketCapSol} SOL
<b>Market Cap in USD : </b>${((message.marketCapSol*solPrice)/1000).toFixed(2)} K$
<b>vSOL in bonding curve : </b>${message.vSolInBondingCurve} SOL
<b>Number of Buy Trades : </b>${pumpfunTokens[message.mint].numberOfBuyTrades}
<b>Number of Sell Trades : </b>${pumpfunTokens[message.mint].numberOfSellTrades}
<b>Total Number of Trades : </b>${pumpfunTokens[message.mint].numberOfBuyTrades+pumpfunTokens[message.mint].numberOfSellTrades}

 | <a href="https://photon-sol.tinyastro.io/en/lp/${message.bondingCurveKey}" >Photon</a>
    `,{
        parse_mode:"HTML",
        link_preview_options:{
            is_disabled:true
        }
    });
}

function websocketConnect(){
    
    const ws=new websocket("wss://pumpportal.fun/api/data");
    ws.on("close",()=>{
        setTimeout(() => {
            websocketConnect()
        }, 2000);
    })
    ws.on("message",async (data)=>{
        const message=JSON.parse(data)
        if(!message.txType) {
            console.log(message);
            return;
        }
        const currentTime=new Date();
        const now=currentTime.getTime();
        if(message.txType=="create"){
            // console.log(message)
            const bondingCurveKeyVault=getAssociatedTokenAddressSync(new PublicKey(message.mint),new PublicKey(message.bondingCurveKey),true).toBase58();
            const tokenAccount=getAssociatedTokenAddressSync(new PublicKey(message.mint),wallet.publicKey,true).toBase58();
            pumpfunTokens[message.mint]={
                ...message,
                creator:message.traderPublicKey,
                created:now,
                initMarketCapSol:message.marketCapSol,
                numberOfBuyTrades:0,
                numberOfSellTrades:0,
                numberOfBuyTradesAfterDevSold:0,
                numberOfSellTradesAfterDevSold:0,
                devSold:null,
                devSoldMarketCapSol:0,
                devSoldvSolInBondingCurve:0,
                prevMarketCapSol:message.marketCapSol,
                prevVSolInBondingCurve:message.vSolInBondingCurve,
                volumeSol:message.vSolInBondingCurve-30,
                maxPoint:message.marketCapSol,
                updated:now,
                percent_10:null,
                percent_30:null,
                percent_50:null,
                percent_60:null,
                percent_70:null,
                percent_80:null,
                percent_90:null,
                percent_95:null,
                alerted:null,
                alertedMarketCapSol:0,
                bondingCurveKeyVault,
                tokenAccount,
                // maxBoughtAmount:message.vSolInBondingCurve-30,
                // maxBoughtAddress:message.traderPublicKey
            }
            if(fs.existsSync(path.resolve(__dirname,"logs",message.mint))){
                fs.unlinkSync(path.resolve(__dirname,"logs",message.mint))
            }
            let payload = {
                method: "subscribeTokenTrade",
                keys: [message.mint]
            }
            ws.send(JSON.stringify(payload))
            
            // console.log(bondingCurveKeyVault)
        }else {
            if(!pumpfunTokens[message.mint]) return;
            // console.log(message)
            if(message.txType=="buy"){
                console.log({
                    mint:message.mint,
                    growth_ratio:message.vSolInBondingCurve/115
                })
                if(((message.vSolInBondingCurve-30)/85)>=0.95){
                    // if((!pumpfunTokens[message.mint].percent_95)) pumpfunSwapTransaction(message.mint,0.001,true)
                    await swapPumpfun(message.mint,pumpfunTokens[message.mint].bondingCurveKey,pumpfunTokens[message.mint].bondingCurveKeyVault,100000,true);
                    percentAlert(message,95);
                }
                if(pumpfunTokens[message.mint]&&message.marketCapSol>=pumpfunTokens[message.mint].maxPoint){
                    pumpfunTokens[message.mint].maxPoint=message.marketCapSol;
                }
                if(pumpfunTokens[message.mint]&&(!pumpfunTokens[message.mint].alerted)&&((pumpfunTokens[message.mint].devSold))&&message.marketCapSol>=pumpfunTokens[message.mint].devSoldMarketCapSol){
                    pumpfunTokens[message.mint].alerted=now;
                    pumpfunTokens[message.mint].alertedMarketCapSol=message.marketCapSol;
                    // await swapPumpfun(message.mint,pumpfunTokens[message.mint].bondingCurveKey,pumpfunTokens[message.mint].bondingCurveKeyVault,10000,true);
                    // await pumpfunSwapTransaction(message.mint, 0.001,true);
                    // filterAlert(message)
                }
                if((pumpfunTokens[message.mint].alerted)&&(now-pumpfunTokens[message.mint].alerted>=15000)&&(message.marketCapSol>=pumpfunTokens[message.mint].alertedMarketCapSol)&&(message.traderPublicKey!=wallet.publicKey.toBase58())){
                    // await pumpfunSwapTransaction(message.mint, 0.001,false);
                }
                pumpfunTokens[message.mint].numberOfBuyTrades+=1;
            }
            if(message.txType=="sell"){
                // console.log(message)
                pumpfunTokens[message.mint].numberOfSellTrades+=1;
                if((message.newTokenBalance==0)&&(pumpfunTokens[message.mint].numberOfBuyTrades>10)&&(now-pumpfunTokens[message.mint].created>20000)&&(message.traderPublicKey==pumpfunTokens[message.mint].creator)&&(!pumpfunTokens[message.mint].devSold)){
                    // console.log(message)
                    pumpfunTokens[message.mint].devSold=now;
                    pumpfunTokens[message.mint].devSoldMarketCapSol=pumpfunTokens[message.mint].prevMarketCapSol;
                    pumpfunTokens[message.mint].devSoldvSolInBondingCurve=pumpfunTokens[message.mint].prevVSolInBondingCurve;
                    // devSoldAlert(message)
                }
                
            }
            const marketCapUsd=solPrice*message.marketCapSol;

            
            // if(marketCapUsd/FULL_BONDINGCURVE_MARKET_CAP>0.95){
            // if(message.vSolInBondingCurve/115>0.90){
            //     // if((!pumpfunTokens[message.mint].percent_95)) pumpfunSwapTransaction(message.mint,0.001,true)
            //     await swapPumpfun(message.mint,pumpfunTokens[message.mint].bondingCurveKey,pumpfunTokens[message.mint].bondingCurveKeyVault,100000,true);
            //     percentAlert(message,95);
            // }
            // // else if(marketCapUsd/FULL_BONDINGCURVE_MARKET_CAP>0.9){
            // else if((message.vSolInBondingCurve-30)/85>0.9){
            //     // if((!pumpfunTokens[message.mint].percent_90)&&pumpfunTokens[message.mint].numberOfSellTrades>80) pumpfunSwapTransaction(message.mint,0.1,true)
            //     percentAlert(message,90);
            // }
            // // else if(marketCapUsd/FULL_BONDINGCURVE_MARKET_CAP>0.8){
            // else if((message.vSolInBondingCurve-30)/85>0.8){
            //     percentAlert(message,80);
            // }
            // // else if(marketCapUsd/FULL_BONDINGCURVE_MARKET_CAP>0.7){
            // else if((message.vSolInBondingCurve-30)/85>0.7){
            //     percentAlert(message,70);
            // }
            // // else if(marketCapUsd/FULL_BONDINGCURVE_MARKET_CAP>0.6){
            // else if((message.vSolInBondingCurve-30)/85>0.6){
            //     percentAlert(message,60);
            // }
            // // else if(marketCapUsd/FULL_BONDINGCURVE_MARKET_CAP>0.5){
            // else if((message.vSolInBondingCurve-30)/85>0.5){
            //     percentAlert(message,50);
            // }
            pumpfunTokens[message.mint].volumeSol+=(message.vSolInBondingCurve-pumpfunTokens[message.mint].prevVSolInBondingCurve)
            pumpfunTokens[message.mint].prevMarketCapSol=message.marketCapSol;
            pumpfunTokens[message.mint].prevVSolInBondingCurve=message.vSolInBondingCurve;
            pumpfunTokens[message.mint].updated=now;
        }
    })
    ws.on('open', function open() {

        let payload = {
            method: "subscribeNewToken", 
        }
        ws.send(JSON.stringify(payload));
    });
    setInterval(async () => {
        for(var token of Object.keys(pumpfunTokens)){
            const currentTime=new Date();
            const now=currentTime.getTime()
            const updated=pumpfunTokens[token].updated;
            if(((now-updated)>(20*60000))&&(!pumpfunTokens[token].alerted)){
                delete pumpfunTokens[token];
                // fs.unlinkSync(path.resolve(__dirname,"logs",token))
                payload={
                    method: "unsubscribeTokenTrade",
                    keys: [token] 
                }
                ws.send(JSON.stringify(payload))
            }
        }
    }, 10*60000);
    
}

websocketConnect()
bot.start();
